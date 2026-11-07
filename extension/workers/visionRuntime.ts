import * as ort from 'onnxruntime-web/webgpu';
import wasmFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url&no-inline';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url&no-inline';

// WXT builds workers in library mode, which otherwise inlines even large
// assets. MV3's self-only CSP requires both runtime files to be packaged URLs.
ort.env.wasm.wasmPaths = { mjs: wasmFactoryUrl, wasm: wasmUrl };

export { ort };
