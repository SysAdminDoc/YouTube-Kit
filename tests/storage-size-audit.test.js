'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STORAGE_KEYS,
    SYNC_QUOTA,
    assessSyncEligibility,
    buildAuditPayloads,
    formatReport,
    storageItemBytes
} = require('../scripts/audit-storage-size');

test('storage size audit uses Chrome sync byte accounting', () => {
    const value = { check: '✓', nested: ['Astra', 42] };
    const expected = Buffer.byteLength('sampleKey', 'utf8')
        + Buffer.byteLength(JSON.stringify(value), 'utf8');
    assert.equal(storageItemBytes('sampleKey', value), expected);
});

test('UI preferences payload fits current storage.sync quotas', () => {
    const { uiPreferences } = buildAuditPayloads();
    const assessment = assessSyncEligibility(uiPreferences);

    assert.equal(assessment.totalBytes, 7334);
    assert.equal(assessment.itemCount, 1);
    assert.equal(assessment.largestItem.key, STORAGE_KEYS.settings);
    assert.equal(assessment.largestItem.bytes, 7334);
    assert.ok(assessment.totalBytes < SYNC_QUOTA.totalBytes);
    assert.ok(assessment.largestItem.bytes < SYNC_QUOTA.bytesPerItem);
    assert.equal(assessment.ok, true);
});

test('typical local payload is not storage.sync eligible', () => {
    const { typicalLocal } = buildAuditPayloads();
    const assessment = assessSyncEligibility(typicalLocal);

    assert.equal(assessment.totalBytes, 172461);
    assert.equal(assessment.ok, false);
    assert.equal(assessment.totalOk, false);
    assert.equal(assessment.perItemOk, false);
    assert.deepEqual(
        assessment.overSyncItemLimit.map((item) => item.key),
        [
            STORAGE_KEYS.deArrowCache,
            STORAGE_KEYS.sponsorBlockCache,
            STORAGE_KEYS.watchProgress,
            STORAGE_KEYS.resumePositions,
            STORAGE_KEYS.bookmarks
        ]
    );
});

test('storage audit report records the sync decision', () => {
    const report = formatReport(buildAuditPayloads());

    assert.match(report, /UI preferences sync candidate: viable \(7\.2 KB/);
    assert.match(report, /Whole chrome\.storage\.local payload: not viable for sync \(168\.4 KB/);
    assert.match(report, /Keep histories, caches, diagnostics, watch progress, and downloaded-state data local-only/);
});
