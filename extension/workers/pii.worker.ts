import { env } from '@huggingface/transformers';
import { createGuard, type ChatGuard } from '@nationaldesignstudio/rampart';
import rampartWasmFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import rampartWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { protectSegments } from '../lib/privacy/protectSegments';

// MV3 extension workers cannot import the CDN fallback selected by
// Transformers.js. Package both ORT files and load them from the extension.
env.useWasmCache = false;
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = new URL('../models/', self.location.href).href;
const onnxWasm = env.backends.onnx.wasm;
if (!onnxWasm) throw new Error('PRIVACY_SCAN_FAILED: ONNX WASM backend unavailable');
onnxWasm.wasmPaths = {
  mjs: rampartWasmFactoryUrl,
  wasm: rampartWasmUrl,
};

interface WorkerRequest {
  id: string;
  type: 'INITIALIZE' | 'PROTECT';
  texts: string[];
  model?: string;
}

let guard: ChatGuard | null = null;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type } = event.data;
  try {
    if (type === 'INITIALIZE') {
      const model = event.data.model ?? 'rampart';
      const preferredDevice = 'gpu' in navigator ? 'webgpu' : 'wasm';
      try {
        guard = await createGuard({ model, device: preferredDevice, minScore: 0.35 });
      } catch {
        if (preferredDevice !== 'webgpu') throw new Error('MODEL_UNAVAILABLE');
        guard = await createGuard({ model, device: 'wasm', minScore: 0.35 });
      }
      self.postMessage({ id, ok: true, protections: [] });
      return;
    }
    if (!guard) throw new Error('MODEL_UNAVAILABLE');
    const protections = [];
    const currentGuard = guard;
    for (const text of event.data.texts) {
      protections.push(await protectSegments(text, async (part) => {
        const protectedText = await currentGuard.protect(part);
        return {
          text: protectedText.text,
          placeholders: [...protectedText.placeholders],
          localValues: protectedText.placeholders.map((placeholder) => ({
            placeholder, value: currentGuard.reveal(placeholder),
          })),
        };
      }));
    }
    self.postMessage({ id, ok: true, protections });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[Rampart] local model failed', detail);
    self.postMessage({
      id,
      ok: false,
      error: `PRIVACY_SCAN_FAILED: ${detail}`,
      failClosed: true,
    });
  }
};

export {};
