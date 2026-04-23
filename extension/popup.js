// Astra Deck — Toolbar Popup
// Quick-toggle 15 of the most-used features without opening the full panel.

const QUICK_TOGGLES = [
    { key: 'removeAllShorts',        group: 'Feed Cleanup',      name: 'Hide Shorts',            desc: 'Remove Shorts from feeds' },
    { key: 'hideRelatedVideos',      group: 'Feed Cleanup',      name: 'Hide Related',           desc: 'No related panel on watch' },
    { key: 'disableInfiniteScroll',  group: 'Feed Cleanup',      name: 'Cap Scroll',             desc: 'Stop infinite scroll' },
    { key: 'sponsorBlock',           group: 'Watch Flow',        name: 'SponsorBlock',           desc: 'Skip sponsored segments' },
    { key: 'deArrow',                group: 'Watch Flow',        name: 'DeArrow',                desc: 'Better titles & thumbnails' },
    { key: 'commentSearch',          group: 'Watch Flow',        name: 'Comment Search',         desc: 'Filter comments on watch pages' },
    { key: 'disableAutoplayNext',    group: 'Playback',          name: 'No Autoplay',            desc: 'Stop auto-advance to next' },
    { key: 'persistentSpeed',        group: 'Playback',          name: 'Persistent Speed',       desc: 'Remember playback rate' },
    { key: 'autoTheaterMode',        group: 'Playback',          name: 'Auto Theater',           desc: 'Default to theater view' },
    { key: 'blueLightFilter',        group: 'Focus',             name: 'Blue-Light Filter',      desc: 'Warmer colors' },
    { key: 'miniPlayerBar',          group: 'Focus',             name: 'Mini Player Bar',        desc: 'Floating bar on scroll' },
    { key: 'digitalWellbeing',       group: 'Focus',             name: 'Digital Wellbeing',      desc: 'Break reminders + daily cap' },
    { key: 'cleanShareUrls',         group: 'Utilities',         name: 'Clean URLs',             desc: 'Strip tracking params' },
    { key: 'transcriptViewer',       group: 'Utilities',         name: 'Transcript Sidebar',     desc: 'Clickable transcript + export' },
    { key: 'debugMode',              group: 'Utilities',         name: 'Debug Mode',             desc: 'Verbose console logging' },
];

// Lucide-style 16×16 stroke icons per group. Each entry is an array of
// SVG element specs so the popup can build them via DOM APIs (satisfies
// MV3 CSP — no innerHTML). Paths are intentionally minimal to read at
// tiny sizes against the darker popup surface.
const SVG_NS = 'http://www.w3.org/2000/svg';
const GROUP_ICONS = {
    'Feed Cleanup': [
        { tag: 'polygon', attrs: { points: '2 4 14 4 10 9 10 14 6 12 6 9' } },
    ],
    'Watch Flow': [
        { tag: 'circle',  attrs: { cx: '8', cy: '8', r: '6' } },
        { tag: 'polygon', attrs: { points: '7 5.5 11 8 7 10.5' } },
    ],
    'Playback': [
        { tag: 'polygon', attrs: { points: '3 3 8 8 3 13' } },
        { tag: 'polygon', attrs: { points: '8 3 13 8 8 13' } },
    ],
    'Focus': [
        { tag: 'path',    attrs: { d: 'M13 9.5A5.5 5.5 0 1 1 6.5 3a4 4 0 0 0 6.5 6.5z' } },
    ],
    'Utilities': [
        { tag: 'path',    attrs: { d: 'M11 2l3 3-1.5 1.5a2.5 2.5 0 0 1-3.5 0 2.5 2.5 0 0 1 0-3.5L11 2z' } },
        { tag: 'line',    attrs: { x1: '9.5', y1: '6.5', x2: '3', y2: '13' } },
    ],
};

function createGroupIcon(groupName) {
    const spec = GROUP_ICONS[groupName];
    if (!spec) return null;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'toggle-group-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
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
const versionEl = $('#version');
const resolvedVersion = getVersion();
versionEl.textContent = 'v' + resolvedVersion;
versionEl.title = resolvedVersion === '—'
    ? 'Astra Deck version unavailable'
    : `Astra Deck v${resolvedVersion}`;

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

// Serialize writes so two toggles clicked in rapid succession can't race
// the storage read-merge-write cycle. Each toggle click produces a task that
// waits for the previous one to finish before starting its own merge.
let _pendingWriteChain = Promise.resolve();

async function writeSetting(key, value) {
    const task = _pendingWriteChain.catch(() => undefined).then(async () => {
        // Merge against the in-memory settings kept fresh by the onChanged
        // listener and the previous write task. This avoids the classic
        // read-merge-write race where two concurrent storageGet() calls both
        // observe pre-write state and the later write clobbers the earlier.
        const nextSettings = {
            ...popupState.settings,
            [key]: value
        };
        popupState.settings = nextSettings;
        await storageSet({ [SETTINGS_STORAGE_KEY]: nextSettings });
        return nextSettings;
    });
    _pendingWriteChain = task;
    return task;
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
            label: 'YouTube',
            note: 'Changes sync to this tab automatically.',
            openLabel: 'Open Full Settings'
        };
    }
    if (isAnyYouTubeUrl(url)) {
        return {
            label: 'YouTube',
            note: 'Changes sync to open YouTube tabs automatically.',
            openLabel: 'Open Full Settings'
        };
    }
    return {
        label: 'Any Tab',
        note: 'Changes sync when you open YouTube.',
        openLabel: 'Go to YouTube'
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
            } catch (_) {
                // reason: tab may be closing or extension host has no receiver
            }
        }
    } catch (_) {
        // reason: chrome.tabs.query rejects when extension is suspended during broadcast
    }
}

function render(settings, filter) {
    const term = (filter || '').toLowerCase().trim();
    const items = QUICK_TOGGLES.filter((t) =>
        !term
            || t.name.toLowerCase().includes(term)
            || t.desc.toLowerCase().includes(term)
            || t.key.toLowerCase().includes(term)
            || t.group.toLowerCase().includes(term)
    );
    list.textContent = '';
    updateSummary(settings);
    updateSearchState();
    if (!items.length) {
        renderEmpty(term);
        return;
    }

    const groupedItems = new Map();
    for (const item of items) {
        const groupName = item.group || 'Quick Controls';
        if (!groupedItems.has(groupName)) groupedItems.set(groupName, []);
        groupedItems.get(groupName).push(item);
    }

    for (const [groupName, groupItems] of groupedItems.entries()) {
        const section = document.createElement('section');
        section.className = 'toggle-group';
        const sectionId = `toggle-group-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        section.setAttribute('aria-labelledby', sectionId);

        const groupEnabled = groupItems.reduce((count, item) => count + (settings[item.key] ? 1 : 0), 0);
        // Promote the group header when any of its toggles are enabled —
        // gives the user a scannable cue about where they've customized.
        section.dataset.active = groupEnabled > 0 ? 'true' : 'false';

        const groupHead = document.createElement('div');
        groupHead.className = 'toggle-group-head';

        const groupTitleWrap = document.createElement('div');
        groupTitleWrap.className = 'toggle-group-title-wrap';

        const icon = createGroupIcon(groupName);
        if (icon) groupTitleWrap.appendChild(icon);

        const groupTitle = document.createElement('h2');
        groupTitle.className = 'toggle-group-title';
        groupTitle.id = sectionId;
        groupTitle.textContent = groupName;
        groupTitleWrap.appendChild(groupTitle);

        const groupCount = document.createElement('span');
        groupCount.className = 'toggle-group-count';
        groupCount.textContent = `${groupEnabled}/${groupItems.length}`;

        groupHead.appendChild(groupTitleWrap);
        groupHead.appendChild(groupCount);
        section.appendChild(groupHead);

        for (const t of groupItems) {
            const on = Boolean(settings[t.key]);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'toggle' + (on ? ' on' : '');
            row.dataset.key = t.key;
            row.setAttribute('role', 'switch');
            row.setAttribute('aria-checked', String(on));
            row.setAttribute('aria-label', `${t.name}. ${t.desc}. ${on ? 'Enabled' : 'Disabled'}.`);

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
            section.appendChild(row);
        }

        list.appendChild(section);
    }
}

function getWheelScrollTarget(rawTarget) {
    let el = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement || null;
    while (el && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const canScrollY = /(auto|scroll)/.test(style.overflowY);
        if (canScrollY && el.scrollHeight > el.clientHeight) return el;
        el = el.parentElement;
    }
    return list;
}

function normalizeWheelDelta(event, scroller) {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * Math.max(scroller.clientHeight, 1);
    return event.deltaY;
}

function installWheelScrolling() {
    document.addEventListener('wheel', (event) => {
        const scroller = getWheelScrollTarget(event.target);
        if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;

        const delta = normalizeWheelDelta(event, scroller);
        if (!Number.isFinite(delta) || delta === 0) return;

        const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
        const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop + delta));
        if (nextScrollTop === scroller.scrollTop) return;

        event.preventDefault();
        scroller.scrollTop = nextScrollTop;
    }, { passive: false });
}

(async () => {
    installWheelScrolling();
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

    // Debounce search re-renders so fast typers don't rebuild the toggle
    // list (and re-run every group layout + aria update) on every keystroke.
    let _searchDebounce = null;
    q.addEventListener('input', () => {
        updateSearchState();
        if (_searchDebounce) clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => {
            _searchDebounce = null;
            render(popupState.settings, q.value);
        }, 120);
    });
    q.addEventListener('keydown', (event) => {
        // Enter on the search field focuses the first visible toggle so
        // keyboard users can filter-then-activate without an extra Tab step.
        if (event.key === 'Enter') {
            const firstToggle = list.querySelector('.toggle');
            if (firstToggle) {
                event.preventDefault();
                firstToggle.focus();
            }
            return;
        }
        // Escape in the search field clears it (one key press) instead of
        // needing to arrow-select-delete or click the × button.
        if (event.key === 'Escape' && q.value) {
            event.preventDefault();
            q.value = '';
            render(popupState.settings, '');
        }
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
        try {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (tab?.id && isSupportedInlinePanelUrl(tab.url || '')) {
                const opened = await sendTabMessage(tab.id, { type: PANEL_OPEN_MESSAGE });
                if (opened) {
                    window.close();
                    return;
                }
            }

            if (isAnyYouTubeUrl(tab?.url || '')) {
                await chrome.runtime.openOptionsPage();
                window.close();
                return;
            }

            await chrome.tabs.create({ url: 'https://www.youtube.com/' });
            window.close();
        } catch (error) {
            console.warn('[Astra Deck popup] Failed to open the full workspace:', error);
            showStatus('Could not open the full settings workspace. Try again.', 'error', 4200);
        }
    });
    openOptionsButton.addEventListener('click', async () => {
        try {
            await chrome.runtime.openOptionsPage();
            window.close();
        } catch (error) {
            console.warn('[Astra Deck popup] Failed to open options page:', error);
            showStatus('Could not open the options page. Try again.', 'error', 4200);
        }
    });
})();
