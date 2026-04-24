#!/usr/bin/env node
'use strict';

// Regenerate tests/fixtures/*.tokens.txt from the raw mhtml/ captures.
//
// The raw MHTML files in mhtml/ are ~5 MB each and are gitignored by the
// blanket `*.mhtml` rule. The selector-regression test needs a portable,
// repo-committed artifact derived from them. This script produces one
// sorted token list per MHTML file, each one the set of distinct DOM
// identifiers our code could plausibly target (ytd-*, ytp-*, yt-*,
// html5-*, the `movie_player` element id, and a few common YT layout
// ids).
//
// Run after refreshing mhtml/:
//     npm run build:fixtures
//     git add tests/fixtures/*.tokens.txt
//     git commit -m "fixtures: refresh selector canary"

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const MHTML_DIR = path.join(REPO_ROOT, 'mhtml');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures');

const SOURCES = [
    { mhtml: 'YouTube.mhtml', out: 'yt-home.tokens.txt' },
    { mhtml: 'WatchPage.mhtml', out: 'yt-watch.tokens.txt' },
];

// Patterns we care to canary. YouTube uses ytd-* for Polymer elements,
// ytp-* for player chrome classes, yt-* for newer attributed-string
// components, and html5-* for the media element wrapper. The `movie_player`
// element id is the canonical entry point for the player API.
const TOKEN_PATTERNS = [
    /\b(ytd-[a-z][\w-]*)/g,
    /\b(ytp-[a-z][\w-]*)/g,
    /\b(yt-[a-z][\w-]*)/g,
    /\b(html5-[a-z][\w-]*)/g,
    /\b(movie_player)\b/g,
    /\b(primary|secondary|contents|content|masthead-container|masthead)\b(?=[^a-z])/g,
];

function decodeQuotedPrintable(str) {
    return str
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        );
}

function extractFirstHtmlPart(mhtmlPath) {
    const raw = fs.readFileSync(mhtmlPath, 'utf8');
    const htmlHeaderIdx = raw.search(/Content-Type:\s*text\/html/i);
    if (htmlHeaderIdx < 0) {
        throw new Error(`${mhtmlPath}: no text/html part found`);
    }
    const partHeadersEnd = raw.indexOf('\n\n', htmlHeaderIdx);
    const partHeadersEndCrlf = raw.indexOf('\r\n\r\n', htmlHeaderIdx);
    const bodyStart = (partHeadersEndCrlf > -1 &&
        (partHeadersEnd === -1 || partHeadersEndCrlf < partHeadersEnd))
        ? partHeadersEndCrlf + 4
        : (partHeadersEnd > -1 ? partHeadersEnd + 2 : -1);
    if (bodyStart <= 0) {
        throw new Error(`${mhtmlPath}: could not locate blank line after part headers`);
    }
    const partHeaderBlock = raw.slice(htmlHeaderIdx, bodyStart);
    const isQuotedPrintable = /Content-Transfer-Encoding:\s*quoted-printable/i.test(partHeaderBlock);
    const nextBoundary = raw.indexOf('\n------MultipartBoundary', bodyStart);
    const bodyEnd = nextBoundary > -1 ? nextBoundary : raw.length;
    const body = raw.slice(bodyStart, bodyEnd);
    return isQuotedPrintable ? decodeQuotedPrintable(body) : body;
}

function extractTokens(html) {
    const tokens = new Set();
    for (const rx of TOKEN_PATTERNS) {
        let match;
        while ((match = rx.exec(html)) !== null) {
            tokens.add(match[1]);
        }
    }
    return Array.from(tokens).sort();
}

function main() {
    if (!fs.existsSync(MHTML_DIR)) {
        console.error(`[build-selector-fixtures] mhtml/ not found at ${MHTML_DIR}`);
        console.error('  The raw *.mhtml captures are gitignored; save them locally first.');
        process.exit(1);
    }
    if (!fs.existsSync(FIXTURE_DIR)) {
        fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    }

    for (const { mhtml, out } of SOURCES) {
        const mhtmlPath = path.join(MHTML_DIR, mhtml);
        if (!fs.existsSync(mhtmlPath)) {
            console.error(`[build-selector-fixtures] missing: ${mhtmlPath}`);
            process.exit(1);
        }
        const html = extractFirstHtmlPart(mhtmlPath);
        const tokens = extractTokens(html);
        const outPath = path.join(FIXTURE_DIR, out);
        const header = [
            '# Selector-regression canary fixture.',
            `# Source: mhtml/${mhtml}`,
            '# Regenerated via: npm run build:fixtures',
            `# Captured tokens: ${tokens.length}`,
            '# Encoding: one token per line, sorted.',
            '',
        ].join('\n');
        fs.writeFileSync(outPath, header + tokens.join('\n') + '\n', 'utf8');
        console.log(`[build-selector-fixtures] wrote ${tokens.length} tokens → ${path.relative(REPO_ROOT, outPath)}`);
    }
}

if (require.main === module) {
    try {
        main();
    } catch (e) {
        console.error('[build-selector-fixtures]', e);
        process.exit(1);
    }
}
