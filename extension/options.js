// Astra Deck Options Page - Standalone settings management via chrome.storage.local
(function () {
    'use strict';

    const BRAND_NAME = 'Astra Deck';
    const DEFAULT_SETTINGS_URL = chrome.runtime.getURL('default-settings.json');
    const SETTINGS_META_URL = chrome.runtime.getURL('settings-meta.json');
    const SETTINGS_SOURCE_URL = chrome.runtime.getURL('ytkit.js');

    const STORAGE_KEYS = {
        settings: 'ytSuiteSettings',
        hiddenVideos: 'ytkit-hidden-videos',
        blockedChannels: 'ytkit-blocked-channels',
        bookmarks: 'ytkit-bookmarks',
        legacySidebarOrder: 'ytkit_sidebar_order'
    };

    // Keep this empty unless a setting is fully removed from defaults, UI, and runtime.
    const RETIRED_SETTING_KEYS = new Set();

    const INTERNAL_SETTING_KEY_PREFIX = '_';
    const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
    const IMPORT_LIMITS = Object.freeze({
        hiddenVideos: 5000,
        blockedChannels: 2000,
        bookmarkVideos: 400,
        bookmarksPerVideo: 100,
        bookmarkNoteChars: 500,
        totalBytes: 4.5 * 1024 * 1024
    });

    const GROUPS = [
        { id: 'all', label: 'All Settings' },
        { id: 'interface', label: 'Interface' },
        { id: 'watch', label: 'Watch Page' },
        { id: 'player', label: 'Video Player' },
        { id: 'comments', label: 'Comments' },
        { id: 'chat', label: 'Live Chat' },
        { id: 'downloads', label: 'Downloads' },
        { id: 'content', label: 'Content Rules' },
        { id: 'behavior', label: 'Behavior' },
        { id: 'advanced', label: 'Advanced' }
    ];

    const manifest = chrome.runtime.getManifest();
    const elements = {
        pageShell: document.querySelector('.page-shell'),
        version: document.getElementById('version'),
        exportButton: document.getElementById('export-btn'),
        importButton: document.getElementById('import-btn'),
        importFile: document.getElementById('import-file'),
        resetButton: document.getElementById('reset-btn'),
        storageInfo: document.getElementById('storage-info'),
        status: document.getElementById('status'),
        statKeys: document.getElementById('stat-keys'),
        statSize: document.getElementById('stat-size'),
        statHiddenVideos: document.getElementById('stat-hidden-videos'),
        statBlockedChannels: document.getElementById('stat-blocked-channels'),
        statBookmarks: document.getElementById('stat-bookmarks'),
        openSettingsModalButton: document.getElementById('open-settings-modal-btn'),
        settingsModalShell: document.getElementById('settings-modal-shell'),
        closeSettingsModalButton: document.getElementById('close-settings-modal-btn'),
        settingsSearch: document.getElementById('settings-search'),
        settingsGroups: document.getElementById('settings-groups'),
        settingsList: document.getElementById('settings-list'),
        settingsEmpty: document.getElementById('settings-empty'),
        settingsTotalCount: document.getElementById('settings-total-count'),
        settingsDirtyCount: document.getElementById('settings-dirty-count'),
        settingsProblemChip: document.getElementById('settings-problem-chip'),
        settingsProblemCount: document.getElementById('settings-problem-count'),
        settingsModalSummary: document.getElementById('settings-modal-summary'),
        settingsModalStatus: document.getElementById('settings-modal-status'),
        settingsSaveButton: document.getElementById('settings-save-btn'),
        settingsDiscardButton: document.getElementById('settings-discard-btn'),
        settingsRestoreDefaultsButton: document.getElementById('settings-restore-defaults-btn'),
        settingsClearSearchButton: document.getElementById('settings-clear-search-btn'),
        settingsWorkspaceBanner: document.getElementById('settings-workspace-banner'),
        settingsWorkspaceTitle: document.getElementById('settings-workspace-title'),
        settingsWorkspaceNote: document.getElementById('settings-workspace-note'),
        settingsClearFiltersButton: document.getElementById('settings-clear-filters-btn'),
        settingsEmptyEyebrow: document.querySelector('#settings-empty .settings-empty-eyebrow'),
        settingsEmptyTitle: document.querySelector('#settings-empty .settings-empty-title'),
        settingsEmptyCopy: document.querySelector('#settings-empty .settings-empty-copy'),
        settingsEmptyResetButton: document.getElementById('settings-empty-reset-btn')
    };

    const state = {
        modalOpen: false,
        defaultSettings: {},
        storedSettings: {},
        resolvedSettings: {},
        draftSettings: {},
        dirtyKeys: new Set(),
        invalidKeys: new Set(),
        activeGroup: 'all',
        search: '',
        defaultsLoaded: false,
        settingsVersion: 1,
        lastFocusedElement: null,
        bodyOverflowBeforeModal: ''
    };

    elements.version.textContent = 'v' + manifest.version;

    function showStatus(message, type) {
        elements.status.textContent = message;
        elements.status.className = 'status ' + type;
    }

    function showModalStatus(message, type) {
        elements.settingsModalStatus.textContent = message;
        elements.settingsModalStatus.className = 'settings-modal-status ' + type;
    }

    function clearModalStatus() {
        elements.settingsModalStatus.textContent = '';
        elements.settingsModalStatus.className = 'settings-modal-status';
    }

    function pluralize(count, singular, plural = singular + 's') {
        return count === 1 ? singular : plural;
    }

    function setButtonBusy(button, busy, busyLabel = '') {
        if (!(button instanceof HTMLButtonElement)) return;
        if (!button.dataset.idleLabel) {
            button.dataset.idleLabel = button.textContent;
        }

        if (busy) {
            button.setAttribute('aria-busy', 'true');
            if (busyLabel) {
                button.textContent = busyLabel;
            }
            return;
        }

        button.removeAttribute('aria-busy');
        if (button.dataset.idleLabel) {
            button.textContent = button.dataset.idleLabel;
        }
    }

    async function runWithBusyButton(button, busyLabel, task, onSettled = null) {
        const previouslyDisabled = button instanceof HTMLButtonElement ? button.disabled : false;

        if (button instanceof HTMLButtonElement) {
            setButtonBusy(button, true, busyLabel);
            button.disabled = true;
        }

        try {
            return await task();
        } finally {
            if (button instanceof HTMLButtonElement) {
                setButtonBusy(button, false);
                if (typeof onSettled === 'function') {
                    onSettled(previouslyDisabled);
                } else {
                    button.disabled = previouslyDisabled;
                }
            }
        }
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function countObjectEntries(value) {
        if (!value || typeof value !== 'object') return 0;
        return Object.keys(value).length;
    }

    function deepClone(value) {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function safeSerialize(value) {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    function areValuesEqual(left, right) {
        return safeSerialize(left) === safeSerialize(right);
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function isSafeObjectKey(key) {
        return typeof key === 'string' && !UNSAFE_OBJECT_KEYS.has(key);
    }

    function sanitizeSettingsObject(settings) {
        if (!isPlainObject(settings)) return {};
        const sanitized = {};
        for (const [key, value] of Object.entries(settings)) {
            if (isSafeObjectKey(key) && !RETIRED_SETTING_KEYS.has(key)) {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }

    function sanitizeImportedHiddenVideos(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const sanitized = [];
        for (const entry of value) {
            if (typeof entry !== 'string') continue;
            const videoId = entry.trim();
            if (!VIDEO_ID_PATTERN.test(videoId) || seen.has(videoId)) continue;
            seen.add(videoId);
            sanitized.push(videoId);
            if (sanitized.length >= IMPORT_LIMITS.hiddenVideos) break;
        }
        return sanitized;
    }

    function sanitizeImportedBlockedChannels(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        const sanitized = [];
        for (const entry of value) {
            if (!isPlainObject(entry)) continue;
            const id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 128) : '';
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 200) : id;
            sanitized.push({ id, name: name || id });
            if (sanitized.length >= IMPORT_LIMITS.blockedChannels) break;
        }
        return sanitized;
    }

    function sanitizeImportedBookmarks(value) {
        if (!isPlainObject(value)) return {};
        const sanitized = {};
        let videoCount = 0;
        for (const [videoId, entries] of Object.entries(value)) {
            if (!isSafeObjectKey(videoId) || !VIDEO_ID_PATTERN.test(videoId) || !Array.isArray(entries)) continue;
            const seenTimes = new Set();
            const sanitizedEntries = [];
            for (const entry of entries) {
                if (!isPlainObject(entry)) continue;
                const rawTime = Number(entry.t);
                if (!Number.isFinite(rawTime) || rawTime < 0) continue;
                const time = Math.floor(rawTime);
                if (seenTimes.has(time)) continue;
                seenTimes.add(time);
                const note = typeof entry.n === 'string' ? entry.n.slice(0, IMPORT_LIMITS.bookmarkNoteChars) : '';
                const createdAt = Number.isFinite(Number(entry.d)) && Number(entry.d) > 0
                    ? Number(entry.d)
                    : Date.now();
                sanitizedEntries.push({ t: time, n: note, d: createdAt });
                if (sanitizedEntries.length >= IMPORT_LIMITS.bookmarksPerVideo) break;
            }
            if (sanitizedEntries.length === 0) continue;
            sanitizedEntries.sort((left, right) => left.t - right.t);
            sanitized[videoId] = sanitizedEntries;
            videoCount += 1;
            if (videoCount >= IMPORT_LIMITS.bookmarkVideos) break;
        }
        return sanitized;
    }

    function estimateSerializedBytes(value) {
        return new Blob([safeSerialize(value)]).size;
    }

    function getLegacySidebarOrder(allStorage = {}) {
        const legacyValue = allStorage[STORAGE_KEYS.legacySidebarOrder];
        return Array.isArray(legacyValue) && legacyValue.length > 0 ? deepClone(legacyValue) : null;
    }

    function mergeLegacySettings(settings, legacySidebarOrder = null) {
        const merged = sanitizeSettingsObject(settings);
        if (
            (!Array.isArray(merged.sidebarOrder) || merged.sidebarOrder.length === 0) &&
            Array.isArray(legacySidebarOrder) &&
            legacySidebarOrder.length > 0
        ) {
            merged.sidebarOrder = deepClone(legacySidebarOrder);
        }
        return merged;
    }

    function isUserFacingSettingKey(key) {
        return !RETIRED_SETTING_KEYS.has(key) && !String(key).startsWith(INTERNAL_SETTING_KEY_PREFIX);
    }

    function applySettingsVersion(settings) {
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
        const next = sanitizeSettingsObject(settings);
        if (Number.isFinite(state.settingsVersion) && state.settingsVersion > 0) {
            next._settingsVersion = state.settingsVersion;
        }
        return next;
    }

    function buildExportData(allStorage) {
        const mergedSettings = mergeLegacySettings(
            allStorage[STORAGE_KEYS.settings] || {},
            getLegacySidebarOrder(allStorage)
        );

        return {
            settings: applySettingsVersion(mergedSettings),
            hiddenVideos: sanitizeImportedHiddenVideos(allStorage[STORAGE_KEYS.hiddenVideos]),
            blockedChannels: sanitizeImportedBlockedChannels(allStorage[STORAGE_KEYS.blockedChannels]),
            bookmarks: sanitizeImportedBookmarks(allStorage[STORAGE_KEYS.bookmarks]),
            exportVersion: 3,
            exportDate: new Date().toISOString(),
            astraDeckVersion: manifest.version,
            ytkitVersion: manifest.version
        };
    }

    function summarizeStorage(allStorage) {
        const hiddenVideos = Array.isArray(allStorage[STORAGE_KEYS.hiddenVideos]) ? allStorage[STORAGE_KEYS.hiddenVideos].length : 0;
        const blockedChannels = Array.isArray(allStorage[STORAGE_KEYS.blockedChannels]) ? allStorage[STORAGE_KEYS.blockedChannels].length : 0;
        const bookmarks = countObjectEntries(allStorage[STORAGE_KEYS.bookmarks]);
        const keys = Object.keys(allStorage).length;
        const sizeBytes = new Blob([JSON.stringify(allStorage)]).size;
        return {
            hiddenVideos,
            blockedChannels,
            bookmarks,
            keys,
            sizeBytes,
            sizeText: formatBytes(sizeBytes)
        };
    }

    function humanizeKey(key) {
        const normalized = String(key)
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const words = normalized.split(' ').map((word) => {
            const lower = word.toLowerCase();
            if (['ui', 'url', 'urls', 'api', 'id', 'ids', 'pip', 'ai'].includes(lower)) {
                return lower.toUpperCase();
            }
            if (lower === 'yt') return 'YT';
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        });

        return words.join(' ');
    }

    function formatValuePreview(value) {
        if (typeof value === 'boolean') return value ? 'On' : 'Off';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'string') {
            const compact = value.replace(/\s+/g, ' ').trim();
            if (!compact) return 'Empty';
            return compact.length > 60 ? compact.slice(0, 57) + '…' : compact;
        }
        if (Array.isArray(value)) return value.length + (value.length === 1 ? ' item' : ' items');
        if (value && typeof value === 'object') return Object.keys(value).length + ' keys';
        return 'Not set';
    }

    function toDomIdFragment(key) {
        return String(key)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'setting';
    }

    function getFocusableElements(root) {
        if (!root) return [];
        return Array.from(root.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => {
            if (!(element instanceof HTMLElement)) return false;
            if (element.hidden) return false;
            if (element.getAttribute('aria-hidden') === 'true') return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
    }

    function trapFocusWithin(root, event) {
        if (event.key !== 'Tab') return;
        const focusable = getFocusableElements(root);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;

        if (event.shiftKey) {
            if (activeElement === first || !root.contains(activeElement)) {
                event.preventDefault();
                last.focus();
            }
            return;
        }

        if (activeElement === last || !root.contains(activeElement)) {
            event.preventDefault();
            first.focus();
        }
    }

    function inferGroup(key) {
        const lower = key.toLowerCase();

        if (/chat|livechat|superchat|ticker|emoji|bots/.test(lower)) return 'chat';
        if (/comment|comments|reply|pinned/.test(lower)) return 'comments';
        if (/download|mediadl|ytdlp/.test(lower)) return 'downloads';
        if (/player|quality|resolution|speed|autoplay|subtitle|caption|miniplayer|pip|fullscreen|theater|ambient|videoend/.test(lower)) return 'player';
        if (/watch|related|description|floatinglogo|shareurl|owner|expandvideo/.test(lower)) return 'watch';
        if (/search|sidebar|subscription|homepage|logo|createbutton|voicesearch|quicklink|layout|grid|avatar|filterchips|style|theme|scrollbar|square/.test(lower)) return 'interface';
        if (/redirect|prevent|pause|disable|enable|auto|safe|openinnewtab|cleanshare/.test(lower)) return 'behavior';
        if (/hide|remove|keyword|members|news|playlist|shorts|merch|summary|fundraiser|playables|blocked|content/.test(lower)) return 'content';
        return 'advanced';
    }

    function getSettingKeys() {
        const keySet = new Set([
            ...Object.keys(state.defaultSettings || {}),
            ...Object.keys(state.storedSettings || {}),
            ...Object.keys(state.draftSettings || {})
        ]);

        return Array.from(keySet)
            .filter((key) => isUserFacingSettingKey(key))
            .sort((left, right) => humanizeKey(left).localeCompare(humanizeKey(right)));
    }

    function matchesSearch(key, value) {
        if (!state.search) return true;
        const haystack = [key, humanizeKey(key), inferGroup(key), formatValuePreview(value)].join(' ').toLowerCase();
        return haystack.includes(state.search);
    }

    function getActiveGroupLabel() {
        return GROUPS.find((group) => group.id === state.activeGroup)?.label || 'All Settings';
    }

    function updateSettingsSearchState() {
        elements.settingsClearSearchButton.hidden = !elements.settingsSearch.value.trim();
    }

    function clearSettingsFilters({ focusSearch = false, announce = false } = {}) {
        const hadFilters = state.activeGroup !== 'all' || !!elements.settingsSearch.value.trim();

        state.activeGroup = 'all';
        state.search = '';
        elements.settingsSearch.value = '';
        updateSettingsSearchState();
        renderSettingsWorkspace();

        if (announce && hadFilters) {
            showModalStatus('Filters cleared. Showing every setting again.', 'info');
        }
        if (focusSearch) {
            requestAnimationFrame(() => elements.settingsSearch.focus());
        }
    }

    function getVisibleKeys() {
        return getSettingKeys().filter((key) => {
            const value = state.draftSettings[key];
            if (!matchesSearch(key, value)) return false;
            if (state.activeGroup === 'all') return true;
            return inferGroup(key) === state.activeGroup;
        });
    }

    async function loadDefaultSettingsFromSource() {
        if (state.defaultsLoaded) return;

        try {
            let defaults = null;
            let settingsVersion = null;

            try {
                const defaultSettingsResponse = await fetch(DEFAULT_SETTINGS_URL, { cache: 'no-store' });
                if (defaultSettingsResponse.ok) {
                    const json = await defaultSettingsResponse.json();
                    if (json && typeof json === 'object' && !Array.isArray(json)) {
                        defaults = json;
                    }
                }
            } catch {
                // Fall back to a degraded mode if the generated catalog is unavailable.
            }

            try {
                const settingsMetaResponse = await fetch(SETTINGS_META_URL, { cache: 'no-store' });
                if (settingsMetaResponse.ok) {
                    const json = await settingsMetaResponse.json();
                    if (json && Number.isFinite(json.settingsVersion)) {
                        settingsVersion = Number(json.settingsVersion);
                    }
                }
            } catch {
                // Fall back to the source regex for settings version if metadata is unavailable.
            }

            if (!settingsVersion) {
                const response = await fetch(SETTINGS_SOURCE_URL, { cache: 'no-store' });
                const source = await response.text();
                const versionMatch = source.match(/SETTINGS_VERSION:\s*(\d+)/);
                if (!versionMatch) {
                    throw new Error('Settings version was not found in ytkit.js');
                }
                settingsVersion = Number(versionMatch[1]);
            }

            if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
                throw new Error('Settings defaults are not a plain object');
            }

            if (Number.isFinite(settingsVersion) && settingsVersion > 0) {
                state.settingsVersion = settingsVersion;
            }
            state.defaultSettings = sanitizeSettingsObject(deepClone(defaults));
            state.defaultsLoaded = true;
        } catch {
            state.defaultSettings = {};
            state.defaultsLoaded = true;
            showStatus('Defaults catalog unavailable, but stored settings can still be edited.', 'info');
        }
    }

    async function renderStorageInfo() {
        try {
            const allStorage = await chrome.storage.local.get(null);
            const summary = summarizeStorage(allStorage);

            elements.statKeys.textContent = String(summary.keys);
            elements.statSize.textContent = summary.sizeText;
            elements.statHiddenVideos.textContent = String(summary.hiddenVideos);
            elements.statBlockedChannels.textContent = String(summary.blockedChannels);
            elements.statBookmarks.textContent = String(summary.bookmarks);

            elements.storageInfo.textContent =
                `${summary.keys} ${summary.keys === 1 ? 'key' : 'keys'} in local storage, using about ${summary.sizeText}. ` +
                `${summary.hiddenVideos} hidden video ${summary.hiddenVideos === 1 ? 'rule' : 'rules'}, ` +
                `${summary.blockedChannels} blocked ${summary.blockedChannels === 1 ? 'channel' : 'channels'}, ` +
                `and ${summary.bookmarks} ${summary.bookmarks === 1 ? 'bookmark' : 'bookmarks'} saved.`;
        } catch (error) {
            elements.storageInfo.textContent = 'Unable to read extension storage.';
            elements.statKeys.textContent = '0';
            elements.statSize.textContent = '0 KB';
            elements.statHiddenVideos.textContent = '0';
            elements.statBlockedChannels.textContent = '0';
            elements.statBookmarks.textContent = '0';
            showStatus('Storage read failed: ' + error.message, 'error');
        }
    }

    async function exportSettings() {
        try {
            const allStorage = await chrome.storage.local.get(null);
            const exportData = buildExportData(allStorage);
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const downloadLink = Object.assign(document.createElement('a'), {
                href: url,
                download: 'astra_deck_settings_' + new Date().toISOString().slice(0, 10) + '.json'
            });

            downloadLink.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showStatus('Settings exported successfully.', 'success');
        } catch (error) {
            showStatus('Export failed: ' + error.message, 'error');
        }
    }

    async function importSettings(file) {
        if (!file) return;

        try {
            if (file.size > 10 * 1024 * 1024) {
                throw new Error('Import file exceeds 10 MB limit');
            }
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid format');
            }

            const writes = {};
            if (data.exportVersion >= 3) {
                if (isPlainObject(data.settings)) writes[STORAGE_KEYS.settings] = applySettingsVersion(data.settings);
                if (Array.isArray(data.hiddenVideos)) writes[STORAGE_KEYS.hiddenVideos] = sanitizeImportedHiddenVideos(data.hiddenVideos);
                if (Array.isArray(data.blockedChannels)) writes[STORAGE_KEYS.blockedChannels] = sanitizeImportedBlockedChannels(data.blockedChannels);
                if (isPlainObject(data.bookmarks)) writes[STORAGE_KEYS.bookmarks] = sanitizeImportedBookmarks(data.bookmarks);
            } else if (data.exportVersion >= 2) {
                if (isPlainObject(data.settings)) writes[STORAGE_KEYS.settings] = applySettingsVersion(data.settings);
                if (Array.isArray(data.hiddenVideos)) writes[STORAGE_KEYS.hiddenVideos] = sanitizeImportedHiddenVideos(data.hiddenVideos);
                if (Array.isArray(data.blockedChannels)) writes[STORAGE_KEYS.blockedChannels] = sanitizeImportedBlockedChannels(data.blockedChannels);
            } else {
                if (isPlainObject(data)) {
                    writes[STORAGE_KEYS.settings] = applySettingsVersion(data);
                }
            }

            if (Object.keys(writes).length === 0) {
                throw new Error('No valid settings found in file');
            }

            if (estimateSerializedBytes(writes) > IMPORT_LIMITS.totalBytes) {
                throw new Error('Import data is too large for extension storage');
            }

            await chrome.storage.local.set(writes);
            if (writes[STORAGE_KEYS.settings]) {
                await chrome.storage.local.remove(STORAGE_KEYS.legacySidebarOrder);
            }
            await renderStorageInfo();
            await refreshSettingsState({ resetDraft: true });
            if (state.modalOpen) renderSettingsWorkspace();
            showStatus('Settings imported. Open YouTube tabs update automatically.', 'success');
        } catch (error) {
            showStatus('Import failed: ' + error.message, 'error');
        } finally {
            elements.importFile.value = '';
        }
    }

    async function resetSettings() {
        const confirmed = window.confirm(
            `Reset all ${BRAND_NAME} extension storage? This clears settings, hidden videos, blocked channels, and bookmarks.`
        );
        if (!confirmed) return;

        try {
            await chrome.storage.local.clear();
            await renderStorageInfo();
            await refreshSettingsState({ resetDraft: true });
            if (state.modalOpen) renderSettingsWorkspace();
            showStatus('All settings cleared. Open YouTube tabs update automatically.', 'success');
        } catch (error) {
            showStatus('Reset failed: ' + error.message, 'error');
        }
    }

    async function refreshSettingsState({ resetDraft = false } = {}) {
        await loadDefaultSettingsFromSource();
        const result = await chrome.storage.local.get([
            STORAGE_KEYS.settings,
            STORAGE_KEYS.legacySidebarOrder
        ]);
        const hasModernSidebarOrder = Array.isArray(result[STORAGE_KEYS.settings]?.sidebarOrder)
            && result[STORAGE_KEYS.settings].sidebarOrder.length > 0;
        if (hasModernSidebarOrder && Array.isArray(result[STORAGE_KEYS.legacySidebarOrder])) {
            await chrome.storage.local.remove(STORAGE_KEYS.legacySidebarOrder);
        }
        const rawStoredSettings = mergeLegacySettings(
            deepClone(result[STORAGE_KEYS.settings] || {}),
            getLegacySidebarOrder(result)
        );
        state.storedSettings = applySettingsVersion(rawStoredSettings);
        if (!areValuesEqual(rawStoredSettings, state.storedSettings)) {
            await chrome.storage.local.set({ [STORAGE_KEYS.settings]: state.storedSettings });
        }
        state.resolvedSettings = {
            ...deepClone(state.defaultSettings),
            ...deepClone(state.storedSettings)
        };

        if (resetDraft || !state.modalOpen || state.dirtyKeys.size === 0) {
            state.draftSettings = deepClone(state.resolvedSettings);
            state.dirtyKeys.clear();
            state.invalidKeys.clear();
        }
    }

    function updateDirtyStateForKey(key) {
        const currentValue = state.draftSettings[key];
        const storedValue = state.resolvedSettings[key];
        if (areValuesEqual(currentValue, storedValue)) {
            state.dirtyKeys.delete(key);
        } else {
            state.dirtyKeys.add(key);
        }
    }

    function updateModalHeaderState() {
        const totalCount = getSettingKeys().length;
        const visibleCount = getVisibleKeys().length;
        const dirtyCount = state.dirtyKeys.size;
        const invalidCount = state.invalidKeys.size;
        const searchValue = elements.settingsSearch.value.trim();
        const hasFilters = state.activeGroup !== 'all' || !!searchValue;
        const activeGroupLabel = getActiveGroupLabel();

        elements.settingsTotalCount.textContent = String(totalCount);
        elements.settingsDirtyCount.textContent = String(dirtyCount);
        elements.settingsProblemCount.textContent = String(invalidCount);
        elements.settingsProblemChip.hidden = invalidCount === 0;
        elements.settingsSaveButton.disabled = dirtyCount === 0 || invalidCount > 0;
        elements.settingsDiscardButton.disabled = dirtyCount === 0 && invalidCount === 0;
        elements.settingsRestoreDefaultsButton.disabled = Object.keys(state.defaultSettings).length === 0;
        elements.settingsClearFiltersButton.hidden = !hasFilters;
        updateSettingsSearchState();

        const workspaceBanner = elements.settingsWorkspaceBanner;
        workspaceBanner.classList.remove('is-warning', 'is-error', 'is-filtered');

        let workspaceTitle = 'Everything is in sync';
        let workspaceNote = 'Changes stay local until you save them.';

        if (totalCount === 0) {
            workspaceBanner.classList.add('is-warning');
            workspaceTitle = 'No editable settings available';
            workspaceNote = 'This build did not expose a settings catalog, so the editor has nothing to show right now.';
        } else if (invalidCount > 0) {
            workspaceBanner.classList.add('is-error');
            workspaceTitle = `${invalidCount} ${pluralize(invalidCount, 'field')} need${invalidCount === 1 ? 's' : ''} attention`;
            workspaceNote = 'Fix the highlighted cards before saving. Invalid values stay local to this editor until the draft is valid.';
        } else if (dirtyCount > 0) {
            workspaceBanner.classList.add('is-warning');
            workspaceTitle = `${dirtyCount} unsaved ${pluralize(dirtyCount, 'change')} ready`;
            workspaceNote = 'Review the highlighted cards, then save when this draft looks right. Open YouTube tabs update automatically after save.';
        } else if (hasFilters) {
            workspaceBanner.classList.add('is-filtered');
            workspaceTitle = visibleCount === 0
                ? 'Filtered view is empty'
                : `Showing ${visibleCount} ${pluralize(visibleCount, 'setting')}`;

            if (state.activeGroup !== 'all' && searchValue) {
                workspaceNote = `Viewing ${activeGroupLabel.toLowerCase()} settings matching "${searchValue}".`;
            } else if (state.activeGroup !== 'all') {
                workspaceNote = `Viewing only the ${activeGroupLabel.toLowerCase()} group.`;
            } else {
                workspaceNote = `Showing settings matching "${searchValue}".`;
            }
        }

        elements.settingsWorkspaceTitle.textContent = workspaceTitle;
        elements.settingsWorkspaceNote.textContent = workspaceNote;

        let summary = '';
        if (totalCount === 0) {
            summary = 'No editable settings are available in this build.';
        } else {
            summary = hasFilters
                ? `${visibleCount} of ${totalCount} ${pluralize(totalCount, 'setting')} visible`
                : `${totalCount} ${pluralize(totalCount, 'setting')} ready to review`;

            if (state.activeGroup !== 'all' && searchValue) {
                summary += ` in ${activeGroupLabel} for "${searchValue}"`;
            } else if (state.activeGroup !== 'all') {
                summary += ` in ${activeGroupLabel}`;
            } else if (searchValue) {
                summary += ` matching "${searchValue}"`;
            }

            summary += '.';

            if (dirtyCount > 0) {
                summary += ` ${dirtyCount} unsaved ${pluralize(dirtyCount, 'change')} ${dirtyCount === 1 ? 'is' : 'are'} ready to apply.`;
            } else {
                summary += ' Changes stay local until you save them.';
            }

            if (invalidCount > 0) {
                summary += ` ${invalidCount} ${pluralize(invalidCount, 'field')} ${invalidCount === 1 ? 'needs' : 'need'} attention before saving.`;
            }
        }

        elements.settingsModalSummary.textContent = summary;
    }

    function updateCardState(card, key) {
        const dirty = state.dirtyKeys.has(key);
        const invalid = state.invalidKeys.has(key);
        const currentValue = state.draftSettings[key];
        const storedValue = state.resolvedSettings[key];
        const defaultValue = state.defaultSettings[key];
        card.classList.toggle('is-dirty', dirty);
        card.classList.toggle('is-invalid', invalid);
        card.querySelectorAll('input, textarea, select').forEach((control) => {
            control.setAttribute('aria-invalid', invalid ? 'true' : 'false');
        });

        const dirtyBadge = card.querySelector('.settings-item-state');
        if (dirtyBadge) {
            dirtyBadge.classList.toggle('is-problem', invalid);
            dirtyBadge.hidden = !dirty && !invalid;
            dirtyBadge.textContent = invalid ? 'Needs Fix' : dirty ? 'Pending Save' : '';
        }

        const hint = card.querySelector('.settings-item-hint');
        if (hint) {
            if (invalid) {
                hint.textContent = 'Fix this field before saving. Invalid draft values stay local to this editor.';
            } else if (dirty) {
                if (defaultValue !== undefined && areValuesEqual(currentValue, defaultValue)) {
                    hint.textContent = `Back at the catalog default (${formatValuePreview(defaultValue)}). Save to replace the stored value.`;
                } else if (defaultValue === undefined) {
                    hint.textContent = `Stored: ${formatValuePreview(storedValue)}. Save to keep this custom value.`;
                } else {
                    hint.textContent = `Stored: ${formatValuePreview(storedValue)} • Default: ${formatValuePreview(defaultValue)}. Save to apply this draft.`;
                }
            } else {
                hint.textContent = defaultValue === undefined
                    ? 'Stored setting with no catalog default.'
                    : areValuesEqual(storedValue, defaultValue)
                        ? `At the catalog default: ${formatValuePreview(defaultValue)}.`
                        : `Stored: ${formatValuePreview(storedValue)} • Default: ${formatValuePreview(defaultValue)}.`;
            }
        }
    }

    function focusFirstInvalidControl() {
        const firstInvalidCard = elements.settingsList.querySelector('.settings-item.is-invalid');
        if (!firstInvalidCard) return;
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        firstInvalidCard.scrollIntoView({
            block: 'nearest',
            behavior: prefersReducedMotion ? 'auto' : 'smooth'
        });
        const control = firstInvalidCard.querySelector('input, textarea, select');
        if (control instanceof HTMLElement) {
            control.focus();
            if (typeof control.select === 'function' && (control.tagName === 'INPUT' || control.tagName === 'TEXTAREA')) {
                control.select();
            }
        } else {
            firstInvalidCard.focus?.();
        }
    }

    function parseListInput(rawValue, referenceArray) {
        const lines = rawValue
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        const templateItem = Array.isArray(referenceArray) ? referenceArray.find((item) => item != null) : undefined;
        const itemType = typeof templateItem;

        if (itemType === 'number') {
            const parsedNumbers = lines.map(Number);
            if (parsedNumbers.some((value) => Number.isNaN(value))) {
                throw new Error('List expects numbers');
            }
            return parsedNumbers;
        }

        if (itemType === 'boolean') {
            return lines.map((line) => {
                const lowered = line.toLowerCase();
                if (lowered === 'true') return true;
                if (lowered === 'false') return false;
                throw new Error('List expects true/false values');
            });
        }

        return lines;
    }

    function applyControlAccessibility(control, key, meta, options = {}) {
        control.id = meta.controlId;
        control.name = key;
        control.setAttribute('aria-labelledby', meta.titleId);
        control.setAttribute('aria-describedby', `${meta.descriptionId} ${meta.hintId}`);
        if ('autocomplete' in control) {
            control.autocomplete = options.autocomplete || 'off';
        }
        if ('spellcheck' in control && options.spellcheck === false) {
            control.spellcheck = false;
        }
        return control;
    }

    function inferControlKind(value, defaultValue) {
        const reference = value !== undefined ? value : defaultValue;

        if (typeof reference === 'boolean') return 'toggle';
        if (typeof reference === 'number') return 'number';
        if (Array.isArray(reference)) {
            return reference.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item)) ? 'list' : 'json';
        }
        if (reference && typeof reference === 'object') return 'json';
        if (typeof reference === 'string' && (reference.includes('\n') || reference.length > 70)) return 'textarea';
        return 'text';
    }

    function formatControlKindLabel(controlKind) {
        switch (controlKind) {
            case 'toggle':
                return 'Toggle';
            case 'number':
                return 'Number';
            case 'list':
                return 'List';
            case 'json':
                return 'JSON';
            case 'textarea':
                return 'Long Text';
            default:
                return 'Text';
        }
    }

    function renderSettingsGroups() {
        const keys = getSettingKeys().filter((key) => matchesSearch(key, state.draftSettings[key]));
        const counts = new Map();
        GROUPS.forEach((group) => counts.set(group.id, 0));

        keys.forEach((key) => {
            const groupId = inferGroup(key);
            counts.set(groupId, (counts.get(groupId) || 0) + 1);
            counts.set('all', (counts.get('all') || 0) + 1);
        });

        if (state.activeGroup !== 'all' && (counts.get(state.activeGroup) || 0) === 0) {
            state.activeGroup = 'all';
        }

        const fragment = document.createDocumentFragment();
        GROUPS.forEach((group) => {
            if (group.id !== 'all' && (counts.get(group.id) || 0) === 0) return;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'settings-group-button' + (state.activeGroup === group.id ? ' active' : '');
            button.dataset.group = group.id;
            button.setAttribute('aria-pressed', state.activeGroup === group.id ? 'true' : 'false');

            const label = document.createElement('span');
            label.textContent = group.label;

            const count = document.createElement('span');
            count.className = 'settings-group-count';
            count.textContent = String(counts.get(group.id) || 0);

            button.appendChild(label);
            button.appendChild(count);
            button.addEventListener('click', () => {
                state.activeGroup = group.id;
                renderSettingsWorkspace();
            });

            fragment.appendChild(button);
        });
        elements.settingsGroups.replaceChildren(fragment);
    }

    function renderTextControl(card, key, value, isMultiline, meta) {
        const input = document.createElement(isMultiline ? 'textarea' : 'input');
        if (!isMultiline) {
            input.type = /url/i.test(key) ? 'url' : 'text';
        }
        applyControlAccessibility(input, key, meta, {
            spellcheck: !/url|css|json|regex/i.test(key)
        });
        input.value = value == null ? '' : String(value);
        input.addEventListener('input', () => {
            state.draftSettings[key] = input.value;
            state.invalidKeys.delete(key);
            updateDirtyStateForKey(key);
            updateCardState(card, key);
            updateModalHeaderState();
        });
        return input;
    }

    function renderNumberControl(card, key, value, meta) {
        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = Number.isInteger(value) ? 'numeric' : 'decimal';
        applyControlAccessibility(input, key, meta);
        input.value = String(value ?? 0);
        input.step = Number.isInteger(value) ? '1' : 'any';
        input.addEventListener('input', () => {
            if (input.value.trim() === '') {
                state.invalidKeys.add(key);
            } else {
                const nextValue = Number(input.value);
                if (Number.isNaN(nextValue)) {
                    state.invalidKeys.add(key);
                } else {
                    state.draftSettings[key] = nextValue;
                    state.invalidKeys.delete(key);
                    updateDirtyStateForKey(key);
                }
            }
            updateCardState(card, key);
            updateModalHeaderState();
        });
        return input;
    }

    function renderToggleControl(card, key, value, meta) {
        const label = document.createElement('label');
        label.className = 'settings-item-toggle';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(value);
        applyControlAccessibility(input, key, meta);

        const track = document.createElement('span');
        track.className = 'settings-item-toggle-track';

        const text = document.createElement('span');
        text.className = 'settings-item-toggle-label';
        text.textContent = input.checked ? 'Enabled' : 'Disabled';

        // Single change listener handles state + label update together.
        // Previously two separate listeners were attached which doubled the
        // per-toggle work on every click for no benefit.
        input.addEventListener('change', () => {
            state.draftSettings[key] = input.checked;
            state.invalidKeys.delete(key);
            text.textContent = input.checked ? 'Enabled' : 'Disabled';
            updateDirtyStateForKey(key);
            updateCardState(card, key);
            updateModalHeaderState();
        });

        label.appendChild(input);
        label.appendChild(track);
        label.appendChild(text);
        return label;
    }

    function renderListControl(card, key, value, defaultValue, meta) {
        const textarea = document.createElement('textarea');
        applyControlAccessibility(textarea, key, meta, { spellcheck: false });
        textarea.value = Array.isArray(value) ? value.join('\n') : '';
        textarea.addEventListener('input', () => {
            try {
                state.draftSettings[key] = parseListInput(textarea.value, value ?? defaultValue);
                state.invalidKeys.delete(key);
                updateDirtyStateForKey(key);
            } catch {
                state.invalidKeys.add(key);
            }
            updateCardState(card, key);
            updateModalHeaderState();
        });
        return textarea;
    }

    function renderJsonControl(card, key, value, meta) {
        const textarea = document.createElement('textarea');
        applyControlAccessibility(textarea, key, meta, { spellcheck: false });
        textarea.value = JSON.stringify(value ?? {}, null, 2);
        textarea.addEventListener('input', () => {
            try {
                state.draftSettings[key] = JSON.parse(textarea.value);
                state.invalidKeys.delete(key);
                updateDirtyStateForKey(key);
            } catch {
                state.invalidKeys.add(key);
            }
            updateCardState(card, key);
            updateModalHeaderState();
        });
        return textarea;
    }

    function createSettingsCard(key) {
        const currentValue = state.draftSettings[key];
        const defaultValue = state.defaultSettings[key];
        const groupId = inferGroup(key);
        const groupLabel = GROUPS.find((group) => group.id === groupId)?.label || 'Advanced';
        const controlKind = inferControlKind(currentValue, defaultValue);
        const controlKindLabel = formatControlKindLabel(controlKind);
        const idBase = toDomIdFragment(key);
        const controlMeta = {
            controlId: `settings-control-${idBase}`,
            titleId: `settings-title-${idBase}`,
            descriptionId: `settings-description-${idBase}`,
            hintId: `settings-hint-${idBase}`
        };

        const card = document.createElement('article');
        card.className = 'settings-item';
        card.dataset.key = key;
        card.tabIndex = -1;
        card.setAttribute('aria-labelledby', controlMeta.titleId);

        const header = document.createElement('div');
        header.className = 'settings-item-header';

        const copy = document.createElement('div');
        copy.className = 'settings-item-copy';

        const title = document.createElement('h3');
        title.className = 'settings-item-title';
        title.id = controlMeta.titleId;
        title.textContent = humanizeKey(key);

        const meta = document.createElement('div');
        meta.className = 'settings-item-meta';

        const keyBadge = document.createElement('span');
        keyBadge.className = 'settings-item-badge settings-item-badge-key';
        keyBadge.textContent = key;

        const groupBadge = document.createElement('span');
        groupBadge.className = 'settings-item-badge settings-item-badge-group';
        groupBadge.textContent = groupLabel;

        const typeBadge = document.createElement('span');
        typeBadge.className = 'settings-item-badge settings-item-badge-type';
        typeBadge.textContent = controlKindLabel;

        const stateBadge = document.createElement('span');
        stateBadge.className = 'settings-item-badge settings-item-state';
        stateBadge.hidden = true;

        meta.appendChild(keyBadge);
        meta.appendChild(groupBadge);
        meta.appendChild(typeBadge);
        meta.appendChild(stateBadge);

        const description = document.createElement('p');
        description.className = 'settings-item-description';
        description.id = controlMeta.descriptionId;
        description.textContent = `Editing a ${controlKindLabel.toLowerCase()} setting. Draft value: ${formatValuePreview(currentValue)}.`;

        copy.appendChild(title);
        copy.appendChild(meta);
        copy.appendChild(description);
        header.appendChild(copy);
        card.appendChild(header);

        const controlWrap = document.createElement('div');
        controlWrap.className = 'settings-item-control';

        if (controlKind === 'toggle') {
            controlWrap.appendChild(renderToggleControl(card, key, currentValue, controlMeta));
        } else if (controlKind === 'number') {
            controlWrap.appendChild(renderNumberControl(card, key, currentValue, controlMeta));
        } else if (controlKind === 'list') {
            controlWrap.appendChild(renderListControl(card, key, currentValue, defaultValue, controlMeta));
        } else if (controlKind === 'json') {
            controlWrap.appendChild(renderJsonControl(card, key, currentValue, controlMeta));
        } else {
            controlWrap.appendChild(renderTextControl(card, key, currentValue, controlKind === 'textarea', controlMeta));
        }

        card.appendChild(controlWrap);

        const footer = document.createElement('div');
        footer.className = 'settings-item-footer';

        const hint = document.createElement('div');
        hint.className = 'settings-item-hint';
        hint.id = controlMeta.hintId;
        footer.appendChild(hint);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'settings-reset-inline';
        resetButton.textContent = 'Reset';
        resetButton.disabled = defaultValue === undefined;
        resetButton.addEventListener('click', () => {
            if (defaultValue === undefined) return;
            state.draftSettings[key] = deepClone(defaultValue);
            state.invalidKeys.delete(key);
            updateDirtyStateForKey(key);
            renderSettingsWorkspace({ preserveScroll: true });
            showModalStatus(`${humanizeKey(key)} restored to its catalog default. Save to apply.`, 'info');
        });

        footer.appendChild(resetButton);
        card.appendChild(footer);

        updateCardState(card, key);
        return card;
    }

    function updateSettingsEmptyState(totalCount) {
        const searchValue = elements.settingsSearch.value.trim();
        const activeGroupLabel = getActiveGroupLabel();
        const hasFilters = state.activeGroup !== 'all' || !!searchValue;

        let eyebrow = 'Filtered View';
        let title = 'No settings match this view';
        let copy = 'Try a broader search or switch back to All Settings.';
        let showReset = hasFilters;

        if (totalCount === 0) {
            eyebrow = 'Catalog';
            title = 'No settings are available';
            copy = 'This build did not expose editable settings, so the workspace has nothing to load right now.';
            showReset = false;
        } else if (state.activeGroup !== 'all' && searchValue) {
            title = 'No settings match this search here';
            copy = `Try a broader search or clear the ${activeGroupLabel.toLowerCase()} filter to browse the full catalog again.`;
        } else if (state.activeGroup !== 'all') {
            title = `No settings found in ${activeGroupLabel}`;
            copy = 'Switch groups or jump back to All Settings to keep exploring the catalog.';
        } else if (searchValue) {
            title = 'No settings match this search';
            copy = 'Try a shorter keyword, search by setting key, or clear the filter to browse everything again.';
        } else {
            eyebrow = 'Empty';
            title = 'No settings to display';
            copy = 'The editor is ready, but no stored or default settings were found for this build.';
            showReset = false;
        }

        elements.settingsEmptyEyebrow.textContent = eyebrow;
        elements.settingsEmptyTitle.textContent = title;
        elements.settingsEmptyCopy.textContent = copy;
        elements.settingsEmptyResetButton.hidden = !showReset;
    }

    function renderSettingsList() {
        const visibleKeys = getVisibleKeys();
        const totalCount = getSettingKeys().length;
        elements.settingsEmpty.hidden = visibleKeys.length > 0;
        elements.settingsList.hidden = visibleKeys.length === 0;

        if (visibleKeys.length === 0) {
            elements.settingsList.replaceChildren();
            updateSettingsEmptyState(totalCount);
            return;
        }

        const fragment = document.createDocumentFragment();
        visibleKeys.forEach((key) => {
            fragment.appendChild(createSettingsCard(key));
        });
        elements.settingsList.replaceChildren(fragment);
    }

    function renderSettingsWorkspace({ preserveScroll = false } = {}) {
        const previousScrollTop = preserveScroll ? elements.settingsList.scrollTop : 0;
        renderSettingsGroups();
        renderSettingsList();
        updateModalHeaderState();
        if (preserveScroll) {
            elements.settingsList.scrollTop = previousScrollTop;
        }
    }

    async function openSettingsModal() {
        try {
            await refreshSettingsState({ resetDraft: true });
        } catch (error) {
            showStatus('Unable to open settings right now: ' + error.message, 'error');
            return;
        }
        clearModalStatus();
        state.activeGroup = 'all';
        state.search = '';
        elements.settingsSearch.value = '';
        updateSettingsSearchState();
        state.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        state.bodyOverflowBeforeModal = document.body.style.overflow;
        state.modalOpen = true;
        if (elements.pageShell) {
            elements.pageShell.setAttribute('aria-hidden', 'true');
            elements.pageShell.inert = true;
        }
        document.body.style.overflow = 'hidden';
        elements.settingsModalShell.hidden = false;
        renderSettingsWorkspace();
        requestAnimationFrame(() => elements.settingsSearch.focus());
    }

    function requestCloseSettingsModal() {
        if (state.dirtyKeys.size > 0 || state.invalidKeys.size > 0) {
            const draftPieces = [];
            if (state.dirtyKeys.size > 0) {
                draftPieces.push(`${state.dirtyKeys.size} unsaved ${pluralize(state.dirtyKeys.size, 'change')}`);
            }
            if (state.invalidKeys.size > 0) {
                draftPieces.push(`${state.invalidKeys.size} ${pluralize(state.invalidKeys.size, 'invalid field')}`);
            }
            const confirmed = window.confirm(`Discard ${draftPieces.join(' and ')} and close the settings editor?`);
            if (!confirmed) return;
        }

        state.modalOpen = false;
        elements.settingsModalShell.hidden = true;
        if (elements.pageShell) {
            elements.pageShell.removeAttribute('aria-hidden');
            elements.pageShell.inert = false;
        }
        document.body.style.overflow = state.bodyOverflowBeforeModal;
        clearModalStatus();
        const restoreTarget = state.lastFocusedElement && state.lastFocusedElement.isConnected
            ? state.lastFocusedElement
            : elements.openSettingsModalButton;
        state.lastFocusedElement = null;
        requestAnimationFrame(() => restoreTarget?.focus());
    }

    async function saveSettingsDraft() {
        if (state.invalidKeys.size > 0) {
            showModalStatus('Fix invalid fields before saving.', 'error');
            focusFirstInvalidControl();
            return;
        }

        try {
            const nextStoredSettings = applySettingsVersion(deepClone(state.draftSettings));
            await chrome.storage.local.set({
                [STORAGE_KEYS.settings]: nextStoredSettings
            });
            await chrome.storage.local.remove(STORAGE_KEYS.legacySidebarOrder);

            state.storedSettings = deepClone(nextStoredSettings);
            state.resolvedSettings = {
                ...deepClone(state.defaultSettings),
                ...deepClone(nextStoredSettings)
            };
            state.draftSettings = deepClone(state.resolvedSettings);
            state.dirtyKeys.clear();
            state.invalidKeys.clear();

            renderSettingsWorkspace({ preserveScroll: true });
            await renderStorageInfo();
            showStatus('Settings saved. Open YouTube tabs update automatically.', 'success');
            showModalStatus('Settings saved. Open YouTube tabs update automatically.', 'success');
        } catch (error) {
            showModalStatus('Save failed: ' + error.message, 'error');
        }
    }

    function discardDraft() {
        state.draftSettings = deepClone(state.resolvedSettings);
        state.dirtyKeys.clear();
        state.invalidKeys.clear();
        renderSettingsWorkspace({ preserveScroll: true });
        showModalStatus('Draft discarded. You are back in sync with stored settings.', 'info');
    }

    function restoreDefaultsDraft() {
        if (Object.keys(state.defaultSettings).length === 0) {
            showModalStatus('Defaults catalog is unavailable for this build.', 'error');
            return;
        }

        state.draftSettings = applySettingsVersion(deepClone(state.defaultSettings));
        state.invalidKeys.clear();
        state.dirtyKeys.clear();
        getSettingKeys().forEach((key) => updateDirtyStateForKey(key));
        renderSettingsWorkspace({ preserveScroll: true });
        showModalStatus('Catalog defaults loaded into the draft. Save to apply them.', 'info');
    }

    elements.exportButton.addEventListener('click', () => {
        void runWithBusyButton(elements.exportButton, 'Exporting…', exportSettings);
    });
    elements.importButton.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', (event) => {
        const [file] = event.target.files || [];
        void runWithBusyButton(elements.importButton, 'Importing…', () => importSettings(file));
    });
    elements.resetButton.addEventListener('click', () => {
        void runWithBusyButton(elements.resetButton, 'Clearing…', resetSettings);
    });
    elements.openSettingsModalButton.addEventListener('click', () => {
        void runWithBusyButton(elements.openSettingsModalButton, 'Loading…', openSettingsModal);
    });
    elements.closeSettingsModalButton.addEventListener('click', requestCloseSettingsModal);
    elements.settingsModalShell.addEventListener('click', (event) => {
        if (event.target.hasAttribute('data-close-settings-modal')) {
            requestCloseSettingsModal();
        }
    });
    let _searchDebounce = null;
    elements.settingsSearch.addEventListener('input', () => {
        state.search = elements.settingsSearch.value.trim().toLowerCase();
        updateSettingsSearchState();
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => renderSettingsWorkspace(), 200);
    });
    elements.settingsClearSearchButton.addEventListener('click', () => {
        clearTimeout(_searchDebounce);
        elements.settingsSearch.value = '';
        state.search = '';
        updateSettingsSearchState();
        renderSettingsWorkspace();
        elements.settingsSearch.focus();
    });
    elements.settingsClearFiltersButton.addEventListener('click', () => {
        clearTimeout(_searchDebounce);
        clearSettingsFilters({ focusSearch: true, announce: true });
    });
    elements.settingsEmptyResetButton.addEventListener('click', () => {
        clearTimeout(_searchDebounce);
        clearSettingsFilters({ focusSearch: true, announce: true });
    });
    elements.settingsSaveButton.addEventListener('click', () => {
        void runWithBusyButton(
            elements.settingsSaveButton,
            'Saving…',
            saveSettingsDraft,
            () => updateModalHeaderState()
        );
    });
    elements.settingsDiscardButton.addEventListener('click', discardDraft);
    elements.settingsRestoreDefaultsButton.addEventListener('click', restoreDefaultsDraft);

    document.addEventListener('keydown', (event) => {
        if (!state.modalOpen) return;
        if (event.key === 'Escape') {
            requestCloseSettingsModal();
            return;
        }
        if (event.key === 'Tab') {
            const dialog = elements.settingsModalShell.querySelector('.settings-modal');
            trapFocusWithin(dialog, event);
        }
    });

    window.addEventListener('beforeunload', (event) => {
        if (!state.modalOpen) return;
        if (state.dirtyKeys.size === 0 && state.invalidKeys.size === 0) return;
        event.preventDefault();
        event.returnValue = '';
    });

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
        if (areaName !== 'local') return;

        await renderStorageInfo();

        if (!changes[STORAGE_KEYS.settings]) return;
        if (!state.modalOpen) return;

        if (state.dirtyKeys.size === 0 && state.invalidKeys.size === 0) {
            await refreshSettingsState({ resetDraft: true });
            renderSettingsWorkspace();
        } else {
            showModalStatus('Stored settings changed elsewhere. Save or discard your draft to resync.', 'info');
        }
    });

    renderStorageInfo();
})();
