// navigator.gpu can exist on a CPU-only machine. Check for an actual adapter
// before initializing ORT, since a failed backend initialization is cached.
export async function preferredExecutionProvider(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as {
      gpu?: { requestAdapter(): Promise<unknown> };
    }).gpu;
    return await gpu?.requestAdapter() ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}
