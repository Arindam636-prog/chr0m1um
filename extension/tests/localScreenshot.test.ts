import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureLocalScreenshot } from '../lib/perception/localScreenshot';

afterEach(() => vi.unstubAllGlobals());
describe('capture target guard', () => {
  it('does not capture a different active tab', async () => {
    const capture = vi.fn();
    vi.stubGlobal('browser', { windows: {}, tabs: { query: vi.fn().mockResolvedValue([{ id: 8 }]), captureVisibleTab: capture } });
    await expect(captureLocalScreenshot(1, 7)).rejects.toThrow('TARGET_TAB_CHANGED');
    expect(capture).not.toHaveBeenCalled();
  });
  it('rejects a switch during capture before the image can enter analysis', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([{ id: 8 }]);
    vi.stubGlobal('browser', { windows: {}, tabs: { query, captureVisibleTab: vi.fn().mockResolvedValue('local image') } });
    await expect(captureLocalScreenshot(1, 7)).rejects.toThrow('TARGET_TAB_CHANGED');
  });
  it('paces concurrent captures within the browser quota without returning stale images', async () => {
    const times: number[] = [];
    vi.stubGlobal('browser', { windows: {}, tabs: { query: vi.fn().mockResolvedValue([{ id: 7 }]), captureVisibleTab: () => { times.push(performance.now()); return Promise.resolve(`image ${times.length}`); } } });
    const values = await Promise.all([captureLocalScreenshot(1, 7), captureLocalScreenshot(1, 7)]);
    expect(values).toEqual(['image 1', 'image 2']);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(590);
  });
});
