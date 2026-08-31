import type {
  ContextualPiiScanner,
  ContextualProtection,
  RampartWorkerScanner,
} from './rampartScanner';

interface ChromeOffscreenApi {
  hasDocument(): Promise<boolean>;
  createDocument(options: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
}

interface RampartReply {
  ok: boolean;
  protections?: ContextualProtection[];
  error?: string;
}

function offscreenApi(): ChromeOffscreenApi | undefined {
  return (globalThis as typeof globalThis & {
    chrome?: { offscreen?: ChromeOffscreenApi };
  }).chrome?.offscreen;
}

export class OffscreenRampartBridge implements ContextualPiiScanner {
  private initialized = false;
  private directScanner: RampartWorkerScanner | null = null;

  private async ensureDocument(): Promise<void> {
    const api = offscreenApi();
    if (!api) throw new Error('PRIVACY_SCAN_FAILED: chrome.offscreen unavailable');
    if (await api.hasDocument()) return;
    await api.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the local Rampart PII worker without transmitting page text',
    });
  }

  async initialize(model = 'rampart'): Promise<void> {
    if (this.initialized) return;
    if (!offscreenApi()) {
      if (!this.directScanner) {
        const { RampartWorkerScanner } = await import('./rampartScanner');
        this.directScanner = new RampartWorkerScanner();
      }
      await this.directScanner.initialize(model);
      this.initialized = true;
      return;
    }
    await this.request({ type: 'OFFSCREEN_RAMPART_INITIALIZE', model }, 180_000);
    this.initialized = true;
  }

  async protectMany(texts: readonly string[]): Promise<ContextualProtection[]> {
    if (!this.initialized) throw new Error('PRIVACY_SCAN_FAILED');
    if (texts.some((text) => text.length > 4_000)) throw new Error('PRIVACY_SCAN_FAILED');
    if (this.directScanner) return this.directScanner.protectMany(texts);
    const reply = await this.request(
      { type: 'OFFSCREEN_RAMPART_PROTECT', texts: [...texts] },
      60_000,
    );
    if (!reply.protections) throw new Error('PRIVACY_SCAN_FAILED');
    return reply.protections;
  }

  terminate(): void {
    this.directScanner?.terminate();
    this.directScanner = null;
    this.initialized = false;
  }

  private async request(message: Record<string, unknown>, timeoutMs: number): Promise<RampartReply> {
    await this.ensureDocument();
    const port = browser.runtime.connect({ name: 'contextshield-rampart-offscreen' });
    const reply = await new Promise<RampartReply>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        port.disconnect();
        reject(new Error('PRIVACY_SCAN_FAILED: Rampart worker timed out'));
      }, timeoutMs);
      port.onMessage.addListener((response: unknown) => {
        settled = true;
        clearTimeout(timer);
        port.disconnect();
        resolve(response as RampartReply);
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(timer);
        if (!settled) {
          const detail = browser.runtime.lastError?.message ?? 'offscreen port disconnected';
          reject(new Error(`PRIVACY_SCAN_FAILED: ${detail}`));
        }
      });
      port.postMessage(message);
    });
    if (!reply.ok) throw new Error(reply.error ?? 'PRIVACY_SCAN_FAILED');
    return reply;
  }
}
