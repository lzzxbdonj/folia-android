'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const routes = require('./routes.cjs');

// Android Node entry: node index.cjs <shared-token>; only app-private loopback API is exposed.
const PORT = 39843;
const HOST = '127.0.0.1';
const NCM = '@neteasecloudmusicapienhanced/api';
const supportRoot = fs.existsSync(path.join(__dirname, 'support')) ? path.join(__dirname, 'support') : path.join(__dirname, '..');
const startup = require(path.join(supportRoot, 'electron/netease/neteaseApiStartup.cjs'));
const { createNeteaseLoginIdentity } = require(path.join(supportRoot, 'electron/netease/neteaseLoginIdentity.cjs'));

function createBackend({ token, runtimeDirectory = process.env.FOLIA_DATA_DIR || process.env.TMPDIR || path.join(__dirname, '.runtime') }) {
    if (typeof token !== 'string' || token.length < 32) throw new Error('A shared token of at least 32 characters is required');
    const secret = Buffer.from(token);
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    // Upstream calls os.tmpdir() at require time and Android has no /tmp, so point it at private storage.
    const os = require('node:os');
    os.tmpdir = () => runtimeDirectory;
    process.env.TMPDIR = runtimeDirectory;
    process.env.TMP = runtimeDirectory;
    process.env.TEMP = runtimeDirectory;
    process.env.ENABLE_GENERAL_UNBLOCK = 'false';
    let state = { status: 'starting', node: process.versions.node, apiVersion: '4.41.1', error: null };
    let request;
    let upstreamUtil;
    let initializing = null;
    const tokenPath = path.join(runtimeDirectory, 'anonymous_token');
    const keyPath = path.join(runtimeDirectory, 'xeapi_public_key');
    const quietLogger = { log() {}, info() {}, warn(message) { console.warn('[AndroidBackend]', String(message).split(':')[0]); }, error() {} };

    // Plugin host and AI proxy: app-private, token-authorized like every other route.
    // They are loaded lazily so a broken plugin directory cannot stop the music API.
    let folio;
    function folioHost() {
        if (!folio) {
            const { createFolioHost } = require('./folioHost.cjs');
            folio = createFolioHost({
                dataDir: runtimeDirectory,
                log: (...args) => console.log('[Folium]', ...args),
            });
        }
        return folio;
    }

    async function handleFolio(req, res, url, send) {
        let body = '';
        for await (const chunk of req) {
            body += chunk.toString('utf8');
            if (Buffer.byteLength(body) > 8 * 1024 * 1024) return send(413, { code: 413 });
        }
        let payload = {};
        if (body) {
            try { payload = JSON.parse(body); } catch { return send(400, { code: 400, msg: 'Invalid JSON' }); }
        }
        try {
            if (url.pathname.startsWith('/folio/ai/')) {
                const { handleAi } = require('./aiHost.cjs');
                const answer = await handleAi(url.pathname, payload, { dataDir: runtimeDirectory });
                return send(answer ? 200 : 404, answer || { code: 404, msg: 'Unsupported AI route' });
            }
            const answer = await folioHost().handle(url.pathname, payload);
            return send(answer ? 200 : 404, answer || { code: 404, msg: 'Unsupported plugin route' });
        } catch (error) {
            // Never echo provider or plugin text: it can carry keys and request URLs.
            console.error('[FolioHost]', url.pathname, error?.name || 'Error', String(error?.message || '').slice(0, 120));
            return send(500, { code: 500, msg: 'host-failed' });
        }
    }

    function authorize(req) {
        const supplied = req.headers['x-folia-token'];
        if (typeof supplied !== 'string') return false;
        const bytes = Buffer.from(supplied);
        return bytes.length === secret.length && crypto.timingSafeEqual(bytes, secret);
    }

    function load() {
        if (request) return;
        if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf8');
        // Upstream logger includes device identities; request.js also dumps full answer objects on error.
        // Suppress its logger and redact that direct console path before any credentials can be loaded.
        const upstreamLogger = require(`${NCM}/util/logger`);
        for (const key of Object.keys(upstreamLogger)) upstreamLogger[key] = () => {};
        if (!console.log.foliaRedacted) {
            const originalLog = console.log.bind(console);
            const redactedLog = (...args) => {
                if (args[0] === '[ERR]') return originalLog('[AndroidBackend] Upstream request failed');
                return originalLog(...args);
            };
            redactedLog.foliaRedacted = true;
            console.log = redactedLog;
        }
        upstreamUtil = require(`${NCM}/util/index`);
        global.cnIp = upstreamUtil.generateRandomChineseIP();
        global.deviceId = upstreamUtil.generateDeviceId();
        const requestPath = require.resolve(`${NCM}/util/request`);
        startup.deferJsdom(requestPath);
        const identity = createNeteaseLoginIdentity({
            generateDeviceId: () => upstreamUtil.generateDeviceId(),
            readAnonymousToken: () => fs.readFileSync(tokenPath, 'utf8'),
            initialAnonymousToken: fs.readFileSync(tokenPath, 'utf8'),
            logger: quietLogger,
        });
        request = identity.wrapRequest(startup.withQrNetworkRetry(startup.withoutImplicitClientIp(require(requestPath)), { logger: quietLogger }));
        require.cache[requestPath].exports = request;
        startup.installLoginQrCheck();
    }

    async function initialize() {
        if (initializing) return initializing;
        state = { ...state, status: 'starting', error: null };
        let step = 'load';
        initializing = (async () => {
            load();
            step = 'xeapi-key';
            let cached = {};
            try { cached = JSON.parse(fs.readFileSync(keyPath, 'utf8')); } catch { /* No usable cached key yet. */ }
            const { getXeapiPublicKey } = require(`${NCM}/util/xeapiKey`);
            const key = await startup.resolveXeapiPublicKey({ currentPublicKey: cached, deviceId: global.deviceId, getXeapiPublicKey, logger: quietLogger });
            if (key.refreshed) fs.writeFileSync(keyPath, JSON.stringify(key.publicKey), 'utf8');
            step = 'anonymous-token';
            await startup.refreshAnonymousToken({
                registerAnonymous: () => require(`${NCM}/module/register_anonimous`)({ cookie: {} }, request),
                cookieToJson: upstreamUtil.cookieToJson,
                persistToken: value => fs.writeFileSync(tokenPath, value, 'utf8'),
                logger: quietLogger,
            });
            state = { ...state, status: 'running', error: null };
        })().catch(error => {
            // Never return upstream exception text: it can contain credentials and full request URLs.
            state = { ...state, status: 'error', error: error.code === 'MODULE_NOT_FOUND' ? 'dependency-missing' : 'initialization-failed' };
            console.error('[AndroidBackend] Initialization failed at', step, error.code || error.name || 'Error', error.syscall || '', (error.path || '').slice(0, 240));
            // Local troubleshooting only; the stack names files but never carries credentials.
            if (process.env.FOLIA_BACKEND_DEBUG === '1' && error?.stack) console.error(error.stack);
        }).finally(() => { initializing = null; });
        return initializing;
    }

    async function dispatch(route, query) {
        // The normal song-url path must not eagerly load the optional cross-platform unblock package.
        if (route === '/song/url/v1') {
            const options = require(`${NCM}/util/option`)(query, 'xeapi');
            const data = { ids: `[${query.id}]`, level: query.level || 'exhigh', encodeType: 'flac' };
            return request('/api/song/enhance/player/url/v1', data, options);
        }
        const handler = require(`${NCM}/module/${routes[route]}`);
        return handler(query, (uri, data, options = {}) => request(uri, data, { ...options, ip: options.randomCNIP ? global.cnIp : '' }));
    }

    const server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const send = (status, body) => { if (!res.writableEnded) { res.writeHead(status); res.end(JSON.stringify(body)); } };
        // Native CapacitorHttp has no Origin. Do not enable CORS for arbitrary browser origins.
        if (!authorize(req)) return send(401, { code: 401, msg: 'Unauthorized' });
        const url = new URL(req.url, `http://${HOST}:${PORT}`);
        if (url.pathname === '/health') return send(200, { ...state, host: HOST, port: PORT });
        if (url.pathname === '/restart' && req.method === 'POST') { void initialize(); return send(202, { code: 202 }); }
        if (url.pathname.startsWith('/folio/')) {
            if (req.method !== 'POST' && req.method !== 'GET') return send(405, { code: 405 });
            return handleFolio(req, res, url, send);
        }
        if (!Object.hasOwn(routes, url.pathname)) return send(404, { code: 404, msg: 'Unsupported route' });
        if (!['GET', 'POST'].includes(req.method)) return send(405, { code: 405 });
        if (state.status !== 'running') return send(503, { code: 503, msg: 'Backend not ready', status: state.status });
        try {
            let body = '';
            for await (const chunk of req) {
                body += chunk.toString('utf8');
                if (Buffer.byteLength(body) > 65536) return send(413, { code: 413 });
            }
            const query = Object.fromEntries(url.searchParams);
            if (body) {
                if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { code: 415 });
                Object.assign(query, JSON.parse(body));
            }
            if (typeof query.cookie === 'string') query.cookie = upstreamUtil.cookieToJson(query.cookie);
            query.cookie ||= {};
            // Explicitly disable proxy/unblock knobs not used by Folia; this is not a generic proxy.
            for (const key of ['proxy', 'realIP', 'ip', 'unblock', 'source', 'domain', 'crypto', 'headers', 'ua', 'checkToken', 'e_r']) delete query[key];
            query.timeout = 25000;
            const answered = await startup.withTimeout(dispatch(url.pathname, query), 60000, 'API request');
            // The JSON response carries QR cookies; do not expose credentials through Set-Cookie or logs.
            const status = Number(answered?.status);
            send(status >= 200 && status <= 599 ? status : 200, answered?.body ?? { code: 502, msg: 'Invalid upstream response' });
        } catch (error) {
            if (error?.body && typeof error.body === 'object') {
                const status = Number(error.status);
                send(status >= 400 && status <= 599 ? status : 502, error.body);
            } else send(502, { code: 502, msg: 'NetEase request failed' });
        }
    });
    server.requestTimeout = 70000;
    server.headersTimeout = 15000;
    return {
        server,
        initialize,
        listen: () => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(PORT, HOST, () => { server.removeListener('error', reject); void initialize(); resolve(); });
        }),
    };
}

if (require.main === module) {
    try {
        const backend = createBackend({ token: process.argv[2] });
        backend.listen().then(() => console.log(`[AndroidBackend] Listening on ${HOST}:${PORT}`)).catch(error => { console.error('[AndroidBackend] Listen failed', error.code); process.exitCode = 1; });
    } catch (error) { console.error('[AndroidBackend]', error.message); process.exitCode = 1; }
}
module.exports = { createBackend, HOST, PORT };
