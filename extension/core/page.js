(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.PageTypes) return;

    const PageTypes = Object.freeze({
        HOME: 'home',
        WATCH: 'watch',
        SEARCH: 'search',
        CHANNEL: 'channel',
        SUBSCRIPTIONS: 'subscriptions',
        PLAYLIST: 'playlist',
        SHORTS: 'shorts',
        HISTORY: 'history',
        LIBRARY: 'library',
        OTHER: 'other'
    });

    function normalizePath(path = window.location.pathname) {
        if (typeof path !== 'string') return '/';
        return path || '/';
    }

    function isWatchPagePath(path = window.location.pathname) {
        return normalizePath(path).startsWith('/watch');
    }

    function isSearchPagePath(path = window.location.pathname) {
        return normalizePath(path).startsWith('/results');
    }

    function isShortsPagePath(path = window.location.pathname) {
        return normalizePath(path).startsWith('/shorts');
    }

    function isChannelPagePath(path = window.location.pathname) {
        const currentPath = normalizePath(path);
        return currentPath.startsWith('/@')
            || currentPath.startsWith('/channel')
            || currentPath.startsWith('/c/')
            || currentPath.startsWith('/user/');
    }

    function getCurrentPage(path = window.location.pathname) {
        const currentPath = normalizePath(path);
        if (currentPath === '/' || currentPath === '/feed/trending') return PageTypes.HOME;
        if (isWatchPagePath(currentPath)) return PageTypes.WATCH;
        if (isSearchPagePath(currentPath)) return PageTypes.SEARCH;
        if (isShortsPagePath(currentPath)) return PageTypes.SHORTS;
        if (currentPath.startsWith('/feed/subscriptions')) return PageTypes.SUBSCRIPTIONS;
        if (currentPath.startsWith('/feed/history')) return PageTypes.HISTORY;
        if (currentPath.startsWith('/feed/library') || currentPath.startsWith('/feed/you')) return PageTypes.LIBRARY;
        if (currentPath.startsWith('/playlist')) return PageTypes.PLAYLIST;
        if (isChannelPagePath(currentPath)) return PageTypes.CHANNEL;
        return PageTypes.OTHER;
    }

    Object.assign(core, {
        PageTypes,
        getCurrentPage,
        isChannelPagePath,
        isSearchPagePath,
        isShortsPagePath,
        isWatchPagePath
    });
})();
