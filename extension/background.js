// Astra Deck v3.2.0 - Background Service Worker
// Handles extension fetch proxying, cookie access, downloads,
// and control-center commands from the toolbar and keyboard.

const PANEL_MESSAGE = Object.freeze({
    toggle: 'YTKIT_TOGGLE_PANEL',
    open: 'YTKIT_OPEN_PANEL'
});

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FETCH_TIMEOUT_MS = 60000; // 60 seconds

// Allowed origins for EXT_FETCH proxy — blocks SSRF to private networks
const ALLOWED_FETCH_ORIGINS = [
    'https://www.youtube.com',
    'https://youtube.com',
    'https://m.youtube.com',
    'https://music.youtube.com',
    'https://youtu.be',
    'https://www.youtube-nocookie.com',
    'https://returnyoutubedislikeapi.com',
    'https://sponsor.ajay.app',
    'http://127.0.0.1:9751',
    'http://localhost:9751',
    'https://cobalt.tools',
    'https://api.cobalt.tools',
    'https://co.wuk.sh',
    'https://meowing.de',
    'https://canine.tools',
    'https://imput.net',
    'https://3kh0.net',
    'https://stuff.solutions',
];

// Headers that must not be forwarded from content script requests
const BLOCKED_REQUEST_HEADERS = new Set([
    'host', 'origin', 'referer', 'cookie', 'authorization',
    'proxy-authorization', 'sec-fetch-dest', 'sec-fetch-mode',
    'sec-fetch-site', 'sec-fetch-user'
]);

// Headers stripped from responses before returning to content script
const BLOCKED_RESPONSE_HEADERS = new Set([
    'set-cookie', 'set-cookie2', 'authorization', 'proxy-authenticate',
    'proxy-authorization', 'www-authenticate'
]);

function isUrlAllowed(url) {
    try {
        const parsed = new URL(url);
        return ALLOWED_FETCH_ORIGINS.some(origin => {
            const allowed = new URL(origin);
            return parsed.protocol === allowed.protocol
                && parsed.hostname === allowed.hostname
                && (allowed.port === '' || parsed.port === allowed.port);
        });
    } catch {
        return false;
    }
}

function filterHeaders(headers, blocklist) {
    if (!headers || typeof headers !== 'object') return {};
    const filtered = {};
    for (const [key, value] of Object.entries(headers)) {
        if (!blocklist.has(key.toLowerCase())) {
            filtered[key] = value;
        }
    }
    return filtered;
}

function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
        if (!tabId) {
            resolve(false);
            return;
        }
        try {
            chrome.tabs.sendMessage(tabId, message, () => {
                resolve(!chrome.runtime.lastError);
            });
        } catch (error) {
            resolve(false);
        }
    });
}

async function togglePanelForTab(tabId) {
    const delivered = await sendTabMessage(tabId, { type: PANEL_MESSAGE.toggle });
    if (!delivered) {
        try {
            await chrome.runtime.openOptionsPage();
        } catch (_) {
            // Ignore fallback failures
        }
    }
}

chrome.action.onClicked.addListener(async (tab) => {
    await togglePanelForTab(tab?.id);
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-control-center') return;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await togglePanelForTab(tab?.id);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'OPEN_URL') {
        let targetUrl;
        try {
            const parsed = new URL(msg.url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                sendResponse({ error: 'Only HTTP(S) URLs can be opened in a tab.' });
                return false;
            }
            targetUrl = parsed.toString();
        } catch (error) {
            sendResponse({ error: 'Invalid URL.' });
            return false;
        }

        const createProperties = {
            url: targetUrl,
            active: msg.active !== false
        };
        if (sender.tab?.id) createProperties.openerTabId = sender.tab.id;
        if (typeof sender.tab?.windowId === 'number') createProperties.windowId = sender.tab.windowId;
        if (typeof sender.tab?.index === 'number') createProperties.index = sender.tab.index + 1;

        chrome.tabs.create(createProperties).then((tab) => {
            sendResponse({ tabId: tab.id || null });
        }).catch((error) => {
            sendResponse({ error: error.message });
        });
        return true;
    }

    if (msg.type === 'EXT_FETCH') {
        const { method, url, headers, data, timeout } = msg.details;

        if (!isUrlAllowed(url)) {
            sendResponse({ error: `URL not in allowlist: ${url}` });
            return false;
        }

        const validMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
        const safeMethod = validMethods.includes(method) ? method : 'GET';

        const controller = new AbortController();
        const clampedTimeout = Math.min(Math.max(timeout || 0, 0), MAX_FETCH_TIMEOUT_MS);
        let timer = null;
        let responded = false;

        if (clampedTimeout > 0) {
            timer = setTimeout(() => {
                if (responded) return;
                responded = true;
                controller.abort();
                sendResponse({ timeout: true });
            }, clampedTimeout);
        }

        const fetchOpts = {
            method: safeMethod,
            signal: controller.signal,
            credentials: 'include'
        };

        const filteredHeaders = filterHeaders(headers, BLOCKED_REQUEST_HEADERS);
        if (Object.keys(filteredHeaders).length > 0) {
            fetchOpts.headers = filteredHeaders;
        }
        if (data && safeMethod !== 'GET' && safeMethod !== 'HEAD') {
            fetchOpts.body = typeof data === 'string' ? data : String(data);
        }

        fetch(url, fetchOpts).then(async (resp) => {
            if (timer) clearTimeout(timer);
            if (responded) return;

            const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
            if (contentLength > MAX_RESPONSE_BYTES) {
                responded = true;
                sendResponse({ error: `Response too large (${contentLength} bytes)` });
                return;
            }

            const text = await resp.text();
            if (text.length > MAX_RESPONSE_BYTES) {
                responded = true;
                sendResponse({ error: `Response body too large (${text.length} chars)` });
                return;
            }

            responded = true;
            const responseHeaders = [...resp.headers.entries()]
                .filter(([k]) => !BLOCKED_RESPONSE_HEADERS.has(k.toLowerCase()))
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n');

            sendResponse({
                status: resp.status,
                statusText: resp.statusText,
                responseText: text,
                responseHeaders: responseHeaders,
                finalUrl: resp.url
            });
        }).catch((err) => {
            if (timer) clearTimeout(timer);
            if (responded) return;
            responded = true;
            sendResponse({ error: err.name === 'AbortError' ? 'Request aborted' : err.message });
        });

        return true; // keep sendResponse channel open
    }

    if (msg.type === 'DOWNLOAD_FILE') {
        let downloadUrl;
        try {
            const parsed = new URL(msg.url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                sendResponse({ error: 'Only HTTP(S) URLs can be downloaded.' });
                return false;
            }
            downloadUrl = parsed.toString();
        } catch {
            sendResponse({ error: 'Invalid download URL.' });
            return false;
        }

        const filename = typeof msg.filename === 'string'
            ? msg.filename.replace(/[\\/:*?"<>|]/g, '_')
            : undefined;

        const opts = { url: downloadUrl, saveAs: false };
        if (filename) opts.filename = filename;
        chrome.downloads.download(opts, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                if (msg.showInFolder) {
                    setTimeout(() => {
                        try {
                            chrome.downloads.show(downloadId);
                        } catch (_) {
                            // Ignore Explorer reveal failures
                        }
                    }, 900);
                }
                sendResponse({ downloadId });
            }
        });
        return true;
    }

    if (msg.type === 'EXT_COOKIE_LIST') {
        const domain = msg.filter?.domain || '.youtube.com';
        chrome.cookies.getAll({ domain }).then(cookies => {
            sendResponse({
                cookies: cookies.map(c => ({
                    domain: c.domain,
                    name: c.name,
                    value: c.value,
                    path: c.path || '/',
                    secure: !!c.secure,
                    httpOnly: !!c.httpOnly,
                    expirationDate: c.expirationDate || 0
                })),
                error: null
            });
        }).catch(err => {
            sendResponse({ cookies: null, error: err.message });
        });
        return true;
    }
});
