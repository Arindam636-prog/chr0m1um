/**
 * Captures the visible tab for local-only analysis. This function deliberately
 * returns a data URL only to its caller; network modules do not accept it.
 */
export async function captureLocalScreenshot(windowId?: number): Promise<string> {
  const targetWindowId = windowId ?? browser.windows.WINDOW_ID_CURRENT;
  return await browser.tabs.captureVisibleTab(targetWindowId, { format: 'png' });
}
