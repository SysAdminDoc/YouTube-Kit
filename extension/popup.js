// Astra Deck — Toolbar Popup
// Quick-toggle 15 of the most-used features without opening the full panel.

const QUICK_TOGGLES = [
    { key: 'removeAllShorts',        name: 'Hide Shorts',            desc: 'Remove Shorts from feeds' },
    { key: 'hideRelatedVideos',      name: 'Hide Related',           desc: 'No related panel on watch' },
    { key: 'sponsorBlock',           name: 'SponsorBlock',           desc: 'Skip sponsored segments' },
    { key: 'deArrow',                name: 'DeArrow',                desc: 'Better titles & thumbnails' },
    { key: 'commentSearch',          name: 'Comment Search',         desc: 'Filter comments on watch pages' },
    { key: 'disableAutoplayNext',    name: 'No Autoplay',            desc: 'Stop auto-advance to next' },
    { key: 'disableInfiniteScroll',  name: 'Cap Scroll',             desc: 'Stop infinite scroll' },
    { key: 'persistentSpeed',        name: 'Persistent Speed',       desc: 'Remember playback rate' },
    { key: 'blueLightFilter',        name: 'Blue-Light Filter',      desc: 'Warmer colors' },
    { key: 'cleanShareUrls',         name: 'Clean URLs',             desc: 'Strip tracking params' },
    { key: 'autoTheaterMode',        name: 'Auto Theater',           desc: 'Default to theater view' },
    { key: 'transcriptViewer',       name: 'Transcript Sidebar',     desc: 'Clickable transcript + export' },
    { key: 'miniPlayerBar',          name: 'Mini Player Bar',        desc: 'Floating bar on scroll' },
    { key: 'digitalWellbeing',       name: 'Digital Wellbeing',      desc: 'Break reminders + daily cap' },
    { key: 'debugMode',              name: 'Debug Mode',             desc: 'Verbose console logging' },
];

const SETTINGS_STORAGE_KEY = 'ytSuiteSettings';
const PANEL_OPEN_MESSAGE = 'YTKIT_OPEN_PANEL';
const QUICK_TOGGLE_KEYS = QUICK_TOGGLES.map((toggle) => toggle.key);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const YOUTUBE_TAB_URLS = [
    '*://youtube.com/*',
    '*://*.youtube.com/*',
    '*://youtube-nocookie.com/*',
    '*://*.youtube-nocookie.com/*',
    '*://youtu.be/*'
];
const popupState = {
    settings: {},
    activeTab: null,
    statusTimer: null
};

const $ = (s) => document.querySelector(s);
const list = $('#toggles');
const q = $('#q');
const enabledCount = $('#enabledCount');
const contextState = $('#contextState');
const supportNote = $('#supportNote');
const statusBanner = $('#status');
const clearSearchButton = $('#clearSearch');
const openPanelButton = $('#openPanel');
const openOptionsButton = $('#openOptions');

function getVersion() {
    try { return (chrome.runtime.getManifest().version || '—'); } catch { return '—'; }
}
$('#version').textContent = 'v' + getVersion();

function storageGet(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (items) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(items || {});
        });
    });
}

function storageSet(entries) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(entries, () => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve();
        });
    });
}

function storageRemove(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve();
        });
    });
}

function normalizeStoredSettings(items) {
    const rawSettings = items?.[SETTINGS_STORAGE_KEY];
    const settings = {};
    const legacyKeys = [];

    if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
        for (const [key, value] of Object.entries(rawSettings)) {
            if (UNSAFE_OBJECT_KEYS.has(key)) continue;
            settings[key] = value;
        }
    }

    for (const key of QUICK_TOGGLE_KEYS) {
        if (typeof items?.[key] !== 'boolean') continue;
        legacyKeys.push(key);
        if (typeof settings[key] === 'undefined') {
            settings[key] = items[key];
        }
    }

    return { settings, legacyKeys };
}

async function loadSettings() {
    const items = await storageGet([SETTINGS_STORAGE_KEY, ...QUICK_TOGGLE_KEYS]);
    const normalized = normalizeStoredSettings(items);

    // Migrate previously broken popup writes from stray top-level keys into the
    // nested settings object the extension actually reads.
    if (normalized.legacyKeys.length > 0) {
        await storageSet({ [SETTINGS_STORAGE_KEY]: normalized.settings });
        await storageRemove(normalized.legacyKeys);
    }

    popupState.settings = normalized.settings;
    return popupState.settings;
}

async function writeSetting(key, value) {
    const items = await storageGet([SETTINGS_STORAGE_KEY, ...QUICK_TOGGLE_KEYS]);
    const normalized = normalizeStoredSettings(items);
    const nextSettings = {
        ...normalized.settings,
        [key]: value
    };

    await storageSet({ [SETTINGS_STORAGE_KEY]: nextSettings });
    if (normalized.legacyKeys.length > 0) {
        await storageRemove(normalized.legacyKeys);
    }

    popupState.settings = nextSettings;
    return nextSettings;
}

function isAnyYouTubeUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        return parsed.hostname === 'youtu.be'
            || parsed.hostname === 'youtube.com'
            || parsed.hostname === 'youtube-nocookie.com'
            || parsed.hostname.endsWith('.youtube.com')
            || parsed.hostname.endsWith('.youtube-nocookie.com');
    } catch {
        return false;
    }
}

function isSupportedInlinePanelUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        const hostname = parsed.hostname;

        if (hostname === 'm.youtube.com' || hostname === 'studio.youtube.com') {
            return false;
        }
        if (parsed.pathname.startsWith('/live_chat')) {
            return false;
        }

        return hostname === 'youtu.be'
            || hostname === 'youtube.com'
            || hostname === 'youtube-nocookie.com'
            || hostname.endsWith('.youtube.com')
            || hostname.endsWith('.youtube-nocookie.com');
    } catch {
        return false;
    }
}

function showStatus(message = '', type = 'info', durationMs = 2400) {
    if (popupState.statusTimer) {
        clearTimeout(popupState.statusTimer);
        popupState.statusTimer = null;
    }

    if (!message) {
        statusBanner.textContent = '';
        statusBanner.className = 'status-banner';
        return;
    }

    statusBanner.textContent = message;
    statusBanner.className = `status-banner is-visible status-${type}`;
    if (durationMs > 0) {
        popupState.statusTimer = setTimeout(() => {
            statusBanner.textContent = '';
            statusBanner.className = 'status-banner';
            popupState.statusTimer = null;
        }, durationMs);
    }
}

function updateSummary(settings) {
    const enabled = QUICK_TOGGLE_KEYS.reduce((count, key) => count + (settings[key] ? 1 : 0), 0);
    enabledCount.textContent = String(enabled);
}

function updateSearchState() {
    clearSearchButton.hidden = !q.value.trim();
}

function getTabContext(tab) {
    const url = tab?.url || '';
    if (isSupportedInlinePanelUrl(url)) {
        return {
            label: 'This Tab',
            note: 'Open the full Astra Deck workspace directly inside this YouTube page.',
            openLabel: 'Open Settings On This Tab'
        };
    }
    if (isAnyYouTubeUrl(url)) {
        return {
            label: 'YouTube Tab',
            note: 'This page cannot host the inline workspace, but the options page is ready whenever you need the full editor.',
            openLabel: 'Open Full Settings'
        };
    }
    return {
        label: 'Any Tab',
        note: 'Quick toggles still sync to open YouTube tabs. Open YouTube first if you want the full in-page workspace.',
        openLabel: 'Open YouTube First'
    };
}

function updateContext(tab) {
    popupState.activeTab = tab || null;
    const nextContext = getTabContext(tab);
    contextState.textContent = nextContext.label;
    supportNote.textContent = nextContext.note;
    openPanelButton.textContent = nextContext.openLabel;
}

function renderLoading() {
    list.textContent = '';
    for (let index = 0; index < 5; index += 1) {
        const skeleton = document.createElement('div');
        skeleton.className = 'toggle-skeleton';

        const copy = document.createElement('div');
        copy.className = 'skeleton-copy';

        const linePrimary = document.createElement('div');
        linePrimary.className = 'skeleton-line';
        const lineSecondary = document.createElement('div');
        lineSecondary.className = 'skeleton-line short';

        copy.appendChild(linePrimary);
        copy.appendChild(lineSecondary);
        skeleton.appendChild(copy);
        list.appendChild(skeleton);
    }
}

function renderEmpty(filter) {
    const empty = document.createElement('div');
    empty.className = 'empty';

    const title = document.createElement('span');
    title.className = 'empty-title';
    title.textContent = filter ? 'No quick toggles match' : 'No quick toggles available';

    const copy = document.createElement('span');
    copy.className = 'empty-copy';
    copy.textContent = filter
        ? 'Clear the filter to see every quick control again.'
        : 'The popup could not load any quick controls right now.';

    empty.appendChild(title);
    empty.appendChild(copy);

    if (filter) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'empty-action';
        action.textContent = 'Clear Filter';
        action.addEventListener('click', () => {
            q.value = '';
            updateSearchState();
            render(popupState.settings, '');
            q.focus();
        });
        empty.appendChild(action);
    }

    list.appendChild(empty);
}

function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
        if (!tabId) {
            resolve(false);
            return;
        }
        try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                resolve(!chrome.runtime.lastError && response?.ok !== false);
            });
        } catch (_) {
            resolve(false);
        }
    });
}

async function broadcast(key, value) {
    try {
        const tabs = await chrome.tabs.query({ url: YOUTUBE_TAB_URLS });
        for (const tab of tabs) {
            try {
                chrome.tabs.sendMessage(tab.id, { type: 'YTKIT_SETTING_CHANGED', key, value }, () => {
                    // Swallow "Receiving end does not exist" — tab may not have loaded ytkit.js yet
                    void chrome.runtime.lastError;
                });
            } catch (_) {}
        }
    } catch (_) {}
}

function render(settings, filter) {
    const term = (filter || '').toLowerCase().trim();
    const items = QUICK_TOGGLES.filter((t) =>
        !term || t.name.toLowerCase().includes(term) || t.desc.toLowerCase().includes(term) || t.key.toLowerCase().includes(term)
    );
    list.textContent = '';
    updateSummary(settings);
    updateSearchState();
    if (!items.length) {
        renderEmpty(term);
        return;
    }
    for (const t of items) {
        const on = Boolean(settings[t.key]);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'toggle' + (on ? ' on' : '');
        row.dataset.key = t.key;
        row.setAttribute('role', 'switch');
        row.setAttribute('aria-checked', String(on));

        const label = document.createElement('div');
        label.className = 'label';
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = t.name;
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = t.desc;
        label.appendChild(name);
        label.appendChild(desc);

        const toggleSwitch = document.createElement('div');
        toggleSwitch.className = 'switch';

        row.appendChild(label);
        row.appendChild(toggleSwitch);
        row.addEventListener('click', async () => {
            row.disabled = true;
            try {
                const next = !Boolean(popupState.settings[t.key]);
                await writeSetting(t.key, next);
                render(popupState.settings, q.value);
                void broadcast(t.key, next);
                showStatus(`${t.name} ${next ? 'enabled' : 'disabled'}.`, 'success');
            } catch (error) {
                console.warn('[Astra Deck popup] Failed to toggle setting:', error);
                showStatus(`Couldn't update ${t.name}. Try again.`, 'error', 4200);
            } finally {
                row.disabled = false;
            }
        });
        list.appendChild(row);
    }
}

(async () => {
    renderLoading();
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        updateContext(tab || null);
    } catch {
        updateContext(null);
    }

    try {
        const settings = await loadSettings();
        render(settings, '');
    } catch (error) {
        console.warn('[Astra Deck popup] Failed to load settings:', error);
        render({}, '');
        showStatus('Quick controls could not be loaded. Try reopening the popup.', 'error', 5000);
    }

    q.addEventListener('input', () => {
        render(popupState.settings, q.value);
    });
    clearSearchButton.addEventListener('click', () => {
        q.value = '';
        render(popupState.settings, '');
        q.focus();
    });

    if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            if (!changes[SETTINGS_STORAGE_KEY] && !QUICK_TOGGLE_KEYS.some((key) => changes[key])) return;
            void loadSettings().then((settings) => {
                render(settings, q.value);
            }).catch((error) => {
                console.warn('[Astra Deck popup] Failed to refresh settings:', error);
            });
        });
    }

    openPanelButton.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id && isSupportedInlinePanelUrl(tab.url || '')) {
            const opened = await sendTabMessage(tab.id, { type: PANEL_OPEN_MESSAGE });
            if (opened) {
                window.close();
                return;
            }
        }

        if (isAnyYouTubeUrl(tab?.url || '')) {
            chrome.runtime.openOptionsPage();
            window.close();
            return;
        }

        await chrome.tabs.create({ url: 'https://www.youtube.com/' });
        window.close();
    });
    openOptionsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
        window.close();
    });
})();
