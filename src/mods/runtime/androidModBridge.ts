import { Capacitor } from '@capacitor/core';
import { androidApiFetch, getAndroidRuntime } from '../../services/androidRuntime';
import type { ModLogEntry, ModRuntimeInfo, ModExportProgress, ModsListPayload } from '../types';

// src/mods/runtime/androidModBridge.ts
// window.electron.mods for the Android build: the same calls, answered by the
// plugin host inside the packaged Node runtime (androidBackend/folioHost.cjs).
// Client entries, the shared data file and main-entry RPC all live there; this
// file only carries the renderer's half, so nothing above it needs to know
// whether it is talking to Electron or to the local host.
//
// Deliberately absent, and refused the same way Electron refuses a mod without
// the capability: file pickers, ffmpeg export and the runtime snapshot push.

type ModsBridge = NonNullable<NonNullable<typeof window.electron>['mods']>;
type Json = Record<string, unknown>;

/** The plugin host is served by the packaged runtime, which may still be booting. */
const HOST_ROUTES = 'folio/mods';

const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';

async function call<T>(route: string, payload: Json = {}, attempt = 0): Promise<T> {
    const info = await getAndroidRuntime();
    const response = await androidApiFetch(`http://127.0.0.1:${info.port}/${HOST_ROUTES}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        // 503 means the music backend is not up yet; the plugin host answers regardless,
        // so anything else is a real refusal.
        if (response.status >= 500 && attempt < 5) {
            await new Promise(resolve => setTimeout(resolve, 300));
            return call<T>(route, payload, attempt + 1);
        }
        throw new Error(`plugin host answered ${response.status}`);
    }
    return await response.json() as T;
}

const listeners = new Set<(mods: ModRuntimeInfo[]) => void>();
const emptyList = (): ModsListPayload => ({
    mods: [],
    ffmpeg: { available: false, path: null, version: null, candidates: [] },
    directories: [],
    startSkipped: false,
});

function createBridge(): ModsBridge {
    const publish = (mods: ModRuntimeInfo[]): void => {
        for (const listener of listeners) {
            try { listener(mods); } catch { /* A bad listener must not break the others. */ }
        }
    };
    return {
        listMods: async (): Promise<ModsListPayload> => {
            try {
                const payload = await call<ModsListPayload>('list');
                return {
                    mods: Array.isArray(payload?.mods) ? payload.mods : [],
                    ffmpeg: payload?.ffmpeg ?? emptyList().ffmpeg,
                    directories: Array.isArray(payload?.directories) ? payload.directories : [],
                    startSkipped: payload?.startSkipped === true,
                };
            } catch {
                return emptyList();
            }
        },
        reloadMods: async () => {
            const payload = await call<{ mods?: ModRuntimeInfo[] }>('reload');
            const mods = Array.isArray(payload?.mods) ? payload.mods : [];
            publish(mods);
            return { mods };
        },
        setModEnabled: async (modId: string, enabled: boolean) => {
            const answer = await call<{ ok?: boolean; error?: string; mods?: ModRuntimeInfo[] }>('set-enabled', { id: modId, enabled });
            const mods = Array.isArray(answer?.mods) ? answer.mods : [];
            publish(mods);
            return { ok: Boolean(answer?.ok), error: answer?.error, mods };
        },
        invokeModRpc: (modId: string, name: string, args: unknown[]) => call('rpc', { id: modId, name, args }),
        invokeModStorage: (modId: string, operation: string, key?: string, value?: unknown) =>
            call<{ ok: boolean; value?: unknown; error?: string }>('storage', { id: modId, op: operation, key, value })
                .then(answer => ({ ok: Boolean(answer?.ok), result: answer?.value, error: answer?.error })),
        invokeModNetFetch: async (modId: string, url: string, init: unknown) => {
            const answer = await call<{ ok: boolean; status?: number; headers?: Record<string, string>; body?: string; error?: string }>(
                'net-fetch',
                { id: modId, url, init },
            );
            if (!answer?.ok) return { ok: false, error: answer?.error ?? 'net-fetch-failed' };
            return { ok: true, result: { status: answer.status, headers: answer.headers, body: answer.body } };
        },
        // Not available on this platform: the features behind them (native file
        // grants, ffmpeg export) have no Android implementation yet.
        invokeModPickFile: async () => ({ ok: false, error: 'unsupported-on-android' }),
        invokeModRestoreFile: async () => ({ ok: false, error: 'unsupported-on-android' }),
        invokeModReleaseFile: async () => ({ ok: false, error: 'unsupported-on-android' }),
        pushRuntimeSnapshot: async () => {},
        getModCallStats: async () => ({ stats: {} }),
        reportModsStartSettled: async () => {},
        reportModsStartAlive: async () => {},
        getFfmpegStatus: async () => ({ ffmpeg: emptyList().ffmpeg }),
        openModsDirectory: async () => ({ ok: false, error: 'unsupported-on-android' }),
        installModFromZip: async () => ({ ok: false, error: 'unsupported-on-android' }),
        getModStorageUsage: async () => ({ ok: false, error: 'unsupported-on-android' }),
        clearModCache: async () => ({ ok: false, error: 'unsupported-on-android' }),
        cancelExport: async () => {},
        onModsStateChanged: (callback: (mods: ModRuntimeInfo[]) => void) => {
            listeners.add(callback);
            return () => { listeners.delete(callback); };
        },
        onExportProgress: (_callback: (progress: ModExportProgress) => void) => () => {},
        onModLog: (_callback: (entry: ModLogEntry) => void) => () => {},
    } as unknown as ModsBridge;
}

let cached: ModsBridge | null = null;

/** The Android plugin bridge, or null where the desktop preload already provides one. */
export const getAndroidModsBridge = (): ModsBridge | null => {
    if (!isAndroid() || window.electron?.mods) return null;
    cached ??= createBridge();
    return cached;
};
