// Astra Deck — Toolbar Popup
// Quick-toggle 15 of the most-used features without opening the full panel.

const QUICK_TOGGLES = [
    { key: 'removeAllShorts',        name: 'Hide Shorts',            desc: 'Remove Shorts from feeds' },
    { key: 'hideRelatedVideos',      name: 'Hide Related',           desc: 'No related panel on watch' },
    { key: 'sponsorBlock',           name: 'SponsorBlock',           desc: 'Skip sponsored segments' },
    { key: 'deArrow',                name: 'DeArrow',                desc: 'Better titles & thumbnails' },
    { key: 'returnYoutubeDislike',   name: 'Dislike Counts',         desc: 'Show dislike ratio' },
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

const $ = (s) => document.querySelector(s);
const list = $('#toggles');
const q = $('#q');

function getVersion() {
    try { return (chrome.runtime.getManifest().version || '—'); } catch { return '—'; }
}
$('#version').textContent = 'v' + getVersion();

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => resolve(items || {}));
    });
}

async function writeSetting(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
    });
}

async function broadcast(key, value) {
    try {
        const tabs = await chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtu.be/*'] });
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
    const items = QUICK_TOGGLES.filter(t =>
        !term || t.name.toLowerCase().includes(term) || t.desc.toLowerCase().includes(term) || t.key.toLowerCase().includes(term)
    );
    list.innerHTML = '';
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No toggles match.';
        list.appendChild(empty);
        return;
    }
    for (const t of items) {
        const on = !!settings[t.key];
        const row = document.createElement('div');
        row.className = 'toggle' + (on ? ' on' : '');
        row.dataset.key = t.key;
        row.innerHTML = `
            <div class="label">
                <div class="name"></div>
                <div class="desc"></div>
            </div>
            <div class="switch"></div>`;
        row.querySelector('.name').textContent = t.name;
        row.querySelector('.desc').textContent = t.desc;
        row.addEventListener('click', async () => {
            const current = !!(await loadSettings())[t.key];
            const next = !current;
            await writeSetting(t.key, next);
            row.classList.toggle('on', next);
            broadcast(t.key, next);
        });
        list.appendChild(row);
    }
}

(async () => {
    const settings = await loadSettings();
    render(settings, '');
    q.addEventListener('input', async () => {
        render(await loadSettings(), q.value);
    });
    $('#openPanel').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && /youtube\.com|youtu\.be/.test(tab.url || '')) {
            try {
                chrome.tabs.sendMessage(tab.id, { type: 'YTKIT_OPEN_PANEL' }, () => {
                    void chrome.runtime.lastError;
                });
            } catch (_) {}
            window.close();
        } else {
            chrome.tabs.create({ url: 'https://www.youtube.com/' });
        }
    });
    $('#openOptions').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
        window.close();
    });
})();
