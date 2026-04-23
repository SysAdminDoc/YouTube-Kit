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

    // Lucide-style 14×14 stroke icons per group. Element specs (not strings)
    // so the renderer can build them with DOM APIs — MV3 options page runs
    // under `script-src 'self'` so innerHTML would trip TrustedTypes on some
    // browsers and would require a policy dance for zero win here.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const GROUPS = [
        { id: 'all',        label: 'All Settings',  icon: [
            { tag: 'rect', attrs: { x: '2', y: '2',  width: '5', height: '5', rx: '1' } },
            { tag: 'rect', attrs: { x: '9', y: '2',  width: '5', height: '5', rx: '1' } },
            { tag: 'rect', attrs: { x: '2', y: '9',  width: '5', height: '5', rx: '1' } },
            { tag: 'rect', attrs: { x: '9', y: '9',  width: '5', height: '5', rx: '1' } },
        ] },
        { id: 'interface',  label: 'Interface',     icon: [
            { tag: 'rect', attrs: { x: '2', y: '2',  width: '12', height: '12', rx: '2' } },
            { tag: 'line', attrs: { x1: '2', y1: '6',  x2: '14', y2: '6' } },
            { tag: 'line', attrs: { x1: '6', y1: '6',  x2: '6',  y2: '14' } },
        ] },
        { id: 'watch',      label: 'Watch Page',    icon: [
            { tag: 'rect',     attrs: { x: '2', y: '3', width: '12', height: '9', rx: '1.5' } },
            { tag: 'polygon',  attrs: { points: '7 6 10.5 7.5 7 9' } },
        ] },
        { id: 'player',     label: 'Video Player',  icon: [
            { tag: 'circle',   attrs: { cx: '8', cy: '8', r: '6' } },
            { tag: 'polygon',  attrs: { points: '7 5.5 11 8 7 10.5' } },
        ] },
        { id: 'comments',   label: 'Comments',      icon: [
            { tag: 'path',  attrs: { d: 'M3 4h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z' } },
        ] },
        { id: 'chat',       label: 'Live Chat',     icon: [
            { tag: 'path', attrs: { d: 'M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5v-5z' } },
            { tag: 'line', attrs: { x1: '5.5', y1: '7',  x2: '10.5', y2: '7' } },
        ] },
        { id: 'downloads',  label: 'Downloads',     icon: [
            { tag: 'line',    attrs: { x1: '8', y1: '2', x2: '8', y2: '10' } },
            { tag: 'polyline', attrs: { points: '4.5 7 8 10.5 11.5 7' } },
            { tag: 'line',    attrs: { x1: '2.5', y1: '13.5', x2: '13.5', y2: '13.5' } },
        ] },
        { id: 'content',    label: 'Content Rules', icon: [
            { tag: 'rect', attrs: { x: '2.5', y: '2.5', width: '11', height: '11', rx: '1.5' } },
            { tag: 'line', attrs: { x1: '5', y1: '6',  x2: '11', y2: '6' } },
            { tag: 'line', attrs: { x1: '5', y1: '9',  x2: '11', y2: '9' } },
            { tag: 'line', attrs: { x1: '5', y1: '12', x2: '9',  y2: '12' } },
        ] },
        { id: 'behavior',   label: 'Behavior',      icon: [
            { tag: 'path',   attrs: { d: 'M3 10.5a5 5 0 1 0 5-8.5' } },
            { tag: 'polyline', attrs: { points: '5 2 8 2 8 5' } },
        ] },
        { id: 'advanced',   label: 'Advanced',      icon: [
            { tag: 'circle', attrs: { cx: '8', cy: '8', r: '2.4' } },
            { tag: 'path',   attrs: { d: 'M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.3 3.3l1.55 1.55M11.15 11.15l1.55 1.55M3.3 12.7l1.55-1.55M11.15 4.85l1.55-1.55' } },
        ] },
    ];

    function createGroupIcon(spec) {
        if (!Array.isArray(spec) || spec.length === 0) return null;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'settings-group-icon');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.55');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        for (const { tag, attrs } of spec) {
            const el = document.createElementNS(SVG_NS, tag);
            for (const [name, value] of Object.entries(attrs)) {
                el.setAttribute(name, value);
            }
            svg.appendChild(el);
        }
        return svg;
    }

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
        // Maps invalid keys to a short human explanation (e.g. list parse error)
        // so the card hint can surface the reason instead of a generic message.
        invalidReasons: {},
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
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
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

    function safeSerialize(value, sortKeys = false) {
        try {
            if (sortKeys) {
                return JSON.stringify(value, (_, v) =>
                    v && typeof v === 'object' && !Array.isArray(v)
                        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
                        : v
                );
            }
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    function areValuesEqual(left, right) {
        // Sort object keys for order-independent comparison
        return safeSerialize(left, true) === safeSerialize(right, true);
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

    function getImportedFilteredVideoPosts(data) {
        if (!isPlainObject(data)) return null;
        if (Array.isArray(data.hiddenVideos)) return data.hiddenVideos;
        if (Array.isArray(data.filteredVideoPosts)) return data.filteredVideoPosts;
        return null;
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

    // v3.14.0: Import path must not silently overwrite the exporter's settings
    // version. Preserving `_settingsVersion` surfaces cross-version imports so
    // the runtime's migration code (driven off that version) can actually run,
    // rather than being bypassed by a current-version stamp.
    function applyImportedSettingsVersion(settings) {
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
        const next = sanitizeSettingsObject(settings);
        const importedVersion = Number(settings._settingsVersion);
        const current = Number(state.settingsVersion);
        if (Number.isFinite(importedVersion) && importedVersion > 0) {
            next._settingsVersion = importedVersion;
            if (Number.isFinite(current) && current > 0 && importedVersion > current) {
                console.warn('[Astra Deck] Imported settings version', importedVersion,
                    'is newer than current', current, '— unknown keys may be dropped');
            }
        } else if (Number.isFinite(current) && current > 0) {
            // No version on import — treat as legacy/v0, stamp current so the
            // migration chain runs from the beginning on next load.
            next._settingsVersion = 0;
        }
        return next;
    }

    function buildExportData(allStorage) {
        const mergedSettings = mergeLegacySettings(
            allStorage[STORAGE_KEYS.settings] || {},
            getLegacySidebarOrder(allStorage)
        );

        const hiddenVideos = sanitizeImportedHiddenVideos(allStorage[STORAGE_KEYS.hiddenVideos]);

        return {
            settings: applySettingsVersion(mergedSettings),
            hiddenVideos,
            filteredVideoPosts: hiddenVideos,
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

    function confirmAction({
        eyebrow = 'Confirm',
        title,
        message,
        confirmLabel = 'Continue',
        cancelLabel = 'Cancel',
        tone = 'default'
    }) {
        return new Promise((resolve) => {
            const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

            const shell = document.createElement('div');
            shell.className = 'confirm-shell';

            const backdrop = document.createElement('div');
            backdrop.className = 'confirm-backdrop';

            const dialog = document.createElement('section');
            dialog.className = 'confirm-dialog' + (tone === 'danger' ? ' is-danger' : '');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', 'confirm-title');
            dialog.setAttribute('aria-describedby', 'confirm-copy');

            const eyebrowEl = document.createElement('span');
            eyebrowEl.className = 'confirm-eyebrow';
            eyebrowEl.textContent = eyebrow;

            const titleEl = document.createElement('h2');
            titleEl.className = 'confirm-title';
            titleEl.id = 'confirm-title';
            titleEl.textContent = title;

            const copyEl = document.createElement('p');
            copyEl.className = 'confirm-copy';
            copyEl.id = 'confirm-copy';
            copyEl.textContent = message;

            const actions = document.createElement('div');
            actions.className = 'confirm-actions';

            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.textContent = cancelLabel;

            const confirmButton = document.createElement('button');
            confirmButton.type = 'button';
            confirmButton.className = tone === 'danger' ? 'danger' : 'primary';
            confirmButton.textContent = confirmLabel;

            actions.appendChild(cancelButton);
            actions.appendChild(confirmButton);
            dialog.appendChild(eyebrowEl);
            dialog.appendChild(titleEl);
            dialog.appendChild(copyEl);
            dialog.appendChild(actions);
            shell.appendChild(backdrop);
            shell.appendChild(dialog);
            document.body.appendChild(shell);

            const finish = (confirmed) => {
                shell.removeEventListener('keydown', handleKeydown);
                shell.remove();
                requestAnimationFrame(() => previousFocus?.focus?.());
                resolve(confirmed);
            };

            function handleKeydown(event) {
                event.stopPropagation();
                if (event.key === 'Escape') {
                    event.preventDefault();
                    finish(false);
                    return;
                }
                trapFocusWithin(dialog, event);
            }

            backdrop.addEventListener('click', () => finish(false));
            cancelButton.addEventListener('click', () => finish(false));
            confirmButton.addEventListener('click', () => finish(true));
            shell.addEventListener('keydown', handleKeydown);
            requestAnimationFrame(() => (tone === 'danger' ? cancelButton : confirmButton).focus());
        });
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
                if (!response.ok) {
                    throw new Error(`Failed to load settings source: HTTP ${response.status}`);
                }
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
                `Local storage is ready: ${summary.keys} ${summary.keys === 1 ? 'key' : 'keys'} using about ${summary.sizeText}. ` +
                `${summary.hiddenVideos} hidden video ${summary.hiddenVideos === 1 ? 'rule' : 'rules'}, ` +
                `${summary.blockedChannels} blocked ${summary.blockedChannels === 1 ? 'channel' : 'channels'}, ` +
                `and ${summary.bookmarks} ${summary.bookmarks === 1 ? 'bookmark' : 'bookmarks'} are available for backup or reset.`;
        } catch (error) {
            elements.storageInfo.textContent = 'Unable to read extension storage.';
            elements.statKeys.textContent = '0';
            elements.statSize.textContent = '0 B';
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
            setTimeout(() => URL.revokeObjectURL(url), 60000);
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
            // v3 is the current export format. Any forward-compatible v3+
            // payload uses the same top-level shape (settings / hiddenVideos /
            // blockedChannels / bookmarks), so future bumps can still import
            // safely and `applyImportedSettingsVersion` handles newer
            // `_settingsVersion` values with a console warning rather than a
            // silent drop. Previously an arbitrary `< 100` cap rejected any
            // forward-compatible export shipped by a newer build.
            if (data.exportVersion >= 3) {
                const filteredVideoPosts = getImportedFilteredVideoPosts(data);
                if (isPlainObject(data.settings)) writes[STORAGE_KEYS.settings] = applyImportedSettingsVersion(data.settings);
                if (filteredVideoPosts) writes[STORAGE_KEYS.hiddenVideos] = sanitizeImportedHiddenVideos(filteredVideoPosts);
                if (Array.isArray(data.blockedChannels)) writes[STORAGE_KEYS.blockedChannels] = sanitizeImportedBlockedChannels(data.blockedChannels);
                if (isPlainObject(data.bookmarks)) writes[STORAGE_KEYS.bookmarks] = sanitizeImportedBookmarks(data.bookmarks);
            } else if (data.exportVersion >= 2) {
                const filteredVideoPosts = getImportedFilteredVideoPosts(data);
                if (isPlainObject(data.settings)) writes[STORAGE_KEYS.settings] = applyImportedSettingsVersion(data.settings);
                if (filteredVideoPosts) writes[STORAGE_KEYS.hiddenVideos] = sanitizeImportedHiddenVideos(filteredVideoPosts);
                if (Array.isArray(data.blockedChannels)) writes[STORAGE_KEYS.blockedChannels] = sanitizeImportedBlockedChannels(data.blockedChannels);
            } else {
                if (isPlainObject(data)) {
                    writes[STORAGE_KEYS.settings] = applyImportedSettingsVersion(data);
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
        const confirmed = await confirmAction({
            eyebrow: 'Destructive action',
            title: 'Reset all local data?',
            message: `This clears ${BRAND_NAME} settings, hidden videos, blocked channels, and bookmarks from extension storage.`,
            confirmLabel: 'Reset All Data',
            tone: 'danger'
        });
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
            state.invalidReasons = {};
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

        // Show footer only when there's something to communicate (complex items always show it)
        const footer = card.querySelector('.settings-item-footer');
        if (footer && !card.classList.contains('is-complex')) {
            footer.hidden = !dirty && !invalid;
        }

        const hint = card.querySelector('.settings-item-hint');
        if (hint) {
            if (invalid) {
                // Render the specific reason when a control captured one
                // (list/json parse error). Without this the user sees a
                // generic "Fix this field" with no clue what broke.
                const detail = state.invalidReasons?.[key];
                hint.textContent = detail
                    ? `Fix this field before saving. ${detail}`
                    : 'Fix this field before saving. Invalid draft values stay local to this editor.';
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
            if (state.activeGroup === group.id) {
                button.setAttribute('aria-current', 'true');
            } else {
                button.removeAttribute('aria-current');
            }

            const leading = document.createElement('span');
            leading.className = 'settings-group-button-lead';

            const icon = createGroupIcon(group.icon);
            if (icon) leading.appendChild(icon);

            const label = document.createElement('span');
            label.className = 'settings-group-button-label';
            label.textContent = group.label;
            leading.appendChild(label);

            const count = document.createElement('span');
            count.className = 'settings-group-count';
            count.textContent = String(counts.get(group.id) || 0);

            button.appendChild(leading);
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
            delete state.invalidReasons[key];
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
                state.invalidReasons[key] = 'Enter a number.';
            } else {
                const nextValue = Number(input.value);
                if (Number.isNaN(nextValue)) {
                    state.invalidKeys.add(key);
                    state.invalidReasons[key] = 'Not a valid number.';
                } else {
                    state.draftSettings[key] = nextValue;
                    state.invalidKeys.delete(key);
                    delete state.invalidReasons[key];
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

        input.addEventListener('change', () => {
            state.draftSettings[key] = input.checked;
            state.invalidKeys.delete(key);
            delete state.invalidReasons[key];
            updateDirtyStateForKey(key);
            updateCardState(card, key);
            updateModalHeaderState();
        });

        label.appendChild(input);
        label.appendChild(track);
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
                delete state.invalidReasons[key];
                updateDirtyStateForKey(key);
            } catch (error) {
                state.invalidKeys.add(key);
                state.invalidReasons[key] = error?.message
                    ? `${error.message} (one value per line).`
                    : 'Could not parse list (one value per line).';
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
                const parsed = JSON.parse(textarea.value);
                // Guard against replacing an object/array with a primitive
                if (value != null && typeof value === 'object' && (typeof parsed !== 'object' || parsed === null)) {
                    state.invalidKeys.add(key);
                    state.invalidReasons[key] = 'Expected an object or array, got a primitive value.';
                } else {
                    state.draftSettings[key] = parsed;
                    state.invalidKeys.delete(key);
                    delete state.invalidReasons[key];
                    updateDirtyStateForKey(key);
                }
            } catch (error) {
                state.invalidKeys.add(key);
                state.invalidReasons[key] = error?.message
                    ? `Invalid JSON: ${error.message}.`
                    : 'Invalid JSON payload.';
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
        const isToggle = controlKind === 'toggle';
        const isComplex = controlKind === 'list' || controlKind === 'json' || controlKind === 'textarea';
        const idBase = toDomIdFragment(key);
        const controlMeta = {
            controlId: `settings-control-${idBase}`,
            titleId: `settings-title-${idBase}`,
            descriptionId: `settings-description-${idBase}`,
            hintId: `settings-hint-${idBase}`
        };

        const card = document.createElement('article');
        card.className = 'settings-item' + (isToggle ? ' is-toggle' : '') + (isComplex ? ' is-complex' : '');
        card.dataset.key = key;
        card.tabIndex = -1;
        card.title = key;
        card.setAttribute('aria-labelledby', controlMeta.titleId);

        // ── Title row (shared by all variants) ──
        const titleRow = document.createElement('div');
        titleRow.className = 'settings-item-title-row';

        const title = document.createElement('h3');
        title.className = 'settings-item-title';
        title.id = controlMeta.titleId;
        title.textContent = humanizeKey(key);
        titleRow.appendChild(title);

        const groupTag = document.createElement('span');
        groupTag.className = 'settings-item-group';
        groupTag.textContent = groupLabel;
        titleRow.appendChild(groupTag);

        if (isComplex) {
            const typeBadge = document.createElement('span');
            typeBadge.className = 'settings-item-type';
            typeBadge.textContent = controlKindLabel;
            titleRow.appendChild(typeBadge);
        }

        const stateBadge = document.createElement('span');
        stateBadge.className = 'settings-item-badge settings-item-state';
        stateBadge.hidden = true;
        titleRow.appendChild(stateBadge);

        if (isToggle) {
            // Compact flex row: title-row left, toggle right
            const right = document.createElement('div');
            right.className = 'settings-item-right';
            right.appendChild(renderToggleControl(card, key, currentValue, controlMeta));
            card.appendChild(titleRow);
            card.appendChild(right);
        } else {
            card.appendChild(titleRow);

            if (isComplex) {
                const description = document.createElement('p');
                description.className = 'settings-item-description';
                description.id = controlMeta.descriptionId;
                description.textContent = `Editing a ${controlKindLabel.toLowerCase()} setting. Draft: ${formatValuePreview(currentValue)}.`;
                card.appendChild(description);
            }

            const controlWrap = document.createElement('div');
            controlWrap.className = 'settings-item-control';

            if (controlKind === 'number') {
                controlWrap.appendChild(renderNumberControl(card, key, currentValue, controlMeta));
            } else if (controlKind === 'list') {
                controlWrap.appendChild(renderListControl(card, key, currentValue, defaultValue, controlMeta));
            } else if (controlKind === 'json') {
                controlWrap.appendChild(renderJsonControl(card, key, currentValue, controlMeta));
            } else {
                controlWrap.appendChild(renderTextControl(card, key, currentValue, controlKind === 'textarea', controlMeta));
            }

            card.appendChild(controlWrap);
        }

        // ── Footer (hidden until dirty/invalid for toggle+text/number; always shown for complex) ──
        const footer = document.createElement('div');
        footer.className = 'settings-item-footer';
        if (!isComplex) {
            footer.hidden = true;
        }

        const hint = document.createElement('div');
        hint.className = 'settings-item-hint';
        hint.id = controlMeta.hintId;
        footer.appendChild(hint);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'settings-reset-inline';
        resetButton.textContent = 'Reset';
        resetButton.disabled = defaultValue === undefined;
        if (defaultValue === undefined) {
            resetButton.title = 'No catalog default is available for this setting.';
            resetButton.setAttribute('aria-label', `Reset ${humanizeKey(key)} (no catalog default available)`);
        } else {
            resetButton.title = `Reset ${humanizeKey(key)} to ${formatValuePreview(defaultValue)}`;
            resetButton.setAttribute('aria-label', `Reset ${humanizeKey(key)} to ${formatValuePreview(defaultValue)}`);
        }
        resetButton.addEventListener('click', () => {
            if (defaultValue === undefined) return;
            state.draftSettings[key] = deepClone(defaultValue);
            state.invalidKeys.delete(key);
            delete state.invalidReasons[key];
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

    async function requestCloseSettingsModal() {
        if (state.dirtyKeys.size > 0 || state.invalidKeys.size > 0) {
            const draftPieces = [];
            if (state.dirtyKeys.size > 0) {
                draftPieces.push(`${state.dirtyKeys.size} unsaved ${pluralize(state.dirtyKeys.size, 'change')}`);
            }
            if (state.invalidKeys.size > 0) {
                draftPieces.push(`${state.invalidKeys.size} ${pluralize(state.invalidKeys.size, 'invalid field')}`);
            }
            const confirmed = await confirmAction({
                eyebrow: 'Unsaved draft',
                title: 'Close without saving?',
                message: `This will discard ${draftPieces.join(' and ')} and close the settings editor.`,
                confirmLabel: 'Discard Draft',
                tone: 'danger'
            });
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
            // Merge-on-save: read latest stored settings and apply only the
            // keys the user actually changed.  This preserves external changes
            // (e.g. popup toggles in another tab) to keys the user did NOT
            // touch in this editing session.
            let mergedSettings;
            if (state.dirtyKeys.size > 0) {
                const freshStorage = await chrome.storage.local.get(STORAGE_KEYS.settings);
                const latestStored = freshStorage[STORAGE_KEYS.settings] || {};
                const base = { ...deepClone(state.defaultSettings), ...deepClone(latestStored) };
                for (const key of state.dirtyKeys) {
                    base[key] = deepClone(state.draftSettings[key]);
                }
                mergedSettings = base;
            } else {
                mergedSettings = deepClone(state.draftSettings);
            }
            const nextStoredSettings = applySettingsVersion(mergedSettings);
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
            state.invalidReasons = {};

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
        state.invalidReasons = {};
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
        state.invalidReasons = {};
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
        void runWithBusyButton(elements.resetButton, 'Confirming…', resetSettings);
    });
    elements.openSettingsModalButton.addEventListener('click', () => {
        void runWithBusyButton(elements.openSettingsModalButton, 'Loading…', openSettingsModal);
    });
    elements.closeSettingsModalButton.addEventListener('click', () => {
        void requestCloseSettingsModal();
    });
    elements.settingsModalShell.addEventListener('click', (event) => {
        if (event.target.hasAttribute('data-close-settings-modal')) {
            void requestCloseSettingsModal();
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
            void requestCloseSettingsModal();
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

    chrome.storage.onChanged.addListener((changes, areaName) => {
        void (async () => {
            try {
                if (areaName !== 'local') return;

                await renderStorageInfo();

                if (!changes[STORAGE_KEYS.settings]) return;
                if (!state.modalOpen) return;

                // If the settings change was triggered by our own save,
                // saveSettingsDraft already re-rendered with preserveScroll:true
                // and updated state.storedSettings before this event fires.
                // Re-rendering here would scroll the list back to the top.
                const newValue = changes[STORAGE_KEYS.settings].newValue;
                if (newValue && areValuesEqual(newValue, state.storedSettings)) return;

                if (state.dirtyKeys.size === 0 && state.invalidKeys.size === 0) {
                    await refreshSettingsState({ resetDraft: true });
                    renderSettingsWorkspace();
                } else {
                    showModalStatus('Stored settings changed elsewhere. Save or discard your draft to resync.', 'info');
                }
            } catch (error) {
                console.warn('[Astra Deck options] Failed to process storage change:', error);
                showStatus('Storage refresh failed: ' + error.message, 'error');
            }
        })();
    });

    void renderStorageInfo().catch((error) => {
        console.warn('[Astra Deck options] Failed to render storage info:', error);
        showStatus('Could not read extension storage: ' + error.message, 'error');
    });
})();
