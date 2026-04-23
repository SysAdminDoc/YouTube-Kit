(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.storageRead) return;

    const extensionStateCache = Object.create(null);
    let pendingStorageWrites = Object.create(null);
    let pendingStorageFlush = null;
    let extensionStateReady = false;
    let extensionStateReadyPromise = null;
    let storageChangeListenerInstalled = false;
    let storageFlushGuardsInstalled = false;
    const STORAGE_WRITE_DEBOUNCE_MS = 140;
    // Exponential backoff on persistent storage failures (e.g. QUOTA_BYTES
    // exceeded, corrupted profile). Without a backoff, a single quota error
    // would retry every 140 ms forever, saturating the SW IPC channel and
    // flooding the console.
    const STORAGE_FLUSH_MIN_BACKOFF_MS = 500;
    const STORAGE_FLUSH_MAX_BACKOFF_MS = 60000;
    let storageFlushBackoffMs = 0;
    let storageFlushFailureCount = 0;

    function emitStorageUpdate(changes, source = 'chrome-storage') {
        try {
            window.dispatchEvent(new CustomEvent('ytkit-storage-changed', {
                detail: { changes, source }
            }));
        } catch (error) {
            console.warn('[YTKit] Failed to dispatch storage event:', error);
        }
    }

    async function preloadExtensionState() {
        if (extensionStateReady) return;
        if (extensionStateReadyPromise) return extensionStateReadyPromise;
        extensionStateReadyPromise = (async () => {
            if (core.hasExtensionContext()) {
                try {
                    Object.assign(extensionStateCache, await chrome.storage.local.get(null));
                } catch (error) {
                    console.warn('[YTKit] Storage preload failed:', error);
                }
            }
            extensionStateReady = true;
        })();
        try {
            await extensionStateReadyPromise;
        } finally {
            extensionStateReadyPromise = null;
        }
    }

    function storageRead(key, defaultValue) {
        return Object.prototype.hasOwnProperty.call(extensionStateCache, key)
            ? extensionStateCache[key]
            : defaultValue;
    }

    function hasPendingStorageWrites() {
        return Object.keys(pendingStorageWrites).length > 0;
    }

    function schedulePendingStorageFlush() {
        if (pendingStorageFlush || !core.hasExtensionContext() || !hasPendingStorageWrites()) return;
        const delay = Math.max(STORAGE_WRITE_DEBOUNCE_MS, storageFlushBackoffMs);
        pendingStorageFlush = setTimeout(() => {
            pendingStorageFlush = null;
            void flushPendingStorageWrites();
        }, delay);
    }

    function flushPendingStorageWrites() {
        if (pendingStorageFlush) {
            clearTimeout(pendingStorageFlush);
            pendingStorageFlush = null;
        }
        if (!core.hasExtensionContext() || !hasPendingStorageWrites()) {
            return Promise.resolve();
        }

        const writes = pendingStorageWrites;
        pendingStorageWrites = Object.create(null);

        return chrome.storage.local.set(writes).then(() => {
            // Success — clear any backoff so the next flush runs on the
            // normal debounce schedule instead of the failure cadence.
            storageFlushBackoffMs = 0;
            storageFlushFailureCount = 0;
        }).catch((error) => {
            console.warn('[YTKit] Storage flush failed:', error);
            // Merge back onto a prototype-less target so retries cannot
            // inherit Object.prototype entries. Newer pending writes that
            // arrived while the failing set() was in flight take precedence
            // over the ones that failed.
            const merged = Object.create(null);
            Object.assign(merged, writes);
            Object.assign(merged, pendingStorageWrites);
            pendingStorageWrites = merged;
            // Exponential backoff so persistent failures (QUOTA_BYTES,
            // corrupted profile) do not retry every 140 ms forever.
            storageFlushFailureCount += 1;
            storageFlushBackoffMs = Math.min(
                STORAGE_FLUSH_MAX_BACKOFF_MS,
                STORAGE_FLUSH_MIN_BACKOFF_MS * Math.pow(2, Math.min(storageFlushFailureCount - 1, 8))
            );
            schedulePendingStorageFlush();
        });
    }

    function storageWriteMany(entries, options = {}) {
        Object.assign(extensionStateCache, entries);
        Object.assign(pendingStorageWrites, entries);

        if (options.immediate) {
            return flushPendingStorageWrites();
        }

        schedulePendingStorageFlush();
        return Promise.resolve();
    }

    function storageWrite(key, value, options = {}) {
        return storageWriteMany({ [key]: value }, options);
    }

    function storageReadJSON(key, defaultValue) {
        const rawValue = storageRead(key, undefined);
        if (rawValue === undefined || rawValue === null || rawValue === '') return defaultValue;
        if (typeof rawValue === 'string') {
            try {
                const parsed = JSON.parse(rawValue);
                return parsed ?? defaultValue;
            } catch (_) {
                return defaultValue;
            }
        }
        if (typeof rawValue === 'object') return rawValue;
        return defaultValue;
    }

    function storageWriteJSON(key, value, options = {}) {
        return storageWrite(key, value, options);
    }

    function installStorageFlushGuards() {
        if (storageFlushGuardsInstalled) return;
        const flush = () => { void flushPendingStorageWrites(); };
        window.addEventListener('beforeunload', flush, { capture: true });
        window.addEventListener('pagehide', flush, { capture: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
        storageFlushGuardsInstalled = true;
    }

    function installStorageChangeListener() {
        if (storageChangeListenerInstalled) return;
        if (!core.hasExtensionContext() || !chrome.storage?.onChanged) return;
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            try {
                const normalizedChanges = {};
                for (const [key, change] of Object.entries(changes)) {
                    if ('newValue' in change) extensionStateCache[key] = change.newValue;
                    else delete extensionStateCache[key];
                    normalizedChanges[key] = {
                        oldValue: change.oldValue,
                        newValue: change.newValue
                    };
                }
                emitStorageUpdate(normalizedChanges);
            } catch (error) {
                console.error('[YTKit] Storage listener error:', error);
            }
        });
        storageChangeListenerInstalled = true;
    }

    Object.assign(core, {
        flushPendingStorageWrites,
        installStorageChangeListener,
        installStorageFlushGuards,
        preloadExtensionState,
        storageRead,
        storageReadJSON,
        storageWrite,
        storageWriteJSON,
        storageWriteMany
    });
})();
