// ==UserScript==
// @name         YTKit v3.10.1
// @namespace    https://github.com/SysAdminDoc/YouTube-Kit
// @version      3.10.1
// @updateURL      https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/ytkit.user.js
// @downloadURL    https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/ytkit.user.js
// @description  Ultimate YouTube customization with ad blocking, SponsorBlock, video/channel hiding, playback enhancements, and 115+ features
// @author       Matthew Parker
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      sponsor.ajay.app
// @connect      returnyoutubedislikeapi.com
// @connect      cobalt.tools
// @connect      *.cobalt.tools
// @connect      *.imput.net
// @connect      *.meowing.de
// @connect      *.canine.tools
// @connect      capi.3kh0.net
// @connect      downloadapi.stuff.solutions
// @connect      raw.githubusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function() {
    'use strict';

    // In userscript context, GM_* APIs are native — no shim needed
    // window.ytInitialPlayerResponse and window.__ytab are directly accessible (same page context)
    const GM = { xmlHttpRequest: GM_xmlhttpRequest };
    // GM_cookie not available in userscripts — provide no-op
    const GM_cookie = { list(filter, cb) { cb(null, 'GM_cookie not available in userscript mode'); } };
    // triggerDownload — open URL directly in userscript mode (no chrome.downloads API)
    function triggerDownload(url, filename) {
        return new Promise((resolve) => {
            const a = document.createElement('a');
            a.href = url;
            if (filename) a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { document.body.removeChild(a); } catch(_) {} resolve({ ok: true }); }, 200);
        });
    }


    // In userscript context, window.ytInitialPlayerResponse and window.__ytab
    // are directly accessible (same page context, no ISOLATED/MAIN world split)


    //  SECTION 0A: CORE UTILITIES & UNIFIED STORAGE

    // Settings version for migrations

    // Page type detection for lazy-loading features
    const PageTypes = {
        HOME: 'home',
        WATCH: 'watch',
        SEARCH: 'search',
        CHANNEL: 'channel',
        SUBSCRIPTIONS: 'subscriptions',
        PLAYLIST: 'playlist',
        SHORTS: 'shorts',
        HISTORY: 'history',
        LIBRARY: 'library',
        OTHER: 'other'
    };

    function getCurrentPage() {
        const path = window.location.pathname;
        if (path === '/' || path === '/feed/trending') return PageTypes.HOME;
        if (path.startsWith('/watch')) return PageTypes.WATCH;
        if (path.startsWith('/results')) return PageTypes.SEARCH;
        if (path.startsWith('/shorts')) return PageTypes.SHORTS;
        if (path.startsWith('/feed/subscriptions')) return PageTypes.SUBSCRIPTIONS;
        if (path.startsWith('/feed/history')) return PageTypes.HISTORY;
        if (path.startsWith('/feed/library') || path.startsWith('/feed/you')) return PageTypes.LIBRARY;
        if (path.startsWith('/playlist')) return PageTypes.PLAYLIST;
        if (path.startsWith('/@') || path.startsWith('/channel') || path.startsWith('/c/') || path.startsWith('/user/')) return PageTypes.CHANNEL;
        return PageTypes.OTHER;
    }

    // ── Version ──
    const YTKIT_VERSION = '3.10.1';

    // ── Z-Index Hierarchy ──
    const Z = {
        HIDE_BTN: 1000,          // Video hide button overlay
        BUTTONS: 9999,           // Download/action buttons
        EMBED_WRAPPER: 9999,     // Embed player wrapper
        BANNER: 50000,           // Floating banners
        CONTEXT_MENU: 60000,     // Right-click context menu
        TOAST: 70000,            // Toast notifications
        SETTINGS_OVERLAY: 80000, // Settings backdrop
        SETTINGS_PANEL: 80001,   // Settings panel
        PANEL_TOAST: 90000,      // Settings panel toasts
    };

    // ── Settings Panel Cleanup Registry ──
    let _panelCleanups = [];

    // ── Timing Constants ──
    const TIMING = {
        NAV_DEBOUNCE: 50,         // Navigation detection debounce (ms)
        SAVE_DEBOUNCE: 500,       // Settings save debounce (ms)
        ELEMENT_TIMEOUT: 3000,    // waitForElement timeout (ms)
    };
    const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const IMPORT_LIMITS = Object.freeze({
        hiddenVideos: 5000,
        blockedChannels: 2000,
        bookmarkVideos: 400,
        bookmarksPerVideo: 100,
        bookmarkNoteChars: 500,
        totalBytes: 4.5 * 1024 * 1024
    });

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function isSafeObjectKey(key) {
        return typeof key === 'string' && !UNSAFE_OBJECT_KEYS.has(key);
    }

    function sanitizeSettingsObject(settings, knownKeys = null) {
        if (!isPlainObject(settings)) return {};
        const sanitized = {};
        for (const [key, value] of Object.entries(settings)) {
            if (!isSafeObjectKey(key)) continue;
            if (knownKeys && key !== '_settingsVersion' && !knownKeys.has(key)) continue;
            sanitized[key] = value;
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
        try {
            return new Blob([JSON.stringify(value)]).size;
        } catch {
            return Infinity;
        }
    }

    //  Trusted Types Safe HTML Helper
    // YouTube enforces Trusted Types which blocks direct innerHTML assignments.
    // Policy is pass-through by design: all TrustedHTML input comes from YTKit's
    // own code (SVG icons, badges), not untrusted user input. The policy exists
    // only to satisfy YouTube's CSP requirement — sanitization is unnecessary
    // and actively harmful (breaks SVG data URIs, attribute patterns, etc.).
    const TrustedHTML = (() => {
        let policy = null;
        if (typeof window.trustedTypes !== 'undefined' && window.trustedTypes.createPolicy) {
            try {
                policy = window.trustedTypes.createPolicy('ytkit-policy', {
                    createHTML: (string) => string
                });
            } catch (e) {
                // Policy already exists or can't be created
            }
        }

        return {
            setHTML(element, html) {
                if (policy) {
                    element.innerHTML = policy.createHTML(html);
                } else {
                    // Fallback: DOMParser (covers non-TrustedTypes browsers)
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(`<template>${html}</template>`, 'text/html');
                    const template = doc.querySelector('template');
                    element.innerHTML = '';
                    if (template && template.content) {
                        element.appendChild(template.content.cloneNode(true));
                    }
                }
            },
            create(html) {
                return policy ? policy.createHTML(html) : html;
            }
        };
    })();

    // Unified Storage Manager
    const StorageManager = {
        _cache: Object.create(null),
        _dirty: new Set(),
        _saveTimeout: null,

        get(key, defaultVal = null) {
            if (Object.prototype.hasOwnProperty.call(this._cache, key)) {
                return this._cache[key];
            }
            try {
                const val = GM_getValue(key, defaultVal);
                this._cache[key] = val;
                return val;
            } catch (e) {
                console.warn('[YTKit Storage] Failed to get:', key, e);
                return defaultVal;
            }
        },

        set(key, value) {
            this._cache[key] = value;
            this._dirty.add(key);
            this._scheduleSave();
        },

        _scheduleSave() {
            if (this._saveTimeout) return;
            this._saveTimeout = setTimeout(() => this._flush(), TIMING.SAVE_DEBOUNCE);
        },

        _flush() {
            this._saveTimeout = null;
            const toSave = [...this._dirty];
            for (const key of toSave) {
                try {
                    GM_setValue(key, this._cache[key]);
                    this._dirty.delete(key);
                } catch (e) {
                    console.error('[YTKit Storage] Failed to save:', key, e);
                }
            }
        },

        setSync(key, value) {
            this._cache[key] = value;
            try {
                GM_setValue(key, value);
            } catch (e) {
                console.error('[YTKit Storage] Sync save failed:', key, e);
            }
        },

        // Ensure pending writes are flushed before page unload
        _initUnloadFlush() {
            window.addEventListener('beforeunload', () => {
                if (this._saveTimeout) {
                    clearTimeout(this._saveTimeout);
                    this._saveTimeout = null;
                }
                if (this._dirty.size > 0) this._flush();
            });
            // Also flush on YouTube SPA navigations
            document.addEventListener('yt-navigate-start', () => {
                if (this._dirty.size > 0) this._flush();
            });
        }
    };
    StorageManager._initUnloadFlush();


    //  TRANSCRIPT SERVICE - Multi-Method Extraction with Failover
    const TranscriptService = {
        config: {
            preferredLanguages: ['en', 'en-US', 'en-GB'],
            preferManualCaptions: true,
            includeTimestamps: true,
            debug: false
        },

        // Main entry point - downloads transcript with automatic failover
        async downloadTranscript(options = {}) {
            const videoId = getVideoId();
            if (!videoId) {
                showToast('No video ID found', '#ef4444');
                return { success: false, error: 'No video ID' };
            }

            showToast('Fetching transcript...', '#3b82f6');
            this._log('Starting transcript fetch for:', videoId);

            try {
                const trackData = await this._getCaptionTracks(videoId);

                if (!trackData || !trackData.tracks || trackData.tracks.length === 0) {
                    showToast('No transcript available for this video', '#ef4444');
                    return { success: false, error: 'No captions available' };
                }

                const selectedTrack = this._selectBestTrack(trackData.tracks);
                this._log('Selected track:', selectedTrack.languageCode, selectedTrack.kind);

                const segments = await this._fetchTranscriptContent(selectedTrack.baseUrl);

                if (!segments || segments.length === 0) {
                    showToast('Failed to parse transcript content', '#ef4444');
                    return { success: false, error: 'Parse failed' };
                }

                const videoTitle = this._sanitizeFilename(trackData.videoTitle || videoId);
                const content = this._formatTranscript(segments);

                this._downloadFile(content, `${videoTitle}_transcript.txt`);

                showToast(`Transcript downloaded! (${segments.length} segments)`, '#22c55e');
                return { success: true, segments: segments.length, language: selectedTrack.languageCode };

            } catch (error) {
                console.error('[YTKit TranscriptService] Error:', error);
                showToast('Failed to download transcript', '#ef4444');
                return { success: false, error: error.message };
            }
        },

        // Multi-method caption track retrieval with automatic failover
        async _getCaptionTracks(videoId) {
            const methods = [
                { name: 'ytInitialPlayerResponse', fn: () => this._method1_WindowVariable(videoId) },
                { name: 'Innertube API', fn: () => this._method2_InnertubeAPI(videoId) },
                { name: 'HTML Page Fetch', fn: () => this._method3_HTMLPageFetch(videoId) },
                { name: 'captionTracks Regex', fn: () => this._method4_CaptionTracksRegex(videoId) },
                { name: 'DOM Panel Scrape', fn: () => this._method5_DOMPanelScrape(videoId) }
            ];

            for (const method of methods) {
                try {
                    this._log(`Trying method: ${method.name}`);
                    const result = await method.fn();

                    if (result && result.tracks && result.tracks.length > 0) {
                        this._log(`Success with method: ${method.name}`, result.tracks.length, 'tracks found');
                        return result;
                    }
                } catch (error) {
                    this._log(`Method ${method.name} failed:`, error.message);
                }
            }

            return null;
        },

        // Method 1: window.ytInitialPlayerResponse (fastest for fresh page loads)
        _method1_WindowVariable(videoId) {
            const playerResponse = window.ytInitialPlayerResponse;

            if (!playerResponse?.videoDetails?.videoId) {
                throw new Error('ytInitialPlayerResponse not available');
            }

            if (playerResponse.videoDetails.videoId !== videoId) {
                throw new Error('ytInitialPlayerResponse is stale (different video)');
            }

            return this._extractFromPlayerResponse(playerResponse);
        },

        // Method 2: Innertube API (most reliable for SPA navigation)
        async _method2_InnertubeAPI(videoId) {
            const apiKey = this._getInnertubeApiKey() || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
            const clientVersion = this._getClientVersion() || '2.20250120.00.00';

            const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'WEB',
                            clientVersion: clientVersion
                        }
                    },
                    videoId: videoId
                })
            });

            if (!response.ok) throw new Error(`Innertube API returned ${response.status}`);

            const data = await response.json();
            return this._extractFromPlayerResponse(data);
        },

        // Method 3: Fetch HTML and extract ytInitialPlayerResponse
        async _method3_HTMLPageFetch(videoId) {
            const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
            if (!response.ok) throw new Error(`Page fetch returned ${response.status}`);

            const html = await response.text();

            const patterns = [
                /ytInitialPlayerResponse\s*=\s*({.+?});\s*(?:var\s|const\s|let\s|<\/script>)/s,
                /ytInitialPlayerResponse\s*=\s*({.+?});/s,
                /var\s+ytInitialPlayerResponse\s*=\s*({.+?});/s
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    try {
                        const playerResponse = JSON.parse(match[1]);
                        return this._extractFromPlayerResponse(playerResponse);
                    } catch (parseError) {
                        this._log('JSON parse failed for pattern, trying next');
                    }
                }
            }

            throw new Error('Could not extract ytInitialPlayerResponse from HTML');
        },

        // Method 4: Direct captionTracks regex extraction
        async _method4_CaptionTracksRegex(videoId) {
            const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
            if (!response.ok) throw new Error(`Page fetch returned ${response.status}`);

            const html = await response.text();

            const captionMatch = html.match(/"captionTracks":(\[.*?\])(?:,|\})/);
            if (!captionMatch || !captionMatch[1]) {
                throw new Error('captionTracks not found in page');
            }

            const captionJson = captionMatch[1].replace(/\\u0026/g, '&');
            const tracks = JSON.parse(captionJson);

            let videoTitle = videoId;
            const titleMatch = html.match(/"title":"([^"]+)"/);
            if (titleMatch && titleMatch[1]) {
                videoTitle = titleMatch[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"');
            }

            return {
                tracks: tracks.map(t => ({
                    baseUrl: t.baseUrl?.replace(/\\u0026/g, '&'),
                    languageCode: t.languageCode,
                    name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
                    kind: t.kind || (t.vssId?.startsWith('a.') ? 'asr' : 'manual'),
                    vssId: t.vssId
                })),
                videoTitle: videoTitle
            };
        },

        // Method 5: DOM panel scraping (final fallback)
        async _method5_DOMPanelScrape(videoId) {
            const transcriptRenderer = document.querySelector('ytd-transcript-renderer');
            if (!transcriptRenderer) throw new Error('Transcript panel not found in DOM');

            const data = transcriptRenderer.__data?.data || transcriptRenderer.data;
            if (!data) throw new Error('No data in transcript renderer');

            const footer = data.content?.transcriptSearchPanelRenderer?.footer?.transcriptFooterRenderer;
            const languageMenu = footer?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems;

            if (!languageMenu || languageMenu.length === 0) {
                throw new Error('No language menu found in panel data');
            }

            const tracks = languageMenu.map(item => ({
                baseUrl: item.continuation?.reloadContinuationData?.continuation,
                languageCode: item.languageCode || 'unknown',
                name: item.title || 'Unknown',
                kind: item.title?.toLowerCase().includes('auto') ? 'asr' : 'manual'
            }));

            const videoTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent || videoId;

            return { tracks, videoTitle };
        },

        // Extract track info from player response object
        _extractFromPlayerResponse(playerResponse) {
            if (!playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
                throw new Error('No caption tracks in player response');
            }

            const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
            const videoTitle = playerResponse.videoDetails?.title || '';

            return {
                tracks: captionTracks.map(t => ({
                    baseUrl: t.baseUrl,
                    languageCode: t.languageCode,
                    name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
                    kind: t.kind || (t.vssId?.startsWith('a.') ? 'asr' : 'manual'),
                    vssId: t.vssId
                })),
                videoTitle: videoTitle
            };
        },

        // Select best track based on language and type preferences
        _selectBestTrack(tracks) {
            if (tracks.length === 1) return tracks[0];

            const { preferredLanguages, preferManualCaptions } = this.config;

            const scored = tracks.map(track => {
                let score = 0;

                const langIndex = preferredLanguages.findIndex(lang =>
                    track.languageCode?.toLowerCase().startsWith(lang.toLowerCase())
                );
                if (langIndex !== -1) {
                    score += (preferredLanguages.length - langIndex) * 10;
                }

                if (preferManualCaptions && track.kind !== 'asr') {
                    score += 5;
                } else if (!preferManualCaptions && track.kind === 'asr') {
                    score += 5;
                }

                return { track, score };
            });

            scored.sort((a, b) => b.score - a.score);
            return scored[0].track;
        },

        // Fetch and parse transcript content from baseUrl
        async _fetchTranscriptContent(baseUrl) {
            if (!baseUrl) throw new Error('No baseUrl provided for transcript');

            const formats = ['json3', 'xml'];

            for (const fmt of formats) {
                try {
                    const url = fmt === 'xml' ? baseUrl : `${baseUrl}&fmt=${fmt}`;
                    const response = await fetch(url);

                    if (!response.ok) continue;

                    const content = await response.text();

                    if (fmt === 'json3') {
                        return this._parseJSON3(content);
                    } else {
                        return this._parseXML(content);
                    }
                } catch (e) {
                    this._log(`Format ${fmt} failed:`, e.message);
                }
            }

            throw new Error('Failed to fetch transcript in any format');
        },

        // Parse JSON3 format (word-level timing)
        _parseJSON3(content) {
            const data = JSON.parse(content);
            const segments = [];

            if (!data.events) throw new Error('No events in JSON3 response');

            for (const event of data.events) {
                if (!event.segs) continue;

                const text = event.segs
                    .map(seg => seg.utf8 || '')
                    .join('')
                    .replace(/\n/g, ' ')
                    .trim();

                if (text) {
                    const seg = {
                        startMs: event.tStartMs || 0,
                        endMs: (event.tStartMs || 0) + (event.dDurationMs || 0),
                        text: text
                    };
                    // Preserve word-level timing from tOffsetMs
                    if (event.segs.length > 1 && event.segs.some(s => s.tOffsetMs !== undefined)) {
                        const evtStart = (event.tStartMs || 0) / 1000;
                        const evtEnd = ((event.tStartMs || 0) + (event.dDurationMs || 0)) / 1000;
                        seg.words = [];
                        for (let i = 0; i < event.segs.length; i++) {
                            const w = (event.segs[i].utf8 || '').replace(/\n/g, ' ').trim();
                            if (!w) continue;
                            const wStart = evtStart + (event.segs[i].tOffsetMs || 0) / 1000;
                            const nextOffset = (i < event.segs.length - 1 && event.segs[i+1].tOffsetMs !== undefined)
                                ? evtStart + event.segs[i+1].tOffsetMs / 1000 : evtEnd;
                            seg.words.push({ text: w, start: wStart, end: nextOffset });
                        }
                    }
                    segments.push(seg);
                }
            }

            return segments;
        },

        // Parse XML format (fallback)
        _parseXML(content) {
            const segments = [];
            const textRegex = /<text[^>]*start="([^"]*)"[^>]*(?:dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;

            let match;
            while ((match = textRegex.exec(content)) !== null) {
                const startSeconds = parseFloat(match[1]) || 0;
                const duration = parseFloat(match[2]) || 0;
                const text = this._decodeHTMLEntities(match[3])
                    .replace(/<[^>]*>/g, '')
                    .trim();

                if (text) {
                    segments.push({
                        startMs: Math.round(startSeconds * 1000),
                        endMs: Math.round((startSeconds + duration) * 1000),
                        text: text
                    });
                }
            }

            return segments;
        },

        // Format segments into transcript text
        _formatTranscript(segments) {
            return segments.map(s => {
                if (this.config.includeTimestamps) {
                    const timestamp = this._formatTimestamp(s.startMs);
                    return `[${timestamp}] ${s.text}`;
                }
                return s.text;
            }).join('\n');
        },

        _formatTimestamp(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            if (hours > 0) {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        },

        _cachedApiKey: null,
        _getInnertubeApiKey() {
            if (this._cachedApiKey) return this._cachedApiKey;
            if (typeof window.ytcfg !== 'undefined' && window.ytcfg.get) {
                const key = window.ytcfg.get('INNERTUBE_API_KEY');
                if (key) { this._cachedApiKey = key; return key; }
            }
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
                const m = s.textContent.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
                if (m) { this._cachedApiKey = m[1]; return m[1]; }
            }
            return null;
        },

        _getClientVersion() {
            if (typeof window.ytcfg !== 'undefined' && window.ytcfg.get) {
                return window.ytcfg.get('INNERTUBE_CLIENT_VERSION');
            }
            return null;
        },

        _decodeHTMLEntities(text) {
            return text
                .replace(/&#39;/g, "'")
                .replace(/&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
                .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        },

        _sanitizeFilename(name) {
            return name
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/[^\x00-\x7F]/g, '')
                .replace(/\s+/g, '_')
                .toLowerCase()
                .substring(0, 50);
        },

        _downloadFile(content, filename) {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            a.remove();
            // Delay revoke to ensure download starts
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },

        _log(...args) {
            if (this.config.debug) {
                console.log('[YTKit TranscriptService]', ...args);
            }
        }
    };

    // Debug Mode Manager — gated behind a flag, no-op in production
    const DebugManager = {
        _enabled: GM_getValue('ytkit_debug', false),
        log(category, ...args) {
            if (!this._enabled) return;
            console.log(`%c[YTKit:${category}]`, 'color:#60a5fa;font-weight:bold', ...args);
        },
        enable()  { this._enabled = true; GM_setValue('ytkit_debug', true); },
        disable() { this._enabled = false; GM_setValue('ytkit_debug', false); }
    };


    // ── Shared Player Button Styles ──
    // All YTKit buttons injected into YouTube's player controls use this base class
    // for consistent sizing, spacing, opacity, and hover behavior.
    const _playerBtnCSS = document.createElement('style');
    _playerBtnCSS.textContent = `
        .ytkit-player-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 100% !important;
            width: 36px !important;
            padding: 0 !important;
            margin: 0 !important;
            opacity: 0.8;
            transition: opacity 0.2s !important;
            color: #fff !important;
            border: none !important;
            background: transparent !important;
            cursor: pointer !important;
            box-sizing: border-box !important;
            vertical-align: top !important;
            line-height: 1 !important;
        }
        .ytkit-player-btn:hover { opacity: 1 !important; }
        .ytkit-player-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
            pointer-events: none;
        }
        .ytkit-player-btn svg[data-stroke] {
            fill: none;
            stroke: currentColor;
            stroke-width: 1.8;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .ytkit-player-btn--text {
            font-size: 12px !important;
            font-weight: 700 !important;
            letter-spacing: 0.3px !important;
            font-family: inherit !important;
        }
        .ytkit-player-btn--active {
            opacity: 1 !important;
            color: #22c55e !important;
        }
        .ytkit-player-btn--warn {
            opacity: 1 !important;
            color: #fbbf24 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(_playerBtnCSS);

    //  SECTION 0B: DYNAMIC CONTENT/STYLE ENGINE
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

    function waitForElement(selector, callback, timeout = TIMING.ELEMENT_TIMEOUT) {
        if (!selector || typeof callback !== 'function') return () => {};
        const el = document.querySelector(selector);
        if (el) { callback(el); return () => {}; }
        let _fired = false;
        let obs = new MutationObserver((mutations) => {
            if (_fired) return;
            // Fast-path: check added nodes directly before full querySelectorAll
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.(selector)) { _fired = true; cleanup(); callback(node); return; }
                }
            }
            // Fallback: full query (handles deeply nested insertions)
            const el = document.querySelector(selector);
            if (el) { _fired = true; cleanup(); callback(el); }
        });
        const cleanup = () => {
            if (obs) {
                obs.disconnect();
                obs = null;
            }
            if (_timeoutId) {
                clearTimeout(_timeoutId);
                _timeoutId = null;
            }
        };
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        let _timeoutId = setTimeout(() => { if (!_fired) cleanup(); }, timeout);
        return cleanup;
    }

    // waitForPageContent — fires callback when YouTube's page content is actually rendered,
    // rather than using blind setTimeout delays. Uses yt-page-data-updated as the primary
    // signal (fires when YT pushes data to the page) and falls back to waitForElement
    // watching for the first rendered video/item. Much faster than fixed 1-2s timeouts.
    function waitForPageContent(callback, fallbackSelector = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer') {
        let fired = false;
        let fallbackTimer = null;
        let cancelElementWait = null;
        const onPageUpdated = () => fire();
        const fire = () => {
            if (fired) return;
            fired = true;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            if (cancelElementWait) {
                cancelElementWait();
                cancelElementWait = null;
            }
            document.removeEventListener('yt-page-data-updated', onPageUpdated);
            callback();
        };

        // yt-page-data-updated fires when YT renders page data — usually within ~200ms of nav
        document.addEventListener('yt-page-data-updated', onPageUpdated, { once: true });

        // Fallback: watch for first content element to appear in DOM
        cancelElementWait = waitForElement(fallbackSelector, fire);

        // Hard fallback at 3s in case neither fires (e.g. cached page, rare edge cases)
        fallbackTimer = setTimeout(fire, 3000);
    }

    //  PageControl System — dismissible injected buttons with ghost-pill restore
    const _pageControlDismissed = {};  // in-memory cache: id -> true/false

    function isPageControlDismissed(id) {
        if (id in _pageControlDismissed) return _pageControlDismissed[id];
        const v = GM_getValue('ytkit_pc_' + id, false);
        _pageControlDismissed[id] = v;
        return v;
    }

    function setPageControlDismissed(id, dismissed) {
        _pageControlDismissed[id] = dismissed;
        GM_setValue('ytkit_pc_' + id, dismissed);
    }

    // Wraps an existing element with an X dismiss button and ghost-pill restore.
    // If currently dismissed, immediately replaces element with ghost pill.
    // options: { label, color, onRestore }
    function wrapPageControl(el, id, options = {}) {
        if (!el || !el.parentNode) return el;

        const label = options.label || id;
        const accentColor = options.color || 'rgba(255,255,255,0.15)';

        // Ghost pill shown when dismissed
        const createGhost = () => {
            const ghost = document.createElement('button');
            ghost.className = 'ytkit-pc-ghost';
            ghost.dataset.pcId = id;
            ghost.title = 'Restore: ' + label;
            ghost.style.cssText = `display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;border:1px dashed rgba(255,255,255,0.2);background:transparent;color:rgba(255,255,255,0.3);font-family:"Roboto",Arial,sans-serif;font-size:12px;cursor:pointer;transition:all 0.2s;white-space:nowrap;`;
            // Build restore icon via DOM API (avoids TrustedHTML issues in non-policy browsers)
            const _svgNS = 'http://www.w3.org/2000/svg';
            const _ico = document.createElementNS(_svgNS, 'svg');
            _ico.setAttribute('viewBox', '0 0 24 24'); _ico.setAttribute('width', '12'); _ico.setAttribute('height', '12');
            _ico.setAttribute('fill', 'none'); _ico.setAttribute('stroke', 'currentColor'); _ico.setAttribute('stroke-width', '2');
            const _pl = document.createElementNS(_svgNS, 'polyline'); _pl.setAttribute('points', '1 4 1 10 7 10'); _ico.appendChild(_pl);
            const _pa = document.createElementNS(_svgNS, 'path'); _pa.setAttribute('d', 'M3.51 15a9 9 0 1 0 .49-3.5'); _ico.appendChild(_pa);
            ghost.appendChild(_ico);
            const _lbl = document.createElement('span'); _lbl.textContent = label; ghost.appendChild(_lbl);
            ghost.onmouseenter = () => { ghost.style.color = 'rgba(255,255,255,0.7)'; ghost.style.borderColor = 'rgba(255,255,255,0.5)'; };
            ghost.onmouseleave = () => { ghost.style.color = 'rgba(255,255,255,0.3)'; ghost.style.borderColor = 'rgba(255,255,255,0.2)'; };
            ghost.addEventListener('click', (e) => {
                e.stopPropagation();
                setPageControlDismissed(id, false);
                ghost.replaceWith(wrap);
                if (options.onRestore) options.onRestore();
            });
            return ghost;
        };

        // Wrap the element
        const wrap = document.createElement('span');
        wrap.className = 'ytkit-pc-wrap';
        wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;';
        el.parentNode.insertBefore(wrap, el);
        wrap.appendChild(el);

        // Dismiss X button
        const xBtn = document.createElement('button');
        xBtn.className = 'ytkit-pc-x';
        xBtn.title = 'Dismiss ' + label;
        xBtn.style.cssText = `position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;border:none;background:rgba(0,0,0,0.7);color:rgba(255,255,255,0.6);font-size:10px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;opacity:0;transition:opacity 0.15s;z-index:10;`;
        xBtn.textContent = '×';
        wrap.addEventListener('mouseenter', () => { xBtn.style.opacity = '1'; });
        wrap.addEventListener('mouseleave', () => { xBtn.style.opacity = '0'; });
        xBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setPageControlDismissed(id, true);
            wrap.replaceWith(createGhost());
        });
        wrap.appendChild(xBtn);

        // If already dismissed, show ghost immediately
        if (isPageControlDismissed(id)) {
            wrap.replaceWith(createGhost());
        }

        return wrap;
    }

    // Inject global PageControl CSS once
    GM_addStyle(`
        .ytkit-pc-wrap:hover .ytkit-pc-x { opacity: 1 !important; }
    `);

    // Global toast notification function with optional action button
    function showToast(message, color = '#22c55e', options = {}) {
        // Remove existing toast if present
        document.querySelector('.ytkit-global-toast')?.remove();

        const toast = document.createElement('div');
        toast.className = 'ytkit-global-toast';
        toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${color};color:white;padding:12px 24px;border-radius:8px;font-family:"Roboto",Arial,sans-serif;font-size:14px;font-weight:500;z-index:${Z.TOAST};box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:12px;animation:ytkit-toast-fade ${options.duration || 2.5}s ease-out forwards;`;

        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        toast.appendChild(textSpan);

        // Add action button if provided (e.g., for Undo)
        if (options.action) {
            const actionBtn = document.createElement('button');
            actionBtn.textContent = options.action.text || 'Undo';
            actionBtn.style.cssText = `
                background: rgba(255,255,255,0.2);
                border: 1px solid rgba(255,255,255,0.3);
                color: white;
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
            `;
            actionBtn.onmouseenter = () => { actionBtn.style.background = 'rgba(255,255,255,0.3)'; };
            actionBtn.onmouseleave = () => { actionBtn.style.background = 'rgba(255,255,255,0.2)'; };
            actionBtn.onclick = (e) => {
                e.stopPropagation();
                toast.remove();
                options.action.onClick?.();
            };
            toast.appendChild(actionBtn);
        }

        // Add animation keyframes if not exists
        if (!document.getElementById('ytkit-toast-animation')) {
            const style = document.createElement('style');
            style.id = 'ytkit-toast-animation';
            style.textContent = `
                @keyframes ytkit-toast-fade {
                    0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    10% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    80% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);
        const duration = (options.duration || 2.5) * 1000;
        setTimeout(() => toast.remove(), duration);

        return toast;
    }

    // Trigger a custom protocol URI (ytvlc://, ytmpv://, etc.) without navigating
    // away from YouTube. An anchor click bypasses YouTube's SPA router.
    function openProtocol(uri, errorMsg) {
        try {
            const a = document.createElement('a');
            a.href = uri;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 200);
        } catch (e) {
            if (errorMsg) showToast(errorMsg, '#ef4444', { duration: 5 });
        }
    }

    // Show a persistent download progress bar anchored to the bottom of the page.
    function showDownloadProgress(id, token, audioOnly) {
        // Remove any existing progress panel for this download
        const panelId = 'ytkit-dl-progress-' + id;
        document.getElementById(panelId)?.remove();

        const panel = document.createElement('div');
        panel.id = panelId;
        panel.style.cssText = `
            position:fixed;bottom:20px;right:20px;width:320px;background:#1a1a2e;border:1px solid #30363d;
            border-radius:12px;padding:14px 16px;z-index:2147483647;font-family:"Roboto",Arial,sans-serif;
            box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#e6edf3;animation:ytkit-slide-in 0.3s ease-out;
        `;

        if (!document.getElementById('ytkit-dl-anim')) {
            const s = document.createElement('style');
            s.id = 'ytkit-dl-anim';
            s.textContent = `
                @keyframes ytkit-slide-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
                #ytkit-dl-bar-fill{transition:width 0.4s ease}
            `;
            document.head.appendChild(s);
        }

        TrustedHTML.setHTML(panel, `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:12px;font-weight:600;color:#8b949e;letter-spacing:.05em;">${audioOnly ? 'AUDIO' : 'VIDEO'} DOWNLOAD</span>
                <button id="ytkit-dl-close-${id}" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:16px;line-height:1;padding:0;">&#x2715;</button>
            </div>
            <div id="ytkit-dl-title-${id}" style="font-size:13px;font-weight:500;margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6edf3;">Starting...</div>
            <div style="background:#30363d;border-radius:4px;height:6px;overflow:hidden;margin-bottom:8px;">
                <div id="ytkit-dl-bar-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:4px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#8b949e;">
                <span id="ytkit-dl-pct-${id}">0%</span>
                <span id="ytkit-dl-speed-${id}"></span>
                <span id="ytkit-dl-eta-${id}"></span>
            </div>
        `);
        document.body.appendChild(panel);

        document.getElementById('ytkit-dl-close-' + id)?.addEventListener('click', () => panel.remove());

        let pollInterval = null;
        function poll() {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'http://127.0.0.1:9751/status/' + id,
                headers: { 'X-Auth-Token': token },
                timeout: 3000,
                onload: function(r) {
                    let data;
                    try { data = JSON.parse(r.responseText); } catch (_) { return; }

                    const fill = document.getElementById('ytkit-dl-bar-fill');
                    const pct  = document.getElementById('ytkit-dl-pct-' + id);
                    const spd  = document.getElementById('ytkit-dl-speed-' + id);
                    const eta  = document.getElementById('ytkit-dl-eta-' + id);
                    const ttl  = document.getElementById('ytkit-dl-title-' + id);
                    if (!fill) { clearInterval(pollInterval); return; }

                    if (data.title) ttl.textContent = data.title;
                    const p = Math.min(data.progress || 0, 100);
                    fill.style.width = p + '%';
                    pct.textContent  = p.toFixed(1) + '%';
                    if (data.speed) spd.textContent = data.speed;
                    if (data.eta)   eta.textContent = 'ETA ' + data.eta;

                    if (data.status === 'done' || data.status === 'complete') {
                        clearInterval(pollInterval);
                        fill.style.width = '100%';
                        fill.style.background = 'linear-gradient(90deg,#22c55e,#16a34a)';
                        pct.textContent = '100%';
                        spd.textContent = '';
                        eta.textContent = 'Done!';
                        setTimeout(() => panel.remove(), 4000);
                    } else if (data.status === 'error' || data.status === 'failed' || data.status === 'cancelled') {
                        clearInterval(pollInterval);
                        fill.style.background = '#ef4444';
                        pct.textContent = data.status;
                        spd.textContent = '';
                        eta.textContent = '';
                        setTimeout(() => panel.remove(), 5000);
                    }
                },
                onerror: function() { clearInterval(pollInterval); },
                ontimeout: function() { clearInterval(pollInterval); }
            });
        }

        pollInterval = setInterval(poll, 1000);
        poll();
    }

    // Web download fallback: opens cobalt when all other download methods fail
    function _webDownloadFallback(videoUrl) {
        const cobaltUrl = GM_getValue('ytkit_cobalt_url', 'https://cobalt.tools/#');
        // Ensure URL ends with # for hash-based paste
        const base = cobaltUrl.includes('#') ? cobaltUrl : cobaltUrl.replace(/\/?$/, '/#');
        const downloadUrl = base + encodeURIComponent(videoUrl);
        showToast('Opening web downloader...', '#3b82f6', { duration: 4 });
        window.open(downloadUrl, '_blank');
    }

    // ── MediaDL Server Manager ──
    // Caches server availability, provides install/status helpers, and auto-start logic.
    const MediaDLManager = {
        _status: null, // null = unknown, 'running', 'not-installed'
        _token: null,
        _lastCheck: 0,
        _serverVersion: null,
        _autoStartAttempted: false,
        _CHECK_INTERVAL: 30000, // Re-check every 30s

        // GitHub raw URL for the PowerShell installer
        INSTALLER_URL: 'https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/Install-YTYT.ps1',
        INSTALLER_COMMAND: "powershell -ExecutionPolicy Bypass -Command \"irm 'https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/Install-YTYT.ps1' | iex\"",

        // Quick health check — returns { ok, token, version } or { ok: false }
        async check(force) {
            const now = Date.now();
            if (!force && this._status === 'running' && this._token && (now - this._lastCheck < this._CHECK_INTERVAL)) {
                return { ok: true, token: this._token, version: this._serverVersion };
            }
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'http://127.0.0.1:9751/health',
                    headers: { 'X-MDL-Client': 'MediaDL' },
                    timeout: 2000,
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.token) {
                                this._status = 'running';
                                this._token = data.token;
                                this._serverVersion = data.version || null;
                                this._lastCheck = now;
                                DebugManager.log('MediaDL', `Server running (v${this._serverVersion || '?'}, ${data.downloads || 0} active)`);
                                resolve({ ok: true, token: data.token, version: this._serverVersion });
                                return;
                            }
                        } catch (_) {}
                        this._status = 'not-installed';
                        this._token = null;
                        resolve({ ok: false });
                    },
                    onerror: () => {
                        this._status = 'not-installed';
                        this._token = null;
                        resolve({ ok: false });
                    },
                    ontimeout: () => {
                        this._status = 'not-installed';
                        this._token = null;
                        resolve({ ok: false });
                    }
                });
            });
        },

        // Try to auto-start the server via mediadl:// protocol and wait for it.
        // Attempts the protocol launch once per page load, then polls health up to
        // `retries` times. If the protocol handler isn't registered, the browser
        // silently ignores it — no error dialog.
        async tryAutoStart(retries = 4) {
            if (this._autoStartAttempted) {
                // Already tried this session — just do a single quick recheck
                return this.check(true);
            }
            this._autoStartAttempted = true;
            DebugManager.log('MediaDL', 'Attempting auto-start via mediadl:// protocol...');
            showToast('Starting MediaDL server...', '#3b82f6', { duration: 4 });
            openProtocol('mediadl://start');
            // Poll for server readiness
            for (let i = 0; i < retries; i++) {
                await new Promise(r => setTimeout(r, 1500));
                const result = await this.check(true);
                if (result.ok) {
                    showToast('MediaDL server started!', '#22c55e', { duration: 2 });
                    return result;
                }
            }
            DebugManager.log('MediaDL', 'Auto-start failed — server did not respond');
            return { ok: false };
        },

        // Reset auto-start flag so the next download re-attempts.
        // Called from the "Retry" button after user installs.
        resetAutoStart() { this._autoStartAttempted = false; this._status = null; },

        get isRunning() { return this._status === 'running'; },
        get token() { return this._token; },

        // Show install / retry prompt panel.
        // Two modes:
        //   'install' — user has never installed MediaDL (default)
        //   'retry'   — auto-start failed, might just need a kick
        showInstallPrompt(mode) {
            const existing = document.getElementById('ytkit-mediadl-install-prompt');
            if (existing) existing.remove(); // replace with fresh state

            const isRetryMode = mode === 'retry';

            const prompt = document.createElement('div');
            prompt.id = 'ytkit-mediadl-install-prompt';
            prompt.style.cssText = `
                position:fixed;bottom:80px;right:20px;width:380px;background:#1a1a2e;
                border:1px solid #30363d;border-radius:12px;padding:18px;z-index:2147483647;
                font-family:"Roboto",Arial,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);
                color:#e6edf3;animation:ytkit-slide-in 0.3s ease-out;
            `;

            // ── Header ──
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
            const titleEl = document.createElement('span');
            titleEl.style.cssText = 'font-size:14px;font-weight:600;color:#22c55e;';
            titleEl.textContent = isRetryMode ? 'MediaDL Server Not Responding' : 'Upgrade Your Downloads';
            const closeBtn = document.createElement('button');
            closeBtn.style.cssText = 'background:none;border:none;color:#8b949e;cursor:pointer;font-size:16px;padding:0;line-height:1;';
            closeBtn.textContent = '\u2715';
            closeBtn.onclick = () => prompt.remove();
            header.appendChild(titleEl);
            header.appendChild(closeBtn);

            // ── Description ──
            const desc = document.createElement('p');
            desc.style.cssText = 'font-size:13px;color:#8b949e;margin:0 0 14px;line-height:1.5;';
            desc.textContent = isRetryMode
                ? 'The server didn\'t start. It may not be installed yet, or the scheduled task stopped. Choose an option below:'
                : 'Install MediaDL for 1080p+ downloads with automatic video+audio merging, background downloads, and progress tracking.';

            // ── Buttons ──
            const btnCol = document.createElement('div');
            btnCol.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

            // Button helper
            const makeBtn = (text, bg, border, onClick) => {
                const b = document.createElement('button');
                b.style.cssText = `width:100%;padding:9px 14px;border-radius:8px;border:${border || 'none'};background:${bg};color:${bg === 'transparent' ? '#8b949e' : 'white'};font-size:13px;font-weight:500;cursor:pointer;transition:background 0.2s;text-align:left;display:flex;align-items:center;gap:10px;`;
                const label = document.createElement('span');
                label.textContent = text;
                b.appendChild(label);
                b.onclick = onClick;
                return b;
            };

            // 1. Retry / Start Server
            if (isRetryMode) {
                const retryBtn = makeBtn('Try Starting Server Again', '#3b82f6', 'none', async () => {
                    retryBtn.querySelector('span').textContent = 'Starting...';
                    retryBtn.style.opacity = '0.7';
                    retryBtn.style.pointerEvents = 'none';
                    this.resetAutoStart();
                    const result = await this.tryAutoStart(5);
                    if (result.ok) {
                        showToast('MediaDL server is running!', '#22c55e', { duration: 3 });
                        prompt.remove();
                    } else {
                        retryBtn.querySelector('span').textContent = 'Still not responding — try installing below';
                        retryBtn.style.opacity = '1';
                        retryBtn.style.pointerEvents = 'auto';
                        retryBtn.style.background = '#ef4444';
                    }
                });
                btnCol.appendChild(retryBtn);
            }

            // 2. Copy Install Command
            const copyBtn = makeBtn('Copy Install Command (PowerShell)', '#22c55e', 'none', async () => {
                try {
                    await navigator.clipboard.writeText(this.INSTALLER_COMMAND);
                    copyBtn.querySelector('span').textContent = 'Copied! Paste in PowerShell (Win+X \u2192 Terminal)';
                    copyBtn.style.background = '#16a34a';
                    showToast('Install command copied! Open PowerShell and paste to install.', '#22c55e', { duration: 8 });
                } catch (_) {
                    window.open(this.INSTALLER_URL, '_blank');
                }
            });
            btnCol.appendChild(copyBtn);

            // 3. Download Installer Script
            const dlBtn = makeBtn('Download Installer Script (.ps1)', 'transparent', '1px solid #30363d', () => {
                triggerDownload(this.INSTALLER_URL, 'Install-YTYT.ps1').catch(() => {
                    window.open(this.INSTALLER_URL, '_blank');
                });
                showToast('Installer downloaded! Right-click \u2192 Run with PowerShell', '#3b82f6', { duration: 6 });
            });
            btnCol.appendChild(dlBtn);

            // 4. "I just installed it" — re-check
            const recheckBtn = makeBtn('I just installed it \u2014 check again', 'transparent', '1px solid #30363d', async () => {
                recheckBtn.querySelector('span').textContent = 'Checking...';
                this.resetAutoStart();
                const result = await this.tryAutoStart(5);
                if (result.ok) {
                    showToast('MediaDL is ready! Downloads will now use 1080p+ quality.', '#22c55e', { duration: 4 });
                    prompt.remove();
                } else {
                    recheckBtn.querySelector('span').textContent = 'Not detected \u2014 make sure the installer completed';
                    setTimeout(() => { recheckBtn.querySelector('span').textContent = 'I just installed it \u2014 check again'; }, 4000);
                }
            });
            btnCol.appendChild(recheckBtn);

            // 5. Dismiss
            if (!isRetryMode) {
                const dismissBtn = makeBtn('Not now', 'transparent', 'none', () => {
                    prompt.remove();
                    GM_setValue('ytkit_mediadl_prompt_dismissed', true);
                });
                dismissBtn.style.cssText += 'padding:6px 14px;font-size:12px;color:#6b7280;justify-content:center;';
                btnCol.appendChild(dismissBtn);
            }

            prompt.appendChild(header);
            prompt.appendChild(desc);
            prompt.appendChild(btnCol);
            document.body.appendChild(prompt);

            // Auto-dismiss after 30s (install mode only)
            if (!isRetryMode) {
                setTimeout(() => { if (prompt.parentNode) prompt.remove(); }, 30000);
            }
        }
    };

    // Legacy wrapper — still used by autoStart retry logic
    function mediaDLDownload(videoUrl, audioOnly) {
        DebugManager.log('MediaDL', `Download requested (legacy): ${videoUrl} (audio=${audioOnly})`);
        ytKitDownload(videoUrl, audioOnly);
    }

    // Extract streaming URLs from YouTube's player response for direct download.
    // This bypasses cookie/auth issues entirely - the URLs contain embedded auth signatures.
    // Uses multi-method approach: inline script parsing (fast) -> Innertube API (SPA-safe).
    async function _extractStreamingData(audioOnly) {
        // Method 1: Parse from inline <script> tags (works on fresh page loads)
        let pr = null;
        try {
            pr = window.ytInitialPlayerResponse;
            if (pr?.streamingData) {
                DebugManager.log('MediaDL', 'Got streamingData from inline script');
            } else {
                pr = null;
            }
        } catch (e) {
            DebugManager.log('MediaDL', `Inline script parse failed: ${e.message}`);
        }

        // Method 2: Innertube API via GM_xmlhttpRequest (works on SPA navigations)
        // Uses GM_xmlhttpRequest because ISOLATED world fetch may not include page cookies
        if (!pr) {
            const videoId = getVideoId();
            if (!videoId) {
                DebugManager.log('MediaDL', 'No video ID in URL for Innertube fallback');
                return null;
            }
            DebugManager.log('MediaDL', `Trying Innertube API for ${videoId}`);
            // Try to extract client version from page scripts for best compatibility
            let clientVersion = '2.20260301.00.00';
            try {
                for (const s of document.querySelectorAll('script')) {
                    const m = s.textContent?.match(/INNERTUBE_CLIENT_VERSION["']?\s*[:=]\s*["']([^"']+)/);
                    if (m) { clientVersion = m[1]; break; }
                }
            } catch (_) {}
            try {
                pr = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
                        headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify({
                            context: { client: { clientName: 'WEB', clientVersion: clientVersion } },
                            videoId: videoId
                        }),
                        timeout: 8000,
                        onload: function(r) {
                            try {
                                const data = JSON.parse(r.responseText);
                                if (data?.streamingData) {
                                    DebugManager.log('MediaDL', 'Got streamingData from Innertube API');
                                    resolve(data);
                                } else {
                                    DebugManager.log('MediaDL', 'Innertube API returned no streamingData');
                                    resolve(null);
                                }
                            } catch (e) {
                                DebugManager.log('MediaDL', `Innertube API parse error: ${e.message}`);
                                resolve(null);
                            }
                        },
                        onerror: function(err) {
                            DebugManager.log('MediaDL', `Innertube API request error: ${JSON.stringify(err)}`);
                            resolve(null);
                        },
                        ontimeout: function() {
                            DebugManager.log('MediaDL', 'Innertube API request timed out');
                            resolve(null);
                        }
                    });
                });
                if (!pr) return null;
            } catch (e) {
                DebugManager.log('MediaDL', `Innertube API error: ${e.message}`);
                return null;
            }
        }

        try {
            const sd = pr.streamingData;
            const title = pr.videoDetails?.title || '';
            const videoId = pr.videoDetails?.videoId || '';
            const duration = parseInt(pr.videoDetails?.lengthSeconds || '0', 10);

            // For audio-only: pick best audio from adaptiveFormats
            if (audioOnly) {
                const audioFormats = (sd.adaptiveFormats || [])
                    .filter(f => f.url && f.mimeType?.startsWith('audio/'))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (audioFormats.length > 0) {
                    const best = audioFormats[0];
                    DebugManager.log('MediaDL', `Audio stream: itag=${best.itag} bitrate=${best.bitrate} mime=${best.mimeType}`);
                    return { title, videoId, duration, audioUrl: best.url, audioItag: best.itag, audioMime: best.mimeType };
                }
            }

            // For video: pick best video + best audio from adaptiveFormats
            // Respect downloadQuality setting (best, 2160, 1440, 1080, 720, 480)
            const qualPref = appState?.settings?.downloadQuality || 'best';
            const maxHeight = qualPref === 'best' ? 2160 : parseInt(qualPref, 10) || 1080;
            const videoFormats = (sd.adaptiveFormats || [])
                .filter(f => f.url && f.mimeType?.startsWith('video/') && (f.height || 0) <= maxHeight)
                .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
            const audioFormats = (sd.adaptiveFormats || [])
                .filter(f => f.url && f.mimeType?.startsWith('audio/'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

            if (videoFormats.length > 0 && audioFormats.length > 0) {
                const bestV = videoFormats[0];
                const bestA = audioFormats[0];
                DebugManager.log('MediaDL', `Video stream: itag=${bestV.itag} ${bestV.width}x${bestV.height} | Audio: itag=${bestA.itag}`);
                return {
                    title, videoId, duration,
                    videoUrl: bestV.url, videoItag: bestV.itag, videoMime: bestV.mimeType,
                    videoWidth: bestV.width, videoHeight: bestV.height,
                    audioUrl: bestA.url, audioItag: bestA.itag, audioMime: bestA.mimeType
                };
            }

            // Try combined (muxed) formats — these contain video+audio in one stream.
            // Lower quality (typically 360p/720p) but downloadable directly via chrome.downloads
            // since the browser sends its own cookies (no 403 issue).
            const combinedFormats = (sd.formats || [])
                .filter(f => f.url && f.mimeType?.startsWith('video/'))
                .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
            if (combinedFormats.length > 0) {
                const best = combinedFormats[0];
                DebugManager.log('MediaDL', `Combined stream: itag=${best.itag} ${best.width}x${best.height} mime=${best.mimeType}`);
                return {
                    title, videoId, duration,
                    combinedUrl: best.url, combinedItag: best.itag, combinedMime: best.mimeType,
                    combinedWidth: best.width, combinedHeight: best.height
                };
            }

            DebugManager.log('MediaDL', 'No usable streams found in streamingData');
            return null;
        } catch (e) {
            DebugManager.log('MediaDL', `Stream extraction error: ${e.message}`);
            return null;
        }
    }

    // Sanitize a video title for use as a filename
    function _sanitizeFilename(title) {
        return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 200);
    }

    // Direct download using chrome.downloads API — downloads YouTube stream URLs
    // directly through the browser's download manager (sends cookies automatically).
    async function _tryDirectDownload(audioOnly) {
        const streams = await _extractStreamingData(audioOnly);
        if (!streams) return false;

        let downloadUrl = null;
        let ext = 'mp4';
        if (audioOnly && streams.audioUrl) {
            downloadUrl = streams.audioUrl;
            ext = streams.audioMime?.includes('webm') ? 'webm' : (streams.audioMime?.includes('mp4') ? 'm4a' : 'webm');
        } else if (!audioOnly && streams.combinedUrl) {
            downloadUrl = streams.combinedUrl;
            ext = streams.combinedMime?.includes('webm') ? 'webm' : 'mp4';
        } else if (!audioOnly && streams.videoUrl && streams.audioUrl) {
            // Adaptive-only: download best video stream (no audio muxing possible in browser).
            // Still better than no download — user gets video file.
            downloadUrl = streams.videoUrl;
            ext = streams.videoMime?.includes('webm') ? 'webm' : 'mp4';
        }

        if (!downloadUrl) return false;

        const title = _sanitizeFilename(streams.title || streams.videoId || 'video');
        const filename = `${title}.${ext}`;

        try {
            // Show quality info
            let qualityInfo = '';
            if (!audioOnly && streams.combinedUrl) {
                qualityInfo = streams.combinedHeight ? ` (${streams.combinedHeight}p)` : '';
            } else if (!audioOnly && streams.videoWidth) {
                qualityInfo = streams.videoHeight ? ` (${streams.videoHeight}p, video only)` : '';
            }
            DebugManager.log('Download', `Direct download: ${filename}${qualityInfo} (${audioOnly ? 'audio' : 'video'})`);
            await triggerDownload(downloadUrl, filename);
            showToast(`Downloading${qualityInfo}: ${title}`, '#22c55e', { duration: 4 });
            return true;
        } catch (e) {
            DebugManager.log('Download', `Direct download failed: ${e.message}`);
            return false;
        }
    }

    // Cobalt API download — calls cobalt instance API to get a direct download URL
    // No-auth community Cobalt API instances (fallback list)
    const _cobaltApiInstances = [
        'https://cobalt-api.meowing.de',
        'https://cobalt-backend.canine.tools',
        'https://kityune.imput.net',
        'https://nachos.imput.net',
        'https://sunny.imput.net',
        'https://blossom.imput.net',
        'https://capi.3kh0.net',
        'https://downloadapi.stuff.solutions',
    ];

    // Resolve user's cobalt URL to an actual API endpoint.
    // cobalt.tools is the web frontend — not the API. Map it to a working instance.
    function _resolveCobaltApiUrl(userUrl) {
        const cleaned = userUrl.replace(/#.*$/, '').replace(/\/+$/, '');
        try {
            const host = new URL(cleaned).hostname;
            // cobalt.tools and co.wuk.sh are web frontends, not API endpoints
            if (host === 'cobalt.tools' || host === 'co.wuk.sh') {
                return _cobaltApiInstances[0];
            }
        } catch (_) {}
        return cleaned;
    }

    async function _tryCobaltApiDownload(videoUrl, audioOnly) {
        const userUrl = GM_getValue('ytkit_cobalt_url', 'https://cobalt.tools/#');
        const primaryApi = _resolveCobaltApiUrl(userUrl);

        // Build instance list: user's configured instance first, then fallbacks
        const instances = [primaryApi, ..._cobaltApiInstances.filter(u => u !== primaryApi)];

        const body = { url: videoUrl };
        if (audioOnly) {
            body.downloadMode = 'audio';
            body.audioFormat = 'mp3';
        } else {
            body.downloadMode = 'auto';
        }
        const payload = JSON.stringify(body);

        for (const instance of instances) {
            const apiUrl = instance.replace(/\/+$/, '') + '/';
            DebugManager.log('Download', `Cobalt API: ${apiUrl}`);
            const result = await new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: apiUrl,
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    data: payload,
                    timeout: 15000,
                    onload: function(r) {
                        try {
                            const resp = JSON.parse(r.responseText);
                            DebugManager.log('Download', `Cobalt response: ${r.status} - status=${resp.status}`);

                            // Auth required — skip to next instance
                            if (resp.error?.code?.startsWith('api.auth')) {
                                DebugManager.log('Download', `Cobalt instance ${instance} requires auth, trying next...`);
                                resolve('next');
                                return;
                            }

                            if ((resp.status === 'tunnel' || resp.status === 'redirect') && resp.url) {
                                const filename = resp.filename || undefined;
                                triggerDownload(resp.url, filename).then(() => {
                                    showToast('Download started via Cobalt', '#22c55e', { duration: 3 });
                                    resolve(true);
                                }).catch(() => {
                                    window.open(resp.url, '_blank');
                                    resolve(true);
                                });
                            } else if (resp.status === 'local-processing' && resp.url) {
                                // v11+ local processing — browser handles muxing
                                triggerDownload(resp.url, resp.filename || undefined).then(() => {
                                    showToast('Download started via Cobalt', '#22c55e', { duration: 3 });
                                    resolve(true);
                                }).catch(() => {
                                    window.open(resp.url, '_blank');
                                    resolve(true);
                                });
                            } else if (resp.status === 'picker' && resp.picker?.length > 0) {
                                const pick = resp.picker[0];
                                triggerDownload(pick.url, pick.filename || undefined).then(() => {
                                    showToast('Download started via Cobalt', '#22c55e', { duration: 3 });
                                    resolve(true);
                                }).catch(() => resolve('next'));
                            } else {
                                DebugManager.log('Download', `Cobalt API returned: ${resp.status} - ${resp.error?.code || 'unknown'}`);
                                resolve('next');
                            }
                        } catch (e) {
                            DebugManager.log('Download', `Cobalt API parse error: ${e.message}`);
                            resolve('next');
                        }
                    },
                    onerror: function(err) {
                        DebugManager.log('Download', `Cobalt API error (${instance}): ${JSON.stringify(err)}`);
                        resolve('next');
                    },
                    ontimeout: function() {
                        DebugManager.log('Download', `Cobalt API timed out (${instance})`);
                        resolve('next');
                    }
                });
            });
            if (result === true) return true;
            if (result === false) return false;
            // 'next' — try next instance
        }
        DebugManager.log('Download', 'All Cobalt instances failed');
        return false;
    }

    // Main download handler — smart cascade with quality awareness:
    //
    //  1. Quick check: is MediaDL already running?          → use it (best quality)
    //  2. Not running: try auto-starting via mediadl://      → use it if it wakes up
    //  3. Still nothing: direct YouTube stream download       → combined ≤720p
    //  4. Direct failed: Cobalt API                          → external muxing service
    //  5. Everything failed: open Cobalt web UI              → manual fallback
    //
    // After step 2 fails, the download still proceeds (steps 3-5) so the user is
    // never blocked. A prompt is shown offering to install / retry MediaDL.
    async function ytKitDownload(videoUrl, audioOnly) {
        DebugManager.log('Download', `Download requested: ${videoUrl} (audio=${audioOnly})`);
        showToast(audioOnly ? 'Starting audio download...' : 'Starting video download...', '#3b82f6', { duration: 2 });

        // ── Step 1: Quick cached check ──
        let mdl = await MediaDLManager.check();

        // ── Step 2: Try to wake the server if not running ──
        if (!mdl.ok) {
            mdl = await MediaDLManager.tryAutoStart();
        }

        // ── Use MediaDL if available ──
        if (mdl.ok) {
            DebugManager.log('Download', 'MediaDL server available — using for best quality');
            try {
                await _mediaDLSendDownload(videoUrl, audioOnly, mdl.token);
                return; // success — done
            } catch (e) {
                DebugManager.log('Download', `MediaDL download failed: ${e.message}`);
                showToast('MediaDL error, falling back to direct download...', '#f59e0b', { duration: 3 });
            }
        }

        // ── Step 3: Direct download via YouTube stream URLs ──
        DebugManager.log('Download', 'No MediaDL — trying direct download...');
        const directOk = await _tryDirectDownload(audioOnly);
        if (directOk) {
            // Show install/retry prompt (non-blocking, behind the download)
            if (!audioOnly && !GM_getValue('ytkit_mediadl_prompt_dismissed', false)) {
                MediaDLManager.showInstallPrompt(MediaDLManager._autoStartAttempted ? 'retry' : 'install');
            }
            return;
        }

        // ── Step 4: Cobalt API ──
        DebugManager.log('Download', 'Direct download failed, trying Cobalt API...');
        showToast('Trying Cobalt download service...', '#3b82f6', { duration: 2 });
        const cobaltOk = await _tryCobaltApiDownload(videoUrl, audioOnly);
        if (cobaltOk) return;

        // ── Step 5: Cobalt web UI fallback ──
        DebugManager.log('Download', 'All methods failed, opening Cobalt web UI');
        _webDownloadFallback(videoUrl);

        // Show install/retry prompt — the user clearly needs help
        if (!GM_getValue('ytkit_mediadl_prompt_dismissed', false)) {
            MediaDLManager.showInstallPrompt('retry');
        }
    }

    async function _mediaDLSendDownload(videoUrl, audioOnly, token) {
        DebugManager.log('MediaDL', `Sending download: ${videoUrl} (audio=${audioOnly})`);
        const streams = await _extractStreamingData(audioOnly);
        if (streams) {
            DebugManager.log('MediaDL', `Extracted streams for "${streams.title}" (${streams.videoId})`);
        } else {
            DebugManager.log('MediaDL', 'No streams extracted - server will use yt-dlp fallback');
        }
        const payload = { url: videoUrl, audioOnly: audioOnly || false };
        if (streams) payload.streams = streams;

        // Extract cookies via GM_cookie (requires ScriptVault with cookies permission).
        // Sends all YouTube cookies (including httpOnly) to the server for yt-dlp fallback.
        const sendDownload = () => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'http://127.0.0.1:9751/download',
                headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
                data: JSON.stringify(payload),
                timeout: 5000,
                onload: function(r) {
                    DebugManager.log('MediaDL', `Download response: ${r.status} - ${r.responseText}`);
                    try {
                        const resp = JSON.parse(r.responseText);
                        if (resp.status === 'complete' && resp.message === 'Already downloaded') {
                            showToast('File already exists - skipping download', '#3b82f6', { duration: 3 });
                        } else if (resp.message === 'Already downloading') {
                            showToast('Already downloading this video', '#f59e0b', { duration: 3 });
                        } else if (resp.id) {
                            showDownloadProgress(resp.id, token, audioOnly);
                        } else {
                            showToast('MediaDL: ' + (resp.error || 'Unknown error'), '#ef4444', { duration: 5 });
                        }
                    } catch (parseErr) {
                        showToast('MediaDL server returned invalid response', '#ef4444', { duration: 5 });
                    }
                },
                onerror: function(err) {
                    DebugManager.log('MediaDL', `Download request error: ${JSON.stringify(err)}`);
                    showToast('MediaDL download request failed', '#ef4444', { duration: 5 });
                },
                ontimeout: function() {
                    DebugManager.log('MediaDL', 'Download request timed out');
                    showToast('MediaDL request timed out', '#ef4444', { duration: 5 });
                }
            });
        };

        if (typeof GM_cookie !== 'undefined' && GM_cookie.list) {
            try {
                GM_cookie.list({ domain: '.youtube.com' }, (cookies, error) => {
                    if (!error && cookies && cookies.length > 0) {
                        payload.cookies = cookies.map(c => ({
                            domain: c.domain, name: c.name, value: c.value,
                            path: c.path || '/', secure: !!c.secure,
                            httpOnly: !!c.httpOnly,
                            expirationDate: c.expirationDate || 0
                        }));
                        DebugManager.log('MediaDL', `Attached ${cookies.length} cookies for yt-dlp fallback`);
                    } else {
                        DebugManager.log('MediaDL', 'GM_cookie returned no cookies (permission may not be granted)');
                    }
                    sendDownload();
                });
            } catch (e) {
                DebugManager.log('MediaDL', `GM_cookie error: ${e.message}`);
                sendDownload();
            }
        } else {
            sendDownload();
        }
    }

    // Aggressive button injection system with MutationObserver
    const persistentButtons = new Map(); // id -> { parentSelector, checkSelector, injectFn }
    let buttonObserver = null;
    let buttonCheckInterval = null;
    let buttonCheckStarted = false;

    function registerPersistentButton(id, parentSelector, checkSelector, injectFn, pcLabel) {
        persistentButtons.set(id, { parentSelector, checkSelector, injectFn, pcLabel });
        DebugManager.log('Buttons', `Registered: ${id} (total: ${persistentButtons.size})`);
        startButtonChecker();
        // Try immediately
        tryInjectButton(id);
    }

    function unregisterPersistentButton(id) {
        const config = persistentButtons.get(id);
        if (config) {
            document.querySelector(config.checkSelector)?.remove();
        }
        persistentButtons.delete(id);
        // Clean up observer when no buttons remain
        if (persistentButtons.size === 0 && buttonObserver) {
            buttonObserver.disconnect();
            buttonObserver = null;
            buttonCheckStarted = false;
        }
    }

    function tryInjectButton(id) {
        if (!window.location.pathname.startsWith('/watch')) return false;

        const config = persistentButtons.get(id);
        if (!config) return false;

        // If button already exists anywhere in DOM, done
        if (document.querySelector(config.checkSelector)) return true;

        // Find the action buttons container (skip clarify-box copies)
        let target = null;
        const allBtnContainers = document.querySelectorAll('#top-level-buttons-computed');
        for (const el of allBtnContainers) {
            if (!el.closest('#clarify-box, ytd-info-panel-container-renderer, ytd-clarification-renderer')) {
                target = el;
                break;
            }
        }

        // Fallback: try parent containers
        if (!target) {
            const fallbacks = [
                'ytd-watch-metadata:not([hidden]) ytd-menu-renderer',
                '#above-the-fold ytd-menu-renderer',
                'ytd-watch-metadata:not([hidden]) #actions-inner',
                'ytd-watch-metadata:not([hidden]) #actions',
                '#above-the-fold #actions',
                '#below #actions',
                'ytd-watch-metadata #actions',
            ];
            for (const sel of fallbacks) {
                try {
                    const el = document.querySelector(sel);
                    if (el && !el.closest('#clarify-box, ytd-info-panel-container-renderer')) {
                        target = el;
                        break;
                    }
                } catch (e) { /* skip */ }
            }
        }

        if (!target) {
            // Only warn if we've been on the watch page long enough — the first 2s is normal
            // Polymer render lag; the 1s/2.5s retry timers will succeed without noise.
            const onPageFor = Date.now() - (tryInjectButton._pageArrival || Date.now());
            if (onPageFor > 2000) {
                if (!tryInjectButton._lastDebugTime || Date.now() - tryInjectButton._lastDebugTime > 5000) {
                    tryInjectButton._lastDebugTime = Date.now();
                    const tlbc = document.querySelector('#top-level-buttons-computed');
                    const actions = document.querySelector('#actions');
                    const menu = document.querySelector('ytd-menu-renderer');
                    const metadata = document.querySelector('ytd-watch-metadata');
                    console.warn(`[YTKit Buttons] No target for ${id}:`,
                        `#top-level-buttons-computed=${!!tlbc}${tlbc ? '(inClarify=' + !!tlbc.closest('#clarify-box') + ')' : ''}`,
                        `#actions=${!!actions}`,
                        `ytd-menu-renderer=${!!menu}`,
                        `ytd-watch-metadata=${!!metadata}`
                    );
                }
            }
            return false;
        }

        try {
            config.injectFn(target);
            DebugManager.log('Buttons', `Injected ${id} into`, target.tagName + '#' + (target.id || ''));
            // Wrap with dismiss X if a label was provided
            if (config.pcLabel) {
                const injected = document.querySelector(config.checkSelector);
                if (injected) wrapPageControl(injected, id, { label: config.pcLabel });
            }
            return true;
        } catch (e) {
            console.error(`[YTKit] Failed to inject ${id}:`, e);
            return false;
        }
    }

    // Track current video ID to clear injection tracking on video change
    let lastVideoId = null;

    function checkAllButtons() {
        if (!window.location.pathname.startsWith('/watch')) return;

        // Check if video changed
        const currentVideoId = getVideoId();
        if (currentVideoId && currentVideoId !== lastVideoId) {
            lastVideoId = currentVideoId;
            DebugManager.log('Buttons', `New video: ${currentVideoId}, ${persistentButtons.size} buttons registered`);
        }

        if (persistentButtons.size === 0) return;

        for (const id of persistentButtons.keys()) {
            tryInjectButton(id);
        }
    }

    function startButtonChecker() {
        if (buttonCheckStarted) return;
        buttonCheckStarted = true;

        // Debounce timer for observer
        let debounceTimer = null;
        let lastCheckTime = 0;
        const MIN_CHECK_INTERVAL = 500;

        // MutationObserver to detect when button container appears OR buttons are removed
        if (!buttonObserver) {
            buttonObserver = new MutationObserver((mutations) => {
                if (Date.now() - lastCheckTime < MIN_CHECK_INTERVAL) return;

                let needsRecheck = false;

                for (const m of mutations) {
                    if (m.type === 'childList' && m.addedNodes.length > 0) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType === 1) {
                                if (node.id === 'top-level-buttons-computed' ||
                                    node.id === 'actions' ||
                                    node.id === 'actions-inner' ||
                                    (node.querySelector && node.querySelector('#top-level-buttons-computed'))) {
                                    needsRecheck = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (m.type === 'childList' && m.removedNodes.length > 0) {
                        for (const node of m.removedNodes) {
                            if (node.nodeType === 1 && node.classList && (
                                node.classList.contains('ytkit-vlc-btn') ||
                                node.classList.contains('ytkit-local-dl-btn') ||
                                node.classList.contains('ytkit-mp3-dl-btn') ||
                                node.classList.contains('ytkit-embed-btn') ||
                                node.classList.contains('ytkit-mpv-btn') ||
                                node.classList.contains('ytkit-dlplay-btn') ||
                                node.classList.contains('ytkit-transcript-btn'))) {
                                needsRecheck = true;
                                break;
                            }
                        }
                    }

                    if (needsRecheck) break;
                }

                if (needsRecheck && !debounceTimer) {
                    debounceTimer = setTimeout(() => {
                        debounceTimer = null;
                        lastCheckTime = Date.now();
                        checkAllButtons();
                    }, 300);
                }
            });
            buttonObserver.observe(document.body, { childList: true, subtree: true });
        }

        // Initial checks
        checkAllButtons();
        setTimeout(checkAllButtons, 500);
        setTimeout(checkAllButtons, 1500);

        // SPA navigation — use navigate rule system instead of separate listener
        let spaTimers = [];
        addNavigateRule('_buttonChecker', () => {
            spaTimers.forEach(t => clearTimeout(t));
            spaTimers = [];
            lastVideoId = null;
            tryInjectButton._pageArrival = Date.now();
            checkAllButtons();
            spaTimers.push(setTimeout(checkAllButtons, 1000));
        });
    }

    const runNavigateRules = () => {
        const isWatch = window.location.pathname.startsWith('/watch');
        for (const rule of navigateRules.values()) {
            try { rule(document.body, isWatch); } catch (e) { console.error('[YTKit] Navigate rule error:', e); }
        }
    };

    // Debounce to prevent rapid repeated calls
    let navigateDebounceTimer = null;
    const debouncedRunNavigateRules = () => {
        if (navigateDebounceTimer) clearTimeout(navigateDebounceTimer);
        navigateDebounceTimer = setTimeout(runNavigateRules, TIMING.NAV_DEBOUNCE);
    };

    const ensureNavigateListener = () => {
        if (isNavigateListenerAttached) return;

        // Primary: yt-navigate-finish (covers 99.9% of YouTube SPA navigations)
        document.addEventListener('yt-navigate-finish', debouncedRunNavigateRules);

        // Backup: yt-page-data-updated fires when YouTube refreshes page data (catches edge cases yt-navigate-finish misses)
        document.addEventListener('yt-page-data-updated', debouncedRunNavigateRules);

        // Fallback: popstate for browser back/forward
        window.addEventListener('popstate', debouncedRunNavigateRules);

        // Targeted attribute observer: watch video-id changes on ytd-watch-flexy (lightweight)
        const watchFlexy = document.querySelector('ytd-watch-flexy');
        if (watchFlexy) {
            const attrObserver = new MutationObserver(() => debouncedRunNavigateRules());
            attrObserver.observe(watchFlexy, { attributes: true, attributeFilter: ['video-id'] });
        }

        // Run immediately
        runNavigateRules();

        isNavigateListenerAttached = true;
    };

    function addNavigateRule(id, ruleFn) {
        ensureNavigateListener();
        navigateRules.set(id, ruleFn);
        ruleFn(document.body);
    }

    function removeNavigateRule(id) {
        navigateRules.delete(id);
    }

    const runMutationRules = (targetNode) => {
        for (const rule of mutationRules.values()) {
            try { rule(targetNode); } catch (e) { console.error('[YTKit] Mutation rule error:', e); }
        }
    };

    let _mutationScheduled = false;
    const observerCallback = () => {
        if (_mutationScheduled) return;
        _mutationScheduled = true;
        requestAnimationFrame(() => {
            _mutationScheduled = false;
            runMutationRules(document.body);
        });
    };

    function startObserver() {
        if (mutationObserver) return;
        mutationObserver = new MutationObserver(observerCallback);
        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['theater', 'fullscreen', 'hidden', 'video-id', 'page-subtype']
        });
    }

    function stopObserver() {
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
    }

    function addMutationRule(id, ruleFn) {
        if (mutationRules.size === 0) startObserver();
        mutationRules.set(id, ruleFn);
        ruleFn(document.body);
    }

    function removeMutationRule(id) {
        mutationRules.delete(id);
        if (mutationRules.size === 0) stopObserver();
    }

    //  SECTION 1: SETTINGS MANAGER
    const settingsManager = {
        defaults: {
            hideCreateButton: true,
            hideVoiceSearch: true,
            logoToSubscriptions: true,
            widenSearchBar: true,
            squareSearchBar: true,
            squareAvatars: true,
            subscriptionsGrid: true,
            homepageGridAlign: true,
            styledFilterChips: true,
            hideSidebar: true,
            uiStyle: 'square',
            noAmbientMode: true,
            compactLayout: true,
            thinScrollbar: true,
            watchPageRestyle: true,
            chatStyleComments: true,
            removeAllShorts: true,
            redirectShorts: true,
            disablePlayOnHover: true,
            fullWidthSubscriptions: true,
            hideSubscriptionOptions: true,
            hidePaidContentOverlay: true,
            redirectToVideosTab: true,
            hidePlayables: true,
            hideMembersOnly: true,
            hideNewsHome: true,
            hidePlaylistsHome: true,
            hideRelatedVideos: true,
            expandVideoWidth: true,
            floatingLogoOnWatch: true,
            hideDescriptionRow: true,
            // Consolidated: replaces hideVideoEndCards, hideVideoEndScreen, hideEndVideoStills
            hideVideoEndContent: true,
            stickyVideo: true,
            cleanShareUrls: true,
            videosPerRow: 0,                // 0 = dynamic, 3-8 = fixed columns
            quickLinkMenu: true,
            quickLinkItems: 'History | /feed/history\nWatch Later | /playlist?list=WL\nPlaylists | /feed/library\nLiked Videos | /playlist?list=LL\nSubscriptions | /feed/subscriptions\nFor You Page | /',
            autoMaxResolution: true,
            preferredQuality: 'max', // 'max' | '4320' | '2160' | '1440' | '1080' | '720' | '480'
            useEnhancedBitrate: true,
            hideQualityPopup: true,
            hideMerchShelf: true,
            hideAiSummary: true,

            hideDescriptionExtras: true,
            hideHashtags: true,
            hidePinnedComments: true,
            hideCommentActionMenu: true,
            condenseComments: true,
            hideCommentTeaser: true,
            autoExpandComments: true,
            hideLiveChatEngagement: true,
            hidePaidPromotionWatch: true,
            hideChannelJoinButton: true,
            hideFundraiser: true,
            hiddenChatElementsManager: true,
            hiddenChatElements: [
                'header', 'menu', 'popout', 'reactions', 'timestamps',
                'polls', 'ticker', 'leaderboard', 'support', 'banner',
                'emoji', 'topFan', 'superChats', 'levelUp', 'bots'
            ],
            chatKeywordFilter: '',
            hiddenActionButtonsManager: true,
            hiddenActionButtons: [
                'like', 'dislike', 'share', 'ask', 'clip',
                'thanks', 'save', 'sponsor', 'moreActions'
            ],
            replaceWithCobaltDownloader: false,
            hiddenPlayerControlsManager: true,
            hiddenPlayerControls: [
                'next', 'autoplay', 'subtitles',
                'captions', 'miniplayer', 'pip', 'theater', 'fullscreen'
            ],
            hiddenWatchElementsManager: true,
            hiddenWatchElements: [
                'joinButton', 'askButton', 'saveButton', 'moreActions',
                'askAISection', 'podcastSection', 'transcriptSection', 'channelInfoCards'
            ],
            showVlcButton: false,
            showLocalDownloadButton: true,
            showMp3DownloadButton: true,
            videoContextMenu: true,
            downloadProvider: 'cobalt',
            cobaltUrl: 'https://cobalt.tools/#',
            hideCollaborations: true,
            hideVideosFromHome: true,
            hideVideosKeywordFilter: '',
            hideVideosDurationFilter: 0,
            hideVideosSubsLoadLimit: true,
            hideVideosSubsLoadThreshold: 3,
            hideInfoPanels: true,
            colorTheme: 'none',
            commentEnhancements: true,
            sidebarOrder: null,

            // v2.4.0 features
            // mousewheelVolume removed in v2.5.0 (interfered with page scrolling)
            forceH264: false,
            titleNormalization: false,
            watchProgress: false,

            // v3.2.0 features
            autoDismissStillWatching: false,
            remainingTimeDisplay: false,
            showPlaylistDuration: false,
            showTimeInTabTitle: false,
            customProgressBarColor: '#ff0000',
            compactUnfixedHeader: false,
            reversePlaylist: false,
            rssFeedLink: false,
            preciseViewCounts: false,
            returnYoutubeDislike: false,
            videoScreenshot: false,
            perChannelSpeed: false,
            hideWatchedVideos: false,
            hideWatchedMode: 'dim',
            antiTranslate: false,
            pauseOtherTabs: false,

            // v3.2.0 wave 2
            abLoop: false,
            fineSpeedControl: false,
            showChannelVideoCount: false,
            redirectHomeToSubs: false,
            notInterestedButton: false,
            timestampBookmarks: false,
            blueLightFilter: false,
            blueLightIntensity: 30,
            disableInfiniteScroll: false,
            popOutPlayer: false,

            // v3.2.0 wave 3
            watchTimeTracker: false,
            alwaysShowProgressBar: false,
            sortCommentsNewest: false,
            autoSkipChapters: false,
            autoSkipChapterPatterns: 'intro,outro,recap,sponsor',
            chapterNavButtons: false,
            videoLoopButton: false,
            persistentSpeed: false,
            persistentSpeedValue: 1,
            codecSelector: 'auto',
            ageRestrictionBypass: false,
            autoLikeSubscribed: false,
            thumbnailPreviewSize: false,

            // v3.2.0 wave 4
            cinemaAmbientGlow: false,
            transcriptViewer: false,
            searchFilterDefaults: false,
            searchFilterSort: 'upload_date',
            forceStandardFps: false,
            stickyChat: false,
            autoExpandDescription: false,
            keyMoments: false,
            scrollToPlayer: false,
            hideEndCards: false,
            hideInfoCards: false,

            // v3.2.0 wave 5
            autoTheaterMode: false,
            resumePlayback: false,
            miniPlayerBar: false,
            playbackStatsOverlay: false,
            hideNotificationBadge: false,
            autoPauseOnSwitch: false,
            creatorCommentHighlight: false,
            copyVideoTitle: false,
            channelAgeDisplay: false,
            speedIndicatorOverlay: false,
            hideAutoplayToggle: false,
            fullscreenOnDoubleClick: false,

            // v3.2.0 wave 6
            rememberVolume: false,
            rememberVolumeLevel: 100,
            pipButton: false,
            autoSubtitles: false,
            autoSubtitleLang: 'en',
            focusedMode: false,
            thumbnailQualityUpgrade: false,
            watchLaterQuickAdd: false,
            playlistEnhancer: false,
            commentSearch: false,
            videoZoom: false,
            forceDarkEverywhere: false,

            // v3.2.0 wave 7
            customCssInjection: false,
            customCssCode: '',
            shareMenuCleaner: false,
            autoClosePopups: false,
            videoResolutionBadge: false,
            likeViewRatio: false,
            downloadThumbnail: false,
            grayscaleThumbnails: false,
            disableAutoplayNext: false,
            channelSubCount: false,
            customSpeedButtons: false,
            openInNewTab: false,

            // v3.2.0 wave 8 — restored from archive
            preventAutoplay: false,
            hideNotificationButton: false,
            noFrostedGlass: false,
            autoOpenChapters: false,
            autoOpenTranscript: false,
            chronologicalNotifications: false,
            hideLatestPosts: false,
            disableMiniPlayer: false,
            adaptiveLiveLayout: false,
            commentNavigator: false,
            shortsAsRegularVideo: false,
            themeAccentColor: '',
            theaterAutoScroll: false,
            scrollWheelSpeed: false,
            speedStep: 0.25,
            preloadComments: false,
            // autoExpandComments already defined above as true
            playbackSpeedOSD: false,
            enableCPU_Tamer: false,
            enableHandleRevealer: false,
            showVlcQueueButton: false,
            showMpvButton: false,
            autoDownloadOnVisit: false,
            downloadQuality: 'best',
            preferredMediaPlayer: 'vlc',
            showDownloadPlayButton: false,
            subsVlcPlaylist: false,
            deArrow: false,
            daReplaceTitles: true,
            daReplaceThumbs: true,
            daTitleFormat: 'sentence',
            daFallbackFormat: true,
            daShowOriginalHover: true,
            daCacheTTL: '4',
            showStatisticsDashboard: false,
            settingsProfiles: false,
            debugMode: false,
            nyanCatProgressBar: false,
            fitPlayerToWindow: false,
            disableSpaNavigation: false,

        },

        // Settings versioning and migration
        SETTINGS_VERSION: 2,

        _migrations: {
            // v1 -> v2: Renamed/restructured settings in 2.1.2
            2: (s) => {
                // Future migrations go here. Example:
                // if (s.oldKey !== undefined) { s.newKey = s.oldKey; delete s.oldKey; }
                return s;
            },
        },

        _migrate(savedSettings) {
            let version = savedSettings._settingsVersion || 1;
            if (version >= this.SETTINGS_VERSION) return savedSettings;
            DebugManager.log('Settings', `Migrating from v${version} to v${this.SETTINGS_VERSION}`);
            while (version < this.SETTINGS_VERSION) {
                version++;
                if (this._migrations[version]) {
                    savedSettings = this._migrations[version](savedSettings);
                    DebugManager.log('Settings', `Applied migration v${version}`);
                }
            }
            savedSettings._settingsVersion = this.SETTINGS_VERSION;
            return savedSettings;
        },

        load() {
            const knownSettingKeys = new Set(Object.keys(this.defaults));
            let savedSettings = sanitizeSettingsObject(StorageManager.get('ytSuiteSettings', {}), knownSettingKeys);
            const storedVersion = savedSettings._settingsVersion;
            savedSettings = sanitizeSettingsObject(this._migrate(savedSettings), knownSettingKeys);
            const merged = { ...this.defaults, ...savedSettings, _settingsVersion: this.SETTINGS_VERSION };
            // Persist migrated settings if version changed
            if (storedVersion !== this.SETTINGS_VERSION) {
                this.save(merged);
            }
            return merged;
        },

        save(settings) {
            const knownSettingKeys = new Set(Object.keys(this.defaults));
            const sanitized = sanitizeSettingsObject(settings, knownSettingKeys);
            sanitized._settingsVersion = this.SETTINGS_VERSION;
            StorageManager.set('ytSuiteSettings', sanitized);
        },
        getFirstRunStatus() {
            return StorageManager.get('ytSuiteHasRun', false);
        },
        setFirstRunStatus(hasRun) {
            StorageManager.set('ytSuiteHasRun', hasRun);
        },
        exportAllSettings() {
            const settings = this.load();
            // Include hidden videos, blocked channels, and bookmarks in export
            let hiddenVideos = [];
            let blockedChannels = [];
            let bookmarks = {};
            try {
                hiddenVideos = sanitizeImportedHiddenVideos(StorageManager.get('ytkit-hidden-videos', []));
                blockedChannels = sanitizeImportedBlockedChannels(StorageManager.get('ytkit-blocked-channels', []));
                bookmarks = sanitizeImportedBookmarks(StorageManager.get('ytkit-bookmarks', {}));
            } catch(e) {
                console.warn('[YTKit] Failed to load data for export:', e);
            }
            const exportData = {
                settings: sanitizeSettingsObject(settings, new Set(Object.keys(this.defaults))),
                hiddenVideos: hiddenVideos,
                blockedChannels: blockedChannels,
                bookmarks: bookmarks,
                exportVersion: 3,
                exportDate: new Date().toISOString(),
                ytkitVersion: YTKIT_VERSION
            };
            return JSON.stringify(exportData, null, 2);
        },
        importAllSettings(jsonString) {
            try {
                if (typeof jsonString !== 'string' || estimateSerializedBytes(jsonString) > 10 * 1024 * 1024) return false;
                const importedData = JSON.parse(jsonString);
                if (!isPlainObject(importedData)) return false;

                // Handle different export versions
                let settings, hiddenVideos, blockedChannels, bookmarks;
                if (importedData.exportVersion >= 3) {
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                    bookmarks = importedData.bookmarks || {};
                } else if (importedData.exportVersion >= 2) {
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                    bookmarks = null;
                } else {
                    settings = importedData;
                    hiddenVideos = null;
                    blockedChannels = null;
                    bookmarks = null;
                }

                const knownSettingKeys = new Set(Object.keys(this.defaults));
                if (settings !== null && !isPlainObject(settings)) return false;
                if (hiddenVideos !== null && !Array.isArray(hiddenVideos)) return false;
                if (blockedChannels !== null && !Array.isArray(blockedChannels)) return false;
                if (bookmarks !== null && !isPlainObject(bookmarks)) return false;

                settings = sanitizeSettingsObject(settings, knownSettingKeys);
                hiddenVideos = hiddenVideos === null ? null : sanitizeImportedHiddenVideos(hiddenVideos);
                blockedChannels = blockedChannels === null ? null : sanitizeImportedBlockedChannels(blockedChannels);
                bookmarks = bookmarks === null ? null : sanitizeImportedBookmarks(bookmarks);

                const sawVersionedSection = importedData.exportVersion >= 3
                    ? ('settings' in importedData || 'hiddenVideos' in importedData || 'blockedChannels' in importedData || 'bookmarks' in importedData)
                    : importedData.exportVersion >= 2
                        ? ('settings' in importedData || 'hiddenVideos' in importedData || 'blockedChannels' in importedData)
                        : true;
                if (!sawVersionedSection) return false;
                if (importedData.exportVersion < 2 && Object.keys(settings).length === 0) return false;

                const importPayload = {
                    settings,
                    hiddenVideos,
                    blockedChannels,
                    bookmarks
                };
                if (estimateSerializedBytes(importPayload) > IMPORT_LIMITS.totalBytes) return false;

                // Backup current state before applying
                const backup = {
                    settings: { ...appState.settings },
                    hiddenVideos: sanitizeImportedHiddenVideos(StorageManager.get('ytkit-hidden-videos', [])),
                    blockedChannels: sanitizeImportedBlockedChannels(StorageManager.get('ytkit-blocked-channels', [])),
                    bookmarks: sanitizeImportedBookmarks(StorageManager.get('ytkit-bookmarks', {})),
                };

                try {
                    const newSettings = { ...this.defaults, ...settings, _settingsVersion: this.SETTINGS_VERSION };
                    this.save(newSettings);
                    if (hiddenVideos !== null) StorageManager.set('ytkit-hidden-videos', hiddenVideos);
                    if (blockedChannels !== null) StorageManager.set('ytkit-blocked-channels', blockedChannels);
                    if (bookmarks !== null) StorageManager.set('ytkit-bookmarks', bookmarks);
                    return true;
                } catch (applyErr) {
                    // Rollback on failure
                    console.error('[YTKit] Import apply failed, rolling back:', applyErr);
                    this.save(backup.settings);
                    StorageManager.set('ytkit-hidden-videos', backup.hiddenVideos);
                    StorageManager.set('ytkit-blocked-channels', backup.blockedChannels);
                    StorageManager.set('ytkit-bookmarks', backup.bookmarks);
                    return false;
                }
            } catch (e) {
                console.error("[YTKit] Failed to import settings:", e);
                return false;
            }
        }
    };

    // ── DOM Element Cache — invalidated on SPA navigation ──
    const _elCache = new Map();
    let _elCacheHref = '';
    function cachedQuery(selector) {
        const href = window.location.href;
        if (href !== _elCacheHref) { _elCache.clear(); _elCacheHref = href; }
        if (_elCache.has(selector)) {
            const el = _elCache.get(selector);
            if (el && el.isConnected) return el;
            _elCache.delete(selector);
        }
        const el = document.querySelector(selector);
        if (el) _elCache.set(selector, el);
        return el;
    }

    //  SECTION 2: FEATURE DEFINITIONS
    // CSS-only feature factory — eliminates boilerplate for features that just inject/remove a style
    function cssFeature(id, name, description, group, icon, css, extra) {
        const isRaw = css.includes('{');
        const f = {
            id, name, description, group, icon,
            _styleElement: null,
            init() { this._styleElement = injectStyle(css, this.id, isRaw); },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        };
        if (extra) Object.assign(f, extra);
        return f;
    }

    // App state - declared before features so feature closures can reference it
    let appState = {};

    // ── Fast Video ID getter (avoids URLSearchParams on every call) ──
    const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
    const VIDEO_ID_PATH_PREFIXES = ['/shorts/', '/embed/', '/live/'];
    let _cachedVid = null, _cachedHref = '';
    function _extractVideoIdFromUrl(urlValue = window.location.href) {
        let parsed;
        try {
            parsed = urlValue instanceof URL ? urlValue : new URL(urlValue, window.location.origin);
        } catch {
            return null;
        }

        const queryVideoId = parsed.searchParams.get('v');
        if (typeof queryVideoId === 'string' && VIDEO_ID_PATTERN.test(queryVideoId)) {
            return queryVideoId;
        }

        const pathname = parsed.pathname || '';
        for (const prefix of VIDEO_ID_PATH_PREFIXES) {
            if (!pathname.startsWith(prefix)) continue;
            const candidate = pathname.slice(prefix.length).split(/[/?#]/, 1)[0];
            return VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
        }

        return null;
    }

    function getVideoId(urlValue = window.location.href) {
        const href = urlValue instanceof URL ? urlValue.href : (typeof urlValue === 'string' && urlValue ? urlValue : window.location.href);
        if (href === _cachedHref) return _cachedVid;
        _cachedHref = href;
        _cachedVid = _extractVideoIdFromUrl(href);
        return _cachedVid;
    }
    // Centralized detection: 'live' | 'vod' | 'standard' | 'premiere'
    // Used by Theater Split to decide what goes in the right panel,
    // and by other features to skip irrelevant operations.
    const VideoTypeDetector = {
        _cache: { videoId: null, type: 'standard' },

        // Primary detection via ytInitialPlayerResponse (most reliable)
        _fromPlayerResponse() {
            try {
                const pr = window.ytInitialPlayerResponse;
                if (!pr?.videoDetails) return null;
                const d = pr.videoDetails;
                const vid = getVideoId();
                if (d.videoId && d.videoId !== vid) return null; // stale response
                if (d.isUpcoming) return 'premiere';
                if (d.isLive) return 'live';
                if (d.isLiveContent || d.isPostLiveDvr) return 'vod';
                return 'standard';
            } catch (e) { return null; }
        },

        // Fallback: DOM signals
        _fromDOM() {
            const video = cachedQuery('video.html5-main-video');
            const liveBadge = cachedQuery('.ytp-live-badge');
            const liveBadgeActive = liveBadge && !liveBadge.classList.contains('ytp-live-badge-disabled')
                && window.getComputedStyle(liveBadge).display !== 'none';
            const chatFrame = cachedQuery('ytd-live-chat-frame, #chat');
            const hasChatFrame = chatFrame && !chatFrame.hasAttribute('hidden');

            // Currently live: badge active + infinite duration
            if (liveBadgeActive) return 'live';
            if (video && !isFinite(video.duration) && hasChatFrame) return 'live';

            // VOD: has chat frame (replay) but not currently live
            if (hasChatFrame && video && isFinite(video.duration)) return 'vod';

            // Chat frame present but no video yet — likely live or VOD
            if (hasChatFrame) return 'vod';

            return 'standard';
        },

        // Get cached type for current video, refreshing if video changed
        getType() {
            const vid = getVideoId();
            if (vid && vid === this._cache.videoId) return this._cache.type;
            this.refresh();
            return this._cache.type;
        },

        // Force refresh detection
        refresh() {
            const vid = getVideoId();
            const type = this._fromPlayerResponse() || this._fromDOM();
            this._cache = { videoId: vid, type };
            DebugManager.log('VideoType', `Detected: ${type} for ${vid}`);
            return type;
        },

        // Convenience checks
        isLive()      { return this.getType() === 'live'; },
        isVOD()       { return this.getType() === 'vod'; },
        isStandard()  { return this.getType() === 'standard'; },
        isPremiere()  { return this.getType() === 'premiere'; },
        hasChat()     { return this.isLive() || this.isVOD(); },
        hasComments() { return this.isStandard() || this.isVOD(); },

        // Get the chat element (ytd-live-chat-frame or #chat container)
        getChatEl() {
            return document.querySelector('ytd-live-chat-frame#chat, ytd-live-chat-frame, #chat');
        }
    };

    // ─── Conflict Detection Map ───
    const CONFLICT_MAP = {
        hideRelatedVideos: { conflicts: [], note: 'expandVideoWidth depends on this' },
        hideSidebar: { conflicts: ['hiddenChatElementsManager'], reason: 'Sidebar hidden removes chat access' },
        removeAllShorts: { conflicts: ['redirectShorts'], reason: 'Removed shorts cannot be redirected' },
        persistentSpeed: { conflicts: ['perChannelSpeed'], reason: 'Global speed overrides per-channel speed' },
        perChannelSpeed: { conflicts: ['persistentSpeed'], reason: 'Per-channel speed overrides global speed' },
        // focusedMode now hides only related videos, not all of #secondary — cooperates with transcriptViewer/timestampBookmarks/stickyVideo
        // forceH264 and codecSelector now share a single canPlayType patch — cooperate cleanly
        // autoPauseOnSwitch and pauseOtherTabs now tag pause reasons — cooperate cleanly
        // popOutPlayer sets __ytkit_videoPopped flag — pipButton/fullscreenOnDoubleClick check it
        fitPlayerToWindow: { conflicts: ['stickyVideo'], reason: 'Both control player positioning on watch pages' },
        stickyVideo: { conflicts: ['fitPlayerToWindow'], reason: 'Both control player positioning on watch pages' },
    };



    // ─── Feature Preview Descriptions ───
    const FEATURE_PREVIEWS = {
        logoToSubscriptions: 'Logo click goes to /feed/subscriptions instead of homepage',
        widenSearchBar: 'Search bar expands ~480px wider to fill header space',
        squareSearchBar: 'Removes rounded corners from search bar and button',
        squareAvatars: 'All channel avatars use square borders instead of circles',
        fitPlayerToWindow: 'Video player fills the entire browser viewport on watch pages',
        disableSpaNavigation: 'Every link triggers a full page load instead of SPA transition',
        subscriptionsGrid: 'Subscriptions feed uses CSS grid with 340px min columns',
        homepageGridAlign: 'Homepage thumbnails snap to uniform grid rows',
        styledFilterChips: 'Filter chips get glassmorphism, hover lift, uniform sizing',
        hideSidebar: 'Left nav panel completely removed, page-manager goes full-width',
        uiStyleManager: 'Applies border-radius:0 globally for square UI look',
        chatStyleComments: 'Comments get compact card layout with inline vote badges',
        removeAllShorts: 'All shorts links and shelf renderers hidden site-wide',
        redirectShorts: 'Shorts URLs rewritten to /watch?v= for standard player',
        stickyVideo: 'Full-screen player with scroll-triggered side-by-side comments',
        hideRelatedVideos: 'Secondary panel hidden, primary stretches to full width',
        expandVideoWidth: 'Primary column gets max-width:none when sidebar is hidden',
        autoMaxResolution: 'Forces highest available resolution on video load',
        autoExpandComments: 'Removes comment truncation, clicks Read More automatically',
        commentEnhancements: 'Highlights creator replies, shows like heat, collapse toggle',
    };

    const features = [
        // ─── Interface ───
        cssFeature('hideCreateButton', 'Hide Create Button', 'Remove the "Create" button from the header toolbar', 'Home / Subscriptions', 'plus-circle',
            'ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])'),
        cssFeature('hideVoiceSearch', 'Hide Voice Search', 'Remove the microphone icon from the search bar', 'Home / Subscriptions', 'mic-off',
            '#voice-search-button'),
        {
            id: 'logoToSubscriptions',
            name: 'Logo → Subscriptions',
            description: 'Clicking the YouTube logo goes to your subscriptions feed',
            group: 'Home / Subscriptions',
            icon: 'home',
            _styleEl: null,
            _relinkLogo() {
                const logoRenderer = document.querySelector('ytd-topbar-logo-renderer');
                if (!logoRenderer) return;
                const link = logoRenderer.querySelector('a#logo');
                if (link) link.href = '/feed/subscriptions';
            },
            init() {
                // Replace the YouTube logo icon with the custom PremiumYTM branding
                this._styleEl = GM_addStyle(`#country-code{display:none;} #logo-icon{width:98px;content:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 846 174'%3E%3Cg%3E%3Cpath style='fill:%23ff0000' d='M 242.88,27.11 A 31.07,31.07 0 0 0 220.95,5.18 C 201.6,0 124,0 124,0 124,0 46.46,0 27.11,5.18 A 31.07,31.07 0 0 0 5.18,27.11 C 0,46.46 0,86.82 0,86.82 c 0,0 0,40.36 5.18,59.71 a 31.07,31.07 0 0 0 21.93,21.93 c 19.35,5.18 96.92,5.18 96.92,5.18 0,0 77.57,0 96.92,-5.18 a 31.07,31.07 0 0 0 21.93,-21.93 c 5.18,-19.35 5.18,-59.71 5.18,-59.71 0,0 0,-40.36 -5.18,-59.71 z'/%3E%3Cpath style='fill:%23ffffff' d='M 99.22,124.03 163.67,86.82 99.22,49.61 Z'/%3E%3Cpath style='fill:%23282828' d='m 358.29,55.1 v 6 c 0,30 -13.3,47.53 -42.39,47.53 h -4.43 v 52.5 H 287.71 V 12.36 H 318 c 27.7,0 40.29,11.71 40.29,42.74 z m -25,2.13 c 0,-21.64 -3.9,-26.78 -17.38,-26.78 h -4.43 v 60.48 h 4.08 c 12.77,0 17.74,-9.22 17.74,-29.26 z m 81.22,-6.56 -1.24,28.2 c -10.11,-2.13 -18.45,-0.53 -22.17,6 v 76.26 H 367.52 V 52.44 h 18.8 L 388.45,76 h 0.89 c 2.48,-17.2 10.46,-25.89 20.75,-25.89 a 22.84,22.84 0 0 1 4.42,0.56 z M 441.64,115 v 5.5 c 0,19.16 1.06,25.72 9.22,25.72 7.8,0 9.58,-6 9.75,-18.44 l 21.1,1.24 c 1.6,23.41 -10.64,33.87 -31.39,33.87 -25.18,0 -32.63,-16.49 -32.63,-46.46 v -19 c 0,-31.57 8.34,-47 33.34,-47 25.18,0 31.57,13.12 31.57,45.93 V 115 Z m 0,-22.35 v 7.8 h 17.91 V 92.7 c 0,-20 -1.42,-25.72 -9,-25.72 -7.58,0 -8.91,5.86 -8.91,25.72 z M 604.45,79 v 82.11 H 580 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8.16,2.48 -10.82,7.09 a 35.59,35.59 0 0 1 0.18,4.43 v 82.11 H 537.24 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8,2.48 -10.64,6.92 v 86.72 H 494.5 V 52.44 h 19.33 L 516,66.28 h 0.35 c 5.5,-10.46 14.37,-16.14 24.83,-16.14 10.29,0 16.14,5.14 18.8,14.37 5.68,-9.4 14.19,-14.37 23.94,-14.37 14.86,0 20.53,10.64 20.53,28.86 z m 12.24,-54.4 c 0,-11.71 4.26,-15.07 13.3,-15.07 9.22,0 13.3,3.9 13.3,15.07 0,12.06 -4.08,15.08 -13.3,15.08 -9.04,-0.01 -13.3,-3.02 -13.3,-15.08 z m 1.42,27.84 h 23.41 v 108.72 h -23.41 z m 103.39,0 v 108.72 h -19.15 l -2.13,-13.3 h -0.53 c -5.5,10.64 -13.48,15.07 -23.41,15.07 -14.54,0 -21.11,-9.22 -21.11,-29.26 V 52.44 h 24.47 v 79.81 c 0,9.58 2,13.48 6.92,13.48 A 12.09,12.09 0 0 0 697,138.81 V 52.44 Z M 845.64,79 v 82.11 H 821.17 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8.16,2.48 -10.82,7.09 A 35.59,35.59 0 0 1 802.9,79 v 82.11 H 778.43 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8,2.48 -10.64,6.92 v 86.72 H 735.69 V 52.44 H 755 l 2.13,13.83 h 0.35 c 5.5,-10.46 14.37,-16.14 24.83,-16.14 10.29,0 16.14,5.14 18.8,14.37 5.68,-9.4 14.19,-14.37 23.94,-14.37 14.95,0.01 20.59,10.65 20.59,28.87 z'/%3E%3C/g%3E%3C/svg%3E") !important;} html[dark] #logo-icon{content:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 846 174'%3E%3Cg%3E%3Cpath style='fill:%23ff0000' d='M 242.88,27.11 A 31.07,31.07 0 0 0 220.95,5.18 C 201.6,0 124,0 124,0 124,0 46.46,0 27.11,5.18 A 31.07,31.07 0 0 0 5.18,27.11 C 0,46.46 0,86.82 0,86.82 c 0,0 0,40.36 5.18,59.71 a 31.07,31.07 0 0 0 21.93,21.93 c 19.35,5.18 96.92,5.18 96.92,5.18 0,0 77.57,0 96.92,-5.18 a 31.07,31.07 0 0 0 21.93,-21.93 c 5.18,-19.35 5.18,-59.71 5.18,-59.71 0,0 0,-40.36 -5.18,-59.71 z'/%3E%3Cpath style='fill:%23ffffff' d='M 99.22,124.03 163.67,86.82 99.22,49.61 Z'/%3E%3Cpath style='fill:%23ffffff' d='m 358.29,55.1 v 6 c 0,30 -13.3,47.53 -42.39,47.53 h -4.43 v 52.5 H 287.71 V 12.36 H 318 c 27.7,0 40.29,11.71 40.29,42.74 z m -25,2.13 c 0,-21.64 -3.9,-26.78 -17.38,-26.78 h -4.43 v 60.48 h 4.08 c 12.77,0 17.74,-9.22 17.74,-29.26 z m 81.22,-6.56 -1.24,28.2 c -10.11,-2.13 -18.45,-0.53 -22.17,6 v 76.26 H 367.52 V 52.44 h 18.8 L 388.45,76 h 0.89 c 2.48,-17.2 10.46,-25.89 20.75,-25.89 a 22.84,22.84 0 0 1 4.42,0.56 z M 441.64,115 v 5.5 c 0,19.16 1.06,25.72 9.22,25.72 7.8,0 9.58,-6 9.75,-18.44 l 21.1,1.24 c 1.6,23.41 -10.64,33.87 -31.39,33.87 -25.18,0 -32.63,-16.49 -32.63,-46.46 v -19 c 0,-31.57 8.34,-47 33.34,-47 25.18,0 31.57,13.12 31.57,45.93 V 115 Z m 0,-22.35 v 7.8 h 17.91 V 92.7 c 0,-20 -1.42,-25.72 -9,-25.72 -7.58,0 -8.91,5.86 -8.91,25.72 z M 604.45,79 v 82.11 H 580 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8.16,2.48 -10.82,7.09 a 35.59,35.59 0 0 1 0.18,4.43 v 82.11 H 537.24 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8,2.48 -10.64,6.92 v 86.72 H 494.5 V 52.44 h 19.33 L 516,66.28 h 0.35 c 5.5,-10.46 14.37,-16.14 24.83,-16.14 10.29,0 16.14,5.14 18.8,14.37 5.68,-9.4 14.19,-14.37 23.94,-14.37 14.86,0 20.53,10.64 20.53,28.86 z m 12.24,-54.4 c 0,-11.71 4.26,-15.07 13.3,-15.07 9.22,0 13.3,3.9 13.3,15.07 0,12.06 -4.08,15.08 -13.3,15.08 -9.04,-0.01 -13.3,-3.02 -13.3,-15.08 z m 1.42,27.84 h 23.41 v 108.72 h -23.41 z m 103.39,0 v 108.72 h -19.15 l -2.13,-13.3 h -0.53 c -5.5,10.64 -13.48,15.07 -23.41,15.07 -14.54,0 -21.11,-9.22 -21.11,-29.26 V 52.44 h 24.47 v 79.81 c 0,9.58 2,13.48 6.92,13.48 A 12.09,12.09 0 0 0 697,138.81 V 52.44 Z M 845.64,79 v 82.11 H 821.17 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8.16,2.48 -10.82,7.09 A 35.59,35.59 0 0 1 802.9,79 v 82.11 H 778.43 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8,2.48 -10.64,6.92 v 86.72 H 735.69 V 52.44 H 755 l 2.13,13.83 h 0.35 c 5.5,-10.46 14.37,-16.14 24.83,-16.14 10.29,0 16.14,5.14 18.8,14.37 5.68,-9.4 14.19,-14.37 23.94,-14.37 14.95,0.01 20.59,10.65 20.59,28.87 z'/%3E%3C/g%3E%3C/svg%3E") !important;}`);
                addNavigateRule('relinkLogoRule', () => this._relinkLogo());
            },
            destroy() {
                removeNavigateRule('relinkLogoRule');
                this._styleEl?.remove(); this._styleEl = null;
                const logoLink = document.querySelector('ytd-topbar-logo-renderer a#logo');
                if (logoLink) logoLink.href = '/';
            }
        },
        cssFeature('widenSearchBar', 'Widen Search Bar', 'Expand the search bar to use more available space', 'Home / Subscriptions', 'search',
            `ytd-masthead yt-searchbox { margin-left: -180px; margin-right: -300px; }`),
        {
            id: 'subscriptionsGrid',
            name: 'Subscriptions Grid',
            description: 'Use a denser grid layout on the subscriptions page',
            group: 'Home / Subscriptions',
            icon: 'layout-grid',
            pages: [PageTypes.SUBSCRIPTIONS],
            _styleElement: null,
            init() {
                const css = `ytd-browse[page-subtype="subscriptions"] #contents.ytd-rich-grid-renderer{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:8px;width:99%;} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer.ytd-rich-grid-renderer{width:100% !important;margin:0 !important;margin-left:2px !important;}`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'homepageGridAlign',
            name: 'Homepage Grid Align',
            description: 'Force uniform thumbnail grid on the homepage — prevents misaligned rows caused by variable title/metadata heights',
            group: 'Home / Subscriptions',
            icon: 'layout-grid',
            pages: [PageTypes.HOME],
            _styleElement: null,
            init() {
                const css = `ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(310px,1fr)) !important;gap:16px !important;} ytd-browse[page-subtype="home"] ytd-rich-grid-row,ytd-browse[page-subtype="home"] ytd-rich-grid-row > #contents{display:contents !important;} ytd-browse[page-subtype="home"] ytd-rich-item-renderer{width:100% !important;margin:0 !important;} ytd-browse[page-subtype="home"] ytd-rich-item-renderer.ytkit-video-hidden{display:none !important;width:0 !important;height:0 !important;margin:0 !important;padding:0 !important;overflow:hidden !important;} ytd-browse[page-subtype="home"] ytd-rich-item-renderer #details.ytd-rich-grid-media{min-height:68px !important;max-height:68px !important;overflow:hidden !important;} ytd-browse[page-subtype="home"] ytd-rich-item-renderer #video-title.ytd-rich-grid-media{display:-webkit-box !important;-webkit-line-clamp:2 !important;-webkit-box-orient:vertical !important;overflow:hidden !important;max-height:4.4rem !important;} ytd-browse[page-subtype="home"] ytd-rich-item-renderer #metadata-line.ytd-video-meta-block{white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;} ytd-browse[page-subtype="home"] ytd-rich-item-renderer ytd-thumbnail{aspect-ratio:16/9 !important;overflow:hidden !important;} ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer > ytd-rich-section-renderer,ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer > ytd-rich-shelf-renderer{grid-column:1 / -1 !important;}`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'styledFilterChips',
            name: 'Styled Filter Chips',
            description: 'Uniform, polished filter chips on the homepage with glassmorphism and smooth hover effects',
            group: 'Theme',
            icon: 'sliders-horizontal',
            pages: [PageTypes.HOME],
            _styleElement: null,
            init() {
                const css = `ytd-feed-filter-chip-bar-renderer #chips-wrapper{background:transparent !important;} ytd-feed-filter-chip-bar-renderer #scroll-container{padding:4px 0 !important;} ytd-feed-filter-chip-bar-renderer #left-arrow,ytd-feed-filter-chip-bar-renderer #right-arrow{background:linear-gradient(to right,var(--yt-spec-base-background,#0f0f0f) 70%,transparent) !important;} ytd-feed-filter-chip-bar-renderer #right-arrow{background:linear-gradient(to left,var(--yt-spec-base-background,#0f0f0f) 70%,transparent) !important;} yt-chip-cloud-chip-renderer .ytChipShapeChip{min-width:72px !important;height:32px !important;padding:0 14px !important;display:flex !important;align-items:center !important;justify-content:center !important;border:1px solid rgba(255,255,255,0.1) !important;border-radius:8px !important;transition:all 0.2s ease !important;backdrop-filter:blur(8px) !important;-webkit-backdrop-filter:blur(8px) !important;} yt-chip-cloud-chip-renderer .ytChipShapeInactive{background:rgba(255,255,255,0.06) !important;color:rgba(255,255,255,0.7) !important;} yt-chip-cloud-chip-renderer .ytChipShapeInactive:hover{background:rgba(255,255,255,0.12) !important;border-color:rgba(255,255,255,0.2) !important;color:#fff !important;transform:translateY(-1px) !important;box-shadow:0 2px 8px rgba(0,0,0,0.3) !important;} yt-chip-cloud-chip-renderer .ytChipShapeActive{background:rgba(255,255,255,0.95) !important;color:#0f0f0f !important;border-color:transparent !important;font-weight:600 !important;box-shadow:0 2px 6px rgba(0,0,0,0.25) !important;} yt-chip-cloud-chip-renderer .ytChipShapeTextContent{font-size:13px !important;line-height:1 !important;white-space:nowrap !important;letter-spacing:0.2px !important;} iron-selector#chips yt-chip-cloud-chip-renderer{margin:0 4px !important;} iron-selector#chips yt-chip-cloud-chip-renderer:first-child{margin-left:0 !important;}`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'hideSidebar',
            name: 'Hide Sidebar',
            description: 'Remove the left navigation sidebar completely',
            group: 'Home / Subscriptions',
            icon: 'sidebar',
            _styleElement: null,
            init() {
                const css = `
                    #guide, #guide-button, ytd-mini-guide-renderer, tp-yt-app-drawer { display: none !important; }
                    tp-yt-app-drawer[opened] + .opened, #scrim.opened { display: none !important; pointer-events: none !important; }
                    ytd-page-manager { margin-left: 0 !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },

        // ─── Appearance ───
        {
            id: 'uiStyleManager',
            name: 'UI Style',
            description: 'Choose rounded or square UI elements',
            group: 'Theme',
            icon: 'square',
            type: 'select',
            options: {
                'rounded': 'Rounded',
                'square': 'Square (Default)'
            },
            settingKey: 'uiStyle',
            _styleElement: null,

            init() {
                const style = appState.settings.uiStyle || 'rounded';
                if (style === 'square') {
                    const css = `
                        /* Nuclear squarify — broad selector with surgical exclusions */
                        *:not(.ytp-spinner-circle):not(.ytp-spinner-dot):not(.ytp-ce-covering-overlay):not(.ytp-scrubber-button):not(.html5-scrubber-button):not(svg):not(circle):not(path):not(use) {
                            border-radius: 0 !important;
                        }
                    `;
                    this._styleElement = injectStyle(css, this.id, true);
                }
            },

            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'colorThemeManager',
            name: 'Color Theme',
            description: 'Apply a color palette across YouTube (dark mode only)',
            group: 'Theme',
            icon: 'palette',
            type: 'select',
            options: {
                'none': 'None (Default)',
                'catppuccin-mocha': 'Catppuccin Mocha',
                'styled-dark': 'Styled Dark',
                'dracula': 'Dracula',
                'nord': 'Nord',
                'gruvbox': 'Gruvbox Dark',
                'tokyo-night': 'Tokyo Night',
                'nyan-cat': 'Nyan Cat'
            },
            settingKey: 'colorTheme',
            _styleElement: null,

            _hexToRgb(hex) {
                const h = hex.replace('#', '');
                return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)].join(',');
            },
            _lightenHex(hex, amount = 40) {
                const h = hex.replace('#', '');
                const r = Math.min(255, parseInt(h.substring(0,2),16) + amount);
                const g = Math.min(255, parseInt(h.substring(2,4),16) + amount);
                const b = Math.min(255, parseInt(h.substring(4,6),16) + amount);
                return '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
            },

            // Theme palettes: keys=[base,mantle,crust,surface0,surface1,surface2,text,subtext0,subtext1,overlay0,overlay1,overlay2,accent,red,green,blue,sapphire,peach,yellow,teal,lavender]
            _themeKeys: ['base','mantle','crust','surface0','surface1','surface2','text','subtext0','subtext1','overlay0','overlay1','overlay2','accent','red','green','blue','sapphire','peach','yellow','teal','lavender'],
            _themeData: {
                'catppuccin-mocha': '1e1e2e,181825,11111b,313244,45475a,585b70,cdd6f4,a6adc8,bac2de,6c7086,7f849c,9399b2,cba6f7,f38ba8,a6e3a1,89b4fa,74c7ec,fab387,f9e2af,94e2d5,b4befe',
                'styled-dark': '090909,0c0c0c,050505,121212,151515,202020,cccccc,aaaaaa,888888,353535,454545,555555,3ea6ff,ff0000,0c8a1d,1563d7,157ef5,ff6600,d6e22b,00bfa5,7f9cf3',
                'dracula': '282a36,21222c,191a21,343746,3e4154,4a4d62,f8f8f2,bfbfbf,a0a0a0,6272a4,7283b5,8294c6,bd93f9,ff5555,50fa7b,8be9fd,6272a4,ffb86c,f1fa8c,8be9fd,bd93f9',
                'nord': '2e3440,272c36,242933,3b4252,434c5e,4c566a,eceff4,d8dee9,c0c8d8,616e88,6e7d99,7b8ca6,88c0d0,bf616a,a3be8c,81a1c1,5e81ac,d08770,ebcb8b,8fbcbb,b48ead',
                'gruvbox': '282828,1d2021,141617,3c3836,504945,665c54,ebdbb2,d5c4a1,bdae93,7c6f64,8c7e73,a89984,fe8019,fb4934,b8bb26,83a598,458588,d65d0e,fabd2f,8ec07c,d3869b',
                'tokyo-night': '1a1b26,16161e,12121a,24283b,2f3447,3b4261,c0caf5,a9b1d6,9aa5ce,565f89,626a94,6e76a0,7aa2f7,f7768e,9ece6a,7dcfff,2ac3de,ff9e64,e0af68,73daca,bb9af7',
            },
            _getTheme(name) {
                const data = this._themeData[name];
                if (!data) return null;
                const vals = data.split(',');
                const t = {};
                this._themeKeys.forEach((k, i) => t[k] = '#' + vals[i]);
                return t;
            },

            // Raw CSS themes (decorative/cosmetic themes that bypass the variable system)
            _rawThemes: {
                'nyan-cat': `
/* ── Nyan Cat Theme ── */
:root, html[dark] { --ytkit-accent: #bd93f9; --ytkit-accent-rgb: 189,147,249; --ytkit-accent-light: #d4b5fb; }

/* Rainbow progress bar */
.html5-play-progress, .ytp-play-progress {
    background: linear-gradient(to bottom, #FF0000 0%, #FF0000 16.5%, #FF9900 16.5%, #FF9900 33%, #FFFF00 33%, #FFFF00 50%, #33FF00 50%, #33FF00 66%, #0099FF 66%, #0099FF 83.5%, #6633ff 83.5%, #6633ff 100%) !important;
}
.html5-load-progress, .ytp-load-progress {
    background: rgba(255,255,255,0.15) !important;
}

/* Nyan Cat scrubber */
.html5-scrubber-button, .ytp-scrubber-button {
    background: url("https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/refs/heads/main/assets/cat.gif") no-repeat center / contain !important;
    border: none !important;
}

/* Volume slider */
.ytp-volume-slider-track { background: #0C4177 !important; }

/* Cosmic comments box */
ytd-comments {
    display: block;
    background-color: rgba(var(--ytkit-accent-rgb), 0.06);
    background-image: linear-gradient(180deg, rgba(var(--ytkit-accent-rgb), 0.08) 0%, rgba(var(--ytkit-accent-rgb), 0.02) 100%);
}

/* Condensed comment spacing */
span.yt-core-attributed-string.yt-core-attributed-string--white-space-pre-wrap {
    margin-bottom: 0px; padding-bottom: 9px; padding-top: 0px; margin-top: 0px;
}
ytd-comment-view-model.style-scope.ytd-comment-thread-renderer {
    padding-top: 0px; margin-bottom: -7px;
}
yt-comment-filter-context-view-model.ytCommentFilterContextHost { display: none; }
yt-sub-thread.ytSubThreadHost.ytSubThreadHasButton.ytSubThreadTopLevelThread {
    padding-top: 0px; padding-bottom: 0px; margin-top: 0px; margin-bottom: -19px; border-style: none;
}

/* Condensed buttons */
div.yt-spec-button-shape-next__button-text-content {
    padding: 0; margin: 0;
}
.yt-spec-button-shape-next--enable-backdrop-filter-experiment.yt-spec-button-shape-next--icon-trailing.yt-spec-button-shape-next--size-m.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--text.yt-spec-button-shape-next {
    padding: 0; margin: 0;
}

/* Commentbox border cleanup */
.style-scope.ytd-commentbox {
    border: none; margin: 0; padding: 0;
}
div.unfocused-line.style-scope.tp-yt-paper-input-container { display: none; }
yt-formatted-string.style-scope.ytd-commentbox { padding: 0; margin: 0; }

/* Hide miniplayer */
ytd-miniplayer.ytdMiniplayerComponentHost.ytdMiniplayerComponentVisible { display: none; }

/* Quick links condensed styling */
#ytkit-po-drop {
    padding: 0 !important; margin: 0 !important;
    display: flex; flex-direction: column;
    min-width: fit-content;
    background: #0f0f0f;
    border: 1px solid rgba(255,255,255,0.1);
}
.ytkit-ql-item {
    display: flex; align-items: center;
    padding: 2px 4px !important; margin: 0 !important;
    min-height: 0 !important; line-height: 1 !important;
    text-decoration: none; color: #f1f1f1;
}
.ytkit-ql-icon { width: 16px !important; height: 16px !important; margin: 0 !important; flex-shrink: 0; }
.ytkit-ql-item span { font-size: 11px !important; margin-left: 4px !important; padding: 0 !important; }
.ytkit-ql-settings { justify-content: center; padding: 4px 0 !important; }
.ytkit-ql-settings span { display: none !important; }
#ytkit-po-drop div[style*="height: 1px"],
#ytkit-po-drop hr {
    height: 1px !important; border: 0 !important;
    background: rgba(255,255,255,0.1) !important;
    margin: 0 !important; padding: 0 !important;
    width: 100% !important; display: block !important;
}
.ytkit-ql-item:hover { background: rgba(255,255,255,0.1); }

/* Transparent player controls */
div.ytp-right-controls { background-color: transparent; }
button.ytp-button.ytkit-po-gear {
    background-color: transparent;
}
div.ytp-time-wrapper.ytp-time-wrapper-delhi { background-color: transparent; }
button.ytp-volume-icon.ytp-button { background-color: transparent; }
button.ytp-play-button.ytp-button { background-color: transparent; }
`
            },

            _buildCSS(t) {
                return `
html[dark], [dark], :root[dark], :root,
html[darker-dark-theme-deprecate], [darker-dark-theme-deprecate] {
    --ytkit-accent: ${t.accent} !important;
    --ytkit-accent-rgb: ${this._hexToRgb(t.accent)} !important;
    --ytkit-accent-light: ${this._lightenHex(t.accent)} !important;
    --yt-spec-base-background: ${t.base} !important;
    --yt-spec-raised-background: ${t.base} !important;
    --yt-spec-menu-background: ${t.mantle} !important;
    --yt-spec-inverted-background: ${t.text} !important;
    --yt-spec-additive-background: ${t.surface0} !important;
    --yt-spec-outline: ${t.surface0} !important;
    --yt-spec-text-primary: ${t.text} !important;
    --yt-spec-text-secondary: ${t.subtext0} !important;
    --yt-spec-text-disabled: ${t.subtext1} !important;
    --yt-spec-text-primary-inverse: ${t.crust} !important;
    --yt-spec-icon-inactive: ${t.text} !important;
    --yt-spec-icon-disabled: ${t.overlay1} !important;
    --yt-spec-call-to-action: ${t.accent} !important;
    --yt-spec-call-to-action-inverse: ${t.accent} !important;
    --yt-spec-brand-icon-active: ${t.accent} !important;
    --yt-spec-brand-button-background: ${t.accent} !important;
    --yt-spec-brand-link-text: ${t.sapphire} !important;
    --yt-spec-badge-chip-background: ${t.surface0} !important;
    --yt-spec-button-chip-background-hover: ${t.surface1} !important;
    --yt-spec-touch-response: ${t.surface0} !important;
    --yt-spec-general-background-a: ${t.base} !important;
    --yt-spec-general-background-b: ${t.base} !important;
    --yt-spec-general-background-c: ${t.crust} !important;
    --yt-spec-brand-background-solid: ${t.base} !important;
    --yt-spec-brand-background-primary: ${t.base} !important;
    --yt-spec-brand-background-secondary: ${t.mantle} !important;
    --yt-spec-snackbar-background: ${t.mantle} !important;
    --yt-spec-10-percent-layer: ${t.surface1} !important;
    --yt-spec-mono-tonal-hover: ${t.surface1} !important;
    --yt-spec-mono-filled-hover: ${t.surface1} !important;
    --yt-spec-static-brand-red: ${t.accent} !important;
    --yt-spec-static-overlay-background-solid: ${t.crust} !important;
    --yt-spec-static-overlay-background-heavy: ${t.crust} !important;
    --yt-spec-static-overlay-text-primary: ${t.text} !important;
    --yt-spec-error-indicator: ${t.red} !important;
    --yt-spec-themed-blue: ${t.accent} !important;
    --yt-spec-themed-green: ${t.green} !important;
    --yt-spec-verified-badge-background: ${t.overlay0} !important;
    --yt-spec-wordmark-text: ${t.text} !important;
    --yt-spec-filled-button-text: ${t.text} !important;
    --yt-spec-selected-nav-text: ${t.text} !important;
    --yt-spec-suggested-action: ${t.accent}33 !important;
    --yt-spec-brand-button-background-hover: ${t.accent} !important;
    --yt-spec-call-to-action-hover: ${t.accent} !important;
    --yt-spec-shadow: ${t.crust}bf !important;
    --yt-spec-white-1: ${t.text} !important;
    --yt-spec-grey-1: ${t.text} !important;
    --yt-spec-grey-2: ${t.subtext0} !important;
    --yt-lightsource-section1-color: ${t.base} !important;
    --yt-lightsource-section2-color: ${t.surface0} !important;
    --yt-lightsource-section3-color: ${t.surface1} !important;
    --yt-lightsource-section4-color: ${t.surface2} !important;
    --yt-lightsource-primary-title-color: ${t.text} !important;
    --yt-lightsource-secondary-title-color: ${t.subtext0} !important;
    --yt-brand-youtube-red: ${t.accent} !important;
    --yt-brand-medium-red: ${t.accent} !important;
    --yt-spec-red-indicator: ${t.accent} !important;
    --yt-spec-red-70: ${t.red} !important;
    --yt-spec-light-green: ${t.green} !important;
    --yt-spec-dark-green: ${t.green} !important;
    --yt-spec-light-blue: ${t.blue} !important;
    --yt-spec-dark-blue: ${t.sapphire} !important;
    --yt-spec-yellow: ${t.peach} !important;
    --yt-endpoint-color: ${t.accent} !important;
    --yt-endpoint-visited-color: ${t.accent} !important;
    --yt-endpoint-hover-color: ${t.accent} !important;
    --paper-dialog-background-color: ${t.mantle} !important;
    --iron-icon-fill-color: ${t.text} !important;
    --ytd-searchbox-background: ${t.base} !important;
    --ytd-searchbox-border-color: ${t.surface0} !important;
    --ytd-searchbox-legacy-border-color: ${t.surface0} !important;
    --ytd-searchbox-legacy-button-color: ${t.mantle} !important;
    --ytd-searchbox-legacy-button-border-color: ${t.surface0} !important;
    --ytd-searchbox-text-color: ${t.text} !important;
    --yt-live-chat-background-color: ${t.base} !important;
    --yt-live-chat-secondary-background-color: ${t.surface1} !important;
    --yt-live-chat-secondary-text-color: ${t.subtext0} !important;
    --yt-live-chat-vem-background-color: ${t.mantle} !important;
    --yt-spec-frosted-glass-desktop: ${t.base} !important;
    --yt-frosted-glass-desktop: ${t.base} !important;
    --yt-spec-static-ad-yellow: ${t.peach} !important;
    --yt-spec-static-grey: ${t.subtext0} !important;
    --paper-tooltip-background: ${t.overlay0} !important;
    --paper-tooltip-text-color: ${t.text} !important;
}
/* Progress bar keeps red for visibility */
html[dark] .ytp-play-progress.ytp-swatch-background-color,
html[dark] .ytp-swatch-background-color { background: ${t.accent} !important; }
/* Frosted glass header */
html[dark] #background.ytd-masthead,
html[dark] #frosted-glass { background: ${t.base} !important; }
/* Active chips */
html[dark] .ytChipShapeActive,
html[dark] yt-chip-cloud-chip-renderer[selected] { background: ${t.accent} !important; color: ${t.crust} !important; }
html[dark] .ytChipShapeInactive { background: ${t.surface0} !important; color: ${t.text} !important; }
/* Buttons */
html[dark] .yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal { background-color: ${t.surface0} !important; color: ${t.text} !important; }
html[dark] .yt-spec-button-shape-next--mono.yt-spec-button-shape-next--filled { background-color: ${t.accent} !important; color: ${t.crust} !important; }
html[dark] .yt-spec-button-shape-next--mono.yt-spec-button-shape-next--outline { border-color: ${t.surface2} !important; color: ${t.text} !important; }
/* Sidebar */
html[dark] #guide-inner-content { background: ${t.mantle} !important; }
html[dark] ytd-mini-guide-renderer { background: ${t.mantle} !important; }
/* Thumbnails */
html[dark] .badge-shape-wiz--thumbnail-default { color: ${t.text} !important; background: ${t.crust}cc !important; }
/* Expandable metadata chapters */
html[dark] ytd-expandable-metadata-renderer {
    --yt-lightsource-section1-color: ${t.base} !important;
    --yt-lightsource-section2-color: ${t.surface0} !important;
}
/* Channel page tabs */
html[dark] .yt-tab-shape-wiz__tab { color: ${t.subtext1} !important; }
html[dark] .yt-tab-shape-wiz__tab--tab-selected { color: ${t.text} !important; }
html[dark] .yt-tab-group-shape-wiz__slider { background-color: ${t.text} !important; }
/* Category pills / chips */
html[dark] yt-chip-cloud-chip-renderer[selected] #chip-container { background: initial !important; }
/* Video player live badge */
html[dark] .ytp-live-badge[disabled]::before { background: ${t.accent} !important; }
/* Subscribe button */
html[dark] .ytp-sb-subscribe,
html[dark] ytd-subscribe-button-renderer:not([subscribed]) button,
html[dark] yt-subscribe-button-view-model:not([subscribed]) button { background: ${t.accent}4d !important; color: ${t.text} !important; }
html[dark] ytd-subscribe-button-renderer[subscribed] button { background: ${t.surface1} !important; color: ${t.text} !important; }
/* Comment author badge */
html[dark] ytd-author-comment-badge-renderer:not([style*="transparent"]) {
    --ytd-author-comment-badge-background-color: ${t.surface0} !important;
    --ytd-author-comment-badge-icon-color: ${t.text} !important;
}
/* Playlist panel */
html[dark] ytd-playlist-panel-renderer[collapsible][collapsed][use-color-palette] .header.ytd-playlist-panel-renderer { background-color: ${t.base} !important; }
html[dark] ytd-playlist-panel-video-renderer {
    --yt-lightsource-section2-color: ${t.surface1} !important;
    --yt-active-playlist-panel-background-color: ${t.surface0} !important;
}
/* Popup dialogs */
html[dark] .yt-spec-dialog-layout { background-color: ${t.mantle} !important; }
/* Video player tooltips & panels */
html[dark] .ytp-popup { background: ${t.surface0}e6 !important; }
html[dark] .ytp-panel-menu, html[dark] .ytp-menuitem-label,
html[dark] .ytp-menuitem-content, html[dark] .ytp-panel-header { color: ${t.text} !important; }
html[dark] .ytp-panel-header { border-bottom-color: ${t.surface2} !important; }
/* Searchbox focus */
html[dark] ytd-searchbox[has-focus] #container.ytd-searchbox { border-color: ${t.accent} !important; }
html[dark] .ytSearchboxComponentInputBoxHasFocusDark { border-color: ${t.accent} !important; }
html[dark] .ytSearchboxComponentSuggestionsContainerDark { background: ${t.base} !important; border-color: ${t.base} !important; }
html[dark] .ytSearchboxComponentSearchButtonDark { background: ${t.surface0} !important; border-color: ${t.surface0} !important; }
/* Vertical ellipsis menu */
html[dark] .ytListViewModelHost { background-color: ${t.mantle} !important; color: ${t.text} !important; }
/* Red fill icons -> accent */
html[dark] [fill="red"], html[dark] [fill="#FF0000"], html[dark] [fill="#F00"] { fill: ${t.accent} !important; }
`;
            },

            init() {
                const theme = appState.settings.colorTheme || 'none';
                if (theme === 'none') return;
                // Raw CSS themes (decorative/cosmetic)
                if (this._rawThemes[theme]) {
                    this._styleElement = injectStyle(this._rawThemes[theme], this.id, true);
                    return;
                }
                // Variable-based color themes
                const t = this._getTheme(theme);
                if (!t) return;
                const css = this._buildCSS(t);
                this._styleElement = injectStyle(css, this.id, true);
            },

            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        cssFeature('noAmbientMode', 'Disable Ambient Mode', 'Turn off the glowing background effect that matches video colors', 'Theme', 'sun-dim',
            `#cinematics, #cinematics-container,
                    .ytp-autonav-endscreen-upnext-cinematics,
                    #player-container.ytd-watch-flexy::before { display: none !important; }`),
        cssFeature('compactLayout', 'Compact Layout', 'Reduce spacing and padding for a denser interface', 'Theme', 'minimize',
            `ytd-rich-grid-renderer { --ytd-rich-grid-row-padding: 0 !important; }
                    ytd-rich-item-renderer { margin-bottom: 8px !important; }
                    #contents.ytd-rich-grid-renderer { padding-top: 8px !important; }
                    ytd-two-column-browse-results-renderer { padding: 8px !important; }
                    ytd-watch-flexy[flexy] #primary.ytd-watch-flexy { padding-top: 12px !important; }`),
        cssFeature('thinScrollbar', 'Thin Scrollbar', 'Use a slim, unobtrusive scrollbar', 'Theme', 'grip-vertical',
            `*::-webkit-scrollbar { width: 5px !important; height: 5px !important; }
                    *::-webkit-scrollbar-track { background: transparent !important; }
                    *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2) !important; border-radius: 10px !important; }
                    *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.35) !important; }
                    * { scrollbar-width: thin !important; scrollbar-color: rgba(255,255,255,0.2) transparent !important; }`),
        {
            id: 'watchPageRestyle',
            name: 'Watch Page Restyle',
            description: 'Polished layout for video title, description, and metadata with glassmorphism accents',
            group: 'Theme',
            icon: 'layout',
            _styleElement: null,
            init() {
                // CSS selectors are scoped to ytd-watch-metadata — safe to inject globally
                // (removing path guard so styles persist across SPA navigations)
                const css = `ytd-watch-metadata[style*="--yt-saturated"]{--yt-saturated-base-background:transparent !important;--yt-saturated-raised-background:transparent !important;--yt-saturated-additive-background:transparent !important;--yt-saturated-text-primary:rgba(255,255,255,0.95) !important;--yt-saturated-text-secondary:rgba(255,255,255,0.6) !important;--yt-saturated-overlay-background:transparent !important}ytd-watch-metadata h1.ytd-watch-metadata yt-formatted-string{font-size:1.55rem !important;line-height:2rem !important;font-weight:700 !important;letter-spacing:-0.025em !important;color:rgba(255,255,255,0.97) !important;text-shadow:0 1px 2px rgba(0,0,0,0.2) !important}ytd-watch-metadata #title.ytd-watch-metadata{margin-bottom:2px !important}ytd-watch-metadata #top-row{display:flex !important;flex-wrap:nowrap !important;align-items:center !important;gap:0 !important;margin-bottom:6px !important;padding:10px 0 8px !important}ytd-watch-metadata[actions-on-separate-line] #top-row{flex-wrap:wrap !important}#owner.ytd-watch-metadata{display:flex !important;align-items:center !important;gap:8px !important;margin-bottom:0 !important;padding:0 !important;flex-shrink:0 !important;margin-right:auto !important}#owner.ytd-watch-metadata>#ytkit-watch-btn,#owner.ytd-watch-metadata>#ytkit-page-btn-watch{order:99 !important}#owner.ytd-watch-metadata ytd-video-owner-renderer #avatar{width:32px !important;height:32px !important;margin-right:0 !important}#owner.ytd-watch-metadata ytd-video-owner-renderer #avatar img{width:32px !important;height:32px !important;border-radius:50% !important;border:1.5px solid rgba(var(--ytkit-accent-rgb),0.2) !important}#owner.ytd-watch-metadata ytd-video-owner-renderer{display:flex !important;align-items:center !important;gap:8px !important;min-width:0 !important}ytd-video-owner-renderer #upload-info{gap:0 !important}ytd-video-owner-renderer #channel-name{font-size:13px !important;font-weight:600 !important}ytd-video-owner-renderer #owner-sub-count{font-size:11px !important;opacity:0.4 !important;line-height:1.2 !important}ytd-watch-metadata #subscribe-button{margin:0 !important}ytd-watch-metadata #subscribe-button .yt-spec-button-shape-next,#notification-preference-button .yt-spec-button-shape-next{height:28px !important;font-size:11px !important;padding:0 12px !important;border-radius:14px !important;min-height:unset !important}#notification-preference-button .yt-spec-button-shape-next{padding:0 6px !important}yt-animated-action .ytAnimatedActionLottie,yt-animated-action .ytAnimatedActionContentWithBackground .ytAnimatedActionLottie{display:none !important}ytd-watch-metadata #actions.ytd-watch-metadata,#actions.item.style-scope.ytd-watch-metadata{flex:0 0 auto !important;min-width:0 !important;margin-left:auto !important}ytd-watch-metadata #actions-inner{display:flex !important;flex-wrap:wrap !important;gap:5px !important;align-items:center !important;justify-content:flex-end !important}#menu.ytd-watch-metadata{margin:0 !important}#top-level-buttons-computed.style-scope.ytd-menu-renderer{display:flex !important;flex-wrap:wrap !important;gap:5px !important;align-items:center !important}ytd-watch-metadata #actions ytd-menu-renderer>yt-icon-button,ytd-watch-metadata #actions ytd-menu-renderer>yt-button-shape:last-child{display:none !important}ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next{height:30px !important;min-height:unset !important;min-width:unset !important;padding:0 12px !important;font-size:12px !important;border-radius:6px !important;background:rgba(255,255,255,0.05) !important;border:1px solid rgba(255,255,255,0.07) !important;color:rgba(255,255,255,0.7) !important;font-weight:500 !important;transition:all 0.2s ease !important}ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next:hover{background:rgba(var(--ytkit-accent-rgb),0.1) !important;border-color:rgba(var(--ytkit-accent-rgb),0.2) !important;color:rgba(255,255,255,0.95) !important}segmented-like-dislike-button-view-model .ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper{gap:5px !important}ytd-watch-metadata .yt-spec-button-shape-next--segmented-start,ytd-watch-metadata .yt-spec-button-shape-next--segmented-end{border-radius:6px !important}ytd-watch-metadata #top-level-buttons-computed .yt-spec-button-shape-next__icon{margin-right:3px !important}ytd-watch-metadata #top-level-buttons-computed yt-icon,ytd-watch-metadata #top-level-buttons-computed .ytIconWrapperHost{width:16px !important;height:16px !important}dislike-button-view-model .yt-spec-button-shape-next{padding:0 8px !important}button[id^="downloadBtn"]{height:30px !important;min-height:unset !important;padding:0 12px !important;font-size:12px !important;border-radius:6px !important;margin-left:0 !important;background:rgba(255,255,255,0.05) !important;border:1px solid rgba(255,255,255,0.07) !important;color:rgba(255,255,255,0.7) !important;font-weight:500 !important;transition:all 0.2s ease !important}button[id^="downloadBtn"]:hover{background:rgba(var(--ytkit-accent-rgb),0.1) !important;border-color:rgba(var(--ytkit-accent-rgb),0.2) !important;color:rgba(255,255,255,0.95) !important}.ytkit-vlc-btn,.ytkit-local-dl-btn,.ytkit-mp3-dl-btn{height:30px !important;min-height:unset !important;padding:0 10px !important;font-size:12px !important;border-radius:6px !important;margin-left:0 !important;background:rgba(255,255,255,0.05) !important;border:1px solid rgba(255,255,255,0.07) !important;color:rgba(255,255,255,0.7) !important;font-weight:500 !important;font-family:"Roboto","Arial",sans-serif !important;gap:4px !important;transition:all 0.2s ease !important}.ytkit-vlc-btn:hover,.ytkit-local-dl-btn:hover,.ytkit-mp3-dl-btn:hover{background:rgba(var(--ytkit-accent-rgb),0.1) !important;border-color:rgba(var(--ytkit-accent-rgb),0.2) !important;color:rgba(255,255,255,0.95) !important}.ytkit-vlc-btn svg,.ytkit-local-dl-btn svg,.ytkit-mp3-dl-btn svg{width:14px !important;height:14px !important}.ytkit-vlc-btn svg path,.ytkit-local-dl-btn svg path,.ytkit-mp3-dl-btn svg path{fill:currentColor !important}.ytkit-pc-wrap{margin-left:0 !important}.ytkit-pc-wrap .ytkit-pc-x{top:-4px !important;right:-4px !important;width:14px !important;height:14px !important;font-size:9px !important}ytd-watch-flexy .ytkit-trigger-btn{width:26px !important;height:26px !important;padding:4px !important;background:transparent !important;border:1px solid rgba(255,255,255,0.06) !important;border-radius:6px !important;opacity:0.35 !important;transition:opacity 0.15s,background 0.15s !important}ytd-watch-flexy .ytkit-trigger-btn:hover{opacity:0.9 !important;background:rgba(255,255,255,0.08) !important;border-color:rgba(255,255,255,0.12) !important}ytd-watch-metadata #description.ytd-watch-metadata,ytd-watch-metadata ytd-text-inline-expander{background:rgba(255,255,255,0.02) !important;border:1px solid rgba(255,255,255,0.04) !important;border-left:2px solid rgba(var(--ytkit-accent-rgb),0.25) !important;border-radius:6px !important;padding:10px 14px !important;margin-top:6px !important;transition:border-color 0.2s ease,background 0.2s ease !important}ytd-watch-metadata #description.ytd-watch-metadata:hover,ytd-watch-metadata ytd-text-inline-expander:hover{background:rgba(255,255,255,0.035) !important;border-color:rgba(255,255,255,0.06) !important;border-left-color:rgba(var(--ytkit-accent-rgb),0.4) !important}ytd-watch-metadata #description-inner{margin:0 !important}ytd-watch-metadata #description tp-yt-paper-button#expand,ytd-watch-metadata #description tp-yt-paper-button#collapse,ytd-text-inline-expander #expand,ytd-text-inline-expander #collapse{font-size:12px !important;color:rgba(var(--ytkit-accent-rgb),0.5) !important;text-transform:none !important;margin-top:6px !important;padding:2px 0 !important}ytd-watch-metadata #description-inline-expander #snippet{font-size:13px !important;line-height:1.6 !important;color:rgba(255,255,255,0.55) !important}ytd-watch-metadata #info-container{font-size:12px !important;color:rgba(255,255,255,0.35) !important}ytd-watch-metadata #info span,ytd-watch-metadata #info-text{font-size:12px !important}#bottom-row.ytd-watch-metadata{margin-top:0 !important;margin-right:0 !important;gap:4px !important;padding:4px 0 !important}ytd-engagement-panel-title-header-renderer{padding:8px 16px !important}#below.ytd-watch-flexy{padding-bottom:12px !important}ytd-watch-metadata{min-height:unset !important}ytd-video-description-infocards-section-renderer{padding:8px 0 !important;margin-top:8px !important}ytd-video-description-music-section-renderer,ytd-video-description-transcript-section-renderer{padding:6px 0 !important}ytd-comments-header-renderer{min-height:0 !important;padding:12px 0 8px !important;margin:8px 0 4px 0 !important;border-top:1px solid rgba(255,255,255,0.05) !important}ytd-comments-header-renderer #count{font-size:13px !important;font-weight:600 !important;color:rgba(255,255,255,0.5) !important;letter-spacing:-0.01em !important}ytd-comments-header-renderer #sort-menu{opacity:0.5 !important;transition:opacity 0.2s !important}ytd-comments-header-renderer #sort-menu:hover{opacity:1 !important}ytd-comments-header-renderer #comments-panel-button,ytd-comments-header-renderer #leading-section,ytd-comments-header-renderer #title{display:none !important}ytd-comments-header-renderer #additional-section{display:none !important}ytd-comments-header-renderer ytd-comment-simplebox-renderer{margin:0 0 8px 0 !important;padding:0 !important}ytd-comments-header-renderer ytd-comment-simplebox-renderer #placeholder-area{background:rgba(255,255,255,0.03) !important;border:1px solid rgba(255,255,255,0.06) !important;border-radius:8px !important;padding:10px 14px !important;font-size:13px !important;color:rgba(255,255,255,0.3) !important;transition:border-color 0.2s !important}ytd-comments-header-renderer ytd-comment-simplebox-renderer #placeholder-area:hover{border-color:rgba(var(--ytkit-accent-rgb),0.25) !important}ytd-comments-header-renderer ytd-comment-simplebox-renderer #avatar{width:28px !important;height:28px !important}ytd-comments-header-renderer ytd-comment-simplebox-renderer #avatar img{width:28px !important;height:28px !important;border-radius:50% !important}h1.style-scope.ytd-watch-metadata{margin-top:20px !important;font-weight:900 !important;font-style:normal !important;text-align:center !important;text-transform:capitalize !important;max-width:100% !important;overflow:hidden !important;text-overflow:ellipsis !important}yt-formatted-string.style-scope.ytd-watch-metadata{margin-bottom:0 !important;word-break:break-word !important;overflow-wrap:break-word !important}#primary.ytd-watch-flexy{max-width:100% !important}ytd-watch-metadata{max-width:100% !important;overflow:hidden !important}#title.ytd-watch-metadata{max-width:100% !important;overflow:hidden !important}div.yt-spec-touch-feedback-shape__fill{display:none !important}div.yt-spec-touch-feedback-shape__stroke{display:none !important}yt-touch-feedback-shape.yt-spec-touch-feedback-shape.yt-spec-touch-feedback-shape--touch-response{display:none !important}ytd-watch-metadata tp-yt-paper-button.dropdown-trigger.style-scope.yt-dropdown-menu{display:none !important}yt-formatted-string.count-text.style-scope.ytd-comments-header-renderer{display:none !important}yt-formatted-string.style-scope.ytd-video-owner-renderer{display:none !important}ytd-watch-flexy button.ytkit-trigger-btn{display:none !important}ytd-watch-flexy yt-icon.style-scope.ytd-logo{display:none !important}div.item.style-scope.ytd-watch-metadata{display:none !important}ytd-watch-metadata #info-container span.style-scope.yt-formatted-string{display:none !important}#actions.ytd-watch-metadata button.yt-spec-button-shape-next.yt-spec-button-shape-next--tonal.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--size-m.yt-spec-button-shape-next--icon-leading.yt-spec-button-shape-next--segmented-start.yt-spec-button-shape-next--enable-backdrop-filter-experiment{text-align:right !important}ytd-comment-view-model span.style-scope.yt-formatted-string,ytd-comment-renderer span.style-scope.yt-formatted-string,ytd-comment-thread-renderer span.style-scope.yt-formatted-string,ytd-comments-header-renderer span.style-scope.yt-formatted-string,ytd-comment-simplebox-renderer span.style-scope.yt-formatted-string{display:inline !important}ytd-comment-view-model yt-formatted-string,ytd-comment-renderer yt-formatted-string{display:inline !important}ytd-comments#comments{display:block !important;visibility:visible !important}ytd-comments#comments ytd-item-section-renderer{display:block !important}div.thread-hitbox.style-scope.ytd-comment-thread-renderer{display:none !important}`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'chatStyleComments',
            name: 'Refined Comments',
            description: 'Polished card-based comment layout with avatars and clean thread lines',
            group: 'Theme',
            icon: 'message-square',
            _styleElement: null,
            _observer: null,
            init() {
                // CSS selectors are scoped to comment elements — safe to inject globally
                // (removing path guard so styles persist across SPA navigations)
                const css = `ytd-comments#comments{background:rgba(var(--ytkit-accent-rgb),0.03) !important;background-image:linear-gradient(180deg,rgba(var(--ytkit-accent-rgb),0.05) 0%,rgba(var(--ytkit-accent-rgb),0.01) 100%) !important;border-radius:12px !important;padding:4px 8px !important}ytd-comment-thread-renderer{margin:0 !important;padding:0 !important;border:none !important;background:none !important}ytd-comment-thread-renderer[is-pinned]{background:none !important;border-radius:0 !important;padding:0 !important;margin:0 !important}#contents.ytd-item-section-renderer{margin:0 !important;padding:0 !important}ytd-comment-view-model,ytd-comment-renderer{position:relative !important;padding:8px 4px 6px !important;margin:0 !important;display:block !important;border-bottom:1px solid rgba(255,255,255,0.035) !important;transition:background 0.15s ease !important}ytd-comment-view-model:last-child,ytd-comment-renderer:last-child{border-bottom:none !important}ytd-comment-view-model:hover,ytd-comment-renderer:hover{background:rgba(var(--ytkit-accent-rgb),0.03) !important}ytd-comment-view-model>#body,ytd-comment-renderer>#body{display:flex !important;flex-direction:row !important;gap:10px !important;align-items:flex-start !important}ytd-comment-view-model #author-thumbnail,ytd-comment-renderer #author-thumbnail{display:block !important;flex-shrink:0 !important;width:28px !important;height:28px !important;margin-top:2px !important}ytd-comment-view-model #author-thumbnail img,ytd-comment-renderer #author-thumbnail img,ytd-comment-view-model #author-thumbnail yt-img-shadow,ytd-comment-renderer #author-thumbnail yt-img-shadow{width:28px !important;height:28px !important;border-radius:50% !important}ytd-comment-view-model>#body>#main,ytd-comment-renderer>#body>#main{flex:1 !important;min-width:0 !important;display:block !important}ytd-comment-view-model>#body>#main>#header,ytd-comment-renderer>#body>#main>#header{display:block !important;margin-bottom:3px !important}ytd-comment-view-model>#body>#main>#header>#header-author,ytd-comment-renderer>#body>#main>#header>#header-author{display:flex !important;flex-wrap:wrap !important;align-items:baseline !important;gap:0 6px !important}ytd-comment-view-model>#body>#main>#header>#header-author>h3,ytd-comment-renderer>#body>#main>#header>#header-author>h3{display:contents !important}ytd-comment-view-model #author-text,ytd-comment-renderer #author-text{display:inline !important;font-size:12.5px !important;font-weight:600 !important;color:var(--ytkit-accent) !important;line-height:1.4 !important;text-decoration:none !important;transition:color 0.15s !important}ytd-comment-view-model #author-text:hover,ytd-comment-renderer #author-text:hover{color:var(--ytkit-accent-light) !important}ytd-comment-view-model #author-text span,ytd-comment-renderer #author-text span{font-size:12.5px !important}ytd-comment-view-model ytd-author-comment-badge-renderer,ytd-comment-renderer ytd-author-comment-badge-renderer{display:inline-flex !important;vertical-align:baseline !important;margin-left:2px !important}.ytkit-vote-badge{display:inline-flex !important;align-items:center !important;font-size:10.5px !important;color:rgba(255,255,255,0.3) !important;cursor:pointer !important;vertical-align:baseline !important;gap:2px !important;padding:1px 4px !important;border-radius:3px !important;transition:all 0.15s ease !important}.ytkit-vote-badge:hover{color:rgba(var(--ytkit-accent-rgb),0.9) !important;background:rgba(var(--ytkit-accent-rgb),0.08) !important}.ytkit-vote-badge svg{width:11px !important;height:11px !important;fill:currentColor !important;vertical-align:-1px !important}.ytkit-vote-badge.ytkit-liked{color:rgba(var(--ytkit-accent-rgb),0.9) !important}ytd-comment-view-model #published-time-text,ytd-comment-renderer #published-time-text,ytd-comment-view-model .published-time-text,ytd-comment-renderer .published-time-text{display:inline !important;font-size:11px !important;color:rgba(255,255,255,0.25) !important;line-height:1.4 !important}ytd-comment-view-model #published-time-text a,ytd-comment-renderer #published-time-text a,ytd-comment-view-model .published-time-text a,ytd-comment-renderer .published-time-text a{color:rgba(255,255,255,0.25) !important;text-decoration:none !important}ytd-comment-view-model #pinned-comment-badge,ytd-comment-renderer #pinned-comment-badge,ytd-comment-view-model #linked-comment-badge,ytd-comment-view-model #paid-comment-background,ytd-comment-view-model #creator-heart-button,ytd-comment-renderer #creator-heart-button,ytd-comment-view-model #inline-action-menu,ytd-comment-renderer #inline-action-menu,ytd-comment-view-model #action-menu,ytd-comment-renderer #action-menu,ytd-comment-view-model #more,ytd-comment-view-model [slot="more"],ytd-comment-view-model #less,ytd-comment-view-model [slot="less"],ytd-comment-renderer tp-yt-paper-button.ytd-expander,ytd-comment-view-model #sponsor-comment-badge,ytd-comment-renderer #sponsor-comment-badge,ytd-comment-engagement-bar #dislike-button{display:none !important}ytd-comment-view-model #content-text,ytd-comment-renderer #content-text{display:block !important;font-size:13px !important;line-height:1.55 !important;color:rgba(255,255,255,0.78) !important;margin:0 !important;padding:0 !important;word-break:break-word !important}ytd-comment-view-model #content-text *,ytd-comment-renderer #content-text *{font-size:13px !important;line-height:1.55 !important}ytd-comment-view-model #content-text a,ytd-comment-renderer #content-text a{color:rgba(var(--ytkit-accent-rgb),0.75) !important;text-decoration:none !important}ytd-comment-view-model #content-text a:hover,ytd-comment-renderer #content-text a:hover{color:var(--ytkit-accent-light) !important;text-decoration:underline !important}ytd-comment-view-model #error-text{display:none !important}ytd-comment-view-model ytd-comment-engagement-bar,ytd-comment-renderer ytd-comment-engagement-bar{position:absolute !important;top:6px !important;right:4px !important;margin:0 !important;padding:0 !important;z-index:2 !important;pointer-events:none !important}ytd-comment-view-model:hover ytd-comment-engagement-bar,ytd-comment-renderer:hover ytd-comment-engagement-bar{pointer-events:auto !important}ytd-comment-engagement-bar #toolbar{display:none !important;position:static !important;align-items:center !important;gap:4px !important;margin:0 !important}ytd-comment-view-model:hover>* ytd-comment-engagement-bar #toolbar,ytd-comment-view-model:hover ytd-comment-engagement-bar #toolbar,ytd-comment-renderer:hover ytd-comment-engagement-bar #toolbar{display:inline-flex !important}ytd-comment-engagement-bar #like-button,ytd-comment-engagement-bar #dislike-button,ytd-comment-engagement-bar #vote-count-middle,ytd-comment-engagement-bar #vote-count-left,ytd-comment-engagement-bar #vote-count-right,ytd-comment-engagement-bar #creator-heart-button{display:none !important}ytd-comment-engagement-bar #reply-button-end .yt-spec-button-shape-next{height:24px !important;min-height:unset !important;padding:0 10px !important;font-size:11px !important;min-width:unset !important;color:rgba(var(--ytkit-accent-rgb),0.6) !important;background:rgba(var(--ytkit-accent-rgb),0.06) !important;border-radius:4px !important;transition:all 0.15s !important}ytd-comment-engagement-bar #reply-button-end .yt-spec-button-shape-next:hover{color:rgba(var(--ytkit-accent-rgb),0.9) !important;background:rgba(var(--ytkit-accent-rgb),0.12) !important}ytd-comment-engagement-bar #reply-button-end yt-icon{display:none !important}ytd-comment-engagement-bar #reply-dialog{padding:10px 0 4px !important;margin:0 !important;position:relative !important;width:100% !important;box-sizing:border-box !important;overflow:visible !important;border:none !important;outline:none !important;background:transparent !important}ytd-comment-engagement-bar #reply-dialog #unopened-dialog{display:none !important}ytd-comment-engagement-bar #reply-dialog:not(:has(ytd-commentbox:not([hidden]))){display:none !important}ytd-comment-engagement-bar #reply-dialog:empty{display:none !important;padding:0 !important}.ytkit-replying ytd-comment-engagement-bar{position:relative !important;top:auto !important;right:auto !important;pointer-events:auto !important;margin:4px 0 0 !important;width:100% !important;display:block !important}.ytkit-replying ytd-comment-engagement-bar #toolbar{display:none !important}.ytkit-replying:hover ytd-comment-engagement-bar #toolbar{display:none !important}ytd-comment-replies-renderer{margin:0 !important;padding:4px 0 4px 20px !important;border:none !important;display:block !important}.ytSubThreadThreadline,.ytSubThreadConnection,.ytSubThreadContinuation,.ytSubThreadShadow{display:none !important}yt-sub-thread{padding:0 !important;margin:0 !important}.ytSubThreadSubThreadContent{padding:0 !important}ytd-comment-replies-renderer #expanded-threads ytd-comment-view-model,ytd-comment-replies-renderer #expanded-threads ytd-comment-renderer,ytd-comment-replies-renderer #expander-contents ytd-comment-view-model,ytd-comment-replies-renderer #expander-contents ytd-comment-renderer{padding:8px 4px 8px 12px !important;border-bottom:none !important;border-left:2px solid rgba(var(--ytkit-accent-rgb),0.12) !important;border-radius:0 !important;margin:0 !important}ytd-comment-replies-renderer #expanded-threads ytd-comment-view-model:hover,ytd-comment-replies-renderer #expanded-threads ytd-comment-renderer:hover,ytd-comment-replies-renderer #expander-contents ytd-comment-view-model:hover,ytd-comment-replies-renderer #expander-contents ytd-comment-renderer:hover{border-left-color:rgba(var(--ytkit-accent-rgb),0.3) !important;background:rgba(var(--ytkit-accent-rgb),0.025) !important}ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail,ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail{width:22px !important;height:22px !important}ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail img,ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail img,ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail yt-img-shadow,ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail yt-img-shadow{width:22px !important;height:22px !important}.show-replies-button,ytd-comment-replies-renderer #more-replies,ytd-comment-replies-renderer #more-replies-sub-thread{margin:2px 0 !important;padding:0 !important}ytd-comment-replies-renderer #more-replies .yt-spec-button-shape-next,ytd-comment-replies-renderer #more-replies-sub-thread .yt-spec-button-shape-next{font-size:11px !important;height:24px !important;padding:0 10px !important;color:rgba(var(--ytkit-accent-rgb),0.6) !important;min-height:unset !important;min-width:unset !important;background:rgba(var(--ytkit-accent-rgb),0.06) !important;border-radius:4px !important;transition:all 0.15s !important}ytd-comment-replies-renderer #more-replies .yt-spec-button-shape-next:hover,ytd-comment-replies-renderer #more-replies-sub-thread .yt-spec-button-shape-next:hover{background:rgba(var(--ytkit-accent-rgb),0.12) !important;color:rgba(var(--ytkit-accent-rgb),0.9) !important}ytd-comment-replies-renderer #more-replies .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #more-replies-sub-thread .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #more-replies svg,ytd-comment-replies-renderer #more-replies-sub-thread svg,ytd-comment-replies-renderer #more-replies yt-icon,ytd-comment-replies-renderer #more-replies-sub-thread yt-icon,ytd-comment-replies-renderer .show-replies-button yt-icon,ytd-comment-replies-renderer .show-replies-button svg{display:none !important}ytd-comment-replies-renderer #expanded-threads,ytd-comment-replies-renderer #expander-contents,#collapsed-threads.ytd-comment-replies-renderer{padding:0 !important;margin:0 !important}ytd-comment-replies-renderer #less-replies,ytd-comment-replies-renderer #less-replies-sub-thread{margin:2px 0 !important;padding:0 !important}ytd-comment-replies-renderer #less-replies .yt-spec-button-shape-next,ytd-comment-replies-renderer #less-replies-sub-thread .yt-spec-button-shape-next{font-size:11px !important;height:24px !important;padding:0 10px !important;color:rgba(var(--ytkit-accent-rgb),0.35) !important;min-height:unset !important;background:rgba(var(--ytkit-accent-rgb),0.04) !important;border-radius:4px !important}ytd-comment-replies-renderer #less-replies .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #less-replies-sub-thread .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #less-replies svg,ytd-comment-replies-renderer #less-replies-sub-thread svg,ytd-comment-replies-renderer #less-replies yt-icon,ytd-comment-replies-renderer #less-replies-sub-thread yt-icon{display:none !important}ytd-comments-header-renderer{margin:0 0 4px 0 !important;padding:0 !important}ytd-comments-entry-point-header-renderer,ytd-comments-entry-point-teaser-renderer{display:none !important}ytd-continuation-item-renderer{padding:4px 0 !important}ytd-commentbox #divider-line{display:none !important}ytd-commentbox #thumbnail-input-row{display:flex !important;align-items:flex-start !important;gap:10px !important;background:transparent !important;border:none !important;padding:0 !important;margin:0 !important;width:100% !important;box-sizing:border-box !important}ytd-commentbox #creation-box,ytd-commentbox #main{background:transparent !important;border:none !important;padding:0 !important;margin:0 !important;flex:1 !important;min-width:0 !important;width:100% !important;box-sizing:border-box !important}ytd-commentbox .underline,ytd-commentbox .unfocused-line,ytd-commentbox .focused-line{display:none !important}ytd-commentbox #contenteditable-textarea{display:block !important;font-size:13px !important;padding:10px 12px !important;background:rgba(255,255,255,0.04) !important;border:1px solid rgba(var(--ytkit-accent-rgb),0.15) !important;border-radius:8px !important;min-height:44px !important;color:rgba(255,255,255,0.85) !important;line-height:1.5 !important;outline:none !important;width:100% !important;box-sizing:border-box !important;transition:border-color 0.2s,background 0.2s,box-shadow 0.2s !important}ytd-commentbox #creation-box:not(.not-focused) #contenteditable-textarea,ytd-commentbox #contenteditable-textarea:focus-within{border-color:rgba(var(--ytkit-accent-rgb),0.4) !important;background:rgba(255,255,255,0.06) !important;box-shadow:0 0 0 2px rgba(var(--ytkit-accent-rgb),0.08) !important}ytd-commentbox #contenteditable-root{font-size:13px !important;color:rgba(255,255,255,0.85) !important;line-height:1.5 !important;outline:none !important;border:none !important;background:transparent !important;padding:0 !important}ytd-commentbox #input-container,ytd-commentbox tp-yt-paper-input-container{background:transparent !important;border:none !important;padding:0 !important;width:100% !important;box-sizing:border-box !important}ytd-commentbox .input-wrapper{width:100% !important;box-sizing:border-box !important}ytd-commentbox #labelAndInputContainer{width:100% !important;box-sizing:border-box !important}ytd-commentbox .paper-input-input{width:100% !important;box-sizing:border-box !important}ytd-commentbox .floated-label-placeholder{display:none !important}ytd-commentbox #footer{margin-top:8px !important;gap:6px !important;display:flex !important;align-items:center !important}ytd-commentbox #footer #buttons{display:flex !important;align-items:center !important;gap:6px !important}ytd-commentbox #footer #buttons .yt-spec-button-shape-next{height:30px !important;font-size:12px !important;padding:0 16px !important;min-height:unset !important;border-radius:6px !important;transition:all 0.15s !important}ytd-commentbox #submit-button .yt-spec-button-shape-next--filled:not([disabled]){background:var(--ytkit-accent) !important;color:#000 !important}ytd-commentbox #submit-button .yt-spec-button-shape-next--filled:not([disabled]):hover{filter:brightness(1.15) !important}ytd-commentbox #cancel-button .yt-spec-button-shape-next{color:rgba(255,255,255,0.5) !important}ytd-commentbox #cancel-button .yt-spec-button-shape-next:hover{color:rgba(255,255,255,0.75) !important}ytd-commentbox #emoji-button .yt-spec-button-shape-next{color:rgba(255,255,255,0.3) !important;transition:color 0.15s !important}ytd-commentbox #emoji-button .yt-spec-button-shape-next:hover{color:rgba(var(--ytkit-accent-rgb),0.7) !important}ytd-commentbox #author-thumbnail{flex-shrink:0 !important;width:28px !important;height:28px !important;margin:0 !important;padding:0 !important}ytd-commentbox #author-thumbnail img,ytd-commentbox #author-thumbnail yt-img-shadow{width:28px !important;height:28px !important;border-radius:50% !important}`;
                this._styleElement = injectStyle(css, this.id, true);

                const thumbSVG = '<svg viewBox="0 0 24 24"><path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7.87 10H4v10h2.5S11 21 13.21 21h3.04c1.37 0 2.57-.93 2.88-2.27l1.23-5.35c.4-1.73-.7-3.38-2.59-3.38z"/></svg>';

                const processComment = (comment) => {
                    if (comment.dataset.ytkitChat) return;
                    comment.dataset.ytkitChat = '1';

                    const authorText = comment.querySelector('#author-text');
                    if (!authorText) return;

                    const voteEl = comment.querySelector('#vote-count-middle');
                    const voteText = voteEl?.textContent?.trim() || '';

                    const badge = document.createElement('span');
                    badge.className = 'ytkit-vote-badge';
                    const html = thumbSVG + '<span>' + (voteText && voteText !== '0' ? voteText : '') + '</span>';
                    TrustedHTML.setHTML(badge, html);
                    badge.title = 'Like';
                    badge.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const likeBtn = comment.querySelector('#like-button button, #like-button yt-button-shape button');
                        if (likeBtn) {
                            likeBtn.click();
                            badge.classList.toggle('ytkit-liked');
                        }
                    });
                    authorText.after(badge);

                    // Check if already liked
                    const likeBtn = comment.querySelector('#like-button button[aria-pressed="true"]');
                    if (likeBtn) badge.classList.add('ytkit-liked');
                };

                const processAll = () => {
                    document.querySelectorAll('ytd-comment-view-model:not([data-ytkit-chat]), ytd-comment-renderer:not([data-ytkit-chat])').forEach(processComment);
                    // Toggle .ytkit-replying on comments with active (visible) reply dialogs
                    document.querySelectorAll('ytd-comment-view-model.ytkit-replying, ytd-comment-renderer.ytkit-replying').forEach(c => {
                        const replyBox = c.querySelector('#reply-dialog ytd-commentbox:not([hidden])');
                        const isOpen = replyBox && !replyBox.closest('[hidden]') && replyBox.offsetParent !== null;
                        if (!isOpen) c.classList.remove('ytkit-replying');
                    });
                    document.querySelectorAll('#reply-dialog ytd-commentbox:not([hidden])').forEach(d => {
                        if (d.closest('[hidden]') || d.offsetParent === null) return;
                        const comment = d.closest('ytd-comment-view-model, ytd-comment-renderer');
                        if (comment) comment.classList.add('ytkit-replying');
                    });

                    // Style reply dialog elements via inline styles with !important (bypasses Shady DOM)
                    document.querySelectorAll('ytd-comment-engagement-bar #reply-dialog').forEach(dialog => {
                        const cb = dialog.querySelector('ytd-commentbox:not([hidden])');
                        const isOpen = cb && !cb.closest('[hidden]') && cb.offsetParent !== null;

                        // If dialog is closed, strip all inline styles we added
                        if (!isOpen) {
                            if (dialog.dataset.ytkitStyled) {
                                delete dialog.dataset.ytkitStyled;
                                dialog.removeAttribute('style');
                                const allCb = dialog.querySelector('ytd-commentbox');
                                if (allCb) {
                                    allCb.removeAttribute('style');
                                    allCb.querySelectorAll('#thumbnail-input-row, #main, #divider-line, #creation-box, #input-container, tp-yt-paper-input-container, .input-wrapper, #labelAndInputContainer, .paper-input-input, ytd-emoji-input, yt-user-mention-autosuggest-input, #author-thumbnail, .underline, .unfocused-line, .focused-line, #contenteditable-textarea, #contenteditable-root, #footer, ytd-comment-reply-dialog-renderer').forEach(el => el.removeAttribute('style'));
                                    allCb.querySelectorAll('#footer .yt-spec-button-shape-next').forEach(el => el.removeAttribute('style'));
                                    const ta = allCb.querySelector('#contenteditable-textarea');
                                    if (ta) delete ta.dataset.ytkitFocus;
                                }
                                const rr = dialog.querySelector('ytd-comment-reply-dialog-renderer');
                                if (rr) rr.removeAttribute('style');
                            }
                            return;
                        }
                        dialog.dataset.ytkitStyled = '1';

                        const S = (el, props) => { if (!el) return; for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important'); };
                        const HIDE = { display: 'none', height: '0', border: 'none', 'border-bottom': 'none', overflow: 'hidden' };
                        const CLEAR = { display: 'block', width: '100%', border: 'none', 'border-bottom': 'none', outline: 'none', background: 'transparent', 'box-shadow': 'none', padding: '0', margin: '0', 'box-sizing': 'border-box' };

                        S(dialog, { display: 'block', padding: '10px 0 4px', margin: '0', position: 'relative', width: '100%', 'box-sizing': 'border-box', overflow: 'visible', border: 'none', outline: 'none', background: 'transparent' });
                        S(cb, { ...CLEAR, overflow: 'visible' });
                        S(cb.querySelector('#thumbnail-input-row'), CLEAR);
                        S(cb.querySelector('#main'), CLEAR);
                        S(cb.querySelector('#divider-line'), HIDE);
                        S(cb.querySelector('#creation-box'), CLEAR);
                        const inputContainer = cb.querySelector('#input-container') || cb.querySelector('tp-yt-paper-input-container');
                        S(inputContainer, CLEAR);
                        S(cb.querySelector('.input-wrapper'), CLEAR);
                        S(cb.querySelector('#labelAndInputContainer'), CLEAR);
                        cb.querySelectorAll('.paper-input-input').forEach(el => S(el, CLEAR));
                        S(cb.querySelector('ytd-emoji-input'), CLEAR);
                        S(cb.querySelector('yt-user-mention-autosuggest-input'), CLEAR);
                        S(cb.querySelector('#author-thumbnail'), { display: 'none' });
                        // Also clear the reply-dialog-renderer wrapper
                        const replyRenderer = dialog.querySelector('ytd-comment-reply-dialog-renderer');
                        S(replyRenderer, { ...CLEAR, overflow: 'visible' });

                        // Hide paper-input underlines
                        cb.querySelectorAll('.underline, .unfocused-line, .focused-line').forEach(el => S(el, HIDE));

                        // Style the contenteditable textarea (outer yt-formatted-string)
                        const textarea = cb.querySelector('#contenteditable-textarea');
                        S(textarea, { display: 'block', 'font-size': '13px', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(var(--ytkit-accent-rgb),0.2)', 'border-radius': '8px', 'min-height': '60px', height: 'auto', color: 'rgba(255,255,255,0.85)', 'line-height': '1.5', outline: 'none', width: '100%', 'box-sizing': 'border-box', transition: 'border-color 0.2s, background 0.2s' });

                        // Strip border from inner contenteditable-root
                        const root = cb.querySelector('#contenteditable-root');
                        S(root, { display: 'block', 'font-size': '13px', color: 'rgba(255,255,255,0.85)', 'line-height': '1.5', outline: 'none', border: 'none', background: 'transparent', padding: '0', 'min-height': 'unset', width: '100%' });

                        // Focus effects (guarded to prevent listener stacking)
                        if (textarea && !textarea.dataset.ytkitFocus) {
                            textarea.dataset.ytkitFocus = '1';
                            textarea.addEventListener('focusin', () => { textarea.style.setProperty('border-color', 'rgba(var(--ytkit-accent-rgb),0.45)', 'important'); textarea.style.setProperty('background', 'rgba(255,255,255,0.06)', 'important'); });
                            textarea.addEventListener('focusout', () => { textarea.style.setProperty('border-color', 'rgba(var(--ytkit-accent-rgb),0.2)', 'important'); textarea.style.setProperty('background', 'rgba(255,255,255,0.04)', 'important'); });
                        }

                        // Footer buttons
                        const footer = cb.querySelector('#footer');
                        S(footer, { 'margin-top': '8px', gap: '6px', display: 'flex', 'justify-content': 'flex-end' });
                        cb.querySelectorAll('#footer .yt-spec-button-shape-next').forEach(btn => S(btn, { height: '28px', 'font-size': '11px', padding: '0 14px', 'min-height': 'unset', 'border-radius': '6px' }));
                    });

                };

                processAll();
                let _processScheduled = false;
                this._mutationHandler = () => {
                    if (_processScheduled) return;
                    _processScheduled = true;
                    requestAnimationFrame(() => { _processScheduled = false; processAll(); });
                };
                addMutationRule(this.id, this._mutationHandler);
            },
            destroy() {
                this._styleElement?.remove(); this._styleElement = null;
                removeMutationRule(this.id);
                document.querySelectorAll('.ytkit-vote-badge').forEach(el => el.remove());
                document.querySelectorAll('[data-ytkit-chat]').forEach(el => delete el.dataset.ytkitChat);
                document.querySelectorAll('.ytkit-replying').forEach(el => el.classList.remove('ytkit-replying'));
            }
        },

        // ─── Content ───
        {
            id: 'removeAllShorts',
            name: 'Remove Shorts',
            description: 'Hide all Shorts videos from feeds and recommendations',
            group: 'Content',
            icon: 'video-off',
            _styleElement: null,
            _observer: null,
            init() {
                const isExemptPage = () => /^\/@[^/]+/.test(window.location.pathname) || window.location.pathname.startsWith('/results');

                const hideShort = (a) => {
                    let parent = a.parentElement;
                    while (parent && (!parent.tagName.startsWith('YTD-') || parent.tagName === 'YTD-THUMBNAIL')) {
                        parent = parent.parentElement;
                    }
                    if (parent instanceof HTMLElement && !parent.dataset.ytkitShortsHidden) {
                        parent.style.display = 'none';
                        parent.dataset.ytkitShortsHidden = '1';
                    }
                };

                const scanPage = () => {
                    if (isExemptPage()) {
                        // Restore any previously hidden shorts when navigating to exempt pages
                        document.querySelectorAll('[data-ytkit-shorts-hidden]').forEach(el => {
                            el.style.display = '';
                            delete el.dataset.ytkitShortsHidden;
                        });
                        return;
                    }
                    document.querySelectorAll('a[href^="/shorts"]').forEach(hideShort);
                };

                // Initial scan
                scanPage();

                // Use shared observer for new content (skip on watch pages — no shorts there)
                addMutationRule(this.id, () => {
                    if (window.location.pathname.startsWith('/watch')) return;
                    if (!isExemptPage()) {
                        document.querySelectorAll('a[href^="/shorts"]').forEach(hideShort);
                    }
                });

                // Re-scan on navigation
                addNavigateRule(this.id, scanPage);

                const css = `
                    body:not([data-ytkit-search-page]) ytd-reel-shelf-renderer,
                    body:not([data-ytkit-search-page]) ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id + '-style', true);

                // Toggle body attribute for CSS scoping
                this._searchPageRule = () => {
                    document.body.toggleAttribute('data-ytkit-search-page', window.location.pathname.startsWith('/results'));
                };
                addNavigateRule(this.id + '-search', this._searchPageRule);
                this._searchPageRule();
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule(this.id);
                removeNavigateRule(this.id + '-search');
                this._styleElement?.remove();
                document.body.removeAttribute('data-ytkit-search-page');
                document.querySelectorAll('[data-ytkit-shorts-hidden]').forEach(el => {
                    el.style.display = '';
                    delete el.dataset.ytkitShortsHidden;
                });
            }
        },
        {
            id: 'redirectShorts',
            name: 'Redirect Shorts',
            description: 'Open Shorts in the standard video player',
            group: 'Content',
            icon: 'external-link',
            init() {
                const redirectRule = () => {
                    if (window.location.pathname.startsWith('/shorts/')) {
                        window.location.replace(window.location.href.replace('/shorts/', '/watch?v='));
                    }
                };
                addNavigateRule(this.id, redirectRule);
            },
            destroy() { removeNavigateRule(this.id); }
        },
        cssFeature('disablePlayOnHover', 'Disable Hover Preview', 'Stop videos from playing when hovering over thumbnails', 'Home / Subscriptions', 'pause',
            `ytd-video-preview, #preview, #mouseover-overlay,
                    ytd-moving-thumbnail-renderer,
                    ytd-thumbnail-overlay-loading-preview-renderer {
                        display: none !important;
                    }`),
        cssFeature('fullWidthSubscriptions', 'Full-Width Subscriptions', 'Expand the subscription grid to fill the page', 'Home / Subscriptions', 'maximize',
            `ytd-browse[page-subtype="subscriptions"] #grid-container.ytd-two-column-browse-results-renderer {
                        max-width: 100% !important;
                    }`),
        cssFeature('hideSubscriptionOptions', 'Hide Layout Options', 'Remove the "Latest" header and view toggles on subscriptions', 'Home / Subscriptions', 'layout',
            'ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(.grid-subheader)'),
        {
            id: 'videosPerRow',
            name: 'Videos Per Row',
            description: 'Set how many video thumbnails per row (0 = dynamic based on window width)',
            group: 'Home / Subscriptions',
            icon: 'grid',
            type: 'select',
            options: { '0': 'Dynamic', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8' },
            _styleEl: null,
            init() {
                const apply = () => {
                    const n = parseInt(appState.settings.videosPerRow) || 0;
                    this._styleEl?.remove();
                    if (n > 0) {
                        this._styleEl = document.createElement('style');
                        this._styleEl.id = 'ytkit-videos-per-row';
                        this._styleEl.textContent = `ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer, ytd-browse[page-subtype="subscriptions"] #contents.ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: ${n} !important; }`;
                        document.head.appendChild(this._styleEl);
                    }
                };
                apply();
                this._settingsHandler = () => apply();
                document.addEventListener('ytkit-settings-changed', this._settingsHandler);
            },
            destroy() {
                this._styleEl?.remove(); this._styleEl = null;
                document.removeEventListener('ytkit-settings-changed', this._settingsHandler);
            }
        },
        cssFeature('hidePaidContentOverlay', 'Hide Promotion Badges', 'Remove "Includes paid promotion" overlays on thumbnails and watch pages', 'Watch Page', 'badge',
            `ytd-paid-content-overlay-renderer, ytm-paid-content-overlay-renderer,
                    .YtmPaidContentOverlayHost, .ytmPaidContentOverlayHost,
                    .ytp-paid-content-overlay, .ytp-paid-content-overlay-link`),
        cssFeature('hideInfoPanels', 'Hide Info Panels', 'Remove Wikipedia/context info boxes that appear below videos (FEMA, COVID, etc.)', 'Watch Page', 'info-off',
            `#clarify-box,#clarify-box.attached-message,ytd-info-panel-container-renderer,ytd-info-panel-content-renderer,ytd-watch-flexy #clarify-box,ytd-watch-flexy ytd-info-panel-container-renderer,ytd-clarification-renderer,.ytd-info-panel-container-renderer,.ytp-info-panel-preview{display:none !important;}`),
        {
            id: 'redirectToVideosTab',
            name: 'Channels → Videos Tab',
            description: 'Open channel pages directly on the Videos tab',
            group: 'Home / Subscriptions',
            icon: 'folder-video',
            _mousedownListener: null,
            init() {
                const RX_CHANNEL_HOME = /^(https?:\/\/www\.youtube\.com)((\/(user|channel|c)\/[^/]+)(\/?$|\/featured[^/])|(\/@(?!.*\/)[^/]+))/;
                const DEFAULT_TAB_HREF = "/videos";
                const handleDirectNavigation = () => {
                    if (RX_CHANNEL_HOME.test(location.href)) {
                        const newUrl = RegExp.$2 + DEFAULT_TAB_HREF;
                        if (location.href !== newUrl) location.href = newUrl;
                    }
                };
                handleDirectNavigation();
                addNavigateRule('channelRedirectorNav', handleDirectNavigation);
                this._mousedownListener = (event) => {
                    const anchorTag = event.target.closest('a');
                    if (anchorTag && RX_CHANNEL_HOME.test(anchorTag.href)) {
                        anchorTag.href = RegExp.$2 + DEFAULT_TAB_HREF;
                    }
                };
                document.addEventListener('mousedown', this._mousedownListener, { passive: true, capture: true });
            },
            destroy() {
                if (this._mousedownListener) document.removeEventListener('mousedown', this._mousedownListener, true);
                removeNavigateRule('channelRedirectorNav');
            }
        },
        cssFeature('hidePlayables', 'Hide Playables', 'Hide YouTube Playables gaming content from feeds', 'Home / Subscriptions', 'gamepad',
            `ytd-rich-section-renderer:has([is-playables]) { display: none !important; }`),
        cssFeature('hideMembersOnly', 'Hide Members Only', 'Hide members-only content from channels', 'Home / Subscriptions', 'lock',
            `ytd-badge-supported-renderer:has([aria-label*="Members only"]),
                    ytd-rich-item-renderer:has([aria-label*="Members only"]),
                    ytd-video-renderer:has([aria-label*="Members only"]) { display: none !important; }`),
        cssFeature('hideNewsHome', 'Hide News Section', 'Hide news sections from the homepage', 'Home / Subscriptions', 'newspaper',
            `ytd-rich-section-renderer:has([is-news]),
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[type="news"]) { display: none !important; }`),
        cssFeature('hidePlaylistsHome', 'Hide Playlist Shelves', 'Hide playlist sections from the homepage', 'Home / Subscriptions', 'list-x',
            `ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-playlist]),
                    ytd-rich-section-renderer:has([is-mixes]) { display: none !important; }`),
        {
            id: 'hiddenWatchElementsManager',
            name: 'Hide Watch Page Elements',
            description: 'Choose which elements to hide below videos',
            group: 'Watch Page',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _ruleId: 'watchElementsHider',
            // CSS selectors for elements that can be hidden with pure CSS
            _cssSelectors: {
                joinButton: 'ytd-video-owner-renderer #sponsor-button',
                askAISection: 'yt-video-description-youchat-section-view-model',
                podcastSection: 'ytd-video-description-course-section-renderer',
                transcriptSection: 'ytd-video-description-transcript-section-renderer',
                channelInfoCards: 'ytd-video-description-infocards-section-renderer'
            },
            // Button aria-labels for JS-based hiding (find parent yt-button-view-model)
            _buttonAriaLabels: {
                askButton: 'Ask',
                saveButton: 'Save to playlist',
                moreActions: 'More actions'
            },
            _hideButtons() {
                const hidden = appState.settings.hiddenWatchElements || [];
                const metadata = document.querySelector('ytd-watch-metadata');
                if (!metadata) return;

                // Hide buttons by finding them via aria-label
                Object.entries(this._buttonAriaLabels).forEach(([key, ariaLabel]) => {
                    if (hidden.includes(key)) {
                        try {
                            const btn = metadata.querySelector(`button[aria-label="${ariaLabel}"]`);
                            if (btn) {
                                const parent = btn.closest('yt-button-view-model') || btn.closest('yt-button-shape');
                                // Validate parent is a real DOM element (YouTube's Polymer can return Symbol/Proxy objects)
                                if (parent && parent instanceof HTMLElement && typeof parent.style === 'object' && !parent.hasAttribute('ytkit-hidden')) {
                                    parent.style.display = 'none';
                                    parent.setAttribute('ytkit-hidden', key);
                                }
                            }
                        } catch(e) { /* Polymer Symbol object - skip */ }
                    }
                });
            },
            init() {
                const hidden = appState.settings.hiddenWatchElements || [];
                if (hidden.length === 0) return;

                // Build CSS for elements that can use pure CSS hiding
                const cssSelectors = hidden
                    .filter(key => this._cssSelectors[key])
                    .map(key => this._cssSelectors[key])
                    .filter(Boolean);

                if (cssSelectors.length > 0) {
                    this._styleElement = injectStyle(cssSelectors.join(', '), this.id);
                }

                // Use mutation observer for button hiding (aria-label based)
                const hasButtonsToHide = hidden.some(key => this._buttonAriaLabels[key]);
                if (hasButtonsToHide) {
                    // Initial hide attempt
                    this._hideButtons();

                    // Add mutation rule to catch dynamically loaded content
                    addMutationRule(this._ruleId, () => {
                        if (!window.location.pathname.startsWith('/watch')) return;
                        this._hideButtons();
                    });
                }
            },
            destroy() {
                this._styleElement?.remove();
                this._styleElement = null;
                removeMutationRule(this._ruleId);

                // Restore hidden buttons
                document.querySelectorAll('[ytkit-hidden]').forEach(el => {
                    if (!(el instanceof HTMLElement)) return;
                    el.style.display = '';
                    el.removeAttribute('ytkit-hidden');
                });
            }
        },
                // Auto-generated Content sub-features
        ...([['joinButton','Join Button','Hide join/membership button'],['askButton','Ask Button','Hide Ask AI button'],['saveButton','Save Button','Hide save to playlist button'],['moreActions','More Actions (...)','Hide more actions menu button'],['askAISection','Ask AI Section','Hide AI section in description'],['podcastSection','Podcast/Course Section','Hide podcast/course section in description'],['transcriptSection','Transcript Section','Hide transcript section in description'],['channelInfoCards','Channel Info Cards','Hide channel info cards in description']].map(([v,n,d])=>({id:'wpHide_'+v,name:n,description:d,group:'Watch Page',icon:'eye-off',isSubFeature:true,parentId:'hiddenWatchElementsManager',_arrayKey:'hiddenWatchElements',_arrayValue:v,init(){},destroy(){}}))),
                                                                {
            id: 'cleanShareUrls',
            name: 'Clean Share URLs',
            description: 'Strip tracking params (si, pp, feature) from copied/shared YouTube links',
            group: 'Watch Page',
            icon: 'link',
            _observer: null,
            _clipboardHandler: null,
            init() {
                const STRIP_PARAMS = ['si', 'pp', 'feature', 'cbrd', 'ucbcb', 'app', 'sttick'];
                const cleanUrl = (url) => {
                    try {
                        const u = new URL(url);
                        if (!u.hostname.includes('youtube.com') && !u.hostname.includes('youtu.be')) return url;
                        STRIP_PARAMS.forEach(p => u.searchParams.delete(p));
                        // Convert to short URL if it's a watch page
                        if (u.pathname === '/watch' && u.searchParams.has('v')) {
                            const videoId = u.searchParams.get('v');
                            u.searchParams.delete('v');
                            const remaining = u.searchParams.toString();
                            return `https://youtu.be/${videoId}${remaining ? '?' + remaining : ''}`;
                        }
                        return u.toString();
                    } catch { return url; }
                };
                // Intercept clipboard writes
                this._clipboardHandler = (e) => {
                    const text = e.clipboardData?.getData('text/plain') || '';
                    if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
                        const cleaned = cleanUrl(text);
                        if (cleaned !== text) {
                            e.preventDefault();
                            e.clipboardData.setData('text/plain', cleaned);
                        }
                    }
                };
                document.addEventListener('copy', this._clipboardHandler, true);
                // Also intercept the share panel URL display via shared observer
                this._cleanShareUrl = () => {
                    const input = document.querySelector('input#share-url');
                    if (input && input.value && !input.dataset.ytkitCleaned) {
                        const cleaned = cleanUrl(input.value);
                        if (cleaned !== input.value) { input.value = cleaned; input.dataset.ytkitCleaned = '1'; }
                    }
                };
                addMutationRule(this.id, this._cleanShareUrl);
                // Also clean address bar on navigation
                this._cleanAddressBar = () => {
                    const url = window.location.href;
                    if (!url.includes('youtube.com') && !url.includes('youtu.be')) return;
                    const cleaned = cleanUrl(url);
                    // Don't convert to youtu.be for address bar (would break SPA)
                    if (cleaned !== url) {
                        try {
                            const u = new URL(url);
                            let modified = false;
                            STRIP_PARAMS.forEach(p => { if (u.searchParams.has(p)) { u.searchParams.delete(p); modified = true; } });
                            if (modified) history.replaceState(history.state, '', u.toString());
                        } catch {}
                    }
                };
                addNavigateRule('cleanShareUrlBar', this._cleanAddressBar);
            },
            destroy() {
                document.removeEventListener('copy', this._clipboardHandler, true);
                removeMutationRule(this.id);
                removeNavigateRule('cleanShareUrlBar');
            }
        },
        // ─── Video Player ───
        cssFeature('hideRelatedVideos', 'Hide Related Videos', 'Remove the related videos panel on watch pages', 'Watch Page', 'panel-right',
            `ytd-watch-flexy #secondary { display: none !important; } ytd-watch-flexy #primary { max-width: none !important; }`, { isParent: true }),
        {
            id: 'expandVideoWidth',
            name: 'Expand Video Width',
            description: 'Stretch the video to fill the space when sidebar is hidden',
            group: 'Watch Page',
            icon: 'arrows-horizontal',
            isSubFeature: true,
            parentId: 'hideRelatedVideos',
            _styleElement: null,
            init() {
                if (appState.settings.hideRelatedVideos) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = 'yt-suite-expand-width';
                    this._styleElement.textContent = `ytd-watch-flexy #primary { max-width: none !important; }`;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'floatingLogoOnWatch',
            name: 'YTKit Player Controls',
            description: 'Replace native player right-controls with YouTube logo (quick links dropdown) and YTKit settings gear',
            group: 'Watch Page',
            icon: 'youtube',
            _ruleId: 'floatingLogoRule',
            _styleEl: null,
            _cleanup() {
                document.getElementById('ytkit-player-controls')?.remove();
                this._styleEl?.remove();
                this._styleEl = null;
            },
            _getLogoHref() {
                return appState.settings.logoToSubscriptions ? '/feed/subscriptions' : '/';
            },
            _inject() {
                if (!window.location.pathname.startsWith('/watch')) { document.getElementById('ytkit-player-controls')?.remove(); return; }
                const rightControls = document.querySelector('.ytp-right-controls');
                if (!rightControls || document.getElementById('ytkit-player-controls')) return;

                const wrap = document.createElement('div');
                wrap.id = 'ytkit-player-controls';

                // YouTube logo with quick links dropdown
                const logoWrap = document.createElement('div');
                logoWrap.id = 'ytkit-po-logo-wrap';

                const logoLink = document.createElement('a');
                logoLink.href = this._getLogoHref();
                logoLink.title = 'YouTube — hover for quick links';
                logoLink.className = 'ytkit-po-logo';
                TrustedHTML.setHTML(logoLink, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 248 174" width="28" height="20" aria-label="YouTube" style="opacity:0.9">
  <path fill="#ff0000" d="M 242.88,27.11 A 31.07,31.07 0 0 0 220.95,5.18 C 201.6,0 124,0 124,0 124,0 46.46,0 27.11,5.18 A 31.07,31.07 0 0 0 5.18,27.11 C 0,46.46 0,86.82 0,86.82 c 0,0 0,40.36 5.18,59.71 a 31.07,31.07 0 0 0 21.93,21.93 c 19.35,5.18 96.92,5.18 96.92,5.18 0,0 77.57,0 96.92,-5.18 a 31.07,31.07 0 0 0 21.93,-21.93 c 5.18,-19.35 5.18,-59.71 5.18,-59.71 0,0 0,-40.36 -5.18,-59.71 z"/>
  <path fill="#ffffff" d="M 99.22,124.03 163.67,86.82 99.22,49.61 Z"/>
</svg>`);
                logoWrap.appendChild(logoLink);

                // Build quick links dropdown
                const qlFeature = features.find(f => f.id === 'quickLinkMenu');
                if (qlFeature && qlFeature._buildMenu) {
                    qlFeature._buildMenu(logoWrap, 'ytkit-po-drop');
                }
                wrap.appendChild(logoWrap);

                // Download buttons
                if (appState.settings.showLocalDownloadButton) {
                    const dlBtn = document.createElement('button');
                    dlBtn.className = 'ytp-button ytkit-player-btn ytkit-po-dl';
                    dlBtn.title = 'Download Video';
                    TrustedHTML.setHTML(dlBtn, '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>');
                    dlBtn.addEventListener('click', (e) => { e.stopPropagation(); ytKitDownload(window.location.href, false); });
                    wrap.appendChild(dlBtn);
                }
                if (appState.settings.showMp3DownloadButton) {
                    const mp3Btn = document.createElement('button');
                    mp3Btn.className = 'ytp-button ytkit-player-btn ytkit-po-mp3';
                    mp3Btn.title = 'Download MP3';
                    TrustedHTML.setHTML(mp3Btn, '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>');
                    mp3Btn.addEventListener('click', (e) => { e.stopPropagation(); ytKitDownload(window.location.href, true); });
                    wrap.appendChild(mp3Btn);
                }
                if (appState.settings.showVlcButton) {
                    const vlcBtn = document.createElement('button');
                    vlcBtn.className = 'ytp-button ytkit-player-btn ytkit-po-vlc';
                    vlcBtn.title = 'Stream in VLC';
                    TrustedHTML.setHTML(vlcBtn, '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>');
                    vlcBtn.addEventListener('click', (e) => { e.stopPropagation(); openProtocol('ytvlc://' + encodeURIComponent(window.location.href), 'VLC protocol handler not found.'); });
                    wrap.appendChild(vlcBtn);
                }

                // Settings gear
                const gearBtn = document.createElement('button');
                gearBtn.className = 'ytp-button ytkit-player-btn ytkit-po-gear';
                gearBtn.title = 'YTKit Settings';
                TrustedHTML.setHTML(gearBtn, '<svg viewBox="0 0 24 24" data-stroke><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg>');
                gearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.body.classList.toggle('ytkit-panel-open');
                });
                wrap.appendChild(gearBtn);

                rightControls.appendChild(wrap);
            },
            init() {
                this._styleEl = GM_addStyle(`/* Hide native right controls, keep our injected elements */ .ytp-right-controls > *:not(#ytkit-player-controls){display:none !important;} .ytp-right-controls{display:flex !important;align-items:center !important;height:100% !important;} #ytkit-player-controls{display:flex;align-items:center;height:100%;margin:0;padding:0;} #ytkit-po-logo-wrap{position:relative;display:inline-flex;align-items:center;height:100%;} .ytkit-po-logo{display:inline-flex;align-items:center;justify-content:center;width:36px;height:100%;text-decoration:none;color:#fff;opacity:0.9;} .ytkit-po-logo svg{display:block;} .ytkit-po-dl:hover{background:rgba(34,197,94,0.15)!important;border-radius:4px;} .ytkit-po-mp3:hover{background:rgba(139,92,246,0.15)!important;border-radius:4px;} .ytkit-po-vlc:hover{background:rgba(249,115,22,0.15)!important;border-radius:4px;} .ytkit-po-gear svg{transition:transform 0.3s ease;} .ytkit-po-gear:hover svg{transform:rotate(45deg);} button.ytp-button.ytp-autonav-toggle.delhi-fast-follow-autonav-toggle{display:none !important;}`);

                const self = this;
                addNavigateRule(this._ruleId, () => self._inject());
            },
            destroy() {
                removeNavigateRule(this._ruleId);
                this._cleanup();
            }
        },
        cssFeature('hideDescriptionRow', 'Hide Description', 'Remove the video description panel below the player', 'Watch Page', 'file-minus',
            'ytd-watch-metadata #bottom-row'),
        {
            id: 'stickyVideo',
            name: 'Theater Split',
            description: 'Fullscreen video on watch pages. Scroll down to reveal comments side-by-side. Scroll back to top to return to fullscreen.',
            group: 'Watch Page',
            icon: 'picture-in-picture-2',
            pages: [PageTypes.WATCH],

            // ── state ──
            _styleEl: null,
            _isSplit: false,          // right panel is open
            _isActive: false,         // overlay is mounted
            _entering: false,
            _lastVideoId: null,
            _splitWrapper: null,
            _navRuleId: '_theaterSplit',
            _wheelHandler: null,
            _touchHandler: null,
            _touchMoveHandler: null,
            _touchStartY: 0,
            _rightWheelHandler: null,
            _rightTouchHandler: null,
            _rightTouchMoveHandler: null,
            _rightTouchStartY: 0,
            _mastheadDisplay: undefined,
            _windowResizeHandler: null,
            _playerResizeObs: null,
            _videoType: 'standard',        // 'live' | 'vod' | 'standard'
            _positionedEls: [],            // elements we CSS-positioned over right panel
            _scrollTarget: null,           // which element receives scroll/wheel handlers

            _headerH() {
                const h = document.querySelector('ytd-masthead, #masthead');
                if (!h || h.style.display === 'none') return 0;
                return h.getBoundingClientRect().height || 56;
            },

            _getPlayer()  { return document.querySelector('#player-container'); },
            _getBelow()   { return document.querySelector('#below') || document.querySelector('ytd-watch-metadata')?.parentElement; },
            _getChatEl()  { return VideoTypeDetector.getChatEl(); },

            // Nudge YouTube's player to recalculate control bar layout.
            _triggerPlayerResize() {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                }, 200);
            },

            _positionOverRight(el, rightPct, topOffset, heightStr) {
                if (!el) return;
                this._setStyles(el, {
                    position:'fixed', top:topOffset||'0', right:'0',
                    width:`calc(${rightPct}% - 6px)`, 'max-width':'none',
                    height:heightStr||'100vh', margin:'0',
                    'overflow-y':'auto', 'overflow-x':'hidden',
                    'z-index':'10001', background:'#0f0f0f', padding:'0',
                    'box-sizing':'border-box', visibility:'visible',
                    'pointer-events':'auto', display:'block',
                    'scrollbar-width':'thin', 'scrollbar-color':'rgba(255,255,255,0.15) transparent'
                });
                this._positionedEls.push(el);
            },

            _unpositionEl(el) {
                this._removeStyles(el, ['position','top','right','width','max-width','height','margin',
                    'overflow-y','overflow-x','z-index','background','padding','box-sizing',
                    'visibility','pointer-events','display','scrollbar-width','scrollbar-color','border-radius']);
            },

            // Clean up all positioned elements
            _unpositionAll() {
                (this._positionedEls || []).forEach(el => this._unpositionEl(el));
                this._positionedEls = [];
                this._scrollTarget = null;
            },

            // Bulk set/remove style properties with !important
            _setStyles(el, props) {
                if (!el) return;
                for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
            },
            _removeStyles(el, props) {
                if (!el) return;
                props.forEach(p => el.style.removeProperty(p));
            },

            // Force/restore chat frame internals
            _forceChatFill(chatEl) {
                if (!chatEl) return;
                const fill = {width:'100%',height:'100%'};
                this._setStyles(chatEl.querySelector('#show-hide-button'), {display:'none'});
                this._setStyles(chatEl.querySelector('#container'), {...fill,'max-height':'none','min-height':'0','border-radius':'0'});
                this._setStyles(chatEl.querySelector('iframe'), {...fill,'min-height':'0',border:'none','border-radius':'0'});
            },
            _restoreChatFill(chatEl) {
                if (!chatEl) return;
                this._removeStyles(chatEl.querySelector('#show-hide-button'), ['display']);
                this._removeStyles(chatEl.querySelector('#container'), ['width','height','max-height','min-height','border-radius']);
                this._removeStyles(chatEl.querySelector('iframe'), ['width','height','min-height','border','border-radius']);
            },

            // Position chat element over the right split panel
            _setupChat(chatEl, rightPct, top, height) {
                if (!chatEl) { this._waitForChat(rightPct, top, height); return; }
                this._positionOverRight(chatEl, rightPct, top, height);
                chatEl.removeAttribute('collapsed');
                this._setStyles(chatEl, {width:`calc(${rightPct}% - 2px)`,padding:'0 8px 0 0','border-radius':'0'});
                this._forceChatFill(chatEl);
            },

            // Wait for chat frame via MutationObserver (replaces 10s polling loop)
            _waitForChat(rightPct, topOffset, heightStr) {
                const self = this;
                let _chatObs = null;
                const _onFound = (chatEl) => {
                    if (_chatObs) { _chatObs.disconnect(); _chatObs = null; }
                    if (!self._isSplit || !self._isActive) return;
                    self._positionOverRight(chatEl, rightPct, topOffset, heightStr);
                    chatEl.removeAttribute('collapsed');
                    chatEl.style.setProperty('width', `calc(${rightPct}% - 2px)`, 'important');
                    chatEl.style.setProperty('padding', '0 8px 0 0', 'important');
                    chatEl.style.setProperty('border-radius', '0', 'important');
                    self._forceChatFill(chatEl);
                    if (!self._scrollTarget) self._scrollTarget = chatEl;
                    if (self._videoType === 'vod') {
                        chatEl.style.setProperty('border-bottom', '2px solid rgba(255,255,255,0.1)', 'important');
                        const below = self._getBelow();
                        if (below && below.style.getPropertyValue('top') === '0') {
                            below.style.setProperty('top', '45vh', 'important');
                            below.style.setProperty('height', '55vh', 'important');
                        }
                    }
                    DebugManager.log('Theater', 'Late chat frame found and positioned');
                };
                // Check immediately
                const existing = this._getChatEl();
                if (existing) { _onFound(existing); return; }
                // Observe for chat frame insertion (faster + less CPU than polling)
                _chatObs = new MutationObserver(() => {
                    const chatEl = self._getChatEl();
                    if (chatEl) _onFound(chatEl);
                });
                _chatObs.observe(document.body, { childList: true, subtree: true });
                // Safety timeout: disconnect after 10s
                setTimeout(() => { if (_chatObs) { _chatObs.disconnect(); _chatObs = null; } }, 10000);
            },

            // ── Build the fixed overlay (video full-width, right panel hidden) ──
            _buildOverlay() {
                const hh = this._headerH();
                const wrapper = document.createElement('div');
                wrapper.id = 'ytkit-split-wrapper';
                wrapper.style.cssText = `display:flex;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:transparent;overflow:hidden;pointer-events:none;`;

                // LEFT — full width initially
                const left = document.createElement('div');
                left.id = 'ytkit-split-left';
                // flex:1 — left fills whatever space the right panel doesn't take.
                // No fixed width, no transition needed — it reacts automatically.
                left.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;background:transparent;position:relative;pointer-events:none;`;

                // DIVIDER — hidden until split
                const divider = document.createElement('div');
                divider.id = 'ytkit-split-divider';
                divider.style.cssText = `flex:0 0 0;width:0;cursor:col-resize;position:relative;background:rgba(255,255,255,0.04);transition:flex-basis 0.35s cubic-bezier(0.4,0,0.2,1);overflow:hidden;z-index:10;pointer-events:auto;scrollbar-width:none;`;
                const pip = document.createElement('div');
                pip.className = 'ytkit-divider-pip';
                pip.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:40px;border-radius:2px;background:rgba(255,255,255,0.18);pointer-events:none;`;
                divider.appendChild(pip);
                divider.addEventListener('mouseenter', () => { divider.style.background='rgba(59,130,246,0.22)'; pip.style.background='rgba(59,130,246,0.8)'; });
                divider.addEventListener('mouseleave', () => { divider.style.background='rgba(255,255,255,0.04)'; pip.style.background='rgba(255,255,255,0.18)'; });
                this._initDividerDrag(divider, left, null);  // right set after creation

                // RIGHT — collapsed initially
                const right = document.createElement('div');
                right.id = 'ytkit-split-right';
                // flex:0 0 0 — right starts at zero width, grows to a fixed size.
                // Left (flex:1) automatically shrinks as right expands.
                right.style.cssText = `flex:0 0 0;width:0;height:100%;overflow-y:auto;overflow-x:hidden;background:#0f0f0f;border-left:1px solid rgba(255,255,255,0.06);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;padding:0;box-sizing:border-box;opacity:0;transition:flex-basis 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.3s;pointer-events:auto;`;
                // wire divider to right panel now that it exists
                this._initDividerDrag(divider, left, right);

                // CLOSE button — low opacity, top-right of left panel
                const closeBtn = document.createElement('button');
                closeBtn.id = 'ytkit-split-close';
                closeBtn.title = 'Close side panel';
                const svgNS = 'http://www.w3.org/2000/svg';
                const cs = document.createElementNS(svgNS,'svg');
                cs.setAttribute('viewBox','0 0 24 24'); cs.setAttribute('width','13'); cs.setAttribute('height','13');
                cs.setAttribute('fill','none'); cs.setAttribute('stroke','currentColor'); cs.setAttribute('stroke-width','2.5');
                const cl1 = document.createElementNS(svgNS,'line'); cl1.setAttribute('x1','18'); cl1.setAttribute('y1','6'); cl1.setAttribute('x2','6'); cl1.setAttribute('y2','18');
                const cl2 = document.createElementNS(svgNS,'line'); cl2.setAttribute('x1','6'); cl2.setAttribute('y1','6'); cl2.setAttribute('x2','18'); cl2.setAttribute('y2','18');
                cs.appendChild(cl1); cs.appendChild(cl2);
                closeBtn.appendChild(cs);
                closeBtn.onclick = () => this._collapseSplit(true);
                left.appendChild(closeBtn);

                wrapper.appendChild(left);
                wrapper.appendChild(divider);
                wrapper.appendChild(right);
                return wrapper;
            },

            _initDividerDrag(divider, left, right) {
                if (!right) return;
                divider.addEventListener('mousedown', (e) => {
                    if (!this._isSplit) return;
                    e.preventDefault();
                    const wrapper = this._splitWrapper;
                    const totalW = wrapper.getBoundingClientRect().width;
                    const startX = e.clientX;
                    const startLeftPct = left.getBoundingClientRect().width / totalW * 100;
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';

                    // Full-viewport overlay prevents cross-origin iframe from eating mouse events
                    const dragShield = document.createElement('div');
                    dragShield.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;';
                    document.body.appendChild(dragShield);

                    const onMove = (me) => {
                        const dx = me.clientX - startX;
                        const newLeftPct = Math.max(25, Math.min(85, startLeftPct + (dx / totalW * 100)));
                        const newRightPct = 100 - newLeftPct;
                        right.style.flexBasis = newRightPct + '%';
                        right.style.width     = newRightPct + '%';
                        divider.style.flexBasis = '6px';
                        const player = this._getPlayer();
                        if (player) player.style.setProperty('width', newLeftPct + '%', 'important');
                        (this._positionedEls || []).forEach(el => {
                            el.style.setProperty('width', `calc(${newRightPct}% - 2px)`, 'important');
                        });
                        const strip = wrapper.querySelector('#ytkit-split-collapse-strip');
                        if (strip) strip.style.width = `calc(${newRightPct}% - 2px)`;
                        try { GM_setValue('ytkit_split_ratio', 100 - newRightPct); } catch(err) {
                            DebugManager.log('Theater', `Failed to save split ratio: ${err.message}`);
                        }
                    };
                    const onUp = () => {
                        dragShield.remove();
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                        this._triggerPlayerResize();
                    };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                });
            },

            // ── Mount overlay (video fullscreen, comments hidden) ──
            _mountOverlay() {
                if (this._isActive) return;
                const player = this._getPlayer();
                const below  = this._getBelow();
                if (!player) return;
                // For live streams, #below may not exist yet — that's OK
                if (!below && !VideoTypeDetector.hasChat()) return;

                // Video type already set by _activate
                this._positionedEls = [];
                this._scrollTarget = null;

                this._isActive = true;

                const wrapper = this._buildOverlay();
                this._splitWrapper = wrapper;
                document.body.appendChild(wrapper);

                const left  = wrapper.querySelector('#ytkit-split-left');
                const right = wrapper.querySelector('#ytkit-split-right');

                // Fix player in place — NO reparenting. Avoids Chrome losing the video
                // GPU compositor surface when the window moves between monitors.
                // The overlay's left panel is transparent, so the player shows through.
                this._setStyles(player, {
                    position: 'fixed', top: '0', left: '0',
                    width: '100%', height: '100vh',
                    'z-index': '9998', background: '#000',
                    'min-height': '0', margin: '0', padding: '0',
                    'max-width': 'none', overflow: 'hidden'
                });

                // Force #movie_player to fill parent — clear YT's inline px dimensions
                // Batched: runs at most once per frame, and stops after layout stabilizes
                let _fpsPending = false;
                let _fpsCount = 0;
                const forcePlayerSize = () => {
                    if (_fpsPending || _fpsCount > 5) return; // Stop after 5 cycles to prevent fight with YT
                    _fpsPending = true;
                    _fpsCount++;
                    requestAnimationFrame(() => {
                        _fpsPending = false;
                        if (!this._isActive) return;
                        const mp = document.getElementById('movie_player');
                        if (!mp) return;
                        mp.style.setProperty('width',  '100%', 'important');
                        mp.style.setProperty('height', '100%', 'important');
                        const vc = mp.querySelector('.html5-video-container');
                        const vid = mp.querySelector('video.html5-main-video');
                        if (vc)  { vc.style.setProperty('width','100%','important'); vc.style.setProperty('height','100%','important'); }
                        if (vid) { vid.style.setProperty('width','100%','important'); vid.style.setProperty('height','100%','important'); vid.style.setProperty('object-fit','contain','important'); }
                        const ytdP = mp.closest('ytd-player');
                        const innerCont = ytdP?.querySelector('#container');
                        if (innerCont) { innerCont.style.setProperty('width','100%','important'); innerCont.style.setProperty('height','100%','important'); innerCont.style.setProperty('padding-bottom','0','important'); }
                    });
                };
                forcePlayerSize();

                // Single ResizeObserver on left panel — debounced to avoid fight with YT's player
                // Also syncs player width with left panel since player is positioned separately
                let _resizeDebounce = null;
                this._playerResizeObs = new ResizeObserver(() => {
                    clearTimeout(_resizeDebounce);
                    _resizeDebounce = setTimeout(() => {
                        _fpsCount = 0;
                        forcePlayerSize();
                        const leftW = left.getBoundingClientRect().width;
                        if (leftW > 0) player.style.setProperty('width', leftW + 'px', 'important');
                    }, 200);
                });
                this._playerResizeObs.observe(left);

                // Delayed resize trigger — wait for layout to settle before telling YT to recalculate
                setTimeout(() => this._triggerPlayerResize(), 600);

                // #below stays in original DOM — overlay at z-index:9999 hides it visually.
                // DO NOT set visibility:hidden — it can prevent IntersectionObserver from firing.
                // Just block interaction until split expands.
                if (below) {
                    below.style.setProperty('pointer-events', 'none', 'important');
                }

                // For live/VOD: also hide the chat frame behind overlay
                const chatEl = this._getChatEl();
                if (chatEl) {
                    chatEl.style.setProperty('pointer-events', 'none', 'important');
                    // Ensure chat iframe isn't collapsed (YT collapses it sometimes)
                    chatEl.removeAttribute('collapsed');
                }

                // Pre-scroll to comments so YT's IO fires (behind the overlay, invisible).
                // Deferred heavily to avoid interfering with video load. Only for standard/VOD.
                if (this._videoType !== 'live' && below) {
                    const scrollToComments = () => {
                        const commentsEl = below.querySelector('ytd-comments');
                        if (commentsEl) commentsEl.scrollIntoView({ behavior: 'instant', block: 'center' });
                    };
                    if (typeof requestIdleCallback === 'function') {
                        requestIdleCallback(scrollToComments, { timeout: 2000 });
                    } else {
                        setTimeout(scrollToComments, 800);
                    }
                }

                // Hide related videos sidebar — but NOT the chat frame container.
                // On live/VOD pages, ytd-live-chat-frame is inside #secondary.
                // Hiding #secondary with display:none kills the chat completely.
                const sec = document.querySelector('#secondary');
                if (sec) {
                    if (this._videoType === 'live' || this._videoType === 'vod') {
                        // Only hide #related, keep #secondary visible for chat.
                        // Force display:block to override hideRelatedVideos CSS !important
                        const related = sec.querySelector('#related');
                        if (related) { related.dataset.ytkitSplitHidden='1'; related.style.display='none'; }
                        sec.style.setProperty('display', 'block', 'important');
                        sec.style.setProperty('pointer-events', 'none', 'important');
                        sec.dataset.ytkitSplitHidden='1';
                    } else {
                        sec.dataset.ytkitSplitHidden='1'; sec.style.display='none';
                    }
                }

                // Masthead hidden via CSS class added in _activate()
                const mast = document.querySelector('ytd-masthead, #masthead');
                if (mast) this._mastheadDisplay = mast.style.display;

                // Cache right panel ref for wheel handler (avoid querySelector in hot path)
                const rightRef = right;

                // Check if event target is in any positioned content element
                const isInRightContent = (target) => {
                    if (rightRef.contains(target)) return true;
                    return (this._positionedEls || []).some(el => el.contains(target));
                };

                // Wheel/touch on document capture — the overlay has pointer-events:none
                // so events target the player directly. Use capture on document to intercept
                // before YouTube's player can stopPropagation (volume control).
                const isOverPlayer = (target) => {
                    const mp = document.getElementById('movie_player');
                    return mp && mp.contains(target);
                };
                this._wheelHandler = (e) => {
                    if (!this._isActive) return;
                    if (!isOverPlayer(e.target) && !isInRightContent(e.target)) return;
                    if (!this._isSplit && e.deltaY > 0 && isOverPlayer(e.target)) { this._expandSplit(); return; }
                    if (this._isSplit && !isInRightContent(e.target)) {
                        const scrollEl = this._scrollTarget;
                        if (scrollEl) {
                            if (e.deltaY < 0 && scrollEl.scrollTop <= 0) {
                                this._collapseSplit(false);
                                return;
                            }
                            scrollEl.scrollTop += e.deltaY;
                        }
                    }
                };
                this._touchStartY = 0;
                this._touchHandler = (e) => { const t = e.touches[0]; if (t) this._touchStartY = t.clientY; };
                this._touchMoveHandler = (e) => {
                    if (!this._isActive) return;
                    const t = e.touches[0]; if (!t) return;
                    if (!this._isSplit && this._touchStartY - t.clientY > 30 && isOverPlayer(e.target)) { this._expandSplit(); return; }
                    if (this._isSplit && !isInRightContent(e.target)) {
                        const delta = this._touchStartY - t.clientY;
                        const scrollEl = this._scrollTarget;
                        if (scrollEl) {
                            if (delta < -40 && scrollEl.scrollTop <= 0) {
                                this._collapseSplit(false);
                                return;
                            }
                            scrollEl.scrollTop += delta * 0.5;
                        }
                        this._touchStartY = t.clientY;
                    }
                };
                document.addEventListener('wheel', this._wheelHandler, { passive: true, capture: true });
                document.addEventListener('touchstart', this._touchHandler, { passive: true, capture: true });
                document.addEventListener('touchmove', this._touchMoveHandler, { passive: true, capture: true });

                // Re-layout on window resize
                this._windowResizeHandler = () => { if (this._isActive) this._triggerPlayerResize(); };
                window.addEventListener('resize', this._windowResizeHandler);

                DebugManager.log('Theater', 'Overlay mounted');
            },

            // ── Expand right panel (show comments/chat) ──
            _expandSplit() {
                if (this._isSplit || !this._isActive) return;
                this._isSplit = true;
                this._entering = true;
                this._positionedEls = [];

                const wrapper = this._splitWrapper;
                const left    = wrapper.querySelector('#ytkit-split-left');

                // Reconnect resize observer
                if (this._playerResizeObs && left) this._playerResizeObs.observe(left);
                const right   = wrapper.querySelector('#ytkit-split-right');
                const divider = wrapper.querySelector('#ytkit-split-divider');
                const below   = this._getBelow();
                const chatEl  = this._getChatEl();
                const type    = this._videoType;

                const closeBtn = wrapper.querySelector('#ytkit-split-close');
                if (closeBtn) closeBtn.style.opacity = '0.3';

                let leftPct = 75;
                try { leftPct = parseFloat(GM_getValue('ytkit_split_ratio', 75)); } catch(e) {
                    DebugManager.log('Theater', `Failed to load split ratio: ${e.message}`);
                }
                leftPct = Math.max(25, Math.min(85, leftPct));
                const rightPct = 100 - leftPct;

                // Expand overlay's right panel placeholder
                right.style.flexBasis = rightPct + '%';
                right.style.width     = rightPct + '%';
                divider.style.flexBasis = '6px';
                divider.style.width     = '6px';

                // Sync player width — player is fixed-positioned separately
                const player = this._getPlayer();
                if (player) player.style.setProperty('width', leftPct + '%', 'important');
                if (type === 'live' || type === 'vod') {
                    // Right panel is just a spacer — chat overlays it via CSS fixed
                    right.style.opacity = '0';
                    right.style.background = 'transparent';
                    right.style.borderLeft = 'none';
                } else {
                    right.style.opacity = '1';
                }

                // Elements stay in original DOM (no reparenting) so YT's IO works.
                if (type === 'live') {
                    this._setupChat(chatEl, rightPct, '0', '100vh');
                    this._scrollTarget = chatEl;
                } else if (type === 'vod') {
                    this._setupChat(chatEl, rightPct, '0', '45vh');
                    if (chatEl) chatEl.style.setProperty('border-bottom', '2px solid rgba(255,255,255,0.1)', 'important');
                    if (below) {
                        const hasChat = !!chatEl;
                        this._positionOverRight(below, rightPct, hasChat ? '45vh' : '0', hasChat ? '55vh' : '100vh');
                        this._setStyles(below, {width:`calc(${rightPct}% - 2px)`,padding:'0 8px 60px 2px'});
                    }
                    this._scrollTarget = chatEl || below;
                } else {
                    if (below) {
                        this._positionOverRight(below, rightPct, '0', '100vh');
                        this._setStyles(below, {width:`calc(${rightPct}% - 2px)`,padding:'0 8px 60px 2px'});
                        this._scrollTarget = below;
                    }
                }

                const onExpanded = () => {
                    if (right) right.removeEventListener('transitionend', onTransEnd);
                    this._entering = false;
                    this._triggerPlayerResize();
                    // For standard/VOD: scroll to top to show video title
                    if (type !== 'live' && below) {
                        below.scrollTop = 0;
                    }
                    // Re-inject download/action buttons — Polymer may have re-rendered
                    // #top-level-buttons-computed when the player was reparented
                    if (typeof checkAllButtons === 'function') {
                        checkAllButtons();
                        setTimeout(checkAllButtons, 500);
                    }
                };
                const onTransEnd = (e) => {
                    if (e.propertyName === 'flex-basis' || e.propertyName === 'opacity') onExpanded();
                };
                right.addEventListener('transitionend', onTransEnd);
                setTimeout(() => { if (this._entering) onExpanded(); }, 500);

                // Scroll/wheel handlers on the primary scroll target
                const scrollEl = this._scrollTarget;
                if (scrollEl) {
                    this._rightWheelHandler = (e) => {
                        if (scrollEl.scrollTop === 0 && e.deltaY < 0) this._collapseSplit(false);
                    };
                    this._rightTouchStartY = 0;
                    this._rightTouchHandler = (e) => {
                        const t = e.touches[0]; if (t) this._rightTouchStartY = t.clientY;
                    };
                    this._rightTouchMoveHandler = (e) => {
                        if (scrollEl.scrollTop !== 0) return;
                        const t = e.touches[0];
                        if (t && t.clientY - this._rightTouchStartY > 40) this._collapseSplit(false);
                    };
                    scrollEl.addEventListener('wheel', this._rightWheelHandler, { passive: true });
                    scrollEl.addEventListener('touchstart', this._rightTouchHandler, { passive: true });
                    scrollEl.addEventListener('touchmove', this._rightTouchMoveHandler, { passive: true });
                }

                // For live/VOD: chat iframe swallows wheel events (cross-origin).
                // Add a collapse trigger strip at top of right panel above the iframe z-index.
                if (type === 'live' || type === 'vod') {
                    const strip = document.createElement('div');
                    strip.id = 'ytkit-split-collapse-strip';
                    strip.style.width = `calc(${rightPct}% - 6px)`;
                    strip.addEventListener('wheel', (e) => {
                        if (e.deltaY < 0) this._collapseSplit(false);
                    }, { passive: true });
                    strip.addEventListener('touchstart', (e) => {
                        const t = e.touches[0]; if (t) strip._touchY = t.clientY;
                    }, { passive: true });
                    strip.addEventListener('touchmove', (e) => {
                        const t = e.touches[0];
                        if (t && t.clientY - (strip._touchY || 0) > 30) this._collapseSplit(false);
                    }, { passive: true });
                    strip.addEventListener('click', () => this._collapseSplit(false));
                    wrapper.appendChild(strip);
                }

                DebugManager.log('Theater', `Split expanded (${type})`);
            },

            // ── Collapse right panel (back to fullscreen video) ──
            _collapseSplit(dismissed) {
                if (!this._isSplit) return;
                this._isSplit = false;

                const wrapper = this._splitWrapper;
                const right   = wrapper.querySelector('#ytkit-split-right');
                const divider = wrapper.querySelector('#ytkit-split-divider');
                const closeBtn = wrapper.querySelector('#ytkit-split-close');

                // Remove scroll handlers from scroll target
                const scrollEl = this._scrollTarget;
                if (this._rightWheelHandler && scrollEl) {
                    scrollEl.removeEventListener('wheel', this._rightWheelHandler);
                    scrollEl.removeEventListener('touchstart', this._rightTouchHandler);
                    scrollEl.removeEventListener('touchmove', this._rightTouchMoveHandler);
                    this._rightWheelHandler = null;
                    this._rightTouchHandler = null;
                    this._rightTouchMoveHandler = null;
                }

                // Collapse overlay placeholder
                right.style.flexBasis = '0';
                right.style.width     = '0';
                divider.style.flexBasis = '0';
                divider.style.width     = '0';
                right.style.padding = '0';
                right.style.opacity = '0';

                // Restore player to full width
                const player = this._getPlayer();
                if (player) player.style.setProperty('width', '100%', 'important');

                // Unposition all elements and hide behind overlay
                this._unpositionAll();
                const below = this._getBelow();
                if (below) below.style.setProperty('pointer-events', 'none', 'important');
                const chatEl = this._getChatEl();
                if (chatEl) {
                    chatEl.style.setProperty('pointer-events', 'none', 'important');
                    chatEl.style.removeProperty('border-bottom');
                    this._restoreChatFill(chatEl);
                }

                if (closeBtn) closeBtn.style.opacity = '0';

                // Remove collapse trigger strip
                wrapper.querySelector('#ytkit-split-collapse-strip')?.remove();

                // Pause resize observer while collapsed
                this._playerResizeObs?.disconnect();

                this._triggerPlayerResize();
                DebugManager.log('Theater', 'Split collapsed');
            },

            // ── Unmount overlay entirely (navigate away / feature disabled) ──
            _unmount(keepClass) {
                if (!this._isActive) return;
                clearTimeout(this._resizeTimer);

                // Remove scroll handlers from scroll target
                const scrollEl = this._scrollTarget;
                if (this._rightWheelHandler && scrollEl) {
                    scrollEl.removeEventListener('wheel', this._rightWheelHandler);
                    scrollEl.removeEventListener('touchstart', this._rightTouchHandler);
                    scrollEl.removeEventListener('touchmove', this._rightTouchMoveHandler);
                    this._rightWheelHandler = null;
                    this._rightTouchHandler = null;
                    this._rightTouchMoveHandler = null;
                }
                if (this._wheelHandler) {
                    document.removeEventListener('wheel', this._wheelHandler, true);
                    document.removeEventListener('touchstart', this._touchHandler, true);
                    document.removeEventListener('touchmove', this._touchMoveHandler, true);
                }
                this._wheelHandler = null;
                this._touchHandler = null;
                this._touchMoveHandler = null;
                if (this._windowResizeHandler) {
                    window.removeEventListener('resize', this._windowResizeHandler);
                    this._windowResizeHandler = null;
                }
                if (!keepClass) {
                    const masth = document.querySelector('ytd-masthead, #masthead');
                    if (masth && this._mastheadDisplay !== undefined) {
                        masth.style.display = this._mastheadDisplay || '';
                    }
                }
                this._mastheadDisplay = undefined;
                this._playerResizeObs?.disconnect();
                this._playerResizeObs = null;

                // Clear fixed positioning — player never left its original DOM location
                const player = this._getPlayer();
                if (player) {
                    this._removeStyles(player, ['position', 'top', 'left', 'width', 'height',
                        'z-index', 'background', 'min-height', 'margin', 'padding', 'max-width', 'overflow']);
                }

                // Restore all positioned elements — remove fixed positioning styles
                this._unpositionAll();
                const below = this._getBelow();
                if (below) {
                    below.style.removeProperty('pointer-events');
                    below.style.removeProperty('border-bottom');
                }
                const chatEl = this._getChatEl();
                if (chatEl) {
                    chatEl.style.removeProperty('pointer-events');
                    chatEl.style.removeProperty('border-bottom');
                    this._restoreChatFill(chatEl);
                }

                const mp = document.getElementById('movie_player');
                if (mp) { mp.style.width=''; mp.style.height=''; }

                document.querySelectorAll('[data-ytkit-split-hidden]').forEach(el => {
                    el.style.display=''; el.style.removeProperty('pointer-events');
                    delete el.dataset.ytkitSplitHidden;
                });

                this._splitWrapper?.remove();
                this._splitWrapper = null;
                this._isSplit = false;
                this._isActive = false;
                this._videoType = 'standard';
                if (!keepClass) document.documentElement.classList.remove('ytkit-split-active');
                if (!keepClass) document.documentElement.style.removeProperty('--ytd-masthead-height');
                // Restore page scroll — we left it scrolled to comments for IO during mount
                window.scrollTo(0, 0);
                DebugManager.log('Theater', 'Overlay unmounted');
            },

            _activate() {
                if (!window.location.pathname.startsWith('/watch')) return;

                const vid = getVideoId();
                if (vid !== this._lastVideoId) {
                    this._lastVideoId = vid;
                    if (this._isActive) {
                        // Same overlay, new video — collapse + refresh type (no unmount/remount)
                        if (this._isSplit) this._collapseSplit(false);
                        this._scrollTarget = null;
                        this._videoType = VideoTypeDetector.refresh();
                        DebugManager.log('Theater', `Video changed to ${vid}, type: ${this._videoType}`);
                        return;
                    }
                }
                if (this._isActive) return;

                // First mount — detect video type
                this._videoType = VideoTypeDetector.refresh();

                const doMount = () => {
                    if (this._isActive) return;
                    // Apply class right before mount — prevents broken half-state
                    // where masthead is hidden but overlay hasn’t mounted yet
                    document.documentElement.classList.add('ytkit-split-active');
                    document.documentElement.style.setProperty('--ytd-masthead-height', '0px');
                    this._mountOverlay();
                };

                const player = this._getPlayer();
                const below  = this._getBelow();
                const chatEl = this._getChatEl();
                const hasContent = below || chatEl;
                if (player && hasContent) {
                    doMount();
                } else {
                    waitForElement('#player-container', () => {
                        waitForElement('#below, ytd-watch-metadata, ytd-live-chat-frame, #chat', () => {
                            if (window.location.pathname.startsWith('/watch')) doMount();
                        });
                    });
                }
            },

            init() {
                const css = `html.ytkit-split-active ytd-watch-flexy{display:block!important;overflow:visible!important;} html.ytkit-split-active ytd-watch-flexy #columns{max-width:100%!important;} html.ytkit-split-active ytd-masthead,html.ytkit-split-active #masthead-container{display:none!important;} html.ytkit-split-active #page-manager{margin-top:0!important;} html.ytkit-split-active ytd-app{--ytd-masthead-height:0px;} html.ytkit-split-active,html.ytkit-split-active body{overflow:hidden!important;} html.ytkit-split-active body{padding-top:0!important;} html.ytkit-split-active #player-container,html.ytkit-split-active #player-container-inner,html.ytkit-split-active #player-theater-container,html.ytkit-split-active ytd-player{width:100%!important;max-width:none!important;height:100%!important;min-height:0!important;padding:0!important;margin:0!important;} html.ytkit-split-active #movie_player{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;position:relative!important;left:auto!important;top:auto!important;} html.ytkit-split-active .html5-video-container{width:100%!important;height:100%!important;} html.ytkit-split-active video.html5-main-video{width:100%!important;height:100%!important;object-fit:contain!important;left:0!important;top:0!important;} html.ytkit-split-active ytd-player > #container,html.ytkit-split-active #player-container-inner #player{width:100%!important;height:100%!important;padding-bottom:0!important;} html.ytkit-split-active ytd-watch-flexy[flexy-header-flipper_] #player-container,html.ytkit-split-active ytd-watch-flexy[theater] #player-container,html.ytkit-split-active ytd-watch-flexy #player-container{width:100%!important;max-width:none!important;} #ytkit-split-right::-webkit-scrollbar{width:5px;} #ytkit-split-right::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:3px;} #ytkit-split-right::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28);} .ytkit-divider-pip{opacity:0;transition:opacity 0.2s ease;} #ytkit-split-divider:hover .ytkit-divider-pip{opacity:1;} html.ytkit-split-active #below[style*="position:fixed"],html.ytkit-split-active #below[style*="position:fixed"]{scrollbar-width:thin!important;scrollbar-color:rgba(255,255,255,0.12) transparent!important;font-size:13px!important;} html.ytkit-split-active #below[style*="position"] ytd-watch-metadata{margin:-12px 0 0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-watch-metadata .item{padding:0!important;margin:0!important;} html.ytkit-split-active #below[style*="position"] ytd-watch-metadata #title{font-size:15px!important;line-height:1.3!important;margin-bottom:2px!important;} html.ytkit-split-active #below[style*="position"] #owner{margin:2px 0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] #actions{flex-wrap:wrap!important;max-width:100%!important;margin:0!important;padding:2px 0!important;gap:4px!important;overflow:visible!important;} html.ytkit-split-active #below[style*="position"] #actions ytd-menu-renderer,html.ytkit-split-active #below[style*="position"] #top-level-buttons-computed{flex-wrap:wrap!important;gap:2px!important;overflow:visible!important;} html.ytkit-split-active #below[style*="position"] #actions button,html.ytkit-split-active #below[style*="position"] #actions ytd-button-renderer,html.ytkit-split-active #below[style*="position"] #actions ytd-toggle-button-renderer{transform:scale(0.88)!important;transform-origin:center!important;} html.ytkit-split-active #below[style*="position"] ytd-text-inline-expander,html.ytkit-split-active #below[style*="position"] ytd-text-inline-expander > div{padding:0!important;margin:0!important;max-width:100%!important;word-break:break-word!important;font-size:12px!important;line-height:1.4!important;} html.ytkit-split-active #below[style*="position"] #description-inline-expander{margin:4px 0!important;padding:6px 8px!important;background:rgba(255,255,255,0.04)!important;border-radius:6px!important;} html.ytkit-split-active #below[style*="position"] ytd-comments{margin:0!important;padding:0 0 40px!important;} html.ytkit-split-active #below[style*="position"] ytd-comments-header-renderer,html.ytkit-split-active #below[style*="position"] ytd-comments-header-renderer > div{padding:0!important;margin:0!important;} html.ytkit-split-active #below[style*="position"] #count.ytd-comments-header-renderer{font-size:13px!important;margin:6px 0 2px!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-simplebox-renderer{padding:0!important;margin:0 0 4px!important;transform:scale(0.92)!important;transform-origin:top left!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-thread-renderer{margin:0!important;padding:6px 4px!important;border-bottom:1px solid rgba(255,255,255,0.06)!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-thread-renderer:last-child{border-bottom:none!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-renderer{margin:0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-renderer #author-thumbnail{width:24px!important;height:24px!important;margin-right:8px!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-renderer #author-thumbnail img,html.ytkit-split-active #below[style*="position"] ytd-comment-renderer #author-thumbnail yt-img-shadow{width:24px!important;height:24px!important;border-radius:50%!important;} html.ytkit-split-active #below[style*="position"] #header-author{margin-bottom:1px!important;} html.ytkit-split-active #below[style*="position"] #author-text{font-size:12px!important;} html.ytkit-split-active #below[style*="position"] #published-time-text{font-size:11px!important;} html.ytkit-split-active #below[style*="position"] #content-text{font-size:13px!important;line-height:1.35!important;margin:0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] #action-buttons{margin-top:2px!important;} html.ytkit-split-active #below[style*="position"] #action-buttons ytd-toggle-button-renderer,html.ytkit-split-active #below[style*="position"] #action-buttons #reply-button-end{transform:scale(0.85)!important;transform-origin:left center!important;} html.ytkit-split-active #below[style*="position"] #action-buttons #vote-count-middle{font-size:11px!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-replies-renderer{margin-left:28px!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-replies-renderer #expander-contents{padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-item-section-renderer,html.ytkit-split-active #below[style*="position"] ytd-item-section-renderer > #contents{padding:0!important;margin:0!important;max-width:100%!important;box-sizing:border-box!important;} html.ytkit-split-active #below[style*="position"] yt-formatted-string{max-width:100%!important;word-break:break-word!important;} html.ytkit-split-active #ytkit-split-right{border:none!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position:fixed"],html.ytkit-split-active ytd-live-chat-frame[style*="position:fixed"],html.ytkit-split-active #chat[style*="position:fixed"],html.ytkit-split-active #chat[style*="position:fixed"]{scrollbar-width:thin!important;scrollbar-color:rgba(255,255,255,0.15) transparent!important;margin:0!important;max-width:none!important;border-radius:0!important;padding:0 6px 0 0!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"] iframe,html.ytkit-split-active #chat[style*="position"] iframe{width:100%!important;height:100%!important;min-height:0!important;border:none!important;border-radius:0!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"] #container,html.ytkit-split-active #chat[style*="position"] #container{width:100%!important;height:100%!important;max-height:none!important;min-height:0!important;border-radius:0!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"] #show-hide-button,html.ytkit-split-active #chat[style*="position"] #show-hide-button{display:none!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"],html.ytkit-split-active #chat[style*="position"]{min-height:0!important;max-height:none!important;} #ytkit-split-close{position:absolute;bottom:16px;right:16px;z-index:25;width:30px;height:30px;border-radius:50%;border:none;background:rgba(0,0,0,0.5);color:rgba(255,255,255,0.55);display:none;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s,background 0.15s;pointer-events:auto;} #ytkit-split-close:hover{background:rgba(220,38,38,0.75);color:#fff;opacity:1!important;} #ytkit-split-collapse-strip{position:fixed;top:0;right:0;height:24px;z-index:10002;cursor:n-resize;background:transparent;transition:background 0.2s;pointer-events:auto;} #ytkit-split-collapse-strip:hover{background:linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%);} #ytkit-split-collapse-strip::after{content:'';display:block;width:24px;height:2px;background:rgba(255,255,255,0.12);border-radius:1px;margin:8px auto 0;opacity:0;transition:opacity 0.2s;} #ytkit-split-collapse-strip:hover::after{opacity:1;} html.ytkit-split-active #secondary,html.ytkit-split-active #below,html.ytkit-split-active #player-full-bleed-container,html.ytkit-split-active #columns,html.ytkit-split-active ytd-watch-flexy{view-transition-name:none!important;} html.ytkit-split-active ytd-live-chat-frame#chat,html.ytkit-split-active ytd-live-chat-frame{display:flex!important;flex-direction:column!important;max-height:none!important;min-height:0!important;visibility:visible!important;} html.ytkit-split-active #chat-container{display:block!important;height:auto!important;max-height:none!important;overflow:visible!important;visibility:visible!important;} html.ytkit-split-active ytd-live-chat-frame#chat>iframe,html.ytkit-split-active ytd-live-chat-frame>iframe{flex:1!important;height:100%!important;min-height:0!important;max-height:none!important;} html.ytkit-split-active ytd-watch-flexy.loading ytd-live-chat-frame#chat,html.ytkit-split-active ytd-watch-flexy:not([ghost-cards-enabled]).loading #chat{visibility:visible!important;}  `;
                this._styleEl = injectStyle(css, this.id, true);
                addNavigateRule(this._navRuleId, () => this._activate());
                DebugManager.log('Theater', 'Theater Split initialized');
            },

            destroy() {
                this._unmount();
                this._styleEl?.remove();
                removeNavigateRule(this._navRuleId);
            }
        },

        // ─── Quality ───
        {
            id: 'autoMaxResolution',
            name: 'Auto Quality',
            description: 'Automatically select preferred video quality (max, 4K, 1440p, 1080p, 720p, 480p)',
            group: 'Video Player',
            icon: 'sparkles',
            isParent: true,
            type: 'select',
            options: {
                'max': 'Maximum Available',
                '2160': '4K (2160p)',
                '1440': '1440p',
                '1080': '1080p',
                '720': '720p',
                '480': '480p'
            },
            settingKey: 'preferredQuality',
            _lastProcessedVideoId: null,
            _onPlayerUpdated: null,
            _styleElement: null,
            _qualityMap: { '2160': 'hd2160', '1440': 'hd1440', '1080': 'hd1080', '720': 'hd720', '480': 'large' },
            init() {
                this._onPlayerUpdated = (evt) => {
                    const player = evt?.target?.player_ || document.getElementById('movie_player');
                    this.setQuality(player);
                };
                window.addEventListener('yt-player-updated', this._onPlayerUpdated, true);
                if (appState.settings.hideQualityPopup) {
                    this._styleElement = injectStyle('.ytp-popup.ytp-settings-menu { opacity: 0 !important; pointer-events: none !important; }', 'hide-quality-popup', true);
                }
            },
            destroy() {
                if (this._onPlayerUpdated) window.removeEventListener('yt-player-updated', this._onPlayerUpdated, true);
                this._styleElement?.remove();
                this._lastProcessedVideoId = null;
            },
            setQuality(player) {
                const currentVideoId = getVideoId();
                if (!player || !currentVideoId || currentVideoId === this._lastProcessedVideoId) return;
                if (typeof player.getAvailableQualityLevels !== 'function') return;
                const levels = player.getAvailableQualityLevels();
                if (!levels || !levels.length) return;
                this._lastProcessedVideoId = currentVideoId;
                const pref = appState.settings.preferredQuality || 'max';
                // Ordered quality levels for fallback chain
                const qualityOrder = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
                let target;
                if (pref === 'max') {
                    target = levels[0];
                } else {
                    const ytLabel = this._qualityMap[pref] || 'hd1080';
                    if (levels.includes(ytLabel)) {
                        target = ytLabel;
                    } else {
                        // Walk down from preferred quality to find closest available
                        const startIdx = qualityOrder.indexOf(ytLabel);
                        if (startIdx !== -1) {
                            for (let i = startIdx; i < qualityOrder.length; i++) {
                                if (levels.includes(qualityOrder[i])) { target = qualityOrder[i]; break; }
                            }
                        }
                        if (!target) target = levels[0];
                    }
                }
                try { player.setPlaybackQualityRange(target, target); } catch { /* ignore */ }
            }
        },
        {
            id: 'useEnhancedBitrate',
            name: 'Enhanced Bitrate',
            description: 'Re-apply max quality on navigation to counter YouTube quality resets',
            group: 'Video Player',
            icon: 'gauge',
            isSubFeature: true,
            parentId: 'autoMaxResolution',
            init() {
                addNavigateRule(this.id, () => {
                    const parentFeature = features.find(f => f.id === 'autoMaxResolution');
                    if (parentFeature) {
                        parentFeature._lastProcessedVideoId = null;
                        const player = document.getElementById('movie_player');
                        if (player) parentFeature.setQuality(player);
                    }
                });
            },
            destroy() { removeNavigateRule(this.id); }
        },
        {
            id: 'hideQualityPopup',
            name: 'Hide Quality Popup',
            description: 'Suppress the quality selection popup during auto-selection',
            group: 'Video Player',
            icon: 'eye-off',
            isSubFeature: true,
            parentId: 'autoMaxResolution',
            init() {},
            destroy() {}
        },

        // ─── Clutter ───
        cssFeature('hideMerchShelf', 'Hide Merch Shelf', 'Remove merchandise promotions below videos', 'Watch Page', 'shopping-bag',
            'ytd-merch-shelf-renderer'),
        cssFeature('hideAiSummary', 'Hide AI Summary', 'Remove AI-generated summaries and Ask AI buttons', 'Watch Page', 'bot-off',
            `ytd-engagement-panel-section-list-renderer[target-id*="ai"],
                    ytd-engagement-panel-section-list-renderer[target-id*="summary"],
                    tp-yt-paper-button[aria-label*="AI"], tp-yt-paper-button[aria-label*="Ask"],
                    ytd-info-panel-content-renderer:has([icon="info_outline"]),
                    [class*="ai-summary"], [class*="aiSummary"],
                    ytd-reel-shelf-renderer:has([is-ask-ai]) { display: none !important; }`),
        cssFeature('hideDescriptionExtras', 'Hide Description Extras', 'Remove extra elements in the description area', 'Watch Page', 'file-x',
            'ytd-video-description-transcript-section-renderer, ytd-structured-description-content-renderer > *:not(ytd-text-inline-expander)'),
        cssFeature('hideHashtags', 'Hide Hashtags', 'Remove hashtag links above video titles', 'Watch Page', 'hash',
            'ytd-watch-metadata .super-title, ytd-video-primary-info-renderer .super-title'),
        cssFeature('hidePinnedComments', 'Hide Pinned Comments', 'Remove pinned comments from the comments section', 'Watch Page', 'pin-off',
            `ytd-comment-thread-renderer:has(ytd-pinned-comment-badge-renderer) { display: none !important; }
                    ytd-pinned-comment-badge-renderer { display: none !important; }`),
        cssFeature('hideCommentActionMenu', 'Hide Comment Actions', 'Remove action menu from individual comments', 'Watch Page', 'more-horizontal',
            '#action-menu.ytd-comment-view-model, #action-menu.ytd-comment-renderer'),
        cssFeature('condenseComments', 'Condense Comments', 'Reduce spacing between comments for a tighter layout', 'Watch Page', 'minimize-2',
            `ytd-comment-thread-renderer.style-scope.ytd-item-section-renderer{margin-top:5px !important;margin-bottom:1px !important;} ytd-comment-thread-renderer.style-scope.ytd-comment-replies-renderer{padding-top:0px !important;padding-bottom:0px !important;margin-top:0px !important;margin-bottom:0px !important;}`),
        cssFeature('hideCommentTeaser', 'Hide Comment Teaser', 'Remove the "Scroll for comments" prompt on watch pages', 'Watch Page', 'message-square-off',
            'ytd-comments-entry-point-header-renderer, ytd-comments-entry-point-teaser-renderer'),
        {
            id: 'autoExpandComments',
            name: 'Auto-Expand Comments',
            description: 'Automatically expand truncated comments so full text is always visible',
            group: 'Comments',
            icon: 'fullscreen',
            pages: [PageTypes.WATCH],
            _styleElement: null,
            init() {
                // CSS: Force comment expanders to show full content and hide Read more / Show less buttons
                const css = `
                    /* Force ytd-expander in comments to be fully expanded */
                    ytd-comment-view-model ytd-expander,
                    ytd-comment-renderer ytd-expander,
                    ytd-comment-thread-renderer ytd-expander {
                        --ytd-expander-max-lines: 9999 !important;
                        max-height: none !important;
                        overflow: visible !important;
                    }
                    ytd-comment-view-model ytd-expander[collapsed] #content,
                    ytd-comment-renderer ytd-expander[collapsed] #content,
                    ytd-comment-view-model ytd-expander #content,
                    ytd-comment-renderer ytd-expander #content {
                        max-height: none !important;
                        overflow: visible !important;
                        -webkit-line-clamp: unset !important;
                        -webkit-box-orient: unset !important;
                        display: block !important;
                    }
                    /* Force content-text to show fully */
                    ytd-comment-view-model #content-text,
                    ytd-comment-renderer #content-text {
                        max-height: none !important;
                        overflow: visible !important;
                        -webkit-line-clamp: unset !important;
                        display: block !important;
                        text-overflow: unset !important;
                    }
                    /* Override any inline truncation on the expander content wrapper */
                    ytd-comment-view-model ytd-expander > #content.ytd-expander,
                    ytd-comment-renderer ytd-expander > #content.ytd-expander {
                        max-height: none !important;
                        overflow: visible !important;
                    }
                    /* Hide Read more / Show less buttons since everything is expanded */
                    ytd-comment-view-model ytd-expander #more,
                    ytd-comment-view-model ytd-expander [slot="more"],
                    ytd-comment-view-model ytd-expander #less,
                    ytd-comment-view-model ytd-expander [slot="less"],
                    ytd-comment-renderer ytd-expander #more,
                    ytd-comment-renderer ytd-expander [slot="more"],
                    ytd-comment-renderer ytd-expander #less,
                    ytd-comment-renderer ytd-expander [slot="less"],
                    ytd-comment-renderer tp-yt-paper-button.ytd-expander {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);

                // MutationObserver fallback: programmatically expand any collapsed expanders
                // YouTube sometimes sets truncation via JS attributes that resist CSS overrides
                const expandComments = () => {
                    const expanders = document.querySelectorAll(
                        'ytd-comment-view-model ytd-expander[collapsed], ytd-comment-renderer ytd-expander[collapsed]'
                    );
                    expanders.forEach(exp => {
                        // Remove collapsed attribute to trigger expansion
                        exp.removeAttribute('collapsed');
                        // Also try clicking the "Read more" button if it exists (handles edge cases)
                        const moreBtn = exp.querySelector('#more, [slot="more"], tp-yt-paper-button#more');
                        if (moreBtn) {
                            try { moreBtn.click(); } catch(e) {
                                DebugManager.log('Description', `Click failed: ${e.message}`);
                            }
                        }
                    });
                };

                addMutationRule(this.id, expandComments);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove();
                this._styleElement = null;
            }
        },
        {
            id: 'commentEnhancements',
            name: 'Comment Enhancements',
            description: 'Highlight creator/OP replies, show like heat indicators, and add collapse-all-replies toggle per thread',
            group: 'Comments',
            icon: 'message-square',
            pages: [PageTypes.WATCH],
            _styleElement: null,
            init() {
                const css = `
                    /* Creator/OP reply highlight */
                    ytd-comment-view-model[data-ytkit-creator],
                    ytd-comment-renderer[data-ytkit-creator] {
                        border-left: 3px solid rgba(255,69,58,0.6) !important;
                        background: rgba(255,69,58,0.03) !important;
                    }
                    ytd-comment-view-model[data-ytkit-creator] #author-text,
                    ytd-comment-renderer[data-ytkit-creator] #author-text {
                        color: #ff453a !important;
                    }
                    /* Like heat indicator */
                    .ytkit-heat-indicator {
                        display: inline-flex; align-items: center; gap: 3px;
                        font-size: 10px; padding: 1px 5px; border-radius: 3px;
                        margin-left: 4px; vertical-align: baseline;
                        font-weight: 600; letter-spacing: 0.02em;
                    }
                    .ytkit-heat-hot { color: #ef4444; background: rgba(239,68,68,0.1); }
                    .ytkit-heat-fire { color: #ff6b6b; background: rgba(255,107,107,0.12); text-shadow: 0 0 6px rgba(255,107,107,0.3); }
                `;
                this._styleElement = injectStyle(css, this.id, true);

                const processCommentEnhancements = () => {
                    // Detect channel name for OP detection
                    const channelEl = document.querySelector('#owner ytd-video-owner-renderer #channel-name a, ytd-video-owner-renderer #channel-name yt-formatted-string a');
                    const channelName = channelEl?.textContent?.trim() || '';

                    document.querySelectorAll('ytd-comment-view-model:not([data-ytkit-enhanced]), ytd-comment-renderer:not([data-ytkit-enhanced])').forEach(comment => {
                        comment.dataset.ytkitEnhanced = '1';

                        // Creator/OP detection
                        const authorEl = comment.querySelector('#author-text');
                        const authorName = authorEl?.textContent?.trim().replace(/^@/, '') || '';
                        const hasBadge = comment.querySelector('ytd-author-comment-badge-renderer');
                        if (hasBadge || (channelName && authorName && channelName.includes(authorName))) {
                            comment.dataset.ytkitCreator = '1';
                        }

                        // Like heat indicator
                        const voteEl = comment.querySelector('#vote-count-middle');
                        const voteText = voteEl?.textContent?.trim() || '';
                        if (voteText && voteText !== '0') {
                            let count = 0;
                            const lower = voteText.toLowerCase();
                            if (lower.includes('k')) count = parseFloat(lower) * 1000;
                            else if (lower.includes('m')) count = parseFloat(lower) * 1000000;
                            else count = parseInt(voteText.replace(/,/g, ''), 10) || 0;

                            if (count >= 1000) {
                                const heat = document.createElement('span');
                                heat.className = 'ytkit-heat-indicator';
                                if (count >= 10000) { heat.classList.add('ytkit-heat-fire'); heat.textContent = voteText; }
                                else { heat.classList.add('ytkit-heat-hot'); heat.textContent = voteText; }
                                const timeEl = comment.querySelector('#published-time-text, .published-time-text');
                                if (timeEl && !comment.querySelector('.ytkit-heat-indicator')) timeEl.after(heat);
                            }
                        }
                    });

                };

                addMutationRule(this.id, processCommentEnhancements);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove(); this._styleElement = null;
                document.querySelectorAll('[data-ytkit-enhanced]').forEach(el => delete el.dataset.ytkitEnhanced);
                document.querySelectorAll('[data-ytkit-creator]').forEach(el => delete el.dataset.ytkitCreator);
                document.querySelectorAll('.ytkit-heat-indicator').forEach(el => el.remove());
            }
        },
        cssFeature('hideLiveChatEngagement', 'Hide Chat Engagement', 'Remove engagement prompts in live chat', 'Live Chat', 'message-circle-off',
            'yt-live-chat-viewer-engagement-message-renderer,yt-live-chat-toast-renderer'),
        cssFeature('hidePaidPromotionWatch', 'Hide Paid Promotion', 'Remove "paid promotion" labels on watch pages', 'Watch Page', 'dollar-sign',
            '.ytp-paid-content-overlay'),
        cssFeature('hideChannelJoinButton', 'Hide Channel Join Button', 'Remove the Join/membership button on channel pages', 'Watch Page', 'dollar-sign',
            '.ytFlexibleActionsViewModelAction:has(button[aria-label="Join this channel"])'),
        {
            id: 'hideVideoEndContent',
            name: 'Hide Video End Content',
            description: 'Remove end cards, end screen, annotations, and video grid when videos finish. Superset of Hide End Screen Cards.',
            group: 'Video Player',
            icon: 'square-x',
            _styleElement: null,
            init() {
                const css = `
                    .ytp-ce-element, .ytp-ce-covering-overlay, .ytp-ce-element-shadow,
                    .ytp-ce-covering-image, .ytp-ce-expanding-image,
                    .ytp-ce-element.ytp-ce-video, .ytp-ce-element.ytp-ce-channel,
                    .ytp-ce-element.ytp-ce-playlist,
                    .ytp-endscreen-content,
                    div.ytp-fullscreen-grid-stills-container { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        cssFeature('hideFundraiser', 'Hide Fundraisers', 'Remove fundraiser and donation badges', 'Watch Page', 'heart-off',
            `ytd-donation-shelf-renderer,
                    ytd-button-renderer[button-next]:has([aria-label*="Donate"]),
                    .ytp-donation-shelf { display: none !important; }`),
        {
            id: 'hiddenChatElementsManager',
            name: 'Hide Chat Elements',
            description: 'Choose which live chat elements to hide',
            group: 'Live Chat',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _selectors: {
                header: 'yt-live-chat-header-renderer',
                menu: 'yt-live-chat-header-renderer #overflow',
                popout: 'yt-live-chat-header-renderer button[aria-label="Popout chat"]',
                reactions: 'yt-reaction-control-panel-overlay-view-model, yt-reaction-control-panel-view-model',
                timestamps: '#show-hide-button.ytd-live-chat-frame',
                polls: 'yt-live-chat-poll-renderer, yt-live-chat-banner-manager, yt-live-chat-action-panel-renderer:has(yt-live-chat-poll-renderer)',
                ticker: 'yt-live-chat-ticker-renderer',
                leaderboard: 'yt-live-chat-participant-list-renderer, yt-pdg-buy-flow-renderer',
                support: 'yt-live-chat-message-buy-flow-renderer, #product-picker, .yt-live-chat-message-input-renderer[id="picker-buttons"]',
                banner: 'yt-live-chat-banner-renderer',
                emoji: '#emoji-picker-button, yt-live-chat-message-input-renderer #picker-buttons yt-icon-button',
                topFan: 'yt-live-chat-author-badge-renderer[type="member"], yt-live-chat-author-badge-renderer[type="top-gifter"]',
                superChats: 'yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer',
                levelUp: 'yt-live-chat-viewer-engagement-message-renderer[engagement-type="VIEWER_ENGAGEMENT_MESSAGE_TYPE_LEVEL_UP"]'
            },
            init() {
                const hidden = appState.settings.hiddenChatElements || [];
                const selectors = hidden
                    .filter(key => key !== 'bots') // bots handled separately via mutation rule
                    .map(key => this._selectors[key])
                    .filter(Boolean)
                    .join(', ');

                if (selectors) {
                    this._styleElement = injectStyle(selectors, this.id);
                }

                // Bot filter uses mutation observer
                if (hidden.includes('bots')) {
                    addMutationRule('chatBotFilter', applyBotFilter);
                }
            },
            destroy() {
                this._styleElement?.remove();
                removeMutationRule('chatBotFilter');
            }
        },
                // Auto-generated Live Chat sub-features
        ...([['header','Chat Header','Hide the live chat header bar'],['menu','Chat Menu (...)','Hide the chat overflow menu'],['popout','Popout Button','Hide the popout chat button'],['reactions','Reactions','Hide chat reactions panel'],['timestamps','Timestamps','Hide chat timestamps'],['polls','Polls & Poll Banner','Hide polls in live chat'],['ticker','Super Chat Ticker','Hide the super chat ticker'],['leaderboard','Leaderboard','Hide chat leaderboard'],['support','Support Buttons','Hide support/buy buttons in chat'],['banner','Chat Banner','Hide chat banners'],['emoji','Emoji Button','Hide emoji picker button'],['topFan','Fan Badges','Hide fan/member badges'],['superChats','Super Chats','Hide super chat messages'],['levelUp','Level Up Messages','Hide level up messages'],['bots','Bot Messages','Filter out known bot messages']].map(([v,n,d])=>({id:'chatHide_'+v,name:n,description:d,group:'Live Chat',icon:'eye-off',isSubFeature:true,parentId:'hiddenChatElementsManager',_arrayKey:'hiddenChatElements',_arrayValue:v,init(){},destroy(){}}))),
                                                                                                                        {
            id: 'chatKeywordFilter',
            name: 'Chat Keyword Filter',
            description: 'Hide chat messages containing these words (comma-separated)',
            group: 'Live Chat',
            icon: 'filter',
            type: 'textarea',
            settingKey: 'chatKeywordFilter',
            init() { addMutationRule(this.id, applyKeywordFilter); },
            destroy() { removeMutationRule(this.id); }
        },
        {
            id: 'hiddenActionButtonsManager',
            name: 'Hide Action Buttons',
            description: 'Choose which action buttons to hide below videos',
            group: 'Watch Page',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _selectors: {
                like: 'ytd-segmented-like-dislike-button-renderer like-button-view-model, #segmented-like-button',
                dislike: 'ytd-segmented-like-dislike-button-renderer dislike-button-view-model, #segmented-dislike-button',
                share: 'ytd-watch-metadata button-view-model:has(button[aria-label="Share"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Share"])',
                ask: '#flexible-item-buttons yt-button-view-model:has(button[aria-label="Ask"]), ytd-watch-metadata button-view-model:has(button[aria-label*="AI"]), ytd-watch-metadata button-view-model:has(button[aria-label="Ask"]), conversational-ui-watch-metadata-button-view-model',
                clip: 'ytd-watch-metadata button-view-model:has(button[aria-label="Clip"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Clip"])',
                thanks: 'ytd-watch-metadata button-view-model:has(button[aria-label="Thanks"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Thanks"])',
                save: 'ytd-watch-metadata button-view-model:has(button[aria-label="Save to playlist"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Save"])',
                sponsor: '#sponsor-button',
                moreActions: '#actions-inner #button-shape > button[aria-label="More actions"]'
            },
            init() {
                const hidden = appState.settings.hiddenActionButtons || [];
                const selectors = hidden.map(key => this._selectors[key]).filter(Boolean).join(', ');
                if (selectors) {
                    this._styleElement = injectStyle(selectors, this.id);
                }
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
                // Auto-generated Action Buttons sub-features
        ...([['like','Like Button','Hide like button below videos'],['dislike','Dislike Button','Hide dislike button below videos'],['share','Share Button','Hide share button below videos'],['ask','Ask/AI Button','Hide Ask or AI button below videos'],['clip','Clip Button','Hide clip button below videos'],['thanks','Thanks Button','Hide thanks button below videos'],['save','Save Button','Hide save button below videos'],['sponsor','Join/Sponsor Button','Hide join/sponsor button below videos'],['moreActions','More Actions (...)','Hide more actions button below videos']].map(([v,n,d])=>({id:'abHide_'+v,name:n,description:d,group:'Watch Page',icon:'eye-off',isSubFeature:true,parentId:'hiddenActionButtonsManager',_arrayKey:'hiddenActionButtons',_arrayValue:v,init(){},destroy(){}}))),
                                                                        {
            id: 'replaceWithCobaltDownloader',
            name: 'Web Download Button',
            description: 'Add a web-based download button (Cobalt, y2mate, etc). Disabled by default when YTYT local download is enabled.',
            group: 'Downloads',
            icon: 'download',
            _styleElement: null,
            _providers: {
                'cobalt': 'https://cobalt.tools/#',
                'y2mate': 'https://www.y2mate.com/youtube/',
                'savefrom': 'https://en.savefrom.net/1-youtube-video-downloader-',
                'ssyoutube': 'https://ssyoutube.com/watch?v='
            },
            _getDownloadUrl(videoUrl) {
                const provider = appState.settings.downloadProvider || 'cobalt';
                const baseUrl = this._providers[provider] || this._providers['cobalt'];
                // Validate provider URL: must be HTTPS to prevent javascript:/file:// redirect
                try {
                    const parsed = new URL(typeof baseUrl === 'string' ? baseUrl : String(baseUrl));
                    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                        showToast('Invalid download provider URL — must be HTTP(S)', '#ef4444');
                        return null;
                    }
                } catch(e) {
                    showToast('Invalid download provider URL', '#ef4444');
                    return null;
                }
                if (provider === 'ssyoutube') {
                    const videoId = new URL(videoUrl).searchParams.get('v');
                    return baseUrl + videoId;
                }
                return baseUrl + encodeURIComponent(videoUrl);
            },
            _isWatchPage() { return window.location.pathname.startsWith('/watch'); },
            _injectButton() {
                if (!this._isWatchPage()) return;
                waitForElement('#actions-inner #end-buttons, #top-level-buttons-computed', (parent) => {
                    if (document.querySelector('button[id^="downloadBtn"]')) return;
                    const id = 'downloadBtn' + Math.random().toString(36).substr(2, 5);
                    const btn = document.createElement('button');
                    btn.id = id;
                    btn.textContent = 'Download';
                    btn.setAttribute('aria-label', 'Download video');
                    btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#ff5722;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                    btn.onmouseenter = () => { btn.style.background = '#e64a19'; };
                    btn.onmouseleave = () => { btn.style.background = '#ff5722'; };
                    btn.addEventListener('click', () => {
                        const videoUrl = window.location.href;
                        const downloadUrl = this._getDownloadUrl(videoUrl);
                        if (downloadUrl) window.open(downloadUrl, '_blank');
                    });
                    parent.appendChild(btn);
                });
            },
            init() {
                this._styleElement = injectStyle('ytd-download-button-renderer', 'hideNativeDownload');
                addNavigateRule('downloadButton', this._injectButton.bind(this));
            },
            destroy() {
                removeNavigateRule('downloadButton');
                document.querySelector('button[id^="downloadBtn"]')?.remove();
                this._styleElement?.remove();
            }
        },
        {
            id: 'hiddenPlayerControlsManager',
            name: 'Hide Player Controls',
            description: 'Choose which player control buttons to hide',
            group: 'Video Player',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _selectors: {
                ytLogo: '.ytp-youtube-button',
                settings: '.ytp-settings-button',
                next: '.ytp-next-button',
                autoplay: '.ytp-autonav-toggle-button-container',
                subtitles: '.ytp-subtitles-button',
                captions: '.caption-window',
                miniplayer: '.ytp-miniplayer-button',
                pip: '.ytp-pip-button',
                theater: '.ytp-size-button',
                fullscreen: '.ytp-fullscreen-button'
            },
            init() {
                const hidden = appState.settings.hiddenPlayerControls || [];
                const selectors = hidden.map(key => this._selectors[key]).filter(Boolean).join(', ');
                if (selectors) {
                    this._styleElement = injectStyle(selectors, this.id);
                }
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
                // Auto-generated Player Controls sub-features
        ...([['ytLogo','YouTube Logo','Hide YouTube logo from player controls'],['settings','Settings Gear','Hide settings gear from player controls'],['next','Next Video Button','Hide next video button from player'],['autoplay','Autoplay Toggle','Hide autoplay toggle from player'],['subtitles','Subtitles Button','Hide subtitles button from player'],['captions','Captions Display','Hide captions overlay on video'],['miniplayer','Miniplayer Button','Hide miniplayer button from player'],['pip','Picture-in-Picture','Hide PiP button from player'],['theater','Theater Mode Button','Hide theater mode button from player'],['fullscreen','Fullscreen Button','Hide fullscreen button from player']].map(([v,n,d])=>({id:'pcHide_'+v,name:n,description:d,group:'Video Player',icon:'eye-off',isSubFeature:true,parentId:'hiddenPlayerControlsManager',_arrayKey:'hiddenPlayerControls',_arrayValue:v,init(){},destroy(){}}))),
                                                                        // Individual player control features removed - now consolidated in hiddenPlayerControlsManager

        // ─── Downloads (YTYT-Downloader Integration) ───
        {
            id: 'downloadProvider',
            name: 'Download Provider',
            description: 'Choose which service to use for video downloads',
            group: 'Downloads',
            icon: 'download-cloud',
            type: 'select',
            options: {
                'cobalt': 'Cobalt (configurable)',
                'y2mate': 'Y2Mate',
                'savefrom': 'SaveFrom.net',
                'ssyoutube': 'SSYouTube'
            },
            _providers: {
                get cobalt() { return GM_getValue('ytkit_cobalt_url', 'https://cobalt.tools/#'); },
                'y2mate': 'https://www.y2mate.com/youtube/',
                'savefrom': 'https://en.savefrom.net/1-youtube-video-downloader-',
                'ssyoutube': 'https://ssyoutube.com/watch?v='
            },
            init() {
                // This is a config-only feature, the download button uses this setting
            },
            destroy() {}
        },
        {
            id: 'cobaltUrl',
            name: 'Cobalt Instance URL',
            description: 'Custom Cobalt API instance URL (Cobalt instances change frequently)',
            group: 'Downloads',
            icon: 'link',
            type: 'textarea',
            placeholder: 'https://cobalt.tools/#',
            init() {
                // Sync textarea value to GM storage for the download provider getter
                const val = appState.settings.cobaltUrl;
                if (val) {
                    // Validate: must be a valid HTTPS URL
                    try {
                        const u = new URL(val);
                        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
                            console.warn('[YTKit] Cobalt URL rejected: must be HTTP(S). Using default.');
                            return;
                        }
                        GM_setValue('ytkit_cobalt_url', val);
                    } catch(e) {
                        console.warn('[YTKit] Cobalt URL invalid, using default.');
                    }
                }
            },
            destroy() {
                GM_setValue('ytkit_cobalt_url', settingsManager.defaults.cobaltUrl || 'https://cobalt.tools/#');
            }
        },
        {
            id: 'hideCollaborations',
            name: 'Hide Collaborations',
            description: 'Hide videos from channels you\'re not subscribed to in your subscriptions feed',
            group: 'Content',
            icon: 'users-x',
            _subscriptions: [],
            _observer: null,
            _initialized: false,

            async _fetchSubscriptions() {
                try {
                    const response = await fetch('https://www.youtube.com/feed/channels');
                    const html = await response.text();
                    const dataMarker = 'ytInitialData = ';
                    let startIdx = html.indexOf(dataMarker);
                    if (startIdx === -1) return [];
                    let jsonStr = html.substring(startIdx + dataMarker.length);
                    const endIdx = jsonStr.indexOf('</script>');
                    if (endIdx === -1) return [];
                    jsonStr = jsonStr.substring(0, endIdx);
                    const start = jsonStr.indexOf('{');
                    const end = jsonStr.lastIndexOf('}');
                    const ytInitialData = JSON.parse(jsonStr.substring(start, end + 1));
                    const tabs = ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs;
                    if (!tabs || !tabs[0]) return [];
                    const sectionList = tabs[0]?.tabRenderer?.content?.sectionListRenderer;
                    if (!sectionList) return [];
                    const items = sectionList?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items;
                    if (!items) return [];
                    return items.map(({ channelRenderer }) => {
                        if (!channelRenderer) return null;
                        const title = channelRenderer?.title?.simpleText;
                        const navUrl = channelRenderer?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ||
                                       channelRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
                        const handle = navUrl.startsWith('/@') ? navUrl.slice(1) : navUrl.replace(/^\//, '');
                        return { title, handle };
                    }).filter(s => s && s.title);
                } catch (e) {
                    console.error('[YTKit] Failed to fetch subscriptions:', e);
                    return [];
                }
            },

            _isSubscribed(channel) {
                if (!channel) return true;
                if (channel.startsWith('@')) {
                    return this._subscriptions.some(s => s.handle === channel);
                }
                return this._subscriptions.some(s => s.title === channel);
            },

            _validateFeedCard(cardNode) {
                if (cardNode.tagName !== 'YTD-ITEM-SECTION-RENDERER') return;
                const channelLink = cardNode.querySelector('ytd-shelf-renderer #title-container a[title]');
                if (!channelLink) return;
                const title = channelLink.getAttribute('title');
                const handle = channelLink.getAttribute('href')?.slice(1);
                if (!this._isSubscribed(title) && !this._isSubscribed(handle)) {
                    DebugManager.log('Content', 'Hiding collaboration from:', title);
                    cardNode.remove();
                }
            },

            async init() {
                if (window.location.pathname !== '/feed/subscriptions') return;
                if (!this._initialized) {
                    this._subscriptions = await this._fetchSubscriptions();
                    this._initialized = true;
                    DebugManager.log('Content', `Loaded ${this._subscriptions.length} subscriptions`);
                }
                if (this._subscriptions.length === 0) return;

                // Process existing items
                document.querySelectorAll('ytd-item-section-renderer').forEach(card => this._validateFeedCard(card));

                // Watch for new items
                const feedSelector = 'ytd-section-list-renderer > div#contents';
                const feed = document.querySelector(feedSelector);
                if (feed) {
                    this._observer = new MutationObserver((mutations) => {
                        for (const m of mutations) {
                            if (m.type === 'childList' && m.addedNodes.length > 0) {
                                m.addedNodes.forEach(node => {
                                    if (node.nodeType === 1) this._validateFeedCard(node);
                                });
                            }
                        }
                    });
                    this._observer.observe(feed, { childList: true });
                }

                // Re-run on navigation
                addNavigateRule(this.id, () => {
                    if (window.location.pathname === '/feed/subscriptions') {
                        setTimeout(() => {
                            document.querySelectorAll('ytd-item-section-renderer').forEach(card => this._validateFeedCard(card));
                        }, 1000);
                    }
                });
            },

            destroy() {
                this._observer?.disconnect();
                removeNavigateRule(this.id);
            }
        },
        // ═══════════════════════════════════════════════════════════════════
        //  VIDEO HIDER — Hide videos/channels from feeds
        // ═══════════════════════════════════════════════════════════════════
        {
            id: 'hideVideosFromHome',
            name: 'Video Hider',
            description: 'Hide videos/channels from feeds. Includes keyword filter, duration filter, and channel blocking.',
            group: 'Content',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _observer: null,
            _toastTimeout: null,
            _lastHidden: null,
            _STORAGE_KEY: 'ytkit-hidden-videos',
            _CHANNELS_KEY: 'ytkit-blocked-channels',
            _hiddenSet: null,
            _hiddenList: null,
            _channelsCache: null,
            _subsLoadState: {
                consecutiveHiddenBatches: 0,
                lastBatchSize: 0,
                lastBatchHidden: 0,
                loadingBlocked: false,
                totalVideosLoaded: 0,
                totalVideosHidden: 0
            },

            _resetSubsLoadState() {
                this._subsLoadState = {
                    consecutiveHiddenBatches: 0,
                    lastBatchSize: 0,
                    lastBatchHidden: 0,
                    loadingBlocked: false,
                    totalVideosLoaded: 0,
                    totalVideosHidden: 0
                };
                this._removeLoadBlocker();
            },

            _blockSubsLoading() {
                if (this._subsLoadState.loadingBlocked) return;
                this._subsLoadState.loadingBlocked = true;
                if (this._clearBatchBuffer) this._clearBatchBuffer();
                const continuations = document.querySelectorAll('ytd-continuation-item-renderer, #continuations, ytd-browse[page-subtype="subscriptions"] ytd-continuation-item-renderer');
                continuations.forEach(cont => {
                    if (!(cont instanceof HTMLElement)) return;
                    cont.style.display = 'none';
                    cont.dataset.ytkitBlocked = 'true';
                });
                this._showLoadBlockedBanner();
                DebugManager.log('VideoHider', 'Subscription loading blocked - too many consecutive hidden batches');
            },

            _removeLoadBlocker() {
                this._subsLoadState.loadingBlocked = false;
                document.querySelectorAll('[data-ytkit-blocked="true"]').forEach(el => {
                    if (!(el instanceof HTMLElement)) return;
                    el.style.display = '';
                    delete el.dataset.ytkitBlocked;
                });
                document.getElementById('ytkit-subs-load-banner')?.remove();
            },

            _showLoadBlockedBanner() {
                if (document.getElementById('ytkit-subs-load-banner')) return;
                const banner = document.createElement('div');
                banner.id = 'ytkit-subs-load-banner';
                banner.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:12px;padding:16px 24px;display:flex;align-items:center;gap:16px;z-index:' + Z.BANNER + ';box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:"Roboto",Arial,sans-serif;max-width:600px;';

                const icon = document.createElement('div');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
                svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', '#f59e0b'); svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '10');
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '12'); line1.setAttribute('y1', '8'); line1.setAttribute('x2', '12'); line1.setAttribute('y2', '12');
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '12'); line2.setAttribute('y1', '16'); line2.setAttribute('x2', '12.01'); line2.setAttribute('y2', '16');
                svg.appendChild(circle); svg.appendChild(line1); svg.appendChild(line2);
                icon.appendChild(svg);

                const textContainer = document.createElement('div');
                textContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;';
                const title = document.createElement('div');
                title.style.cssText = 'color:#f1f5f9;font-size:14px;font-weight:600;';
                title.textContent = 'Infinite scroll stopped';
                const subtitle = document.createElement('div');
                subtitle.style.cssText = 'color:#94a3b8;font-size:12px;';
                subtitle.textContent = `${this._subsLoadState.totalVideosHidden} of ${this._subsLoadState.totalVideosLoaded} videos were hidden. Stopped loading to prevent performance issues.`;
                textContainer.appendChild(title); textContainer.appendChild(subtitle);

                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = 'display:flex;gap:8px;';
                const resumeBtn = document.createElement('button');
                resumeBtn.textContent = 'Load More';
                resumeBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:none;background:#3b82f6;color:white;font-size:13px;font-weight:500;cursor:pointer;transition:background 0.2s;';
                resumeBtn.onmouseenter = () => { resumeBtn.style.background = '#2563eb'; };
                resumeBtn.onmouseleave = () => { resumeBtn.style.background = '#3b82f6'; };
                resumeBtn.onclick = () => {
                    this._subsLoadState.consecutiveHiddenBatches = 0;
                    this._removeLoadBlocker();
                    window.scrollBy(0, 100);
                    setTimeout(() => window.scrollBy(0, -100), 100);
                };
                const dismissBtn = document.createElement('button');
                dismissBtn.textContent = '\u2715';
                dismissBtn.title = 'Dismiss';
                dismissBtn.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94a3b8;font-size:14px;cursor:pointer;transition:all 0.2s;';
                dismissBtn.onmouseenter = () => { dismissBtn.style.background = '#1e293b'; dismissBtn.style.color = '#f1f5f9'; };
                dismissBtn.onmouseleave = () => { dismissBtn.style.background = 'transparent'; dismissBtn.style.color = '#94a3b8'; };
                dismissBtn.onclick = () => banner.remove();
                buttonContainer.appendChild(resumeBtn); buttonContainer.appendChild(dismissBtn);
                banner.appendChild(icon); banner.appendChild(textContainer); banner.appendChild(buttonContainer);
                document.body.appendChild(banner);
            },

            _trackSubsLoadBatch(processedVideos) {
                if (window.location.pathname !== '/feed/subscriptions') return;
                if (!appState.settings.hideVideosSubsLoadLimit) return;
                if (this._subsLoadState.loadingBlocked) return;
                const hiddenCount = processedVideos.filter(v => v.hidden).length;
                const batchSize = processedVideos.length;
                if (batchSize === 0) return;
                this._subsLoadState.totalVideosLoaded += batchSize;
                this._subsLoadState.totalVideosHidden += hiddenCount;
                this._subsLoadState.lastBatchSize = batchSize;
                this._subsLoadState.lastBatchHidden = hiddenCount;
                const allHidden = hiddenCount === batchSize;
                const threshold = appState.settings.hideVideosSubsLoadThreshold || 3;
                if (allHidden) {
                    this._subsLoadState.consecutiveHiddenBatches++;
                    DebugManager.log('VideoHider', `Subs load: batch ${this._subsLoadState.consecutiveHiddenBatches}/${threshold} all hidden (${hiddenCount}/${batchSize})`);
                    if (this._subsLoadState.consecutiveHiddenBatches >= threshold) this._blockSubsLoading();
                } else {
                    this._subsLoadState.consecutiveHiddenBatches = 0;
                }
            },

            _getHiddenVideos() {
                if (this._hiddenList === null) {
                    try { this._hiddenList = GM_getValue(this._STORAGE_KEY, []); }
                    catch(e) { const s = localStorage.getItem(this._STORAGE_KEY); this._hiddenList = s ? JSON.parse(s) : []; }
                    this._hiddenSet = new Set(this._hiddenList);
                }
                return this._hiddenList;
            },
            _isVideoIdHidden(videoId) {
                if (this._hiddenSet === null) this._getHiddenVideos();
                return this._hiddenSet.has(videoId);
            },
            _setHiddenVideos(videos) {
                this._hiddenList = videos;
                this._hiddenSet = new Set(videos);
                try { GM_setValue(this._STORAGE_KEY, videos); }
                catch(e) { localStorage.setItem(this._STORAGE_KEY, JSON.stringify(videos)); }
            },
            _getBlockedChannels() {
                if (this._channelsCache === null) {
                    try { this._channelsCache = GM_getValue(this._CHANNELS_KEY, []); }
                    catch(e) { const s = localStorage.getItem(this._CHANNELS_KEY); this._channelsCache = s ? JSON.parse(s) : []; }
                }
                return this._channelsCache;
            },
            _setBlockedChannels(channels) {
                this._channelsCache = channels;
                try { GM_setValue(this._CHANNELS_KEY, channels); }
                catch(e) { localStorage.setItem(this._CHANNELS_KEY, JSON.stringify(channels)); }
            },

            _extractVideoId(element) {
                const lockup = element.querySelector('.yt-lockup-view-model[class*="content-id-"]');
                if (lockup) { const m = lockup.className.match(/content-id-([a-zA-Z0-9_-]+)/); if (m) return m[1]; }
                const links = element.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]');
                for (const link of links) {
                    const watchMatch = link.href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
                    if (watchMatch) return watchMatch[1];
                    const shortsMatch = link.href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
                    if (shortsMatch) return shortsMatch[1];
                }
                const vidEl = element.querySelector('[data-video-id]');
                return vidEl ? vidEl.getAttribute('data-video-id') : null;
            },

            _extractChannelInfo(element) {
                const channelLink = element.querySelector('a[href*="/@"], a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"]');
                if (!channelLink) return null;
                const href = channelLink.href;
                let channelId = null;
                const handleMatch = href.match(/\/@([^/?]+)/);
                if (handleMatch) channelId = '@' + handleMatch[1];
                else {
                    const idMatch = href.match(/\/(channel|c|user)\/([^/?]+)/);
                    if (idMatch) channelId = idMatch[2];
                }
                const channelName = element.querySelector('#channel-name a, .ytd-channel-name a, [id="text"] a')?.textContent?.trim() ||
                                   element.querySelector('#channel-name, .ytd-channel-name')?.textContent?.trim() || channelId;
                return channelId ? { id: channelId, name: channelName } : null;
            },

            _extractDuration(element) {
                const badge = element.querySelector('ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer, [aria-label*=":"]');
                if (!badge) return 0;
                const text = badge.textContent?.trim() || badge.getAttribute('aria-label') || '';
                const match = text.match(/(\d+):(\d+):?(\d+)?/);
                if (!match) return 0;
                if (match[3]) return parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]);
                return parseInt(match[1])*60 + parseInt(match[2]);
            },

            _extractTitle(element) {
                return element.querySelector('#video-title, .title, [id="video-title"]')?.textContent?.trim()?.toLowerCase() || '';
            },

            _findThumbnailContainer(element) {
                const selectors = ['a.yt-lockup-view-model__content-image', 'yt-thumbnail-view-model', '#thumbnail', 'ytd-thumbnail'];
                for (const sel of selectors) { const c = element.querySelector(sel); if (c) return c; }
                return null;
            },

            _createSVG(pathD) {
                const svg = createSVG('0 0 24 24', [{ type: 'path', d: pathD, fill: 'currentColor' }], { fill: 'currentColor', stroke: false });
                svg.setAttribute('width', '14');
                svg.setAttribute('height', '14');
                return svg;
            },

            _createHideButton() {
                const btn = document.createElement('button');
                btn.className = 'ytkit-video-hide-btn';
                btn.title = 'Hide this video (right-click to block channel)';
                btn.appendChild(this._createSVG('M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'));
                return btn;
            },

            _showToast(message, buttons = []) {
                document.getElementById('ytkit-hide-toast')?.remove();
                if (this._toastTimeout) clearTimeout(this._toastTimeout);
                const primaryAction = buttons[0];
                showToast(message, '#6b7280', {
                    duration: 5,
                    action: primaryAction ? { text: primaryAction.text, onClick: primaryAction.onClick } : undefined
                });
            },

            _hideVideo(videoId, element) {
                const hidden = this._getHiddenVideos();
                if (!hidden.includes(videoId)) { hidden.push(videoId); this._setHiddenVideos(hidden); }
                element.classList.add('ytkit-video-hidden');
                this._lastHidden = { type: 'video', id: videoId, element };
                this._showToast('Video hidden', [
                    { text: 'Undo', onClick: () => this._undoHide() },
                    { text: 'Manage', onClick: () => this._showManager() }
                ]);
            },

            _blockChannel(channelInfo, element) {
                if (!channelInfo) return;
                const channels = this._getBlockedChannels();
                if (!channels.find(c => c.id === channelInfo.id)) {
                    channels.push(channelInfo);
                    this._setBlockedChannels(channels);
                }
                this._hideChannelVideos(channelInfo.id);
                this._lastHidden = { type: 'channel', info: channelInfo };
                this._showToast(`Blocked: ${channelInfo.name}`, [
                    { text: 'Undo', onClick: () => this._undoHide() },
                    { text: 'Manage', onClick: () => this._showManager() }
                ]);
            },

            _hideChannelVideos(channelId) {
                document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer').forEach(el => {
                    const info = this._extractChannelInfo(el);
                    if (info && info.id === channelId) el.classList.add('ytkit-video-hidden');
                });
            },

            _undoHide() {
                if (!this._lastHidden) return;
                if (this._lastHidden.type === 'video') {
                    const hidden = this._getHiddenVideos();
                    const idx = hidden.indexOf(this._lastHidden.id);
                    if (idx > -1) { hidden.splice(idx, 1); this._setHiddenVideos(hidden); }
                    this._lastHidden.element?.classList.remove('ytkit-video-hidden');
                } else if (this._lastHidden.type === 'channel') {
                    const channels = this._getBlockedChannels();
                    const idx = channels.findIndex(c => c.id === this._lastHidden.info.id);
                    if (idx > -1) { channels.splice(idx, 1); this._setBlockedChannels(channels); }
                    this._processAllVideos();
                }
                this._lastHidden = null;
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
            },

            _unhideVideo(videoId) {
                const hidden = this._getHiddenVideos();
                const idx = hidden.indexOf(videoId);
                if (idx > -1) {
                    hidden.splice(idx, 1);
                    this._setHiddenVideos(hidden);
                    document.querySelectorAll(`[data-ytkit-video-id="${videoId}"]`)?.forEach(el => {
                        el.classList.remove('ytkit-video-hidden');
                    });
                    this._processAllVideos();
                    return true;
                }
                return false;
            },

            _showManager() {
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
                document.body.classList.add('ytkit-panel-open');
                setTimeout(() => {
                    const navBtn = document.querySelector('.ytkit-nav-btn[data-tab="Video-Hider"]');
                    if (navBtn) navBtn.click();
                }, 100);
            },

            _shouldHide(element) {
                const videoId = this._extractVideoId(element);
                if (videoId && this._isVideoIdHidden(videoId)) return true;
                const channelInfo = this._extractChannelInfo(element);
                if (channelInfo && this._getBlockedChannels().find(c => c.id === channelInfo.id)) return true;

                const filterStr = (appState.settings.hideVideosKeywordFilter || '').trim();
                if (filterStr) {
                    const title = this._extractTitle(element);
                    const channelName = channelInfo?.name?.toLowerCase() || '';
                    const searchText = (title + ' ' + channelName).toLowerCase();

                    if (filterStr.startsWith('/')) {
                        try {
                            const regexMatch = filterStr.match(/^\/(.+)\/([gimsuy]*)$/);
                            if (regexMatch) {
                                // Reject patterns with nested quantifiers (ReDoS risk)
                                if (/([+*?]|\{\d+,?\d*\})\s*[+*?]|\(\?[^)]*[+*]/.test(regexMatch[1])) {
                                    DebugManager.log('VideoHider', 'Regex rejected: nested quantifiers (ReDoS risk)');
                                } else {
                                    const regex = new RegExp(regexMatch[1], regexMatch[2]);
                                    if (regex.test(title) || regex.test(channelName)) return true;
                                }
                            }
                        } catch (e) {
                            DebugManager.log('VideoHider', 'Invalid regex pattern', e.message);
                        }
                    } else {
                        const keywords = filterStr.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
                        const positiveKw = keywords.filter(k => !k.startsWith('!'));
                        const negativeKw = keywords.filter(k => k.startsWith('!')).map(k => k.slice(1));
                        if (negativeKw.length && negativeKw.some(k => searchText.includes(k))) return false;
                        if (positiveKw.length && positiveKw.some(k => searchText.includes(k))) return true;
                    }
                }

                const minDuration = (appState.settings.hideVideosDurationFilter || 0) * 60;
                if (minDuration > 0) {
                    const duration = this._extractDuration(element);
                    if (duration > 0 && duration < minDuration) return true;
                }
                return false;
            },

            _processVideoElement(element) {
                const alreadyProcessed = !!element.dataset.ytkitHideProcessed;
                element.dataset.ytkitHideProcessed = 'true';
                const videoId = this._extractVideoId(element);
                if (videoId) element.dataset.ytkitVideoId = videoId;
                if (!alreadyProcessed) {
                    if (this._shouldHide(element)) { element.classList.add('ytkit-video-hidden'); }
                    else { element.classList.remove('ytkit-video-hidden'); }
                }
                const thumbnail = this._findThumbnailContainer(element);
                if (!thumbnail || thumbnail.querySelector('.ytkit-video-hide-btn')) return;
                if (window.getComputedStyle(thumbnail).position === 'static') thumbnail.style.position = 'relative';
                const btn = this._createHideButton();
                const channelInfo = this._extractChannelInfo(element);
                btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (videoId) this._hideVideo(videoId, element); });
                btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (channelInfo) this._blockChannel(channelInfo, element); });
                thumbnail.appendChild(btn);
            },

            _processVideoElementWithResult(element) {
                const alreadyProcessed = !!element.dataset.ytkitHideProcessed;
                element.dataset.ytkitHideProcessed = 'true';
                const videoId = this._extractVideoId(element);
                if (videoId) element.dataset.ytkitVideoId = videoId;
                let shouldHide;
                if (alreadyProcessed) {
                    shouldHide = element.classList.contains('ytkit-video-hidden');
                } else {
                    shouldHide = this._shouldHide(element);
                    if (shouldHide) { element.classList.add('ytkit-video-hidden'); }
                    else { element.classList.remove('ytkit-video-hidden'); }
                }
                const thumbnail = this._findThumbnailContainer(element);
                if (thumbnail && !thumbnail.querySelector('.ytkit-video-hide-btn')) {
                    if (window.getComputedStyle(thumbnail).position === 'static') thumbnail.style.position = 'relative';
                    const btn = this._createHideButton();
                    const channelInfo = this._extractChannelInfo(element);
                    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (videoId) this._hideVideo(videoId, element); });
                    btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (channelInfo) this._blockChannel(channelInfo, element); });
                    thumbnail.appendChild(btn);
                }
                return shouldHide;
            },

            _processAllDebounceTimer: null,
            _processAllVideos() {
                // Clear pending batch to prevent race with MutationObserver
                this._clearBatchBuffer?.();
                document.querySelectorAll('[data-ytkit-hide-processed]').forEach(el => { delete el.dataset.ytkitHideProcessed; });
                document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer')
                    .forEach(el => this._processVideoElement(el));
            },
            _processAllVideosDebounced(delay = 300) {
                if (this._processAllDebounceTimer) clearTimeout(this._processAllDebounceTimer);
                this._processAllDebounceTimer = setTimeout(() => {
                    this._processAllDebounceTimer = null;
                    this._processAllVideos();
                }, delay);
            },

            _getVisibleVideos() {
                const videos = [];
                const selectors = ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer'];
                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(item => {
                        if (item.classList.contains('ytkit-video-hidden')) return;
                        const videoId = this._extractVideoId(item);
                        if (videoId) videos.push({ id: videoId, element: item });
                    });
                });
                return videos;
            },

            _hideAllVideos() {
                const videos = this._getVisibleVideos();
                if (videos.length === 0) { showToast('No visible videos to hide', '#6b7280'); return; }
                const hidden = this._getHiddenVideos();
                let newlyHidden = 0;
                videos.forEach(v => {
                    if (!hidden.includes(v.id)) { hidden.push(v.id); newlyHidden++; }
                    v.element.classList.add('ytkit-video-hidden');
                });
                this._setHiddenVideos(hidden);
                this._showToast(`Hidden ${newlyHidden} videos`, [
                    { text: 'Undo All', onClick: () => this._undoHideAll(videos) },
                    { text: 'Manage', onClick: () => this._showManager() }
                ]);
            },

            _undoHideAll(videos) {
                const hidden = this._getHiddenVideos();
                videos.forEach(v => {
                    const idx = hidden.indexOf(v.id);
                    if (idx > -1) hidden.splice(idx, 1);
                    v.element.classList.remove('ytkit-video-hidden');
                });
                this._setHiddenVideos(hidden);
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
                showToast('Restored all videos', '#22c55e');
            },

            _createHideAllButtonElement(className) {
                const ns = 'http://www.w3.org/2000/svg';
                const createSvgElement = (tag, attrs) => {
                    const el = document.createElementNS(ns, tag);
                    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                    return el;
                };
                const hideAllBtn = document.createElement('button');
                hideAllBtn.className = className;
                hideAllBtn.title = 'Hide all visible videos on this page';
                const svg = createSvgElement('svg', { viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
                svg.appendChild(createSvgElement('path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' }));
                svg.appendChild(createSvgElement('line', { x1: '1', y1: '1', x2: '23', y2: '23' }));
                hideAllBtn.appendChild(svg);
                const text = document.createElement('span');
                text.textContent = 'Hide All';
                hideAllBtn.appendChild(text);
                hideAllBtn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:20px;border:none;background:#dc2626;color:white;font-family:"Roboto",Arial,sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;';
                hideAllBtn.onmouseenter = () => { hideAllBtn.style.background = '#b91c1c'; };
                hideAllBtn.onmouseleave = () => { hideAllBtn.style.background = '#dc2626'; };
                hideAllBtn.addEventListener('click', () => this._hideAllVideos());
                return hideAllBtn;
            },

            _createSubsHideAllButton() {
                if (document.querySelector('.ytkit-subs-hide-all-btn')) return;
                if (window.location.pathname !== '/feed/subscriptions') return;
                const headerButtons = document.querySelector('#masthead #end #buttons');
                if (!headerButtons) return;
                const hideAllBtn = this._createHideAllButtonElement('ytkit-subs-hide-all-btn');
                const vlcBtn = headerButtons.querySelector('.ytkit-subs-vlc-btn');
                if (vlcBtn) headerButtons.insertBefore(hideAllBtn, vlcBtn);
                else headerButtons.appendChild(hideAllBtn);
            },

            _removeSubsHideAllButton() {
                document.querySelector('.ytkit-subs-hide-all-btn')?.remove();
            },

            _createHomeHideAllButton() {
                if (document.querySelector('.ytkit-home-hide-all-btn')) return;
                if (window.location.pathname !== '/') return;
                const headerButtons = document.querySelector('#masthead #end #buttons');
                if (!headerButtons) return;
                const hideAllBtn = this._createHideAllButtonElement('ytkit-home-hide-all-btn');
                const vlcBtn = headerButtons.querySelector('.ytkit-subs-vlc-btn');
                if (vlcBtn) headerButtons.insertBefore(hideAllBtn, vlcBtn);
                else headerButtons.appendChild(hideAllBtn);
            },

            _removeHomeHideAllButton() {
                document.querySelector('.ytkit-home-hide-all-btn')?.remove();
            },

            init() {
                const css = `
                    .ytkit-video-hide-btn { position:absolute;top:8px;right:8px;width:28px;height:28px;background:rgba(0,0,0,0.8);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:${Z.HIDE_BTN};opacity:0;transition:all 0.15s;padding:0;color:#fff; }
                    .ytkit-video-hide-btn:hover { background:rgba(200,0,0,0.9);transform:scale(1.1); }
                    .ytkit-video-hide-btn svg { width:16px;height:16px;fill:#fff;pointer-events:none; }
                    ytd-rich-item-renderer:hover .ytkit-video-hide-btn, ytd-video-renderer:hover .ytkit-video-hide-btn, ytd-grid-video-renderer:hover .ytkit-video-hide-btn, ytd-compact-video-renderer:hover .ytkit-video-hide-btn { opacity:1; }
                    .ytkit-video-hidden { display:none !important; }
                    #ytkit-hide-toast { position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(100px);background:#323232;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;z-index:${Z.TOAST};opacity:0;transition:all 0.3s;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3); }
                    #ytkit-hide-toast.show { transform:translateX(-50%) translateY(0);opacity:1; }
                    #ytkit-hide-toast button { background:transparent;border:none;color:#3ea6ff;cursor:pointer;font-size:14px;font-weight:500;padding:4px 8px;border-radius:4px; }
                    #ytkit-hide-toast button:hover { background:rgba(62,166,255,0.1); }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                this._processAllVideos();
                const selectors = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer';

                let batchBuffer = [];
                let batchTimeout = null;
                this._clearBatchBuffer = () => {
                    batchBuffer = [];
                    if (batchTimeout) { clearTimeout(batchTimeout); batchTimeout = null; }
                };

                const processBatch = () => {
                    if (batchBuffer.length > 0 && !this._subsLoadState.loadingBlocked) {
                        this._trackSubsLoadBatch(batchBuffer);
                        batchBuffer = [];
                    }
                };

                this._observer = new MutationObserver(mutations => {
                    for (const m of mutations) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType !== 1) continue;
                            if (node.matches?.(selectors)) {
                                const wasHidden = this._processVideoElementWithResult(node);
                                batchBuffer.push({ element: node, hidden: wasHidden });
                            }
                            node.querySelectorAll?.(selectors).forEach(el => {
                                const wasHidden = this._processVideoElementWithResult(el);
                                batchBuffer.push({ element: el, hidden: wasHidden });
                            });
                        }
                    }
                    if (batchTimeout) clearTimeout(batchTimeout);
                    batchTimeout = setTimeout(processBatch, 300);
                });
                const observeTarget = document.querySelector('ytd-app') || document.body;
                this._observer.observe(observeTarget, { childList: true, subtree: true });

                let wasOnSubsPage = window.location.pathname === '/feed/subscriptions';
                const checkPages = () => {
                    const path = window.location.pathname;
                    const isOnSubsPage = path === '/feed/subscriptions';
                    const isOnHomePage = path === '/';
                    if (isOnSubsPage) {
                        if (!wasOnSubsPage) this._resetSubsLoadState();
                        setTimeout(() => this._createSubsHideAllButton(), 1000);
                    } else {
                        this._removeSubsHideAllButton();
                        this._removeLoadBlocker();
                    }
                    if (isOnHomePage) {
                        setTimeout(() => this._createHomeHideAllButton(), 1000);
                    } else {
                        this._removeHomeHideAllButton();
                    }
                    wasOnSubsPage = isOnSubsPage;
                };

                addNavigateRule('hideVideosFromHomeNav', () => {
                    this._processAllVideosDebounced(500);
                    checkPages();
                });
                checkPages();

                // Filter chip clicks (e.g. "Recently uploaded") replace grid content
                // without firing yt-navigate-finish. Detect and reprocess after DOM settles.
                this._chipClickHandler = (e) => {
                    const chip = e.target.closest('yt-chip-cloud-chip-renderer, ytd-feed-filter-chip-bar-renderer yt-formatted-string');
                    if (chip) {
                        this._processAllVideosDebounced(800);
                        // Second pass for late-rendering thumbnails
                        setTimeout(() => this._processAllVideosDebounced(300), 1500);
                    }
                };
                document.addEventListener('click', this._chipClickHandler, true);

                DebugManager.log('VideoHider', 'Initialized:', this._getHiddenVideos().length, 'videos,', this._getBlockedChannels().length, 'channels');
            },

            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                this._clearBatchBuffer?.();
                if (this._chipClickHandler) { document.removeEventListener('click', this._chipClickHandler, true); this._chipClickHandler = null; }
                if (this._processAllDebounceTimer) { clearTimeout(this._processAllDebounceTimer); this._processAllDebounceTimer = null; }
                removeNavigateRule('hideVideosFromHomeNav');
                document.querySelectorAll('.ytkit-video-hide-btn').forEach(b => b.remove());
                document.querySelectorAll('.ytkit-video-hidden').forEach(e => e.classList.remove('ytkit-video-hidden'));
                document.querySelectorAll('[data-ytkit-hide-processed]').forEach(e => delete e.dataset.ytkitHideProcessed);
                document.getElementById('ytkit-hide-toast')?.remove();
                this._removeSubsHideAllButton();
                this._removeHomeHideAllButton();
                this._removeLoadBlocker();
            }
        },
        {
            id: 'showVlcButton',
            name: 'VLC Player Button',
            description: 'Add button to stream video directly in VLC media player',
            group: 'Downloads',
            icon: 'play-circle',
            isParent: true,
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-vlc-btn';
                btn.title = 'Stream in VLC Player (requires YTYT-Downloader)';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z');
                path.setAttribute('fill', 'white');
                svg.appendChild(path);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' VLC'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#f97316;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#ea580c'; };
                btn.onmouseleave = () => { btn.style.background = '#f97316'; };
                btn.addEventListener('click', () => {
                    showToast('🎬 Sending to VLC...', '#f97316');
                    openProtocol('ytvlc://' + encodeURIComponent(window.location.href), 'VLC protocol handler not found. Install YTYT-Downloader.');
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('vlcButton', '#top-level-buttons-computed', '.ytkit-vlc-btn', this._createButton.bind(this), 'VLC');
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('vlcButton');
                document.querySelector('.ytkit-vlc-btn')?.remove();
            }
        },
        {
            id: 'showLocalDownloadButton',
            name: 'Local Download Button',
            description: 'Add button to download video locally via yt-dlp',
            group: 'Downloads',
            icon: 'hard-drive-download',
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-local-dl-btn';
                btn.title = 'Download to PC (requires YTYT-Downloader)';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z');
                path.setAttribute('fill', 'white');
                svg.appendChild(path);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' DL'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#22c55e;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#16a34a'; };
                btn.onmouseleave = () => { btn.style.background = '#22c55e'; };
                btn.addEventListener('click', () => {
                    ytKitDownload(window.location.href, false);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('localDownloadButton', '#top-level-buttons-computed', '.ytkit-local-dl-btn', this._createButton.bind(this), 'Download');
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('localDownloadButton');
                document.querySelector('.ytkit-local-dl-btn')?.remove();
            }
        },
        {
            id: 'showMp3DownloadButton',
            name: 'MP3 Download Button',
            description: 'Add button to download audio as MP3 via yt-dlp',
            group: 'Downloads',
            icon: 'music',
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-mp3-dl-btn';
                btn.title = 'Download MP3 (requires YTYT-Downloader)';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z');
                path.setAttribute('fill', 'white');
                svg.appendChild(path);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' MP3'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#8b5cf6;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#7c3aed'; };
                btn.onmouseleave = () => { btn.style.background = '#8b5cf6'; };
                btn.addEventListener('click', () => {
                    ytKitDownload(window.location.href, true);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('mp3DownloadButton', '#top-level-buttons-computed', '.ytkit-mp3-dl-btn', this._createButton.bind(this), 'MP3');
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('mp3DownloadButton');
                document.querySelector('.ytkit-mp3-dl-btn')?.remove();
            }
        },
        {
            id: 'videoContextMenu',
            name: 'Video Context Menu',
            description: 'Right-click on video player for quick download options (video, audio, transcript)',
            group: 'Downloads',
            icon: 'menu',
            _menu: null,
            _styleElement: null,
            _contextHandler: null,
            _clickHandler: null,

            _injectStyles() {
                if (this._styleElement) return;

                this._styleElement = document.createElement('style');
                this._styleElement.id = 'ytkit-context-menu-styles';
                this._styleElement.textContent = `.ytkit-context-menu{position:fixed;z-index:${Z.CONTEXT_MENU};background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:6px 0;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:"Roboto",Arial,sans-serif;font-size:14px;animation:ytkit-menu-fade 0.15s ease-out;} @keyframes ytkit-menu-fade{from{opacity:0;transform:scale(0.95);} to{opacity:1;transform:scale(1);} } .ytkit-context-menu-header{padding:8px 14px;color:#888;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;margin-bottom:4px;} .ytkit-context-menu-item{display:flex;align-items:center;gap:12px;padding:10px 14px;color:#e0e0e0;cursor:pointer;transition:background 0.1s;} .ytkit-context-menu-item:hover{background:#2d2d44;} .ytkit-context-menu-item svg{width:18px;height:18px;flex-shrink:0;} .ytkit-context-menu-item.ytkit-item-video svg{color:#22c55e;} .ytkit-context-menu-item.ytkit-item-audio svg{color:#8b5cf6;} .ytkit-context-menu-item.ytkit-item-transcript svg{color:#3b82f6;} .ytkit-context-menu-item.ytkit-item-vlc svg{color:#f97316;} .ytkit-context-menu-item.ytkit-item-mpv svg{color:#ec4899;} .ytkit-context-menu-item.ytkit-item-embed svg{color:#06b6d4;} .ytkit-context-menu-item.ytkit-item-copy svg{color:#fbbf24;} .ytkit-context-menu-divider{height:1px;background:#333;margin:6px 0;} .ytkit-context-menu-item .ytkit-shortcut{margin-left:auto;color:#666;font-size:12px;}`;
                document.head.appendChild(this._styleElement);
            },

            _createMenu() {
                const menu = document.createElement('div');
                menu.className = 'ytkit-context-menu';
                menu.style.display = 'none';

                const header = document.createElement('div');
                header.className = 'ytkit-context-menu-header';
                header.textContent = 'YTKit Downloads';
                menu.appendChild(header);

                const items = [
                    { id: 'download-video', icon: 'download', label: 'Download Video (MP4)', class: 'ytkit-item-video', action: () => this._downloadVideo() },
                    { id: 'download-audio', icon: 'music', label: 'Download Audio (MP3)', class: 'ytkit-item-audio', action: () => this._downloadAudio() },
                    { id: 'download-transcript', icon: 'file-text', label: 'Download Transcript', class: 'ytkit-item-transcript', action: () => this._downloadTranscript() },
                    { divider: true },
                    { id: 'stream-vlc', icon: 'play-circle', label: 'Stream in VLC', class: 'ytkit-item-vlc', action: () => this._streamVLC() },
                    { id: 'queue-vlc', icon: 'list-plus', label: 'Add to VLC Queue', class: 'ytkit-item-vlc-queue', action: () => this._addToVLCQueue() },
                    { id: 'stream-mpv', icon: 'monitor', label: 'Stream in MPV', class: 'ytkit-item-mpv', action: () => this._streamMPV() },
                    { id: 'embed-player', icon: 'tv', label: 'Use Embed Player', class: 'ytkit-item-embed', action: () => this._activateEmbed() },
                    { divider: true },
                    { id: 'screenshot', icon: 'camera', label: 'Screenshot Frame', class: 'ytkit-item-copy', action: () => {
                        const f = features.find(f => f.id === 'videoScreenshot');
                        if (f?._capture) f._capture();
                        else {
                            const video = document.querySelector('video.html5-main-video');
                            if (!video || !video.videoWidth) { showToast('No video', '#ef4444'); return; }
                            const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
                            c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
                            c.toBlob(b => { if (!b) return; navigator.clipboard.write([new ClipboardItem({'image/png':b})]).catch(()=>{}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`${getVideoId()||'video'}_${Math.floor(video.currentTime)}s.png`; a.click(); URL.revokeObjectURL(u); showToast('Screenshot captured','#22c55e'); }, 'image/png');
                        }
                    }},
                    { id: 'copy-url', icon: 'link', label: 'Copy Video URL', class: 'ytkit-item-copy', action: () => this._copyURL() },
                    { id: 'copy-url-time', icon: 'link', label: 'Copy URL at Timestamp', class: 'ytkit-item-copy', action: () => this._copyURLAtTime() },
                    { id: 'copy-id', icon: 'hash', label: 'Copy Video ID', class: 'ytkit-item-copy', action: () => this._copyID() },
                ];

                // Add "Setup MediaDL" option at the bottom if server is not running
                if (!MediaDLManager.isRunning) {
                    items.push({ divider: true });
                    items.push({
                        id: 'setup-mediadl',
                        icon: 'settings',
                        label: 'Setup MediaDL (1080p+ Downloads)',
                        class: 'ytkit-item-copy',
                        action: () => MediaDLManager.showInstallPrompt('install')
                    });
                }

                items.forEach(item => {
                    if (item.divider) {
                        const divider = document.createElement('div');
                        divider.className = 'ytkit-context-menu-divider';
                        menu.appendChild(divider);
                        return;
                    }

                    const el = document.createElement('div');
                    el.className = `ytkit-context-menu-item ${item.class}`;
                    el.dataset.action = item.id;

                    // Icon SVG
                    const iconSvg = this._getIcon(item.icon);
                    el.appendChild(iconSvg);

                    // Label
                    const label = document.createElement('span');
                    label.textContent = item.label;
                    el.appendChild(label);

                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._hideMenu();
                        item.action();
                    });

                    menu.appendChild(el);
                });

                document.body.appendChild(menu);
                return menu;
            },

            _getIcon(name) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');

                // Build icons using DOM methods (Trusted Types compliant)
                const ns = 'http://www.w3.org/2000/svg';

                const createPath = (d) => {
                    const p = document.createElementNS(ns, 'path');
                    p.setAttribute('d', d);
                    return p;
                };

                const createLine = (x1, y1, x2, y2) => {
                    const l = document.createElementNS(ns, 'line');
                    l.setAttribute('x1', x1);
                    l.setAttribute('y1', y1);
                    l.setAttribute('x2', x2);
                    l.setAttribute('y2', y2);
                    return l;
                };

                const createCircle = (cx, cy, r) => {
                    const c = document.createElementNS(ns, 'circle');
                    c.setAttribute('cx', cx);
                    c.setAttribute('cy', cy);
                    c.setAttribute('r', r);
                    return c;
                };

                const createRect = (x, y, w, h, rx, ry) => {
                    const r = document.createElementNS(ns, 'rect');
                    r.setAttribute('x', x);
                    r.setAttribute('y', y);
                    r.setAttribute('width', w);
                    r.setAttribute('height', h);
                    if (rx) r.setAttribute('rx', rx);
                    if (ry) r.setAttribute('ry', ry);
                    return r;
                };

                const createPolyline = (points) => {
                    const p = document.createElementNS(ns, 'polyline');
                    p.setAttribute('points', points);
                    return p;
                };

                const createPolygon = (points) => {
                    const p = document.createElementNS(ns, 'polygon');
                    p.setAttribute('points', points);
                    return p;
                };

                switch (name) {
                    case 'download':
                        svg.appendChild(createPath('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'));
                        svg.appendChild(createPolyline('7 10 12 15 17 10'));
                        svg.appendChild(createLine('12', '15', '12', '3'));
                        break;
                    case 'music':
                        svg.appendChild(createPath('M9 18V5l12-2v13'));
                        svg.appendChild(createCircle('6', '18', '3'));
                        svg.appendChild(createCircle('18', '16', '3'));
                        break;
                    case 'file-text':
                        svg.appendChild(createPath('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'));
                        svg.appendChild(createPolyline('14 2 14 8 20 8'));
                        svg.appendChild(createLine('16', '13', '8', '13'));
                        svg.appendChild(createLine('16', '17', '8', '17'));
                        break;
                    case 'play-circle':
                        svg.appendChild(createCircle('12', '12', '10'));
                        svg.appendChild(createPolygon('10 8 16 12 10 16'));
                        break;
                    case 'monitor':
                        svg.appendChild(createRect('2', '3', '20', '14', '2', '2'));
                        svg.appendChild(createLine('8', '21', '16', '21'));
                        svg.appendChild(createLine('12', '17', '12', '21'));
                        break;
                    case 'tv':
                        svg.appendChild(createRect('2', '7', '20', '15', '2', '2'));
                        svg.appendChild(createPolyline('17 2 12 7 7 2'));
                        break;
                    case 'link':
                        svg.appendChild(createPath('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'));
                        svg.appendChild(createPath('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'));
                        break;
                    case 'hash':
                        svg.appendChild(createLine('4', '9', '20', '9'));
                        svg.appendChild(createLine('4', '15', '20', '15'));
                        svg.appendChild(createLine('10', '3', '8', '21'));
                        svg.appendChild(createLine('16', '3', '14', '21'));
                        break;
                    case 'list-plus':
                        svg.appendChild(createLine('8', '6', '21', '6'));
                        svg.appendChild(createLine('8', '12', '21', '12'));
                        svg.appendChild(createLine('8', '18', '21', '18'));
                        svg.appendChild(createLine('3', '6', '3.01', '6'));
                        svg.appendChild(createLine('3', '12', '3.01', '12'));
                        svg.appendChild(createLine('3', '18', '3.01', '18'));
                        // Plus sign
                        svg.appendChild(createLine('16', '5', '16', '7'));
                        svg.appendChild(createLine('15', '6', '17', '6'));
                        break;
                    case 'settings':
                        svg.appendChild(createCircle('12', '12', '3'));
                        svg.appendChild(createPath('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'));
                        break;
                }

                return svg;
            },

            _showMenu(x, y) {
                if (!this._menu) {
                    this._menu = this._createMenu();
                }

                // Position menu
                this._menu.style.display = 'block';

                // Adjust position if menu would go off screen
                const rect = this._menu.getBoundingClientRect();
                const maxX = window.innerWidth - rect.width - 10;
                const maxY = window.innerHeight - rect.height - 10;

                this._menu.style.left = Math.min(x, maxX) + 'px';
                this._menu.style.top = Math.min(y, maxY) + 'px';
            },

            _hideMenu() {
                if (this._menu) {
                    this._menu.style.display = 'none';
                }
            },

            // Action handlers
            _downloadVideo() {
                const url = window.location.href;
                ytKitDownload(url, false);
            },

            _downloadAudio() {
                const url = window.location.href;
                ytKitDownload(url, true);
            },

            async _downloadTranscript() {
                await TranscriptService.downloadTranscript();
            },

            _streamVLC() {
                const url = window.location.href;
                showToast('Sending to VLC...', '#f97316');
                openProtocol('ytvlc://' + encodeURIComponent(url), 'VLC protocol handler not found. Install YTYT-Downloader.');
            },

            _streamMPV() {
                const url = window.location.href;
                showToast('🎬 Sending to MPV...', '#8b5cf6');
                openProtocol('ytmpv://' + encodeURIComponent(url), 'MPV protocol handler not found. Install YTYT-Downloader.');
            },

            _addToVLCQueue() {
                const url = window.location.href;
                showToast('📋 Adding to VLC queue...', '#f97316');
                openProtocol('ytvlcq://' + encodeURIComponent(url), 'VLC Queue protocol handler not found. Install YTYT-Downloader.');
            },

            async _activateEmbed() {
                if (embedFeature && typeof embedFeature.activateEmbed === 'function') {
                    embedFeature._injectStyles();
                    await embedFeature.activateEmbed(true);
                }
            },

            _copyURL() {
                navigator.clipboard.writeText(window.location.href).then(() => {
                    showToast('URL copied to clipboard', '#22c55e');
                }).catch(() => { showToast('Clipboard access denied', '#ef4444'); });
            },

            _copyURLAtTime() {
                const video = document.querySelector('video');
                if (video) {
                    const t = Math.floor(video.currentTime);
                    const url = new URL(window.location.href);
                    url.searchParams.set('t', t + 's');
                    navigator.clipboard.writeText(url.toString()).then(() => {
                        showToast(`URL copied at ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`, '#22c55e');
                    }).catch(() => { showToast('Clipboard access denied', '#ef4444'); });
                } else {
                    this._copyURL();
                }
            },

            _copyID() {
                const videoId = getVideoId();
                if (videoId) {
                    navigator.clipboard.writeText(videoId).then(() => {
                        showToast('Video ID copied: ' + videoId, '#22c55e');
                    }).catch(() => { showToast('Clipboard access denied', '#ef4444'); });
                }
            },

            init() {
                this._injectStyles();

                // Context menu handler - use capturing to intercept before YouTube
                this._contextHandler = (e) => {
                    // Check if right-click is on video player area
                    const moviePlayer = document.querySelector('#movie_player');
                    if (!moviePlayer) return;

                    // Check if click target is within movie player
                    if (moviePlayer.contains(e.target) || e.target === moviePlayer) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        this._showMenu(e.clientX, e.clientY);
                        return false;
                    }
                };

                // Click handler to hide menu
                this._clickHandler = (e) => {
                    if (this._menu && !this._menu.contains(e.target)) {
                        this._hideMenu();
                    }
                };

                // Use capturing phase to get the event before YouTube does
                document.addEventListener('contextmenu', this._contextHandler, true);
                document.addEventListener('click', this._clickHandler);
                this._scrollHandler = () => this._hideMenu();
                document.addEventListener('scroll', this._scrollHandler, { passive: true });

                // Also add directly to movie_player when it appears
                this._playerContextHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this._showMenu(e.clientX, e.clientY);
                    return false;
                };
                this._attachToPlayer = () => {
                    const moviePlayer = document.querySelector('#movie_player');
                    if (moviePlayer && !moviePlayer._ytkitContextMenu) {
                        moviePlayer._ytkitContextMenu = true;
                        this._playerElement = moviePlayer;
                        moviePlayer.addEventListener('contextmenu', this._playerContextHandler, true);
                    }
                };

                // Try to attach now and on navigation
                this._attachToPlayer();
                addNavigateRule('contextMenuAttach', this._attachToPlayer);
            },

            destroy() {
                if (this._contextHandler) {
                    document.removeEventListener('contextmenu', this._contextHandler, true);
                }
                if (this._clickHandler) {
                    document.removeEventListener('click', this._clickHandler);
                }
                if (this._scrollHandler) {
                    document.removeEventListener('scroll', this._scrollHandler);
                }
                if (this._playerElement && this._playerContextHandler) {
                    this._playerElement.removeEventListener('contextmenu', this._playerContextHandler, true);
                    delete this._playerElement._ytkitContextMenu;
                    this._playerElement = null;
                }
                removeNavigateRule('contextMenuAttach');
                this._menu?.remove();
                this._menu = null;
                this._styleElement?.remove();
                this._styleElement = null;
            }
        },




        // ALCHEMY-INSPIRED FEATURES
        {
            id: 'quickLinkMenu',
            name: 'Logo Quick Links',
            description: 'Hover over the YouTube logo to reveal a customizable dropdown menu',
            group: 'Home / Subscriptions',
            icon: 'menu',
            _wrapper: null,
            _styleEl: null,
            _iconMap: {
                '/feed/history':       'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
                '/playlist?list=WL':   'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z',
                '/feed/library':       'M22,7H2v1h20V7z M13,12H2v-1h11V12z M13,16H2v-1h11V16z M15,19v-8l7,4L15,19z',
                '/playlist?list=LL':   'M18.77,11h-4.23l1.52-4.94C16.38,5.03,15.54,4,14.38,4c-0.58,0-1.13,0.24-1.53,0.65L7,11H3v10h4h1h9.43 c1.06,0,1.98-0.67,2.26-1.68l1.29-4.73C21.35,13.41,20.41,11,18.77,11z M7,20H4v-8h3V20z M19.98,14.37l-1.29,4.73 C18.59,19.64,18.02,20,17.43,20H8v-8.61l5.83-5.97c0.15-0.15,0.35-0.23,0.55-0.23c0.41,0,0.72,0.37,0.6,0.77L13.46,11h1.08h4.23 c0.54,0,0.85,0.79,0.65,1.29L19.98,14.37z',
                '/feed/subscriptions': 'M10 18v-6l5 3-5 3zm7-15H7v1h10V3zm3 3H4v1h16V6zm2 3H2v12h20V9zM3 20V10h18v10H3z',
                '/':                   'M12 2L3.5 9.25V22h6.25V15.5h4.5V22h6.25V9.25L12 2zm0 2.5l6.5 5.5V20h-2.25v-6.5h-8.5V20H5.5V10L12 4.5z',
                '/feed/trending':      'M17.53 11.2c-.23-.3-.5-.56-.76-.82-.65-.6-1.4-1.03-2.03-1.66C13.3 7.26 13 5.64 13.41 4c-1.59.5-2.8 1.5-3.7 2.82-2.06 3.05-1.53 7.03 1.21 9.43.17.15.31.34.36.56.07.29-.03.58-.27.8-.24.22-.56.34-.88.27-.29-.06-.54-.27-.68-.53-.85-1.32-.95-2.88-.46-4.35a7.932 7.932 0 00-1.59 4.27c-.07.81.07 1.62.33 2.39.3.95.81 1.81 1.49 2.54 1.48 1.52 3.58 2.36 5.71 2.28 2.27-.09 4.33-1.25 5.53-3.09 1.33-2.04 1.6-4.77.37-6.92z',
                '/feed/channels':      'M4 20h14v1H3V6h1v14zM6 3v14h15V3H6zm13 2v10H8V5h11z',
                '_default':            'M10 6V8H5V19H16V14H18V20C18 20.5523 17.5523 21 17 21H4C3.44772 21 3 20.5523 3 20V7C3 6.44772 3.44772 6 4 6H10ZM21 3V11H19V6.413L11.2071 14.2071L9.79289 12.7929L17.585 5H13V3H21Z',
            },
            _parseItems() {
                const raw = appState.settings.quickLinkItems || '';
                return raw.split('\n').map(line => {
                    const sep = line.indexOf('|');
                    if (sep === -1) return null;
                    const text = line.substring(0, sep).trim();
                    const url = line.substring(sep + 1).trim();
                    if (!text || !url) return null;
                    const icon = this._iconMap[url] || this._iconMap['_default'];
                    return { text, url, icon };
                }).filter(Boolean);
            },
            _buildMenu(parentEl, dropId) {
                const existing = parentEl.querySelector('#' + dropId);
                if (existing) existing.remove();
                const menu = document.createElement('div');
                menu.id = dropId;
                menu.className = 'ytkit-ql-drop';
                const self = this;
                this._parseItems().forEach((item, idx) => {
                    const row = document.createElement('div');
                    row.className = 'ytkit-ql-row';
                    const a = document.createElement('a'); a.href = item.url; a.className = 'ytkit-ql-item';
                    TrustedHTML.setHTML(a, `<svg viewBox="0 0 24 24" class="ytkit-ql-icon"><path d="${item.icon}"></path></svg><span>${item.text}</span>`);
                    row.appendChild(a);
                    // Delete button (hidden unless editing)
                    const del = document.createElement('button');
                    del.className = 'ytkit-ql-del';
                    del.title = 'Remove';
                    TrustedHTML.setHTML(del, `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M18 6L6 18M6 6l12 12" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`);
                    del.onclick = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const items = self._parseItems();
                        items.splice(idx, 1);
                        const newRaw = items.map(i => `${i.text} | ${i.url}`).join('\n');
                        appState.settings.quickLinkItems = newRaw;
                        settingsManager.save(appState.settings);
                        self.rebuildMenus();
                        showToast(`Removed "${item.text}"`, '#ef4444');
                    };
                    row.appendChild(del);
                    menu.appendChild(row);
                });

                // Divider
                const divider = document.createElement('div');
                divider.className = 'ytkit-ql-divider';
                menu.appendChild(divider);

                // Bottom row: Edit + Settings
                const bottomRow = document.createElement('div');
                bottomRow.className = 'ytkit-ql-bottom';

                // Edit toggle
                const editBtn = document.createElement('a');
                editBtn.href = '#';
                editBtn.className = 'ytkit-ql-item ytkit-ql-bottom-btn';
                editBtn.title = 'Edit links';
                editBtn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const isEditing = menu.classList.toggle('ytkit-ql-editing');
                    if (isEditing) {
                        // Show add form
                        let addForm = menu.querySelector('.ytkit-ql-add-form');
                        if (!addForm) {
                            addForm = document.createElement('div');
                            addForm.className = 'ytkit-ql-add-form';
                            const nameInput = document.createElement('input');
                            nameInput.type = 'text'; nameInput.placeholder = 'Label';
                            nameInput.className = 'ytkit-ql-input';
                            const urlInput = document.createElement('input');
                            urlInput.type = 'text'; urlInput.placeholder = '/path or URL';
                            urlInput.className = 'ytkit-ql-input';
                            const addBtn = document.createElement('button');
                            addBtn.className = 'ytkit-ql-add-btn';
                            addBtn.textContent = 'Add';
                            addBtn.onclick = (ev) => {
                                ev.preventDefault(); ev.stopPropagation();
                                const name = nameInput.value.trim();
                                const url = urlInput.value.trim();
                                if (!name || !url) return;
                                const current = appState.settings.quickLinkItems || '';
                                appState.settings.quickLinkItems = current + (current ? '\n' : '') + `${name} | ${url}`;
                                settingsManager.save(appState.settings);
                                self.rebuildMenus();
                                showToast(`Added "${name}"`, '#22c55e');
                            };
                            addForm.appendChild(nameInput);
                            addForm.appendChild(urlInput);
                            addForm.appendChild(addBtn);
                            divider.before(addForm);
                        }
                        addForm.style.display = '';
                    } else {
                        const addForm = menu.querySelector('.ytkit-ql-add-form');
                        if (addForm) addForm.style.display = 'none';
                    }
                };
                TrustedHTML.setHTML(editBtn, `<svg viewBox="0 0 24 24" class="ytkit-ql-icon"><path d="M16.474 5.408l2.118 2.117m-.756-3.982L12.109 9.27a2.118 2.118 0 00-.58 1.082L11 13l2.648-.53c.41-.082.786-.283 1.082-.579l5.727-5.727a1.853 1.853 0 10-2.621-2.621z"/><path d="M19 15v3a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span>Edit</span>`);
                bottomRow.appendChild(editBtn);

                // Settings
                const gear = document.createElement('a');
                gear.href = '#';
                gear.className = 'ytkit-ql-item ytkit-ql-bottom-btn';
                gear.title = 'YTKit Settings';
                gear.onclick = (e) => { e.preventDefault(); document.body.classList.toggle('ytkit-panel-open'); };
                TrustedHTML.setHTML(gear, `<svg viewBox="0 0 24 24" class="ytkit-ql-icon"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg><span>Settings</span>`);
                bottomRow.appendChild(gear);

                menu.appendChild(bottomRow);
                parentEl.appendChild(menu);

                // JS hover — stay open while cursor is anywhere inside wrapper or menu
                let hideTimer = null;
                const show = () => { clearTimeout(hideTimer); hideTimer = null; menu.classList.add('ytkit-ql-visible'); };
                const scheduleHide = (e) => {
                    // Don't hide if cursor moved to another element inside the wrapper
                    if (e && e.relatedTarget && parentEl.contains(e.relatedTarget)) return;
                    clearTimeout(hideTimer);
                    hideTimer = setTimeout(() => menu.classList.remove('ytkit-ql-visible'), 300);
                };
                parentEl.addEventListener('mouseenter', show);
                parentEl.addEventListener('mouseleave', scheduleHide);

                return menu;
            },
            rebuildMenus() {
                if (this._wrapper) this._buildMenu(this._wrapper, 'ytkit-ql-menu');
                // Also rebuild watch page dropdown if present
                const poLogoWrap = document.getElementById('ytkit-po-logo-wrap');
                if (poLogoWrap) this._buildMenu(poLogoWrap, 'ytkit-po-drop');
            },
            init() {
                const self = this;
                self._styleEl = GM_addStyle(`#ytkit-ql-wrap{position:relative;display:inline-block} .ytkit-ql-drop{position:absolute;flex-direction:column;background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.6);padding:3px 0;z-index:9999;min-width:160px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(4px);transition:opacity 0.2s ease,visibility 0.2s ease,transform 0.2s ease;display:flex} .ytkit-ql-drop.ytkit-ql-visible{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0)} #ytkit-ql-menu{top:38px;left:0} #ytkit-po-drop{bottom:calc(100% + 6px);right:0} .ytkit-ql-row{display:flex;align-items:center} .ytkit-ql-item{display:flex;align-items:center;padding:5px 12px;color:#fff;text-decoration:none;font-size:12px;font-family:"Roboto","Arial",sans-serif;transition:background .12s;gap:8px;flex:1;min-width:0} .ytkit-ql-item:hover{background:rgba(255,255,255,.07)} .ytkit-ql-icon{fill:#fff;width:16px;height:16px;flex-shrink:0} .ytkit-ql-del{display:none;background:none;border:none;cursor:pointer;padding:4px 8px 4px 0;opacity:0.4;transition:opacity .15s} .ytkit-ql-del:hover{opacity:1} .ytkit-ql-editing .ytkit-ql-del{display:flex} .ytkit-ql-divider{height:1px;background:rgba(255,255,255,0.06);margin:2px 0} .ytkit-ql-bottom{display:flex;gap:0} .ytkit-ql-bottom-btn{opacity:0.4;font-size:11px;flex:1;justify-content:center} .ytkit-ql-bottom-btn .ytkit-ql-icon{width:13px;height:13px} .ytkit-ql-bottom-btn:hover{opacity:0.85} .ytkit-ql-editing .ytkit-ql-bottom-btn[title="Edit links"]{opacity:1;color:#3ea6ff} .ytkit-ql-add-form{display:flex;gap:4px;padding:4px 8px;align-items:center} .ytkit-ql-input{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;font-size:11px;padding:4px 6px;width:70px;outline:none;font-family:"Roboto","Arial",sans-serif} .ytkit-ql-input:focus{border-color:rgba(62,166,255,0.4)} .ytkit-ql-add-btn{background:#3ea6ff;border:none;color:#000;font-size:11px;font-weight:500;padding:4px 8px;border-radius:4px;cursor:pointer;font-family:"Roboto","Arial",sans-serif;white-space:nowrap} .ytkit-ql-add-btn:hover{background:#5bb8ff}`);

                waitForElement('ytd-topbar-logo-renderer', (logo) => {
                    if (document.getElementById('ytkit-ql-wrap')) return;
                    const wrapper = document.createElement('div'); wrapper.id = 'ytkit-ql-wrap';
                    logo.parentNode.insertBefore(wrapper, logo);
                    wrapper.appendChild(logo);
                    self._buildMenu(wrapper, 'ytkit-ql-menu');
                    self._wrapper = wrapper;
                });
            },
            destroy() {
                if (this._wrapper) {
                    const logo = this._wrapper.querySelector('ytd-topbar-logo-renderer');
                    if (logo) { this._wrapper.parentNode?.insertBefore(logo, this._wrapper); }
                    this._wrapper.remove(); this._wrapper = null;
                }
                this._styleEl?.remove(); this._styleEl = null;
            }
        },
        {
            id: 'quickLinkEditor',
            name: 'Edit Quick Links',
            description: 'Customize the logo dropdown menu. One link per line: Label | URL',
            group: 'Home / Subscriptions',
            icon: 'menu',
            isSubFeature: true,
            parentId: 'quickLinkMenu',
            type: 'textarea',
            placeholder: 'History | /feed/history\nWatch Later | /playlist?list=WL',
            settingKey: 'quickLinkItems',
            _settingsHandler: null,
            init() {
                // Listen for setting changes to rebuild menus
                this._settingsHandler = (e) => {
                    if (e.detail?.key === 'quickLinkItems') {
                        const ql = features.find(f => f.id === 'quickLinkMenu');
                        if (ql && ql.rebuildMenus) ql.rebuildMenus();
                    }
                };
                document.addEventListener('ytkit-settings-changed', this._settingsHandler);
            },
            destroy() {
                if (this._settingsHandler) {
                    document.removeEventListener('ytkit-settings-changed', this._settingsHandler);
                    this._settingsHandler = null;
                }
            }
        },

        {
            id: 'forceH264',
            name: 'Force H.264 Codec',
            description: 'Prefer H.264 (AVC) over VP9/AV1 for lower CPU usage on older hardware. May reduce max quality. Uses the same codec engine as Codec Selector.',
            group: 'Video Player',
            icon: 'cpu',

            init() {
                // Delegate to the shared codec patching via codecSelector's engine
                // This avoids double-patching canPlayType when both are active
                if (!HTMLVideoElement.prototype.__ytkit_codecPatched) {
                    const videoProto = HTMLVideoElement.prototype;
                    videoProto.__ytkit_origCanPlayType = videoProto.canPlayType;
                    videoProto.__ytkit_codecPatched = true;
                    videoProto.canPlayType = function(type) {
                        const codec = appState.settings.codecSelector || 'auto';
                        const forceH264 = appState.settings.forceH264;
                        // forceH264 forces h264 regardless of codecSelector
                        const effective = forceH264 ? 'h264' : codec;
                        if (effective === 'auto') return videoProto.__ytkit_origCanPlayType.call(this, type);
                        if (effective === 'h264' && /vp0?9|av01/i.test(type)) return '';
                        if (effective === 'vp9') {
                            if (/av01/i.test(type)) return '';
                            if (/avc1/i.test(type) && !/vp0?9/i.test(type)) return '';
                        }
                        if (effective === 'av1') {
                            if (/vp0?9|avc1/i.test(type) && !/av01/i.test(type)) return '';
                        }
                        return videoProto.__ytkit_origCanPlayType.call(this, type);
                    };
                }
                DebugManager.log('Codec', 'Forcing H.264 — VP9/AV1 blocked');
            },
            destroy() {
                // Only restore if codecSelector is not also active
                if (!appState.settings.codecSelector || appState.settings.codecSelector === 'auto') {
                    if (HTMLVideoElement.prototype.__ytkit_origCanPlayType) {
                        HTMLVideoElement.prototype.canPlayType = HTMLVideoElement.prototype.__ytkit_origCanPlayType;
                        delete HTMLVideoElement.prototype.__ytkit_origCanPlayType;
                        delete HTMLVideoElement.prototype.__ytkit_codecPatched;
                    }
                }
            }
        },
        {
            id: 'titleNormalization',
            name: 'Normalize Clickbait Titles',
            description: 'Convert ALL CAPS titles to Title Case. Reduces clickbait without changing meaning.',
            group: 'Content',
            icon: 'type',
            _observer: null,

            _toTitleCase(str) {
                // Only normalize if more than 50% of letters are uppercase
                const letters = str.replace(/[^a-zA-Z]/g, '');
                if (letters.length < 4) return str;
                const upperCount = (str.match(/[A-Z]/g) || []).length;
                if (upperCount / letters.length < 0.5) return str;

                // Preserve acronyms (2-4 consecutive caps), numbers, special chars
                return str.replace(/\b([A-Z]{2,4})\b/g, '|||$1|||')
                    .toLowerCase()
                    .replace(/\|\|\|([^|]+)\|\|\|/g, (_, acr) => acr.toUpperCase())
                    .replace(/(^|\s|["\-(\[])([a-z])/g, (_, pre, c) => pre + c.toUpperCase())
                    .replace(/\bi\b/g, 'I');
            },

            _processTitle(el) {
                if (el._ytkitNormalized) return;
                const text = el.textContent.trim();
                if (!text) return;
                const normalized = this._toTitleCase(text);
                if (normalized !== text) {
                    el._ytkitOriginalTitle = text;
                    el.textContent = normalized;
                    el._ytkitNormalized = true;
                    el.title = text; // Show original on hover
                }
            },

            _processAll() {
                // Video titles in feeds
                document.querySelectorAll('#video-title, #video-title-link yt-formatted-string, ytd-rich-grid-media #video-title-link, h3.ytd-rich-grid-media a#video-title-link').forEach(el => this._processTitle(el));
                // Watch page title
                document.querySelectorAll('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string').forEach(el => this._processTitle(el));
            },

            init() {
                this._processAll();
                addMutationRule(this.id, () => this._processAll());
                addNavigateRule('titleNorm', () => setTimeout(() => this._processAll(), 1000));
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule('titleNorm');
                // Restore original titles
                document.querySelectorAll('[data-ytkit-normalized]').forEach(el => {
                    if (el._ytkitOriginalTitle) el.textContent = el._ytkitOriginalTitle;
                });
            }
        },
        {
            id: 'watchProgress',
            name: 'Watch Progress Indicators',
            description: 'Show colored progress bars on video thumbnails based on your watch history (saved locally)',
            group: 'Content',
            icon: 'bar-chart',
            _styleElement: null,
            _storageKey: 'ytkit-watch-progress',
            _saveInterval: null,

            _getProgress() {
                return StorageManager.get(this._storageKey, {});
            },

            _saveCurrentProgress() {
                if (!window.location.pathname.startsWith('/watch')) return;
                const video = document.querySelector('video.html5-main-video');
                const videoId = getVideoId();
                if (!video || !videoId || !video.duration || video.duration < 30) return;
                const percent = Math.round((video.currentTime / video.duration) * 100);
                if (percent < 5) return; // Don't save negligible progress
                const progress = this._getProgress();
                progress[videoId] = { p: Math.min(percent, 100), t: Date.now() };
                // Prune entries older than 30 days
                const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
                for (const id in progress) {
                    if (progress[id].t < cutoff) delete progress[id];
                }
                StorageManager.set(this._storageKey, progress);
            },

            _addProgressBars() {
                const progress = this._getProgress();
                if (Object.keys(progress).length === 0) return;
                document.querySelectorAll('ytd-rich-item-renderer a#thumbnail, ytd-video-renderer a#thumbnail, ytd-compact-video-renderer a#thumbnail, ytd-grid-video-renderer a#thumbnail').forEach(thumb => {
                    if (thumb.querySelector('.ytkit-progress-bar')) return;
                    const href = thumb.getAttribute('href');
                    if (!href) return;
                    const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
                    if (!match) return;
                    const videoId = match[1];
                    const entry = progress[videoId];
                    if (!entry) return;
                    const bar = document.createElement('div');
                    bar.className = 'ytkit-progress-bar';
                    const color = entry.p >= 90 ? '#22c55e' : '#3ea6ff';
                    bar.style.cssText = `position:absolute;bottom:0;left:0;height:3px;background:${color};z-index:10;border-radius:0 1px 0 0;transition:width 0.3s;width:${entry.p}%;`;
                    thumb.style.position = thumb.style.position || 'relative';
                    thumb.appendChild(bar);
                });
            },

            init() {
                this._styleElement = injectStyle('.ytkit-progress-bar { pointer-events: none; }', this.id, true);
                this._addProgressBars();
                addMutationRule(this.id, () => this._addProgressBars());
                addNavigateRule('watchProgress', () => {
                    this._saveCurrentProgress();
                    setTimeout(() => this._addProgressBars(), 1500);
                });
                // Periodically save progress while watching
                this._saveInterval = setInterval(() => this._saveCurrentProgress(), 15000);
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule('watchProgress');
                if (this._saveInterval) { clearInterval(this._saveInterval); this._saveInterval = null; }
                this._saveCurrentProgress(); // Save one last time
                this._styleElement?.remove();
                document.querySelectorAll('.ytkit-progress-bar').forEach(el => el.remove());
            }
        },

        // ─── v3.2.0: Quick Wins ───

        {
            id: 'autoDismissStillWatching',
            name: 'Auto-Dismiss "Still Watching?"',
            description: 'Automatically clicks the "Continue Watching" button when YouTube pauses playback for inactivity',
            group: 'Playback',
            icon: 'play',
            _observer: null,

            _dismiss() {
                const btn = document.querySelector('.ytp-unmute-confirm-button, button.ytp-play-button[data-title-no-tooltip="Play"], .yt-confirm-dialog-renderer #confirm-button, [aria-label="Yes, keep playing"], .ytd-popup-container tp-yt-paper-button#button');
                if (btn) { btn.click(); DebugManager.log('StillWatching', 'Auto-dismissed prompt'); }
                const video = document.querySelector('video.html5-main-video');
                if (video && video.paused && !video.ended && document.querySelector('.ytp-pause-overlay, .ytp-error-content-wrap-reason')) {
                    video.play().catch(() => {});
                }
            },

            init() {
                this._observer = new MutationObserver(() => this._dismiss());
                const target = document.querySelector('ytd-popup-container') || document.body;
                this._observer.observe(target, { childList: true, subtree: true });
                addNavigateRule('stillWatching', () => this._dismiss());
            },
            destroy() {
                this._observer?.disconnect(); this._observer = null;
                removeNavigateRule('stillWatching');
            }
        },
        {
            id: 'remainingTimeDisplay',
            name: 'Remaining Time Display',
            description: 'Show time remaining next to current time in the player, adjusted for playback speed',
            group: 'Playback',
            icon: 'clock',
            pages: [PageTypes.WATCH],
            _styleEl: null,
            _interval: null,
            _el: null,

            _formatTime(secs) {
                const neg = secs < 0;
                secs = Math.abs(Math.floor(secs));
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                const s = secs % 60;
                const ts = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
                return (neg ? '-' : '') + ts;
            },

            _update() {
                const video = document.querySelector('video.html5-main-video');
                if (!video || !video.duration) { if (this._el) this._el.textContent = ''; return; }
                const remaining = (video.duration - video.currentTime) / (video.playbackRate || 1);
                if (!this._el) {
                    const timeDisplay = document.querySelector('.ytp-time-display');
                    if (!timeDisplay) return;
                    this._el = document.createElement('span');
                    this._el.className = 'ytkit-remaining-time';
                    this._el.style.cssText = 'margin-left:8px;color:rgba(255,255,255,0.7);font-size:inherit;';
                    timeDisplay.appendChild(this._el);
                }
                this._el.textContent = `(-${this._formatTime(remaining)})`;
            },

            init() {
                this._interval = setInterval(() => this._update(), 1000);
                addNavigateRule('remainTime', () => { this._el = null; setTimeout(() => this._update(), 2000); });
            },
            destroy() {
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                removeNavigateRule('remainTime');
                this._el?.remove(); this._el = null;
            }
        },
        {
            id: 'showPlaylistDuration',
            name: 'Show Playlist Duration',
            description: 'Display total playlist runtime and speed-adjusted estimate next to the playlist header',
            group: 'Playback',
            icon: 'list',
            _observer: null,

            _formatDuration(secs) {
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                if (h > 0) return `${h}h ${m}m`;
                return `${m}m`;
            },

            _calculate() {
                const items = document.querySelectorAll('ytd-playlist-panel-video-renderer .ytd-thumbnail-overlay-time-status-renderer, ytd-playlist-video-renderer .ytd-thumbnail-overlay-time-status-renderer');
                if (items.length === 0) return;
                let totalSecs = 0;
                items.forEach(el => {
                    const text = el.textContent.trim();
                    const parts = text.split(':').map(Number);
                    if (parts.length === 3) totalSecs += parts[0] * 3600 + parts[1] * 60 + parts[2];
                    else if (parts.length === 2) totalSecs += parts[0] * 60 + parts[1];
                });
                if (totalSecs === 0) return;
                const header = document.querySelector('#header-description ytd-playlist-panel-renderer, .metadata-stats, ytd-playlist-header-renderer .metadata-action-bar, ytd-playlist-sidebar-primary-info-renderer .stats, #stats.ytd-playlist-sidebar-primary-info-renderer');
                const target = header || document.querySelector('ytd-playlist-panel-renderer #publisher-container, ytd-playlist-panel-renderer #playlist-action-menu');
                if (!target || target.querySelector('.ytkit-playlist-duration')) return;
                const badge = document.createElement('span');
                badge.className = 'ytkit-playlist-duration';
                const video = document.querySelector('video.html5-main-video');
                const speed = video?.playbackRate || 1;
                let text = this._formatDuration(totalSecs);
                if (speed !== 1) text += ` (${this._formatDuration(Math.round(totalSecs / speed))} at ${speed}x)`;
                badge.textContent = text;
                badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;background:rgba(255,255,255,0.1);border-radius:4px;font-size:12px;color:rgba(255,255,255,0.7);vertical-align:middle;';
                target.appendChild(badge);
            },

            init() {
                setTimeout(() => this._calculate(), 2000);
                addNavigateRule('playlistDur', () => setTimeout(() => this._calculate(), 2000));
                addMutationRule(this.id, () => {
                    if (!document.querySelector('.ytkit-playlist-duration')) this._calculate();
                });
            },
            destroy() {
                removeNavigateRule('playlistDur');
                removeMutationRule(this.id);
                document.querySelectorAll('.ytkit-playlist-duration').forEach(el => el.remove());
            }
        },
        {
            id: 'showTimeInTabTitle',
            name: 'Show Time in Tab Title',
            description: 'Prepend current playback time [5:23] to the browser tab title',
            group: 'Playback',
            icon: 'type',
            pages: [PageTypes.WATCH],
            _interval: null,
            _origTitle: null,

            _update() {
                const video = document.querySelector('video.html5-main-video');
                if (!video || !video.duration || video.paused) {
                    if (this._origTitle && document.title.startsWith('[')) document.title = this._origTitle;
                    return;
                }
                const secs = Math.floor(video.currentTime);
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                const s = secs % 60;
                const ts = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
                const base = document.title.replace(/^\[\d+:[\d:]+\]\s*/, '');
                if (!this._origTitle) this._origTitle = base;
                document.title = `[${ts}] ${base}`;
            },

            init() {
                this._interval = setInterval(() => this._update(), 1000);
                addNavigateRule('tabTitle', () => { this._origTitle = null; });
            },
            destroy() {
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                removeNavigateRule('tabTitle');
                if (this._origTitle) document.title = this._origTitle;
            }
        },
        {
            id: 'customProgressBarColor',
            name: 'Custom Progress Bar Color',
            description: 'Change the red progress bar to any color',
            group: 'Theme',
            icon: 'palette',
            type: 'color',
            settingKey: 'customProgressBarColor',
            _styleEl: null,

            init() {
                const color = appState.settings.customProgressBarColor || '#ff0000';
                if (color === '#ff0000') return;
                const css = `.ytp-play-progress, .ytp-swatch-background-color { background: ${color} !important; } .ytp-volume-slider-foreground::after { background: ${color} !important; }`;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'compactUnfixedHeader',
            name: 'Compact / Unfixed Header',
            description: 'Reduce header height and let it scroll away instead of staying fixed',
            group: 'Home / Subscriptions',
            icon: 'minimize',
            _styleEl: null,

            init() {
                const css = `
                    ytd-masthead { position: absolute !important; height: 40px !important; min-height: 40px !important; }
                    ytd-masthead #container.ytd-masthead { height: 40px !important; }
                    ytd-masthead #logo { height: 16px !important; }
                    ytd-masthead #search-form, ytd-masthead #search-input { height: 32px !important; }
                    ytd-page-manager { margin-top: 0 !important; }
                    html[dark] #cinematics { top: 40px !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'reversePlaylist',
            name: 'Reverse Playlist Button',
            description: 'Adds a "Reverse" button to playlist panels to play oldest first',
            group: 'Playback',
            icon: 'arrow-down-up',
            _injected: false,

            _inject() {
                const menu = document.querySelector('ytd-playlist-panel-renderer #playlist-action-menu, ytd-playlist-panel-renderer .header-action-menu');
                if (!menu || menu.querySelector('.ytkit-reverse-btn')) return;
                const btn = document.createElement('button');
                btn.className = 'ytkit-reverse-btn';
                btn.textContent = 'Reverse';
                btn.title = 'Play oldest first';
                btn.style.cssText = 'padding:4px 12px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;background:rgba(255,255,255,0.08);color:#fff;font-size:12px;cursor:pointer;transition:background 0.2s;margin-left:8px;';
                btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.15)'; };
                btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.08)'; };
                btn.onclick = () => {
                    const container = document.querySelector('ytd-playlist-panel-renderer #items');
                    if (!container) return;
                    const items = [...container.children];
                    items.reverse().forEach(item => container.appendChild(item));
                    showToast('Playlist reversed', '#3ea6ff');
                };
                menu.appendChild(btn);
            },

            init() {
                setTimeout(() => this._inject(), 2000);
                addNavigateRule('reversePlaylist', () => setTimeout(() => this._inject(), 2000));
                addMutationRule(this.id, () => {
                    if (!document.querySelector('.ytkit-reverse-btn')) this._inject();
                });
            },
            destroy() {
                removeNavigateRule('reversePlaylist');
                removeMutationRule(this.id);
                document.querySelectorAll('.ytkit-reverse-btn').forEach(el => el.remove());
            }
        },
        {
            id: 'rssFeedLink',
            name: 'RSS Feed Link',
            description: 'Show an RSS feed link on channel pages for subscribing via RSS readers',
            group: 'Home / Subscriptions',
            icon: 'rss',
            pages: [PageTypes.CHANNEL],

            _inject() {
                const container = document.querySelector('#channel-header-container #inner-header-container #buttons, ytd-c4-tabbed-header-renderer #buttons, #page-header #flexible-item-buttons');
                if (!container || container.querySelector('.ytkit-rss-btn')) return;
                const channelId = document.querySelector('ytd-c4-tabbed-header-renderer')?.data?.header?.c4TabbedHeaderRenderer?.channelId
                    || document.querySelector('meta[itemprop="identifier"], meta[property="og:url"]')?.content?.match(/channel\/(UC[a-zA-Z0-9_-]+)/)?.[1]
                    || document.querySelector('link[rel="canonical"]')?.href?.match(/channel\/(UC[a-zA-Z0-9_-]+)/)?.[1];
                if (!channelId) return;
                const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
                const btn = document.createElement('a');
                btn.className = 'ytkit-rss-btn';
                btn.href = rssUrl;
                btn.target = '_blank';
                btn.title = 'RSS Feed';
                btn.textContent = 'RSS';
                btn.style.cssText = 'display:inline-flex;align-items:center;padding:6px 12px;border:1px solid rgba(255,255,255,0.2);border-radius:18px;background:rgba(255,255,255,0.08);color:#f97316;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;margin-left:8px;transition:background 0.2s;';
                btn.onmouseenter = () => { btn.style.background = 'rgba(249,115,22,0.15)'; };
                btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.08)'; };
                container.appendChild(btn);
            },

            init() {
                setTimeout(() => this._inject(), 2000);
                addNavigateRule('rssFeed', () => setTimeout(() => this._inject(), 2000));
            },
            destroy() {
                removeNavigateRule('rssFeed');
                document.querySelectorAll('.ytkit-rss-btn').forEach(el => el.remove());
            }
        },
        {
            id: 'preciseViewCounts',
            name: 'Precise View Counts',
            description: 'Show full view counts (1,234,567) instead of truncated (1.2M)',
            group: 'Watch Page',
            icon: 'hash',
            pages: [PageTypes.WATCH],

            _process() {
                const infoEl = document.querySelector('ytd-watch-metadata #info-container yt-formatted-string, ytd-watch-metadata .view-count, #info-text .view-count, ytd-video-primary-info-renderer .view-count');
                if (!infoEl || infoEl.dataset.ytkitPrecise) return;
                try {
                    const playerResponse = window.ytInitialPlayerResponse;
                    const viewCount = playerResponse?.videoDetails?.viewCount;
                    if (viewCount) {
                        const formatted = Number(viewCount).toLocaleString();
                        const text = infoEl.textContent;
                        if (text.includes('view')) {
                            infoEl.textContent = `${formatted} views`;
                            infoEl.dataset.ytkitPrecise = '1';
                        }
                    }
                } catch(e) {}
            },

            init() {
                setTimeout(() => this._process(), 1500);
                addNavigateRule('preciseViews', () => setTimeout(() => this._process(), 2000));
            },
            destroy() {
                removeNavigateRule('preciseViews');
            }
        },

        // ─── v3.2.0: Medium Effort ───

        {
            id: 'returnYoutubeDislike',
            name: 'Return YouTube Dislike',
            description: 'Restore dislike counts and like/dislike ratio bar using the Return YouTube Dislike API',
            group: 'Watch Page',
            icon: 'thumbs-down',
            pages: [PageTypes.WATCH],
            _styleEl: null,

            async _fetchDislikes(videoId) {
                try {
                    const resp = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`);
                    if (!resp.ok) return null;
                    return await resp.json();
                } catch { return null; }
            },

            _formatCount(n) {
                if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
                if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
                if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
                return String(n);
            },

            async _apply() {
                const videoId = getVideoId();
                if (!videoId) return;
                if (document.querySelector('.ytkit-dislike-count')) return;
                const data = await this._fetchDislikes(videoId);
                if (!data || data.dislikes === undefined) return;
                // Find dislike button — multiple layout fallbacks
                const selectors = [
                    'dislike-button-view-model button',
                    '#segmented-dislike-button button',
                    'ytd-toggle-button-renderer:has(path[d*="M17"]) button',
                    '#menu-container ytd-toggle-button-renderer:nth-child(2) button',
                    'ytd-segmented-like-dislike-button-renderer button[aria-label*="islike"], ytd-segmented-like-dislike-button-renderer button[aria-label*="dislike"]',
                    '.YtLikeButtonViewModelHost ~ .YtDislikeButtonViewModelHost button'
                ];
                let dislikeBtn = null;
                for (const sel of selectors) {
                    dislikeBtn = document.querySelector(sel);
                    if (dislikeBtn) break;
                }
                if (!dislikeBtn) return;
                const countEl = document.createElement('span');
                countEl.className = 'ytkit-dislike-count';
                countEl.textContent = this._formatCount(data.dislikes);
                countEl.style.cssText = 'margin-left:4px;font-size:12px;color:rgba(255,255,255,0.7);';
                dislikeBtn.parentElement.style.position = dislikeBtn.parentElement.style.position || 'relative';
                dislikeBtn.parentElement.appendChild(countEl);
                // Add ratio bar below like/dislike buttons
                const segmented = dislikeBtn.closest('ytd-segmented-like-dislike-button-renderer, .YtSegmentedLikeDislikeButtonViewModelHost');
                if (segmented && !segmented.querySelector('.ytkit-ratio-bar')) {
                    const total = (data.likes || 0) + (data.dislikes || 0);
                    const likePercent = total > 0 ? ((data.likes / total) * 100).toFixed(1) : 100;
                    const bar = document.createElement('div');
                    bar.className = 'ytkit-ratio-bar';
                    bar.style.cssText = `width:100%;height:2px;margin-top:4px;border-radius:1px;background:rgba(255,255,255,0.15);overflow:hidden;`;
                    const fill = document.createElement('div');
                    fill.style.cssText = `width:${likePercent}%;height:100%;background:#3ea6ff;border-radius:1px;`;
                    bar.appendChild(fill);
                    segmented.style.position = segmented.style.position || 'relative';
                    segmented.appendChild(bar);
                }
            },

            init() {
                this._styleEl = injectStyle('.ytkit-ratio-bar { pointer-events: none; }', this.id, true);
                setTimeout(() => this._apply(), 2000);
                addNavigateRule('ryd', () => setTimeout(() => this._apply(), 2500));
            },
            destroy() {
                removeNavigateRule('ryd');
                this._styleEl?.remove(); this._styleEl = null;
                document.querySelectorAll('.ytkit-dislike-count, .ytkit-ratio-bar').forEach(el => el.remove());
            }
        },
        {
            id: 'videoScreenshot',
            name: 'Video Screenshot',
            description: 'Capture the current video frame as a PNG image — copies to clipboard and downloads',
            group: 'Video Player',
            icon: 'camera',
            pages: [PageTypes.WATCH],
            _btn: null,

            _capture() {
                const video = document.querySelector('video.html5-main-video');
                if (!video || !video.videoWidth) { showToast('No video to capture', '#ef4444'); return; }
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    if (!blob) return;
                    // Copy to clipboard
                    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
                    // Download
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    const videoId = getVideoId() || 'video';
                    const time = Math.floor(video.currentTime);
                    a.href = url;
                    a.download = `${videoId}_${time}s.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('Screenshot captured', '#22c55e');
                }, 'image/png');
            },

            _inject() {
                const controls = document.querySelector('.ytp-right-controls');
                if (!controls || controls.querySelector('.ytkit-screenshot-btn')) return;
                const btn = document.createElement('button');
                btn.className = 'ytp-button ytkit-player-btn ytkit-screenshot-btn';
                btn.title = 'Screenshot (YTKit)';
                TrustedHTML.setHTML(btn, '<svg viewBox="0 0 24 24"><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.65 0-3 1.35-3 3s1.35 3 3 3 3-1.35 3-3-1.35-3-3-3z"/></svg>');
                btn.onclick = (e) => { e.stopPropagation(); this._capture(); };
                controls.insertBefore(btn, controls.firstChild);
                this._btn = btn;
            },

            init() {
                setTimeout(() => this._inject(), 2000);
                addNavigateRule('screenshot', () => { this._btn = null; setTimeout(() => this._inject(), 2000); });
            },
            destroy() {
                removeNavigateRule('screenshot');
                this._btn?.remove(); this._btn = null;
            }
        },
        {
            id: 'perChannelSpeed',
            name: 'Per-Channel Speed Memory',
            description: 'Remember and auto-apply preferred playback speed for each channel',
            group: 'Video Player',
            icon: 'gauge',
            pages: [PageTypes.WATCH],
            _storageKey: 'ytkit-channel-speeds',
            _observer: null,
            _applied: false,

            _getChannelId() {
                return document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner a, ytd-video-owner-renderer a')?.href?.match(/@[\w-]+|channel\/[\w-]+/)?.[0] || null;
            },

            _getSpeeds() { return StorageManager.get(this._storageKey, {}); },

            _applySpeed() {
                if (this._applied) return;
                const channelId = this._getChannelId();
                if (!channelId) return;
                const speeds = this._getSpeeds();
                const savedSpeed = speeds[channelId];
                if (!savedSpeed) return;
                const video = document.querySelector('video.html5-main-video');
                if (!video) return;
                video.playbackRate = savedSpeed;
                this._applied = true;
                DebugManager.log('ChannelSpeed', `Applied ${savedSpeed}x for ${channelId}`);
            },

            _saveCurrentSpeed() {
                const channelId = this._getChannelId();
                if (!channelId) return;
                const video = document.querySelector('video.html5-main-video');
                if (!video || video.playbackRate === 1) return;
                const speeds = this._getSpeeds();
                speeds[channelId] = video.playbackRate;
                // Prune to 500 channels max
                const keys = Object.keys(speeds);
                if (keys.length > 500) delete speeds[keys[0]];
                StorageManager.set(this._storageKey, speeds);
            },

            init() {
                setTimeout(() => this._applySpeed(), 3000);
                addNavigateRule('channelSpeed', () => {
                    this._saveCurrentSpeed();
                    this._applied = false;
                    setTimeout(() => this._applySpeed(), 3000);
                });
                // Observe speed changes via ratechange event
                this._rateHandler = () => this._saveCurrentSpeed();
                document.addEventListener('ratechange', this._rateHandler, true);
            },
            destroy() {
                this._saveCurrentSpeed();
                removeNavigateRule('channelSpeed');
                document.removeEventListener('ratechange', this._rateHandler, true);
            }
        },
        {
            id: 'hideWatchedVideos',
            name: 'Hide Watched Videos',
            description: 'Dim or hide videos with a red progress bar (already watched) from feeds',
            group: 'Content',
            icon: 'eye-off',
            type: 'select',
            options: { 'dim': 'Dim (50% opacity)', 'hide': 'Fully Hidden' },
            settingKey: 'hideWatchedMode',
            _styleEl: null,

            _process() {
                const mode = appState.settings.hideWatchedMode || 'dim';
                document.querySelectorAll('ytd-rich-item-renderer:not([ytkit-watched-check]), ytd-video-renderer:not([ytkit-watched-check]), ytd-grid-video-renderer:not([ytkit-watched-check])').forEach(item => {
                    item.setAttribute('ytkit-watched-check', '1');
                    const progressBar = item.querySelector('#progress, ytd-thumbnail-overlay-resume-playback-renderer');
                    if (progressBar) {
                        if (mode === 'hide') item.style.display = 'none';
                        else item.style.opacity = '0.4';
                        item.classList.add('ytkit-watched');
                    }
                });
            },

            init() {
                this._process();
                addMutationRule(this.id, () => this._process());
                addNavigateRule('hideWatched', () => {
                    document.querySelectorAll('[ytkit-watched-check]').forEach(el => {
                        el.removeAttribute('ytkit-watched-check');
                        el.classList.remove('ytkit-watched');
                        el.style.opacity = ''; el.style.display = '';
                    });
                    setTimeout(() => this._process(), 1500);
                });
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule('hideWatched');
                document.querySelectorAll('[ytkit-watched-check]').forEach(el => {
                    el.removeAttribute('ytkit-watched-check');
                    el.classList.remove('ytkit-watched');
                    el.style.opacity = ''; el.style.display = '';
                });
            }
        },
        {
            id: 'antiTranslate',
            name: 'Anti-Translate (Original Titles)',
            description: 'Prevent YouTube from auto-translating video titles and descriptions to your language',
            group: 'Content',
            icon: 'languages',

            _process() {
                // YouTube stores original title in data attributes or in the ytInitialData structure
                // The most reliable method: override title elements that have title attribute with original text
                document.querySelectorAll('#video-title[title]:not([ytkit-antitranslate])').forEach(el => {
                    const original = el.getAttribute('title');
                    const displayed = el.textContent.trim();
                    if (original && displayed && original !== displayed) {
                        el.textContent = original;
                        el.setAttribute('ytkit-antitranslate', '1');
                    }
                });
                // Watch page title
                const watchTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
                if (watchTitle && !watchTitle.getAttribute('ytkit-antitranslate')) {
                    try {
                        const pr = window.ytInitialPlayerResponse;
                        const original = pr?.videoDetails?.title;
                        if (original && original !== watchTitle.textContent.trim()) {
                            watchTitle.textContent = original;
                            watchTitle.setAttribute('ytkit-antitranslate', '1');
                        }
                    } catch {}
                }
            },

            init() {
                setTimeout(() => this._process(), 1500);
                addMutationRule(this.id, () => this._process());
                addNavigateRule('antiTranslate', () => setTimeout(() => this._process(), 2000));
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule('antiTranslate');
                document.querySelectorAll('[ytkit-antitranslate]').forEach(el => el.removeAttribute('ytkit-antitranslate'));
            }
        },
        {
            id: 'pauseOtherTabs',
            name: 'Pause Other Tabs on Play',
            description: 'When a video starts playing, pause YouTube in all other tabs',
            group: 'Playback',
            icon: 'pause-circle',
            _channel: null,
            _playHandler: null,

            init() {
                this._channel = new BroadcastChannel('ytkit-pause-sync');
                this._channel.onmessage = (e) => {
                    if (e.data === 'pause') {
                        const video = document.querySelector('video.html5-main-video');
                        if (video && !video.paused) {
                            video.__ytkit_pausedByBroadcast = true;
                            video.pause();
                        }
                    }
                };
                this._playHandler = () => {
                    // Clear broadcast-paused flag since user is playing in this tab now
                    const video = document.querySelector('video.html5-main-video');
                    if (video) delete video.__ytkit_pausedByBroadcast;
                    this._channel.postMessage('pause');
                };
                document.addEventListener('play', this._playHandler, true);
            },
            destroy() {
                document.removeEventListener('play', this._playHandler, true);
                this._channel?.close(); this._channel = null;
            }
        },

        // ─── v3.2.0 Wave 2: Complex & Differentiating ───

        {
            id: 'abLoop',
            name: 'A-B Loop',
            description: 'Set two points on the video timeline and loop between them. Visual markers on the progress bar.',
            group: 'Video Player',
            icon: 'repeat',
            pages: [PageTypes.WATCH],
            _pointA: null,
            _pointB: null,
            _active: false,
            _interval: null,
            _btn: null,
            _markers: null,
            _styleEl: null,

            _formatTime(secs) {
                const m = Math.floor(secs / 60);
                const s = Math.floor(secs % 60);
                return `${m}:${String(s).padStart(2, '0')}`;
            },

            _setPoint(which) {
                const video = document.querySelector('video.html5-main-video');
                if (!video) return;
                if (which === 'A') {
                    this._pointA = video.currentTime;
                    showToast(`Loop point A set at ${this._formatTime(this._pointA)}`, '#3ea6ff');
                } else {
                    this._pointB = video.currentTime;
                    showToast(`Loop point B set at ${this._formatTime(this._pointB)}`, '#3ea6ff');
                }
                if (this._pointA !== null && this._pointB !== null) {
                    if (this._pointA > this._pointB) [this._pointA, this._pointB] = [this._pointB, this._pointA];
                    this._startLoop();
                    this._updateMarkers();
                }
            },

            _startLoop() {
                this._stopLoop();
                this._active = true;
                const video = document.querySelector('video.html5-main-video');
                if (!video) return;
                this._interval = setInterval(() => {
                    if (!this._active || video.paused) return;
                    if (video.currentTime >= this._pointB) video.currentTime = this._pointA;
                }, 100);
                this._updateBtn();
                showToast(`Looping ${this._formatTime(this._pointA)} - ${this._formatTime(this._pointB)}`, '#22c55e');
            },

            _stopLoop() {
                this._active = false;
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                this._updateBtn();
            },

            _clearLoop() {
                this._stopLoop();
                this._pointA = null;
                this._pointB = null;
                this._removeMarkers();
                this._updateBtn();
                showToast('A-B Loop cleared', '#f97316');
            },

            _updateBtn() {
                if (!this._btn) return;
                this._btn.classList.toggle('ytkit-player-btn--active', this._active);
                this._btn.classList.toggle('ytkit-player-btn--warn', !this._active && this._pointA !== null);
            },

            _updateMarkers() {
                this._removeMarkers();
                const video = document.querySelector('video.html5-main-video');
                const progressBar = document.querySelector('.ytp-progress-bar');
                if (!video || !progressBar || !video.duration) return;
                this._markers = document.createElement('div');
                this._markers.className = 'ytkit-ab-markers';
                this._markers.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;';
                const aPos = (this._pointA / video.duration) * 100;
                const bPos = (this._pointB / video.duration) * 100;
                // Highlight region
                const region = document.createElement('div');
                region.style.cssText = `position:absolute;top:0;left:${aPos}%;width:${bPos - aPos}%;height:100%;background:rgba(62,166,255,0.25);border-left:2px solid #3ea6ff;border-right:2px solid #3ea6ff;`;
                this._markers.appendChild(region);
                progressBar.style.position = progressBar.style.position || 'relative';
                progressBar.appendChild(this._markers);
            },

            _removeMarkers() {
                this._markers?.remove(); this._markers = null;
            },

            _inject() {
                const controls = document.querySelector('.ytp-right-controls');
                if (!controls || controls.querySelector('.ytkit-ab-btn')) return;
                const btn = document.createElement('button');
                btn.className = 'ytp-button ytkit-player-btn ytkit-player-btn--text ytkit-ab-btn';
                btn.title = 'A-B Loop: Click=Set A, Click again=Set B, Click again=Clear';
                btn.textContent = 'A-B';
                let clickCount = 0;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    clickCount++;
                    if (clickCount === 1) this._setPoint('A');
                    else if (clickCount === 2) this._setPoint('B');
                    else { this._clearLoop(); clickCount = 0; }
                };
                controls.insertBefore(btn, controls.firstChild);
                this._btn = btn;
            },

            init() {
                this._styleEl = injectStyle('.ytkit-ab-markers { pointer-events: none; }', this.id, true);
                setTimeout(() => this._inject(), 2000);
                addNavigateRule('abLoop', () => {
                    this._clearLoop();
                    this._btn = null;
                    setTimeout(() => this._inject(), 2000);
                });
            },
            destroy() {
                removeNavigateRule('abLoop');
                this._stopLoop();
                this._removeMarkers();
                this._styleEl?.remove(); this._styleEl = null;
                this._btn?.remove(); this._btn = null;
                this._pointA = null; this._pointB = null;
            }
        },
        {
            id: 'fineSpeedControl',
            name: 'Fine Speed Control',
            description: 'Extend speed range to 0.1x-16x with 0.05x increments. Scroll on the speed badge to adjust.',
            group: 'Video Player',
            icon: 'gauge',
            pages: [PageTypes.WATCH],
            _badge: null,
            _wheelHandler: null,

            _createBadge() {
                const player = document.querySelector('#movie_player');
                if (!player || player.querySelector('.ytkit-speed-badge')) return;
                this._badge = document.createElement('div');
                this._badge.className = 'ytkit-speed-badge';
                this._badge.style.cssText = 'position:absolute;bottom:68px;right:12px;padding:4px 10px;background:rgba(0,0,0,0.75);color:#fff;font-size:13px;font-weight:600;border-radius:6px;cursor:ns-resize;z-index:100;user-select:none;transition:background 0.15s;';
                this._badge.title = 'Scroll to adjust speed (0.1x-16x)';
                this._updateBadge();
                this._wheelHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const video = document.querySelector('video.html5-main-video');
                    if (!video) return;
                    const delta = e.deltaY < 0 ? 0.05 : -0.05;
                    let newSpeed = Math.round((video.playbackRate + delta) * 100) / 100;
                    newSpeed = Math.max(0.1, Math.min(16, newSpeed));
                    video.playbackRate = newSpeed;
                    this._updateBadge();
                };
                this._badge.addEventListener('wheel', this._wheelHandler, { passive: false });
                this._badge.addEventListener('click', () => {
                    const video = document.querySelector('video.html5-main-video');
                    if (video) { video.playbackRate = 1; this._updateBadge(); }
                });
                player.appendChild(this._badge);
            },

            _updateBadge() {
                if (!this._badge) return;
                const video = document.querySelector('video.html5-main-video');
                if (!video) return;
                const rate = video.playbackRate;
                this._badge.textContent = `${rate.toFixed(2)}x`;
                this._badge.style.color = rate === 1 ? '#fff' : '#fbbf24';
            },

            init() {
                setTimeout(() => this._createBadge(), 2000);
                // Update badge when speed changes externally
                this._rateHandler = () => this._updateBadge();
                document.addEventListener('ratechange', this._rateHandler, true);
                addNavigateRule('fineSpeed', () => {
                    this._badge = null;
                    setTimeout(() => this._createBadge(), 2000);
                });
            },
            destroy() {
                removeNavigateRule('fineSpeed');
                document.removeEventListener('ratechange', this._rateHandler, true);
                this._badge?.remove(); this._badge = null;
            }
        },
        {
            id: 'showChannelVideoCount',
            name: 'Show Channel Video Count',
            description: 'Display total uploaded video count next to the channel name on watch pages',
            group: 'Watch Page',
            icon: 'hash',
            pages: [PageTypes.WATCH],

            async _inject() {
                const ownerEl = document.querySelector('ytd-video-owner-renderer #owner-sub-count, ytd-watch-metadata ytd-channel-name + yt-formatted-string');
                if (!ownerEl || ownerEl.closest('[ytkit-vid-count]')) return;
                const channelLink = document.querySelector('ytd-video-owner-renderer a, ytd-watch-metadata ytd-channel-name a');
                if (!channelLink) return;
                const channelUrl = channelLink.href;
                try {
                    const resp = await fetch(channelUrl + '/about', { credentials: 'same-origin' });
                    const html = await resp.text();
                    // YouTube embeds channel stats in ytInitialData
                    const match = html.match(/"videoCountText":\s*\{"simpleText":\s*"([^"]+)"\}/);
                    if (match) {
                        const badge = document.createElement('span');
                        badge.className = 'ytkit-channel-vid-count';
                        badge.textContent = ` · ${match[1]}`;
                        badge.style.cssText = 'color:rgba(255,255,255,0.5);font-size:12px;';
                        ownerEl.parentElement.setAttribute('ytkit-vid-count', '1');
                        ownerEl.after(badge);
                    }
                } catch {}
            },

            init() {
                setTimeout(() => this._inject(), 3000);
                addNavigateRule('channelVidCount', () => setTimeout(() => this._inject(), 3000));
            },
            destroy() {
                removeNavigateRule('channelVidCount');
                document.querySelectorAll('.ytkit-channel-vid-count').forEach(el => el.remove());
                document.querySelectorAll('[ytkit-vid-count]').forEach(el => el.removeAttribute('ytkit-vid-count'));
            }
        },
        {
            id: 'redirectHomeToSubs',
            name: 'Redirect Home to Subscriptions',
            description: 'Automatically redirect the YouTube homepage to your subscriptions feed',
            group: 'Home / Subscriptions',
            icon: 'arrow-right',
            _navHandler: null,

            _check() {
                if (window.location.pathname === '/' || window.location.pathname === '/feed/trending') {
                    window.location.replace('/feed/subscriptions');
                }
            },

            init() {
                this._check();
                this._navHandler = () => setTimeout(() => this._check(), 100);
                document.addEventListener('yt-navigate-finish', this._navHandler);
            },
            destroy() {
                document.removeEventListener('yt-navigate-finish', this._navHandler);
            }
        },
        {
            id: 'notInterestedButton',
            name: '"Not Interested" on Thumbnails',
            description: 'Add an X button on video thumbnails to quickly dismiss videos via YouTube\'s feedback API',
            group: 'Content',
            icon: 'x-circle',
            _styleEl: null,

            _process() {
                document.querySelectorAll('ytd-rich-item-renderer:not([ytkit-ni-btn]), ytd-video-renderer:not([ytkit-ni-btn])').forEach(item => {
                    item.setAttribute('ytkit-ni-btn', '1');
                    const thumbnail = item.querySelector('ytd-thumbnail, a#thumbnail');
                    if (!thumbnail) return;
                    const btn = document.createElement('button');
                    btn.className = 'ytkit-not-interested-btn';
                    btn.title = 'Not interested';
                    btn.textContent = '\u00D7';
                    btn.style.cssText = `position:absolute;top:4px;left:4px;width:24px;height:24px;border:none;border-radius:50%;background:rgba(0,0,0,0.7);color:#fff;font-size:16px;line-height:24px;text-align:center;cursor:pointer;z-index:${Z.HIDE_BTN};opacity:0;transition:opacity 0.2s;padding:0;`;
                    thumbnail.style.position = thumbnail.style.position || 'relative';
                    thumbnail.appendChild(btn);

                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Try YouTube's native "Not Interested" via the three-dot menu
                        const menuBtn = item.querySelector('ytd-menu-renderer yt-icon-button, ytd-menu-renderer button');
                        if (menuBtn) {
                            menuBtn.click();
                            requestAnimationFrame(() => {
                                const notIntItem = document.querySelector('ytd-menu-service-item-renderer:has(yt-formatted-string), tp-yt-paper-listbox ytd-menu-service-item-renderer');
                                const items = document.querySelectorAll('ytd-menu-service-item-renderer yt-formatted-string, tp-yt-paper-listbox ytd-menu-service-item-renderer yt-formatted-string');
                                for (const i of items) {
                                    if (i.textContent.toLowerCase().includes('not interested')) {
                                        i.closest('ytd-menu-service-item-renderer')?.click();
                                        break;
                                    }
                                }
                                // Close menu if it's still open
                                document.querySelector('tp-yt-iron-dropdown[aria-hidden="false"]')?.setAttribute('aria-hidden', 'true');
                            });
                        }
                        // Visually dismiss immediately
                        item.style.transition = 'opacity 0.3s, transform 0.3s';
                        item.style.opacity = '0';
                        item.style.transform = 'scale(0.9)';
                        setTimeout(() => { item.style.display = 'none'; }, 300);
                        showToast('Dismissed', '#3ea6ff');
                    };
                });
            },

            init() {
                const css = `ytd-rich-item-renderer:hover .ytkit-not-interested-btn, ytd-video-renderer:hover .ytkit-not-interested-btn { opacity: 1 !important; } .ytkit-not-interested-btn:hover { background: rgba(239,68,68,0.9) !important; transform: scale(1.1); }`;
                this._styleEl = injectStyle(css, this.id, true);
                this._process();
                addMutationRule(this.id, () => this._process());
                addNavigateRule('notInterested', () => this._process());
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule('notInterested');
                this._styleEl?.remove(); this._styleEl = null;
                document.querySelectorAll('.ytkit-not-interested-btn').forEach(el => el.remove());
                document.querySelectorAll('[ytkit-ni-btn]').forEach(el => el.removeAttribute('ytkit-ni-btn'));
            }
        },
        {
            id: 'timestampBookmarks',
            name: 'Timestamp Bookmarks',
            description: 'Bookmark moments in videos with custom notes. Click a bookmark to seek. Persists across sessions.',
            group: 'Watch Page',
            icon: 'bookmark',
            pages: [PageTypes.WATCH],
            _storageKey: 'ytkit-bookmarks',
            _panel: null,
            _btn: null,

            _getBookmarks() { return StorageManager.get(this._storageKey, {}); },

            _formatTime(secs) {
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                const s = Math.floor(secs % 60);
                return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
            },

            _addBookmark() {
                const video = document.querySelector('video.html5-main-video');
                const videoId = getVideoId();
                if (!video || !videoId) return;
                const time = Math.floor(video.currentTime);
                const bookmarks = this._getBookmarks();
                if (!bookmarks[videoId]) bookmarks[videoId] = [];
                // Check for duplicate within 2 seconds
                if (bookmarks[videoId].some(b => Math.abs(b.t - time) < 2)) {
                    showToast('Bookmark already exists here', '#f97316'); return;
                }
                bookmarks[videoId].push({ t: time, n: '', d: Date.now() });
                bookmarks[videoId].sort((a, b) => a.t - b.t);
                StorageManager.set(this._storageKey, bookmarks);
                this._renderPanel();
                showToast(`Bookmarked at ${this._formatTime(time)}`, '#22c55e');
            },

            _deleteBookmark(videoId, index) {
                const bookmarks = this._getBookmarks();
                if (!bookmarks[videoId]) return;
                bookmarks[videoId].splice(index, 1);
                if (bookmarks[videoId].length === 0) delete bookmarks[videoId];
                StorageManager.set(this._storageKey, bookmarks);
                this._renderPanel();
            },

            _renderPanel() {
                if (!this._panel) return;
                const videoId = getVideoId();
                const bookmarks = this._getBookmarks();
                const list = bookmarks[videoId] || [];
                this._panel.textContent = '';
                if (list.length === 0) {
                    const empty = document.createElement('div');
                    empty.textContent = 'No bookmarks for this video';
                    empty.style.cssText = 'color:rgba(255,255,255,0.4);font-size:12px;text-align:center;padding:12px;';
                    this._panel.appendChild(empty);
                    return;
                }
                list.forEach((bm, idx) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;cursor:pointer;transition:background 0.15s;';
                    row.onmouseenter = () => { row.style.background = 'rgba(255,255,255,0.08)'; };
                    row.onmouseleave = () => { row.style.background = ''; };
                    const ts = document.createElement('span');
                    ts.textContent = this._formatTime(bm.t);
                    ts.style.cssText = 'color:#3ea6ff;font-size:12px;font-weight:600;min-width:48px;';
                    const note = document.createElement('input');
                    note.type = 'text';
                    note.value = bm.n || '';
                    note.placeholder = 'Add note...';
                    note.style.cssText = 'flex:1;background:transparent;border:none;color:#fff;font-size:12px;outline:none;padding:2px 4px;';
                    note.onclick = (e) => e.stopPropagation();
                    note.onchange = () => {
                        const bks = this._getBookmarks();
                        if (bks[videoId]?.[idx]) { bks[videoId][idx].n = note.value; StorageManager.set(this._storageKey, bks); }
                    };
                    const del = document.createElement('button');
                    del.textContent = '\u00D7';
                    del.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);font-size:16px;cursor:pointer;padding:0 4px;';
                    del.onclick = (e) => { e.stopPropagation(); this._deleteBookmark(videoId, idx); };
                    row.onclick = () => {
                        const video = document.querySelector('video.html5-main-video');
                        if (video) video.currentTime = bm.t;
                    };
                    row.appendChild(ts);
                    row.appendChild(note);
                    row.appendChild(del);
                    this._panel.appendChild(row);
                });
            },

            _inject() {
                const secondary = document.querySelector('#secondary-inner, #below');
                if (!secondary || secondary.querySelector('.ytkit-bookmarks-container')) return;

                const container = document.createElement('div');
                container.className = 'ytkit-bookmarks-container';
                container.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;margin-bottom:12px;overflow:hidden;';

                const header = document.createElement('div');
                header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.08);';
                const title = document.createElement('span');
                title.textContent = 'Bookmarks';
                title.style.cssText = 'color:rgba(255,255,255,0.7);font-size:13px;font-weight:600;';
                const addBtn = document.createElement('button');
                addBtn.textContent = '+ Add';
                addBtn.style.cssText = 'background:rgba(62,166,255,0.15);color:#3ea6ff;border:none;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;transition:background 0.15s;';
                addBtn.onmouseenter = () => { addBtn.style.background = 'rgba(62,166,255,0.25)'; };
                addBtn.onmouseleave = () => { addBtn.style.background = 'rgba(62,166,255,0.15)'; };
                addBtn.onclick = () => this._addBookmark();
                header.appendChild(title);
                header.appendChild(addBtn);

                this._panel = document.createElement('div');
                this._panel.style.cssText = 'max-height:200px;overflow-y:auto;padding:4px 0;';

                container.appendChild(header);
                container.appendChild(this._panel);
                secondary.insertBefore(container, secondary.firstChild);
                this._renderPanel();
            },

            init() {
                setTimeout(() => this._inject(), 2500);
                addNavigateRule('bookmarks', () => {
                    this._panel = null;
                    setTimeout(() => this._inject(), 2500);
                });
            },
            destroy() {
                removeNavigateRule('bookmarks');
                this._panel = null;
                document.querySelectorAll('.ytkit-bookmarks-container').forEach(el => el.remove());
            }
        },
        {
            id: 'blueLightFilter',
            name: 'Blue Light Filter',
            description: 'Apply a warm tint to reduce blue light emission. Configurable intensity.',
            group: 'Theme',
            icon: 'sun',
            type: 'range',
            rangeMin: 10,
            rangeMax: 80,
            rangeStep: 5,
            settingKey: 'blueLightIntensity',
            _overlay: null,

            _apply() {
                const intensity = (appState.settings.blueLightIntensity || 30) / 100;
                if (!this._overlay) {
                    this._overlay = document.createElement('div');
                    this._overlay.className = 'ytkit-blue-light-filter';
                    this._overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483646;mix-blend-mode:multiply;transition:background 0.3s;`;
                    document.documentElement.appendChild(this._overlay);
                }
                // Warm orange tint that blocks blue light
                this._overlay.style.background = `rgba(255, ${Math.round(180 - intensity * 80)}, ${Math.round(60 - intensity * 60)}, ${intensity * 0.35})`;
            },

            init() {
                this._apply();
                this._settingsHandler = () => this._apply();
                document.addEventListener('ytkit-settings-changed', this._settingsHandler);
            },
            destroy() {
                document.removeEventListener('ytkit-settings-changed', this._settingsHandler);
                this._overlay?.remove(); this._overlay = null;
            }
        },
        {
            id: 'disableInfiniteScroll',
            name: 'Disable Infinite Scroll',
            description: 'Replace infinite scroll with a "Load More" button on home, search, and subscriptions pages',
            group: 'Home / Subscriptions',
            icon: 'list-end',
            pages: [PageTypes.HOME, PageTypes.SEARCH, PageTypes.SUBSCRIPTIONS],
            _observer: null,
            _styleEl: null,

            _process() {
                const continuations = document.querySelectorAll('ytd-continuation-item-renderer:not([ytkit-load-more])');
                continuations.forEach(cont => {
                    cont.setAttribute('ytkit-load-more', '1');
                    // Hide the spinner
                    cont.style.visibility = 'hidden';
                    cont.style.height = '0';
                    cont.style.overflow = 'hidden';

                    // Prevent IntersectionObserver from triggering auto-load
                    const spinner = cont.querySelector('tp-yt-paper-spinner, yt-next-continuation');
                    if (spinner) spinner.style.display = 'none';

                    // Add Load More button
                    const wrapper = document.createElement('div');
                    wrapper.className = 'ytkit-load-more-wrapper';
                    wrapper.style.cssText = 'display:flex;justify-content:center;padding:20px;';
                    const btn = document.createElement('button');
                    btn.className = 'ytkit-load-more-btn';
                    btn.textContent = 'Load More';
                    btn.style.cssText = 'padding:10px 32px;border:1px solid rgba(255,255,255,0.2);border-radius:20px;background:rgba(255,255,255,0.06);color:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s;';
                    btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.12)'; btn.style.borderColor = 'rgba(255,255,255,0.3)'; };
                    btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.borderColor = 'rgba(255,255,255,0.2)'; };
                    btn.onclick = () => {
                        // Restore the continuation element so YouTube loads the next page
                        cont.style.visibility = '';
                        cont.style.height = '';
                        cont.style.overflow = '';
                        if (spinner) spinner.style.display = '';
                        wrapper.remove();
                        // Scroll it into view to trigger YouTube's intersection observer
                        cont.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    };
                    wrapper.appendChild(btn);
                    cont.parentElement.insertBefore(wrapper, cont);
                });
            },

            init() {
                this._styleEl = injectStyle('ytd-continuation-item-renderer[ytkit-load-more] { visibility: hidden !important; height: 0 !important; overflow: hidden !important; }', this.id, true);
                setTimeout(() => this._process(), 2000);
                addMutationRule(this.id, () => this._process());
                addNavigateRule('infiniteScroll', () => setTimeout(() => this._process(), 2000));
            },
            destroy() {
                removeMutationRule(this.id);
                removeNavigateRule('infiniteScroll');
                this._styleEl?.remove(); this._styleEl = null;
                document.querySelectorAll('.ytkit-load-more-wrapper').forEach(el => el.remove());
                document.querySelectorAll('[ytkit-load-more]').forEach(el => {
                    el.removeAttribute('ytkit-load-more');
                    el.style.visibility = ''; el.style.height = ''; el.style.overflow = '';
                    const spinner = el.querySelector('tp-yt-paper-spinner, yt-next-continuation');
                    if (spinner) spinner.style.display = '';
                });
            }
        },
        {
            id: 'popOutPlayer',
            name: 'Pop-Out Player',
            description: 'Detach the video into a resizable floating Picture-in-Picture window with transport controls',
            group: 'Video Player',
            icon: 'external-link',
            pages: [PageTypes.WATCH],
            _btn: null,
            _pipWindow: null,

            async _activate() {
                const video = document.querySelector('video.html5-main-video');
                if (!video) { showToast('No video found', '#ef4444'); return; }
                // Try Document PiP API first (Chrome 116+)
                if ('documentPictureInPicture' in window) {
                    try {
                        this._pipWindow = await window.documentPictureInPicture.requestWindow({
                            width: Math.round(video.videoWidth * 0.5) || 640,
                            height: Math.round(video.videoHeight * 0.5) || 360
                        });
                        // Style the PiP window
                        const style = this._pipWindow.document.createElement('style');
                        style.textContent = 'body{margin:0;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;} video{width:100%;height:100%;object-fit:contain;} .controls{position:fixed;bottom:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:8px 12px;background:linear-gradient(transparent,rgba(0,0,0,0.8));opacity:0;transition:opacity 0.2s;} body:hover .controls{opacity:1;} button{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:4px 8px;} .time{color:rgba(255,255,255,0.7);font-size:12px;font-family:monospace;margin-left:auto;}';
                        this._pipWindow.document.head.appendChild(style);
                        // Move video to PiP window
                        const origParent = video.parentElement;
                        const origNext = video.nextSibling;
                        this._pipWindow.document.body.appendChild(video);
                        // Add controls
                        const controls = this._pipWindow.document.createElement('div');
                        controls.className = 'controls';
                        const playBtn = this._pipWindow.document.createElement('button');
                        playBtn.textContent = '\u23F8';
                        playBtn.onclick = () => {
                            if (video.paused) { video.play(); playBtn.textContent = '\u23F8'; }
                            else { video.pause(); playBtn.textContent = '\u25B6'; }
                        };
                        const timeEl = this._pipWindow.document.createElement('span');
                        timeEl.className = 'time';
                        setInterval(() => {
                            const c = Math.floor(video.currentTime);
                            const d = Math.floor(video.duration || 0);
                            const fmt = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
                            timeEl.textContent = `${fmt(c)} / ${fmt(d)}`;
                        }, 500);
                        controls.appendChild(playBtn);
                        controls.appendChild(timeEl);
                        this._pipWindow.document.body.appendChild(controls);
                        // Return video on close
                        this._pipWindow.addEventListener('pagehide', () => {
                            if (origNext) origParent.insertBefore(video, origNext);
                            else origParent.appendChild(video);
                            this._pipWindow = null;
                        });
                        window.__ytkit_videoPopped = true;
                        // Clear flag when video returns
                        this._pipWindow.addEventListener('pagehide', () => { window.__ytkit_videoPopped = false; });
                        showToast('Video popped out', '#22c55e');
                        return;
                    } catch(e) { DebugManager.log('PopOut', 'Document PiP failed: ' + e.message); }
                }
                // Fallback to standard PiP API
                try {
                    await video.requestPictureInPicture();
                    window.__ytkit_videoPopped = true;
                    video.addEventListener('leavepictureinpicture', () => { window.__ytkit_videoPopped = false; }, { once: true });
                    showToast('Picture-in-Picture active', '#22c55e');
                } catch(e) {
                    showToast('PiP not supported', '#ef4444');
                }
            },

            _inject() {
                const controls = document.querySelector('.ytp-right-controls');
                if (!controls || controls.querySelector('.ytkit-popout-btn')) return;
                const btn = document.createElement('button');
                btn.className = 'ytp-button ytkit-player-btn ytkit-popout-btn';
                btn.title = 'Pop-out Player (YTKit)';
                TrustedHTML.setHTML(btn, '<svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>');
                btn.onclick = (e) => { e.stopPropagation(); this._activate(); };
                controls.insertBefore(btn, controls.firstChild);
                this._btn = btn;
            },

            init() {
                setTimeout(() => this._inject(), 2000);
                addNavigateRule('popOut', () => { this._btn = null; setTimeout(() => this._inject(), 2000); });
            },
            destroy() {
                removeNavigateRule('popOut');
                this._btn?.remove(); this._btn = null;
                // Close any open PiP window
                if (this._pipWindow) { try { this._pipWindow.close(); } catch {} this._pipWindow = null; }
            }
        },

        // ─── v3.2.0 Wave 3: Audio EQ, Watch Tracking, Player Polish ───

        {
            id: 'watchTimeTracker',
            name: 'Watch Time Tracker',
            description: 'Track your daily/weekly YouTube watch time with a stats widget in the settings panel',
            group: 'Watch Page',
            icon: 'timer',
            _storageKey: 'ytkit-watch-time',
            _interval: null,
            _lastTick: null,

            _getStats() { return StorageManager.get(this._storageKey, { days: {}, total: 0 }); },

            _todayKey() {
                const d = new Date();
                return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            },

            _tick() {
                const video = document.querySelector('video.html5-main-video');
                if (!video || video.paused || video.ended) { this._lastTick = null; return; }
                const now = Date.now();
                if (this._lastTick) {
                    const elapsed = Math.min((now - this._lastTick) / 1000, 15);
                    const stats = this._getStats();
                    const key = this._todayKey();
                    if (!stats.days[key]) stats.days[key] = 0;
                    stats.days[key] += elapsed;
                    stats.total = (stats.total || 0) + elapsed;
                    // Prune days older than 90 days
                    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
                    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,'0')}-${String(cutoff.getDate()).padStart(2,'0')}`;
                    for (const dk in stats.days) { if (dk < cutoffKey) delete stats.days[dk]; }
                    StorageManager.set(this._storageKey, stats);
                }
                this._lastTick = now;
            },

            _formatDuration(secs) {
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                if (h > 0) return `${h}h ${m}m`;
                return `${m}m`;
            },

            // Called by settings panel to render stats
            getStatsHtml() {
                const stats = this._getStats();
                const today = stats.days[this._todayKey()] || 0;
                // Last 7 days
                const weekKeys = [];
                for (let i = 0; i < 7; i++) {
                    const d = new Date(); d.setDate(d.getDate() - i);
                    weekKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
                }
                const weekTotal = weekKeys.reduce((sum, k) => sum + (stats.days[k] || 0), 0);
                return `Today: ${this._formatDuration(today)} | This week: ${this._formatDuration(weekTotal)} | All time: ${this._formatDuration(stats.total || 0)}`;
            },

            init() {
                this._interval = setInterval(() => this._tick(), 10000);
            },
            destroy() {
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                this._lastTick = null;
            }
        },
        cssFeature('alwaysShowProgressBar', 'Always Show Progress Bar', 'Keep the video progress bar visible at all times instead of hiding on idle', 'Watch Page', 'minus',
            `.ytp-autohide .ytp-chrome-bottom { opacity: 1 !important; visibility: visible !important; } .ytp-autohide .ytp-progress-bar-container { opacity: 1 !important; bottom: 0 !important; }`),
        {
            id: 'sortCommentsNewest',
            name: 'Sort Comments Newest First',
            description: 'Automatically switch the comment sort order to "Newest first" on every video',
            group: 'Comments',
            icon: 'arrow-down',
            pages: [PageTypes.WATCH],

            _sort() {
                // YouTube's sort menu: click the sort button, then select "Newest first"
                const sortMenu = document.querySelector('#comments #sort-menu tp-yt-paper-button, #comments #sort-menu yt-sort-filter-sub-menu-renderer tp-yt-paper-button, #comments [slot="toolbar"] tp-yt-paper-button');
                if (!sortMenu) return;
                // Check if already set to newest
                const activeSort = sortMenu.textContent?.trim()?.toLowerCase();
                if (activeSort?.includes('newest')) return;
                sortMenu.click();
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        const options = document.querySelectorAll('tp-yt-paper-listbox a, tp-yt-paper-listbox tp-yt-paper-item');
                        for (const opt of options) {
                            if (opt.textContent?.trim()?.toLowerCase()?.includes('newest')) {
                                opt.click();
                                DebugManager.log('SortComments', 'Switched to newest first');
                                break;
                            }
                        }
                    }, 200);
                });
            },

            init() {
                addNavigateRule('sortComments', () => setTimeout(() => this._sort(), 4000));
                setTimeout(() => this._sort(), 4000);
            },
            destroy() { removeNavigateRule('sortComments'); }
        },
        {
            id: 'autoSkipChapters',
            name: 'Auto-Skip Chapters',
            description: 'Automatically skip chapters matching patterns (intro, outro, recap, sponsor). Comma-separated.',
            group: 'Watch Page',
            icon: 'skip-forward',
            pages: [PageTypes.WATCH],
            type: 'textarea',
            settingKey: 'autoSkipChapterPatterns',
            _interval: null,
            _skippedAt: null,

            _getChapters() {
                const chapters = [];
                document.querySelectorAll('ytd-macro-markers-list-item-renderer, .ytp-chapter-hover-container').forEach(el => {
                    const title = el.querySelector('.macro-markers-list-item-text, .ytp-chapter-title-content')?.textContent?.trim();
                    const time = el.querySelector('.macro-markers-list-item-time, .ytp-chapter-timestamp-content')?.textContent?.trim();
                    if (title && time) {
                        const parts = time.split(':').map(Number);
                        let secs = 0;
                        if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
                        else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
                        chapters.push({ title: title.toLowerCase(), time: secs });
                    }
                });
                return chapters.sort((a, b) => a.time - b.time);
            },

            _check() {
                const video = document.querySelector('video.html5-main-video');
                if (!video || video.paused || !video.duration) return;
                const patterns = (appState.settings.autoSkipChapterPatterns || 'intro,outro,recap,sponsor')
                    .split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
                if (patterns.length === 0) return;

                const chapters = this._getChapters();
                if (chapters.length === 0) return;
                const currentTime = video.currentTime;

                for (let i = 0; i < chapters.length; i++) {
                    const ch = chapters[i];
                    const nextTime = chapters[i + 1]?.time || video.duration;
                    // Is the current time within this chapter?
                    if (currentTime >= ch.time && currentTime < nextTime - 1) {
                        // Does this chapter match a skip pattern?
                        const shouldSkip = patterns.some(p => ch.title.includes(p));
                        if (shouldSkip && this._skippedAt !== ch.time) {
                            this._skippedAt = ch.time;
                            video.currentTime = nextTime;
                            showToast(`Skipped: "${ch.title}"`, '#f97316', { duration: 3 });
                            DebugManager.log('AutoSkipChapter', `Skipped "${ch.title}" at ${ch.time}s`);
                        }
                        break;
                    }
                }
            },

            init() {
                this._interval = setInterval(() => this._check(), 1000);
                addNavigateRule('autoSkipCh', () => { this._skippedAt = null; });
            },
            destroy() {
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                removeNavigateRule('autoSkipCh');
            }
        },
        {
            id: 'chapterNavButtons',
            name: 'Chapter Navigation',
            description: 'Add Previous/Next Chapter buttons to the video player controls',
            group: 'Watch Page',
            icon: 'skip-forward',
            pages: [PageTypes.WATCH],
            _prevBtn: null,
            _nextBtn: null,

            _getChapterTimes() {
                const times = [];
                document.querySelectorAll('.ytp-chapter-hover-container, ytd-macro-markers-list-item-renderer').forEach(el => {
                    const timeEl = el.querySelector('.ytp-chapter-timestamp-content, .macro-markers-list-item-time');
                    if (timeEl) {
                        const parts = timeEl.textContent.trim().split(':').map(Number);
                        let secs = 0;
                        if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
                        else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
                        times.push(secs);
                    }
                });
                // Also try progress bar markers
                if (times.length === 0) {
                    document.querySelectorAll('.ytp-progress-bar .ytp-chapter-hover-container').forEach(el => {
                        const style = el.style.left;
                        // Can't reliably get time from left percentage without duration
                    });
                }
                return [...new Set(times)].sort((a, b) => a - b);
            },

            _navigate(direction) {
                const video = document.querySelector('video.html5-main-video');
                if (!video) return;
                const chapters = this._getChapterTimes();
                if (chapters.length === 0) { showToast('No chapters found', '#f97316'); return; }
                const current = video.currentTime;
                if (direction === 'next') {
                    const next = chapters.find(t => t > current + 2);
                    if (next !== undefined) video.currentTime = next;
                    else showToast('Last chapter', '#f97316');
                } else {
                    const prev = [...chapters].reverse().find(t => t < current - 3);
                    if (prev !== undefined) video.currentTime = prev;
                    else video.currentTime = chapters[0];
                }
            },

            _inject() {
                const controls = document.querySelector('.ytp-left-controls');
                if (!controls || controls.querySelector('.ytkit-chapter-nav')) return;
                const makeBtn = (label, dir) => {
                    const btn = document.createElement('button');
                    btn.className = 'ytp-button ytkit-player-btn ytkit-player-btn--text ytkit-chapter-nav';
                    btn.title = `${label} Chapter`;
                    btn.textContent = dir === 'prev' ? '|<' : '>|';
                    btn.onclick = (e) => { e.stopPropagation(); this._navigate(dir); };
                    return btn;
                };
                this._prevBtn = makeBtn('Previous', 'prev');
                this._nextBtn = makeBtn('Next', 'next');
                // Insert after the next button or at the end
                const nextBtn = controls.querySelector('.ytp-next-button');
                if (nextBtn?.nextSibling) {
                    controls.insertBefore(this._prevBtn, nextBtn.nextSibling);
                    controls.insertBefore(this._nextBtn, this._prevBtn.nextSibling);
                } else {
                    controls.appendChild(this._prevBtn);
                    controls.appendChild(this._nextBtn);
                }
            },

            init() {
                setTimeout(() => this._inject(), 2500);
                addNavigateRule('chapterNav', () => {
                    this._prevBtn = null; this._nextBtn = null;
                    setTimeout(() => this._inject(), 2500);
                });
            },
            destroy() {
                removeNavigateRule('chapterNav');
                this._prevBtn?.remove(); this._nextBtn?.remove();
                this._prevBtn = null; this._nextBtn = null;
            }
        },
        {
            id: 'videoLoopButton',
            name: 'Video Loop Button',
            description: 'Add a loop toggle button to the player controls for one-click video looping',
            group: 'Video Player',
            icon: 'repeat',
            pages: [PageTypes.WATCH],
            _btn: null,

            _inject() {
                const controls = document.querySelector('.ytp-right-controls');
                if (!controls || controls.querySelector('.ytkit-loop-btn')) return;
                const btn = document.createElement('button');
                btn.className = 'ytp-button ytkit-player-btn ytkit-loop-btn';
                btn.title = 'Toggle Loop';
                TrustedHTML.setHTML(btn, '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>');
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const video = document.querySelector('video.html5-main-video');
                    if (video) {
                        video.loop = !video.loop;
                        btn.classList.toggle('ytkit-player-btn--active', video.loop);
                        showToast(video.loop ? 'Loop enabled' : 'Loop disabled', video.loop ? '#22c55e' : '#f97316');
                    }
                };
                controls.insertBefore(btn, controls.firstChild);
                this._btn = btn;
            },

            init() {
                setTimeout(() => this._inject(), 2000);
                addNavigateRule('loopBtn', () => { this._btn = null; setTimeout(() => this._inject(), 2000); });
            },
            destroy() {
                removeNavigateRule('loopBtn');
                const video = document.querySelector('video.html5-main-video');
                if (video) video.loop = false;
                this._btn?.remove(); this._btn = null;
            }
        },
        {
            id: 'persistentSpeed',
            name: 'Persistent Playback Speed',
            description: 'Remember your preferred playback speed globally and auto-apply it to every video',
            group: 'Video Player',
            icon: 'gauge',
            pages: [PageTypes.WATCH],
            type: 'select',
            options: {
                '1': '1x (Normal)', '0.5': '0.5x', '0.75': '0.75x',
                '1.25': '1.25x', '1.5': '1.5x', '1.75': '1.75x',
                '2': '2x', '2.5': '2.5x', '3': '3x'
            },
            settingKey: 'persistentSpeedValue',
            _applied: false,

            _apply() {
                if (this._applied) return;
                const video = document.querySelector('video.html5-main-video');
                if (!video) return;
                const speed = parseFloat(appState.settings.persistentSpeedValue) || 1;
                if (speed !== 1 && speed !== video.playbackRate) {
                    video.playbackRate = speed;
                    DebugManager.log('PersistentSpeed', `Applied ${speed}x`);
                }
                this._applied = true;
            },

            init() {
                setTimeout(() => this._apply(), 2500);
                addNavigateRule('persistSpeed', () => { this._applied = false; setTimeout(() => this._apply(), 2500); });
            },
            destroy() { removeNavigateRule('persistSpeed'); }
        },
        {
            id: 'codecSelector',
            name: 'Codec Selector',
            description: 'Choose which video codec to prefer: Auto, H.264 (low CPU), VP9, or AV1 (best quality). Shares codec engine with Force H.264.',
            group: 'Video Player',
            icon: 'cpu',
            type: 'select',
            options: {
                'auto': 'Auto (YouTube decides)',
                'h264': 'Force H.264 (AVC)',
                'vp9': 'Force VP9',
                'av1': 'Force AV1'
            },
            settingKey: 'codecSelector',

            init() {
                const codec = appState.settings.codecSelector || 'auto';
                if (codec === 'auto' && !appState.settings.forceH264) return;
                // Use shared codec patch — same engine as forceH264
                if (!HTMLVideoElement.prototype.__ytkit_codecPatched) {
                    const videoProto = HTMLVideoElement.prototype;
                    videoProto.__ytkit_origCanPlayType = videoProto.canPlayType;
                    videoProto.__ytkit_codecPatched = true;
                    videoProto.canPlayType = function(type) {
                        const currentCodec = appState.settings.codecSelector || 'auto';
                        const forceH264 = appState.settings.forceH264;
                        const effective = forceH264 ? 'h264' : currentCodec;
                        if (effective === 'auto') return videoProto.__ytkit_origCanPlayType.call(this, type);
                        if (effective === 'h264' && /vp0?9|av01/i.test(type)) return '';
                        if (effective === 'vp9') {
                            if (/av01/i.test(type)) return '';
                            if (/avc1/i.test(type) && !/vp0?9/i.test(type)) return '';
                        }
                        if (effective === 'av1') {
                            if (/vp0?9|avc1/i.test(type) && !/av01/i.test(type)) return '';
                        }
                        return videoProto.__ytkit_origCanPlayType.call(this, type);
                    };
                }
                DebugManager.log('Codec', `Codec selector: ${codec}`);
            },
            destroy() {
                // Only restore if forceH264 is not also active
                if (!appState.settings.forceH264) {
                    if (HTMLVideoElement.prototype.__ytkit_origCanPlayType) {
                        HTMLVideoElement.prototype.canPlayType = HTMLVideoElement.prototype.__ytkit_origCanPlayType;
                        delete HTMLVideoElement.prototype.__ytkit_origCanPlayType;
                        delete HTMLVideoElement.prototype.__ytkit_codecPatched;
                    }
                }
            }
        },
        {
            id: 'ageRestrictionBypass',
            name: 'Age Restriction Bypass',
            description: 'Bypass age verification by fetching video data from YouTube\'s embed endpoint. No sign-in required.',
            group: 'Playback',
            icon: 'shield-off',
            pages: [PageTypes.WATCH],

            async _bypass() {
                // Check if the page shows an age gate
                const ageGate = document.querySelector('ytd-player-error-message-renderer, .ytd-enforcement-type-age-gate, ytd-playability-error-with-button-renderer, [class*="age-gate"]');
                if (!ageGate) return;
                const loginPrompt = document.querySelector('#reason, .yt-playability-error-supported-renderers');
                if (!loginPrompt?.textContent?.toLowerCase()?.includes('sign in') && !loginPrompt?.textContent?.toLowerCase()?.includes('age')) return;

                const videoId = getVideoId();
                if (!videoId) return;
                DebugManager.log('AgeBypass', `Attempting bypass for ${videoId}`);

                try {
                    // Fetch from embed endpoint — doesn't require authentication
                    const resp = await fetch(`https://www.youtube.com/embed/${videoId}`, { credentials: 'omit' });
                    const html = await resp.text();
                    // Extract embedded player config
                    const configMatch = html.match(/ytcfg\.set\((\{[^}]+\})\)/);
                    if (!configMatch) { DebugManager.log('AgeBypass', 'No config found in embed'); return; }

                    // Use the embed page to get the video URL and redirect to embedded player
                    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
                    const player = document.querySelector('#player-container, #player');
                    if (player) {
                        // Replace player with embedded iframe
                        const iframe = document.createElement('iframe');
                        iframe.src = embedUrl;
                        iframe.style.cssText = 'width:100%;height:100%;border:none;';
                        iframe.setAttribute('allowfullscreen', '');
                        iframe.setAttribute('allow', 'autoplay; encrypted-media');
                        player.textContent = '';
                        player.appendChild(iframe);
                        // Hide the error message
                        if (ageGate) ageGate.style.display = 'none';
                        showToast('Age restriction bypassed', '#22c55e');
                    }
                } catch(e) { DebugManager.log('AgeBypass', 'Failed: ' + e.message); }
            },

            init() {
                setTimeout(() => this._bypass(), 3000);
                addNavigateRule('ageBypass', () => setTimeout(() => this._bypass(), 3000));
            },
            destroy() { removeNavigateRule('ageBypass'); }
        },
        {
            id: 'autoLikeSubscribed',
            name: 'Auto-Like Subscribed Channels',
            description: 'Automatically like videos from channels you\'re subscribed to after watching for 30 seconds',
            group: 'Watch Page',
            icon: 'thumbs-up',
            pages: [PageTypes.WATCH],
            _timeout: null,
            _liked: false,

            _isSubscribed() {
                const subBtn = document.querySelector('ytd-subscribe-button-renderer button, #subscribe-button tp-yt-paper-button, ytd-watch-metadata ytd-subscribe-button-renderer');
                if (!subBtn) return false;
                // Check if the button says "Subscribed" (not "Subscribe")
                const text = subBtn.textContent?.trim()?.toLowerCase() || '';
                const ariaLabel = subBtn.getAttribute('aria-label')?.toLowerCase() || '';
                return text.includes('subscribed') || ariaLabel.includes('unsubscribe') || subBtn.hasAttribute('subscribed');
            },

            _like() {
                if (this._liked) return;
                if (!this._isSubscribed()) return;
                // Find and click the like button
                const selectors = [
                    'like-button-view-model button',
                    '#segmented-like-button button',
                    'ytd-toggle-button-renderer.style-scope.ytd-menu-renderer button[aria-label*="like" i]',
                    'ytd-segmented-like-dislike-button-renderer button[aria-label*="like" i]:not([aria-label*="dislike" i])'
                ];
                for (const sel of selectors) {
                    const btn = document.querySelector(sel);
                    if (btn) {
                        const pressed = btn.getAttribute('aria-pressed');
                        if (pressed === 'true') { this._liked = true; return; } // Already liked
                        btn.click();
                        this._liked = true;
                        DebugManager.log('AutoLike', 'Auto-liked video');
                        return;
                    }
                }
            },

            init() {
                addNavigateRule('autoLike', () => {
                    this._liked = false;
                    if (this._timeout) clearTimeout(this._timeout);
                    this._timeout = setTimeout(() => this._like(), 30000);
                });
                this._timeout = setTimeout(() => this._like(), 30000);
            },
            destroy() {
                removeNavigateRule('autoLike');
                if (this._timeout) { clearTimeout(this._timeout); this._timeout = null; }
            }
        },
        {
            id: 'thumbnailPreviewSize',
            name: 'Large Thumbnail Previews',
            description: 'Increase the size of thumbnail hover previews for easier viewing on large screens',
            group: 'Content',
            icon: 'maximize',
            _styleEl: null,

            init() {
                const css = `
                    ytd-rich-item-renderer ytd-thumbnail { min-height: 180px !important; }
                    ytd-rich-item-renderer ytd-thumbnail img { object-fit: cover !important; }
                    ytd-moving-thumbnail-renderer { transform: scale(1.1) !important; transform-origin: center !important; z-index: 50 !important; transition: transform 0.2s ease !important; }
                    ytd-rich-item-renderer:hover ytd-moving-thumbnail-renderer { transform: scale(1.15) !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },

        // ═══════════════════════════════════════════════════════════════
        // ═══ WAVE 4 — Polish & Deep Enhancement ═══════════════════════
        // ═══════════════════════════════════════════════════════════════

        {
            id: 'cinemaAmbientGlow',
            name: 'Cinema Ambient Glow',
            description: 'Projects dominant video colors as a soft glow behind the player for an immersive cinema feel',
            group: 'Video Player',
            icon: 'monitor',
            _canvas: null,
            _ctx: null,
            _glowEl: null,
            _raf: null,
            _active: false,

            _setup() {
                const player = document.querySelector('#movie_player');
                const video = document.querySelector('video');
                if (!player || !video) return;
                if (this._glowEl) return;

                this._canvas = document.createElement('canvas');
                this._canvas.width = 8;
                this._canvas.height = 8;
                this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });

                this._glowEl = document.createElement('div');
                this._glowEl.id = 'ytkit-ambient-glow';
                this._glowEl.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:0;opacity:0.5;filter:blur(80px);transition:background 1s ease;';
                player.style.position = 'relative';
                player.insertBefore(this._glowEl, player.firstChild);

                this._active = true;
                this._sample(video);
            },

            _sample(video) {
                if (!this._active) return;
                try {
                    this._ctx.drawImage(video, 0, 0, 8, 8);
                    const d = this._ctx.getImageData(0, 0, 8, 8).data;
                    let r = 0, g = 0, b = 0, count = 0;
                    for (let i = 0; i < d.length; i += 4) {
                        r += d[i]; g += d[i+1]; b += d[i+2]; count++;
                    }
                    r = Math.round(r/count); g = Math.round(g/count); b = Math.round(b/count);
                    if (this._glowEl) {
                        this._glowEl.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.6) 0%, transparent 70%)`;
                    }
                } catch(e) { /* cross-origin video, silently skip */ }
                this._raf = requestAnimationFrame(() => setTimeout(() => this._sample(video), 500));
            },

            init() {
                addNavigateRule('cinemaAmbientGlow', () => {
                    this._cleanup();
                    setTimeout(() => this._setup(), 1500);
                });
                setTimeout(() => this._setup(), 1500);
            },

            _cleanup() {
                this._active = false;
                if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
                this._glowEl?.remove(); this._glowEl = null;
                this._canvas = null; this._ctx = null;
            },

            destroy() {
                removeNavigateRule('cinemaAmbientGlow');
                this._cleanup();
            }
        },
        {
            id: 'transcriptViewer',
            name: 'Transcript Sidebar',
            description: 'Adds a clickable transcript panel in the sidebar with timestamp navigation',
            group: 'Watch Page',
            icon: 'file-text',
            _panel: null,
            _navRule: null,

            async _loadTranscript() {
                const panel = this._panel;
                if (!panel) return;
                const body = panel.querySelector('.ytkit-transcript-body');
                if (!body) return;
                body.textContent = 'Loading transcript...';

                try {
                    const pageData = document.querySelector('ytd-watch-flexy');
                    const playerResponse = pageData?.__data?.playerResponse || pageData?.playerResponse;
                    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (!tracks || tracks.length === 0) {
                        body.textContent = 'No transcript available for this video.';
                        return;
                    }
                    const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
                    const resp = await fetch(track.baseUrl + '&fmt=json3');
                    const data = await resp.json();
                    body.textContent = '';

                    (data.events || []).forEach(ev => {
                        if (!ev.segs) return;
                        const text = ev.segs.map(s => s.utf8).join('').trim();
                        if (!text) return;
                        const startSec = (ev.tStartMs || 0) / 1000;
                        const mins = Math.floor(startSec / 60);
                        const secs = Math.floor(startSec % 60);

                        const line = document.createElement('div');
                        line.style.cssText = 'display:flex;gap:8px;padding:4px 8px;cursor:pointer;border-radius:4px;';
                        line.addEventListener('mouseenter', () => line.style.background = 'rgba(255,255,255,0.1)');
                        line.addEventListener('mouseleave', () => line.style.background = 'transparent');

                        const ts = document.createElement('span');
                        ts.style.cssText = 'color:#3ea6ff;font-size:12px;min-width:42px;flex-shrink:0;font-family:monospace;';
                        ts.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

                        const txt = document.createElement('span');
                        txt.style.cssText = 'color:#eee;font-size:13px;line-height:1.4;';
                        txt.textContent = text;

                        line.appendChild(ts);
                        line.appendChild(txt);
                        line.addEventListener('click', () => {
                            const v = document.querySelector('video');
                            if (v) v.currentTime = startSec;
                        });
                        body.appendChild(line);
                    });
                } catch(e) {
                    body.textContent = 'Failed to load transcript.';
                }
            },

            _create() {
                if (this._panel) return;
                const secondary = document.querySelector('#secondary, ytd-watch-flexy #secondary');
                if (!secondary) return;

                const panel = document.createElement('div');
                panel.id = 'ytkit-transcript-panel';
                panel.style.cssText = 'background:rgba(30,30,30,0.95);border-radius:12px;padding:12px;margin-bottom:16px;max-height:500px;display:flex;flex-direction:column;';

                const header = document.createElement('div');
                header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
                const title = document.createElement('span');
                title.style.cssText = 'color:#fff;font-weight:600;font-size:14px;';
                title.textContent = 'Transcript';
                const closeBtn = document.createElement('span');
                closeBtn.style.cssText = 'color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;';
                closeBtn.textContent = '\u00D7';
                closeBtn.addEventListener('click', () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; });
                header.appendChild(title);
                header.appendChild(closeBtn);

                const body = document.createElement('div');
                body.className = 'ytkit-transcript-body';
                body.style.cssText = 'overflow-y:auto;flex:1;color:#aaa;font-size:13px;';

                panel.appendChild(header);
                panel.appendChild(body);
                secondary.insertBefore(panel, secondary.firstChild);
                this._panel = panel;
                this._loadTranscript();
            },

            init() {
                addNavigateRule('transcriptViewer', () => {
                    this._panel?.remove(); this._panel = null;
                    setTimeout(() => this._create(), 2000);
                });
                setTimeout(() => this._create(), 2000);
            },
            destroy() {
                removeNavigateRule('transcriptViewer');
                this._panel?.remove(); this._panel = null;
            }
        },
        {
            id: 'searchFilterDefaults',
            name: 'Search Filter Defaults',
            description: 'Automatically apply a default sort order (upload date, view count, or rating) to YouTube search results',
            group: 'Content',
            icon: 'filter',
            type: 'select',
            options: [
                { value: 'upload_date', label: 'Upload Date' },
                { value: 'view_count', label: 'View Count' },
                { value: 'rating', label: 'Rating' }
            ],
            settingKey: 'searchFilterSort',

            _appliedUrl: null,

            _apply() {
                if (!location.pathname.startsWith('/results')) return;
                const url = new URL(location.href);
                const sp = url.searchParams.get('sp');
                if (sp) return; // User already applied a filter, don't override

                const sort = appState.settings.searchFilterSort || 'upload_date';
                const spMap = { upload_date: 'CAI%253D', view_count: 'CAM%253D', rating: 'CAE%253D' };
                const newSp = spMap[sort];
                if (!newSp) return;
                if (this._appliedUrl === location.href) return;
                this._appliedUrl = location.href;
                url.searchParams.set('sp', decodeURIComponent(newSp));
                window.location.replace(url.toString());
            },

            init() {
                addNavigateRule('searchFilterDefaults', () => this._apply());
                this._apply();
            },
            destroy() {
                removeNavigateRule('searchFilterDefaults');
            }
        },
        {
            id: 'forceStandardFps',
            name: 'Force Standard Frame Rate',
            description: 'Block 60fps streams to reduce CPU/GPU load — plays 30fps versions instead',
            group: 'Video Player',
            icon: 'film',

            _observer: null,

            _apply() {
                const player = document.querySelector('#movie_player');
                if (!player || !player.getAvailableQualityData) return;
                try {
                    const video = document.querySelector('video');
                    if (!video) return;
                    // YouTube exposes setPlaybackQualityRange on the player API
                    if (player.setPlaybackQualityRange) {
                        // Get current quality and force non-HFR version
                        const current = player.getPlaybackQuality?.() || 'auto';
                        if (current !== 'auto') {
                            player.setPlaybackQualityRange(current, current);
                        }
                    }
                } catch(e) { /* player API may not be ready */ }
            },

            init() {
                // Inject CSS to signal preference, plus player API approach
                const css = `
                    /* Force standard framerate label */
                    .ytp-quality-menu .ytp-menuitem[data-quality*="hfr"] { opacity: 0.5; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
                addNavigateRule('forceStandardFps', () => setTimeout(() => this._apply(), 3000));
                setTimeout(() => this._apply(), 3000);
            },
            destroy() {
                removeNavigateRule('forceStandardFps');
                this._styleEl?.remove(); this._styleEl = null;
            }
        },
        {
            id: 'stickyChat',
            name: 'Sticky Live Chat',
            description: 'Keeps the live chat panel pinned at the top of the sidebar when scrolling',
            group: 'Live Chat',
            icon: 'message-circle',
            _styleEl: null,

            init() {
                const css = `
                    ytd-live-chat-frame { position: sticky !important; top: 8px !important; z-index: 100 !important; }
                    #chat-container { position: sticky !important; top: 8px !important; z-index: 100 !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'autoExpandDescription',
            name: 'Auto-Expand Description',
            description: 'Automatically expands the video description so you never need to click "Show more"',
            group: 'Watch Page',
            icon: 'chevrons-down',

            _expand() {
                // New YouTube layout uses a truncated-text with "...more" button
                const moreBtn = document.querySelector('tp-yt-paper-button#expand, #description-inline-expander #expand, ytd-text-inline-expander #expand, #expand');
                if (moreBtn && moreBtn.offsetParent !== null) {
                    moreBtn.click();
                }
                // Also try the expand metadata element
                const expandEl = document.querySelector('ytd-expander[collapsed] #more, ytd-text-inline-expander[is-collapsed] tp-yt-paper-button');
                if (expandEl && expandEl.offsetParent !== null) {
                    expandEl.click();
                }
            },

            init() {
                addNavigateRule('autoExpandDescription', () => setTimeout(() => this._expand(), 2000));
                addMutationRule('autoExpandDescription', () => {
                    const expander = document.querySelector('ytd-text-inline-expander[is-collapsed], ytd-expander[collapsed]');
                    if (expander) setTimeout(() => this._expand(), 500);
                });
                setTimeout(() => this._expand(), 2000);
            },
            destroy() {
                removeNavigateRule('autoExpandDescription');
                removeMutationRule('autoExpandDescription');
            }
        },
        {
            id: 'scrollToPlayer',
            name: 'Scroll to Player on Navigate',
            description: 'Automatically scrolls to the top of the page when navigating to a new video',
            group: 'Watch Page',
            icon: 'arrow-up',

            init() {
                addNavigateRule('scrollToPlayer', () => {
                    if (location.pathname === '/watch') {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                });
            },
            destroy() { removeNavigateRule('scrollToPlayer'); }
        },
        cssFeature(
            'hideEndCards',
            'Hide End Screen Cards',
            'Removes the clickable end screen cards/annotations that overlay the video in the last seconds. Also covered by Hide Video End Content.',
            'Watch Page',
            'x-square',
            '.ytp-ce-element, .ytp-ce-covering-overlay, .ytp-ce-element-shadow, .ytp-ce-covering-image, .ytp-ce-expanding-image, .ytp-ce-element.ytp-ce-video, .ytp-ce-element.ytp-ce-channel, .ytp-ce-element.ytp-ce-playlist',
            { isSubFeature: true, parentId: 'hideVideoEndContent' }
        ),
        cssFeature(
            'hideInfoCards',
            'Hide Info Cards',
            'Removes the "i" info card teasers and popups that appear during video playback',
            'Watch Page',
            'info',
            '.ytp-cards-teaser, .ytp-cards-button, .ytp-cards-button-icon, iv-promo, .iv-promo-contents, .ytp-cards-teaser-box'
        ),
        {
            id: 'keyMoments',
            name: 'Key Moments Highlights',
            description: 'Highlights chapter markers on the progress bar with colored segments for quick visual navigation',
            group: 'Watch Page',
            icon: 'bookmark',
            _styleEl: null,

            init() {
                const css = `
                    .ytp-chapter-hover-container { background: rgba(62, 166, 255, 0.3) !important; }
                    .ytp-progress-bar-container .ytp-chapter-hover-container:hover { background: rgba(62, 166, 255, 0.5) !important; }
                    .ytp-heat-map-chapter { border-left: 1px solid rgba(62, 166, 255, 0.4) !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },

        // ═══════════════════════════════════════════════════════════════
        // ═══ WAVE 5 — Power User & QoL ═══════════════════════════════
        // ═══════════════════════════════════════════════════════════════

        {
            id: 'autoTheaterMode',
            name: 'Auto Theater Mode',
            description: 'Automatically enter theater (wide) mode when opening a video',
            group: 'Video Player',
            icon: 'maximize-2',

            _apply() {
                if (location.pathname !== '/watch') return;
                const player = document.querySelector('#movie_player');
                if (!player) return;
                const isTheater = document.querySelector('ytd-watch-flexy')?.hasAttribute('theater');
                if (!isTheater) {
                    const btn = document.querySelector('.ytp-size-button, button.ytp-size-button');
                    if (btn) btn.click();
                }
            },

            init() {
                addNavigateRule('autoTheaterMode', () => setTimeout(() => this._apply(), 1000));
                setTimeout(() => this._apply(), 1000);
            },
            destroy() { removeNavigateRule('autoTheaterMode'); }
        },
        {
            id: 'resumePlayback',
            name: 'Resume Playback Position',
            description: 'Remember where you stopped watching and automatically resume from that point',
            group: 'Playback',
            icon: 'play-circle',
            _saveInterval: null,
            _positions: null,
            _MAX_ENTRIES: 500,

            _getVideoId() {
                const url = new URL(location.href);
                return url.searchParams.get('v');
            },

            async _load() {
                this._positions = (await StorageManager.get('ytkit_resume_positions')) || {};
            },

            async _save() {
                if (!this._positions) return;
                // Prune oldest entries if over limit
                const keys = Object.keys(this._positions);
                if (keys.length > this._MAX_ENTRIES) {
                    const sorted = keys.sort((a, b) => (this._positions[a]?.ts || 0) - (this._positions[b]?.ts || 0));
                    const toRemove = sorted.slice(0, keys.length - this._MAX_ENTRIES);
                    toRemove.forEach(k => delete this._positions[k]);
                }
                await StorageManager.set('ytkit_resume_positions', this._positions);
            },

            _savePosition() {
                const vid = this._getVideoId();
                const video = document.querySelector('video');
                if (!vid || !video || video.duration < 60) return; // Only for videos > 1 min
                const time = video.currentTime;
                const duration = video.duration;
                // Don't save if near start or end (within 10s)
                if (time < 10 || (duration - time) < 10) {
                    // Video finished or just started — remove saved position
                    if (this._positions[vid]) {
                        delete this._positions[vid];
                        this._save();
                    }
                    return;
                }
                this._positions[vid] = { time, ts: Date.now() };
            },

            async _restore() {
                const vid = this._getVideoId();
                if (!vid || !this._positions) return;
                const saved = this._positions[vid];
                if (!saved) return;

                const video = document.querySelector('video');
                if (!video) return;

                const waitForReady = () => new Promise(resolve => {
                    if (video.readyState >= 2) return resolve();
                    video.addEventListener('loadeddata', resolve, { once: true });
                    setTimeout(resolve, 5000); // Fallback
                });

                await waitForReady();
                if (Math.abs(video.currentTime - saved.time) > 5) {
                    video.currentTime = saved.time;
                    DebugManager.log('Resume', `Resumed at ${Math.floor(saved.time)}s`);
                }
            },

            async init() {
                await this._load();
                addNavigateRule('resumePlayback', () => {
                    this._savePosition();
                    setTimeout(() => this._restore(), 2000);
                });
                // Save position every 15 seconds
                this._saveInterval = setInterval(() => this._savePosition(), 15000);
                setTimeout(() => this._restore(), 2000);
            },
            destroy() {
                this._savePosition();
                this._save();
                removeNavigateRule('resumePlayback');
                if (this._saveInterval) { clearInterval(this._saveInterval); this._saveInterval = null; }
            }
        },
        {
            id: 'miniPlayerBar',
            name: 'Mini Player Bar',
            description: 'Shows a floating mini-player bar at the bottom when you scroll past the video',
            group: 'Video Player',
            icon: 'picture-in-picture',
            _bar: null,
            _observer: null,
            _scrollHandler: null,

            _create() {
                if (this._bar) return;
                if (location.pathname !== '/watch') return;

                const bar = document.createElement('div');
                bar.id = 'ytkit-mini-player-bar';
                bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:64px;background:rgba(15,15,15,0.97);z-index:99999;display:none;align-items:center;padding:0 16px;gap:12px;border-top:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(8px);transition:transform 0.3s ease;';

                // Thumbnail
                const thumb = document.createElement('div');
                thumb.style.cssText = 'width:100px;height:56px;background:#222;border-radius:4px;overflow:hidden;flex-shrink:0;cursor:pointer;';
                const img = document.createElement('img');
                const videoId = new URL(location.href).searchParams.get('v');
                if (videoId) img.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                thumb.appendChild(img);
                thumb.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

                // Title
                const title = document.createElement('div');
                title.style.cssText = 'flex:1;color:#fff;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string');
                title.textContent = titleEl?.textContent || 'Now Playing';

                // Play/Pause button
                const playBtn = document.createElement('button');
                playBtn.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:22px;padding:8px;';
                playBtn.textContent = '\u23F8'; // pause symbol
                playBtn.addEventListener('click', () => {
                    const v = document.querySelector('video');
                    if (!v) return;
                    if (v.paused) { v.play(); playBtn.textContent = '\u23F8'; }
                    else { v.pause(); playBtn.textContent = '\u25B6'; }
                });

                // Progress
                const progress = document.createElement('div');
                progress.style.cssText = 'position:absolute;top:-2px;left:0;right:0;height:3px;background:rgba(255,255,255,0.1);';
                const progressFill = document.createElement('div');
                progressFill.style.cssText = 'height:100%;background:#f00;width:0%;transition:width 0.5s linear;';
                progress.appendChild(progressFill);

                // Close button
                const closeBtn = document.createElement('button');
                closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;padding:8px;';
                closeBtn.textContent = '\u00D7';
                closeBtn.addEventListener('click', () => { bar.style.display = 'none'; this._dismissed = true; });

                bar.appendChild(progress);
                bar.appendChild(thumb);
                bar.appendChild(title);
                bar.appendChild(playBtn);
                bar.appendChild(closeBtn);
                document.body.appendChild(bar);
                this._bar = bar;
                this._dismissed = false;

                // Update progress periodically
                this._progressInterval = setInterval(() => {
                    const v = document.querySelector('video');
                    if (v && v.duration) {
                        progressFill.style.width = `${(v.currentTime / v.duration) * 100}%`;
                        playBtn.textContent = v.paused ? '\u25B6' : '\u23F8';
                    }
                }, 500);

                // Show/hide based on scroll
                this._scrollHandler = () => {
                    if (this._dismissed) return;
                    const player = document.querySelector('#movie_player, #player');
                    if (!player) return;
                    const rect = player.getBoundingClientRect();
                    bar.style.display = rect.bottom < -50 ? 'flex' : 'none';
                };
                window.addEventListener('scroll', this._scrollHandler, { passive: true });
            },

            init() {
                addNavigateRule('miniPlayerBar', () => {
                    this._cleanup();
                    setTimeout(() => this._create(), 1500);
                });
                setTimeout(() => this._create(), 1500);
            },

            _cleanup() {
                if (this._scrollHandler) { window.removeEventListener('scroll', this._scrollHandler); this._scrollHandler = null; }
                if (this._progressInterval) { clearInterval(this._progressInterval); this._progressInterval = null; }
                this._bar?.remove(); this._bar = null;
                this._dismissed = false;
            },

            destroy() {
                removeNavigateRule('miniPlayerBar');
                this._cleanup();
            }
        },
        {
            id: 'playbackStatsOverlay',
            name: 'Playback Stats Overlay',
            description: 'Shows video codec, resolution, bitrate, and dropped frame count as a togglable overlay',
            group: 'Video Player',
            icon: 'activity',
            _overlay: null,
            _interval: null,

            _create() {
                if (this._overlay) return;
                const player = document.querySelector('#movie_player');
                if (!player) return;

                const overlay = document.createElement('div');
                overlay.id = 'ytkit-stats-overlay';
                overlay.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.75);color:#0f0;font-family:monospace;font-size:11px;padding:8px 12px;border-radius:6px;z-index:100;pointer-events:none;line-height:1.6;display:none;';
                player.appendChild(overlay);
                this._overlay = overlay;

                // Toggle visibility with 'i' key while focused on player — NO, user rules say no keyboard shortcuts
                // Instead, add a button to the player controls
                const btn = document.createElement('button');
                btn.className = 'ytp-button ytkit-player-btn ytkit-player-btn--text ytkit-stats-btn';
                btn.title = 'Toggle Stats';
                btn.textContent = 'STATS';
                btn.addEventListener('click', () => {
                    overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
                });
                const controls = player.querySelector('.ytp-right-controls');
                if (controls) controls.insertBefore(btn, controls.firstChild);
                this._btn = btn;

                this._interval = setInterval(() => this._update(), 1000);
            },

            _update() {
                if (!this._overlay || this._overlay.style.display === 'none') return;
                const video = document.querySelector('video');
                if (!video) return;

                const quality = video.getVideoPlaybackQuality?.() || {};
                const dropped = quality.droppedVideoFrames || 0;
                const total = quality.totalVideoFrames || 0;

                // Try to get codec from player
                const player = document.querySelector('#movie_player');
                let codecStr = 'unknown';
                let resolution = `${video.videoWidth}x${video.videoHeight}`;
                try {
                    const stats = player?.getStatsForNerds?.();
                    if (stats) {
                        codecStr = stats.codecs || codecStr;
                        resolution = stats.resolution || resolution;
                    }
                } catch(e) { /* API may not exist */ }

                // Bandwidth estimate
                const conn = navigator.connection;
                const bandwidth = conn?.downlink ? `${conn.downlink} Mbps` : 'N/A';

                const lines = [
                    `Resolution: ${resolution}`,
                    `Dropped: ${dropped}/${total} frames`,
                    `Bandwidth: ${bandwidth}`,
                    `Playback: ${video.playbackRate}x`,
                    `Buffered: ${video.buffered.length > 0 ? Math.floor(video.buffered.end(video.buffered.length - 1) - video.currentTime) + 's ahead' : 'N/A'}`
                ];
                this._overlay.textContent = lines.join('\n');
            },

            init() {
                addNavigateRule('playbackStatsOverlay', () => {
                    this._cleanup();
                    setTimeout(() => this._create(), 2000);
                });
                setTimeout(() => this._create(), 2000);
            },

            _cleanup() {
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                this._overlay?.remove(); this._overlay = null;
                this._btn?.remove(); this._btn = null;
            },

            destroy() {
                removeNavigateRule('playbackStatsOverlay');
                this._cleanup();
            }
        },
        cssFeature(
            'hideNotificationBadge',
            'Hide Notification Badge',
            'Removes the red notification count badge from the bell icon',
            'Home / Subscriptions',
            'bell-off',
            `.ytd-notification-topbar-button-renderer .yt-spec-icon-badge-shape__badge, ytd-notification-topbar-button-renderer .badge-shape-wiz { display: none !important; }`
        ),
        {
            id: 'autoPauseOnSwitch',
            name: 'Auto-Pause on Tab Switch',
            description: 'Pauses playback when you switch to another tab, resumes when you return',
            group: 'Playback',
            icon: 'pause-circle',
            _handler: null,
            _wasPlaying: false,

            init() {
                this._handler = () => {
                    const video = document.querySelector('video');
                    if (!video) return;
                    if (document.hidden) {
                        // Don't interfere if pauseOtherTabs already paused this tab
                        if (video.__ytkit_pausedByBroadcast) return;
                        if (!video.paused) {
                            this._wasPlaying = true;
                            video.__ytkit_pausedByVisibility = true;
                            video.pause();
                        }
                    } else {
                        if (this._wasPlaying && video.__ytkit_pausedByVisibility) {
                            video.play().catch(() => {});
                            this._wasPlaying = false;
                            delete video.__ytkit_pausedByVisibility;
                        }
                    }
                };
                document.addEventListener('visibilitychange', this._handler);
            },
            destroy() {
                if (this._handler) { document.removeEventListener('visibilitychange', this._handler); this._handler = null; }
                this._wasPlaying = false;
            }
        },
        {
            id: 'creatorCommentHighlight',
            name: 'Highlight Creator Comments',
            description: 'Makes comments from the video creator stand out with a colored border and badge',
            group: 'Comments',
            icon: 'user-check',
            _styleEl: null,

            init() {
                const css = `
                    ytd-comment-view-model.ytd-comment-thread-renderer:has(#author-comment-badge),
                    ytd-comment-renderer:has(#author-comment-badge) {
                        border-left: 3px solid #3ea6ff !important;
                        background: rgba(62, 166, 255, 0.05) !important;
                        padding-left: 12px !important;
                        border-radius: 8px !important;
                    }
                    ytd-comment-view-model:has([creator]) #author-text,
                    ytd-comment-renderer:has([creator]) #author-text {
                        color: #3ea6ff !important;
                        font-weight: 600 !important;
                    }
                    /* Also highlight hearted comments */
                    ytd-comment-view-model:has(#creator-heart),
                    ytd-comment-renderer:has(#creator-heart-button[is-hearted]) {
                        border-left: 3px solid #f44336 !important;
                        background: rgba(244, 67, 54, 0.04) !important;
                        padding-left: 12px !important;
                        border-radius: 8px !important;
                    }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'copyVideoTitle',
            name: 'Copy Video Title Button',
            description: 'Adds a copy button next to the video title for one-click title copying',
            group: 'Watch Page',
            icon: 'clipboard',
            _btn: null,

            _create() {
                if (this._btn) return;
                if (location.pathname !== '/watch') return;

                const titleContainer = document.querySelector('h1.ytd-watch-metadata, #title h1');
                if (!titleContainer) return;
                if (titleContainer.querySelector('.ytkit-copy-title-btn')) return;

                const btn = document.createElement('button');
                btn.className = 'ytkit-copy-title-btn';
                btn.title = 'Copy title';
                btn.style.cssText = 'background:none;border:none;cursor:pointer;color:#aaa;font-size:16px;padding:2px 6px;margin-left:8px;vertical-align:middle;opacity:0.6;transition:opacity 0.2s;';
                btn.textContent = '\uD83D\uDCCB'; // clipboard emoji
                btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
                btn.addEventListener('mouseleave', () => btn.style.opacity = '0.6');
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string')?.textContent?.trim();
                    if (title) {
                        try {
                            await navigator.clipboard.writeText(title);
                            btn.textContent = '\u2705';
                            setTimeout(() => btn.textContent = '\uD83D\uDCCB', 1500);
                        } catch(e) { /* clipboard API failed */ }
                    }
                });

                titleContainer.appendChild(btn);
                this._btn = btn;
            },

            init() {
                addNavigateRule('copyVideoTitle', () => {
                    this._btn = null;
                    setTimeout(() => this._create(), 2000);
                });
                addMutationRule('copyVideoTitle', () => {
                    if (location.pathname === '/watch' && !document.querySelector('.ytkit-copy-title-btn')) {
                        this._create();
                    }
                });
                setTimeout(() => this._create(), 2000);
            },
            destroy() {
                removeNavigateRule('copyVideoTitle');
                removeMutationRule('copyVideoTitle');
                document.querySelector('.ytkit-copy-title-btn')?.remove();
                this._btn = null;
            }
        },
        {
            id: 'channelAgeDisplay',
            name: 'Video Age Display',
            description: 'Shows how old a video is (e.g. "2 years, 3 months ago") next to the upload date',
            group: 'Watch Page',
            icon: 'calendar',
            _el: null,

            _calculate() {
                if (location.pathname !== '/watch') return;
                const dateEl = document.querySelector('#info-strings yt-formatted-string, ytd-watch-metadata #info-container yt-formatted-string');
                if (!dateEl) return;
                const text = dateEl.textContent?.trim();
                if (!text) return;

                // YouTube shows dates like "Jan 15, 2023" or "Premiered Jan 15, 2023" or "Streamed live on Jan 15, 2023"
                const cleaned = text.replace(/^(Premiered|Streamed live on|Streamed)\s*/i, '');
                const date = new Date(cleaned);
                if (isNaN(date.getTime())) return;

                const now = new Date();
                const diffMs = now - date;
                const days = Math.floor(diffMs / 86400000);

                let ageStr;
                if (days < 1) ageStr = 'Today';
                else if (days < 30) ageStr = `${days} day${days !== 1 ? 's' : ''} ago`;
                else if (days < 365) {
                    const months = Math.floor(days / 30);
                    ageStr = `${months} month${months !== 1 ? 's' : ''} ago`;
                } else {
                    const years = Math.floor(days / 365);
                    const remainMonths = Math.floor((days % 365) / 30);
                    ageStr = `${years}y ${remainMonths}m ago`;
                }

                // Remove existing badge
                document.querySelector('.ytkit-age-badge')?.remove();
                const badge = document.createElement('span');
                badge.className = 'ytkit-age-badge';
                badge.style.cssText = 'color:#aaa;font-size:12px;margin-left:8px;background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:12px;';
                badge.textContent = ageStr;
                dateEl.parentElement?.appendChild(badge);
                this._el = badge;
            },

            init() {
                addNavigateRule('channelAgeDisplay', () => {
                    this._el?.remove(); this._el = null;
                    setTimeout(() => this._calculate(), 2500);
                });
                setTimeout(() => this._calculate(), 2500);
            },
            destroy() {
                removeNavigateRule('channelAgeDisplay');
                this._el?.remove(); this._el = null;
                document.querySelector('.ytkit-age-badge')?.remove();
            }
        },
        {
            id: 'speedIndicatorOverlay',
            name: 'Speed Indicator Overlay',
            description: 'Shows the current playback speed as a small overlay on the video when not at 1x',
            group: 'Video Player',
            icon: 'gauge',
            _overlay: null,
            _interval: null,

            _create() {
                if (this._overlay) return;
                const player = document.querySelector('#movie_player');
                if (!player) return;

                const overlay = document.createElement('div');
                overlay.id = 'ytkit-speed-indicator';
                overlay.style.cssText = 'position:absolute;top:12px;left:12px;background:rgba(0,0,0,0.7);color:#fff;font-size:13px;font-weight:600;padding:4px 10px;border-radius:6px;z-index:100;pointer-events:none;display:none;font-family:monospace;';
                player.appendChild(overlay);
                this._overlay = overlay;

                this._interval = setInterval(() => {
                    const video = document.querySelector('video');
                    if (!video || !this._overlay) return;
                    const rate = video.playbackRate;
                    if (Math.abs(rate - 1) < 0.01) {
                        this._overlay.style.display = 'none';
                    } else {
                        this._overlay.style.display = 'block';
                        this._overlay.textContent = `${rate}x`;
                    }
                }, 500);
            },

            init() {
                addNavigateRule('speedIndicatorOverlay', () => {
                    this._cleanup();
                    setTimeout(() => this._create(), 1500);
                });
                setTimeout(() => this._create(), 1500);
            },

            _cleanup() {
                if (this._interval) { clearInterval(this._interval); this._interval = null; }
                this._overlay?.remove(); this._overlay = null;
            },

            destroy() {
                removeNavigateRule('speedIndicatorOverlay');
                this._cleanup();
            }
        },
        cssFeature(
            'hideAutoplayToggle',
            'Hide Autoplay Toggle',
            'Removes the autoplay toggle switch from the player controls',
            'Watch Page',
            'toggle-right',
            `.ytp-autonav-toggle-button-container, .ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"] { display: none !important; }`
        ),
        {
            id: 'fullscreenOnDoubleClick',
            name: 'Double-Click Fullscreen',
            description: 'Double-click anywhere on the video to toggle fullscreen (replaces default seek behavior)',
            group: 'Video Player',
            icon: 'maximize',
            _handler: null,

            init() {
                this._handler = (e) => {
                    // Skip if video is in a pop-out window
                    if (window.__ytkit_videoPopped) return;
                    const player = document.querySelector('#movie_player');
                    if (!player) return;
                    // Only respond to double clicks on the video element or its container
                    if (!e.target.closest('.html5-video-container, video')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const btn = player.querySelector('.ytp-fullscreen-button');
                    if (btn) btn.click();
                };
                // Use capture to intercept before YouTube's handler
                document.addEventListener('dblclick', this._handler, true);
            },
            destroy() {
                if (this._handler) { document.removeEventListener('dblclick', this._handler, true); this._handler = null; }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // ═══ WAVE 6 — Interaction & Media Control ═════════════════════
        // ═══════════════════════════════════════════════════════════════

        {
            id: 'rememberVolume',
            name: 'Remember Volume',
            description: 'Persist your volume level across videos and sessions',
            group: 'Playback',
            icon: 'volume-1',

            _apply() {
                const level = appState.settings.rememberVolumeLevel || 100;
                const video = document.querySelector('video');
                if (!video) return;
                video.volume = level / 100;
                try {
                    const playerApi = document.querySelector('#movie_player');
                    if (playerApi?.setVolume) playerApi.setVolume(level);
                } catch(e) {}
            },

            _saveHandler: null,

            init() {
                addNavigateRule('rememberVolume', () => setTimeout(() => this._apply(), 1500));
                setTimeout(() => this._apply(), 1500);

                // Save volume changes
                this._saveHandler = () => {
                    const video = document.querySelector('video');
                    if (!video) return;
                    const level = Math.round(video.volume * 100);
                    if (level !== appState.settings.rememberVolumeLevel) {
                        appState.settings.rememberVolumeLevel = level;
                        settingsManager.save(appState.settings);
                    }
                };
                document.addEventListener('volumechange', this._saveHandler, true);
            },
            destroy() {
                removeNavigateRule('rememberVolume');
                if (this._saveHandler) { document.removeEventListener('volumechange', this._saveHandler, true); this._saveHandler = null; }
            }
        },
        {
            id: 'pipButton',
            name: 'Picture-in-Picture Button',
            description: 'Adds a one-click PiP button to the player controls for native browser Picture-in-Picture',
            group: 'Video Player',
            icon: 'airplay',
            _btn: null,

            _create() {
                if (this._btn) return;
                const controls = document.querySelector('#movie_player .ytp-right-controls');
                if (!controls) return;
                if (controls.querySelector('.ytkit-pip-btn')) return;

                const btn = document.createElement('button');
                btn.className = 'ytp-button ytkit-player-btn ytkit-player-btn--text ytkit-pip-btn';
                btn.title = 'Picture-in-Picture';
                btn.textContent = 'PiP';

                btn.addEventListener('click', async () => {
                    // Skip if video is in a Document PiP pop-out
                    if (window.__ytkit_videoPopped) {
                        showToast('Video is already in pop-out mode', '#f59e0b');
                        return;
                    }
                    const video = document.querySelector('video');
                    if (!video) return;
                    try {
                        if (document.pictureInPictureElement) {
                            await document.exitPictureInPicture();
                        } else {
                            await video.requestPictureInPicture();
                        }
                    } catch(e) { DebugManager.log('PiP', `Failed: ${e.message}`); }
                });

                controls.insertBefore(btn, controls.firstChild);
                this._btn = btn;
            },

            init() {
                addNavigateRule('pipButton', () => {
                    this._btn = null;
                    setTimeout(() => this._create(), 2000);
                });
                setTimeout(() => this._create(), 2000);
            },
            destroy() {
                removeNavigateRule('pipButton');
                document.querySelector('.ytkit-pip-btn')?.remove();
                this._btn = null;
            }
        },
        {
            id: 'autoSubtitles',
            name: 'Auto-Enable Subtitles',
            description: 'Automatically turns on closed captions when a video starts playing',
            group: 'Playback',
            icon: 'subtitles',

            _enable() {
                if (location.pathname !== '/watch') return;
                const player = document.querySelector('#movie_player');
                if (!player) return;

                // Check if captions are already on
                const ccBtn = player.querySelector('.ytp-subtitles-button');
                if (!ccBtn) return;
                const isOn = ccBtn.getAttribute('aria-pressed') === 'true';
                if (!isOn) {
                    ccBtn.click();
                    DebugManager.log('AutoSub', 'Enabled subtitles');
                }
            },

            init() {
                addNavigateRule('autoSubtitles', () => setTimeout(() => this._enable(), 3000));
                setTimeout(() => this._enable(), 3000);
            },
            destroy() { removeNavigateRule('autoSubtitles'); }
        },
        {
            id: 'focusedMode',
            name: 'Focused Mode',
            description: 'Hides everything except the video player and comments for a distraction-free experience',
            group: 'Watch Page',
            icon: 'eye',
            _styleEl: null,

            init() {
                const css = `
                    /* Hide related videos inside sidebar — NOT the entire #secondary, so
                       transcriptViewer, timestampBookmarks, and stickyVideo can still inject there */
                    ytd-watch-next-secondary-results-renderer { display: none !important; }
                    ytd-compact-autoplay-renderer { display: none !important; }
                    /* Hide masthead */
                    #masthead-container { display: none !important; }
                    /* Hide mini guide */
                    ytd-mini-guide-renderer { display: none !important; }
                    tp-yt-app-drawer { display: none !important; }
                    /* Expand primary */
                    ytd-watch-flexy #primary { max-width: none !important; }
                    ytd-watch-flexy #columns { max-width: 1200px !important; margin: 0 auto !important; }
                    /* Hide page manager margin from masthead */
                    ytd-app { margin-top: 0 !important; }
                    ytd-page-manager { margin-top: 0 !important; }
                    /* Hide end screen suggestions */
                    .ytp-endscreen-content { display: none !important; }
                    /* Collapse sidebar if no YTKit panels are injected */
                    ytd-watch-flexy #secondary:not(:has(.ytkit-bookmarks-container, #ytkit-transcript-panel)) { display: none !important; }
                    /* Keep comments visible */
                    #comments { display: block !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'thumbnailQualityUpgrade',
            name: 'HD Thumbnails',
            description: 'Upgrades video thumbnails to maximum resolution where available',
            group: 'Content',
            icon: 'image',

            _upgradeAll() {
                const thumbnails = document.querySelectorAll('ytd-thumbnail img[src*="i.ytimg.com"], ytd-playlist-thumbnail img[src*="i.ytimg.com"]');
                thumbnails.forEach(img => {
                    const src = img.src;
                    if (!src) return;
                    // Replace hqdefault/mqdefault/sddefault with maxresdefault
                    if (src.includes('hqdefault') || src.includes('mqdefault') || src.includes('sddefault') || src.includes('default.jpg')) {
                        const upgraded = src.replace(/(hqdefault|mqdefault|sddefault|default)\.jpg/, 'maxresdefault.jpg');
                        if (upgraded !== src) {
                            img.src = upgraded;
                            // Fallback if maxres doesn't exist
                            img.onerror = () => { img.src = src; img.onerror = null; };
                        }
                    }
                });
            },

            init() {
                addNavigateRule('thumbnailQualityUpgrade', () => setTimeout(() => this._upgradeAll(), 1500));
                addMutationRule('thumbnailQualityUpgrade', () => this._upgradeAll());
                setTimeout(() => this._upgradeAll(), 1500);
            },
            destroy() {
                removeNavigateRule('thumbnailQualityUpgrade');
                removeMutationRule('thumbnailQualityUpgrade');
            }
        },
        {
            id: 'watchLaterQuickAdd',
            name: 'Watch Later Quick Button',
            description: 'Adds a clock icon on every thumbnail for one-click Watch Later saving',
            group: 'Content',
            icon: 'clock',

            _addButtons() {
                const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
                thumbnails.forEach(item => {
                    if (item.querySelector('.ytkit-wl-btn')) return;
                    const thumb = item.querySelector('ytd-thumbnail, #thumbnail');
                    if (!thumb) return;

                    // Get video ID from the link
                    const link = item.querySelector('a#thumbnail, a.yt-simple-endpoint[href*="/watch"]');
                    const href = link?.href;
                    if (!href) return;
                    const match = href.match(/[?&]v=([^&]+)/);
                    if (!match) return;

                    const container = thumb.querySelector('#overlays') || thumb;
                    const btn = document.createElement('button');
                    btn.className = 'ytkit-wl-btn';
                    btn.title = 'Add to Watch Later';
                    btn.style.cssText = 'position:absolute;top:4px;right:4px;z-index:50;background:rgba(0,0,0,0.7);border:none;border-radius:4px;color:#fff;cursor:pointer;padding:4px 6px;font-size:16px;opacity:0;transition:opacity 0.2s;line-height:1;';
                    btn.textContent = '\u23F0'; // timer emoji

                    // Show on hover
                    thumb.style.position = 'relative';
                    thumb.addEventListener('mouseenter', () => btn.style.opacity = '1');
                    thumb.addEventListener('mouseleave', () => btn.style.opacity = '0');

                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Click YouTube's native "Save" menu to add to Watch Later
                        const menuBtn = item.querySelector('ytd-menu-renderer yt-icon-button, #menu button, ytd-menu-renderer button');
                        if (menuBtn) {
                            menuBtn.click();
                            setTimeout(() => {
                                const wlItem = document.querySelector('ytd-menu-service-item-renderer tp-yt-paper-item[aria-label*="Watch later"], ytd-menu-service-item-renderer:has(yt-formatted-string[title*="Watch later"])');
                                if (wlItem) {
                                    wlItem.click();
                                    btn.textContent = '\u2705';
                                    setTimeout(() => btn.textContent = '\u23F0', 2000);
                                } else {
                                    // Close menu if Watch Later not found
                                    document.body.click();
                                }
                            }, 300);
                        }
                    });

                    container.appendChild(btn);
                });
            },

            init() {
                addNavigateRule('watchLaterQuickAdd', () => setTimeout(() => this._addButtons(), 1500));
                addMutationRule('watchLaterQuickAdd', () => this._addButtons());
                setTimeout(() => this._addButtons(), 1500);
            },
            destroy() {
                removeNavigateRule('watchLaterQuickAdd');
                removeMutationRule('watchLaterQuickAdd');
                document.querySelectorAll('.ytkit-wl-btn').forEach(b => b.remove());
            }
        },
        {
            id: 'playlistEnhancer',
            name: 'Playlist Enhancer',
            description: 'Adds shuffle and remove-duplicates buttons to playlist panels',
            group: 'Watch Page',
            icon: 'shuffle',
            _btns: null,

            _create() {
                if (location.pathname !== '/watch') return;
                const playlistHeader = document.querySelector('ytd-playlist-panel-renderer #header-contents, ytd-playlist-panel-renderer .header');
                if (!playlistHeader) return;
                if (playlistHeader.querySelector('.ytkit-playlist-enhance')) return;

                const container = document.createElement('div');
                container.className = 'ytkit-playlist-enhance';
                container.style.cssText = 'display:flex;gap:8px;padding:4px 8px;';

                // Shuffle button
                const shuffleBtn = document.createElement('button');
                shuffleBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;padding:4px 10px;border-radius:16px;font-size:12px;';
                shuffleBtn.textContent = '\uD83D\uDD00 Shuffle';
                shuffleBtn.addEventListener('click', () => {
                    const items = document.querySelectorAll('ytd-playlist-panel-video-renderer');
                    if (items.length < 2) return;
                    // Pick a random video from the playlist
                    const randomIdx = Math.floor(Math.random() * items.length);
                    const link = items[randomIdx]?.querySelector('a#wc-endpoint');
                    if (link) link.click();
                });

                // Copy playlist URLs
                const copyBtn = document.createElement('button');
                copyBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;padding:4px 10px;border-radius:16px;font-size:12px;';
                copyBtn.textContent = '\uD83D\uDCCB Copy All URLs';
                copyBtn.addEventListener('click', async () => {
                    const items = document.querySelectorAll('ytd-playlist-panel-video-renderer a#wc-endpoint');
                    const urls = Array.from(items).map(a => a.href).filter(Boolean);
                    if (urls.length > 0) {
                        try {
                            await navigator.clipboard.writeText(urls.join('\n'));
                            copyBtn.textContent = '\u2705 Copied!';
                            setTimeout(() => copyBtn.textContent = '\uD83D\uDCCB Copy All URLs', 2000);
                        } catch(e) {}
                    }
                });

                container.appendChild(shuffleBtn);
                container.appendChild(copyBtn);
                playlistHeader.appendChild(container);
                this._btns = container;
            },

            init() {
                addNavigateRule('playlistEnhancer', () => {
                    this._btns?.remove(); this._btns = null;
                    setTimeout(() => this._create(), 2000);
                });
                setTimeout(() => this._create(), 2000);
            },
            destroy() {
                removeNavigateRule('playlistEnhancer');
                this._btns?.remove(); this._btns = null;
                document.querySelectorAll('.ytkit-playlist-enhance').forEach(b => b.remove());
            }
        },
        {
            id: 'commentSearch',
            name: 'Comment Search',
            description: 'Adds a search bar above comments to filter and find specific comments',
            group: 'Comments',
            icon: 'search',
            _bar: null,

            _create() {
                if (location.pathname !== '/watch') return;
                const comments = document.querySelector('ytd-comments#comments');
                if (!comments) return;
                if (comments.querySelector('.ytkit-comment-search')) return;

                const bar = document.createElement('div');
                bar.className = 'ytkit-comment-search';
                bar.style.cssText = 'padding:8px 0;margin-bottom:8px;';

                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = 'Search comments...';
                input.style.cssText = 'width:100%;padding:8px 12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#fff;font-size:13px;outline:none;box-sizing:border-box;';
                input.addEventListener('focus', () => input.style.borderColor = '#3ea6ff');
                input.addEventListener('blur', () => input.style.borderColor = 'rgba(255,255,255,0.15)');

                let filterTimeout;
                input.addEventListener('input', () => {
                    clearTimeout(filterTimeout);
                    filterTimeout = setTimeout(() => {
                        const query = input.value.toLowerCase().trim();
                        const threads = document.querySelectorAll('ytd-comment-thread-renderer');
                        threads.forEach(thread => {
                            if (!query) {
                                thread.style.display = '';
                                return;
                            }
                            const text = thread.textContent?.toLowerCase() || '';
                            thread.style.display = text.includes(query) ? '' : 'none';
                        });

                        // Show count
                        let countEl = bar.querySelector('.ytkit-search-count');
                        if (!countEl) {
                            countEl = document.createElement('span');
                            countEl.className = 'ytkit-search-count';
                            countEl.style.cssText = 'color:#aaa;font-size:11px;margin-left:8px;';
                            bar.appendChild(countEl);
                        }
                        if (query) {
                            const visible = document.querySelectorAll('ytd-comment-thread-renderer:not([style*="display: none"])').length;
                            countEl.textContent = `${visible} match${visible !== 1 ? 'es' : ''}`;
                        } else {
                            countEl.textContent = '';
                        }
                    }, 300);
                });

                bar.appendChild(input);
                const header = comments.querySelector('#header, ytd-comments-header-renderer');
                if (header) {
                    header.parentElement.insertBefore(bar, header.nextSibling);
                } else {
                    comments.insertBefore(bar, comments.firstChild);
                }
                this._bar = bar;
            },

            init() {
                addNavigateRule('commentSearch', () => {
                    this._bar?.remove(); this._bar = null;
                    setTimeout(() => this._create(), 3000);
                });
                addMutationRule('commentSearch', () => {
                    if (location.pathname === '/watch' && !document.querySelector('.ytkit-comment-search')) {
                        this._create();
                    }
                });
                setTimeout(() => this._create(), 3000);
            },
            destroy() {
                removeNavigateRule('commentSearch');
                removeMutationRule('commentSearch');
                // Reset any hidden comments
                document.querySelectorAll('ytd-comment-thread-renderer[style*="display: none"]').forEach(t => t.style.display = '');
                this._bar?.remove(); this._bar = null;
                document.querySelectorAll('.ytkit-comment-search').forEach(b => b.remove());
            }
        },
        {
            id: 'videoZoom',
            name: 'Video Zoom & Pan',
            description: 'Hold Ctrl and scroll on the video to zoom in, then drag to pan around',
            group: 'Video Player',
            icon: 'zoom-in',
            _scale: 1,
            _translateX: 0,
            _translateY: 0,
            _wheelHandler: null,
            _mouseDownHandler: null,
            _mouseMoveHandler: null,
            _mouseUpHandler: null,
            _dragging: false,
            _startX: 0,
            _startY: 0,

            _applyTransform() {
                const video = document.querySelector('#movie_player video');
                if (!video) return;
                video.style.transform = `scale(${this._scale}) translate(${this._translateX}px, ${this._translateY}px)`;
                video.style.transformOrigin = 'center center';
            },

            _resetZoom() {
                this._scale = 1;
                this._translateX = 0;
                this._translateY = 0;
                const video = document.querySelector('#movie_player video');
                if (video) {
                    video.style.transform = '';
                    video.style.transformOrigin = '';
                }
            },

            init() {
                this._wheelHandler = (e) => {
                    if (!e.ctrlKey) return;
                    const player = e.target.closest('#movie_player, .html5-video-player');
                    if (!player) return;

                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    this._scale = Math.max(1, Math.min(5, this._scale + delta));
                    if (this._scale <= 1) { this._resetZoom(); return; }
                    this._applyTransform();
                };

                this._mouseDownHandler = (e) => {
                    if (this._scale <= 1) return;
                    const player = e.target.closest('#movie_player, .html5-video-player');
                    if (!player) return;

                    this._dragging = true;
                    this._startX = e.clientX - this._translateX;
                    this._startY = e.clientY - this._translateY;
                    e.preventDefault();
                };

                this._mouseMoveHandler = (e) => {
                    if (!this._dragging) return;
                    this._translateX = e.clientX - this._startX;
                    this._translateY = e.clientY - this._startY;
                    this._applyTransform();
                };

                this._mouseUpHandler = () => { this._dragging = false; };

                document.addEventListener('wheel', this._wheelHandler, { passive: false, capture: true });
                document.addEventListener('mousedown', this._mouseDownHandler, true);
                document.addEventListener('mousemove', this._mouseMoveHandler, true);
                document.addEventListener('mouseup', this._mouseUpHandler, true);

                addNavigateRule('videoZoom', () => this._resetZoom());
            },
            destroy() {
                this._resetZoom();
                removeNavigateRule('videoZoom');
                if (this._wheelHandler) document.removeEventListener('wheel', this._wheelHandler, true);
                if (this._mouseDownHandler) document.removeEventListener('mousedown', this._mouseDownHandler, true);
                if (this._mouseMoveHandler) document.removeEventListener('mousemove', this._mouseMoveHandler, true);
                if (this._mouseUpHandler) document.removeEventListener('mouseup', this._mouseUpHandler, true);
                this._wheelHandler = null; this._mouseDownHandler = null;
                this._mouseMoveHandler = null; this._mouseUpHandler = null;
            }
        },
        {
            id: 'forceDarkEverywhere',
            name: 'Force Dark on All YouTube Pages',
            description: 'Applies dark theme to YouTube pages that may not respect dark mode (settings, about, etc.)',
            group: 'Theme',
            icon: 'moon',
            _styleEl: null,

            init() {
                // Set dark theme attribute and inject fallback CSS
                document.documentElement.setAttribute('dark', '');
                document.documentElement.style.colorScheme = 'dark';
                const css = `
                    html[dark] { --yt-spec-base-background: #0f0f0f !important; --yt-spec-brand-background-solid: #0f0f0f !important; }
                    ytd-app, ytd-browse, ytd-page-manager, #content { background-color: #0f0f0f !important; }
                    body { background-color: #0f0f0f !important; color: #f1f1f1 !important; }
                    /* Force dark on non-standard pages */
                    .page-container, .yt-core-attributed-string, [light] { background: #0f0f0f !important; color: #f1f1f1 !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() {
                this._styleEl?.remove(); this._styleEl = null;
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // ═══ WAVE 7 — Customization & Utilities ══════════════════════
        // ═══════════════════════════════════════════════════════════════

        {
            id: 'customCssInjection',
            name: 'Custom CSS',
            description: 'Inject your own custom CSS rules into YouTube pages',
            group: 'Theme',
            icon: 'code',
            type: 'textarea',
            settingKey: 'customCssCode',
            _styleEl: null,

            _apply() {
                const css = appState.settings.customCssCode || '';
                if (this._styleEl) this._styleEl.remove();
                if (!css.trim()) return;
                this._styleEl = injectStyle(css, this.id, true);
            },

            init() {
                this._apply();
                // Re-apply when settings change
                this._settingsObserver = setInterval(() => {
                    const current = appState.settings.customCssCode || '';
                    if (this._lastCss !== current) {
                        this._lastCss = current;
                        this._apply();
                    }
                }, 2000);
            },
            destroy() {
                if (this._settingsObserver) { clearInterval(this._settingsObserver); this._settingsObserver = null; }
                this._styleEl?.remove(); this._styleEl = null;
            }
        },
        {
            id: 'shareMenuCleaner',
            name: 'Clean Share Menu',
            description: 'Removes social media buttons from the share dialog, leaving only the URL copy option',
            group: 'Watch Page',
            icon: 'share-2',
            _styleEl: null,

            init() {
                const css = `
                    /* Hide social media buttons in share dialog */
                    ytd-unified-share-panel-renderer .social-share-button-list,
                    ytd-unified-share-panel-renderer #share-targets,
                    ytd-third-party-share-target-section-renderer,
                    ytd-unified-share-panel-renderer .share-panel-social-container {
                        display: none !important;
                    }
                    /* Also hide "More" expand for social share */
                    ytd-unified-share-panel-renderer #expand-button {
                        display: none !important;
                    }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'autoClosePopups',
            name: 'Auto-Close Popups',
            description: 'Automatically dismisses cookie consent, survey prompts, and other YouTube popups',
            group: 'Content',
            icon: 'x-circle',

            _dismiss() {
                // Cookie consent / GDPR
                const consentBtn = document.querySelector('button[aria-label*="Accept"], button[aria-label*="Reject all"], tp-yt-paper-dialog #dismiss-button, .consent-bump-v2-lightbox button[aria-label*="Accept"]');
                if (consentBtn && consentBtn.offsetParent !== null) consentBtn.click();

                // "No thanks" on various prompts
                const noThanksBtn = document.querySelector('yt-button-renderer#dismiss-button button, tp-yt-paper-dialog button[aria-label*="No thanks"], tp-yt-paper-dialog button[aria-label*="Dismiss"]');
                if (noThanksBtn && noThanksBtn.offsetParent !== null) noThanksBtn.click();

                // Survey/feedback overlay
                const surveyDismiss = document.querySelector('.ytd-popup-container button[aria-label="Close"], .ytd-enforcement-message-view-model button, ytd-survey-renderer #dismiss-button button');
                if (surveyDismiss && surveyDismiss.offsetParent !== null) surveyDismiss.click();

                // "YouTube Premium" popup
                const premiumDismiss = document.querySelector('ytd-mealbar-promo-renderer #dismiss-button button, tp-yt-paper-dialog[id*="mealbar"] button[aria-label*="Dismiss"], tp-yt-paper-dialog[id*="mealbar"] #dismiss-button button');
                if (premiumDismiss && premiumDismiss.offsetParent !== null) premiumDismiss.click();
            },

            init() {
                addMutationRule('autoClosePopups', () => this._dismiss());
                addNavigateRule('autoClosePopups', () => setTimeout(() => this._dismiss(), 2000));
                this._dismiss();
            },
            destroy() {
                removeMutationRule('autoClosePopups');
                removeNavigateRule('autoClosePopups');
            }
        },
        {
            id: 'videoResolutionBadge',
            name: 'Resolution Badge on Thumbnails',
            description: 'Shows a 4K, HD, or SD badge on video thumbnails based on available quality',
            group: 'Content',
            icon: 'monitor',

            _addBadges() {
                const thumbnails = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
                thumbnails.forEach(item => {
                    if (item.querySelector('.ytkit-res-badge')) return;
                    const thumb = item.querySelector('ytd-thumbnail, #thumbnail');
                    if (!thumb) return;

                    // Try to detect quality from metadata
                    const qualityBadges = item.querySelectorAll('ytd-badge-supported-renderer .badge-style-type-simple, span.ytd-badge-supported-renderer');
                    let has4k = false;
                    let hasHd = false;
                    qualityBadges.forEach(b => {
                        const text = b.textContent?.trim()?.toUpperCase() || '';
                        if (text.includes('4K') || text.includes('2160')) has4k = true;
                        if (text.includes('HD') || text.includes('1080') || text.includes('720')) hasHd = true;
                    });

                    // Also check for quality overlays YouTube adds
                    const overlayBadge = item.querySelector('[overlay-style="RICH_METADATA"], ytd-thumbnail-overlay-time-status-renderer');
                    const metaLine = item.querySelector('#video-title, #meta');
                    if (metaLine) {
                        const aria = metaLine.getAttribute('aria-label') || '';
                        if (aria.includes('4K') || aria.includes('2160p')) has4k = true;
                        else if (aria.includes('1080p') || aria.includes('720p')) hasHd = true;
                    }

                    // Only add badge if we detected something
                    if (!has4k && !hasHd) return;

                    const badge = document.createElement('span');
                    badge.className = 'ytkit-res-badge';
                    badge.style.cssText = `position:absolute;bottom:4px;left:4px;z-index:50;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;line-height:1.4;letter-spacing:0.5px;`;

                    if (has4k) {
                        badge.textContent = '4K';
                        badge.style.background = 'rgba(168,85,247,0.9)';
                        badge.style.color = '#fff';
                    } else {
                        badge.textContent = 'HD';
                        badge.style.background = 'rgba(59,130,246,0.85)';
                        badge.style.color = '#fff';
                    }

                    thumb.style.position = 'relative';
                    thumb.appendChild(badge);
                });
            },

            init() {
                addNavigateRule('videoResolutionBadge', () => setTimeout(() => this._addBadges(), 1500));
                addMutationRule('videoResolutionBadge', () => this._addBadges());
                setTimeout(() => this._addBadges(), 1500);
            },
            destroy() {
                removeNavigateRule('videoResolutionBadge');
                removeMutationRule('videoResolutionBadge');
                document.querySelectorAll('.ytkit-res-badge').forEach(b => b.remove());
            }
        },
        {
            id: 'likeViewRatio',
            name: 'Like-to-View Ratio',
            description: 'Shows the like-to-view percentage next to the view count on watch pages',
            group: 'Watch Page',
            icon: 'percent',
            _el: null,

            _calculate() {
                if (location.pathname !== '/watch') return;
                document.querySelector('.ytkit-lv-ratio')?.remove();

                // Get view count
                const viewEl = document.querySelector('#info-container yt-formatted-string.bold, ytd-watch-metadata #info yt-formatted-string, #info-text #count .view-count');
                if (!viewEl) return;
                const viewText = viewEl.textContent?.replace(/[^0-9]/g, '');
                const views = parseInt(viewText);
                if (!views || isNaN(views)) return;

                // Get like count - check for RYD first, then native
                const likeBtn = document.querySelector('like-button-view-model button, ytd-toggle-button-renderer:first-child button[aria-label*="like" i]:not([aria-label*="dislike" i]), segmented-like-dislike-button-view-model button:first-child');
                if (!likeBtn) return;
                const likeAria = likeBtn.getAttribute('aria-label') || '';
                const likeMatch = likeAria.match(/[\d,]+/);
                if (!likeMatch) return;
                const likes = parseInt(likeMatch[0].replace(/,/g, ''));
                if (!likes || isNaN(likes)) return;

                const ratio = ((likes / views) * 100).toFixed(2);

                const badge = document.createElement('span');
                badge.className = 'ytkit-lv-ratio';
                badge.style.cssText = 'color:#aaa;font-size:12px;margin-left:8px;background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:12px;';
                badge.title = `${likes.toLocaleString()} likes / ${views.toLocaleString()} views`;
                badge.textContent = `${ratio}% liked`;

                const container = viewEl.parentElement;
                if (container) container.appendChild(badge);
                this._el = badge;
            },

            init() {
                addNavigateRule('likeViewRatio', () => {
                    this._el?.remove(); this._el = null;
                    setTimeout(() => this._calculate(), 3000);
                });
                setTimeout(() => this._calculate(), 3000);
            },
            destroy() {
                removeNavigateRule('likeViewRatio');
                this._el?.remove(); this._el = null;
                document.querySelector('.ytkit-lv-ratio')?.remove();
            }
        },
        {
            id: 'downloadThumbnail',
            name: 'Download Thumbnail Button',
            description: 'Adds a button below the video to download the current video thumbnail in max resolution',
            group: 'Watch Page',
            icon: 'image',
            _btn: null,

            _create() {
                if (location.pathname !== '/watch') return;
                if (document.querySelector('.ytkit-dl-thumb-btn')) return;

                const url = new URL(location.href);
                const videoId = url.searchParams.get('v');
                if (!videoId) return;

                const actions = document.querySelector('#actions, ytd-watch-metadata #actions, #top-level-buttons-computed');
                if (!actions) return;

                const btn = document.createElement('button');
                btn.className = 'ytkit-dl-thumb-btn';
                btn.title = 'Download Thumbnail';
                btn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;padding:6px 12px;border-radius:18px;font-size:12px;margin-left:8px;display:inline-flex;align-items:center;gap:4px;transition:background 0.2s;';
                btn.textContent = '\uD83D\uDDBC Thumbnail';
                btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,0.2)');
                btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255,255,255,0.1)');

                btn.addEventListener('click', async () => {
                    const thumbUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
                    try {
                        const resp = await fetch(thumbUrl);
                        if (!resp.ok) throw new Error('Not found');
                        const blob = await resp.blob();
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${videoId}_thumbnail.jpg`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                        btn.textContent = '\u2705 Downloaded';
                        setTimeout(() => btn.textContent = '\uD83D\uDDBC Thumbnail', 2000);
                    } catch(e) {
                        // Fallback to hqdefault
                        const a = document.createElement('a');
                        a.href = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                        a.download = `${videoId}_thumbnail.jpg`;
                        a.target = '_blank';
                        a.click();
                    }
                });

                actions.appendChild(btn);
                this._btn = btn;
            },

            init() {
                addNavigateRule('downloadThumbnail', () => {
                    this._btn = null;
                    setTimeout(() => this._create(), 2000);
                });
                setTimeout(() => this._create(), 2000);
            },
            destroy() {
                removeNavigateRule('downloadThumbnail');
                document.querySelectorAll('.ytkit-dl-thumb-btn').forEach(b => b.remove());
                this._btn = null;
            }
        },
        {
            id: 'grayscaleThumbnails',
            name: 'Grayscale Thumbnails',
            description: 'Shows thumbnails in grayscale to reduce visual distraction — color restores on hover',
            group: 'Content',
            icon: 'droplet',
            _styleEl: null,

            init() {
                const css = `
                    ytd-rich-item-renderer ytd-thumbnail img,
                    ytd-video-renderer ytd-thumbnail img,
                    ytd-grid-video-renderer ytd-thumbnail img,
                    ytd-compact-video-renderer ytd-thumbnail img {
                        filter: grayscale(100%) !important;
                        transition: filter 0.3s ease !important;
                    }
                    ytd-rich-item-renderer:hover ytd-thumbnail img,
                    ytd-video-renderer:hover ytd-thumbnail img,
                    ytd-grid-video-renderer:hover ytd-thumbnail img,
                    ytd-compact-video-renderer:hover ytd-thumbnail img {
                        filter: grayscale(0%) !important;
                    }
                `;
                this._styleEl = injectStyle(css, this.id, true);
            },
            destroy() { this._styleEl?.remove(); this._styleEl = null; }
        },
        {
            id: 'disableAutoplayNext',
            name: 'Disable Autoplay Next Video',
            description: 'Prevents the next video from automatically playing when the current one finishes',
            group: 'Playback',
            icon: 'skip-forward',

            _disable() {
                if (location.pathname !== '/watch') return;
                // Turn off autoplay toggle if it's on
                const toggle = document.querySelector('.ytp-autonav-toggle-button');
                if (!toggle) return;
                const isOn = toggle.getAttribute('aria-checked') === 'true';
                if (isOn) toggle.click();
            },

            init() {
                addNavigateRule('disableAutoplayNext', () => setTimeout(() => this._disable(), 2000));
                setTimeout(() => this._disable(), 2000);
            },
            destroy() { removeNavigateRule('disableAutoplayNext'); }
        },
        {
            id: 'channelSubCount',
            name: 'Enhanced Channel Info',
            description: 'Shows the channel subscriber count more prominently below videos',
            group: 'Watch Page',
            icon: 'users',
            _el: null,

            _show() {
                if (location.pathname !== '/watch') return;
                document.querySelector('.ytkit-sub-count-badge')?.remove();

                const ownerEl = document.querySelector('#owner #channel-name a, ytd-watch-metadata #owner ytd-channel-name a');
                if (!ownerEl) return;

                const subText = document.querySelector('#owner #owner-sub-count, ytd-watch-metadata #owner-sub-count');
                if (!subText) return;
                const count = subText.textContent?.trim();
                if (!count) return;

                const badge = document.createElement('span');
                badge.className = 'ytkit-sub-count-badge';
                badge.style.cssText = 'display:inline-block;color:#aaa;font-size:11px;background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle;';
                badge.textContent = count;

                const nameContainer = ownerEl.closest('#channel-name, ytd-channel-name');
                if (nameContainer) nameContainer.appendChild(badge);
                this._el = badge;
            },

            init() {
                addNavigateRule('channelSubCount', () => {
                    this._el?.remove(); this._el = null;
                    setTimeout(() => this._show(), 2500);
                });
                setTimeout(() => this._show(), 2500);
            },
            destroy() {
                removeNavigateRule('channelSubCount');
                this._el?.remove(); this._el = null;
                document.querySelector('.ytkit-sub-count-badge')?.remove();
            }
        },
        {
            id: 'customSpeedButtons',
            name: 'Speed Preset Buttons',
            description: 'Adds quick speed buttons (0.5x, 1x, 1.25x, 1.5x, 2x, 3x) below the video player',
            group: 'Video Player',
            icon: 'fast-forward',
            _container: null,

            _create() {
                if (location.pathname !== '/watch') return;
                if (document.querySelector('.ytkit-speed-presets')) return;

                const below = document.querySelector('#below, ytd-watch-metadata');
                if (!below) return;

                const container = document.createElement('div');
                container.className = 'ytkit-speed-presets';
                container.style.cssText = 'display:flex;gap:6px;padding:8px 0;flex-wrap:wrap;';

                const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
                speeds.forEach(speed => {
                    const btn = document.createElement('button');
                    btn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;padding:4px 10px;border-radius:14px;font-size:12px;font-weight:500;transition:background 0.2s;';
                    btn.textContent = `${speed}x`;
                    btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,255,255,0.2)');
                    btn.addEventListener('mouseleave', () => {
                        const video = document.querySelector('video');
                        btn.style.background = video && Math.abs(video.playbackRate - speed) < 0.01 ? 'rgba(62,166,255,0.3)' : 'rgba(255,255,255,0.1)';
                    });
                    btn.addEventListener('click', () => {
                        const video = document.querySelector('video');
                        if (video) {
                            video.playbackRate = speed;
                            // Update all button styles
                            container.querySelectorAll('button').forEach(b => {
                                b.style.background = 'rgba(255,255,255,0.1)';
                            });
                            btn.style.background = 'rgba(62,166,255,0.3)';
                        }
                    });

                    // Highlight current speed
                    const video = document.querySelector('video');
                    if (video && Math.abs(video.playbackRate - speed) < 0.01) {
                        btn.style.background = 'rgba(62,166,255,0.3)';
                    }

                    container.appendChild(btn);
                });

                below.insertBefore(container, below.firstChild);
                this._container = container;
            },

            init() {
                addNavigateRule('customSpeedButtons', () => {
                    this._container?.remove(); this._container = null;
                    setTimeout(() => this._create(), 2000);
                });
                setTimeout(() => this._create(), 2000);
            },
            destroy() {
                removeNavigateRule('customSpeedButtons');
                this._container?.remove(); this._container = null;
                document.querySelectorAll('.ytkit-speed-presets').forEach(c => c.remove());
            }
        },
        {
            id: 'openInNewTab',
            name: 'Open Videos in New Tab',
            description: 'Makes video links on the home/subscriptions page open in a new tab instead of navigating away',
            group: 'Content',
            icon: 'external-link',
            _handler: null,

            init() {
                this._handler = (e) => {
                    // Only on non-watch pages
                    if (location.pathname === '/watch') return;

                    const link = e.target.closest('a[href*="/watch"], a[href*="/shorts/"]');
                    if (!link) return;

                    // Don't interfere if user is already holding Ctrl/Cmd
                    if (e.ctrlKey || e.metaKey) return;

                    // Only thumbnail and title links
                    const isThumbnail = link.id === 'thumbnail' || link.closest('ytd-thumbnail');
                    const isTitle = link.id === 'video-title-link' || link.id === 'video-title' || link.closest('#video-title, h3');
                    if (!isThumbnail && !isTitle) return;

                    e.preventDefault();
                    e.stopPropagation();
                    window.open(link.href, '_blank');
                };
                document.addEventListener('click', this._handler, true);
            },
            destroy() {
                if (this._handler) { document.removeEventListener('click', this._handler, true); this._handler = null; }
            }
        },

        // ═══════════════════════════════════════════════════════════════
        //  WAVE 8: RESTORED ARCHIVE FEATURES
        // ═══════════════════════════════════════════════════════════════


        // ── CSS-Only Features ──
        cssFeature('hideNotificationButton', 'Hide Notification Bell', 'Remove the notification bell icon from the header', 'Interface', 'bell-off',
            `ytd-notification-topbar-button-renderer, ytd-topbar-menu-button-renderer:has(a[href="/notifications"]) { display: none !important; }`),

        cssFeature('noFrostedGlass', 'Disable Frosted Glass', 'Remove blur effects from UI elements', 'Appearance', 'droplet',
            `* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`),

        cssFeature('hideLatestPosts', 'Hide Latest Posts', 'Hide community posts and updates sections from feeds', 'Content', 'file-x',
            `ytd-rich-section-renderer:has(ytd-post-renderer), ytd-rich-section-renderer:has(ytd-backstage-post-thread-renderer), ytd-post-renderer, ytd-backstage-post-thread-renderer, ytd-reel-shelf-renderer:has(ytd-backstage-post-thread-renderer) { display: none !important; }`),

        cssFeature('disableMiniPlayer', 'Disable Mini Player', 'Prevent the mini player from appearing when navigating away', 'Video Player', 'minimize-2',
            `ytd-miniplayer[active] { display: none !important; } .ytp-miniplayer-button { display: none !important; }`),

        cssFeature('nyanCatProgressBar', 'Nyan Cat Progress Bar', 'Replace the video progress bar with a Nyan Cat animation', 'Appearance', 'cat',
            `.ytp-play-progress {
                background: linear-gradient(180deg, #ff0000 0%, #ff9900 16.6%, #ffff00 33.3%, #33ff00 50%, #0099ff 66.6%, #6633ff 83.3%, #ff0000 100%) !important;
                background-size: 100% 600% !important;
                animation: ytkit-nyan-rainbow 1s linear infinite !important;
                height: 100% !important;
            }
            .ytp-scrubber-container .ytp-scrubber-button {
                background: radial-gradient(circle, #ff69b4, #ffcc00, #66ff66) !important;
                border-radius: 50% !important;
                width: 16px !important; height: 16px !important;
                box-shadow: 0 0 8px rgba(255,105,180,0.6) !important;
            }
            @keyframes ytkit-nyan-rainbow { 0% { background-position: 0% 0%; } 100% { background-position: 0% 100%; } }`),

        // ── Prevent Autoplay ──
        {
            id: 'preventAutoplay',
            name: 'Prevent Autoplay',
            description: 'Stop videos from automatically playing on page load',
            group: 'Playback',
            icon: 'pause-circle',
            _navHandler: null,
            init() {
                const pauseRule = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const video = document.querySelector('video.html5-main-video');
                    const player = document.getElementById('movie_player');
                    if (video && player && !video.paused) {
                        video.pause();
                        player.classList.remove('playing-mode');
                        player.classList.add('paused-mode');
                    }
                };
                this._navHandler = () => setTimeout(pauseRule, 500);
                window.addEventListener('yt-navigate-finish', this._navHandler);
                setTimeout(pauseRule, 500);
            },
            destroy() {
                if (this._navHandler) {
                    window.removeEventListener('yt-navigate-finish', this._navHandler);
                    this._navHandler = null;
                }
            }
        },

        // ── Auto-Open Chapters ──
        {
            id: 'autoOpenChapters',
            name: 'Auto-Open Chapters',
            description: 'Automatically open the chapters panel when available',
            group: 'Playback',
            icon: 'list-tree',
            init() {
                const openChapters = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    setTimeout(() => {
                        const chaptersButton = document.querySelector('ytd-video-description-chapters-section-renderer button');
                        if (chaptersButton && !document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"]')) {
                            chaptersButton.click();
                        }
                    }, 1000);
                };
                addNavigateRule(this.id, openChapters);
            },
            destroy() { removeNavigateRule(this.id); }
        },

        // ── Auto-Open Transcript ──
        {
            id: 'autoOpenTranscript',
            name: 'Auto-Open Transcript',
            description: 'Automatically open the transcript panel when available',
            group: 'Playback',
            icon: 'scroll-text',
            init() {
                const openTranscript = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    setTimeout(() => {
                        const moreBtn = document.querySelector('ytd-video-description-transcript-section-renderer button');
                        if (moreBtn && !document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]')) {
                            moreBtn.click();
                        }
                    }, 1200);
                };
                addNavigateRule(this.id, openTranscript);
            },
            destroy() { removeNavigateRule(this.id); }
        },

        // ── Sort Notifications Chronologically ──
        {
            id: 'chronologicalNotifications',
            name: 'Sort Notifications',
            description: 'Sort notifications chronologically (newest first)',
            group: 'Advanced',
            icon: 'bell-ring',
            _observer: null,
            init() {
                const sortNotifications = () => {
                    const container = document.querySelector('ytd-notification-renderer');
                    if (!container) return;
                    const parent = container.parentElement;
                    if (!parent || parent.dataset.sorted) return;
                    const items = Array.from(parent.querySelectorAll('ytd-notification-renderer'));
                    if (items.length < 2) return;
                    items.sort((a, b) => {
                        const timeA = a.querySelector('#message')?.textContent || '';
                        const timeB = b.querySelector('#message')?.textContent || '';
                        return timeB.localeCompare(timeA);
                    });
                    items.forEach(item => parent.appendChild(item));
                    parent.dataset.sorted = 'true';
                };
                this._observer = new MutationObserver(sortNotifications);
                const popup = document.querySelector('ytd-popup-container');
                if (popup) this._observer.observe(popup, { childList: true, subtree: true });
            },
            destroy() { this._observer?.disconnect(); this._observer = null; }
        },

        // ── Preload Comments ──
        {
            id: 'preloadComments',
            name: 'Preload Comments',
            description: 'Eagerly load the comment section so it is ready when you scroll down',
            group: 'Playback',
            icon: 'message-square',
            init() {
                const preloadRule = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const tryPreload = (attempts = 0) => {
                        if (document.querySelector('ytd-comments#comments ytd-comment-thread-renderer')) return;
                        const continuation = document.querySelector('ytd-comments#comments ytd-continuation-item-renderer');
                        if (!continuation) {
                            if (attempts < 30) setTimeout(() => tryPreload(attempts + 1), 500);
                            return;
                        }
                        const orig = continuation.style.cssText;
                        continuation.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;z-index:-1!important;';
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => { continuation.style.cssText = orig; });
                        });
                    };
                    setTimeout(() => tryPreload(), 1500);
                };
                addNavigateRule(this.id, preloadRule);
            },
            destroy() { removeNavigateRule(this.id); }
        },

        // ── Adaptive Live Layout ──
        {
            id: 'adaptiveLiveLayout',
            name: 'Adaptive Live Layout',
            description: 'Automatically adjust layout for live stream chat side-by-side',
            group: 'Video Player',
            icon: 'cast',
            _styleElement: null,
            init() {
                const css = `
                    body.ytkit-adaptive-live ytd-watch-flexy[theater] #columns.ytd-watch-flexy {
                        flex-direction: row !important; max-width: none !important;
                    }
                    body.ytkit-adaptive-live ytd-watch-flexy[theater] #primary.ytd-watch-flexy {
                        flex: 1 1 auto !important; max-width: none !important;
                    }
                    body.ytkit-adaptive-live ytd-watch-flexy[theater] #secondary.ytd-watch-flexy {
                        display: block !important; flex: 0 0 400px !important; max-width: 400px !important;
                    }
                    body.ytkit-adaptive-live ytd-live-chat-frame { min-height: 500px !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                const checkLive = () => {
                    const isWatch = window.location.pathname.startsWith('/watch');
                    const liveBadge = document.querySelector('.ytp-live-badge');
                    const isLive = isWatch && liveBadge && window.getComputedStyle(liveBadge).display !== 'none';
                    document.body.classList.toggle('ytkit-adaptive-live', isLive);
                };
                addMutationRule(this.id, checkLive);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove(); this._styleElement = null;
                document.body.classList.remove('ytkit-adaptive-live');
            }
        },

        // ── Comment Navigator ──
        {
            id: 'commentNavigator',
            name: 'Comment Navigator',
            description: 'Quick-jump between top-level comments with floating prev/next buttons',
            group: 'Advanced',
            icon: 'messages-square',
            _container: null,
            _currentIndex: -1,
            init() {
                const self = this;
                const createNav = () => {
                    if (self._container || !window.location.pathname.startsWith('/watch')) return;
                    const nav = document.createElement('div');
                    nav.id = 'ytkit-comment-nav';
                    nav.style.cssText = 'position:fixed;right:20px;bottom:100px;display:flex;flex-direction:column;gap:6px;z-index:9999;';
                    const makeBtn = (label, arrow, direction) => {
                        const btn = document.createElement('button');
                        btn.title = label;
                        btn.textContent = arrow;
                        btn.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.15);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;transition:all 0.2s;';
                        btn.onmouseenter = () => { btn.style.background = 'rgba(200,0,0,0.8)'; };
                        btn.onmouseleave = () => { btn.style.background = 'rgba(0,0,0,0.8)'; };
                        btn.onclick = () => self._navigate(direction);
                        return btn;
                    };
                    nav.appendChild(makeBtn('Previous comment', '\u25B2', -1));
                    nav.appendChild(makeBtn('Next comment', '\u25BC', 1));
                    document.body.appendChild(nav);
                    self._container = nav;
                };
                addNavigateRule(this.id, () => {
                    self._currentIndex = -1;
                    self._container?.remove(); self._container = null;
                    setTimeout(createNav, 2000);
                });
            },
            _navigate(direction) {
                const threads = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'));
                if (!threads.length) return;
                this._currentIndex = Math.max(0, Math.min(threads.length - 1, this._currentIndex + direction));
                threads[this._currentIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            },
            destroy() {
                removeNavigateRule(this.id);
                this._container?.remove(); this._container = null;
            }
        },

        // ── Shorts Player Controls ──
        {
            id: 'shortsAsRegularVideo',
            name: 'Shorts Player Controls',
            description: 'Add native HTML5 player controls (progress bar, speed, quality) to YouTube Shorts',
            group: 'Content',
            icon: 'film',
            _styleElement: null,
            init() {
                const css = `
                    ytd-reel-video-renderer video::-webkit-media-controls { display: flex !important; opacity: 1 !important; }
                    ytd-reel-video-renderer .overlay.ytd-reel-video-renderer { pointer-events: none; }
                    ytd-reel-video-renderer .overlay.ytd-reel-video-renderer > * { pointer-events: auto; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                const enhanceShorts = () => {
                    document.querySelectorAll('ytd-reel-video-renderer:not([data-ytkit-shorts-enhanced])').forEach(reel => {
                        reel.dataset.ytkitShortsEnhanced = '1';
                        const video = reel.querySelector('video');
                        if (!video) return;
                        video.controls = true;
                        video.style.objectFit = 'contain';
                        video.removeAttribute('loop');
                    });
                };
                addMutationRule(this.id, enhanceShorts);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove(); this._styleElement = null;
                document.querySelectorAll('[data-ytkit-shorts-enhanced]').forEach(el => {
                    delete el.dataset.ytkitShortsEnhanced;
                    const v = el.querySelector('video');
                    if (v) v.controls = false;
                });
            }
        },

        // ── Theme Accent Color ──
        {
            id: 'themeAccentColor',
            name: 'Accent Color',
            description: 'Custom accent color for highlights, progress bar, and active UI elements',
            group: 'Theme',
            icon: 'palette',
            type: 'color',
            _styleElement: null,
            init() {
                const accent = appState.settings.themeAccentColor;
                if (!accent || !/^#[0-9a-fA-F]{3,8}$/.test(accent)) return;
                const css = `
                    :root { --ytkit-accent: ${accent} !important; }
                    .ytp-swatch-background-color, .ytp-play-progress,
                    #progress.ytd-thumbnail-overlay-resume-playback-renderer {
                        background: ${accent} !important;
                    }
                    yt-chip-cloud-chip-renderer[selected] {
                        background-color: ${accent} !important;
                    }
                    ytd-toggle-button-renderer.style-default-active[is-icon-button] yt-icon {
                        color: ${accent} !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },

        // ── Theater Auto-Scroll ──
        {
            id: 'theaterAutoScroll',
            name: 'Theater Auto-Scroll',
            description: 'Scroll video into full view when theater mode activates',
            group: 'Video Player',
            icon: 'tv',
            isSubFeature: true,
            parentId: 'autoTheaterMode',
            init() {
                addNavigateRule(this.id, () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    if (!appState.settings.autoTheaterMode) return;
                    setTimeout(() => {
                        const watchFlexy = document.querySelector('ytd-watch-flexy');
                        if (watchFlexy?.hasAttribute('theater')) {
                            const player = document.querySelector('#player-container, #movie_player');
                            if (player) player.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }, 500);
                });
            },
            destroy() { removeNavigateRule(this.id); }
        },

        // ── Scroll Wheel Speed ──
        {
            id: 'scrollWheelSpeed',
            name: 'Scroll Wheel Speed',
            description: 'Adjust playback speed by scrolling the mouse wheel over the video player',
            group: 'Playback',
            icon: 'gauge',
            _wheelHandler: null,
            init() {
                const step = appState.settings.speedStep || 0.25;
                this._wheelHandler = (e) => {
                    if (e.ctrlKey) return; // Let videoZoom handle Ctrl+scroll
                    const player = document.querySelector('#movie_player, .html5-video-player');
                    if (!player || !player.contains(e.target)) return;
                    if (e.target.closest('.ytp-chrome-bottom, .ytp-settings-menu')) return;
                    if (!e.shiftKey) return; // Require Shift+scroll for speed adjustment
                    const video = player.querySelector('video');
                    if (!video) return;
                    e.preventDefault();
                    const dir = e.deltaY < 0 ? 1 : -1;
                    const newSpeed = Math.round(Math.max(0.1, Math.min(16, video.playbackRate + dir * step)) * 100) / 100;
                    video.playbackRate = newSpeed;
                    showToast(`Speed: ${newSpeed}x`, '#3b82f6', { duration: 1000 });
                };
                document.addEventListener('wheel', this._wheelHandler, { passive: false, capture: true });
            },
            destroy() {
                if (this._wheelHandler) document.removeEventListener('wheel', this._wheelHandler, { capture: true });
                this._wheelHandler = null;
            }
        },
        {
            id: 'speedStep',
            name: 'Speed Step Amount',
            description: 'How much to change speed per scroll tick',
            group: 'Playback',
            icon: 'gauge',
            isSubFeature: true,
            parentId: 'scrollWheelSpeed',
            type: 'range',
            min: 0.05, max: 1.0, step: 0.05,
            init() {}, destroy() {}
        },

        // ── Playback Speed OSD ──
        {
            id: 'playbackSpeedOSD',
            name: 'Speed Change OSD',
            description: 'Show speed overlay on the video player (like VLC) instead of corner toast',
            group: 'Playback',
            icon: 'gauge',
            _pollInterval: null,
            _lastSpeed: null,
            _osdTimeout: null,
            init() {
                const self = this;
                const checkSpeed = () => {
                    const video = document.querySelector('video.html5-main-video');
                    if (!video) return;
                    if (self._lastSpeed !== null && video.playbackRate !== self._lastSpeed) {
                        self._showOSD(video.playbackRate);
                    }
                    self._lastSpeed = video.playbackRate;
                };
                this._pollInterval = setInterval(checkSpeed, 200);
            },
            _showOSD(speed) {
                const player = document.querySelector('#movie_player');
                if (!player) return;
                let osd = player.querySelector('#ytkit-speed-osd');
                if (!osd) {
                    osd = document.createElement('div');
                    osd.id = 'ytkit-speed-osd';
                    osd.style.cssText = 'position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:6px;font-size:18px;font-weight:700;font-family:"Roboto",sans-serif;z-index:60;pointer-events:none;transition:opacity 0.3s;opacity:0;';
                    player.appendChild(osd);
                }
                osd.textContent = `${speed}x`;
                osd.style.opacity = '1';
                clearTimeout(this._osdTimeout);
                this._osdTimeout = setTimeout(() => { if (osd) osd.style.opacity = '0'; }, 1200);
            },
            destroy() {
                if (this._pollInterval) clearInterval(this._pollInterval);
                this._pollInterval = null;
                clearTimeout(this._osdTimeout);
                document.querySelector('#ytkit-speed-osd')?.remove();
            }
        },

        // ── CPU Tamer ──
        {
            id: 'enableCPU_Tamer',
            name: 'CPU Tamer',
            description: 'Reduce CPU usage by throttling background timers via requestAnimationFrame gating',
            group: 'Advanced',
            icon: 'cpu',
            _originals: null,
            init() {
                this._originals = {
                    setTimeout: window.setTimeout,
                    setInterval: window.setInterval,
                    clearTimeout: window.clearTimeout,
                    clearInterval: window.clearInterval
                };
                const originals = this._originals;
                const win = window;
                if (win.__ytkit_cpu_tamer) return;
                win.__ytkit_cpu_tamer = true;
                const { setTimeout: origSetTimeout, setInterval: origSetInterval, clearTimeout: origClearTimeout, clearInterval: origClearInterval } = originals;
                const PromiseCtor = (async () => {})().constructor;
                let canvas;
                try { canvas = document.createElement('canvas'); } catch(e) { return; }
                if (!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))) return;
                let afHandler = null;
                const rafPromise = (resolve) => requestAnimationFrame(afHandler = resolve);
                let p1 = { resolved: true }, p2 = { resolved: true };
                const resolveAF = async (pw) => {
                    await new PromiseCtor(rafPromise);
                    pw.resolved = true;
                    if (pw.resolve) pw.resolve();
                };
                const executeThrottled = async () => {
                    if (!p1.resolved && !p2.resolved) await PromiseCtor.race([p1, p2]);
                    else if (!p1.resolved) await p1;
                    else if (!p2.resolved) await p2;
                    p1 = { resolve: null, resolved: false }; resolveAF(p1);
                    p2 = { resolve: null, resolved: false }; resolveAF(p2);
                };
                const throttledWrapper = async (handler, store) => {
                    try {
                        const now = Date.now();
                        if (now - store.lastCall < 800) await executeThrottled();
                        store.lastCall = now;
                        handler();
                    } catch(e) {}
                };
                const schedule = (origFn) => (func, ms = 0, ...args) => {
                    if (typeof func === 'function') {
                        const store = { lastCall: Date.now() };
                        const handler = args.length ? func.bind(null, ...args) : func;
                        return origFn(() => throttledWrapper(handler, store), ms);
                    }
                    return origFn(func, ms, ...args);
                };
                win.setTimeout = schedule(origSetTimeout);
                win.setInterval = schedule(origSetInterval);
                origSetInterval(() => {
                    if (afHandler) { afHandler(); afHandler = null; }
                }, 125);
            },
            destroy() {
                if (this._originals) {
                    window.setTimeout = this._originals.setTimeout;
                    window.setInterval = this._originals.setInterval;
                    window.clearTimeout = this._originals.clearTimeout;
                    window.clearInterval = this._originals.clearInterval;
                }
                window.__ytkit_cpu_tamer = false;
            }
        },

        // ── Comment Handle Revealer ──
        {
            id: 'enableHandleRevealer',
            name: 'Comment Handle Revealer',
            description: 'Show the original channel name next to @handle in comments',
            group: 'Advanced',
            icon: 'at-sign',
            _observer: null,
            _nameMap: null,
            init() {
                this._nameMap = new Map();
                const nameMap = this._nameMap;
                const pageManager = document.getElementById('page-manager');
                if (!pageManager) return;
                const decode = (() => {
                    const ENTITIES = [['amp','&'],['apos',"'"],['quot','"'],['nbsp',' '],['lt','<'],['gt','>'],['#39',"'"]];
                    return s => ENTITIES.reduce((acc, [e, sym]) => acc.replaceAll(`&${e};`, sym), s);
                })();
                const appendName = (anchor, name) => {
                    if (anchor.querySelector('span[data-ytkit-name]')) return;
                    const span = document.createElement('span');
                    span.textContent = `( ${name} )`;
                    span.style.cssText = 'margin-left:4px;color:var(--yt-spec-text-secondary);font-size:0.9em;';
                    span.dataset.ytkitName = name;
                    const target = anchor.querySelector('#author-text') || anchor;
                    target.appendChild(span);
                };
                this._observer = new MutationObserver(records => {
                    for (const r of records) {
                        for (const node of r.addedNodes) {
                            if (!(node instanceof HTMLElement)) continue;
                            const vms = node.tagName === 'YTD-COMMENT-VIEW-MODEL' ? [node] :
                                Array.from(node.querySelectorAll?.('ytd-comment-view-model') || []);
                            for (const vm of vms) {
                                for (const author of vm.querySelectorAll('#author-text')) {
                                    const handle = author.textContent.trim();
                                    if (!handle || !author.href) continue;
                                    if (nameMap.has(handle)) {
                                        const n = nameMap.get(handle);
                                        if (n) appendName(author, n);
                                        continue;
                                    }
                                    nameMap.set(handle, null);
                                    fetch(author.href).then(async resp => {
                                        const text = await resp.text();
                                        const m = text.match(/(?<=<title>).+?(?= - YouTube)/);
                                        if (m) {
                                            const decoded = decode(m[0]);
                                            nameMap.set(handle, decoded);
                                            appendName(author, decoded);
                                        } else nameMap.delete(handle);
                                    }).catch(() => nameMap.delete(handle));
                                }
                            }
                        }
                    }
                });
                this._observer.observe(pageManager, { childList: true, subtree: true });
            },
            destroy() {
                this._observer?.disconnect(); this._observer = null;
                document.querySelectorAll('span[data-ytkit-name]').forEach(el => el.remove());
                this._nameMap = null;
            }
        },

        // ── VLC Queue Button ──
        {
            id: 'showVlcQueueButton',
            name: 'VLC Queue Button',
            description: 'Add button to queue video in VLC (plays after current)',
            group: 'Downloads',
            icon: 'list-plus',
            init() {
                const createButton = () => {
                    const btn = document.createElement('a');
                    btn.className = 'ytkit-vlc-queue-btn';
                    btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:18px;background:#ea580c;color:#fff;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;transition:opacity 0.2s;margin-left:6px;';
                    btn.textContent = '+Q VLC';
                    btn.title = 'Queue in VLC';
                    btn.addEventListener('click', () => {
                        const url = window.location.href;
                        window.open('ytvlcq://' + encodeURIComponent(url), '_self');
                        showToast('Queued in VLC', '#ea580c');
                    });
                    return btn;
                };
                registerPersistentButton('vlcQueueButton', '#top-level-buttons-computed', '.ytkit-vlc-queue-btn', createButton);
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('vlcQueueButton');
                document.querySelector('.ytkit-vlc-queue-btn')?.remove();
            }
        },

        // ── MPV Player Button ──
        {
            id: 'showMpvButton',
            name: 'MPV Player Button',
            description: 'Stream video directly in MPV media player',
            group: 'Downloads',
            icon: 'play-circle',
            init() {
                const createButton = () => {
                    const btn = document.createElement('a');
                    btn.className = 'ytkit-mpv-btn';
                    btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:18px;background:#8b5cf6;color:#fff;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;transition:opacity 0.2s;margin-left:6px;';
                    btn.textContent = 'MPV';
                    btn.title = 'Stream in MPV';
                    btn.addEventListener('click', () => {
                        const url = window.location.href;
                        window.open('ytmpv://' + encodeURIComponent(url), '_self');
                        showToast('Opening in MPV', '#8b5cf6');
                    });
                    return btn;
                };
                registerPersistentButton('mpvButton', '#top-level-buttons-computed', '.ytkit-mpv-btn', createButton);
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('mpvButton');
                document.querySelector('.ytkit-mpv-btn')?.remove();
            }
        },

        // ── Auto-Download on Visit ──
        {
            id: 'autoDownloadOnVisit',
            name: 'Auto-Download Videos',
            description: 'Automatically start download when visiting a video page',
            group: 'Downloads',
            icon: 'download',
            _lastDownloaded: null,
            init() {
                const self = this;
                addNavigateRule(this.id, () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const videoId = getVideoId();
                    if (!videoId || videoId === self._lastDownloaded) return;
                    self._lastDownloaded = videoId;
                    setTimeout(() => {
                        window.open('ytdl://' + encodeURIComponent(window.location.href), '_self');
                        showToast('Auto-download started', '#22c55e');
                    }, 2000);
                });
            },
            destroy() {
                removeNavigateRule(this.id);
                this._lastDownloaded = null;
            }
        },

        // ── Download Quality Selector ──
        {
            id: 'downloadQuality',
            name: 'Download Quality',
            description: 'Preferred video quality for downloads',
            group: 'Downloads',
            icon: 'settings-2',
            type: 'select',
            options: [
                { value: 'best', label: 'Best Available' },
                { value: '2160', label: '4K (2160p)' },
                { value: '1440', label: '2K (1440p)' },
                { value: '1080', label: 'Full HD (1080p)' },
                { value: '720', label: 'HD (720p)' },
                { value: '480', label: 'SD (480p)' }
            ],
            init() {}, destroy() {}
        },

        // ── Preferred Media Player ──
        {
            id: 'preferredMediaPlayer',
            name: 'Preferred Media Player',
            description: 'Default player for streaming videos',
            group: 'Downloads',
            icon: 'monitor-play',
            type: 'select',
            options: [
                { value: 'vlc', label: 'VLC' },
                { value: 'mpv', label: 'MPV' },
                { value: 'potplayer', label: 'PotPlayer' },
                { value: 'mpc-hc', label: 'MPC-HC' }
            ],
            init() {}, destroy() {}
        },

        // ── Download & Play Button ──
        {
            id: 'showDownloadPlayButton',
            name: 'Download & Play',
            description: 'Download video first, then open in VLC for better quality',
            group: 'Downloads',
            icon: 'download',
            init() {
                const createButton = () => {
                    const btn = document.createElement('a');
                    btn.className = 'ytkit-dlplay-btn';
                    btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:18px;background:linear-gradient(135deg,#22c55e,#f97316);color:#fff;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;transition:opacity 0.2s;margin-left:6px;';
                    btn.textContent = 'DL+Play';
                    btn.title = 'Download then play in VLC';
                    btn.addEventListener('click', () => {
                        window.open('ytdlplay://' + encodeURIComponent(window.location.href), '_self');
                        showToast('Downloading & opening in VLC', '#22c55e');
                    });
                    return btn;
                };
                registerPersistentButton('dlPlayButton', '#top-level-buttons-computed', '.ytkit-dlplay-btn', createButton);
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('dlPlayButton');
                document.querySelector('.ytkit-dlplay-btn')?.remove();
            }
        },

        // ── Subscriptions VLC Playlist ──
        {
            id: 'subsVlcPlaylist',
            name: 'Subscriptions VLC Queue',
            description: 'Queue all subscription page videos to VLC playlist',
            group: 'Downloads',
            icon: 'list-video',
            _styleElement: null,
            _observer: null,
            _container: null,
            init() {
                const self = this;
                const css = `
                    .ytkit-video-queued { opacity: 0.5 !important; }
                    .ytkit-queued-badge {
                        position:absolute;top:4px;right:4px;background:#22c55e;color:#fff;
                        font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;z-index:10;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                const STORAGE_KEY = 'ytkit-queued-videos';
                const getQueued = () => { try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch(e) { return new Set(); } };
                const saveQueued = (s) => { localStorage.setItem(STORAGE_KEY, JSON.stringify([...s])); };
                const createUI = () => {
                    if (self._container || !window.location.pathname.startsWith('/feed/subscriptions')) return;
                    const btn = document.createElement('button');
                    btn.className = 'ytkit-subs-vlc-btn';
                    btn.textContent = 'Queue All to VLC';
                    btn.style.cssText = 'position:fixed;top:56px;right:24px;z-index:9999;padding:8px 16px;border-radius:8px;background:#f97316;color:#fff;font-weight:600;font-size:13px;border:none;cursor:pointer;transition:all 0.2s;';
                    btn.addEventListener('click', async () => {
                        const queued = getQueued();
                        const links = document.querySelectorAll('a#thumbnail[href*="/watch"]');
                        let count = 0;
                        for (const a of links) {
                            const url = new URL(a.href, location.origin);
                            const vid = url.searchParams.get('v');
                            if (!vid || queued.has(vid)) continue;
                            queued.add(vid);
                            window.open('ytvlcq://' + encodeURIComponent(a.href), '_self');
                            const renderer = a.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer');
                            if (renderer) renderer.classList.add('ytkit-video-queued');
                            count++;
                            await new Promise(r => setTimeout(r, 300));
                        }
                        saveQueued(queued);
                        showToast(`Queued ${count} videos to VLC`, '#f97316');
                    });
                    const clearBtn = document.createElement('button');
                    clearBtn.textContent = 'Clear Queue';
                    clearBtn.style.cssText = 'position:fixed;top:56px;right:200px;z-index:9999;padding:8px 16px;border-radius:8px;background:#6b7280;color:#fff;font-weight:600;font-size:13px;border:none;cursor:pointer;';
                    clearBtn.addEventListener('click', () => {
                        localStorage.removeItem(STORAGE_KEY);
                        document.querySelectorAll('.ytkit-video-queued').forEach(el => el.classList.remove('ytkit-video-queued'));
                        document.querySelectorAll('.ytkit-queued-badge').forEach(el => el.remove());
                        showToast('Queue cleared', '#6b7280');
                    });
                    document.body.appendChild(btn);
                    document.body.appendChild(clearBtn);
                    self._container = btn;
                };
                addNavigateRule(this.id, () => {
                    self._container?.remove();
                    document.querySelector('.ytkit-subs-vlc-btn')?.remove();
                    document.querySelector('.ytkit-subs-clear-btn')?.remove();
                    self._container = null;
                    createUI();
                });
            },
            destroy() {
                removeNavigateRule(this.id);
                this._styleElement?.remove(); this._styleElement = null;
                this._container?.remove(); this._container = null;
                document.querySelectorAll('.ytkit-subs-vlc-btn, .ytkit-subs-clear-btn, .ytkit-queued-badge').forEach(el => el.remove());
                document.querySelectorAll('.ytkit-video-queued').forEach(el => el.classList.remove('ytkit-video-queued'));
            }
        },


        // ── DeArrow ──
        {
            id: 'deArrow',
            name: 'DeArrow',
            description: 'Replace clickbait titles and thumbnails with crowdsourced alternatives from the DeArrow database',
            group: 'Content',
            icon: 'type',
            isParent: true,
            _cache: {},
            _cacheMeta: {},
            _observer: null,
            _navHandler: null,
            _generation: 0,
            _processTimer: null,
            _TITLE_SELECTORS: '#video-title, #video-title-link, h3.ytd-rich-grid-media a#video-title-link',
            _WATCH_TITLE_SELECTORS: 'ytd-watch-metadata h1.ytd-watch-metadata yt-formatted-string, ytd-watch-metadata h1 yt-formatted-string',
            _persistTimer: null,
            init() {
                const self = this;
                // Load persistent cache
                try {
                    const cached = GM_getValue('da_branding_cache', null);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        const ttl = parseInt(appState.settings.daCacheTTL || '4', 10) * 3600000;
                        const maxAge = ttl * 6 || 86400000;
                        const now = Date.now();
                        for (const [k, v] of Object.entries(parsed)) {
                            if (v._ts && (now - v._ts) < maxAge) {
                                self._cache[k] = v;
                                self._cacheMeta[k] = v._ts;
                            }
                        }
                    }
                } catch(e) {}
                const css = `
                    .daCustomTitle { display: block !important; }
                    .daCustomTitle + [id="video-title"], .daCustomTitle + a#video-title-link { display: none !important; }
                `;
                this._styleEl = injectStyle(css, this.id, true);
                this._navHandler = () => {
                    self._generation++;
                    clearTimeout(self._processTimer);
                    document.querySelectorAll('.daCustomTitle').forEach(c => c.remove());
                    document.querySelectorAll('[data-da-processed]').forEach(el => {
                        delete el.dataset.daProcessed;
                        el.style.display = '';
                    });
                    document.querySelectorAll('.da-replaced-thumb').forEach(el => {
                        if (el.dataset.daOrigSrc) { el.src = el.dataset.daOrigSrc; delete el.dataset.daOrigSrc; }
                        el.classList.remove('da-replaced-thumb');
                    });
                    if (!window.location.pathname.startsWith('/watch')) {
                        setTimeout(() => self._processPage(), 1000);
                    }
                };
                window.addEventListener('yt-navigate-finish', this._navHandler);
                if (!window.location.pathname.startsWith('/watch')) {
                    setTimeout(() => self._processPage(), 800);
                }
                this._observer = new MutationObserver(() => {
                    if (window.location.pathname.startsWith('/watch')) return;
                    clearTimeout(self._processTimer);
                    self._processTimer = setTimeout(() => self._processPage(), 300);
                });
                this._observer.observe(document.body, { childList: true, subtree: true });
            },
            async _fetchBranding(videoId) {
                if (this._cache[videoId]) return this._cache[videoId];
                const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
                const prefix = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('').substring(0, 4);
                return new Promise((resolve) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://sponsor.ajay.app/api/branding?videoID=${videoId}`,
                        timeout: 8000,
                        onload: (resp) => {
                            try {
                                const data = JSON.parse(resp.responseText);
                                data._ts = Date.now();
                                this._cache[videoId] = data;
                                this._cacheMeta[videoId] = data._ts;
                                this._schedulePersist();
                                resolve(data);
                            } catch(e) { resolve(null); }
                        },
                        onerror: () => resolve(null),
                        ontimeout: () => resolve(null)
                    });
                });
            },
            _schedulePersist() {
                clearTimeout(this._persistTimer);
                this._persistTimer = setTimeout(() => {
                    const entries = Object.entries(this._cache).sort((a, b) => (b[1]._ts || 0) - (a[1]._ts || 0)).slice(0, 2000);
                    GM_setValue('da_branding_cache', JSON.stringify(Object.fromEntries(entries)));
                }, 5000);
            },
            _formatTitle(title, format) {
                if (!title) return title;
                title = title.replace(/^>\s*/, '');
                if (format === 'sentence') {
                    return title.charAt(0).toUpperCase() + title.slice(1).replace(/\b[A-Z]{2,}\b/g, m => m).toLowerCase().replace(/^./, c => c.toUpperCase());
                }
                if (format === 'title_case') {
                    const lower = new Set(['a','an','the','and','but','or','for','nor','on','at','to','by','in','of','up','as','is','it']);
                    return title.split(' ').map((w, i) => i === 0 || !lower.has(w.toLowerCase()) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(' ');
                }
                return title;
            },
            async _processPage() {
                const gen = this._generation;
                const replaceTitles = appState.settings.daReplaceTitles;
                const replaceThumbs = appState.settings.daReplaceThumbs;
                const format = appState.settings.daTitleFormat || 'sentence';
                const fallback = appState.settings.daFallbackFormat;
                const renderers = document.querySelectorAll('ytd-rich-item-renderer:not([data-da-processed]), ytd-video-renderer:not([data-da-processed]), ytd-compact-video-renderer:not([data-da-processed]), ytd-grid-video-renderer:not([data-da-processed])');
                for (const el of renderers) {
                    if (gen !== this._generation) return;
                    el.dataset.daProcessed = '1';
                    const link = el.querySelector('a#thumbnail[href*="/watch"], a#video-title-link[href*="/watch"], a[href*="/watch"]');
                    if (!link) continue;
                    const url = new URL(link.href, location.origin);
                    const videoId = url.searchParams.get('v');
                    if (!videoId) continue;
                    const branding = await this._fetchBranding(videoId);
                    if (!branding || gen !== this._generation) continue;
                    if (replaceTitles) {
                        const titleEl = el.querySelector('#video-title, #video-title-link');
                        if (titleEl) {
                            const submission = branding.titles?.[0];
                            if (submission?.title) {
                                const formatted = this._formatTitle(submission.title, format);
                                const clone = titleEl.cloneNode(false);
                                clone.className = 'daCustomTitle ' + titleEl.className;
                                clone.removeAttribute('id');
                                clone.textContent = formatted;
                                clone.title = formatted;
                                titleEl.style.display = 'none';
                                titleEl.dataset.daProcessed = '1';
                                titleEl.parentNode.insertBefore(clone, titleEl);
                            } else if (fallback) {
                                const original = titleEl.textContent.trim();
                                const formatted = this._formatTitle(original, format);
                                if (formatted !== original) {
                                    const clone = titleEl.cloneNode(false);
                                    clone.className = 'daCustomTitle da-formatted-title ' + titleEl.className;
                                    clone.removeAttribute('id');
                                    clone.textContent = formatted;
                                    clone.title = formatted;
                                    titleEl.style.display = 'none';
                                    titleEl.dataset.daProcessed = '1';
                                    titleEl.parentNode.insertBefore(clone, titleEl);
                                }
                            }
                        }
                    }
                    if (replaceThumbs) {
                        const thumb = branding.thumbnails?.[0];
                        if (thumb?.timestamp !== undefined) {
                            const img = el.querySelector('img.yt-core-image, ytd-thumbnail img, #thumbnail img');
                            if (img && !img.classList.contains('da-replaced-thumb')) {
                                img.dataset.daOrigSrc = img.src;
                                img.src = `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoId}&time=${thumb.timestamp}`;
                                img.classList.add('da-replaced-thumb');
                                img.onerror = () => { if (img.dataset.daOrigSrc) img.src = img.dataset.daOrigSrc; };
                            }
                        }
                    }
                }
            },
            destroy() {
                this._generation++;
                clearTimeout(this._processTimer);
                clearTimeout(this._persistTimer);
                if (this._navHandler) window.removeEventListener('yt-navigate-finish', this._navHandler);
                this._observer?.disconnect();
                this._styleEl?.remove();
                document.querySelectorAll('.daCustomTitle').forEach(c => c.remove());
                document.querySelectorAll('[data-da-processed]').forEach(el => { delete el.dataset.daProcessed; el.style.display = ''; });
                document.querySelectorAll('.da-replaced-thumb').forEach(el => {
                    if (el.dataset.daOrigSrc) { el.src = el.dataset.daOrigSrc; delete el.dataset.daOrigSrc; }
                    el.classList.remove('da-replaced-thumb');
                });
            }
        },
        // DeArrow sub-features
        { id: 'daReplaceTitles', name: 'Replace Titles', description: 'Replace clickbait titles with crowdsourced alternatives', group: 'Content', icon: 'type', isSubFeature: true, parentId: 'deArrow', init(){}, destroy(){} },
        { id: 'daReplaceThumbs', name: 'Replace Thumbnails', description: 'Replace clickbait thumbnails with video screenshots', group: 'Content', icon: 'image', isSubFeature: true, parentId: 'deArrow', init(){}, destroy(){} },
        { id: 'daTitleFormat', name: 'Title Format', description: 'How to format replacement titles', group: 'Content', icon: 'type', isSubFeature: true, parentId: 'deArrow', type: 'select', options: [{value:'sentence',label:'Sentence case'},{value:'title_case',label:'Title Case'},{value:'original',label:'Original'}], init(){}, destroy(){} },
        { id: 'daFallbackFormat', name: 'Format Original Titles', description: 'Format the original title when no crowdsourced submission exists', group: 'Content', icon: 'type', isSubFeature: true, parentId: 'deArrow', init(){}, destroy(){} },
        { id: 'daShowOriginalHover', name: 'Show Original on Hover', description: 'Hover over a replaced title to see the original', group: 'Content', icon: 'eye', isSubFeature: true, parentId: 'deArrow', init(){}, destroy(){} },
        { id: 'daCacheTTL', name: 'Cache Duration', description: 'Hours to cache branding data locally before refreshing', group: 'Content', icon: 'clock', isSubFeature: true, parentId: 'deArrow', type: 'select', options: [{value:'0',label:'No cache'},{value:'1',label:'1 hour'},{value:'4',label:'4 hours'},{value:'12',label:'12 hours'},{value:'24',label:'24 hours'},{value:'72',label:'3 days'}], init(){}, destroy(){} },

        // ── Statistics Dashboard ──
        {
            id: 'showStatisticsDashboard',
            name: 'Statistics Dashboard',
            description: 'Track videos watched, time on YouTube, and videos hidden',
            group: 'Advanced',
            icon: 'bar-chart-2',
            _timeInterval: null,
            _lastVideoId: null,
            init() {
                const self = this;
                const statsKey = 'ytkit_stats';
                const getStats = () => {
                    try { return JSON.parse(GM_getValue(statsKey, '{}')) || {}; } catch(e) { return {}; }
                };
                const saveStats = (s) => GM_setValue(statsKey, JSON.stringify(s));
                const increment = (key, amount = 1) => {
                    const s = getStats();
                    s[key] = (s[key] || 0) + amount;
                    saveStats(s);
                };
                addNavigateRule(this.id, () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const vid = getVideoId();
                    if (vid && vid !== self._lastVideoId) {
                        self._lastVideoId = vid;
                        increment('videosWatched');
                    }
                });
                this._timeInterval = setInterval(() => increment('totalTimeOnYouTube', 60), 60000);
            },
            destroy() {
                removeNavigateRule(this.id);
                if (this._timeInterval) clearInterval(this._timeInterval);
                this._timeInterval = null;
            }
        },

        // ── Settings Profiles ──
        {
            id: 'settingsProfiles',
            name: 'Settings Profiles',
            description: 'Save and load different configurations (used via settings panel)',
            group: 'Advanced',
            icon: 'list-tree',
            init() {}, destroy() {}
        },

        // ── Debug Mode ──
        {
            id: 'debugMode',
            name: 'Debug Mode',
            description: 'Enable verbose diagnostic logging to the console',
            group: 'Advanced',
            icon: 'bug',
            init() {
                window.__ytkit_debug = true;
                console.log('%c[YTKit Debug] Debug mode enabled', 'color: #f59e0b; font-weight: bold;');
            },
            destroy() {
                window.__ytkit_debug = false;
                console.log('%c[YTKit Debug] Debug mode disabled', 'color: #6b7280;');
            }
        },

        // ── Wave 9: Restored Archive Features (Final) ──

        cssFeature('squareSearchBar', 'Square Search Bar', 'Remove rounded corners from the search bar', 'Home / Subscriptions', 'search',
            'ytd-searchbox #container.ytd-searchbox, ytd-searchbox #container.ytd-searchbox input#search, #search-icon-legacy { border-radius: 0 !important; }'),

        cssFeature('squareAvatars', 'Square Avatars', 'Make channel avatars square instead of round', 'Theme', 'user',
            'yt-img-shadow, #avatar-link, #author-thumbnail, ytd-channel-avatar-editor img, yt-img-shadow img, .yt-spec-avatar-shape--circle { border-radius: 0 !important; }'),

        // ── Fit Player to Window ──
        {
            id: 'fitPlayerToWindow',
            name: 'Fit Player to Window',
            description: 'Make the video player fill the entire browser window',
            group: 'Video Player',
            icon: 'fullscreen',
            _styleElement: null,
            _ruleId: 'fitPlayerToWindowRule',
            _applyStyles() {
                if (appState.settings.stickyVideo && window.location.pathname.startsWith('/watch')) return;
                const isWatchPage = window.location.pathname.startsWith('/watch');
                document.documentElement.classList.toggle('ytkit-fit-to-window', isWatchPage);
                document.body.classList.toggle('ytkit-fit-to-window', isWatchPage);
                if (isWatchPage) {
                    setTimeout(() => {
                        const watchFlexy = document.querySelector('ytd-watch-flexy:not([theater])');
                        if (watchFlexy) document.querySelector('button.ytp-size-button')?.click();
                    }, 500);
                }
            },
            init() {
                this._styleElement = document.createElement('style');
                this._styleElement.id = `ytkit-style-${this.id}`;
                this._styleElement.textContent = `
                    html.ytkit-fit-to-window, body.ytkit-fit-to-window { overflow-y: auto !important; height: auto !important; }
                    body.ytkit-fit-to-window #movie_player { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100vh !important; z-index: 9999 !important; background-color: #000 !important; }
                    body.ytkit-fit-to-window #movie_player .html5-video-container { width: 100% !important; height: 100% !important; }
                    body.ytkit-fit-to-window #movie_player video.html5-main-video { width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
                    html.ytkit-fit-to-window { padding-top: 100vh !important; }
                    html.ytkit-fit-to-window ytd-masthead { display: none !important; }
                    body.ytkit-fit-to-window #page-manager { margin-top: 0 !important; }
                `;
                document.head.appendChild(this._styleElement);
                addNavigateRule(this._ruleId, () => this._applyStyles());
            },
            destroy() {
                document.documentElement.classList.remove('ytkit-fit-to-window');
                document.body.classList.remove('ytkit-fit-to-window');
                this._styleElement?.remove(); this._styleElement = null;
                removeNavigateRule(this._ruleId);
                if (document.querySelector('ytd-watch-flexy[theater]')) {
                    document.querySelector('button.ytp-size-button')?.click();
                }
            }
        },

        // ── Disable SPA Navigation ──
        {
            id: 'disableSpaNavigation',
            name: 'Disable SPA Navigation',
            description: 'Force full page loads instead of YouTube\'s smooth transitions (fixes player sizing issues)',
            group: 'Advanced',
            icon: 'refresh-cw',
            _clickHandler: null,
            init() {
                this._clickHandler = (e) => {
                    if (e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
                    if (e.button && e.button !== 0) return;
                    const anchor = e.target.closest('a[href]');
                    if (!anchor) return;
                    const href = anchor.getAttribute('href');
                    if (!href || href.startsWith('blob:') || href.startsWith('data:') || href.startsWith('#') || href.startsWith('javascript:')) return;
                    const isInternal = href.startsWith('/') || href.includes('youtube.com/');
                    if (isInternal) {
                        const url = href.startsWith('http') ? href : window.location.origin + href;
                        if (url === window.location.href) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        window.location.href = url;
                    }
                };
                document.addEventListener('click', this._clickHandler, true);
            },
            destroy() {
                if (this._clickHandler) {
                    document.removeEventListener('click', this._clickHandler, true);
                    this._clickHandler = null;
                }
            }
        },

    ];

    function injectStyle(selector, featureId, isRawCss = false) {
        const id = `yt-suite-style-${featureId}`;
        document.getElementById(id)?.remove();
        const style = document.createElement('style');
        style.id = id;
        style.textContent = isRawCss ? selector : `${selector} { display: none !important; }`;
        document.head.appendChild(style);
        return style;
    }

    //  SECTION 3: HELPERS

    function applyBotFilter() {
        const path = window.location.pathname;
        if (!path.startsWith('/watch') && !path.startsWith('/live_chat')) return;
        const messages = document.querySelectorAll('yt-live-chat-text-message-renderer:not([data-ytkit-bot-checked])');
        messages.forEach(msg => {
            msg.dataset.ytkitBotChecked = '1';
            const authorName = msg.querySelector('#author-name')?.textContent.toLowerCase() || '';
            if (authorName.includes('bot')) {
                msg.style.display = 'none';
                msg.classList.add('yt-suite-hidden-bot');
            }
        });
    }

    let _lastKeywordHash = '';
    function applyKeywordFilter() {
        const path = window.location.pathname;
        if (!path.startsWith('/watch') && !path.startsWith('/live_chat')) return;
        const keywordsRaw = appState.settings.chatKeywordFilter;
        const currentHash = keywordsRaw || '';

        // If keywords changed, recheck all messages
        if (currentHash !== _lastKeywordHash) {
            _lastKeywordHash = currentHash;
            document.querySelectorAll('yt-live-chat-text-message-renderer[data-ytkit-kw-checked]').forEach(el => {
                delete el.dataset.ytkitKwChecked;
            });
        }

        const messages = document.querySelectorAll('yt-live-chat-text-message-renderer:not([data-ytkit-kw-checked])');
        if (!keywordsRaw || !keywordsRaw.trim()) {
            messages.forEach(el => {
                el.dataset.ytkitKwChecked = '1';
                if (el.classList.contains('yt-suite-hidden-keyword')) {
                    el.style.display = '';
                    el.classList.remove('yt-suite-hidden-keyword');
                }
            });
            return;
        }
        const keywords = keywordsRaw.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        messages.forEach(msg => {
            msg.dataset.ytkitKwChecked = '1';
            const messageText = msg.querySelector('#message')?.textContent.toLowerCase() || '';
            const authorText = msg.querySelector('#author-name')?.textContent.toLowerCase() || '';
            const shouldHide = keywords.some(k => messageText.includes(k) || authorText.includes(k));
            if (shouldHide) {
                msg.style.display = 'none';
                msg.classList.add('yt-suite-hidden-keyword');
            }
        });
    }

    //  SECTION 4: PREMIUM UI (Trusted Types Safe)

    // SVG Icon Factory - Creates icons using DOM methods (Trusted Types safe)
    function createSVG(viewBox, paths, options = {}) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', viewBox);
        if (options.fill) svg.setAttribute('fill', options.fill);
        else svg.setAttribute('fill', 'none');
        if (options.stroke !== false) svg.setAttribute('stroke', options.stroke || 'currentColor');
        if (options.strokeWidth) svg.setAttribute('stroke-width', options.strokeWidth);
        if (options.strokeLinecap) svg.setAttribute('stroke-linecap', options.strokeLinecap);
        if (options.strokeLinejoin) svg.setAttribute('stroke-linejoin', options.strokeLinejoin);

        paths.forEach(p => {
            if (p.type === 'path') {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', p.d);
                if (p.fill) path.setAttribute('fill', p.fill);
                svg.appendChild(path);
            } else if (p.type === 'circle') {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', p.cx);
                circle.setAttribute('cy', p.cy);
                circle.setAttribute('r', p.r);
                if (p.fill) circle.setAttribute('fill', p.fill);
                svg.appendChild(circle);
            } else if (p.type === 'rect') {
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', p.x);
                rect.setAttribute('y', p.y);
                rect.setAttribute('width', p.width);
                rect.setAttribute('height', p.height);
                if (p.rx) rect.setAttribute('rx', p.rx);
                svg.appendChild(rect);
            } else if (p.type === 'line') {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', p.x1);
                line.setAttribute('y1', p.y1);
                line.setAttribute('x2', p.x2);
                line.setAttribute('y2', p.y2);
                svg.appendChild(line);
            } else if (p.type === 'polyline') {
                const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', p.points);
                svg.appendChild(polyline);
            } else if (p.type === 'polygon') {
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                polygon.setAttribute('points', p.points);
                svg.appendChild(polygon);
            }
        });
        return svg;
    }

    const _S = { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' };
    const ICONS = {
        settings: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 3 },
            { type: 'path', d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }
        ], _S),

        close: () => createSVG('0 0 24 24', [
            { type: 'line', x1: 18, y1: 6, x2: 6, y2: 18 },
            { type: 'line', x1: 6, y1: 6, x2: 18, y2: 18 }
        ], { strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        github: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z' }
        ], { fill: 'currentColor', stroke: false }),

        upload: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
            { type: 'polyline', points: '17 8 12 3 7 8' },
            { type: 'line', x1: 12, y1: 3, x2: 12, y2: 15 }
        ], { strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        download: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
            { type: 'polyline', points: '7 10 12 15 17 10' },
            { type: 'line', x1: 12, y1: 15, x2: 12, y2: 3 }
        ], { strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        check: () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '20 6 9 17 4 12' }
        ], { strokeWidth: '3', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        search: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 11, cy: 11, r: 8 },
            { type: 'line', x1: 21, y1: 21, x2: 16.65, y2: 16.65 }
        ], { strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        chevronRight: () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '9 18 15 12 9 6' }
        ], { strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        ytLogo: () => createSVG('0 0 28 20', [
            { type: 'path', d: 'M27.5 3.1s-.3-2.2-1.3-3.2C25.8-1 24.1-.1 23.6-.1 19.8 0 14 0 14 0S8.2 0 4.4-.1c-.5 0-1.6 0-2.6 1-1 .9-1.3 3.2-1.3 3.2S0 5.4 0 7.7v4.6c0 2.3.4 4.6.4 4.6s.3 2.2 1.3 3.2c1 .9 2.3 1 2.8 1.1 2.5.2 9.5.2 9.5.2s5.8 0 9.5-.2c.5-.1 1.8-0.2 2.8-1.1 1-.9 1.3-3.2 1.3-3.2s.4-2.3.4-4.6V7.7c0-2.3-.4-4.6-.4-4.6z', fill: '#FF0000' },
            { type: 'path', d: 'M11.2 14.6V5.4l8 4.6-8 4.6z', fill: 'white' }
        ], { stroke: false }),

        // Category icons
        interface: () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'path', d: 'M3 9h18' },
            { type: 'path', d: 'M9 21V9' }
        ], _S),

        appearance: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 5 },
            { type: 'path', d: 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' }
        ], _S),

        content: () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 2 },
            { type: 'line', x1: 7, y1: 2, x2: 7, y2: 22 },
            { type: 'line', x1: 17, y1: 2, x2: 17, y2: 22 },
            { type: 'line', x1: 2, y1: 12, x2: 22, y2: 12 }
        ], _S),

        player: () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'path', d: 'm10 8 5 3-5 3z' },
            { type: 'line', x1: 2, y1: 20, x2: 22, y2: 20 }
        ], _S),

        sponsor: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }
        ], _S),

        shield: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
            { type: 'path', d: 'M9 12l2 2 4-4' }
        ], _S),

        quality: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8' },
            { type: 'circle', cx: 12, cy: 12, r: 4 }
        ], _S),

        clutter: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' },
            { type: 'path', d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' },
            { type: 'line', x1: 10, y1: 11, x2: 10, y2: 17 },
            { type: 'line', x1: 14, y1: 11, x2: 14, y2: 17 }
        ], _S),

        livechat: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
            { type: 'circle', cx: 12, cy: 10, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 8, cy: 10, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 16, cy: 10, r: 1, fill: 'currentColor' }
        ], _S),

        actions: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'path', d: 'M12 8v4l3 3' }
        ], _S),

        controls: () => createSVG('0 0 24 24', [
            { type: 'line', x1: 4, y1: 21, x2: 4, y2: 14 },
            { type: 'line', x1: 4, y1: 10, x2: 4, y2: 3 },
            { type: 'line', x1: 12, y1: 21, x2: 12, y2: 12 },
            { type: 'line', x1: 12, y1: 8, x2: 12, y2: 3 },
            { type: 'line', x1: 20, y1: 21, x2: 20, y2: 16 },
            { type: 'line', x1: 20, y1: 12, x2: 20, y2: 3 },
            { type: 'circle', cx: 4, cy: 12, r: 2, fill: 'currentColor' },
            { type: 'circle', cx: 12, cy: 10, r: 2, fill: 'currentColor' },
            { type: 'circle', cx: 20, cy: 14, r: 2, fill: 'currentColor' }
        ], _S),

        downloads: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
            { type: 'polyline', points: '7 10 12 15 17 10' },
            { type: 'line', x1: 12, y1: 15, x2: 12, y2: 3 }
        ], _S),

        'list-plus': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 8, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 8, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 8, y1: 18, x2: 21, y2: 18 },
            { type: 'circle', cx: 3, cy: 6, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 3, cy: 12, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 3, cy: 18, r: 1, fill: 'currentColor' }
        ], _S),

        // Feature Icons
        'eye-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], _S),

        'square': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 }
        ], _S),

        'video-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8' },
            { type: 'path', d: 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], _S),

        'external-link': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
            { type: 'polyline', points: '15 3 21 3 21 9' },
            { type: 'line', x1: 10, y1: 14, x2: 21, y2: 3 }
        ], _S),

        'layout': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 3, y1: 9, x2: 21, y2: 9 },
            { type: 'line', x1: 9, y1: 21, x2: 9, y2: 9 }
        ], _S),

        'grid': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 7, height: 7 },
            { type: 'rect', x: 14, y: 3, width: 7, height: 7 },
            { type: 'rect', x: 14, y: 14, width: 7, height: 7 },
            { type: 'rect', x: 3, y: 14, width: 7, height: 7 }
        ], _S),

        'folder-video': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' },
            { type: 'polygon', points: '10 13 15 10.5 10 8 10 13' }
        ], _S),

        'fullscreen': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '15 3 21 3 21 9' },
            { type: 'polyline', points: '9 21 3 21 3 15' },
            { type: 'polyline', points: '21 15 21 21 15 21' },
            { type: 'polyline', points: '3 9 3 3 9 3' }
        ], _S),

        'arrows-horizontal': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '18 8 22 12 18 16' },
            { type: 'polyline', points: '6 8 2 12 6 16' },
            { type: 'line', x1: 2, y1: 12, x2: 22, y2: 12 }
        ], _S),

        'youtube': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z' },
            { type: 'polygon', points: '9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02' }
        ], _S),

        'tv': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 7, width: 20, height: 15, rx: 2 },
            { type: 'polyline', points: '17 2 12 7 7 2' }
        ], _S),

        'home': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
            { type: 'polyline', points: '9 22 9 12 15 12 15 22' }
        ], _S),

        'sidebar': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 9, y1: 3, x2: 9, y2: 21 }
        ], _S),

        'skip-forward': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 4 15 12 5 20 5 4' },
            { type: 'line', x1: 19, y1: 5, x2: 19, y2: 19 }
        ], _S),

        'play-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'polygon', points: '10 8 16 12 10 16 10 8' }
        ], _S),

        'monitor': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'line', x1: 8, y1: 21, x2: 16, y2: 21 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 21 }
        ], _S),

        'menu': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 3, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 3, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 3, y1: 18, x2: 21, y2: 18 }
        ], _S),

        'hash': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 4, y1: 9, x2: 20, y2: 9 },
            { type: 'line', x1: 4, y1: 15, x2: 20, y2: 15 },
            { type: 'line', x1: 10, y1: 3, x2: 8, y2: 21 },
            { type: 'line', x1: 16, y1: 3, x2: 14, y2: 21 }
        ], _S),

        'file-text': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 16, y1: 13, x2: 8, y2: 13 },
            { type: 'line', x1: 16, y1: 17, x2: 8, y2: 17 },
            { type: 'polyline', points: '10 9 9 9 8 9' }
        ], _S),

        'link': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' },
            { type: 'path', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }
        ], _S),

        'music': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M9 18V5l12-2v13' },
            { type: 'circle', cx: 6, cy: 18, r: 3 },
            { type: 'circle', cx: 18, cy: 16, r: 3 }
        ], _S),

        'hard-drive-download': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2v8' },
            { type: 'path', d: 'm16 6-4 4-4-4' },
            { type: 'rect', x: 2, y: 14, width: 20, height: 8, rx: 2 },
            { type: 'line', x1: 6, y1: 18, x2: 6.01, y2: 18 }
        ], _S),

        'users-x': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
            { type: 'circle', cx: 9, cy: 7, r: 4 },
            { type: 'line', x1: 18, y1: 8, x2: 23, y2: 13 },
            { type: 'line', x1: 23, y1: 8, x2: 18, y2: 13 }
        ], _S),

        'clock': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'polyline', points: '12 6 12 12 16 14' }
        ], _S),

        'download-cloud': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' },
            { type: 'path', d: 'M12 12v9' },
            { type: 'path', d: 'm8 17 4 4 4-4' }
        ], _S),

        'filter': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' }
        ], _S),

        'layout-grid': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 }
        ], _S),

        'message-square': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }
        ], _S),

        'play': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 3 19 12 5 21 5 3' }
        ], _S),

        'sparkles': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z' },
            { type: 'path', d: 'M5 3v4' },
            { type: 'path', d: 'M19 17v4' },
            { type: 'path', d: 'M3 5h4' },
            { type: 'path', d: 'M17 19h4' }
        ], _S),

        'square-x': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 9, y1: 9, x2: 15, y2: 15 },
            { type: 'line', x1: 15, y1: 9, x2: 9, y2: 15 }
        ], _S),

        'list': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 8, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 8, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 8, y1: 18, x2: 21, y2: 18 },
            { type: 'line', x1: 3, y1: 6, x2: 3.01, y2: 6 },
            { type: 'line', x1: 3, y1: 12, x2: 3.01, y2: 12 },
            { type: 'line', x1: 3, y1: 18, x2: 3.01, y2: 18 }
        ], _S),
        'picture-in-picture-2': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 1, y: 1, width: 22, height: 22, rx: 2 },
            { type: 'rect', x: 10, y: 10, width: 12, height: 8, rx: 1 }
        ], _S),
        'gauge': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 15l3.5-5' },
            { type: 'circle', cx: 12, cy: 15, r: 2 },
            { type: 'path', d: 'M2 12a10 10 0 0120 0' }
        ], _S),
        'palette': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10a2.5 2.5 0 002.5-2.5c0-.61-.23-1.21-.64-1.67A1.5 1.5 0 0115 16h1.5a10 10 0 00-4.5-18z' },
            { type: 'circle', cx: 7.5, cy: 11.5, r: 1.5 },
            { type: 'circle', cx: 12, cy: 7.5, r: 1.5 },
            { type: 'circle', cx: 16.5, cy: 11.5, r: 1.5 }
        ], _S),
        'cpu': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 2 },
            { type: 'rect', x: 9, y: 9, width: 6, height: 6 },
            { type: 'line', x1: 9, y1: 1, x2: 9, y2: 4 }, { type: 'line', x1: 15, y1: 1, x2: 15, y2: 4 },
            { type: 'line', x1: 9, y1: 20, x2: 9, y2: 23 }, { type: 'line', x1: 15, y1: 20, x2: 15, y2: 23 },
            { type: 'line', x1: 20, y1: 9, x2: 23, y2: 9 }, { type: 'line', x1: 20, y1: 14, x2: 23, y2: 14 },
            { type: 'line', x1: 1, y1: 9, x2: 4, y2: 9 }, { type: 'line', x1: 1, y1: 14, x2: 4, y2: 14 }
        ], _S),
        'type': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '4 7 4 4 20 4 20 7' },
            { type: 'line', x1: 9, y1: 20, x2: 15, y2: 20 },
            { type: 'line', x1: 12, y1: 4, x2: 12, y2: 20 }
        ], _S),
        'bar-chart': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 12, y1: 20, x2: 12, y2: 10 },
            { type: 'line', x1: 18, y1: 20, x2: 18, y2: 4 },
            { type: 'line', x1: 6, y1: 20, x2: 6, y2: 16 }
        ], _S)
    };

    const CATEGORY_CONFIG = {
        'Video Player': { icon: 'player', color: '#a78bfa' },
        'Playback': { icon: 'skip-forward', color: '#c084fc' },
        'Comments': { icon: 'message-square', color: '#22d3ee' },
        'Watch Page': { icon: 'monitor', color: '#6366f1' },
        'Content': { icon: 'eye-off', color: '#f472b6' },
        'Home / Subscriptions': { icon: 'interface', color: '#60a5fa' },
        'Theme': { icon: 'appearance', color: '#fb923c' },
        'Live Chat': { icon: 'livechat', color: '#4ade80' },
        'Downloads': { icon: 'downloads', color: '#f97316' },
        'Advanced': { icon: 'settings', color: '#94a3b8' },
    };

    function injectSettingsButton() {
        const handleDisplay = () => {
            const isWatchPage = window.location.pathname.startsWith('/watch');

            const createButton = (id) => {
                const btn = document.createElement('button');
                btn.id = id;
                btn.className = 'ytkit-trigger-btn';
                btn.title = 'YTKit Settings (Ctrl+Alt+Y)';
                btn.appendChild(ICONS.settings());
                btn.onclick = () => document.body.classList.toggle('ytkit-panel-open');
                return btn;
            };

            if (isWatchPage) {
                // Remove masthead button if we're on watch page
                document.getElementById('ytkit-masthead-btn')?.remove();

                // Only add watch button if it doesn't exist
                if (document.getElementById('ytkit-watch-btn')) return;

                waitForElement('#top-row #owner', (ownerDiv) => {
                    if (document.getElementById('ytkit-watch-btn')) return;
                    const btn = createButton('ytkit-watch-btn');
                    ownerDiv.prepend(btn);
                });
            } else {
                // Remove watch button if we're not on watch page
                document.getElementById('ytkit-watch-btn')?.remove();

                // Only add masthead button if it doesn't exist
                if (document.getElementById('ytkit-masthead-btn')) return;

                waitForElement('ytd-masthead #end', (mastheadEnd) => {
                    if (document.getElementById('ytkit-masthead-btn')) return;
                    mastheadEnd.prepend(createButton('ytkit-masthead-btn'));
                });
            }
        };
        addNavigateRule("settingsButtonRule", handleDisplay);
    }

    function buildSettingsPanel() {
        if (document.getElementById('ytkit-settings-panel')) return;

        // Centralized cleanup when panel closes
        _panelCleanups.length = 0;
        let _wasPanelOpen = false;
        new MutationObserver(() => {
            const isOpen = document.body.classList.contains('ytkit-panel-open');
            if (_wasPanelOpen && !isOpen) {
                _panelCleanups.forEach(fn => { try { fn(); } catch(e) {} });
                _panelCleanups.length = 0;
            }
            _wasPanelOpen = isOpen;
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

        const categoryOrder = ['Video Player', 'Playback', 'Comments', 'Watch Page', 'Content', 'Home / Subscriptions', 'Theme', 'Live Chat', 'Downloads', 'Advanced'];

        // Group labels: maps first category of each group → label text
        const categoryGroupLabels = {};
        const featuresByCategory = categoryOrder.reduce((acc, cat) => ({...acc, [cat]: []}), {});
        features.forEach(f => { if (f.group && featuresByCategory[f.group]) featuresByCategory[f.group].push(f); });

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'ytkit-overlay';
        overlay.onclick = () => document.body.classList.remove('ytkit-panel-open');

        // Create panel
        const panel = document.createElement('div');
        panel.id = 'ytkit-settings-panel';
        panel.setAttribute('role', 'dialog');

        // Header
        const header = document.createElement('header');
        header.className = 'ytkit-header';

        const brand = document.createElement('div');
        brand.className = 'ytkit-brand';

        const title = document.createElement('h1');
        title.className = 'ytkit-title';
        const titleYT = document.createElement('span');
        titleYT.className = 'ytkit-title-yt';
        titleYT.textContent = 'YT';
        const titleKit = document.createElement('span');
        titleKit.className = 'ytkit-title-kit';
        titleKit.textContent = 'Kit';
        title.appendChild(titleYT);
        title.appendChild(titleKit);

        const badge = document.createElement('span');
        badge.className = 'ytkit-badge';
        badge.textContent = 'PRO';

        brand.appendChild(title);
        brand.appendChild(badge);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ytkit-close';
        closeBtn.title = 'Close (Esc)';
        closeBtn.appendChild(ICONS.close());
        closeBtn.onclick = () => document.body.classList.remove('ytkit-panel-open');

        header.appendChild(brand);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.className = 'ytkit-body';

        // Sidebar
        const sidebar = document.createElement('nav');
        sidebar.className = 'ytkit-sidebar';

        // Search box
        const searchContainer = document.createElement('div');
        searchContainer.className = 'ytkit-search-container';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'ytkit-search-input';
        searchInput.placeholder = 'Search settings...';
        searchInput.id = 'ytkit-search';
        const searchIcon = ICONS.search();
        searchIcon.setAttribute('class', 'ytkit-search-icon');
        searchContainer.appendChild(searchIcon);
        searchContainer.appendChild(searchInput);
        sidebar.appendChild(searchContainer);

        // Divider
        const divider = document.createElement('div');
        divider.className = 'ytkit-sidebar-divider';
        sidebar.appendChild(divider);

        // Helper: create a sidebar nav button
        function makeNavBtn(cat, config, iconNode, countText, countTitle, extraClass) {
            const catId = cat.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '');
            const btn = document.createElement('button');
            btn.className = 'ytkit-nav-btn' + (extraClass || '');
            btn.dataset.tab = catId;
            const iconWrap = document.createElement('span');
            iconWrap.className = 'ytkit-nav-icon';
            iconWrap.style.setProperty('--cat-color', config.color);
            iconWrap.appendChild(iconNode);
            const labelSpan = document.createElement('span');
            labelSpan.className = 'ytkit-nav-label';
            labelSpan.textContent = cat;
            const countSpan = document.createElement('span');
            countSpan.className = 'ytkit-nav-count';
            countSpan.textContent = countText;
            if (countTitle) countSpan.title = countTitle;
            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'ytkit-nav-arrow';
            arrowSpan.appendChild(ICONS.chevronRight());
            btn.appendChild(iconWrap);
            btn.appendChild(labelSpan);
            btn.appendChild(countSpan);
            btn.appendChild(arrowSpan);
            return { btn, countSpan, catId };
        }

        // Helper: add drag-reorder support to a nav button
        function addDragReorder(btn, catId) {
            btn.draggable = true;
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', catId);
                btn.classList.add('ytkit-dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            btn.addEventListener('dragend', () => btn.classList.remove('ytkit-dragging'));
            btn.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = btn.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                btn.classList.toggle('ytkit-drag-above', e.clientY < midY);
                btn.classList.toggle('ytkit-drag-below', e.clientY >= midY);
            });
            btn.addEventListener('dragleave', () => {
                btn.classList.remove('ytkit-drag-above', 'ytkit-drag-below');
            });
            btn.addEventListener('drop', (e) => {
                e.preventDefault();
                btn.classList.remove('ytkit-drag-above', 'ytkit-drag-below');
                const draggedCatId = e.dataTransfer.getData('text/plain');
                const draggedBtn = sidebar.querySelector('.ytkit-nav-btn[data-tab="' + draggedCatId + '"]');
                if (!draggedBtn || draggedBtn === btn) return;
                const rect = btn.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) btn.before(draggedBtn);
                else btn.after(draggedBtn);
                const newOrder = Array.from(sidebar.querySelectorAll('.ytkit-nav-btn')).map(b => b.dataset.tab);
                GM_setValue('ytkit_sidebar_order', JSON.stringify(newOrder));
            });
        }

        categoryOrder.forEach((cat, index) => {
            // Insert group label before first category of each group
            if (categoryGroupLabels[cat]) {
                const groupLabel = document.createElement('div');
                groupLabel.className = 'ytkit-nav-group-label';
                groupLabel.textContent = categoryGroupLabels[cat];
                if (index > 0) groupLabel.style.marginTop = '6px';
                sidebar.appendChild(groupLabel);
            }



            const categoryFeatures = featuresByCategory[cat];
            if (!categoryFeatures || categoryFeatures.length === 0) return;

            const config = CATEGORY_CONFIG[cat] || { icon: 'settings', color: '#60a5fa' };
            const enabledCount = categoryFeatures.filter(f => !f.isSubFeature && appState.settings[f.id]).length;
            const totalCount = categoryFeatures.filter(f => !f.isSubFeature).length;
            const { btn, catId } = makeNavBtn(cat, config, (ICONS[config.icon] || ICONS.settings)(), `${enabledCount}/${totalCount}`, '', index === 0 ? ' active' : '');
            addDragReorder(btn, catId);
            sidebar.appendChild(btn);
        });

        // Apply saved sidebar order
        try {
            const savedOrder = JSON.parse(GM_getValue('ytkit_sidebar_order', 'null'));
            if (savedOrder && Array.isArray(savedOrder)) {
                const navBtns = Array.from(sidebar.querySelectorAll('.ytkit-nav-btn'));
                const groupLabels = Array.from(sidebar.querySelectorAll('.ytkit-nav-group-label'));
                // Remove group labels (order is now user-controlled)
                groupLabels.forEach(gl => gl.remove());
                // Reorder buttons
                const btnMap = {};
                navBtns.forEach(b => { btnMap[b.dataset.tab] = b; });
                savedOrder.forEach(catId => {
                    if (btnMap[catId]) sidebar.appendChild(btnMap[catId]);
                });
                // Append any new categories not in saved order
                navBtns.forEach(b => {
                    if (!savedOrder.includes(b.dataset.tab)) sidebar.appendChild(b);
                });
            }
        } catch(e) {
            DebugManager.log('Settings', `Failed to restore sidebar order: ${e.message}`);
        }

        // Content
        const content = document.createElement('div');
        content.className = 'ytkit-content';

        //  Video Hider Custom Pane
        function buildVideoHiderPane(config) {
            const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');

            const pane = document.createElement('section');
            pane.id = 'ytkit-pane-Video-Hider';
            pane.className = 'ytkit-pane ytkit-vh-pane';

            // Pane header
            const paneHeader = document.createElement('div');
            paneHeader.className = 'ytkit-pane-header';
            const paneTitle = document.createElement('div');
            paneTitle.className = 'ytkit-pane-title';
            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = 'Video Hider';
            paneTitle.appendChild(paneTitleH2);

            // Enable toggle
            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'ytkit-toggle-all';
            toggleLabel.style.marginLeft = 'auto';
            const toggleText = document.createElement('span');
            toggleText.textContent = 'Enabled';
            const toggleSwitch = document.createElement('div');
            toggleSwitch.className = 'ytkit-switch' + (appState.settings.hideVideosFromHome ? ' active' : '');
            const toggleInput = document.createElement('input');
            toggleInput.type = 'checkbox';
            toggleInput.id = 'ytkit-toggle-hideVideosFromHome';
            toggleInput.checked = appState.settings.hideVideosFromHome;
            toggleInput.onchange = async () => {
                appState.settings.hideVideosFromHome = toggleInput.checked;
                toggleSwitch.classList.toggle('active', toggleInput.checked);
                settingsManager.save(appState.settings);
                if (toggleInput.checked) videoHiderFeature?.init?.();
                else videoHiderFeature?.destroy?.();
                updateAllToggleStates();
            };
            const toggleTrack = document.createElement('span');
            toggleTrack.className = 'ytkit-switch-track';
            const toggleThumb = document.createElement('span');
            toggleThumb.className = 'ytkit-switch-thumb';
            toggleTrack.appendChild(toggleThumb);
            toggleSwitch.appendChild(toggleInput);
            toggleSwitch.appendChild(toggleTrack);
            toggleLabel.appendChild(toggleText);
            toggleLabel.appendChild(toggleSwitch);
            paneHeader.appendChild(paneTitle);
            paneHeader.appendChild(toggleLabel);
            pane.appendChild(paneHeader);

            // Tab navigation
            const tabNav = document.createElement('div');
            tabNav.className = 'ytkit-vh-tabs';
            tabNav.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--ytkit-border);margin-bottom:12px;';
            const tabs = ['Videos', 'Channels', 'Keywords', 'Settings'];
            tabs.forEach((tabName, i) => {
                const tab = document.createElement('button');
                tab.className = 'ytkit-vh-tab' + (i === 0 ? ' active' : '');
                tab.dataset.tab = tabName.toLowerCase();
                tab.textContent = tabName;
                tab.style.cssText = 'flex:1;padding:8px 12px;background:transparent;border:none;color:var(--ytkit-text-muted);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;border-bottom:2px solid transparent;';
                tab.onmouseenter = () => { if (!tab.classList.contains('active')) tab.style.color = 'var(--ytkit-text-secondary)'; };
                tab.onmouseleave = () => { if (!tab.classList.contains('active')) tab.style.color = 'var(--ytkit-text-muted)'; };
                tab.onclick = () => {
                    tabNav.querySelectorAll('.ytkit-vh-tab').forEach(t => {
                        t.classList.remove('active');
                        t.style.color = 'var(--ytkit-text-muted)';
                        t.style.borderBottomColor = 'transparent';
                    });
                    tab.classList.add('active');
                    tab.style.color = config.color;
                    tab.style.borderBottomColor = config.color;
                    renderTabContent(tabName.toLowerCase());
                };
                if (i === 0) { tab.style.color = config.color; tab.style.borderBottomColor = config.color; }
                tabNav.appendChild(tab);
            });
            pane.appendChild(tabNav);

            const tabContent = document.createElement('div');
            tabContent.id = 'ytkit-vh-content';
            pane.appendChild(tabContent);

            function renderTabContent(tab) {
                while (tabContent.firstChild) tabContent.removeChild(tabContent.firstChild);

                if (tab === 'videos') {
                    const videos = videoHiderFeature?._getHiddenVideos() || [];
                    if (videos.length === 0) {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'text-align:center;padding:40px 16px;color:var(--ytkit-text-muted);';
                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:14px;margin-bottom:6px;';
                        emptyTitle.textContent = 'No hidden videos yet';
                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:12px;opacity:0.7;';
                        emptyDesc.textContent = 'Click the X button on video thumbnails to hide them';
                        empty.appendChild(emptyTitle);
                        empty.appendChild(emptyDesc);
                        tabContent.appendChild(empty);
                    } else {
                        const grid = document.createElement('div');
                        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;';
                        videos.forEach(vid => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;background:var(--ytkit-bg-surface);border-radius:6px;border:1px solid var(--ytkit-border);';
                            const thumb = document.createElement('img');
                            thumb.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
                            thumb.style.cssText = 'width:88px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;';
                            thumb.onerror = () => { thumb.style.background = 'var(--ytkit-bg-elevated)'; };
                            const info = document.createElement('div');
                            info.style.cssText = 'flex:1;min-width:0;';
                            const vidId = document.createElement('div');
                            vidId.style.cssText = 'font-size:11px;color:var(--ytkit-text-secondary);font-family:monospace;margin-bottom:2px;';
                            vidId.textContent = vid;
                            const link = document.createElement('a');
                            link.href = `https://youtube.com/watch?v=${vid}`;
                            link.target = '_blank';
                            link.style.cssText = 'font-size:11px;color:var(--ytkit-accent);text-decoration:none;';
                            link.textContent = 'View on YouTube';
                            info.appendChild(vidId);
                            info.appendChild(link);
                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unhide';
                            removeBtn.style.cssText = 'padding:4px 10px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);color:var(--ytkit-text-secondary);border-radius:5px;cursor:pointer;font-size:11px;transition:all 0.2s;';
                            removeBtn.onmouseenter = () => { removeBtn.style.background = '#dc2626'; removeBtn.style.color = '#fff'; removeBtn.style.borderColor = '#dc2626'; };
                            removeBtn.onmouseleave = () => { removeBtn.style.background = 'var(--ytkit-bg-elevated)'; removeBtn.style.color = 'var(--ytkit-text-secondary)'; removeBtn.style.borderColor = 'var(--ytkit-border)'; };
                            removeBtn.onclick = () => {
                                const h = videoHiderFeature._getHiddenVideos();
                                const idx = h.indexOf(vid);
                                if (idx > -1) { h.splice(idx, 1); videoHiderFeature._setHiddenVideos(h); }
                                item.remove();
                                videoHiderFeature._processAllVideos();
                                if (videoHiderFeature._getHiddenVideos().length === 0) renderTabContent('videos');
                            };
                            item.appendChild(thumb);
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            grid.appendChild(item);
                        });
                        tabContent.appendChild(grid);
                        const clearBtn = document.createElement('button');
                        clearBtn.textContent = `Clear All Hidden Videos (${videos.length})`;
                        clearBtn.style.cssText = 'margin-top:12px;padding:8px 20px;width:100%;background:#dc2626;border:none;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:background 0.2s;';
                        clearBtn.onmouseenter = () => { clearBtn.style.background = '#b91c1c'; };
                        clearBtn.onmouseleave = () => { clearBtn.style.background = '#dc2626'; };
                        clearBtn.onclick = () => {
                            const backup = [...videoHiderFeature._getHiddenVideos()];
                            videoHiderFeature._setHiddenVideos([]);
                            videoHiderFeature._processAllVideos();
                            renderTabContent('videos');
                            showToast(`Cleared ${backup.length} hidden videos`, '#dc2626', { duration: 5, action: { text: 'Undo', onClick: () => {
                                videoHiderFeature._setHiddenVideos(backup);
                                videoHiderFeature._processAllVideos();
                                renderTabContent('videos');
                                showToast('Videos restored', '#22c55e');
                            }}});
                        };
                        tabContent.appendChild(clearBtn);
                    }
                } else if (tab === 'channels') {
                    const channels = videoHiderFeature?._getBlockedChannels() || [];
                    if (channels.length === 0) {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'text-align:center;padding:40px 16px;color:var(--ytkit-text-muted);';
                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:14px;margin-bottom:6px;';
                        emptyTitle.textContent = 'No blocked channels yet';
                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:12px;opacity:0.7;';
                        emptyDesc.textContent = 'Right-click the X button on thumbnails to block channels';
                        empty.appendChild(emptyTitle);
                        empty.appendChild(emptyDesc);
                        tabContent.appendChild(empty);
                    } else {
                        const list = document.createElement('div');
                        list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
                        channels.forEach(ch => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;background:var(--ytkit-bg-surface);border-radius:6px;border:1px solid var(--ytkit-border);';
                            const icon = document.createElement('div');
                            icon.style.cssText = 'width:32px;height:32px;border-radius:50%;background:var(--ytkit-bg-elevated);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--ytkit-text-muted);';
                            icon.textContent = (ch.name || ch.id || '?')[0].toUpperCase();
                            const info = document.createElement('div');
                            info.style.cssText = 'flex:1;';
                            const name = document.createElement('div');
                            name.style.cssText = 'font-size:13px;color:var(--ytkit-text-primary);font-weight:500;';
                            name.textContent = ch.name || ch.id;
                            const handle = document.createElement('div');
                            handle.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);';
                            handle.textContent = ch.id;
                            info.appendChild(name);
                            info.appendChild(handle);
                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unblock';
                            removeBtn.style.cssText = 'padding:4px 10px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);color:var(--ytkit-text-secondary);border-radius:5px;cursor:pointer;font-size:11px;transition:all 0.2s;';
                            removeBtn.onmouseenter = () => { removeBtn.style.background = '#22c55e'; removeBtn.style.color = '#fff'; removeBtn.style.borderColor = '#22c55e'; };
                            removeBtn.onmouseleave = () => { removeBtn.style.background = 'var(--ytkit-bg-elevated)'; removeBtn.style.color = 'var(--ytkit-text-secondary)'; removeBtn.style.borderColor = 'var(--ytkit-border)'; };
                            removeBtn.onclick = () => {
                                const c = videoHiderFeature._getBlockedChannels();
                                const idx = c.findIndex(x => x.id === ch.id);
                                if (idx > -1) { c.splice(idx, 1); videoHiderFeature._setBlockedChannels(c); }
                                item.remove();
                                videoHiderFeature._processAllVideos();
                                if (videoHiderFeature._getBlockedChannels().length === 0) renderTabContent('channels');
                            };
                            item.appendChild(icon);
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            list.appendChild(item);
                        });
                        tabContent.appendChild(list);
                        const clearBtn = document.createElement('button');
                        clearBtn.textContent = `Unblock All Channels (${channels.length})`;
                        clearBtn.style.cssText = 'margin-top:12px;padding:8px 20px;width:100%;background:#dc2626;border:none;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:background 0.2s;';
                        clearBtn.onmouseenter = () => { clearBtn.style.background = '#b91c1c'; };
                        clearBtn.onmouseleave = () => { clearBtn.style.background = '#dc2626'; };
                        clearBtn.onclick = () => {
                            const backup = [...videoHiderFeature._getBlockedChannels()];
                            videoHiderFeature._setBlockedChannels([]);
                            videoHiderFeature._processAllVideos();
                            renderTabContent('channels');
                            showToast(`Unblocked ${backup.length} channels`, '#dc2626', { duration: 5, action: { text: 'Undo', onClick: () => {
                                videoHiderFeature._setBlockedChannels(backup);
                                videoHiderFeature._processAllVideos();
                                renderTabContent('channels');
                                showToast('Channels restored', '#22c55e');
                            }}});
                        };
                        tabContent.appendChild(clearBtn);
                    }
                } else if (tab === 'keywords') {
                    const container = document.createElement('div');
                    const desc = document.createElement('div');
                    desc.style.cssText = 'color:var(--ytkit-text-muted);font-size:12px;margin-bottom:12px;line-height:1.4;';
                    desc.textContent = 'Videos with titles containing these keywords will be automatically hidden. Separate multiple keywords with commas. Prefix with ! to whitelist. Start with / for regex.';
                    container.appendChild(desc);
                    const textarea = document.createElement('textarea');
                    textarea.style.cssText = 'width:100%;min-height:100px;padding:8px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:6px;color:var(--ytkit-text-primary);font-size:12px;resize:vertical;font-family:inherit;';
                    textarea.placeholder = 'e.g., reaction, unboxing, prank, shorts';
                    textarea.value = appState.settings.hideVideosKeywordFilter || '';
                    textarea.onchange = async () => {
                        appState.settings.hideVideosKeywordFilter = textarea.value;
                        settingsManager.save(appState.settings);
                        videoHiderFeature?._processAllVideos();
                    };
                    container.appendChild(textarea);
                    const hint = document.createElement('div');
                    hint.style.cssText = 'color:var(--ytkit-text-muted);font-size:10px;margin-top:6px;';
                    hint.textContent = 'Changes apply immediately. Keywords are case-insensitive.';
                    container.appendChild(hint);
                    tabContent.appendChild(container);
                } else if (tab === 'settings') {
                    const container = document.createElement('div');
                    container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

                    // Duration filter
                    const durSection = document.createElement('div');
                    durSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:8px;padding:14px;';
                    const durTitle = document.createElement('div');
                    durTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:6px;';
                    durTitle.textContent = 'Duration Filter';
                    durSection.appendChild(durTitle);
                    const durDesc = document.createElement('div');
                    durDesc.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);margin-bottom:8px;';
                    durDesc.textContent = 'Automatically hide videos shorter than the specified duration.';
                    durSection.appendChild(durDesc);
                    const durRow = document.createElement('div');
                    durRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
                    const durInput = document.createElement('input');
                    durInput.type = 'number'; durInput.min = '0'; durInput.max = '60';
                    durInput.value = appState.settings.hideVideosDurationFilter || 0;
                    durInput.style.cssText = 'width:70px;padding:6px 10px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:5px;color:var(--ytkit-text-primary);font-size:13px;';
                    durInput.onchange = async () => {
                        appState.settings.hideVideosDurationFilter = parseInt(durInput.value) || 0;
                        settingsManager.save(appState.settings);
                        videoHiderFeature?._processAllVideos();
                    };
                    const durLabel = document.createElement('span');
                    durLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:12px;';
                    durLabel.textContent = 'minutes (0 = disabled)';
                    durRow.appendChild(durInput); durRow.appendChild(durLabel);
                    durSection.appendChild(durRow);
                    container.appendChild(durSection);

                    // Subscription Load Limiter
                    const limiterSection = document.createElement('div');
                    limiterSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:8px;padding:14px;';
                    const limiterTitle = document.createElement('div');
                    limiterTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:6px;';
                    limiterTitle.textContent = 'Subscription Page Load Limiter';
                    limiterSection.appendChild(limiterTitle);
                    const limiterDesc = document.createElement('div');
                    limiterDesc.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);margin-bottom:10px;line-height:1.4;';
                    limiterDesc.textContent = "Prevents infinite scrolling when many consecutive videos are hidden.";
                    limiterSection.appendChild(limiterDesc);
                    const limiterToggleRow = document.createElement('div');
                    limiterToggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:8px;background:var(--ytkit-bg-elevated);border-radius:6px;';
                    const limiterToggleLabel = document.createElement('span');
                    limiterToggleLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:12px;';
                    limiterToggleLabel.textContent = 'Enable load limiter';
                    const limiterSwitch = document.createElement('div');
                    limiterSwitch.className = 'ytkit-switch' + (appState.settings.hideVideosSubsLoadLimit !== false ? ' active' : '');
                    limiterSwitch.style.cssText = 'cursor:pointer;';
                    const limiterInput = document.createElement('input');
                    limiterInput.type = 'checkbox';
                    limiterInput.checked = appState.settings.hideVideosSubsLoadLimit !== false;
                    limiterInput.onchange = async () => {
                        appState.settings.hideVideosSubsLoadLimit = limiterInput.checked;
                        limiterSwitch.classList.toggle('active', limiterInput.checked);
                        settingsManager.save(appState.settings);
                    };
                    const limiterTrack = document.createElement('span');
                    limiterTrack.className = 'ytkit-switch-track';
                    limiterSwitch.appendChild(limiterInput);
                    limiterSwitch.appendChild(limiterTrack);
                    limiterToggleRow.appendChild(limiterToggleLabel);
                    limiterToggleRow.appendChild(limiterSwitch);
                    limiterSection.appendChild(limiterToggleRow);
                    const thresholdRow = document.createElement('div');
                    thresholdRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
                    const thresholdLabel = document.createElement('span');
                    thresholdLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:12px;flex:1;';
                    thresholdLabel.textContent = 'Stop after consecutive hidden batches:';
                    const thresholdInput = document.createElement('input');
                    thresholdInput.type = 'number'; thresholdInput.min = '1'; thresholdInput.max = '20';
                    thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold || 3;
                    thresholdInput.style.cssText = 'width:60px;padding:6px 10px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:5px;color:var(--ytkit-text-primary);font-size:13px;text-align:center;';
                    thresholdInput.onchange = async () => {
                        appState.settings.hideVideosSubsLoadThreshold = Math.max(1, Math.min(20, parseInt(thresholdInput.value) || 3));
                        thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold;
                        settingsManager.save(appState.settings);
                    };
                    thresholdRow.appendChild(thresholdLabel);
                    thresholdRow.appendChild(thresholdInput);
                    limiterSection.appendChild(thresholdRow);
                    const thresholdHint = document.createElement('div');
                    thresholdHint.style.cssText = 'color:var(--ytkit-text-muted);font-size:10px;margin-top:6px;';
                    thresholdHint.textContent = 'Lower = stops faster, Higher = loads more before stopping (1-20)';
                    limiterSection.appendChild(thresholdHint);
                    container.appendChild(limiterSection);

                    // Stats
                    const statsSection = document.createElement('div');
                    statsSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:8px;padding:14px;';
                    const statsTitle = document.createElement('div');
                    statsTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:8px;';
                    statsTitle.textContent = 'Statistics';
                    statsSection.appendChild(statsTitle);
                    const statsGrid = document.createElement('div');
                    statsGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
                    const videoCount = videoHiderFeature?._getHiddenVideos()?.length || 0;
                    const channelCount = videoHiderFeature?._getBlockedChannels()?.length || 0;
                    [{ label: 'Hidden Videos', value: videoCount }, { label: 'Blocked Channels', value: channelCount }].forEach(stat => {
                        const statEl = document.createElement('div');
                        statEl.style.cssText = 'padding:10px;background:var(--ytkit-bg-elevated);border-radius:6px;text-align:center;';
                        const val = document.createElement('div');
                        val.style.cssText = 'font-size:20px;font-weight:700;color:var(--ytkit-text-primary);margin-bottom:2px;';
                        val.textContent = stat.value;
                        const lbl = document.createElement('div');
                        lbl.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);';
                        lbl.textContent = stat.label;
                        statEl.appendChild(val); statEl.appendChild(lbl);
                        statsGrid.appendChild(statEl);
                    });
                    statsSection.appendChild(statsGrid);
                    container.appendChild(statsSection);
                    tabContent.appendChild(container);
                }
            }

            renderTabContent('videos');
            return pane;
        }

        categoryOrder.forEach((cat, index) => {

            const categoryFeatures = featuresByCategory[cat];
            if (!categoryFeatures || categoryFeatures.length === 0) return;

            const config = CATEGORY_CONFIG[cat] || { icon: 'settings', color: '#60a5fa' };
            const catId = cat.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '');

            const pane = document.createElement('section');
            pane.id = `ytkit-pane-${catId}`;
            pane.className = 'ytkit-pane' + (index === 0 ? ' active' : '');

            // Pane header
            const paneHeader = document.createElement('div');
            paneHeader.className = 'ytkit-pane-header';

            const paneTitle = document.createElement('div');
            paneTitle.className = 'ytkit-pane-title';

            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = cat;

            paneTitle.appendChild(paneTitleH2);

            const toggleAllLabel = document.createElement('label');
            toggleAllLabel.className = 'ytkit-toggle-all';

            const toggleAllText = document.createElement('span');
            toggleAllText.textContent = 'Enable All';

            const toggleAllSwitch = document.createElement('div');
            toggleAllSwitch.className = 'ytkit-switch';

            const toggleAllInput = document.createElement('input');
            toggleAllInput.type = 'checkbox';
            toggleAllInput.className = 'ytkit-toggle-all-cb';
            toggleAllInput.dataset.category = catId;

            const toggleAllTrack = document.createElement('span');
            toggleAllTrack.className = 'ytkit-switch-track';

            const toggleAllThumb = document.createElement('span');
            toggleAllThumb.className = 'ytkit-switch-thumb';

            toggleAllTrack.appendChild(toggleAllThumb);
            toggleAllSwitch.appendChild(toggleAllInput);
            toggleAllSwitch.appendChild(toggleAllTrack);
            toggleAllLabel.appendChild(toggleAllText);
            toggleAllLabel.appendChild(toggleAllSwitch);

            paneHeader.appendChild(paneTitle);

            // Reset group button
            const resetBtn = document.createElement('button');
            resetBtn.className = 'ytkit-reset-group-btn';
            resetBtn.title = 'Reset this group to defaults';
            resetBtn.textContent = 'Reset';
            resetBtn.onclick = () => {
                const categoryFeatures = featuresByCategory[cat];
                const backup = {};
                categoryFeatures.forEach(f => { backup[f.id] = appState.settings[f.id]; });
                categoryFeatures.forEach(f => {
                    const defaultValue = settingsManager.defaults[f.id];
                    if (defaultValue !== undefined) {
                        appState.settings[f.id] = defaultValue;
                        try { f.destroy?.(); f._initialized = false; } catch(err) {
                            DebugManager.log('Reset', `Destroy failed for "${f.id}": ${err.message}`);
                        }
                        if (defaultValue) {
                            try { f.init?.(); f._initialized = true; } catch(err) {
                                DebugManager.log('Reset', `Init failed for "${f.id}": ${err.message}`);
                            }
                        }
                    }
                });
                settingsManager.save(appState.settings);
                updateAllToggleStates();
                // Update UI
                categoryFeatures.forEach(f => {
                    const toggle = document.getElementById(`ytkit-toggle-${f.id}`);
                    if (toggle) {
                        toggle.checked = appState.settings[f.id];
                        const switchEl = toggle.closest('.ytkit-switch');
                        if (switchEl) switchEl.classList.toggle('active', toggle.checked);
                    }
                });
                createToast(`Reset "${cat}" to defaults`, 'success');
                showToast(`"${cat}" reset to defaults`, '#f97316', { duration: 5, action: { text: 'Undo', onClick: async () => {
                    categoryFeatures.forEach(f => {
                        if (backup[f.id] !== undefined) {
                            appState.settings[f.id] = backup[f.id];
                            try { f.destroy?.(); f._initialized = false; } catch(err) {
                                DebugManager.log('Reset', `Undo destroy failed for "${f.id}": ${err.message}`);
                            }
                            if (backup[f.id]) {
                                try { f.init?.(); f._initialized = true; } catch(err) {
                                    DebugManager.log('Reset', `Undo init failed for "${f.id}": ${err.message}`);
                                }
                            }
                        }
                    });
                    settingsManager.save(appState.settings);
                    updateAllToggleStates();
                    categoryFeatures.forEach(f => {
                        const t = document.getElementById(`ytkit-toggle-${f.id}`);
                        if (t) { t.checked = appState.settings[f.id]; const s = t.closest('.ytkit-switch'); if (s) s.classList.toggle('active', t.checked); }
                    });
                    showToast(`"${cat}" restored`, '#22c55e');
                }}});
            };
            paneHeader.appendChild(resetBtn);
            paneHeader.appendChild(toggleAllLabel);
            pane.appendChild(paneHeader);

            // MediaDL status banner for Downloads pane
            if (cat === 'Downloads') {
                const banner = document.createElement('div');
                banner.id = 'ytkit-mediadl-banner';
                banner.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:10px;padding:14px 16px;margin-bottom:16px;';

                const bannerTop = document.createElement('div');
                bannerTop.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';

                const bannerLeft = document.createElement('div');
                bannerLeft.style.cssText = 'display:flex;align-items:center;gap:10px;flex:1;min-width:0;';
                const statusDot = document.createElement('span');
                statusDot.id = 'ytkit-mediadl-status-dot';
                statusDot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#6b7280;flex-shrink:0;transition:background 0.3s;';
                const bannerInfo = document.createElement('div');
                bannerInfo.style.cssText = 'min-width:0;';
                const bannerTitle = document.createElement('div');
                bannerTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--ytkit-text-primary);';
                bannerTitle.textContent = 'MediaDL Server';
                const bannerStatus = document.createElement('div');
                bannerStatus.id = 'ytkit-mediadl-status-text';
                bannerStatus.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);margin-top:2px;';
                bannerStatus.textContent = 'Checking...';
                bannerInfo.appendChild(bannerTitle);
                bannerInfo.appendChild(bannerStatus);
                bannerLeft.appendChild(statusDot);
                bannerLeft.appendChild(bannerInfo);

                const bannerActions = document.createElement('div');
                bannerActions.id = 'ytkit-mediadl-banner-actions';
                bannerActions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

                bannerTop.appendChild(bannerLeft);
                bannerTop.appendChild(bannerActions);
                banner.appendChild(bannerTop);

                // Feature comparison (shown when not installed)
                const comparison = document.createElement('div');
                comparison.id = 'ytkit-mediadl-comparison';
                comparison.style.cssText = 'display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--ytkit-border);';
                banner.appendChild(comparison);

                pane.appendChild(banner);

                // Check MediaDL status and update banner
                (async () => {
                    const result = await MediaDLManager.check();
                    const dot = document.getElementById('ytkit-mediadl-status-dot');
                    const text = document.getElementById('ytkit-mediadl-status-text');
                    const actions = document.getElementById('ytkit-mediadl-banner-actions');
                    const comp = document.getElementById('ytkit-mediadl-comparison');
                    if (!dot || !text || !actions) return;

                    if (result.ok) {
                        dot.style.background = '#22c55e';
                        text.textContent = `Running${result.version ? ' (v' + result.version + ')' : ''} \u2014 1080p+ downloads with muxing`;
                        // Add a "Check" refresh button
                        const refreshBtn = document.createElement('button');
                        refreshBtn.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid var(--ytkit-border);background:transparent;color:var(--ytkit-text-secondary);font-size:11px;cursor:pointer;';
                        refreshBtn.textContent = 'Refresh';
                        refreshBtn.onclick = async () => {
                            refreshBtn.textContent = '...';
                            const r = await MediaDLManager.check(true);
                            dot.style.background = r.ok ? '#22c55e' : '#ef4444';
                            text.textContent = r.ok ? `Running${r.version ? ' (v' + r.version + ')' : ''} \u2014 1080p+ downloads with muxing` : 'Not running';
                            refreshBtn.textContent = 'Refresh';
                        };
                        actions.appendChild(refreshBtn);
                    } else {
                        dot.style.background = '#f59e0b';
                        text.textContent = 'Not installed \u2014 downloads limited to 720p combined streams';

                        const btnStyle = 'padding:5px 12px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;transition:background 0.2s;';

                        // "Try Start" button — attempts auto-start via mediadl:// protocol
                        const startBtn = document.createElement('button');
                        startBtn.style.cssText = btnStyle + 'border:1px solid var(--ytkit-border);background:transparent;color:var(--ytkit-text-secondary);';
                        startBtn.textContent = 'Start';
                        startBtn.title = 'Try to start the MediaDL server';
                        startBtn.onclick = async () => {
                            startBtn.textContent = '...';
                            startBtn.style.pointerEvents = 'none';
                            MediaDLManager.resetAutoStart();
                            const r = await MediaDLManager.tryAutoStart(5);
                            if (r.ok) {
                                dot.style.background = '#22c55e';
                                text.textContent = `Running${r.version ? ' (v' + r.version + ')' : ''} \u2014 1080p+ downloads with muxing`;
                                startBtn.textContent = 'Running';
                                startBtn.style.background = '#22c55e'; startBtn.style.color = 'white'; startBtn.style.border = 'none';
                                if (comp) comp.style.display = 'none';
                            } else {
                                startBtn.textContent = 'Start';
                                startBtn.style.pointerEvents = 'auto';
                                showToast('Server did not start. Try installing below.', '#f59e0b', { duration: 4 });
                            }
                        };
                        actions.appendChild(startBtn);

                        // "Install" button — copies PowerShell command
                        const installBtn = document.createElement('button');
                        installBtn.style.cssText = btnStyle + 'border:none;background:#22c55e;color:white;';
                        installBtn.textContent = 'Install';
                        installBtn.title = 'Copy install command for PowerShell';
                        installBtn.onclick = async () => {
                            try {
                                await navigator.clipboard.writeText(MediaDLManager.INSTALLER_COMMAND);
                                installBtn.textContent = 'Copied!';
                                installBtn.style.background = '#16a34a';
                                showToast('Paste in PowerShell (Win+X \u2192 Terminal) to install.', '#22c55e', { duration: 8 });
                                setTimeout(() => { installBtn.textContent = 'Install'; installBtn.style.background = '#22c55e'; }, 3000);
                            } catch (_) {
                                window.open(MediaDLManager.INSTALLER_URL, '_blank');
                            }
                        };
                        actions.appendChild(installBtn);

                        // "Download .ps1" button — downloads installer script
                        const dlBtn = document.createElement('button');
                        dlBtn.style.cssText = btnStyle + 'border:1px solid var(--ytkit-border);background:transparent;color:var(--ytkit-text-secondary);';
                        dlBtn.textContent = 'Download .ps1';
                        dlBtn.title = 'Download the installer script to run manually';
                        dlBtn.onclick = () => {
                            triggerDownload(MediaDLManager.INSTALLER_URL, 'Install-YTYT.ps1').catch(() => {
                                window.open(MediaDLManager.INSTALLER_URL, '_blank');
                            });
                            showToast('Installer downloaded! Right-click \u2192 Run with PowerShell', '#3b82f6', { duration: 6 });
                        };
                        actions.appendChild(dlBtn);

                        // Show comparison table
                        if (comp) {
                            comp.style.display = 'block';
                            const table = document.createElement('div');
                            table.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;font-size:11px;';
                            const rows = [
                                ['', 'Without MediaDL', 'With MediaDL'],
                                ['Video Quality', 'Up to 720p', 'Up to 4K'],
                                ['Audio Downloads', 'WebM/M4A', 'MP3 (converted)'],
                                ['Audio+Video Merge', 'No', 'Yes (ffmpeg)'],
                                ['Progress Tracking', 'No', 'Yes'],
                                ['Background DL', 'No', 'Yes'],
                            ];
                            rows.forEach((row, ri) => {
                                row.forEach((cell, ci) => {
                                    const el = document.createElement('div');
                                    el.style.cssText = `padding:6px 8px;${ri === 0 ? 'font-weight:600;color:var(--ytkit-text-primary);' : 'color:var(--ytkit-text-secondary);'}${ci > 0 ? 'text-align:center;' : ''}${ri > 0 ? 'border-top:1px solid var(--ytkit-border);' : ''}`;
                                    if (ri > 0 && ci === 2) el.style.color = '#22c55e';
                                    el.textContent = cell;
                                    table.appendChild(el);
                                });
                            });
                            comp.appendChild(table);

                            const hint = document.createElement('div');
                            hint.style.cssText = 'margin-top:10px;font-size:11px;color:var(--ytkit-text-muted);line-height:1.5;';
                            hint.textContent = 'MediaDL installs yt-dlp + ffmpeg locally. Runs as a background service on port 9751. Windows only.';
                            comp.appendChild(hint);
                        }
                    }
                })();
            }

            // Features grid
            const grid = document.createElement('div');
            grid.className = 'ytkit-features-grid';

            const parentFeatures = categoryFeatures.filter(f => !f.isSubFeature);
            const subFeatures = categoryFeatures.filter(f => f.isSubFeature);

            // Sort features: dropdowns/selects first, then others
            const sortedParentFeatures = [...parentFeatures].sort((a, b) => {
                const aIsDropdown = a.type === 'select';
                const bIsDropdown = b.type === 'select';
                if (aIsDropdown && !bIsDropdown) return -1;
                if (!aIsDropdown && bIsDropdown) return 1;
                return 0;
            });

            sortedParentFeatures.forEach(f => {
                const card = buildFeatureCard(f, config.color);
                grid.appendChild(card);

                // Add sub-features if any
                const children = subFeatures.filter(sf => sf.parentId === f.id);
                if (children.length > 0) {
                    const subContainer = document.createElement('div');
                    subContainer.className = 'ytkit-sub-features';
                    subContainer.dataset.parentId = f.id;
                    if (!appState.settings[f.id]) { subContainer.style.opacity = '0.35'; subContainer.style.pointerEvents = 'none'; }
                    children.forEach(sf => {
                        subContainer.appendChild(buildFeatureCard(sf, config.color, true));
                    });
                    grid.appendChild(subContainer);
                }
            });

            pane.appendChild(grid);
            content.appendChild(pane);
        });

        body.appendChild(sidebar);
        body.appendChild(content);

        // Footer
        const footer = document.createElement('footer');
        footer.className = 'ytkit-footer';

        const footerLeft = document.createElement('div');
        footerLeft.className = 'ytkit-footer-left';

        const githubLink = document.createElement('a');
        githubLink.href = 'https://github.com/SysAdminDoc/YouTube-Kit';
        githubLink.target = '_blank';
        githubLink.className = 'ytkit-github';
        githubLink.title = 'View on GitHub';
        githubLink.appendChild(ICONS.github());

        // YTYT-Downloader Installer Button - Downloads a .bat launcher
        const ytToolsBtn = document.createElement('button');
        ytToolsBtn.className = 'ytkit-github';
        ytToolsBtn.title = 'Download & run this script to setup local YouTube downloads (VLC/MPV streaming, yt-dlp)';
        ytToolsBtn.style.cssText = 'background: linear-gradient(135deg, #f97316, #22c55e) !important; border: none; cursor: pointer;';
        const dlIcon = ICONS.download();
        dlIcon.style.color = 'white';
        ytToolsBtn.appendChild(dlIcon);

        ytToolsBtn.addEventListener('click', () => {
            // Generate a .bat file that runs the PowerShell installer
            const batContent = `@echo off
title YTYT-Downloader Installer
echo ========================================
echo   YTYT-Downloader Installer
echo   VLC/MPV Streaming ^& Local Downloads
echo ========================================
echo.
echo Downloading and running installer...
echo.
powershell -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/main/Install-YTYT.ps1' -OutFile '%TEMP%\\Install-YTYT.ps1'"
powershell -ExecutionPolicy Bypass -File "%TEMP%\\Install-YTYT.ps1"
echo.
echo If the window closes immediately, right-click and Run as Administrator.
pause
`;
            const blob = new Blob([batContent], { type: 'application/x-bat' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Install-YTYT.bat';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast('📦 Installer downloaded! Double-click the .bat file to run.', '#22c55e');
        });
        const ytToolsLink = ytToolsBtn; // Alias for existing appendChild call

        const versionSpan = document.createElement('span');
        versionSpan.className = 'ytkit-version';
        versionSpan.textContent = 'v' + YTKIT_VERSION;
        versionSpan.style.position = 'relative';
        versionSpan.style.cursor = 'pointer';
        // What's New badge
        const CURRENT_VER = YTKIT_VERSION;
        const lastSeenVer = GM_getValue('ytkit_last_seen_version', '');
        if (lastSeenVer !== CURRENT_VER) {
            const badge = document.createElement('span');
            badge.id = 'ytkit-whats-new-badge';
            badge.style.cssText = 'position:absolute;top:-3px;right:-8px;width:8px;height:8px;background:#ef4444;border-radius:50%;animation:ytkit-badge-pulse 2s infinite;';
            versionSpan.appendChild(badge);
            versionSpan.title = `New in v${YTKIT_VERSION}: Ultra-condensed settings panel — removed logo, pane icons, status badges, recently changed section; zero-padding layout`;
            versionSpan.onclick = () => {
                GM_setValue('ytkit_last_seen_version', CURRENT_VER);
                badge.remove();
                showToast(`v${YTKIT_VERSION}: Ultra-condensed settings — removed logo, pane icons, status badges, recently changed; zero-padding`, '#3b82f6', { duration: 6 });
            };
        }

        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'ytkit-shortcut';
        shortcutSpan.textContent = 'Ctrl+Alt+Y';

        footerLeft.appendChild(githubLink);
        footerLeft.appendChild(ytToolsLink);
        footerLeft.appendChild(versionSpan);
        footerLeft.appendChild(shortcutSpan);

        const footerRight = document.createElement('div');
        footerRight.className = 'ytkit-footer-right';

        const importBtn = document.createElement('button');
        importBtn.className = 'ytkit-btn ytkit-btn-secondary';
        importBtn.id = 'ytkit-import';
        importBtn.appendChild(ICONS.upload());
        const importText = document.createElement('span');
        importText.textContent = 'Import';
        importBtn.appendChild(importText);

        const exportBtn = document.createElement('button');
        exportBtn.className = 'ytkit-btn ytkit-btn-primary';
        exportBtn.id = 'ytkit-export';
        exportBtn.appendChild(ICONS.download());
        const exportText = document.createElement('span');
        exportText.textContent = 'Export';
        exportBtn.appendChild(exportText);

        footerRight.appendChild(importBtn);
        footerRight.appendChild(exportBtn);

        footer.appendChild(footerLeft);
        footer.appendChild(footerRight);

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);

        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        updateAllToggleStates();
    }

    function buildFeatureCard(f, accentColor, isSubFeature = false) {
        const card = document.createElement('div');
        card.className = 'ytkit-feature-card' + (isSubFeature ? ' ytkit-sub-card' : '') + (f.type === 'textarea' ? ' ytkit-textarea-card' : '') + (f.type === 'select' ? ' ytkit-select-card' : '') + (f.type === 'info' ? ' ytkit-info-card' : '');
        card.dataset.featureId = f.id;
        if (accentColor) card.style.setProperty('--cat-color', accentColor);

        // Apply enabled accent stripe for boolean features
        const _cardIsEnabled = f._arrayKey
            ? (appState.settings[f._arrayKey] || []).includes(f._arrayValue)
            : (f.type !== 'select' && f.type !== 'color' && f.type !== 'range' && appState.settings[f.id]);
        if (_cardIsEnabled && !isSubFeature) card.classList.add('ytkit-card-enabled');

        // Special styling for info cards
        if (f.type === 'info') {
            card.style.cssText = 'background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(34, 197, 94, 0.15)) !important; border: 1px solid rgba(249, 115, 22, 0.3) !important; grid-column: 1 / -1;';
        }

        const info = document.createElement('div');
        info.className = 'ytkit-feature-info';

        const name = document.createElement('h3');
        name.className = 'ytkit-feature-name';
        name.textContent = f.name;

        const desc = document.createElement('p');
        desc.className = 'ytkit-feature-desc';
        desc.textContent = f.description;

        info.appendChild(name);
        info.appendChild(desc);

        // Feature preview tooltip
        const previewText = FEATURE_PREVIEWS[f.id];
        if (previewText) {
            card.dataset.preview = previewText;
            card.classList.add('ytkit-has-preview');
        }

        card.appendChild(info);

        if (f.type === 'info') {
            // info-type features have no interactive control
        } else if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.className = 'ytkit-input';
            textarea.id = `ytkit-input-${f.id}`;
            textarea.placeholder = f.placeholder || 'word1, word2, phrase';
            textarea.value = appState.settings[f.settingKey || f.id] || appState.settings[f.id] || '';
            // Auto-save on blur for textarea features
            textarea.addEventListener('blur', () => {
                const key = f.settingKey || f.id;
                appState.settings[key] = textarea.value;
                settingsManager.save(appState.settings);
                document.dispatchEvent(new CustomEvent('ytkit-settings-changed', { detail: { key } }));
                if (f.id === 'cobaltUrl' && textarea.value) {
                    GM_setValue('ytkit_cobalt_url', textarea.value);
                }
            });
            card.appendChild(textarea);
        } else if (f.type === 'select') {
            const select = document.createElement('select');
            select.className = 'ytkit-select';
            select.id = `ytkit-select-${f.id}`;
            select.style.cssText = `padding:5px 10px;border-radius:6px;background:var(--ytkit-bg-base);color:#fff;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:12px;min-width:140px;`;
            const settingKey = f.settingKey || f.id;
            const currentValue = String(appState.settings[settingKey] ?? Object.keys(f.options)[0]);
            for (const [value, label] of Object.entries(f.options)) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                option.selected = value === currentValue;
                select.appendChild(option);
            }
            card.appendChild(select);
        } else if (f.type === 'range') {
            const settingKey = f.settingKey || f.id;
            const currentVal = appState.settings[settingKey] ?? f.min ?? 0;
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;align-items:center;gap:10px;min-width:200px;';
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = f.min ?? 0;
            slider.max = f.max ?? 100;
            slider.step = f.step ?? 1;
            slider.value = currentVal;
            slider.className = 'ytkit-range';
            slider.id = `ytkit-range-${f.id}`;
            slider.style.cssText = 'flex:1;accent-color:#3b82f6;cursor:pointer;height:6px;';
            const valDisplay = document.createElement('span');
            valDisplay.className = 'ytkit-range-value';
            valDisplay.style.cssText = 'min-width:45px;text-align:right;font-size:12px;color:var(--ytkit-text-secondary);font-weight:600;font-variant-numeric:tabular-nums;';
            valDisplay.textContent = f.formatValue ? f.formatValue(currentVal) : currentVal;
            slider.oninput = () => { valDisplay.textContent = f.formatValue ? f.formatValue(slider.value) : slider.value; };
            wrapper.appendChild(slider);
            wrapper.appendChild(valDisplay);
            card.appendChild(wrapper);
        } else if (f.type === 'color') {
            const settingKey = f.settingKey || f.id;
            const currentVal = appState.settings[settingKey] || '';
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.id = `ytkit-color-${f.id}`;
            colorInput.value = currentVal || '#3b82f6';
            colorInput.style.cssText = 'width:36px;height:28px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;cursor:pointer;background:transparent;padding:0;';
            const clearBtn = document.createElement('button');
            clearBtn.textContent = 'Clear';
            clearBtn.style.cssText = 'padding:4px 10px;border-radius:4px;background:var(--ytkit-bg-hover);border:1px solid rgba(255,255,255,0.1);color:#aaa;font-size:11px;cursor:pointer;';
            clearBtn.onclick = () => { colorInput.value = '#3b82f6'; colorInput.dispatchEvent(new Event('change', { bubbles: true })); };
            wrapper.appendChild(colorInput);
            wrapper.appendChild(clearBtn);
            card.appendChild(wrapper);
        } else {
            // For array-toggle sub-features, check array membership instead of boolean
            const isEnabled = f._arrayKey
                ? (appState.settings[f._arrayKey] || []).includes(f._arrayValue)
                : appState.settings[f.id];
            const switchDiv = document.createElement('div');
            switchDiv.className = 'ytkit-switch' + (isEnabled ? ' active' : '');
            switchDiv.style.setProperty('--switch-color', accentColor);

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'ytkit-feature-cb';
            input.id = `ytkit-toggle-${f.id}`;
            input.checked = isEnabled;

            const track = document.createElement('span');
            track.className = 'ytkit-switch-track';

            const thumb = document.createElement('span');
            thumb.className = 'ytkit-switch-thumb';

            const iconWrap = document.createElement('span');
            iconWrap.className = 'ytkit-switch-icon';
            iconWrap.appendChild(ICONS.check());

            thumb.appendChild(iconWrap);
            track.appendChild(thumb);
            switchDiv.appendChild(input);
            switchDiv.appendChild(track);
            card.appendChild(switchDiv);
        }

        return card;
    }

    function createToast(message, type = 'success', duration = 3000) {
        const colorMap = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
        showToast(message, colorMap[type] || '#22c55e', { duration: duration / 1000 });
    }

    function updateAllToggleStates() {
        document.querySelectorAll('.ytkit-toggle-all-cb').forEach(cb => {
            const catId = cb.dataset.category;
            const pane = document.getElementById(`ytkit-pane-${catId}`);
            if (!pane) return;
            const featureToggles = pane.querySelectorAll('.ytkit-feature-cb');
            const allChecked = featureToggles.length > 0 && Array.from(featureToggles).every(t => t.checked);
            cb.checked = allChecked;

            // Update switch visual state
            const switchEl = cb.closest('.ytkit-switch');
            if (switchEl) {
                switchEl.classList.toggle('active', allChecked);
            }
        });

        // Update nav counts
        document.querySelectorAll('.ytkit-nav-btn').forEach(btn => {
            const catId = btn.dataset.tab;
            const pane = document.getElementById(`ytkit-pane-${catId}`);
            if (!pane) return;
            const featureToggles = pane.querySelectorAll('.ytkit-feature-card:not(.ytkit-sub-card) .ytkit-feature-cb');
            const enabledCount = Array.from(featureToggles).filter(t => t.checked).length;
            const totalCount = featureToggles.length;
            const countEl = btn.querySelector('.ytkit-nav-count');
            if (countEl) countEl.textContent = `${enabledCount}/${totalCount}`;
        });
    }

    function handleFileImport(callback) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = readerEvent => callback(readerEvent.target.result);
            reader.readAsText(file);
        };
        fileInput.click();
    }

    function handleFileExport(filename, content) {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function attachUIEventListeners() {
        const doc = document;

        // Auto-close panel on SPA navigation — prevents overlay persisting on home/other pages
        doc.addEventListener('yt-navigate-start', () => {
            doc.body.classList.remove('ytkit-panel-open');
        });

        // Close panel
        doc.addEventListener('click', (e) => {
            if (e.target.closest('.ytkit-close') || e.target.matches('#ytkit-overlay')) {
                doc.body.classList.remove('ytkit-panel-open');
            }
        });

        // Tab navigation
        doc.addEventListener('click', (e) => {
            const navBtn = e.target.closest('.ytkit-nav-btn');
            if (navBtn) {
                doc.querySelectorAll('.ytkit-nav-btn').forEach(btn => btn.classList.remove('active'));
                doc.querySelectorAll('.ytkit-pane').forEach(pane => pane.classList.remove('active'));
                navBtn.classList.add('active');
                const pane = doc.querySelector(`#ytkit-pane-${navBtn.dataset.tab}`);
                if (pane) {
                    pane.classList.add('active');
                    pane.scrollTop = 0;
                }
                // Also scroll the main content area
                const contentArea = doc.querySelector('.ytkit-content');
                if (contentArea) contentArea.scrollTop = 0;
            }
        });

        // Keyboard shortcuts
        doc.addEventListener('keydown', (e) => {
            if (e.key === "Escape" && doc.body.classList.contains('ytkit-panel-open')) {
                doc.body.classList.remove('ytkit-panel-open');
            }
            if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                e.stopPropagation();
                doc.body.classList.toggle('ytkit-panel-open');
            }
        });

        // Search functionality (debounced)
        let _searchDebounce = null;
        doc.addEventListener('input', (e) => {
            if (e.target.matches('#ytkit-search')) {
                clearTimeout(_searchDebounce);
                _searchDebounce = setTimeout(() => { _handleSearch(e.target.value); }, 150);
                return;
            }
        });
        function _handleSearch(rawQuery) {
            const query = rawQuery.toLowerCase().trim();
            const allCards = doc.querySelectorAll('.ytkit-feature-card');
            const allPanes = doc.querySelectorAll('.ytkit-pane');
            const allNavBtns = doc.querySelectorAll('.ytkit-nav-btn');

            // Clear all previous highlights
            doc.querySelectorAll('.ytkit-feature-name, .ytkit-feature-desc').forEach(el => {
                if (el._originalText !== undefined) el.textContent = el._originalText;
            });

            if (!query) {
                // Reset to normal view
                allCards.forEach(card => card.style.display = '');
                allPanes.forEach(pane => pane.classList.remove('ytkit-search-active'));
                doc.querySelectorAll('.ytkit-sub-features').forEach(sub => {
                    const parentId = sub.dataset.parentId;
                    const enabled = appState.settings[parentId];
                    sub.style.opacity = enabled ? '' : '0.35';
                    sub.style.pointerEvents = enabled ? '' : 'none';
                });
                // Restore normal tab behavior
                if (!doc.querySelector('.ytkit-pane.active')) {
                    allPanes[0]?.classList.add('active');
                    allNavBtns[0]?.classList.add('active');
                }
                return;
            }

            // Show all panes for searching
            allPanes.forEach(pane => pane.classList.add('ytkit-search-active'));
            doc.querySelectorAll('.ytkit-sub-features').forEach(sub => { sub.style.opacity = ''; sub.style.pointerEvents = ''; });

            // Helper to highlight text matches
            const highlightText = (el, q) => {
                if (!el) return;
                if (el._originalText === undefined) el._originalText = el.textContent;
                const text = el._originalText;
                const idx = text.toLowerCase().indexOf(q);
                if (idx === -1) { el.textContent = text; return; }
                el.textContent = '';
                el.appendChild(document.createTextNode(text.substring(0, idx)));
                const mark = document.createElement('mark');
                mark.style.cssText = 'background:#fbbf24;color:#000;border-radius:2px;padding:0 1px;';
                mark.textContent = text.substring(idx, idx + q.length);
                el.appendChild(mark);
                el.appendChild(document.createTextNode(text.substring(idx + q.length)));
            };

            // Filter cards and highlight
            let matchCount = 0;
            allCards.forEach(card => {
                const nameEl = card.querySelector('.ytkit-feature-name');
                const descEl = card.querySelector('.ytkit-feature-desc');
                const name = nameEl?.textContent.toLowerCase() || '';
                const desc = descEl?.textContent.toLowerCase() || '';
                const matches = name.includes(query) || desc.includes(query);
                card.style.display = matches ? '' : 'none';
                if (matches) {
                    matchCount++;
                    highlightText(nameEl, query);
                    highlightText(descEl, query);
                }
            });

            // Update nav buttons with match counts
            allNavBtns.forEach(btn => {
                const catId = btn.dataset.tab;
                const pane = doc.getElementById(`ytkit-pane-${catId}`);
                if (pane) {
                    const visibleCards = pane.querySelectorAll('.ytkit-feature-card:not([style*="display: none"])').length;
                    const countEl = btn.querySelector('.ytkit-nav-count');
                    if (countEl && query) {
                        countEl.textContent = visibleCards > 0 ? `${visibleCards} match${visibleCards !== 1 ? 'es' : ''}` : '0';
                        countEl.style.color = visibleCards > 0 ? '#22c55e' : '#666';
                    }
                }
            });
        }

        // Clear search on tab click
        doc.addEventListener('click', (e) => {
            if (e.target.closest('.ytkit-nav-btn')) {
                const searchInput = doc.getElementById('ytkit-search');
                if (searchInput && searchInput.value) {
                    searchInput.value = '';
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });

        // Feature toggles
        doc.addEventListener('change', (e) => {
            if (e.target.matches('.ytkit-feature-cb')) {
                const card = e.target.closest('[data-feature-id]');
                if (!card) return;
                const featureId = card.dataset.featureId;
                const isEnabled = e.target.checked;

                // Update switch visual
                const switchEl = e.target.closest('.ytkit-switch');
                if (switchEl) switchEl.classList.toggle('active', isEnabled);

                // Update card enabled accent stripe
                const cardEl = e.target.closest('.ytkit-feature-card');
                if (cardEl && !cardEl.classList.contains('ytkit-sub-card')) {
                    cardEl.classList.toggle('ytkit-card-enabled', isEnabled);
                }

                const feature = features.find(f => f.id === featureId);

                // Array-toggle sub-features: modify parent array instead of boolean
                if (feature?._arrayKey) {
                    let arr = appState.settings[feature._arrayKey] || [];
                    if (!Array.isArray(arr)) arr = [];
                    if (isEnabled && !arr.includes(feature._arrayValue)) {
                        arr.push(feature._arrayValue);
                    } else if (!isEnabled) {
                        arr = arr.filter(v => v !== feature._arrayValue);
                    }
                    appState.settings[feature._arrayKey] = arr;
                    settingsManager.save(appState.settings);
                    // Re-init parent feature to apply changes
                    const parentFeature = features.find(f => f.id === feature.parentId);
                    if (parentFeature) {
                        try { parentFeature.destroy?.(); parentFeature._initialized = false; } catch(err) {
                            DebugManager.log('Toggle', `Array parent destroy failed for "${parentFeature.id}": ${err.message}`);
                        }
                        if (appState.settings[parentFeature.id] !== false) {
                            try { parentFeature.init?.(); parentFeature._initialized = true; } catch(err) {
                                DebugManager.log('Toggle', `Array parent init failed for "${parentFeature.id}": ${err.message}`);
                            }
                        }
                    }
                } else {
                    appState.settings[featureId] = isEnabled;
                    settingsManager.save(appState.settings);

                    // Conflict enforcement — auto-disable conflicting features
                    if (isEnabled && CONFLICT_MAP[featureId]) {
                        const conflicts = CONFLICT_MAP[featureId].conflicts || [];
                        const activeConflicts = conflicts.filter(cid => appState.settings[cid]);
                        if (activeConflicts.length > 0) {
                            activeConflicts.forEach(cid => {
                                const cf = features.find(ff => ff.id === cid);
                                appState.settings[cid] = false;
                                settingsManager.save(appState.settings);
                                if (cf?._initialized) {
                                    try { cf.destroy?.(); cf._initialized = false; } catch(err) {
                                        DebugManager.log('Conflict', `Destroy failed for "${cid}": ${err.message}`);
                                    }
                                }
                                // Update toggle UI in settings panel
                                const toggle = document.querySelector(`[data-feature-id="${cid}"] input[type="checkbox"]`);
                                if (toggle) toggle.checked = false;
                            });
                            const conflictNames = activeConflicts.map(cid => {
                                const cf = features.find(ff => ff.id === cid);
                                return cf?.name || cid;
                            }).join(', ');
                            showToast('Auto-disabled ' + conflictNames + ' — ' + (CONFLICT_MAP[featureId].reason || 'conflicts with ' + (feature?.name || featureId)), '#f59e0b', { duration: 5 });
                        }
                    }

                    if (feature) {
                        if (isEnabled) {
                            // Reset crash counter on manual toggle-on
                            delete _featureCrashCounts[featureId]; _persistCrashCounts();
                            try { feature.init?.(); feature._initialized = true; } catch(err) {
                                console.error(`[YTKit] Error initializing "${featureId}":`, err);
                                DebugManager.log('Toggle', `Init failed for "${featureId}": ${err.message}`);
                            }
                        } else {
                            try { feature.destroy?.(); feature._initialized = false; } catch(err) {
                                console.error(`[YTKit] Error destroying "${featureId}":`, err);
                                DebugManager.log('Toggle', `Destroy failed for "${featureId}": ${err.message}`);
                            }
                        }
                    }

                    // If this is a sub-feature, reinit the parent to pick up the change
                    if (feature?.isSubFeature && feature.parentId) {
                        const parentFeature = features.find(f => f.id === feature.parentId);
                        if (parentFeature && appState.settings[parentFeature.id] !== false) {
                            try { parentFeature.destroy?.(); parentFeature._initialized = false; } catch(err) {
                                DebugManager.log('Toggle', `Parent destroy failed for "${parentFeature.id}": ${err.message}`);
                            }
                            try { parentFeature.init?.(); parentFeature._initialized = true; } catch(err) {
                                DebugManager.log('Toggle', `Parent init failed for "${parentFeature.id}": ${err.message}`);
                            }
                        }
                    }
                }

                // Toggle sub-features visibility (greyed out, not hidden)
                const subContainer = doc.querySelector(`.ytkit-sub-features[data-parent-id="${featureId}"]`);
                if (subContainer) {
                    subContainer.style.opacity = isEnabled ? '' : '0.35';
                    subContainer.style.pointerEvents = isEnabled ? '' : 'none';
                }

                updateAllToggleStates();
            }

            // Toggle all
            if (e.target.matches('.ytkit-toggle-all-cb')) {
                const isEnabled = e.target.checked;
                const catId = e.target.dataset.category;
                const pane = doc.getElementById(`ytkit-pane-${catId}`);

                // Update the switch visual state
                const switchEl = e.target.closest('.ytkit-switch');
                if (switchEl) {
                    switchEl.classList.toggle('active', isEnabled);
                }

                if (pane) {
                    pane.querySelectorAll('.ytkit-feature-card:not(.ytkit-sub-card) .ytkit-feature-cb').forEach(cb => {
                        if (cb.checked !== isEnabled) {
                            cb.checked = isEnabled;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                }
            }
        });

        // Textarea input
        doc.addEventListener('input', (e) => {
            if (e.target.matches('.ytkit-input')) {
                const card = e.target.closest('[data-feature-id]');
                if (!card) return;
                const featureId = card.dataset.featureId;
                appState.settings[featureId] = e.target.value;
                settingsManager.save(appState.settings);
                const feature = features.find(f => f.id === featureId);
                if (feature) {
                    feature.destroy?.();
                    feature.init?.();
                }
            }
            // Select dropdown
            if (e.target.matches('.ytkit-select')) {
                const card = e.target.closest('[data-feature-id]');
                if (!card) return;
                const featureId = card.dataset.featureId;
                const feature = features.find(f => f.id === featureId);

                // Use settingKey if specified, otherwise use featureId
                const settingKey = feature?.settingKey || featureId;
                const newValue = e.target.value;

                appState.settings[settingKey] = newValue;
                settingsManager.save(appState.settings);

                // Reinitialize the feature to apply changes immediately
                if (feature) {
                    if (typeof feature.destroy === 'function') {
                        try { feature.destroy(); feature._initialized = false; } catch (e) { /* ignore */ }
                    }
                    if (typeof feature.init === 'function') {
                        try { feature.init(); feature._initialized = true; } catch (e) { console.warn('[YTKit] Feature reinit error:', e); }
                    }
                }

                const selectedText = e.target.options[e.target.selectedIndex].text;
                createToast(`${feature?.name || 'Setting'} changed to ${selectedText}`, 'success');
            }
            // Range slider
            if (e.target.matches('.ytkit-range')) {
                const card = e.target.closest('[data-feature-id]');
                if (!card) return;
                const featureId = card.dataset.featureId;
                const feature = features.find(f => f.id === featureId);
                const settingKey = feature?.settingKey || featureId;
                const val = parseFloat(e.target.value);
                appState.settings[settingKey] = val;
                settingsManager.save(appState.settings);
                if (feature) {
                    try { feature.destroy?.(); feature._initialized = false; } catch(err) {
                        DebugManager.log('Range', `Destroy failed for "${featureId}": ${err.message}`);
                    }
                    try { feature.init?.(); feature._initialized = true; } catch(err) {
                        DebugManager.log('Range', `Init failed for "${featureId}": ${err.message}`);
                    }
                }
            }
            // Color picker
            if (e.target.matches('[id^="ytkit-color-"]')) {
                const card = e.target.closest('[data-feature-id]');
                if (!card) return;
                const featureId = card.dataset.featureId;
                const feature = features.find(f => f.id === featureId);
                const settingKey = feature?.settingKey || featureId;
                appState.settings[settingKey] = e.target.value;
                settingsManager.save(appState.settings);
                if (feature) {
                    try { feature.destroy?.(); feature._initialized = false; } catch(err) {
                        DebugManager.log('Color', `Destroy failed for "${featureId}": ${err.message}`);
                    }
                    try { feature.init?.(); feature._initialized = true; } catch(err) {
                        DebugManager.log('Color', `Init failed for "${featureId}": ${err.message}`);
                    }
                }
            }
        });
        doc.addEventListener('click', (e) => {
            if (e.target.closest('#ytkit-export')) {
                const configString = settingsManager.exportAllSettings();
                handleFileExport('ytkit_settings.json', configString);
                createToast('Settings exported successfully', 'success');
            }
            if (e.target.closest('#ytkit-import')) {
                handleFileImport(async (content) => {
                    const success = settingsManager.importAllSettings(content);
                    if (success) {
                        createToast('Settings imported! Reloading...', 'success');
                        setTimeout(() => location.reload(), 1000);
                    } else {
                        createToast('Import failed. Invalid file format.', 'error');
                    }
                });
            }
        });
    }

    //  SECTION 5: STYLES
    function injectPanelStyles() {
        GM_addStyle(`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');:root{--ytkit-font:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;--ytkit-bg-base:#0a0a0b;--ytkit-bg-elevated:#111113;--ytkit-bg-surface:#17171a;--ytkit-bg-hover:#1e1e22;--ytkit-bg-active:#27272a;--ytkit-border:#2a2a2e;--ytkit-border-subtle:#1e1e22;--ytkit-text-primary:#f0f0f0;--ytkit-text-secondary:#a1a1aa;--ytkit-text-muted:#71717a;--ytkit-accent:#ff4e45;--ytkit-accent-soft:rgba(255,78,69,0.12);--ytkit-success:#22c55e;--ytkit-error:#ef4444;--ytkit-radius-sm:8px;--ytkit-radius-md:12px;--ytkit-radius-lg:16px;--ytkit-radius-xl:20px;--ytkit-shadow-sm:0 1px 2px rgba(0,0,0,0.3);--ytkit-shadow-md:0 4px 16px rgba(0,0,0,0.35);--ytkit-shadow-lg:0 8px 32px rgba(0,0,0,0.45);--ytkit-shadow-xl:0 24px 64px rgba(0,0,0,0.55);--ytkit-transition:180ms cubic-bezier(0.4,0,0.2,1);} .ytkit-vlc-btn,.ytkit-local-dl-btn,.ytkit-mp3-dl-btn,.ytkit-transcript-btn,.ytkit-mpv-btn,.ytkit-dlplay-btn,.ytkit-embed-btn{display:inline-flex !important;visibility:visible !important;opacity:1 !important;z-index:9999 !important;position:relative !important;} .ytkit-button-container{display:flex !important;gap:8px !important;margin:8px 0 !important;flex-wrap:wrap !important;visibility:visible !important;} .ytkit-trigger-btn{display:flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;margin:0 4px;background:transparent;border:none;border-radius:var(--ytkit-radius-md);cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-trigger-btn svg{width:22px;height:22px;color:var(--yt-spec-icon-inactive,#aaa);transition:all var(--ytkit-transition);} .ytkit-trigger-btn:hover{background:var(--yt-spec-badge-chip-background,rgba(255,255,255,0.1));} .ytkit-trigger-btn:hover svg{color:var(--yt-spec-text-primary,#fff);transform:rotate(45deg);} #ytkit-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:80000;opacity:0;pointer-events:none;transition:opacity 300ms ease;} body.ytkit-panel-open #ytkit-overlay{opacity:1;pointer-events:auto;} #ytkit-settings-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.96);z-index:80001;display:flex;flex-direction:column;width:95%;max-width:1100px;height:85vh;max-height:820px;background:var(--ytkit-bg-base);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-xl);box-shadow:var(--ytkit-shadow-xl),0 0 0 1px rgba(255,255,255,0.04) inset;font-family:var(--ytkit-font);color:var(--ytkit-text-primary);opacity:0;pointer-events:none;transition:all 300ms cubic-bezier(0.32,0.72,0,1);overflow:hidden;} body.ytkit-panel-open #ytkit-settings-panel{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1);} .ytkit-header{display:flex;align-items:center;justify-content:space-between;padding:10px 24px;background:var(--ytkit-bg-elevated);border-bottom:1px solid var(--ytkit-border);flex-shrink:0;} .ytkit-brand{display:flex;align-items:center;gap:12px;} .ytkit-title{font-size:22px;font-weight:700;letter-spacing:-0.5px;margin:0;} .ytkit-title-yt{background:linear-gradient(135deg,#ff4e45 0%,#ff0000 50%,#ff4e45 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:ytkit-shimmer 3s linear infinite;} .ytkit-title-kit{color:var(--ytkit-text-primary);} @keyframes ytkit-shimmer{0%{background-position:0% center;} 100%{background-position:200% center;} } .ytkit-badge{padding:3px 10px;font-size:9px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,#ff4e45,#e6302a);border-radius:100px;box-shadow:0 2px 8px rgba(255,78,69,0.35);} .ytkit-close{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-sm);cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-close svg{width:16px;height:16px;color:var(--ytkit-text-secondary);transition:color var(--ytkit-transition);} .ytkit-close:hover{background:var(--ytkit-error);border-color:var(--ytkit-error);} .ytkit-close:hover svg{color:#fff;} .ytkit-body{display:flex;flex:1;overflow:hidden;} .ytkit-sidebar{display:flex;flex-direction:column;width:230px;padding:8px 6px;background:var(--ytkit-bg-elevated);border-right:1px solid var(--ytkit-border);overflow-y:auto;flex-shrink:0;gap:2px;} .ytkit-search-container{position:relative;margin:0 2px 10px;} .ytkit-search-input{width:100%;padding:8px 12px 8px 34px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-sm);color:var(--ytkit-text-primary);font-size:13px;font-family:var(--ytkit-font);transition:all var(--ytkit-transition);box-sizing:border-box;} .ytkit-search-input:focus{outline:none;border-color:var(--ytkit-accent);box-shadow:0 0 0 3px rgba(255,78,69,0.12);} .ytkit-search-input::placeholder{color:var(--ytkit-text-muted);} .ytkit-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--ytkit-text-muted);pointer-events:none;} .ytkit-sidebar-divider{height:1px;background:var(--ytkit-border);margin:6px 4px 8px;} .ytkit-pane.ytkit-search-active{display:block;} .ytkit-pane.ytkit-search-active .ytkit-pane-header{display:none;} .ytkit-nav-btn{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;margin:0;background:transparent;border:none;border-radius:var(--ytkit-radius-sm);cursor:pointer;transition:all var(--ytkit-transition);text-align:left;} .ytkit-nav-btn:hover{background:var(--ytkit-bg-hover);} .ytkit-nav-btn.active{background:var(--ytkit-bg-active);} .ytkit-nav-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:var(--ytkit-bg-surface);border-radius:6px;flex-shrink:0;transition:all var(--ytkit-transition);} .ytkit-nav-btn.active .ytkit-nav-icon{background:var(--cat-color,var(--ytkit-accent));box-shadow:0 2px 10px color-mix(in srgb,var(--cat-color,var(--ytkit-accent)) 40%,transparent);} .ytkit-nav-icon svg{width:15px;height:15px;color:var(--ytkit-text-secondary);transition:color var(--ytkit-transition);} .ytkit-nav-btn.active .ytkit-nav-icon svg{color:#fff;} .ytkit-nav-label{flex:1;font-size:13px;font-weight:500;color:var(--ytkit-text-secondary);transition:color var(--ytkit-transition);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .ytkit-nav-btn.active .ytkit-nav-label{color:var(--ytkit-text-primary);font-weight:600;} .ytkit-nav-count{font-size:10px;font-weight:600;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);padding:2px 7px;border-radius:100px;transition:all var(--ytkit-transition);} .ytkit-nav-btn.active .ytkit-nav-count{background:rgba(255,255,255,0.12);color:var(--ytkit-text-primary);} .ytkit-nav-arrow{display:flex;opacity:0;transition:opacity var(--ytkit-transition);} .ytkit-nav-arrow svg{width:14px;height:14px;color:var(--ytkit-text-muted);} .ytkit-nav-btn.active .ytkit-nav-arrow{opacity:1;} .ytkit-nav-group-label{padding:8px 12px 4px;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--ytkit-text-muted);user-select:none;pointer-events:none;} .ytkit-content{flex:1;padding:20px 24px;overflow-y:auto;background:var(--ytkit-bg-base);} .ytkit-pane{display:none;animation:ytkit-fade-in 250ms ease;} .ytkit-pane.active{display:block;} .ytkit-pane.ytkit-vh-pane.active{display:flex;flex-direction:column;height:100%;max-height:calc(85vh - 180px);} #ytkit-vh-content{flex:1;overflow-y:auto;padding-right:8px;} @keyframes ytkit-fade-in{from{opacity:0;transform:translateY(6px);} to{opacity:1;transform:translateY(0);} } @keyframes ytkit-badge-pulse{0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.5;transform:scale(1.3);} } .ytkit-pane-header{display:flex;align-items:center;justify-content:space-between;margin:0 0 16px 0;padding:0 0 14px 0;border-bottom:1px solid var(--ytkit-border);} .ytkit-pane-title{display:flex;align-items:center;gap:10px;} .ytkit-pane-title h2{font-size:18px;font-weight:700;margin:0;color:var(--ytkit-text-primary);letter-spacing:-0.3px;} .ytkit-toggle-all{display:flex;align-items:center;gap:8px;cursor:pointer;} .ytkit-toggle-all span{font-size:12px;font-weight:500;color:var(--ytkit-text-secondary);} .ytkit-reset-group-btn{padding:5px 12px;margin-right:10px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-sm);color:var(--ytkit-text-muted);font-size:11px;font-weight:500;cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-reset-group-btn:hover{background:var(--ytkit-error);border-color:var(--ytkit-error);color:#fff;} .ytkit-features-grid{display:grid;grid-template-columns:1fr;gap:6px;} .ytkit-feature-card{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;margin:0;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border-subtle);border-left:3px solid transparent;border-radius:var(--ytkit-radius-sm);transition:all var(--ytkit-transition);} .ytkit-feature-card:hover{background:var(--ytkit-bg-hover);border-color:var(--ytkit-border);border-left-color:transparent;transform:translateX(2px);} .ytkit-feature-card.ytkit-card-enabled{border-left-color:var(--cat-color,var(--ytkit-accent));background:color-mix(in srgb,var(--cat-color,var(--ytkit-accent)) 4%,var(--ytkit-bg-surface));} .ytkit-sub-card{margin-left:20px;background:var(--ytkit-bg-elevated);border-left:2px solid var(--ytkit-accent-soft);} .ytkit-sub-features{display:grid;grid-template-columns:1fr;gap:6px;} .ytkit-feature-info{flex:1;min-width:0;padding-right:16px;} .ytkit-feature-name{font-size:13px;font-weight:600;color:var(--ytkit-text-primary);margin:0 0 2px 0;} .ytkit-feature-desc{font-size:11px;color:var(--ytkit-text-muted);margin:0;line-height:1.4;} .ytkit-textarea-card{flex-direction:column;align-items:stretch;gap:8px;} .ytkit-textarea-card .ytkit-feature-info{padding-right:0;} .ytkit-input{width:100%;padding:7px 10px;font-family:var(--ytkit-font);font-size:12px;color:var(--ytkit-text-primary);background:var(--ytkit-bg-base);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-sm);resize:vertical;min-height:50px;transition:all var(--ytkit-transition);} .ytkit-input:focus{outline:none;border-color:var(--ytkit-accent);box-shadow:0 0 0 3px var(--ytkit-accent-soft);} .ytkit-input::placeholder{color:var(--ytkit-text-muted);} .ytkit-switch{position:relative;width:40px;height:22px;flex-shrink:0;} .ytkit-switch input{position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;z-index:1;margin:0;} .ytkit-switch-track{position:absolute;inset:0;background:var(--ytkit-bg-active);border:1px solid var(--ytkit-border);border-radius:100px;transition:all var(--ytkit-transition);} .ytkit-switch.active .ytkit-switch-track{background:var(--switch-color,var(--ytkit-accent));border-color:transparent;box-shadow:0 0 14px color-mix(in srgb,var(--switch-color,var(--ytkit-accent)) 45%,transparent);} .ytkit-switch-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;box-shadow:var(--ytkit-shadow-sm);transition:all var(--ytkit-transition);display:flex;align-items:center;justify-content:center;} .ytkit-switch.active .ytkit-switch-thumb{transform:translateX(18px);} .ytkit-switch-icon{display:flex;opacity:0;transform:scale(0.5);transition:all var(--ytkit-transition);} .ytkit-switch-icon svg{width:10px;height:10px;color:var(--switch-color,var(--ytkit-accent));} .ytkit-switch.active .ytkit-switch-icon{opacity:1;transform:scale(1);} .ytkit-footer{display:flex;align-items:center;justify-content:space-between;padding:10px 24px;background:var(--ytkit-bg-elevated);border-top:1px solid var(--ytkit-border);flex-shrink:0;} .ytkit-footer-left{display:flex;align-items:center;gap:12px;} .ytkit-github{display:flex;align-items:center;justify-content:center;width:30px;height:30px;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);border-radius:6px;transition:all var(--ytkit-transition);} .ytkit-github:hover{color:var(--ytkit-text-primary);background:var(--ytkit-bg-hover);} .ytkit-github svg{width:16px;height:16px;} .ytkit-version{font-size:11px;font-weight:600;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);padding:3px 10px;border-radius:100px;} .ytkit-shortcut{font-size:10px;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);padding:3px 8px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;} .ytkit-footer-right{display:flex;gap:8px;} .ytkit-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;font-family:var(--ytkit-font);font-size:12px;font-weight:600;border:none;border-radius:var(--ytkit-radius-sm);cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-btn svg{width:14px;height:14px;} .ytkit-btn-secondary{color:var(--ytkit-text-secondary);background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);} .ytkit-btn-secondary:hover{background:var(--ytkit-bg-hover);color:var(--ytkit-text-primary);} .ytkit-btn-primary{color:#fff;background:linear-gradient(135deg,#ff4e45,#e6302a);box-shadow:0 2px 8px rgba(255,78,69,0.3);} .ytkit-btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(255,78,69,0.4);} .ytkit-toast{position:fixed;bottom:-80px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:12px 20px;font-family:var(--ytkit-font);font-size:13px;font-weight:500;color:#fff;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-md);box-shadow:var(--ytkit-shadow-lg);z-index:90000;transition:all 400ms cubic-bezier(0.68,-0.55,0.27,1.55);} .ytkit-toast.show{bottom:24px;} .ytkit-toast-success{border-color:var(--ytkit-success);box-shadow:0 4px 20px rgba(34,197,94,0.15);} .ytkit-toast-error{border-color:var(--ytkit-error);box-shadow:0 4px 20px rgba(239,68,68,0.15);}ytd-watch-metadata.watch-active-metadata{margin-top:180px !important;} ytd-live-chat-frame:not([style*="position"]){margin-top:-57px !important;width:402px !important;} .ytkit-sidebar::-webkit-scrollbar,.ytkit-content::-webkit-scrollbar{width:5px;} .ytkit-sidebar::-webkit-scrollbar-track,.ytkit-content::-webkit-scrollbar-track{background:transparent;} .ytkit-sidebar::-webkit-scrollbar-thumb,.ytkit-content::-webkit-scrollbar-thumb{background:var(--ytkit-border);border-radius:100px;} .ytkit-sidebar::-webkit-scrollbar-thumb:hover,.ytkit-content::-webkit-scrollbar-thumb:hover{background:var(--ytkit-text-muted);}  .ytkit-css-editor{width:100%;min-height:150px;padding:12px;background:var(--ytkit-bg-base);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-md);color:var(--ytkit-text-primary);font-family:'Monaco','Menlo','Ubuntu Mono',monospace;font-size:13px;line-height:1.5;resize:vertical;} .ytkit-css-editor:focus{outline:none;border-color:var(--ytkit-accent);} .ytkit-bulk-bar{animation:slideDown 0.2s ease-out;} @keyframes slideDown{from{opacity:0;transform:translateY(-10px);} to{opacity:1;transform:translateY(0);} }

/* ─── Drag-reorder sidebar ─── */
.ytkit-nav-btn{cursor:grab;user-select:none;}
.ytkit-nav-btn:active{cursor:grabbing;}
.ytkit-nav-btn.ytkit-dragging{opacity:0.3;transform:scale(0.95);}
.ytkit-drag-above{box-shadow:0 -2px 0 0 var(--ytkit-accent) inset;}
.ytkit-drag-below{box-shadow:0 2px 0 0 var(--ytkit-accent) inset;}


/* ─── Feature Preview Tooltip ─── */
.ytkit-feature-card.ytkit-has-preview{position:relative;}
.ytkit-feature-card.ytkit-has-preview::after{content:attr(data-preview);position:absolute;bottom:calc(100% + 8px);left:16px;right:16px;padding:8px 12px;background:#1a1a2e;color:var(--ytkit-text-secondary);font-size:11px;line-height:1.45;border-radius:8px;border:1px solid var(--ytkit-border);box-shadow:var(--ytkit-shadow-md);opacity:0;pointer-events:none;transition:opacity 0.2s ease 0.5s,transform 0.2s ease 0.5s;transform:translateY(4px);z-index:10;white-space:normal;}
.ytkit-feature-card.ytkit-has-preview:hover::after{opacity:1;transform:translateY(0);}

/* ─── Responsive Breakpoints ─── */
@media (max-width:900px){
    #ytkit-settings-panel{width:98%;height:92vh;max-height:none;border-radius:14px;}
    .ytkit-sidebar{width:190px;padding:6px 4px;}
    .ytkit-nav-label{font-size:12px;}
    .ytkit-nav-icon{width:26px;height:26px;}
    .ytkit-nav-icon svg{width:13px;height:13px;}
    .ytkit-content{padding:14px 16px;}
    .ytkit-pane-title h2{font-size:16px;}
}
@media (max-width:700px){
    .ytkit-body{flex-direction:column;}
    .ytkit-sidebar{width:100%;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:none;border-bottom:1px solid var(--ytkit-border);padding:8px;gap:4px;flex-shrink:0;max-height:none;height:auto;}
    .ytkit-search-container{display:none;}
    .ytkit-sidebar-divider{display:none;}
    .ytkit-nav-group-label{display:none;}
    .ytkit-nav-btn{flex-direction:column;gap:3px;padding:4px 8px;min-width:fit-content;white-space:nowrap;margin:0;border-radius:8px;}
    .ytkit-nav-icon{width:24px;height:24px;}
    .ytkit-nav-label{font-size:10px;}
    .ytkit-nav-count{font-size:9px;padding:1px 4px;}
    .ytkit-nav-arrow{display:none !important;}
    .ytkit-content{padding:10px;flex:1;overflow-y:auto;}
    .ytkit-pane-header{flex-wrap:wrap;gap:6px;}
    .ytkit-toggle-all span{font-size:10px;}
    .ytkit-feature-card{padding:4px 10px;}
    .ytkit-feature-name{font-size:12px;}
    .ytkit-feature-desc{font-size:10px;}
    .ytkit-header{padding:4px 12px;}
    .ytkit-title{font-size:18px;}
    .ytkit-footer{padding:4px 12px;flex-wrap:wrap;gap:6px;}
    .ytkit-footer-left{gap:6px;}
    .ytkit-btn{padding:5px 10px;font-size:11px;}
    /* Tooltip below on mobile */
    .ytkit-feature-card.ytkit-has-preview::after{bottom:auto;top:calc(100% + 4px);left:8px;right:8px;}
}
@media (max-width:480px){
    #ytkit-settings-panel{width:100%;height:100vh;border-radius:0;max-height:100vh;}
    .ytkit-sidebar{padding:4px 0;gap:2px;}
    .ytkit-nav-btn{padding:3px 6px;}
    .ytkit-content{padding:10px;}
    .ytkit-pane-title h2{font-size:14px;}
    .ytkit-sub-card{margin-left:10px;}
    .ytkit-feature-card.ytkit-has-preview::after{display:none;}
}`);
    }

    //  SECTION 6: BOOTSTRAP
    let _mainRan = false;
    function main() {
        if (_mainRan) return; // Guard against double-init (YouTube SPA can re-trigger)
        _mainRan = true;
        appState.settings = settingsManager.load();
        appState.currentPage = getCurrentPage();

        // Live chat iframe: only initialize chat-related features, skip full UI
        if (window.location.pathname.startsWith('/live_chat')) {
            const CHAT_FEATURE_IDS = new Set([
                'hideLiveChatEngagement', 'hiddenChatElementsManager', 'chatKeywordFilter'
            ]);
            const chatFeatures = features.filter(f =>
                CHAT_FEATURE_IDS.has(f.id) || CHAT_FEATURE_IDS.has(f.parentId)
            );
            chatFeatures.forEach(f => {
                if (f._arrayKey) return;
                const isEnabled = appState.settings[f.id];
                if (!isEnabled) return;
                try { f.init?.(); f._initialized = true; } catch(e) {
                    console.warn('[YTKit Chat] Feature init error:', f.id, e);
                }
            });
            console.log('[YTKit] Chat iframe mode - initialized chat features only');
            return;
        }

        // Inject base accent CSS variables (default purple, overridden by colorThemeManager)
        injectStyle(`:root, html[dark] { --ytkit-accent: #a78bfa; --ytkit-accent-rgb: 167,139,250; --ytkit-accent-light: #c4b5fd; }`, 'ytkit-accent-vars', true);

        injectPanelStyles();

    //  Page Feature Dock — per-page floating toggle strip
    //  Page Quick Settings Modal
    //  A per-page context modal opened by a dedicated button next to the gear.

    // Per-page feature config: id → label override (null = use feature.name)
    const PAGE_MODAL_CONFIG = {
        home: [
            { id: 'videosPerRow',               label: 'Videos Per Row' },
            { id: 'hideNewsHome',                label: 'Hide News' },
            { id: 'hidePlaylistsHome',           label: 'Hide Playlists' },
        ],
        subs: [
            { id: 'subscriptionsGrid',           label: 'Dense Grid' },
            { id: 'fullWidthSubscriptions',      label: 'Full Width' },
            { id: 'hideVideosFromHome',          label: 'Video Hider' },
        ],
        watch: [
            { id: 'stickyVideo',                 label: 'Theater Split' },
            { id: 'expandVideoWidth',            label: 'Expand Width' },
            { id: 'autoMaxResolution',           label: 'Max Resolution' },
        ],
        channel: [
            { id: 'redirectToVideosTab',         label: 'Auto Videos Tab' },
        ],
    };

    const PAGE_LABELS = {
        home: 'Home',
        subs: 'Subscriptions',
        watch: 'Watch',
        channel: 'Channel',
    };

    const PAGE_MODAL_PAGE_MAP = {
        [PageTypes.HOME]: 'home',
        [PageTypes.SUBSCRIPTIONS]: 'subs',
        [PageTypes.WATCH]: 'watch',
        [PageTypes.CHANNEL]: 'channel',
    };

    let _pageModalOpen = false;
    let _pageModalEl = null;
    let _pageModalOverlay = null;

    function closePageModal() {
        if (!_pageModalOpen) return;
        _pageModalOpen = false;
        if (_pageModalEl) {
            _pageModalEl.classList.remove('ytkit-pm-visible');
            setTimeout(() => _pageModalEl?.remove(), 220);
            _pageModalEl = null;
        }
        if (_pageModalOverlay) {
            _pageModalOverlay.classList.remove('ytkit-pm-ov-visible');
            setTimeout(() => _pageModalOverlay?.remove(), 220);
            _pageModalOverlay = null;
        }
        document.querySelector('#ytkit-page-btn')?.classList.remove('active');
        document.querySelector('#ytkit-page-btn-watch')?.classList.remove('active');
    }

    function openPageModal() {
        if (_pageModalOpen) { closePageModal(); return; }

        const pt = getCurrentPage();
        const pageKey = PAGE_MODAL_PAGE_MAP[pt];
        const featureList = pageKey ? (PAGE_MODAL_CONFIG[pageKey] || []) : [];
        if (!featureList.length) return;

        _pageModalOpen = true;
        document.querySelector('#ytkit-page-btn')?.classList.add('active');
        document.querySelector('#ytkit-page-btn-watch')?.classList.add('active');

        // Overlay
        const ov = document.createElement('div');
        ov.className = 'ytkit-pm-overlay';
        ov.addEventListener('click', closePageModal);
        document.body.appendChild(ov);
        _pageModalOverlay = ov;
        requestAnimationFrame(() => ov.classList.add('ytkit-pm-ov-visible'));

        // Modal panel
        const modal = document.createElement('div');
        modal.id = 'ytkit-page-modal';
        modal.className = 'ytkit-pm';
        modal.addEventListener('click', e => e.stopPropagation());

        // Header
        const header = document.createElement('div');
        header.className = 'ytkit-pm-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'ytkit-pm-title-wrap';

        const pageBadge = document.createElement('span');
        pageBadge.className = 'ytkit-pm-badge';
        pageBadge.textContent = PAGE_LABELS[pageKey] || pageKey;

        const titleText = document.createElement('h3');
        titleText.className = 'ytkit-pm-title';
        titleText.textContent = 'Quick Settings';

        titleWrap.appendChild(pageBadge);
        titleWrap.appendChild(titleText);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ytkit-pm-close';
        closeBtn.title = 'Close';
        closeBtn.appendChild(ICONS.close());
        closeBtn.addEventListener('click', closePageModal);

        header.appendChild(titleWrap);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // Feature grid
        const grid = document.createElement('div');
        grid.className = 'ytkit-pm-grid';

        featureList.forEach(({ id: fid, label }) => {
            const feat = features.find(f => f.id === fid);
            if (!feat) return;

            const isOn = !!appState.settings[fid];
            const card = document.createElement('button');
            card.className = 'ytkit-pm-card' + (isOn ? ' on' : '');
            card.dataset.fid = fid;

            // Icon area
            const iconWrap = document.createElement('div');
            iconWrap.className = 'ytkit-pm-card-icon';
            const iconFn = ICONS[feat.icon] || ICONS[feat.group?.toLowerCase()] || ICONS.settings;
            iconWrap.appendChild(iconFn());

            // Text
            const textWrap = document.createElement('div');
            textWrap.className = 'ytkit-pm-card-text';

            const cardLabel = document.createElement('span');
            cardLabel.className = 'ytkit-pm-card-label';
            cardLabel.textContent = label || feat.name;

            const cardDesc = document.createElement('span');
            cardDesc.className = 'ytkit-pm-card-desc';
            // Keep description short
            const desc = feat.description || '';
            cardDesc.textContent = desc.length > 72 ? desc.slice(0, 70) + '…' : desc;

            textWrap.appendChild(cardLabel);
            textWrap.appendChild(cardDesc);

            // Toggle indicator
            const toggle = document.createElement('div');
            toggle.className = 'ytkit-pm-card-toggle';
            const toggleTrack = document.createElement('div');
            toggleTrack.className = 'ytkit-pm-toggle-track';
            const toggleThumb = document.createElement('div');
            toggleThumb.className = 'ytkit-pm-toggle-thumb';
            toggleTrack.appendChild(toggleThumb);
            toggle.appendChild(toggleTrack);

            card.appendChild(iconWrap);
            card.appendChild(textWrap);
            card.appendChild(toggle);

            card.addEventListener('click', () => {
                const newVal = !appState.settings[fid];
                appState.settings[fid] = newVal;
                settingsManager.save(appState.settings);
                try {
                    if (newVal) { feat.init?.(); feat._initialized = true; }
                    else { feat.destroy?.(); feat._initialized = false; }
                } catch(err) {
                    DebugManager.log('QuickSettings', `Toggle failed for "${fid}": ${err.message}`);
                }
                card.classList.toggle('on', newVal);
                // Update all matching dock pills if any remain
                document.querySelectorAll(`.ytkit-dock-pill[data-fid="${fid}"]`).forEach(p => p.classList.toggle('on', newVal));
            });

            grid.appendChild(card);
        });

        modal.appendChild(grid);

        // Footer: link to full settings
        const footer = document.createElement('div');
        footer.className = 'ytkit-pm-footer';
        const fullBtn = document.createElement('button');
        fullBtn.className = 'ytkit-pm-full-settings';
        fullBtn.textContent = 'Open Full Settings →';
        fullBtn.addEventListener('click', () => {
            closePageModal();
            document.body.classList.add('ytkit-panel-open');
        });
        footer.appendChild(fullBtn);
        modal.appendChild(footer);

        document.body.appendChild(modal);
        _pageModalEl = modal;
        requestAnimationFrame(() => modal.classList.add('ytkit-pm-visible'));

        // Close on navigation
        document.addEventListener('yt-navigate-start', closePageModal, { once: true });
    }

    function injectPageModalButton() {
        const handleDisplay = () => {
            const isWatch = window.location.pathname.startsWith('/watch');

            // Clean up wrong-context button
            if (isWatch) {
                document.getElementById('ytkit-page-btn')?.remove();
            } else {
                document.getElementById('ytkit-page-btn-watch')?.remove();
            }

            const btnId = isWatch ? 'ytkit-page-btn-watch' : 'ytkit-page-btn';
            if (document.getElementById(btnId)) return;

            const pt = getCurrentPage();
            const pageKey = PAGE_MODAL_PAGE_MAP[pt];
            if (!pageKey || !PAGE_MODAL_CONFIG[pageKey]?.length) return;

            const btn = document.createElement('button');
            btn.id = btnId;
            btn.className = 'ytkit-trigger-btn ytkit-page-trigger';
            btn.title = 'YTKit Page Settings';
            // Sliders icon
            const svg = createSVG('0 0 24 24', [
                { type: 'line', x1: 4, y1: 21, x2: 4, y2: 14 },
                { type: 'line', x1: 4, y1: 10, x2: 4, y2: 3 },
                { type: 'line', x1: 12, y1: 21, x2: 12, y2: 12 },
                { type: 'line', x1: 12, y1: 8, x2: 12, y2: 3 },
                { type: 'line', x1: 20, y1: 21, x2: 20, y2: 16 },
                { type: 'line', x1: 20, y1: 12, x2: 20, y2: 3 },
                { type: 'line', x1: 1, y1: 14, x2: 7, y2: 14 },
                { type: 'line', x1: 9, y1: 8, x2: 15, y2: 8 },
                { type: 'line', x1: 17, y1: 16, x2: 23, y2: 16 },
            ], { strokeWidth: '2', strokeLinecap: 'round' });
            btn.appendChild(svg);
            btn.addEventListener('click', openPageModal);

            if (isWatch) {
                waitForElement('#top-row #owner', (ownerDiv) => {
                    if (document.getElementById(btnId)) return;
                    // Place right after the gear button
                    const gear = document.getElementById('ytkit-watch-btn');
                    if (gear) gear.after(btn);
                    else ownerDiv.prepend(btn);
                });
            } else {
                waitForElement('ytd-masthead #end', (mastheadEnd) => {
                    if (document.getElementById(btnId)) return;
                    // Place right before the gear button
                    const gear = document.getElementById('ytkit-masthead-btn');
                    if (gear) mastheadEnd.insertBefore(btn, gear);
                    else mastheadEnd.prepend(btn);
                });
            }
        };

        addNavigateRule('_pageModalBtnRule', handleDisplay);

        // Close modal on click-away (Escape key)
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && _pageModalOpen) closePageModal(); });
    }

    GM_addStyle(`.ytkit-pm-overlay{position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,0);transition:background 0.2s ease;pointer-events:none;} .ytkit-pm-ov-visible{background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);pointer-events:auto;} .ytkit-pm{position:fixed;top:60px;right:16px;width:400px;max-height:calc(100vh - 80px);overflow-y:auto;z-index:99991;background:linear-gradient(145deg,rgba(18,18,28,0.98),rgba(12,12,20,0.98));border:1px solid rgba(255,255,255,0.08);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04) inset;font-family:"Roboto",Arial,sans-serif;color:var(--yt-spec-text-primary,#fff);opacity:0;transform:translateY(-8px) scale(0.98);transition:opacity 0.2s ease,transform 0.2s ease;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.1) transparent;} .ytkit-pm::-webkit-scrollbar{width:4px;} .ytkit-pm::-webkit-scrollbar-track{background:transparent;} .ytkit-pm::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px;} .ytkit-pm-visible{opacity:1;transform:translateY(0) scale(1);} .ytkit-pm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;border-bottom:1px solid rgba(255,255,255,0.06);} .ytkit-pm-title-wrap{display:flex;align-items:center;gap:10px;} .ytkit-pm-badge{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#3b82f6;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);border-radius:6px;padding:2px 8px;} .ytkit-pm-title{margin:0;font-size:15px;font-weight:600;color:rgba(255,255,255,0.9);} .ytkit-pm-close{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;flex-shrink:0;} .ytkit-pm-close:hover{background:rgba(255,255,255,0.12);color:#fff;} .ytkit-pm-close svg{width:14px;height:14px;} .ytkit-pm-grid{display:flex;flex-direction:column;gap:2px;padding:8px;} .ytkit-pm-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;border:none;background:transparent;cursor:pointer;text-align:left;transition:background 0.15s;width:100%;} .ytkit-pm-card:hover{background:rgba(255,255,255,0.05);} .ytkit-pm-card.on{background:rgba(59,130,246,0.08);} .ytkit-pm-card.on:hover{background:rgba(59,130,246,0.13);} .ytkit-pm-card-icon{width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.45);transition:all 0.15s;} .ytkit-pm-card.on .ytkit-pm-card-icon{background:rgba(59,130,246,0.18);color:#60a5fa;} .ytkit-pm-card-icon svg{width:16px;height:16px;} .ytkit-pm-card-text{flex:1;min-width:0;} .ytkit-pm-card-label{display:block;font-size:13px;font-weight:500;color:rgba(255,255,255,0.8);line-height:1.3;} .ytkit-pm-card.on .ytkit-pm-card-label{color:#e0eaff;} .ytkit-pm-card-desc{display:block;font-size:11px;color:rgba(255,255,255,0.35);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;} .ytkit-pm-card-toggle{flex-shrink:0;} .ytkit-pm-toggle-track{width:34px;height:18px;border-radius:9px;background:rgba(255,255,255,0.1);position:relative;transition:background 0.2s;} .ytkit-pm-card.on .ytkit-pm-toggle-track{background:#2563eb;} .ytkit-pm-toggle-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,0.5);transition:transform 0.2s,background 0.2s;} .ytkit-pm-card.on .ytkit-pm-toggle-thumb{transform:translateX(16px);background:#fff;} .ytkit-pm-footer{padding:10px 16px 14px;border-top:1px solid rgba(255,255,255,0.06);} .ytkit-pm-full-settings{width:100%;padding:9px 16px;border-radius:8px;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.55);font-size:12px;font-weight:500;cursor:pointer;transition:all 0.15s;letter-spacing:0.2px;} .ytkit-pm-full-settings:hover{background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.85);} .ytkit-page-trigger.active svg{color:#3b82f6 !important;transform:none !important;} .ytkit-page-trigger:hover svg{transform:none !important;}`);

    function buildPageDock() {
        // Dock replaced by page modal — no-op kept for call-site compatibility
    }

            buildSettingsPanel();
        injectSettingsButton();
        buildPageDock();
        injectPageModalButton();
        attachUIEventListeners();
        updateAllToggleStates();

        // ── Lifetime Ad Block Stats Flush ──

        // ── Safe Mode + Diagnostics ──
        const isSafeMode = new URLSearchParams(window.location.search).get('ytkit') === 'safe' ||
                           GM_getValue('ytkit_safe_mode', false);

        window.ytkit = {
            safe() { GM_setValue('ytkit_safe_mode', true); location.reload(); },
            unsafe() { GM_setValue('ytkit_safe_mode', false); location.reload(); },
            debug(on) {
                if (on === undefined) return DebugManager._enabled;
                on ? DebugManager.enable() : DebugManager.disable();
                console.log('[YTKit] Debug ' + (on ? 'enabled' : 'disabled'));
            },
            testOnly(id) {
                const s = { ...appState.settings };
                features.forEach(f => { if (!f._arrayKey) s[f.id] = false; });
                s[id] = true;
                settingsManager.save(s);
                GM_setValue('ytkit_safe_mode', false);
                location.reload();
            },
            disableAll() {
                const s = { ...appState.settings };
                features.forEach(f => { if (!f._arrayKey) s[f.id] = false; });
                settingsManager.save(s);
                location.reload();
            },
            list() {
                const enabled = [], disabled = [];
                features.forEach(f => {
                    if (f._arrayKey) return;
                    (appState.settings[f.id] ? enabled : disabled).push(f.id);
                });
                console.log(`%c[YTKit] ${enabled.length} enabled:`, 'color:#22c55e;font-weight:bold');
                enabled.forEach(id => console.log(`  ✓ ${id}`));
                console.log(`%c[YTKit] ${disabled.length} disabled:`, 'color:#ef4444;font-weight:bold');
                disabled.forEach(id => console.log(`  ✗ ${id}`));
                return { enabled, disabled };
            },
            settings: appState.settings,
            features,
            version: YTKIT_VERSION,
        };

        const _featureCrashCounts = StorageManager.get('ytkit_crash_counts', {});
        const MAX_FEATURE_CRASHES = 3;
        const _persistCrashCounts = () => StorageManager.set('ytkit_crash_counts', _featureCrashCounts);

        if (isSafeMode) {
            console.log('%c[YTKit] SAFE MODE — All features disabled. ytkit.unsafe() to exit.', 'color:#f97316;font-weight:bold;font-size:16px;');
            showToast('SAFE MODE — All features disabled. Console: ytkit.unsafe() to exit.', '#f97316', { duration: 10 });
        } else {
            // TIER 0: Critical — CSS-only, Theater Split.
            //         Must run synchronously before any page content paints.
            // TIER 1: Normal — all other non-watch-page-specific features.
            //         Run in rAF to avoid blocking first paint.
            // TIER 2: Watch-page-only — heavy features that aren't needed until
            //         the video is playing. Deferred 1500ms via requestIdleCallback.
            const CRITICAL_IDS = new Set([
                'uiStyleManager',
            ]);
            const LAZY_IDS = new Set([
                // Only defer watch-page-only features that are heavy or network-bound
            ]);

            const initFeature = (f) => {
                if (f._arrayKey) return;
                const isEnabled = (f.type === 'select' || f.type === 'color' || f.type === 'range')
                    ? true : appState.settings[f.id];
                if (!isEnabled) return;
                if (f.pages && !f.pages.includes(appState.currentPage)) return;
                if (f.dependsOn && !appState.settings[f.dependsOn]) return;
                if (f._initialized) return;
                // Conflict enforcement at init time — skip if a conflicting feature already initialized
                if (CONFLICT_MAP[f.id]) {
                    const activeConflicts = (CONFLICT_MAP[f.id].conflicts || []).filter(cid => {
                        const cf = features.find(ff => ff.id === cid);
                        return cf && cf._initialized;
                    });
                    if (activeConflicts.length > 0) {
                        DebugManager.log('Init', `Skipping "${f.id}" — conflicts with already-initialized: ${activeConflicts.join(', ')}`);
                        appState.settings[f.id] = false;
                        settingsManager.save(appState.settings);
                        return;
                    }
                }
                // Skip features that have crashed too many times
                if ((_featureCrashCounts[f.id] || 0) >= MAX_FEATURE_CRASHES) {
                    DebugManager.log('Init', `Skipping "${f.id}" — crashed ${MAX_FEATURE_CRASHES}+ times`);
                    return;
                }
                try { f.init?.(); f._initialized = true; if (_featureCrashCounts[f.id]) { delete _featureCrashCounts[f.id]; _persistCrashCounts(); } } catch(err) {
                    _featureCrashCounts[f.id] = (_featureCrashCounts[f.id] || 0) + 1;
                    _persistCrashCounts();
                    console.error(`[YTKit] Error initializing "${f.id}" (crash ${_featureCrashCounts[f.id]}/${MAX_FEATURE_CRASHES}):`, err);
                    if (_featureCrashCounts[f.id] >= MAX_FEATURE_CRASHES) {
                        console.warn(`[YTKit] Feature "${f.id}" auto-disabled after ${MAX_FEATURE_CRASHES} crashes`);
                    }
                }
            };

            // Topological sort: ensure parents initialize before children
            const topoSort = (featureList) => {
                const idMap = new Map(featureList.map(f => [f.id, f]));
                const sorted = [];
                const visited = new Set();
                const visit = (f) => {
                    if (visited.has(f.id)) return;
                    visited.add(f.id);
                    if (f.parentId && idMap.has(f.parentId)) {
                        visit(idMap.get(f.parentId));
                    }
                    if (f.dependsOn && idMap.has(f.dependsOn)) {
                        visit(idMap.get(f.dependsOn));
                    }
                    sorted.push(f);
                };
                featureList.forEach(f => visit(f));
                return sorted;
            };

            const critLog = [], normalLog = [], lazyLog = [];
            const normal = [], lazy = [];

            const sortedFeatures = topoSort(features);
            sortedFeatures.forEach(f => {
                if (CRITICAL_IDS.has(f.id)) { initFeature(f); critLog.push(f.id); }
                else if (LAZY_IDS.has(f.id)) lazy.push(f);
                else normal.push(f);
            });

            // Tier 1: after first paint
            requestAnimationFrame(() => {
                normal.forEach(f => { initFeature(f); if (f._initialized) normalLog.push(f.id); });
                console.log(`[YTKit] v${YTKIT_VERSION} | critical:${critLog.length} normal:${normalLog.length} (lazy pending)`);
            });

            // Tier 2: after page is interactive
            const lazyInit = () => {
                lazy.forEach(f => { initFeature(f); if (f._initialized) lazyLog.push(f.id); });
                if (lazyLog.length) DebugManager.log('Init', `Lazy loaded: ${lazyLog.join(', ')}`);
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(lazyInit, { timeout: 2000 });
            } else {
                setTimeout(lazyInit, 1500);
            }
        }

        // Show sub-features for enabled parents
        document.querySelectorAll('.ytkit-sub-features').forEach(container => {
            const parentId = container.dataset.parentId;
            if (appState.settings[parentId]) {
                container.style.display = '';
            }
        });

        // Button injection is handled by startButtonChecker() called from each button feature's init()

        const hasRun = settingsManager.getFirstRunStatus();
        if (!hasRun) {
            settingsManager.setFirstRunStatus(true);
        }

        // Track page changes for lazy loading (skip in safe mode)
        if (!isSafeMode && !window._ytkitNavListenerAdded) {
            window._ytkitNavListenerAdded = true;
            document.addEventListener('yt-navigate-finish', () => {
            const newPage = getCurrentPage();
            if (newPage !== appState.currentPage) {
                const oldPage = appState.currentPage;
                appState.currentPage = newPage;
                DebugManager.log('Navigation', `Page changed: ${oldPage} -> ${newPage}`);

                // Re-initialize features that are page-specific
                features.forEach(f => {
                    if (f._arrayKey) return;
                    const isEnabled = (f.type === 'select' || f.type === 'color' || f.type === 'range')
                        ? true
                        : appState.settings[f.id];

                    if (isEnabled && f.pages) {
                        const wasActive = f.pages.includes(oldPage);
                        const shouldBeActive = f.pages.includes(newPage);

                        if (!wasActive && shouldBeActive && !f._initialized) {
                            if ((_featureCrashCounts[f.id] || 0) >= MAX_FEATURE_CRASHES) return;
                            try { f.init?.(); f._initialized = true; if (_featureCrashCounts[f.id]) { delete _featureCrashCounts[f.id]; _persistCrashCounts(); } } catch(e) {
                                _featureCrashCounts[f.id] = (_featureCrashCounts[f.id] || 0) + 1;
                                _persistCrashCounts();
                                console.error(`[YTKit] Nav re-init error "${f.id}" (crash ${_featureCrashCounts[f.id]}/${MAX_FEATURE_CRASHES}):`, e);
                            }
                        } else if (wasActive && !shouldBeActive && f._initialized) {
                            try { f.destroy?.(); f._initialized = false; } catch(err) {
                                DebugManager.log('Navigation', `Destroy failed for "${f.id}": ${err.message}`);
                            }
                        }
                    }
                });
            }
        });
        } // end !isSafeMode

        console.log(`%c[YTKit] v${YTKIT_VERSION} Initialized${isSafeMode ? ' (SAFE MODE)' : ''}`, 'color: #3b82f6; font-weight: bold; font-size: 14px;');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main, { once: true });
    }
})();
