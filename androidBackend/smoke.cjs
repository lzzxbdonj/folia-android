'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Run on the exact Node target; use isolated runtime storage and never log cookies or query URLs.
async function run() {
    const packed = process.argv.includes('--packed');
    const root = packed ? path.join(__dirname, 'assets/nodejs-project') : __dirname;
    const { createBackend } = require(path.join(root, 'index.cjs'));
    const token = crypto.randomBytes(32).toString('hex');
    const runtimeDirectory = path.join(__dirname, '.smoke-runtime');
    const backend = createBackend({ token, runtimeDirectory });
    await backend.listen();
    const base = 'http://127.0.0.1:39843';
    const report = { node: process.versions.node, packed, tests: [] };
    const request = async (route, authenticated = true) => {
        const response = await fetch(base + route, { headers: authenticated ? { 'X-Folia-Token': token } : {}, signal: AbortSignal.timeout(70000) });
        return { http: response.status, body: await response.json() };
    };
    try {
        assert.equal((await request('/health', false)).http, 401);
        report.tests.push({ name: 'health-requires-token', passed: true });
        assert.equal((await request('/health')).http, 200);
        report.tests.push({ name: 'health-before-ready', passed: true });
        await backend.initialize();
        const health = await request('/health');
        report.health = health.body;
        assert.equal(health.body.status, 'running');
        report.tests.push({ name: 'initialization', passed: true });
        assert.equal((await request('/api')).http, 404);
        report.tests.push({ name: 'generic-proxy-disabled', passed: true });
        const anonymous = await request('/register/anonimous');
        report.tests.push({ name: 'anonymous-registration', http: anonymous.http, code: anonymous.body.code, cookiePresent: Boolean(anonymous.body.cookie), passed: anonymous.http === 200 && anonymous.body.code === 200 });
        const anonymousCookie = typeof anonymous.body.cookie === 'string' ? anonymous.body.cookie : '';
        const search = await request('/cloudsearch?keywords=hello&limit=1&offset=0' + (anonymousCookie ? '&cookie=' + encodeURIComponent(anonymousCookie) : ''));
        report.tests.push({ name: 'search', http: search.http, code: search.body.code, songs: search.body.result?.songs?.length || 0, passed: search.http === 200 && search.body.code === 200 && Boolean(search.body.result?.songs?.length) });
        // QR creation is purely local and does not create or inspect an account session.
        const qr = await request('/login/qr/create?key=folia-smoke-not-a-login-key&qrimg=true');
        report.tests.push({ name: 'qr-image-local', http: qr.http, imagePresent: Boolean(qr.body.data?.qrimg), passed: Boolean(qr.body.data?.qrimg) });
    } catch (error) {
        report.failure = { name: error.name, code: error.code, message: error.code === 'ERR_ASSERTION' ? error.message : 'Runtime or network validation failed; no credentials recorded' };
        process.exitCode = 1;
    } finally {
        await new Promise(resolve => backend.server.close(resolve));
        backend.server.closeAllConnections();
        const file = path.join(__dirname, `smoke-node${process.versions.node}-${packed ? 'packed' : 'source'}.json`);
        fs.writeFileSync(file, JSON.stringify(report, null, 4) + '\n');
        console.log(JSON.stringify(report, null, 4));
        if (report.tests.some(test => !test.passed)) process.exitCode = 1;
    }
}
run().catch(error => { console.error('[AndroidBackend] Smoke failed', error.code || error.name); process.exitCode = 1; });
