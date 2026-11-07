import { defineConfig } from 'wxt';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// Transformers pins its own ORT version. Its WASM files must come from that
// same installation, rather than the separate runtime used for vision/OCR.
const transformersRequire = createRequire(import.meta.resolve('@huggingface/transformers'));
const rampartRuntimeDirectory = dirname(transformersRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs'));

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: { alias: { 'rampart-onnxruntime': rampartRuntimeDirectory } },
  }),
  manifest: ({ browser }) => ({
    name: 'ContextShield',
    description: 'Privacy-preserving local-first browser agent',
    version: '1.5.0',
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8000 http://localhost:8000",
    },
    browser_specific_settings: {
      gecko: {
        id: 'contextshield@sih26171.local',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['websiteActivity', 'websiteContent'],
        },
      },
    },
  }),
});
