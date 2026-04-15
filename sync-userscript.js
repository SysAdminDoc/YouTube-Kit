#!/usr/bin/env node
'use strict';

const fs = require('fs');

const EXTENSION_SOURCE = 'extension/ytkit.js';
const USERSCRIPT_SOURCE = 'ytkit.user.js';

const extensionText = fs.readFileSync(EXTENSION_SOURCE, 'utf8');
const versionMatch = extensionText.match(/const YTKIT_VERSION = '([^']+)'/);
if (!versionMatch) {
    console.error('Could not find YTKIT_VERSION in extension/ytkit.js');
    process.exit(1);
}

const targetVersion = versionMatch[1];
let userscriptText = fs.readFileSync(USERSCRIPT_SOURCE, 'utf8');
const before = userscriptText;

userscriptText = userscriptText.replace(/^(\/\/ @name\s+)YTKit v[\d.]+/m, `$1YTKit v${targetVersion}`);
userscriptText = userscriptText.replace(/^(\/\/ @version\s+)[\d.]+/m, `$1${targetVersion}`);
userscriptText = userscriptText.replace(/const YTKIT_VERSION = '[^']+';/, `const YTKIT_VERSION = '${targetVersion}';`);

if (userscriptText === before) {
    console.log(`Userscript already aligned to v${targetVersion}`);
    process.exit(0);
}

fs.writeFileSync(USERSCRIPT_SOURCE, userscriptText, 'utf8');
console.log(`Userscript metadata synced to v${targetVersion}`);
