import * as ort from 'onnxruntime-web';

interface InitializeRequest {
  id: string;
  type: 'INITIALIZE';
  detectorUrl: string;
  recognizerUrl: string;
  dictionary: string[];
}

interface RecognizeRequest {
  id: string;
  type: 'RECOGNIZE';
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

type WorkerRequest = InitializeRequest | RecognizeRequest;
type Rect = { x: number; y: number; width: number; height: number };

let detector: ort.InferenceSession | null = null;
let recognizer: ort.InferenceSession | null = null;
let dictionary: string[] = [];

async function createSession(url: string): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(url, { executionProviders: ['webgpu'] });
  } catch {
    return ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
  }
}

function canvasFromRgba(width: number, height: number, rgba: ArrayBuffer): OffscreenCanvas {
  const data = new Uint8ClampedArray(rgba);
  if (data.length !== width * height * 4) throw new Error('INVALID_IMAGE');
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  context.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}

function recognitionTensor(canvas: OffscreenCanvas, width: number, height: number): ort.Tensor {
  const resized = new OffscreenCanvas(width, height);
  const context = resized.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const plane = width * height;
  const data = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index += 1) {
    data[index] = ((pixels[index * 4 + 2] ?? 0) / 255 - 0.5) / 0.5;
    data[plane + index] = ((pixels[index * 4 + 1] ?? 0) / 255 - 0.5) / 0.5;
    data[plane * 2 + index] = ((pixels[index * 4] ?? 0) / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

function detectionTensor(canvas: OffscreenCanvas, width: number, height: number): ort.Tensor {
  const resized = new OffscreenCanvas(width, height);
  const context = resized.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const plane = width * height;
  const data = new Float32Array(plane * 3);
  const means = [0.485, 0.456, 0.406] as const;
  const standardDeviations = [0.229, 0.224, 0.225] as const;
  for (let index = 0; index < plane; index += 1) {
    const bgr = [pixels[index * 4 + 2] ?? 0, pixels[index * 4 + 1] ?? 0, pixels[index * 4] ?? 0];
    for (let channel = 0; channel < 3; channel += 1) {
      const pixelValue = bgr[channel] ?? 0;
      const mean = means[channel] ?? 0;
      const standardDeviation = standardDeviations[channel] ?? 1;
      data[channel * plane + index] =
        (pixelValue / 255 - mean) / standardDeviation;
    }
  }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

function connectedTextBoxes(
  output: ort.Tensor,
  originalWidth: number,
  originalHeight: number,
): Rect[] {
  const dims = output.dims.map(Number);
  const mapHeight = dims.at(-2) ?? 0;
  const mapWidth = dims.at(-1) ?? 0;
  if (!mapWidth || !mapHeight || !(output.data instanceof Float32Array)) {
    throw new Error('UNSUPPORTED_OCR_DETECTOR_OUTPUT');
  }
  const values = output.data;
  const visited = new Uint8Array(mapWidth * mapHeight);
  const boxes: Rect[] = [];
  const indexFor = (x: number, y: number) => y * mapWidth + x;
  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const start = indexFor(x, y);
      if (visited[start] || (values[start] ?? 0) < 0.3) continue;
      visited[start] = 1;
      const queue: Array<[number, number]> = [[x, y]];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const point = queue[cursor];
        if (!point) continue;
        const [currentX, currentY] = point;
        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);
        const neighbours: Array<[number, number]> = [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1],
        ];
        for (const [nextX, nextY] of neighbours) {
          if (nextX < 0 || nextY < 0 || nextX >= mapWidth || nextY >= mapHeight) continue;
          const nextIndex = indexFor(nextX, nextY);
          if (visited[nextIndex] || (values[nextIndex] ?? 0) < 0.3) continue;
          visited[nextIndex] = 1;
          queue.push([nextX, nextY]);
        }
      }
      if ((maxX - minX + 1) * (maxY - minY + 1) < 8) continue;
      const scaleX = originalWidth / mapWidth;
      const scaleY = originalHeight / mapHeight;
      boxes.push({
        x: Math.max(0, (minX - 1) * scaleX),
        y: Math.max(0, (minY - 1) * scaleY),
        width: Math.min(originalWidth, (maxX - minX + 3) * scaleX),
        height: Math.min(originalHeight, (maxY - minY + 3) * scaleY),
      });
    }
  }
  return boxes.sort((left, right) => left.y - right.y || left.x - right.x).slice(0, 200);
}

async function recognizeBox(source: OffscreenCanvas, box: Rect): Promise<{ text: string; confidence: number }> {
  if (!recognizer) throw new Error('MODEL_UNAVAILABLE');
  const crop = new OffscreenCanvas(Math.max(1, Math.ceil(box.width)), Math.max(1, Math.ceil(box.height)));
  const cropContext = crop.getContext('2d');
  if (!cropContext) throw new Error('PRIVACY_SCAN_FAILED');
  cropContext.drawImage(
    source,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  const targetWidth = Math.min(320, Math.max(32, Math.ceil((48 * crop.width) / crop.height / 8) * 8));
  const tensor = recognitionTensor(crop, targetWidth, 48);
  const inputName = recognizer.inputNames[0];
  if (!inputName) throw new Error('MODEL_UNAVAILABLE');
  const outputs = await recognizer.run({ [inputName]: tensor });
  const output = outputs[recognizer.outputNames[0] ?? ''];
  if (!output || !(output.data instanceof Float32Array)) throw new Error('UNSUPPORTED_OCR_OUTPUT');
  const classes = Number(output.dims.at(-1));
  const timesteps = Number(output.dims.at(-2));
  let previous = -1;
  let confidenceTotal = 0;
  let characterCount = 0;
  const characters: string[] = [];
  for (let timestep = 0; timestep < timesteps; timestep += 1) {
    let bestClass = 0;
    let bestScore = -Infinity;
    for (let classIndex = 0; classIndex < classes; classIndex += 1) {
      const score = output.data[timestep * classes + classIndex] ?? -Infinity;
      if (score > bestScore) {
        bestScore = score;
        bestClass = classIndex;
      }
    }
    if (bestClass !== 0 && bestClass !== previous) {
      const character = dictionary[bestClass - 1];
      if (character) {
        characters.push(character);
        confidenceTotal += bestScore;
        characterCount += 1;
      }
    }
    previous = bestClass;
  }
  return {
    text: characters.join(''),
    confidence: characterCount ? confidenceTotal / characterCount : 0,
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id } = event.data;
  try {
    if (event.data.type === 'INITIALIZE') {
      if (event.data.dictionary.length < 2) throw new Error('INVALID_OCR_DICTIONARY');
      [detector, recognizer] = await Promise.all([
        createSession(event.data.detectorUrl),
        createSession(event.data.recognizerUrl),
      ]);
      dictionary = event.data.dictionary;
      self.postMessage({ id, ok: true, lines: [] });
      return;
    }
    if (!detector || !recognizer) throw new Error('MODEL_UNAVAILABLE');
    const source = canvasFromRgba(event.data.width, event.data.height, event.data.rgba);
    const detectorTensor = detectionTensor(source, 736, 736);
    const inputName = detector.inputNames[0];
    if (!inputName) throw new Error('MODEL_UNAVAILABLE');
    const outputs = await detector.run({ [inputName]: detectorTensor });
    const output = outputs[detector.outputNames[0] ?? ''];
    if (!output) throw new Error('MODEL_UNAVAILABLE');
    const boxes = connectedTextBoxes(output, event.data.width, event.data.height);
    const lines = [];
    for (const bbox of boxes) {
      const recognized = await recognizeBox(source, bbox);
      if (recognized.text) lines.push({ ...recognized, bbox });
    }
    self.postMessage({ id, ok: true, lines });
  } catch {
    self.postMessage({ id, ok: false, error: 'PRIVACY_SCAN_FAILED', failClosed: true });
  }
};

export {};
