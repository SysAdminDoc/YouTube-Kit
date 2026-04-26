#!/usr/bin/env node
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const { resolveUserscriptPath } = require('./repo-paths');

const repoRoot = path.join(__dirname, '..');
const filesToCheck = [
    'build-extension.js',
    'sync-userscript.js',
    'extension/background.js',
    'extension/popup.js',
    'extension/ytkit.js',
    'extension/ytkit-main.js',
    'extension/core/env.js',
    'extension/core/navigation.js',
    'extension/core/page.js',
    'extension/core/player.js',
    'extension/core/storage.js',
    'extension/core/styles.js',
    'extension/core/url.js',
    'scripts/audit-storage-size.js',
    'scripts/catalog-utils.js',
    'scripts/check-syntax.js',
    'scripts/repo-paths.js'
].map((relativePath) => path.join(repoRoot, relativePath));

filesToCheck.push(resolveUserscriptPath(repoRoot));

for (const filePath of filesToCheck) {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
}
