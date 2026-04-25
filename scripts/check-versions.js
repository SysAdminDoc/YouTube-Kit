#!/usr/bin/env node
'use strict';

// Cross-validate the four canonical version strings before tag/push.
//
// The Build & Release workflow (.github/workflows/build.yml) already
// runs this comparison on tag push, but a developer who bumps three of
// four sources locally won't notice the drift until CI fails post-tag.
// Running this in `npm run check` catches it pre-push.
//
// Sources of truth (must all match):
//   1. package.json                  → "version"
//   2. extension/manifest.json       → "version"
//   3. extension/ytkit.js            → const YTKIT_VERSION = '...'
//   4. YTKit.user.js                 → // @version
//
// Exit 0 if all four agree; exit 1 with a per-source breakdown otherwise.
//
// Optional: pass --tag <vX.Y.Z> to also validate against an external
// tag string (e.g. before `git tag` runs in a release recipe).

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

function readPackageVersion() {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return { source: 'package.json', value: String(pkg.version || '') };
}

function readManifestVersion() {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'manifest.json'), 'utf8'));
    return { source: 'extension/manifest.json', value: String(manifest.version || '') };
}

function readYtkitVersion() {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'ytkit.js'), 'utf8');
    const m = src.match(/const YTKIT_VERSION = '([^']+)'/);
    return { source: 'extension/ytkit.js (YTKIT_VERSION)', value: m ? m[1] : '' };
}

function readUserscriptVersion() {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'YTKit.user.js'), 'utf8');
    const m = src.match(/^\/\/ @version\s+(\S+)/m);
    return { source: 'YTKit.user.js (@version)', value: m ? m[1] : '' };
}

function parseTagFlag(argv) {
    const idx = argv.indexOf('--tag');
    if (idx === -1 || idx + 1 >= argv.length) return null;
    const raw = argv[idx + 1];
    return raw.startsWith('v') ? raw.slice(1) : raw;
}

function main(argv) {
    const sources = [
        readPackageVersion(),
        readManifestVersion(),
        readYtkitVersion(),
        readUserscriptVersion(),
    ];

    const tagOverride = parseTagFlag(argv);
    if (tagOverride) {
        sources.push({ source: '--tag flag (caller-provided)', value: tagOverride });
    }

    const distinct = new Set(sources.map((s) => s.value));
    // distinct.size === 1 means every read returned the same string; the
    // empty-string check ensures we don't pass when every regex failed
    // and produced ''. (Earlier draft used .includes('') which is always
    // true on any string and silently broke the happy path.)
    if (distinct.size === 1 && sources[0].value !== '') {
        const v = sources[0].value;
        console.log(`[check-versions] All ${sources.length} sources agree at v${v}`);
        for (const s of sources) console.log(`  - ${s.source}`);
        process.exit(0);
    }

    console.error('[check-versions] Version drift detected — sources disagree:');
    for (const s of sources) {
        console.error(`  ${s.value || '<empty>'}  ←  ${s.source}`);
    }
    console.error('');
    console.error('Fix every source then re-run. Useful one-liners:');
    console.error('  node sync-userscript.js               # syncs YTKit.user.js to ytkit.js');
    console.error('  npm install --package-lock-only       # refreshes package-lock.json');
    process.exit(1);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (e) {
        console.error('[check-versions]', e.message || e);
        process.exit(2);
    }
}
