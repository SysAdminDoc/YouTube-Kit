'use strict';

// Selector-drift regression canary.
//
// YouTube re-renames CSS classes and element IDs without notice as A/B
// tests roll out (see HARDENING.md; memory youtube-kit.md notes YT filter
// chips replace grid via Polymer recycling without yt-navigate-finish).
// `mhtml/` holds Chrome-saved reference snapshots — captured at v3.20.1 —
// of the home grid and a watch page. The raw MHTML files are ~5 MB each
// and are gitignored by the blanket `*.mhtml` rule; their derived token
// signatures live in `tests/fixtures/*.tokens.txt` (regenerated via
// `npm run build:fixtures`).
//
// This harness asserts, for each critical selector our code depends on:
//   1. The selector appears as a token in the fixture signatures (i.e.
//      YouTube still exposes it in the reference pages).
//   2. The selector appears as a literal in extension/ytkit.js (i.e.
//      our code still references it).
//
// Both sides matter: if the fixture is refreshed and a selector has been
// renamed by YouTube, the token list loses it and this test fails —
// forcing us to update ytkit.js before shipping. If ytkit.js refactors
// drop the selector, the other side fails — forcing us to review whether
// the canary list is stale.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const YTKIT_SOURCE = fs.readFileSync(
    path.join(REPO_ROOT, 'extension', 'ytkit.js'),
    'utf8'
);

function loadTokens(fixtureName) {
    const p = path.join(REPO_ROOT, 'tests', 'fixtures', fixtureName);
    const raw = fs.readFileSync(p, 'utf8');
    return new Set(
        raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
    );
}

const FIXTURES = {
    home: 'yt-home.tokens.txt',
    watch: 'yt-watch.tokens.txt',
};

// Critical selectors. Each must appear as a token in at least one fixture
// AND as a literal substring in ytkit.js. Use bare identifiers (no `#` or
// `.`): tokens are raw ids/classes, ytkit.js selector strings embed them.
//
// Coverage rationale (v3.20.3 expansion):
//   - Layout selectors (ytd-app, ytd-watch-flexy, ytd-watch-metadata,
//     ytd-comments) catch SPA-shape changes that orphan our content
//     scripts.
//   - Player API surfaces (movie_player, html5-video-container) catch
//     the MAIN-world bridge breaking.
//   - Player CHROME controls (ytp-chrome-bottom, ytp-progress-bar,
//     ytp-play-button, ytp-settings-button, ytp-fullscreen-button,
//     ytp-time-display) catch DOM rewrites of the control bar — the
//     surface where most ad-blocking + theater-split + per-feature hooks
//     live.
//   - Feed grid (ytd-rich-grid-renderer / ytd-rich-item-renderer) catches
//     home/subs/results renderer renames.
//   - Comments DOM in BOTH shapes:
//        * old: ytd-comment-thread-renderer
//        * new: ytd-comment-view-model
//     YouTube ships the new shape via A/B; theater-split v1.0.6 already
//     had to follow this rename. Canary keeps both alive until the old
//     shape is fully retired.
//   - Text rendering wrappers (yt-formatted-string, yt-attributed-string)
//     catch the recurring text-DOM rewrite that broke comment-text
//     selection in v1.0.6. yt-attributed-string is the newer shape;
//     yt-formatted-string is the older one still used widely.
const CRITICAL_SELECTORS = [
    // SPA + layout
    'ytd-app',
    'ytd-watch-flexy',
    'ytd-watch-metadata',
    'ytd-comments',
    // Player API
    'movie_player',
    'html5-video-container',
    // Player chrome / controls
    'ytp-chrome-bottom',
    'ytp-progress-bar',
    'ytp-play-button',
    'ytp-settings-button',
    'ytp-fullscreen-button',
    'ytp-time-display',
    // Feed / grid
    'ytd-rich-grid-renderer',
    'ytd-rich-item-renderer',
    // Comments — both DOM shapes
    'ytd-comment-thread-renderer',
    'ytd-comment-view-model',
    // Text rendering wrappers — old + new shapes
    'yt-formatted-string',
    'yt-attributed-string',
];

test('selector fixtures exist and contain a non-trivial token set', () => {
    for (const [label, file] of Object.entries(FIXTURES)) {
        const tokens = loadTokens(file);
        assert.ok(
            tokens.size >= 30,
            `${label} fixture (${file}) has only ${tokens.size} tokens — likely stale or misbuilt. Run: npm run build:fixtures`
        );
        assert.ok(
            tokens.has('ytd-app'),
            `${label} fixture must include ytd-app as a sanity baseline`
        );
    }
});

for (const selector of CRITICAL_SELECTORS) {
    test(`Selector "${selector}" survives in fixture signatures AND is referenced by ytkit.js`, () => {
        const home = loadTokens(FIXTURES.home);
        const watch = loadTokens(FIXTURES.watch);
        const inFixture = home.has(selector) || watch.has(selector);

        assert.ok(
            inFixture,
            `Selector "${selector}" is absent from both fixture token sets. ` +
            `If the mhtml/ captures were just refreshed and the fixtures rebuilt, ` +
            `YouTube likely renamed the selector — update extension/ytkit.js to match, ` +
            `then update this canary list.`
        );

        assert.ok(
            YTKIT_SOURCE.includes(selector),
            `Selector "${selector}" is no longer referenced by extension/ytkit.js. ` +
            `If the feature using it was retired, remove it from CRITICAL_SELECTORS in this test; ` +
            `otherwise the selector was lost in a refactor and needs to be restored.`
        );
    });
}
