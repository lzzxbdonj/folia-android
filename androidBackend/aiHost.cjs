'use strict';

// AI settings and theme generation for the Android build.
//
// On the desktop the key never leaves the main process; here the same rule is
// kept by the packaged Node runtime: the renderer can set a key, and can ask for
// a theme, but can never read the key back (get answers `keysConfigured` only).
//
// Nothing here logs a key, a URL with a query, or a provider body.

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'ai-settings.json';
const TIMEOUT_MS = 60000;

const DEFAULTS = {
    provider: 'openai',
    openaiUrl: 'https://api.openai.com/v1/chat/completions',
    openaiModel: 'gpt-4o-mini',
    openaiStream: false,
    temperature: 0.7,
    geminiModel: 'gemini-2.0-flash',
    keys: { openai: '', gemini: '' },
};

function readSettings(dataDir) {
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), 'utf8')); } catch { /* First run. */ }
    return { ...DEFAULTS, ...stored, keys: { ...DEFAULTS.keys, ...(stored.keys || {}) } };
}

function writeSettings(dataDir, settings) {
    const file = path.join(dataDir, FILE);
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
}

// The renderer's key names come from the desktop settings dialog; keep them as-is
// so the same form drives both builds.
function applySetting(settings, key, value) {
    const text = typeof value === 'string' ? value.trim() : value;
    switch (key) {
        case 'AI_PROVIDER': settings.provider = text === 'gemini' ? 'gemini' : 'openai'; break;
        case 'OPENAI_API_URL': settings.openaiUrl = typeof text === 'string' && text ? text : DEFAULTS.openaiUrl; break;
        case 'OPENAI_API_MODEL': settings.openaiModel = typeof text === 'string' && text ? text : DEFAULTS.openaiModel; break;
        case 'OPENAI_API_STREAM': settings.openaiStream = text === true || text === 'true'; break;
        case 'OPENAI_API_TEMPERATURE': {
            const number = Number(text);
            if (Number.isFinite(number)) settings.temperature = Math.min(2, Math.max(0, number));
            break;
        }
        case 'OPENAI_API_KEY': settings.keys.openai = typeof text === 'string' ? text : ''; break;
        case 'GEMINI_API_KEY': settings.keys.gemini = typeof text === 'string' ? text : ''; break;
        default: break; // USE_SYSTEM_PROXY_FOR_AI and friends have no meaning here.
    }
    return settings;
}

function publicSettings(settings) {
    const keysConfigured = { openai: Boolean(settings.keys.openai), gemini: Boolean(settings.keys.gemini) };
    // The renderer reads the desktop option names, so the answer speaks them too:
    // the settings dialog is one form for both builds.
    return {
        AI_PROVIDER: settings.provider,
        OPENAI_API_URL: settings.openaiUrl,
        OPENAI_API_MODEL: settings.openaiModel,
        OPENAI_API_STREAM: settings.openaiStream,
        OPENAI_API_TEMPERATURE: String(settings.temperature),
        AI_API_KEYS_CONFIGURED: {
            GEMINI_API_KEY: keysConfigured.gemini,
            OPENAI_API_KEY: keysConfigured.openai,
        },
        OPENAI_API_KEY_ENDPOINT: keysConfigured.openai ? settings.openaiUrl : null,
    };
}

const THEME_INSTRUCTION = [
    'You design lyric themes for a music player.',
    'Answer with JSON only: {"light":{...},"dark":{...}}.',
    'Each side needs name (Chinese, <=10 chars), description (Chinese, 15-30 chars),',
    'backgroundColor, primaryColor, accentColor, secondaryColor (hex),',
    'wordColors: [{word, color}] picked from the lyrics, lyricsIcons: [lucide icon names].',
    'light is for daylight, dark for midnight; both must stay readable.',
].join(' ');

async function postJson(url, headers, body, signal) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`provider answered ${response.status}`);
    return JSON.parse(text);
}

function firstJsonObject(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('provider returned no JSON');
    return JSON.parse(text.slice(start, end + 1));
}

// A self-hosted build is configured by hand, so people paste whatever the provider
// documents: "https://api.deepseek.com", ".../v1" or the full chat endpoint. Only the
// last form is what the request needs, so the path is completed here instead of
// rejecting the common base-URL spelling.
function chatEndpoint(rawUrl) {
    const text = String(rawUrl || '').trim() || DEFAULTS.openaiUrl;
    if (/\/chat\/completions\/?$/.test(text)) return text.replace(/\/+$/, '');
    return `${text.replace(/\/+$/, '')}/chat/completions`;
}

async function openAiChat(settings, messages) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const answer = await postJson(chatEndpoint(settings.openaiUrl), { Authorization: `Bearer ${settings.keys.openai}` }, {
            model: settings.openaiModel,
            temperature: settings.temperature,
            messages,
        }, controller.signal);
        const content = answer?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('provider returned no content');
        return firstJsonObject(content);
    } finally {
        clearTimeout(timer);
    }
}

async function geminiChat(settings, prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.keys.gemini)}`;
        const answer = await postJson(url, {}, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: settings.temperature },
        }, controller.signal);
        const content = answer?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
        return firstJsonObject(content);
    } finally {
        clearTimeout(timer);
    }
}

async function generateTheme(settings, lyricsText) {
    const provider = settings.provider === 'gemini' ? 'gemini' : 'openai';
    if (provider === 'gemini' && !settings.keys.gemini) throw new Error('GEMINI_API_KEY not configured');
    if (provider === 'openai' && !settings.keys.openai) throw new Error('OPENAI_API_KEY not configured');
    const prompt = `${THEME_INSTRUCTION}\n\nLyrics:\n${String(lyricsText || '').slice(0, 6000)}`;
    if (provider === 'gemini') return await geminiChat(settings, prompt);
    return await openAiChat(settings, [
        { role: 'system', content: THEME_INSTRUCTION },
        { role: 'user', content: String(lyricsText || '').slice(0, 6000) },
    ]);
}

async function testConnection(settings, payload) {
    const provider = payload.provider === 'gemini' ? 'gemini' : settings.provider;
    const key = typeof payload.apiKey === 'string' && payload.apiKey ? payload.apiKey : (provider === 'gemini' ? settings.keys.gemini : settings.keys.openai);
    if (!key) return { ok: false, message: `${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} not configured` };
    const probe = {
        ...settings,
        provider,
        openaiUrl: typeof payload.apiUrl === 'string' && payload.apiUrl ? payload.apiUrl : settings.openaiUrl,
        openaiModel: typeof payload.model === 'string' && payload.model ? payload.model : settings.openaiModel,
        keys: { ...settings.keys, [provider]: key },
    };
    try {
        if (provider === 'gemini') await geminiChat(probe, 'Answer with {"ok":true} and nothing else.');
        else await openAiChat(probe, [{ role: 'user', content: 'Answer with {"ok":true} and nothing else.' }]);
        return { ok: true, message: 'connection ok' };
    } catch (error) {
        return { ok: false, message: String(error?.message || error).slice(0, 200) };
    }
}

async function handleAi(route, payload, { dataDir }) {
    const settings = readSettings(dataDir);
    switch (route) {
        case '/folio/ai/settings': {
            if (payload?.op === 'set') {
                applySetting(settings, String(payload.key || ''), payload.value);
                writeSettings(dataDir, settings);
                return { ok: true, settings: publicSettings(settings) };
            }
            return { ok: true, settings: publicSettings(settings) };
        }
        case '/folio/ai/test':
            return await testConnection(settings, payload || {});
        case '/folio/ai/theme': {
            try {
                return { ok: true, theme: await generateTheme(settings, payload?.lyricsText) };
            } catch (error) {
                return { ok: false, error: String(error?.message || error).slice(0, 200) };
            }
        }
        // Lyric segmentation is not ported yet; the caller falls back to its own splitter.
        case '/folio/ai/segment':
            return { ok: false, error: 'segmentation-not-ported' };
        default:
            return null;
    }
}

module.exports = { handleAi };
