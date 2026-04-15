(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.addNavigateRule) return;
    const isWatchPagePath = core.isWatchPagePath || ((path = window.location.pathname) => String(path).startsWith('/watch'));

    const runtime = {
        navDebounce: 50,
        elementTimeout: 3000
    };

    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;
    let watchFlexyObserver = null;
    let watchFlexyObservedNode = null;
    let navigateDebounceTimer = null;
    let mutationScheduled = false;

    function configureNavigationRuntime(options = {}) {
        if (Number.isFinite(options.navDebounce)) {
            runtime.navDebounce = Math.max(0, options.navDebounce);
        }
        if (Number.isFinite(options.elementTimeout)) {
            runtime.elementTimeout = Math.max(0, options.elementTimeout);
        }
    }

    function waitForElement(selector, callback, timeout = runtime.elementTimeout) {
        if (!selector || typeof callback !== 'function') return;
        const existing = document.querySelector(selector);
        if (existing) {
            callback(existing);
            return;
        }

        let fired = false;
        const observer = new MutationObserver((mutations) => {
            if (fired) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.(selector)) {
                        fired = true;
                        observer.disconnect();
                        callback(node);
                        return;
                    }
                }
            }

            const matched = document.querySelector(selector);
            if (matched) {
                fired = true;
                observer.disconnect();
                callback(matched);
            }
        });

        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
            if (!fired) observer.disconnect();
        }, timeout);
    }

    function waitForPageContent(callback, fallbackSelector = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer') {
        if (typeof callback !== 'function') return;
        let fired = false;
        const fire = () => {
            if (fired) return;
            fired = true;
            callback();
        };

        document.addEventListener('yt-page-data-updated', fire, { once: true });
        waitForElement(fallbackSelector, fire);
        setTimeout(fire, 3000);
    }

    function getIsWatchPage() {
        return isWatchPagePath(window.location.pathname);
    }

    function disconnectWatchFlexyObserver() {
        watchFlexyObserver?.disconnect();
        watchFlexyObserver = null;
        watchFlexyObservedNode = null;
    }

    function ensureWatchFlexyObserver() {
        const watchFlexy = document.querySelector('ytd-watch-flexy');
        if (!watchFlexy) {
            if (watchFlexyObservedNode && !document.contains(watchFlexyObservedNode)) {
                disconnectWatchFlexyObserver();
            }
            return;
        }

        if (watchFlexyObservedNode === watchFlexy && watchFlexyObserver) return;

        disconnectWatchFlexyObserver();
        watchFlexyObservedNode = watchFlexy;
        watchFlexyObserver = new MutationObserver(() => debouncedRunNavigateRules());
        watchFlexyObserver.observe(watchFlexy, {
            attributes: true,
            attributeFilter: ['video-id']
        });
    }

    function runNavigateRules() {
        const isWatch = getIsWatchPage();
        ensureWatchFlexyObserver();
        for (const rule of navigateRules.values()) {
            try {
                rule(document.body, isWatch);
            } catch (error) {
                console.error('[YTKit] Navigate rule error:', error);
            }
        }
    }

    function debouncedRunNavigateRules() {
        if (navigateDebounceTimer) clearTimeout(navigateDebounceTimer);
        navigateDebounceTimer = setTimeout(runNavigateRules, runtime.navDebounce);
    }

    function ensureNavigateListener() {
        if (isNavigateListenerAttached) return;

        document.addEventListener('yt-navigate-finish', debouncedRunNavigateRules);
        document.addEventListener('yt-page-data-updated', debouncedRunNavigateRules);
        window.addEventListener('popstate', debouncedRunNavigateRules);

        ensureWatchFlexyObserver();
        runNavigateRules();
        isNavigateListenerAttached = true;
    }

    function addNavigateRule(id, ruleFn) {
        if (!id || typeof ruleFn !== 'function') return;
        ensureNavigateListener();
        navigateRules.set(id, ruleFn);
        try {
            ruleFn(document.body, getIsWatchPage());
        } catch (error) {
            console.error('[YTKit] Navigate rule error:', error);
        }
    }

    function removeNavigateRule(id) {
        navigateRules.delete(id);
        if (navigateRules.size === 0 && navigateDebounceTimer) {
            clearTimeout(navigateDebounceTimer);
            navigateDebounceTimer = null;
        }
    }

    function runMutationRules(targetNode) {
        for (const rule of mutationRules.values()) {
            try {
                rule(targetNode);
            } catch (error) {
                console.error('[YTKit] Mutation rule error:', error);
            }
        }
    }

    function observerCallback() {
        if (mutationScheduled) return;
        mutationScheduled = true;
        requestAnimationFrame(() => {
            mutationScheduled = false;
            runMutationRules(document.body);
        });
    }

    function startObserver() {
        if (mutationObserver) return;
        mutationObserver = new MutationObserver(observerCallback);
        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['theater', 'fullscreen', 'hidden', 'video-id', 'page-subtype']
        });
    }

    function stopObserver() {
        if (!mutationObserver) return;
        mutationObserver.disconnect();
        mutationObserver = null;
    }

    function addMutationRule(id, ruleFn) {
        if (!id || typeof ruleFn !== 'function') return;
        if (mutationRules.size === 0) startObserver();
        mutationRules.set(id, ruleFn);
        try {
            ruleFn(document.body);
        } catch (error) {
            console.error('[YTKit] Mutation rule error:', error);
        }
    }

    function removeMutationRule(id) {
        mutationRules.delete(id);
        if (mutationRules.size === 0) stopObserver();
    }

    Object.assign(core, {
        addMutationRule,
        addNavigateRule,
        configureNavigationRuntime,
        removeMutationRule,
        removeNavigateRule,
        waitForElement,
        waitForPageContent
    });
})();
