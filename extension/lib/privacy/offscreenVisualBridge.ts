import { captureLocalScreenshot } from '../perception/localScreenshot';
import type { LocalPageObservation } from './types';
import type {
  VisualAnalysisResult,
  VisualPrivacyScanner,
} from './visualPrivacyScanner';

interface OffscreenReply {
  ok: boolean;
  result?: VisualAnalysisResult;
  error?: string;
}

interface ChromeOffscreenApi {
  hasDocument(): Promise<boolean>;
  createDocument(options: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
}

function offscreenApi(): ChromeOffscreenApi | undefined {
  return (globalThis as typeof globalThis & {
    chrome?: { offscreen?: ChromeOffscreenApi };
  }).chrome?.offscreen;
}

function withCaptureTiming(
  result: VisualAnalysisResult,
  captureMs: number,
): VisualAnalysisResult {
  return {
    ...result,
    timings: {
      modelInitializationMs: result.timings?.modelInitializationMs ?? 0,
      inferenceAndRedactionMs: result.timings?.inferenceAndRedactionMs ?? 0,
      captureMs,
    },
  };
}

export class OffscreenVisualBridge {
  private creating: Promise<void> | null = null;
  private directScanner: VisualPrivacyScanner | null = null;

  private async ensureDocument(): Promise<void> {
    const api = offscreenApi();
    if (!api) throw new Error('PRIVACY_SCAN_FAILED: chrome.offscreen unavailable');
    if (await api.hasDocument()) return;
    this.creating ??= api
      .createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Run local YOLOX and OCR workers without exposing screenshots',
      })
      .finally(() => {
        this.creating = null;
      });
    await this.creating;
  }

  async analyze(local: LocalPageObservation, tabId?: number): Promise<VisualAnalysisResult> {
    const captureStarted = performance.now();
    const tab = tabId === undefined ? undefined : await browser.tabs.get(tabId);
    const screenshotDataUrl = await captureLocalScreenshot(tab?.windowId, tabId);
    const captureMs = performance.now() - captureStarted;
    const localForVisuals: LocalPageObservation = {
      ...local,
      privateValues: [],
    };
    if (!offscreenApi()) {
      if (!this.directScanner) {
        const { VisualPrivacyScanner } = await import('./visualPrivacyScanner');
        this.directScanner = new VisualPrivacyScanner();
      }
      const result = await this.directScanner.analyze(localForVisuals, screenshotDataUrl);
      return withCaptureTiming(result, captureMs);
    }
    await this.ensureDocument();
    const port = browser.runtime.connect({ name: 'contextshield-visual-offscreen' });
    const reply = await new Promise<OffscreenReply>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        port.disconnect();
        reject(new Error('PRIVACY_SCAN_FAILED'));
      }, 180_000);
      port.onMessage.addListener((message: unknown) => {
        settled = true;
        clearTimeout(timer);
        port.disconnect();
        resolve(message as OffscreenReply);
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(timer);
        if (!settled) {
          const detail = browser.runtime.lastError?.message ?? 'offscreen port disconnected';
          reject(new Error(`PRIVACY_SCAN_FAILED: ${detail}`));
        }
      });
      port.postMessage({
        type: 'OFFSCREEN_ANALYZE_VISUALS',
        local: localForVisuals,
        screenshotDataUrl,
      });
    });
    if (!reply.ok || !reply.result) {
      throw new Error(reply.error ?? 'PRIVACY_SCAN_FAILED');
    }
    return withCaptureTiming(reply.result, captureMs);
  }
}
