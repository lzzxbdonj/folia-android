import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Assemble only NetEase runtime dependencies from the installed lockfile tree; never run npm.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const output = path.join(here, 'assets', 'nodejs-project');
if (fs.existsSync(output)) {
    const manifest = path.join(output, 'package.json');
    const expected = path.resolve(here, 'assets', 'nodejs-project');
    const generated = fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === 'folia-android-node-runtime';
    // Delete only our exact, previously generated output, never a caller-supplied/computed external path.
    if (path.resolve(output) !== expected || !generated || fs.lstatSync(output).isSymbolicLink()) throw new Error('Output is not a verified generated runtime directory');
    fs.rmSync(output, { recursive: true });
}
fs.mkdirSync(output, { recursive: true });
const rootRequire = createRequire(path.join(root, 'package.json'));
const roots = ['@neteasecloudmusicapienhanced/api', 'axios', 'crypto-js', 'node-forge', 'pac-proxy-agent', 'tunnel', 'fzstd', 'qrcode', 'jsdom'];
const seen = new Set();
const packages = [];

function packageDirectory(name, fromRequire) {
    let entry;
    try { entry = fromRequire.resolve(`${name}/package.json`); }
    catch { entry = fromRequire.resolve(name); }
    let directory = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
    while (directory !== path.dirname(directory)) {
        const manifest = path.join(directory, 'package.json');
        if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return directory;
        directory = path.dirname(directory);
    }
    throw new Error(`Cannot resolve package directory: ${name}`);
}

function copyPackage(name, fromRequire, walkDependencies = true) {
    const directory = packageDirectory(name, fromRequire);
    if (seen.has(directory)) return;
    seen.add(directory);
    const relative = path.relative(root, directory);
    if (relative.startsWith('..') || !relative.startsWith('node_modules' + path.sep)) throw new Error(`Dependency is outside installed workspace: ${name}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (name === roots[0] && manifest.version !== '4.41.1') throw new Error('Expected pinned NetEase API 4.41.1');
    fs.cpSync(directory, path.join(output, relative), {
        recursive: true,
        filter: source => !path.relative(directory, source).split(path.sep).includes('node_modules'),
    });
    packages.push({ name, version: manifest.version, engines: manifest.engines || {}, path: relative.replaceAll('\\', '/') });
    if (!walkDependencies) return;
    const localRequire = createRequire(path.join(directory, 'package.json'));
    for (const dependency of Object.keys(manifest.dependencies || {})) copyPackage(dependency, localRequire);
    // Optional native modules (e.g. jsdom canvas) must never include host-OS binaries in Android assets.
}

for (const name of roots) copyPackage(name, rootRequire, name !== roots[0]);
for (const file of ['index.cjs', 'routes.cjs', 'folioHost.cjs', 'aiHost.cjs']) fs.copyFileSync(path.join(here, file), path.join(output, file));
const support = [
    'electron/netease/neteaseApiStartup.cjs', 'electron/netease/lazyJsdom.cjs',
    'electron/netease/neteaseLoginIdentity.cjs', 'electron/netease/neteaseLoginDiagnostics.cjs',
    'electron/backendLifecycle.cjs', 'shared/networkErrorText.cjs',
];
for (const file of support) {
    const destination = path.join(output, 'support', file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
}
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ name: 'folia-android-node-runtime', private: true, type: 'commonjs', engines: { node: '>=18.20.4' } }, null, 4) + '\n');
fs.writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify({ nodeTarget: '18.20.4', apiVersion: '4.41.1', port: 39843, packages }, null, 4) + '\n');
console.log(JSON.stringify({ output, packages: packages.length }));
