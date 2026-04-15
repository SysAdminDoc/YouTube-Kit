// Astra Deck - Background Service Worker
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
    'https://i.ytimg.com',
    'https://sponsor.ajay.app',
    'https://api.openai.com',
    'https://api.anthropic.com',
    'https://generativelanguage.googleapis.com',
    'https://www.reddit.com',
    'https://old.reddit.com',
    'http://127.0.0.1:9751',
    'http://localhost:9751',
    'http://127.0.0.1:11434',
    'http://localhost:11434',
];

// Origins that are allowed to receive cookies on proxied requests.
// All other origins (third-party APIs like SponsorBlock, RYD, DeArrow) get
// credentials: 'omit' so YouTube session cookies are never leaked off-site.
const CREDENTIALED_FETCH_ORIGINS = new Set([
    'https://www.youtube.com',
    'https://youtube.com',
    'https://m.youtube.com',
    'https://music.youtube.com',
    'https://youtu.be',
    'https://www.youtube-nocookie.com',
    'http://127.0.0.1:9751',
    'http://localhost:9751',
]);

const ALLOWED_COOKIE_DOMAINS = new Set([
    '.youtube.com',
    'youtube.com',
    '.www.youtube.com',
    'www.youtube.com',
    '.m.youtube.com',
    'm.youtube.com',
    '.music.youtube.com',
    'music.youtube.com',
    '.youtube-nocookie.com',
    'youtube-nocookie.com',
    '.www.youtube-nocookie.com',
    'www.youtube-nocookie.com'
]);

function shouldSendCredentials(url) {
    try {
        const parsed = new URL(url);
        const originKey = `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
        return CREDENTIALED_FETCH_ORIGINS.has(originKey);
    } catch {
        return false;
    }
}

// Headers that must never be forwarded from content-script requests.
// `Authorization` is handled separately so BYO-key API calls can work for
// explicit non-YouTube allowlisted origins without letting arbitrary auth
// headers leak onto first-party YouTube/session-bound requests.
const ALWAYS_BLOCKED_REQUEST_HEADERS = new Set([
    'host', 'origin', 'referer', 'cookie',
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

const AUTH_HEADER_ALLOWED_ORIGINS = new Set([
    'https://api.openai.com',
    'https://api.anthropic.com',
    'http://127.0.0.1:9751',
    'http://localhost:9751',
    'http://127.0.0.1:11434',
    'http://localhost:11434',
]);

function getRequestOrigin(url) {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
    } catch {
        return '';
    }
}

function canForwardAuthorizationHeader(url) {
    return AUTH_HEADER_ALLOWED_ORIGINS.has(getRequestOrigin(url));
}

function filterRequestHeaders(headers, url) {
    const filtered = filterHeaders(headers, ALWAYS_BLOCKED_REQUEST_HEADERS);
    if (!canForwardAuthorizationHeader(url)) {
        for (const key of Object.keys(filtered)) {
            if (key.toLowerCase() === 'authorization') {
                delete filtered[key];
            }
        }
    }
    return filtered;
}

function isJsonLikePayload(data) {
    return Array.isArray(data) || (data && typeof data === 'object'
        && !(data instanceof FormData)
        && !(data instanceof URLSearchParams)
        && !(data instanceof Blob)
        && !(data instanceof ArrayBuffer)
        && !ArrayBuffer.isView(data));
}

function hasHeader(headers, name) {
    if (!headers || typeof headers !== 'object') return false;
    const target = String(name).toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function normalizeRequestBody(data, headers = {}) {
    if (data == null) return null;
    if (typeof data === 'string') return data;
    // ArrayBuffer and TypedArrays survive structured cloning through chrome.runtime messaging
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data;

    const contentTypeHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
    const contentType = typeof contentTypeHeader?.[1] === 'string' ? contentTypeHeader[1].toLowerCase() : '';
    if (contentType.includes('application/json')) {
        return JSON.stringify(data);
    }

    if (isJsonLikePayload(data)) {
        return JSON.stringify(data);
    }

    return String(data);
}

function isAllowedCookieDomain(domain) {
    if (typeof domain !== 'string') return false;
    const normalized = domain.trim().toLowerCase();
    return ALLOWED_COOKIE_DOMAINS.has(normalized);
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

// chrome.action.onClicked does not fire when default_popup is set in the
// manifest, so the toolbar click is handled entirely by popup.html/popup.js.
// The keyboard shortcut (Ctrl+Shift+Y) still needs the commands listener.

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-control-center') return;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await togglePanelForTab(tab?.id);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Guard: reject malformed messages up front so a missing/non-object `msg`
    // cannot throw before any handler runs.
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        try { sendResponse({ error: 'Invalid message.' }); } catch (_) {}
        return false;
    }

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
        const details = msg?.details;
        if (!details || typeof details !== 'object') {
            sendResponse({ error: 'Missing fetch details.' });
            return false;
        }

        const { method, url, headers, data, timeout } = details;
        if (typeof url !== 'string' || !url) {
            sendResponse({ error: 'Invalid fetch URL.' });
            return false;
        }

        if (!isUrlAllowed(url)) {
            sendResponse({ error: `URL not in allowlist: ${url}` });
            return false;
        }

        const validMethods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
        const normalizedMethod = String(method || 'GET').toUpperCase();
        const safeMethod = validMethods.includes(normalizedMethod) ? normalizedMethod : 'GET';

        const controller = new AbortController();
        // Default to 30 s when the caller does not pass a timeout so unauthenticated
        // or hung upstream fetches cannot stall the service worker indefinitely.
        const DEFAULT_FETCH_TIMEOUT_MS = 30000;
        const MIN_FETCH_TIMEOUT_MS = 1000;
        const requestedTimeout = Number.isFinite(timeout) && timeout > 0
            ? timeout
            : DEFAULT_FETCH_TIMEOUT_MS;
        const clampedTimeout = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(requestedTimeout, MAX_FETCH_TIMEOUT_MS));
        let timer = null;
        let responded = false;

        timer = setTimeout(() => {
            if (responded) return;
            responded = true;
            controller.abort();
            sendResponse({ timeout: true });
        }, clampedTimeout);

        const fetchOpts = {
            method: safeMethod,
            signal: controller.signal,
            credentials: shouldSendCredentials(url) ? 'include' : 'omit'
        };

        const filteredHeaders = filterRequestHeaders(headers, url);
        if (isJsonLikePayload(data) && !hasHeader(filteredHeaders, 'content-type')) {
            filteredHeaders['Content-Type'] = 'application/json';
        }
        if (Object.keys(filteredHeaders).length > 0) {
            fetchOpts.headers = filteredHeaders;
        }
        if (data && safeMethod !== 'GET' && safeMethod !== 'HEAD') {
            fetchOpts.body = normalizeRequestBody(data, filteredHeaders);
        }

        fetch(url, fetchOpts).then(async (resp) => {
            if (timer) clearTimeout(timer);
            if (responded) return;

            const contentLengthHeader = resp.headers.get('content-length');
            if (contentLengthHeader !== null) {
                const contentLength = parseInt(contentLengthHeader, 10);
                if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
                    responded = true;
                    sendResponse({ error: `Response too large (${contentLength} bytes)` });
                    try { controller.abort(); } catch (_) {}
                    return;
                }
            }

            // Stream-bounded read so a chunked / unknown-length response cannot
            // OOM the service worker before we reach the size check below.
            let text;
            try {
                const reader = resp.body?.getReader();
                if (reader) {
                    const chunks = [];
                    let received = 0;
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        received += value.byteLength;
                        if (received > MAX_RESPONSE_BYTES) {
                            try { reader.cancel(); } catch (_) {}
                            responded = true;
                            sendResponse({ error: `Response body too large (${received} bytes)` });
                            return;
                        }
                        chunks.push(value);
                    }
                    const merged = new Uint8Array(received);
                    let offset = 0;
                    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
                    text = new TextDecoder('utf-8').decode(merged);
                } else {
                    text = await resp.text();
                    if (text.length > MAX_RESPONSE_BYTES) {
                        responded = true;
                        sendResponse({ error: `Response body too large (${text.length} chars)` });
                        return;
                    }
                }
            } catch (readErr) {
                if (responded) return;
                responded = true;
                sendResponse({ error: readErr.message || 'Failed to read response body' });
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
        const requestedDomain = typeof msg.filter?.domain === 'string' ? msg.filter.domain : '.youtube.com';
        const domain = requestedDomain.trim().toLowerCase() || '.youtube.com';
        if (!isAllowedCookieDomain(domain)) {
            sendResponse({ cookies: null, error: `Cookie domain not allowed: ${requestedDomain}` });
            return false;
        }
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
