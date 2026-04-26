(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.getMainVideoElement) return;

    function getMoviePlayerElement(root = document) {
        if (!root) return null;
        if (typeof root.getElementById === 'function') {
            const byId = root.getElementById('movie_player');
            if (byId) return byId;
        }
        return root.querySelector?.('#movie_player') || null;
    }

    function getMainVideoElement(root = document) {
        if (!root?.querySelector) return null;
        return root.querySelector('video.html5-main-video')
            || root.querySelector('#movie_player video')
            || null;
    }

    function getPlayerProgressBar(root = document) {
        if (!root?.querySelector) return null;
        const paddedBar = root.querySelector('.ytp-progress-bar-padding .ytp-progress-bar');
        return paddedBar || root.querySelector('.ytp-progress-bar') || null;
    }

    Object.assign(core, {
        getMainVideoElement,
        getMoviePlayerElement,
        getPlayerProgressBar
    });
})();
