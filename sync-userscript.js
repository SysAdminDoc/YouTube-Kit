// Sync userscript from extension source
const fs = require('fs');

const ext = fs.readFileSync('extension/ytkit.js', 'utf8');

// Extract version from extension source
const verMatch = ext.match(/const YTKIT_VERSION = '([^']+)'/);
const version = verMatch ? verMatch[1] : '3.2.0';

// Userscript header
const header = `// ==UserScript==
// @name         YTKit v${version}
// @namespace    https://github.com/SysAdminDoc/YouTube-Kit
// @version      ${version}
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
// @connect      returnyoutubedislikeapi.com
// @connect      cobalt.tools
// @connect      *.cobalt.tools
// @connect      *.imput.net
// @connect      *.meowing.de
// @connect      *.canine.tools
// @connect      capi.3kh0.net
// @connect      downloadapi.stuff.solutions
// @connect      raw.githubusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==
`;

// Preamble for userscript (replaces gm-compat shim loading)
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
            setTimeout(() => { try { document.body.removeChild(a); } catch(_) {} resolve({ ok: true }); }, 200);
        });
    }

`;

// Find where the extension preamble ends (after the triggerDownload line)
// The body starts after: const triggerDownload = gm.triggerDownload.bind(gm);
const bodyStartMarker = 'const triggerDownload = gm.triggerDownload.bind(gm);';
let bodyStartIdx = ext.indexOf(bodyStartMarker);
if (bodyStartIdx === -1) {
    // Fallback to older marker if triggerDownload not found
    const fallback = 'const GM = gm.GM;';
    bodyStartIdx = ext.indexOf(fallback);
    if (bodyStartIdx === -1) {
        console.error('Could not find body start marker');
        process.exit(1);
    }
}
// Skip past the marker and the next newline(s)
let afterMarker = bodyStartIdx + bodyStartMarker.length;
while (ext[afterMarker] === '\r' || ext[afterMarker] === '\n') afterMarker++;
let body = ext.slice(afterMarker);

// Replace the _rw bridge object and references
// Remove the entire _rw bridge block (multi-line const _rw = { ... };)
body = body.replace(/\s*\/\/ Bridge to page context[^\n]*[\s\S]*?_prCacheHref: ''\r?\n\s*\};/,
    '\n    // In userscript context, window.ytInitialPlayerResponse and window.__ytab\n    // are directly accessible (same page context, no ISOLATED/MAIN world split)');

// Replace all _rw.ytInitialPlayerResponse with window.ytInitialPlayerResponse
body = body.replace(/_rw\.ytInitialPlayerResponse/g, 'window.ytInitialPlayerResponse');

// Replace all _rw.__ytab with window.__ytab
body = body.replace(/_rw\.__ytab/g, 'window.__ytab');

// Replace the async IIFE closing with regular IIFE
// The extension uses (async function() { ... })(); — we use (function() { ... })();
// But the extension's outer wrapper is already stripped by taking the body

// Fix: the extension ends with })(); — we need to match that
// The body still has the closing })(); from the extension's async IIFE
// We need to remove it and add our own

// Remove trailing })(); from extension wrapper
body = body.replace(/\r?\n\}\)\(\);\s*$/, '');

// Compose
const userscript = header + '\n' + preamble + body + '\n})();\n';

fs.writeFileSync('ytkit.user.js', userscript, 'utf8');

const lines = userscript.split('\n').length;
console.log(`Userscript synced: ${lines} lines, v${version}`);
