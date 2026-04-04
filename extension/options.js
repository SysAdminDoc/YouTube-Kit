// Astra Deck Options Page - Standalone settings management via chrome.storage.local
(function () {
    'use strict';

    const BRAND_NAME = 'Astra Deck';
    const SETTINGS_SOURCE_URL = chrome.runtime.getURL('ytkit.js');

    const STORAGE_KEYS = {
        settings: 'ytSuiteSettings',
        hiddenVideos: 'ytkit-hidden-videos',
        blockedChannels: 'ytkit-blocked-channels',
        bookmarks: 'ytkit-bookmarks'
    };

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
        settingsModalSummary: document.getElementById('settings-modal-summary'),
        settingsModalStatus: document.getElementById('settings-modal-status'),
        settingsSaveButton: document.getElementById('settings-save-btn'),
        settingsDiscardButton: document.getElementById('settings-discard-btn'),
        settingsRestoreDefaultsButton: document.getElementById('settings-restore-defaults-btn')
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
        defaultsLoaded: false
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

    function buildExportData(allStorage) {
        return {
            settings: allStorage[STORAGE_KEYS.settings] || {},
            hiddenVideos: allStorage[STORAGE_KEYS.hiddenVideos] || [],
            blockedChannels: allStorage[STORAGE_KEYS.blockedChannels] || [],
            bookmarks: allStorage[STORAGE_KEYS.bookmarks] || {},
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
            return compact.length > 60 ? compact.slice(0, 57) + '...' : compact;
        }
        if (Array.isArray(value)) return value.length + (value.length === 1 ? ' item' : ' items');
        if (value && typeof value === 'object') return Object.keys(value).length + ' keys';
        return 'Not set';
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

        return Array.from(keySet).sort((left, right) => humanizeKey(left).localeCompare(humanizeKey(right)));
    }

    function matchesSearch(key, value) {
        if (!state.search) return true;
        const haystack = [key, humanizeKey(key), inferGroup(key), formatValuePreview(value)].join(' ').toLowerCase();
        return haystack.includes(state.search);
    }

    function getVisibleKeys() {
        return getSettingKeys().filter((key) => {
            const value = state.draftSettings[key];
            if (!matchesSearch(key, value)) return false;
            if (state.activeGroup === 'all') return true;
            return inferGroup(key) === state.activeGroup;
        });
    }

    function findBalancedObjectLiteral(source, startToken) {
        const start = source.indexOf(startToken);
        if (start === -1) return null;

        const openIndex = source.indexOf('{', start);
        if (openIndex === -1) return null;

        let depth = 0;
        let inSingle = false;
        let inDouble = false;
        let inTemplate = false;
        let inLineComment = false;
        let inBlockComment = false;
        let escaping = false;

        for (let index = openIndex; index < source.length; index += 1) {
            const char = source[index];
            const next = source[index + 1];

            if (inLineComment) {
                if (char === '\n') inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (char === '*' && next === '/') {
                    inBlockComment = false;
                    index += 1;
                }
                continue;
            }

            if (inSingle) {
                if (!escaping && char === '\'') inSingle = false;
                escaping = char === '\\' && !escaping;
                continue;
            }

            if (inDouble) {
                if (!escaping && char === '"') inDouble = false;
                escaping = char === '\\' && !escaping;
                continue;
            }

            if (inTemplate) {
                if (!escaping && char === '`') inTemplate = false;
                escaping = char === '\\' && !escaping;
                continue;
            }

            escaping = false;

            if (char === '/' && next === '/') {
                inLineComment = true;
                index += 1;
                continue;
            }

            if (char === '/' && next === '*') {
                inBlockComment = true;
                index += 1;
                continue;
            }

            if (char === '\'') {
                inSingle = true;
                continue;
            }

            if (char === '"') {
                inDouble = true;
                continue;
            }

            if (char === '`') {
                inTemplate = true;
                continue;
            }

            if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    return source.slice(openIndex, index + 1);
                }
            }
        }

        return null;
    }

    async function loadDefaultSettingsFromSource() {
        if (state.defaultsLoaded) return;

        try {
            const response = await fetch(SETTINGS_SOURCE_URL);
            const source = await response.text();
            const objectLiteral = findBalancedObjectLiteral(source, 'defaults:');
            if (!objectLiteral) {
                throw new Error('Settings defaults were not found in ytkit.js');
            }

            const defaults = Function('"use strict"; return (' + objectLiteral + ');')();
            if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
                throw new Error('Settings defaults are not a plain object');
            }

            state.defaultSettings = deepClone(defaults);
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
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid format');
            }

            const writes = {};
            if (data.exportVersion >= 3) {
                if (data.settings && typeof data.settings === 'object') writes[STORAGE_KEYS.settings] = data.settings;
                if (Array.isArray(data.hiddenVideos)) writes[STORAGE_KEYS.hiddenVideos] = data.hiddenVideos;
                if (Array.isArray(data.blockedChannels)) writes[STORAGE_KEYS.blockedChannels] = data.blockedChannels;
                if (data.bookmarks && typeof data.bookmarks === 'object') writes[STORAGE_KEYS.bookmarks] = data.bookmarks;
            } else if (data.exportVersion >= 2) {
                if (data.settings && typeof data.settings === 'object') writes[STORAGE_KEYS.settings] = data.settings;
                if (Array.isArray(data.hiddenVideos)) writes[STORAGE_KEYS.hiddenVideos] = data.hiddenVideos;
                if (Array.isArray(data.blockedChannels)) writes[STORAGE_KEYS.blockedChannels] = data.blockedChannels;
            } else {
                writes[STORAGE_KEYS.settings] = data;
            }

            if (Object.keys(writes).length === 0) {
                throw new Error('No valid settings found in file');
            }

            await chrome.storage.local.set(writes);
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
        const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
        state.storedSettings = deepClone(result[STORAGE_KEYS.settings] || {});
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
        const visibleCount = getVisibleKeys().length;
        elements.settingsTotalCount.textContent = String(getSettingKeys().length);
        elements.settingsDirtyCount.textContent = String(state.dirtyKeys.size);
        elements.settingsSaveButton.disabled = state.dirtyKeys.size === 0 || state.invalidKeys.size > 0;
        elements.settingsDiscardButton.disabled = state.dirtyKeys.size === 0 && state.invalidKeys.size === 0;
        elements.settingsRestoreDefaultsButton.disabled = Object.keys(state.defaultSettings).length === 0;

        let summary = `${visibleCount} ${visibleCount === 1 ? 'setting' : 'settings'} visible`;
        if (state.search) {
            summary += ` for "${elements.settingsSearch.value.trim()}"`;
        }
        summary += '. Changes save straight to extension storage and update open YouTube tabs automatically.';
        if (state.invalidKeys.size > 0) {
            summary += ` ${state.invalidKeys.size} field${state.invalidKeys.size === 1 ? ' needs' : 's need'} attention before saving.`;
        }
        elements.settingsModalSummary.textContent = summary;
    }

    function updateCardState(card, key) {
        const dirty = state.dirtyKeys.has(key);
        const invalid = state.invalidKeys.has(key);
        card.classList.toggle('is-dirty', dirty);
        card.classList.toggle('is-invalid', invalid);

        const dirtyBadge = card.querySelector('.settings-item-state');
        if (dirtyBadge) {
            dirtyBadge.hidden = !dirty;
            dirtyBadge.textContent = dirty ? 'Modified' : '';
        }

        const hint = card.querySelector('.settings-item-hint');
        if (hint) {
            if (invalid) {
                hint.textContent = 'Invalid input. Fix this field before saving.';
            } else {
                const defaultValue = state.defaultSettings[key];
                hint.textContent = defaultValue === undefined
                    ? 'Stored setting with no catalog default.'
                    : `Default: ${formatValuePreview(defaultValue)}`;
            }
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

    function renderSettingsGroups() {
        const keys = getSettingKeys().filter((key) => matchesSearch(key, state.draftSettings[key]));
        const counts = new Map();
        GROUPS.forEach((group) => counts.set(group.id, 0));

        keys.forEach((key) => {
            const groupId = inferGroup(key);
            counts.set(groupId, (counts.get(groupId) || 0) + 1);
            counts.set('all', (counts.get('all') || 0) + 1);
        });

        elements.settingsGroups.innerHTML = '';
        GROUPS.forEach((group) => {
            if (group.id !== 'all' && (counts.get(group.id) || 0) === 0) return;

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'settings-group-button' + (state.activeGroup === group.id ? ' active' : '');
            button.dataset.group = group.id;

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

            elements.settingsGroups.appendChild(button);
        });
    }

    function renderTextControl(card, key, value, isMultiline) {
        const input = document.createElement(isMultiline ? 'textarea' : 'input');
        if (!isMultiline) {
            input.type = /url/i.test(key) ? 'url' : 'text';
        }
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

    function renderNumberControl(card, key, value) {
        const input = document.createElement('input');
        input.type = 'number';
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

    function renderToggleControl(card, key, value) {
        const label = document.createElement('label');
        label.className = 'settings-item-toggle';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(value);
        input.addEventListener('change', () => {
            state.draftSettings[key] = input.checked;
            state.invalidKeys.delete(key);
            updateDirtyStateForKey(key);
            updateCardState(card, key);
            updateModalHeaderState();
        });

        const track = document.createElement('span');
        track.className = 'settings-item-toggle-track';

        const text = document.createElement('span');
        text.className = 'settings-item-toggle-label';
        text.textContent = input.checked ? 'Enabled' : 'Disabled';
        input.addEventListener('change', () => {
            text.textContent = input.checked ? 'Enabled' : 'Disabled';
        });

        label.appendChild(input);
        label.appendChild(track);
        label.appendChild(text);
        return label;
    }

    function renderListControl(card, key, value, defaultValue) {
        const textarea = document.createElement('textarea');
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

    function renderJsonControl(card, key, value) {
        const textarea = document.createElement('textarea');
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

        const card = document.createElement('article');
        card.className = 'settings-item';
        card.dataset.key = key;

        const header = document.createElement('div');
        header.className = 'settings-item-header';

        const copy = document.createElement('div');
        copy.className = 'settings-item-copy';

        const title = document.createElement('h3');
        title.className = 'settings-item-title';
        title.textContent = humanizeKey(key);

        const meta = document.createElement('div');
        meta.className = 'settings-item-meta';

        const keyBadge = document.createElement('span');
        keyBadge.className = 'settings-item-badge';
        keyBadge.textContent = key;

        const groupBadge = document.createElement('span');
        groupBadge.className = 'settings-item-badge';
        groupBadge.textContent = groupLabel;

        const typeBadge = document.createElement('span');
        typeBadge.className = 'settings-item-badge';
        typeBadge.textContent = controlKind;

        const stateBadge = document.createElement('span');
        stateBadge.className = 'settings-item-badge settings-item-state';
        stateBadge.hidden = true;

        meta.appendChild(keyBadge);
        meta.appendChild(groupBadge);
        meta.appendChild(typeBadge);
        meta.appendChild(stateBadge);

        const description = document.createElement('p');
        description.className = 'settings-item-description';
        description.textContent = `Stored as ${controlKind}. Current value: ${formatValuePreview(currentValue)}.`;

        copy.appendChild(title);
        copy.appendChild(meta);
        copy.appendChild(description);
        header.appendChild(copy);
        card.appendChild(header);

        const controlWrap = document.createElement('div');
        controlWrap.className = 'settings-item-control';

        if (controlKind === 'toggle') {
            controlWrap.appendChild(renderToggleControl(card, key, currentValue));
        } else if (controlKind === 'number') {
            controlWrap.appendChild(renderNumberControl(card, key, currentValue));
        } else if (controlKind === 'list') {
            controlWrap.appendChild(renderListControl(card, key, currentValue, defaultValue));
        } else if (controlKind === 'json') {
            controlWrap.appendChild(renderJsonControl(card, key, currentValue));
        } else {
            controlWrap.appendChild(renderTextControl(card, key, currentValue, controlKind === 'textarea'));
        }

        card.appendChild(controlWrap);

        const footer = document.createElement('div');
        footer.className = 'settings-item-footer';

        const hint = document.createElement('div');
        hint.className = 'settings-item-hint';
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
            renderSettingsWorkspace();
            showModalStatus(`${humanizeKey(key)} restored to its catalog default. Save to apply.`, 'info');
        });

        footer.appendChild(resetButton);
        card.appendChild(footer);

        updateCardState(card, key);
        return card;
    }

    function renderSettingsList() {
        const visibleKeys = getVisibleKeys();
        elements.settingsList.innerHTML = '';
        elements.settingsEmpty.hidden = visibleKeys.length > 0;
        elements.settingsList.hidden = visibleKeys.length === 0;

        visibleKeys.forEach((key) => {
            elements.settingsList.appendChild(createSettingsCard(key));
        });
    }

    function renderSettingsWorkspace() {
        renderSettingsGroups();
        renderSettingsList();
        updateModalHeaderState();
    }

    async function openSettingsModal() {
        await refreshSettingsState({ resetDraft: true });
        clearModalStatus();
        state.activeGroup = 'all';
        state.search = '';
        elements.settingsSearch.value = '';
        state.modalOpen = true;
        elements.settingsModalShell.hidden = false;
        renderSettingsWorkspace();
        requestAnimationFrame(() => elements.settingsSearch.focus());
    }

    function requestCloseSettingsModal() {
        if (state.dirtyKeys.size > 0 || state.invalidKeys.size > 0) {
            const confirmed = window.confirm('Discard the current settings draft and close the modal?');
            if (!confirmed) return;
        }

        state.modalOpen = false;
        elements.settingsModalShell.hidden = true;
        clearModalStatus();
    }

    async function saveSettingsDraft() {
        if (state.invalidKeys.size > 0) {
            showModalStatus('Fix invalid fields before saving.', 'error');
            return;
        }

        try {
            await chrome.storage.local.set({
                [STORAGE_KEYS.settings]: deepClone(state.draftSettings)
            });

            state.storedSettings = deepClone(state.draftSettings);
            state.resolvedSettings = deepClone(state.draftSettings);
            state.dirtyKeys.clear();
            state.invalidKeys.clear();

            renderSettingsWorkspace();
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
        renderSettingsWorkspace();
        showModalStatus('Draft discarded. You are back in sync with stored settings.', 'info');
    }

    function restoreDefaultsDraft() {
        if (Object.keys(state.defaultSettings).length === 0) {
            showModalStatus('Defaults catalog is unavailable for this build.', 'error');
            return;
        }

        state.draftSettings = deepClone(state.defaultSettings);
        state.invalidKeys.clear();
        state.dirtyKeys.clear();
        getSettingKeys().forEach((key) => updateDirtyStateForKey(key));
        renderSettingsWorkspace();
        showModalStatus('Catalog defaults loaded into the draft. Save to apply them.', 'info');
    }

    elements.exportButton.addEventListener('click', exportSettings);
    elements.importButton.addEventListener('click', () => elements.importFile.click());
    elements.importFile.addEventListener('change', (event) => importSettings(event.target.files[0]));
    elements.resetButton.addEventListener('click', resetSettings);
    elements.openSettingsModalButton.addEventListener('click', openSettingsModal);
    elements.closeSettingsModalButton.addEventListener('click', requestCloseSettingsModal);
    elements.settingsModalShell.addEventListener('click', (event) => {
        if (event.target.hasAttribute('data-close-settings-modal')) {
            requestCloseSettingsModal();
        }
    });
    elements.settingsSearch.addEventListener('input', () => {
        state.search = elements.settingsSearch.value.trim().toLowerCase();
        renderSettingsWorkspace();
    });
    elements.settingsSaveButton.addEventListener('click', saveSettingsDraft);
    elements.settingsDiscardButton.addEventListener('click', discardDraft);
    elements.settingsRestoreDefaultsButton.addEventListener('click', restoreDefaultsDraft);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.modalOpen) {
            requestCloseSettingsModal();
        }
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
    loadDefaultSettingsFromSource();
})();
