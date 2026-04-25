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

// v3.19.0: options.html / options.js removed. The toolbar popup
// now hosts all data management (export/import/reset/stats) plus
// the quick-toggle list. Tests that touched the options page
// source have been retired in this release.

const popupSource = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'popup.js'),
    'utf8'
);

const popupHtmlSource = fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'popup.html'),
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

// ── v3.19.0: export/import now lives in popup.js ──

test('settings backups include filtered video posts and import the alias', () => {
    const popupExportStart = popupSource.indexOf('function buildExportData');
    const popupExportEnd = popupSource.indexOf('function confirmAction');
    assert.ok(popupExportStart > -1 && popupExportEnd > popupExportStart, 'popup buildExportData should exist');
    const popupExportBody = popupSource.slice(popupExportStart, popupExportEnd);
    assert.match(
        popupExportBody,
        /filteredVideoPosts:\s*hiddenVideos/,
        'Popup exports should include filteredVideoPosts beside hiddenVideos'
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
        popupSource.includes('function getImportedFilteredVideoPosts') &&
        ytkitSource.includes('function getImportedFilteredVideoPosts'),
        'Both import paths should share a filtered-video-posts fallback helper'
    );
    assert.ok(
        popupSource.includes('data.filteredVideoPosts') &&
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

test('quality forcer uses MAIN-world setPlaybackQualityRange, not gear-menu DOM clicks (v3.18.0)', () => {
    // ISOLATED side: autoMaxResolution toggles a single attribute. The whole
    // _setQualityViaDOM / _temporarilyHideQualityPopup / settings-menu-click
    // path that caused the popup-flash bug must stay deleted.
    assert.match(
        ytkitSource,
        /id:\s*'autoMaxResolution'[\s\S]{0,800}data-ytkit-quality/,
        'autoMaxResolution must set data-ytkit-quality on <html>'
    );
    assert.ok(
        !/_setQualityViaDOM|_temporarilyHideQualityPopup|ytkit-hide-quality-popup/.test(ytkitSource),
        'gear-menu DOM-click quality forcing must remain removed'
    );

    // MAIN side: the bridge must use the documented player APIs.
    const mainSource = fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'ytkit-main.js'),
        'utf8'
    );
    assert.match(mainSource, /setPlaybackQualityRange/, 'MAIN bridge must call setPlaybackQualityRange');
    assert.match(mainSource, /getAvailableQualityData/, 'MAIN bridge must use getAvailableQualityData for Premium awareness');
    assert.match(mainSource, /\/premium\/i/, 'MAIN bridge must detect Premium-labelled qualityLabel entries');
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
        ['popup.js', popupSource]
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

// ── v3.16+ Audit Pass: popup.js serializes toggle writes ──

test('popup.js serializes toggle writes to avoid read-merge-write race', () => {
    // The fix chains every writeSetting() call onto a shared promise so two
    // rapid toggle clicks can't both read pre-write storage and clobber each
    // other's update.
    assert.match(
        popupSource,
        /_pendingWriteChain/,
        'popup.js must serialize writeSetting() via a pending-write chain'
    );
    // The merge must be against the in-memory popupState.settings, not a
    // fresh storageGet() round-trip (which was the race source).
    const fnStart = popupSource.indexOf('async function writeSetting');
    assert.ok(fnStart > -1, 'writeSetting must exist');
    const fnBody = popupSource.slice(fnStart, fnStart + 1200);
    assert.match(fnBody, /\.\.\.\s*popupState\.settings/, 'writeSetting must merge from popupState.settings');
    assert.doesNotMatch(fnBody, /await\s+storageGet\s*\(/, 'writeSetting must not re-read storage per call');
});

test('popup.js exposes live result counts and the new data-management controls', () => {
    assert.ok(
        popupSource.includes('function updateResultsState(totalCount, visibleCount, filter)'),
        'popup.js should compute a live quick-control results summary'
    );
    assert.ok(
        popupHtmlSource.includes('id="resultsState"'),
        'popup.html should expose a dedicated results summary chip'
    );
    // v3.19.0: export/import/reset + storage stats were absorbed from the
    // removed options page. Every control must be wired up in the popup.
    for (const id of ['export-btn', 'import-btn', 'reset-btn', 'stat-keys', 'stat-size', 'stat-hidden-videos']) {
        assert.ok(
            popupHtmlSource.includes(`id="${id}"`),
            `popup.html must expose ${id} (ported from the removed options page)`
        );
    }
    assert.match(popupSource, /async function exportSettings/, 'popup.js must define exportSettings');
    assert.match(popupSource, /async function importSettings/, 'popup.js must define importSettings');
    assert.match(popupSource, /async function resetAllData/, 'popup.js must define resetAllData');
    assert.match(popupSource, /function summarizeStorage/, 'popup.js must own storage summarization');
});

// ── v3.19.0: options.html / options.js retirement ──

test('extension bundle no longer ships a standalone options page', () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'manifest.json'),
        'utf8'
    ));
    assert.equal(
        manifest.options_ui,
        undefined,
        'manifest.options_ui must stay removed — the toolbar popup is the only settings surface'
    );
    assert.ok(
        !fs.existsSync(path.join(__dirname, '..', 'extension', 'options.html')),
        'extension/options.html must remain deleted'
    );
    assert.ok(
        !fs.existsSync(path.join(__dirname, '..', 'extension', 'options.js')),
        'extension/options.js must remain deleted'
    );
});

test('popup.js import accepts exportVersion >= 3 without an upper cap', () => {
    assert.doesNotMatch(
        popupSource,
        /exportVersion\s*>=\s*3\s*&&\s*data\.exportVersion\s*<\s*100/,
        'Arbitrary `< 100` import cap must be absent from the ported importer'
    );
});

// ── v3.16+ Audit Pass: SponsorBlock destroy is race-proof ──

test('sponsorBlock _loadForVideo aborts if destroy runs mid-fetch', () => {
    const idx = ytkitSource.indexOf("id: 'sponsorBlock'");
    assert.ok(idx > -1, 'sponsorBlock feature must exist');
    const end = ytkitSource.indexOf("id: 'sbCat_sponsor'", idx);
    const block = ytkitSource.slice(idx, end);

    assert.match(block, /_generation:\s*0/, 'sponsorBlock must track a generation counter');
    assert.match(
        block,
        /gen\s*!==\s*this\._generation/,
        '_loadForVideo must short-circuit when destroy bumped the generation'
    );
    // The destroy() hook must bump the counter before clearing other state
    // so late fetches observe the bump. Match `destroy() {` to skip prose
    // that mentions destroy() in comments.
    const destroyIdx = block.search(/destroy\s*\(\s*\)\s*\{/);
    assert.ok(destroyIdx > -1, 'destroy() method must exist');
    const destroyBody = block.slice(destroyIdx, destroyIdx + 1800);
    assert.match(destroyBody, /this\._generation\s*=/, 'destroy must bump _generation');
});

// ── v3.17.0 Perf Pass: scoped mutation rule helper ──

test('addScopedMutationRule exists in core/navigation.js and is selector-filtered', () => {
    const navSource = fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'core', 'navigation.js'),
        'utf8'
    );
    // New helper that only fires when an element matching `selector` is added
    // in the mutation batch. Without it the shared observer fan-out ran all
    // ~37 rules on every rAF tick.
    assert.match(navSource, /function\s+addScopedMutationRule\s*\(\s*id\s*,\s*selector\s*,\s*ruleFn\s*\)/,
        'addScopedMutationRule(id, selector, ruleFn) must exist');
    assert.match(navSource, /scopedMutationRules/, 'scoped rules must live in a separate Map from addMutationRule rules');
    // The dispatch path must short-circuit when no added node matches.
    assert.match(navSource, /anyAddedMatchesSelector/, 'scoped dispatch must use the added-node match helper');
    // Core must export both the add and remove helpers.
    assert.match(navSource, /addScopedMutationRule,/, 'addScopedMutationRule must be exported on core');
    assert.match(navSource, /removeScopedMutationRule/, 'removeScopedMutationRule must be exported on core');
});

test('hot feed-driven mutation rules are migrated to scoped form', () => {
    // These four features ran `document.querySelectorAll`/debounced schedulers
    // on every mutation tick. After the perf pass they only fire when a
    // thumbnail-bearing renderer is added to the DOM.
    for (const id of [
        'thumbnailQualityUpgrade',
        'watchLaterQuickAdd',
        'videoResolutionBadge',
        'videoAgeColors'
    ]) {
        assert.ok(
            ytkitSource.includes(`addScopedMutationRule(\n                    '${id}'`)
            || ytkitSource.includes(`addScopedMutationRule(\n                    '${id}',`)
            || new RegExp(`addScopedMutationRule\\(\\s*'${id}'`).test(ytkitSource),
            `${id} must register via addScopedMutationRule, not addMutationRule`
        );
        // And cleanup must use the matching remove helper.
        assert.ok(
            new RegExp(`removeScopedMutationRule\\(\\s*'${id}'`).test(ytkitSource),
            `${id} destroy must call removeScopedMutationRule`
        );
    }
});

// ── v3.17.0 Perf Pass: 1Hz intervals → timeupdate events ──

test('remainingTimeDisplay + showTimeInTabTitle use timeupdate, not setInterval', () => {
    // These were setInterval(_update, 1000) — waking up once a second even in
    // background tabs. `timeupdate` is free (fires during playback only) and
    // stops when the video pauses.
    const remainIdx = ytkitSource.indexOf("id: 'remainingTimeDisplay'");
    assert.ok(remainIdx > -1, 'remainingTimeDisplay feature must exist');
    const nextFeatureIdx = ytkitSource.indexOf("id: 'showTimeInTabTitle'", remainIdx);
    const remainBlock = ytkitSource.slice(remainIdx, nextFeatureIdx);
    assert.doesNotMatch(remainBlock, /setInterval\s*\(\s*\(\s*\)\s*=>\s*this\._update/,
        'remainingTimeDisplay must not wake up once per second via setInterval');
    assert.match(remainBlock, /addEventListener\('timeupdate'/,
        'remainingTimeDisplay must bind to the video `timeupdate` event');

    const titleIdx = ytkitSource.indexOf("id: 'showTimeInTabTitle'");
    assert.ok(titleIdx > -1);
    const titleEnd = ytkitSource.indexOf("id: 'customProgressBarColor'", titleIdx);
    const titleBlock = ytkitSource.slice(titleIdx, titleEnd);
    assert.doesNotMatch(titleBlock, /setInterval\s*\(\s*\(\s*\)\s*=>\s*this\._update/,
        'showTimeInTabTitle must not wake up once per second via setInterval');
    assert.match(titleBlock, /addEventListener\('timeupdate'/,
        'showTimeInTabTitle must bind to the video `timeupdate` event');
});

// ── Audit pass: EXT_FETCH SSRF post-redirect validation ──

test('EXT_FETCH rejects responses whose final URL escapes the origin allowlist', () => {
    // A 30x from an allowed origin (e.g. api.openai.com) to an internal IP
    // would otherwise smuggle an arbitrary host into the response because
    // fetch() defaults to `redirect: 'follow'`. The guard must re-check
    // `resp.url` against isUrlAllowed before the body is streamed back.
    assert.match(
        backgroundSource,
        /resp\.url\s*!==\s*url\s*&&\s*!isUrlAllowed\(resp\.url\)/,
        'background.js must re-check the post-redirect URL against the allowlist'
    );
    assert.match(
        backgroundSource,
        /Response URL not in allowlist after redirect/,
        'Rejection must carry a descriptive error so callers can surface it'
    );
});

// ── Audit pass: storage write backoff prevents retry storms ──

test('core/storage.js applies exponential backoff on persistent write failures', () => {
    const storageSource = fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'core', 'storage.js'),
        'utf8'
    );
    // Without a backoff, a QUOTA_BYTES failure would retry every 140ms
    // forever, saturating the SW IPC channel and flooding the console.
    assert.match(
        storageSource,
        /storageFlushBackoffMs/,
        'Storage flush must track a backoff value on failure'
    );
    assert.match(
        storageSource,
        /storageFlushFailureCount/,
        'Storage flush must track consecutive failure count for backoff'
    );
    assert.match(
        storageSource,
        /STORAGE_FLUSH_MAX_BACKOFF_MS/,
        'Storage flush must cap the backoff so it cannot diverge'
    );
    // Success path must reset the backoff — a sticky backoff would keep
    // penalising writes long after the transient error cleared.
    const flushFn = storageSource.slice(
        storageSource.indexOf('function flushPendingStorageWrites')
    );
    const successBody = flushFn.slice(0, flushFn.indexOf('.catch('));
    assert.match(
        successBody,
        /storageFlushBackoffMs\s*=\s*0/,
        'Success path must reset backoff'
    );
    assert.match(
        successBody,
        /storageFlushFailureCount\s*=\s*0/,
        'Success path must reset failure count'
    );
});

// ── Audit pass: download progress poll is resilient and non-overlapping ──

test('showDownloadProgress uses self-scheduling poll with consecutive-error budget', () => {
    const progressStart = ytkitSource.indexOf('function showDownloadProgress(');
    assert.ok(progressStart > -1, 'showDownloadProgress must exist');
    // Grab from the function start up to the matching `}` — the function is
    // ~14 KB with all the DOM scaffolding so this generous capture covers
    // the whole poll loop without overshooting into neighbours.
    const progressBody = ytkitSource.slice(progressStart, progressStart + 16000);

    // setInterval would allow a slow poll to overlap itself, doubling load
    // on the downloader when yt-dlp is busy merging or extracting audio.
    assert.doesNotMatch(
        progressBody,
        /setInterval\s*\(\s*poll/,
        'showDownloadProgress must not drive its poll loop with setInterval'
    );
    // Tolerate a small streak of transient failures before tearing down the
    // panel so a single network blip doesn't kill an otherwise healthy
    // download.
    assert.match(
        progressBody,
        /consecutiveErrors/,
        'Poll loop must track consecutive errors for graceful retry'
    );
    assert.match(
        progressBody,
        /MAX_CONSECUTIVE_ERRORS/,
        'Poll loop must cap consecutive errors before giving up'
    );
    assert.match(
        progressBody,
        /pollTimer\s*=\s*setTimeout\(poll/,
        'Poll loop must reschedule itself with setTimeout, not setInterval'
    );
});

// ── v3.20.0 Hardening Pass 7 ──

test('_pendingReveals is mirrored to chrome.storage.session for SW-restart survival', () => {
    // The roadmap audit-pass flagged the in-memory Set as fragile: a SW
    // terminated between download() and state.complete would lose the reveal.
    // Pass 7 mirrors writes into chrome.storage.session (MV3-only, survives
    // SW restart, cleared on browser restart) and hydrates on SW cold-start.
    assert.match(
        backgroundSource,
        /_PENDING_REVEALS_KEY\s*=\s*'_pendingReveals'/,
        'Session-storage key constant must exist'
    );
    assert.match(
        backgroundSource,
        /_pendingRevealsReady\s*=\s*\(async\s*\(\s*\)\s*=>/,
        'Hydration promise must bootstrap on SW cold-start'
    );
    assert.match(
        backgroundSource,
        /chrome\.storage\.session\.get\s*\(\s*_PENDING_REVEALS_KEY/,
        'Hydration must read from chrome.storage.session'
    );
    assert.match(
        backgroundSource,
        /function\s+_persistPendingReveals/,
        'Persist helper must exist so add/delete mirror into storage.session'
    );
    assert.match(
        backgroundSource,
        /chrome\.storage\.session\.set\s*\(\s*payload/,
        'Persist helper must write through chrome.storage.session.set'
    );
    // The onChanged listener must await the hydration promise so a reveal
    // queued before SW cold-start is still honoured when the event arrives.
    const listenerStart = backgroundSource.indexOf(
        'chrome.downloads.onChanged.addListener'
    );
    assert.ok(listenerStart > -1, 'onChanged listener must exist');
    // Bound the slice to the closing brace of the addListener() call so
    // growth of the listener body doesn't silently let the assertion below
    // reach past it into unrelated code.
    const listenerEnd = backgroundSource.indexOf('\n}', listenerStart);
    assert.ok(listenerEnd > listenerStart, 'onChanged listener must have a closing brace');
    const listenerBody = backgroundSource.slice(listenerStart, listenerEnd);
    assert.match(
        listenerBody,
        /await\s+_pendingRevealsReady/,
        'onChanged listener must await the hydration promise before checking membership'
    );
    assert.match(
        listenerBody,
        /_persistPendingReveals\s*\(\s*\)/,
        'onChanged listener must persist the Set after deleting a completed/interrupted id'
    );

    // The DOWNLOAD_FILE handler must persist the add, not just update the
    // in-memory Set — otherwise a SW kill between add and state.complete
    // loses the reveal.
    const addStart = backgroundSource.indexOf('_pendingReveals.add(downloadId)');
    assert.ok(addStart > -1, 'DOWNLOAD_FILE handler must still populate _pendingReveals');
    const addBlock = backgroundSource.slice(addStart, addStart + 200);
    assert.match(
        addBlock,
        /_persistPendingReveals\s*\(\s*\)/,
        'DOWNLOAD_FILE handler must mirror the add into storage.session'
    );
});

test('_pendingReveals is pruned when a tracked download is erased from history', () => {
    // Pass 8 closes the Pass 7 LOW security finding: without onErased, a
    // download that is cancelled + erased (or wiped on crash recovery)
    // before reaching `state.complete` / `state.interrupted` would leave
    // its id in `_pendingReveals` forever — both in memory and in the
    // session mirror.
    assert.match(
        backgroundSource,
        /chrome\.downloads\?\.onErased\?\.addListener/,
        'onErased listener must exist (guarded for older Firefox builds)'
    );
    const erasedStart = backgroundSource.indexOf('chrome.downloads.onErased.addListener');
    assert.ok(erasedStart > -1, 'onErased listener must be registered');
    // Bound the slice to the closing brace of this addListener() call so
    // growth elsewhere in the file can't satisfy these assertions.
    const erasedEnd = backgroundSource.indexOf('\n}', erasedStart);
    assert.ok(erasedEnd > erasedStart, 'onErased listener must have a closing brace');
    const erasedBody = backgroundSource.slice(erasedStart, erasedEnd);
    assert.match(
        erasedBody,
        /await\s+_pendingRevealsReady/,
        'onErased listener must await the hydration promise before mutating the Set'
    );
    assert.match(
        erasedBody,
        /_pendingReveals\.delete\s*\(\s*downloadId\s*\)/,
        'onErased listener must drop the id from the in-memory Set'
    );
    assert.match(
        erasedBody,
        /_persistPendingReveals\s*\(\s*\)/,
        'onErased listener must mirror the delete into chrome.storage.session'
    );
    assert.match(
        erasedBody,
        /_pendingReveals\.has\s*\(\s*downloadId\s*\)/,
        'onErased listener must no-op on ids we never tracked (e.g. unrelated downloads)'
    );
});

test('manifest declares unlimitedStorage to exceed the 10 MB default quota', () => {
    // Watch history, DeArrow cache, and storageQuotaLRU can collectively
    // push chrome.storage.local past the 10 MB default quota for long-term
    // users. `unlimitedStorage` removes the ceiling without changing any
    // other permission surface.
    const manifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'manifest.json'),
        'utf8'
    ));
    assert.ok(
        Array.isArray(manifest.permissions) && manifest.permissions.includes('unlimitedStorage'),
        'manifest.permissions must include "unlimitedStorage"'
    );
});

test('Firefox build rewrites Ctrl+Shift+Y (reserved by Firefox Downloads) to Ctrl+Alt+Y', () => {
    // Chrome manifest is the build input — stays on the original shortcut.
    const manifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'manifest.json'),
        'utf8'
    ));
    assert.equal(
        manifest.commands?.['toggle-control-center']?.suggested_key?.default,
        'Ctrl+Shift+Y',
        'Chrome manifest must keep Ctrl+Shift+Y as the default (no vendor conflict there)'
    );

    // Run the actual patch function on a deep copy of the Chrome manifest —
    // this catches drift in either the Chrome-side source spelling or the
    // patch's internal string literals, which a pure source-regex test
    // would silently no-op through.
    const { patchManifestForFirefox } = require('../scripts/manifest-patch');
    const ffManifest = JSON.parse(JSON.stringify(manifest));
    patchManifestForFirefox(ffManifest);

    assert.equal(
        ffManifest.commands?.['toggle-control-center']?.suggested_key?.default,
        'Ctrl+Alt+Y',
        'Firefox-patched manifest must carry Ctrl+Alt+Y'
    );
    assert.notEqual(
        ffManifest.commands?.['toggle-control-center']?.suggested_key?.default,
        'Ctrl+Shift+Y',
        'Firefox-patched manifest must NOT retain the reserved Ctrl+Shift+Y default'
    );
    // The patch must also apply the Firefox-specific gecko + background
    // transformations — a regression that dropped those would silently
    // break Firefox at load time.
    assert.equal(ffManifest.browser_specific_settings?.gecko?.id, 'ytkit@sysadmindoc.github.io');
    assert.equal(ffManifest.browser_specific_settings?.gecko?.strict_min_version, '128.0');
    assert.ok(
        Array.isArray(ffManifest.background?.scripts) && ffManifest.background.scripts.length > 0,
        'Firefox background must be a scripts[] array, not a service_worker entry'
    );

    // Running the patch twice must stay idempotent — protects against a
    // re-run on an already-patched manifest (the guard on 'Ctrl+Shift+Y'
    // ensures the second pass is a no-op for the shortcut).
    patchManifestForFirefox(ffManifest);
    assert.equal(
        ffManifest.commands?.['toggle-control-center']?.suggested_key?.default,
        'Ctrl+Alt+Y',
        'Patch must be idempotent — a second application must not flip the shortcut back'
    );
});

test('SponsorBlock never auto-skips poi_highlight (API contract: marker, not skip)', () => {
    // Pass 8 closes the Pass 7 POI correctness finding. The SponsorBlock
    // API defines poi_highlight as a jump-to marker. Previously we skipped
    // past it like any other segment. Both the skip check and the
    // scheduler now exclude it explicitly, while the progress-bar render
    // still paints the marker.
    // Match method DEFINITIONS (leading whitespace + name, not call sites).
    const checkStart = ytkitSource.search(/\n\s+_checkSkip\(\)\s*\{/);
    assert.ok(checkStart > -1, '_checkSkip method definition must exist');
    const checkEnd = ytkitSource.indexOf('            },', checkStart);
    assert.ok(checkEnd > checkStart, '_checkSkip must have a closing brace');
    const checkBody = ytkitSource.slice(checkStart, checkEnd);
    assert.match(
        checkBody,
        /seg\.category\s*===\s*'poi_highlight'/,
        '_checkSkip must explicitly skip the poi_highlight category'
    );

    const schedStart = ytkitSource.search(/\n\s+_scheduleNextSkip\(\)\s*\{/);
    assert.ok(schedStart > -1, '_scheduleNextSkip method definition must exist');
    const schedEnd = ytkitSource.indexOf('            },', schedStart);
    assert.ok(schedEnd > schedStart, '_scheduleNextSkip must have a closing brace');
    const schedBody = ytkitSource.slice(schedStart, schedEnd);
    assert.match(
        schedBody,
        /seg\.category\s*===\s*'poi_highlight'/,
        '_scheduleNextSkip must also exclude poi_highlight so no skip timer fires for it'
    );
});

test('_run_download no longer contains the dead "Downloading video" regex match', () => {
    const downloaderSource = fs.readFileSync(
        path.join(__dirname, '..', 'astra_downloader', 'astra_downloader.py'),
        'utf8'
    );
    // The match target captured a group count but assigned it to `m` and
    // never read it. Removing the dead line keeps `_run_download` focused
    // on filename detection + progress parsing.
    assert.doesNotMatch(
        downloaderSource,
        /m\s*=\s*re\.search\(r'\\\[download\\\] Downloading video/,
        'Dead "Downloading video" regex must remain removed from _run_download'
    );
});

// ── v3.20.2 H1: TrustedTypes createPolicy fallback is observable ──
//
// Previously the catch block at ytkit.js:~640 swallowed createPolicy()
// failures silently, so peer-extension policy-name collisions were
// invisible in field diagnostics — the userscript fell back to DOMParser
// with no signal in the ring buffer. H1 routes the fallback reason through
// DiagnosticLog so users can surface it via the diagnostic dump if another
// extension squats the 'ytkit-policy' name.

test('TrustedTypes IIFE captures a fallbackReason for DiagnosticLog', () => {
    const iifeStart = ytkitSource.indexOf('const TrustedHTML = (() => {');
    assert.ok(iifeStart > -1, 'TrustedHTML IIFE must still exist');
    const iifeEnd = ytkitSource.indexOf('})();', iifeStart);
    assert.ok(iifeEnd > iifeStart, 'TrustedHTML IIFE must close');
    const iifeBody = ytkitSource.slice(iifeStart, iifeEnd);

    assert.match(
        iifeBody,
        /let\s+fallbackReason\s*=\s*null/,
        'IIFE must declare a fallbackReason variable to capture the failure mode'
    );
    assert.match(
        iifeBody,
        /let\s+fallbackLogged\s*=/,
        'IIFE must debounce logging with a fallbackLogged flag so it records once'
    );
    assert.match(
        iifeBody,
        /TT_UNAVAILABLE/,
        'Firefox / older-browser path must be tagged TT_UNAVAILABLE so field logs distinguish it from policy collisions'
    );
    assert.match(
        iifeBody,
        /TT_POLICY_FAIL/,
        'createPolicy throw path must be tagged TT_POLICY_FAIL so field logs can distinguish it from TT_UNAVAILABLE'
    );
});

test('TrustedTypes createPolicy catch redacts URLs before logging', () => {
    const iifeStart = ytkitSource.indexOf('const TrustedHTML = (() => {');
    const iifeEnd = ytkitSource.indexOf('})();', iifeStart);
    const iifeBody = ytkitSource.slice(iifeStart, iifeEnd);

    // The raw error message can contain the offending page URL. Redacting
    // before it lands in DiagnosticLog prevents page-URL leakage in
    // diagnostic dumps that users send to us.
    assert.match(
        iifeBody,
        /replace\(\s*\/https\?:\\\/\\\/\[\^\\s\)\]\+\/g/,
        'createPolicy catch must redact http(s)://… URLs from the logged message'
    );
});

test('TrustedTypes setHTML and create both trigger lazy fallback log', () => {
    const iifeStart = ytkitSource.indexOf('const TrustedHTML = (() => {');
    const iifeEnd = ytkitSource.indexOf('})();', iifeStart);
    const iifeBody = ytkitSource.slice(iifeStart, iifeEnd);

    // setHTML runs before appState.settings is guaranteed ready, so the
    // log call must be deferred into the first public-method invocation.
    // Both setHTML and create are public entry points; both must call
    // logFallbackOnce so whichever fires first surfaces the signal.
    const setHTMLStart = iifeBody.indexOf('setHTML(element, html)');
    const createStart = iifeBody.indexOf('create(html)');
    assert.ok(setHTMLStart > -1 && createStart > -1, 'Both public methods must exist');

    const setHTMLBody = iifeBody.slice(setHTMLStart, createStart);
    const createBody = iifeBody.slice(createStart);

    assert.match(setHTMLBody, /logFallbackOnce\(\)/,
        'setHTML must call logFallbackOnce so the first render records the signal');
    assert.match(createBody, /logFallbackOnce\(\)/,
        'create must call logFallbackOnce in case it fires before any setHTML call');
});

test('TrustedTypes fallback uses DOMParser + replaceChildren (no raw innerHTML clear)', () => {
    const iifeStart = ytkitSource.indexOf('const TrustedHTML = (() => {');
    const iifeEnd = ytkitSource.indexOf('})();', iifeStart);
    const iifeBody = ytkitSource.slice(iifeStart, iifeEnd);

    // The fallback path for non-TrustedTypes browsers (Firefox) must not
    // use `innerHTML = ''` even for clearing — that's still a TrustedHTML
    // sink on strict-CSP pages. replaceChildren() + DOMParser template
    // extraction is the correct pattern.
    assert.match(iifeBody, /new DOMParser\(\)/,
        'Fallback must parse via DOMParser to avoid innerHTML sink');
    assert.match(iifeBody, /element\.replaceChildren\(\);/,
        'Fallback must clear via replaceChildren, not innerHTML = ""');
    assert.doesNotMatch(iifeBody, /element\.innerHTML\s*=\s*['"]{2}/,
        'Fallback must NOT use innerHTML = "" to clear — trips strict-CSP TrustedHTML sinks');
});

// ── v3.20.2 H4: popup surfaces TrustedTypes diagnostic signal ──
//
// The signal written by H1 only has value if a user sees it. The popup
// gains a conditional "health banner" that reads ytSuiteSettings._errors,
// filters for ctx === 'trusted-types', and surfaces the latest event
// with a Copy-to-clipboard payload so users filing bug reports include
// the reason code instead of a vague "something broke."

test('popup.html carries a hidden health-banner scaffold', () => {
    assert.match(popupHtmlSource, /id="health-banner"[^>]*hidden/,
        'Health banner must be rendered hidden by default so the happy path is quiet');
    assert.match(popupHtmlSource, /id="health-detail"/,
        'Banner must expose a detail slot so popup.js can fill the message in');
    assert.match(popupHtmlSource, /id="health-copy-btn"/,
        'Banner must include a Copy button to dump the diagnostic payload to clipboard');
    assert.match(popupHtmlSource, /role="status"[^>]*aria-live="polite"/,
        'Banner must be an aria-live polite status region so screen readers announce it non-intrusively');
});

test('popup.js filters trusted-types diagnostics from _errors and renders a count', () => {
    // Pin the filter predicate so a rename of ctx ('trusted-types' is the
    // tag ytkit.js uses when logging) breaks the test immediately.
    assert.match(popupSource, /entry\.ctx\s*===\s*'trusted-types'/,
        'summarizeDiagnostics must filter _errors entries where ctx === "trusted-types"');
    // Pin the shape returned so renderHealthBanner can rely on it.
    assert.match(popupSource, /trustedTypes:\s*\{[\s\S]*?count:/,
        'Diagnostic summary must expose trustedTypes.count so the banner can show an event total');
    assert.match(popupSource, /latestMessage:/,
        'Diagnostic summary must include the latest message verbatim (already URL-redacted at capture site)');
});

test('popup.js health banner stays hidden when no trusted-types events exist', () => {
    // The render path takes either null (no diagnostics) OR an object
    // whose trustedTypes.count is zero and must keep the banner hidden.
    const renderStart = popupSource.indexOf('function renderHealthBanner');
    assert.ok(renderStart > -1, 'renderHealthBanner must exist');
    const renderEnd = popupSource.indexOf('\nif (healthCopyBtn)', renderStart);
    assert.ok(renderEnd > renderStart, 'renderHealthBanner must have an identifiable end boundary');
    const renderBody = popupSource.slice(renderStart, renderEnd);

    assert.match(renderBody, /healthBanner\.hidden\s*=\s*true/,
        'Null / zero-count path must hide the banner');
    assert.match(renderBody, /!tt\s*\|\|\s*tt\.count\s*<=\s*0/,
        'Null / zero-count guard must match the trustedTypes.count shape');
    assert.match(renderBody, /healthCopyPayload\s*=\s*['"]{2}/,
        'Null path must reset the copy payload so a stale payload never reaches the clipboard on a later click');
});

test('popup.css styles the health banner with a warning-toned palette and focus-visible outline', () => {
    const cssSource = fs.readFileSync(
        path.join(__dirname, '..', 'extension', 'popup.css'),
        'utf8'
    );
    assert.match(cssSource, /\.health-banner\s*\{/,
        'health-banner CSS rule must exist');
    assert.match(cssSource, /\.health-banner\[hidden\]\s*\{\s*display:\s*none/,
        'Banner must honor the [hidden] attribute (avoid grid-layout peek)');
    assert.match(cssSource, /\.health-copy-btn:focus-visible/,
        'Copy button must carry a focus-visible outline for keyboard users');
});

// ── v3.20.2 H5: storageQuotaLRU stale deArrowCache reference removed ──
//
// The prune loop iterated `appState.settings.deArrowCache`, but the actual
// DeArrow branding cache lives under the top-level storage key
// `da_branding_cache` (written via storageWriteJSON, not through settings).
// The entry was dead — it never matched a real cache, regardless of
// whether the DeArrow feature was running. H5 removes the stale entry
// and adds a belt-and-suspenders sweep on the real top-level key.

test('storageQuotaLRU._prune no longer references the dead deArrowCache key', () => {
    const pruneStart = ytkitSource.indexOf("id: 'storageQuotaLRU'");
    assert.ok(pruneStart > -1, 'storageQuotaLRU feature must still exist');
    const pruneEnd = ytkitSource.indexOf("this._timer = null;", pruneStart);
    assert.ok(pruneEnd > pruneStart, 'storageQuotaLRU must have a terminator');
    const pruneBlock = ytkitSource.slice(pruneStart, pruneEnd);

    assert.doesNotMatch(
        pruneBlock,
        /\['deArrowCache',/,
        "Dead 'deArrowCache' cap entry must be removed — DeArrow does not store under appState.settings.deArrowCache"
    );
    assert.match(
        pruneBlock,
        /storageReadJSON\(['"]da_branding_cache['"]/,
        "Prune must read da_branding_cache (the real DeArrow top-level storage key) via storageReadJSON"
    );
    assert.match(
        pruneBlock,
        /storageWriteJSON\(['"]da_branding_cache['"]/,
        "Prune must persist the trimmed da_branding_cache via storageWriteJSON"
    );
});

test('storageQuotaLRU description now names the real DeArrow cache key', () => {
    const pruneStart = ytkitSource.indexOf("id: 'storageQuotaLRU'");
    const pruneBlock = ytkitSource.slice(pruneStart, pruneStart + 500);
    // Pre-fix: description claimed to cover 'deArrowCache' (never existed).
    assert.doesNotMatch(pruneBlock, /description:\s*['"][^'"]*deArrowCache/,
        'Description must not reference the dead deArrowCache key');
    assert.match(pruneBlock, /description:\s*['"][^'"]*da_branding_cache/,
        'Description must name the real da_branding_cache top-level key so users can audit what the sweep actually touches');
});

// ── v3.20.3 H6: explicit cookie-jar wire contract via normalizeCookieExpiry ──
//
// Three sites previously inlined `expirationDate: c.expirationDate || 0`:
//   - extension/ytkit.js (MediaDL cookie mapper, ~line 2633)
//   - extension/background.js (EXT_COOKIE_LIST handler, ~line 620)
//   - YTKit.user.js (GM_cookie fallback, ~line 1851)
//
// The contract was implicit — null/undefined/negative/NaN/strings all
// happened to coerce to 0 because of JavaScript's truthiness rules. A
// future wire-format change (or a future Chrome cookies API that returns
// expirationDate as ISO string) could silently break that. Centralize as
// a named helper so the contract is explicit, parity across sites is
// testable, and the Python downloader's defensive parsing
// (test_astra_downloader.py:333+) has a documented JS counterpart.

function extractNormalizeFn(source, label) {
    const startIdx = source.indexOf('function normalizeCookieExpiry');
    assert.ok(startIdx > -1, `${label}: normalizeCookieExpiry must be defined`);
    // Find the matching closing brace (small function — ~5 lines).
    const openBrace = source.indexOf('{', startIdx);
    let depth = 1;
    let i = openBrace + 1;
    while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        i++;
    }
    const body = source.slice(startIdx, i);
    // eval is safe here — body is a vetted, repo-tracked function literal,
    // and the test runs in node:test sandboxes already.
    // eslint-disable-next-line no-new-func
    return new Function(body + '; return normalizeCookieExpiry;')();
}

test('normalizeCookieExpiry is defined identically in all three sites', () => {
    const userscriptSource = fs.readFileSync(
        path.join(__dirname, '..', 'YTKit.user.js'),
        'utf8'
    );

    const fnYtkit = extractNormalizeFn(ytkitSource, 'extension/ytkit.js');
    const fnBg = extractNormalizeFn(backgroundSource, 'extension/background.js');
    const fnUser = extractNormalizeFn(userscriptSource, 'YTKit.user.js');

    // Parity check: every input shape must produce the same output across
    // all three implementations. If a site drifts, this test trips.
    const cases = [
        ['undefined', undefined, 0],
        ['null', null, 0],
        ['empty string', '', 0],
        ['zero', 0, 0],
        ['negative int', -42, 0],
        ['negative float', -1.5, 0],
        ['positive int', 1700000000, 1700000000],
        ['positive float (preserved)', 1700000000.123, 1700000000.123],
        ['NaN', NaN, 0],
        ['Infinity', Infinity, 0],
        ['-Infinity', -Infinity, 0],
        ['bogus string', 'bogus', 0],
        ['numeric string', '1700000000', 1700000000],
        ['boolean true (Number(true)===1, treated as 1s past epoch — quirky but consistent)', true, 1],
        ['boolean false', false, 0],
    ];

    for (const [label, input, expected] of cases) {
        const a = fnYtkit(input);
        const b = fnBg(input);
        const c = fnUser(input);
        assert.equal(a, expected, `ytkit.js: ${label} must return ${expected}, got ${a}`);
        assert.equal(b, expected, `background.js: ${label} must return ${expected}, got ${b}`);
        assert.equal(c, expected, `YTKit.user.js: ${label} must return ${expected}, got ${c}`);
    }
});

test('normalizeCookieExpiry replaces every prior c.expirationDate || 0 site', () => {
    const userscriptSource = fs.readFileSync(
        path.join(__dirname, '..', 'YTKit.user.js'),
        'utf8'
    );

    // The legacy `c.expirationDate || 0` pattern must be gone everywhere
    // we ship. Catches the case where a future PR adds back a fourth
    // inlined site.
    for (const [label, src] of [
        ['extension/ytkit.js', ytkitSource],
        ['extension/background.js', backgroundSource],
        ['YTKit.user.js', userscriptSource],
    ]) {
        assert.doesNotMatch(
            src,
            /expirationDate:\s*c\.expirationDate\s*\|\|\s*0/,
            `${label} must use normalizeCookieExpiry instead of "c.expirationDate || 0"`
        );
        assert.match(
            src,
            /expirationDate:\s*normalizeCookieExpiry\(c\.expirationDate\)/,
            `${label} must call normalizeCookieExpiry on c.expirationDate at the cookie-mapper site`
        );
    }
});

// ── v1.0.7 H7: theater-split divider-drag mid-SPA-nav cleanup ──
//
// The divider-drag handler in theater-split.user.js attaches mousemove +
// mouseup to `window` and a position:fixed shield to document.body. The
// only cleanup path was the mouseup handler — but if a yt-navigate-finish
// fires between mousedown and mouseup, teardown() would remove the split
// wrapper while leaving the window listeners + dragShield orphaned. They
// would then fire closures over the disposed wrapper indefinitely.
//
// Fix: hoist drag handles to module-scope state (dragShield, dragOnMove,
// dragOnUp), provide an idempotent abortDividerDrag() helper, and call
// it from teardown() so SPA nav mid-drag cleans up the orphan listeners.

test('theater-split bumps to v1.0.7 with abortDividerDrag in teardown', () => {
    const tsSource = fs.readFileSync(
        path.join(__dirname, '..', 'theater-split.user.js'),
        'utf8'
    );
    assert.match(tsSource, /@version\s+1\.0\.7/, 'theater-split userscript must declare v1.0.7');
    assert.match(tsSource, /function abortDividerDrag\(\)/,
        'abortDividerDrag helper must be defined');
    // Module-scope state hoisted (was previously closure-local in initDividerDrag).
    assert.match(tsSource, /let dragShield\s*=\s*null/,
        'dragShield must be hoisted to module scope so teardown can reach it');
    assert.match(tsSource, /let dragOnMove\s*=\s*null/,
        'dragOnMove must be hoisted to module scope');
    assert.match(tsSource, /let dragOnUp\s*=\s*null/,
        'dragOnUp must be hoisted to module scope');
});

test('theater-split teardown calls abortDividerDrag to handle SPA-nav mid-drag', () => {
    const tsSource = fs.readFileSync(
        path.join(__dirname, '..', 'theater-split.user.js'),
        'utf8'
    );
    const teardownStart = tsSource.indexOf('function teardown()');
    assert.ok(teardownStart > -1, 'teardown function must exist');
    const teardownEnd = tsSource.indexOf('// ── Activate', teardownStart);
    assert.ok(teardownEnd > teardownStart, 'teardown must have a recognizable end');
    const teardownBody = tsSource.slice(teardownStart, teardownEnd);

    assert.match(teardownBody, /abortDividerDrag\(\)/,
        'teardown must call abortDividerDrag so a mid-drag SPA navigation does not orphan window listeners or the dragShield');
});

// ── v3.20.4 H9: EXT_FETCH controller.abort() consistency on size limits ──
//
// Five "responded = true" early-return paths in EXT_FETCH:
//   1. timeout → already aborted
//   2. redirect to non-allowlisted origin → already aborted
//   3. content-length declared > MAX_RESPONSE_BYTES → already aborted
//   4. streamed body exceeds limit while reading → reader.cancel() only,
//      no controller.abort() — fetch could keep reading until natural EOF
//   5. non-streaming body exceeds limit after measuring → no abort either
//
// (4) and (5) leak: we've already responded to the content script, but the
// SW continues to consume bandwidth and a socket for a response we will
// never use. v3.20.4 adds controller.abort() to both paths so all five
// early-returns are consistent.

test('EXT_FETCH aborts the controller on every size-limit early return path', () => {
    const fetchHandlerStart = backgroundSource.indexOf('const controller = new AbortController()');
    assert.ok(fetchHandlerStart > -1, 'EXT_FETCH AbortController must exist');
    const fetchHandlerEnd = backgroundSource.indexOf('return true; // keep sendResponse channel open', fetchHandlerStart);
    assert.ok(fetchHandlerEnd > fetchHandlerStart, 'EXT_FETCH handler must terminate');
    const handler = backgroundSource.slice(fetchHandlerStart, fetchHandlerEnd);

    // Count abort sites — should be at least 4 (timeout + redirect + content-length
    // + streamed-too-large + non-streaming-too-large = 5 total, but timeout fires
    // outside the success branch).
    const abortMatches = handler.match(/controller\.abort\(\)/g) || [];
    assert.ok(
        abortMatches.length >= 5,
        `Expected ≥5 controller.abort() call sites covering timeout + redirect + content-length + streamed-too-large + non-streaming-too-large; found ${abortMatches.length}`
    );

    // Pin the streamed-too-large block to require BOTH reader.cancel AND
    // controller.abort. reader.cancel alone closes the reader but doesn't
    // always tear down the network request.
    const streamErr = handler.indexOf('Response body too large');
    assert.ok(streamErr > -1, 'streamed too-large branch must exist');
    // Walk back from the error to find the opening of the if-block.
    const blockStart = handler.lastIndexOf('if (received > MAX_RESPONSE_BYTES)', streamErr);
    assert.ok(blockStart > -1, 'streamed too-large guard must exist');
    const blockBody = handler.slice(blockStart, streamErr + 200);
    assert.match(blockBody, /reader\.cancel\(\)/,
        'streamed too-large path must still call reader.cancel()');
    assert.match(blockBody, /controller\.abort\(\)/,
        'streamed too-large path must ALSO call controller.abort() so the SW socket is freed');

    // Pin the non-streaming too-large branch (text = await resp.text() path).
    const measuredBytesIdx = handler.indexOf('measuredBytes > MAX_RESPONSE_BYTES');
    assert.ok(measuredBytesIdx > -1, 'non-streaming too-large guard must exist');
    const nonStreamingBlock = handler.slice(measuredBytesIdx, measuredBytesIdx + 400);
    assert.match(nonStreamingBlock, /controller\.abort\(\)/,
        'non-streaming too-large path must call controller.abort() to free the SW + socket');
});

test('theater-split divider mousedown clears any pre-existing drag state defensively', () => {
    const tsSource = fs.readFileSync(
        path.join(__dirname, '..', 'theater-split.user.js'),
        'utf8'
    );
    const initStart = tsSource.indexOf('function initDividerDrag');
    assert.ok(initStart > -1, 'initDividerDrag must exist');
    // mousedown handler must clear any orphan drag before starting a new one.
    const mdStart = tsSource.indexOf("'mousedown'", initStart);
    const fnEnd = tsSource.indexOf('function ', mdStart + 1);
    const handlerBody = tsSource.slice(mdStart, fnEnd);
    assert.match(handlerBody, /abortDividerDrag\(\)/,
        'mousedown must defensively call abortDividerDrag before starting a new drag, so re-entrancy or orphans cannot stack listeners');
});

test('normalizeCookieExpiry produces wire-compatible output with the Python downloader', () => {
    // The Python downloader at astra_downloader/astra_downloader.py:830-838
    // parses raw_expiry as `int(float(x)) if x not in (None, "") else 0`,
    // clamping negatives to 0. The JS helper must produce values that
    // survive that round-trip identically. Test the boundary cases:
    //   - JS sends 0 → Python gets 0 → wire emits "0" (session marker)
    //   - JS sends positive double → Python truncates to int, same int
    //   - JS sends 0 for any non-positive-finite-number → Python sees 0
    const fn = extractNormalizeFn(ytkitSource, 'extension/ytkit.js');
    // Mimic Python's `int(float(x))` truncation:
    const pythonRoundTrip = (jsOutput) => Math.trunc(Number(jsOutput));

    assert.equal(pythonRoundTrip(fn(undefined)), 0);
    assert.equal(pythonRoundTrip(fn(null)), 0);
    assert.equal(pythonRoundTrip(fn(-1)), 0);
    assert.equal(pythonRoundTrip(fn(1700000000)), 1700000000);
    assert.equal(pythonRoundTrip(fn(1700000000.999)), 1700000000);  // Python truncates
});
