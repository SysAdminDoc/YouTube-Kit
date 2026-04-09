(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.storageRead) return;

    const extensionStateCache = {};
    let pendingStorageWrites = Object.create(null);
    let pendingStorageFlush = null;
    let extensionStateReady = false;
    let storageChangeListenerInstalled = false;
    let storageFlushGuardsInstalled = false;
    const STORAGE_WRITE_DEBOUNCE_MS = 140;

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
        if (core.hasExtensionContext()) {
            try {
                Object.assign(extensionStateCache, await chrome.storage.local.get(null));
            } catch (error) {
                console.warn('[YTKit] Storage preload failed:', error);
            }
        }
        extensionStateReady = true;
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
        pendingStorageFlush = setTimeout(() => {
            pendingStorageFlush = null;
            void flushPendingStorageWrites();
        }, STORAGE_WRITE_DEBOUNCE_MS);
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

        return chrome.storage.local.set(writes).catch((error) => {
            console.warn('[YTKit] Storage flush failed:', error);
            pendingStorageWrites = { ...writes, ...pendingStorageWrites };
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
