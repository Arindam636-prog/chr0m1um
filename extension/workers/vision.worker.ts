import * as ort from 'onnxruntime-web';

interface InitializeRequest {
  id: string;
  type: 'INITIALIZE';
  modelUrl: string;
  labels: Array<'FACE' | 'PRIVATE_DOCUMENT'>;
  inputSize?: number;
}

interface DetectRequest {
  id: string;
  type: 'DETECT';
  width: number;
  height: number;
  rgba: ArrayBuffer;
  confidence?: number;
}

type WorkerRequest = InitializeRequest | DetectRequest;

interface Detection {
  type: 'FACE' | 'PRIVATE_DOCUMENT';
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

let session: ort.InferenceSession | null = null;
let labels: Array<'FACE' | 'PRIVATE_DOCUMENT'> = [];
let inputSize = 640;

function intersectionOverUnion(left: Detection, right: Detection): number {
  const x1 = Math.max(left.bbox.x, right.bbox.x);
  const y1 = Math.max(left.bbox.y, right.bbox.y);
  const x2 = Math.min(left.bbox.x + left.bbox.width, right.bbox.x + right.bbox.width);
  const y2 = Math.min(left.bbox.y + left.bbox.height, right.bbox.y + right.bbox.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.bbox.width * left.bbox.height + right.bbox.width * right.bbox.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function nonMaximumSuppression(detections: Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const detection of detections.sort((a, b) => b.confidence - a.confidence)) {
    if (kept.some((candidate) => candidate.type === detection.type && intersectionOverUnion(candidate, detection) > 0.45)) continue;
    kept.push(detection);
  }
  return kept.slice(0, 100);
}

function preprocess(width: number, height: number, rgba: Uint8ClampedArray): ort.Tensor {
  if (rgba.length !== width * height * 4) throw new Error('INVALID_IMAGE');
  const canvas = new OffscreenCanvas(inputSize, inputSize);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  const source = new OffscreenCanvas(width, height);
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('PRIVACY_SCAN_FAILED');
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const scale = Math.min(inputSize / width, inputSize / height);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);
  context.fillStyle = 'rgb(114,114,114)';
  context.fillRect(0, 0, inputSize, inputSize);
  context.drawImage(source, 0, 0, scaledWidth, scaledHeight);
  const pixels = context.getImageData(0, 0, inputSize, inputSize).data;
  const chw = new Float32Array(3 * inputSize * inputSize);
  const plane = inputSize * inputSize;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    // YOLOX's published preprocessing keeps the 0-255 range and uses BGR.
    chw[pixel] = pixels[pixel * 4 + 2] ?? 0;
    chw[plane + pixel] = pixels[pixel * 4 + 1] ?? 0;
    chw[plane * 2 + pixel] = pixels[pixel * 4] ?? 0;
  }
  return new ort.Tensor('float32', chw, [1, 3, inputSize, inputSize]);
}

function decode(
  output: ort.Tensor,
  originalWidth: number,
  originalHeight: number,
  threshold: number,
): Detection[] {
  const dimensions = output.dims.map(Number);
  const rowCount = dimensions.length === 3 ? dimensions[1] : dimensions[0];
  const columns = dimensions.at(-1) ?? 0;
  if (!rowCount || columns < 5 + labels.length || !(output.data instanceof Float32Array)) {
    throw new Error('UNSUPPORTED_YOLOX_OUTPUT');
  }
  const values = output.data;
  const scale = Math.min(inputSize / originalWidth, inputSize / originalHeight);
  const detections: Detection[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const offset = row * columns;
    const objectness = values[offset + 4] ?? 0;
    let bestClass = 0;
    let bestScore = 0;
    for (let classIndex = 0; classIndex < labels.length; classIndex += 1) {
      const score = objectness * (values[offset + 5 + classIndex] ?? 0);
      if (score > bestScore) {
        bestScore = score;
        bestClass = classIndex;
      }
    }
    const type = labels[bestClass];
    if (!type || bestScore < threshold) continue;
    const centerX = (values[offset] ?? 0) / scale;
    const centerY = (values[offset + 1] ?? 0) / scale;
    const width = (values[offset + 2] ?? 0) / scale;
    const height = (values[offset + 3] ?? 0) / scale;
    detections.push({
      type,
      confidence: bestScore,
      bbox: {
        x: Math.max(0, centerX - width / 2),
        y: Math.max(0, centerY - height / 2),
        width: Math.min(width, originalWidth),
        height: Math.min(height, originalHeight),
      },
    });
  }
  return nonMaximumSuppression(detections);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id } = event.data;
  try {
    if (event.data.type === 'INITIALIZE') {
      labels = event.data.labels;
      inputSize = event.data.inputSize ?? 640;
      if (labels.length === 0 || labels.some((label) => !['FACE', 'PRIVATE_DOCUMENT'].includes(label))) {
        throw new Error('UNSUPPORTED_LABELS');
      }
      try {
        session = await ort.InferenceSession.create(event.data.modelUrl, {
          executionProviders: ['webgpu'],
        });
      } catch {
        session = await ort.InferenceSession.create(event.data.modelUrl, {
          executionProviders: ['wasm'],
        });
      }
      self.postMessage({ id, ok: true, detections: [] });
      return;
    }
    if (!session) throw new Error('MODEL_UNAVAILABLE');
    const tensor = preprocess(
      event.data.width,
      event.data.height,
      new Uint8ClampedArray(event.data.rgba),
    );
    const inputName = session.inputNames[0];
    if (!inputName) throw new Error('MODEL_UNAVAILABLE');
    const outputs = await session.run({ [inputName]: tensor });
    const output = outputs[session.outputNames[0] ?? ''];
    if (!output) throw new Error('MODEL_UNAVAILABLE');
    const detections = decode(
      output,
      event.data.width,
      event.data.height,
      event.data.confidence ?? 0.35,
    );
    self.postMessage({ id, ok: true, detections });
  } catch {
    self.postMessage({ id, ok: false, error: 'PRIVACY_SCAN_FAILED', failClosed: true });
  }
};

export {};
