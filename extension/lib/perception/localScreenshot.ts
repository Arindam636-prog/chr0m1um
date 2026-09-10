const MIN_CAPTURE_INTERVAL_MS = 600;
let lastCaptureAt = -Infinity;
let captureQueue: Promise<unknown> = Promise.resolve();

/**
 * Captures the visible tab for local-only analysis. This function deliberately
 * returns a data URL only to its caller; network modules do not accept it.
 */
export async function captureLocalScreenshot(windowId?: number, expectedTabId?: number): Promise<string> {
  const capture = captureQueue.catch(() => undefined).then(async () => {
    // Chrome limits captureVisibleTab to two calls per second. Fast grounded
    // actions can finish sooner than that, but still need a fresh screenshot.
    const delay = Math.max(0, MIN_CAPTURE_INTERVAL_MS - (performance.now() - lastCaptureAt));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    return captureTarget(windowId, expectedTabId);
  });
  captureQueue = capture;
  return capture;
}

async function captureTarget(windowId?: number, expectedTabId?: number): Promise<string> {
  const targetWindowId = windowId ?? browser.windows.WINDOW_ID_CURRENT;
  const assertTarget = async () => {
    if (expectedTabId === undefined) return;
    const [active] = await browser.tabs.query({ active: true, windowId: targetWindowId });
    if (active?.id !== expectedTabId) throw new Error('TARGET_TAB_CHANGED');
  };
  await assertTarget();
  lastCaptureAt = performance.now();
  const screenshot = await browser.tabs.captureVisibleTab(targetWindowId, { format: 'png' });
  await assertTarget();
  return screenshot;
}
