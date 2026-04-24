'use strict';

// v3.20.0: Extracted from build-extension.js so tests can assert the
// exact Firefox-side manifest delta without spawning a real build.
// Side-effect-free module — safe to `require()` from tests.

// Mutates and returns `ffManifest`. Caller is responsible for writing
// the result back to disk.
function patchManifestForFirefox(ffManifest) {
    ffManifest.browser_specific_settings = {
        gecko: {
            id: 'ytkit@sysadmindoc.github.io',
            strict_min_version: '128.0'
        }
    };

    if (ffManifest.background && ffManifest.background.service_worker) {
        const worker = ffManifest.background.service_worker;
        ffManifest.background = { scripts: [worker] };
    }

    // Firefox reserves Ctrl+Shift+Y for "Show Downloads". Rebind the
    // toggle to Ctrl+Alt+Y on Firefox only. Users can still remap via
    // about:addons -> Manage Extension Shortcuts.
    if (ffManifest.commands?.['toggle-control-center']?.suggested_key?.default === 'Ctrl+Shift+Y') {
        ffManifest.commands['toggle-control-center'].suggested_key.default = 'Ctrl+Alt+Y';
    }

    return ffManifest;
}

module.exports = { patchManifestForFirefox };
