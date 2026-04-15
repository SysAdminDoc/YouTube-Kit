'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    extractDefaultsFromSource,
    extractSettingsVersionFromSource
} = require('../scripts/catalog-utils');

const repoRoot = path.join(__dirname, '..');
const ytkitSource = fs.readFileSync(path.join(repoRoot, 'extension', 'ytkit.js'), 'utf8');
const defaultSettings = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension', 'default-settings.json'), 'utf8'));
const settingsMeta = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension', 'settings-meta.json'), 'utf8'));

test('default settings catalog stays in sync with ytkit.js defaults', () => {
    const extractedDefaults = extractDefaultsFromSource(ytkitSource);
    assert.deepStrictEqual(defaultSettings, extractedDefaults);
});

test('settings metadata stays in sync with ytkit.js settings version', () => {
    const extractedVersion = extractSettingsVersionFromSource(ytkitSource);
    assert.equal(settingsMeta.settingsVersion, extractedVersion);
    assert.ok(Number.isInteger(settingsMeta.settingsVersion));
    assert.ok(settingsMeta.settingsVersion > 0);
});
