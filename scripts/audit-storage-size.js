#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

const STORAGE_KEYS = Object.freeze({
    settings: 'ytSuiteSettings',
    hiddenVideos: 'ytkit-hidden-videos',
    blockedChannels: 'ytkit-blocked-channels',
    bookmarks: 'ytkit-bookmarks',
    watchProgress: 'ytkit-watch-progress',
    channelSpeeds: 'ytkit-channel-speeds',
    watchTime: 'ytkit-watch-time',
    resumePositions: 'ytkit_resume_positions',
    deArrowCache: 'da_branding_cache',
    sponsorBlockCache: 'sb_segments_cache',
    stats: 'ytkit_stats',
    crashCounts: 'ytkit_crash_counts',
    firstRun: 'ytSuiteHasRun',
    debug: 'ytkit_debug',
    safeMode: 'ytkit_safe_mode',
    mediadlPromptDismissed: 'ytkit_mediadl_prompt_dismissed'
});

const SYNC_QUOTA = Object.freeze({
    totalBytes: 102400,
    bytesPerItem: 8192,
    maxItems: 512
});

const LOCAL_QUOTA = Object.freeze({
    totalBytes: 10485760
});

const FIXED_NOW = Date.UTC(2026, 3, 26, 12, 0, 0);

function utf8Bytes(value) {
    return Buffer.byteLength(String(value), 'utf8');
}

function jsonBytes(value) {
    return utf8Bytes(JSON.stringify(value));
}

function storageItemBytes(key, value) {
    return utf8Bytes(key) + jsonBytes(value);
}

function measurePayload(payload) {
    const items = Object.entries(payload).map(([key, value]) => ({
        key,
        bytes: storageItemBytes(key, value)
    })).sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));

    const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const largestItem = items[0] || { key: null, bytes: 0 };
    const overSyncItemLimit = items.filter((item) => item.bytes > SYNC_QUOTA.bytesPerItem);
    return {
        totalBytes,
        itemCount: items.length,
        largestItem,
        overSyncItemLimit,
        items
    };
}

function assessSyncEligibility(payload) {
    const measured = measurePayload(payload);
    const totalOk = measured.totalBytes <= SYNC_QUOTA.totalBytes;
    const perItemOk = measured.overSyncItemLimit.length === 0;
    const itemCountOk = measured.itemCount <= SYNC_QUOTA.maxItems;
    return {
        ...measured,
        totalOk,
        perItemOk,
        itemCountOk,
        ok: totalOk && perItemOk && itemCountOk
    };
}

function loadCurrentSettings(repoRoot = REPO_ROOT) {
    const defaultsPath = path.join(repoRoot, 'extension', 'default-settings.json');
    const metaPath = path.join(repoRoot, 'extension', 'settings-meta.json');
    const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return {
        ...defaults,
        _settingsVersion: meta.settingsVersion
    };
}

function makeVideoId(index) {
    return `v${String(index).padStart(10, '0')}`;
}

function makeChannelId(index) {
    return `UC${String(index).padStart(22, '0')}`;
}

function makeHiddenVideos(count) {
    return Array.from({ length: count }, (_, index) => makeVideoId(index));
}

function makeBlockedChannels(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: makeChannelId(index),
        name: `Channel ${String(index + 1).padStart(4, '0')}`
    }));
}

function makeBookmarks(videoCount, bookmarksPerVideo) {
    const bookmarks = {};
    for (let videoIndex = 0; videoIndex < videoCount; videoIndex++) {
        bookmarks[makeVideoId(videoIndex)] = Array.from({ length: bookmarksPerVideo }, (_, bookmarkIndex) => ({
            t: 45 + bookmarkIndex * 180,
            n: `Reference note ${videoIndex + 1}-${bookmarkIndex + 1}`,
            d: FIXED_NOW - (videoIndex * bookmarksPerVideo + bookmarkIndex) * 60000
        }));
    }
    return bookmarks;
}

function makeWatchProgress(count) {
    const progress = {};
    for (let index = 0; index < count; index++) {
        progress[makeVideoId(index)] = {
            position: 120 + index * 7,
            duration: 1800 + (index % 12) * 60,
            updatedAt: FIXED_NOW - index * 300000
        };
    }
    return progress;
}

function makeResumePositions(count) {
    const positions = {};
    for (let index = 0; index < count; index++) {
        positions[makeVideoId(index)] = {
            t: 90 + index * 11,
            d: 1200 + (index % 10) * 90,
            ts: FIXED_NOW - index * 240000
        };
    }
    return positions;
}

function makeChannelSpeeds(count) {
    const speeds = {};
    for (let index = 0; index < count; index++) {
        speeds[`@channel-${String(index + 1).padStart(3, '0')}`] = 1 + ((index % 5) * 0.1);
    }
    return speeds;
}

function makeWatchTime(dayCount) {
    const days = {};
    for (let index = 0; index < dayCount; index++) {
        const day = new Date(FIXED_NOW - index * 86400000).toISOString().slice(0, 10);
        days[day] = 900 + (index % 12) * 60;
    }
    return {
        days,
        total: Object.values(days).reduce((sum, value) => sum + value, 0)
    };
}

function makeDeArrowCache(count) {
    const cache = {};
    for (let index = 0; index < count; index++) {
        cache[makeVideoId(index)] = {
            title: `Human title ${String(index + 1).padStart(4, '0')}`,
            originalTitle: `Original clickbait title ${String(index + 1).padStart(4, '0')}`,
            thumbnail: {
                timestamp: 12 + (index % 90),
                original: false
            },
            _ts: FIXED_NOW - index * 180000
        };
    }
    return cache;
}

function makeSponsorBlockCache(count, segmentsPerVideo) {
    const categories = ['sponsor', 'intro', 'outro', 'selfpromo'];
    const cache = {};
    for (let videoIndex = 0; videoIndex < count; videoIndex++) {
        cache[makeVideoId(videoIndex)] = {
            ts: FIXED_NOW - videoIndex * 240000,
            categoryKey: categories.join(','),
            segments: Array.from({ length: segmentsPerVideo }, (_, segmentIndex) => ({
                segment: [30 + segmentIndex * 220, 75 + segmentIndex * 220],
                category: categories[(videoIndex + segmentIndex) % categories.length],
                actionType: 'skip',
                UUID: `segment-${videoIndex}-${segmentIndex}`,
                videoDuration: 1800
            }))
        };
    }
    return cache;
}

function makeStats() {
    return {
        downloadsStarted: 8,
        screenshotsCaptured: 4,
        transcriptsOpened: 6,
        settingsExports: 2,
        lastUpdated: FIXED_NOW
    };
}

function buildUiPreferencesPayload(repoRoot = REPO_ROOT) {
    return {
        [STORAGE_KEYS.settings]: loadCurrentSettings(repoRoot)
    };
}

function buildTypicalLocalPayload(repoRoot = REPO_ROOT) {
    return {
        ...buildUiPreferencesPayload(repoRoot),
        [STORAGE_KEYS.firstRun]: true,
        [STORAGE_KEYS.debug]: false,
        [STORAGE_KEYS.safeMode]: false,
        [STORAGE_KEYS.mediadlPromptDismissed]: false,
        [STORAGE_KEYS.hiddenVideos]: makeHiddenVideos(250),
        [STORAGE_KEYS.blockedChannels]: makeBlockedChannels(80),
        [STORAGE_KEYS.bookmarks]: makeBookmarks(60, 3),
        [STORAGE_KEYS.watchProgress]: makeWatchProgress(250),
        [STORAGE_KEYS.resumePositions]: makeResumePositions(250),
        [STORAGE_KEYS.channelSpeeds]: makeChannelSpeeds(60),
        [STORAGE_KEYS.watchTime]: makeWatchTime(90),
        [STORAGE_KEYS.deArrowCache]: makeDeArrowCache(400),
        [STORAGE_KEYS.sponsorBlockCache]: makeSponsorBlockCache(120, 3),
        [STORAGE_KEYS.stats]: makeStats(),
        [STORAGE_KEYS.crashCounts]: {}
    };
}

function buildCapStressPayload(repoRoot = REPO_ROOT) {
    return {
        ...buildUiPreferencesPayload(repoRoot),
        [STORAGE_KEYS.hiddenVideos]: makeHiddenVideos(5000),
        [STORAGE_KEYS.blockedChannels]: makeBlockedChannels(2000),
        [STORAGE_KEYS.bookmarks]: makeBookmarks(400, 100),
        [STORAGE_KEYS.watchProgress]: makeWatchProgress(500),
        [STORAGE_KEYS.resumePositions]: makeResumePositions(500),
        [STORAGE_KEYS.channelSpeeds]: makeChannelSpeeds(500),
        [STORAGE_KEYS.watchTime]: makeWatchTime(90),
        [STORAGE_KEYS.deArrowCache]: makeDeArrowCache(2000),
        [STORAGE_KEYS.sponsorBlockCache]: makeSponsorBlockCache(500, 5),
        [STORAGE_KEYS.stats]: makeStats(),
        [STORAGE_KEYS.crashCounts]: {}
    };
}

function buildAuditPayloads(repoRoot = REPO_ROOT) {
    return {
        uiPreferences: buildUiPreferencesPayload(repoRoot),
        typicalLocal: buildTypicalLocalPayload(repoRoot),
        capStressLocal: buildCapStressPayload(repoRoot)
    };
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAssessment(name, payload) {
    const assessment = assessSyncEligibility(payload);
    const syncStatus = assessment.ok ? 'PASS' : 'FAIL';
    const overItemText = assessment.overSyncItemLimit.length
        ? `; over item limit: ${assessment.overSyncItemLimit.map((item) => `${item.key}=${formatBytes(item.bytes)}`).join(', ')}`
        : '';
    return [
        `${name}: ${formatBytes(assessment.totalBytes)} across ${assessment.itemCount} items`,
        `  largest: ${assessment.largestItem.key || '(none)'}=${formatBytes(assessment.largestItem.bytes)}`,
        `  storage.sync: ${syncStatus} (total ${assessment.totalBytes}/${SYNC_QUOTA.totalBytes}; largest ${assessment.largestItem.bytes}/${SYNC_QUOTA.bytesPerItem}; items ${assessment.itemCount}/${SYNC_QUOTA.maxItems})${overItemText}`
    ].join('\n');
}

function formatReport(payloads) {
    const sections = ['Astra Deck storage size audit'];
    for (const [name, payload] of Object.entries(payloads)) {
        sections.push(formatAssessment(name, payload));
    }
    const ui = assessSyncEligibility(payloads.uiPreferences);
    const typical = assessSyncEligibility(payloads.typicalLocal);
    sections.push([
        'Decision:',
        `  UI preferences sync candidate: ${ui.ok ? 'viable' : 'not viable'} (${formatBytes(ui.totalBytes)}, largest ${formatBytes(ui.largestItem.bytes)}).`,
        `  Whole chrome.storage.local payload: ${typical.ok ? 'viable' : 'not viable'} for sync (${formatBytes(typical.totalBytes)}, largest ${formatBytes(typical.largestItem.bytes)}).`,
        '  Keep histories, caches, diagnostics, watch progress, and downloaded-state data local-only.'
    ].join('\n'));
    return sections.join('\n\n');
}

function readPayloadFile(filePath) {
    const absolutePath = path.resolve(filePath);
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
    const fileFlagIndex = argv.indexOf('--file');
    if (fileFlagIndex >= 0) {
        const filePath = argv[fileFlagIndex + 1];
        if (!filePath) throw new Error('--file requires a JSON file path');
        console.log(formatReport({ filePayload: readPayloadFile(filePath) }));
        return;
    }
    console.log(formatReport(buildAuditPayloads()));
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`[audit-storage-size] ${error.message}`);
        process.exit(1);
    }
}

module.exports = {
    LOCAL_QUOTA,
    STORAGE_KEYS,
    SYNC_QUOTA,
    assessSyncEligibility,
    buildAuditPayloads,
    buildCapStressPayload,
    buildTypicalLocalPayload,
    buildUiPreferencesPayload,
    formatBytes,
    formatReport,
    jsonBytes,
    measurePayload,
    storageItemBytes,
    utf8Bytes
};
