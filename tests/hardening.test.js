'use strict';

// Regression tests for v3.14.0+ hardening passes. Each test captures an
// invariant established by an audit finding so future refactors can't
// silently regress the fix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ytkitSource = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'ytkit.js'),
    'utf8'
);

const optionsSource = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'options.js'),
    'utf8'
);

const backgroundSource = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'background.js'),
    'utf8'
);

// ── v3.14.0 C1: ReDoS guard in videoHider ──

test('videoHider ReDoS guard catches alternation-wrapped quantifier stacks', () => {
    // The guard at ytkit.js:~10248 must reject patterns that wrap a
    // quantified atom in a group and then quantify the group (e.g. `(a|b+)+`).
    // The narrower `(a+)+`-only guard shipped before v3.14.0 allowed
    // alternation-hidden ReDoS patterns through.
    const guardStart = ytkitSource.indexOf('Reject patterns with nested quantifiers');
    assert.ok(guardStart > -1, 'Nested-quantifier guard comment should exist');
    const guardBlock = ytkitSource.slice(guardStart, guardStart + 1500);

    assert.match(
        guardBlock,
        /groupWithInnerQuantifier/,
        'Guard must include a dedicated check for alternation-wrapped quantifier stacks'
    );
    // The guard regex uses character-class + non-capturing alternation
    // `[^()]*(?:[+*?]|{...})` so it matches quantifiers anywhere inside the
    // group body, not just at the end. Assert the critical fragment is
    // present (substring check avoids re-escaping a regex-of-a-regex).
    assert.ok(
        guardBlock.includes('[^()]*(?:[+*?]|'),
        'groupWithInnerQuantifier must use character-class + alternation to match quantifiers anywhere in group body'
    );
    assert.ok(
        guardBlock.includes(')\\s*(?:[+*?]|'),
        'groupWithInnerQuantifier must require the group itself to be followed by a quantifier'
    );
});

// ── v3.14.0 C3: profile import preserves exporter _settingsVersion ──

test('applyImportedSettingsVersion exists and preserves imported _settingsVersion', () => {
    assert.match(
        optionsSource,
        /function\s+applyImportedSettingsVersion\s*\(/,
        'applyImportedSettingsVersion helper must exist'
    );

    const start = optionsSource.indexOf('function applyImportedSettingsVersion');
    // Grab the next ~2000 chars; the function is short enough that this
    // captures its body without over-reading into unrelated code.
    const body = optionsSource.slice(start, start + 2000);

    assert.match(
        body,
        /Number\s*\(\s*settings\._settingsVersion\s*\)/,
        'Must read imported _settingsVersion from the payload'
    );
    assert.match(
        body,
        /next\._settingsVersion\s*=\s*importedVersion/,
        'Must preserve the imported version, not stamp current'
    );

    // The legacy path (no _settingsVersion on import) should stamp v0 so
    // the runtime's migration chain runs from the beginning.
    assert.match(
        body,
        /next\._settingsVersion\s*=\s*0/,
        'Legacy imports (no version) must stamp 0 so migration runs'
    );
});

test('importSettings routes through applyImportedSettingsVersion, not applySettingsVersion', () => {
    // Grab the importSettings body and assert every settings write goes
    // through the import-aware helper.
    const importStart = optionsSource.indexOf('async function importSettings');
    assert.ok(importStart > -1, 'importSettings function should exist');
    const importEnd = optionsSource.indexOf('async function resetSettings');
    const body = optionsSource.slice(importStart, importEnd);

    // Count references — every "applySettingsVersion" inside importSettings
    // should actually be "applyImportedSettingsVersion".
    const bareCount = (body.match(/\bapplySettingsVersion\s*\(/g) || []).length;
    const importAwareCount = (body.match(/\bapplyImportedSettingsVersion\s*\(/g) || []).length;

    assert.equal(
        bareCount,
        0,
        'importSettings must not call applySettingsVersion directly (would overwrite exporter version)'
    );
    assert.ok(
        importAwareCount >= 2,
        'importSettings should apply the import-aware helper on at least both export-version branches'
    );
});

test('settings backups include filtered video posts and import the alias', () => {
    const optionsExportStart = optionsSource.indexOf('function buildExportData');
    const optionsExportEnd = optionsSource.indexOf('function summarizeStorage');
    assert.ok(optionsExportStart > -1 && optionsExportEnd > optionsExportStart, 'options buildExportData should exist');
    const optionsExportBody = optionsSource.slice(optionsExportStart, optionsExportEnd);
    assert.match(
        optionsExportBody,
        /filteredVideoPosts:\s*hiddenVideos/,
        'Options-page exports should include filteredVideoPosts beside hiddenVideos'
    );

    const panelExportStart = ytkitSource.indexOf('exportAllSettings()');
    const panelExportEnd = ytkitSource.indexOf('importAllSettings(jsonString)');
    assert.ok(panelExportStart > -1 && panelExportEnd > panelExportStart, 'in-page exportAllSettings should exist');
    const panelExportBody = ytkitSource.slice(panelExportStart, panelExportEnd);
    assert.match(
        panelExportBody,
        /filteredVideoPosts:\s*hiddenVideosForExport/,
        'In-page exports should include filteredVideoPosts beside hiddenVideos'
    );

    assert.ok(
        optionsSource.includes('function getImportedFilteredVideoPosts') &&
        ytkitSource.includes('function getImportedFilteredVideoPosts'),
        'Both import paths should share a filtered-video-posts fallback helper'
    );
    assert.ok(
        optionsSource.includes('data.filteredVideoPosts') &&
        ytkitSource.includes('data.filteredVideoPosts'),
        'Imports should restore hidden videos from filteredVideoPosts when hiddenVideos is absent'
    );
});

// ── v3.14.0 infrastructure: selectorChain helper ──

test('selectorChain helper exists with label, all:true, and first-miss logging', () => {
    assert.match(
        ytkitSource,
        /function\s+selectorChain\s*\(\s*selectors\s*,\s*options\s*=\s*\{\}\s*\)/,
        'selectorChain(selectors, options) must be defined'
    );

    const start = ytkitSource.indexOf('function selectorChain');
    // Slice generously — selectorChain is ~40 lines including comments.
    const body = ytkitSource.slice(start, start + 3500);

    assert.match(body, /options\.all\s*===\s*true/, 'Must support { all: true } mode for NodeList results');
    assert.match(body, /root\.querySelectorAll/, 'all:true branch must use querySelectorAll');
    assert.match(body, /root\.querySelector\b/, 'single-match branch must use querySelector');
    assert.match(body, /_selectorMissLogged/, 'Must deduplicate miss logs per session');
    assert.match(body, /DiagnosticLog\?\.record\?\.\(/, 'Misses must funnel into diagnosticLog');
});

test('selectorChain is adopted at macro-markers (chapter extract + chapter-jump)', () => {
    // Both copyChapterMarkdown._extract and chapterJumpButtons._getChapterTimes
    // should go through selectorChain with a label so drift surfaces.
    const extractMatches = ytkitSource.match(/selectorChain\(\s*\[[\s\S]*?'ytd-macro-markers-list-item-renderer'/g) || [];
    assert.ok(
        extractMatches.length >= 2,
        'Expected at least 2 selectorChain adoptions citing macro-markers (chapter + chapter-jump)'
    );

    const labelCount = (ytkitSource.match(/label:\s*'chapters\.macroMarkers'/g) || []).length;
    assert.ok(
        labelCount >= 2,
        `Expected at least 2 'chapters.macroMarkers' labels, found ${labelCount}`
    );
});

test('selectorChain is adopted at player settings button (quality-forcing)', () => {
    const match = ytkitSource.match(/selectorChain\(\s*\[[\s\S]*?'\.ytp-settings-button'[\s\S]*?\{\s*root:\s*player[\s\S]*?label:\s*'player\.settingsButton'/);
    assert.ok(
        match,
        'Quality-forcing path should use selectorChain rooted at player with label player.settingsButton'
    );
});

// ── v3.14.0 getSetting helper ──

test('getSetting helper exists and is null-safe', () => {
    assert.match(
        ytkitSource,
        /function\s+getSetting\s*\(\s*key\s*,\s*def\s*\)/,
        'getSetting(key, default) must be defined'
    );

    const start = ytkitSource.indexOf('function getSetting');
    // Slice a generous window — the function body is short so any later code
    // won't affect the assertions.
    const body = ytkitSource.slice(start, start + 600);

    assert.match(body, /appState\s*&&\s*appState\.settings/, 'Must guard against missing appState.settings');
    assert.match(body, /typeof\s+settings\s*!==\s*'object'/, 'Must guard against non-object settings');
});

// ── v3.14.0 L1: chrome.downloads.show via onChanged ──

test('background.js reveals downloads via onChanged, not setTimeout', () => {
    assert.match(
        backgroundSource,
        /chrome\.downloads\.onChanged\.addListener/,
        'background.js must listen for downloads.onChanged'
    );
    assert.match(
        backgroundSource,
        /delta\.state\?\.current/,
        'onChanged handler must inspect delta.state.current transitions'
    );
    assert.match(
        backgroundSource,
        /state\s*===\s*'complete'/,
        'onChanged handler must branch on complete state'
    );
    assert.match(
        backgroundSource,
        /_pendingReveals/,
        'Pending reveals must be tracked via a Set, not timeouts'
    );

    // Confirm the legacy setTimeout(900, chrome.downloads.show) is gone.
    // Use multiline-aware regex since setTimeout callback spans newlines.
    assert.doesNotMatch(
        backgroundSource,
        /setTimeout\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?chrome\.downloads\.show/,
        'Legacy setTimeout + downloads.show pattern must be removed'
    );
});

// ── v3.14.0 C4: empty catch blocks must be documented ──

test('empty catch (_) {} blocks are eliminated from extension source', () => {
    for (const [name, source] of [
        ['ytkit.js', ytkitSource],
        ['background.js', backgroundSource],
        ['options.js', optionsSource]
    ]) {
        const matches = source.match(/catch\s*\(\s*_\s*\)\s*\{\s*\}/g) || [];
        assert.equal(
            matches.length,
            0,
            `${name} must not contain empty catch (_) {} blocks; each must carry a // reason: or log`
        );
    }
});

// ── v3.14.0 L2: diagnosticLog destroy clears _errors ──

test('diagnosticLog destroy clears _errors for immediate storage relief', () => {
    const idx = ytkitSource.indexOf("id: 'diagnosticLog'");
    assert.ok(idx > -1, 'diagnosticLog feature must exist');
    const end = ytkitSource.indexOf("id: 'storageQuotaLRU'", idx);
    const block = ytkitSource.slice(idx, end);

    assert.match(block, /destroy\s*\(\s*\)/, 'diagnosticLog must expose a destroy hook');
    assert.match(block, /DiagnosticLog\.clear\s*\(\s*\)/, 'destroy must call DiagnosticLog.clear()');
});
