#!/usr/bin/env node
// build-extension.js -- Packages extension/ into Chrome (.zip + .crx) and Firefox (.zip + .xpi)
// Usage: node build-extension.js [--bump patch|minor|major]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crx3 = require('crx3');

const EXT_DIR = path.join(__dirname, 'extension');
const BUILD_DIR = path.join(__dirname, 'build');
const MANIFEST = path.join(EXT_DIR, 'manifest.json');
const YTKIT_JS = path.join(EXT_DIR, 'ytkit.js');
const DEFAULT_SETTINGS_JSON = path.join(EXT_DIR, 'default-settings.json');
const SETTINGS_META_JSON = path.join(EXT_DIR, 'settings-meta.json');
const USERSCRIPT = path.join(__dirname, 'ytkit.user.js');
const CRX_KEY = path.join(__dirname, 'ytkit.pem');

// Parse args
const args = process.argv.slice(2);
const INCLUDE_USERSCRIPT = args.includes('--with-userscript');
const bumpIndex = args.indexOf('--bump');
// Guard: `--bump` with no following arg previously silently no-op'd because
// `bumpType` was undefined and fell through the `if (bumpType)` check. Fail
// loudly instead so the user knows the bump didn't apply.
let bumpType = null;
if (bumpIndex !== -1) {
    bumpType = args[bumpIndex + 1];
    if (!bumpType || bumpType.startsWith('--')) {
        console.error('--bump requires a type: patch | minor | major');
        process.exit(1);
    }
    if (!['patch', 'minor', 'major'].includes(bumpType)) {
        console.error('Invalid bump type: ' + bumpType + ' (use patch, minor, or major)');
        process.exit(1);
    }
}

// Read manifest
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let version = manifest.version;
let ytkitSource = fs.readFileSync(YTKIT_JS, 'utf8');

// Optional version bump
if (bumpType) {
    const parts = version.split('.').map(Number);
    if (bumpType === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
    else if (bumpType === 'minor') { parts[1]++; parts[2] = 0; }
    else if (bumpType === 'patch') { parts[2]++; }
    version = parts.join('.');
    manifest.version = version;
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    // Update YTKIT_VERSION constant in ytkit.js — hard-fail if the regex no
    // longer matches (e.g. string was refactored to template/backtick form),
    // otherwise the built extension would ship with a stale embedded version.
    const versionRegex = /const YTKIT_VERSION = '[^']+';/;
    if (!versionRegex.test(ytkitSource)) {
        console.error('Could not find `const YTKIT_VERSION = \'...\';` in ytkit.js — refusing to bump with stale version.');
        process.exit(1);
    }
    ytkitSource = ytkitSource.replace(versionRegex, "const YTKIT_VERSION = '" + version + "';");
    fs.writeFileSync(YTKIT_JS, ytkitSource, 'utf8');
    console.log('Updated YTKIT_VERSION in ytkit.js');

    // Always keep the repo-tracked userscript header in sync with the extension
    // version — `Version everything` (CLAUDE.md) requires all version strings
    // to match across files. The `--with-userscript` flag still controls
    // whether a *build artifact* copy is emitted into `build/` later.
    if (fs.existsSync(USERSCRIPT)) {
        let usSrc = fs.readFileSync(USERSCRIPT, 'utf8');
        const before = usSrc;
        usSrc = usSrc.replace(/^(\/\/ @name\s+)YTKit v[\d.]+/m, '$1YTKit v' + version);
        usSrc = usSrc.replace(/^(\/\/ @version\s+)[\d.]+/m, '$1' + version);
        usSrc = usSrc.replace(/const YTKIT_VERSION = '[^']+';/, "const YTKIT_VERSION = '" + version + "';");
        if (usSrc !== before) {
            fs.writeFileSync(USERSCRIPT, usSrc, 'utf8');
            console.log('Updated userscript version header in ytkit.user.js');
        }
    }

    console.log('Bumped version to ' + version);
}

writeDefaultSettingsCatalog(ytkitSource);
writeSettingsMetaCatalog(ytkitSource);

// Clean and create build dir
if (fs.existsSync(BUILD_DIR)) fs.rmSync(BUILD_DIR, { recursive: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });

const STAGE_SKIP_NAMES = new Set([
    '.git',
    '.DS_Store',
    'Thumbs.db',
    'node_modules'
]);

const STAGE_SKIP_SUFFIXES = [
    '.map',
    '.tmp',
    '.bak',
    '.orig',
    '.rej'
];

function shouldStageEntry(entryName) {
    if (STAGE_SKIP_NAMES.has(entryName)) return false;
    return !STAGE_SKIP_SUFFIXES.some(suffix => entryName.endsWith(suffix));
}

// Copy extension files while skipping temp/editor artifacts
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (!shouldStageEntry(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function createZip(sourceDir, zipPath) {
    if (process.platform === 'win32') {
        execSync(
            'powershell -NoProfile -Command "Compress-Archive -Path \'' + sourceDir + '\\*\' -DestinationPath \'' + zipPath + '\' -Force"',
            { stdio: 'inherit' }
        );
    } else {
        execSync('cd "' + sourceDir + '" && zip -r "' + zipPath + '" .', { stdio: 'inherit' });
    }
    const size = fs.statSync(zipPath).size;
    return (size / 1024).toFixed(1);
}

function formatSize(filePath) {
    return (fs.statSync(filePath).size / 1024).toFixed(1);
}

// Collect all files in a directory recursively (relative paths)
function listFiles(dir, base) {
    base = base || dir;
    let files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!shouldStageEntry(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(listFiles(full, base));
        } else {
            files.push(full);
        }
    }
    return files;
}

function findBalancedObjectLiteral(source, startToken) {
    const start = source.indexOf(startToken);
    if (start === -1) return null;

    const openIndex = source.indexOf('{', start);
    if (openIndex === -1) return null;

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaping = false;

    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];

        if (inLineComment) {
            if (char === '\n') inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inSingle) {
            if (!escaping && char === '\'') inSingle = false;
            escaping = char === '\\' && !escaping;
            continue;
        }

        if (inDouble) {
            if (!escaping && char === '"') inDouble = false;
            escaping = char === '\\' && !escaping;
            continue;
        }

        if (inTemplate) {
            if (!escaping && char === '`') inTemplate = false;
            escaping = char === '\\' && !escaping;
            continue;
        }

        escaping = false;

        if (char === '/' && next === '/') {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(openIndex, index + 1);
            }
        }
    }

    return null;
}

function writeDefaultSettingsCatalog(ytkitSource) {
    const objectLiteral = findBalancedObjectLiteral(ytkitSource, 'defaults:');
    if (!objectLiteral) {
        throw new Error('Could not find settings defaults in ytkit.js');
    }

    const defaults = Function('"use strict"; return (' + objectLiteral + ');')();
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
        throw new Error('Parsed defaults are not a plain object');
    }

    const retiredSettingKeys = [
        'autoExpandComments',
        'chatStyleComments',
        'commentEnhancements',
        'commentNavigator',
        'commentSearch',
        'condenseComments',
        'hideCommentActionMenu',
        'hideCommentDislikeButton',
        'hideCommentTeaser',
        'hidePinnedComments'
    ];

    for (const key of retiredSettingKeys) {
        delete defaults[key];
    }

    fs.writeFileSync(DEFAULT_SETTINGS_JSON, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
}

function writeSettingsMetaCatalog(ytkitSource) {
    const settingsVersionMatch = ytkitSource.match(/SETTINGS_VERSION:\s*(\d+)/);
    if (!settingsVersionMatch) {
        throw new Error('Could not find settings version in ytkit.js');
    }

    const meta = {
        settingsVersion: Number(settingsVersionMatch[1])
    };

    fs.writeFileSync(SETTINGS_META_JSON, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

function buildUserscriptSource(extensionSource, targetVersion) {
    const header = `// ==UserScript==
// @name         YTKit v${targetVersion}
// @namespace    https://github.com/SysAdminDoc/YouTube-Kit
// @version      ${targetVersion}
// @description  Ultimate YouTube customization with ad blocking, SponsorBlock, video/channel hiding, playback enhancements, and 115+ features
// @author       Matthew Parker
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      sponsor.ajay.app
// @connect      raw.githubusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==
`;

    const preamble = `(function() {
    'use strict';

    // In userscript context, GM_* APIs are native — no shim needed
    // window.ytInitialPlayerResponse and window.__ytab are directly accessible (same page context)
    const GM = { xmlHttpRequest: GM_xmlhttpRequest };
    // GM_cookie not available in userscripts — provide no-op
    const GM_cookie = { list(filter, cb) { cb(null, 'GM_cookie not available in userscript mode'); } };
    // triggerDownload — open URL directly in userscript mode (no chrome.downloads API)
    function triggerDownload(url, filename) {
        return new Promise((resolve) => {
            const a = document.createElement('a');
            a.href = url;
            if (filename) a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} resolve({ ok: true }); }, 200);
        });
    }

`;

    let activeMarker = 'const triggerDownload = gm.triggerDownload.bind(gm);';
    let bodyStartIndex = extensionSource.indexOf(activeMarker);
    if (bodyStartIndex === -1) {
        activeMarker = 'const GM = gm.GM;';
        bodyStartIndex = extensionSource.indexOf(activeMarker);
        if (bodyStartIndex === -1) {
            throw new Error('Could not find userscript body start marker in extension source');
        }
    }

    let body = extensionSource.slice(bodyStartIndex + activeMarker.length);
    while (body.startsWith('\r') || body.startsWith('\n')) {
        body = body.slice(1);
    }

    body = body.replace(
        /\s*\/\/ Bridge to page context[^\n]*[\s\S]*?_prCacheHref: ''\r?\n\s*\};/,
        '\n    // In userscript context, window.ytInitialPlayerResponse and window.__ytab\n    // are directly accessible (same page context, no ISOLATED/MAIN world split)'
    );
    body = body.replace(/_rw\.ytInitialPlayerResponse/g, 'window.ytInitialPlayerResponse');
    body = body.replace(/_rw\.__ytab/g, 'window.__ytab');
    body = body.replace(/\r?\n\}\)\(\);\s*$/, '');

    return header + '\n' + preamble + body + '\n})();\n';
}

async function build() {
    // ── Chrome Build ──
    const chromeStageDir = path.join(BUILD_DIR, 'chrome-stage');
    // Wrap the whole build in try/finally so an exception mid-flight cannot
    // leave orphan `chrome-stage/` or `firefox-stage/` directories behind in
    // `build/` that would confuse the next run.
    let firefoxStageDir = null;
    try {
    copyDir(EXT_DIR, chromeStageDir);

const chromeZipName = 'astra-deck-chrome-v' + version + '.zip';
    const chromeZipPath = path.join(BUILD_DIR, chromeZipName);

    try {
        const size = createZip(chromeStageDir, chromeZipPath);
        console.log('Chrome ZIP: build/' + chromeZipName + ' (' + size + ' KB)');
    } catch (e) {
        console.error('Chrome ZIP failed:', e.message);
        process.exit(1);
    }

    // ── Chrome CRX Build ──
const chromeCrxName = 'astra-deck-chrome-v' + version + '.crx';
    const chromeCrxPath = path.join(BUILD_DIR, chromeCrxName);

    try {
        const crxFiles = listFiles(chromeStageDir);
        const keyPath = fs.existsSync(CRX_KEY) ? CRX_KEY : undefined;

        await crx3(crxFiles, {
            keyPath: keyPath,
            crxPath: chromeCrxPath,
            zipPath: undefined // already have the ZIP
        });

        // crx3 generates a key file if one didn't exist
        if (!keyPath) {
            // Move auto-generated key to project root for reuse
            const generatedKey = chromeCrxPath.replace('.crx', '.pem');
            if (fs.existsSync(generatedKey)) {
                fs.renameSync(generatedKey, CRX_KEY);
                console.log('Generated signing key: ytkit.pem (keep this file for consistent extension ID)');
            }
        }

        console.log('Chrome CRX: build/' + chromeCrxName + ' (' + formatSize(chromeCrxPath) + ' KB)');
    } catch (e) {
        console.error('Chrome CRX failed:', e.message);
    }

    // ── Firefox Build ──
    firefoxStageDir = path.join(BUILD_DIR, 'firefox-stage');
    copyDir(EXT_DIR, firefoxStageDir);

    // Modify manifest for Firefox
    const ffManifestPath = path.join(firefoxStageDir, 'manifest.json');
    const ffManifest = JSON.parse(fs.readFileSync(ffManifestPath, 'utf8'));

    ffManifest.browser_specific_settings = {
        gecko: {
            id: 'ytkit@sysadmindoc.github.io',
            strict_min_version: '128.0'
        }
    };

    if (ffManifest.background && ffManifest.background.service_worker) {
        const worker = ffManifest.background.service_worker;
        ffManifest.background = { scripts: [worker] };
    }

    fs.writeFileSync(ffManifestPath, JSON.stringify(ffManifest, null, 2) + '\n', 'utf8');

const firefoxZipName = 'astra-deck-firefox-v' + version + '.zip';
    const firefoxZipPath = path.join(BUILD_DIR, firefoxZipName);

    try {
        const size = createZip(firefoxStageDir, firefoxZipPath);
        console.log('Firefox ZIP: build/' + firefoxZipName + ' (' + size + ' KB)');
    } catch (e) {
        console.error('Firefox ZIP failed:', e.message);
        process.exit(1);
    }

    // ── Firefox XPI Build ──
    // XPI is just a ZIP with .xpi extension
const firefoxXpiName = 'astra-deck-firefox-v' + version + '.xpi';
    const firefoxXpiPath = path.join(BUILD_DIR, firefoxXpiName);
    fs.copyFileSync(firefoxZipPath, firefoxXpiPath);
    console.log('Firefox XPI: build/' + firefoxXpiName + ' (' + formatSize(firefoxXpiPath) + ' KB)');

    // ── Optional Userscript Build Artifact ──
    if (INCLUDE_USERSCRIPT) {
        const userscriptDestName = 'ytkit-v' + version + '.user.js';
        const userscriptDestPath = path.join(BUILD_DIR, userscriptDestName);
        const extensionSource = fs.readFileSync(YTKIT_JS, 'utf8');
        const userscriptOutput = buildUserscriptSource(extensionSource, version);
        fs.writeFileSync(userscriptDestPath, userscriptOutput, 'utf8');
        console.log('Userscript:  build/' + userscriptDestName + ' (' + formatSize(userscriptDestPath) + ' KB)');
    } else {
        console.log('Userscript:  skipped (extension-native build)');
    }

    console.log('\nAll artifacts built for v' + version);
    } finally {
        // Cleanup staging dirs even when the build throws mid-way.
        if (chromeStageDir && fs.existsSync(chromeStageDir)) {
            try { fs.rmSync(chromeStageDir, { recursive: true, force: true }); } catch (_) {}
        }
        if (firefoxStageDir && fs.existsSync(firefoxStageDir)) {
            try { fs.rmSync(firefoxStageDir, { recursive: true, force: true }); } catch (_) {}
        }
    }
}

build().catch(e => { console.error('Build failed:', e); process.exit(1); });
