import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tests the native boundary without a device or real account credentials.
const mocks = vi.hoisted(() => ({
    platform: 'android', start: vi.fn(), request: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
    Capacitor: { getPlatform: () => mocks.platform },
    CapacitorHttp: { request: mocks.request },
    registerPlugin: () => ({ start: mocks.start }),
}));

beforeEach(() => {
    vi.resetModules();
    mocks.platform = 'android';
    mocks.start.mockReset().mockResolvedValue({ port: 39843, token: 'test-token' });
    mocks.request.mockReset().mockResolvedValue({ status: 200, headers: {}, data: '{"code":200}' });
});
describe('Android API boundary', () => {
    it('uses the authenticated native HTTP channel and shares runtime startup', async () => {
        const { androidApiFetch } = await import('../../../src/services/androidRuntime');
        const [a, b] = await Promise.all([
            androidApiFetch('http://127.0.0.1:39843/search?keywords=test'),
            androidApiFetch('http://127.0.0.1:39843/health'),
        ]);
        expect(await a.json()).toEqual({ code: 200 });
        expect(b.status).toBe(200);
        expect(mocks.start).toHaveBeenCalledTimes(1);
        expect(mocks.request.mock.calls[0][0].headers['X-Folia-Token']).toBe('test-token');
    });
    it('never sends the token to a remote origin', async () => {
        const { androidApiFetch } = await import('../../../src/services/androidRuntime');
        await expect(androidApiFetch('https://example.com/')).rejects.toThrow('Unexpected Android API origin');
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it('does not send requests already aborted', async () => {
        const { androidApiFetch } = await import('../../../src/services/androidRuntime');
        const controller = new AbortController();
        controller.abort();
        await expect(androidApiFetch('http://127.0.0.1:39843/health', { signal: controller.signal })).rejects.toThrow();
        expect(mocks.request).not.toHaveBeenCalled();
    });
    it('retries a rejected native startup', async () => {
        mocks.start.mockRejectedValueOnce(new Error('startup failed'));
        const { getAndroidRuntime } = await import('../../../src/services/androidRuntime');
        await expect(getAndroidRuntime()).rejects.toThrow('startup failed');
        await expect(getAndroidRuntime()).resolves.toHaveProperty('port', 39843);
    });
});
