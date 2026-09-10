import type { LocalPageObservation } from '../../lib/privacy/types';
import { RampartWorkerScanner } from '../../lib/privacy/rampartScanner';
import { VisualPrivacyScanner } from '../../lib/privacy/visualPrivacyScanner';

interface OffscreenRequest {
  type: 'OFFSCREEN_ANALYZE_VISUALS';
  local: LocalPageObservation;
  screenshotDataUrl: string;
}

const rampartScanner = new RampartWorkerScanner();
const scanner = new VisualPrivacyScanner(rampartScanner);

browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'contextshield-rampart-offscreen') {
    port.onMessage.addListener((message: unknown) => {
      const request = message as {
        type?: string;
        model?: string;
        texts?: string[];
      };
      const operation =
        request.type === 'OFFSCREEN_RAMPART_INITIALIZE'
          ? rampartScanner.initialize(request.model).then(() => [])
          : request.type === 'OFFSCREEN_RAMPART_PROTECT' && Array.isArray(request.texts)
            ? rampartScanner.protectMany(request.texts)
            : Promise.reject(new Error('PRIVACY_SCAN_FAILED'));
      void operation
        .then((protections) => port.postMessage({ ok: true, protections }))
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          console.error('[Rampart] offscreen scan failed', detail);
          port.postMessage({ ok: false, error: `PRIVACY_SCAN_FAILED: ${detail}` });
        });
    });
    return;
  }
  if (port.name !== 'contextshield-visual-offscreen') return;
  port.onMessage.addListener((message: unknown) => {
    const request = message as Partial<OffscreenRequest>;
    if (request.type !== 'OFFSCREEN_ANALYZE_VISUALS') return;
    if (!request.local || typeof request.screenshotDataUrl !== 'string') {
      port.postMessage({ ok: false, error: 'PRIVACY_SCAN_FAILED' });
      return;
    }
    void scanner
      .analyze(request.local, request.screenshotDataUrl)
      .then((result) => port.postMessage({ ok: true, result }))
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[Visual] local scan failed', detail);
        port.postMessage({ ok: false, error: `PRIVACY_SCAN_FAILED: ${detail}` });
      });
  });
});
