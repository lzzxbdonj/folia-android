'use strict';

// Android host for Folia's plugin system: discovery, enable state, the shared
// per-mod data file, client→main RPC and a net.fetch stand-in.
//
// The renderer never talks to this module directly. It reaches it through
// src/mods/runtime/androidModBridge.ts, which mirrors window.electron.mods and
// goes out over CapacitorHttp with the same X-Folia-Token as every other call.
//
// Client entry files are *not* sent over this server: they are served same-origin
// by MainActivity's request interceptor from <dataDir>/mods/<id>/… under
// https://localhost/__folia_mods__/, so relative imports inside a mod keep working.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEME_BASE = 'https://localhost/__folia_mods__';
const DATA_MAX_BYTES = 1024 * 1024;

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    fs.renameSync(tmp, file);
}

function digestOf(id, client, dir) {
    // Same purpose as the desktop digest: an edited mod must import as a new
    // module. A cheap content hash of the entry plus its size is enough here.
    const hash = crypto.createHash('sha256');
    hash.update(`${id}\0${client}\0`);
    try {
        const stat = fs.statSync(path.join(dir, client));
        hash.update(String(stat.size)).update(String(Math.floor(stat.mtimeMs)));
    } catch { /* Missing entry: the loader reports it. */ }
    return hash.digest('hex').slice(0, 12);
}

function readManifest(dir) {
    const manifest = readJson(path.join(dir, 'mod.json'), null);
    if (!manifest || typeof manifest !== 'object') return null;
    if (typeof manifest.id !== 'string' || !manifest.id) return null;
    return manifest;
}

function publicMod(manifest, dir, enabled) {
    const client = typeof manifest.client === 'string' && manifest.client ? manifest.client : null;
    const hasMain = typeof manifest.main === 'string' && Boolean(manifest.main);
    const version = typeof manifest.version === 'string' ? manifest.version : null;
    return {
        id: manifest.id,
        name: typeof manifest.name === 'string' && manifest.name ? manifest.name : manifest.id,
        version,
        author: typeof manifest.author === 'string' ? manifest.author : null,
        description: typeof manifest.description === 'string' ? manifest.description : null,
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions.filter(p => typeof p === 'string') : [],
        status: 'loaded',
        error: null,
        enabled,
        trustStale: false,
        signature: { status: 'unsigned', keyLabel: null, signedAt: null },
        devSource: false,
        experimental: Array.isArray(manifest.experimental) ? manifest.experimental.filter(p => typeof p === 'string') : [],
        embedOrigins: Array.isArray(manifest.embedOrigins) ? manifest.embedOrigins.filter(p => typeof p === 'string') : [],
        folia: typeof manifest.folia === 'string' ? manifest.folia : null,
        hasMain,
        clientUrl: client && enabled ? `${SCHEME_BASE}/${manifest.id}/${client}?v=${digestOf(manifest.id, client, dir)}` : null,
        loadOrder: 0,
        warnings: [],
    };
}

function createFolioHost({ dataDir, log = () => {} }) {
    const modsRoot = path.join(dataDir, 'mods');
    const dataRoot = path.join(dataDir, 'mods-data');
    const stateFile = path.join(dataDir, 'mods-state.json');
    const mains = new Map(); // id → { handlers: Map<string, Function>, deactivate: Function[] }

    const state = () => readJson(stateFile, {});
    const setState = (id, enabled) => {
        const next = { ...state(), [id]: Boolean(enabled) };
        writeJsonAtomic(stateFile, next);
    };
    const storageFile = id => path.join(dataRoot, id, 'data.json');
    const readStorage = id => {
        const value = readJson(storageFile(id), {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };
    const writeStorage = (id, value) => {
        if (Buffer.byteLength(JSON.stringify(value)) > DATA_MAX_BYTES) throw new Error('storage limit exceeded');
        writeJsonAtomic(storageFile(id), value);
    };

    function directories() {
        return [{ label: '应用私有目录', path: modsRoot, kind: 'user', writable: true }];
    }

    function scan() {
        fs.mkdirSync(modsRoot, { recursive: true });
        const enabledState = state();
        const mods = [];
        for (const entry of fs.readdirSync(modsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const dir = path.join(modsRoot, entry.name);
            const manifest = readManifest(dir);
            if (!manifest) continue;
            const enabled = enabledState[manifest.id] !== false;
            mods.push(publicMod(manifest, dir, enabled));
        }
        mods.sort((a, b) => a.id.localeCompare(b.id));
        return mods;
    }

    // Main entry: a mod's index.cjs gets the small slice of `folium` it uses.
    // Failure is per mod and never takes the backend down.
    function loadMain(mod) {
        if (!mod.hasMain) return;
        if (mains.has(mod.id)) return;
        const manifest = readJson(path.join(modsRoot, mod.id, 'mod.json'), null);
        if (!manifest || typeof manifest.main !== 'string') return;
        const handlers = new Map();
        const deactivate = [];
        const store = () => readStorage(mod.id);
        const save = value => writeStorage(mod.id, value);
        // Folium's main-entry logger is an object with level methods, and some mods also call it
        // as a bare function; one callable object satisfies both shapes.
        const modLog = (level, message, details) => log(`[${mod.id}] ${level}: ${String(message)}`, details ?? '');
        const logFn = (...args) => modLog('info', args.map(String).join(' '));
        logFn.info = (message, details) => modLog('info', message, details);
        logFn.warn = (message, details) => modLog('warn', message, details);
        logFn.error = (message, details) => modLog('error', message, details);
        logFn.debug = (message, details) => modLog('debug', message, details);
        const modData = path.join(dataRoot, mod.id);
        const api = {
            id: mod.id,
            version: mod.version,
            manifest: Object.freeze({ ...manifest }),
            host: Object.freeze({ platform: 'android', arch: process.arch, node: process.versions.node }),
            log: logFn,
            storage: {
                data: {
                    get: async key => store()[key],
                    set: async (key, value) => { const next = store(); next[key] = value; save(next); },
                    delete: async key => { const next = store(); delete next[key]; save(next); },
                    has: async key => Object.hasOwn(store(), key),
                    keys: async () => Object.keys(store()),
                },
                get: async key => store()[key],
                set: async (key, value) => { const next = store(); next[key] = value; save(next); },
                delete: async key => { const next = store(); delete next[key]; save(next); },
                has: async key => Object.hasOwn(store(), key),
                keys: async () => Object.keys(store()),
                paths: Object.freeze({
                    get data() { fs.mkdirSync(modData, { recursive: true }); return modData; },
                    get cache() { const cache = path.join(dataDir, 'mods-cache', mod.id); fs.mkdirSync(cache, { recursive: true }); return cache; },
                }),
            },
            rpc: {
                handle(name, handler) {
                    if (typeof handler === 'function') handlers.set(String(name), handler);
                },
            },
            lifecycle: {
                onDeactivate(fn) { if (typeof fn === 'function') deactivate.push(fn); },
            },
            onDispose(fn) { if (typeof fn === 'function') deactivate.push(fn); },
            paths: {
                data: modData,
                files: path.join(modData, 'files'),
                cache: path.join(dataDir, 'mods-cache', mod.id),
            },
            // No renderer snapshot is pushed on Android yet; mods treat null as "nothing playing".
            runtime: { platform: 'android', version: null, getPlaybackSnapshot: () => null },
        };
        try {
            const entry = path.join(modsRoot, mod.id, manifest.main);
            delete require.cache[require.resolve(entry)];
            const activate = require(entry);
            if (typeof activate === 'function') activate(api);
            mains.set(mod.id, { handlers, deactivate });
        } catch (error) {
            log(`[${mod.id}] main entry failed:`, error?.message || error);
        }
    }

    function unloadMain(id) {
        const running = mains.get(id);
        mains.delete(id);
        if (!running) return;
        for (const fn of running.deactivate) {
            try { fn(); } catch (error) { log(`[${id}] deactivate failed:`, error?.message || error); }
        }
    }

    function listPayload() {
        const mods = scan();
        for (const mod of mods) if (mod.enabled && mod.hasMain) loadMain(mod);
        for (const id of [...mains.keys()]) if (!mods.some(mod => mod.id === id && mod.enabled)) unloadMain(id);
        return {
            mods,
            ffmpeg: { available: false, path: null, version: null, candidates: [] },
            directories: directories(),
            startSkipped: false,
        };
    }

    async function callRpc({ id, name, args }) {
        const running = mains.get(String(id));
        const handler = running?.handlers.get(String(name));
        if (!handler) return { ok: false, error: 'no-rpc-handler' };
        try {
            return { ok: true, result: await handler(...(Array.isArray(args) ? args : [])) };
        } catch (error) {
            return { ok: false, error: error?.message || String(error) };
        }
    }

    async function netFetch({ url, init }) {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'bad-url' };
        try {
            const response = await fetch(url, {
                method: init?.method || 'GET',
                headers: init?.headers && typeof init.headers === 'object' ? init.headers : undefined,
                body: typeof init?.body === 'string' ? init.body : undefined,
            });
            const body = await response.text();
            return {
                ok: true,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body,
            };
        } catch (error) {
            return { ok: false, error: error?.message || String(error) };
        }
    }

    async function handle(route, payload) {
        switch (route) {
            case '/folio/mods/list':
            case '/folio/mods/reload':
                return listPayload();
            case '/folio/mods/set-enabled': {
                const id = String(payload.id || '');
                if (!id) return { ok: false, error: 'bad-id', mods: scan() };
                setState(id, Boolean(payload.enabled));
                if (!payload.enabled) unloadMain(id);
                return { ok: true, mods: listPayload().mods };
            }
            case '/folio/mods/storage': {
                const id = String(payload.id || '');
                const op = String(payload.op || '');
                if (!id) return { ok: false, error: 'bad-id' };
                const value = readStorage(id);
                const key = String(payload.key ?? '');
                switch (op) {
                    case 'get': return { ok: true, value: value[key] };
                    case 'has': return { ok: true, value: Object.hasOwn(value, key) };
                    case 'keys': return { ok: true, value: Object.keys(value) };
                    case 'set': value[key] = payload.value; writeStorage(id, value); return { ok: true };
                    case 'delete': delete value[key]; writeStorage(id, value); return { ok: true };
                    default: return { ok: false, error: 'bad-operation' };
                }
            }
            case '/folio/mods/rpc':
                return callRpc(payload);
            case '/folio/mods/net-fetch':
                return netFetch(payload);
            default:
                return null;
        }
    }

    return { handle, listPayload, modsRoot, dataRoot, loadMain, unloadMain };
}

module.exports = { createFolioHost, SCHEME_BASE };
