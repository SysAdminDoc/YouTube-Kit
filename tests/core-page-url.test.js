'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const pageSource = fs.readFileSync(path.join(repoRoot, 'extension', 'core', 'page.js'), 'utf8');
const urlSource = fs.readFileSync(path.join(repoRoot, 'extension', 'core', 'url.js'), 'utf8');

function loadCoreAtUrl(href) {
    const parsed = new URL(href);
    const location = {
        href: parsed.href,
        origin: parsed.origin,
        pathname: parsed.pathname,
        search: parsed.search
    };
    const context = {
        URL,
        URLSearchParams,
        globalThis: null,
        location,
        window: { location }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(pageSource, context, { filename: 'extension/core/page.js' });
    vm.runInContext(urlSource, context, { filename: 'extension/core/url.js' });
    return context.globalThis.YTKitCore;
}

test('core page helpers classify library and playlist routes correctly', () => {
    const core = loadCoreAtUrl('https://www.youtube.com/feed/you');
    assert.equal(core.getCurrentPage('/feed/you'), core.PageTypes.LIBRARY);
    assert.equal(core.getCurrentPage('/playlist'), core.PageTypes.PLAYLIST);
    assert.equal(core.getCurrentPage('/watch'), core.PageTypes.WATCH);
});

test('core video id helper supports watch query routes', () => {
    const core = loadCoreAtUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(core.getVideoId(), 'dQw4w9WgXcQ');
    assert.equal(core.extractVideoIdFromUrl('https://www.youtube.com/watch?v=9bZkp7q19f0&list=PL123'), '9bZkp7q19f0');
});

test('core video id helper supports shorts, live, and embed routes', () => {
    const core = loadCoreAtUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(core.getVideoId(), 'dQw4w9WgXcQ');
    assert.equal(core.extractVideoIdFromUrl('https://www.youtube.com/live/9bZkp7q19f0'), '9bZkp7q19f0');
    assert.equal(core.extractVideoIdFromUrl('https://www.youtube.com/embed/M7lc1UVf-VE?start=30'), 'M7lc1UVf-VE');
});

test('core video id helper rejects invalid path segments and invalid urls', () => {
    const core = loadCoreAtUrl('https://www.youtube.com/shorts/not-a-real-video-id');
    assert.equal(core.getVideoId(), null);
    assert.equal(core.extractVideoIdFromUrl('https://www.youtube.com/embed/not-real'), null);
    assert.equal(core.extractVideoIdFromUrl('not a valid url'), null);
});
