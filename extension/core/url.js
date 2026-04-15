(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.getVideoId) return;

    const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
    const VIDEO_ID_PATH_PREFIXES = Object.freeze([
        '/shorts/',
        '/embed/',
        '/live/'
    ]);

    let cachedVideoId = null;
    let cachedHref = '';
    let cachedSearchHref = '';
    let cachedSearchParams = null;

    function getUrlSearchParams() {
        const href = window.location.href;
        if (href !== cachedSearchHref) {
            cachedSearchHref = href;
            cachedSearchParams = new URLSearchParams(window.location.search);
        }
        return cachedSearchParams;
    }

    function getUrlParam(name) {
        return getUrlSearchParams().get(name);
    }

    function isValidVideoId(value) {
        return typeof value === 'string' && VIDEO_ID_PATTERN.test(value);
    }

    function parseUrl(urlValue = window.location.href) {
        if (urlValue instanceof URL) return urlValue;
        const href = typeof urlValue === 'string' && urlValue ? urlValue : window.location.href;
        try {
            return new URL(href, window.location.origin);
        } catch {
            return null;
        }
    }

    function extractVideoIdFromPath(pathname = '') {
        if (typeof pathname !== 'string') return null;
        for (const prefix of VIDEO_ID_PATH_PREFIXES) {
            if (!pathname.startsWith(prefix)) continue;
            const candidate = pathname.slice(prefix.length).split(/[/?#]/, 1)[0];
            return isValidVideoId(candidate) ? candidate : null;
        }
        return null;
    }

    function extractVideoIdFromUrl(urlValue = window.location.href) {
        const url = parseUrl(urlValue);
        if (!url) return null;

        const queryVideoId = url.searchParams.get('v');
        if (isValidVideoId(queryVideoId)) return queryVideoId;

        return extractVideoIdFromPath(url.pathname);
    }

    function getVideoId(urlValue = window.location.href) {
        const url = parseUrl(urlValue);
        const href = url?.href || window.location.href;
        if (href === cachedHref) return cachedVideoId;
        cachedHref = href;
        cachedVideoId = extractVideoIdFromUrl(url || href);
        return cachedVideoId;
    }

    Object.assign(core, {
        extractVideoIdFromUrl,
        getUrlParam,
        getUrlSearchParams,
        getVideoId
    });
})();
