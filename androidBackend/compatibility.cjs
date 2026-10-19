'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Exercise the packed require graph on Node 18 without contacting any account or upstream API.
const root = path.join(__dirname, 'assets/nodejs-project');
const packedRequire = createRequire(path.join(root, 'index.cjs'));
// Prevent false positives from resolving a missing packed dependency from the workspace's node_modules.
const Module = require('node:module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...options) {
    const resolved = originalResolve.call(this, request, parent, ...options);
    if (parent?.filename?.startsWith(root + path.sep) && path.isAbsolute(resolved) && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Packed dependency escaped runtime root: ${request}`);
    }
    return resolved;
};
const report = { node: process.versions.node, failures: [], routes: 0, polyfills: [] };
try {
    const tmp = path.join(__dirname, '.compat-runtime');
    fs.mkdirSync(tmp, { recursive: true });
    process.env.TMPDIR = tmp; process.env.TMP = tmp; process.env.TEMP = tmp;
    fs.writeFileSync(path.join(tmp, 'anonymous_token'), '', 'utf8');
    packedRequire('@neteasecloudmusicapienhanced/api/util/request');
    for (const [route, moduleName] of Object.entries(packedRequire('./routes.cjs'))) {
        // Android dispatch implements this without the upstream module's eager unblock import.
        if (route === '/song/url/v1') continue;
        try { packedRequire(`@neteasecloudmusicapienhanced/api/module/${moduleName}`); report.routes++; }
        catch (error) { report.failures.push({ route, code: error.code, message: error.message }); }
    }
    const { JSDOM } = packedRequire('jsdom');
    const dom = new JSDOM('<p>Node 18</p>');
    if (dom.window.document.querySelector('p').textContent !== 'Node 18') throw new Error('jsdom check failed');
    dom.window.close();
    report.jsdom = true;
} catch (error) { report.failures.push({ code: error.code, message: error.message }); }
fs.writeFileSync(path.join(__dirname, 'compatibility-node' + process.versions.node + '.json'), JSON.stringify(report, null, 4) + '\n');
console.log(JSON.stringify(report, null, 4));
if (report.failures.length) process.exitCode = 1;
