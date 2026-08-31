export interface ContextualProtection {
  text: string;
  placeholders: string[];
  localValues?: Array<{ placeholder: string; value: string }>;
}

interface WorkerReply {
  id: string;
  ok: boolean;
  protections?: ContextualProtection[];
  error?: string;
}

interface PendingRequest {
  resolve: (protections: ContextualProtection[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ContextualPiiScanner {
  protectMany(texts: readonly string[]): Promise<ContextualProtection[]>;
  terminate(): void;
}

export class RampartWorkerScanner implements ContextualPiiScanner {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private initialized = false;

  constructor() {
    this.worker = new Worker(new URL('../../workers/pii.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(event.data.id);
      if (!event.data.ok || !event.data.protections) {
        request.reject(new Error(event.data.error ?? 'PRIVACY_SCAN_FAILED'));
        return;
      }
      request.resolve(event.data.protections);
    });
    this.worker.addEventListener('error', (event) => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(`PRIVACY_SCAN_FAILED: ${event.message}`));
      }
      this.pending.clear();
    });
  }

  async initialize(model = 'rampart'): Promise<void> {
    if (this.initialized) return;
    await this.request('INITIALIZE', [], model, 120_000);
    this.initialized = true;
  }

  async protectMany(texts: readonly string[]): Promise<ContextualProtection[]> {
    if (!this.initialized) throw new Error('PRIVACY_SCAN_FAILED');
    if (texts.some((text) => text.length > 4_000)) throw new Error('PRIVACY_SCAN_FAILED');
    return this.request('PROTECT', [...texts], undefined, 60_000);
  }

  terminate(): void {
    this.worker.terminate();
    this.initialized = false;
  }

  private request(
    type: 'INITIALIZE' | 'PROTECT',
    texts: string[],
    model: string | undefined,
    timeoutMs: number,
  ): Promise<ContextualProtection[]> {
    const id = `worker_${crypto.randomUUID().replaceAll('-', '')}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('PRIVACY_SCAN_FAILED'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, texts, model });
    });
  }
}
