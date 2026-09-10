import type {
  BBox,
  PageElement,
  SafeVisualCrop,
  SensitiveEntityType,
} from '@contextshield/shared';

import { detectSensitiveText } from './deterministicDetectors';
import { mergeVisualDetections } from './visualEvidence';
import { RampartWorkerScanner } from './rampartScanner';
import { createVerifiedPngCrop, irreversiblyMask, type RasterImage } from './rasterRedactor';
import { privateInputMasks } from './inputMasks';
import type {
  LocalOcrHint,
  LocalPageObservation,
  LocalVisualHint,
} from './types';

interface Detection {
  type: 'FACE' | 'PRIVATE_DOCUMENT';
  confidence: number;
  bbox: BBox;
}

interface OcrLine {
  text: string;
  confidence: number;
  bbox: BBox;
}

interface WorkerReply {
  id: string;
  ok: boolean;
  detections?: Detection[];
  lines?: OcrLine[];
  error?: string;
}

interface PendingRequest {
  resolve: (reply: WorkerReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const PRIVATE_DOCUMENT_TYPES = new Set<SensitiveEntityType>([
  'PAN',
  'GSTIN',
  'PAYMENT_CARD',
  'AADHAAR_LIKE',
  'ACCOUNT_ID',
]);

const MAX_VISUAL_REGIONS = 8;
const MAX_CROP_SIDE = 640;
const MAX_VIEWPORT_SIDE = 960;
const MAX_PIXEL_RECORDS = 160;
const VIEWPORT_REGION_ID = 'region_viewport';

class LocalWorkerClient {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(event.data.id);
      if (!event.data.ok) {
        request.reject(new Error(event.data.error ?? 'PRIVACY_SCAN_FAILED'));
      } else {
        request.resolve(event.data);
      }
    });
    worker.addEventListener('error', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('PRIVACY_SCAN_FAILED'));
      }
      this.pending.clear();
    });
  }

  request(message: Record<string, unknown>, timeoutMs: number, transfer: Transferable[] = []) {
    const id = `visual_${crypto.randomUUID().replaceAll('-', '')}`;
    return new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('PRIVACY_SCAN_FAILED'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

function transferableCopy(data: Uint8ClampedArray): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function expanded(box: BBox, width: number, height: number, padding = 6): BBox {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  return {
    x,
    y,
    width: Math.min(width, box.x + box.width + padding) - x,
    height: Math.min(height, box.y + box.height + padding) - y,
  };
}

async function screenshotCanvas(dataUrl: string): Promise<OffscreenCanvas> {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new Error('PRIVACY_SCAN_FAILED');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: match[1] }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function cropRegion(
  screenshot: OffscreenCanvas,
  region: LocalPageObservation['observation']['visual_regions'][number],
  viewport: LocalPageObservation['observation']['viewport'],
): RasterImage {
  const scaleX = screenshot.width / viewport.width;
  const scaleY = screenshot.height / viewport.height;
  const sourceX = Math.max(0, Math.floor(region.bbox.x * scaleX));
  const sourceY = Math.max(0, Math.floor(region.bbox.y * scaleY));
  const sourceWidth = Math.max(
    1,
    Math.min(screenshot.width - sourceX, Math.ceil(region.bbox.width * scaleX)),
  );
  const sourceHeight = Math.max(
    1,
    Math.min(screenshot.height - sourceY, Math.ceil(region.bbox.height * scaleY)),
  );
  const downscale = Math.min(1, MAX_CROP_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * downscale));
  const height = Math.max(1, Math.round(sourceHeight * downscale));
  const crop = new OffscreenCanvas(width, height);
  const context = crop.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  context.drawImage(
    screenshot,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

function fullViewportRaster(screenshot: OffscreenCanvas): RasterImage {
  const downscale = Math.min(1, MAX_VIEWPORT_SIDE / Math.max(screenshot.width, screenshot.height));
  const width = Math.max(1, Math.round(screenshot.width * downscale));
  const height = Math.max(1, Math.round(screenshot.height * downscale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PRIVACY_SCAN_FAILED');
  context.drawImage(screenshot, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

function rasterBoxToViewport(
  box: BBox,
  raster: RasterImage,
  viewport: LocalPageObservation['observation']['viewport'],
): BBox {
  return {
    x: (box.x / raster.width) * viewport.width,
    y: (box.y / raster.height) * viewport.height,
    width: (box.width / raster.width) * viewport.width,
    height: (box.height / raster.height) * viewport.height,
  };
}

function intersection(left: BBox, right: BBox): BBox | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottomEdge <= y) return null;
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function viewportBoxToCrop(box: BBox, region: BBox, crop: RasterImage, linePaddingRatio = 0): BBox | null {
  const clipped = intersection(box, region);
  if (!clipped || region.width <= 0 || region.height <= 0) return null;
  return expanded(
    {
      x: ((clipped.x - region.x) / region.width) * crop.width,
      y: ((clipped.y - region.y) / region.height) * crop.height,
      width: (clipped.width / region.width) * crop.width,
      height: (clipped.height / region.height) * crop.height,
    },
    crop.width,
    crop.height,
    Math.max(6, (clipped.height / region.height) * crop.height * linePaddingRatio),
  );
}

function stableVisualId(text: string, box: BBox, index: number): string {
  const value = `${text}|${Math.round(box.x)}|${Math.round(box.y)}|${index}`;
  let hash = 2_166_136_261;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    hash ^= value.charCodeAt(cursor);
    hash = Math.imul(hash, 16_777_619);
  }
  return `el_visual_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface VisualAnalysisResult {
  visualHints: LocalVisualHint[];
  ocrHints: LocalOcrHint[];
  safeVisualCrops: SafeVisualCrop[];
  visualElements?: PageElement[];
  timings?: {
    captureMs?: number;
    modelInitializationMs: number;
    inferenceAndRedactionMs: number;
  };
}

export class VisualPrivacyScanner {
  // The text channel and the image channel must use the same contextual
  // protection. Regex-only OCR masking misses names embedded in sentences.
  constructor(private readonly contextualScanner = new RampartWorkerScanner()) {}
  private readonly vision = new LocalWorkerClient(
    new Worker(new URL('../../workers/vision.worker.ts', import.meta.url), { type: 'module' }),
  );
  private readonly ocr = new LocalWorkerClient(
    new Worker(new URL('../../workers/ocr.worker.ts', import.meta.url), { type: 'module' }),
  );
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const dictionaryUrl = browser.runtime.getURL('/models/ppocrv6-tiny-dictionary.json');
    const dictionaryResponse = await globalThis.fetch(dictionaryUrl);
    if (!dictionaryResponse.ok) throw new Error('PRIVACY_SCAN_FAILED');
    const dictionary = (await dictionaryResponse.json()) as unknown;
    if (!Array.isArray(dictionary) || dictionary.some((entry) => typeof entry !== 'string')) {
      throw new Error('PRIVACY_SCAN_FAILED');
    }
    await Promise.all([
      this.contextualScanner.initialize(),
      this.vision.request(
        {
          type: 'INITIALIZE',
          modelUrl: browser.runtime.getURL('/models/yolox-face.onnx'),
          labels: ['FACE'],
          inputSize: 192,
        },
        120_000,
      ),
      this.ocr.request(
        {
          type: 'INITIALIZE',
          detectorUrl: browser.runtime.getURL('/models/ppocrv6-tiny-det.onnx'),
          recognizerUrl: browser.runtime.getURL('/models/ppocrv6-tiny-rec.onnx'),
          dictionary,
        },
        120_000,
      ),
    ]);
    this.initialized = true;
  }

  async analyze(
    local: LocalPageObservation,
    screenshotDataUrl: string,
  ): Promise<VisualAnalysisResult> {
    const initializationStarted = performance.now();
    await this.initialize();
    const modelInitializationMs = performance.now() - initializationStarted;
    const inferenceStarted = performance.now();
    const screenshot = await screenshotCanvas(screenshotDataUrl);
    const originalViewport = fullViewportRaster(screenshot);
    const inputMasks = privateInputMasks(local.observation.elements);
    // Do not let OCR reintroduce a filled local-only input into the safe text
    // channel. The same boxes are applied to every outgoing image crop below.
    const viewportRaster = irreversiblyMask(originalViewport, inputMasks.map((box) => ({
      x: box.x / local.observation.viewport.width * originalViewport.width,
      y: box.y / local.observation.viewport.height * originalViewport.height,
      width: box.width / local.observation.viewport.width * originalViewport.width,
      height: box.height / local.observation.viewport.height * originalViewport.height,
    })));
    const visualHints = [...local.visualHints];
    const ocrHints = [...local.ocrHints];
    const safeVisualCrops = [...local.safeVisualCrops];
    const visualElements: PageElement[] = [];
    let localEntitySequence = 0;

    const visionBuffer = transferableCopy(viewportRaster.data);
    const ocrBuffer = transferableCopy(viewportRaster.data);
    const [visionReply, ocrReply] = await Promise.all([
      this.vision.request(
        {
          type: 'DETECT',
          width: viewportRaster.width,
          height: viewportRaster.height,
          rgba: visionBuffer,
          confidence: 0.35,
        },
        30_000,
        [visionBuffer],
      ),
      this.ocr.request(
        {
          type: 'RECOGNIZE',
          width: viewportRaster.width,
          height: viewportRaster.height,
          rgba: ocrBuffer,
        },
        60_000,
        [ocrBuffer],
      ),
    ]);

    const candidates = local.observation.visual_regions.filter((region) => region.requires_analysis);
    const rasters = new Map<string, RasterImage>();
    const viewportDetections = (visionReply.detections ?? []).map((detection) => ({
      ...detection,
      viewportBox: rasterBoxToViewport(
        detection.bbox,
        viewportRaster,
        local.observation.viewport,
      ),
    }));
    // A small portrait may disappear when the whole viewport is scaled to the
    // model's 192px input. Inspect bounded candidate crops at local resolution
    // too, then merge overlapping detections in viewport coordinates.
    for (const region of candidates.slice(0, MAX_VISUAL_REGIONS)) {
      const raster = cropRegion(screenshot, region, local.observation.viewport);
      rasters.set(region.id, raster);
      const buffer = transferableCopy(raster.data);
      const reply = await this.vision.request({ type: 'DETECT', width: raster.width, height: raster.height, rgba: buffer, confidence: 0.35 }, 30_000, [buffer]);
      for (const detection of reply.detections ?? []) {
        viewportDetections.push({ ...detection, viewportBox: {
          x: region.bbox.x + detection.bbox.x / raster.width * region.bbox.width,
          y: region.bbox.y + detection.bbox.y / raster.height * region.bbox.height,
          width: detection.bbox.width / raster.width * region.bbox.width,
          height: detection.bbox.height / raster.height * region.bbox.height,
        } });
      }
    }
    const faceBoxes = mergeVisualDetections(viewportDetections);
    for (const detection of faceBoxes) {
      visualHints.push({ regionId: VIEWPORT_REGION_ID, type: detection.type, evidenceId: detection.evidenceId });
      if (visualElements.length < MAX_PIXEL_RECORDS) {
        visualElements.push({
          id: stableVisualId(detection.type, detection.viewportBox, visualElements.length),
          role: 'visual_region',
          tag: 'visual',
          text: 'Protected face region',
          label: null,
          input_type: null,
          bbox: detection.viewportBox,
          visible: true,
          enabled: false,
          selected: null,
          value_present: false,
          options: [],
          selected_option: null,
          control_value: null,
          dom_index: local.observation.elements.length + visualElements.length,
          sources: ['VISION'],
        });
      }
    }

    const sensitiveOcrBoxes: Array<{ box: BBox; types: SensitiveEntityType[] }> = [];
    const ocrLines = ocrReply.lines ?? [];
    const protections = await this.contextualScanner.protectMany(
      ocrLines.map((line) => line.text.trim().replace(/\s+/g, ' ').slice(0, 2_000)),
    );
    if (protections.length !== ocrLines.length) throw new Error('PRIVACY_SCAN_FAILED');
    for (const [index, line] of (ocrReply.lines ?? []).entries()) {
      const text = line.text.trim().replace(/\s+/g, ' ').slice(0, 2_000);
      if (!text) continue;
      const viewportBox = rasterBoxToViewport(
        line.bbox,
        viewportRaster,
        local.observation.viewport,
      );
      if (visualElements.length < MAX_PIXEL_RECORDS) {
        visualElements.push({
          id: stableVisualId(text, viewportBox, index),
          role: 'visual_text',
          tag: 'visual',
          text,
          label: null,
          input_type: null,
          bbox: viewportBox,
          visible: true,
          // Pixel records help understanding but are never directly actionable.
          // Actions still require a fused DOM element ID checked by ActionBroker.
          enabled: false,
          selected: null,
          value_present: false,
          options: [],
          selected_option: null,
          control_value: null,
          dom_index: local.observation.elements.length + visualElements.length,
          sources: ['OCR'],
        });
      }
      const found = detectSensitiveText(
        text,
        'VISUAL',
        'OCR',
        null,
        () => `pii_visual_${++localEntitySequence}`,
      );
      if (found.length === 0 && !protections[index]?.placeholders.length) continue;
      const types = [...new Set(found.map((entity) => entity.entity.type))];
      sensitiveOcrBoxes.push({ box: viewportBox, types });
      for (const entity of found) {
        ocrHints.push({
          regionId: VIEWPORT_REGION_ID,
          type: entity.entity.type,
          rawValue: entity.rawValue,
          confidence: Math.min(1, Math.max(0, line.confidence)),
        });
      }
    }

    for (const region of candidates.slice(0, MAX_VISUAL_REGIONS)) {
      const raster = rasters.get(region.id);
      if (!raster) throw new Error('PRIVACY_SCAN_FAILED');
      const masks: BBox[] = [];
      for (const input of inputMasks) {
        const mask = viewportBoxToCrop(input, region.bbox, raster);
        if (mask) masks.push(mask);
      }
      for (const detection of faceBoxes) {
        // Detector boxes are estimates, not perfect face outlines. Pad the
        // mask only (not the detection/count), proportional to face size.
        const padded = expanded(detection.viewportBox, local.observation.viewport.width,
          local.observation.viewport.height, Math.max(6, detection.viewportBox.height * .15));
        const mask = viewportBoxToCrop(padded, region.bbox, raster);
        if (!mask) continue;
        masks.push(mask);
        visualHints.push({ regionId: region.id, type: detection.type, evidenceId: detection.evidenceId });
      }

      const declared = local.visualHints.filter((hint) => hint.regionId === region.id);
      let privateDocument = declared.some((hint) => hint.type === 'PRIVATE_DOCUMENT');
      if (declared.some((hint) => hint.type === 'FACE')) {
        masks.push({ x: 0, y: 0, width: raster.width, height: raster.height });
      }

      for (const sensitive of sensitiveOcrBoxes) {
        // OCR boxes can clip glyph edges after viewport downscaling. Include
        // a line-height-scaled safety margin rather than trusting tight boxes.
        const mask = viewportBoxToCrop(sensitive.box, region.bbox, raster, .4);
        if (!mask) continue;
        masks.push(mask);
        if (sensitive.types.some((type) => PRIVATE_DOCUMENT_TYPES.has(type))) {
          privateDocument = true;
        }
      }

      if (privateDocument) {
        if (!visualHints.some((hint) => hint.regionId === region.id && hint.type === 'PRIVATE_DOCUMENT')) {
          visualHints.push({ regionId: region.id, type: 'PRIVATE_DOCUMENT' });
        }
        continue;
      }

      safeVisualCrops.push(
        await createVerifiedPngCrop(`crop_${region.id}`, raster, masks),
      );
    }

    for (const region of candidates.slice(MAX_VISUAL_REGIONS)) {
      visualHints.push({ regionId: region.id, type: 'PRIVATE_DOCUMENT' });
    }

    return {
      visualHints,
      ocrHints,
      safeVisualCrops,
      visualElements,
      timings: {
        modelInitializationMs,
        inferenceAndRedactionMs: performance.now() - inferenceStarted,
      },
    };
  }

  terminate(): void {
    this.vision.terminate();
    this.ocr.terminate();
    this.initialized = false;
  }
}
