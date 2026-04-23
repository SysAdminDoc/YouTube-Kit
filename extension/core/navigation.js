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
    const scopedMutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;
    let watchFlexyObserver = null;
    let watchFlexyObservedNode = null;
    let navigateDebounceTimer = null;
    let mutationScheduled = false;
    // Pending mutation records collected between observer fires, drained in
    // the rAF dispatch. Scoped rules inspect these to early-exit when no
    // newly-added node matches their selector.
    let pendingMutationRecords = [];

    function configureNavigationRuntime(options = {}) {
        if (Number.isFinite(options.navDebounce)) {
            runtime.navDebounce = Math.max(0, options.navDebounce);
        }
        if (Number.isFinite(options.elementTimeout)) {
            runtime.elementTimeout = Math.max(0, options.elementTimeout);
        }
    }

    function waitForElement(selector, callback, timeout = runtime.elementTimeout) {
        if (!selector || typeof callback !== 'function') return () => {};
        const existing = document.querySelector(selector);
        if (existing) {
            callback(existing);
            return () => {};
        }

        let fired = false;
        let timeoutId = null;
        let observer = null;
        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            observer?.disconnect();
            observer = null;
        };
        observer = new MutationObserver((mutations) => {
            if (fired) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.(selector)) {
                        fired = true;
                        cleanup();
                        callback(node);
                        return;
                    }
                }
            }

            const matched = document.querySelector(selector);
            if (matched) {
                fired = true;
                cleanup();
                callback(matched);
            }
        });

        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        timeoutId = setTimeout(() => {
            if (!fired) cleanup();
        }, timeout);
        return cleanup;
    }

    function waitForPageContent(callback, fallbackSelector = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer') {
        if (typeof callback !== 'function') return () => {};
        let fired = false;
        let fallbackTimer = null;
        let cancelElementWait = null;
        const onPageUpdated = () => fire();
        const fire = () => {
            if (fired) return;
            fired = true;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            if (cancelElementWait) {
                cancelElementWait();
                cancelElementWait = null;
            }
            document.removeEventListener('yt-page-data-updated', onPageUpdated);
            callback();
        };
        const cancel = () => {
            if (fired) return;
            fired = true;
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
            if (cancelElementWait) { cancelElementWait(); cancelElementWait = null; }
            document.removeEventListener('yt-page-data-updated', onPageUpdated);
        };

        document.addEventListener('yt-page-data-updated', onPageUpdated, { once: true });
        cancelElementWait = waitForElement(fallbackSelector, fire);
        fallbackTimer = setTimeout(fire, 3000);
        return cancel;
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

    function stopNavigateListener() {
        if (!isNavigateListenerAttached) return;

        document.removeEventListener('yt-navigate-finish', debouncedRunNavigateRules);
        document.removeEventListener('yt-page-data-updated', debouncedRunNavigateRules);
        window.removeEventListener('popstate', debouncedRunNavigateRules);
        if (navigateDebounceTimer) {
            clearTimeout(navigateDebounceTimer);
            navigateDebounceTimer = null;
        }
        disconnectWatchFlexyObserver();
        isNavigateListenerAttached = false;
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
        if (navigateRules.size === 0) {
            stopNavigateListener();
        }
    }

    // Collect newly-added Element nodes from a mutation record batch so scoped
    // rules can selector-match once without each rule walking the tree again.
    function collectAddedElements(records) {
        const added = [];
        for (const record of records) {
            if (record.type !== 'childList') continue;
            for (const node of record.addedNodes) {
                if (node && node.nodeType === 1) added.push(node);
            }
        }
        return added;
    }

    function anyAddedMatchesSelector(addedElements, selector) {
        if (!addedElements.length) return false;
        for (const el of addedElements) {
            if (typeof el.matches === 'function' && el.matches(selector)) return true;
            if (typeof el.querySelector === 'function' && el.querySelector(selector)) return true;
        }
        return false;
    }

    function runMutationRules(targetNode, records) {
        for (const rule of mutationRules.values()) {
            try {
                rule(targetNode);
            } catch (error) {
                console.error('[YTKit] Mutation rule error:', error);
            }
        }

        if (scopedMutationRules.size === 0) return;
        const addedElements = collectAddedElements(records);
        for (const entry of scopedMutationRules.values()) {
            try {
                // Fast path: empty batch (observer fired from attribute-only
                // mutation) — skip the rule entirely.
                if (!addedElements.length) continue;
                if (!anyAddedMatchesSelector(addedElements, entry.selector)) continue;
                entry.ruleFn(targetNode, addedElements);
            } catch (error) {
                console.error('[YTKit] Scoped mutation rule error:', error);
            }
        }
    }

    function observerCallback(records) {
        if (records && records.length) {
            // Accumulate records across batches delivered before the rAF drain.
            for (const record of records) pendingMutationRecords.push(record);
        }
        if (mutationScheduled) return;
        mutationScheduled = true;
        requestAnimationFrame(() => {
            mutationScheduled = false;
            const drained = pendingMutationRecords;
            pendingMutationRecords = [];
            runMutationRules(document.body, drained);
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
        pendingMutationRecords = [];
    }

    function hasAnyMutationRule() {
        return mutationRules.size > 0 || scopedMutationRules.size > 0;
    }

    function addMutationRule(id, ruleFn) {
        if (!id || typeof ruleFn !== 'function') return;
        if (!hasAnyMutationRule()) startObserver();
        mutationRules.set(id, ruleFn);
        try {
            ruleFn(document.body);
        } catch (error) {
            console.error('[YTKit] Mutation rule error:', error);
        }
    }

    function removeMutationRule(id) {
        mutationRules.delete(id);
        if (!hasAnyMutationRule()) stopObserver();
    }

    // Scoped mutation rule — only runs when a node matching `selector` is
    // added anywhere in the observed subtree. Massively cuts per-frame work
    // for feed-driven features that previously did `document.querySelectorAll`
    // on every mutation tick.
    //
    // `ruleFn` receives `(targetNode, addedElements)` where `addedElements`
    // is the array of Element nodes inserted in this batch. The rule can
    // scope its own work to that array instead of the whole document.
    function addScopedMutationRule(id, selector, ruleFn) {
        if (!id || typeof selector !== 'string' || typeof ruleFn !== 'function') return;
        if (!hasAnyMutationRule()) startObserver();
        scopedMutationRules.set(id, { selector, ruleFn });
        try {
            ruleFn(document.body, []);
        } catch (error) {
            console.error('[YTKit] Scoped mutation rule error:', error);
        }
    }

    function removeScopedMutationRule(id) {
        scopedMutationRules.delete(id);
        if (!hasAnyMutationRule()) stopObserver();
    }

    Object.assign(core, {
        addMutationRule,
        addNavigateRule,
        addScopedMutationRule,
        configureNavigationRuntime,
        removeMutationRule,
        removeNavigateRule,
        removeScopedMutationRule,
        waitForElement,
        waitForPageContent
    });
})();
