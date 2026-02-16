// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      25.0
// @description  Ultimate YouTube customization with ad blocking, VLC streaming, video/channel hiding, playback enhancements, sticky video, ChapterForge AI chapters, DeArrow clickbait removal, and more.
// @author       Matthew Parker
// @match        https://*.youtube.com/*
// @match        https://*.youtube-nocookie.com/*
// @match        https://youtu.be/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @icon         https://github.com/SysAdminDoc/YTKit/blob/main/assets/ytlogo.png?raw=true
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @grant        GM_notification
// @grant        GM_download
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @connect      sponsor.ajay.app
// @connect      dearrow-thumb.ajay.app
// @connect      raw.githubusercontent.com
// @connect      googlevideo.com
// @connect      gstatic.com
// @connect      cdn-lfs-us-1.hf.co
// @connect      cdn-lfs.hf.co
// @connect      huggingface.co
// @connect      cobalt-api.meowing.de
// @connect      cobalt.meowing.de
// @connect      meowing.de
// @connect      api.openai.com
// @connect      openrouter.ai
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @resource     betterDarkMode https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/Themes/youtube-dark-theme.css
// @resource     catppuccinMocha https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/Themes/youtube-catppuccin-theme.css
// @updateURL    https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @downloadURL  https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @run-at       document-start
// ==/UserScript==

// ══════════════════════════════════════════════════════════════════════════
//  AD BLOCKER BOOTSTRAP - Split Architecture
//  PHASE 1: Proxy engine injected into REAL page context via <script>
//           (bypasses Tampermonkey sandbox so YouTube sees the proxies)
//  PHASE 2: CSS / DOM observer / SSAP stay in sandbox (shared DOM access)
// ══════════════════════════════════════════════════════════════════════════
(function ytAdBlockBootstrap() {
    'use strict';

    const enabled = GM_getValue('ytab_enabled', true);
    const antiDetect = GM_getValue('ytab_antidetect', true);

    if (!enabled) {
        const rw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        rw.__ytab = { active: false, stats: { blocked: 0, pruned: 0, ssapSkipped: 0 } };
        return;
    }

    // ══════════════════════════════════════════════════════════════════
    //  PHASE 1: Page-context proxy engine
    //  This function is serialized and injected via <script> element
    //  so it runs on the REAL window, not Tampermonkey's sandbox.
    // ══════════════════════════════════════════════════════════════════
    function pageContextEngine(cfg, W) {
        // W = the real page window (unsafeWindow). ALL globals must use W.*
        // because this function's scope chain is still the Tampermonkey sandbox.
        if (W.__ytab_injected) return;
        W.__ytab_injected = true;

        const stats = { blocked: 0, pruned: 0, ssapSkipped: 0 };

        const PRUNE_KEYS = [
            'adPlacements', 'adSlots', 'playerAds',
            'playerResponse.adPlacements', 'playerResponse.adSlots', 'playerResponse.playerAds',
            'auxiliaryUi.messageRenderers.upsellDialogRenderer',
            'adBreakHeartbeatParams', 'playerResponse.adBreakHeartbeatParams',
            'responseContext.adSignalsInfo'
        ];
        const REPLACE_MAP = { adPlacements: 'no_ads', adSlots: 'no_ads', playerAds: 'no_ads', adBreakHeartbeatParams: 'no_ads' };
        const INTERCEPT_URLS = [
            '/youtubei/v1/player', '/youtubei/v1/get_watch',
            '/youtubei/v1/browse', '/youtubei/v1/search', '/youtubei/v1/next',
            '/watch?', '/playlist?list=', '/reel_watch_sequence'
        ];
        const AD_RENDERER_KEYS_ARR = [
            'adSlotRenderer', 'displayAdRenderer', 'promotedVideoRenderer',
            'compactPromotedVideoRenderer', 'promotedSparklesWebRenderer',
            'promotedSparklesTextSearchRenderer', 'searchPyvRenderer',
            'bannerPromoRenderer', 'statementBannerRenderer',
            'brandVideoSingletonRenderer', 'brandVideoShelfRenderer',
            'actionCompanionAdRenderer', 'inFeedAdLayoutRenderer',
            'adSlotAndLayoutRenderer', 'videoMastheadAdV3Renderer',
            'privetimePromoRenderer', 'movieOfferModuleRenderer',
            'mealbarPromoRenderer', 'backgroundPromoRenderer',
            'enforcementMessageViewModel'
        ];
        const AD_RENDERER_SET = {};
        for (let i = 0; i < AD_RENDERER_KEYS_ARR.length; i++) AD_RENDERER_SET[AD_RENDERER_KEYS_ARR[i]] = true;

        // ── Utilities ──
        function safeOverride(obj, prop, val) {
            try { obj[prop] = val; if (obj[prop] === val) return true; } catch(e) {}
            try { W.Object.defineProperty(obj, prop, { value: val, writable: true, configurable: true, enumerable: true }); return true; } catch(e) {}
            try { delete obj[prop]; W.Object.defineProperty(obj, prop, { value: val, writable: true, configurable: true, enumerable: true }); return true; } catch(e) {}
            return false;
        }
        function deleteNested(obj, path) {
            const keys = path.split('.');
            let cur = obj;
            for (let i = 0; i < keys.length - 1; i++) {
                if (cur == null || typeof cur !== 'object') return false;
                cur = cur[keys[i]];
            }
            if (cur != null && typeof cur === 'object') {
                const last = keys[keys.length - 1];
                if (last in cur) { delete cur[last]; return true; }
            }
            return false;
        }
        function matchesIntercept(url) {
            if (!url) return false;
            for (let i = 0; i < INTERCEPT_URLS.length; i++) { if (url.indexOf(INTERCEPT_URLS[i]) !== -1) return true; }
            return false;
        }
        function replaceAdKeys(text) {
            if (typeof text !== 'string') return text;
            let t = text;
            const keys = W.Object.keys(REPLACE_MAP);
            for (let i = 0; i < keys.length; i++) {
                t = t.split('"' + keys[i] + '"').join('"' + REPLACE_MAP[keys[i]] + '"');
            }
            return t;
        }

        // ── Deep Recursive Ad Pruner ──
        function deepPruneAds(obj, depth) {
            if (!obj || typeof obj !== 'object' || (depth || 0) > 12) return false;
            let pruned = false;
            const d = (depth || 0) + 1;
            if (W.Array.isArray(obj)) {
                for (let i = obj.length - 1; i >= 0; i--) {
                    const item = obj[i];
                    if (item && typeof item === 'object') {
                        let isAd = false;
                        const keys = W.Object.keys(item);
                        for (let j = 0; j < keys.length; j++) { if (AD_RENDERER_SET[keys[j]]) { isAd = true; break; } }
                        if (isAd) { obj.splice(i, 1); pruned = true; continue; }
                        const content = item.content || item.renderer;
                        if (content && typeof content === 'object') {
                            const cKeys = W.Object.keys(content);
                            for (let k = 0; k < cKeys.length; k++) { if (AD_RENDERER_SET[cKeys[k]]) { isAd = true; break; } }
                            if (isAd) { obj.splice(i, 1); pruned = true; continue; }
                        }
                        if (item.richItemRenderer && item.richItemRenderer.content) {
                            const rc = item.richItemRenderer.content;
                            if (typeof rc === 'object') {
                                const rKeys = W.Object.keys(rc);
                                for (let r = 0; r < rKeys.length; r++) { if (AD_RENDERER_SET[rKeys[r]]) { isAd = true; break; } }
                                if (isAd) { obj.splice(i, 1); pruned = true; continue; }
                            }
                        }
                        pruned = deepPruneAds(item, d) || pruned;
                    }
                }
            } else {
                const oKeys = W.Object.keys(obj);
                for (let m = 0; m < oKeys.length; m++) {
                    const key = oKeys[m];
                    if (AD_RENDERER_SET[key]) { delete obj[key]; pruned = true; continue; }
                    const val = obj[key];
                    if (val && typeof val === 'object') { pruned = deepPruneAds(val, d) || pruned; }
                }
            }
            return pruned;
        }

        function pruneObject(obj) {
            if (!obj || typeof obj !== 'object') return false;
            let pruned = false;
            for (let i = 0; i < PRUNE_KEYS.length; i++) { if (deleteNested(obj, PRUNE_KEYS[i])) pruned = true; }
            if (obj.entries && W.Array.isArray(obj.entries)) {
                const before = obj.entries.length;
                obj.entries = obj.entries.filter(function(e) {
                    return !(e && e.command && e.command.reelWatchEndpoint &&
                             e.command.reelWatchEndpoint.adClientParams &&
                             e.command.reelWatchEndpoint.adClientParams.isAd);
                });
                if (obj.entries.length < before) pruned = true;
            }
            pruned = deepPruneAds(obj) || pruned;
            if (pruned) stats.pruned++;
            return pruned;
        }

        // ═══ 1. JSON.parse Proxy ═══
        const origParse = W.JSON.parse;
        safeOverride(W.JSON, 'parse', new W.Proxy(origParse, {
            apply: function(target, thisArg, args) {
                const result = W.Reflect.apply(target, thisArg, args);
                try { if (result && typeof result === 'object' && pruneObject(result)) stats.blocked++; } catch(e) {}
                return result;
            }
        }));

        // ═══ 2. fetch() Proxy ═══
        const origFetch = W.fetch;
        safeOverride(W, 'fetch', new W.Proxy(origFetch, {
            apply: function(target, thisArg, args) {
                const req = args[0];
                const url = typeof req === 'string' ? req : (req instanceof W.Request ? req.url : '');
                try {
                    if (url.indexOf('/youtubei/v1/player') !== -1 || url.indexOf('/youtubei/v1/get_watch') !== -1) {
                        const init = args[1];
                        if (init && init.body && typeof init.body === 'string') {
                            const b = origParse(init.body);
                            if (b && b.context && b.context.client && b.context.client.clientName === 'WEB') {
                                b.context.client.clientScreen = 'CHANNEL';
                                args[1] = W.Object.assign({}, init, { body: W.JSON.stringify(b) });
                            }
                        }
                    }
                } catch(e) {}
                if (!matchesIntercept(url)) return W.Reflect.apply(target, thisArg, args);
                return W.Reflect.apply(target, thisArg, args).then(function(resp) {
                    if (!resp || !resp.ok) return resp;
                    return resp.clone().text().then(function(text) {
                        try {
                            const mod = replaceAdKeys(text);
                            const obj = origParse(mod);
                            pruneObject(obj);
                            stats.blocked++;
                            return new W.Response(W.JSON.stringify(obj), { status: resp.status, statusText: resp.statusText, headers: resp.headers });
                        } catch(e) { return resp; }
                    })['catch'](function() { return resp; });
                });
            }
        }));

        // ═══ 3. XMLHttpRequest Proxy ═══
        const origXHROpen = W.XMLHttpRequest.prototype.open;
        const origXHRSend = W.XMLHttpRequest.prototype.send;
        safeOverride(W.XMLHttpRequest.prototype, 'open', function() {
            this._ytab_url = arguments[1];
            this._ytab_modify = (arguments[1] && (arguments[1].indexOf('/youtubei/v1/player') !== -1 || arguments[1].indexOf('/youtubei/v1/get_watch') !== -1));
            return origXHROpen.apply(this, arguments);
        });
        safeOverride(W.XMLHttpRequest.prototype, 'send', function(body) {
            if (this._ytab_modify && body && typeof body === 'string') {
                try {
                    const b = origParse(body);
                    if (b && b.context && b.context.client && b.context.client.clientName === 'WEB') {
                        b.context.client.clientScreen = 'CHANNEL';
                        body = W.JSON.stringify(b);
                    }
                } catch(e) {}
            }
            if (!matchesIntercept(this._ytab_url)) return origXHRSend.call(this, body);
            const xhr = this;
            xhr.addEventListener('readystatechange', function() {
                if (xhr.readyState !== 4) return;
                try {
                    const text = xhr.responseText;
                    if (!text) return;
                    const obj = origParse(replaceAdKeys(text));
                    pruneObject(obj);
                    const newText = W.JSON.stringify(obj);
                    W.Object.defineProperty(xhr, 'responseText', { value: newText, configurable: true });
                    W.Object.defineProperty(xhr, 'response', { value: newText, configurable: true });
                    stats.blocked++;
                } catch(e) {}
            });
            return origXHRSend.call(this, body);
        });

        // ═══ 4. DOM Bypass Prevention ═══
        const origAppendChild = W.Node.prototype.appendChild;
        safeOverride(W.Node.prototype, 'appendChild', new W.Proxy(origAppendChild, {
            apply: function(target, thisArg, args) {
                const node = args[0];
                try {
                    if (node instanceof W.HTMLIFrameElement && node.src === 'about:blank') {
                        const res = W.Reflect.apply(target, thisArg, args);
                        if (node.contentWindow) { node.contentWindow.fetch = W.fetch; node.contentWindow.JSON.parse = W.JSON.parse; }
                        return res;
                    }
                    if (node instanceof W.HTMLScriptElement) {
                        const t = (node.textContent || node.text || '');
                        if (t.indexOf('window,"fetch"') !== -1 || t.indexOf("window,'fetch'") !== -1) {
                            // Block by removing src/content and making it a no-op (avoids Trusted Types)
                            node.type = 'application/json';
                        }
                    }
                } catch(e) {}
                return W.Reflect.apply(target, thisArg, args);
            }
        }));

        // ═══ 5. Timer Neutralization ═══
        const origSetTimeout = W.setTimeout;
        safeOverride(W, 'setTimeout', new W.Proxy(origSetTimeout, {
            apply: function(target, thisArg, args) {
                const fn = args[0], delay = args[1];
                if (typeof fn === 'function' && delay >= 16000 && delay <= 18000) {
                    try { if (fn.toString().indexOf('[native code]') !== -1 || fn.toString().length < 50) args[1] = 1; } catch(e) {}
                }
                return W.Reflect.apply(target, thisArg, args);
            }
        }));

        // ═══ 6. Promise.then Anti-Detection ═══
        if (cfg.antiDetect) {
            const origThen = W.Promise.prototype.then;
            safeOverride(W.Promise.prototype, 'then', new W.Proxy(origThen, {
                apply: function(target, thisArg, args) {
                    if (typeof args[0] === 'function') {
                        try { if (args[0].toString().indexOf('onAbnormalityDetected') !== -1) { args[0] = function(){}; stats.blocked++; } } catch(e) {}
                    }
                    return W.Reflect.apply(target, thisArg, args);
                }
            }));
        }

        // ═══ 7. Property Traps ═══
        const SET_UNDEFINED = [
            'ytInitialPlayerResponse.playerAds', 'ytInitialPlayerResponse.adPlacements',
            'ytInitialPlayerResponse.adSlots', 'ytInitialPlayerResponse.adBreakHeartbeatParams',
            'ytInitialPlayerResponse.auxiliaryUi.messageRenderers.upsellDialogRenderer',
            'playerResponse.adPlacements'
        ];
        for (let si = 0; si < SET_UNDEFINED.length; si++) {
            (function(path) {
                try {
                    const parts = path.split('.');
                    const rootName = parts[0];
                    let _val = W[rootName];
                    W.Object.defineProperty(W, rootName, {
                        get: function() { return _val; },
                        set: function(newVal) {
                            if (newVal && typeof newVal === 'object') {
                                const sub = parts.slice(1);
                                let t = newVal;
                                for (let j = 0; j < sub.length - 1; j++) {
                                    if (t && typeof t === 'object' && sub[j] in t) t = t[sub[j]]; else { t = null; break; }
                                }
                                if (t && typeof t === 'object') {
                                    const last = sub[sub.length - 1];
                                    if (last in t) { delete t[last]; stats.pruned++; }
                                }
                            }
                            _val = newVal;
                        },
                        configurable: true, enumerable: true
                    });
                } catch(e) {}
            })(SET_UNDEFINED[si]);
        }

        // ═══ 8. Video Ad Neutralizer (runs in page context for player API access) ═══
        // Strategy: Click skip buttons only. No playbackRate/mute manipulation.
        // Uses MutationObserver on player + low-frequency poll as fallback.
        var adNeutTimer = null;
        var adObserver = null;

        function trySkipAd() {
            try {
                // Click skip buttons
                var skipSelectors = [
                    '.ytp-ad-skip-button',
                    '.ytp-ad-skip-button-modern',
                    '.ytp-skip-ad-button',
                    'button.ytp-ad-skip-button',
                    '.ytp-ad-skip-button-slot button',
                    '[id^="skip-button"]',
                    '.ytp-ad-skip-button-container button',
                    'yt-button-shape.ytp-ad-skip-button-modern button',
                ];
                for (var s = 0; s < skipSelectors.length; s++) {
                    var btns = W.document.querySelectorAll(skipSelectors[s]);
                    for (var b = 0; b < btns.length; b++) {
                        try { btns[b].click(); stats.blocked++; } catch(e) {}
                    }
                }

                // Close overlay ads
                var overlays = W.document.querySelectorAll(
                    '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container, .ytp-ad-overlay-close-button'
                );
                for (var oc = 0; oc < overlays.length; oc++) {
                    try { overlays[oc].click(); } catch(e) {}
                }

                // Try player API skip methods
                var player = W.document.getElementById('movie_player');
                if (player) {
                    if (player.skipAd) try { player.skipAd(); } catch(e) {}
                    if (player.cancelPlayback) try { player.cancelPlayback(); } catch(e) {}
                }
            } catch(e) {}
        }

        function startVideoAdNeutralizer() {
            // MutationObserver: watch for .ad-showing class on player
            function setupObserver() {
                var player = W.document.getElementById('movie_player');
                if (!player) return false;
                if (adObserver) adObserver.disconnect();
                adObserver = new W.MutationObserver(function(mutations) {
                    for (var i = 0; i < mutations.length; i++) {
                        if (mutations[i].attributeName === 'class') {
                            var el = mutations[i].target;
                            if (el.classList.contains('ad-showing')) {
                                stats.ssapSkipped++;
                                // Immediate skip attempt + retries
                                trySkipAd();
                                W.setTimeout(trySkipAd, 500);
                                W.setTimeout(trySkipAd, 1500);
                                W.setTimeout(trySkipAd, 3000);
                                W.setTimeout(trySkipAd, 5500);
                            }
                        }
                    }
                });
                adObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
                // If already showing an ad right now
                if (player.classList.contains('ad-showing')) trySkipAd();
                return true;
            }

            // Fallback poll: set up observer when player appears, click skip if ad detected
            if (adNeutTimer) return;
            var observerReady = setupObserver();
            adNeutTimer = W.setInterval(function() {
                if (!observerReady) observerReady = setupObserver();
                // Light check - only look for skip buttons, no video element manipulation
                var player = W.document.getElementById('movie_player');
                if (player && player.classList.contains('ad-showing')) {
                    trySkipAd();
                }
            }, 1000);
        }
        function stopVideoAdNeutralizer() {
            if (adNeutTimer) { W.clearInterval(adNeutTimer); adNeutTimer = null; }
            if (adObserver) { adObserver.disconnect(); adObserver = null; }
        }

        // Start when DOM is ready
        if (W.document.readyState === 'loading') {
            W.document.addEventListener('DOMContentLoaded', startVideoAdNeutralizer);
        } else {
            startVideoAdNeutralizer();
        }

        // ═══ Expose API on the real window ═══
        W.__ytab = {
            active: true, stats: stats,
            startVideoAdNeutralizer: startVideoAdNeutralizer,
            stopVideoAdNeutralizer: stopVideoAdNeutralizer,
            parseFilterList: function(text) {
                const selectors = [];
                const lines = text.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const t = lines[i].trim();
                    if (!t || t.charAt(0) === '!' || t.indexOf('@@') === 0 || t.indexOf('#@#') !== -1 || t.indexOf('||') === 0) continue;
                    const m = t.match(/^(?:[a-z][a-z0-9.*,-]*)?##([^+^].+)$/);
                    if (m && m[1].indexOf(':style(') === -1 && m[1].indexOf(':remove-attr(') === -1) selectors.push(m[1]);
                }
                const unique = [], seen = {};
                for (let j = 0; j < selectors.length; j++) { if (!seen[selectors[j]]) { seen[selectors[j]] = true; unique.push(selectors[j]); } }
                return unique;
            }
        };
    }

    // Install proxy engine on the REAL page window.
    // unsafeWindow is Tampermonkey's bridge to the actual page context.
    // This avoids Trusted Types CSP issues entirely (no script injection needed).
    const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    pageContextEngine.call(pageWindow, { antiDetect: antiDetect }, pageWindow);

    // ══════════════════════════════════════════════════════════════════
    //  PHASE 2: CSS / DOM Observer / SSAP — stays in sandbox
    //  (operates on shared DOM, needs GM_* for settings)
    // ══════════════════════════════════════════════════════════════════
    const realWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ── Cosmetic CSS Injection ──
    const COSMETIC_SELECTORS = [
        // ═══ Masthead / Top-Level Ad Containers ═══
        '#masthead-ad',
        '#masthead-ad.ytd-rich-grid-renderer',
        '#promotion-shelf',
        '#shopping-timely-shelf',
        '#player-ads',
        '#merch-shelf',
        '#panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        '[target-id="engagement-panel-ads"]',

        // ═══ Player Ad UI Elements ═══
        '.video-ads',
        '.ytp-ad-module',
        '.ytp-ad-overlay-slot',
        '.ytp-ad-overlay-container',
        '.ytp-ad-overlay-image',
        '.ytp-ad-text-overlay',
        '.ytp-ad-progress',
        '.ytp-ad-progress-list',
        '.ytp-ad-player-overlay',
        '.ytp-ad-player-overlay-layout',
        '.ytp-ad-image-overlay',
        '.ytp-ad-action-interstitial',
        '.ytp-ad-skip-button-container',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-slot',
        '.ytp-ad-preview-container',
        '.ytp-ad-message-container',
        '.ytp-ad-persistent-progress-bar-container',
        '.ytp-suggested-action',
        '.ytp-suggested-action-badge',
        '.ytp-visit-advertiser-link',

        // ═══ General Ad Classes ═══
        '.masthead-ad-control',
        '.ad-div',
        '.pyv-afc-ads-container',
        '.ad-container',
        '.ad-showing > .ad-interrupting',
        '.ytd-ad-slot-renderer',
        '.ytd-in-feed-ad-layout-renderer',
        '.ytd-promoted-video-renderer',
        '.ytd-search-pyv-renderer',
        '.ytd-compact-promoted-video-renderer',
        'div.ytd-ad-slot-renderer',
        'div.ytd-in-feed-ad-layout-renderer',

        // ═══ Ad Renderer Elements ═══
        'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-display-ad-renderer',
        'ytd-promoted-video-renderer',
        'ytd-compact-promoted-video-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-promoted-sparkles-text-search-renderer',
        'ytd-video-masthead-ad-advertiser-info-renderer',
        'ytd-video-masthead-ad-v3-renderer',
        'ytd-primetime-promo-renderer',
        'ytd-search-pyv-renderer',
        'ytd-banner-promo-renderer',
        'ytd-banner-promo-renderer-background',
        'ytd-action-companion-ad-renderer',
        'ytd-companion-slot-renderer',
        'ytd-player-legacy-desktop-watch-ads-renderer',
        'ytd-brand-video-singleton-renderer',
        'ytd-brand-video-shelf-renderer',
        'ytd-statement-banner-renderer',
        'ytd-mealbar-promo-renderer',
        'ytd-background-promo-renderer',
        'ytd-movie-offer-module-renderer',
        'ytm-promoted-sparkles-web-renderer',
        'ytm-companion-ad-renderer',
        'ad-slot-renderer',

        // ═══ Attribute-Based Selectors ═══
        '[layout*="display-ad-"]',
        '[layout="display-ad-layout-top-landscape-image"]',
        '[layout="display-ad-layout-top-portrait-image"]',
        '[layout="display-ad-layout-bottom-landscape-image"]',

        // ═══ Feed / Home — Parent Wrappers ═══
        'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
        'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
        'ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)',
        'ytd-rich-item-renderer:has(ytd-display-ad-renderer)',
        'ytd-rich-item-renderer:has(ytd-promoted-video-renderer)',
        'ytd-rich-item-renderer:has([layout*="display-ad-"])',
        'ytd-rich-item-renderer:has(> .ytd-rich-item-renderer > ytd-ad-slot-renderer)',
        'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)',
        'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
        'ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)',

        // ═══ Grid / Browse ═══
        '.grid.ytd-browse > #primary > .style-scope > .ytd-rich-grid-renderer > .ytd-rich-grid-renderer > .ytd-ad-slot-renderer',
        '.ytd-rich-item-renderer.style-scope > .ytd-rich-item-renderer > .ytd-ad-slot-renderer.style-scope',

        // ═══ Search Results ═══
        'ytd-item-section-renderer > .ytd-item-section-renderer > ytd-ad-slot-renderer.style-scope',
        '.ytd-section-list-renderer > .ytd-item-section-renderer > ytd-search-pyv-renderer.ytd-item-section-renderer',
        'ytd-search-pyv-renderer.ytd-item-section-renderer',

        // ═══ Watch Page / Sidebar ═══
        '.ytd-watch-flexy > .ytd-watch-next-secondary-results-renderer > ytd-ad-slot-renderer',
        '.ytd-watch-flexy > .ytd-watch-next-secondary-results-renderer > ytd-ad-slot-renderer.ytd-watch-next-secondary-results-renderer',

        // ═══ Merch / Shopping ═══
        'ytd-merch-shelf-renderer',
        '#description-inner > ytd-merch-shelf-renderer',
        '#description-inner > ytd-merch-shelf-renderer > #main.ytd-merch-shelf-renderer',
        '.ytd-watch-flexy > ytd-merch-shelf-renderer',
        '.ytd-watch-flexy > ytd-merch-shelf-renderer > #main.ytd-merch-shelf-renderer',

        // ═══ Shorts ═══
        '#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)',
        '.ytReelMetapanelViewModelHost > .ytReelMetapanelViewModelMetapanelItem > .ytShortsSuggestedActionViewModelStaticHost',

        // ═══ Mobile ═══
        'lazy-list > ad-slot-renderer',
        'ytm-rich-item-renderer > ad-slot-renderer',
        'ytm-companion-slot[data-content-type] > ytm-companion-ad-renderer',

        // ═══ Premium Upsell / Nags ═══
        'ytd-popup-container > .ytd-popup-container > #contentWrapper > .ytd-popup-container[position-type="OPEN_POPUP_POSITION_BOTTOMLEFT"]',
        '#mealbar\\:3 > ytm-mealbar.mealbar-promo-renderer',
        'yt-mealbar-promo-renderer',
        'ytmusic-mealbar-promo-renderer',
        'ytd-enforcement-message-view-model',

        // ═══ Misc / Catch-All ═══
        'tp-yt-paper-dialog:has(> ytd-popup-container)',
        '#feed-pyv-container',
        '#feedmodule-PRO',
        '#homepage-chrome-side-promo',
        '#watch-channel-brand-div',
        '#watch-buy-urls',
        '#watch-branded-actions',
        'ytd-movie-renderer',
        '.sparkles-light-cta',
        '.badge-style-type-ad',
        '.GoogleActiveViewElement',
        '.ad-showing .ytp-ad-player-overlay-layout',

        // ═══ Video Ad Speed-Skip Visual Suppression ═══
        '.ad-showing .video-ads',
        '.ad-showing .ytp-ad-module',
        '.ad-showing .ytp-ad-image-overlay',
        '.ad-showing .ytp-ad-text-overlay',
        '.ad-showing .ytp-ad-overlay-slot',
        '.ad-showing .ytp-ad-skip-button-container',
        '.ad-showing .ytp-ad-preview-container',
        '.ad-showing .ytp-ad-message-container',
        '.ad-showing .ytp-ad-player-overlay-instream-info',
        '.ad-showing .ytp-ad-persistent-progress-bar-container',
    ];

    const HARDCODED_CSS = COSMETIC_SELECTORS.join(',\n');

    let cosmeticEl = null;
    function updateCSS(extraSelectors) {
        const allCSS = HARDCODED_CSS + (extraSelectors ? ',\n' + extraSelectors : '');
        const css = allCSS + ' { display: none !important; visibility: hidden !important; height: 0 !important; max-height: 0 !important; overflow: hidden !important; padding: 0 !important; margin: 0 !important; }';
        if (cosmeticEl && cosmeticEl.parentNode) {
            cosmeticEl.textContent = css;
        } else {
            cosmeticEl = document.createElement('style');
            cosmeticEl.id = 'ytab-cosmetic';
            cosmeticEl.textContent = css;
            (document.head || document.documentElement).appendChild(cosmeticEl);
        }
    }
    const cachedSelectors = GM_getValue('ytab_cached_selectors', '');
    const customFilters = GM_getValue('ytab_custom_filters', '');
    const combined = [cachedSelectors, customFilters].filter(Boolean).join(',\n');
    updateCSS(combined);

    // Fix: YouTube's sidebar drawer scrim (.opened) blocks all page interaction
    const _openedFix = document.createElement('style');
    _openedFix.id = 'ytkit-opened-fix';
    _openedFix.textContent = '.opened { display: none !important; }';
    (document.head || document.documentElement).appendChild(_openedFix);

    // Re-inject protection
    const _ensureCSS = () => {
        if (!cosmeticEl || !cosmeticEl.parentNode) {
            cosmeticEl = null;
            const c = [GM_getValue('ytab_cached_selectors', ''), GM_getValue('ytab_custom_filters', '')].filter(Boolean).join(',\n');
            updateCSS(c);
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _ensureCSS);
    const _cssObserver = new MutationObserver(_ensureCSS);
    const _startCssObs = () => { if (document.head) _cssObserver.observe(document.head, { childList: true }); };
    if (document.head) _startCssObs(); else document.addEventListener('DOMContentLoaded', _startCssObs);

    // ── DOM Mutation Observer — Active Ad Element Removal ──
    const AD_REMOVAL_TAGS = new Set([
        'YTD-AD-SLOT-RENDERER', 'YTD-IN-FEED-AD-LAYOUT-RENDERER', 'YTD-DISPLAY-AD-RENDERER',
        'YTD-PROMOTED-VIDEO-RENDERER', 'YTD-COMPACT-PROMOTED-VIDEO-RENDERER',
        'YTD-PROMOTED-SPARKLES-WEB-RENDERER', 'YTD-PROMOTED-SPARKLES-TEXT-SEARCH-RENDERER',
        'YTD-BANNER-PROMO-RENDERER', 'YTD-STATEMENT-BANNER-RENDERER',
        'YTD-VIDEO-MASTHEAD-AD-V3-RENDERER', 'YTD-VIDEO-MASTHEAD-AD-ADVERTISER-INFO-RENDERER',
        'YTD-PRIMETIME-PROMO-RENDERER', 'YTD-BRAND-VIDEO-SINGLETON-RENDERER',
        'YTD-BRAND-VIDEO-SHELF-RENDERER', 'YTD-ACTION-COMPANION-AD-RENDERER',
        'YTD-PLAYER-LEGACY-DESKTOP-WATCH-ADS-RENDERER', 'YTD-SEARCH-PYV-RENDERER',
        'YTD-MEALBAR-PROMO-RENDERER', 'YTD-MOVIE-OFFER-MODULE-RENDERER',
        'YTD-ENFORCEMENT-MESSAGE-VIEW-MODEL', 'AD-SLOT-RENDERER',
        'YTM-PROMOTED-SPARKLES-WEB-RENDERER', 'YTM-COMPANION-AD-RENDERER',
    ]);
    const AD_PARENT_CHECK = new Set([
        'YTD-AD-SLOT-RENDERER', 'YTD-IN-FEED-AD-LAYOUT-RENDERER',
        'YTD-DISPLAY-AD-RENDERER', 'YTD-PROMOTED-VIDEO-RENDERER',
    ]);

    function nukeAdNode(node) {
        if (!node || !node.parentElement) return;
        const parent = node.closest('ytd-rich-item-renderer, ytd-rich-section-renderer');
        const st = realWindow.__ytab && realWindow.__ytab.stats;
        if (parent && AD_PARENT_CHECK.has(node.tagName)) { parent.remove(); if (st) st.blocked++; }
        else { node.remove(); if (st) st.blocked++; }
    }
    function scanForAds(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        for (const tag of AD_REMOVAL_TAGS) { for (const el of root.querySelectorAll(tag.toLowerCase())) nukeAdNode(el); }
        for (const el of root.querySelectorAll('[layout*="display-ad-"]')) nukeAdNode(el);
    }
    function startDOMCleaner() {
        scanForAds(document);
        const obs = new MutationObserver(mutations => {
            for (const m of mutations) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (AD_REMOVAL_TAGS.has(n.tagName)) { nukeAdNode(n); continue; }
                    if (n.querySelector) scanForAds(n);
                }
            }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDOMCleaner);
    else startDOMCleaner();

    // ── SSAP / Video Ad Control (delegates to page-context engine) ──
    function startSSAP() {
        const api = realWindow.__ytab;
        if (api && api.startVideoAdNeutralizer) api.startVideoAdNeutralizer();
    }
    function stopSSAP() {
        const api = realWindow.__ytab;
        if (api && api.stopVideoAdNeutralizer) api.stopVideoAdNeutralizer();
    }

    // ── Extend real window's __ytab with sandbox-side functions ──
    const _patchAPI = () => {
        const api = realWindow.__ytab;
        if (!api) return;
        api.updateCSS = updateCSS;
        api.startSSAP = startSSAP;
        api.stopSSAP = stopSSAP;
    };
    try { _patchAPI(); } catch(e) {}
    setTimeout(() => { try { _patchAPI(); } catch(e) {} }, 0);
})();

// ══════════════════════════════════════════════════════════════════════════
//  MAIN YTKIT (deferred to DOMContentLoaded via bootstrap at bottom)
// ══════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Bridge to real page window (needed because __ytab lives in page context, not sandbox)
    const _rw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0A: CORE UTILITIES & UNIFIED STORAGE
    // ══════════════════════════════════════════════════════════════════════════

    // Settings version for migrations
    const SETTINGS_VERSION = 4;

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
        if (path.startsWith('/feed/library') || path.startsWith('/playlist')) return PageTypes.LIBRARY;
        if (path.startsWith('/@') || path.startsWith('/channel') || path.startsWith('/c/') || path.startsWith('/user/')) return PageTypes.CHANNEL;
        return PageTypes.OTHER;
    }

    // ── Timing Constants ──
    const TIMING = {
        NAV_DEBOUNCE: 150,        // Navigation detection debounce (ms)
        MUTATION_THROTTLE: 500,   // Mutation observer throttle (ms)
        BUTTON_DEBOUNCE: 300,     // Button checker mutation debounce (ms)
        SAVE_DEBOUNCE: 500,       // Settings save debounce (ms)
        NAV_SETTLE: 1000,         // Time for YouTube SPA to settle after nav (ms)
        ELEMENT_TIMEOUT: 10000,   // waitForElement timeout (ms)
        LABEL_MAX_ATTEMPTS: 20,   // SponsorBlock label retry limit
    };

    // ══════════════════════════════════════════════════════════════════════════
    //  Trusted Types Safe HTML Helper
    // ══════════════════════════════════════════════════════════════════════════
    // YouTube enforces Trusted Types which blocks direct innerHTML assignments
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
        _cache: {},
        _dirty: new Set(),
        _saveTimeout: null,

        get(key, defaultVal = null) {
            if (this._cache.hasOwnProperty(key)) {
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
            this._dirty.clear();
            for (const key of toSave) {
                try {
                    GM_setValue(key, this._cache[key]);
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
        }
    };

    // ══════════════════════════════════════════════════════════════════════════
    //  TRANSCRIPT SERVICE - Multi-Method Extraction with Failover
    // ══════════════════════════════════════════════════════════════════════════
    const TranscriptService = {
        config: {
            preferredLanguages: ['en', 'en-US', 'en-GB'],
            preferManualCaptions: true,
            includeTimestamps: true,
            debug: false
        },

        // Main entry point - downloads transcript with automatic failover
        async downloadTranscript(options = {}) {
            const videoId = new URLSearchParams(window.location.search).get('v');
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
                    segments.push({
                        startMs: event.tStartMs || 0,
                        endMs: (event.tStartMs || 0) + (event.dDurationMs || 0),
                        text: text
                    });
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

        _getInnertubeApiKey() {
            const match = document.body?.innerHTML?.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
            return match ? match[1] : null;
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
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        _log(...args) {
            if (this.config.debug) {
                console.log('[YTKit TranscriptService]', ...args);
            }
        }
    };

    // Settings Migration System
    const SettingsMigration = {
        migrations: {
            // Migration from version 1 to 2
            1: (settings) => {
                // Rename old setting keys if needed
                if (settings.hideYouTubeShorts !== undefined) {
                    settings.removeAllShorts = settings.hideYouTubeShorts;
                    delete settings.hideYouTubeShorts;
                }
                return settings;
            },
            // Migration from version 2 to 3
            2: (settings) => {
                return settings;
            },
            // Migration from version 3 to 4: Ollama + captions-first defaults
            3: (settings) => {
                // Update Vibe endpoint from old default to WhisperServer port
                if (!settings.cfVibeEndpoint || settings.cfVibeEndpoint === 'http://localhost:3022') {
                    settings.cfVibeEndpoint = 'http://localhost:8178';
                }
                // Captions-first transcript (instant, free, reliable) — WhisperServer is fallback only
                if (!settings.cfTranscriptMethod || settings.cfTranscriptMethod === 'vibe') settings.cfTranscriptMethod = 'auto';
                // Ollama for real AI chapters instead of basic NLP heuristic
                if (!settings.cfLlmProvider || settings.cfLlmProvider === 'builtin') settings.cfLlmProvider = 'ollama';
                // Enable ChapterForge + auto mode
                if (settings.chapterForge === false || settings.chapterForge === undefined) settings.chapterForge = true;
                if (settings.cfMode === 'manual' || !settings.cfMode) settings.cfMode = 'auto';
                // Enable filler + pause skipping
                if (!settings.cfAutoSkipMode || settings.cfAutoSkipMode === 'off') settings.cfAutoSkipMode = 'normal';
                return settings;
            }
        },

        migrate(settings) {
            let currentVersion = settings._version || 1;
            let migrated = { ...settings };

            while (currentVersion < SETTINGS_VERSION) {
                const migrationFn = this.migrations[currentVersion];
                if (migrationFn) {
                    try {
                        migrated = migrationFn(migrated);
                        console.log(`[YTKit] Migrated settings from v${currentVersion} to v${currentVersion + 1}`);
                    } catch (e) {
                        console.error(`[YTKit] Migration ${currentVersion} failed:`, e);
                    }
                }
                currentVersion++;
            }

            migrated._version = SETTINGS_VERSION;
            return migrated;
        }
    };

    // Undo System for Video Hiding
    const UndoManager = {
        _stack: [],
        _maxItems: 10,

        push(action) {
            this._stack.push({
                ...action,
                timestamp: Date.now()
            });
            if (this._stack.length > this._maxItems) {
                this._stack.shift();
            }
        },

        pop() {
            return this._stack.pop();
        },

        peek() {
            return this._stack[this._stack.length - 1];
        },

        canUndo() {
            return this._stack.length > 0;
        },

        clear() {
            this._stack = [];
        }
    };

    // Debug Mode Manager
    const DebugManager = { log() {} };
    // Statistics Tracker
    const StatsTracker = { load() {}, increment() {}, getAll() { return {}; }, formatTime() { return '0s'; }, reset() {} };
    // Per-Channel Settings Manager
    const ChannelSettingsManager = {
        _STORAGE_KEY: 'ytkit-channel-settings',
        _settings: null,

        load() {
            if (this._settings) return this._settings;
            this._settings = StorageManager.get(this._STORAGE_KEY, {});
            return this._settings;
        },

        save() {
            if (!this._settings) return;
            StorageManager.set(this._STORAGE_KEY, this._settings);
        },

        getForChannel(channelId) {
            this.load();
            return this._settings[channelId] || null;
        },

        setForChannel(channelId, settings) {
            this.load();
            this._settings[channelId] = {
                ...this._settings[channelId],
                ...settings,
                updatedAt: Date.now()
            };
            this.save();
        },

        removeChannel(channelId) {
            this.load();
            delete this._settings[channelId];
            this.save();
        },

        getAllChannels() {
            this.load();
            return Object.entries(this._settings).map(([id, settings]) => ({
                id,
                ...settings
            }));
        },

        getCurrentChannelId() {
            // Try to extract channel ID from various sources
            const channelLink = document.querySelector('#owner #channel-name a, #upload-info #channel-name a, ytd-video-owner-renderer a');
            if (channelLink) {
                const href = channelLink.href;
                const match = href.match(/\/@([^\/\?]+)|\/channel\/([^\/\?]+)/);
                if (match) return match[1] || match[2];
            }
            return null;
        },

        getCurrentChannelName() {
            const channelName = document.querySelector('#owner #channel-name, #upload-info #channel-name, ytd-video-owner-renderer #channel-name');
            return channelName?.textContent?.trim() || null;
        },

        exportAll() {
            this.load();
            return JSON.stringify(this._settings, null, 2);
        },

        importAll(jsonStr) {
            try {
                const data = JSON.parse(jsonStr);
                if (typeof data !== 'object') return false;
                this._settings = data;
                this.save();
                return true;
            } catch { return false; }
        }
    };

    // IntersectionObserver Helper for Performance
    const VisibilityObserver = {
        _observer: null,
        _callbacks: new Map(),
        _options: {
            root: null,
            rootMargin: '200px',
            threshold: 0
        },

        init() {
            if (this._observer) return;
            this._observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const callback = this._callbacks.get(entry.target);
                    if (callback) {
                        callback(entry.isIntersecting, entry);
                    }
                });
            }, this._options);
        },

        observe(element, callback) {
            this.init();
            this._callbacks.set(element, callback);
            this._observer.observe(element);
        },

        unobserve(element) {
            if (!this._observer) return;
            this._callbacks.delete(element);
            this._observer.unobserve(element);
        },

        disconnect() {
            if (this._observer) {
                this._observer.disconnect();
                this._callbacks.clear();
            }
        }
    };


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0B: DYNAMIC CONTENT/STYLE ENGINE
    // ══════════════════════════════════════════════════════════════════════════
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

    function waitForElement(selector, callback, timeout = TIMING.ELEMENT_TIMEOUT) {
        const el = document.querySelector(selector);
        if (el) { callback(el); return; }
        const obs = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { obs.disconnect(); callback(el); }
        });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), timeout);
    }

    // Global toast notification function with optional action button
    function showToast(message, color = '#22c55e', options = {}) {
        // Remove existing toast if present
        document.querySelector('.ytkit-global-toast')?.remove();

        const toast = document.createElement('div');
        toast.className = 'ytkit-global-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: ${color};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: "Roboto", Arial, sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 999999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 12px;
            animation: ytkit-toast-fade ${options.duration || 2.5}s ease-out forwards;
        `;

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

    // Aggressive button injection system with MutationObserver
    const persistentButtons = new Map(); // id -> { parentSelector, checkSelector, injectFn }
    let buttonObserver = null;
    let buttonCheckInterval = null;
    let buttonCheckStarted = false;

    function registerPersistentButton(id, parentSelector, checkSelector, injectFn) {
        persistentButtons.set(id, { parentSelector, checkSelector, injectFn });
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
            // Debug: log what we can see to help diagnose
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
            return false;
        }

        try {
            config.injectFn(target);
            DebugManager.log('Buttons', `Injected ${id} into`, target.tagName + '#' + (target.id || ''));
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
        const currentVideoId = new URLSearchParams(window.location.search).get('v');
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
                                node.classList.contains('ytkit-transcript-btn') ||
                                node.classList.contains('ytkit-summarize-btn'))) {
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
            spaTimers.push(setTimeout(checkAllButtons, 300));
            spaTimers.push(setTimeout(checkAllButtons, 1000));
            spaTimers.push(setTimeout(checkAllButtons, 2500));
        });
    }


    const runNavigateRules = () => {
        for (const rule of navigateRules.values()) {
            try { rule(document.body); } catch (e) { console.error('[YTKit] Navigate rule error:', e); }
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

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 1: SETTINGS MANAGER
    // ══════════════════════════════════════════════════════════════════════════
    const settingsManager = {
        defaults: {
            // ═══ Interface ═══
            hideCreateButton: true,
            hideVoiceSearch: true,
            logoToSubscriptions: true,
            widenSearchBar: true,
            subscriptionsGrid: true,
            hideSidebar: true,

            // ═══ Appearance ═══
            // Consolidated: theme replaces nativeDarkMode, betterDarkMode, catppuccinMocha
            theme: 'betterDark', // 'system' | 'dark' | 'betterDark' | 'catppuccin'
            uiStyle: 'rounded', // 'rounded' | 'square' (replaces squarify, squareAvatars, squareSearchBar)
            noAmbientMode: true,
            noFrostedGlass: true,
            compactLayout: true,
            thinScrollbar: true,
            themeAccentColor: '', // empty = use theme default, or hex like '#ff6b6b'

            // ═══ Content ═══
            removeAllShorts: true,
            redirectShorts: true,
            disablePlayOnHover: true,
            fullWidthSubscriptions: true,
            hideSubscriptionOptions: true,
            fiveVideosPerRow: true,
            hidePaidContentOverlay: true,
            redirectToVideosTab: true,
            hidePlayables: true,
            hideMembersOnly: true,
            hideNewsHome: true,
            hidePlaylistsHome: true,

            // ═══ Video Hider ═══
            hideVideosFromHome: true,
            hideVideosBlockChannels: true,
            // Consolidated: single keyword filter that auto-detects regex (starts with /)
            hideVideosKeywordFilter: '',
            hideVideosDurationFilter: 0,
            hideVideosBlockedChannels: [],
            hideVideosSubsLoadLimit: true,
            hideVideosSubsLoadThreshold: 3,

            // ═══ Video Player ═══
            fitPlayerToWindow: true,
            hideRelatedVideos: true,
            adaptiveLiveLayout: true,
            expandVideoWidth: true,
            floatingLogoOnWatch: true,
            playerOverlayControls: true, // true = hover overlay on player, false = below video
            hideDescriptionRow: false,
            // Consolidated: replaces hideVideoEndCards, hideVideoEndScreen, hideEndVideoStills
            hideVideoEndContent: true,
            stickyVideo: true,

            // ═══ Playback ═══
            preventAutoplay: false,
            autoExpandDescription: false,
            preloadComments: true,
            sortCommentsNewestFirst: false,
            autoOpenChapters: false,
            autoOpenTranscript: false,
            chronologicalNotifications: false,
            autoSkipStillWatching: true,

            // ═══ Playback Enhancements ═══
            playbackSpeedPresets: true,
            defaultPlaybackSpeed: 1,
            rememberPlaybackSpeed: false,
            showWatchProgress: true,
            timestampBookmarks: true,
            autoSkipIntroOutro: false,
            enablePerChannelSettings: true,
            returnYouTubeDislike: true,
            cleanShareUrls: true,
            reversePlaylist: false,

            // ═══ Ad Blocker ═══
            ytAdBlock: true,
            adblockCosmeticHide: true,
            adblockSsapAutoSkip: true,
            adblockAntiDetect: true,
            adblockFilterUrl: 'https://raw.githubusercontent.com/SysAdminDoc/YoutubeAdblock/refs/heads/main/youtube-adblock-filters.txt',
            adblockFilterAutoUpdate: true,
            adblockFilterLastUpdate: 0,

            // ═══ SponsorBlock ═══
            skipSponsors: true,
            hideSponsorBlockLabels: true,
            sponsorBlockCategories: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic', 'preview', 'filler'],

            // ═══ Video Quality ═══
            autoMaxResolution: true,
            preferredQuality: 'max', // 'max' | '4320' | '2160' | '1440' | '1080' | '720' | '480'
            useEnhancedBitrate: true,
            hideQualityPopup: true,

            // ═══ Clutter ═══
            hideMerchShelf: true,
            hideAiSummary: true,

            // ═══ v19 New Features ═══
            autoResumePosition: true,
            autoResumeThreshold: 15, // seconds from start before saving position
            playbackSpeedOSD: true,
            watchTimeTracker: true,
            speedIndicatorBadge: false,

            // hideInfoPanel removed — consolidated into hideInfoPanels (Content group)
            hideDescriptionExtras: true,
            hideHashtags: true,
            hidePinnedComments: true,
            hideCommentActionMenu: true,
            condenseComments: true,
            hideLiveChatEngagement: true,
            hidePaidPromotionWatch: true,
            hideFundraiser: true,

            // ═══ Live Chat - Consolidated into array ═══
            hiddenChatElementsManager: true,
            hiddenChatElements: [
                'header', 'menu', 'popout', 'reactions', 'timestamps',
                'polls', 'ticker', 'leaderboard', 'support', 'banner',
                'emoji', 'topFan', 'superChats', 'levelUp', 'bots'
            ],
            chatKeywordFilter: '',

            // ═══ Action Buttons - Consolidated into array ═══
            hiddenActionButtonsManager: true,
            hiddenActionButtons: [
                'like', 'dislike', 'share', 'ask', 'clip',
                'thanks', 'save', 'sponsor', 'moreActions'
            ],
            autolikeVideos: true,
            replaceWithCobaltDownloader: true,

            // ═══ Player Controls - Consolidated into array ═══
            hiddenPlayerControlsManager: true,
            hiddenPlayerControls: [
                'sponsorBlock', 'next', 'autoplay', 'subtitles',
                'captions', 'miniplayer', 'pip', 'theater', 'fullscreen'
            ],

            // ═══ Watch Page Elements - Hide elements below videos ═══
            hiddenWatchElementsManager: true,
            hiddenWatchElements: [
                'joinButton', 'askButton', 'saveButton', 'moreActions',
                'askAISection', 'podcastSection', 'transcriptSection', 'channelInfoCards'
            ],

            // ═══ Downloads ═══
            showVlcButton: true,
            showVlcQueueButton: false,
            showLocalDownloadButton: true,
            showMp3DownloadButton: true,
            showSummarizeButton: true,
            showDownloadPlayButton: false,
            subsVlcPlaylist: true,
            videoContextMenu: true,
            autoDownloadOnVisit: false,
            downloadQuality: 'best',
            preferredMediaPlayer: 'vlc',
            downloadProvider: 'cobalt',

            // ═══ Advanced ═══
            hideCollaborations: true,
            useIntersectionObserver: true,
            hideInfoPanels: true,

            // ═══ ChapterForge ═══
            chapterForge: true,

            // ═══ DeArrow ═══
            deArrow: false,
            daReplaceTitles: true,
            daReplaceThumbs: true,
            daTitleFormat: 'sentence',    // 'sentence' | 'title_case' | 'original'
            daFallbackFormat: true,       // format original titles when no submission
            daShowOriginalHover: true,    // show original title/thumb on hover
            daCacheTTL: '4',               // hours to cache branding data before background refresh
            daDebugLog: false,             // verbose DeArrow console logging (off by default)
            cfMode: 'auto',          // 'manual' | 'auto'
            cfLlmProvider: 'ollama',  // 'builtin' | 'openai' | 'ollama' | 'openrouter' | 'custom'
            cfLlmEndpoint: '',         // custom API endpoint (auto-set for known providers)
            cfLlmApiKey: '',           // API key for provider
            cfLlmModel: 'gpt-4o',// model name
            cfShowChapters: true,
            cfShowPOIs: true,
            cfChapterOpacity: 0.35,
            cfTranscriptMethod: 'auto',     // 'auto' | 'captions-only' | 'whisper-only' | 'vibe'
            cfVibeEndpoint: 'http://localhost:8178',  // WhisperServer transcription endpoint
            cfWhisperModel: 'whisper-tiny.en',  // 'whisper-tiny.en' | 'whisper-base.en'
            cfMaxAutoDuration: 60,          // max minutes for auto-processing
            cfShowPlayerButton: true,       // show player button even in auto mode
            cfUseInnertube: true,           // audio download via Innertube adaptive formats
            cfUseCobalt: true,              // audio download via Cobalt API
            cfUseCapture: true,             // audio capture from player element
            cfPoiColor: '#ff6b6b',          // POI marker color
            cfDebugLog: false,              // verbose console logging
            cfSpeedControl: false,          // chapter-aware speed control
            cfBrowserAiModel: 'SmolLM2-360M-Instruct', // browser AI model for local LLM
            cfShowChapterHUD: false,         // show chapter name overlay on video player
            cfHudPosition: 'top-left',     // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
            cfCustomSummaryPrompt: '',     // user-editable summary system prompt (empty = use default)
            cfCustomChapterPrompt: '',     // user-editable chapter system prompt (empty = use default)
            cfFillerDetect: true,          // detect filler words in transcript (OpenCut: filler word detection)
            cfShowFillerMarkers: true,     // show filler markers on progress bar
            cfFillerWords: 'um, uh, uhh, umm, hmm, hm, er, erm, ah, mhm, you know, I mean, sort of, kind of, okay so, so yeah, yeah so, like',
            cfTranslateLang: '',           // target language for AI translation (empty = disabled)
            cfAutoSkipMode: 'normal',      // 'off' | 'gentle' | 'normal' | 'aggressive'
            cfAutoModel: true,             // auto-select best Ollama model for video length
            cfSummaryMode: 'paragraph',    // 'paragraph' (clean prose) or 'timestamped' (indexed)
            cfSummaryLength: 'standard',   // 'brief', 'standard', 'detailed'
            cfChapterMode: 'standard',     // 'standard' or 'seo' (keyword-optimized titles)
        },

        // Migration map for old settings to new
        _migrationMap: {
            // Theme consolidation
            'nativeDarkMode': (val, settings) => { if (val && !settings.betterDarkMode) settings.theme = 'dark'; },
            'betterDarkMode': (val, settings) => { if (val) settings.theme = 'betterDark'; },
            'catppuccinMocha': (val, settings) => { if (val) settings.theme = 'catppuccin'; },
            // UI style consolidation
            'squarify': (val, settings) => { if (val) settings.uiStyle = 'square'; },
            'squareAvatars': (val, settings) => { if (val) settings.uiStyle = 'square'; },
            'squareSearchBar': (val, settings) => { if (val) settings.uiStyle = 'square'; },
            // Video end consolidation
            'hideVideoEndCards': (val, settings) => { settings.hideVideoEndContent = val; },
            'hideVideoEndScreen': (val, settings) => { if (val) settings.hideVideoEndContent = true; },
            'hideEndVideoStills': (val, settings) => { if (val) settings.hideVideoEndContent = true; },
            // Info panel consolidation
            'hideClarifyBoxes': (val, settings) => { if (val) settings.hideInfoPanels = true; },
            'hideInfoPanel': (val, settings) => { if (val) settings.hideInfoPanels = true; },
            // Regex filter consolidation
            'useRegexKeywordFilter': () => {}, // No longer needed - auto-detected
            'hideVideosRegexFilter': (val, settings) => {
                if (val) settings.hideVideosKeywordFilter = val;
            },
        },

        load() {
            let savedSettings = StorageManager.get('ytSuiteSettings', {});

            // Migrate old settings to new format
            savedSettings = this._migrateOldSettings(savedSettings);

            // Run version migrations if needed
            if (!savedSettings._version || savedSettings._version < SETTINGS_VERSION) {
                savedSettings = SettingsMigration.migrate(savedSettings);
                this.save(savedSettings);
            }
            return { ...this.defaults, ...savedSettings };
        },

        _migrateOldSettings(saved) {
            const migrated = { ...saved };

            // Migrate action buttons to array format
            if (saved.hideLikeButton !== undefined) {
                const hidden = [];
                if (saved.hideLikeButton) hidden.push('like');
                if (saved.hideDislikeButton) hidden.push('dislike');
                if (saved.hideShareButton) hidden.push('share');
                if (saved.hideAskButton) hidden.push('ask');
                if (saved.hideClipButton) hidden.push('clip');
                if (saved.hideThanksButton) hidden.push('thanks');
                if (saved.hideSaveButton) hidden.push('save');
                if (saved.hideSponsorButton) hidden.push('sponsor');
                if (saved.hideMoreActionsButton) hidden.push('moreActions');
                migrated.hiddenActionButtons = hidden;
                // Clean up old keys
                delete migrated.hideLikeButton; delete migrated.hideDislikeButton;
                delete migrated.hideShareButton; delete migrated.hideAskButton;
                delete migrated.hideClipButton; delete migrated.hideThanksButton;
                delete migrated.hideSaveButton; delete migrated.hideSponsorButton;
                delete migrated.hideMoreActionsButton;
            }

            // Migrate player controls to array format
            if (saved.hideSponsorBlockButton !== undefined) {
                const hidden = [];
                if (saved.hideSponsorBlockButton) hidden.push('sponsorBlock');
                if (saved.hideNextButton) hidden.push('next');
                if (saved.hideAutoplayToggle) hidden.push('autoplay');
                if (saved.hideSubtitlesToggle) hidden.push('subtitles');
                if (saved.hideCaptionsContainer) hidden.push('captions');
                if (saved.hideMiniplayerButton) hidden.push('miniplayer');
                if (saved.hidePipButton) hidden.push('pip');
                if (saved.hideTheaterButton) hidden.push('theater');
                if (saved.hideFullscreenButton) hidden.push('fullscreen');
                migrated.hiddenPlayerControls = hidden;
                // Clean up old keys
                delete migrated.hideSponsorBlockButton; delete migrated.hideNextButton;
                delete migrated.hideAutoplayToggle; delete migrated.hideSubtitlesToggle;
                delete migrated.hideCaptionsContainer; delete migrated.hideMiniplayerButton;
                delete migrated.hidePipButton; delete migrated.hideTheaterButton;
                delete migrated.hideFullscreenButton;
            }

            // Migrate chat elements to array format
            if (saved.hideLiveChatHeader !== undefined) {
                const hidden = [];
                if (saved.hideLiveChatHeader) hidden.push('header');
                if (saved.hideChatMenu) hidden.push('menu');
                if (saved.hidePopoutChatButton) hidden.push('popout');
                if (saved.hideChatReactionsButton) hidden.push('reactions');
                if (saved.hideChatTimestampsButton) hidden.push('timestamps');
                if (saved.hideChatPolls || saved.hideChatPollBanner) hidden.push('polls');
                if (saved.hideChatTicker) hidden.push('ticker');
                if (saved.hideViewerLeaderboard) hidden.push('leaderboard');
                if (saved.hideChatSupportButtons) hidden.push('support');
                if (saved.hideChatBanner) hidden.push('banner');
                if (saved.hideChatEmojiButton) hidden.push('emoji');
                if (saved.hideTopFanIcons) hidden.push('topFan');
                if (saved.hideSuperChats) hidden.push('superChats');
                if (saved.hideLevelUp) hidden.push('levelUp');
                if (saved.hideChatBots) hidden.push('bots');
                migrated.hiddenChatElements = hidden;
                migrated.chatKeywordFilter = saved.keywordFilterList || '';
                // Clean up old keys
                delete migrated.hideLiveChatHeader; delete migrated.hideChatMenu;
                delete migrated.hidePopoutChatButton; delete migrated.hideChatReactionsButton;
                delete migrated.hideChatTimestampsButton; delete migrated.hideChatPolls;
                delete migrated.hideChatPollBanner; delete migrated.hideChatTicker;
                delete migrated.hideViewerLeaderboard; delete migrated.hideChatSupportButtons;
                delete migrated.hideChatBanner; delete migrated.hideChatEmojiButton;
                delete migrated.hideTopFanIcons; delete migrated.hideSuperChats;
                delete migrated.hideLevelUp; delete migrated.hideChatBots;
                delete migrated.keywordFilterList;
            }

            // Apply other migrations
            for (const [oldKey, migrateFn] of Object.entries(this._migrationMap)) {
                if (saved[oldKey] !== undefined) {
                    migrateFn(saved[oldKey], migrated);
                    delete migrated[oldKey];
                }
            }

            // Remove returnYouTubeDislike completely
            delete migrated.returnYouTubeDislike;
            delete migrated.channelPlaybackSpeeds;

            return migrated;
        },

        save(settings) {
            settings._version = SETTINGS_VERSION;
            StorageManager.set('ytSuiteSettings', settings);
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
                hiddenVideos = StorageManager.get('ytkit-hidden-videos', []);
                blockedChannels = StorageManager.get('ytkit-blocked-channels', []);
                bookmarks = StorageManager.get('ytkit-bookmarks', {});
            } catch(e) {
                console.warn('[YTKit] Failed to load data for export:', e);
            }
            const exportData = {
                settings: settings,
                hiddenVideos: hiddenVideos,
                blockedChannels: blockedChannels,
                bookmarks: bookmarks,
                exportVersion: 3,
                exportDate: new Date().toISOString(),
                ytkitVersion: '10.0'
            };
            return JSON.stringify(exportData, null, 2);
        },
        importAllSettings(jsonString) {
            try {
                const importedData = JSON.parse(jsonString);
                if (typeof importedData !== 'object' || importedData === null) return false;

                // Handle different export versions
                let settings, hiddenVideos, blockedChannels, bookmarks;
                if (importedData.exportVersion >= 3) {
                    // Version 3 format with bookmarks
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                    bookmarks = importedData.bookmarks || {};
                } else if (importedData.exportVersion >= 2) {
                    // Version 2 format with hidden videos
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                    bookmarks = null;
                } else {
                    // Version 1 format - just settings object
                    settings = importedData;
                    hiddenVideos = null;
                    blockedChannels = null;
                    bookmarks = null;
                }

                const newSettings = { ...this.defaults, ...settings };
                this.save(newSettings);

                // Import hidden videos, blocked channels, and bookmarks if present
                if (hiddenVideos !== null) {
                    StorageManager.set('ytkit-hidden-videos', hiddenVideos);
                }
                if (blockedChannels !== null) {
                    StorageManager.set('ytkit-blocked-channels', blockedChannels);
                }
                if (bookmarks !== null) {
                    StorageManager.set('ytkit-bookmarks', bookmarks);
                }

                return true;
            } catch (e) {
                console.error("[YTKit] Failed to import settings:", e);
                return false;
            }
        }
    };

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 2: FEATURE DEFINITIONS
    // ══════════════════════════════════════════════════════════════════════════
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

    const features = [
        // ─── Interface ───
        cssFeature('hideCreateButton', 'Hide Create Button', 'Remove the "Create" button from the header toolbar', 'Interface', 'plus-circle',
            'ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])'),
        cssFeature('hideVoiceSearch', 'Hide Voice Search', 'Remove the microphone icon from the search bar', 'Interface', 'mic-off',
            '#voice-search-button'),
        {
            id: 'logoToSubscriptions',
            name: 'Logo → Subscriptions',
            description: 'Clicking the YouTube logo goes to your subscriptions feed',
            group: 'Interface',
            icon: 'home',
            _relinkLogo() {
                const logoRenderer = document.querySelector('ytd-topbar-logo-renderer');
                if (!logoRenderer) return;
                const link = logoRenderer.querySelector('a#logo');
                if (link) link.href = '/feed/subscriptions';
            },
            init() { addNavigateRule('relinkLogoRule', () => this._relinkLogo()); },
            destroy() {
                removeNavigateRule('relinkLogoRule');
                const logoLink = document.querySelector('ytd-topbar-logo-renderer a#logo');
                if (logoLink) logoLink.href = '/';
            }
        },
        cssFeature('widenSearchBar', 'Widen Search Bar', 'Expand the search bar to use more available space', 'Interface', 'search',
            `ytd-masthead yt-searchbox { margin-left: -180px; margin-right: -300px; }`),
        {
            id: 'subscriptionsGrid',
            name: 'Subscriptions Grid',
            description: 'Use a denser grid layout on the subscriptions page',
            group: 'Interface',
            icon: 'layout-grid',
            pages: [PageTypes.SUBSCRIPTIONS],
            _styleElement: null,
            init() {
                const css = `
                    #contents.ytd-rich-grid-renderer {
                        display: grid !important;
                        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
                        gap: 8px;
                        width: 99%;
                    }
                    ytd-rich-item-renderer.ytd-rich-grid-renderer {
                        width: 100% !important;
                        margin: 0 !important;
                        margin-left: 2px !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideSidebar',
            name: 'Hide Sidebar',
            description: 'Remove the left navigation sidebar completely',
            group: 'Interface',
            icon: 'sidebar',
            _styleElement: null,
            init() {
                const css = `
                    #guide, #guide-button, ytd-mini-guide-renderer, tp-yt-app-drawer { display: none !important; }
                    .opened { display: none !important; }
                    ytd-page-manager { margin-left: 0 !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        // squareSearchBar removed — consolidated into uiStyleManager 'square' mode

        // ─── Appearance ───
        {
            // ═══ Consolidated Theme Feature ═══
            id: 'themeManager',
            name: 'Theme',
            description: 'Choose your preferred color theme',
            group: 'Appearance',
            icon: 'moon',
            type: 'select',
            options: {
                'system': 'System Default',
                'dark': 'Dark',
                'betterDark': 'Enhanced Dark',
                'catppuccin': 'Catppuccin Mocha'
            },
            settingKey: 'theme',
            _styleElement: null,
            _ruleId: 'themeManagerRule',

            init() {
                const theme = appState.settings.theme || 'betterDark';
                this._applyTheme(theme);
                addMutationRule(this._ruleId, () => this._applyTheme(theme));
            },

            _applyTheme(theme) {
                // Remove existing theme styles
                document.getElementById('ytkit-theme-style')?.remove();

                // Always force dark mode for non-system themes
                if (theme !== 'system') {
                    document.documentElement.setAttribute('dark', '');
                }

                // Apply specific theme CSS
                if (theme === 'betterDark') {
                    const customCss = GM_getResourceText('betterDarkMode');
                    if (customCss) {
                        const style = document.createElement('style');
                        style.id = 'ytkit-theme-style';
                        style.textContent = customCss;
                        document.head.appendChild(style);
                        this._styleElement = style;
                    }
                } else if (theme === 'catppuccin') {
                    const customCss = GM_getResourceText('catppuccinMocha');
                    if (customCss) {
                        const style = document.createElement('style');
                        style.id = 'ytkit-theme-style';
                        style.textContent = customCss;
                        document.head.appendChild(style);
                        this._styleElement = style;
                    }
                }
                // Apply custom accent color
                const accent = appState.settings.themeAccentColor;
                if (accent && /^#[0-9a-f]{3,8}$/i.test(accent)) {
                    document.getElementById('ytkit-accent-style')?.remove();
                    const accentStyle = document.createElement('style');
                    accentStyle.id = 'ytkit-accent-style';
                    accentStyle.textContent = `
                        :root {
                            --ytkit-accent: ${accent} !important;
                        }
                        ytd-toggle-button-renderer.style-default-active[is-icon-button] yt-icon,
                        .yt-spec-button-shape-next--filled[aria-pressed="true"],
                        .ytp-swatch-background-color,
                        .ytp-play-progress,
                        yt-chip-cloud-chip-renderer[selected],
                        ytd-mini-guide-entry-renderer[active] .guide-icon,
                        #progress.ytd-thumbnail-overlay-resume-playback-renderer {
                            color: ${accent} !important;
                            background-color: ${accent} !important;
                        }
                        a:hover, a:focus { color: ${accent} !important; }
                        .ytp-play-progress { background: ${accent} !important; }
                    `;
                    document.head.appendChild(accentStyle);
                }
            },

            destroy() {
                document.documentElement.removeAttribute('dark');
                this._styleElement?.remove();
                document.getElementById('ytkit-theme-style')?.remove();
                document.getElementById('ytkit-accent-style')?.remove();
                removeMutationRule(this._ruleId);
            }
        },
        {
            id: 'themeAccentColor',
            name: 'Accent Color',
            description: 'Custom accent color for highlights, progress bar, and active elements',
            group: 'Appearance',
            icon: 'palette',
            isSubFeature: true,
            parentId: 'themeManager',
            type: 'color',
            settingKey: 'themeAccentColor',
            init() {
                const accent = appState.settings.themeAccentColor;
                if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
                    const themeFeature = features.find(f => f.id === 'themeManager');
                    if (themeFeature) { themeFeature.destroy?.(); themeFeature.init?.(); }
                }
            },
            destroy() {}
        },
        {
            // ═══ Consolidated UI Style Feature ═══
            id: 'uiStyleManager',
            name: 'UI Style',
            description: 'Choose rounded or square UI elements',
            group: 'Appearance',
            icon: 'square',
            type: 'select',
            options: {
                'rounded': 'Rounded (Default)',
                'square': 'Square'
            },
            settingKey: 'uiStyle',
            _styleElement: null,

            init() {
                const style = appState.settings.uiStyle || 'rounded';
                if (style === 'square') {
                    const css = `
                        * { border-radius: 0 !important; }
                        yt-img-shadow, #avatar-link, #author-thumbnail,
                        ytd-channel-avatar-editor img, yt-img-shadow img,
                        .yt-spec-avatar-shape--circle { border-radius: 0 !important; }
                    `;
                    this._styleElement = injectStyle(css, this.id, true);
                }
            },

            destroy() { this._styleElement?.remove(); }
        },
        cssFeature('noAmbientMode', 'Disable Ambient Mode', 'Turn off the glowing background effect that matches video colors', 'Appearance', 'sun-dim',
            `#cinematics, #cinematics-container,
                    .ytp-autonav-endscreen-upnext-cinematics,
                    #player-container.ytd-watch-flexy::before { display: none !important; }`),
        cssFeature('noFrostedGlass', 'Disable Frosted Glass', 'Remove blur effects from UI elements', 'Appearance', 'droplet-off',
            `* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`),
        cssFeature('compactLayout', 'Compact Layout', 'Reduce spacing and padding for a denser interface', 'Appearance', 'minimize',
            `ytd-rich-grid-renderer { --ytd-rich-grid-row-padding: 0 !important; }
                    ytd-rich-item-renderer { margin-bottom: 8px !important; }
                    #contents.ytd-rich-grid-renderer { padding-top: 8px !important; }
                    ytd-two-column-browse-results-renderer { padding: 8px !important; }
                    ytd-watch-flexy[flexy] #primary.ytd-watch-flexy { padding-top: 0 !important; }`),
        cssFeature('thinScrollbar', 'Thin Scrollbar', 'Use a slim, unobtrusive scrollbar', 'Appearance', 'grip-vertical',
            `*::-webkit-scrollbar { width: 5px !important; height: 5px !important; }
                    *::-webkit-scrollbar-track { background: transparent !important; }
                    *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2) !important; border-radius: 10px !important; }
                    *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.35) !important; }
                    * { scrollbar-width: thin !important; scrollbar-color: rgba(255,255,255,0.2) transparent !important; }`),

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

                const processNode = (node) => {
                    if (node.nodeType !== 1) return;
                    if (node.matches?.('a[href^="/shorts"]')) hideShort(node);
                    node.querySelectorAll?.('a[href^="/shorts"]').forEach(hideShort);
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

                // Use shared observer for new content
                addMutationRule(this.id, () => {
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
                        window.location.href = window.location.href.replace('/shorts/', '/watch?v=');
                    }
                };
                addNavigateRule(this.id, redirectRule);
            },
            destroy() { removeNavigateRule(this.id); }
        },
        cssFeature('disablePlayOnHover', 'Disable Hover Preview', 'Stop videos from playing when hovering over thumbnails', 'Content', 'pause',
            `ytd-video-preview, #preview, #mouseover-overlay,
                    ytd-moving-thumbnail-renderer,
                    ytd-thumbnail-overlay-loading-preview-renderer {
                        display: none !important;
                    }`),
        cssFeature('fullWidthSubscriptions', 'Full-Width Subscriptions', 'Expand the subscription grid to fill the page', 'Content', 'maximize',
            `ytd-browse[page-subtype="subscriptions"] #grid-container.ytd-two-column-browse-results-renderer {
                        max-width: 100% !important;
                    }`),
        cssFeature('hideSubscriptionOptions', 'Hide Layout Options', 'Remove the "Latest" header and view toggles on subscriptions', 'Content', 'layout',
            'ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(.grid-subheader)'),
        cssFeature('fiveVideosPerRow', '5 Videos Per Row', 'Display five video thumbnails per row in grids', 'Content', 'grid',
            `#contents.ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: 5 !important; }`),
        cssFeature('hidePaidContentOverlay', 'Hide Promotion Badges', 'Remove "Includes paid promotion" overlays on thumbnails', 'Content', 'badge',
            'ytd-paid-content-overlay-renderer, ytm-paid-content-overlay-renderer'),
        cssFeature('hideInfoPanels', 'Hide Info Panels', 'Remove Wikipedia/context info boxes that appear below videos (FEMA, COVID, etc.)', 'Content', 'info-off',
            `#clarify-box,
                    #clarify-box.attached-message,
                    ytd-info-panel-container-renderer,
                    ytd-info-panel-content-renderer,
                    ytd-watch-flexy #clarify-box,
                    ytd-watch-flexy ytd-info-panel-container-renderer,
                    ytd-clarification-renderer,
                    .ytd-info-panel-container-renderer,
                    .ytp-info-panel-preview {
                        display: none !important;
                    }`),
        {
            id: 'redirectToVideosTab',
            name: 'Channels → Videos Tab',
            description: 'Open channel pages directly on the Videos tab',
            group: 'Content',
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
        cssFeature('hidePlayables', 'Hide Playables', 'Hide YouTube Playables gaming content from feeds', 'Content', 'gamepad',
            `ytd-rich-section-renderer:has([is-playables]) { display: none !important; }`),
        cssFeature('hideMembersOnly', 'Hide Members Only', 'Hide members-only content from channels', 'Content', 'lock',
            `ytd-badge-supported-renderer:has([aria-label*="Members only"]),
                    ytd-rich-item-renderer:has([aria-label*="Members only"]),
                    ytd-video-renderer:has([aria-label*="Members only"]) { display: none !important; }`),
        cssFeature('hideNewsHome', 'Hide News Section', 'Hide news sections from the homepage', 'Content', 'newspaper',
            `ytd-rich-section-renderer:has([is-news]),
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[type="news"]) { display: none !important; }`),
        cssFeature('hidePlaylistsHome', 'Hide Playlist Shelves', 'Hide playlist sections from the homepage', 'Content', 'list-x',
            `ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-playlist]),
                    ytd-rich-section-renderer:has([is-mixes]) { display: none !important; }`),
        // ═══ Watch Page Elements Hiding ═══
        {
            id: 'hiddenWatchElementsManager',
            name: 'Hide Watch Page Elements',
            description: 'Choose which elements to hide below videos',
            group: 'Content',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _ruleId: 'watchElementsHider',
            // CSS selectors for elements that can be hidden with pure CSS
            _cssSelectors: {
                title: 'ytd-watch-metadata #title',
                views: 'ytd-watch-info-text #view-count',
                date: 'ytd-watch-info-text #date-text',
                channelAvatar: 'ytd-video-owner-renderer #avatar',
                channelName: 'ytd-video-owner-renderer #channel-name',
                subCount: 'ytd-video-owner-renderer #owner-sub-count',
                joinButton: 'ytd-video-owner-renderer #sponsor-button',
                subscribeButton: 'ytd-watch-metadata #subscribe-button',
                likeDislike: 'segmented-like-dislike-button-view-model',
                description: 'ytd-watch-metadata #description',
                askAISection: 'yt-video-description-youchat-section-view-model',
                podcastSection: 'ytd-video-description-course-section-renderer',
                transcriptSection: 'ytd-video-description-transcript-section-renderer',
                channelInfoCards: 'ytd-video-description-infocards-section-renderer'
            },
            // Button aria-labels for JS-based hiding (find parent yt-button-view-model)
            _buttonAriaLabels: {
                shareButton: 'Share',
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
                    addMutationRule(this._ruleId, () => this._hideButtons());
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
        { id: 'wpHide_title', name: 'Video Title', description: 'Hide the video title', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'title', init(){}, destroy(){} },
        { id: 'wpHide_views', name: 'View Count', description: 'Hide the view count', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'views', init(){}, destroy(){} },
        { id: 'wpHide_date', name: 'Upload Date', description: 'Hide the upload date', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'date', init(){}, destroy(){} },
        { id: 'wpHide_channelAvatar', name: 'Channel Avatar', description: 'Hide the channel avatar', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'channelAvatar', init(){}, destroy(){} },
        { id: 'wpHide_channelName', name: 'Channel Name', description: 'Hide the channel name', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'channelName', init(){}, destroy(){} },
        { id: 'wpHide_subCount', name: 'Subscriber Count', description: 'Hide subscriber count', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'subCount', init(){}, destroy(){} },
        { id: 'wpHide_joinButton', name: 'Join Button', description: 'Hide join/membership button', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'joinButton', init(){}, destroy(){} },
        { id: 'wpHide_subscribeButton', name: 'Subscribe Button', description: 'Hide subscribe button', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'subscribeButton', init(){}, destroy(){} },
        { id: 'wpHide_likeDislike', name: 'Like/Dislike Buttons', description: 'Hide like/dislike buttons', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'likeDislike', init(){}, destroy(){} },
        { id: 'wpHide_shareButton', name: 'Share Button', description: 'Hide share button on watch page', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'shareButton', init(){}, destroy(){} },
        { id: 'wpHide_askButton', name: 'Ask Button', description: 'Hide Ask AI button', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'askButton', init(){}, destroy(){} },
        { id: 'wpHide_saveButton', name: 'Save Button', description: 'Hide save to playlist button', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'saveButton', init(){}, destroy(){} },
        { id: 'wpHide_moreActions', name: 'More Actions (...)', description: 'Hide more actions menu button', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'moreActions', init(){}, destroy(){} },
        { id: 'wpHide_description', name: 'Description Box', description: 'Hide the video description', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'description', init(){}, destroy(){} },
        { id: 'wpHide_askAISection', name: 'Ask AI Section', description: 'Hide AI section in description', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'askAISection', init(){}, destroy(){} },
        { id: 'wpHide_podcastSection', name: 'Podcast/Course Section', description: 'Hide podcast/course section in description', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'podcastSection', init(){}, destroy(){} },
        { id: 'wpHide_transcriptSection', name: 'Transcript Section', description: 'Hide transcript section in description', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'transcriptSection', init(){}, destroy(){} },
        { id: 'wpHide_channelInfoCards', name: 'Channel Info Cards', description: 'Hide channel info cards in description', group: 'Content', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenWatchElementsManager', _arrayKey: 'hiddenWatchElements', _arrayValue: 'channelInfoCards', init(){}, destroy(){} },
        {
            id: 'hideVideosFromHome',
            name: 'Video Hider',
            description: 'Hide videos/channels from feeds. Includes keyword filter, duration filter, and channel blocking.',
            group: 'Video Hider',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _observer: null,
            _toastTimeout: null,
            _lastHidden: null,
            _STORAGE_KEY: 'ytkit-hidden-videos',
            _CHANNELS_KEY: 'ytkit-blocked-channels',
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

                // Clear any pending batch processing
                if (this._clearBatchBuffer) this._clearBatchBuffer();

                // Hide the continuation spinner/trigger to prevent more loading
                const continuations = document.querySelectorAll('ytd-continuation-item-renderer, #continuations, ytd-browse[page-subtype="subscriptions"] ytd-continuation-item-renderer');
                continuations.forEach(cont => {
                    if (!(cont instanceof HTMLElement)) return;
                    cont.style.display = 'none';
                    cont.dataset.ytkitBlocked = 'true';
                });

                // Create info banner
                this._showLoadBlockedBanner();
                DebugManager.log('VideoHider', 'Subscription loading blocked - too many consecutive hidden batches');
            },

            _removeLoadBlocker() {
                this._subsLoadState.loadingBlocked = false;
                // Restore continuation elements
                document.querySelectorAll('[data-ytkit-blocked="true"]').forEach(el => {
                    if (!(el instanceof HTMLElement)) return;
                    el.style.display = '';
                    delete el.dataset.ytkitBlocked;
                });
                // Remove banner
                document.getElementById('ytkit-subs-load-banner')?.remove();
            },

            _showLoadBlockedBanner() {
                if (document.getElementById('ytkit-subs-load-banner')) return;

                const banner = document.createElement('div');
                banner.id = 'ytkit-subs-load-banner';
                banner.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                    border: 1px solid #334155;
                    border-radius: 12px;
                    padding: 16px 24px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    z-index: 99999;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                    font-family: "Roboto", Arial, sans-serif;
                    max-width: 600px;
                `;

                const icon = document.createElement('div');
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '24');
                svg.setAttribute('height', '24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', '#f59e0b');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '12');
                circle.setAttribute('cy', '12');
                circle.setAttribute('r', '10');
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '12');
                line1.setAttribute('y1', '8');
                line1.setAttribute('x2', '12');
                line1.setAttribute('y2', '12');
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '12');
                line2.setAttribute('y1', '16');
                line2.setAttribute('x2', '12.01');
                line2.setAttribute('y2', '16');
                svg.appendChild(circle);
                svg.appendChild(line1);
                svg.appendChild(line2);
                icon.appendChild(svg);

                const textContainer = document.createElement('div');
                textContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px;';

                const title = document.createElement('div');
                title.style.cssText = 'color: #f1f5f9; font-size: 14px; font-weight: 600;';
                title.textContent = 'Infinite scroll stopped';

                const subtitle = document.createElement('div');
                subtitle.style.cssText = 'color: #94a3b8; font-size: 12px;';
                subtitle.textContent = `${this._subsLoadState.totalVideosHidden} of ${this._subsLoadState.totalVideosLoaded} videos were hidden. Stopped loading to prevent performance issues.`;

                textContainer.appendChild(title);
                textContainer.appendChild(subtitle);

                const buttonContainer = document.createElement('div');
                buttonContainer.style.cssText = 'display: flex; gap: 8px;';

                const resumeBtn = document.createElement('button');
                resumeBtn.textContent = 'Load More';
                resumeBtn.style.cssText = `
                    padding: 8px 16px;
                    border-radius: 8px;
                    border: none;
                    background: #3b82f6;
                    color: white;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                `;
                resumeBtn.onmouseenter = () => { resumeBtn.style.background = '#2563eb'; };
                resumeBtn.onmouseleave = () => { resumeBtn.style.background = '#3b82f6'; };
                resumeBtn.onclick = () => {
                    this._subsLoadState.consecutiveHiddenBatches = 0;
                    this._removeLoadBlocker();
                    // Scroll slightly to trigger reload
                    window.scrollBy(0, 100);
                    setTimeout(() => window.scrollBy(0, -100), 100);
                };

                const dismissBtn = document.createElement('button');
                dismissBtn.textContent = '✕';
                dismissBtn.title = 'Dismiss';
                dismissBtn.style.cssText = `
                    padding: 8px 12px;
                    border-radius: 8px;
                    border: 1px solid #334155;
                    background: transparent;
                    color: #94a3b8;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                `;
                dismissBtn.onmouseenter = () => { dismissBtn.style.background = '#1e293b'; dismissBtn.style.color = '#f1f5f9'; };
                dismissBtn.onmouseleave = () => { dismissBtn.style.background = 'transparent'; dismissBtn.style.color = '#94a3b8'; };
                dismissBtn.onclick = () => banner.remove();

                buttonContainer.appendChild(resumeBtn);
                buttonContainer.appendChild(dismissBtn);

                banner.appendChild(icon);
                banner.appendChild(textContainer);
                banner.appendChild(buttonContainer);
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

                // Check if ALL videos in this batch were hidden
                const allHidden = hiddenCount === batchSize;
                const threshold = appState.settings.hideVideosSubsLoadThreshold || 3;

                if (allHidden) {
                    this._subsLoadState.consecutiveHiddenBatches++;
                    DebugManager.log('VideoHider', `Subs load: batch ${this._subsLoadState.consecutiveHiddenBatches}/${threshold} all hidden (${hiddenCount}/${batchSize})`);

                    if (this._subsLoadState.consecutiveHiddenBatches >= threshold) {
                        this._blockSubsLoading();
                    }
                } else {
                    // Reset counter if we found some visible videos
                    this._subsLoadState.consecutiveHiddenBatches = 0;
                }
            },

            _getHiddenVideos() {
                try { return GM_getValue(this._STORAGE_KEY, []); }
                catch(e) { const s = localStorage.getItem(this._STORAGE_KEY); return s ? JSON.parse(s) : []; }
            },
            _setHiddenVideos(videos) {
                try { GM_setValue(this._STORAGE_KEY, videos); }
                catch(e) { localStorage.setItem(this._STORAGE_KEY, JSON.stringify(videos)); }
            },
            _getBlockedChannels() {
                try { return GM_getValue(this._CHANNELS_KEY, []); }
                catch(e) { const s = localStorage.getItem(this._CHANNELS_KEY); return s ? JSON.parse(s) : []; }
            },
            _setBlockedChannels(channels) {
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
                // Remove legacy toast if present
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
                // Push to UndoManager for extended undo capability
                UndoManager.push({
                    type: 'video-restore',
                    data: this._lastHidden
                });
                this._lastHidden = null;
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
            },

            // Public method to unhide a specific video by ID
            _unhideVideo(videoId) {
                const hidden = this._getHiddenVideos();
                const idx = hidden.indexOf(videoId);
                if (idx > -1) {
                    hidden.splice(idx, 1);
                    this._setHiddenVideos(hidden);
                    // Remove hidden class from any matching elements
                    document.querySelectorAll(`[data-ytkit-video-id="${videoId}"]`)?.forEach(el => {
                        el.classList.remove('ytkit-video-hidden');
                    });
                    this._processAllVideos(); // Refresh visibility
                    return true;
                }
                return false;
            },

            _showManager() {
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
                // Open main settings panel and switch to Video Hider tab
                document.body.classList.add('ytkit-panel-open');
                // Wait for panel to be visible then switch tab
                setTimeout(() => {
                    const navBtn = document.querySelector('.ytkit-nav-btn[data-tab="Video-Hider"]');
                    if (navBtn) navBtn.click();
                }, 100);
            },

            _closeManager() {
                // No longer needed - handled by main settings panel
            },

            _shouldHide(element) {
                const videoId = this._extractVideoId(element);
                if (videoId && this._getHiddenVideos().includes(videoId)) return true;
                const channelInfo = this._extractChannelInfo(element);
                if (channelInfo && this._getBlockedChannels().find(c => c.id === channelInfo.id)) return true;

                // Unified keyword/regex filter - auto-detects regex if starts with /
                const filterStr = (appState.settings.hideVideosKeywordFilter || '').trim();
                if (filterStr) {
                    const title = this._extractTitle(element);
                    const channelName = channelInfo?.name?.toLowerCase() || '';
                    const searchText = (title + ' ' + channelName).toLowerCase();

                    // Check if it's a regex pattern (starts with /)
                    if (filterStr.startsWith('/')) {
                        try {
                            const regexMatch = filterStr.match(/^\/(.+)\/([gimsuy]*)$/);
                            if (regexMatch) {
                                const regex = new RegExp(regexMatch[1], regexMatch[2]);
                                if (regex.test(title) || regex.test(channelName)) return true;
                            }
                        } catch (e) {
                            DebugManager.log('Regex', 'Invalid regex pattern', e.message);
                        }
                    } else {
                        // Comma-separated keywords with !negation support
                        const keywords = filterStr.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
                        const positiveKw = keywords.filter(k => !k.startsWith('!'));
                        const negativeKw = keywords.filter(k => k.startsWith('!')).map(k => k.slice(1));
                        // If any negative keyword matches, DON'T hide (whitelist)
                        if (negativeKw.length && negativeKw.some(k => searchText.includes(k))) return false;
                        // If any positive keyword matches title or channel, hide
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
                if (element.dataset.ytkitHideProcessed) return;
                element.dataset.ytkitHideProcessed = 'true';
                if (this._shouldHide(element)) { element.classList.add('ytkit-video-hidden'); }
                else { element.classList.remove('ytkit-video-hidden'); }
                const thumbnail = this._findThumbnailContainer(element);
                if (!thumbnail || thumbnail.querySelector('.ytkit-video-hide-btn')) return;
                if (window.getComputedStyle(thumbnail).position === 'static') thumbnail.style.position = 'relative';
                const btn = this._createHideButton();
                const videoId = this._extractVideoId(element);
                const channelInfo = this._extractChannelInfo(element);
                btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (videoId) this._hideVideo(videoId, element); });
                btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (channelInfo) this._blockChannel(channelInfo, element); });
                thumbnail.appendChild(btn);
            },

            // Version that returns whether video was hidden (for batch tracking)
            _processVideoElementWithResult(element) {
                if (element.dataset.ytkitHideProcessed) {
                    return element.classList.contains('ytkit-video-hidden');
                }
                element.dataset.ytkitHideProcessed = 'true';
                const shouldHide = this._shouldHide(element);
                if (shouldHide) { element.classList.add('ytkit-video-hidden'); }
                else { element.classList.remove('ytkit-video-hidden'); }
                const thumbnail = this._findThumbnailContainer(element);
                if (thumbnail && !thumbnail.querySelector('.ytkit-video-hide-btn')) {
                    if (window.getComputedStyle(thumbnail).position === 'static') thumbnail.style.position = 'relative';
                    const btn = this._createHideButton();
                    const videoId = this._extractVideoId(element);
                    const channelInfo = this._extractChannelInfo(element);
                    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (videoId) this._hideVideo(videoId, element); });
                    btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (channelInfo) this._blockChannel(channelInfo, element); });
                    thumbnail.appendChild(btn);
                }
                return shouldHide;
            },

            _processAllVideos() {
                document.querySelectorAll('[data-ytkit-hide-processed]').forEach(el => { delete el.dataset.ytkitHideProcessed; });
                document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer')
                    .forEach(el => this._processVideoElement(el));
            },

            // Get all visible (not hidden) videos on the page
            _getVisibleVideos() {
                const videos = [];
                const selectors = ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer'];
                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(item => {
                        if (item.classList.contains('ytkit-video-hidden')) return;
                        const videoId = this._extractVideoId(item);
                        if (videoId) {
                            videos.push({ id: videoId, element: item });
                        }
                    });
                });
                return videos;
            },

            // Hide all visible videos on the current page
            _hideAllVideos() {
                const videos = this._getVisibleVideos();
                if (videos.length === 0) {
                    showToast('No visible videos to hide', '#6b7280');
                    return;
                }
                const hidden = this._getHiddenVideos();
                let newlyHidden = 0;
                videos.forEach(v => {
                    if (!hidden.includes(v.id)) {
                        hidden.push(v.id);
                        newlyHidden++;
                    }
                    v.element.classList.add('ytkit-video-hidden');
                });
                this._setHiddenVideos(hidden);
                this._showToast(`Hidden ${newlyHidden} videos`, [
                    { text: 'Undo All', onClick: () => this._undoHideAll(videos) },
                    { text: 'Manage', onClick: () => this._showManager() }
                ]);
            },

            // Undo hiding all videos
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

            // Create "Hide All" button for subscriptions page - placed in header next to VLC buttons
            _createSubsHideAllButton() {
                if (document.querySelector('.ytkit-subs-hide-all-btn')) return;
                if (window.location.pathname !== '/feed/subscriptions') return;

                // Find the header buttons container (same as VLC buttons)
                const headerButtons = document.querySelector('#masthead #end #buttons');
                if (!headerButtons) return;

                // Helper to create SVG elements
                const ns = 'http://www.w3.org/2000/svg';
                const createSvgElement = (tag, attrs) => {
                    const el = document.createElementNS(ns, tag);
                    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                    return el;
                };

                // Hide All button
                const hideAllBtn = document.createElement('button');
                hideAllBtn.className = 'ytkit-subs-hide-all-btn';
                hideAllBtn.title = 'Hide all visible videos on this page';

                // Eye-off SVG icon
                const svg = createSvgElement('svg', { viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
                svg.appendChild(createSvgElement('path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' }));
                svg.appendChild(createSvgElement('line', { x1: '1', y1: '1', x2: '23', y2: '23' }));
                hideAllBtn.appendChild(svg);

                const text = document.createElement('span');
                text.textContent = 'Hide All';
                hideAllBtn.appendChild(text);

                hideAllBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    border-radius: 20px;
                    border: none;
                    background: #dc2626;
                    color: white;
                    font-family: "Roboto", Arial, sans-serif;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                `;
                hideAllBtn.onmouseenter = () => { hideAllBtn.style.background = '#b91c1c'; };
                hideAllBtn.onmouseleave = () => { hideAllBtn.style.background = '#dc2626'; };
                hideAllBtn.addEventListener('click', () => this._hideAllVideos());

                // Insert before the VLC button if it exists, otherwise at the end
                const vlcBtn = headerButtons.querySelector('.ytkit-subs-vlc-btn');
                if (vlcBtn) {
                    headerButtons.insertBefore(hideAllBtn, vlcBtn);
                } else {
                    headerButtons.appendChild(hideAllBtn);
                }
            },

            _removeSubsHideAllButton() {
                document.querySelector('.ytkit-subs-hide-all-btn')?.remove();
            },

            init() {
                const css = `
                    .ytkit-video-hide-btn { position:absolute;top:8px;right:8px;width:28px;height:28px;background:rgba(0,0,0,0.8);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1000;opacity:0;transition:all 0.15s;padding:0; }
                    .ytkit-video-hide-btn:hover { background:rgba(200,0,0,0.9);transform:scale(1.1); }
                    .ytkit-video-hide-btn svg { width:16px;height:16px;fill:#fff;pointer-events:none; }
                    ytd-rich-item-renderer:hover .ytkit-video-hide-btn, ytd-video-renderer:hover .ytkit-video-hide-btn, ytd-grid-video-renderer:hover .ytkit-video-hide-btn, ytd-compact-video-renderer:hover .ytkit-video-hide-btn { opacity:1; }
                    .ytkit-video-hidden { display:none !important; }
                    #ytkit-hide-toast { position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(100px);background:#323232;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;z-index:99999;opacity:0;transition:all 0.3s;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3); }
                    #ytkit-hide-toast.show { transform:translateX(-50%) translateY(0);opacity:1; }
                    #ytkit-hide-toast button { background:transparent;border:none;color:#3ea6ff;cursor:pointer;font-size:14px;font-weight:500;padding:4px 8px;border-radius:4px; }
                    #ytkit-hide-toast button:hover { background:rgba(62,166,255,0.1); }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                this._processAllVideos();
                const selectors = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer';

                // Debounce for batch tracking
                let batchBuffer = [];
                let batchTimeout = null;
                // Store reference for clearing when blocking
                this._clearBatchBuffer = () => {
                    batchBuffer = [];
                    if (batchTimeout) {
                        clearTimeout(batchTimeout);
                        batchTimeout = null;
                    }
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
                    // Debounce batch processing to group rapid mutations
                    if (batchTimeout) clearTimeout(batchTimeout);
                    batchTimeout = setTimeout(processBatch, 300);
                });
                this._observer.observe(document.body, { childList: true, subtree: true });

                // Navigation handler for subscriptions page Hide All button
                let wasOnSubsPage = window.location.pathname === '/feed/subscriptions';
                const checkSubsPage = () => {
                    const isOnSubsPage = window.location.pathname === '/feed/subscriptions';
                    if (isOnSubsPage) {
                        // Only reset load state when ENTERING subscriptions page (not while staying on it)
                        if (!wasOnSubsPage) {
                            this._resetSubsLoadState();
                        }
                        setTimeout(() => this._createSubsHideAllButton(), 1000);
                    } else {
                        this._removeSubsHideAllButton();
                        this._removeLoadBlocker();
                    }
                    wasOnSubsPage = isOnSubsPage;
                };

                addNavigateRule('hideVideosFromHomeNav', () => {
                    setTimeout(() => this._processAllVideos(), 500);
                    checkSubsPage();
                });

                // Initial check for subscriptions page
                checkSubsPage();

                DebugManager.log('VideoHider', 'Initialized:', this._getHiddenVideos().length, 'videos,', this._getBlockedChannels().length, 'channels');
            },

            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                removeNavigateRule('hideVideosFromHomeNav');
                document.querySelectorAll('.ytkit-video-hide-btn').forEach(b => b.remove());
                document.querySelectorAll('.ytkit-video-hidden').forEach(e => e.classList.remove('ytkit-video-hidden'));
                document.querySelectorAll('[data-ytkit-hide-processed]').forEach(e => delete e.dataset.ytkitHideProcessed);
                document.getElementById('ytkit-hide-toast')?.remove();
                document.getElementById('ytkit-hide-manager')?.remove();
                document.getElementById('ytkit-hide-manager-overlay')?.remove();
                this._removeSubsHideAllButton();
                this._removeLoadBlocker();
            }
        },
        {
            id: 'cleanShareUrls',
            name: 'Clean Share URLs',
            description: 'Strip tracking params (si, pp, feature) from copied/shared YouTube links',
            group: 'Content',
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
        {
            id: 'fitPlayerToWindow',
            name: 'Fit to Window',
            description: 'Make the player fill your entire browser window',
            group: 'Video Player',
            icon: 'fullscreen',
            _styleElement: null,
            _ruleId: 'fitPlayerToWindowRule',
            applyStyles() {
                const isWatchPage = window.location.pathname.startsWith('/watch');
                document.documentElement.classList.toggle('yt-suite-fit-to-window', isWatchPage);
                document.body.classList.toggle('yt-suite-fit-to-window', isWatchPage);
                if (isWatchPage) {
                    setTimeout(() => {
                        const watchFlexy = document.querySelector('ytd-watch-flexy:not([theater])');
                        if (watchFlexy) document.querySelector('button.ytp-size-button')?.click();
                    }, 500);
                }
            },
            init() {
                this._styleElement = document.createElement('style');
                this._styleElement.id = `yt-suite-style-${this.id}`;
                this._styleElement.textContent = `
                    html.yt-suite-fit-to-window, body.yt-suite-fit-to-window { overflow-y: auto !important; height: auto !important; }
                    body.yt-suite-fit-to-window #movie_player { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100vh !important; z-index: 9999 !important; background-color: #000 !important; }
                    body.yt-suite-fit-to-window #movie_player .html5-video-container { width: 100% !important; height: 100% !important; }
                    body.yt-suite-fit-to-window #movie_player video.html5-main-video { width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
                    html.yt-suite-fit-to-window { padding-top: calc(100vh) !important; }
                    html.yt-suite-fit-to-window ytd-masthead { display: none !important; }
                    body.yt-suite-fit-to-window #page-manager { margin-top: 0 !important; }
                `;
                document.head.appendChild(this._styleElement);
                addNavigateRule(this._ruleId, () => this.applyStyles());
            },
            destroy() {
                document.documentElement.classList.remove('yt-suite-fit-to-window');
                document.body.classList.remove('yt-suite-fit-to-window');
                this._styleElement?.remove();
                removeNavigateRule(this._ruleId);
                if (document.querySelector('ytd-watch-flexy[theater]')) {
                    document.querySelector('button.ytp-size-button')?.click();
                }
            }
        },
        cssFeature('hideRelatedVideos', 'Hide Related Videos', 'Remove the related videos panel on watch pages', 'Video Player', 'panel-right',
            `ytd-watch-flexy #secondary { display: none !important; } ytd-watch-flexy #primary { max-width: none !important; }`, { isParent: true }),
        {
            id: 'expandVideoWidth',
            name: 'Expand Video Width',
            description: 'Stretch the video to fill the space when sidebar is hidden',
            group: 'Video Player',
            icon: 'arrows-horizontal',
            isSubFeature: true,
            parentId: 'hideRelatedVideos',
            _styleElement: null,
            init() {
                if (appState.settings.hideRelatedVideos) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = 'yt-suite-expand-width';
                    this._styleElement.textContent = `ytd-watch-flexy:not(.yt-suite-fit-to-window) #primary { max-width: none !important; }`;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'adaptiveLiveLayout',
            name: 'Adaptive Live Layout',
            description: 'Automatically adjust layout for live stream chat',
            group: 'Video Player',
            icon: 'cast',
            _ruleId: 'adaptiveLiveLayoutRule',
            _checkLive() {
                const isWatchPage = window.location.pathname.startsWith('/watch');
                const liveBadge = document.querySelector('.ytp-live-badge');
                const isLive = isWatchPage && liveBadge && window.getComputedStyle(liveBadge).display !== 'none';
                document.body.classList.toggle('ytkit-adaptive-live', isLive);
            },
            init() { addMutationRule(this._ruleId, () => this._checkLive()); },
            destroy() {
                removeMutationRule(this._ruleId);
                document.body.classList.remove('ytkit-adaptive-live');
            }
        },
        {
            id: 'floatingLogoOnWatch',
            name: 'YTKit Controls on Video',
            description: 'Show YouTube logo on watch pages. Choose overlay (on player hover) or inline (below video).',
            group: 'Video Player',
            icon: 'youtube',
            isParent: true,
            _ruleId: 'floatingLogoRule',
            _styleEl: null,
            _cleanup() {
                document.getElementById('ytkit-player-overlay')?.remove();
                document.getElementById('yt-suite-watch-logo')?.remove();
                this._styleEl?.remove();
                this._styleEl = null;
            },
            _getLogoHref() {
                return appState.settings.logoToSubscriptions ? '/feed/subscriptions' : '/';
            },
            _getLogoTitle() {
                return appState.settings.logoToSubscriptions ? 'Subscriptions' : 'YouTube Home';
            },
            _injectOverlay() {
                if (!window.location.pathname.startsWith('/watch')) { document.getElementById('ytkit-player-overlay')?.remove(); return; }
                const player = document.querySelector('#movie_player');
                if (!player || document.getElementById('ytkit-player-overlay')) return;

                const overlay = document.createElement('div');
                overlay.id = 'ytkit-player-overlay';

                // YouTube logo link
                const logoLink = document.createElement('a');
                logoLink.href = this._getLogoHref();
                logoLink.title = this._getLogoTitle();
                logoLink.className = 'ytkit-po-btn ytkit-po-logo';
                const originalLogo = document.querySelector('ytd-topbar-logo-renderer ytd-logo');
                if (originalLogo) {
                    const clone = originalLogo.cloneNode(true);
                    clone.style.cssText = 'display:flex;align-items:center;height:20px;';
                    const svgs = clone.querySelectorAll('svg');
                    svgs.forEach(s => { s.style.height = '20px'; s.style.width = 'auto'; });
                    logoLink.appendChild(clone);
                } else {
                    logoLink.textContent = 'YouTube';
                    logoLink.style.cssText += 'font-weight:700;font-size:14px;color:#fff;text-decoration:none;';
                }

                // Settings gear button
                const gearBtn = document.createElement('button');
                gearBtn.className = 'ytkit-po-btn ytkit-po-gear';
                gearBtn.title = 'YTKit Settings';
                const gearSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                gearSvg.setAttribute('viewBox', '0 0 24 24');
                gearSvg.setAttribute('width', '20');
                gearSvg.setAttribute('height', '20');
                gearSvg.setAttribute('fill', 'none');
                gearSvg.setAttribute('stroke', 'white');
                gearSvg.setAttribute('stroke-width', '2');
                gearSvg.setAttribute('stroke-linecap', 'round');
                gearSvg.setAttribute('stroke-linejoin', 'round');
                const gearPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                gearPath.setAttribute('d', 'M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z');
                const gearCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                gearCircle.setAttribute('cx', '12');
                gearCircle.setAttribute('cy', '12');
                gearCircle.setAttribute('r', '3');
                gearSvg.appendChild(gearPath);
                gearSvg.appendChild(gearCircle);
                gearBtn.appendChild(gearSvg);
                gearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.body.classList.toggle('ytkit-panel-open');
                });

                overlay.appendChild(logoLink);
                overlay.appendChild(gearBtn);
                player.appendChild(overlay);
            },
            _injectInline() {
                if (!window.location.pathname.startsWith('/watch')) { document.getElementById('yt-suite-watch-logo')?.remove(); return; }
                waitForElement('#top-row #owner', (ownerDiv) => {
                    if (document.getElementById('yt-suite-watch-logo')) return;

                    const container = document.createElement('div');
                    container.id = 'yt-suite-watch-logo';
                    container.style.cssText = 'display:flex;align-items:center;gap:12px;margin-right:12px;';

                    const link = document.createElement('a');
                    link.href = this._getLogoHref();
                    link.title = this._getLogoTitle();
                    link.style.cssText = 'display:flex;align-items:center;';
                    const originalLogo = document.querySelector('ytd-topbar-logo-renderer ytd-logo');
                    if (originalLogo) link.appendChild(originalLogo.cloneNode(true));
                    container.appendChild(link);

                    ownerDiv.prepend(container);
                });
            },
            init() {
                // Inject CSS for player overlay
                this._styleEl = GM_addStyle(`
                    #ytkit-player-overlay {
                        position: absolute;
                        top: 0;
                        left: 0;
                        display: flex;
                        align-items: center;
                        gap: 0;
                        padding: 0;
                        margin: 0;
                        padding-left: 0; padding-right: 0; padding-top: 0; padding-bottom: 0;
                        margin-left: 6px; margin-right: 0; margin-top: -12px; margin-bottom: 0;
                        background: rgba(0, 0, 0, 0.45);
                        backdrop-filter: blur(8px);
                        -webkit-backdrop-filter: blur(8px);
                        border: 1px solid rgba(255, 255, 255, 0.04);
                        border-radius: 0 0 6px 6px;
                        z-index: 59;
                        opacity: 0;
                        pointer-events: none;
                        transition: opacity 0.25s ease, margin-top 0.25s ease;
                    }
                    #movie_player:hover #ytkit-player-overlay {
                        opacity: 0.1;
                        pointer-events: auto;
                        margin-top: 0;
                    }
                    #ytkit-player-overlay:hover {
                        opacity: 1 !important;
                        pointer-events: auto;
                        margin-top: 0;
                    }
                    a.ytkit-po-btn.ytkit-po-logo {
                        padding-top: 0; padding-bottom: 0; padding-left: 0; padding-right: 0;
                        margin-top: 0; margin-bottom: 0; margin-right: 0; margin-left: 0;
                    }
                    button.ytkit-po-btn.ytkit-po-gear {
                        padding-top: 0; padding-bottom: 0; padding-left: 0; padding-right: 0;
                        margin-top: 0; margin-bottom: 0; margin-right: 0; margin-left: -7px;
                    }
                    #ytkit-player-overlay yt-icon span div {
                        padding: 0; margin: 0;
                        margin-left: -34px;
                    }
                    #ytkit-player-overlay yt-icon.style-scope.ytd-logo {
                        padding: 0; margin: 0;
                        margin-right: -12px;
                    }
                    .ytkit-po-btn {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 0;
                        border: none;
                        background: transparent;
                        cursor: pointer;
                        border-radius: 4px;
                        transition: background 0.2s;
                        text-decoration: none;
                        color: #fff;
                    }
                    .ytkit-po-btn:hover {
                        background: rgba(255, 255, 255, 0.15);
                    }
                    .ytkit-po-gear svg {
                        transition: transform 0.3s ease;
                    }
                    .ytkit-po-gear:hover svg {
                        transform: rotate(45deg);
                    }
                `);

                const self = this;
                const handler = () => {
                    // Always show inline below video
                    self._injectInline();
                    // Show overlay on player if enabled
                    if (appState.settings.playerOverlayControls) {
                        self._injectOverlay();
                    } else {
                        document.getElementById('ytkit-player-overlay')?.remove();
                    }
                };
                addNavigateRule(this._ruleId, handler);
            },
            destroy() {
                removeNavigateRule(this._ruleId);
                this._cleanup();
            }
        },
        {
            id: 'playerOverlayControls',
            name: 'Overlay on Player',
            description: 'Also show controls as hover overlay on video player (logo + gear always shown below video)',
            group: 'Video Player',
            icon: 'youtube',
            isSubFeature: true,
            parentId: 'floatingLogoOnWatch',
            init() {},
            destroy() {}
        },
        cssFeature('hideDescriptionRow', 'Hide Description', 'Remove the video description panel below the player', 'Video Player', 'file-minus',
            'ytd-watch-metadata #bottom-row'),
        {
            id: 'stickyVideo',
            name: 'Sticky Video',
            description: 'Float the video in the corner when scrolling down to read comments',
            group: 'Video Player',
            icon: 'picture-in-picture-2',
            pages: [PageTypes.WATCH],
            _styleElement: null,
            _scrollHandler: null,
            _isFloating: false,
            _manuallyDismissed: false,
            _lastVideoId: null,
            _floatThreshold: null,
            _lastActionTime: 0,
            _floatingContainer: null,
            _dragState: null,
            _originalVideoParent: null,
            _originalVideoNextSibling: null,
            _originalVideoStyle: null,
            _timeUpdateHandler: null,
            _playHandler: null,
            _pauseHandler: null,
            _volumeHandler: null,

            _getVideo() {
                return document.querySelector('video.html5-main-video');
            },

            _getPlayerAnchor() {
                return document.querySelector('#player-container');
            },

            _createFloatingContainer() {
                const container = document.createElement('div');
                container.id = 'ytkit-floating-video-container';

                // Helper to create SVG elements
                const createSvg = (width, height, viewBox) => {
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.setAttribute('width', width);
                    svg.setAttribute('height', height);
                    svg.setAttribute('viewBox', viewBox);
                    svg.setAttribute('fill', 'white');
                    return svg;
                };

                const createPath = (d) => {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', d);
                    return path;
                };

                // Controls overlay
                const controls = document.createElement('div');
                controls.id = 'ytkit-floating-controls';

                // Play/Pause button (center)
                const playPauseBtn = document.createElement('button');
                playPauseBtn.id = 'ytkit-floating-playpause';
                playPauseBtn.title = 'Play/Pause';

                // Play icon
                const playIcon = createSvg('40', '40', '0 0 24 24');
                playIcon.classList.add('play-icon');
                playIcon.appendChild(createPath('M8 5v14l11-7z'));

                // Pause icon
                const pauseIcon = createSvg('40', '40', '0 0 24 24');
                pauseIcon.classList.add('pause-icon');
                pauseIcon.appendChild(createPath('M6 19h4V5H6v14zm8-14v14h4V5h-4z'));

                playPauseBtn.appendChild(playIcon);
                playPauseBtn.appendChild(pauseIcon);

                playPauseBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const video = container.querySelector('video');
                    if (video) {
                        if (video.paused) {
                            video.play();
                        } else {
                            video.pause();
                        }
                    }
                };

                // Bottom bar (progress + volume)
                const bottomBar = document.createElement('div');
                bottomBar.id = 'ytkit-floating-bottombar';

                // Progress bar
                const progressContainer = document.createElement('div');
                progressContainer.id = 'ytkit-floating-progress-container';

                const progressBar = document.createElement('div');
                progressBar.id = 'ytkit-floating-progress';

                const progressFilled = document.createElement('div');
                progressFilled.id = 'ytkit-floating-progress-filled';

                const progressHandle = document.createElement('div');
                progressHandle.id = 'ytkit-floating-progress-handle';

                progressBar.appendChild(progressFilled);
                progressBar.appendChild(progressHandle);
                progressContainer.appendChild(progressBar);

                // Time display
                const timeDisplay = document.createElement('span');
                timeDisplay.id = 'ytkit-floating-time';
                timeDisplay.textContent = '0:00 / 0:00';

                // Volume control
                const volumeContainer = document.createElement('div');
                volumeContainer.id = 'ytkit-floating-volume-container';

                const volumeBtn = document.createElement('button');
                volumeBtn.id = 'ytkit-floating-volume-btn';

                // Volume high icon
                const volumeHighIcon = createSvg('20', '20', '0 0 24 24');
                volumeHighIcon.classList.add('volume-high');
                volumeHighIcon.appendChild(createPath('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'));

                // Volume muted icon
                const volumeMutedIcon = createSvg('20', '20', '0 0 24 24');
                volumeMutedIcon.classList.add('volume-muted');
                volumeMutedIcon.appendChild(createPath('M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z'));

                volumeBtn.appendChild(volumeHighIcon);
                volumeBtn.appendChild(volumeMutedIcon);

                volumeBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const video = container.querySelector('video');
                    if (video) {
                        video.muted = !video.muted;
                        this._updateVolumeUI(container);
                    }
                };

                const volumeSlider = document.createElement('input');
                volumeSlider.type = 'range';
                volumeSlider.id = 'ytkit-floating-volume-slider';
                volumeSlider.min = '0';
                volumeSlider.max = '1';
                volumeSlider.step = '0.05';
                volumeSlider.value = '1';
                volumeSlider.oninput = (e) => {
                    const video = container.querySelector('video');
                    if (video) {
                        video.volume = e.target.value;
                        video.muted = e.target.value == 0;
                        this._updateVolumeUI(container);
                    }
                };

                volumeContainer.appendChild(volumeBtn);
                volumeContainer.appendChild(volumeSlider);

                bottomBar.appendChild(progressContainer);
                bottomBar.appendChild(timeDisplay);
                bottomBar.appendChild(volumeContainer);

                controls.appendChild(playPauseBtn);
                controls.appendChild(bottomBar);

                // Close button
                const closeBtn = document.createElement('button');
                closeBtn.id = 'ytkit-floating-close';
                closeBtn.title = 'Close';

                const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                closeSvg.setAttribute('width', '14');
                closeSvg.setAttribute('height', '14');
                closeSvg.setAttribute('viewBox', '0 0 24 24');
                closeSvg.setAttribute('fill', 'none');
                closeSvg.setAttribute('stroke', 'currentColor');
                closeSvg.setAttribute('stroke-width', '2.5');

                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '18');
                line1.setAttribute('y1', '6');
                line1.setAttribute('x2', '6');
                line1.setAttribute('y2', '18');

                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '6');
                line2.setAttribute('y1', '6');
                line2.setAttribute('x2', '18');
                line2.setAttribute('y2', '18');

                closeSvg.appendChild(line1);
                closeSvg.appendChild(line2);
                closeBtn.appendChild(closeSvg);

                closeBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._manuallyDismissed = true;
                    this._unfloatVideo();
                };

                // Progress bar click handling
                progressContainer.onclick = (e) => {
                    e.stopPropagation();
                    const video = container.querySelector('video');
                    if (video && video.duration) {
                        const rect = progressBar.getBoundingClientRect();
                        const percent = (e.clientX - rect.left) / rect.width;
                        video.currentTime = percent * video.duration;
                    }
                };

                container.appendChild(controls);
                container.appendChild(closeBtn);

                // Resize handles
                const resizeHandle = document.createElement('div');
                resizeHandle.id = 'ytkit-floating-resize';
                resizeHandle.dataset.corner = 'br';
                container.appendChild(resizeHandle);

                const resizeHandleLeft = document.createElement('div');
                resizeHandleLeft.id = 'ytkit-floating-resize-left';
                resizeHandleLeft.dataset.corner = 'bl';
                container.appendChild(resizeHandleLeft);

                document.body.appendChild(container);
                this._initDrag(container);
                this._initResize(container, [resizeHandle, resizeHandleLeft]);
                return container;
            },

            _formatTime(seconds) {
                if (isNaN(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            },

            _updateProgress(container) {
                const video = container.querySelector('video');
                if (!video) return;

                const progressFilled = container.querySelector('#ytkit-floating-progress-filled');
                const progressHandle = container.querySelector('#ytkit-floating-progress-handle');
                const timeDisplay = container.querySelector('#ytkit-floating-time');

                if (video.duration) {
                    const percent = (video.currentTime / video.duration) * 100;
                    if (progressFilled) progressFilled.style.width = percent + '%';
                    if (progressHandle) progressHandle.style.left = percent + '%';
                    if (timeDisplay) {
                        timeDisplay.textContent = `${this._formatTime(video.currentTime)} / ${this._formatTime(video.duration)}`;
                    }
                }
            },

            _updatePlayPauseUI(container) {
                const video = container.querySelector('video');
                const btn = container.querySelector('#ytkit-floating-playpause');
                if (!video || !btn) return;

                if (video.paused) {
                    btn.classList.remove('playing');
                } else {
                    btn.classList.add('playing');
                }
            },

            _updateVolumeUI(container) {
                const video = container.querySelector('video');
                const btn = container.querySelector('#ytkit-floating-volume-btn');
                const slider = container.querySelector('#ytkit-floating-volume-slider');
                if (!video || !btn) return;

                if (video.muted || video.volume === 0) {
                    btn.classList.add('muted');
                } else {
                    btn.classList.remove('muted');
                }
                if (slider && !video.muted) {
                    slider.value = video.volume;
                }
            },

            _setupVideoListeners(video) {
                if (!this._floatingContainer) return;

                const container = this._floatingContainer;

                // Update progress
                this._timeUpdateHandler = () => this._updateProgress(container);
                video.addEventListener('timeupdate', this._timeUpdateHandler);

                // Update play/pause state
                this._playHandler = () => this._updatePlayPauseUI(container);
                this._pauseHandler = () => this._updatePlayPauseUI(container);
                video.addEventListener('play', this._playHandler);
                video.addEventListener('pause', this._pauseHandler);

                // Update volume
                this._volumeHandler = () => this._updateVolumeUI(container);
                video.addEventListener('volumechange', this._volumeHandler);

                // Initial state
                this._updatePlayPauseUI(container);
                this._updateVolumeUI(container);
                this._updateProgress(container);
            },

            _removeVideoListeners(video) {
                if (this._timeUpdateHandler) {
                    video.removeEventListener('timeupdate', this._timeUpdateHandler);
                }
                if (this._playHandler) {
                    video.removeEventListener('play', this._playHandler);
                }
                if (this._pauseHandler) {
                    video.removeEventListener('pause', this._pauseHandler);
                }
                if (this._volumeHandler) {
                    video.removeEventListener('volumechange', this._volumeHandler);
                }
            },

            _getSavedLayout() {
                try {
                    const saved = localStorage.getItem('ytkit-floating-layout');
                    if (saved) return JSON.parse(saved);
                } catch (e) {}
                try {
                    const pos = localStorage.getItem('ytkit-floating-pos');
                    if (pos) return JSON.parse(pos);
                } catch (e) {}
                return null;
            },

            _saveLayout(x, y, w, h) {
                try {
                    localStorage.setItem('ytkit-floating-layout', JSON.stringify({ x, y, w, h }));
                } catch (e) {}
            },

            _applyPosition(container) {
                const layout = this._getSavedLayout();
                if (layout) {
                    if (layout.w && layout.h) {
                        container.style.width = Math.max(240, Math.min(layout.w, window.innerWidth - 20)) + 'px';
                        container.style.height = Math.max(135, Math.min(layout.h, window.innerHeight - 20)) + 'px';
                    }
                    if (layout.x != null && layout.y != null) {
                        const maxX = window.innerWidth - container.offsetWidth;
                        const maxY = window.innerHeight - container.offsetHeight;
                        container.style.left = Math.max(0, Math.min(layout.x, maxX)) + 'px';
                        container.style.top = Math.max(0, Math.min(layout.y, maxY)) + 'px';
                        container.style.right = 'auto';
                    }
                }
            },

            _initDrag(container) {
                const onMouseDown = (e) => {
                    if (e.target.closest('button, input, #ytkit-floating-progress-container, #ytkit-floating-volume-container, #ytkit-floating-resize, #ytkit-floating-resize-left')) return;
                    e.preventDefault();
                    const rect = container.getBoundingClientRect();
                    this._dragState = {
                        startX: e.clientX,
                        startY: e.clientY,
                        origLeft: rect.left,
                        origTop: rect.top,
                        dragged: false
                    };
                };

                const onMouseMove = (e) => {
                    if (!this._dragState) return;
                    const dx = e.clientX - this._dragState.startX;
                    const dy = e.clientY - this._dragState.startY;
                    if (!this._dragState.dragged && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                    this._dragState.dragged = true;
                    const maxX = window.innerWidth - container.offsetWidth;
                    const maxY = window.innerHeight - container.offsetHeight;
                    const newX = Math.max(0, Math.min(this._dragState.origLeft + dx, maxX));
                    const newY = Math.max(0, Math.min(this._dragState.origTop + dy, maxY));
                    container.style.left = newX + 'px';
                    container.style.top = newY + 'px';
                    container.style.right = 'auto';
                    container.style.transition = 'none';
                };

                const onMouseUp = () => {
                    if (!this._dragState) return;
                    if (this._dragState.dragged) {
                        const rect = container.getBoundingClientRect();
                        this._saveLayout(rect.left, rect.top, rect.width, rect.height);
                    }
                    container.style.transition = '';
                    this._dragState = null;
                };

                container.addEventListener('mousedown', onMouseDown);
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);

                this._dragCleanup = () => {
                    container.removeEventListener('mousedown', onMouseDown);
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };
            },

            _initResize(container, handles) {
                let resizeState = null;

                const onMouseDown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = container.getBoundingClientRect();
                    resizeState = {
                        corner: e.target.dataset.corner,
                        startX: e.clientX,
                        startY: e.clientY,
                        origW: rect.width,
                        origH: rect.height,
                        origLeft: rect.left
                    };
                    container.style.transition = 'none';
                };

                const onMouseMove = (e) => {
                    if (!resizeState) return;
                    const dh = e.clientY - resizeState.startY;
                    const newH = Math.max(135, Math.min(resizeState.origH + dh, window.innerHeight - container.offsetTop));

                    if (resizeState.corner === 'bl') {
                        const dw = resizeState.startX - e.clientX;
                        const newW = Math.max(240, Math.min(resizeState.origW + dw, resizeState.origLeft + resizeState.origW));
                        const newLeft = resizeState.origLeft + (resizeState.origW - newW);
                        container.style.width = newW + 'px';
                        container.style.left = Math.max(0, newLeft) + 'px';
                        container.style.right = 'auto';
                    } else {
                        const dw = e.clientX - resizeState.startX;
                        const newW = Math.max(240, Math.min(resizeState.origW + dw, window.innerWidth - container.offsetLeft));
                        container.style.width = newW + 'px';
                    }
                    container.style.height = newH + 'px';
                };

                const onMouseUp = () => {
                    if (!resizeState) return;
                    resizeState = null;
                    container.style.transition = '';
                    const rect = container.getBoundingClientRect();
                    this._saveLayout(rect.left, rect.top, rect.width, rect.height);
                };

                handles.forEach(h => h.addEventListener('mousedown', onMouseDown));
                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);

                this._resizeCleanup = () => {
                    handles.forEach(h => h.removeEventListener('mousedown', onMouseDown));
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                };
            },

            _floatVideo() {
                if (this._isFloating || this._manuallyDismissed) return;
                if (Date.now() - this._lastActionTime < 500) return;

                const video = this._getVideo();
                if (!video) {
                    DebugManager.log('Sticky', 'No video element');
                    return;
                }

                // Create floating container if needed
                if (!this._floatingContainer) {
                    this._floatingContainer = this._createFloatingContainer();
                }

                // Store original position and styles
                this._originalVideoParent = video.parentElement;
                this._originalVideoNextSibling = video.nextSibling;
                this._originalVideoStyle = video.getAttribute('style') || '';
                this._floatThreshold = window.scrollY;

                // Move video to floating container (insert before controls)
                const controls = this._floatingContainer.querySelector('#ytkit-floating-controls');
                this._floatingContainer.insertBefore(video, controls);
                this._floatingContainer.classList.add('ytkit-floating-visible');
                this._applyPosition(this._floatingContainer);

                // Force video to fill container
                video.style.cssText = 'width:100%!important;height:100%!important;left:0!important;top:0!important;position:absolute!important;object-fit:contain!important;';

                // Setup event listeners for controls
                this._setupVideoListeners(video);

                this._isFloating = true;
                this._lastActionTime = Date.now();
                DebugManager.log('Sticky', 'Floated video');
            },

            _unfloatVideo() {
                if (!this._isFloating) return;

                const video = this._floatingContainer?.querySelector('video');

                if (video) {
                    // Remove our event listeners
                    this._removeVideoListeners(video);

                    if (this._originalVideoParent) {
                        // Restore video to original position
                        if (this._originalVideoNextSibling && this._originalVideoNextSibling.parentElement === this._originalVideoParent) {
                            this._originalVideoParent.insertBefore(video, this._originalVideoNextSibling);
                        } else {
                            this._originalVideoParent.appendChild(video);
                        }

                        // Restore original styles
                        if (this._originalVideoStyle) {
                            video.setAttribute('style', this._originalVideoStyle);
                        } else {
                            video.removeAttribute('style');
                        }
                    }
                }

                if (this._floatingContainer) {
                    this._floatingContainer.classList.remove('ytkit-floating-visible');
                }

                this._originalVideoParent = null;
                this._originalVideoNextSibling = null;
                this._originalVideoStyle = null;
                this._isFloating = false;
                this._floatThreshold = null;
                this._lastActionTime = Date.now();
                DebugManager.log('Sticky', 'Unfloated video');
            },

            _checkScroll() {
                if (!window.location.pathname.startsWith('/watch')) {
                    if (this._isFloating) this._unfloatVideo();
                    return;
                }

                const currentVideoId = new URLSearchParams(window.location.search).get('v');
                if (currentVideoId !== this._lastVideoId) {
                    this._lastVideoId = currentVideoId;
                    this._manuallyDismissed = false;
                    this._floatThreshold = null;
                    if (this._isFloating) this._unfloatVideo();
                    return;
                }

                const anchor = this._getPlayerAnchor();
                if (!anchor) return;

                const rect = anchor.getBoundingClientRect();

                // If floating, check if we should unfloat
                if (this._isFloating) {
                    // Only unfloat when scrolled significantly back up
                    if (this._floatThreshold !== null && window.scrollY < this._floatThreshold - 200) {
                        DebugManager.log('Sticky', 'Scrolled back up, unfloating', window.scrollY);
                        this._unfloatVideo();
                    }
                    return;
                }

                // Not floating - check if we should float
                if (this._manuallyDismissed) {
                    if (rect.top > 0) {
                        this._manuallyDismissed = false;
                    }
                    return;
                }

                if (rect.bottom < 100) {
                    DebugManager.log('Sticky', 'Floating', rect.bottom);
                    this._floatVideo();
                }
            },

            init() {
                const css = `
                    #ytkit-floating-video-container {
                        position: fixed;
                        top: 70px;
                        right: 20px;
                        width: 400px;
                        height: 225px;
                        z-index: 2147483647;
                        border-radius: 12px;
                        overflow: hidden;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1);
                        background: #000;
                        display: none;
                        cursor: grab;
                        user-select: none;
                    }

                    #ytkit-floating-video-container:active {
                        cursor: grabbing;
                    }

                    #ytkit-floating-video-container.ytkit-floating-visible {
                        display: block;
                    }

                    #ytkit-floating-video-container:hover {
                        box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.2);
                    }

                    #ytkit-floating-video-container video {
                        width: 100% !important;
                        height: 100% !important;
                        object-fit: contain !important;
                    }

                    /* Controls overlay */
                    #ytkit-floating-controls {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        opacity: 0;
                        transition: opacity 0.2s;
                        pointer-events: none;
                        z-index: 10;
                    }

                    #ytkit-floating-video-container:hover #ytkit-floating-controls {
                        opacity: 1;
                    }

                    /* Play/Pause button */
                    #ytkit-floating-playpause {
                        width: 60px;
                        height: 60px;
                        border-radius: 50%;
                        background: rgba(0,0,0,0.6);
                        border: none;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: background 0.2s, transform 0.1s;
                        pointer-events: auto;
                    }

                    #ytkit-floating-playpause:hover {
                        background: rgba(0,0,0,0.8);
                        transform: scale(1.1);
                    }

                    #ytkit-floating-playpause .play-icon {
                        display: block;
                    }
                    #ytkit-floating-playpause .pause-icon {
                        display: none;
                    }
                    #ytkit-floating-playpause.playing .play-icon {
                        display: none;
                    }
                    #ytkit-floating-playpause.playing .pause-icon {
                        display: block;
                    }

                    /* Bottom bar */
                    #ytkit-floating-bottombar {
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        padding: 8px 12px;
                        background: linear-gradient(transparent, rgba(0,0,0,0.8));
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        pointer-events: auto;
                    }

                    /* Progress bar */
                    #ytkit-floating-progress-container {
                        flex: 1;
                        height: 20px;
                        display: flex;
                        align-items: center;
                        cursor: pointer;
                    }

                    #ytkit-floating-progress {
                        width: 100%;
                        height: 4px;
                        background: rgba(255,255,255,0.3);
                        border-radius: 2px;
                        position: relative;
                        transition: height 0.1s;
                    }

                    #ytkit-floating-progress-container:hover #ytkit-floating-progress {
                        height: 6px;
                    }

                    #ytkit-floating-progress-filled {
                        height: 100%;
                        background: #ff0000;
                        border-radius: 2px;
                        width: 0%;
                        position: absolute;
                        top: 0;
                        left: 0;
                    }

                    #ytkit-floating-progress-handle {
                        width: 12px;
                        height: 12px;
                        background: #ff0000;
                        border-radius: 50%;
                        position: absolute;
                        top: 50%;
                        left: 0%;
                        transform: translate(-50%, -50%) scale(0);
                        transition: transform 0.1s;
                    }

                    #ytkit-floating-progress-container:hover #ytkit-floating-progress-handle {
                        transform: translate(-50%, -50%) scale(1);
                    }

                    /* Time display */
                    #ytkit-floating-time {
                        color: white;
                        font-size: 11px;
                        font-family: 'YouTube Sans', 'Roboto', sans-serif;
                        white-space: nowrap;
                        min-width: 75px;
                        text-align: center;
                    }

                    /* Volume control */
                    #ytkit-floating-volume-container {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    }

                    #ytkit-floating-volume-btn {
                        background: none;
                        border: none;
                        cursor: pointer;
                        padding: 4px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0.9;
                        transition: opacity 0.2s;
                    }

                    #ytkit-floating-volume-btn:hover {
                        opacity: 1;
                    }

                    #ytkit-floating-volume-btn .volume-high {
                        display: block;
                    }
                    #ytkit-floating-volume-btn .volume-muted {
                        display: none;
                    }
                    #ytkit-floating-volume-btn.muted .volume-high {
                        display: none;
                    }
                    #ytkit-floating-volume-btn.muted .volume-muted {
                        display: block;
                    }

                    #ytkit-floating-volume-slider {
                        width: 0;
                        opacity: 0;
                        transition: width 0.2s, opacity 0.2s;
                        cursor: pointer;
                        accent-color: white;
                        height: 4px;
                    }

                    #ytkit-floating-volume-container:hover #ytkit-floating-volume-slider {
                        width: 60px;
                        opacity: 1;
                    }

                    /* Close button */
                    #ytkit-floating-close {
                        position: absolute;
                        top: 8px;
                        right: 8px;
                        width: 28px;
                        height: 28px;
                        border-radius: 50%;
                        background: rgba(0,0,0,0.75);
                        border: none;
                        color: white;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        opacity: 0;
                        transition: opacity 0.2s, background 0.2s;
                        z-index: 20;
                    }

                    #ytkit-floating-video-container:hover #ytkit-floating-close {
                        opacity: 1;
                    }

                    #ytkit-floating-close:hover {
                        background: rgba(220,38,38,0.9);
                    }

                    /* Resize handles */
                    #ytkit-floating-resize, #ytkit-floating-resize-left {
                        position: absolute;
                        bottom: 0;
                        width: 18px;
                        height: 18px;
                        z-index: 25;
                        background: transparent;
                    }
                    #ytkit-floating-resize { right: 0; cursor: nwse-resize; }
                    #ytkit-floating-resize-left { left: 0; cursor: nesw-resize; }
                    #ytkit-floating-resize::after, #ytkit-floating-resize-left::after {
                        content: '';
                        position: absolute;
                        bottom: 3px;
                        width: 8px;
                        height: 8px;
                        opacity: 0;
                        transition: opacity 0.2s;
                    }
                    #ytkit-floating-resize::after {
                        right: 3px;
                        border-right: 2px solid rgba(255,255,255,0.4);
                        border-bottom: 2px solid rgba(255,255,255,0.4);
                    }
                    #ytkit-floating-resize-left::after {
                        left: 3px;
                        border-left: 2px solid rgba(255,255,255,0.4);
                        border-bottom: 2px solid rgba(255,255,255,0.4);
                    }
                    #ytkit-floating-video-container:hover #ytkit-floating-resize::after,
                    #ytkit-floating-video-container:hover #ytkit-floating-resize-left::after {
                        opacity: 1;
                    }

                    @media (max-width: 1200px) {
                        #ytkit-floating-video-container {
                            width: 320px;
                            height: 180px;
                        }
                        #ytkit-floating-playpause {
                            width: 50px;
                            height: 50px;
                        }
                        #ytkit-floating-playpause svg {
                            width: 30px;
                            height: 30px;
                        }
                        #ytkit-floating-time {
                            font-size: 10px;
                            min-width: 65px;
                        }
                    }

                    @media (max-width: 768px) {
                        #ytkit-floating-video-container {
                            width: 280px;
                            height: 158px;
                            top: auto;
                            bottom: 70px;
                            right: 10px;
                        }
                        #ytkit-floating-playpause {
                            width: 44px;
                            height: 44px;
                        }
                        #ytkit-floating-playpause svg {
                            width: 26px;
                            height: 26px;
                        }
                        #ytkit-floating-bottombar {
                            padding: 6px 8px;
                            gap: 6px;
                        }
                        #ytkit-floating-time {
                            display: none;
                        }
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);

                // Scroll handler
                let scrollTimeout = null;
                this._scrollHandler = () => {
                    if (scrollTimeout) return;
                    scrollTimeout = setTimeout(() => {
                        scrollTimeout = null;
                        this._checkScroll();
                    }, 150);
                };

                window.addEventListener('scroll', this._scrollHandler, { passive: true });

                setTimeout(() => {
                    DebugManager.log('Sticky', 'Init complete');
                }, 1000);

                DebugManager.log('Sticky', 'Sticky Video initialized');
            },

            destroy() {
                this._unfloatVideo();
                this._styleElement?.remove();
                this._dragCleanup?.();
                this._resizeCleanup?.();

                if (this._floatingContainer) {
                    this._floatingContainer.remove();
                    this._floatingContainer = null;
                }

                if (this._scrollHandler) {
                    window.removeEventListener('scroll', this._scrollHandler);
                }
            }
        },
        // ─── Playback ───
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
                document.addEventListener('yt-navigate-finish', this._navHandler);
                setTimeout(pauseRule, 500);
            },
            destroy() {
                if (this._navHandler) {
                    document.removeEventListener('yt-navigate-finish', this._navHandler);
                    this._navHandler = null;
                }
            }
        },
        {
            id: 'autoExpandDescription',
            name: 'Auto-Expand Description',
            description: 'Automatically show the full video description',
            group: 'Playback',
            icon: 'chevrons-down',
            init() {
                const expandRule = () => {
                    if (window.location.pathname.startsWith('/watch')) {
                        document.querySelector('ytd-text-inline-expander tp-yt-paper-button#expand')?.click();
                    }
                };
                addNavigateRule(this.id, expandRule);
            },
            destroy() { removeNavigateRule(this.id); }
        },
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
                            requestAnimationFrame(() => {
                                continuation.style.cssText = orig;
                            });
                        });
                    };
                    setTimeout(() => tryPreload(), 1500);
                };
                addNavigateRule(this.id, preloadRule);
            },
            destroy() { removeNavigateRule(this.id); }
        },
        {
            id: 'sortCommentsNewestFirst',
            name: 'Newest Comments First',
            description: 'Sort comments by newest instead of top',
            group: 'Playback',
            icon: 'clock',
            init() {
                const sortRule = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const commentsSection = document.querySelector('ytd-comments#comments');
                    if (!commentsSection || commentsSection.textContent.includes('Comments are turned off')) return;
                    const sortButton = commentsSection.querySelector('yt-sort-filter-sub-menu-renderer');
                    if (sortButton && !sortButton.hasAttribute('data-suite-sorted')) {
                        sortButton.querySelector('yt-dropdown-menu tp-yt-paper-button')?.click();
                        setTimeout(() => {
                            const menuItems = document.querySelectorAll('tp-yt-paper-listbox a.yt-simple-endpoint');
                            const newestOption = Array.from(menuItems).find(item => item.textContent.trim() === 'Newest first');
                            if (newestOption) {
                                newestOption.click();
                                sortButton.setAttribute('data-suite-sorted', 'true');
                            } else {
                                document.body.click();
                            }
                        }, 200);
                    }
                };
                addNavigateRule(this.id, sortRule);
            },
            destroy() { removeNavigateRule(this.id); }
        },
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
        {
            id: 'chronologicalNotifications',
            name: 'Sort Notifications',
            description: 'Sort notifications chronologically (newest first)',
            group: 'Playback',
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
            destroy() { this._observer?.disconnect(); }
        },
        {
            id: 'reversePlaylist',
            name: 'Reverse Playlist',
            description: 'Add a button to reverse the order of the current playlist',
            group: 'Playback',
            icon: 'arrow-down-up',
            _ruleId: 'reversePlaylistRule',
            _injectButton() {
                if (document.getElementById('ytkit-reverse-playlist')) return;
                const header = document.querySelector('ytd-playlist-panel-renderer #header-contents, ytd-playlist-panel-renderer .header');
                if (!header) return;
                const btn = document.createElement('button');
                btn.id = 'ytkit-reverse-playlist';
                btn.title = 'Reverse playlist order';
                btn.textContent = '\u21C5';
                btn.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;margin-left:8px;';
                btn.addEventListener('click', () => {
                    const items = document.querySelector('ytd-playlist-panel-renderer #items');
                    if (!items) return;
                    const children = [...items.children];
                    children.reverse().forEach(c => items.appendChild(c));
                    showToast('Playlist reversed', '#22c55e');
                });
                header.appendChild(btn);
            },
            init() { addMutationRule(this._ruleId, () => this._injectButton()); },
            destroy() {
                removeMutationRule(this._ruleId);
                document.getElementById('ytkit-reverse-playlist')?.remove();
            }
        },

        // ─── Playback Enhancements ───
        {
            id: 'playbackSpeedPresets',
            name: 'Speed Presets',
            description: 'Quick buttons for 1.25x, 1.5x, 1.75x, 2x speeds on the player',
            group: 'Playback',
            icon: 'gauge',
            isParent: true,
            _styleElement: null,
            _container: null,

            _createSpeedButton(speed, isActive) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-speed-btn' + (isActive ? ' active' : '');
                btn.textContent = speed === 1 ? '1x' : speed + 'x';
                btn.dataset.speed = speed;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const video = document.querySelector('video.html5-main-video');
                    if (video) {
                        video.playbackRate = speed;
                        document.querySelectorAll('.ytkit-speed-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        // Save as default or per-channel
                        if (appState.settings.rememberPlaybackSpeed) {
                            const channelId = this._getCurrentChannelId();
                            if (channelId) {
                                appState.settings.channelPlaybackSpeeds[channelId] = speed;
                                settingsManager.save(appState.settings);
                            }
                        } else {
                            // Save as global default
                            appState.settings.defaultPlaybackSpeed = speed;
                            settingsManager.save(appState.settings);
                        }
                    }
                };
                return btn;
            },

            _getCurrentChannelId() {
                const link = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner a');
                if (!link) return null;
                const match = link.href.match(/\/@([^/?]+)|\/channel\/([^/?]+)/);
                return match ? (match[1] || match[2]) : null;
            },

            _applySpeed(video) {
                let targetSpeed = appState.settings.defaultPlaybackSpeed || 1;

                // Check for per-channel override
                if (appState.settings.rememberPlaybackSpeed) {
                    const channelId = this._getCurrentChannelId();
                    const channelSpeed = appState.settings.channelPlaybackSpeeds?.[channelId];
                    if (channelSpeed) targetSpeed = channelSpeed;
                }

                video.playbackRate = targetSpeed;
                document.querySelectorAll('.ytkit-speed-btn').forEach(b => {
                    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - targetSpeed) < 0.01);
                });
            },

            _injectSpeedControls() {
                if (!window.location.pathname.startsWith('/watch')) return;
                if (document.querySelector('.ytkit-speed-controls')) return;

                const player = document.querySelector('.ytp-right-controls');
                if (!player) return;

                const container = document.createElement('div');
                container.className = 'ytkit-speed-controls';

                const defaultSpeed = appState.settings.defaultPlaybackSpeed || 1;

                [1, 1.25, 1.5, 1.75, 2].forEach(speed => {
                    container.appendChild(this._createSpeedButton(speed, Math.abs(defaultSpeed - speed) < 0.01));
                });

                player.insertBefore(container, player.firstChild);
                this._container = container;

                // Apply speed after a short delay
                const video = document.querySelector('video.html5-main-video');
                if (video) {
                    setTimeout(() => this._applySpeed(video), 500);
                }
            },

            init() {
                const css = `
                    .ytkit-speed-controls { display:flex;align-items:center;gap:2px;margin-right:8px; }
                    .ytkit-speed-btn { background:rgba(255,255,255,0.1);border:none;color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;cursor:pointer;transition:all 0.15s;font-weight:500; }
                    .ytkit-speed-btn:hover { background:rgba(255,255,255,0.2); }
                    .ytkit-speed-btn.active { background:#c00;color:#fff; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                addNavigateRule(this.id, () => setTimeout(() => this._injectSpeedControls(), 1000));
                setTimeout(() => this._injectSpeedControls(), 1000);
            },

            destroy() {
                this._styleElement?.remove();
                removeNavigateRule(this.id);
                document.querySelector('.ytkit-speed-controls')?.remove();
            }
        },
        {
            id: 'rememberPlaybackSpeed',
            name: 'Per-Channel Speed Override',
            description: 'Override default speed with per-channel preferences (otherwise uses global default)',
            group: 'Playback',
            icon: 'brain',
            isSubFeature: true,
            parentId: 'playbackSpeedPresets',
            init() { /* Handled by parent */ },
            destroy() { /* Handled by parent */ }
        },
        // REMOVED: Return YouTube Dislike - API dependency removed for performance
        {
            id: 'showWatchProgress',
            name: 'Watch Progress Indicator',
            description: 'Show which videos you\'ve partially watched with a red progress bar',
            group: 'Playback',
            icon: 'progress',
            _styleElement: null,
            _observer: null,
            _STORAGE_KEY: 'ytkit-watch-progress',

            _getProgress() {
                try { return GM_getValue(this._STORAGE_KEY, {}); }
                catch { const s = localStorage.getItem(this._STORAGE_KEY); return s ? JSON.parse(s) : {}; }
            },
            _setProgress(data) {
                try { GM_setValue(this._STORAGE_KEY, data); }
                catch { localStorage.setItem(this._STORAGE_KEY, JSON.stringify(data)); }
            },

            _trackProgress() {
                if (!window.location.pathname.startsWith('/watch')) return;
                const video = document.querySelector('video.html5-main-video');
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!video || !videoId) return;

                // Remove previous handlers if any (prevents stacking on SPA nav)
                if (this._progressHandlers) {
                    const prev = this._progressHandlers;
                    prev.video.removeEventListener('timeupdate', prev.handler);
                    prev.video.removeEventListener('pause', prev.handler);
                }

                const saveProgress = () => {
                    if (video.duration > 0) {
                        const percent = (video.currentTime / video.duration) * 100;
                        if (percent > 5 && percent < 95) {
                            const progress = this._getProgress();
                            progress[videoId] = Math.round(percent);
                            this._setProgress(progress);
                        } else if (percent >= 95) {
                            const progress = this._getProgress();
                            delete progress[videoId];
                            this._setProgress(progress);
                        }
                    }
                };
                video.addEventListener('timeupdate', saveProgress);
                video.addEventListener('pause', saveProgress);
                this._progressHandlers = { video, handler: saveProgress };
            },

            _showProgressBars() {
                const progress = this._getProgress();
                document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer').forEach(el => {
                    if (el.dataset.ytkitProgressProcessed) return;
                    el.dataset.ytkitProgressProcessed = 'true';

                    const link = el.querySelector('a[href*="/watch?v="]');
                    if (!link) return;
                    const match = link.href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
                    if (!match) return;
                    const videoId = match[1];
                    const percent = progress[videoId];
                    if (!percent) return;

                    const thumbnail = el.querySelector('#thumbnail, ytd-thumbnail, .ytd-thumbnail');
                    if (!thumbnail || thumbnail.querySelector('.ytkit-progress-bar')) return;

                    const bar = document.createElement('div');
                    bar.className = 'ytkit-progress-bar';
                    bar.style.width = percent + '%';
                    thumbnail.style.position = 'relative';
                    thumbnail.appendChild(bar);
                });
            },

            init() {
                const css = `
                    .ytkit-progress-bar { position:absolute;bottom:0;left:0;height:3px;background:#c00;z-index:100;pointer-events:none; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                this._trackProgress();
                this._showProgressBars();
                addMutationRule(this.id + '_bars', () => this._showProgressBars());
                addNavigateRule(this.id, () => { this._trackProgress(); this._showProgressBars(); });
            },

            destroy() {
                this._styleElement?.remove();
                removeMutationRule(this.id + '_bars');
                removeNavigateRule(this.id);
                if (this._progressHandlers) {
                    const prev = this._progressHandlers;
                    prev.video.removeEventListener('timeupdate', prev.handler);
                    prev.video.removeEventListener('pause', prev.handler);
                    this._progressHandlers = null;
                }
                document.querySelectorAll('.ytkit-progress-bar').forEach(b => b.remove());
            }
        },
        {
            id: 'timestampBookmarks',
            name: 'Timestamp Bookmarks',
            description: 'Save bookmarks at specific timestamps (Shift+B to bookmark)',
            group: 'Playback',
            icon: 'bookmark',
            _styleElement: null,
            _STORAGE_KEY: 'ytkit-timestamp-bookmarks',

            _getBookmarks() {
                try { return GM_getValue(this._STORAGE_KEY, {}); }
                catch { const s = localStorage.getItem(this._STORAGE_KEY); return s ? JSON.parse(s) : {}; }
            },
            _setBookmarks(data) {
                try { GM_setValue(this._STORAGE_KEY, data); }
                catch { localStorage.setItem(this._STORAGE_KEY, JSON.stringify(data)); }
            },

            _formatTime(seconds) {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);
                return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
            },

            _addBookmark() {
                const video = document.querySelector('video.html5-main-video');
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!video || !videoId) return;

                const time = Math.floor(video.currentTime);
                const bookmarks = this._getBookmarks();
                if (!bookmarks[videoId]) bookmarks[videoId] = [];
                if (!bookmarks[videoId].includes(time)) {
                    bookmarks[videoId].push(time);
                    bookmarks[videoId].sort((a, b) => a - b);
                    this._setBookmarks(bookmarks);
                    this._renderBookmarks();
                    showToast('Bookmark saved at ' + this._formatTime(time), '#22c55e');
                }
            },

            _renderBookmarks() {
                const videoId = new URLSearchParams(window.location.search).get('v');
                const bookmarks = this._getBookmarks()[videoId] || [];

                let container = document.querySelector('.ytkit-bookmarks-container');
                if (bookmarks.length === 0) { container?.remove(); return; }

                if (!container) {
                    container = document.createElement('div');
                    container.className = 'ytkit-bookmarks-container';
                    const descArea = document.querySelector('#bottom-row, ytd-watch-metadata #description');
                    if (descArea) descArea.parentElement.insertBefore(container, descArea);
                }

                container.textContent = '';
                const title = document.createElement('span');
                title.className = 'ytkit-bookmarks-title';
                title.textContent = 'Bookmarks:';
                container.appendChild(title);

                bookmarks.forEach(time => {
                    const btn = document.createElement('button');
                    btn.className = 'ytkit-bookmark-btn';
                    btn.textContent = this._formatTime(time);
                    btn.onclick = () => {
                        const video = document.querySelector('video.html5-main-video');
                        if (video) video.currentTime = time;
                    };
                    btn.oncontextmenu = (e) => {
                        e.preventDefault();
                        const bm = this._getBookmarks();
                        bm[videoId] = bm[videoId].filter(t => t !== time);
                        if (bm[videoId].length === 0) delete bm[videoId];
                        this._setBookmarks(bm);
                        this._renderBookmarks();
                    };
                    container.appendChild(btn);
                });

                // Export button
                const exportBtn = document.createElement('button');
                exportBtn.className = 'ytkit-bookmark-btn';
                exportBtn.style.cssText = 'background:#1a365d;margin-left:auto;';
                exportBtn.textContent = '\u2197 Copy';
                exportBtn.title = 'Copy bookmarks as YouTube comment timestamps';
                exportBtn.onclick = () => {
                    const lines = bookmarks.map(t => this._formatTime(t));
                    navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('Bookmarks copied', '#22c55e'));
                };
                container.appendChild(exportBtn);
                // Export all as JSON
                const exportAllBtn = document.createElement('button');
                exportAllBtn.className = 'ytkit-bookmark-btn';
                exportAllBtn.style.cssText = 'background:#1a365d;';
                exportAllBtn.textContent = '\u21E9 JSON';
                exportAllBtn.title = 'Export all bookmarks as JSON';
                exportAllBtn.onclick = () => {
                    const all = this._getBookmarks();
                    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'ytkit-bookmarks.json';
                    a.click();
                    showToast('Bookmarks exported', '#22c55e');
                };
                container.appendChild(exportAllBtn);
            },

            _keyHandler(e) {
                if (e.shiftKey && e.key === 'B' && !e.target.matches('input, textarea, [contenteditable]')) {
                    e.preventDefault();
                    this._addBookmark();
                }
            },

            init() {
                const css = `
                    .ytkit-bookmarks-container { display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 0;margin-bottom:12px;border-bottom:1px solid #333; }
                    .ytkit-bookmarks-title { color:#aaa;font-size:13px;font-weight:500; }
                    .ytkit-bookmark-btn { background:#333;border:none;color:#fff;padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer;transition:background 0.15s; }
                    .ytkit-bookmark-btn:hover { background:#c00; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                this._boundKeyHandler = this._keyHandler.bind(this);
                document.addEventListener('keydown', this._boundKeyHandler);
                addNavigateRule(this.id, () => setTimeout(() => this._renderBookmarks(), 1000));
            },

            destroy() {
                this._styleElement?.remove();
                document.removeEventListener('keydown', this._boundKeyHandler);
                removeNavigateRule(this.id);
                document.querySelector('.ytkit-bookmarks-container')?.remove();
            }
        },
        {
            id: 'returnYouTubeDislike',
            name: 'Return YouTube Dislike',
            description: 'Show community-sourced dislike counts via returnyoutubedislike.com API',
            group: 'Playback',
            icon: 'thumbs-down',
            _currentVideoId: null,
            _ruleId: 'returnDislikeRule',
            async _fetchDislikes(videoId) {
                try {
                    return new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: `https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`,
                            onload: (res) => {
                                try { resolve(JSON.parse(res.responseText)); } catch { reject(); }
                            },
                            onerror: reject
                        });
                    });
                } catch { return null; }
            },
            _formatCount(n) {
                if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
                if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
                if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
                return String(n);
            },
            async _updateDislikeCount() {
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId || videoId === this._currentVideoId) return;
                this._currentVideoId = videoId;
                const data = await this._fetchDislikes(videoId);
                if (!data || data.dislikes === undefined) return;
                // Wait for dislike button to appear (race condition fix)
                const injectCount = () => {
                    const seg = document.querySelector('ytd-segmented-like-dislike-button-renderer');
                    if (!seg) return false;
                    let countEl = seg.querySelector('#ytkit-dislike-count');
                    if (!countEl) {
                        countEl = document.createElement('span');
                        countEl.id = 'ytkit-dislike-count';
                        countEl.style.cssText = 'font-size:12px;color:var(--yt-spec-text-secondary);margin-left:4px;';
                        const dislikeArea = seg.querySelector('dislike-button-view-model, ytd-toggle-button-renderer:last-child');
                        if (dislikeArea) dislikeArea.appendChild(countEl);
                    }
                    if (countEl) { countEl.textContent = this._formatCount(data.dislikes); return true; }
                    return false;
                };
                if (injectCount()) return;
                // Retry with MutationObserver
                const obs = new MutationObserver(() => { if (injectCount()) obs.disconnect(); });
                obs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => obs.disconnect(), 10000);
            },
            init() {
                addNavigateRule(this._ruleId, () => {
                    this._currentVideoId = null; // allow re-fetch on navigation
                    setTimeout(() => this._updateDislikeCount(), 500);
                });
            },
            destroy() {
                removeNavigateRule(this._ruleId);
                document.getElementById('ytkit-dislike-count')?.remove();
            }
        },
        // ─── Ad Blocker (interfaces with document-start bootstrap) ───
        {
            id: 'ytAdBlock',
            name: 'YouTube Ad Blocker',
            description: 'Block video ads via API interception, JSON pruning, and cosmetic hiding',
            group: 'Ad Blocker',
            icon: 'shield',
            isParent: true,
            _autoUpdateTimer: null,
            init() {
                GM_setValue('ytab_enabled', true);
                if (!_rw.__ytab?.active) {
                    showToast('Ad Blocker will activate on next page load', '#f59e0b');
                }
                // Auto-update filter list every 24 hours
                if (appState.settings.adblockFilterAutoUpdate) {
                    const lastUpdate = GM_getValue('ytab_filter_update_time', 0);
                    const DAY_MS = 24 * 60 * 60 * 1000;
                    const doUpdate = () => {
                        const url = (appState.settings.adblockFilterUrl || '').trim();
                        if (!url) return;
                        GM_xmlhttpRequest({
                            method: 'GET', url,
                            onload: (res) => {
                                if (res.status === 200 && res.responseText) {
                                    const lines = res.responseText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!') && !l.startsWith('#') && !l.startsWith('['));
                                    if (lines.length > 0) {
                                        const selectorStr = lines.join(',\n');
                                        GM_setValue('ytab_cached_selectors', selectorStr);
                                        GM_setValue('ytab_cached_selector_count', lines.length);
                                        GM_setValue('ytab_filter_update_time', Date.now());
                                        DebugManager.log('AdBlock', `Auto-updated ${lines.length} filter selectors`);
                                    }
                                }
                            }
                        });
                    };
                    if (Date.now() - lastUpdate > DAY_MS) doUpdate();
                    this._autoUpdateTimer = setInterval(doUpdate, DAY_MS);
                }
            },
            destroy() {
                GM_setValue('ytab_enabled', false);
                if (this._autoUpdateTimer) clearInterval(this._autoUpdateTimer);
                showToast('Ad Blocker disabled - takes effect on next page load', '#ef4444');
            }
        },
        {
            id: 'adblockCosmeticHide',
            name: 'Cosmetic Element Hiding',
            description: 'Hide ad slots, banners, merch shelves, and promoted content via CSS',
            group: 'Ad Blocker',
            icon: 'eye-off',
            isSubFeature: true,
            parentId: 'ytAdBlock',
            init() { _rw.__ytab?.updateCSS?.(GM_getValue('ytab_cached_selectors', '') + (GM_getValue('ytab_custom_filters', '') ? ',' + GM_getValue('ytab_custom_filters', '') : '')); },
            destroy() { const el = document.getElementById('ytab-cosmetic'); if (el) el.textContent = ''; }
        },
        {
            id: 'adblockSsapAutoSkip',
            name: 'SSAP Auto-Skip',
            description: 'Detect and auto-skip server-side ad stitching in videos',
            group: 'Ad Blocker',
            icon: 'skip-forward',
            isSubFeature: true,
            parentId: 'ytAdBlock',
            init() { GM_setValue('ytab_ssap', true); _rw.__ytab?.startSSAP?.(); },
            destroy() { GM_setValue('ytab_ssap', false); _rw.__ytab?.stopSSAP?.(); }
        },
        {
            id: 'adblockAntiDetect',
            name: 'Anti-Detection Bypass',
            description: 'Block YouTube abnormality detection and ad-blocker countermeasures',
            group: 'Ad Blocker',
            icon: 'shield',
            isSubFeature: true,
            parentId: 'ytAdBlock',
            init() { GM_setValue('ytab_antidetect', true); },
            destroy() { GM_setValue('ytab_antidetect', false); showToast('Anti-Detection changes take effect on next page load', '#f59e0b'); }
        },

        // ─── SponsorBlock (Lite Implementation) ───
        {
            id: 'skipSponsors',
            name: 'Skip Sponsors',
            description: 'Automatically skip sponsored segments using SponsorBlock API',
            group: 'SponsorBlock',
            icon: 'skip-forward',
            isParent: true,
            _state: {
                videoID: null,
                segments: [],
                skippableSegments: [],
                lastSkippedUUID: null,
                currentSegmentIndex: 0,
                video: null,
                rafSkipId: null,
                skipScheduleTimer: null,
                previewBarContainer: null,
                videoDuration: 0
            },
            _categories: null, // populated from settings in init
            _allCategories: ["sponsor", "selfpromo", "exclusive_access", "interaction", "intro", "outro", "music_offtopic", "preview", "filler"],
            _categoryColors: {
                sponsor: "#00d400",
                selfpromo: "#ffff00",
                exclusive_access: "#008a5c",
                interaction: "#cc00ff",
                intro: "#00ffff",
                outro: "#0202ed",
                music_offtopic: "#ff9900",
                preview: "#008fd6",
                filler: "#7300ff"
            },
            _styleElement: null,

            async _sha256(message) {
                const msgBuffer = new TextEncoder().encode(message);
                const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
            },

            async _getHashPrefix(videoID) {
                const hash = await this._sha256(videoID);
                return hash.slice(0, 4);
            },

            _getVideoID() {
                const url = new URL(window.location.href);
                const vParam = url.searchParams.get("v");
                if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;
                const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
                if (shortsMatch) return shortsMatch[1];
                return null;
            },

            async _fetchSegments(videoID) {
                try {
                    const hashPrefix = await this._getHashPrefix(videoID);
                    const params = new URLSearchParams({
                        categories: JSON.stringify(this._categories),
                        actionTypes: JSON.stringify(["skip", "full"])
                    });
                    return new Promise((resolve) => {
                        GM.xmlHttpRequest({
                            method: "GET",
                            url: `https://sponsor.ajay.app/api/skipSegments/${hashPrefix}?${params}`,
                            headers: { Accept: "application/json" },
                            onload: (response) => {
                                if (response.status === 200) {
                                    try {
                                        const data = JSON.parse(response.responseText);
                                        const videoData = data.find(v => v.videoID === videoID);
                                        const segs = videoData?.segments || [];
                                        segs.sort((a, b) => a.segment[0] - b.segment[0]);
                                        resolve(segs);
                                    } catch { resolve([]); }
                                } else { resolve([]); }
                            },
                            onerror: () => resolve([])
                        });
                    });
                } catch { return []; }
            },

            _computeSkippableSegments() {
                this._state.skippableSegments = this._state.segments.filter(s => s.actionType !== "full");
                this._state.currentSegmentIndex = 0;
            },

            _skipToTime(targetTime) {
                if (!this._state.video || targetTime === undefined) return false;
                try {
                    this._state.video.currentTime = targetTime;
                    return true;
                } catch (e) { return false; }
            },

            _startRAFSkipLoop() {
                if (this._state.rafSkipId) cancelAnimationFrame(this._state.rafSkipId);
                const SKIP_BUFFER = 0.003;
                const checkAndSkip = () => {
                    if (!this._state.video || !this._state.skippableSegments.length) {
                        this._state.rafSkipId = null;
                        return;
                    }
                    if (!this._state.video.paused) {
                        const currentTime = this._state.video.currentTime;
                        for (const seg of this._state.skippableSegments) {
                            const [startTime, endTime] = seg.segment;
                            if (currentTime >= startTime - SKIP_BUFFER && currentTime < endTime - SKIP_BUFFER && this._state.lastSkippedUUID !== seg.UUID) {
                                this._state.lastSkippedUUID = seg.UUID;
                                DebugManager.log('SponsorBlock', `Skipping ${seg.category} segment`);
                                this._skipToTime(endTime);
                                break;
                            }
                        }
                    }
                    this._state.rafSkipId = requestAnimationFrame(checkAndSkip);
                };
                this._state.rafSkipId = requestAnimationFrame(checkAndSkip);
            },

            _stopRAFSkipLoop() {
                if (this._state.rafSkipId) {
                    cancelAnimationFrame(this._state.rafSkipId);
                    this._state.rafSkipId = null;
                }
            },

            _createPreviewBar() {
                const container = document.createElement("ul");
                container.id = "ytkit-sb-previewbar";
                container.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;padding:0;margin:0;overflow:visible;pointer-events:none;z-index:42;list-style:none;transform:scaleY(0.6);transition:transform 0.1s cubic-bezier(0, 0, 0.2, 1);";
                return container;
            },

            _updatePreviewBar() {
                const duration = this._state.video?.duration || 0;
                if (!duration || duration <= 0) return;
                this._state.videoDuration = duration;
                if (!this._state.previewBarContainer) {
                    this._state.previewBarContainer = this._createPreviewBar();
                }
                const progressBar = document.querySelector(".ytp-progress-bar");
                if (progressBar && !progressBar.contains(this._state.previewBarContainer)) {
                    progressBar.appendChild(this._state.previewBarContainer);
                }
                if (!progressBar) return;
                // Clear children using DOM method (Trusted Types compliant)
                while (this._state.previewBarContainer.firstChild) {
                    this._state.previewBarContainer.removeChild(this._state.previewBarContainer.firstChild);
                }
                const previewSegments = this._state.segments.filter(s => s.actionType !== "full");
                for (const segment of previewSegments) {
                    const bar = document.createElement("li");
                    bar.className = "ytkit-sb-segment";
                    const startPercent = (segment.segment[0] / duration) * 100;
                    const endPercent = (segment.segment[1] / duration) * 100;
                    const widthPercent = endPercent - startPercent;
                    bar.style.cssText = `position:absolute;top:0;height:100%;min-width:1px;opacity:0.7;left:${startPercent}%;width:${widthPercent}%;background-color:${this._categoryColors[segment.category] || "#888"};`;
                    bar.title = segment.category.replace(/_/g, " ");
                    this._state.previewBarContainer.appendChild(bar);
                }
            },

            _removePreviewBar() {
                if (this._state.previewBarContainer) {
                    this._state.previewBarContainer.remove();
                    this._state.previewBarContainer = null;
                }
            },

            _reset() {
                // Remove video event listeners before clearing references
                if (this._state.video) {
                    if (this._state._playHandler) this._state.video.removeEventListener("play", this._state._playHandler);
                    if (this._state._pauseHandler) this._state.video.removeEventListener("pause", this._state._pauseHandler);
                    if (this._state._seekedHandler) this._state.video.removeEventListener("seeked", this._state._seekedHandler);
                    this._state._playHandler = null;
                    this._state._pauseHandler = null;
                    this._state._seekedHandler = null;
                }
                this._state.videoID = null;
                this._state.segments = [];
                this._state.skippableSegments = [];
                this._state.lastSkippedUUID = null;
                this._state.currentSegmentIndex = 0;
                this._state.videoDuration = 0;
                this._stopRAFSkipLoop();
                this._removePreviewBar();
                document.querySelectorAll('[id^="ytkit-sb-label-"]').forEach(e => e.remove());
            },

            async _loadSegmentsAndSetup() {
                if (!this._state.videoID) return;
                try {
                    this._state.segments = await this._fetchSegments(this._state.videoID);
                    if (this._state.segments.length > 0) {
                        DebugManager.log('SponsorBlock', `Found ${this._state.segments.length} segments`);
                    }
                    this._computeSkippableSegments();
                    this._updatePreviewBar();
                    // Create full video labels
                    this._state.segments.filter(s => s.actionType === "full").forEach(s => this._createVideoLabel(s));
                    if (this._state.video && !this._state.video.paused) {
                        this._startRAFSkipLoop();
                    }
                } catch (error) {
                    console.error("[YTKit SponsorBlock] Failed to load segments:", error);
                }
            },

            _createVideoLabel(videoLabel) {
                let labelAttempts = 0;
                const check = () => {
                    if (++labelAttempts > TIMING.LABEL_MAX_ATTEMPTS) return;
                    const title = document.querySelector("#title h1, h1.title.ytd-video-primary-info-renderer");
                    if (title) {
                        const category = videoLabel.category;
                        const label = document.createElement("span");
                        label.id = `ytkit-sb-label-${category}`;
                        label.title = `The entire video is ${category}`;
                        label.innerText = category;
                        label.style.cssText = `color:#111;background-color:${this._categoryColors[category] || "#ccc"};display:flex;margin:0 5px;padding:2px 6px;font-size:12px;font-weight:bold;border-radius:4px;`;
                        title.style.display = "flex";
                        title.prepend(label);
                    } else {
                        setTimeout(check, 500);
                    }
                };
                check();
            },

            _handleVideoChange() {
                const newVideoID = this._getVideoID();
                if (!newVideoID || newVideoID === this._state.videoID) return;
                DebugManager.log('SponsorBlock', `Video changed to: ${newVideoID}`);
                this._reset();
                this._state.videoID = newVideoID;
                let attempts = 0;
                const checkVideo = setInterval(() => {
                    attempts++;
                    const video = document.querySelector("video");
                    if (video) {
                        clearInterval(checkVideo);
                        this._state.video = video;
                        this._state._playHandler = () => this._startRAFSkipLoop();
                        this._state._pauseHandler = () => this._stopRAFSkipLoop();
                        this._state._seekedHandler = () => { this._state.lastSkippedUUID = null; };
                        video.addEventListener("play", this._state._playHandler);
                        video.addEventListener("pause", this._state._pauseHandler);
                        video.addEventListener("seeked", this._state._seekedHandler);
                        this._loadSegmentsAndSetup();
                    } else if (attempts >= 50) {
                        clearInterval(checkVideo);
                    }
                }, 100);
            },

            init() {
                // Load categories from settings
                const cats = appState.settings.sponsorBlockCategories || this._allCategories;
                this._categories = cats.length ? cats : this._allCategories;
                this._styleElement = document.createElement("style");
                this._styleElement.textContent = `
                    .ytp-progress-bar:hover #ytkit-sb-previewbar { transform: scaleY(1); }
                    .ytp-big-mode #ytkit-sb-previewbar { transform: scaleY(0.625); }
                    .ytp-big-mode .ytp-progress-bar:hover #ytkit-sb-previewbar { transform: scaleY(1); }
                    .ytkit-sb-segment:hover { opacity: 1 !important; }
                `;
                document.head.appendChild(this._styleElement);
                this._navHandler = () => this._handleVideoChange();
                this._resetHandler = () => { this._removePreviewBar(); this._stopRAFSkipLoop(); };
                document.addEventListener("yt-navigate-finish", this._navHandler);
                document.addEventListener("yt-navigate-start", this._resetHandler);
                this._handleVideoChange();
                setTimeout(() => this._handleVideoChange(), 500);
            },

            destroy() {
                document.removeEventListener("yt-navigate-finish", this._navHandler);
                document.removeEventListener("yt-navigate-start", this._resetHandler);
                this._reset();
                this._styleElement?.remove();
            }
        },
        cssFeature('hideSponsorBlockLabels', 'Hide SponsorBlock Labels', 'Hide the category labels added by SponsorBlock', 'SponsorBlock', 'tag-off',
            '[id^="ytkit-sb-label-"]', { isSubFeature: true, parentId: 'skipSponsors' }),
        {
            id: 'sbCat_sponsor', name: 'Skip: Sponsor', description: 'Auto-skip sponsor segments', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'sponsor', init(){}, destroy(){}
        },
        {
            id: 'sbCat_selfpromo', name: 'Skip: Self Promotion', description: 'Auto-skip self-promotion segments', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'selfpromo', init(){}, destroy(){}
        },
        {
            id: 'sbCat_interaction', name: 'Skip: Interaction Reminder', description: 'Auto-skip subscribe/like reminders', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'interaction', init(){}, destroy(){}
        },
        {
            id: 'sbCat_intro', name: 'Skip: Intro', description: 'Auto-skip intro animations', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'intro', init(){}, destroy(){}
        },
        {
            id: 'sbCat_outro', name: 'Skip: Outro', description: 'Auto-skip outro/credits', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'outro', init(){}, destroy(){}
        },
        {
            id: 'sbCat_music_offtopic', name: 'Skip: Off-Topic Music', description: 'Auto-skip non-music in music videos', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'music_offtopic', init(){}, destroy(){}
        },
        {
            id: 'sbCat_preview', name: 'Skip: Preview/Recap', description: 'Auto-skip preview or recap sections', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'preview', init(){}, destroy(){}
        },
        {
            id: 'sbCat_filler', name: 'Skip: Filler', description: 'Auto-skip filler/tangent sections', group: 'SponsorBlock', icon: 'list',
            isSubFeature: true, parentId: 'skipSponsors', _arrayKey: 'sponsorBlockCategories', _arrayValue: 'filler', init(){}, destroy(){}
        },

        // ─── Quality ───
        {
            id: 'autoMaxResolution',
            name: 'Auto Quality',
            description: 'Automatically select preferred video quality (max, 4K, 1440p, 1080p, 720p, 480p)',
            group: 'Quality',
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
                const currentVideoId = (new URLSearchParams(window.location.search)).get('v');
                if (!player || !currentVideoId || currentVideoId === this._lastProcessedVideoId) return;
                if (typeof player.getAvailableQualityLevels !== 'function') return;
                const levels = player.getAvailableQualityLevels();
                if (!levels || !levels.length) return;
                this._lastProcessedVideoId = currentVideoId;
                const pref = appState.settings.preferredQuality || 'max';
                let target;
                if (pref === 'max') {
                    target = levels[0];
                } else {
                    const ytLabel = this._qualityMap[pref] || 'hd1080';
                    // Find the best available quality at or below preferred
                    target = levels.find(l => l === ytLabel) || levels.find(l => levels.indexOf(l) >= levels.indexOf(ytLabel)) || levels[0];
                }
                try { player.setPlaybackQualityRange(target); } catch { /* ignore */ }
            }
        },
        {
            id: 'useEnhancedBitrate',
            name: 'Enhanced Bitrate',
            description: 'Request higher bitrate streams when available',
            group: 'Quality',
            icon: 'gauge',
            isSubFeature: true,
            parentId: 'autoMaxResolution',
            init() {
                const applyBitrate = () => {
                    const player = document.getElementById('movie_player');
                    if (player && typeof player.setPlaybackQualityRange === 'function') {
                        try {
                            const levels = player.getAvailableQualityLevels();
                            if (levels && levels.length > 0) player.setPlaybackQualityRange(levels[0], levels[0]);
                        } catch (e) { /* ignore */ }
                    }
                };
                addNavigateRule(this.id, applyBitrate);
            },
            destroy() { removeNavigateRule(this.id); }
        },
        {
            id: 'hideQualityPopup',
            name: 'Hide Quality Popup',
            description: 'Suppress the quality selection popup during auto-selection',
            group: 'Quality',
            icon: 'eye-off',
            isSubFeature: true,
            parentId: 'autoMaxResolution',
            init() {},
            destroy() {}
        },

        // ─── Clutter ───
        cssFeature('hideMerchShelf', 'Hide Merch Shelf', 'Remove merchandise promotions below videos', 'Clutter', 'shopping-bag',
            'ytd-merch-shelf-renderer'),
        cssFeature('hideAiSummary', 'Hide AI Summary', 'Remove AI-generated summaries and Ask AI buttons', 'Clutter', 'bot-off',
            `ytd-engagement-panel-section-list-renderer[target-id*="ai"],
                    ytd-engagement-panel-section-list-renderer[target-id*="summary"],
                    tp-yt-paper-button[aria-label*="AI"], tp-yt-paper-button[aria-label*="Ask"],
                    ytd-info-panel-content-renderer:has([icon="info_outline"]),
                    [class*="ai-summary"], [class*="aiSummary"],
                    ytd-reel-shelf-renderer:has([is-ask-ai]) { display: none !important; }`),
        cssFeature('hideDescriptionExtras', 'Hide Description Extras', 'Remove extra elements in the description area', 'Clutter', 'file-x',
            'ytd-video-description-transcript-section-renderer, ytd-structured-description-content-renderer > *:not(ytd-text-inline-expander)'),
        cssFeature('hideHashtags', 'Hide Hashtags', 'Remove hashtag links above video titles', 'Clutter', 'hash',
            'ytd-watch-metadata .super-title, ytd-video-primary-info-renderer .super-title'),
        cssFeature('hidePinnedComments', 'Hide Pinned Comments', 'Remove pinned comments from the comments section', 'Clutter', 'pin-off',
            `ytd-comment-thread-renderer:has(ytd-pinned-comment-badge-renderer) { display: none !important; }
                    ytd-pinned-comment-badge-renderer { display: none !important; }`),
        cssFeature('hideCommentActionMenu', 'Hide Comment Actions', 'Remove action menu from individual comments', 'Clutter', 'more-horizontal',
            '#action-menu.ytd-comment-view-model, #action-menu.ytd-comment-renderer'),
        cssFeature('condenseComments', 'Condense Comments', 'Reduce spacing between comments for a tighter layout', 'Clutter', 'minimize-2',
            `ytd-comment-thread-renderer.style-scope.ytd-item-section-renderer {
                        margin-top: 5px !important;
                        margin-bottom: 1px !important;
                    }
                    ytd-comment-thread-renderer.style-scope.ytd-comment-replies-renderer {
                        padding-top: 0px !important;
                        padding-bottom: 0px !important;
                        margin-top: 0px !important;
                        margin-bottom: 0px !important;
                    }`),
        cssFeature('hideLiveChatEngagement', 'Hide Chat Engagement', 'Remove engagement prompts in live chat', 'Clutter', 'message-circle-off',
            'yt-live-chat-viewer-engagement-message-renderer'),
        cssFeature('hidePaidPromotionWatch', 'Hide Paid Promotion', 'Remove "paid promotion" labels on watch pages', 'Clutter', 'dollar-sign',
            '.ytp-paid-content-overlay'),
        {
            // ═══ Consolidated Video End Content Feature ═══
            id: 'hideVideoEndContent',
            name: 'Hide Video End Content',
            description: 'Remove end cards, end screen, and video grid when videos finish',
            group: 'Clutter',
            icon: 'square-x',
            _styleElement: null,
            init() {
                const css = `
                    .ytp-ce-element,
                    .ytp-endscreen-content,
                    div.ytp-fullscreen-grid-stills-container { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        cssFeature('hideFundraiser', 'Hide Fundraisers', 'Remove fundraiser and donation badges', 'Clutter', 'heart-off',
            `ytd-donation-shelf-renderer,
                    ytd-button-renderer[button-next]:has([aria-label*="Donate"]),
                    .ytp-donation-shelf { display: none !important; }`),
        // ═══ Consolidated Live Chat Feature ═══
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
        { id: 'chatHide_header', name: 'Chat Header', description: 'Hide the live chat header bar', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'header', init(){}, destroy(){} },
        { id: 'chatHide_menu', name: 'Chat Menu (...)', description: 'Hide the chat overflow menu', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'menu', init(){}, destroy(){} },
        { id: 'chatHide_popout', name: 'Popout Button', description: 'Hide the popout chat button', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'popout', init(){}, destroy(){} },
        { id: 'chatHide_reactions', name: 'Reactions', description: 'Hide chat reactions panel', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'reactions', init(){}, destroy(){} },
        { id: 'chatHide_timestamps', name: 'Timestamps', description: 'Hide chat timestamps', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'timestamps', init(){}, destroy(){} },
        { id: 'chatHide_polls', name: 'Polls & Poll Banner', description: 'Hide polls in live chat', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'polls', init(){}, destroy(){} },
        { id: 'chatHide_ticker', name: 'Super Chat Ticker', description: 'Hide the super chat ticker', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'ticker', init(){}, destroy(){} },
        { id: 'chatHide_leaderboard', name: 'Leaderboard', description: 'Hide chat leaderboard', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'leaderboard', init(){}, destroy(){} },
        { id: 'chatHide_support', name: 'Support Buttons', description: 'Hide support/buy buttons in chat', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'support', init(){}, destroy(){} },
        { id: 'chatHide_banner', name: 'Chat Banner', description: 'Hide chat banners', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'banner', init(){}, destroy(){} },
        { id: 'chatHide_emoji', name: 'Emoji Button', description: 'Hide emoji picker button', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'emoji', init(){}, destroy(){} },
        { id: 'chatHide_topFan', name: 'Fan Badges', description: 'Hide fan/member badges', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'topFan', init(){}, destroy(){} },
        { id: 'chatHide_superChats', name: 'Super Chats', description: 'Hide super chat messages', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'superChats', init(){}, destroy(){} },
        { id: 'chatHide_levelUp', name: 'Level Up Messages', description: 'Hide level up messages', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'levelUp', init(){}, destroy(){} },
        { id: 'chatHide_bots', name: 'Bot Messages', description: 'Filter out known bot messages', group: 'Live Chat', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenChatElementsManager', _arrayKey: 'hiddenChatElements', _arrayValue: 'bots', init(){}, destroy(){} },
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

        // ─── Action Buttons ───
        {
            id: 'autolikeVideos',
            name: 'Auto-Like Videos',
            description: 'Automatically like videos from subscribed channels',
            group: 'Action Buttons',
            icon: 'thumbs-up',
            init() {
                const autoLike = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    waitForElement('ytd-video-owner-renderer #subscribe-button tp-yt-paper-button[subscribed]', () => {
                        const likeBtn = document.querySelector('ytd-segmented-like-dislike-button-renderer button[aria-pressed="false"]');
                        if (likeBtn) likeBtn.click();
                    }, 5000);
                };
                addNavigateRule(this.id, autoLike);
            },
            destroy() { removeNavigateRule(this.id); }
        },

        // ═══ Consolidated Action Buttons Feature ═══
        {
            id: 'hiddenActionButtonsManager',
            name: 'Hide Action Buttons',
            description: 'Choose which action buttons to hide below videos',
            group: 'Action Buttons',
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
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'abHide_like', name: 'Like Button', description: 'Hide like button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'like', init(){}, destroy(){} },
        { id: 'abHide_dislike', name: 'Dislike Button', description: 'Hide dislike button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'dislike', init(){}, destroy(){} },
        { id: 'abHide_share', name: 'Share Button', description: 'Hide share button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'share', init(){}, destroy(){} },
        { id: 'abHide_ask', name: 'Ask/AI Button', description: 'Hide Ask or AI button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'ask', init(){}, destroy(){} },
        { id: 'abHide_clip', name: 'Clip Button', description: 'Hide clip button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'clip', init(){}, destroy(){} },
        { id: 'abHide_thanks', name: 'Thanks Button', description: 'Hide thanks button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'thanks', init(){}, destroy(){} },
        { id: 'abHide_save', name: 'Save Button', description: 'Hide save button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'save', init(){}, destroy(){} },
        { id: 'abHide_sponsor', name: 'Join/Sponsor Button', description: 'Hide join/sponsor button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'sponsor', init(){}, destroy(){} },
        { id: 'abHide_moreActions', name: 'More Actions (...)', description: 'Hide more actions button below videos', group: 'Action Buttons', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenActionButtonsManager', _arrayKey: 'hiddenActionButtons', _arrayValue: 'moreActions', init(){}, destroy(){} },
        {
            id: 'replaceWithCobaltDownloader',
            name: 'Web Download Button',
            description: 'Add a web-based download button (Cobalt, y2mate, etc). Disabled by default when YTYT local download is enabled.',
            group: 'Downloads',
            icon: 'download',
            _styleElement: null,
            _providers: {
                'cobalt': 'https://cobalt.meowing.de/#',
                'y2mate': 'https://www.y2mate.com/youtube/',
                'savefrom': 'https://en.savefrom.net/1-youtube-video-downloader-',
                'ssyoutube': 'https://ssyoutube.com/watch?v='
            },
            _getDownloadUrl(videoUrl) {
                const provider = appState.settings.downloadProvider || 'cobalt';
                const baseUrl = this._providers[provider] || this._providers['cobalt'];
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
                    btn.style.cssText = `font-size:14px;padding:6px 12px;margin-left:8px;border-radius:20px;border:2px solid #ff5722;background:transparent;color:#ff5722;cursor:pointer;transition:background .2s,color .2s;`;
                    btn.onmouseenter = () => { btn.style.background = '#ff5722'; btn.style.color = '#fff'; };
                    btn.onmouseleave = () => { btn.style.background = 'transparent'; btn.style.color = '#ff5722'; };
                    btn.addEventListener('click', () => {
                        const videoUrl = window.location.href;
                        const downloadUrl = this._getDownloadUrl(videoUrl);
                        window.open(downloadUrl, '_blank');
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

        // ═══ Consolidated Player Controls Feature ═══
        {
            id: 'hiddenPlayerControlsManager',
            name: 'Hide Player Controls',
            description: 'Choose which player control buttons to hide',
            group: 'Player Controls',
            icon: 'eye-off',
            isParent: true,
            _styleElement: null,
            _selectors: {
                sponsorBlock: '.ytp-sb-button, .ytp-sponsorblock-button',
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
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'pcHide_sponsorBlock', name: 'SponsorBlock Button', description: 'Hide SponsorBlock button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'sponsorBlock', init(){}, destroy(){} },
        { id: 'pcHide_next', name: 'Next Video Button', description: 'Hide next video button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'next', init(){}, destroy(){} },
        { id: 'pcHide_autoplay', name: 'Autoplay Toggle', description: 'Hide autoplay toggle from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'autoplay', init(){}, destroy(){} },
        { id: 'pcHide_subtitles', name: 'Subtitles Button', description: 'Hide subtitles button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'subtitles', init(){}, destroy(){} },
        { id: 'pcHide_captions', name: 'Captions Display', description: 'Hide captions overlay on video', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'captions', init(){}, destroy(){} },
        { id: 'pcHide_miniplayer', name: 'Miniplayer Button', description: 'Hide miniplayer button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'miniplayer', init(){}, destroy(){} },
        { id: 'pcHide_pip', name: 'Picture-in-Picture', description: 'Hide PiP button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'pip', init(){}, destroy(){} },
        { id: 'pcHide_theater', name: 'Theater Mode Button', description: 'Hide theater mode button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'theater', init(){}, destroy(){} },
        { id: 'pcHide_fullscreen', name: 'Fullscreen Button', description: 'Hide fullscreen button from player', group: 'Player Controls', icon: 'eye-off', isSubFeature: true, parentId: 'hiddenPlayerControlsManager', _arrayKey: 'hiddenPlayerControls', _arrayValue: 'fullscreen', init(){}, destroy(){} },
        // Individual player control features removed - now consolidated in hiddenPlayerControlsManager

        // ─── Downloads (YTYT-Downloader Integration) ───
        {
            id: 'youtubeToolsInfo',
            name: '📦 YTYT-Downloader Setup',
            description: 'VLC/MPV streaming, local downloads, and the Embed Player require YTYT-Downloader. Click the orange/green button in the footer to download the installer. The embed server starts automatically on boot.',
            group: 'Downloads',
            icon: 'info',
            type: 'info',
            init() {},
            destroy() {}
        },
        {
            id: 'downloadProvider',
            name: 'Download Provider',
            description: 'Choose which service to use for video downloads',
            group: 'Downloads',
            icon: 'download-cloud',
            type: 'select',
            options: {
                'cobalt': 'Cobalt (cobalt.meowing.de)',
                'y2mate': 'Y2Mate',
                'savefrom': 'SaveFrom.net',
                'ssyoutube': 'SSYouTube'
            },
            _providers: {
                'cobalt': 'https://cobalt.meowing.de/#',
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
                    return items.map(({ channelRenderer }) => ({
                        title: channelRenderer?.title?.simpleText,
                        handle: channelRenderer?.subscriberCountText?.simpleText
                    })).filter(s => s.title);
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
                    window.location.href = 'ytvlc://' + encodeURIComponent(window.location.href);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('vlcButton', '#top-level-buttons-computed', '.ytkit-vlc-btn', this._createButton.bind(this));
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('vlcButton');
                document.querySelector('.ytkit-vlc-btn')?.remove();
            }
        },
        {
            id: 'showVlcQueueButton',
            name: 'VLC Queue Button',
            description: 'Add button to queue video in VLC (plays after current)',
            group: 'Downloads',
            icon: 'list-plus',
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-vlc-queue-btn';
                btn.title = 'Add to VLC Queue (requires YTYT-Downloader)';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'white');
                svg.setAttribute('stroke-width', '2');
                // List icon with plus
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '8'); line1.setAttribute('y1', '6');
                line1.setAttribute('x2', '21'); line1.setAttribute('y2', '6');
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '8'); line2.setAttribute('y1', '12');
                line2.setAttribute('x2', '21'); line2.setAttribute('y2', '12');
                const line3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line3.setAttribute('x1', '8'); line3.setAttribute('y1', '18');
                line3.setAttribute('x2', '21'); line3.setAttribute('y2', '18');
                const plus1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                plus1.setAttribute('x1', '3'); plus1.setAttribute('y1', '12');
                plus1.setAttribute('x2', '3'); plus1.setAttribute('y2', '12');
                plus1.setAttribute('stroke-linecap', 'round');
                const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle1.setAttribute('cx', '3'); circle1.setAttribute('cy', '6'); circle1.setAttribute('r', '1');
                circle1.setAttribute('fill', 'white');
                const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle2.setAttribute('cx', '3'); circle2.setAttribute('cy', '12'); circle2.setAttribute('r', '1');
                circle2.setAttribute('fill', 'white');
                const circle3 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle3.setAttribute('cx', '3'); circle3.setAttribute('cy', '18'); circle3.setAttribute('r', '1');
                circle3.setAttribute('fill', 'white');
                svg.appendChild(line1); svg.appendChild(line2); svg.appendChild(line3);
                svg.appendChild(circle1); svg.appendChild(circle2); svg.appendChild(circle3);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' +Q'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#ea580c;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#c2410c'; };
                btn.onmouseleave = () => { btn.style.background = '#ea580c'; };
                btn.addEventListener('click', () => {
                    showToast('📋 Adding to VLC queue...', '#ea580c');
                    window.location.href = 'ytvlcq://' + encodeURIComponent(window.location.href);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('vlcQueueButton', '#top-level-buttons-computed', '.ytkit-vlc-queue-btn', this._createButton.bind(this));
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('vlcQueueButton');
                document.querySelector('.ytkit-vlc-queue-btn')?.remove();
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
                    showToast('⬇️ Starting download...', '#22c55e');
                    window.location.href = 'ytdl://' + encodeURIComponent(window.location.href);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('localDownloadButton', '#top-level-buttons-computed', '.ytkit-local-dl-btn', this._createButton.bind(this));
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
                    showToast('🎵 Starting MP3 download...', '#8b5cf6');
                    window.location.href = 'ytdl://' + encodeURIComponent(window.location.href) + '?ytyt_audio_only=1';
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('mp3DownloadButton', '#top-level-buttons-computed', '.ytkit-mp3-dl-btn', this._createButton.bind(this));
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('mp3DownloadButton');
                document.querySelector('.ytkit-mp3-dl-btn')?.remove();
            }
        },
        {
            id: 'showSummarizeButton',
            name: 'Summarize Button',
            description: 'Add a Summarize button next to video actions — shows AI summary in a popup bubble',
            group: 'ChapterForge',
            icon: 'file-text',
            dependsOn: 'chapterForge',
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-summarize-btn';
                btn.title = 'AI Summary (ChapterForge)';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '18');
                svg.setAttribute('height', '18');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'white');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p1.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
                const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                p2.setAttribute('points', '14 2 14 8 20 8');
                const p3 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                p3.setAttribute('x1', '16'); p3.setAttribute('y1', '13'); p3.setAttribute('x2', '8'); p3.setAttribute('y2', '13');
                const p4 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                p4.setAttribute('x1', '16'); p4.setAttribute('y1', '17'); p4.setAttribute('x2', '8'); p4.setAttribute('y2', '17');
                svg.append(p1, p2, p3, p4);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' TL;DR'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#3b82f6;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#2563eb'; };
                btn.onmouseleave = () => { btn.style.background = '#3b82f6'; };
                btn.addEventListener('click', async () => {
                    const cf = features.find(f => f.id === 'chapterForge');
                    if (!cf) { showToast('Enable ChapterForge first', '#ef4444'); return; }
                    // If summary already exists, toggle bubble
                    if (cf._lastSummary) {
                        const existing = document.getElementById('cf-summary-bubble');
                        if (existing) { cf._hideSummaryBubble(); return; }
                        cf._showSummaryBubble(cf._lastSummary);
                        return;
                    }
                    btn.disabled = true; btn.style.opacity = '0.6';
                    showToast('Generating summary...', '#3b82f6', { duration: 3 });
                    try {
                        await cf._generateSummary(true);
                    } catch(e) {
                        console.warn('[YTKit] TL;DR error:', e);
                        showToast('Summary failed: ' + (e.message || 'unknown error'), '#ef4444');
                    }
                    btn.disabled = false; btn.style.opacity = '1';
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('summarizeButton', '#top-level-buttons-computed', '.ytkit-summarize-btn', this._createButton.bind(this));
                startButtonChecker();
                // Reset summary on navigation
                addNavigateRule('summaryBubbleReset', () => {
                    const cf = features.find(f => f.id === 'chapterForge');
                    if (cf) { cf._hideSummaryBubble(); cf._lastSummary = null; }
                });
            },
            destroy() {
                unregisterPersistentButton('summarizeButton');
                document.querySelector('.ytkit-summarize-btn')?.remove();
                document.getElementById('cf-summary-bubble')?.remove();
                removeNavigateRule('summaryBubbleReset');
            }
        },
        {
            id: 'autoDownloadOnVisit',
            name: 'Auto-Download Videos',
            description: 'Automatically start download when visiting a video page',
            group: 'Downloads',
            icon: 'download',
            _lastDownloaded: null,
            _handleNavigation() {
                if (!window.location.pathname.startsWith('/watch')) return;
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId || videoId === this._lastDownloaded) return;
                this._lastDownloaded = videoId;
                // Small delay to let page load
                setTimeout(() => {
                    const videoUrl = window.location.href;
                    DebugManager.log('Download', 'Auto-downloading:', videoUrl);
                    window.location.href = 'ytdl://' + encodeURIComponent(videoUrl);
                }, 2000);
            },
            init() {
                addNavigateRule('autoDownload', this._handleNavigation.bind(this));
            },
            destroy() {
                removeNavigateRule('autoDownload');
            }
        },
        {
            id: 'downloadQuality',
            name: 'Download Quality',
            description: 'Preferred video quality for downloads',
            group: 'Downloads',
            icon: 'settings-2',
            type: 'select',
            options: {
                '2160': '4K (2160p)',
                '1440': '2K (1440p)',
                '1080': 'Full HD (1080p)',
                '720': 'HD (720p)',
                '480': 'SD (480p)',
                'best': 'Best Available'
            },
            init() {},
            destroy() {}
        },
        {
            id: 'preferredMediaPlayer',
            name: 'Preferred Media Player',
            description: 'Default player for streaming videos',
            group: 'Downloads',
            icon: 'monitor-play',
            type: 'select',
            options: {
                'vlc': 'VLC Media Player',
                'mpv': 'MPV',
                'potplayer': 'PotPlayer',
                'mpc-hc': 'MPC-HC'
            },
            init() {},
            destroy() {}
        },
        {
            id: 'showDownloadPlayButton',
            name: 'Download & Play Button',
            description: 'Download video first, then open in VLC (better quality, works offline)',
            group: 'Downloads',
            icon: 'download',
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-dlplay-btn';
                btn.title = 'Download & Play in VLC';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M12 2v8l3-3m-3 3l-3-3m-4 8a9 9 0 1018 0');
                path.setAttribute('stroke', 'white');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('fill', 'none');
                svg.appendChild(path);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' DL+Play'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:linear-gradient(135deg,#22c55e,#f97316);color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:opacity 0.2s;`;
                btn.onmouseenter = () => { btn.style.opacity = '0.8'; };
                btn.onmouseleave = () => { btn.style.opacity = '1'; };
                btn.addEventListener('click', () => {
                    showToast('⬇️ Downloading & preparing to play...', '#22c55e');
                    window.location.href = 'ytdlplay://' + encodeURIComponent(window.location.href);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('downloadPlayButton', '#top-level-buttons-computed', '.ytkit-dlplay-btn', this._createButton.bind(this));
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('downloadPlayButton');
                document.querySelector('.ytkit-dlplay-btn')?.remove();
            }
        },
        {
            id: 'subsVlcPlaylist',
            name: 'Subscriptions VLC Button',
            description: 'Add button on subscriptions page to queue all videos to VLC playlist',
            group: 'Downloads',
            icon: 'list-video',
            _queuedVideos: new Set(),
            _styleElement: null,

            _getQueuedVideos() {
                try {
                    const stored = localStorage.getItem('ytkit-queued-videos');
                    return stored ? new Set(JSON.parse(stored)) : new Set();
                } catch {
                    return new Set();
                }
            },

            _saveQueuedVideos() {
                try {
                    localStorage.setItem('ytkit-queued-videos', JSON.stringify([...this._queuedVideos]));
                } catch {}
            },

            _markVideoQueued(videoId, element) {
                this._queuedVideos.add(videoId);
                this._saveQueuedVideos();

                if (element) {
                    element.classList.add('ytkit-video-queued');
                    // Add overlay badge
                    if (!element.querySelector('.ytkit-queued-badge')) {
                        const badge = document.createElement('div');
                        badge.className = 'ytkit-queued-badge';
                        badge.textContent = '✓ Queued';
                        const thumbnail = element.querySelector('ytd-thumbnail, #thumbnail');
                        if (thumbnail) {
                            thumbnail.style.position = 'relative';
                            thumbnail.appendChild(badge);
                        }
                    }
                }
            },

            _isVideoQueued(videoId) {
                return this._queuedVideos.has(videoId);
            },

            _getAllVideosOnPage() {
                const videos = [];
                // Find all video renderers on subscriptions page
                const selectors = [
                    'ytd-rich-item-renderer',
                    'ytd-grid-video-renderer',
                    'ytd-video-renderer'
                ];

                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(item => {
                        const link = item.querySelector('a#thumbnail, a.ytd-thumbnail');
                        if (link && link.href && link.href.includes('/watch?v=')) {
                            const match = link.href.match(/[?&]v=([^&]+)/);
                            if (match) {
                                videos.push({
                                    id: match[1],
                                    url: link.href,
                                    element: item
                                });
                            }
                        }
                    });
                });

                return videos;
            },

            async _queueAllVideos() {
                const videos = this._getAllVideosOnPage();
                const unqueuedVideos = videos.filter(v => !this._isVideoQueued(v.id));

                if (unqueuedVideos.length === 0) {
                    showToast('✅ All videos already queued!', '#22c55e');
                    return;
                }

                showToast(`📋 Queueing ${unqueuedVideos.length} videos to VLC...`, '#f97316');

                // Queue videos with small delay between each
                for (let i = 0; i < unqueuedVideos.length; i++) {
                    const video = unqueuedVideos[i];

                    // Mark as queued visually
                    this._markVideoQueued(video.id, video.element);

                    // Send to VLC queue
                    window.location.href = 'ytvlcq://' + encodeURIComponent(video.url);

                    // Small delay to allow protocol handler to process
                    if (i < unqueuedVideos.length - 1) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                }

                showToast(`✅ Queued ${unqueuedVideos.length} videos to VLC!`, '#22c55e');
            },

            _clearQueueMarks() {
                this._queuedVideos.clear();
                this._saveQueuedVideos();
                document.querySelectorAll('.ytkit-video-queued').forEach(el => {
                    el.classList.remove('ytkit-video-queued');
                });
                document.querySelectorAll('.ytkit-queued-badge').forEach(el => el.remove());
                showToast('🗑️ Queue marks cleared', '#6b7280');
            },

            _applyQueuedMarks() {
                const videos = this._getAllVideosOnPage();
                videos.forEach(video => {
                    if (this._isVideoQueued(video.id)) {
                        this._markVideoQueued(video.id, video.element);
                    }
                });
            },

            _createButton() {
                if (document.querySelector('.ytkit-subs-vlc-btn')) return;

                // Find the header area on subscriptions page
                const headerContainer = document.querySelector('#title-container, #page-header, ytd-page-manager #header');
                const buttonContainer = document.querySelector('#buttons, #header-buttons, #start #buttons');

                // Try to find a suitable container
                let container = buttonContainer || headerContainer;
                if (!container) {
                    // Create our own container near the title
                    const title = document.querySelector('yt-page-header-renderer, #page-header');
                    if (title) {
                        container = document.createElement('div');
                        container.className = 'ytkit-subs-btn-container';
                        container.style.cssText = 'display:flex;gap:8px;margin-left:auto;padding:8px 16px;';
                        title.appendChild(container);
                    }
                }

                if (!container) return;

                // Helper to create SVG elements
                const ns = 'http://www.w3.org/2000/svg';
                const createSvgElement = (tag, attrs) => {
                    const el = document.createElementNS(ns, tag);
                    for (const [k, v] of Object.entries(attrs)) {
                        el.setAttribute(k, v);
                    }
                    return el;
                };

                // Queue All button
                const queueBtn = document.createElement('button');
                queueBtn.className = 'ytkit-subs-vlc-btn';
                queueBtn.title = 'Add all subscription videos to VLC queue';

                // Build SVG using DOM
                const queueSvg = createSvgElement('svg', { viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
                queueSvg.appendChild(createSvgElement('line', { x1: '8', y1: '6', x2: '21', y2: '6' }));
                queueSvg.appendChild(createSvgElement('line', { x1: '8', y1: '12', x2: '21', y2: '12' }));
                queueSvg.appendChild(createSvgElement('line', { x1: '8', y1: '18', x2: '21', y2: '18' }));
                const c1 = createSvgElement('circle', { cx: '3', cy: '6', r: '1.5' }); c1.setAttribute('fill', 'currentColor'); queueSvg.appendChild(c1);
                const c2 = createSvgElement('circle', { cx: '3', cy: '12', r: '1.5' }); c2.setAttribute('fill', 'currentColor'); queueSvg.appendChild(c2);
                const c3 = createSvgElement('circle', { cx: '3', cy: '18', r: '1.5' }); c3.setAttribute('fill', 'currentColor'); queueSvg.appendChild(c3);
                queueBtn.appendChild(queueSvg);

                const queueText = document.createElement('span');
                queueText.textContent = 'Queue All to VLC';
                queueBtn.appendChild(queueText);

                queueBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 16px;
                    border-radius: 20px;
                    border: none;
                    background: #f97316;
                    color: white;
                    font-family: "Roboto", Arial, sans-serif;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                `;
                queueBtn.onmouseenter = () => { queueBtn.style.background = '#ea580c'; };
                queueBtn.onmouseleave = () => { queueBtn.style.background = '#f97316'; };
                queueBtn.addEventListener('click', () => this._queueAllVideos());

                // Clear button
                const clearBtn = document.createElement('button');
                clearBtn.className = 'ytkit-subs-clear-btn';
                clearBtn.title = 'Clear queue marks';

                // Build clear SVG using DOM
                const clearSvg = createSvgElement('svg', { viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
                clearSvg.appendChild(createSvgElement('path', { d: 'M3 6h18' }));
                clearSvg.appendChild(createSvgElement('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }));
                clearSvg.appendChild(createSvgElement('path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }));
                clearBtn.appendChild(clearSvg);

                clearBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: none;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    cursor: pointer;
                    transition: background 0.2s;
                `;
                clearBtn.onmouseenter = () => { clearBtn.style.background = 'rgba(255,255,255,0.2)'; };
                clearBtn.onmouseleave = () => { clearBtn.style.background = 'rgba(255,255,255,0.1)'; };
                clearBtn.addEventListener('click', () => this._clearQueueMarks());

                container.appendChild(queueBtn);
                container.appendChild(clearBtn);
            },

            _injectStyles() {
                if (this._styleElement) return;

                this._styleElement = document.createElement('style');
                this._styleElement.textContent = `
                    .ytkit-video-queued ytd-thumbnail,
                    .ytkit-video-queued #thumbnail {
                        opacity: 0.6;
                    }

                    .ytkit-video-queued::after {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(249, 115, 22, 0.1);
                        pointer-events: none;
                    }

                    .ytkit-queued-badge {
                        position: absolute;
                        top: 8px;
                        left: 8px;
                        background: #22c55e;
                        color: white;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        font-family: "Roboto", Arial, sans-serif;
                        z-index: 100;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    }

                    .ytkit-subs-btn-container {
                        position: fixed;
                        top: 56px;
                        right: 24px;
                        z-index: 1000;
                        display: flex;
                        gap: 8px;
                    }
                `;
                document.head.appendChild(this._styleElement);
            },

            init() {
                this._queuedVideos = this._getQueuedVideos();
                this._injectStyles();

                // Only activate on subscriptions page
                const checkAndCreate = () => {
                    if (window.location.pathname === '/feed/subscriptions') {
                        setTimeout(() => {
                            this._createButton();
                            this._applyQueuedMarks();
                        }, 1000);
                    }
                };

                // Check on navigation
                addNavigateRule(this.id + '_nav', checkAndCreate);
                checkAndCreate();

                // Re-apply marks when new content loads
                addMutationRule(this.id + '_marks', () => {
                    if (window.location.pathname === '/feed/subscriptions') {
                        this._applyQueuedMarks();
                    }
                });
            },

            destroy() {
                this._styleElement?.remove();
                removeMutationRule(this.id + '_marks');
                removeNavigateRule(this.id + '_nav');
                document.querySelector('.ytkit-subs-vlc-btn')?.remove();
                document.querySelector('.ytkit-subs-clear-btn')?.remove();
                document.querySelectorAll('.ytkit-queued-badge').forEach(el => el.remove());
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
            _serverPort: 9547,

            _injectStyles() {
                if (this._styleElement) return;

                this._styleElement = document.createElement('style');
                this._styleElement.id = 'ytkit-context-menu-styles';
                this._styleElement.textContent = `
                    .ytkit-context-menu {
                        position: fixed;
                        z-index: 999999;
                        background: #1a1a2e;
                        border: 1px solid #333;
                        border-radius: 8px;
                        padding: 6px 0;
                        min-width: 220px;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                        font-family: "Roboto", Arial, sans-serif;
                        font-size: 14px;
                        animation: ytkit-menu-fade 0.15s ease-out;
                    }

                    @keyframes ytkit-menu-fade {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }

                    .ytkit-context-menu-header {
                        padding: 8px 14px;
                        color: #888;
                        font-size: 11px;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        border-bottom: 1px solid #333;
                        margin-bottom: 4px;
                    }

                    .ytkit-context-menu-item {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 10px 14px;
                        color: #e0e0e0;
                        cursor: pointer;
                        transition: background 0.1s;
                    }

                    .ytkit-context-menu-item:hover {
                        background: #2d2d44;
                    }

                    .ytkit-context-menu-item svg {
                        width: 18px;
                        height: 18px;
                        flex-shrink: 0;
                    }

                    .ytkit-context-menu-item.ytkit-item-video svg { color: #22c55e; }
                    .ytkit-context-menu-item.ytkit-item-audio svg { color: #8b5cf6; }
                    .ytkit-context-menu-item.ytkit-item-transcript svg { color: #3b82f6; }
                    .ytkit-context-menu-item.ytkit-item-vlc svg { color: #f97316; }
                    .ytkit-context-menu-item.ytkit-item-mpv svg { color: #ec4899; }
                    .ytkit-context-menu-item.ytkit-item-embed svg { color: #06b6d4; }
                    .ytkit-context-menu-item.ytkit-item-copy svg { color: #fbbf24; }

                    .ytkit-context-menu-divider {
                        height: 1px;
                        background: #333;
                        margin: 6px 0;
                    }

                    .ytkit-context-menu-item .ytkit-shortcut {
                        margin-left: auto;
                        color: #666;
                        font-size: 12px;
                    }
                `;
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
                    { id: 'copy-url', icon: 'link', label: 'Copy Video URL', class: 'ytkit-item-copy', action: () => this._copyURL() },
                    { id: 'copy-id', icon: 'hash', label: 'Copy Video ID', class: 'ytkit-item-copy', action: () => this._copyID() },
                ];

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
                showToast('⬇️ Starting video download...', '#22c55e');
                window.location.href = 'ytdl://' + encodeURIComponent(url);
            },

            _downloadAudio() {
                const url = window.location.href;
                showToast('🎵 Starting audio download...', '#a855f7');
                // Use ytdl with audio-only flag (assuming handler supports it)
                window.location.href = 'ytdl://' + encodeURIComponent(url + '&ytkit_audio_only=1');
            },

            async _downloadTranscript() {
                await TranscriptService.downloadTranscript();
            },

            _streamVLC() {
                const url = window.location.href;
                showToast('Sending to VLC...', '#f97316');
                window.location.href = 'ytvlc://' + encodeURIComponent(url);
            },

            _streamMPV() {
                const url = window.location.href;
                showToast('🎬 Sending to MPV...', '#8b5cf6');
                window.location.href = 'ytmpv://' + encodeURIComponent(url);
            },

            _addToVLCQueue() {
                const url = window.location.href;
                showToast('📋 Adding to VLC queue...', '#f97316');
                window.location.href = 'ytvlcq://' + encodeURIComponent(url);
            },

            async _activateEmbed() {
                if (embedFeature && typeof embedFeature.activateEmbed === 'function') {
                    embedFeature._injectStyles();
                    await embedFeature.activateEmbed(true);
                }
            },

            _copyURL() {
                navigator.clipboard.writeText(window.location.href).then(() => {
                    this._showToast('URL copied to clipboard');
                });
            },

            _copyID() {
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (videoId) {
                    navigator.clipboard.writeText(videoId).then(() => {
                        this._showToast('Video ID copied: ' + videoId);
                    });
                }
            },

            _showToast(message) {
                showToast(message, '#22c55e');
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
                document.addEventListener('scroll', this._scrollHandler);

                // Also add directly to movie_player when it appears
                this._attachToPlayer = () => {
                    const moviePlayer = document.querySelector('#movie_player');
                    if (moviePlayer && !moviePlayer._ytkitContextMenu) {
                        moviePlayer._ytkitContextMenu = true;
                        moviePlayer.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            this._showMenu(e.clientX, e.clientY);
                            return false;
                        }, true);
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
                removeNavigateRule('contextMenuAttach');
                this._menu?.remove();
                this._menu = null;
                this._styleElement?.remove();
                this._styleElement = null;
            }
        },

        {
            id: 'autoSkipStillWatching',
            name: 'Auto-Skip "Still Watching?"',
            description: 'Automatically dismiss the "Video paused. Continue watching?" popup',
            group: 'Playback',
            icon: 'skip-forward',
            _observer: null,
            _checkInterval: null,
            init() {
                const dismissPopup = () => {
                    // Look for the "Still watching?" / "Continue watching?" dialog
                    const confirmButton = document.querySelector(
                        'yt-confirm-dialog-renderer #confirm-button, ' +
                        '.ytp-pause-overlay-container button, ' +
                        'ytd-popup-container yt-confirm-dialog-renderer button.yt-spec-button-shape-next--filled, ' +
                        'tp-yt-paper-dialog #confirm-button, ' +
                        'ytd-enforcement-message-view-model button'
                    );
                    if (confirmButton) {
                        const dialogText = confirmButton.closest('yt-confirm-dialog-renderer, tp-yt-paper-dialog')?.textContent?.toLowerCase() || '';
                        if (dialogText.includes('still watching') || dialogText.includes('continue watching') || dialogText.includes('video paused')) {
                            confirmButton.click();
                            showToast('Auto-dismissed "Still watching?" popup', '#22c55e');
                            StatsTracker.increment('stillWatchingDismissed');
                            DebugManager.log('StillWatching', 'Dismissed popup');
                        }
                    }

                    // Also check for the pause overlay
                    const pauseOverlay = document.querySelector('.ytp-pause-overlay');
                    if (pauseOverlay && pauseOverlay.style.display !== 'none') {
                        const playButton = document.querySelector('.ytp-play-button');
                        if (playButton) {
                            playButton.click();
                            showToast('Auto-resumed playback', '#22c55e');
                        }
                    }
                };

                // Check periodically
                this._checkInterval = setInterval(dismissPopup, 2000);

                // Also detect new dialogs via shared observer
                addMutationRule(this.id, () => setTimeout(dismissPopup, 100));
            },
            destroy() {
                if (this._checkInterval) clearInterval(this._checkInterval);
                removeMutationRule(this.id);
            }
        },

        // ─── Auto-Resume Last Position ───
        {
            id: 'autoResumePosition',
            name: 'Auto-Resume Position',
            description: 'Resume videos from where you left off (saves position for partially watched videos)',
            group: 'Playback',
            icon: 'play',
            _ruleId: 'autoResumeRule',
            _saveInterval: null,
            _storageKey: 'ytkit_resume_positions',
            _getPositions() {
                try { return JSON.parse(GM_getValue(this._storageKey, '{}')); } catch { return {}; }
            },
            _setPositions(p) { GM_setValue(this._storageKey, JSON.stringify(p)); },
            init() {
                const self = this;
                const threshold = appState.settings.autoResumeThreshold || 15;

                const tryResume = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const videoId = new URLSearchParams(window.location.search).get('v');
                    if (!videoId) return;
                    const positions = self._getPositions();
                    const saved = positions[videoId];
                    if (!saved || saved < threshold) return;
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || video.currentTime > threshold) return;
                    if (!isFinite(video.duration)) return; // Skip live streams
                    video.currentTime = saved;
                    showToast(`Resumed from ${Math.floor(saved / 60)}:${String(Math.floor(saved % 60)).padStart(2, '0')}`, '#3b82f6', { duration: 2 });
                    // Remove position after resuming
                    delete positions[videoId];
                    self._setPositions(positions);
                };

                addNavigateRule(this._ruleId, () => setTimeout(tryResume, 1500));

                // Save position every 10 seconds
                this._saveInterval = setInterval(() => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || video.paused || video.duration < 60 || !isFinite(video.duration)) return;
                    const videoId = new URLSearchParams(window.location.search).get('v');
                    if (!videoId) return;
                    // Don't save if near start or near end (within 10%)
                    if (video.currentTime < threshold || video.currentTime > video.duration * 0.9) return;
                    const positions = self._getPositions();
                    positions[videoId] = Math.floor(video.currentTime);
                    // Keep only last 200 entries
                    const keys = Object.keys(positions);
                    if (keys.length > 200) { keys.slice(0, keys.length - 200).forEach(k => delete positions[k]); }
                    self._setPositions(positions);
                }, 10000);
            },
            destroy() {
                removeNavigateRule(this._ruleId);
                if (this._saveInterval) clearInterval(this._saveInterval);
            }
        },
        {
            id: 'autoResumeThreshold',
            name: 'Resume Threshold',
            description: 'Seconds into a video before saving resume position',
            group: 'Playback',
            icon: 'clock',
            isSubFeature: true,
            parentId: 'autoResumePosition',
            type: 'range',
            settingKey: 'autoResumeThreshold',
            min: 5,
            max: 120,
            step: 5,
            formatValue: (v) => `${v}s`,
            init() {},
            destroy() {}
        },

        // ─── Playback Speed OSD ───
        {
            id: 'playbackSpeedOSD',
            name: 'Speed Change OSD',
            description: 'Show speed overlay on the video player (like VLC) instead of corner toast',
            group: 'Playback',
            icon: 'gauge',
            _observer: null,
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
                // Poll for speed changes (handles all sources: keyboard, extensions, scroll wheel)
                this._pollInterval = setInterval(checkSpeed, 200);
            },
            _showOSD(speed) {
                const player = document.querySelector('#movie_player');
                if (!player) return;
                let osd = player.querySelector('#ytkit-speed-osd');
                if (!osd) {
                    osd = document.createElement('div');
                    osd.id = 'ytkit-speed-osd';
                    osd.style.cssText = 'position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.75);color:#fff;padding:6px 14px;border-radius:6px;font-size:18px;font-weight:700;font-family:"Roboto",sans-serif;z-index:60;pointer-events:none;transition:opacity 0.3s;opacity:0;backdrop-filter:blur(4px);';
                    player.appendChild(osd);
                }
                osd.textContent = `${speed}x`;
                osd.style.opacity = '1';
                clearTimeout(this._osdTimeout);
                this._osdTimeout = setTimeout(() => { if (osd) osd.style.opacity = '0'; }, 1200);
            },
            destroy() {
                if (this._pollInterval) clearInterval(this._pollInterval);
                document.querySelector('#ytkit-speed-osd')?.remove();
            }
        },

        // ─── Video Speed Indicator Badge ───
        {
            id: 'speedIndicatorBadge',
            name: 'Speed Indicator Badge',
            description: 'Persistent badge on video player showing current speed when not 1x',
            group: 'Playback',
            icon: 'gauge',
            _pollInterval: null,
            _lastShown: null,
            init() {
                const self = this;
                this._pollInterval = setInterval(() => {
                    const video = document.querySelector('video.html5-main-video');
                    const player = document.querySelector('#movie_player');
                    if (!video || !player) return;
                    const speed = video.playbackRate;
                    let badge = player.querySelector('#ytkit-speed-badge');
                    if (speed === 1) {
                        if (badge) badge.style.opacity = '0';
                        self._lastShown = null;
                        return;
                    }
                    if (speed === self._lastShown) return;
                    self._lastShown = speed;
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.id = 'ytkit-speed-badge';
                        badge.style.cssText = 'position:absolute;top:12px;left:12px;background:rgba(204,0,0,0.85);color:#fff;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:700;font-family:"Roboto",sans-serif;z-index:60;pointer-events:none;transition:opacity 0.3s;backdrop-filter:blur(4px);';
                        player.appendChild(badge);
                    }
                    badge.textContent = `${speed}x`;
                    badge.style.opacity = '1';
                }, 500);
            },
            destroy() {
                if (this._pollInterval) clearInterval(this._pollInterval);
                document.querySelector('#ytkit-speed-badge')?.remove();
            }
        },

        // ─── Watch Time Tracker ───
        {
            id: 'watchTimeTracker',
            name: 'Watch Time Tracker',
            description: 'Track daily watch time by channel (view in Statistics Dashboard)',
            group: 'Playback',
            icon: 'clock',
            _pollInterval: null,
            _storageKey: 'ytkit_watch_time',
            _getWatchTime() {
                try { return JSON.parse(GM_getValue(this._storageKey, '{}')); } catch { return {}; }
            },
            _setWatchTime(d) { GM_setValue(this._storageKey, JSON.stringify(d)); },
            init() {
                const self = this;
                this._pollInterval = setInterval(() => {
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || video.paused || !window.location.pathname.startsWith('/watch')) return;
                    const channelEl = document.querySelector('ytd-channel-name #text a, ytd-video-owner-renderer ytd-channel-name a');
                    const channelName = channelEl?.textContent?.trim() || 'Unknown';
                    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                    const data = self._getWatchTime();
                    if (!data[today]) data[today] = {};
                    if (!data[today][channelName]) data[today][channelName] = 0;
                    data[today][channelName] += 30; // 30 seconds per tick
                    // Prune entries older than 90 days
                    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
                    for (const day of Object.keys(data)) { if (day < cutoff) delete data[day]; }
                    self._setWatchTime(data);
                }, 30000);
            },
            destroy() {
                if (this._pollInterval) clearInterval(this._pollInterval);
            }
        },

        // ─── Comment Navigator ───
        // ─── Per-Channel Settings ───
        {
            id: 'enablePerChannelSettings',
            name: 'Per-Channel Settings',
            description: 'Remember playback speed, volume, and quality per channel',
            group: 'Playback',
            icon: 'users',
            _lastVideoId: null,
            init() {
                const applyChannelSettings = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;

                    const videoId = new URLSearchParams(window.location.search).get('v');
                    if (videoId === this._lastVideoId) return;
                    this._lastVideoId = videoId;

                    const channelId = ChannelSettingsManager.getCurrentChannelId();
                    if (!channelId) return;

                    const settings = ChannelSettingsManager.getForChannel(channelId);
                    if (!settings) return;

                    const video = document.querySelector('video');
                    if (!video) return;

                    // Apply playback speed
                    if (settings.playbackSpeed && settings.playbackSpeed !== video.playbackRate) {
                        video.playbackRate = settings.playbackSpeed;
                        DebugManager.log('ChannelSettings', `Applied speed ${settings.playbackSpeed}x for channel ${channelId}`);
                    }

                    // Apply volume
                    if (settings.volume !== undefined && settings.volume !== video.volume) {
                        video.volume = settings.volume;
                    }
                };

                // Save current settings for channel
                const saveChannelSettings = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;

                    const channelId = ChannelSettingsManager.getCurrentChannelId();
                    const channelName = ChannelSettingsManager.getCurrentChannelName();
                    if (!channelId) return;

                    const video = document.querySelector('video');
                    if (!video) return;

                    ChannelSettingsManager.setForChannel(channelId, {
                        name: channelName,
                        playbackSpeed: video.playbackRate,
                        volume: video.volume
                    });
                };

                // Apply on navigation
                addNavigateRule('perChannelSettings', () => {
                    setTimeout(applyChannelSettings, 1000);
                });

                // Save periodically when video is playing
                this._saveInterval = setInterval(() => {
                    const video = document.querySelector('video');
                    if (video && !video.paused) {
                        saveChannelSettings();
                    }
                }, 30000); // Save every 30 seconds while playing
            },
            destroy() {
                removeNavigateRule('perChannelSettings');
                if (this._saveInterval) clearInterval(this._saveInterval);
            }
        },
        {
            id: 'channelSettingsExportImport',
            name: 'Export/Import Channel Settings',
            description: 'Backup and restore per-channel speed, volume, and quality preferences',
            group: 'Playback',
            icon: 'download',
            isSubFeature: true,
            parentId: 'enablePerChannelSettings',
            type: 'info',
            init() {},
            destroy() {}
        },

        // ─── Statistics Dashboard ───
        // ─── Regex Keyword Filter ───
        {
            id: 'useRegexKeywordFilter',
            name: 'Regex Keyword Filter',
            description: 'Use regular expressions for advanced keyword filtering (e.g., /\\[.*\\]/ to hide bracketed titles)',
            group: 'Video Hider',
            icon: 'filter',
            subFeatureOf: 'hideVideosFromHome',
            init() {
                // This modifies the behavior of hideVideosFromHome
                // The actual regex matching is handled in _shouldHide
            },
            destroy() {
                // Nothing to clean up
            }
        },

        // ─── Custom CSS Injection ───
        // ─── IntersectionObserver Performance Mode ───
        {
            id: 'useIntersectionObserver',
            name: 'Performance Mode',
            description: 'Use IntersectionObserver to only process visible videos (improves performance on long feeds)',
            group: 'Advanced',
            icon: 'gauge',
            init() {
                VisibilityObserver.init();

                // Add CSS containment for better rendering performance
                const style = document.createElement('style');
                style.id = 'ytkit-performance-css';
                style.textContent = `
                    ytd-rich-item-renderer,
                    ytd-video-renderer,
                    ytd-grid-video-renderer,
                    ytd-compact-video-renderer {
                        contain: content;
                    }

                    ytd-thumbnail {
                        contain: content;
                    }
                `;
                document.head.appendChild(style);
                this._styleElement = style;
            },
            destroy() {
                VisibilityObserver.disconnect();
                this._styleElement?.remove();
            }
        },

        // ═══════════════════════════════════════════════════════════════════
        //  CHAPTERFORGE — AI Chapter & POI Generation
        // ═══════════════════════════════════════════════════════════════════
        {
            id: 'chapterForge',
            name: 'ChapterForge',
            description: 'AI-powered chapter & POI generation for YouTube videos using WebLLM + Whisper transcription + Browser AI',
            group: 'ChapterForge',
            icon: 'player',
            isParent: true,

            // ── Internal state ──
            _whisperPipeline: null,
            _browserLLMPipeline: null,
            _browserLLMModelId: null,
            _transformersLib: null,
            _isGenerating: false,
            _currentVideoId: null,
            _currentDuration: 0,
            _chapterData: null,
            _lastTranscriptSegments: null,
            _panelEl: null,
            _activeTab: 'chapters',
            _searchQuery: '',
            _searchResults: null,
            _globalSearchQuery: '',
            _globalSearchResults: null,
            _styleElement: null,
            _resizeObserver: null,
            _clickHandler: null,
            _navHandler: null,
            _barObsHandler: null,
            _chapterHUDEl: null,
            _chapterTrackingRAF: null,
            _lastActiveChapterIdx: -1,
            _fillerData: null,             // [{time, duration, word, segStart, segEnd}] detected filler words
            _pauseData: null,              // [{start, end, duration}] detected pauses
            _autoSkipRAF: null,            // single RAF handle for unified skip loop
            _autoSkipActive: false,        // whether autoskip is currently running
            _autoSkipSavedRate: null,      // saved playback rate before silence speedup
            _lastOllamaModels: null,       // cached list of installed Ollama model names
            _translatedSummary: null,      // translated summary text
            _translatedChapters: null,     // translated chapter titles
            _paceData: null,               // [{start, end, wpm}] speech pace per segment
            _keywordsPerChapter: null,     // [[keyword,...], ...] per chapter
            _chatHistory: [],              // [{role:'user'|'assistant', content}] Q&A chat
            _chatLoading: false,           // chat response in progress
            _flashcards: null,             // [{q, a}] generated flashcards
            _flashcardIdx: 0,              // current flashcard index
            _flashcardFlipped: false,      // whether current card is flipped
            _flashcardLoading: false,      // flashcard generation in progress
            _sbChapters: null,             // SponsorBlock community chapters
            _mindMapData: null,            // mind map outline text
            _mindMapLoading: false,        // mind map generation in progress
            _blogLoading: false,           // blog post generation in progress
    
            _CF_PROVIDERS: {
                builtin:    { name: 'Built-in (NLP)', endpoint: null, needsKey: false, defaultModel: null },
                ollama:     { name: 'Local AI (Ollama)', endpoint: 'http://localhost:11434/v1/chat/completions', needsKey: false, defaultModel: 'qwen3:32b' },
                openai:     { name: 'Web AI - OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', needsKey: true, defaultModel: 'gpt-4o' },
                openrouter: { name: 'Web AI - OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', needsKey: true, defaultModel: 'qwen/qwen3-32b' },
                custom:     { name: 'Web AI - Custom', endpoint: '', needsKey: false, defaultModel: '' },
            },
    

    
            _CF_CACHE_PREFIX: 'cf_cache_',
            _CF_TRANSCRIPT_PREFIX: 'cf_tx_',
            _CF_NOTES_PREFIX: 'cf_notes_',
            // Distinct, high-contrast chapter colors — each clearly identifiable
            _CF_COLORS: ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4'],
            // Readable foreground for each color
            _CF_COLORS_FG: ['#e0d4fc', '#cceeff', '#c6f7e2', '#fef3c7', '#fecaca', '#fce7f3', '#ddd6fe', '#cffafe'],

            _CF_SUMMARY_STYLES: {
                paragraph: { name: 'Paragraph', prompt: null },
                timestamped: { name: 'Timestamped', prompt: null },
                takeaways: { name: 'Key Takeaways', prompt: `ROLE: Video analyst. Extract the most important insights.\n\nTASK: List 5-10 key takeaways from this video transcript.\n\nCONSTRAINTS:\n- Each takeaway is one clear sentence starting with a bullet dash (-)\n- Focus on actionable insights, surprising facts, or core arguments\n- Order from most to least important\n- No timestamps, headers, preamble, or commentary\n- Output ONLY the bullet list. Nothing before. Nothing after.` },
                bullets: { name: 'Bullet Points', prompt: `ROLE: Video summarizer.\n\nTASK: Summarize this video as a concise bullet-point list.\n\nCONSTRAINTS:\n- Write 6-12 bullet points using dash (-) prefix\n- Each bullet is one sentence covering a distinct topic from the video\n- Cover topics in chronological order\n- No timestamps, headers, preamble, or commentary\n- Output ONLY the bullet list. Nothing before. Nothing after.` },
                studynotes: { name: 'Study Notes', prompt: `ROLE: Educational note-taker.\n\nTASK: Create structured study notes from this video transcript.\n\nCONSTRAINTS:\n- Start with a one-sentence TOPIC line\n- Group content into 3-5 sections with bold **Section Title** headers\n- Under each section, write 2-4 concise bullet points (dash prefix)\n- Include key terms, definitions, and examples mentioned\n- End with a "KEY TERMS:" line listing important vocabulary (comma-separated)\n- No timestamps, preamble, or commentary\n- Output ONLY the study notes. Nothing before. Nothing after.` },
                actionitems: { name: 'Action Items', prompt: `ROLE: Productivity assistant.\n\nTASK: Extract all actionable items, recommendations, and steps from this video.\n\nCONSTRAINTS:\n- List each action item as a checkbox line: [ ] Action description\n- Only include concrete, actionable recommendations the speaker makes\n- If the video has no actionable content, output: "No action items found in this video."\n- Order by sequence of appearance\n- No timestamps, headers, preamble, or commentary\n- Output ONLY the action items. Nothing before. Nothing after.` },
                blog: { name: 'Blog Post', prompt: `ROLE: Blog writer converting video content into a polished article.\n\nTASK: Transform this video transcript into a well-structured blog post.\n\nCONSTRAINTS:\n- Start with a compelling one-sentence hook (no "In this video" openings)\n- Use 3-5 bold **Section Headers** to organize the content\n- Write 2-4 sentences per section in engaging, readable prose\n- Preserve the speaker's key arguments, examples, and data points\n- End with a brief conclusion or takeaway paragraph\n- Write in third person ("the presenter explains..." not "I")\n- Total length: 400-800 words\n- No timestamps, no bullet points, no disclaimers\n- Output ONLY the blog post. Nothing before. Nothing after.` },
            },
    
            // ── Debug logging ──
    
            _log(...args) {
                if (appState.settings?.cfDebugLog) console.log('[ChapterForge]', ...args);
            },
            _warn(...args) {
                console.warn('[ChapterForge]', ...args);
            },
            _esc(str) {
                if (!str) return '';
                return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            },
    
            // ── Helpers ──
            _getVideoId() { return new URLSearchParams(window.location.search).get('v'); },
            _formatTime(seconds) {
                const s = Math.floor(seconds); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
                if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
                return `${m}:${String(sec).padStart(2,'0')}`;
            },
            _seekTo(seconds) { const v = document.querySelector('video.html5-main-video'); if (v) v.currentTime = seconds; },
            _getVideoDuration() { const v = document.querySelector('video.html5-main-video'); return v ? v.duration : 0; },
            _getCachedData(videoId) { try { const raw = localStorage.getItem(this._CF_CACHE_PREFIX + videoId); return raw ? JSON.parse(raw) : null; } catch { return null; } },
            _setCachedData(videoId, data) {
                try { localStorage.setItem(this._CF_CACHE_PREFIX + videoId, JSON.stringify(data)); } catch(e) {
                    const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(this._CF_CACHE_PREFIX)) keys.push(k); }
                    if (keys.length > 20) { keys.slice(0, 5).forEach(k => localStorage.removeItem(k)); try { localStorage.setItem(this._CF_CACHE_PREFIX + videoId, JSON.stringify(data)); } catch(e2) {} }
                }
            },
            _countCache() { let c = 0; for (let i = 0; i < localStorage.length; i++) { if (localStorage.key(i).startsWith(this._CF_CACHE_PREFIX)) c++; } return c; },
            _clearCache() { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(this._CF_CACHE_PREFIX)) keys.push(k); } keys.forEach(k => localStorage.removeItem(k)); },
    
            // ═══ TRANSCRIPT CACHE (for cross-video search) ═══
            _cacheTranscript(videoId, segments, title) {
                try {
                    const compact = segments.map(s => ({ s: Math.round(s.start), t: s.text }));
                    localStorage.setItem(this._CF_TRANSCRIPT_PREFIX + videoId, JSON.stringify({ title: title || videoId, segments: compact }));
                } catch(e) {
                    const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(this._CF_TRANSCRIPT_PREFIX)) keys.push(k); }
                    if (keys.length > 30) { keys.slice(0, 10).forEach(k => localStorage.removeItem(k)); try { localStorage.setItem(this._CF_TRANSCRIPT_PREFIX + videoId, JSON.stringify({ title: title || videoId, segments: segments.map(s => ({ s: Math.round(s.start), t: s.text })) })); } catch(e2) {} }
                }
            },
            _getCachedTranscript(videoId) { try { const raw = localStorage.getItem(this._CF_TRANSCRIPT_PREFIX + videoId); return raw ? JSON.parse(raw) : null; } catch { return null; } },
            _countTranscriptCache() { let c = 0; for (let i = 0; i < localStorage.length; i++) { if (localStorage.key(i).startsWith(this._CF_TRANSCRIPT_PREFIX)) c++; } return c; },
    
            // ═══ NOTES STORAGE ═══
            _getNotes(videoId) { try { const raw = localStorage.getItem(this._CF_NOTES_PREFIX + videoId); return raw ? JSON.parse(raw) : []; } catch { return []; } },
            _setNotes(videoId, notes) { try { localStorage.setItem(this._CF_NOTES_PREFIX + videoId, JSON.stringify(notes)); } catch(e) {} },
            _addNote(videoId, time, text) {
                const notes = this._getNotes(videoId);
                notes.push({ time: Math.round(time), text, ts: Date.now() });
                notes.sort((a, b) => a.time - b.time);
                this._setNotes(videoId, notes);
            },
            _removeNote(videoId, index) {
                const notes = this._getNotes(videoId);
                notes.splice(index, 1);
                this._setNotes(videoId, notes);
            },
    
            // ═══ SEARCH WITHIN VIDEO ═══
            _searchTranscript(query) {
                if (!this._lastTranscriptSegments?.length || !query?.trim()) return [];
                const q = query.toLowerCase().trim();
                const results = [];
                for (const seg of this._lastTranscriptSegments) {
                    const idx = seg.text.toLowerCase().indexOf(q);
                    if (idx !== -1) {
                        results.push({ time: seg.start, text: seg.text, matchIdx: idx });
                    }
                }
                return results;
            },
    
            // ═══ CROSS-VIDEO TRANSCRIPT SEARCH ═══
            _searchAllTranscripts(query) {
                if (!query?.trim()) return [];
                const q = query.toLowerCase().trim();
                const results = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key.startsWith(this._CF_TRANSCRIPT_PREFIX)) continue;
                    const videoId = key.slice(this._CF_TRANSCRIPT_PREFIX.length);
                    try {
                        const data = JSON.parse(localStorage.getItem(key));
                        if (!data?.segments) continue;
                        const matches = [];
                        for (const seg of data.segments) {
                            if (seg.t.toLowerCase().includes(q)) {
                                matches.push({ time: seg.s, text: seg.t });
                            }
                        }
                        if (matches.length) results.push({ videoId, title: data.title || videoId, matches });
                    } catch(e) {}
                }
                return results;
            },
    
            // ═══ VIDEO SUMMARY ═══
            async _generateSummary(showBubble) {
                const videoId = this._getVideoId();
                if (!videoId) { this._log('Summary: no videoId'); return null; }
                const btn = document.getElementById('cf-summary-btn');
                const actionBtn = document.querySelector('.ytkit-summarize-btn');
                const _resetButtons = () => {
                    if (btn) { btn.disabled = false; btn.textContent = 'Summarize'; }
                    if (actionBtn) { actionBtn.disabled = false; actionBtn.style.opacity = '1'; }
                };
                if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
                if (actionBtn) { actionBtn.disabled = true; actionBtn.style.opacity = '0.6'; }
                this._updateStatus('Summarizing...', 'loading', 20);

                try {
                let segments = this._lastTranscriptSegments;
                if (!segments?.length) {
                    this._log('Summary: fetching transcript...');
                    segments = await this._fetchTranscript(videoId, (m, s, p) => this._updateStatus(m, s, p));
                    if (segments?.length) this._lastTranscriptSegments = segments;
                }
                if (!segments?.length) {
                    _resetButtons();
                    this._updateStatus('No transcript', 'error', 0);
                    showToast('No transcript available', '#ef4444');
                    return null;
                }
                this._log('Summary: got', segments.length, 'segments, provider:', appState.settings.cfLlmProvider || 'builtin');
    
                const provider = appState.settings.cfLlmProvider || 'builtin';
                const summaryMode = appState.settings.cfSummaryMode || 'paragraph';
                let summary;

                // ── System prompts ──
                const paragraphPrompt = `ROLE: Video summarizer. You write concise, readable summaries.

TASK: Write a clear summary of this video transcript in 3-6 sentences as flowing prose.

CONSTRAINTS:
- Write in plain paragraphs with NO timestamps, NO bullet points, NO headers, NO formatting
- Start with what the video is about, then cover the key points
- Use clear, direct language — no filler phrases like "In this video" or "The speaker goes on to"
- Do NOT add opinions, disclaimers, fact-checks, or commentary
- Report claims neutrally: "X explains that..." not "X controversially claims..."
- Output ONLY the summary paragraph(s). Nothing before. Nothing after.`;

                const timestampedPrompt = `ROLE: Transcript indexer. You extract timestamps and topics from transcripts. You are a machine that outputs structured data. You have no opinions.

TASK: Read the transcript. Output ONLY this format:

TOPIC: [1 sentence: who is speaking and what subject they discuss]

[MM:SS] Speaker discusses [topic]
[MM:SS] Speaker mentions [topic]
[MM:SS] Speaker claims [topic]

REFS: [comma list of proper nouns mentioned]

CONSTRAINTS:
- Output NOTHING before TOPIC and NOTHING after REFS
- Every line between TOPIC and REFS must begin with a [MM:SS] timestamp from the transcript
- Use ONLY the verbs: discusses, mentions, claims, describes, states, explains, references, lists, compares, asks
- Write 5-10 timestamp lines
- Bold proper nouns with **double asterisks**
- NEVER add disclaimers, warnings, evaluations, context, fact-checks, or commentary
- Your output must be a neutral index. Nothing more.`;

                // Allow user override, otherwise use mode-based prompt
                const stylePreset = this._CF_SUMMARY_STYLES[summaryMode];
                const presetPrompt = stylePreset?.prompt || (summaryMode === 'timestamped' ? timestampedPrompt : paragraphPrompt);
                // Apply length modifier
                const lengthSetting = appState.settings.cfSummaryLength || 'standard';
                const lengthMod = { brief: '\n\nLENGTH: Keep it very brief — 2-3 sentences or 3-5 bullet points max.', detailed: '\n\nLENGTH: Be thorough — 8-12 sentences or 10-15 bullet points, covering all major topics discussed.' };
                const basePrompt = presetPrompt + (lengthMod[lengthSetting] || '');
                const effectivePrompt = appState.settings.cfCustomSummaryPrompt || basePrompt;

                // Post-process: strip any preamble/disclaimer the model adds despite instructions
                const _stripEditorializing = (text) => {
                    if (!text) return text;
                    let lines = text.split('\n');
                    if (summaryMode === 'timestamped') {
                        const topicIdx = lines.findIndex(l => /^TOPIC:/i.test(l.trim()));
                        if (topicIdx > 0) lines = lines.slice(topicIdx);
                        const refsIdx = lines.findIndex(l => /^REFS:/i.test(l.trim()) || /^NAMES\/REFS:/i.test(l.trim()));
                        if (refsIdx >= 0) lines = lines.slice(0, refsIdx + 1);
                    }
                    const banPatterns = [
                        /^(it'?s |note:|disclaimer:|important|please |remember |keep in mind|here are|this (is|view|transcript)|consider |be (wary|careful)|crucial|fascinating|controversial|\*\*it)/i,
                        /critical thinking|healthy skepticism|multiple sources|fact.?check|mainstream support|lacks.*evidence|important to note/i,
                        /^(in this video|in this transcript|the video|the speaker|this content)/i,
                    ];
                    lines = lines.filter(l => {
                        const t = l.trim();
                        if (!t) return true;
                        return !banPatterns.some(p => p.test(t));
                    });
                    return lines.join('\n').trim();
                };

                // TextRank extractive fallback (used by builtin + as error fallback)
                const _extractiveSummary = (segs) => {
                    try {
                    const allText = segs.map(s => s.text).join(' ');
                    const rawSentences = allText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 25 && s.trim().length < 300);
                    if (rawSentences.length < 3) return allText.slice(0, 500);
                    const ranked = this._nlpTextRank(rawSentences, Math.min(6, Math.ceil(rawSentences.length * 0.15)));
                    return ranked.map(r => r.text.trim()).join(' ');
                    } catch(e) { this._warn('Extractive summary error:', e); return segs.map(s => s.text).join(' ').slice(0, 500); }
                };
    
                if (provider === 'builtin') {
                    this._log('Summary: using builtin TextRank');
                    summary = _extractiveSummary(segments);
                    if (summary.length > 800) summary = summary.slice(0, 797) + '...';
                } else {
                    try {
                        const isLocal = this._isLocalProvider();
                        const txLimit = isLocal ? 200000 : 30000;
                        const transcriptText = this._buildTranscriptText(segments, txLimit);
                        const vidTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || '';
                        const durationMin = Math.ceil((this._getVideoDuration() || 0) / 60);
                        this._updateStatus(isLocal ? `Summarizing full transcript locally (${Math.round(transcriptText.length/1000)}K chars)...` : 'Summarizing via API...', 'loading', 50);
                        const userMsg = summaryMode === 'timestamped'
                            ? `INDEX THIS TRANSCRIPT. Output TOPIC, timestamped lines, and REFS. Nothing else.\n\nVideo: ${durationMin} minutes${vidTitle ? ', "' + vidTitle + '"' : ''}\n\n${transcriptText}`
                            : `Process this ${durationMin}-minute video${vidTitle ? ' titled "' + vidTitle + '"' : ''} transcript as instructed.\n\n${transcriptText}`;
                        this._log('Summary: calling LLM API, mode:', summaryMode, 'prompt:', transcriptText.length, 'chars');
                        const rawText = await this._callLlmApi(effectivePrompt, userMsg, null);
                        this._log('Summary: got response,', rawText?.length, 'chars');
                        summary = (appState.settings.cfCustomSummaryPrompt || stylePreset?.prompt) ? rawText?.trim() : _stripEditorializing(rawText?.trim());
                    } catch(e) {
                        this._warn('Summary API error, falling back to extractive:', e.message);
                        summary = _extractiveSummary(segments);
                    }
                }
    
                this._lastSummary = summary;
                this._log('Summary: done,', summary?.length, 'chars');
                this._updateStatus('Done', 'ready', 100);
                _resetButtons();
                this._renderPanel();
                if (showBubble && summary) this._showSummaryBubble(summary);
                return summary;

                } catch(outerErr) {
                    this._warn('Summary unexpected error:', outerErr);
                    showToast('Summary failed: ' + (outerErr.message || 'unknown error'), '#ef4444');
                    _resetButtons();
                    this._updateStatus('Summary error', 'error', 0);
                    return null;
                }
            },

            _formatSummaryHTML(text) {
                if (!text) return '';
                let html = text
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>');
                // Style TOPIC: and REFS: headers
                html = html.replace(/^TOPIC:\s*/gm, '<span class="cf-bubble-label">TOPIC</span> ');
                html = html.replace(/^(REFS|NAMES\/REFS):\s*/gm, '<span class="cf-bubble-label">REFS</span> ');
                html = html.replace(/^OUTLINE:\s*$/gm, '');
                // Convert [MM:SS] or [H:MM:SS] timestamps to clickable links
                html = html.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (match, ts) => {
                    const parts = ts.split(':').map(Number);
                    let seconds = 0;
                    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    else seconds = parts[0] * 60 + parts[1];
                    return `<a class="cf-bubble-ts" data-cf-seek="${seconds}">[${ts}]</a>`;
                });
                // Convert markdown-style lists (- item) to styled lines
                html = html.replace(/^- /gm, '<span class="cf-bubble-bullet"></span>');
                // Line breaks, collapse multiple blanks
                html = html.replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br>');
                return html;
            },

            _showSummaryBubble(summary) {
                this._hideSummaryBubble();
                const player = document.getElementById('movie_player');
                if (!player) return;

                const bubble = document.createElement('div');
                bubble.id = 'cf-summary-bubble';
                const providerLabel = this._CF_PROVIDERS[appState.settings.cfLlmProvider || 'builtin']?.name || 'Built-in';

                const headerHTML = `<div class="cf-bubble-header">
                    <div class="cf-bubble-title-row">
                        <div class="cf-bubble-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
                        <span class="cf-bubble-title">TL;DR</span>
                        <span class="cf-bubble-provider">${providerLabel}</span>
                    </div>
                    <div class="cf-bubble-actions">
                        <button class="cf-bubble-btn" id="cf-bubble-copy" title="Copy"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        <button class="cf-bubble-btn cf-bubble-close-btn" id="cf-bubble-close" title="Close"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                </div>`;

                const bodyHTML = `<div class="cf-bubble-body">${this._formatSummaryHTML(summary)}</div>`;

                TrustedHTML.setHTML(bubble, headerHTML + bodyHTML);

                bubble.querySelector('#cf-bubble-close')?.addEventListener('click', () => this._hideSummaryBubble());
                bubble.querySelector('#cf-bubble-copy')?.addEventListener('click', () => {
                    navigator.clipboard.writeText(summary);
                    const btn = bubble.querySelector('#cf-bubble-copy');
                    if (btn) { TrustedHTML.setHTML(btn, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'); setTimeout(() => { TrustedHTML.setHTML(btn, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'); }, 1500); }
                });
                // Clickable timestamps seek the video
                bubble.querySelectorAll('.cf-bubble-ts').forEach(ts => {
                    ts.addEventListener('click', (e) => {
                        e.preventDefault();
                        const seconds = parseInt(ts.dataset.cfSeek, 10);
                        if (!isNaN(seconds)) {
                            const video = document.querySelector('video.html5-main-video');
                            if (video) video.currentTime = seconds;
                        }
                    });
                });

                // Escape key closes
                bubble._keyHandler = (e) => { if (e.key === 'Escape') this._hideSummaryBubble(); };
                document.addEventListener('keydown', bubble._keyHandler);

                // Close on click outside
                bubble._outsideClick = (e) => { if (!bubble.contains(e.target) && !e.target.closest('.ytkit-summarize-btn')) this._hideSummaryBubble(); };
                setTimeout(() => document.addEventListener('click', bubble._outsideClick), 200);

                // Overlay on the player
                player.style.position = 'relative';
                player.appendChild(bubble);

                // Animate in
                requestAnimationFrame(() => { bubble.classList.add('cf-bubble-visible'); });
            },

            _hideSummaryBubble() {
                const existing = document.getElementById('cf-summary-bubble');
                if (existing) {
                    if (existing._outsideClick) document.removeEventListener('click', existing._outsideClick);
                    if (existing._keyHandler) document.removeEventListener('keydown', existing._keyHandler);
                    existing.classList.remove('cf-bubble-visible');
                    existing.classList.add('cf-bubble-hiding');
                    setTimeout(() => existing.remove(), 250);
                }
            },
            _lastSummary: null,
    
            // ═══ EXPORT CHAPTERS ═══
            _exportChaptersYouTube() {
                if (!this._chapterData?.chapters?.length) return;
                const lines = this._chapterData.chapters.map(ch => `${this._formatTime(ch.start)} ${ch.title}`);
                navigator.clipboard.writeText(lines.join('\n'));
            },
            _exportChaptersJSON() {
                if (!this._chapterData) return;
                const blob = new Blob([JSON.stringify(this._chapterData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `chapters_${this._getVideoId()}.json`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            },
    
            // ═══ SMART CLIP LINKS ═══
            _copyClipLink(startTime, endTime) {
                const videoId = this._getVideoId();
                if (!videoId) return;
                let url = `https://youtu.be/${videoId}?t=${Math.round(startTime)}`;
                if (endTime) url = `https://youtube.com/clip/${videoId}?t=${Math.round(startTime)}&end=${Math.round(endTime)}`;
                navigator.clipboard.writeText(url);
            },

            // ═══ Q&A CHAT ═══
            async _sendChatMessage(question) {
                if (!question?.trim() || this._chatLoading) return;
                const provider = appState.settings.cfLlmProvider || 'builtin';
                if (provider === 'builtin') { showToast('Q&A Chat requires an AI provider (Ollama, OpenAI, etc.)', '#f59e0b'); return; }

                this._chatHistory.push({ role: 'user', content: question.trim() });
                this._chatLoading = true;
                this._renderPanel();

                try {
                    let segments = this._lastTranscriptSegments;
                    if (!segments?.length) {
                        segments = await this._fetchTranscript(this._getVideoId(), null);
                        if (segments?.length) this._lastTranscriptSegments = segments;
                    }
                    if (!segments?.length) throw new Error('No transcript available');

                    const isLocal = this._isLocalProvider();
                    const txLimit = isLocal ? 200000 : 30000;
                    const transcriptText = this._buildTranscriptText(segments, txLimit);
                    const vidTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || '';

                    const systemPrompt = `You are a helpful assistant answering questions about a YouTube video. Use ONLY the transcript provided to answer. If the answer isn't in the transcript, say so. Be concise and direct. When referencing specific moments, include timestamps in [MM:SS] format.`;

                    // Build conversation context (last 6 messages max for context window)
                    const recentHistory = this._chatHistory.slice(-7, -1);
                    let userMsg = `Video: "${vidTitle}"\n\nTranscript:\n${transcriptText}\n\n`;
                    if (recentHistory.length > 0) {
                        userMsg += `Previous conversation:\n`;
                        recentHistory.forEach(m => { userMsg += `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}\n`; });
                        userMsg += `\n`;
                    }
                    userMsg += `Question: ${question.trim()}`;

                    const response = await this._callLlmApi(systemPrompt, userMsg, null);
                    this._chatHistory.push({ role: 'assistant', content: response.trim() });
                } catch (e) {
                    this._warn('Chat error:', e);
                    this._chatHistory.push({ role: 'assistant', content: `Error: ${e.message}` });
                }
                this._chatLoading = false;
                this._renderPanel();
                // Scroll chat to bottom
                setTimeout(() => {
                    const chatBox = this._panelEl?.querySelector('.cf-chat-messages');
                    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
                }, 60);
            },

            // ═══ FLASHCARD GENERATION ═══
            async _generateFlashcards() {
                const provider = appState.settings.cfLlmProvider || 'builtin';
                if (provider === 'builtin') { showToast('Flashcards require an AI provider (Ollama, OpenAI, etc.)', '#f59e0b'); return; }
                if (this._flashcardLoading) return;
                this._flashcardLoading = true;
                this._renderPanel();

                try {
                    let segments = this._lastTranscriptSegments;
                    if (!segments?.length) {
                        segments = await this._fetchTranscript(this._getVideoId(), null);
                        if (segments?.length) this._lastTranscriptSegments = segments;
                    }
                    if (!segments?.length) throw new Error('No transcript available');

                    const isLocal = this._isLocalProvider();
                    const txLimit = isLocal ? 200000 : 30000;
                    const transcriptText = this._buildTranscriptText(segments, txLimit);
                    const vidTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || '';

                    const systemPrompt = `ROLE: Educational flashcard generator.

TASK: Generate 8-15 study flashcards from this video transcript.

OUTPUT FORMAT: Output ONLY valid JSON — an array of objects with "q" (question) and "a" (answer) keys.
Example: [{"q":"What is X?","a":"X is..."},{"q":"How does Y work?","a":"Y works by..."}]

CONSTRAINTS:
- Questions should test understanding of key concepts, facts, and processes discussed
- Answers should be concise (1-3 sentences max)
- Cover different topics from throughout the video
- Include a mix of: definitions, cause/effect, comparisons, and application questions
- Do NOT include timestamps
- Output ONLY the JSON array. No markdown fences, no preamble, no commentary.`;

                    const userMsg = `Generate study flashcards for this video${vidTitle ? ' titled "' + vidTitle + '"' : ''}.\n\n${transcriptText}`;
                    const rawText = await this._callLlmApi(systemPrompt, userMsg, null);

                    // Parse JSON — strip markdown fences if present
                    const cleaned = rawText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
                    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
                    if (!jsonMatch) throw new Error('LLM did not return valid JSON');
                    const cards = JSON.parse(jsonMatch[0]);
                    if (!Array.isArray(cards) || !cards.length || !cards[0].q) throw new Error('Invalid flashcard format');

                    this._flashcards = cards;
                    this._flashcardIdx = 0;
                    this._flashcardFlipped = false;
                    showToast(`Generated ${cards.length} flashcards`, '#10b981');
                } catch (e) {
                    this._warn('Flashcard error:', e);
                    showToast('Flashcard generation failed: ' + e.message, '#ef4444');
                }
                this._flashcardLoading = false;
                this._renderPanel();
            },

            _exportFlashcardsAnki() {
                if (!this._flashcards?.length) return;
                const lines = this._flashcards.map(c => `${c.q}\t${c.a}`);
                const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values' });
                const url = URL.createObjectURL(blob);
                const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()?.replace(/[^\w\s-]/g, '').slice(0, 50) || this._getVideoId();
                const a = document.createElement('a'); a.href = url; a.download = `flashcards_${title}.tsv`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                showToast('Exported as TSV (Anki/Quizlet)', '#10b981');
            },

            // ═══ MIND MAP GENERATION ═══
            async _generateMindMap() {
                const provider = appState.settings.cfLlmProvider || 'builtin';
                if (provider === 'builtin') { showToast('Mind Map requires an AI provider (Ollama, OpenAI, etc.)', '#f59e0b'); return; }
                if (this._mindMapLoading) return;
                this._mindMapLoading = true;
                this._renderPanel();

                try {
                    let segments = this._lastTranscriptSegments;
                    if (!segments?.length) {
                        segments = await this._fetchTranscript(this._getVideoId(), null);
                        if (segments?.length) this._lastTranscriptSegments = segments;
                    }
                    if (!segments?.length) throw new Error('No transcript available');

                    const isLocal = this._isLocalProvider();
                    const txLimit = isLocal ? 200000 : 30000;
                    const transcriptText = this._buildTranscriptText(segments, txLimit);
                    const vidTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || '';

                    const systemPrompt = `ROLE: Content outline generator.

TASK: Create a hierarchical mind map outline of this video's content.

OUTPUT FORMAT: Use indented text with these markers:
# Main Topic (the video's central subject)
## Major Section 1
  - Key point
  - Key point
    - Sub-detail
## Major Section 2
  - Key point
  - Key point

CONSTRAINTS:
- 3-6 major sections (##) covering distinct topics
- 2-5 key points (-) per section
- Sub-details only when genuinely important
- Keep each line under 60 characters
- No timestamps, no preamble, no commentary
- Start with exactly one # line for the video's central topic
- Output ONLY the outline. Nothing before. Nothing after.`;

                    const userMsg = `Generate a mind map outline for this video${vidTitle ? ' titled "' + vidTitle + '"' : ''}.\n\n${transcriptText}`;
                    const rawText = await this._callLlmApi(systemPrompt, userMsg, null);
                    this._mindMapData = rawText?.trim();
                    showToast('Mind map generated', '#10b981');
                } catch (e) {
                    this._warn('Mind map error:', e);
                    showToast('Mind map failed: ' + e.message, '#ef4444');
                }
                this._mindMapLoading = false;
                this._renderPanel();
            },

            _exportMindMapMermaid() {
                if (!this._mindMapData) return;
                const lines = this._mindMapData.split('\n').filter(l => l.trim());
                let mermaid = 'mindmap\n';
                lines.forEach(line => {
                    const stripped = line.replace(/^#+\s*/, '').replace(/^-\s*/, '').trim();
                    if (!stripped) return;
                    if (line.match(/^#\s/)) mermaid += `  root((${stripped}))\n`;
                    else if (line.match(/^##\s/)) mermaid += `    ${stripped}\n`;
                    else if (line.match(/^\s{4,}-/)) mermaid += `        ${stripped}\n`;
                    else if (line.match(/^\s*-/)) mermaid += `      ${stripped}\n`;
                });
                navigator.clipboard.writeText(mermaid);
                showToast('Mermaid mind map copied to clipboard', '#10b981');
            },

            _exportBlogMarkdown() {
                if (!this._lastSummary) { showToast('Generate a Blog Post summary first', '#f59e0b'); return; }
                const vidTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || 'Untitled Video';
                const videoId = this._getVideoId();
                const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
                const md = `# ${vidTitle}\n\n${this._lastSummary}\n\n---\n*Source: [${vidTitle}](${url})*\n`;
                const blob = new Blob([md], { type: 'text/markdown' });
                const dlUrl = URL.createObjectURL(blob);
                const safeName = vidTitle.replace(/[^\w\s-]/g, '').slice(0, 50).trim();
                const a = document.createElement('a'); a.href = dlUrl; a.download = `${safeName}.md`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(dlUrl);
                showToast('Blog post exported as Markdown', '#10b981');
            },

            // ═══ CUSTOM PROMPT LIBRARY ═══
            _getSavedPrompts() {
                try { return JSON.parse(GM_getValue('cf_prompt_library', '[]')); } catch { return []; }
            },
            _savePrompt(name, prompt) {
                const library = this._getSavedPrompts();
                const existing = library.findIndex(p => p.name === name);
                if (existing >= 0) library[existing].prompt = prompt;
                else library.push({ name, prompt });
                GM_setValue('cf_prompt_library', JSON.stringify(library));
                showToast(`Prompt "${name}" saved`, '#10b981');
            },
            _deletePrompt(name) {
                const library = this._getSavedPrompts().filter(p => p.name !== name);
                GM_setValue('cf_prompt_library', JSON.stringify(library));
                showToast(`Prompt "${name}" deleted`, '#10b981');
            },
            _loadPrompt(name) {
                const prompt = this._getSavedPrompts().find(p => p.name === name);
                if (prompt) {
                    appState.settings.cfCustomSummaryPrompt = prompt.prompt;
                    settingsManager.save(appState.settings);
                    showToast(`Loaded prompt: "${name}"`, '#10b981');
                }
            },

            // ═══ SPONSORBLOCK CHAPTER IMPORT ═══
            async _importSBChapters() {
                const videoId = this._getVideoId();
                if (!videoId) return;
                try {
                    const data = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=["chapter"]`,
                            headers: { 'Accept': 'application/json' },
                            timeout: 10000,
                            onload: (r) => {
                                if (r.status === 200) { try { resolve(JSON.parse(r.responseText)); } catch(e) { reject(new Error('Invalid JSON')); } }
                                else if (r.status === 404) resolve(null);
                                else reject(new Error(`HTTP ${r.status}`));
                            },
                            onerror: () => reject(new Error('Network error')),
                            ontimeout: () => reject(new Error('Timeout'))
                        });
                    });
                    if (!data || !data.length) {
                        showToast('No SponsorBlock chapters found for this video', '#f59e0b');
                        this._sbChapters = [];
                        return;
                    }
                    // Convert SB format to CF chapter format
                    const chapters = data
                        .filter(s => s.actionType === 'chapter')
                        .sort((a, b) => a.segment[0] - b.segment[0])
                        .map(s => ({ start: s.segment[0], end: s.segment[1], title: s.description || 'Chapter' }));
                    if (!chapters.length) {
                        showToast('No SponsorBlock chapters found', '#f59e0b');
                        this._sbChapters = [];
                        return;
                    }
                    this._sbChapters = chapters;
                    showToast(`Imported ${chapters.length} SponsorBlock chapters`, '#10b981');
                    this._renderPanel();
                } catch (e) {
                    this._warn('SponsorBlock import error:', e);
                    showToast('SponsorBlock: ' + e.message, '#ef4444');
                }
            },

            _applySBChapters() {
                if (!this._sbChapters?.length) return;
                this._chapterData = { chapters: this._sbChapters.map(c => ({ ...c })), pois: [] };
                this._renderProgressBarOverlay();
                this._startChapterTracking();
                this._renderPanel();
                showToast('Applied SponsorBlock chapters', '#10b981');
            },
    
            // ═══ CHAPTER-AWARE SPEED CONTROL ═══
            _speedControlActive: false,
            _speedControlRAF: null,
            _speedSettings: { introSpeed: 2, outroSpeed: 2, normalSpeed: 1, skipChapters: {} },
    
            _toggleSpeedControl() {
                this._speedControlActive = !this._speedControlActive;
                appState.settings.cfSpeedControl = this._speedControlActive;
                settingsManager.save(appState.settings);
                if (this._speedControlActive) this._startSpeedControl();
                else this._stopSpeedControl();
            },
            _startSpeedControl() {
                if (this._speedControlRAF) return;
                const check = () => {
                    if (!this._speedControlActive) return;
                    const video = document.querySelector('video.html5-main-video, video');
                    if (video && this._chapterData?.chapters?.length >= 2 && !video.paused) {
                        const ct = video.currentTime;
                        const chapters = this._chapterData.chapters;
                        const currentChapter = chapters.findIndex((ch, i) => ct >= ch.start && (i === chapters.length - 1 || ct < chapters[i + 1].start));
    
                        let targetSpeed = this._speedSettings.normalSpeed;
    
                        if (currentChapter >= 0 && this._speedSettings.skipChapters[currentChapter]) {
                            const nextChapter = chapters[currentChapter + 1];
                            if (nextChapter) { video.currentTime = nextChapter.start; }
                        } else if (currentChapter === 0) {
                            targetSpeed = this._speedSettings.introSpeed;
                        } else if (currentChapter === chapters.length - 1) {
                            targetSpeed = this._speedSettings.outroSpeed;
                        }
    
                        if (Math.abs(video.playbackRate - targetSpeed) > 0.01) {
                            video.playbackRate = targetSpeed;
                        }
                    }
                    this._speedControlRAF = requestAnimationFrame(check);
                };
                this._speedControlRAF = requestAnimationFrame(check);
            },
            _stopSpeedControl() {
                if (this._speedControlRAF) { cancelAnimationFrame(this._speedControlRAF); this._speedControlRAF = null; }
                const video = document.querySelector('video.html5-main-video, video');
                if (video) video.playbackRate = 1;
            },
    
            // ── GM helpers ──
            _gmGet(url, extraHeaders = {}) {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({ method: 'GET', url, anonymous: false,
                        headers: Object.keys(extraHeaders).length ? extraHeaders : undefined,
                        onload: (r) => {
                            this._log(`GM GET ${r.status} ${url.slice(0,80)}... (${(r.responseText||'').length} chars)`);
                            if (r.status >= 400) { reject(new Error(`GM GET HTTP ${r.status}`)); return; }
                            resolve(r.responseText || '');
                        },
                        onerror: (e) => { this._warn('GM GET error:', url.slice(0,80)); reject(new Error('GM GET error: ' + (e?.statusText || 'unknown'))); },
                        ontimeout: () => reject(new Error('GM GET timeout')),
                        timeout: 30000 });
                });
            },
            _gmPostJson(url, data, extraHeaders = {}, customTimeout = 30000) {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({ method: 'POST', url, anonymous: false,
                        headers: { 'Content-Type': 'application/json', ...extraHeaders },
                        data: typeof data === 'string' ? data : JSON.stringify(data),
                        onload: (r) => {
                            this._log(`GM POST ${r.status} ${url.slice(0,80)}... (${(r.responseText||'').length} chars)`);
                            if (r.status >= 400) { reject(new Error(`GM POST HTTP ${r.status}: ${(r.responseText||'').slice(0,200)}`)); return; }
                            try { resolve(JSON.parse(r.responseText)); } catch(e) {
                                // Fallback: try to reassemble streaming NDJSON (SSE) response
                                const text = r.responseText || '';
                                if (text.includes('data: ')) {
                                    try {
                                        let content = '';
                                        for (const line of text.split('\n')) {
                                            if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
                                            const chunk = JSON.parse(line.slice(6));
                                            const delta = chunk?.choices?.[0]?.delta?.content;
                                            if (delta) content += delta;
                                        }
                                        if (content) {
                                            resolve({ choices: [{ message: { content } }] });
                                            return;
                                        }
                                    } catch(e2) { /* fall through */ }
                                }
                                reject(new Error('GM POST JSON parse error'));
                            }
                        },
                        onerror: (e) => { this._warn('GM POST error:', url.slice(0,80)); reject(new Error('GM POST error')); },
                        ontimeout: () => reject(new Error('GM POST timeout')),
                        timeout: customTimeout });
                });
            },
            async _buildSapisidAuth() {
                try {
                    const cookies = document.cookie.split(';').map(c => c.trim());
                    const sapisid = cookies.find(c => c.startsWith('SAPISID=') || c.startsWith('__Secure-3PAPISID='));
                    if (!sapisid) return null;
                    const val = sapisid.split('=')[1]; const origin = 'https://www.youtube.com'; const ts = Math.floor(Date.now() / 1000);
                    const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${val} ${origin}`));
                    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                    return { authorization: `SAPISIDHASH ${ts}_${hash}`, 'x-origin': origin };
                } catch(e) { return null; }
            },
    
            // ═══════════════════════════════════════════
            //  TRANSCRIPT FETCHER
            // ═══════════════════════════════════════════
            async _fetchTranscript(videoId, onStatus) {
                const transcriptMethod = appState.settings.cfTranscriptMethod || 'auto';
    
                if (transcriptMethod === 'whisper-only') {
                    this._log('Transcript method: whisper-only — skipping captions');
                    return null;
                }

                if (transcriptMethod === 'vibe') {
                    this._log('Transcript method: vibe — trying WhisperServer first');
                    try {
                        return await this._vibeTranscribe(videoId, onStatus);
                    } catch(e) {
                        this._warn('WhisperServer transcription failed:', e.message);
                        this._log('Falling back to caption-based methods...');
                    }
                }
    
                this._log('=== Fetching transcript for:', videoId, '(method:', transcriptMethod, ') ===');
                onStatus?.('Fetching transcript...', 'loading', 5);
    
                // ── PRIMARY: Use YTKit's TranscriptService ──
                try {
                    onStatus?.('Trying YTKit TranscriptService...', 'loading', 8);
                    this._log('Method 1: YTKit TranscriptService._getCaptionTracks');
                    const trackData = await TranscriptService._getCaptionTracks(videoId);
                    if (trackData?.tracks?.length) {
                        this._log('TranscriptService found', trackData.tracks.length, 'tracks:', trackData.tracks.map(t => `${t.languageCode}(${t.kind})`).join(', '));
                        const selectedTrack = TranscriptService._selectBestTrack(trackData.tracks);
                        this._log('Selected track:', selectedTrack.languageCode, selectedTrack.kind);
    
                        if (selectedTrack.baseUrl) {
                            try {
                                const tsSegments = await TranscriptService._fetchTranscriptContent(selectedTrack.baseUrl);
                                if (tsSegments?.length) {
                                    this._log('TranscriptService delivered', tsSegments.length, 'segments');
                                    return tsSegments.map(s => ({
                                        start: (s.startMs || 0) / 1000,
                                        dur: ((s.endMs || 0) - (s.startMs || 0)) / 1000,
                                        text: s.text
                                    }));
                                }
                            } catch(e) {
                                this._log('TranscriptService._fetchTranscriptContent failed:', e.message);
                            }
    
                            this._log('Trying GM-backed caption download as fallback...');
                            onStatus?.('Trying GM caption fetch...', 'loading', 15);
                            const gmSegments = await this._gmDownloadCaptions(selectedTrack, videoId);
                            if (gmSegments?.length) {
                                this._log('GM caption download got', gmSegments.length, 'segments');
                                return gmSegments;
                            }
                        }
                    } else {
                        this._log('TranscriptService found no tracks');
                    }
                } catch(e) {
                    this._log('TranscriptService failed:', e.message);
                }
    
                // ── FALLBACK 2: Direct page-level variable access via unsafeWindow ──
                try {
                    onStatus?.('Trying page context access...', 'loading', 20);
                    this._log('Method 2: unsafeWindow.ytInitialPlayerResponse');
                    const pw = _rw;
                    const pr = pw.ytInitialPlayerResponse;
                    if (pr?.videoDetails?.videoId === videoId) {
                        const ct = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                        if (ct?.length) {
                            this._log('Found', ct.length, 'tracks via unsafeWindow');
                            const segments = await this._gmDownloadCaptions(ct[0], videoId, ct);
                            if (segments?.length) return segments;
                        } else {
                            this._log('unsafeWindow PR exists but no captionTracks (captions:', !!pr?.captions, ')');
                        }
                    } else {
                        this._log('unsafeWindow PR missing or stale (prVid:', pr?.videoDetails?.videoId, 'wanted:', videoId, ')');
                    }
                } catch(e) {
                    this._log('unsafeWindow access failed:', e.message);
                }
    
                // ── FALLBACK 3: Polymer element data ──
                try {
                    onStatus?.('Trying Polymer element data...', 'loading', 25);
                    this._log('Method 3: ytd-watch-flexy Polymer data');
                    const wf = document.querySelector('ytd-watch-flexy');
                    if (wf) {
                        for (const path of ['playerData_', '__data', 'data']) {
                            let pr = wf[path]; if (pr?.playerResponse) pr = pr.playerResponse;
                            if (!pr?.videoDetails || pr.videoDetails.videoId !== videoId) continue;
                            const ct = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                            if (ct?.length) {
                                this._log('Found', ct.length, 'tracks via flexy.' + path);
                                const segments = await this._gmDownloadCaptions(ct[0], videoId, ct);
                                if (segments?.length) return segments;
                            }
                        }
                    }
                    this._log('Polymer element: no tracks found');
                } catch(e) {
                    this._log('Polymer access failed:', e.message);
                }
    
                // ── FALLBACK 4: GM-backed fresh page fetch ──
                try {
                    onStatus?.('Fetching fresh page via GM...', 'loading', 30);
                    this._log('Method 4: GM page fetch');
                    const html = await this._gmGet(`https://www.youtube.com/watch?v=${videoId}`);
                    this._log('Got', html.length, 'chars, captionTracks:', html.includes('captionTracks'), 'timedtext:', html.includes('timedtext'));
    
                    // 4A: ytInitialPlayerResponse
                    const prMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s+(?:meta|head)|<\/script|\n)/s);
                    if (prMatch) {
                        try {
                            const pr = JSON.parse(prMatch[1]);
                            const ct = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                            if (ct?.length) {
                                this._log('4A: found', ct.length, 'tracks from page PR');
                                const segments = await this._gmDownloadCaptions(ct[0], videoId, ct);
                                if (segments?.length) return segments;
                            }
                        } catch(e) { this._log('4A: JSON parse failed:', e.message?.slice(0,80)); }
                    }
    
                    // 4B: captionTracks regex
                    if (html.includes('captionTracks')) {
                        for (const pat of [/"captionTracks":\s*(\[.*?\])(?=\s*,\s*")/s, /"captionTracks":\s*(\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*\])/]) {
                            const m = html.match(pat);
                            if (m) {
                                try {
                                    const parsed = JSON.parse(m[1]);
                                    if (parsed?.length) {
                                        this._log('4B: regex found', parsed.length, 'tracks');
                                        const segments = await this._gmDownloadCaptions(parsed[0], videoId, parsed);
                                        if (segments?.length) return segments;
                                    }
                                } catch(e) {}
                            }
                        }
                    }
    
                    // 4C: timedtext URL
                    if (html.includes('timedtext')) {
                        const urlMatch = html.match(/(https?:\\\/\\\/[^"]*timedtext[^"]*)/);
                        if (urlMatch) {
                            const cleanUrl = urlMatch[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
                            this._log('4C: extracted timedtext URL');
                            const segments = await this._gmDownloadCaptions({ baseUrl: cleanUrl, languageCode: 'en' }, videoId);
                            if (segments?.length) return segments;
                        }
                    }
                } catch(e) {
                    this._log('GM page fetch failed:', e.message);
                }
    
                // ── FALLBACK 5: Innertube player API via GM ──
                try {
                    onStatus?.('Trying Innertube player API...', 'loading', 40);
                    this._log('Method 5: Innertube player API');
                    const pw = _rw;
                    let apiKey; try { apiKey = pw.ytcfg?.get?.('INNERTUBE_API_KEY'); } catch(e) {}
                    if (!apiKey) apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
                    let clientVersion; try { clientVersion = pw.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION'); } catch(e) {}
                    if (!clientVersion) clientVersion = '2.20250210.01.00';
    
                    const body = { context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } }, videoId };
                    const authHeaders = await this._buildSapisidAuth() || {};
                    const data = await this._gmPostJson(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, body, authHeaders);
                    const ct = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (ct?.length) {
                        this._log('M5: found', ct.length, 'tracks');
                        const segments = await this._gmDownloadCaptions(ct[0], videoId, ct);
                        if (segments?.length) return segments;
                    } else {
                        this._log('M5: status:', data?.playabilityStatus?.status, 'reason:', data?.playabilityStatus?.reason?.slice(0,80) || 'none');
                    }
                } catch(e) {
                    this._log('Innertube player API failed:', e.message);
                }
    
                // ── FALLBACK 6: Innertube get_transcript ──
                try {
                    onStatus?.('Trying Innertube get_transcript...', 'loading', 50);
                    this._log('Method 6: Innertube get_transcript');
                    const segments = await this._fetchTranscriptViaInnertube(videoId, 'en');
                    if (segments?.length) {
                        this._log('get_transcript delivered', segments.length, 'segments');
                        return segments;
                    }
                } catch(e) {
                    this._log('get_transcript failed:', e.message);
                }
    
                // ── FALLBACK 7: DOM scrape ──
                try {
                    onStatus?.('Trying DOM transcript scrape...', 'loading', 55);
                    this._log('Method 7: DOM scrape');
                    const segments = await this._scrapeTranscriptFromDOM();
                    if (segments?.length) {
                        this._log('DOM scrape got', segments.length, 'segments');
                        return segments;
                    }
                } catch(e) {
                    this._log('DOM scrape failed:', e.message);
                }
    
                this._warn('ALL transcript methods failed for video:', videoId);
                return null;
            },
    
            // GM-backed caption download with SAPISIDHASH auth and multi-format fallback
            async _gmDownloadCaptions(trackOrFirst, videoId, allTracks) {
                let track = trackOrFirst;
                if (allTracks?.length) {
                    track = allTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
                         || allTracks.find(t => t.languageCode === 'en')
                         || allTracks.find(t => t.languageCode?.startsWith('en'))
                         || allTracks[0];
                }
                if (!track?.baseUrl) { this._log('No baseUrl in track:', JSON.stringify(track)?.slice(0,200)); return null; }
    
                let baseUrl = track.baseUrl;
                if (baseUrl.includes('\\u0026')) baseUrl = baseUrl.replace(/\\u0026/g, '&');
                if (baseUrl.includes('\\u002F')) baseUrl = baseUrl.replace(/\\u002F/g, '/');
                if (track.languageCode && !baseUrl.includes('&lang=')) baseUrl += '&lang=' + encodeURIComponent(track.languageCode);
                if (track.kind && !baseUrl.includes('&kind=')) baseUrl += '&kind=' + encodeURIComponent(track.kind);
                if (typeof track.name === 'string' && !baseUrl.includes('&name=')) baseUrl += '&name=' + encodeURIComponent(track.name);
    
                this._log('Downloading captions for track:', track.languageCode, track.kind || 'manual');
    
                const authHeaders = await this._buildSapisidAuth() || {};
                for (const fmt of ['json3', null, 'srv3']) {
                    try {
                        const url = fmt ? baseUrl + '&fmt=' + fmt : baseUrl;
                        this._log('A(GM): fmt=' + (fmt || 'xml'));
                        const text = await this._gmGet(url, authHeaders);
                        if (!text.length) continue;
                        const segments = this._parseCaptionResponse(text, fmt);
                        if (segments?.length) { this._log('A(GM): got', segments.length, 'segments via fmt=' + (fmt || 'xml')); return segments; }
                    } catch(e) { this._log('A(GM): fmt=' + (fmt || 'xml'), 'error:', e.message); }
                }
    
                for (const fmt of ['json3', null, 'srv3']) {
                    try {
                        const url = fmt ? baseUrl + '&fmt=' + fmt : baseUrl;
                        this._log('B(fetch): fmt=' + (fmt || 'xml'));
                        const resp = await fetch(url, { credentials: 'include' });
                        const text = await resp.text();
                        if (!text.length) continue;
                        const segments = this._parseCaptionResponse(text, fmt);
                        if (segments?.length) { this._log('B(fetch): got', segments.length, 'segments via fmt=' + (fmt || 'xml')); return segments; }
                    } catch(e) { this._log('B(fetch): fmt=' + (fmt || 'xml'), 'error:', e.message); }
                }
    
                this._log('All caption download methods failed for track:', track.languageCode);
                return null;
            },
    
            _parseCaptionResponse(text, fmt) {
                if (fmt === 'json3') {
                    try {
                        const data = JSON.parse(text); if (!data.events?.length) return null;
                        const segments = [];
                        for (const evt of data.events) { if (!evt.segs) continue; const t = evt.segs.map(s => s.utf8 || '').join('').trim(); if (!t || t === '\n') continue; segments.push({ start: (evt.tStartMs || 0) / 1000, dur: (evt.dDurationMs || 0) / 1000, text: t.replace(/\n/g, ' ').trim() }); }
                        return segments.length ? segments : null;
                    } catch(e) { return null; }
                }
                if (fmt === 'srv3') {
                    const segments = []; const re = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g; let m;
                    while ((m = re.exec(text)) !== null) { const raw = (m[3] || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n/g, ' ').trim(); if (raw) segments.push({ start: parseInt(m[1]||'0')/1000, dur: parseInt(m[2]||'0')/1000, text: raw }); }
                    return segments.length ? segments : null;
                }
                const segments = []; const re = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g; let m;
                while ((m = re.exec(text)) !== null) { const raw = (m[3] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/\n/g, ' ').trim(); if (raw) segments.push({ start: parseFloat(m[1]||'0'), dur: parseFloat(m[2]||'0'), text: raw }); }
                return segments.length ? segments : null;
            },
    
            async _fetchTranscriptViaInnertube(videoId, lang) {
                const pw = _rw;
                const vidBytes = [...new TextEncoder().encode(videoId)]; const langBytes = [...new TextEncoder().encode(lang || 'en')];
                function varint(val) { const b = []; while (val > 0x7f) { b.push((val & 0x7f) | 0x80); val >>>= 7; } b.push(val & 0x7f); return b; }
                function lenField(fieldNum, data) { const tag = varint((fieldNum << 3) | 2); return [...tag, ...varint(data.length), ...data]; }
                const f1 = lenField(1, vidBytes); const f2 = lenField(2, [...lenField(1, langBytes), ...lenField(3, [])]);
                const params = btoa(String.fromCharCode(...f1, ...f2));
                let apiKey; try { apiKey = pw.ytcfg?.get?.('INNERTUBE_API_KEY'); } catch(e) {}
                if (!apiKey) apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
                let clientVersion; try { clientVersion = pw.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION'); } catch(e) {}
                if (!clientVersion) clientVersion = '2.20250210.01.00';
                const body = { context: { client: { clientName: 'WEB', clientVersion, hl: lang || 'en', gl: 'US' } }, params };
                try { const si = pw.ytcfg?.get?.('SESSION_INDEX'); if (si !== undefined) body.context.request = { sessionIndex: String(si) }; } catch(e) {}
                const authHeaders = await this._buildSapisidAuth() || {};
                const data = await this._gmPostJson(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, body, authHeaders);
                if (data.error) { this._log('get_transcript error:', data.error.code, data.error.message); return null; }
                const paths = [data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.transcriptSegmentListRenderer?.initialSegments, data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments];
                for (const segs of paths) { if (segs?.length) return this._parseTranscriptSegments(segs); }
                this._log('get_transcript: no segments in response');
                return null;
            },
    
            _parseTranscriptSegments(segments) {
                const result = [];
                for (const seg of segments) { const r = seg.transcriptSegmentRenderer; if (!r) continue; const text = r.snippet?.runs?.map(x => x.text || '').join('').trim(); if (!text) continue; result.push({ start: parseInt(r.startMs||'0')/1000, dur: (parseInt(r.endMs||'0')-parseInt(r.startMs||'0'))/1000, text: text.replace(/\n/g,' ').trim() }); }
                return result.length ? result : null;
            },
    
            async _scrapeTranscriptFromDOM() {
                const existing = document.querySelectorAll('ytd-transcript-segment-renderer');
                if (existing.length) return this._extractTranscriptFromDOM(existing);
    
                const descExpand = document.querySelector('tp-yt-paper-button#expand, #expand.button, #description-inline-expander #expand');
                if (descExpand) descExpand.click();
                await new Promise(r => setTimeout(r, 500));
    
                const btnSelectors = ['button', 'ytd-button-renderer', 'yt-button-shape button'];
                for (const sel of btnSelectors) {
                    for (const btn of document.querySelectorAll(sel)) {
                        const text = btn.textContent?.trim().toLowerCase() || '';
                        if (text.includes('show transcript') || text.includes('transcript')) {
                            this._log('DOM scrape: clicking transcript button:', text);
                            btn.click();
                            break;
                        }
                    }
                }
    
                for (let i = 0; i < 20; i++) {
                    await new Promise(r => setTimeout(r, 300));
                    const segs = document.querySelectorAll('ytd-transcript-segment-renderer');
                    if (segs.length) return this._extractTranscriptFromDOM(segs);
                }
                return null;
            },
            _extractTranscriptFromDOM(segElements) {
                const result = [];
                for (const seg of segElements) {
                    const timeEl = seg.querySelector('.segment-timestamp, [class*="timestamp"]');
                    const textEl = seg.querySelector('.segment-text, [class*="text"], yt-formatted-string');
                    if (!textEl?.textContent?.trim()) continue;
                    const timeStr = timeEl?.textContent?.trim() || '0:00';
                    const parts = timeStr.split(':').map(Number);
                    let secs = 0;
                    if (parts.length === 3) secs = parts[0]*3600 + parts[1]*60 + parts[2];
                    else if (parts.length === 2) secs = parts[0]*60 + parts[1];
                    else secs = parts[0] || 0;
                    result.push({ start: secs, dur: 5, text: textEl.textContent.trim().replace(/\n/g, ' ') });
                }
                return result.length ? result : null;
            },
    
            _buildTranscriptText(segments, maxChars = 30000) {
                // Build 30-second blocks from segments
                const blocks = []; let currentBlock = { start: 0, texts: [] }; let lastBlockStart = 0;
                for (const seg of segments) {
                    if (seg.start - lastBlockStart >= 30 || blocks.length === 0) {
                        if (currentBlock.texts.length) blocks.push(currentBlock);
                        currentBlock = { start: seg.start, texts: [] }; lastBlockStart = seg.start;
                    }
                    currentBlock.texts.push(seg.text);
                }
                if (currentBlock.texts.length) blocks.push(currentBlock);
                if (!blocks.length) return '';

                const formatBlock = b => `[${this._formatTime(b.start)}] ${b.texts.join(' ')}\n`;

                // If it all fits, return everything
                const fullText = blocks.map(formatBlock).join('');
                if (fullText.length <= maxChars) return fullText;

                // Smart truncation: keep intro (25%) + conclusion (15%) + evenly sampled middle (60%)
                const introCount = Math.max(2, Math.ceil(blocks.length * 0.25));
                const outroCount = Math.max(1, Math.ceil(blocks.length * 0.15));
                const introBlocks = blocks.slice(0, introCount);
                const outroBlocks = blocks.slice(-outroCount);
                const middleBlocks = blocks.slice(introCount, blocks.length - outroCount);

                let result = '';
                // Add intro
                for (const b of introBlocks) {
                    const line = formatBlock(b);
                    if (result.length + line.length > maxChars * 0.3) break;
                    result += line;
                }

                // Evenly sample middle to fill ~55% of budget
                if (middleBlocks.length > 0) {
                    const midBudget = maxChars * 0.55;
                    const step = Math.max(1, Math.floor(middleBlocks.length / Math.ceil(midBudget / 120)));
                    let midText = '';
                    for (let i = 0; i < middleBlocks.length; i += step) {
                        const line = formatBlock(middleBlocks[i]);
                        if (midText.length + line.length > midBudget) break;
                        midText += line;
                    }
                    if (midText && result.length > 0) result += '[...]\n';
                    result += midText;
                }

                // Add conclusion
                if (outroBlocks.length > 0) {
                    const outroBudget = maxChars - result.length - 10;
                    let outroText = '';
                    for (const b of outroBlocks) {
                        const line = formatBlock(b);
                        if (outroText.length + line.length > outroBudget) break;
                        outroText += line;
                    }
                    if (outroText) {
                        result += '[...]\n' + outroText;
                    }
                }
                return result;
            },
    
            // ═══ TRANSCRIPT DOWNLOAD ═══
            async _downloadTranscript() {
                const videoId = this._getVideoId();
                if (!videoId) return;
                const btn = document.getElementById('cf-dl-transcript');
                if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; btn.classList.add('cf-loading'); }
                this._updateStatus('Fetching transcript...', 'loading', 5);
                const segments = await this._fetchTranscript(videoId, (msg, state, pct) => this._updateStatus(msg, state, pct));
                if (!segments?.length) {
                    this._updateStatus('No transcript found', 'error', 0);
                    if (btn) { btn.disabled = false; btn.textContent = 'Transcript: TXT'; btn.classList.remove('cf-loading'); }
                    return;
                }
    
                const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
                    || document.querySelector('#title h1')?.textContent?.trim() || videoId;
                this._lastTranscriptSegments = segments;
                const safeName = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').slice(0, 60);
                const lines = segments.map(s => `[${this._formatTime(s.start)}] ${s.text}`);
                const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `${safeName}_transcript.txt`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                this._updateStatus('Done', 'ready', 100);
                if (btn) { btn.disabled = false; btn.textContent = 'Transcript: TXT'; btn.classList.remove('cf-loading'); }
            },
    
            // ═══ LIVE VIDEO ROLLING CHAPTERS ═══
            _liveIntervalId: null,
            _liveAccumulated: [],
            _liveLastGenTime: 0,
            _liveNoNewCount: 0,
    
            _isLiveVideo() {
                return !!document.querySelector('.ytp-live-badge:not(.ytp-live-badge-disabled), .ytp-live, .html5-video-player.playing-mode.ytp-live');
            },
    
            _isVideoEnded() {
                const vid = document.querySelector('video.html5-main-video, video');
                if (!vid) return true;
                return vid.ended || (vid.paused && vid.currentTime > 0 && vid.duration > 0 && Math.abs(vid.currentTime - vid.duration) < 1);
            },
    
            async _startLiveTracking() {
                if (this._liveIntervalId) return;
                this._liveAccumulated = [];
                this._liveLastGenTime = 0;
                this._liveNoNewCount = 0;
                this._log('Live tracking started');
                this._updateStatus('Live tracking...', 'loading', 0);
    
                this._liveIntervalId = setInterval(async () => {
                    const videoId = this._getVideoId();
    
                    if (!videoId || this._isVideoEnded()) {
                        this._log('Live: video ended or no video, stopping');
                        this._stopLiveTracking();
                        return;
                    }
                    if (!this._isLiveVideo()) {
                        this._liveNoNewCount++;
                        this._log('Live: no longer detected as live, stale count:', this._liveNoNewCount);
                        if (this._liveNoNewCount >= 3) {
                            this._stopLiveTracking();
                            return;
                        }
                    }
    
                    try {
                        const segments = await this._fetchTranscript(videoId, null);
                        if (segments?.length) {
                            const existingTimes = new Set(this._liveAccumulated.map(s => s.start));
                            let added = 0;
                            for (const seg of segments) {
                                if (!existingTimes.has(seg.start)) {
                                    this._liveAccumulated.push(seg);
                                    existingTimes.add(seg.start);
                                    added++;
                                }
                            }
    
                            if (added > 0) {
                                this._liveNoNewCount = 0;
                                this._log('Live: added', added, 'new segments, total:', this._liveAccumulated.length);
                            } else {
                                this._liveNoNewCount++;
                            }
    
                            if (this._liveNoNewCount >= 5) {
                                this._log('Live: no new content for 5 polls, stopping');
                                this._stopLiveTracking();
                                return;
                            }
    
                            const now = Date.now();
                            if (this._liveAccumulated.length >= 10 && now - this._liveLastGenTime > 120000) {
                                this._liveLastGenTime = now;
                                this._log('Live: regenerating chapters...');
                                const duration = this._getVideoDuration() || (this._liveAccumulated[this._liveAccumulated.length - 1].start + 30);
                                const provider = appState.settings.cfLlmProvider || 'builtin';
                                let data;
                                if (provider === 'builtin') {
                                    data = this._generateChaptersHeuristic(this._liveAccumulated, duration);
                                } else {
                                    try {
                                        const isLocal = this._isLocalProvider();
                                        const txLimit = isLocal ? 200000 : 30000;
                                        const transcriptText = this._buildTranscriptText(this._liveAccumulated, txLimit);
                                        const durationMin = Math.ceil(duration / 60);
                                        const systemPrompt = this._buildLiveChapterSystemPrompt(durationMin);
                                        const rawText = await this._callLlmApi(systemPrompt, `Generate chapters for this ${durationMin}-minute live stream.\n\nTranscript (${transcriptText.length} chars):\n\n${transcriptText}`, null);
                                        data = this._parseChapterJSON(rawText, duration);
                                    } catch(e) {
                                        this._log('Live: API failed, falling back to heuristic:', e.message);
                                        data = this._generateChaptersHeuristic(this._liveAccumulated, duration);
                                    }
                                }
                                if (data?.chapters?.length) {
                                    this._chapterData = data;
                                    this._setCachedData(videoId, data);
                                    this._renderProgressBarOverlay();
                                    if (this._panelEl?.classList.contains('cf-visible')) this._renderPanel();
                                    this._log('Live: updated to', data.chapters.length, 'chapters');
                                }
                            }
                        } else {
                            this._liveNoNewCount++;
                            this._log('Live: fetch returned empty, stale count:', this._liveNoNewCount);
                            if (this._liveNoNewCount >= 5) {
                                this._stopLiveTracking();
                                return;
                            }
                        }
                    } catch(e) {
                        this._log('Live poll error:', e.message);
                        this._liveNoNewCount++;
                        if (this._liveNoNewCount >= 5) {
                            this._stopLiveTracking();
                        }
                    }
                }, 30000);
            },
    
            _stopLiveTracking() {
                if (this._liveIntervalId) {
                    clearInterval(this._liveIntervalId);
                    this._liveIntervalId = null;
                    this._liveNoNewCount = 0;
                    this._log('Live tracking stopped');
                    if (this._panelEl?.classList.contains('cf-visible')) this._renderPanel();
                }
            },
    
            // ═══ SUBSCRIPTIONS BATCH PROCESSOR ═══
            _batchProcessing: false,
            _batchProgress: { done: 0, total: 0, current: '' },
    
            async _batchProcessSubscriptions() {
                if (this._batchProcessing) return;
    
                const videoLinks = new Set();
                document.querySelectorAll('a#video-title-link[href*="watch"], a.yt-simple-endpoint[href*="watch"], a[href*="/watch?v="]').forEach(a => {
                    const match = a.href?.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
                    if (match) videoLinks.add(match[1]);
                });
                document.querySelectorAll('a#thumbnail[href*="watch"]').forEach(a => {
                    const match = a.href?.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
                    if (match) videoLinks.add(match[1]);
                });
    
                if (!videoLinks.size) { return; }
    
                const uncached = [...videoLinks].filter(id => !this._getCachedData(id));
                if (!uncached.length) { return; }
    
                this._batchProcessing = true;
                this._batchProgress = { done: 0, total: uncached.length, current: '' };
                this._updateBatchUI();
    
                for (const videoId of uncached) {
                    if (!this._batchProcessing) break;
                    this._batchProgress.current = videoId;
                    this._updateBatchUI();
    
                    try {
                        const segments = await this._fetchTranscript(videoId, null);
                        if (segments?.length) {
                            const provider = appState.settings.cfLlmProvider || 'builtin';
                            let data;
                            if (provider === 'builtin') {
                                data = this._generateChaptersHeuristic(segments, 0);
                            } else {
                                try {
                                    const isLocal = this._isLocalProvider();
                                    const txLimit = isLocal ? 200000 : 30000;
                                    const transcriptText = this._buildTranscriptText(segments, txLimit);
                                    const systemPrompt = appState.settings.cfCustomChapterPrompt || this._buildChapterSystemPrompt(0);
                                    const rawText = await this._callLlmApi(systemPrompt, `Generate chapters:\n\n${transcriptText}`, null);
                                    data = this._parseChapterJSON(rawText, 0);
                                } catch(e) {
                                    data = this._generateChaptersHeuristic(segments, 0);
                                }
                            }
                            if (data?.chapters?.length) this._setCachedData(videoId, data);
                        }
                    } catch(e) { this._log('Batch error for', videoId, ':', e.message); }
    
                    this._batchProgress.done++;
                    this._updateBatchUI();
                    await new Promise(r => setTimeout(r, 500));
                }
    
                const done = this._batchProgress.done;
                this._batchProcessing = false;
                this._removeBatchUI();
            },
    
            _cancelBatch() { this._batchProcessing = false; },
    
            _updateBatchUI() {
                let bar = document.getElementById('cf-batch-bar');
                if (!bar) {
                    bar = document.createElement('div'); bar.id = 'cf-batch-bar';
                    bar.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1a1a24;border:1px solid rgba(124,58,237,0.4);border-radius:12px;padding:12px 16px;z-index:99999;font-family:-apple-system,sans-serif;color:#e0e0e8;font-size:12px;min-width:280px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
                    document.body.appendChild(bar);
                }
                const { done, total, current } = this._batchProgress;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                TrustedHTML.setHTML(bar, `
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-weight:600;color:#a78bfa">ChapterForge Batch</span><span style="cursor:pointer;color:rgba(255,255,255,0.4)" id="cf-batch-cancel">&times;</span></div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px">${done}/${total} videos (${pct}%)</div>
                    <div style="width:100%;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:2px;transition:width 0.3s"></div></div>
                `);
                bar.querySelector('#cf-batch-cancel')?.addEventListener('click', () => { this._cancelBatch(); this._removeBatchUI(); });
            },
            _removeBatchUI() { document.getElementById('cf-batch-bar')?.remove(); },
    
            _injectSubscriptionsButton() {
                if (document.getElementById('cf-batch-btn')) return;
                if (!window.location.pathname.startsWith('/feed/subscriptions')) return;
    
                const headerButtons = document.querySelector('#masthead #end #buttons');
                if (!headerButtons) { setTimeout(() => this._injectSubscriptionsButton(), 1000); return; }
    
                const ns = 'http://www.w3.org/2000/svg';
                const btn = document.createElement('button');
                btn.id = 'cf-batch-btn';
                btn.className = 'cf-batch-btn';
                btn.title = 'ChapterForge: Process all videos on this page';
                btn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:20px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-family:"Roboto",Arial,sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(124,58,237,0.3);';
    
                const svg = document.createElementNS(ns, 'svg');
                svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
                svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
                const p1 = document.createElementNS(ns, 'path'); p1.setAttribute('d', 'M3 12h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V6H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 6v2h14V6H7z');
                p1.setAttribute('fill', 'currentColor'); p1.setAttribute('stroke', 'none');
                svg.appendChild(p1);
                btn.appendChild(svg);
    
                const text = document.createElement('span');
                text.textContent = 'Process All';
                btn.appendChild(text);
    
                btn.addEventListener('click', () => this._batchProcessSubscriptions());
                btn.addEventListener('mouseenter', () => { btn.style.background = 'linear-gradient(135deg,#8b5cf6,#7c3aed)'; btn.style.boxShadow = '0 4px 16px rgba(124,58,237,0.5)'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = 'linear-gradient(135deg,#7c3aed,#6d28d9)'; btn.style.boxShadow = '0 2px 8px rgba(124,58,237,0.3)'; });
    
                const hideAllBtn = headerButtons.querySelector('.ytkit-subs-hide-all-btn');
                const vlcBtn = headerButtons.querySelector('.ytkit-subs-vlc-btn');
                if (hideAllBtn) {
                    hideAllBtn.after(btn);
                } else if (vlcBtn) {
                    headerButtons.insertBefore(btn, vlcBtn);
                } else {
                    headerButtons.appendChild(btn);
                }
            },
    
            async _getAudioStreamUrl(videoId) {
                const pw = _rw;
                const sources = [];
    
                try { const pr = pw.ytInitialPlayerResponse; if (pr?.videoDetails?.videoId === videoId && pr?.streamingData?.adaptiveFormats) { sources.push(...pr.streamingData.adaptiveFormats); this._log('Audio: page PR has', pr.streamingData.adaptiveFormats.length, 'adaptiveFormats'); } } catch(e) {}
    
                try {
                    const wf = document.querySelector('ytd-watch-flexy');
                    for (const p of ['playerData_', '__data', 'data']) { let pr = wf?.[p]; if (pr?.playerResponse) pr = pr.playerResponse; if (pr?.videoDetails?.videoId === videoId && pr?.streamingData?.adaptiveFormats) { sources.push(...pr.streamingData.adaptiveFormats); break; } }
                } catch(e) {}
    
                if (!sources.some(f => f.mimeType?.startsWith('audio/') && f.url)) {
                    let visitorData; try { visitorData = pw.ytcfg?.get?.('VISITOR_DATA'); } catch(e) {}
                    let clientVersion; try { clientVersion = pw.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION') || '2.20250210.01.00'; } catch(e) { clientVersion = '2.20250210.01.00'; }
                    let apiKey; try { apiKey = pw.ytcfg?.get?.('INNERTUBE_API_KEY'); } catch(e) {}
                    if (!apiKey) apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    
                    const clients = [
                        { name: 'WEB_CREATOR', body: { context: { client: { clientName: 'WEB_CREATOR', clientVersion: '1.20250210.01.00', hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) } }, videoId, contentCheckOk: true, racyCheckOk: true }, ua: null },
                        { name: 'WEB', body: { context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) } }, videoId, contentCheckOk: true, racyCheckOk: true }, ua: null },
                        { name: 'TVHTML5_EMBEDDED', body: { context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' } }, videoId, contentCheckOk: true, racyCheckOk: true, thirdParty: { embedUrl: 'https://www.youtube.com' } }, ua: null },
                        { name: 'ANDROID', body: { context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'US' } }, videoId, contentCheckOk: true, racyCheckOk: true }, ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip' },
                    ];
    
                    for (const client of clients) {
                        try {
                            const hdrs = client.ua ? { 'User-Agent': client.ua } : {};
                            const sapi = await this._buildSapisidAuth();
                            if (sapi) Object.assign(hdrs, sapi);
                            this._log('Audio: trying', client.name, 'client');
                            const data = await this._gmPostJson(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, client.body, hdrs);
                            if (data?.streamingData?.adaptiveFormats) {
                                const fmts = data.streamingData.adaptiveFormats;
                                if (client.ua) fmts.forEach(f => f._downloadUA = client.ua);
                                sources.push(...fmts);
                                const audioWithUrl = fmts.filter(f => f.mimeType?.startsWith('audio/') && f.url);
                                this._log('Audio:', client.name, 'returned', fmts.length, 'formats,', audioWithUrl.length, 'audio w/ URL');
                                if (audioWithUrl.length) break;
                            }
                        } catch(e) { this._log('Audio:', client.name, 'failed:', e.message); }
                    }
                }
    
                const audioFormats = sources.filter(f => f.mimeType?.startsWith('audio/') && f.url).sort((a, b) => (a.bitrate || 999999) - (b.bitrate || 999999));
                if (!audioFormats.length) { this._log('Audio: no usable audio streams found in', sources.length, 'total formats'); return null; }
                const opus = audioFormats.find(f => f.mimeType?.includes('opus'));
                const chosen = opus || audioFormats[0];
                let url = chosen.url; if (url.includes('\\u0026')) url = url.replace(/\\u0026/g, '&');
                this._log('Audio chosen:', chosen.mimeType, chosen.bitrate + 'bps');
                return { url, ua: chosen._downloadUA || null };
            },
    
            _downloadAudioData(url, onProgress, userAgent) {
                const self = this;
                const attempts = [];
                if (userAgent) attempts.push({ ua: userAgent, anon: true, label: 'custom-UA+anon' });
                attempts.push({ ua: null, anon: true, label: 'default-UA+anon' });
                attempts.push({ ua: null, anon: false, label: 'default-UA+cookies' });
                let attemptIdx = 0;
                function tryDownload(resolve, reject) {
                    if (attemptIdx >= attempts.length) { reject(new Error('Audio download failed: all attempts exhausted')); return; }
                    const attempt = attempts[attemptIdx]; const headers = {};
                    if (attempt.ua) headers['User-Agent'] = attempt.ua;
                    self._log('Audio download attempt', attemptIdx + 1, '/', attempts.length, '(' + attempt.label + ')');
                    GM_xmlhttpRequest({ method: 'GET', url, responseType: 'arraybuffer', anonymous: attempt.anon, headers,
                        onprogress: (evt) => { if (evt.total > 0) onProgress?.(`Downloading audio... ${Math.round((evt.loaded / evt.total) * 100)}%`, Math.round((evt.loaded / evt.total) * 100)); },
                        onload: (resp) => {
                            const bytes = resp.response?.byteLength || 0;
                            self._log('Audio attempt', attemptIdx + 1, ':', resp.status, (bytes/1024/1024).toFixed(1) + 'MB');
                            if (resp.status >= 400 || bytes < 1000) { attemptIdx++; tryDownload(resolve, reject); return; }
                            resolve(resp.response);
                        },
                        onerror: () => { attemptIdx++; tryDownload(resolve, reject); },
                        ontimeout: () => { attemptIdx++; tryDownload(resolve, reject); },
                        timeout: 120000 });
                }
                return new Promise((resolve, reject) => tryDownload(resolve, reject));
            },
    
            async _decodeAndResample(arrayBuffer) {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                let audioBuffer;
                try { audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0)); } finally { audioCtx.close(); }
                let samples;
                if (audioBuffer.numberOfChannels === 1) { samples = audioBuffer.getChannelData(0); } else { const ch0 = audioBuffer.getChannelData(0); const ch1 = audioBuffer.getChannelData(1); samples = new Float32Array(ch0.length); for (let i = 0; i < ch0.length; i++) samples[i] = (ch0[i] + ch1[i]) / 2; }
                const srcRate = audioBuffer.sampleRate; if (srcRate === 16000) return samples;
                const ratio = 16000 / srcRate; const newLen = Math.round(samples.length * ratio); const resampled = new Float32Array(newLen);
                for (let i = 0; i < newLen; i++) { const srcIdx = i / ratio; const lo = Math.floor(srcIdx); const hi = Math.min(lo + 1, samples.length - 1); const frac = srcIdx - lo; resampled[i] = samples[lo] * (1 - frac) + samples[hi] * frac; }
                this._log('Audio resampled:', srcRate + 'Hz -> 16000Hz,', (resampled.length / 16000).toFixed(1) + 's');
                return resampled;
            },
    
            // ═══ SHARED: Transformers.js Library Loader ═══
            async _loadTransformersLib() {
                if (this._transformersLib) return this._transformersLib;
                const cdnUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0/dist/transformers.min.js';
                let transformers;
                try {
                    this._log('Transformers.js: trying GM fetch + blob import...');
                    const code = await this._gmGet(cdnUrl);
                    if (code.length < 1000) throw new Error('Fetched code too small: ' + code.length);
                    const blob = new Blob([code], { type: 'text/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    try { transformers = await import(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
                    this._log('Transformers.js: blob import succeeded');
                } catch(e1) {
                    this._log('Transformers.js: blob import failed:', e1.message, '- trying direct import...');
                    try { transformers = await import(cdnUrl); }
                    catch(e2) {
                        this._warn('Transformers.js: all import methods blocked by CSP.');
                        throw new Error('Transformers.js blocked by YouTube CSP. Try "Captions Only" transcript mode or use an API provider.');
                    }
                }
                transformers.env.allowLocalModels = false;
                this._transformersLib = transformers;
                return transformers;
            },
    
            async _loadWhisperPipeline(onProgress) {
                if (this._whisperPipeline) return this._whisperPipeline;
                const modelId = 'onnx-community/' + (appState.settings.cfWhisperModel || 'whisper-tiny.en');
                this._log('Loading Whisper model:', modelId);
                onProgress?.('Loading Whisper library...', 0);
    
                const transformers = await this._loadTransformersLib();
                const { pipeline } = transformers;
    
                onProgress?.('Loading Whisper model: ' + modelId + '...', 10);
                this._whisperPipeline = await pipeline('automatic-speech-recognition', modelId, {
                    dtype: 'q4', device: navigator.gpu ? 'webgpu' : 'wasm',
                    progress_callback: (info) => { if (info.status === 'progress' && info.total) onProgress?.(`Loading Whisper... ${Math.round((info.loaded / info.total) * 100)}%`, Math.round((info.loaded / info.total) * 100)); },
                });
                this._log('Whisper model loaded');
                return this._whisperPipeline;
            },
    
            // ═══ BROWSER AI: Local LLM via Transformers.js + WebGPU ═══
            async _loadBrowserLLMPipeline(onStatus) {
                const modelKey = appState.settings.cfBrowserAiModel || 'SmolLM2-360M-Instruct';
                const modelInfo = this._CF_BROWSER_AI_MODELS[modelKey];
                if (!modelInfo) throw new Error('Unknown Browser AI model: ' + modelKey);
    
                // Reuse pipeline if same model already loaded
                if (this._browserLLMPipeline && this._browserLLMModelId === modelInfo.id) {
                    return this._browserLLMPipeline;
                }
    
                // If a different model was loaded, discard it
                if (this._browserLLMPipeline && this._browserLLMModelId !== modelInfo.id) {
                    this._log('Browser AI: model changed, discarding old pipeline');
                    try { await this._browserLLMPipeline.dispose?.(); } catch(e) {}
                    this._browserLLMPipeline = null;
                    this._browserLLMModelId = null;
                }
    
                this._log('Browser AI: loading model:', modelInfo.id, '(' + modelInfo.size + ')');
                onStatus?.('Loading Transformers.js...', 'loading', 10);
    
                if (!navigator.gpu) {
                    this._warn('Browser AI: WebGPU not available. Try Chrome or Edge.');
                    throw new Error('WebGPU not available. Browser AI requires Chrome or Edge with WebGPU support.');
                }
    
                const transformers = await this._loadTransformersLib();
                const { pipeline } = transformers;
    
                onStatus?.(`Loading ${modelKey} (${modelInfo.size})...`, 'loading', 20);
    
                this._browserLLMPipeline = await pipeline('text-generation', modelInfo.id, {
                    dtype: 'q4f16',
                    device: 'webgpu',
                    progress_callback: (info) => {
                        if (info.status === 'progress' && info.total) {
                            const pct = Math.round((info.loaded / info.total) * 100);
                            onStatus?.(`Downloading ${modelKey}... ${pct}%`, 'loading', 20 + Math.round(pct * 0.4));
                        }
                        if (info.status === 'ready') {
                            onStatus?.(`${modelKey} loaded`, 'loading', 65);
                        }
                    },
                });
                this._browserLLMModelId = modelInfo.id;
                this._log('Browser AI: model loaded:', modelInfo.id);
                return this._browserLLMPipeline;
            },
    
            async _callBrowserAI(systemPrompt, userPrompt, onStatus) {
                const generator = await this._loadBrowserLLMPipeline(onStatus);
                onStatus?.('Generating with Browser AI...', 'loading', 70);
    
                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ];
    
                this._log('Browser AI: generating, prompt length:', systemPrompt.length + userPrompt.length);
                const startTime = performance.now();
    
                const result = await generator(messages, {
                    max_new_tokens: 1024,
                    temperature: 0.1,
                    do_sample: true,
                    return_full_text: false,
                });
    
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
                const output = result?.[0]?.generated_text;
    
                // Extract assistant response — handle both string and array-of-messages formats
                let text;
                if (typeof output === 'string') {
                    text = output.trim();
                } else if (Array.isArray(output)) {
                    // Some models return [{role:'assistant', content:'...'}]
                    const assistantMsg = output.find(m => m.role === 'assistant');
                    text = assistantMsg?.content?.trim() || '';
                } else if (output?.content) {
                    text = output.content.trim();
                } else {
                    text = String(output || '').trim();
                }
    
                this._log('Browser AI: generated', text.length, 'chars in', elapsed + 's');
                onStatus?.(`Generated in ${elapsed}s`, 'loading', 90);
                return text;
            },
    
            async _getAudioViaCobalt(videoId, onProgress) {
                this._log('Trying Cobalt API for audio...');
                onProgress?.('Trying Cobalt API...', 10);
                const resp = await this._gmPostJson('https://cobalt-api.meowing.de/', { url: `https://www.youtube.com/watch?v=${videoId}`, downloadMode: 'audio', audioFormat: 'opus', filenameStyle: 'basic' }, { Accept: 'application/json' });
                const dlUrl = resp?.url;
                if (!dlUrl) throw new Error(`Cobalt API error: ${resp?.error?.code || resp?.status || JSON.stringify(resp).slice(0, 200)}`);
                this._log('Cobalt URL obtained:', dlUrl.slice(0, 100));
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({ method: 'GET', url: dlUrl, responseType: 'arraybuffer', anonymous: true,
                        onprogress: (evt) => { if (evt.total > 0) onProgress?.(`Downloading audio via Cobalt... ${Math.round((evt.loaded / evt.total) * 100)}%`, Math.round((evt.loaded / evt.total) * 100)); },
                        onload: (r) => { const bytes = r.response?.byteLength || 0; if (r.status >= 400 || bytes < 1000) { reject(new Error(`Cobalt download failed: HTTP ${r.status}, ${bytes} bytes`)); return; } resolve(r.response); },
                        onerror: (e) => reject(new Error('Cobalt download error')), ontimeout: () => reject(new Error('Cobalt download timeout')), timeout: 120000 });
                });
            },
    
            async _capturePlayerAudio(onStatus) {
                const video = document.querySelector('video.html5-main-video');
                if (!video || !video.duration || video.duration > 1800) throw new Error('Player capture: video not available or >30min');
                onStatus?.('Capturing audio from player...', 10);
                const videoSrc = video.src || video.currentSrc;
                if (videoSrc && !videoSrc.startsWith('blob:')) {
                    try { const resp = await fetch(videoSrc); return await resp.arrayBuffer(); } catch(e) { throw new Error('Cannot fetch video source: ' + e.message); }
                }
                const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream?.();
                if (!stream) throw new Error('captureStream not available');
                const audioCtx = new AudioContext({ sampleRate: 16000 });
                audioCtx.createMediaStreamSource(stream);
                const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
                const chunks = [];
                recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                return new Promise((resolve, reject) => {
                    recorder.onstop = async () => { audioCtx.close(); const blob = new Blob(chunks, { type: 'audio/webm' }); resolve(await blob.arrayBuffer()); };
                    recorder.onerror = () => { audioCtx.close(); reject(new Error('Recording failed')); };
                    onStatus?.('Real-time audio capture (takes video duration)...', 15);
                    recorder.start(1000);
                    setTimeout(() => { try { recorder.stop(); } catch(e) {} }, Math.min(video.duration * 1000, 300000));
                });
            },
    
            async _whisperTranscribe(videoId, onStatus) {
                const s = appState.settings;
                const methods = [];
                if (s.cfUseInnertube !== false) methods.push('innertube');
                if (s.cfUseCobalt !== false) methods.push('cobalt');
                if (s.cfUseCapture !== false) methods.push('capture');
                if (!methods.length) methods.push('innertube', 'cobalt');
    
                this._log('Whisper audio methods:', methods.join(', '));
                let audioData = null;
    
                for (const method of methods) {
                    if (audioData) break;
                    try {
                        if (method === 'innertube') {
                            onStatus?.('Finding audio stream (Innertube)...', 5);
                            const audioInfo = await this._getAudioStreamUrl(videoId);
                            if (audioInfo) audioData = await this._downloadAudioData(audioInfo.url, (msg, pct) => onStatus?.(msg, Math.round(5 + pct * 0.3)), audioInfo.ua);
                        } else if (method === 'cobalt') {
                            onStatus?.('Finding audio stream (Cobalt)...', 5);
                            audioData = await this._getAudioViaCobalt(videoId, (msg, pct) => onStatus?.(msg, Math.round(5 + pct * 0.3)));
                        } else if (method === 'capture') {
                            onStatus?.('Capturing audio from player...', 5);
                            audioData = await this._capturePlayerAudio(onStatus);
                        }
                    } catch(e) {
                        this._warn('Audio method "' + method + '" failed:', e.message);
                    }
                }
    
                if (!audioData) throw new Error('All audio download methods failed (' + methods.join(', ') + ')');
    
                onStatus?.('Decoding audio...', 38);
                const samples = await this._decodeAndResample(audioData);
                this._log('Audio ready:', (samples.length / 16000).toFixed(1) + 's');
    
                const transcriber = await this._loadWhisperPipeline((msg, pct) => onStatus?.(msg, Math.round(40 + (pct || 0) * 0.2)));
                onStatus?.('Transcribing with Whisper AI...', 62);
                const startTime = performance.now();
                const result = await transcriber(samples, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, language: 'en' });
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
    
                const segments = [];
                if (result.chunks?.length) { for (const chunk of result.chunks) { const text = chunk.text?.trim(); if (!text) continue; segments.push({ start: chunk.timestamp?.[0] || 0, dur: (chunk.timestamp?.[1] || (chunk.timestamp?.[0] || 0) + 5) - (chunk.timestamp?.[0] || 0), text }); } }
                else if (result.text) { segments.push({ start: 0, dur: samples.length / 16000, text: result.text.trim() }); }
    
                onStatus?.(`Transcribed ${segments.length} segments in ${elapsed}s`, 100);
                return segments;
            },

            // ═══ VIBE TRANSCRIPTION (local Whisper via whisper.cpp server) ═══
            _vibeCheck() {
                const endpoint = appState.settings.cfVibeEndpoint || 'http://localhost:8178';
                return new Promise(resolve => {
                    GM_xmlhttpRequest({
                        method: 'GET', url: endpoint + '/health',
                        timeout: 3000,
                        onload: (r) => {
                            // Any HTTP response means the server is running
                            resolve({ running: true, models: [], version: null });
                        },
                        onerror: () => resolve({ running: false, models: [], version: null }),
                        ontimeout: () => resolve({ running: false, models: [], version: null })
                    });
                });
            },

            async _vibeTranscribe(videoId, onStatus) {
                const endpoint = appState.settings.cfVibeEndpoint || 'http://localhost:8178';
                this._log('WhisperServer: starting transcription via', endpoint);

                // Check WhisperServer is running
                onStatus?.('Checking WhisperServer...', 2);
                const status = await this._vibeCheck();
                if (!status.running) throw new Error('WhisperServer is not running. Start it from your Windows Startup folder, or re-run the YTYT installer with WhisperServer checked.');

                // Download audio
                const s = appState.settings;
                const methods = [];
                if (s.cfUseInnertube !== false) methods.push('innertube');
                if (s.cfUseCobalt !== false) methods.push('cobalt');
                methods.push('capture');
                if (!methods.length) methods.push('innertube', 'cobalt', 'capture');

                let audioData = null;
                for (const method of methods) {
                    if (audioData) break;
                    try {
                        if (method === 'innertube') {
                            onStatus?.('Finding audio stream (Innertube)...', 5);
                            const audioInfo = await this._getAudioStreamUrl(videoId);
                            if (audioInfo) audioData = await this._downloadAudioData(audioInfo.url, (msg, pct) => onStatus?.(msg, Math.round(5 + pct * 0.3)), audioInfo.ua);
                        } else if (method === 'cobalt') {
                            onStatus?.('Finding audio stream (Cobalt)...', 5);
                            audioData = await this._getAudioViaCobalt(videoId, (msg, pct) => onStatus?.(msg, Math.round(5 + pct * 0.3)));
                        } else if (method === 'capture') {
                            onStatus?.('Capturing audio from player...', 5);
                            audioData = await this._capturePlayerAudio((msg, pct) => onStatus?.(msg, Math.round(5 + pct * 0.3)));
                        }
                    } catch(e) { this._warn('WhisperServer audio method "' + method + '" failed:', e.message); }
                }
                if (!audioData) throw new Error('Audio download failed — cannot send to WhisperServer');

                // Build multipart/form-data body manually (GM_xmlhttpRequest doesn't support FormData)
                onStatus?.('Sending audio to WhisperServer...', 40);
                const boundary = '----CFVibeUpload' + Date.now();
                const audioBytes = new Uint8Array(audioData);

                // Determine audio format from first bytes
                let mimeType = 'audio/webm';
                let ext = 'webm';
                if (audioBytes[0] === 0xFF && (audioBytes[1] & 0xE0) === 0xE0) { mimeType = 'audio/mpeg'; ext = 'mp3'; }
                else if (audioBytes[0] === 0x4F && audioBytes[1] === 0x67) { mimeType = 'audio/ogg'; ext = 'ogg'; }
                else if (audioBytes[0] === 0x52 && audioBytes[1] === 0x49) { mimeType = 'audio/wav'; ext = 'wav'; }
                else if (audioBytes[0] === 0x1A && audioBytes[1] === 0x45) { mimeType = 'audio/webm'; ext = 'webm'; }

                // Build multipart body as ArrayBuffer
                const enc = new TextEncoder();
                const parts = [];
                // File part
                const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
                parts.push(enc.encode(fileHeader));
                parts.push(audioBytes);
                parts.push(enc.encode('\r\n'));
                // response_format part
                parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`));
                // language part (optional)
                parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`));
                // timestamp_granularities part
                parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nsegment\r\n`));
                // Closing boundary
                parts.push(enc.encode(`--${boundary}--\r\n`));

                // Merge all parts into a single Uint8Array
                const totalLen = parts.reduce((sum, p) => sum + p.byteLength, 0);
                const body = new Uint8Array(totalLen);
                let offset = 0;
                for (const part of parts) { body.set(part, offset); offset += part.byteLength; }

                this._log('WhisperServer: uploading', (audioBytes.length / 1024 / 1024).toFixed(1) + 'MB audio as', mimeType);

                // Send to WhisperServer
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: endpoint + '/v1/audio/transcriptions',
                        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
                        data: body.buffer,
                        responseType: 'json',
                        timeout: 600000, // 10 min for long videos
                        onload: (r) => {
                            if (r.status >= 400) {
                                const errMsg = typeof r.response === 'object' ? JSON.stringify(r.response) : r.responseText;
                                reject(new Error(`WhisperServer API error ${r.status}: ${errMsg?.slice(0, 200)}`));
                                return;
                            }
                            resolve(typeof r.response === 'object' ? r.response : JSON.parse(r.responseText));
                        },
                        onerror: (e) => reject(new Error('WhisperServer connection failed: ' + (e.error || 'network error'))),
                        ontimeout: () => reject(new Error('WhisperServer transcription timed out (10 min limit)'))
                    });
                });

                onStatus?.('Parsing WhisperServer results...', 90);
                this._log('WhisperServer response:', JSON.stringify(response)?.slice(0, 500));

                // Parse response — OpenAI verbose_json format
                const segments = [];
                if (response?.segments?.length) {
                    for (const seg of response.segments) {
                        const text = seg.text?.trim();
                        if (!text) continue;
                        segments.push({
                            start: seg.start || 0,
                            dur: (seg.end || seg.start || 0) - (seg.start || 0),
                            text
                        });
                    }
                } else if (response?.text) {
                    // Fallback: plain text response
                    segments.push({ start: 0, dur: 0, text: response.text.trim() });
                }

                if (!segments.length) throw new Error('WhisperServer returned empty transcription');
                onStatus?.(`WhisperServer: transcribed ${segments.length} segments`, 100);
                this._log('WhisperServer: got', segments.length, 'segments');
                return segments;
            },
    
            // ═══ OLLAMA MODEL MANAGER ═══
            _CF_RECOMMENDED_MODELS: {
                'qwen3:32b':      { size: '~20 GB', speed: 'Medium', quality: 'Excellent', desc: '128K context, hybrid reasoning, best local model for detailed chapters & summaries' },
            },

            async _ollamaCheck() {
                return new Promise(resolve => {
                    GM_xmlhttpRequest({
                        method: 'GET', url: 'http://localhost:11434/api/tags',
                        timeout: 3000,
                        onload: (r) => {
                            try {
                                const data = JSON.parse(r.responseText);
                                resolve({ running: true, models: (data.models || []).map(m => m.name) });
                            } catch { resolve({ running: true, models: [] }); }
                        },
                        onerror: () => resolve({ running: false, models: [] }),
                        ontimeout: () => resolve({ running: false, models: [] })
                    });
                });
            },

            async _ollamaPull(modelName, onProgress) {
                return new Promise((resolve, reject) => {
                    onProgress?.(`Pulling ${modelName}...`, 0);
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: 'http://localhost:11434/api/pull',
                        headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify({ name: modelName, stream: false }),
                        timeout: 600000, // 10 minute timeout for large downloads
                        onload: (r) => {
                            try {
                                const data = JSON.parse(r.responseText);
                                if (data.error) {
                                    onProgress?.(`Error: ${data.error}`, -1);
                                    reject(new Error(data.error));
                                } else {
                                    onProgress?.(`${modelName} ready`, 100);
                                    resolve(true);
                                }
                            } catch(e) {
                                // Streaming response — check last line
                                const lines = r.responseText.trim().split('\n');
                                const last = lines[lines.length - 1];
                                try {
                                    const lastData = JSON.parse(last);
                                    if (lastData.status === 'success') {
                                        onProgress?.(`${modelName} ready`, 100);
                                        resolve(true);
                                    } else {
                                        onProgress?.(`${modelName} pull complete`, 100);
                                        resolve(true);
                                    }
                                } catch {
                                    onProgress?.(`${modelName} pull complete`, 100);
                                    resolve(true);
                                }
                            }
                        },
                        onerror: (e) => { onProgress?.('Pull failed — is Ollama running?', -1); reject(new Error('Pull failed')); },
                        ontimeout: () => { onProgress?.('Pull timed out', -1); reject(new Error('Timeout')); }
                    });
                });
            },

            // ═══ LLM PROMPT BUILDERS (shared across all generation paths) ═══
            _buildChapterSystemPrompt(durationMin) {
                const seoMode = appState.settings.cfChapterMode === 'seo';
                const seoRules = seoMode ? `\n- IMPORTANT: Optimize chapter titles for YouTube SEO — include searchable keywords viewers would actually type
- Titles should be 4-9 words with specific, keyword-rich language
- Include topic-specific terms, product names, and action words (e.g. "How to Configure Nginx Reverse Proxy" not "Server Setup")
- Front-load the most important keyword in each title` : '';
                return `You are an expert video chapter generator. Analyze the transcript and identify where the speaker changes topics, introduces new concepts, or shifts focus. Output ONLY a valid JSON object (no markdown fences, no commentary).

Format:
{"chapters":[{"start":0,"title":"..."}],"pois":[{"time":120,"label":"..."}]}

Chapter rules:
- "start" values are integers (seconds). First chapter MUST start at 0
- Create 4-10 chapters proportional to the video length (${durationMin} min). ~1 chapter per 3-5 minutes
- Titles should be ${seoMode ? '4-9' : '3-7'} words, descriptive and specific — name the actual topic discussed
- Place boundaries where the speaker transitions to a NEW topic, not mid-discussion
- Avoid generic titles like "Introduction" or "Conclusion" unless that's genuinely what the section is${seoRules}

POI (Points of Interest) rules:
- 2-6 POIs marking the most valuable, surprising, or actionable moments
- Labels should be 4-10 words describing what happens at that moment
- Good POIs: key reveals, important tips, surprising facts, critical warnings, best quotes
- Don't place POIs at chapter boundaries

Example output for a 15-minute coding tutorial:
{"chapters":[{"start":0,"title":"${seoMode ? 'Project Setup Installing Required Dependencies' : 'Project Setup and Dependencies'}"},{"start":95,"title":"${seoMode ? 'Building Express API Route Handler From Scratch' : 'Building the API Route Handler'}"},{"start":280,"title":"${seoMode ? 'PostgreSQL Database Schema Design Best Practices' : 'Database Schema Design'}"},{"start":450,"title":"${seoMode ? 'JWT Authentication Middleware Implementation' : 'Authentication Middleware'}"},{"start":680,"title":"${seoMode ? 'Unit Testing and Error Handling Strategies' : 'Testing and Error Handling'}"},{"start":820,"title":"${seoMode ? 'Deploy Node.js App to Production Server' : 'Deployment to Production'}"}],"pois":[{"time":145,"label":"Common gotcha with async middleware"},{"time":340,"label":"Why indexes matter for this query pattern"},{"time":720,"label":"The one test that catches 90% of bugs"}]}

Output ONLY the JSON object.`;
            },

            _buildLiveChapterSystemPrompt(durationMin) {
                return `You are a video chapter generator for a LIVE stream (~${durationMin} min so far). Analyze the transcript and output ONLY a valid JSON object:
{"chapters":[{"start":0,"title":"Stream Opening"}],"pois":[{"time":45,"label":"Key moment"}]}

Rules: start in seconds (integers), first at 0, 3-8 chapters, 2-6 POIs. Titles 3-7 words, specific to content discussed. Output ONLY JSON.`;
            },

            // ═══ LLM API (OpenAI-compatible, via GM_xmlhttpRequest — bypasses CSP) ═══
            _getLlmEndpoint() {
                const s = appState.settings;
                const provider = s.cfLlmProvider || 'builtin';
                if (provider === 'custom') return s.cfLlmEndpoint || '';
                return this._CF_PROVIDERS[provider]?.endpoint || null;
            },
            _getLlmModel() {
                const s = appState.settings;
                const provider = s.cfLlmProvider || 'builtin';
                // Ollama uses its own model setting to prevent cross-contamination with web AI models
                if (provider === 'ollama') {
                    // Auto-select when enabled and we have cached installed models
                    if (s.cfAutoModel && this._lastOllamaModels?.length) {
                        const durationMin = Math.ceil((this._getVideoDuration() || 300) / 60);
                        const auto = this._getOptimalModel(durationMin, this._lastOllamaModels);
                        if (auto) {
                            this._log('Auto-selected model:', auto, 'for', durationMin, 'min video');
                            return auto;
                        }
                    }
                    return s.cfOllamaModel || this._CF_PROVIDERS.ollama.defaultModel;
                }
                return s.cfLlmModel || this._CF_PROVIDERS[provider]?.defaultModel || 'gpt-4o';
            },
            _isLocalProvider() {
                const p = appState.settings.cfLlmProvider || 'builtin';
                if (p === 'ollama') return true;
                if (p === 'custom') {
                    const ep = appState.settings.cfLlmEndpoint || '';
                    return ep.includes('localhost') || ep.includes('127.0.0.1');
                }
                return false;
            },
            async _ensureOllama(onStatus) {
                // 1. Check if Ollama is running
                let check = await this._ollamaCheck();
                if (check.running) {
                    this._lastOllamaModels = check.models;
                    // Auto-detect model if none set
                    if (check.models.length && !appState.settings.cfOllamaModel) {
                        const rec = Object.keys(this._CF_RECOMMENDED_MODELS);
                        const match = check.models.find(m => rec.some(r => m.startsWith(r.split(':')[0]))) || check.models[0];
                        appState.settings.cfOllamaModel = match.replace(':latest', '');
                        settingsManager.save(appState.settings);
                        this._log('Auto-detected Ollama model:', appState.settings.cfOllamaModel);
                    }
                    return check;
                }
                // 2. Try to wake Ollama (some Windows installs sleep until first request)
                onStatus?.('Ollama not responding, attempting to wake...', 'loading', 40);
                this._log('Ollama not responding, sending wake requests...');
                try {
                    await new Promise((resolve) => {
                        GM_xmlhttpRequest({ method: 'GET', url: 'http://localhost:11434/', timeout: 5000, onload: () => resolve(), onerror: () => resolve(), ontimeout: () => resolve() });
                    });
                    for (let attempt = 1; attempt <= 6; attempt++) {
                        await new Promise(r => setTimeout(r, 2000));
                        onStatus?.(`Waiting for Ollama... (attempt ${attempt}/6)`, 'loading', 40 + attempt * 5);
                        check = await this._ollamaCheck();
                        if (check.running) {
                            this._lastOllamaModels = check.models;
                            this._log('Ollama started on attempt', attempt);
                            if (check.models.length && !appState.settings.cfOllamaModel) {
                                const rec = Object.keys(this._CF_RECOMMENDED_MODELS);
                                const match = check.models.find(m => rec.some(r => m.startsWith(r.split(':')[0]))) || check.models[0];
                                appState.settings.cfOllamaModel = match.replace(':latest', '');
                                settingsManager.save(appState.settings);
                            }
                            return check;
                        }
                    }
                } catch(e) { this._log('Ollama wake error:', e.message); }
                return { running: false, models: [] };
            },
            async _callLlmApi(systemPrompt, userPrompt, onStatus, opts = {}) {
                const provider = appState.settings.cfLlmProvider || 'builtin';
                const isLocal = this._isLocalProvider();

                // For Ollama: ensure server is running and model is detected
                if (provider === 'ollama') {
                    const ollamaStatus = await this._ensureOllama(onStatus);
                    if (!ollamaStatus.running) {
                        throw new Error('Ollama is not running. Start it from your system tray, or run: ollama serve');
                    }
                    if (!ollamaStatus.models.length) {
                        throw new Error('No models installed in Ollama. Run: ollama pull qwen3:32b');
                    }
                }

                const endpoint = this._getLlmEndpoint();
                const model = this._getLlmModel();
                const apiKey = appState.settings.cfLlmApiKey || '';
                if (!endpoint) throw new Error('No LLM endpoint configured');

                const maxTokens = opts.maxTokens || (isLocal ? 4096 : 2048);
                const timeout = opts.timeout || (isLocal ? 180000 : 60000);

                this._log('LLM API call:', endpoint, 'model:', model, 'local:', isLocal, 'timeout:', timeout);
                const autoSelected = (appState.settings.cfAutoModel && appState.settings.cfLlmProvider === 'ollama' && this._lastOllamaModels?.length);
                onStatus?.(isLocal ? `Processing via Ollama (${model}${autoSelected ? ' - auto' : ''})...` : 'Calling LLM API...', 'loading', 80);

                const headers = { 'Content-Type': 'application/json' };
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                if (provider === 'openrouter') {
                    headers['HTTP-Referer'] = 'https://github.com/SysAdminDoc/YTKit';
                    headers['X-Title'] = 'YTKit ChapterForge';
                }

                const body = {
                    model,
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                    temperature: 0.1,
                    max_tokens: maxTokens,
                    stream: false,
                };

                // Ollama needs explicit context window size — default is only 2048 tokens
                // which truncates anything over ~5 minutes of transcript
                if (provider === 'ollama') {
                    // Estimate tokens needed: ~4 chars per token for English
                    const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3.5);
                    // Set context window to fit the full prompt + room for response
                    const numCtx = Math.min(Math.max(estimatedTokens + maxTokens + 512, 8192), 131072);
                    body.options = { num_ctx: numCtx };
                    this._log('Ollama num_ctx:', numCtx, '(estimated', estimatedTokens, 'input tokens)');
                }

                const data = await this._gmPostJson(endpoint, body, headers, timeout);
                if (data?.error) throw new Error(`LLM API error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}`);
                const content = data?.choices?.[0]?.message?.content;
                if (!content) throw new Error('LLM returned empty response');
                this._log('LLM response length:', content.length);
                return content;
            },

            // ═══ NLP ENGINE (zero dependencies) ═══

            // Stopwords for English — filter these from keyword extraction
            _NLP_STOPS: new Set(['the','and','that','this','with','for','are','was','were','been','have','has','had','not','but','what','all','can','her','his','from','they','will','one','its','also','just','more','about','would','there','their','which','could','other','than','then','these','some','them','into','only','your','when','very','most','over','such','after','know','like','going','right','think','really','want','well','here','look','make','come','how','did','get','got','say','said','because','way','still','being','those','where','back','does','take','much','many','through','before','should','each','between','must','same','thing','things','even','every','doing','something','anything','nothing','everything','need','let','see','yeah','yes','okay','actually','gonna','kind','sort','mean','basically','literally','stuff','pretty','little','whole','sure','probably','maybe','guess','though','enough','around','might','quite','able','always','never','already','again','another','talking','talk','people','called','start','started','going','really','actually','point','work','working','time','way','lot','part']),

            // Tokenize text into clean lowercase word array
            _nlpTokenize(text) {
                return text.toLowerCase().replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^\d+$/.test(w));
            },

            // Extract meaningful bigrams (two-word phrases)
            _nlpBigrams(tokens) {
                const bigrams = [];
                for (let i = 0; i < tokens.length - 1; i++) {
                    const a = tokens[i], b = tokens[i + 1];
                    if (!this._NLP_STOPS.has(a) && !this._NLP_STOPS.has(b) && a.length > 2 && b.length > 2) {
                        bigrams.push(a + ' ' + b);
                    }
                }
                return bigrams;
            },

            // Compute TF-IDF vectors for an array of documents (each doc is a string)
            _nlpTFIDF(docs) {
                const N = docs.length;
                const docTokens = docs.map(d => this._nlpTokenize(d));
                const docBigrams = docTokens.map(t => this._nlpBigrams(t));

                // Document frequency for each term
                const df = {};
                for (let i = 0; i < N; i++) {
                    const seen = new Set();
                    for (const t of docTokens[i]) { if (!this._NLP_STOPS.has(t)) seen.add(t); }
                    for (const b of docBigrams[i]) seen.add(b);
                    for (const term of seen) df[term] = (df[term] || 0) + 1;
                }

                // Compute TF-IDF vectors
                const vectors = [];
                for (let i = 0; i < N; i++) {
                    const tf = {};
                    const allTerms = [...docTokens[i].filter(t => !this._NLP_STOPS.has(t)), ...docBigrams[i]];
                    const total = allTerms.length || 1;
                    for (const t of allTerms) tf[t] = (tf[t] || 0) + 1;
                    const vec = {};
                    for (const [term, count] of Object.entries(tf)) {
                        const idf = Math.log(N / (df[term] || 1));
                        if (idf > 0.1) vec[term] = (count / total) * idf;
                    }
                    vectors.push(vec);
                }
                return vectors;
            },

            // Cosine similarity between two sparse TF-IDF vectors
            _nlpCosine(a, b) {
                let dot = 0, normA = 0, normB = 0;
                for (const [k, v] of Object.entries(a)) {
                    normA += v * v;
                    if (b[k]) dot += v * b[k];
                }
                for (const v of Object.values(b)) normB += v * v;
                const denom = Math.sqrt(normA) * Math.sqrt(normB);
                return denom > 0 ? dot / denom : 0;
            },

            // Extract top-N key phrases from a TF-IDF vector, preferring bigrams
            _nlpKeyPhrases(vec, n = 5) {
                return Object.entries(vec)
                    .map(([term, score]) => ({ term, score: score * (term.includes(' ') ? 1.5 : 1) }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, n)
                    .map(e => e.term);
            },

            // Title-case a phrase
            _nlpTitleCase(phrase) {
                const minor = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','by','with','vs']);
                return phrase.split(' ').map((w, i) => {
                    if (i > 0 && minor.has(w)) return w;
                    return w.charAt(0).toUpperCase() + w.slice(1);
                }).join(' ');
            },

            // TextRank-lite: score sentences by importance using graph-based ranking
            _nlpTextRank(sentences, topN = 5) {
                if (sentences.length <= topN) return sentences.map((s, i) => ({ text: s, idx: i, score: 1 }));

                const tokenized = sentences.map(s => new Set(this._nlpTokenize(s).filter(t => !this._NLP_STOPS.has(t))));

                // Build similarity matrix and compute scores (simplified PageRank)
                const scores = new Float64Array(sentences.length).fill(1);
                const dampening = 0.85;

                for (let iter = 0; iter < 15; iter++) {
                    const newScores = new Float64Array(sentences.length).fill(1 - dampening);
                    for (let i = 0; i < sentences.length; i++) {
                        let totalSim = 0;
                        const sims = new Float64Array(sentences.length);
                        for (let j = 0; j < sentences.length; j++) {
                            if (i === j) continue;
                            const intersection = [...tokenized[i]].filter(t => tokenized[j].has(t)).length;
                            const union = new Set([...tokenized[i], ...tokenized[j]]).size;
                            sims[j] = union > 0 ? intersection / union : 0;
                            totalSim += sims[j];
                        }
                        if (totalSim > 0) {
                            for (let j = 0; j < sentences.length; j++) {
                                newScores[j] += dampening * (sims[j] / totalSim) * scores[i];
                            }
                        }
                    }
                    for (let i = 0; i < sentences.length; i++) scores[i] = newScores[i];
                }

                // Position bias: first and last sentences get a boost
                const posBoost = (idx) => {
                    if (idx <= 1) return 1.3;
                    if (idx >= sentences.length - 2) return 1.15;
                    return 1.0;
                };

                return Array.from(scores)
                    .map((score, idx) => ({ text: sentences[idx], idx, score: score * posBoost(idx) }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, topN)
                    .sort((a, b) => a.idx - b.idx); // restore document order
            },

            // ═══ BUILT-IN HEURISTIC CHAPTER GENERATOR (TF-IDF + Cosine Similarity) ═══
            _generateChaptersHeuristic(segments, duration) {
                this._log('NLP heuristic generator:', segments.length, 'segments');
                const totalSecs = duration || segments[segments.length - 1]?.start + 30 || 300;

                // ── Step 1: Build time-windowed documents (30-second windows) ──
                const windowSize = 30;
                const windows = [];
                for (const seg of segments) {
                    const idx = Math.floor(seg.start / windowSize);
                    while (windows.length <= idx) windows.push({ start: windows.length * windowSize, texts: [] });
                    windows[idx].texts.push(seg.text);
                }

                // ── Step 2: Merge into fixed ~60-second analysis groups ──
                // Keep groups small regardless of video length so TF-IDF vectors stay distinctive.
                // Previous approach scaled groups with video length, making them 3-4 min for long videos,
                // which caused vectors to converge and chapters to stop being detected past ~10 min.
                const groupWindowCount = 2; // 2 × 30s = 60s per group — consistent resolution
                const groups = [];
                for (let i = 0; i < windows.length; i += groupWindowCount) {
                    const slice = windows.slice(i, i + groupWindowCount);
                    const text = slice.map(w => w.texts.join(' ')).join(' ');
                    if (text.trim()) groups.push({ start: slice[0]?.start || 0, text });
                }
                if (groups.length < 2) {
                    return { chapters: [{ start: 0, title: 'Full Video', end: totalSecs }], pois: [] };
                }

                // ── Step 3: Compute TF-IDF vectors for each group ──
                const groupDocs = groups.map(g => g.text);
                const vectors = this._nlpTFIDF(groupDocs);

                // ── Step 4: Find topic boundaries via cosine similarity drops ──
                const similarities = [];
                for (let i = 1; i < groups.length; i++) {
                    similarities.push({ idx: i, sim: this._nlpCosine(vectors[i - 1], vectors[i]) });
                }

                // Adaptive threshold: use percentile-based approach for long videos
                const sims = similarities.map(s => s.sim);
                const sortedSims = [...sims].sort((a, b) => a - b);
                const meanSim = sims.reduce((a, b) => a + b, 0) / sims.length;
                const stdSim = Math.sqrt(sims.reduce((a, b) => a + (b - meanSim) ** 2, 0) / sims.length);
                // Use lower of: mean - 0.5*std OR 25th percentile — whichever finds more boundaries
                const statThreshold = meanSim - 0.5 * stdSim;
                const pctThreshold = sortedSims[Math.floor(sortedSims.length * 0.25)] || 0;
                const threshold = Math.max(0.05, Math.min(statThreshold, pctThreshold + 0.05));
                this._log('Cosine threshold:', threshold.toFixed(3), 'mean:', meanSim.toFixed(3), 'std:', stdSim.toFixed(3), 'p25:', pctThreshold.toFixed(3));

                // Minimum gap between boundaries is time-based (90 seconds), not group-count-based
                const minGapSeconds = 90;
                const boundaries = [0];
                for (const { idx, sim } of similarities) {
                    if (sim < threshold) {
                        const lastBoundaryTime = groups[boundaries[boundaries.length - 1]].start;
                        const thisTime = groups[idx].start;
                        if (thisTime - lastBoundaryTime >= minGapSeconds) {
                            boundaries.push(idx);
                        }
                    }
                }

                // Target chapter count based on video length: ~1 per 3-5 minutes
                const targetMin = Math.max(3, Math.floor(totalSecs / 300)); // 1 per 5 min, min 3
                const targetMax = Math.max(6, Math.ceil(totalSecs / 180));  // 1 per 3 min
                const targetCap = Math.min(targetMax, 15); // hard cap

                // Trim excess: remove boundaries with smallest similarity drops
                while (boundaries.length > targetCap) {
                    let bestMerge = 1, bestSim = -1;
                    for (let i = 1; i < boundaries.length; i++) {
                        // Find the boundary with highest similarity (weakest topic change)
                        const s = similarities.find(s => s.idx === boundaries[i])?.sim ?? 1;
                        if (s > bestSim) { bestSim = s; bestMerge = i; }
                    }
                    boundaries.splice(bestMerge, 1);
                }

                // Add boundaries if too few: split largest chapters at biggest similarity drops
                if (boundaries.length < targetMin && groups.length >= 4) {
                    // Find low-similarity points not yet used as boundaries
                    const unusedDrops = similarities
                        .filter(s => !boundaries.includes(s.idx) && s.sim < meanSim)
                        .sort((a, b) => a.sim - b.sim);
                    for (const drop of unusedDrops) {
                        if (boundaries.length >= targetMin) break;
                        // Check time gap from nearest existing boundary
                        const dropTime = groups[drop.idx].start;
                        const tooClose = boundaries.some(bIdx => Math.abs(groups[bIdx].start - dropTime) < 60);
                        if (!tooClose) {
                            boundaries.push(drop.idx);
                            boundaries.sort((a, b) => a - b);
                        }
                    }
                }

                // ── Step 5: Generate descriptive titles using key phrases ──
                const chapters = boundaries.map((bIdx, i) => {
                    const endIdx = i < boundaries.length - 1 ? boundaries[i + 1] : groups.length;
                    const mergedVec = {};
                    for (let g = bIdx; g < endIdx; g++) {
                        for (const [term, score] of Object.entries(vectors[g])) {
                            mergedVec[term] = (mergedVec[term] || 0) + score;
                        }
                    }
                    const keyPhrases = this._nlpKeyPhrases(mergedVec, 4);

                    let title;
                    if (keyPhrases.length >= 2) {
                        if (keyPhrases[0].includes(' ')) {
                            title = this._nlpTitleCase(keyPhrases[0]);
                        } else if (keyPhrases[1].includes(' ')) {
                            title = this._nlpTitleCase(keyPhrases[1]);
                        } else {
                            title = this._nlpTitleCase(keyPhrases[0] + ' ' + keyPhrases[1]);
                        }
                        if (title.length < 10 && keyPhrases.length >= 3) {
                            const extra = keyPhrases[2].includes(' ') ? keyPhrases[2].split(' ')[0] : keyPhrases[2];
                            title += ' ' + this._nlpTitleCase(extra);
                        }
                    } else if (keyPhrases.length === 1) {
                        title = this._nlpTitleCase(keyPhrases[0]);
                    } else {
                        title = `Section ${i + 1}`;
                    }

                    return { start: Math.round(groups[bIdx].start), title: title.slice(0, 50) };
                });

                if (chapters.length && chapters[0].start > 5) chapters[0].start = 0;
                for (let i = 0; i < chapters.length; i++) {
                    chapters[i].end = i < chapters.length - 1 ? chapters[i + 1].start : totalSecs;
                }

                // ── Step 6: POI detection (multi-signal scoring) ──
                const pois = this._detectPOIs(segments, chapters, totalSecs);

                this._log('NLP result:', chapters.length, 'chapters,', pois.length, 'POIs from', groups.length, 'groups');
                return { chapters, pois };
            },

            // ═══ POI DETECTION (multi-signal scoring) ═══
            _detectPOIs(segments, chapters, totalSecs) {
                const candidates = [];
                const emphasisRe = /\b(important|key point|remember|crucial|breaking|announce|reveal|surprise|incredible|amazing|game.?changer|mind.?blow|breakthrough|discover|secret|tip|trick|hack|milestone|highlight|takeaway|essential|critical|warning|danger|careful|watch out|pay attention)\b/i;
                const enumerationRe = /\b(first(ly)?|second(ly)?|third(ly)?|step one|step two|number one|number two|finally|in conclusion|to summarize|the main|the biggest|the most|in summary|bottom line|key takeaway|most importantly)\b/i;

                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    let score = 0;

                    if (emphasisRe.test(seg.text)) score += 4;
                    if (enumerationRe.test(seg.text)) score += 3;

                    // Question cluster
                    const nearbyQ = segments.filter(s => Math.abs(s.start - seg.start) < 60 && s.text.includes('?')).length;
                    if (nearbyQ >= 3) score += 2;

                    // Time gap (pause = emphasis)
                    if (i > 0 && seg.start - segments[i - 1].start > 8) score += 2;

                    // Substantive length
                    if (seg.text.length > 100) score += 1;
                    if (seg.text.includes('!')) score += 1;

                    // Named entities (capitalized words mid-sentence)
                    const caps = seg.text.match(/\b[A-Z][a-z]{2,}/g);
                    if (caps && caps.length >= 2) score += 1;

                    if (score >= 3) {
                        let label = seg.text.trim();
                        const sents = label.split(/[.!?]+/).filter(s => s.trim().length > 10);
                        if (sents.length > 1) {
                            label = (sents.find(s => emphasisRe.test(s) || enumerationRe.test(s)) || sents[0]).trim();
                        }
                        if (label.length > 70) label = label.slice(0, 67) + '...';
                        candidates.push({ time: Math.round(seg.start), label, score });
                    }
                }

                candidates.sort((a, b) => b.score - a.score);
                const pois = [];
                for (const p of candidates) {
                    if (pois.length >= 6) break;
                    if (pois.some(e => Math.abs(e.time - p.time) < 90)) continue;
                    if (chapters.some(c => Math.abs(c.start - p.time) < 10)) continue;
                    pois.push(p);
                }
                pois.sort((a, b) => a.time - b.time);
                return pois;
            },

    
            // ═══ CHAPTER GENERATION (routes between builtin/API) ═══
            async _generateChapters(videoId, onStatus) {
                if (this._isGenerating) return null;
                this._isGenerating = true;
                try {
                    const transcriptMethod = appState.settings.cfTranscriptMethod || 'auto';
                    let segments = null;
    
                    if (transcriptMethod !== 'whisper-only') {
                        segments = await this._fetchTranscript(videoId, onStatus);
                    }
    
                    if (!segments?.length && (transcriptMethod === 'auto' || transcriptMethod === 'whisper-only')) {
                        onStatus?.('Captions unavailable — trying Whisper AI...', 'loading', 0);
                        try { segments = await this._whisperTranscribe(videoId, (msg, pct) => onStatus?.(msg, 'loading', Math.round(pct * 0.4))); }
                        catch(e) { this._warn('Whisper failed:', e.message); onStatus?.(`Whisper failed: ${e.message}`, 'error', 0); this._isGenerating = false; return null; }
                    }
    
                    if (!segments?.length) {
                        const reason = transcriptMethod === 'captions-only' ? 'No captions found (Whisper disabled)' : transcriptMethod === 'vibe' ? 'WhisperServer transcription failed — is WhisperServer running?' : 'No transcript available';
                        onStatus?.(reason, 'error', 0);
                        this._isGenerating = false; return null;
                    }
    
                    this._log('Got', segments.length, 'transcript segments');
                    this._lastTranscriptSegments = segments;
                    const vidTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || videoId;
                    this._cacheTranscript(videoId, segments, vidTitle);
                    const duration = this._getVideoDuration();
                    const provider = appState.settings.cfLlmProvider || 'builtin';
    
                    let data;
                    if (provider === 'builtin') {
                        onStatus?.('Analyzing transcript (built-in)...', 'loading', 60);
                        data = this._generateChaptersHeuristic(segments, duration);
                    } else {
                        try {
                            const endpoint = this._getLlmEndpoint();
                            if (!endpoint) throw new Error('No LLM endpoint configured');
                            const needsKey = this._CF_PROVIDERS[provider]?.needsKey;
                            if (needsKey && !appState.settings.cfLlmApiKey) throw new Error(`API key required for ${this._CF_PROVIDERS[provider]?.name || provider}`);
    
                            onStatus?.('Preparing transcript for AI...', 'loading', 55);
                            const isLocal = this._isLocalProvider();
                            const txLimit = isLocal ? 200000 : 30000;
                            const transcriptText = this._buildTranscriptText(segments, txLimit);
                            const durationMin = Math.ceil(duration / 60);
    
                            const systemPrompt = appState.settings.cfCustomChapterPrompt || this._buildChapterSystemPrompt(durationMin);
                            const userPrompt = `Generate chapters and points of interest for this ${durationMin}-minute video titled "${vidTitle}".\n\nFull transcript (${segments.length} segments, ${transcriptText.length} chars):\n\n${transcriptText}`;
    
                            onStatus?.(isLocal ? `Processing full transcript locally (${Math.round(transcriptText.length/1000)}K chars)...` : 'Calling LLM API...', 'loading', 70);
                            const rawText = await this._callLlmApi(systemPrompt, userPrompt, onStatus);
                            onStatus?.('Parsing AI results...', 'loading', 95);
                            data = this._parseChapterJSON(rawText, duration);
                            if (!data?.chapters?.length) {
                                this._log('Raw AI output:', rawText);
                                throw new Error('AI returned unparseable response');
                            }
                        } catch(aiErr) {
                            this._warn('AI chapter gen failed, falling back to built-in:', aiErr.message);
                            if (aiErr.message?.includes('unparseable')) {
                                this._log('Hint: If using Ollama, ensure version >= 0.1.14 for OpenAI-compatible endpoint');
                            }
                            onStatus?.('AI failed — using built-in analysis...', 'loading', 80);
                            data = this._generateChaptersHeuristic(segments, duration);
                        }
                    }
    
                    if (data?.chapters?.length) {
                        this._setCachedData(videoId, data);
                        onStatus?.(`Generated ${data.chapters.length} chapters, ${data.pois.length} POIs`, 'ready', 100);
                        this._isGenerating = false; return data;
                    } else { onStatus?.('Generation produced no chapters', 'error', 0); this._isGenerating = false; return null; }
                } catch(e) { this._warn('Generation error:', e); onStatus?.(e.message || 'Generation failed', 'error', 0); this._isGenerating = false; return null; }
            },
    
            _parseChapterJSON(raw, duration) {
                let json = null;
                try { json = JSON.parse(raw); } catch(e) {}
                if (!json) { const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/); if (match) try { json = JSON.parse(match[1].trim()); } catch(e) {} }
                if (!json) { const match = raw.match(/\{[\s\S]*\}/); if (match) try { json = JSON.parse(match[0]); } catch(e) {} }
                if (!json) return null;
                const chapters = (json.chapters || []).filter(c => typeof c.start === 'number' && typeof c.title === 'string').map(c => ({ start: Math.max(0, Math.min(c.start, duration || Infinity)), title: c.title.slice(0, 60) })).sort((a, b) => a.start - b.start);
                const pois = (json.pois || json.poi || []).filter(p => typeof p.time === 'number' && typeof p.label === 'string').map(p => ({ time: Math.max(0, Math.min(p.time, duration || Infinity)), label: p.label.slice(0, 80) })).sort((a, b) => a.time - b.time);
                if (chapters.length && chapters[0].start > 0) chapters.unshift({ start: 0, title: 'Introduction' });
                for (let i = 0; i < chapters.length; i++) chapters[i].end = (i < chapters.length - 1) ? chapters[i + 1].start : (duration || chapters[i].start + 300);
                return { chapters, pois };
            },

            // ═══════════════════════════════════════════════════════
            //  OpenCut-inspired Analysis Engine (browser-native)
            // ═══════════════════════════════════════════════════════

            // Filler word detection — user-editable via cfFillerWords setting
            _getFillerSets() {
                const raw = appState.settings.cfFillerWords || '';
                const words = raw.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
                const simple = new Set();
                const multi = [];
                for (const w of words) {
                    if (w.includes(' ')) {
                        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        multi.push({ pattern: new RegExp(`\\b(${escaped})\\b`, 'gi'), word: w });
                    } else {
                        simple.add(w);
                    }
                }
                // "like" with comma is a special case (filler "like," vs normal "like")
                if (simple.has('like')) {
                    simple.delete('like');
                    multi.push({ pattern: /\b(like)\s*[,]/gi, word: 'like' });
                }
                return { simple, multi };
            },

            _detectFillers(segments) {
                if (!segments?.length) return [];
                const { simple, multi } = this._getFillerSets();
                if (simple.size === 0 && multi.length === 0) return [];
                const fillers = [];
                for (const seg of segments) {
                    const text = seg.text || '';
                    const words = text.split(/\s+/);
                    const segDur = seg.dur || seg.duration || 3;
                    const segEnd = seg.start + segDur;
                    for (let wi = 0; wi < words.length; wi++) {
                        const clean = words[wi].replace(/[^a-zA-Z\s]/g, '').toLowerCase().trim();
                        if (simple.has(clean)) {
                            const offset = (wi / Math.max(words.length, 1)) * segDur;
                            fillers.push({ time: seg.start + offset, duration: 0.8, word: clean, segStart: seg.start, segEnd });
                        }
                    }
                    for (const { pattern, word } of multi) {
                        pattern.lastIndex = 0;
                        let m;
                        while ((m = pattern.exec(text)) !== null) {
                            const matched = m[0].toLowerCase().trim();
                            if (simple.has(matched)) continue;
                            const charPos = m.index / Math.max(text.length, 1);
                            fillers.push({ time: seg.start + charPos * segDur, duration: 1.0, word: matched, segStart: seg.start, segEnd });
                        }
                    }
                }
                fillers.sort((a, b) => a.time - b.time);
                const deduped = []; let lastT = -2;
                for (const f of fillers) { if (f.time - lastT > 1.0) { deduped.push(f); lastT = f.time; } }
                this._log('Filler detection:', deduped.length, 'fillers in', segments.length, 'segments');
                return deduped;
            },

            // ═══════════════════════════════════════════════════════
            //  AutoSkip Engine (unified pause + filler skip)
            //  Inspired by AutoCut aggression presets
            // ═══════════════════════════════════════════════════════

            // AutoSkip mode presets — controls pause threshold, filler skip, and silence speedup
            _AUTOSKIP_PRESETS: {
                gentle:     { pauseThreshold: 3.0, skipFillers: false, silenceSpeed: null, label: 'Gentle',     desc: 'Skip long pauses (>3s)' },
                normal:     { pauseThreshold: 1.5, skipFillers: true,  silenceSpeed: null, label: 'Normal',     desc: 'Skip pauses >1.5s + fillers' },
                aggressive: { pauseThreshold: 0.5, skipFillers: true,  silenceSpeed: 2.0,  label: 'Aggressive', desc: 'Skip all gaps, speed silence' },
            },

            _getAutoSkipPreset() {
                const mode = appState.settings.cfAutoSkipMode || 'off';
                return this._AUTOSKIP_PRESETS[mode] || null;
            },

            // Pause detection — recomputed per aggression level
            _detectPauses(segments, threshold) {
                if (!segments?.length || segments.length < 2) return [];
                const pauses = [];
                for (let i = 0; i < segments.length - 1; i++) {
                    const segEnd = segments[i].start + (segments[i].dur || segments[i].duration || 3);
                    const nextStart = segments[i + 1].start;
                    const gap = nextStart - segEnd;
                    if (gap >= threshold) {
                        pauses.push({ start: segEnd, end: nextStart, duration: Math.round(gap * 10) / 10 });
                    }
                }
                this._log('Pause detection:', pauses.length, 'pauses >', threshold + 's in', segments.length, 'segments');
                return pauses;
            },

            // Recompute pauses for current preset and store
            _recomputePauses() {
                if (!this._lastTranscriptSegments?.length) return;
                const preset = this._getAutoSkipPreset();
                const threshold = preset ? preset.pauseThreshold : 1.5;
                this._pauseData = this._detectPauses(this._lastTranscriptSegments, threshold);
            },

            // Unified skip loop — one RAF handles both pause and filler skipping
            _startAutoSkip() {
                if (this._autoSkipRAF) return;
                const preset = this._getAutoSkipPreset();
                if (!preset) return;
                this._autoSkipActive = true;

                // Recompute pauses for this aggression level
                this._recomputePauses();

                // Build a sorted skip list: [{start, end, type}]
                // This lets us binary-search instead of scanning every filler/pause per frame
                const skipZones = [];
                if (this._pauseData?.length) {
                    for (const p of this._pauseData) {
                        skipZones.push({ start: p.start, end: p.end, type: 'pause' });
                    }
                }
                if (preset.skipFillers && this._fillerData?.length) {
                    for (const f of this._fillerData) {
                        // Use wider window: ±1s around estimated time to account for
                        // inaccurate word-level timing within transcript segments
                        const windowStart = Math.max(f.time - 1.0, f.segStart);
                        const windowEnd = Math.min(f.time + f.duration + 0.5, f.segEnd);
                        skipZones.push({ start: windowStart, end: windowEnd, type: 'filler' });
                    }
                }
                skipZones.sort((a, b) => a.start - b.start);

                // Merge overlapping zones
                const merged = [];
                for (const z of skipZones) {
                    const last = merged[merged.length - 1];
                    if (last && z.start <= last.end + 0.2) {
                        last.end = Math.max(last.end, z.end);
                        if (z.type === 'pause') last.type = 'pause'; // pause takes priority for speedup
                    } else {
                        merged.push({ ...z });
                    }
                }

                this._log('AutoSkip started:', merged.length, 'skip zones (mode:', appState.settings.cfAutoSkipMode + ')');
                this._autoSkipZones = merged;

                let zoneIdx = 0; // cursor for binary-search optimization
                const silenceSpeed = preset.silenceSpeed;
                const self = this;

                const tick = () => {
                    if (!self._autoSkipActive) return;
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || video.paused) {
                        self._autoSkipRAF = requestAnimationFrame(tick);
                        return;
                    }

                    const ct = video.currentTime;

                    // Reset cursor if we seeked backwards
                    if (zoneIdx > 0 && merged[zoneIdx - 1]?.end > ct + 1) zoneIdx = 0;

                    // Advance cursor to current position
                    while (zoneIdx < merged.length && merged[zoneIdx].end <= ct) zoneIdx++;

                    // Check if we're inside a skip zone
                    if (zoneIdx < merged.length) {
                        const zone = merged[zoneIdx];
                        if (ct >= zone.start && ct < zone.end) {
                            if (zone.type === 'pause' && silenceSpeed) {
                                // Aggressive mode: speed through silence instead of hard skip
                                if (self._autoSkipSavedRate === null) {
                                    self._autoSkipSavedRate = video.playbackRate;
                                    video.playbackRate = silenceSpeed;
                                }
                            } else {
                                // Hard skip past the zone
                                video.currentTime = zone.end + 0.05;
                                zoneIdx++;
                            }
                            self._autoSkipRAF = requestAnimationFrame(tick);
                            return;
                        }
                    }

                    // Not in a skip zone — restore normal speed if we were speeding through silence
                    if (self._autoSkipSavedRate !== null) {
                        video.playbackRate = self._autoSkipSavedRate;
                        self._autoSkipSavedRate = null;
                    }

                    self._autoSkipRAF = requestAnimationFrame(tick);
                };

                this._autoSkipRAF = requestAnimationFrame(tick);
            },

            _stopAutoSkip() {
                this._autoSkipActive = false;
                if (this._autoSkipRAF) { cancelAnimationFrame(this._autoSkipRAF); this._autoSkipRAF = null; }
                // Restore playback rate if we were speeding through silence
                if (this._autoSkipSavedRate !== null) {
                    const video = document.querySelector('video.html5-main-video');
                    if (video) video.playbackRate = this._autoSkipSavedRate;
                    this._autoSkipSavedRate = null;
                }
                this._autoSkipZones = null;
            },

            // Auto model selection — pick best Ollama model for video length
            _MODEL_CONTEXT: {
                'qwen3:32b':   { ctx: 131072, priority: 1 },
                'qwen3:14b':   { ctx: 131072, priority: 2 },
                'qwen3:8b':    { ctx: 131072, priority: 3 },
                'llama3.3:70b': { ctx: 131072, priority: 1 },
                'llama3.1:70b': { ctx: 131072, priority: 1 },
            },
            _getOptimalModel(durationMin, installedModels) {
                if (!installedModels?.length) return null;
                // Estimate required context: ~100 tokens/min of transcript + prompt overhead
                const estTokens = Math.max(durationMin * 100, 4000) + 2000;
                // Filter to models that can handle the transcript
                const viable = installedModels
                    .map(name => {
                        const baseName = name.replace(/:latest$/, '');
                        const info = this._MODEL_CONTEXT[baseName];
                        if (!info) return { name, ctx: 131072, priority: 10 }; // unknown model, assume large ctx
                        return { name, ctx: info.ctx, priority: info.priority };
                    })
                    .filter(m => m.ctx >= estTokens);
                if (!viable.length) {
                    // None can handle it — pick the largest context available
                    const all = installedModels.map(name => {
                        const baseName = name.replace(/:latest$/, '');
                        const info = this._MODEL_CONTEXT[baseName];
                        return { name, ctx: info?.ctx || 131072, priority: info?.priority || 10 };
                    });
                    all.sort((a, b) => b.ctx - a.ctx || a.priority - b.priority);
                    return all[0]?.name || installedModels[0];
                }
                // Sort by quality (priority ascending = better model first)
                viable.sort((a, b) => a.priority - b.priority);
                return viable[0].name;
            },

            // Speech pace analysis — from OpenCut audio analysis
            _analyzePace(segments) {
                if (!segments?.length) return [];
                const pace = [];
                for (const seg of segments) {
                    const words = (seg.text || '').split(/\s+/).filter(w => w.length > 0).length;
                    const dur = seg.duration || 3;
                    pace.push({ start: seg.start, end: seg.start + dur, wpm: Math.round((words / dur) * 60), words });
                }
                return pace;
            },
            _getPaceStats(paceData) {
                if (!paceData?.length) return null;
                const wpms = paceData.map(p => p.wpm).filter(w => w > 0);
                if (!wpms.length) return null;
                const avg = Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length);
                return { avg, max: Math.max(...wpms), min: Math.min(...wpms), fast: paceData.filter(p => p.wpm > avg * 1.4).length, slow: paceData.filter(p => p.wpm > 0 && p.wpm < avg * 0.6).length, total: wpms.length };
            },

            // Keyword extraction per chapter — from OpenCut NLP + scene detection
            _extractKeywords(segments, chapters) {
                if (!segments?.length || !chapters?.length) return [];
                const result = [];
                for (const ch of chapters) {
                    const chSegs = segments.filter(s => s.start >= ch.start && s.start < (ch.end || Infinity));
                    const text = chSegs.map(s => s.text).join(' ').toLowerCase();
                    const words = text.split(/[^a-z0-9']+/).filter(w => w.length > 3 && !this._NLP_STOPS.has(w));
                    const freq = {};
                    for (const w of words) freq[w] = (freq[w] || 0) + 1;
                    result.push(Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]));
                }
                return result;
            },

            // AI Translation — from OpenCut deep-translator module
            async _translateContent(text, targetLang, onStatus) {
                const provider = appState.settings.cfLlmProvider;
                if (!provider || provider === 'builtin') throw new Error('Translation requires an AI provider (Ollama, OpenAI, etc.)');
                const systemPrompt = `You are a professional translator. Translate the following text to ${targetLang}. Preserve all timestamps, formatting, and structure exactly. Only translate the spoken content. Output ONLY the translated text, nothing else.`;
                return await this._callLlmApi(systemPrompt, text, onStatus);
            },

            async _translateChaptersAndSummary(targetLang) {
                if (!targetLang) return;
                const provider = appState.settings.cfLlmProvider;
                if (!provider || provider === 'builtin') { this._log('Translation requires AI provider'); return; }
                if (this._chapterData?.chapters?.length) {
                    const titles = this._chapterData.chapters.map((c, i) => `${i + 1}. ${c.title}`).join('\n');
                    try {
                        const translated = await this._translateContent(titles, targetLang);
                        if (translated) {
                            this._translatedChapters = translated.trim().split('\n').map(line => {
                                const m = line.match(/^\d+\.\s*(.+)/);
                                return m ? m[1].trim() : line.trim();
                            });
                        }
                    } catch (e) { this._log('Chapter translation error:', e.message); }
                }
                if (this._lastSummary) {
                    try { this._translatedSummary = await this._translateContent(this._lastSummary, targetLang); } catch (e) { this._log('Summary translation error:', e.message); }
                }
            },

            // Export: SRT format — from OpenCut transcript export module
            _exportSRT() {
                const segs = this._lastTranscriptSegments;
                if (!segs?.length) return;
                let srt = '';
                segs.forEach((seg, i) => {
                    const start = this._fmtSRT(seg.start);
                    const end = this._fmtSRT(seg.start + (seg.duration || 3));
                    srt += `${i + 1}\n${start} --> ${end}\n${seg.text}\n\n`;
                });
                this._dlFile(srt, `transcript_${this._getVideoId()}.srt`, 'text/srt');
            },
            _exportVTT() {
                const segs = this._lastTranscriptSegments;
                if (!segs?.length) return;
                let vtt = 'WEBVTT\n\n';
                segs.forEach((seg) => {
                    const start = this._fmtSRT(seg.start).replace(',', '.');
                    const end = this._fmtSRT(seg.start + (seg.duration || 3)).replace(',', '.');
                    vtt += `${start} --> ${end}\n${seg.text}\n\n`;
                });
                this._dlFile(vtt, `transcript_${this._getVideoId()}.vtt`, 'text/vtt');
            },
            _exportChaptersSRT() {
                if (!this._chapterData?.chapters?.length) return;
                let srt = '';
                this._chapterData.chapters.forEach((ch, i) => {
                    const start = this._fmtSRT(ch.start);
                    const end = this._fmtSRT(ch.end || ch.start + 60);
                    const title = this._translatedChapters?.[i] || ch.title;
                    srt += `${i + 1}\n${start} --> ${end}\n${title}\n\n`;
                });
                this._dlFile(srt, `chapters_${this._getVideoId()}.srt`, 'text/srt');
            },
            _fmtSRT(sec) {
                const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec % 1) * 1000);
                return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
            },
            _dlFile(content, filename, type) {
                const blob = new Blob([content], { type });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            },

            // Run all analysis after transcript is available
            _runAnalysis(segments) {
                if (!segments?.length) return;
                if (appState.settings.cfFillerDetect) this._fillerData = this._detectFillers(segments);
                // Detect pauses at finest granularity (0.5s) — AutoSkip filters by mode at runtime
                this._pauseData = this._detectPauses(segments, 0.5);
                this._paceData = this._analyzePace(segments);
                if (this._chapterData?.chapters?.length) this._keywordsPerChapter = this._extractKeywords(segments, this._chapterData.chapters);
            },

    
            // ═══════════════════════════════════════════════════════════
            //  UI: Progress Bar Overlay (FIXED — no z-index conflicts)
            // ═══════════════════════════════════════════════════════════
            _renderProgressBarOverlay() {
                // Clean up all previous overlays
                document.querySelectorAll('.cf-bar-overlay,.cf-chapter-markers,.cf-chapter-label-row,.cf-filler-markers').forEach(el => el.remove());
                document.getElementById('cf-transcript-tip')?.remove();
                if (!this._chapterData) return;
                const progressBar = document.querySelector('.ytp-progress-bar');
                if (!progressBar) return;
                const duration = this._getVideoDuration();
                if (!duration) return;
                if (getComputedStyle(progressBar).position === 'static') progressBar.style.position = 'relative';
                const s = appState.settings;
                const poiColor = s.cfPoiColor || '#ff6b6b';
    
                // ── Chapter segments on the progress bar ──
                if (s.cfShowChapters && this._chapterData.chapters.length > 1) {
                    const markerContainer = document.createElement('div');
                    markerContainer.className = 'cf-chapter-markers';
    
                    // Label row above the progress bar — shows chapter names
                    const labelRow = document.createElement('div');
                    labelRow.className = 'cf-chapter-label-row';
    
                    this._chapterData.chapters.forEach((ch, i) => {
                        const left = (ch.start / duration) * 100;
                        const width = ((ch.end - ch.start) / duration) * 100;
                        const color = this._CF_COLORS[i % this._CF_COLORS.length];
                        const fg = this._CF_COLORS_FG[i % this._CF_COLORS_FG.length];
    
                        // Chapter segment (colored bar)
                        const seg = document.createElement('div');
                        seg.className = 'cf-chapter-seg';
                        seg.style.cssText = `left:${left}%;width:${width}%;--cf-seg-color:${color};--cf-seg-opacity:${s.cfChapterOpacity || 0.35}`;
                        seg.dataset.cfChapterIdx = i;
                        seg.addEventListener('click', (e) => { e.stopPropagation(); this._seekTo(ch.start); });
    
                        // Tooltip on hover (positioned well above bar)
                        const tip = document.createElement('div');
                        tip.className = 'cf-bar-tooltip cf-chapter-tip';
                        TrustedHTML.setHTML(tip, `<span class="cf-tip-time">${this._formatTime(ch.start)}</span><span class="cf-tip-title">${ch.title}</span>`);
                        seg.appendChild(tip);
                        seg.addEventListener('mouseenter', () => tip.style.opacity = '1');
                        seg.addEventListener('mouseleave', () => tip.style.opacity = '0');
    
                        // Gap divider between chapters
                        if (i > 0) {
                            const gap = document.createElement('div');
                            gap.className = 'cf-chapter-gap';
                            gap.style.left = `${left}%`;
                            markerContainer.appendChild(gap);
                        }
    
                        markerContainer.appendChild(seg);
    
                        // Chapter label (name inside the colored segment area, above bar)
                        const label = document.createElement('div');
                        label.className = 'cf-chapter-label';
                        label.style.cssText = `left:${left}%;width:${width}%;--cf-label-color:${color};--cf-label-fg:${fg}`;
                        label.textContent = ch.title;
                        label.addEventListener('click', (e) => { e.stopPropagation(); this._seekTo(ch.start); });
                        labelRow.appendChild(label);
                    });
    
                    progressBar.appendChild(markerContainer);
                    // Append label row to progress bar itself — purely absolute, no layout impact
                    progressBar.appendChild(labelRow);
                }
    
                // ── POI markers ──
                const overlay = document.createElement('div'); overlay.className = 'cf-bar-overlay';
    
                if (s.cfShowPOIs && this._chapterData.pois.length) {
                    this._chapterData.pois.forEach(p => {
                        const left = (p.time / duration) * 100;
                        const hitbox = document.createElement('div');
                        hitbox.className = 'cf-poi-hitbox';
                        hitbox.style.left = `${left}%`;
                        hitbox.addEventListener('click', (e) => { e.stopPropagation(); this._seekTo(p.time); });
    
                        const diamond = document.createElement('div');
                        diamond.className = 'cf-poi-diamond';
                        diamond.style.background = poiColor;
                        hitbox.appendChild(diamond);
    
                        const tip = document.createElement('div');
                        tip.className = 'cf-bar-tooltip cf-poi-tip';
                        TrustedHTML.setHTML(tip, `<span class="cf-tip-poi-icon">&#9733;</span><span class="cf-tip-time">${this._formatTime(p.time)}</span><span class="cf-tip-label">${p.label}</span>`);
                        hitbox.appendChild(tip);
                        hitbox.addEventListener('mouseenter', () => { tip.style.opacity = '1'; diamond.classList.add('cf-poi-hover'); });
                        hitbox.addEventListener('mouseleave', () => { tip.style.opacity = '0'; diamond.classList.remove('cf-poi-hover'); });
                        overlay.appendChild(hitbox);
                    });
                }
    
                // ── Enhanced transcript hover ──
                if (this._lastTranscriptSegments?.length) {
                    const transcriptTip = document.createElement('div');
                    transcriptTip.id = 'cf-transcript-tip';
                    transcriptTip.className = 'cf-transcript-tip';
                    const chapters = this._chapterData?.chapters || [];
    
                    overlay.addEventListener('mousemove', (e) => {
                        const rect = progressBar.getBoundingClientRect();
                        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        const hoverTime = percent * duration;
    
                        let bestIdx = -1;
                        for (let si = 0; si < this._lastTranscriptSegments.length; si++) {
                            const seg = this._lastTranscriptSegments[si];
                            if (seg.start <= hoverTime && hoverTime <= seg.start + (seg.dur || 5)) { bestIdx = si; break; }
                            if (seg.start > hoverTime) break;
                            bestIdx = si;
                        }
    
                        if (bestIdx >= 0) {
                            const segs = this._lastTranscriptSegments;
                            const lines = [];
                            if (bestIdx > 0) lines.push({ time: segs[bestIdx - 1].start, text: segs[bestIdx - 1].text, dim: true });
                            lines.push({ time: segs[bestIdx].start, text: segs[bestIdx].text, dim: false });
                            if (bestIdx < segs.length - 1) lines.push({ time: segs[bestIdx + 1].start, text: segs[bestIdx + 1].text, dim: true });
    
                            let chapterName = '';
                            for (let ci = chapters.length - 1; ci >= 0; ci--) {
                                if (hoverTime >= chapters[ci].start) { chapterName = chapters[ci].title; break; }
                            }
    
                            let html = '';
                            if (chapterName) html += `<div class="cf-tx-chapter">${chapterName}</div>`;
                            for (const ln of lines) {
                                const txt = ln.text.length > 80 ? ln.text.slice(0, 77) + '...' : ln.text;
                                html += `<div class="cf-tx-line${ln.dim ? ' cf-tx-dim' : ''}"><span class="cf-tx-ts">${this._formatTime(ln.time)}</span> ${txt}</div>`;
                            }
    
                            TrustedHTML.setHTML(transcriptTip, html);
                            transcriptTip.style.opacity = '1';
                            const tipWidth = 300;
                            const xPos = Math.max(5, Math.min(rect.width - tipWidth - 5, e.clientX - rect.left - tipWidth / 2));
                            transcriptTip.style.left = xPos + 'px';
                        } else {
                            transcriptTip.style.opacity = '0';
                        }
                    });
                    overlay.addEventListener('mouseleave', () => { transcriptTip.style.opacity = '0'; });
                    overlay.appendChild(transcriptTip);
                }
    
                progressBar.appendChild(overlay);

                // ── Filler word markers (OpenCut: filler detection) ──
                if (s.cfShowFillerMarkers && this._fillerData?.length) {
                    const fillerContainer = document.createElement('div');
                    fillerContainer.className = 'cf-filler-markers';
                    this._fillerData.forEach(f => {
                        const left = (f.time / duration) * 100;
                        const marker = document.createElement('div');
                        marker.className = 'cf-filler-marker';
                        marker.style.left = `${left}%`;
                        marker.title = f.word;
                        const tip = document.createElement('div');
                        tip.className = 'cf-bar-tooltip cf-filler-tip';
                        tip.textContent = `"${f.word}" @ ${this._formatTime(f.time)}`;
                        marker.appendChild(tip);
                        marker.addEventListener('mouseenter', () => tip.style.opacity = '1');
                        marker.addEventListener('mouseleave', () => tip.style.opacity = '0');
                        marker.addEventListener('click', (e) => { e.stopPropagation(); this._seekTo(f.time); });
                        fillerContainer.appendChild(marker);
                    });
                    progressBar.appendChild(fillerContainer);
                }
    
                // Start chapter HUD tracking
                this._startChapterTracking();
            },
    
            // ═══ CHAPTER HUD — Floating current chapter indicator on video ═══
            _startChapterTracking() {
                this._stopChapterTracking();
                if (!appState.settings.cfShowChapterHUD || !this._chapterData?.chapters?.length) return;
    
                const track = () => {
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || !this._chapterData?.chapters?.length) {
                        this._chapterTrackingRAF = requestAnimationFrame(track);
                        return;
                    }
                    const ct = video.currentTime;
                    const chapters = this._chapterData.chapters;
                    let idx = -1;
                    for (let i = chapters.length - 1; i >= 0; i--) {
                        if (ct >= chapters[i].start) { idx = i; break; }
                    }
                    if (idx !== this._lastActiveChapterIdx) {
                        this._lastActiveChapterIdx = idx;
                        this._updateChapterHUD(idx);
                        // Highlight active segment on progress bar
                        document.querySelectorAll('.cf-chapter-seg').forEach((seg, si) => {
                            seg.classList.toggle('cf-seg-active', si === idx);
                        });
                        document.querySelectorAll('.cf-chapter-label').forEach((lbl, li) => {
                            lbl.classList.toggle('cf-label-active', li === idx);
                        });
                    }
                    this._chapterTrackingRAF = requestAnimationFrame(track);
                };
                this._chapterTrackingRAF = requestAnimationFrame(track);
            },
    
            _stopChapterTracking() {
                if (this._chapterTrackingRAF) {
                    cancelAnimationFrame(this._chapterTrackingRAF);
                    this._chapterTrackingRAF = null;
                }
                this._lastActiveChapterIdx = -1;
            },
    
            _updateChapterHUD(chapterIdx) {
                if (!appState.settings.cfShowChapterHUD) {
                    this._chapterHUDEl?.remove();
                    this._chapterHUDEl = null;
                    return;
                }
                const player = document.getElementById('movie_player');
                if (!player) return;
    
                if (!this._chapterHUDEl) {
                    this._chapterHUDEl = document.createElement('div');
                    this._chapterHUDEl.className = 'cf-chapter-hud';
                    player.appendChild(this._chapterHUDEl);
                }

                // Apply position
                const pos = appState.settings.cfHudPosition || 'top-left';
                this._chapterHUDEl.setAttribute('data-cf-pos', pos);
    
                if (chapterIdx < 0 || !this._chapterData?.chapters?.[chapterIdx]) {
                    this._chapterHUDEl.style.opacity = '0';
                    return;
                }
    
                const chapters = this._chapterData.chapters;
                const ch = chapters[chapterIdx];
                const color = this._CF_COLORS[chapterIdx % this._CF_COLORS.length];
                const hasPrev = chapterIdx > 0;
                const hasNext = chapterIdx < chapters.length - 1;
                const counter = `${chapterIdx + 1}/${chapters.length}`;
    
                let html = `<button class="cf-hud-nav ${hasPrev ? '' : 'cf-hud-disabled'}" data-cf-nav="prev" title="Previous chapter"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>`;
                html += `<span class="cf-hud-dot" style="background:${color}"></span>`;
                html += `<span class="cf-hud-title">${this._esc(ch.title)}</span>`;
                html += `<span class="cf-hud-counter">${counter}</span>`;
                html += `<button class="cf-hud-nav ${hasNext ? '' : 'cf-hud-disabled'}" data-cf-nav="next" title="Next chapter"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    
                TrustedHTML.setHTML(this._chapterHUDEl, html);
                this._chapterHUDEl.style.opacity = '1';
                this._chapterHUDEl.style.setProperty('--cf-hud-accent', color);

                // Wire nav buttons
                this._chapterHUDEl.querySelectorAll('.cf-hud-nav').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const dir = btn.dataset.cfNav;
                        const video = document.querySelector('video.html5-main-video');
                        if (!video) return;
                        const targetIdx = dir === 'prev' ? chapterIdx - 1 : chapterIdx + 1;
                        if (targetIdx >= 0 && targetIdx < chapters.length) {
                            video.currentTime = chapters[targetIdx].start + 0.5;
                        }
                    });
                });
            },
    
            // ═══ UI: Panel ═══
            _createPanel() {
                if (this._panelEl) return this._panelEl;
                this._panelEl = document.createElement('div'); this._panelEl.id = 'cf-panel'; this._panelEl.className = 'cf-panel';
                // Prevent ALL panel clicks from reaching the outside-click handler
                this._panelEl.addEventListener('click', (e) => e.stopPropagation());
                document.body.appendChild(this._panelEl); this._renderPanel(); return this._panelEl;
            },
            _togglePanel() { const p = this._createPanel(); if (p.classList.contains('cf-visible')) { p.classList.remove('cf-visible'); } else { p.classList.add('cf-visible'); this._renderPanel(); } },
            _renderPanel() {
                if (!this._panelEl) return;
                this._lastRenderTime = Date.now();
                const hasData = !!this._chapterData?.chapters?.length; const s = appState.settings;
                const videoId = this._getVideoId();
                let tabHTML = '';
    
                if (this._activeTab === 'chapters') {
                    if (hasData) {
                        tabHTML = `<div class="cf-section-label">Chapters (${this._chapterData.chapters.length})</div><ul class="cf-chapter-list">`;
                        this._chapterData.chapters.forEach((c, i) => { const color = this._CF_COLORS[i % this._CF_COLORS.length]; tabHTML += `<li class="cf-chapter-item" data-cf-seek="${c.start}"><span class="cf-chapter-dot" style="background:${color}"></span><span class="cf-chapter-time">${this._formatTime(c.start)}</span><span class="cf-chapter-title">${this._esc(c.title)}</span><span class="cf-clip-btn" data-cf-clip="${c.start}" data-cf-clip-end="${c.end || ''}" title="Copy timestamped link">&#128279;</span></li>`; });
                        tabHTML += `</ul>`;
                        if (this._chapterData.pois?.length) {
                            const poiColor = s.cfPoiColor || '#ff6b6b';
                            tabHTML += `<div class="cf-section-label">Points of Interest</div><ul class="cf-chapter-list">`;
                            this._chapterData.pois.forEach(p => { tabHTML += `<li class="cf-chapter-item" data-cf-seek="${p.time}"><span class="cf-chapter-dot" style="background:${poiColor}"></span><span class="cf-chapter-time">${this._formatTime(p.time)}</span><span class="cf-chapter-title">${this._esc(p.label)}<span class="cf-poi-badge">POI</span></span><span class="cf-clip-btn" data-cf-clip="${p.time}" title="Copy timestamped link">&#128279;</span></li>`; });
                            tabHTML += `</ul>`;
                        }
                    } else {
                        const provider = s.cfLlmProvider || 'builtin';
                        const isFirstTime = !this._countCache();
                        tabHTML = `<div class="cf-empty"><svg viewBox="0 0 24 24" style="width:40px;height:40px;fill:rgba(255,255,255,0.08);margin-bottom:12px"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg><div>No chapters generated yet</div><div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.15)">Click Generate to analyze this video</div>`;
                        if (isFirstTime) {
                            tabHTML += `<div class="cf-onboard"><div class="cf-onboard-title">Quick Start</div>`;
                            tabHTML += `<div class="cf-onboard-step"><span class="cf-onboard-num">1</span>${provider === 'builtin' ? 'Works out of the box with built-in NLP' : `Using ${this._CF_PROVIDERS[provider]?.name || provider}`}</div>`;
                            tabHTML += `<div class="cf-onboard-step"><span class="cf-onboard-num">2</span>For better results, install <a href="https://ollama.com" target="_blank" style="color:#a78bfa">Ollama</a> and set provider in Settings</div>`;
                            tabHTML += `<div class="cf-onboard-step"><span class="cf-onboard-num">3</span>Pull the model: <span style="font-family:monospace;color:#a78bfa">ollama pull qwen3:32b</span> (~20 GB)</div>`;
                            tabHTML += `</div>`;
                        }
                        tabHTML += `</div>`;
                    }
                    // SponsorBlock import — always visible on chapters tab
                    tabHTML += `<div class="cf-section-label">Community Chapters</div>`;
                    tabHTML += `<div style="display:flex;gap:6px;align-items:center">`;
                    tabHTML += `<button class="cf-action-btn" id="cf-sb-import" style="flex:0 0 auto">Import from SponsorBlock</button>`;
                    if (this._sbChapters?.length) tabHTML += `<button class="cf-action-btn" id="cf-sb-apply" style="flex:0 0 auto;border-color:rgba(16,185,129,0.3);color:rgba(16,185,129,0.7)">Apply (${this._sbChapters.length})</button>`;
                    else if (this._sbChapters !== null && !this._sbChapters.length) tabHTML += `<span style="font-size:10px;color:rgba(255,255,255,0.2)">None found</span>`;
                    tabHTML += `</div>`;
                } else if (this._activeTab === 'tools') {
                    tabHTML = `<div class="cf-section-label">Search Transcript</div>`;
                    tabHTML += `<div class="cf-search-row"><input class="cf-input cf-search-input" id="cf-search-input" type="text" placeholder="Search this video..." value="${this._searchQuery}" spellcheck="false" /><span class="cf-search-count" id="cf-search-count">${this._searchResults?.length ? this._searchResults.length + ' hits' : ''}</span></div>`;
                    if (this._searchResults?.length) {
                        tabHTML += `<ul class="cf-chapter-list cf-search-results">`;
                        this._searchResults.slice(0, 25).forEach(r => {
                            const snip = r.text.length > 80 ? r.text.slice(0, 77) + '...' : r.text;
                            tabHTML += `<li class="cf-chapter-item cf-search-hit" data-cf-seek="${r.time}"><span class="cf-chapter-time">${this._formatTime(r.time)}</span><span class="cf-chapter-title cf-search-text">${this._esc(snip)}</span></li>`;
                        });
                        tabHTML += `</ul>`;
                    }
                    tabHTML += `<div class="cf-section-label">Search All Videos (${this._countTranscriptCache()} cached)</div>`;
                    tabHTML += `<div class="cf-search-row"><input class="cf-input cf-search-input" id="cf-global-search" type="text" placeholder="Search across all videos..." value="${this._globalSearchQuery}" spellcheck="false" /></div>`;
                    if (this._globalSearchResults?.length) {
                        this._globalSearchResults.slice(0, 10).forEach(r => {
                            tabHTML += `<div class="cf-global-result"><div class="cf-global-title"><a href="https://www.youtube.com/watch?v=${r.videoId}" target="_blank" class="cf-video-link">${this._esc(r.title)}</a> <span class="cf-match-count">${r.matches.length} hits</span></div><ul class="cf-chapter-list">`;
                            r.matches.slice(0, 3).forEach(m => {
                                const snip = m.text.length > 70 ? m.text.slice(0, 67) + '...' : m.text;
                                tabHTML += `<li class="cf-chapter-item cf-search-hit"><a href="https://www.youtube.com/watch?v=${r.videoId}&t=${Math.round(m.time)}" target="_blank" class="cf-global-link"><span class="cf-chapter-time">${this._formatTime(m.time)}</span><span class="cf-chapter-title cf-search-text">${this._esc(snip)}</span></a></li>`;
                            });
                            tabHTML += `</ul></div>`;
                        });
                    }
                    tabHTML += `<div class="cf-section-label">Summary</div>`;
                    const curStyle = s.cfSummaryMode || 'paragraph';
                    const curLength = s.cfSummaryLength || 'standard';
                    const styleOptions = Object.entries(this._CF_SUMMARY_STYLES).map(([k, v]) => `<option value="${k}" ${curStyle === k ? 'selected' : ''}>${v.name}</option>`).join('');
                    const lengthOptions = ['brief', 'standard', 'detailed'].map(k => `<option value="${k}" ${curLength === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('');
                    tabHTML += `<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center"><select class="cf-select" id="cf-summary-style" style="flex:1;max-width:none">${styleOptions}</select><select class="cf-select" id="cf-summary-length" style="flex:0 0 90px">${lengthOptions}</select><button class="cf-action-btn" id="cf-summary-btn" style="flex:0 0 auto;padding:7px 14px">Summarize</button></div>`;
                    if (this._lastSummary) {
                        tabHTML += `<div class="cf-summary-box">${this._formatSummaryHTML(this._lastSummary)}</div><div style="display:flex;gap:6px;margin-top:4px"><button class="cf-action-btn" id="cf-copy-summary">Copy Summary</button>${(s.cfSummaryMode === 'blog') ? '<button class="cf-action-btn" id="cf-export-blog" style="border-color:rgba(16,185,129,0.3);color:rgba(16,185,129,0.7)">Export .md</button>' : ''}</div>`;
                    }
                    tabHTML += `<div class="cf-section-label">Export</div>`;
                    tabHTML += `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="cf-action-btn" id="cf-export-yt" ${!hasData ? 'disabled' : ''}>Chapters: YouTube</button><button class="cf-action-btn" id="cf-export-json" ${!hasData ? 'disabled' : ''}>Chapters: JSON</button><button class="cf-action-btn" id="cf-export-ch-srt" ${!hasData ? 'disabled' : ''}>Chapters: SRT</button></div>`;
                    tabHTML += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><button class="cf-action-btn" id="cf-export-srt" ${!this._lastTranscriptSegments?.length ? 'disabled' : ''}>Transcript: SRT</button><button class="cf-action-btn" id="cf-export-vtt" ${!this._lastTranscriptSegments?.length ? 'disabled' : ''}>Transcript: VTT</button><button class="cf-action-btn" id="cf-dl-transcript" ${!this._lastTranscriptSegments?.length ? 'disabled' : ''}>Transcript: TXT</button></div>`;
                    tabHTML += `<div class="cf-section-label">Playback Control</div>`;
                    tabHTML += `<div class="cf-settings-row"><span class="cf-settings-label">Auto-speed Intro/Outro</span><div class="cf-toggle-track ${this._speedControlActive ? 'active' : ''}" id="cf-toggle-speed"><div class="cf-toggle-knob"></div></div></div>`;
                    if (this._speedControlActive && hasData) {
                        tabHTML += `<div class="cf-settings-row"><span class="cf-settings-label">Intro Speed</span><select class="cf-select" id="cf-intro-speed"><option value="1.5" ${this._speedSettings.introSpeed==1.5?'selected':''}>1.5x</option><option value="2" ${this._speedSettings.introSpeed==2?'selected':''}>2x</option><option value="3" ${this._speedSettings.introSpeed==3?'selected':''}>3x</option></select></div>`;
                        tabHTML += `<div class="cf-settings-row"><span class="cf-settings-label">Outro Speed</span><select class="cf-select" id="cf-outro-speed"><option value="1.5" ${this._speedSettings.outroSpeed==1.5?'selected':''}>1.5x</option><option value="2" ${this._speedSettings.outroSpeed==2?'selected':''}>2x</option><option value="3" ${this._speedSettings.outroSpeed==3?'selected':''}>3x</option></select></div>`;
                        tabHTML += `<div class="cf-section-label">Skip Chapters</div>`;
                        this._chapterData.chapters.forEach((ch, i) => {
                            tabHTML += `<div class="cf-settings-row"><span class="cf-settings-label" style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${this._esc(ch.title)}">${this._esc(ch.title)}</span><div class="cf-toggle-track cf-skip-toggle ${this._speedSettings.skipChapters[i]?'active':''}" data-cf-skip="${i}"><div class="cf-toggle-knob"></div></div></div>`;
                        });
                    }
                } else if (this._activeTab === 'analysis') {
                    const preset = this._getAutoSkipPreset();
                    const mode = appState.settings.cfAutoSkipMode || 'off';

                    // ── AutoSkip (AutoCut-style) ──
                    tabHTML = `<div class="cf-section-label">AutoSkip</div>`;
                    tabHTML += `<div class="cf-settings-row"><span class="cf-settings-label">Mode</span><select class="cf-select" id="cf-autoskip-mode">`;
                    tabHTML += `<option value="off" ${mode==='off'?'selected':''}>Off</option>`;
                    tabHTML += `<option value="gentle" ${mode==='gentle'?'selected':''}>Gentle — skip long pauses</option>`;
                    tabHTML += `<option value="normal" ${mode==='normal'?'selected':''}>Normal — pauses + fillers</option>`;
                    tabHTML += `<option value="aggressive" ${mode==='aggressive'?'selected':''}>Aggressive — skip all gaps</option>`;
                    tabHTML += `</select></div>`;
                    if (preset && !this._lastTranscriptSegments?.length) {
                        tabHTML += `<div class="cf-muted" style="margin:4px 0 8px">Generate chapters first to enable AutoSkip.</div>`;
                    } else if (preset) {
                        tabHTML += `<div style="font-size:10px;color:rgba(255,255,255,0.25);margin:2px 0 6px;padding-left:2px">${this._esc(preset.desc)}${preset.silenceSpeed ? '. Speeds silence to ' + preset.silenceSpeed + 'x' : ''}</div>`;
                        tabHTML += `<button class="cf-action-btn" id="cf-autoskip-toggle" style="margin-bottom:8px">${this._autoSkipActive ? 'Stop AutoSkip' : 'Start AutoSkip'}</button>`;
                        if (this._autoSkipActive && this._autoSkipZones?.length) {
                            tabHTML += `<div class="cf-muted" style="font-size:10px">${this._autoSkipZones.length} skip zones active</div>`;
                        }
                    }

                    // ── Silence / Pauses stats ──
                    tabHTML += `<div class="cf-section-label">Silence / Pauses</div>`;
                    if (this._pauseData?.length) {
                        // Show stats for current preset threshold (or 1.5s default)
                        const threshold = preset ? preset.pauseThreshold : 1.5;
                        const relevant = this._pauseData.filter(p => p.duration >= threshold);
                        const totalPause = relevant.reduce((sum, p) => sum + p.duration, 0);
                        const duration = this._getVideoDuration() || 1;
                        const pctPause = Math.round((totalPause / duration) * 100);
                        tabHTML += `<div class="cf-analysis-box"><div class="cf-pace-grid">`;
                        tabHTML += `<div class="cf-analysis-stat"><span class="cf-stat-value">${relevant.length}</span><span class="cf-stat-label">pauses >${threshold}s</span></div>`;
                        tabHTML += `<div class="cf-analysis-stat"><span class="cf-stat-value">${Math.round(totalPause)}s</span><span class="cf-stat-label">total silence (${pctPause}%)</span></div>`;
                        tabHTML += `</div></div>`;
                    } else if (this._lastTranscriptSegments?.length) {
                        tabHTML += `<div class="cf-muted">No significant pauses detected.</div>`;
                    } else {
                        tabHTML += `<div class="cf-muted">Generate chapters first to analyze.</div>`;
                    }

                    // ── Filler Word Analysis ──
                    tabHTML += `<div class="cf-section-label">Filler Words</div>`;
                    if (this._fillerData?.length) {
                        const fillerCounts = {};
                        this._fillerData.forEach(f => { fillerCounts[f.word] = (fillerCounts[f.word] || 0) + 1; });
                        const sorted = Object.entries(fillerCounts).sort((a, b) => b[1] - a[1]);
                        tabHTML += `<div class="cf-analysis-box"><div class="cf-analysis-stat"><span class="cf-stat-value">${this._fillerData.length}</span><span class="cf-stat-label">total fillers</span></div>`;
                        tabHTML += `<div class="cf-filler-breakdown">`;
                        sorted.forEach(([word, count]) => {
                            const pct = Math.round((count / this._fillerData.length) * 100);
                            tabHTML += `<div class="cf-filler-row"><span class="cf-filler-word">"${this._esc(word)}"</span><div class="cf-filler-bar-bg"><div class="cf-filler-bar-fill" style="width:${pct}%"></div></div><span class="cf-filler-count">${count}</span></div>`;
                        });
                        tabHTML += `</div></div>`;
                    } else if (this._lastTranscriptSegments?.length) {
                        tabHTML += `<div class="cf-muted">No fillers detected.</div>`;
                    } else {
                        tabHTML += `<div class="cf-muted">Generate chapters first to analyze.</div>`;
                    }

                    // ── Speech Pace ──
                    tabHTML += `<div class="cf-section-label">Speech Pace</div>`;
                    const paceStats = this._getPaceStats(this._paceData);
                    if (paceStats) {
                        let paceClass = 'cf-pace-normal';
                        let paceLabel = 'Normal';
                        if (paceStats.avg > 180) { paceClass = 'cf-pace-fast'; paceLabel = 'Fast'; }
                        else if (paceStats.avg < 120) { paceClass = 'cf-pace-slow'; paceLabel = 'Slow'; }
                        tabHTML += `<div class="cf-analysis-box cf-pace-box"><div class="cf-pace-grid">`;
                        tabHTML += `<div class="cf-analysis-stat ${paceClass}"><span class="cf-stat-value">${paceStats.avg}</span><span class="cf-stat-label">avg WPM (${paceLabel})</span></div>`;
                        tabHTML += `<div class="cf-analysis-stat"><span class="cf-stat-value">${paceStats.min}-${paceStats.max}</span><span class="cf-stat-label">range WPM</span></div>`;
                        tabHTML += `</div>`;
                        if (paceStats.fast > 0 || paceStats.slow > 0) {
                            tabHTML += `<div class="cf-pace-detail">${paceStats.fast} fast segments, ${paceStats.slow} slow segments</div>`;
                        }
                        tabHTML += `</div>`;
                    } else {
                        tabHTML += `<div class="cf-muted">Generate chapters first to analyze.</div>`;
                    }

                    // ── Keywords per Chapter ──
                    if (this._keywordsPerChapter?.length && this._chapterData?.chapters?.length) {
                        tabHTML += `<div class="cf-section-label">Keywords by Chapter</div>`;
                        tabHTML += `<div class="cf-keywords-box">`;
                        this._chapterData.chapters.forEach((ch, i) => {
                            const kws = this._keywordsPerChapter[i];
                            if (kws?.length) {
                                tabHTML += `<div class="cf-kw-row"><span class="cf-kw-chapter">${this._esc(ch.title)}</span><span class="cf-kw-tags">${kws.map(k => `<span class="cf-kw-tag">${this._esc(k)}</span>`).join('')}</span></div>`;
                            }
                        });
                        tabHTML += `</div>`;
                    }

                    // ── AI Translation ──
                    tabHTML += `<div class="cf-section-label">AI Translation</div>`;
                    const curLang = s.cfTranslateLang || '';
                    const providerReady = s.cfLlmProvider && s.cfLlmProvider !== 'builtin';
                    if (!providerReady) {
                        tabHTML += `<div class="cf-muted">Translation requires an AI provider. Set one in Settings tab.</div>`;
                    } else {
                        tabHTML += `<div style="display:flex;gap:6px;align-items:center"><select class="cf-select" id="cf-translate-lang" style="flex:1">`;
                        tabHTML += `<option value="">Select language...</option>`;
                        const langs = ['Spanish','French','German','Portuguese','Italian','Dutch','Russian','Japanese','Korean','Chinese (Simplified)','Chinese (Traditional)','Arabic','Hindi','Turkish','Polish','Vietnamese','Thai','Indonesian','Swedish','Czech','Greek','Hebrew','Romanian','Hungarian','Danish','Finnish','Norwegian','Ukrainian','Malay','Filipino'];
                        langs.forEach(l => { tabHTML += `<option value="${l}" ${curLang===l?'selected':''}>${l}</option>`; });
                        tabHTML += `</select><button class="cf-action-btn" id="cf-translate-btn" ${!curLang ? 'disabled' : ''}>Translate</button></div>`;
                    }
                    if (this._translatedSummary) {
                        tabHTML += `<div class="cf-section-label">Translated Summary</div><div class="cf-summary-box">${this._formatSummaryHTML(this._translatedSummary)}</div>`;
                    }
                    if (this._translatedChapters?.length) {
                        tabHTML += `<div class="cf-section-label">Translated Chapters</div><ul class="cf-chapter-list">`;
                        this._translatedChapters.forEach((t, i) => {
                            const ch = this._chapterData?.chapters?.[i];
                            tabHTML += `<li class="cf-chapter-item" data-cf-seek="${ch?.start || 0}"><span class="cf-chapter-time">${this._formatTime(ch?.start || 0)}</span><span class="cf-chapter-title">${this._esc(t)}</span></li>`;
                        });
                        tabHTML += `</ul>`;
                    }
                } else if (this._activeTab === 'ai') {
                    const providerReady = s.cfLlmProvider && s.cfLlmProvider !== 'builtin';
                    // ── Q&A Chat ──
                    tabHTML = `<div class="cf-section-label">Ask About This Video</div>`;
                    if (!providerReady) {
                        tabHTML += `<div style="font-size:10px;color:rgba(255,255,255,0.25);margin-bottom:8px;padding:8px;background:rgba(255,255,255,0.02);border-radius:6px">AI features require a provider (Ollama, OpenAI, etc.). Set one in Settings tab.</div>`;
                    }
                    tabHTML += `<div class="cf-chat-messages" id="cf-chat-messages">`;
                    if (!this._chatHistory.length) {
                        tabHTML += `<div class="cf-chat-empty">Ask any question about this video. ChapterForge will answer using the transcript.</div>`;
                    } else {
                        this._chatHistory.forEach(m => {
                            const isUser = m.role === 'user';
                            const escapedContent = this._formatSummaryHTML(m.content);
                            tabHTML += `<div class="cf-chat-msg ${isUser ? 'cf-chat-user' : 'cf-chat-ai'}">${escapedContent}</div>`;
                        });
                    }
                    if (this._chatLoading) tabHTML += `<div class="cf-chat-msg cf-chat-ai cf-chat-thinking">Thinking...</div>`;
                    tabHTML += `</div>`;
                    tabHTML += `<div class="cf-chat-input-row"><input class="cf-input cf-chat-input" id="cf-chat-input" type="text" placeholder="${providerReady ? 'Ask a question...' : 'Set an AI provider first'}" spellcheck="false" ${providerReady ? '' : 'disabled'} /><button class="cf-action-btn" id="cf-chat-send" style="flex:0 0 auto;padding:7px 12px" ${providerReady ? '' : 'disabled'}>Ask</button></div>`;
                    if (this._chatHistory.length) tabHTML += `<button class="cf-action-btn" id="cf-chat-clear" style="margin-top:6px;font-size:10px;padding:4px 8px;align-self:flex-start">Clear Chat</button>`;

                    // ── Flashcards ──
                    tabHTML += `<div class="cf-section-label">Flashcards</div>`;
                    tabHTML += `<button class="cf-action-btn" id="cf-flashcard-gen" style="margin-bottom:8px" ${this._flashcardLoading ? 'disabled' : ''} ${providerReady ? '' : 'disabled'}>${this._flashcardLoading ? 'Generating...' : (this._flashcards?.length ? `Regenerate (${this._flashcards.length} cards)` : 'Generate Flashcards')}</button>`;
                    if (this._flashcards?.length) {
                        const card = this._flashcards[this._flashcardIdx];
                        const total = this._flashcards.length;
                        tabHTML += `<div class="cf-flashcard-container">`;
                        tabHTML += `<div class="cf-flashcard ${this._flashcardFlipped ? 'cf-flipped' : ''}" id="cf-flashcard">`;
                        tabHTML += `<div class="cf-flashcard-face cf-flashcard-front"><div class="cf-flashcard-label">Q</div><div class="cf-flashcard-text">${this._esc(card.q)}</div></div>`;
                        tabHTML += `<div class="cf-flashcard-face cf-flashcard-back"><div class="cf-flashcard-label">A</div><div class="cf-flashcard-text">${this._esc(card.a)}</div></div>`;
                        tabHTML += `</div>`;
                        tabHTML += `<div class="cf-flashcard-nav">`;
                        tabHTML += `<button class="cf-action-btn cf-fc-prev" id="cf-fc-prev" ${this._flashcardIdx === 0 ? 'disabled' : ''} style="padding:5px 10px">&larr;</button>`;
                        tabHTML += `<span class="cf-fc-counter">${this._flashcardIdx + 1} / ${total}</span>`;
                        tabHTML += `<button class="cf-action-btn cf-fc-next" id="cf-fc-next" ${this._flashcardIdx >= total - 1 ? 'disabled' : ''} style="padding:5px 10px">&rarr;</button>`;
                        tabHTML += `</div>`;
                        tabHTML += `<div style="display:flex;gap:6px;margin-top:6px"><button class="cf-action-btn" id="cf-fc-export" style="font-size:10px;padding:4px 8px">Export TSV (Anki)</button><button class="cf-action-btn" id="cf-fc-copy" style="font-size:10px;padding:4px 8px">Copy All</button></div>`;
                        tabHTML += `</div>`;
                    }

                    // ── Mind Map ──
                    tabHTML += `<div class="cf-section-label">Mind Map</div>`;
                    tabHTML += `<button class="cf-action-btn" id="cf-mindmap-gen" style="margin-bottom:8px" ${this._mindMapLoading ? 'disabled' : ''} ${providerReady ? '' : 'disabled'}>${this._mindMapLoading ? 'Generating...' : (this._mindMapData ? 'Regenerate Mind Map' : 'Generate Mind Map')}</button>`;
                    if (this._mindMapData) {
                        // Render as collapsible outline
                        let outlineHTML = '<div class="cf-mindmap-outline">';
                        const mmLines = this._mindMapData.split('\n');
                        mmLines.forEach(line => {
                            const t = line.trim();
                            if (!t) return;
                            if (t.startsWith('# ')) outlineHTML += `<div class="cf-mm-root">${this._esc(t.replace(/^#\s*/, ''))}</div>`;
                            else if (t.startsWith('## ')) outlineHTML += `<div class="cf-mm-section">${this._esc(t.replace(/^##\s*/, ''))}</div>`;
                            else if (t.match(/^\s{4,}-/)) outlineHTML += `<div class="cf-mm-sub">${this._esc(t.replace(/^\s*-\s*/, ''))}</div>`;
                            else if (t.startsWith('-') || t.startsWith('  -')) outlineHTML += `<div class="cf-mm-point">${this._esc(t.replace(/^\s*-\s*/, ''))}</div>`;
                            else outlineHTML += `<div class="cf-mm-point">${this._esc(t)}</div>`;
                        });
                        outlineHTML += '</div>';
                        tabHTML += outlineHTML;
                        tabHTML += `<div style="display:flex;gap:6px;margin-top:6px"><button class="cf-action-btn" id="cf-mm-copy" style="font-size:10px;padding:4px 8px">Copy Outline</button><button class="cf-action-btn" id="cf-mm-mermaid" style="font-size:10px;padding:4px 8px">Copy Mermaid</button></div>`;
                    }
                } else if (this._activeTab === 'notes') {
                    const notes = videoId ? this._getNotes(videoId) : [];
                    tabHTML = `<div class="cf-section-label">Add Note at Current Time</div>`;
                    tabHTML += `<div class="cf-note-row"><input class="cf-input cf-note-input" id="cf-note-input" type="text" placeholder="Type a note..." spellcheck="false" /><button class="cf-note-add-btn" id="cf-note-add">+</button></div>`;
                    if (notes.length) {
                        tabHTML += `<div class="cf-section-label">Notes (${notes.length})</div><ul class="cf-chapter-list">`;
                        notes.forEach((n, i) => {
                            tabHTML += `<li class="cf-chapter-item cf-note-item" data-cf-seek="${n.time}"><span class="cf-chapter-time">${this._formatTime(n.time)}</span><span class="cf-chapter-title">${this._esc(n.text)}</span><span class="cf-note-del" data-cf-note-del="${i}" title="Delete">&times;</span></li>`;
                        });
                        tabHTML += `</ul>`;
                        tabHTML += `<div style="display:flex;gap:6px;margin-top:8px"><button class="cf-action-btn" id="cf-notes-copy">Copy All</button><button class="cf-action-btn" id="cf-notes-export">Export TXT</button></div>`;
                    } else {
                        tabHTML += `<div class="cf-empty" style="padding:16px"><div style="color:rgba(255,255,255,0.2);font-size:11px">No notes yet. Pause and add a note while watching.</div></div>`;
                    }
                } else if (this._activeTab === 'settings') {
                    const providerOptions = Object.entries(this._CF_PROVIDERS).map(([k, v]) => `<option value="${k}" ${s.cfLlmProvider === k ? 'selected' : ''}>${v.name}</option>`).join('');
                    const currentProvider = this._CF_PROVIDERS[s.cfLlmProvider || 'builtin'] || this._CF_PROVIDERS.builtin;
                    const showApiFields = s.cfLlmProvider && s.cfLlmProvider !== 'builtin' && s.cfLlmProvider !== 'ollama';
                    const showKeyField = currentProvider.needsKey || s.cfLlmProvider === 'custom';
                    const showEndpointField = s.cfLlmProvider === 'custom';
                    const showOllamaManager = s.cfLlmProvider === 'ollama';
                    
                    // Build Ollama model manager HTML
                    let ollamaHTML = '';
                    if (showOllamaManager) {
                        const recModels = Object.entries(this._CF_RECOMMENDED_MODELS).map(([name, info]) =>
                            `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
                                <div style="flex:1;min-width:0">
                                    <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7)">${name} <span style="font-size:9px;color:rgba(255,255,255,0.25)">${info.size}</span></div>
                                    <div style="font-size:9px;color:rgba(255,255,255,0.3)">${info.desc}</div>
                                </div>
                                <button class="cf-action-btn cf-ollama-pull" data-cf-model="${name}" style="flex-shrink:0;padding:4px 10px;font-size:10px;margin-left:8px">Pull</button>
                            </div>`
                        ).join('');
                        ollamaHTML = `
                            <div class="cf-section-label">Ollama Model Manager</div>
                            <div class="cf-settings-row"><span class="cf-settings-label">Status</span><button class="cf-action-btn" id="cf-ollama-check" style="padding:4px 12px;font-size:10px">Check Ollama</button></div>
                            <div id="cf-ollama-status" style="font-size:10px;color:rgba(255,255,255,0.3);margin:-2px 0 4px;padding-left:2px"></div>
                            <div class="cf-settings-row"><span class="cf-settings-label">Active Model</span><select class="cf-select" id="cf-ollama-model-select"><option value="${s.cfOllamaModel || 'qwen3:32b'}">${s.cfOllamaModel || 'qwen3:32b'} (current)</option></select></div>
                            <div style="font-size:9px;color:rgba(255,255,255,0.12);margin:-2px 0 8px;padding-left:2px">Click "Check Ollama" to refresh installed models</div>
                            <div id="cf-ollama-installed" style="margin-bottom:8px"></div>
                            <div style="font-size:9px;color:rgba(124,58,237,0.5);margin-bottom:6px;font-weight:600;letter-spacing:0.5px">RECOMMENDED MODEL</div>
                            ${recModels}
                            <div style="font-size:9px;color:rgba(255,255,255,0.15);margin-top:8px;line-height:1.4">Install Ollama from <span style="color:rgba(124,58,237,0.6)">ollama.com</span> then pull the model above or run: <span style="font-family:monospace;color:rgba(124,58,237,0.5)">ollama pull qwen3:32b</span></div>
                        `;
                    }
                    
                    tabHTML = `
                        <div class="cf-section-label">AI Provider</div>
                        <div class="cf-settings-row"><span class="cf-settings-label">Provider</span><select class="cf-select" id="cf-provider-select">${providerOptions}</select></div>
                        ${showApiFields ? `
                            <div class="cf-settings-row"><span class="cf-settings-label">Model</span><input class="cf-input" id="cf-model-input" type="text" value="${s.cfLlmModel || currentProvider.defaultModel || ''}" placeholder="${currentProvider.defaultModel || 'model-name'}" spellcheck="false" /></div>
                            ${showKeyField ? `<div class="cf-settings-row"><span class="cf-settings-label">API Key</span><input class="cf-input" id="cf-apikey-input" type="password" value="${s.cfLlmApiKey || ''}" placeholder="${currentProvider.needsKey ? 'Required' : 'Optional'}" spellcheck="false" /></div>` : ''}
                            ${showEndpointField ? `<div class="cf-settings-row"><span class="cf-settings-label">Endpoint</span><input class="cf-input" id="cf-endpoint-input" type="text" value="${s.cfLlmEndpoint || ''}" placeholder="https://api.example.com/v1/chat/completions" spellcheck="false" /></div>` : ''}
                        ` : (!showOllamaManager ? '<div style="font-size:10px;color:rgba(255,255,255,0.15);margin:-2px 0 8px;padding-left:2px">Analyzes transcript patterns locally — NLP engine with TF-IDF topic segmentation.</div>' : '')}
                        ${ollamaHTML}
                        <div class="cf-section-label">Cache</div>
                        <div class="cf-settings-row"><span class="cf-settings-label">Cached</span><span style="font-size:12px;color:rgba(255,255,255,0.4)">${this._countCache()} chapters / ${this._countTranscriptCache()} transcripts</span></div>
                        <button class="cf-clear-btn" id="cf-clear-cache">Clear All Cache</button>
                        <div class="cf-section-label">Prompt Library</div>
                        <div style="font-size:10px;color:rgba(255,255,255,0.2);margin-bottom:6px">Save custom system prompts for summary generation. Loaded prompt overrides the style preset.</div>
                        <div style="display:flex;gap:6px;margin-bottom:6px"><input class="cf-input" id="cf-prompt-name" type="text" placeholder="Prompt name..." spellcheck="false" style="flex:1;max-width:none" /><button class="cf-action-btn" id="cf-prompt-save" style="flex:0 0 auto;padding:5px 10px;font-size:10px">Save Current</button></div>
                        ${(() => { const prompts = this._getSavedPrompts(); if (!prompts.length) return '<div style="font-size:10px;color:rgba(255,255,255,0.12);padding:4px">No saved prompts yet.</div>'; return '<div class="cf-prompt-list">' + prompts.map((p, i) => `<div class="cf-prompt-item"><span class="cf-prompt-name" data-cf-load-prompt="${i}" title="Click to load">${this._esc(p.name)}</span><span class="cf-prompt-del" data-cf-del-prompt="${i}" title="Delete">&times;</span></div>`).join('') + '</div>'; })()}
                        ${s.cfCustomSummaryPrompt ? '<div style="margin-top:4px"><button class="cf-action-btn" id="cf-prompt-clear" style="font-size:10px;padding:4px 8px;border-color:rgba(239,68,68,0.2);color:rgba(239,68,68,0.6)">Clear Active Prompt</button></div>' : ''}
                        <div style="font-size:9px;color:rgba(255,255,255,0.15);margin-top:12px;line-height:1.4;text-align:center">All other ChapterForge settings are in the main YTKit settings panel under the ChapterForge group.</div>
                    `;
                }
    
                TrustedHTML.setHTML(this._panelEl, `
                    <div class="cf-panel-header"><div><span class="cf-panel-title">ChapterForge</span><span class="cf-panel-version">v25.0</span></div><button class="cf-panel-close" id="cf-close">&times;</button></div>
                    <div class="cf-tab-bar"><div class="cf-tab ${this._activeTab === 'chapters' ? 'active' : ''}" data-cf-tab="chapters">Chapters</div><div class="cf-tab ${this._activeTab === 'tools' ? 'active' : ''}" data-cf-tab="tools">Tools</div><div class="cf-tab ${this._activeTab === 'ai' ? 'active' : ''}" data-cf-tab="ai">AI</div><div class="cf-tab ${this._activeTab === 'analysis' ? 'active' : ''}" data-cf-tab="analysis">Analysis</div><div class="cf-tab ${this._activeTab === 'notes' ? 'active' : ''}" data-cf-tab="notes">Notes</div><div class="cf-tab ${this._activeTab === 'settings' ? 'active' : ''}" data-cf-tab="settings">Settings</div></div>
                    <div class="cf-panel-body">
                        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><button class="cf-generate-btn" id="cf-generate" style="margin-bottom:0;flex:1" ${this._isGenerating ? 'disabled' : ''}>${this._isGenerating ? 'Generating...' : (hasData ? 'Regenerate Chapters' : 'Generate Chapters')}</button><button class="cf-action-btn" id="cf-seo-toggle" style="flex:0 0 auto;padding:7px 10px;font-size:10px;letter-spacing:0.3px;${(s.cfChapterMode === 'seo') ? 'background:rgba(16,185,129,0.12);border-color:rgba(16,185,129,0.3);color:rgba(16,185,129,0.8)' : ''}" title="SEO-optimized chapter titles with keyword-rich language">SEO</button></div>
                        <div class="cf-status-bar" id="cf-status-bar" style="display:${this._isGenerating ? 'block' : 'none'}"><div class="cf-status-fill" id="cf-status-fill"></div><span class="cf-status-text" id="cf-status-text"></span></div>
                        ${this._isLiveVideo() ? `<div style="display:flex;gap:6px;margin:-6px 0 12px"><button class="cf-action-btn cf-live-btn" id="cf-live-track" title="Track chapters for live stream">${this._liveIntervalId ? 'Stop Live Tracking' : 'Track Live Chapters'}</button></div>` : ''}
                        ${tabHTML}
                    </div>
                `);
    
                // ── Core bindings ──
                const self = this;
                this._panelEl.querySelector('#cf-close')?.addEventListener('click', () => self._togglePanel());
                this._panelEl.querySelector('#cf-generate')?.addEventListener('click', () => self._handleGenerate());
                this._panelEl.querySelector('#cf-seo-toggle')?.addEventListener('click', () => { appState.settings.cfChapterMode = (appState.settings.cfChapterMode === 'seo') ? 'standard' : 'seo'; settingsManager.save(appState.settings); self._renderPanel(); });
                this._panelEl.querySelector('#cf-dl-transcript')?.addEventListener('click', () => self._downloadTranscript());
                this._panelEl.querySelector('#cf-live-track')?.addEventListener('click', () => { if (self._liveIntervalId) { self._stopLiveTracking(); } else { self._startLiveTracking(); } self._renderPanel(); });
                this._panelEl.querySelectorAll('.cf-tab').forEach(tab => { tab.addEventListener('click', (e) => { e.stopPropagation(); self._activeTab = tab.dataset.cfTab; self._renderPanel(); }); });
                this._panelEl.querySelectorAll('[data-cf-seek]').forEach(el => { el.addEventListener('click', () => self._seekTo(parseFloat(el.dataset.cfSeek))); });
    
                this._panelEl.querySelectorAll('[data-cf-clip]').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const start = parseFloat(el.dataset.cfClip);
                        const end = el.dataset.cfClipEnd ? parseFloat(el.dataset.cfClipEnd) : null;
                        self._copyClipLink(start, end);
                        el.textContent = '\u2713'; setTimeout(() => el.textContent = '\uD83D\uDD17', 1200);
                    });
                });
    
                const searchInput = this._panelEl.querySelector('#cf-search-input');
                if (searchInput) {
                    searchInput.addEventListener('input', () => { self._searchQuery = searchInput.value; self._searchResults = self._searchTranscript(searchInput.value); const countEl = self._panelEl.querySelector('#cf-search-count'); if (countEl) countEl.textContent = self._searchResults?.length ? self._searchResults.length + ' hits' : ''; });
                    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { self._renderPanel(); setTimeout(() => { const el = self._panelEl.querySelector('#cf-search-input'); if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, 50); } });
                }
                const globalSearch = this._panelEl.querySelector('#cf-global-search');
                if (globalSearch) {
                    globalSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { self._globalSearchQuery = globalSearch.value; self._globalSearchResults = self._searchAllTranscripts(globalSearch.value); self._renderPanel(); setTimeout(() => { const el = self._panelEl.querySelector('#cf-global-search'); if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }, 50); } });
                }
                this._panelEl.querySelector('#cf-summary-btn')?.addEventListener('click', async () => { try { await self._generateSummary(); } catch(e) { self._warn('Panel summary error:', e); showToast('Summary failed', '#ef4444'); } });
                this._panelEl.querySelector('#cf-summary-style')?.addEventListener('change', (e) => { appState.settings.cfSummaryMode = e.target.value; settingsManager.save(appState.settings); });
                this._panelEl.querySelector('#cf-summary-length')?.addEventListener('change', (e) => { appState.settings.cfSummaryLength = e.target.value; settingsManager.save(appState.settings); });
                this._panelEl.querySelector('#cf-copy-summary')?.addEventListener('click', () => { navigator.clipboard.writeText(self._lastSummary || ''); showToast('Summary copied', '#10b981'); });
                this._panelEl.querySelector('#cf-export-blog')?.addEventListener('click', () => self._exportBlogMarkdown());
                this._panelEl.querySelectorAll('.cf-summary-box .cf-bubble-ts').forEach(ts => {
                    ts.addEventListener('click', (e) => { e.preventDefault(); const s = parseInt(ts.dataset.cfSeek, 10); if (!isNaN(s)) { const v = document.querySelector('video.html5-main-video'); if (v) v.currentTime = s; } });
                });
                this._panelEl.querySelector('#cf-export-yt')?.addEventListener('click', () => { self._exportChaptersYouTube(); });
                this._panelEl.querySelector('#cf-export-json')?.addEventListener('click', () => self._exportChaptersJSON());
                // OpenCut-inspired export bindings
                this._panelEl.querySelector('#cf-export-srt')?.addEventListener('click', () => self._exportSRT());
                this._panelEl.querySelector('#cf-export-vtt')?.addEventListener('click', () => self._exportVTT());
                this._panelEl.querySelector('#cf-export-ch-srt')?.addEventListener('click', () => self._exportChaptersSRT());
                // SponsorBlock import
                this._panelEl.querySelector('#cf-sb-import')?.addEventListener('click', () => self._importSBChapters());
                this._panelEl.querySelector('#cf-sb-apply')?.addEventListener('click', () => self._applySBChapters());
                // AI Chat
                const chatInput = this._panelEl.querySelector('#cf-chat-input');
                const sendChat = () => { if (chatInput?.value.trim()) { self._sendChatMessage(chatInput.value); } };
                this._panelEl.querySelector('#cf-chat-send')?.addEventListener('click', sendChat);
                if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
                this._panelEl.querySelector('#cf-chat-clear')?.addEventListener('click', () => { self._chatHistory = []; self._renderPanel(); });
                // Flashcards
                this._panelEl.querySelector('#cf-flashcard-gen')?.addEventListener('click', () => self._generateFlashcards());
                this._panelEl.querySelector('#cf-flashcard')?.addEventListener('click', () => { self._flashcardFlipped = !self._flashcardFlipped; self._renderPanel(); });
                this._panelEl.querySelector('#cf-fc-prev')?.addEventListener('click', () => { if (self._flashcardIdx > 0) { self._flashcardIdx--; self._flashcardFlipped = false; self._renderPanel(); } });
                this._panelEl.querySelector('#cf-fc-next')?.addEventListener('click', () => { if (self._flashcardIdx < (self._flashcards?.length || 0) - 1) { self._flashcardIdx++; self._flashcardFlipped = false; self._renderPanel(); } });
                this._panelEl.querySelector('#cf-fc-export')?.addEventListener('click', () => self._exportFlashcardsAnki());
                this._panelEl.querySelector('#cf-fc-copy')?.addEventListener('click', () => {
                    if (!self._flashcards?.length) return;
                    const text = self._flashcards.map((c, i) => `Q${i+1}: ${c.q}\nA${i+1}: ${c.a}`).join('\n\n');
                    navigator.clipboard.writeText(text);
                    showToast('Flashcards copied', '#10b981');
                });
                // Mind Map
                this._panelEl.querySelector('#cf-mindmap-gen')?.addEventListener('click', () => self._generateMindMap());
                this._panelEl.querySelector('#cf-mm-copy')?.addEventListener('click', () => { navigator.clipboard.writeText(self._mindMapData || ''); showToast('Outline copied', '#10b981'); });
                this._panelEl.querySelector('#cf-mm-mermaid')?.addEventListener('click', () => self._exportMindMapMermaid());
                // AutoSkip mode selector
                this._panelEl.querySelector('#cf-autoskip-mode')?.addEventListener('change', (e) => {
                    const wasActive = self._autoSkipActive;
                    if (wasActive) self._stopAutoSkip();
                    appState.settings.cfAutoSkipMode = e.target.value;
                    settingsManager.save(appState.settings);
                    self._renderPanel();
                });
                // AutoSkip start/stop button
                this._panelEl.querySelector('#cf-autoskip-toggle')?.addEventListener('click', () => {
                    if (self._autoSkipActive) { self._stopAutoSkip(); } else { self._startAutoSkip(); }
                    self._renderPanel();
                });
                // Translation
                this._panelEl.querySelector('#cf-translate-lang')?.addEventListener('change', (e) => {
                    appState.settings.cfTranslateLang = e.target.value;
                    settingsManager.save(appState.settings);
                    const btn = self._panelEl.querySelector('#cf-translate-btn');
                    if (btn) btn.disabled = !e.target.value;
                });
                this._panelEl.querySelector('#cf-translate-btn')?.addEventListener('click', async () => {
                    const lang = appState.settings.cfTranslateLang;
                    if (!lang) return;
                    const btn = self._panelEl.querySelector('#cf-translate-btn');
                    if (btn) { btn.disabled = true; btn.textContent = 'Translating...'; }
                    await self._translateChaptersAndSummary(lang);
                    self._renderPanel();
                });
                this._panelEl.querySelector('#cf-toggle-speed')?.addEventListener('click', () => { self._toggleSpeedControl(); self._renderPanel(); });
                this._panelEl.querySelector('#cf-intro-speed')?.addEventListener('change', (e) => { self._speedSettings.introSpeed = parseFloat(e.target.value); });
                this._panelEl.querySelector('#cf-outro-speed')?.addEventListener('change', (e) => { self._speedSettings.outroSpeed = parseFloat(e.target.value); });
                this._panelEl.querySelectorAll('.cf-skip-toggle').forEach(el => { el.addEventListener('click', () => { const idx = parseInt(el.dataset.cfSkip); self._speedSettings.skipChapters[idx] = !self._speedSettings.skipChapters[idx]; self._renderPanel(); }); });
    
                const noteInput = this._panelEl.querySelector('#cf-note-input');
                const addNote = () => {
                    if (!noteInput?.value.trim() || !videoId) return;
                    const video = document.querySelector('video.html5-main-video, video');
                    const time = video ? video.currentTime : 0;
                    self._addNote(videoId, time, noteInput.value.trim());
                    self._renderPanel();
                };
                this._panelEl.querySelector('#cf-note-add')?.addEventListener('click', addNote);
                if (noteInput) noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });
                this._panelEl.querySelectorAll('[data-cf-note-del]').forEach(el => {
                    el.addEventListener('click', (e) => { e.stopPropagation(); self._removeNote(videoId, parseInt(el.dataset.cfNoteDel)); self._renderPanel(); });
                });
                this._panelEl.querySelector('#cf-notes-copy')?.addEventListener('click', () => {
                    const notes = self._getNotes(videoId);
                    const lines = notes.map(n => `[${self._formatTime(n.time)}] ${n.text}`);
                    navigator.clipboard.writeText(lines.join('\n'));
                });
                this._panelEl.querySelector('#cf-notes-export')?.addEventListener('click', () => {
                    const notes = self._getNotes(videoId);
                    const title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() || videoId;
                    const lines = [`Notes for: ${title}\n`].concat(notes.map(n => `[${self._formatTime(n.time)}] ${n.text}`));
                    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `notes_${videoId}.txt`;
                    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
                });
    
                // ── Settings bindings ──
                const bindSelect = (id, key, transform) => { this._panelEl.querySelector(id)?.addEventListener('change', (e) => { appState.settings[key] = transform ? transform(e.target.value) : e.target.value; settingsManager.save(appState.settings); self._renderPanel(); }); };
                const bindToggle = (id, key, afterFn) => { this._panelEl.querySelector(id)?.addEventListener('click', () => { appState.settings[key] = !appState.settings[key]; settingsManager.save(appState.settings); self._renderPanel(); afterFn?.(); }); };
                const bindInput = (id, key) => { const el = this._panelEl.querySelector(id); if (el) { el.addEventListener('input', () => { appState.settings[key] = el.value; settingsManager.save(appState.settings); }); el.addEventListener('blur', () => self._renderPanel()); } };
    
                this._panelEl.querySelector('#cf-provider-select')?.addEventListener('change', (e) => {
                    const prov = e.target.value;
                    appState.settings.cfLlmProvider = prov;
                    const info = self._CF_PROVIDERS[prov];
                    if (prov === 'ollama') {
                        if (!appState.settings.cfOllamaModel) appState.settings.cfOllamaModel = info.defaultModel;
                    } else if (prov !== 'custom' && info?.defaultModel) {
                        appState.settings.cfLlmModel = info.defaultModel;
                    }
                    settingsManager.save(appState.settings); self._renderPanel();
                });
                bindInput('#cf-model-input', 'cfLlmModel');
                bindInput('#cf-apikey-input', 'cfLlmApiKey');
                bindInput('#cf-endpoint-input', 'cfLlmEndpoint');
    
                this._panelEl.querySelector('#cf-clear-cache')?.addEventListener('click', () => { self._clearCache(); const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(self._CF_TRANSCRIPT_PREFIX) || k.startsWith(self._CF_NOTES_PREFIX)) keys.push(k); } keys.forEach(k => localStorage.removeItem(k)); self._chapterData = null; self._renderPanel(); self._renderProgressBarOverlay(); });

                // Prompt Library
                this._panelEl.querySelector('#cf-prompt-save')?.addEventListener('click', () => {
                    const nameEl = self._panelEl?.querySelector('#cf-prompt-name');
                    const name = nameEl?.value?.trim();
                    if (!name) { showToast('Enter a prompt name', '#f59e0b'); return; }
                    const currentPrompt = appState.settings.cfCustomSummaryPrompt;
                    if (!currentPrompt) { showToast('No custom prompt is active. Set one in the main YTKit settings first.', '#f59e0b'); return; }
                    self._savePrompt(name, currentPrompt);
                    self._renderPanel();
                });
                this._panelEl.querySelector('#cf-prompt-clear')?.addEventListener('click', () => { appState.settings.cfCustomSummaryPrompt = ''; settingsManager.save(appState.settings); self._renderPanel(); showToast('Custom prompt cleared', '#10b981'); });
                this._panelEl.querySelectorAll('[data-cf-load-prompt]').forEach(el => {
                    el.addEventListener('click', () => { const prompts = self._getSavedPrompts(); const idx = parseInt(el.dataset.cfLoadPrompt); if (prompts[idx]) { self._loadPrompt(prompts[idx].name); self._renderPanel(); } });
                });
                this._panelEl.querySelectorAll('[data-cf-del-prompt]').forEach(el => {
                    el.addEventListener('click', (e) => { e.stopPropagation(); const prompts = self._getSavedPrompts(); const idx = parseInt(el.dataset.cfDelPrompt); if (prompts[idx]) { self._deletePrompt(prompts[idx].name); self._renderPanel(); } });
                });

                // ── Ollama manager bindings ──
                // Auto-check Ollama status when panel opens
                if (self._panelEl?.querySelector('#cf-ollama-check')) {
                    setTimeout(() => { self._panelEl?.querySelector('#cf-ollama-check')?.click(); }, 100);
                }
                this._panelEl.querySelector('#cf-ollama-check')?.addEventListener('click', async () => {
                    const statusEl = self._panelEl?.querySelector('#cf-ollama-status');
                    const installedEl = self._panelEl?.querySelector('#cf-ollama-installed');
                    if (statusEl) TrustedHTML.setHTML(statusEl, '<span style="color:#a78bfa">Checking...</span>');
                    const result = await self._ollamaCheck();
                    if (!statusEl) return;
                    if (result.running) {
                        TrustedHTML.setHTML(statusEl, `<span style="color:#10b981">Connected</span> — ${result.models.length} model(s) installed`);
                        // Populate active model dropdown
                        const modelSelect = self._panelEl?.querySelector('#cf-ollama-model-select');
                        if (modelSelect && result.models.length) {
                            const currentModel = appState.settings.cfOllamaModel || 'qwen3:32b';
                            const optionsHTML = result.models.map(m => {
                                const clean = m.replace(':latest', '');
                                return `<option value="${clean}" ${clean === currentModel ? 'selected' : ''}>${clean}</option>`;
                            }).join('');
                            TrustedHTML.setHTML(modelSelect, optionsHTML);
                            modelSelect.addEventListener('change', () => {
                                appState.settings.cfOllamaModel = modelSelect.value;
                                settingsManager.save(appState.settings);
                            });
                        }
                        if (installedEl && result.models.length) {
                            const modelHTML = result.models.map(m => {
                                const isCurrent = (appState.settings.cfOllamaModel || '').includes(m.replace(':latest',''));
                                return `<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0">
                                    <span style="font-size:11px;color:rgba(255,255,255,${isCurrent ? '0.9' : '0.5'});font-family:monospace">${m}${isCurrent ? ' <span style="color:#10b981;font-size:9px">active</span>' : ''}</span>
                                    <button class="cf-action-btn cf-ollama-use" data-cf-model="${m.replace(':latest','')}" style="padding:2px 8px;font-size:9px">Use</button>
                                </div>`;
                            }).join('');
                            TrustedHTML.setHTML(installedEl, `<div style="font-size:9px;color:rgba(124,58,237,0.5);margin:6px 0 4px;font-weight:600;letter-spacing:0.5px">INSTALLED MODELS</div>${modelHTML}`);
                            installedEl.querySelectorAll('.cf-ollama-use').forEach(btn => {
                                btn.addEventListener('click', () => {
                                    appState.settings.cfOllamaModel = btn.dataset.cfModel;
                                    settingsManager.save(appState.settings);
                                    self._renderPanel();
                                });
                            });
                            // Update pull buttons to show "Installed" for models already present
                            const installedNames = result.models.map(m => m.replace(':latest',''));
                            self._panelEl?.querySelectorAll('.cf-ollama-pull').forEach(btn => {
                                if (installedNames.some(n => n === btn.dataset.cfModel || btn.dataset.cfModel.startsWith(n))) {
                                    btn.textContent = 'Installed';
                                    btn.style.opacity = '0.4';
                                }
                            });
                        }
                    } else {
                        TrustedHTML.setHTML(statusEl, '<span style="color:#ef4444">Not running</span> — Start Ollama or install from ollama.com');
                    }
                });
                this._panelEl?.querySelectorAll('.cf-ollama-pull').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const model = btn.dataset.cfModel;
                        btn.disabled = true;
                        btn.textContent = 'Pulling...';
                        btn.classList.add('cf-loading');
                        try {
                            await self._ollamaPull(model, (msg, pct) => {
                                if (pct >= 0) btn.textContent = pct < 100 ? `${pct}%` : 'Done';
                                else btn.textContent = 'Failed';
                            });
                            btn.textContent = 'Installed';
                            btn.style.opacity = '0.4';
                            // Auto-set as active model
                            appState.settings.cfOllamaModel = model;
                            settingsManager.save(appState.settings);
                        } catch(e) {
                            btn.textContent = 'Failed';
                            btn.disabled = false;
                            btn.classList.remove('cf-loading');
                        }
                    });
                });
            },
    
            _updateStatus(text, state, pct) {
                // Update player button mini-progress
                let indicator = document.getElementById('cf-mini-progress');
                const btn = document.getElementById('cf-player-btn');
                if (!indicator && btn) {
                    indicator = document.createElement('div');
                    indicator.id = 'cf-mini-progress';
                    indicator.style.cssText = 'position:absolute;bottom:-4px;left:0;width:100%;height:3px;border-radius:2px;overflow:hidden;pointer-events:none;';
                    btn.style.position = 'relative';
                    btn.appendChild(indicator);
                }
                if (indicator) {
                    if (state === 'loading') {
                        indicator.style.display = 'block';
                        const fill = typeof pct === 'number' ? pct : 30;
                        TrustedHTML.setHTML(indicator, `<div style="width:${fill}%;height:100%;background:#a78bfa;border-radius:2px;transition:width 0.4s"></div>`);
                        btn?.classList.add('cf-btn-active');
                    } else {
                        indicator.style.display = 'none';
                        btn?.classList.remove('cf-btn-active');
                    }
                }
                // Update panel status bar
                const statusBar = document.getElementById('cf-status-bar');
                const statusFill = document.getElementById('cf-status-fill');
                const statusText = document.getElementById('cf-status-text');
                if (statusBar) {
                    statusBar.style.display = state === 'loading' ? 'block' : 'none';
                }
                if (statusFill && typeof pct === 'number') {
                    statusFill.style.width = `${pct}%`;
                }
                if (statusText) statusText.textContent = text || '';
                // Update generate button with progress %
                const genBtn = document.getElementById('cf-generate');
                if (genBtn && state === 'loading' && typeof pct === 'number') {
                    genBtn.textContent = `Generating... ${pct}%`;
                }
            },
    
            async _handleGenerate() {
                const videoId = this._getVideoId();
                if (!videoId) return;
                const btn = document.getElementById('cf-generate');
                if (btn) { btn.disabled = true; btn.textContent = 'Generating... 0%'; btn.classList.add('cf-loading'); }
                const statusBar = document.getElementById('cf-status-bar');
                if (statusBar) statusBar.style.display = 'block';
                const data = await this._generateChapters(videoId, (t, s, p) => this._updateStatus(t, s, p));
                if (data) {
                    this._chapterData = data;
                    this._currentDuration = this._getVideoDuration();
                    this._runAnalysis(this._lastTranscriptSegments);
                    // Auto-start AutoSkip if a mode is configured
                    if (appState.settings.cfAutoSkipMode && appState.settings.cfAutoSkipMode !== 'off') {
                        this._startAutoSkip();
                    }
                    this._activeTab = 'chapters'; // auto-switch to show results
                    this._renderPanel();
                    this._renderProgressBarOverlay();
                }
                this._updateStatus(data ? 'Done' : 'Failed', data ? 'ready' : 'error', data ? 100 : 0);
                if (btn) { btn.disabled = false; btn.textContent = data ? 'Regenerate Chapters' : 'Generate Chapters'; btn.classList.remove('cf-loading'); }
            },
    
            // ═══ UI: Player Button ═══
            _injectPlayerButton() {
                if (document.getElementById('cf-player-btn')) return;
                const controls = document.querySelector('.ytp-right-controls');
                if (!controls) return;
                const btn = document.createElement('button');
                btn.id = 'cf-player-btn'; btn.className = 'ytp-button cf-btn'; btn.title = 'ChapterForge';
                TrustedHTML.setHTML(btn, `<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`);
                btn.addEventListener('click', () => this._togglePanel());
                controls.insertBefore(btn, controls.firstChild);
            },
    
            // ═══ LIFECYCLE ═══
            _onVideoChange() {
                const videoId = this._getVideoId();
                if (!videoId || videoId === this._currentVideoId) return;
                if (!window.location.pathname.startsWith('/watch')) return;
                this._currentVideoId = videoId;
                this._chapterData = null;
                this._lastTranscriptSegments = null;
                this._lastActiveChapterIdx = -1;
                this._fillerData = null;
                this._pauseData = null;
                this._paceData = null;
                this._keywordsPerChapter = null;
                this._translatedSummary = null;
                this._translatedChapters = null;
                this._lastSummary = null;
                this._chatHistory = [];
                this._flashcards = null;
                this._flashcardIdx = 0;
                this._flashcardFlipped = false;
                this._mindMapData = null;
                this._sbChapters = null;
                this._stopAutoSkip();
                const cached = this._getCachedData(videoId);
                if (cached) this._chapterData = cached;
    
                // Clean HUD on video change
                this._stopChapterTracking();
                this._chapterHUDEl?.remove();
                this._chapterHUDEl = null;
    
                this._waitForPlayer().then(() => {
                    this._currentDuration = this._getVideoDuration();
                    const s = appState.settings;
    
                    if (s.cfMode === 'manual' || s.cfShowPlayerButton) {
                        this._injectPlayerButton();
                    }
                    this._renderProgressBarOverlay();
                    if (this._panelEl?.classList.contains('cf-visible')) this._renderPanel();
    
                    const btn = document.getElementById('cf-player-btn');
                    if (btn) { const badge = btn.querySelector('.cf-badge'); if (this._chapterData && !badge) { const b = document.createElement('span'); b.className = 'cf-badge'; btn.appendChild(b); } else if (!this._chapterData && badge) badge.remove(); }
    
                    if (s.cfMode === 'auto' && !this._chapterData) {
                        const maxDur = (s.cfMaxAutoDuration || 60) * 60;
                        if (this._currentDuration <= maxDur || maxDur >= 599940) {
                            this._handleGenerate();
                        } else {
                            this._log('Auto-skip: video duration', Math.round(this._currentDuration/60), 'min exceeds limit', s.cfMaxAutoDuration, 'min');
                        }
                    }
    
                    if (s.cfMode === 'auto' && this._isLiveVideo() && !this._liveIntervalId) {
                        this._startLiveTracking();
                    }
                });
            },
    
            _waitForPlayer(timeout = 10000) {
                return new Promise((resolve) => {
                    const check = () => { const player = document.getElementById('movie_player'); const video = document.querySelector('video.html5-main-video'); if (player && video && video.duration) return resolve(); if (timeout <= 0) return resolve(); timeout -= 200; setTimeout(check, 200); };
                    check();
                });
            },
    
            // ═══ INIT / DESTROY ═══
    
            init() {
                const css = `
                    .cf-btn { position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;background:transparent;cursor:pointer;border-radius:6px;transition:background 0.2s;color:#fff; }
                    .cf-btn:hover { background:rgba(255,255,255,0.1); }
                    .cf-btn .cf-badge { position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:#7c3aed; }
                    .cf-panel { position:fixed;top:80px;right:20px;width:380px;max-height:calc(100vh - 120px);background:#0f0f14;border:1px solid rgba(124,58,237,0.3);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.7),0 0 40px rgba(124,58,237,0.08);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e0e0e8;overflow:hidden;display:none;animation:cfSlideIn 0.25s cubic-bezier(0.16,1,0.3,1); }
                    @keyframes cfSlideIn { from{opacity:0;transform:translateY(-10px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
                    .cf-panel.cf-visible { display:flex;flex-direction:column; }
                    .cf-panel-header { display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid rgba(255,255,255,0.06);background:linear-gradient(180deg,rgba(124,58,237,0.08) 0%,transparent 100%); }
                    .cf-panel-title { font-size:14px;font-weight:700;background:linear-gradient(135deg,#a78bfa,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:0.5px; }
                    .cf-panel-version { font-size:10px;color:rgba(255,255,255,0.25);margin-left:8px; }
                    .cf-panel-close { width:28px;height:28px;border:none;background:transparent;color:rgba(255,255,255,0.4);cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all 0.15s; }
                    .cf-panel-close:hover { background:rgba(255,255,255,0.08);color:#fff; }
                    .cf-panel-body { flex:1;overflow-y:auto;padding:12px 16px 16px;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.3) transparent; }
                    .cf-panel-body::-webkit-scrollbar { width:5px; } .cf-panel-body::-webkit-scrollbar-thumb { background:rgba(124,58,237,0.3);border-radius:10px; }
                    @keyframes cfPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
                    .cf-generate-btn { width:100%;padding:10px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;transition:all 0.2s;margin-bottom:12px; }
                    .cf-generate-btn:hover:not(:disabled) { background:linear-gradient(135deg,#8b5cf6,#7c3aed);box-shadow:0 4px 16px rgba(124,58,237,0.3); } .cf-generate-btn:disabled { opacity:0.4;cursor:not-allowed; }
                    .cf-generate-btn.cf-loading { position:relative;overflow:hidden; } .cf-generate-btn.cf-loading::after { content:'';position:absolute;bottom:0;left:0;height:2px;background:linear-gradient(90deg,transparent,#e0e0e8,transparent);animation:cfSlide 1.2s infinite; }
                    .cf-action-btn { flex:1;padding:7px 8px;border:1px solid rgba(124,58,237,0.25);border-radius:8px;cursor:pointer;font-size:11px;font-weight:500;background:rgba(124,58,237,0.08);color:rgba(255,255,255,0.6);transition:all 0.15s;font-family:inherit;position:relative;overflow:hidden; } .cf-action-btn:hover { background:rgba(124,58,237,0.15);color:#e0e0e8;border-color:rgba(124,58,237,0.4); } .cf-action-btn:disabled { opacity:0.5;cursor:not-allowed; }
                    .cf-action-btn.cf-loading::after { content:'';position:absolute;bottom:0;left:0;height:2px;background:linear-gradient(90deg,transparent,#a78bfa,transparent);animation:cfSlide 1.2s infinite; }
                    @keyframes cfSlide { 0% { width:0;left:0; } 50% { width:60%;left:20%; } 100% { width:0;left:100%; } }
                    .cf-live-btn { border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:rgba(239,68,68,0.7); } .cf-live-btn:hover { background:rgba(239,68,68,0.15);color:#ef4444; }
                    .cf-chapter-list { list-style:none;padding:0;margin:0; }
                    .cf-chapter-item { display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.15s;margin-bottom:2px; } .cf-chapter-item:hover { background:rgba(255,255,255,0.05); }
                    .cf-chapter-time { font-size:11px;font-weight:600;font-family:'SF Mono','Cascadia Code',monospace;color:#a78bfa;min-width:48px;padding-top:1px;flex-shrink:0; }
                    .cf-chapter-title { font-size:12.5px;color:rgba(255,255,255,0.8);line-height:1.4; }
                    .cf-chapter-dot { width:6px;height:6px;border-radius:50%;margin-top:5px;flex-shrink:0; }
                    .cf-poi-badge { display:inline-block;font-size:9px;font-weight:700;color:#ff6b6b;background:rgba(255,107,107,0.1);padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:middle;letter-spacing:0.5px; }
                    .cf-section-label { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,0.2);margin:14px 0 8px;padding-left:2px; } .cf-section-label:first-child { margin-top:0; }
                    .cf-settings-row { display:flex;align-items:center;justify-content:space-between;padding:8px 0;font-size:12px; }
                    .cf-settings-label { color:rgba(255,255,255,0.6); }
                    .cf-select { background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#e0e0e8;border-radius:6px;padding:5px 8px;font-size:11px;outline:none;cursor:pointer;max-width:180px; } .cf-select:focus { border-color:rgba(124,58,237,0.5); }
                    .cf-input { background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#e0e0e8;border-radius:6px;padding:5px 8px;font-size:11px;outline:none;max-width:180px;width:180px;font-family:inherit; } .cf-input:focus { border-color:rgba(124,58,237,0.5); } .cf-input::placeholder { color:rgba(255,255,255,0.2); }
                    .cf-toggle-track { width:36px;height:20px;border-radius:10px;background:rgba(255,255,255,0.1);cursor:pointer;position:relative;transition:background 0.2s;flex-shrink:0; } .cf-toggle-track.active { background:#7c3aed; }
                    .cf-toggle-knob { width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:transform 0.2s; } .cf-toggle-track.active .cf-toggle-knob { transform:translateX(16px); }
                    .cf-tab-bar { display:flex;gap:0;padding:0 16px;border-bottom:1px solid rgba(255,255,255,0.06); }
                    .cf-tab { padding:8px 10px;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);cursor:pointer;border-bottom:2px solid transparent;transition:all 0.15s;text-transform:uppercase;letter-spacing:0.5px;flex:1;text-align:center; } .cf-tab:hover { color:rgba(255,255,255,0.6); } .cf-tab.active { color:#a78bfa;border-bottom-color:#7c3aed; }
                    .cf-empty { text-align:center;padding:30px 20px;color:rgba(255,255,255,0.25);font-size:12px; }
                    .cf-clear-btn { background:transparent;border:1px solid rgba(239,68,68,0.3);color:rgba(239,68,68,0.7);border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer;transition:all 0.15s;margin-top:8px; } .cf-clear-btn:hover { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.5); }
    
                    /* ═══ PROGRESS BAR: Chapter segments (FIXED z-index layering) ═══ */
                    .cf-bar-overlay { position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:25; }
                    .cf-chapter-markers { position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:24; }
                    .cf-chapter-seg { position:absolute;top:0;height:100%;pointer-events:auto;cursor:pointer;transition:opacity 0.15s; }
                    .cf-chapter-seg::before { content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:var(--cf-seg-color);opacity:var(--cf-seg-opacity,0.35);transition:opacity 0.15s;border-radius:1px; }
                    .cf-chapter-seg:hover::before { opacity:0.55; }
                    .cf-chapter-seg.cf-seg-active::before { opacity:0.5; }
                    .cf-chapter-gap { position:absolute;top:-1px;bottom:-1px;width:3px;transform:translateX(-50%);background:#0f0f14;z-index:1;pointer-events:none;border-radius:1px; }
    
                    /* Chapter name labels — absolutely positioned above progress bar, zero layout impact */
                    .cf-chapter-label-row { position:absolute;bottom:100%;left:0;width:100%;height:0;pointer-events:none;z-index:25;opacity:0;transition:opacity 0.2s; }
                    .ytp-progress-bar:hover .cf-chapter-label-row,
                    .ytp-progress-bar-container:hover .cf-chapter-label-row { opacity:1; }
                    .cf-chapter-label { position:absolute;bottom:4px;height:14px;display:flex;align-items:center;padding:0 3px;font-size:9px;font-weight:600;color:var(--cf-label-fg, #e0e0e8);background:color-mix(in srgb, var(--cf-label-color, #7c3aed) 25%, #0f0f14 75%);border-radius:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;pointer-events:auto;transition:all 0.15s;letter-spacing:0.2px;border:1px solid color-mix(in srgb, var(--cf-label-color, #7c3aed) 20%, transparent);box-sizing:border-box;line-height:1; }
                    .cf-chapter-label:hover { background:color-mix(in srgb, var(--cf-label-color, #7c3aed) 40%, #0f0f14 60%);z-index:2; }
                    .cf-chapter-label.cf-label-active { background:color-mix(in srgb, var(--cf-label-color, #7c3aed) 45%, #0f0f14 55%);border-color:color-mix(in srgb, var(--cf-label-color, #7c3aed) 50%, transparent); }
    
                    /* POI markers */
                    .cf-poi-hitbox { position:absolute;top:50%;width:34px;height:34px;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;z-index:26; }
                    .cf-poi-diamond { position:absolute;top:50%;left:50%;width:10px;height:10px;transform:translate(-50%,-50%) rotate(45deg);border-radius:2px;transition:all 0.2s;box-shadow:0 0 6px rgba(255,107,107,0.4);pointer-events:none; }
                    .cf-poi-hover { transform:translate(-50%,-50%) rotate(45deg) scale(1.6);box-shadow:0 0 12px rgba(255,107,107,0.7),0 0 24px rgba(255,107,107,0.3); }
    
                    /* Tooltips — positioned well above the bar to avoid YouTube overlap */
                    .cf-bar-tooltip { position:absolute;bottom:28px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:8px;font-size:11px;white-space:nowrap;pointer-events:none;z-index:50;opacity:0;transition:opacity 0.15s; }
                    .cf-chapter-tip { background:rgba(15,15,20,0.95);color:#e0e0e8;border:1px solid rgba(124,58,237,0.25);box-shadow:0 4px 16px rgba(0,0,0,0.5);display:flex;gap:8px;align-items:center;backdrop-filter:blur(8px); }
                    .cf-tip-time { font-weight:700;color:#a78bfa;font-size:10px;font-variant-numeric:tabular-nums; }
                    .cf-tip-title { color:#e0e0e8;font-weight:500; }
    
                    .cf-poi-tip { background:linear-gradient(135deg,rgba(30,10,10,0.95),rgba(15,15,20,0.95));color:#fca5a5;border:1px solid rgba(255,107,107,0.35);box-shadow:0 4px 20px rgba(255,107,107,0.15),0 0 40px rgba(255,107,107,0.05);display:flex;gap:6px;align-items:center;animation:cfGlow 2s ease-in-out infinite;backdrop-filter:blur(8px); }
                    .cf-tip-poi-icon { font-size:12px;color:#ff6b6b;filter:drop-shadow(0 0 3px rgba(255,107,107,0.6)); }
                    .cf-tip-label { color:#fca5a5;font-weight:500; }
                    @keyframes cfGlow { 0%,100%{box-shadow:0 4px 20px rgba(255,107,107,0.15)} 50%{box-shadow:0 4px 24px rgba(255,107,107,0.3),0 0 8px rgba(255,107,107,0.1)} }
                    .cf-poi-hitbox .cf-bar-tooltip { bottom:30px; }
    
                    /* Transcript hover preview */
                    .cf-transcript-tip { position:absolute;bottom:38px;background:rgba(10,10,15,0.95);color:rgba(255,255,255,0.8);padding:8px 12px;border-radius:8px;font-size:11px;width:300px;white-space:normal;word-wrap:break-word;pointer-events:none;z-index:30;opacity:0;transition:opacity 0.12s;border:1px solid rgba(124,58,237,0.15);box-shadow:0 4px 16px rgba(0,0,0,0.5);line-height:1.5;backdrop-filter:blur(8px); }
                    .cf-tx-chapter { font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid rgba(124,58,237,0.15);text-transform:uppercase;letter-spacing:0.5px; }
                    .cf-tx-line { font-size:11px;color:rgba(255,255,255,0.85);line-height:1.5;margin:2px 0; }
                    .cf-tx-dim { color:rgba(255,255,255,0.3);font-size:10px; }
                    .cf-tx-ts { font-family:'SF Mono','Cascadia Code',monospace;font-size:9px;color:#a78bfa;opacity:0.6;margin-right:4px; }
    
                    /* ═══ CHAPTER HUD — Floating overlay on video player ═══ */
                    .cf-chapter-hud { position:absolute;display:flex;align-items:center;gap:6px;padding:5px 8px 5px 6px;background:rgba(10,10,15,0.82);border-radius:10px;border:1px solid color-mix(in srgb, var(--cf-hud-accent, #7c3aed) 25%, transparent);backdrop-filter:blur(16px);z-index:60;pointer-events:auto;opacity:0;transition:opacity 0.3s, transform 0.2s;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.5);max-width:70%; }
                    .cf-chapter-hud[data-cf-pos="top-left"] { top:12px;left:12px; }
                    .cf-chapter-hud[data-cf-pos="top-right"] { top:12px;right:12px; }
                    .cf-chapter-hud[data-cf-pos="bottom-left"] { bottom:60px;left:12px; }
                    .cf-chapter-hud[data-cf-pos="bottom-right"] { bottom:60px;right:12px; }
                    .cf-chapter-hud[style*="opacity: 1"] { opacity:1; }
                    .cf-hud-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 6px color-mix(in srgb, var(--cf-hud-accent, #7c3aed) 50%, transparent); }
                    .cf-hud-title { font-size:12px;font-weight:600;color:#e0e0e8;letter-spacing:0.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
                    .cf-hud-counter { font-size:9px;color:rgba(255,255,255,0.25);font-weight:600;flex-shrink:0;letter-spacing:0.5px; }
                    .cf-hud-nav { width:24px;height:24px;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;padding:0;flex-shrink:0; }
                    .cf-hud-nav:hover { background:rgba(255,255,255,0.14);color:#fff; }
                    .cf-hud-nav.cf-hud-disabled { opacity:0.2;pointer-events:none; }
                    /* Hide HUD when controls are hidden (fullscreen idle) */
                    .ytp-autohide .cf-chapter-hud { opacity:0 !important; }
    
                    .cf-btn-active { animation:cfBtnPulse 1.5s infinite; }
                    @keyframes cfBtnPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    
                    .cf-search-row { display:flex;align-items:center;gap:6px;margin-bottom:8px; }
                    .cf-search-input { flex:1; }
                    .cf-search-count { font-size:10px;color:#a78bfa;white-space:nowrap;min-width:40px;text-align:right; }
                    .cf-search-hit { cursor:pointer; } .cf-search-hit:hover { background:rgba(124,58,237,0.12); }
                    .cf-search-text { font-size:11px;color:rgba(255,255,255,0.6); }
                    .cf-global-result { margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.04); }
                    .cf-global-title { font-size:11px;margin-bottom:4px;display:flex;align-items:center;gap:6px; }
                    .cf-video-link { color:#a78bfa;text-decoration:none;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;display:inline-block; } .cf-video-link:hover { text-decoration:underline; }
                    .cf-global-link { display:flex;align-items:flex-start;gap:8px;text-decoration:none;color:inherit;width:100%; } .cf-global-link:hover { color:#e0e0e8; }
                    .cf-match-count { font-size:10px;color:rgba(255,255,255,0.25);flex-shrink:0; }
                    .cf-summary-box { font-size:12px;line-height:1.5;color:rgba(255,255,255,0.65);padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.05);margin-bottom:6px; }
                    .cf-clip-btn { cursor:pointer;font-size:12px;opacity:0;transition:opacity 0.15s;margin-left:auto;flex-shrink:0;padding:0 2px; } .cf-chapter-item:hover .cf-clip-btn { opacity:0.5; } .cf-clip-btn:hover { opacity:1 !important; }
                    .cf-note-row { display:flex;gap:6px;margin-bottom:10px; }
                    .cf-note-input { flex:1; }
                    .cf-note-add-btn { width:32px;height:32px;border:none;background:rgba(124,58,237,0.3);color:#a78bfa;border-radius:8px;cursor:pointer;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;transition:background 0.2s; } .cf-note-add-btn:hover { background:rgba(124,58,237,0.5); }
                    .cf-note-item { position:relative; }
                    .cf-note-del { position:absolute;right:4px;top:50%;transform:translateY(-50%);cursor:pointer;color:rgba(255,255,255,0.15);font-size:14px;padding:2px 4px;border-radius:4px;opacity:0;transition:opacity 0.15s; } .cf-note-item:hover .cf-note-del { opacity:1; } .cf-note-del:hover { color:#ef4444;background:rgba(239,68,68,0.1); }
                    #cf-summary-bubble { position:absolute;top:12px;right:12px;bottom:60px;width:380px;max-width:40%;z-index:60;background:linear-gradient(165deg, rgba(8,8,14,0.94) 0%, rgba(12,12,22,0.96) 50%, rgba(8,10,18,0.94) 100%);backdrop-filter:blur(24px) saturate(1.6);border:1px solid rgba(59,130,246,0.15);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.7), 0 0 40px rgba(59,130,246,0.06), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 30px rgba(59,130,246,0.02);opacity:0;transform:translateX(20px) scale(0.96);transition:opacity 0.3s cubic-bezier(0.16,1,0.3,1), transform 0.3s cubic-bezier(0.16,1,0.3,1);display:flex;flex-direction:column;overflow:hidden; }
                    #cf-summary-bubble.cf-bubble-visible { opacity:1;transform:translateX(0) scale(1); }
                    #cf-summary-bubble.cf-bubble-hiding { opacity:0;transform:translateX(20px) scale(0.96); }
                    #cf-summary-bubble::before { content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg, transparent, rgba(59,130,246,0.3), rgba(139,92,246,0.2), transparent);z-index:1; }
                    .cf-bubble-header { display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0;background:rgba(255,255,255,0.01); }
                    .cf-bubble-title-row { display:flex;align-items:center;gap:8px; }
                    .cf-bubble-icon { width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg, rgba(59,130,246,0.2), rgba(139,92,246,0.15));border-radius:8px;color:#60a5fa;flex-shrink:0; }
                    .cf-bubble-title { font-size:13px;font-weight:700;color:rgba(255,255,255,0.85);letter-spacing:0.5px; }
                    .cf-bubble-actions { display:flex;align-items:center;gap:2px; }
                    .cf-bubble-provider { font-size:8px;color:rgba(59,130,246,0.55);background:rgba(59,130,246,0.08);padding:3px 8px;border-radius:6px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-right:4px; }
                    .cf-bubble-btn { width:28px;height:28px;border:none;background:transparent;color:rgba(255,255,255,0.3);cursor:pointer;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;padding:0; }
                    .cf-bubble-btn:hover { background:rgba(255,255,255,0.08);color:#fff; }
                    .cf-bubble-close-btn:hover { background:rgba(239,68,68,0.15);color:#f87171; }
                    .cf-bubble-body { padding:14px 16px;font-size:13px;line-height:1.75;color:rgba(255,255,255,0.78);flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(59,130,246,0.15) transparent; }
                    .cf-bubble-body strong { color:#93c5fd;font-weight:600; }
                    .cf-bubble-body em { color:rgba(255,255,255,0.55);font-style:italic; }
                    .cf-bubble-body::-webkit-scrollbar { width:4px; } .cf-bubble-body::-webkit-scrollbar-track { background:transparent; } .cf-bubble-body::-webkit-scrollbar-thumb { background:rgba(59,130,246,0.15);border-radius:4px; }
                    .cf-bubble-ts { color:#60a5fa;cursor:pointer;font-family:"Cascadia Code","Consolas",monospace;font-size:11.5px;font-weight:600;padding:2px 6px;border-radius:5px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.1);transition:all 0.15s;text-decoration:none;display:inline-block;line-height:1; }
                    .cf-bubble-ts:hover { background:rgba(59,130,246,0.22);border-color:rgba(59,130,246,0.25);color:#93c5fd;box-shadow:0 0 8px rgba(59,130,246,0.15); }
                    .cf-bubble-bullet { display:inline-block;width:4px;height:4px;background:linear-gradient(135deg, #3b82f6, #8b5cf6);border-radius:50%;margin-right:8px;vertical-align:middle;flex-shrink:0; }
                    .cf-bubble-label { display:inline-block;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(59,130,246,0.6);background:rgba(59,130,246,0.08);padding:2px 7px;border-radius:4px;margin-right:4px;vertical-align:middle; }

                    /* OpenCut-inspired: Filler markers */
                    .cf-filler-markers { position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:52; }
                    .cf-filler-marker { position:absolute;top:-2px;width:3px;height:calc(100% + 4px);background:#f97316;border-radius:1px;opacity:0.7;pointer-events:auto;cursor:pointer;transition:opacity .15s,transform .15s; }
                    .cf-filler-marker:hover { opacity:1;transform:scaleX(2); }
                    .cf-filler-tip { white-space:nowrap;font-size:10px;background:rgba(249,115,22,0.95);color:#fff;border:none; }

                    /* OpenCut-inspired: Analysis boxes */
                    .cf-analysis-box { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px;margin-bottom:8px; }
                    .cf-analysis-stat { display:inline-flex;flex-direction:column;align-items:center;padding:6px 12px;min-width:70px; }
                    .cf-stat-value { font-size:20px;font-weight:700;color:#e2e8f0;line-height:1.2; }
                    .cf-stat-label { font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px; }
                    .cf-filler-breakdown { margin-top:8px; }
                    .cf-filler-row { display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px; }
                    .cf-filler-word { color:#f97316;font-weight:600;min-width:70px;font-family:monospace; }
                    .cf-filler-bar-bg { flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden; }
                    .cf-filler-bar-fill { height:100%;background:linear-gradient(90deg,#f97316,#fb923c);border-radius:3px;transition:width .3s; }
                    .cf-filler-count { color:rgba(255,255,255,0.5);min-width:20px;text-align:right; }
                    .cf-muted { font-size:11px;color:rgba(255,255,255,0.3);padding:4px 0; }

                    /* OpenCut-inspired: Speech pace */
                    .cf-pace-box { padding:8px 10px; }
                    .cf-pace-grid { display:flex;gap:12px;justify-content:center; }
                    .cf-pace-normal .cf-stat-value { color:#10b981; }
                    .cf-pace-fast .cf-stat-value { color:#f97316; }
                    .cf-pace-slow .cf-stat-value { color:#60a5fa; }
                    .cf-pace-detail { font-size:10px;color:rgba(255,255,255,0.35);text-align:center;margin-top:6px; }

                    /* OpenCut-inspired: Keywords */
                    .cf-keywords-box { margin-bottom:8px; }
                    .cf-kw-row { display:flex;align-items:baseline;gap:6px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04); }
                    .cf-kw-row:last-child { border-bottom:none; }
                    .cf-kw-chapter { font-size:10px;color:rgba(255,255,255,0.5);min-width:80px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
                    .cf-kw-tags { display:flex;flex-wrap:wrap;gap:3px; }
                    .cf-kw-tag { display:inline-block;font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(139,92,246,0.12);color:#a78bfa;border:1px solid rgba(139,92,246,0.15); }

                    /* Status bar (in-panel progress) */
                    .cf-status-bar { position:relative;height:22px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;margin:-6px 0 10px; }
                    .cf-status-fill { position:absolute;top:0;left:0;height:100%;background:linear-gradient(90deg,rgba(124,58,237,0.3),rgba(124,58,237,0.5));border-radius:6px;transition:width 0.4s ease; }
                    .cf-status-text { position:relative;z-index:1;display:block;font-size:10px;color:rgba(255,255,255,0.5);text-align:center;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px; }

                    /* First-time onboarding */
                    .cf-onboard { margin-top:16px;padding:12px;background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.12);border-radius:8px;text-align:left; }
                    .cf-onboard-title { font-size:11px;font-weight:700;color:rgba(124,58,237,0.7);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px; }
                    .cf-onboard-step { display:flex;align-items:flex-start;gap:8px;font-size:11px;color:rgba(255,255,255,0.35);line-height:1.5;margin-bottom:6px; }
                    .cf-onboard-num { display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(124,58,237,0.2);color:#a78bfa;font-size:9px;font-weight:700;flex-shrink:0;margin-top:1px; }

                    /* ═══ AI Chat ═══ */
                    .cf-chat-messages { max-height:220px;min-height:60px;overflow-y:auto;margin-bottom:8px;padding:8px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid rgba(255,255,255,0.04);scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.2) transparent;display:flex;flex-direction:column;gap:6px; }
                    .cf-chat-messages::-webkit-scrollbar { width:4px; } .cf-chat-messages::-webkit-scrollbar-thumb { background:rgba(124,58,237,0.2);border-radius:4px; }
                    .cf-chat-empty { font-size:11px;color:rgba(255,255,255,0.15);text-align:center;padding:16px 8px; }
                    .cf-chat-msg { font-size:11.5px;line-height:1.5;padding:8px 10px;border-radius:8px;max-width:92%;word-wrap:break-word; }
                    .cf-chat-user { background:rgba(124,58,237,0.15);color:rgba(255,255,255,0.8);align-self:flex-end;border:1px solid rgba(124,58,237,0.2); }
                    .cf-chat-ai { background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.7);align-self:flex-start;border:1px solid rgba(255,255,255,0.06); }
                    .cf-chat-ai strong { color:#a78bfa; }
                    .cf-chat-thinking { opacity:0.5;animation:cfPulse 1.5s infinite; }
                    .cf-chat-input-row { display:flex;gap:6px;align-items:center; }
                    .cf-chat-input { flex:1;max-width:none;width:auto; }

                    /* ═══ Flashcards ═══ */
                    .cf-flashcard-container { display:flex;flex-direction:column;align-items:center;gap:8px; }
                    .cf-flashcard { width:100%;min-height:120px;cursor:pointer;perspective:600px;position:relative; }
                    .cf-flashcard-face { position:absolute;top:0;left:0;width:100%;min-height:120px;padding:16px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;backface-visibility:hidden;transition:transform 0.4s cubic-bezier(0.16,1,0.3,1),opacity 0.4s;box-sizing:border-box; }
                    .cf-flashcard-front { background:linear-gradient(135deg,rgba(124,58,237,0.12),rgba(59,130,246,0.08));border:1px solid rgba(124,58,237,0.2);transform:rotateY(0deg);opacity:1; }
                    .cf-flashcard-back { background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(59,130,246,0.06));border:1px solid rgba(16,185,129,0.2);transform:rotateY(180deg);opacity:0; }
                    .cf-flipped .cf-flashcard-front { transform:rotateY(-180deg);opacity:0; }
                    .cf-flipped .cf-flashcard-back { transform:rotateY(0deg);opacity:1; }
                    .cf-flashcard-label { font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;opacity:0.4; }
                    .cf-flashcard-front .cf-flashcard-label { color:#a78bfa; }
                    .cf-flashcard-back .cf-flashcard-label { color:#10b981; }
                    .cf-flashcard-text { font-size:12.5px;line-height:1.5;color:rgba(255,255,255,0.8); }
                    .cf-flashcard-nav { display:flex;align-items:center;gap:12px;justify-content:center; }
                    .cf-fc-counter { font-size:11px;color:rgba(255,255,255,0.3);font-weight:600;min-width:50px;text-align:center; }
                    .cf-mindmap-outline { padding:10px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid rgba(255,255,255,0.04);max-height:280px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.2) transparent; }
                    .cf-mindmap-outline::-webkit-scrollbar { width:4px; } .cf-mindmap-outline::-webkit-scrollbar-thumb { background:rgba(124,58,237,0.2);border-radius:4px; }
                    .cf-mm-root { font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(124,58,237,0.15); }
                    .cf-mm-section { font-size:11.5px;font-weight:600;color:rgba(255,255,255,0.7);margin:8px 0 4px;padding-left:8px;border-left:2px solid rgba(124,58,237,0.3); }
                    .cf-mm-point { font-size:11px;color:rgba(255,255,255,0.5);padding:2px 0 2px 20px;line-height:1.5; }
                    .cf-mm-sub { font-size:10px;color:rgba(255,255,255,0.3);padding:1px 0 1px 34px;line-height:1.5;font-style:italic; }
                    .cf-prompt-list { max-height:120px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,0.2) transparent; }
                    .cf-prompt-list::-webkit-scrollbar { width:4px; } .cf-prompt-list::-webkit-scrollbar-thumb { background:rgba(124,58,237,0.2);border-radius:4px; }
                    .cf-prompt-item { display:flex;align-items:center;justify-content:space-between;padding:5px 6px;border-bottom:1px solid rgba(255,255,255,0.03);transition:background 0.15s; }
                    .cf-prompt-item:hover { background:rgba(124,58,237,0.06); }
                    .cf-prompt-name { font-size:11px;color:rgba(255,255,255,0.5);cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
                    .cf-prompt-name:hover { color:#a78bfa; }
                    .cf-prompt-del { font-size:14px;color:rgba(255,255,255,0.15);cursor:pointer;padding:0 4px;flex:0 0 auto; }
                    .cf-prompt-del:hover { color:rgba(239,68,68,0.6); }
                `;
                this._styleElement = document.createElement('style'); this._styleElement.id = 'chapterforge-styles'; this._styleElement.textContent = css; document.head.appendChild(this._styleElement);
    
                this._navHandler = () => {
                    this._onVideoChange();
                    if (window.location.pathname.startsWith('/feed/subscriptions')) {
                        setTimeout(() => this._injectSubscriptionsButton(), 1000);
                    }
                    if (!window.location.pathname.startsWith('/watch') && this._liveIntervalId) {
                        this._stopLiveTracking();
                    }
                    // Clean HUD when leaving watch page
                    if (!window.location.pathname.startsWith('/watch')) {
                        this._stopChapterTracking();
                        this._chapterHUDEl?.remove();
                        this._chapterHUDEl = null;
                    }
                };
                document.addEventListener('yt-navigate-finish', this._navHandler);
    
                this._clickHandler = (e) => {
                    if (!this._panelEl?.classList.contains('cf-visible')) return;
                    // Debounce: ignore clicks within 300ms of a panel render (DOM rebuild race condition)
                    if (Date.now() - (this._lastRenderTime || 0) < 300) return;
                    // Check if click is inside panel (handles DOM rebuild edge cases)
                    if (this._panelEl.contains(e.target)) return;
                    if (e.target.closest('#cf-panel')) return;
                    const rect = this._panelEl.getBoundingClientRect();
                    if (rect.width > 0 && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) return;
                    if (e.target.closest('#cf-player-btn')) return;
                    this._panelEl.classList.remove('cf-visible');
                };
                document.addEventListener('click', this._clickHandler);
    
                this._resizeObserver = new ResizeObserver(() => { if (this._chapterData) this._renderProgressBarOverlay(); });
                this._barObsHandler = () => { setTimeout(() => { const bar = document.querySelector('.ytp-progress-bar'); if (bar) this._resizeObserver.observe(bar); }, 1000); };
                document.addEventListener('yt-navigate-finish', this._barObsHandler);
                setTimeout(this._barObsHandler, 2000);
    
                if (window.location.pathname.startsWith('/watch')) setTimeout(() => this._onVideoChange(), 500);
                if (window.location.pathname.startsWith('/feed/subscriptions')) setTimeout(() => this._injectSubscriptionsButton(), 1500);
                if (appState.settings.cfLlmProvider === 'browserai') { appState.settings.cfLlmProvider = 'ollama'; settingsManager.save(appState.settings); showToast('Browser AI provider removed — switched to Ollama', '#f59e0b'); }
                if (appState.settings?.cfDebugLog) console.log('[ChapterForge] v25.0 initialized — Provider:', appState.settings.cfLlmProvider || 'builtin');
            },
    
            destroy() {
                this._stopLiveTracking();
                this._stopChapterTracking();
                this._removeBatchUI();
                this._chapterHUDEl?.remove(); this._chapterHUDEl = null;
                try { this._browserLLMPipeline?.dispose?.(); } catch(e) {}
                this._browserLLMPipeline = null; this._browserLLMModelId = null;
                if (this._navHandler) document.removeEventListener('yt-navigate-finish', this._navHandler);
                if (this._clickHandler) document.removeEventListener('click', this._clickHandler);
                if (this._barObsHandler) document.removeEventListener('yt-navigate-finish', this._barObsHandler);
                if (this._resizeObserver) this._resizeObserver.disconnect();
                this._styleElement?.remove();
                this._panelEl?.remove(); this._panelEl = null;
                document.getElementById('cf-player-btn')?.remove();
                document.getElementById('cf-batch-btn')?.remove();
                document.querySelectorAll('.cf-bar-overlay,.cf-chapter-markers,.cf-chapter-label-row').forEach(el => el.remove());
            }
    
        },
        // ── ChapterForge sub-features (shown in YTKit settings panel) ──
        {
            id: 'cfMode', name: 'Processing Mode', description: 'Auto: generate chapters for every video. Manual: player button to trigger.',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'manual': 'Manual (Player Button)', 'auto': 'Auto (All Videos)' }, init() {}, destroy() {}
        },
        // ══════════════════════════════════════════════════════════════
        //  DeArrow — Crowdsourced Better Titles & Thumbnails
        // ══════════════════════════════════════════════════════════════
        {
            id: 'deArrow',
            name: 'DeArrow',
            description: 'Replace clickbait titles and thumbnails with crowdsourced alternatives from the DeArrow database',
            group: 'DeArrow',
            icon: 'player',
            isParent: true,

            _DA_API: 'https://sponsor.ajay.app/api/branding',
            _DA_THUMB_API: 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail',
            _cache: {},           // in-memory: videoId -> branding data
            _cacheMeta: {},       // in-memory: videoId -> { ts: timestamp }
            _pendingFetches: {},
            _persistKey: 'da_branding_cache',
            _maxCacheEntries: 2000,
            _observer: null,
            _navHandler: null,
            _hoverHandler: null,
            _hoverOutHandler: null,
            _styleEl: null,
            _processTimer: null,
            _persistTimer: null,
            _persistDirty: false,
            _generation: 0,       // monotonic counter — incremented on navigation to abort stale processing
            _isProcessing: false, // flag to prevent re-entrant batch processing
            _stats: { fetched: 0, cached: 0, titles: 0, thumbs: 0, formatted: 0, errors: 0 },

            _log(...args) { if (appState.settings.daDebugLog) console.log('[DeArrow]', ...args); },

            _isWatchPage() { return window.location.pathname.startsWith('/watch'); },

            // ── Persistent cache: load from GM storage ──
            _loadCache() {
                const ttl = parseInt(appState.settings.daCacheTTL) || 0;
                if (ttl <= 0) { this._log('Persistent cache disabled'); return; }
                try {
                    const stored = GM_getValue(this._persistKey, null);
                    if (stored) {
                        const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
                        const now = Date.now();
                        const ttlH = parseInt(appState.settings.daCacheTTL);
                        const maxAge = (isNaN(ttlH) ? 4 : ttlH) * 3600000 * 6; // hard-expire at 6x TTL
                        let count = 0;
                        for (const [vid, entry] of Object.entries(parsed)) {
                            if (entry?.ts && (now - entry.ts) < maxAge && entry.data) {
                                this._cache[vid] = entry.data;
                                this._cacheMeta[vid] = { ts: entry.ts };
                                count++;
                            }
                        }
                        this._log(`Loaded ${count} cached entries from storage`);
                    }
                } catch (e) {
                    this._log('Cache load error:', e.message);
                }
            },

            // ── Persistent cache: save to GM storage (debounced) ──
            _schedulePersist() {
                if ((parseInt(appState.settings.daCacheTTL) || 0) <= 0) return;
                this._persistDirty = true;
                if (this._persistTimer) return;
                this._persistTimer = setTimeout(() => {
                    this._persistTimer = null;
                    if (!this._persistDirty) return;
                    this._persistDirty = false;
                    this._persistCache();
                }, 5000); // batch writes every 5s
            },

            _persistCache() {
                try {
                    const out = {};
                    const entries = Object.entries(this._cache);
                    // If over limit, keep only the most recent entries
                    const sorted = entries
                        .map(([vid, data]) => ({ vid, data, ts: this._cacheMeta[vid]?.ts || 0 }))
                        .sort((a, b) => b.ts - a.ts)
                        .slice(0, this._maxCacheEntries);
                    for (const { vid, data, ts } of sorted) {
                        out[vid] = { data, ts };
                    }
                    GM_setValue(this._persistKey, JSON.stringify(out));
                    this._log(`Persisted ${sorted.length} cache entries`);
                } catch (e) {
                    this._log('Cache persist error:', e.message);
                }
            },

            // ── API: Fetch branding data (with persistent cache + background refresh) ──
            async _fetchBranding(videoId) {
                const now = Date.now();
                const ttlHours = parseInt(appState.settings.daCacheTTL);
                const ttlMs = (isNaN(ttlHours) ? 4 : ttlHours) * 3600000;

                // Cache disabled — always fetch fresh
                if (ttlMs <= 0) {
                    if (this._pendingFetches[videoId]) return this._pendingFetches[videoId];
                    return this._fetchFromAPI(videoId);
                }
                const meta = this._cacheMeta[videoId];

                // Fresh cache hit — return immediately
                if (this._cache[videoId] && meta && (now - meta.ts) < ttlMs) {
                    this._stats.cached++;
                    return this._cache[videoId];
                }

                // Stale cache hit — return immediately but refresh in background
                if (this._cache[videoId] && meta) {
                    this._stats.cached++;
                    this._backgroundRefresh(videoId);
                    return this._cache[videoId];
                }

                // No cache — fetch synchronously
                if (this._pendingFetches[videoId]) return this._pendingFetches[videoId];
                return this._fetchFromAPI(videoId);
            },

            _fetchFromAPI(videoId) {
                const url = `${this._DA_API}?videoID=${videoId}`;
                this._pendingFetches[videoId] = new Promise((resolve) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        anonymous: true,
                        timeout: 8000,
                        onload: (r) => {
                            delete this._pendingFetches[videoId];
                            if (r.status === 200) {
                                try {
                                    const data = JSON.parse(r.responseText);
                                    this._cacheStore(videoId, data);
                                    this._stats.fetched++;
                                    resolve(data);
                                } catch(e) {
                                    this._log('Parse error for', videoId, e.message);
                                    this._stats.errors++;
                                    resolve(null);
                                }
                            } else if (r.status === 404) {
                                const empty = { titles: [], thumbnails: [], randomTime: 0, videoDuration: null };
                                this._cacheStore(videoId, empty);
                                resolve(empty);
                            } else {
                                this._log('API returned', r.status, 'for', videoId);
                                this._stats.errors++;
                                resolve(null);
                            }
                        },
                        onerror: (e) => { delete this._pendingFetches[videoId]; this._log('Network error for', videoId); this._stats.errors++; resolve(null); },
                        ontimeout: () => { delete this._pendingFetches[videoId]; this._log('Timeout for', videoId); this._stats.errors++; resolve(null); }
                    });
                });
                return this._pendingFetches[videoId];
            },

            _cacheStore(videoId, data) {
                this._cache[videoId] = data;
                this._cacheMeta[videoId] = { ts: Date.now() };
                this._schedulePersist();
            },

            // ── Background refresh for stale entries (no UI blocking) ──
            _backgroundRefresh(videoId) {
                if (this._pendingFetches[videoId]) return; // already fetching
                const url = `${this._DA_API}?videoID=${videoId}`;
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    anonymous: true,
                    timeout: 10000,
                    onload: (r) => {
                        if (r.status === 200) {
                            try {
                                const data = JSON.parse(r.responseText);
                                this._cacheStore(videoId, data);
                            } catch(e) { /* silent */ }
                        } else if (r.status === 404) {
                            this._cacheStore(videoId, { titles: [], thumbnails: [], randomTime: 0, videoDuration: null });
                        }
                    },
                    onerror: () => {},
                    ontimeout: () => {}
                });
            },

            // ── Title formatting ──
            _formatTitle(title, format) {
                if (!title) return title;
                // DeArrow uses > before words to prevent auto-formatting those words
                let clean = title.replace(/>\s*/g, '');
                if (format === 'original') return clean;

                const words = clean.split(/(\s+)/);
                const lowerWords = new Set(['a','an','and','as','at','but','by','for','in','nor','of','on','or','so','the','to','up','yet','is','it','be','do','no','vs']);
                const allCapsPattern = /^[A-Z0-9]{2,}$/;

                if (format === 'sentence') {
                    let first = true;
                    return words.map(w => {
                        if (/^\s+$/.test(w)) return w;
                        if (allCapsPattern.test(w)) return w;
                        if (first) { first = false; return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }
                        return w.toLowerCase();
                    }).join('');
                }
                if (format === 'title_case') {
                    return words.map((w, i) => {
                        if (/^\s+$/.test(w)) return w;
                        if (allCapsPattern.test(w)) return w;
                        if (i > 0 && lowerWords.has(w.toLowerCase())) return w.toLowerCase();
                        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
                    }).join('');
                }
                return clean;
            },

            _formatOriginalTitle(title) {
                if (!appState.settings.daFallbackFormat) return title;
                return this._formatTitle(title, appState.settings.daTitleFormat || 'sentence');
            },

            // ── Get best title/thumbnail from branding data ──
            _getBestTitle(data) {
                if (!data?.titles?.length) return null;
                const best = data.titles[0];
                if (!best.original && (best.locked || best.votes >= 0)) {
                    return this._formatTitle(best.title, appState.settings.daTitleFormat || 'sentence');
                }
                return null;
            },

            _getBestThumbnailTime(data) {
                if (!data?.thumbnails?.length) return null;
                const best = data.thumbnails[0];
                if (!best.original && (best.locked || best.votes >= 0) && best.timestamp != null) {
                    return best.timestamp;
                }
                if (data.randomTime != null && data.randomTime > 0) return data.randomTime;
                return null;
            },

            _getThumbnailUrl(videoId, time) {
                return `${this._DA_THUMB_API}?videoID=${videoId}&time=${time}`;
            },

            // ── Extract video ID from elements ──
            _getVideoIdFromElement(el) {
                const link = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]') || el.closest('a[href*="/watch?v="], a[href*="/shorts/"]');
                if (link) {
                    const href = link.getAttribute('href') || '';
                    const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || href.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
                    if (match) return match[1];
                }
                return null;
            },

            // ── Title selectors for all YouTube layouts ──
            // DeArrow approach: NEVER modify the original element text.
            // Instead, clone it, hide original with display:none, show clone.
            // This avoids fighting YouTube's Polymer re-renders entirely.
            _TITLE_SELECTORS: [
                // New YouTube layout (subscriptions feed, home, etc.)
                '.yt-lockup-metadata-view-model-wiz__title .yt-core-attributed-string',
                '.yt-lockup-metadata-view-model__title .yt-core-attributed-string',
                // Shorts in new layout
                '.ShortsLockupViewModelHostMetadataTitle .yt-core-attributed-string',
                '.shortsLockupViewModelHostMetadataTitle .yt-core-attributed-string',
                // Classic layout selectors
                'yt-formatted-string#video-title',
                '#video-title-link yt-formatted-string',
                '#video-title yt-formatted-string',
                'a#video-title',
                '#video-title',
                'h3 a yt-formatted-string',
                'h3 yt-formatted-string',
                '[id="video-title"]',
            ],

            _WATCH_TITLE_SELECTORS: [
                'h1.ytd-watch-metadata yt-formatted-string',
                'ytd-watch-metadata h1 yt-formatted-string',
                'h1.ytd-watch-metadata',
                '#title h1 yt-formatted-string',
                'ytd-video-primary-info-renderer h1 yt-formatted-string',
                // New layout watch page
                'h1 .yt-core-attributed-string',
            ],

            // ── Find the ORIGINAL title element (exclude our clones) ──
            _findTitleElement(el, requireText = true) {
                for (const sel of this._TITLE_SELECTORS) {
                    const found = el.querySelector(`${sel}:not(.daCustomTitle)`);
                    if (found) {
                        if (!requireText) return found;
                        const text = found.textContent?.trim();
                        if (text && text.length > 0) return found;
                    }
                }
                return null;
            },

            // ── Get or create the custom title clone ──
            _getOrCreateClone(originalEl) {
                // Check if a clone already exists as a sibling
                const existing = originalEl.parentElement?.querySelector('.daCustomTitle');
                if (existing) return existing;
                // Clone the element (shallow — no children)
                const clone = originalEl.cloneNode(false);
                clone.classList.add('daCustomTitle');
                // Remove id to avoid duplicate IDs
                clone.removeAttribute('id');
                // Remove Polymer-specific attributes that cause re-render binding
                clone.removeAttribute('is-empty');
                clone.removeAttribute('disable-upgrade');
                // Insert clone right before the original
                originalEl.parentElement?.insertBefore(clone, originalEl);
                return clone;
            },

            // ── Set text on our clone element ──
            _setCloneText(clone, text) {
                // Clear any children and set plain text
                while (clone.firstChild) clone.removeChild(clone.firstChild);
                clone.appendChild(document.createTextNode(text));
                clone.title = text;
            },

            // ── Show custom title, hide original ──
            _showCustomTitle(originalEl, clone) {
                originalEl.style.setProperty('display', 'none', 'important');
                clone.style.removeProperty('display');
                // Clear parent tooltip so it doesn't show the old title
                const parentLink = originalEl.closest('a');
                if (parentLink) {
                    parentLink.setAttribute('title', clone.textContent || '');
                    parentLink.setAttribute('aria-label', clone.textContent || '');
                }
            },

            // ── Show original title, hide clone ──
            _showOriginalTitle(originalEl) {
                const clone = originalEl.parentElement?.querySelector('.daCustomTitle');
                if (clone) clone.style.setProperty('display', 'none', 'important');
                // Restore original display — use -webkit-box for line clamping (YouTube default)
                if (originalEl.closest('.ytp-title-link')) {
                    originalEl.style.removeProperty('display');
                } else {
                    originalEl.style.setProperty('display', '-webkit-box', 'important');
                }
                const parentLink = originalEl.closest('a');
                if (parentLink) {
                    parentLink.setAttribute('title', originalEl.textContent?.trim() || '');
                    parentLink.setAttribute('aria-label', originalEl.textContent?.trim() || '');
                }
            },

            // ── Wait for title text to appear (YouTube lazy-renders) ──
            _waitForTitleText(el, maxWait = 3000) {
                return new Promise(resolve => {
                    const titleEl = this._findTitleElement(el, false);
                    if (!titleEl) return resolve(null);
                    const text = titleEl.textContent?.trim();
                    if (text && text.length > 0) return resolve(titleEl);
                    const start = Date.now();
                    const check = () => {
                        const t = titleEl.textContent?.trim();
                        if (t && t.length > 0) return resolve(titleEl);
                        if (Date.now() - start > maxWait) {
                            const fresh = this._findTitleElement(el, true);
                            return resolve(fresh);
                        }
                        setTimeout(check, 150);
                    };
                    setTimeout(check, 150);
                });
            },

            // ── Process a single video element (clone approach) ──
            async _processVideoElement(el) {
                if (el.dataset.daProcessed) return;
                const videoId = this._getVideoIdFromElement(el);
                if (!videoId) return;
                el.dataset.daProcessed = videoId;

                const data = await this._fetchBranding(videoId);
                if (!data) { this._log('No data for', videoId); return; }

                const s = appState.settings;

                // ── Replace title using clone approach ──
                if (s.daReplaceTitles) {
                    const originalEl = await this._waitForTitleText(el);
                    if (!originalEl) {
                        if (this._stats.errors < 5) this._log('No title element for', videoId, '- tag:', el.tagName);
                    } else {
                        const originalText = originalEl.textContent.trim();
                        const newTitle = this._getBestTitle(data);

                        if (newTitle && newTitle !== originalText) {
                            // Crowdsourced title available — clone, set text, swap visibility
                            const clone = this._getOrCreateClone(originalEl);
                            this._setCloneText(clone, newTitle);
                            clone.classList.add('da-replaced-title');
                            clone.dataset.daOriginal = originalText;
                            clone.dataset.daVideoId = videoId;
                            this._showCustomTitle(originalEl, clone);
                            this._stats.titles++;
                            if (this._stats.titles <= 5) this._log('Replaced:', originalText.substring(0, 50), '=>', newTitle.substring(0, 50));
                        } else if (s.daFallbackFormat && !newTitle) {
                            // No crowdsourced title — format original if enabled
                            const formatted = this._formatOriginalTitle(originalText);
                            if (formatted !== originalText) {
                                const clone = this._getOrCreateClone(originalEl);
                                this._setCloneText(clone, formatted);
                                clone.classList.add('da-formatted-title');
                                clone.dataset.daOriginal = originalText;
                                clone.dataset.daVideoId = videoId;
                                this._showCustomTitle(originalEl, clone);
                                this._stats.formatted++;
                            }
                        }
                        if (this._stats.fetched <= 5 && !newTitle) {
                            this._log('No DeArrow submission for', videoId);
                        }
                    }
                }

                // ── Replace thumbnail ──
                if (s.daReplaceThumbs) {
                    const thumbTime = this._getBestThumbnailTime(data);
                    if (thumbTime != null) {
                        const thumbContainer = el.querySelector('ytd-thumbnail, ytd-playlist-thumbnail');
                        const img = thumbContainer?.querySelector('img');
                        if (img && img.src) {
                            img.dataset.daOriginalSrc = img.src;
                            const newSrc = this._getThumbnailUrl(videoId, thumbTime);
                            const probe = new Image();
                            probe.onload = () => {
                                if (probe.naturalWidth > 1) {
                                    img.src = newSrc;
                                    img.classList.add('da-replaced-thumb');
                                    this._stats.thumbs++;
                                }
                            };
                            probe.src = newSrc;
                        }
                    }
                }
            },

            // ── Process watch page title (clone approach) ──
            async _processWatchPage() {
                const urlParams = new URLSearchParams(window.location.search);
                const videoId = urlParams.get('v');
                if (!videoId) return;

                const data = await this._fetchBranding(videoId);
                if (!data) return;

                const s = appState.settings;
                if (!s.daReplaceTitles) return;

                // Find original watch page title (exclude our clones)
                let originalEl = null;
                for (const sel of this._WATCH_TITLE_SELECTORS) {
                    originalEl = document.querySelector(`${sel}:not(.daCustomTitle)`);
                    if (originalEl?.textContent?.trim()) break;
                }
                if (!originalEl || originalEl.dataset.daWatchProcessed === videoId) return;
                originalEl.dataset.daWatchProcessed = videoId;

                const originalText = originalEl.textContent.trim();
                const newTitle = this._getBestTitle(data);

                if (newTitle && newTitle !== originalText) {
                    const clone = this._getOrCreateClone(originalEl);
                    this._setCloneText(clone, newTitle);
                    clone.classList.add('da-replaced-title');
                    clone.dataset.daOriginal = originalText;
                    clone.dataset.daVideoId = videoId;
                    this._showCustomTitle(originalEl, clone);
                    this._stats.titles++;
                } else if (s.daFallbackFormat) {
                    const formatted = this._formatOriginalTitle(originalText);
                    if (formatted !== originalText) {
                        const clone = this._getOrCreateClone(originalEl);
                        this._setCloneText(clone, formatted);
                        clone.classList.add('da-formatted-title');
                        clone.dataset.daOriginal = originalText;
                        clone.dataset.daVideoId = videoId;
                        this._showCustomTitle(originalEl, clone);
                        this._stats.formatted++;
                    }
                }
            },

            // ── Scan page for video elements ──
            _abortProcessing() {
                this._generation++;
                if (this._processTimer) { clearTimeout(this._processTimer); this._processTimer = null; }
                this._isProcessing = false;
                // Abandon pending fetches — they'll resolve but results are discarded
                this._pendingFetches = {};
                this._log('Aborted processing (gen', this._generation, ')');
            },

            _processPage() {
                // KILL on watch pages — no scanning, no processing, no observer
                if (this._isWatchPage()) return;
                if (this._processTimer || this._isProcessing) return;
                const gen = this._generation;
                this._processTimer = setTimeout(async () => {
                    this._processTimer = null;
                    if (gen !== this._generation) return;
                    if (this._isWatchPage()) return; // double-check after delay
                    this._isProcessing = true;
                    try {

                    // Pause observer during processing to prevent feedback loop
                    if (this._observer) this._observer.disconnect();

                    const selectors = [
                        'ytd-rich-item-renderer',
                        'ytd-video-renderer',
                        'ytd-compact-video-renderer',
                        'ytd-grid-video-renderer',
                        'ytd-reel-item-renderer',
                        'ytd-playlist-video-renderer',
                    ].join(', ');
                    const els = [...document.querySelectorAll(selectors)].filter(el => !el.dataset.daProcessed);
                    if (els.length > 0) {
                        this._log(`Processing ${els.length} videos on ${window.location.pathname} (gen ${gen})`);
                        const BATCH = 10;
                        const DELAY = 100;
                        for (let i = 0; i < els.length; i += BATCH) {
                            if (gen !== this._generation || this._isWatchPage()) { this._log('Batch aborted at', i, '/', els.length); break; }
                            const batch = els.slice(i, i + BATCH);
                            await Promise.all(batch.map(el => this._processVideoElement(el)));
                            if (gen !== this._generation) break;
                            if (i + BATCH < els.length) await new Promise(r => setTimeout(r, DELAY));
                        }
                        if (gen === this._generation) this._log('Batch complete — Stats:', JSON.stringify(this._stats));
                    }

                    // Resume observer after processing (only if still not on watch page)
                    if (gen === this._generation && this._observer && !this._isWatchPage()) {
                        const target = document.querySelector('ytd-app') || document.body;
                        this._observer.observe(target, { childList: true, subtree: true });
                    }

                    } finally { this._isProcessing = false; }
                }, 300);
            },

            // ── Hover: toggle between clone and original ──
            _setupHoverRestore() {
                this._hoverHandler = (e) => {
                    if (!appState.settings.daShowOriginalHover) return;
                    const t = e.target;
                    if (!t || !t.closest) return;
                    // Check if hovering a clone title
                    const clone = t.closest('.da-replaced-title, .da-formatted-title');
                    if (clone?.classList.contains('daCustomTitle') && clone.dataset.daOriginal) {
                        // Find the original sibling (next sibling since clone is inserted before)
                        const originalEl = clone.nextElementSibling;
                        if (originalEl && !originalEl.classList.contains('daCustomTitle')) {
                            this._showOriginalTitle(originalEl);
                            clone._daHoverActive = true;
                        }
                    }
                    // Thumbnail hover
                    const img = t.closest('.da-replaced-thumb');
                    if (img?.dataset.daOriginalSrc) {
                        img.dataset.daCurrent = img.src;
                        img.src = img.dataset.daOriginalSrc;
                    }
                };
                this._hoverOutHandler = (e) => {
                    const t = e.target;
                    if (!t || !t.closest) return;
                    const clone = t.closest('.da-replaced-title, .da-formatted-title');
                    if (clone?.classList.contains('daCustomTitle') && clone._daHoverActive) {
                        const originalEl = clone.nextElementSibling;
                        if (originalEl && !originalEl.classList.contains('daCustomTitle')) {
                            this._showCustomTitle(originalEl, clone);
                        }
                        delete clone._daHoverActive;
                    }
                    const img = t.closest('.da-replaced-thumb');
                    if (img?.dataset.daCurrent) {
                        img.src = img.dataset.daCurrent;
                        delete img.dataset.daCurrent;
                    }
                };
                document.addEventListener('mouseenter', this._hoverHandler, true);
                document.addEventListener('mouseleave', this._hoverOutHandler, true);
            },

            init() {
                const css = `
                    .daCustomTitle { transition:opacity 0.15s; }
                    .da-replaced-thumb { transition:opacity 0.2s; }
                    /* Ensure clones inherit the same line-clamp behavior as originals */
                    .daCustomTitle {
                        -webkit-line-clamp: inherit;
                        -webkit-box-orient: inherit;
                        overflow: inherit;
                        text-overflow: inherit;
                        display: -webkit-box;
                    }
                `;
                this._styleEl = injectStyle(css, 'deArrow', true);
                this._stats = { fetched: 0, cached: 0, titles: 0, thumbs: 0, formatted: 0, errors: 0 };

                // Load persistent cache from GM storage
                this._loadCache();

                // Process initial page after a short delay (skip on watch pages)
                if (!this._isWatchPage()) {
                    setTimeout(() => this._processPage(), 800);
                }

                // SPA navigation — abort all in-flight processing immediately
                this._navHandler = () => {
                    this._abortProcessing();
                    // Always disconnect observer during navigation
                    if (this._observer) this._observer.disconnect();
                    // Remove all clones and unhide originals on navigation
                    document.querySelectorAll('.daCustomTitle').forEach(clone => {
                        const originalEl = clone.nextElementSibling;
                        if (originalEl) {
                            originalEl.style.removeProperty('display');
                            delete originalEl.dataset.daWatchProcessed;
                        }
                        clone.remove();
                    });
                    document.querySelectorAll('[data-da-processed]').forEach(el => delete el.dataset.daProcessed);
                    // On watch pages: stay dead — no processing, no observer
                    if (this._isWatchPage()) {
                        this._log('Watch page — DeArrow dormant');
                        return;
                    }
                    // On feed/browse pages: resume after settle
                    setTimeout(() => this._processPage(), 1000);
                };
                document.addEventListener('yt-navigate-finish', this._navHandler);

                // MutationObserver for dynamically loaded content (infinite scroll, etc.)
                // Completely dormant on watch pages — no throttle timers, no processing
                let mutationThrottle = null;
                const DA_TAGS = new Set(['YTD-RICH-ITEM-RENDERER', 'YTD-VIDEO-RENDERER', 'YTD-COMPACT-VIDEO-RENDERER', 'YTD-GRID-VIDEO-RENDERER', 'YTD-REEL-ITEM-RENDERER', 'YTD-PLAYLIST-VIDEO-RENDERER']);
                this._observer = new MutationObserver((mutations) => {
                    if (this._isWatchPage()) return;
                    if (mutationThrottle) return;
                    // Only trigger when video renderers are actually added
                    let hasRelevant = false;
                    for (const m of mutations) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType !== 1) continue;
                            if (DA_TAGS.has(node.tagName) || node.querySelector?.('ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer')) {
                                hasRelevant = true;
                                break;
                            }
                        }
                        if (hasRelevant) break;
                    }
                    if (!hasRelevant) return;
                    mutationThrottle = setTimeout(() => { mutationThrottle = null; this._processPage(); }, TIMING.MUTATION_THROTTLE);
                });
                // Only attach observer if not on a watch page
                if (!this._isWatchPage()) {
                    const target = document.querySelector('ytd-app') || document.body;
                    this._observer.observe(target, { childList: true, subtree: true });
                }

                // Hover restore
                this._setupHoverRestore();

                this._log('Initialized (clone approach) — Titles:', appState.settings.daReplaceTitles, 'Thumbs:', appState.settings.daReplaceThumbs, 'Format:', appState.settings.daTitleFormat);
            },

            destroy() {
                this._abortProcessing();
                if (this._navHandler) document.removeEventListener('yt-navigate-finish', this._navHandler);
                if (this._observer) this._observer.disconnect();
                if (this._hoverHandler) document.removeEventListener('mouseenter', this._hoverHandler, true);
                if (this._hoverOutHandler) document.removeEventListener('mouseleave', this._hoverOutHandler, true);
                this._styleEl?.remove();
                // Remove all clones and restore originals
                document.querySelectorAll('.daCustomTitle').forEach(clone => {
                    const originalEl = clone.nextElementSibling;
                    if (originalEl) {
                        originalEl.style.removeProperty('display');
                    }
                    clone.remove();
                });
                document.querySelectorAll('.da-replaced-thumb').forEach(img => {
                    if (img.dataset.daOriginalSrc) img.src = img.dataset.daOriginalSrc;
                    img.classList.remove('da-replaced-thumb');
                });
                document.querySelectorAll('[data-da-processed]').forEach(el => delete el.dataset.daProcessed);
                document.querySelectorAll('[data-da-watch-processed]').forEach(el => delete el.dataset.daWatchProcessed);
                // Flush any pending cache writes
                if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
                if (this._persistDirty) this._persistCache();
                this._cache = {};
                this._cacheMeta = {};
                this._pendingFetches = {};
                if (this._processTimer) { clearTimeout(this._processTimer); this._processTimer = null; }
                this._log('Destroyed — Stats:', this._stats);
            }
        },
        // ── DeArrow sub-features ──
        {
            id: 'daReplaceTitles', name: 'Replace Titles', description: 'Replace clickbait titles with crowdsourced alternatives',
            group: 'DeArrow', icon: 'settings-2', dependsOn: 'deArrow', init() {}, destroy() {}
        },
        {
            id: 'daReplaceThumbs', name: 'Replace Thumbnails', description: 'Replace clickbait thumbnails with video screenshots',
            group: 'DeArrow', icon: 'settings-2', dependsOn: 'deArrow', init() {}, destroy() {}
        },
        {
            id: 'daTitleFormat', name: 'Title Format', description: 'How to format replacement titles',
            group: 'DeArrow', icon: 'settings-2', type: 'select', dependsOn: 'deArrow',
            options: { 'sentence': 'Sentence case', 'title_case': 'Title Case', 'original': 'As Submitted' },
            init() {}, destroy() {}
        },
        {
            id: 'daFallbackFormat', name: 'Format Original Titles', description: 'When no crowdsourced title exists, format the original title to your preferred case',
            group: 'DeArrow', icon: 'settings-2', dependsOn: 'deArrow', init() {}, destroy() {}
        },
        {
            id: 'daShowOriginalHover', name: 'Show Original on Hover', description: 'Hover over a title or thumbnail to briefly see the original',
            group: 'DeArrow', icon: 'settings-2', dependsOn: 'deArrow', init() {}, destroy() {}
        },
        {
            id: 'daCacheTTL', name: 'Cache Duration', description: 'Hours to cache branding data locally before refreshing (0 = no cache)',
            group: 'DeArrow', icon: 'settings-2', type: 'select', dependsOn: 'deArrow',
            options: { '0': 'Disabled', '1': '1 hour', '4': '4 hours', '12': '12 hours', '24': '24 hours', '72': '3 days' },
            init() {}, destroy() {}
        },
        {
            id: 'daDebugLog', name: 'Debug Logging', description: 'Enable verbose DeArrow console logging for troubleshooting',
            group: 'DeArrow', icon: 'settings-2', dependsOn: 'deArrow', init() {}, destroy() {}
        },
        {
            id: 'cfLlmProvider', name: 'Chapter AI Provider', description: 'Built-in (local heuristic), Browser AI (local LLM via Transformers.js), or cloud providers',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'builtin': 'Built-in (NLP)', 'ollama': 'Local AI (Ollama)', 'openai': 'Web AI - OpenAI', 'openrouter': 'Web AI - OpenRouter', 'custom': 'Web AI - Custom' },
            init() {}, destroy() {}
        },
        {
            id: 'cfTranscriptMethod', name: 'Transcript Source', description: 'How to get the video transcript: captions, Whisper (in-browser), or WhisperServer (local GPU-accelerated transcription)',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'auto': 'Auto (Captions -> Whisper)', 'captions-only': 'Captions Only', 'whisper-only': 'Whisper Only (Browser)', 'vibe': 'WhisperServer (Local)' },
            init() {}, destroy() {}
        },
        {
            id: 'cfVibeEndpoint', name: 'WhisperServer Address', description: 'HTTP endpoint for local whisper.cpp server. Auto-starts on login if installed via the YTYT installer.',
            group: 'ChapterForge', icon: 'settings-2', type: 'text', dependsOn: 'chapterForge',
            placeholder: 'http://localhost:8178',
            init() {}, destroy() {}
        },
        {
            id: 'cfWhisperModel', name: 'Whisper Model', description: 'Speech-to-text model size — Tiny is fast, Base is more accurate',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'whisper-tiny.en': 'Tiny (fastest, ~75MB)', 'whisper-base.en': 'Base (better, ~150MB)' },
            init() {}, destroy() {}
        },
        {
            id: 'cfMaxAutoDuration', name: 'Auto Max Duration', description: 'Maximum video length (minutes) for auto-processing in Auto mode',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { '15': '15 minutes', '30': '30 minutes', '60': '60 minutes', '120': '2 hours', '9999': 'No Limit' },
            init() {}, destroy() {}
        },
        {
            id: 'cfShowPlayerButton', name: 'Always Show Player Button', description: 'Show ChapterForge button on the player even in Auto mode',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfDebugLog', name: 'Debug Logging', description: 'Enable verbose console logging for transcript/audio troubleshooting',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfShowChapterHUD', name: 'Chapter HUD Overlay', description: 'Show current chapter name overlay on the video player during playback',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfHudPosition', name: 'HUD Position', description: 'Where to display the chapter HUD overlay on the video player',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'top-left': 'Top Left', 'top-right': 'Top Right', 'bottom-left': 'Bottom Left', 'bottom-right': 'Bottom Right' },
            init() {}, destroy() {}
        },
        {
            id: 'cfSpeedControl', name: 'Speed Control', description: 'Auto-speed intro/outro sections and skip selected chapters',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfAutoSkipMode', name: 'AutoSkip Mode', description: 'Skip pauses and filler words during playback (Gentle = long pauses, Normal = pauses + fillers, Aggressive = all gaps + speed silence)',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'off': 'Off', 'gentle': 'Gentle — long pauses', 'normal': 'Normal — pauses + fillers', 'aggressive': 'Aggressive — all gaps' },
            init() {}, destroy() {}
        },
        {
            id: 'cfShowChapters', name: 'Show Chapters on Bar', description: 'Display chapter markers on the YouTube progress bar',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfShowPOIs', name: 'Show POI Markers', description: 'Display points of interest markers on the progress bar',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfChapterOpacity', name: 'Chapter Opacity', description: 'Opacity of chapter overlay segments on the progress bar',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            settingKey: 'cfChapterOpacity',
            options: { '0.15': '15%', '0.25': '25%', '0.35': '35%', '0.5': '50%', '0.7': '70%' },
            init() {}, destroy() {}
        },
        {
            id: 'cfShowFillerMarkers', name: 'Show Filler Markers', description: 'Display detected filler word markers on the progress bar',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfFillerWords', name: 'Filler Words', description: 'Comma-separated list of filler words/phrases to detect and optionally skip',
            group: 'ChapterForge', icon: 'settings-2', type: 'textarea', dependsOn: 'chapterForge',
            placeholder: 'um, uh, you know, I mean, like, sort of',
            init() {}, destroy() {}
        },
        {
            id: 'cfSummaryMode', name: 'Summary Mode', description: 'Format for AI-generated summaries — clean prose or timestamped index',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'paragraph': 'Paragraph (clean prose)', 'timestamped': 'Timestamped Index' },
            init() {}, destroy() {}
        },
        {
            id: 'cfAutoModel', name: 'Auto-select Ollama Model', description: 'Automatically pick the best installed Ollama model for the video length',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfUseInnertube', name: 'Audio: Innertube', description: 'Use YouTube Innertube API for direct audio extraction (for Whisper)',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfUseCobalt', name: 'Audio: Cobalt API', description: 'Use Cobalt API as fallback for audio extraction (for Whisper)',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfUseCapture', name: 'Audio: Player Capture', description: 'Capture audio directly from the video player element (for Whisper)',
            group: 'ChapterForge', icon: 'settings-2', dependsOn: 'chapterForge', init() {}, destroy() {}
        },
        {
            id: 'cfCustomSummaryPrompt', name: 'Custom Summary Prompt', description: 'Override the default AI system prompt for summaries (leave empty for default)',
            group: 'ChapterForge', icon: 'settings-2', type: 'textarea', dependsOn: 'chapterForge',
            placeholder: 'Leave empty to use default prompt...',
            init() {}, destroy() {}
        },
        {
            id: 'cfCustomChapterPrompt', name: 'Custom Chapter Prompt', description: 'Override the default AI system prompt for chapter generation (leave empty for default)',
            group: 'ChapterForge', icon: 'settings-2', type: 'textarea', dependsOn: 'chapterForge',
            placeholder: 'Leave empty to use default prompt...',
            init() {}, destroy() {}
        },
        {
            id: 'cfBrowserAiModel', name: 'Browser AI Model', description: 'Local LLM model for chapter generation (requires Browser AI provider)',
            group: 'ChapterForge', icon: 'settings-2', type: 'select', dependsOn: 'chapterForge',
            options: { 'SmolLM2-360M-Instruct': 'SmolLM2 360M (fast)', 'Qwen2.5-0.5B-Instruct': 'Qwen2.5 0.5B (better)', 'Llama-3.2-1B-Instruct': 'Llama 3.2 1B (best)' },
            init() {}, destroy() {}
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

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 3: HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    function applyBotFilter() {
        if (!window.location.pathname.startsWith('/watch')) return;
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
        if (!window.location.pathname.startsWith('/watch')) return;
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

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 4: PREMIUM UI (Trusted Types Safe)
    // ══════════════════════════════════════════════════════════════════════════

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

    const ICONS = {
        settings: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 3 },
            { type: 'path', d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

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
            { type: 'path', d: 'M27.5 3.1s-.3-2.2-1.3-3.2C25.2-1 24.1-.1 23.6-.1 19.8 0 14 0 14 0S8.2 0 4.4-.1c-.5 0-1.6 0-2.6 1-1 .9-1.3 3.2-1.3 3.2S0 5.4 0 7.7v4.6c0 2.3.4 4.6.4 4.6s.3 2.2 1.3 3.2c1 .9 2.3 1 2.8 1.1 2.5.2 9.5.2 9.5.2s5.8 0 9.5-.2c.5-.1 1.8-0.2 2.8-1.1 1-.9 1.3-3.2 1.3-3.2s.4-2.3.4-4.6V7.7c0-2.3-.4-4.6-.4-4.6z', fill: '#FF0000' },
            { type: 'path', d: 'M11.2 14.6V5.4l8 4.6-8 4.6z', fill: 'white' }
        ], { stroke: false }),

        // Category icons
        interface: () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'path', d: 'M3 9h18' },
            { type: 'path', d: 'M9 21V9' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        appearance: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 5 },
            { type: 'path', d: 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        content: () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 2 },
            { type: 'line', x1: 7, y1: 2, x2: 7, y2: 22 },
            { type: 'line', x1: 17, y1: 2, x2: 17, y2: 22 },
            { type: 'line', x1: 2, y1: 12, x2: 22, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        player: () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'path', d: 'm10 8 5 3-5 3z' },
            { type: 'line', x1: 2, y1: 20, x2: 22, y2: 20 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        playback: () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 3 19 12 5 21 5 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        sponsor: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        shield: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
            { type: 'path', d: 'M9 12l2 2 4-4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        quality: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8' },
            { type: 'circle', cx: 12, cy: 12, r: 4 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        clutter: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' },
            { type: 'path', d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' },
            { type: 'line', x1: 10, y1: 11, x2: 10, y2: 17 },
            { type: 'line', x1: 14, y1: 11, x2: 14, y2: 17 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        livechat: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
            { type: 'circle', cx: 12, cy: 10, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 8, cy: 10, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 16, cy: 10, r: 1, fill: 'currentColor' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        actions: () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'path', d: 'M12 8v4l3 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

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
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        advanced: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2L2 7l10 5 10-5-10-5z' },
            { type: 'path', d: 'M2 17l10 5 10-5' },
            { type: 'path', d: 'M2 12l10 5 10-5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        downloads: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
            { type: 'polyline', points: '7 10 12 15 17 10' },
            { type: 'line', x1: 12, y1: 15, x2: 12, y2: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'list-plus': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 8, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 8, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 8, y1: 18, x2: 21, y2: 18 },
            { type: 'circle', cx: 3, cy: 6, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 3, cy: 12, r: 1, fill: 'currentColor' },
            { type: 'circle', cx: 3, cy: 18, r: 1, fill: 'currentColor' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'list-video': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 10, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 10, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 10, y1: 18, x2: 21, y2: 18 },
            { type: 'polygon', points: '3 6 7 9 3 12 3 6', fill: 'currentColor' },
            { type: 'circle', cx: 5, cy: 18, r: 1.5, fill: 'currentColor' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        // Playback Enhancement Icons
        gauge: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
            { type: 'path', d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        brain: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.54' },
            { type: 'path', d: 'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.54' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'thumbs-down': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        progress: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M5 12h14' },
            { type: 'path', d: 'M12 5v14' },
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        bookmark: () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'minimize-2': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '4 14 10 14 10 20' },
            { type: 'polyline', points: '20 10 14 10 14 4' },
            { type: 'line', x1: 14, y1: 10, x2: 21, y2: 3 },
            { type: 'line', x1: 3, y1: 21, x2: 10, y2: 14 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'grid-3x3': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 3, y1: 9, x2: 21, y2: 9 },
            { type: 'line', x1: 3, y1: 15, x2: 21, y2: 15 },
            { type: 'line', x1: 9, y1: 3, x2: 9, y2: 21 },
            { type: 'line', x1: 15, y1: 3, x2: 15, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        // ─── Additional Feature Icons ───
        'eye-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bell-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M13.73 21a2 2 0 0 1-3.46 0' },
            { type: 'path', d: 'M18.63 13A17.89 17.89 0 0 1 18 8' },
            { type: 'path', d: 'M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14' },
            { type: 'path', d: 'M18 8a6 6 0 0 0-9.33-5' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bell-minus': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' },
            { type: 'path', d: 'M13.73 21a2 2 0 0 1-3.46 0' },
            { type: 'line', x1: 8, y1: 2, x2: 16, y2: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'moon': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'sun-dim': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 4 },
            { type: 'path', d: 'M12 4h.01M12 20h.01M4 12h.01M20 12h.01M6.34 6.34h.01M17.66 6.34h.01M6.34 17.66h.01M17.66 17.66h.01' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'contrast': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'path', d: 'M12 2v20' },
            { type: 'path', d: 'M12 2a10 10 0 0 1 0 20', fill: 'currentColor' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'palette': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 13.5, cy: 6.5, r: 0.5, fill: 'currentColor' },
            { type: 'circle', cx: 17.5, cy: 10.5, r: 0.5, fill: 'currentColor' },
            { type: 'circle', cx: 8.5, cy: 7.5, r: 0.5, fill: 'currentColor' },
            { type: 'circle', cx: 6.5, cy: 12.5, r: 0.5, fill: 'currentColor' },
            { type: 'path', d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'square': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'user-square': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'circle', cx: 12, cy: 10, r: 3 },
            { type: 'path', d: 'M7 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'droplet-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2v5' },
            { type: 'path', d: 'M6.8 11.2A6 6 0 0 0 12 22a6 6 0 0 0 5.3-8.8' },
            { type: 'path', d: 'M12 2l3.5 5.5' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'minimize': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 3v3a2 2 0 0 1-2 2H3' },
            { type: 'path', d: 'M21 8h-3a2 2 0 0 1-2-2V3' },
            { type: 'path', d: 'M3 16h3a2 2 0 0 1 2 2v3' },
            { type: 'path', d: 'M16 21v-3a2 2 0 0 1 2-2h3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'video-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8' },
            { type: 'path', d: 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'external-link': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
            { type: 'polyline', points: '15 3 21 3 21 9' },
            { type: 'line', x1: 10, y1: 14, x2: 21, y2: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pause': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 6, y: 4, width: 4, height: 16 },
            { type: 'rect', x: 14, y: 4, width: 4, height: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'maximize': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 3H5a2 2 0 0 0-2 2v3' },
            { type: 'path', d: 'M21 8V5a2 2 0 0 0-2-2h-3' },
            { type: 'path', d: 'M3 16v3a2 2 0 0 0 2 2h3' },
            { type: 'path', d: 'M16 21h3a2 2 0 0 0 2-2v-3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'layout': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 3, y1: 9, x2: 21, y2: 9 },
            { type: 'line', x1: 9, y1: 21, x2: 9, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'grid': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 7, height: 7 },
            { type: 'rect', x: 14, y: 3, width: 7, height: 7 },
            { type: 'rect', x: 14, y: 14, width: 7, height: 7 },
            { type: 'rect', x: 3, y: 14, width: 7, height: 7 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'badge': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'info-off': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 12, y1: 16, x2: 12, y2: 12 },
            { type: 'line', x1: 12, y1: 8, x2: 12.01, y2: 8 },
            { type: 'line', x1: 4, y1: 4, x2: 20, y2: 20 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'folder-video': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' },
            { type: 'polygon', points: '10 13 15 10.5 10 8 10 13' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'gamepad': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 6, y1: 12, x2: 10, y2: 12 },
            { type: 'line', x1: 8, y1: 10, x2: 8, y2: 14 },
            { type: 'line', x1: 15, y1: 13, x2: 15.01, y2: 13 },
            { type: 'line', x1: 18, y1: 11, x2: 18.01, y2: 11 },
            { type: 'rect', x: 2, y: 6, width: 20, height: 12, rx: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'lock': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 11, width: 18, height: 11, rx: 2 },
            { type: 'path', d: 'M7 11V7a5 5 0 0 1 10 0v4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'newspaper': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2' },
            { type: 'path', d: 'M18 14h-8M15 18h-5M10 6h8v4h-8V6Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'list-x': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 11, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 11, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 11, y1: 18, x2: 21, y2: 18 },
            { type: 'line', x1: 3, y1: 4, x2: 7, y2: 8 },
            { type: 'line', x1: 7, y1: 4, x2: 3, y2: 8 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'fullscreen': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '15 3 21 3 21 9' },
            { type: 'polyline', points: '9 21 3 21 3 15' },
            { type: 'polyline', points: '21 15 21 21 15 21' },
            { type: 'polyline', points: '3 9 3 3 9 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'panel-right': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 15, y1: 3, x2: 15, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'arrows-horizontal': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '18 8 22 12 18 16' },
            { type: 'polyline', points: '6 8 2 12 6 16' },
            { type: 'line', x1: 2, y1: 12, x2: 22, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'cast': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6' },
            { type: 'path', d: 'M2 12a9 9 0 0 1 8 8' },
            { type: 'path', d: 'M2 16a5 5 0 0 1 4 4' },
            { type: 'line', x1: 2, y1: 20, x2: 2.01, y2: 20 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'youtube': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z' },
            { type: 'polygon', points: '9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'file-minus': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 9, y1: 15, x2: 15, y2: 15 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'tv': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 7, width: 20, height: 15, rx: 2 },
            { type: 'polyline', points: '17 2 12 7 7 2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'align-horizontal-justify-center': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 5, width: 6, height: 14, rx: 2 },
            { type: 'rect', x: 16, y: 7, width: 6, height: 10, rx: 2 },
            { type: 'line', x1: 12, y1: 2, x2: 12, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pause-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 10, y1: 15, x2: 10, y2: 9 },
            { type: 'line', x1: 14, y1: 15, x2: 14, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'chevrons-down': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '7 13 12 18 17 13' },
            { type: 'polyline', points: '7 6 12 11 17 6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'plus-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 12, y1: 8, x2: 12, y2: 16 },
            { type: 'line', x1: 8, y1: 12, x2: 16, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'mic-off': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 },
            { type: 'path', d: 'M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6' },
            { type: 'path', d: 'M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23' },
            { type: 'line', x1: 12, y1: 19, x2: 12, y2: 23 },
            { type: 'line', x1: 8, y1: 23, x2: 16, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'home': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
            { type: 'polyline', points: '9 22 9 12 15 12 15 22' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'sidebar': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 9, y1: 3, x2: 9, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'skip-forward': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 4 15 12 5 20 5 4' },
            { type: 'line', x1: 19, y1: 5, x2: 19, y2: 19 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'thumbs-up': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'play-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'polygon', points: '10 8 16 12 10 16 10 8' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'monitor': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'line', x1: 8, y1: 21, x2: 16, y2: 21 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'monitor-play': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'polygon', points: '10 8 15 10 10 12 10 8' },
            { type: 'line', x1: 8, y1: 21, x2: 16, y2: 21 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'menu': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 3, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 3, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 3, y1: 18, x2: 21, y2: 18 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'hash': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 4, y1: 9, x2: 20, y2: 9 },
            { type: 'line', x1: 4, y1: 15, x2: 20, y2: 15 },
            { type: 'line', x1: 10, y1: 3, x2: 8, y2: 21 },
            { type: 'line', x1: 16, y1: 3, x2: 14, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'file-text': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 16, y1: 13, x2: 8, y2: 13 },
            { type: 'line', x1: 16, y1: 17, x2: 8, y2: 17 },
            { type: 'polyline', points: '10 9 9 9 8 9' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'info': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 12, y1: 16, x2: 12, y2: 12 },
            { type: 'line', x1: 12, y1: 8, x2: 12.01, y2: 8 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'link': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' },
            { type: 'path', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'music': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M9 18V5l12-2v13' },
            { type: 'circle', cx: 6, cy: 18, r: 3 },
            { type: 'circle', cx: 18, cy: 16, r: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'hard-drive-download': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2v8' },
            { type: 'path', d: 'm16 6-4 4-4-4' },
            { type: 'rect', x: 2, y: 14, width: 20, height: 8, rx: 2 },
            { type: 'line', x1: 6, y1: 18, x2: 6.01, y2: 18 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'zap-off': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '12.41 6.75 13 2 10.57 4.92' },
            { type: 'polyline', points: '18.57 12.91 21 10 15.66 10' },
            { type: 'polyline', points: '8 8 3 14 12 14 11 22 16 16' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'trophy': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6' },
            { type: 'path', d: 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18' },
            { type: 'path', d: 'M4 22h16' },
            { type: 'path', d: 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22' },
            { type: 'path', d: 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22' },
            { type: 'path', d: 'M18 2H6v7a6 6 0 0 0 12 0V2Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'trending-up': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '23 6 13.5 15.5 8.5 10.5 1 18' },
            { type: 'polyline', points: '17 6 23 6 23 12' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'timer': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 14, r: 8 },
            { type: 'line', x1: 12, y1: 14, x2: 12, y2: 10 },
            { type: 'line', x1: 12, y1: 2, x2: 12, y2: 4 },
            { type: 'line', x1: 8, y1: 2, x2: 16, y2: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'ticket': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z' },
            { type: 'path', d: 'M13 5v2' },
            { type: 'path', d: 'M13 17v2' },
            { type: 'path', d: 'M13 11v2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'users': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
            { type: 'circle', cx: 9, cy: 7, r: 4 },
            { type: 'path', d: 'M23 21v-2a4 4 0 0 0-3-3.87' },
            { type: 'path', d: 'M16 3.13a4 4 0 0 1 0 7.75' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'users-x': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
            { type: 'circle', cx: 9, cy: 7, r: 4 },
            { type: 'line', x1: 18, y1: 8, x2: 23, y2: 13 },
            { type: 'line', x1: 23, y1: 8, x2: 18, y2: 13 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'award': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 8, r: 6 },
            { type: 'path', d: 'M15.477 12.89 17 22l-5-3-5 3 1.523-9.11' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bar-chart': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 12, y1: 20, x2: 12, y2: 10 },
            { type: 'line', x1: 18, y1: 20, x2: 18, y2: 4 },
            { type: 'line', x1: 6, y1: 20, x2: 6, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bell-ring': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' },
            { type: 'path', d: 'M13.73 21a2 2 0 0 1-3.46 0' },
            { type: 'path', d: 'M2 8c0-2.2.7-4.3 2-6' },
            { type: 'path', d: 'M22 8a10 10 0 0 0-2-6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bot': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 11, width: 18, height: 10, rx: 2 },
            { type: 'circle', cx: 12, cy: 5, r: 2 },
            { type: 'path', d: 'M12 7v4' },
            { type: 'line', x1: 8, y1: 16, x2: 8, y2: 16 },
            { type: 'line', x1: 16, y1: 16, x2: 16, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'captions-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.5 5H19a2 2 0 0 1 2 2v8.5' },
            { type: 'path', d: 'M17 11h-.5' },
            { type: 'path', d: 'M19 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2' },
            { type: 'path', d: 'M2 2 22 22' },
            { type: 'path', d: 'M7 11h4' },
            { type: 'path', d: 'M7 15h2.5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'clapperboard': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8H4Z' },
            { type: 'path', d: 'm4 11-.88-2.87a2 2 0 0 1 1.33-2.5l11.48-3.5a2 2 0 0 1 2.5 1.32l.87 2.87L4 11.01Z' },
            { type: 'path', d: 'm6.6 4.99 3.38 4.2' },
            { type: 'path', d: 'm11.86 3.38 3.38 4.2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'clock': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'polyline', points: '12 6 12 12 16 14' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'dollar-sign': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 12, y1: 2, x2: 12, y2: 22 },
            { type: 'path', d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'download-cloud': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' },
            { type: 'path', d: 'M12 12v9' },
            { type: 'path', d: 'm8 17 4 4 4-4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'filter': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'file-x': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 9.5, y1: 12.5, x2: 14.5, y2: 17.5 },
            { type: 'line', x1: 14.5, y1: 12.5, x2: 9.5, y2: 17.5 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'flag-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 2c3 0 5 2 8 2s4-1 4-1v11' },
            { type: 'path', d: 'M4 22V4' },
            { type: 'path', d: 'M4 15s1-1 4-1 5 2 8 2' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'gift': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 8, width: 18, height: 4, rx: 1 },
            { type: 'path', d: 'M12 8v13' },
            { type: 'path', d: 'M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7' },
            { type: 'path', d: 'M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'heart': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'heart-off': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 },
            { type: 'path', d: 'M16.5 16.5 12 21l-7-7c-1.5-1.45-3-3.2-3-5.5a5.5 5.5 0 0 1 2.14-4.35' },
            { type: 'path', d: 'M8.76 3.1c1.15.22 2.13.78 3.24 1.9 1.5-1.5 2.74-2 4.5-2A5.5 5.5 0 0 1 22 8.5c0 2.12-1.3 3.78-2.67 5.17' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'layout-grid': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'list-tree': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 12h-8' },
            { type: 'path', d: 'M21 6H8' },
            { type: 'path', d: 'M21 18h-8' },
            { type: 'path', d: 'M3 6v4c0 1.1.9 2 2 2h3' },
            { type: 'path', d: 'M3 10v6c0 1.1.9 2 2 2h3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'megaphone-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M9.26 9.26 3 11v3l14.14 3.14' },
            { type: 'path', d: 'M21 15.34V6l-7.31 2.03' },
            { type: 'path', d: 'M11.6 16.8a3 3 0 1 1-5.8-1.6' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'message-circle-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M20.5 14.9A9 9 0 0 0 9.1 3.5' },
            { type: 'path', d: 'M5.5 5.5A9 9 0 0 0 3 12c0 .78.1 1.53.28 2.25a9 9 0 0 0 .61 1.6l-1.7 5.47a.5.5 0 0 0 .61.63l5.58-1.48c.48.27.99.49 1.52.66' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'message-square': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'message-square-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15V5a2 2 0 0 0-2-2H9' },
            { type: 'path', d: 'M3 3l18 18' },
            { type: 'path', d: 'M3 6v15l4-4h5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'more-horizontal': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 1 },
            { type: 'circle', cx: 19, cy: 12, r: 1 },
            { type: 'circle', cx: 5, cy: 12, r: 1 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'more-vertical': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 1 },
            { type: 'circle', cx: 12, cy: 5, r: 1 },
            { type: 'circle', cx: 12, cy: 19, r: 1 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'panel-top': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 3, y1: 9, x2: 21, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'picture-in-picture': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'rect', x: 12, y: 12, width: 8, height: 6 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pip': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'rect', x: 12, y: 12, width: 8, height: 6 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pin-off': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 22 },
            { type: 'path', d: 'M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12' },
            { type: 'path', d: 'M15 9.34V6h1a2 2 0 0 0 0-4H7.89' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'play': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 3 19 12 5 21 5 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'repeat': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'm17 2 4 4-4 4' },
            { type: 'path', d: 'M3 11v-1a4 4 0 0 1 4-4h14' },
            { type: 'path', d: 'm7 22-4-4 4-4' },
            { type: 'path', d: 'M21 13v1a4 4 0 0 1-4 4H3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'scissors': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 6, cy: 6, r: 3 },
            { type: 'circle', cx: 6, cy: 18, r: 3 },
            { type: 'line', x1: 20, y1: 4, x2: 8.12, y2: 15.88 },
            { type: 'line', x1: 14.47, y1: 14.48, x2: 20, y2: 20 },
            { type: 'line', x1: 8.12, y1: 8.12, x2: 12, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'scroll-text': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4' },
            { type: 'path', d: 'M19 17V5a2 2 0 0 0-2-2H4' },
            { type: 'path', d: 'M15 8h-5' },
            { type: 'path', d: 'M15 12h-5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'settings-2': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M20 7h-9' },
            { type: 'path', d: 'M14 17H5' },
            { type: 'circle', cx: 17, cy: 17, r: 3 },
            { type: 'circle', cx: 7, cy: 7, r: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'share': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 18, cy: 5, r: 3 },
            { type: 'circle', cx: 6, cy: 12, r: 3 },
            { type: 'circle', cx: 18, cy: 19, r: 3 },
            { type: 'line', x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 },
            { type: 'line', x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'shield-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M19.7 14a6.9 6.9 0 0 0 .3-2V5l-8-3-3.2 1.2' },
            { type: 'path', d: 'M4.7 4.7 4 5v7c0 6 8 10 8 10a20.3 20.3 0 0 0 5.62-4.38' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'shopping-bag': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z' },
            { type: 'line', x1: 3, y1: 6, x2: 21, y2: 6 },
            { type: 'path', d: 'M16 10a4 4 0 0 1-8 0' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'smile': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'path', d: 'M8 14s1.5 2 4 2 4-2 4-2' },
            { type: 'line', x1: 9, y1: 9, x2: 9.01, y2: 9 },
            { type: 'line', x1: 15, y1: 9, x2: 15.01, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'smile-plus': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M22 11v1a10 10 0 1 1-9-10' },
            { type: 'path', d: 'M8 14s1.5 2 4 2 4-2 4-2' },
            { type: 'line', x1: 9, y1: 9, x2: 9.01, y2: 9 },
            { type: 'line', x1: 15, y1: 9, x2: 15.01, y2: 9 },
            { type: 'path', d: 'M16 5h6' },
            { type: 'path', d: 'M19 2v6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'sparkles': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z' },
            { type: 'path', d: 'M5 3v4' },
            { type: 'path', d: 'M19 17v4' },
            { type: 'path', d: 'M3 5h4' },
            { type: 'path', d: 'M17 19h4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'square-x': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 9, y1: 9, x2: 15, y2: 15 },
            { type: 'line', x1: 15, y1: 9, x2: 9, y2: 15 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'subtitles': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'line', x1: 6, y1: 12, x2: 9, y2: 12 },
            { type: 'line', x1: 6, y1: 16, x2: 13, y2: 16 },
            { type: 'line', x1: 12, y1: 12, x2: 18, y2: 12 },
            { type: 'line', x1: 16, y1: 16, x2: 18, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'tag-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.02 2.03 2.03 10.02a2 2 0 0 0 0 2.83l8.12 8.12a2 2 0 0 0 2.83 0l8.01-8.01a2.02 2.02 0 0 0 .38-2.29' },
            { type: 'path', d: 'M7.5 7.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0Z' },
            { type: 'path', d: 'M21.95 12.05 12.05 21.95' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        // Keyboard/debug icons
        'keyboard': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'line', x1: 6, y1: 8, x2: 6, y2: 8 },
            { type: 'line', x1: 10, y1: 8, x2: 10, y2: 8 },
            { type: 'line', x1: 14, y1: 8, x2: 14, y2: 8 },
            { type: 'line', x1: 18, y1: 8, x2: 18, y2: 8 },
            { type: 'line', x1: 8, y1: 12, x2: 8, y2: 12 },
            { type: 'line', x1: 12, y1: 12, x2: 12, y2: 12 },
            { type: 'line', x1: 16, y1: 12, x2: 16, y2: 12 },
            { type: 'line', x1: 7, y1: 16, x2: 17, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bug': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 8, y: 6, width: 8, height: 14, rx: 4 },
            { type: 'path', d: 'M19 7l-3 2' },
            { type: 'path', d: 'M5 7l3 2' },
            { type: 'path', d: 'M19 19l-3-2' },
            { type: 'path', d: 'M5 19l3-2' },
            { type: 'path', d: 'M20 13h-4' },
            { type: 'path', d: 'M4 13h4' },
            { type: 'path', d: 'M10 4l1 2' },
            { type: 'path', d: 'M14 4l-1 2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'undo': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 7v6h6' },
            { type: 'path', d: 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'camera': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M23 19a2 2 0 01-2-2V7a2 2 0 00-2-2h-4l-2-2H9L7 5H3a2 2 0 00-2 2v12a2 2 0 002 2h18z' },
            { type: 'circle', cx: 12, cy: 12, r: 4 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'film': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 2, width: 20, height: 20, rx: 2.18, ry: 2.18 },
            { type: 'line', x1: 7, y1: 2, x2: 7, y2: 22 },
            { type: 'line', x1: 17, y1: 2, x2: 17, y2: 22 },
            { type: 'line', x1: 2, y1: 12, x2: 22, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'volume-2': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' },
            { type: 'path', d: 'M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'arrow-down-up': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M11 17l-4 4-4-4M7 21V3M13 7l4-4 4 4M17 3v18' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'gauge': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 15l3.5-5' },
            { type: 'circle', cx: 12, cy: 15, r: 2 },
            { type: 'path', d: 'M2 12a10 10 0 0120 0' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bot-off': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 11, width: 18, height: 10, rx: 2 },
            { type: 'circle', cx: 9, cy: 16, r: 1 },
            { type: 'circle', cx: 15, cy: 16, r: 1 },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
        'palette': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 13.5, cy: 6.5, r: 0.5 },
            { type: 'circle', cx: 17.5, cy: 10.5, r: 0.5 },
            { type: 'circle', cx: 8.5, cy: 7.5, r: 0.5 },
            { type: 'circle', cx: 6.5, cy: 12, r: 0.5 },
            { type: 'path', d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.3-.3-.4-.7-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-10-10-10z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    };

    const CATEGORY_CONFIG = {
        'Interface': { icon: 'interface', color: '#60a5fa' },
        'Appearance': { icon: 'appearance', color: '#f472b6' },
        'Content': { icon: 'content', color: '#34d399' },
        'Video Hider': { icon: 'eye-off', color: '#ef4444' },
        'Video Player': { icon: 'player', color: '#a78bfa' },
        'Playback': { icon: 'playback', color: '#fb923c' },
        'Ad Blocker': { icon: 'shield', color: '#10b981' },
        'SponsorBlock': { icon: 'sponsor', color: '#22d3ee' },
        'Quality': { icon: 'quality', color: '#facc15' },
        'Clutter': { icon: 'clutter', color: '#f87171' },
        'Live Chat': { icon: 'livechat', color: '#4ade80' },
        'Action Buttons': { icon: 'actions', color: '#c084fc' },
        'Player Controls': { icon: 'controls', color: '#38bdf8' },
        'Downloads': { icon: 'downloads', color: '#f97316' },
        'ChapterForge': { icon: 'player', color: '#7c3aed' },
        'DeArrow': { icon: 'content', color: '#22d3ee' },
        'Advanced': { icon: 'advanced', color: '#94a3b8' },
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
                    const logo = document.getElementById('yt-suite-watch-logo');
                    if (logo && logo.parentElement === ownerDiv) {
                        ownerDiv.insertBefore(btn, logo.nextSibling);
                    } else {
                        ownerDiv.prepend(btn);
                    }
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

        const categoryOrder = ['Interface', 'Appearance', 'Content', 'Video Hider', 'Video Player', 'Playback', 'Ad Blocker', 'SponsorBlock', 'Quality', 'Clutter', 'Live Chat', 'Action Buttons', 'Player Controls', 'Downloads', 'ChapterForge', 'DeArrow', 'Advanced'];
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

        const logoWrap = document.createElement('div');
        logoWrap.className = 'ytkit-logo';
        logoWrap.appendChild(ICONS.ytLogo());

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

        brand.appendChild(logoWrap);
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

        categoryOrder.forEach((cat, index) => {
            // Special handling for Ad Blocker sidebar
            if (cat === 'Ad Blocker') {
                const config = CATEGORY_CONFIG[cat];
                const catId = cat.replace(/ /g, '-');
                const btn = document.createElement('button');
                btn.className = 'ytkit-nav-btn';
                btn.dataset.tab = catId;

                const iconWrap = document.createElement('span');
                iconWrap.className = 'ytkit-nav-icon';
                iconWrap.style.setProperty('--cat-color', config.color);
                iconWrap.appendChild((ICONS.shield || ICONS.settings)());

                const labelSpan = document.createElement('span');
                labelSpan.className = 'ytkit-nav-label';
                labelSpan.textContent = cat;

                const countSpan = document.createElement('span');
                countSpan.className = 'ytkit-nav-count';
                const st = _rw.__ytab?.stats;
                countSpan.textContent = st ? `${st.blocked}` : '0';
                countSpan.title = 'Ads blocked this session';
                // Live update
                setInterval(() => {
                    const s = _rw.__ytab?.stats;
                    if (s) countSpan.textContent = `${s.blocked}`;
                }, 3000);

                const arrowSpan = document.createElement('span');
                arrowSpan.className = 'ytkit-nav-arrow';
                arrowSpan.appendChild(ICONS.chevronRight());

                btn.appendChild(iconWrap);
                btn.appendChild(labelSpan);
                btn.appendChild(countSpan);
                btn.appendChild(arrowSpan);
                sidebar.appendChild(btn);
                return;
            }
            // Special handling for Video Hider
            if (cat === 'Video Hider') {
                const config = CATEGORY_CONFIG[cat];
                const catId = cat.replace(/ /g, '-');
                const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');
                const videoCount = (typeof videoHiderFeature?._getHiddenVideos === 'function' ? videoHiderFeature._getHiddenVideos() : []).length;
                const channelCount = (typeof videoHiderFeature?._getBlockedChannels === 'function' ? videoHiderFeature._getBlockedChannels() : []).length;

                const btn = document.createElement('button');
                btn.className = 'ytkit-nav-btn';
                btn.dataset.tab = catId;

                const iconWrap = document.createElement('span');
                iconWrap.className = 'ytkit-nav-icon';
                iconWrap.style.setProperty('--cat-color', config.color);
                const iconFn = ICONS['eye-off'] || ICONS.settings;
                iconWrap.appendChild(iconFn());

                const labelSpan = document.createElement('span');
                labelSpan.className = 'ytkit-nav-label';
                labelSpan.textContent = cat;

                const countSpan = document.createElement('span');
                countSpan.className = 'ytkit-nav-count';
                countSpan.textContent = `${videoCount + channelCount}`;
                countSpan.title = `${videoCount} videos, ${channelCount} channels`;

                const arrowSpan = document.createElement('span');
                arrowSpan.className = 'ytkit-nav-arrow';
                arrowSpan.appendChild(ICONS.chevronRight());

                btn.appendChild(iconWrap);
                btn.appendChild(labelSpan);
                btn.appendChild(countSpan);
                btn.appendChild(arrowSpan);

                sidebar.appendChild(btn);
                return;
            }

            const categoryFeatures = featuresByCategory[cat];
            if (!categoryFeatures || categoryFeatures.length === 0) return;

            const config = CATEGORY_CONFIG[cat] || { icon: 'settings', color: '#60a5fa' };
            const catId = cat.replace(/ /g, '-');
            const enabledCount = categoryFeatures.filter(f => !f.isSubFeature && appState.settings[f.id]).length;
            const totalCount = categoryFeatures.filter(f => !f.isSubFeature).length;

            const btn = document.createElement('button');
            btn.className = 'ytkit-nav-btn' + (index === 0 ? ' active' : '');
            btn.dataset.tab = catId;

            const iconWrap = document.createElement('span');
            iconWrap.className = 'ytkit-nav-icon';
            iconWrap.style.setProperty('--cat-color', config.color);
            const iconFn = ICONS[config.icon] || ICONS.settings;
            iconWrap.appendChild(iconFn());

            const labelSpan = document.createElement('span');
            labelSpan.className = 'ytkit-nav-label';
            labelSpan.textContent = cat;

            const countSpan = document.createElement('span');
            countSpan.className = 'ytkit-nav-count';
            countSpan.textContent = `${enabledCount}/${totalCount}`;

            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'ytkit-nav-arrow';
            arrowSpan.appendChild(ICONS.chevronRight());

            btn.appendChild(iconWrap);
            btn.appendChild(labelSpan);
            btn.appendChild(countSpan);
            btn.appendChild(arrowSpan);

            sidebar.appendChild(btn);
        });

        // Content
        const content = document.createElement('div');
        content.className = 'ytkit-content';

        // Special builder for Video Hider pane
        // ══════════════════════════════════════════════════════════════════
        //  Ad Blocker Custom Pane
        // ══════════════════════════════════════════════════════════════════
        function buildAdBlockPane(config) {
            const adblockFeature = features.find(f => f.id === 'ytAdBlock');
            const subFeatures = features.filter(f => f.parentId === 'ytAdBlock');

            const pane = document.createElement('section');
            pane.id = 'ytkit-pane-Ad-Blocker';
            pane.className = 'ytkit-pane';

            // ── Header ──
            const paneHeader = document.createElement('div');
            paneHeader.className = 'ytkit-pane-header';

            const paneTitle = document.createElement('div');
            paneTitle.className = 'ytkit-pane-title';

            const paneIcon = document.createElement('span');
            paneIcon.className = 'ytkit-pane-icon';
            paneIcon.style.setProperty('--cat-color', config.color);
            paneIcon.appendChild((ICONS.shield || ICONS.settings)());

            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = 'Ad Blocker';

            paneTitle.appendChild(paneIcon);
            paneTitle.appendChild(paneTitleH2);

            // Master toggle
            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'ytkit-toggle-all';
            toggleLabel.style.marginLeft = 'auto';

            const toggleText = document.createElement('span');
            toggleText.textContent = 'Enabled';

            const toggleSwitch = document.createElement('div');
            toggleSwitch.className = 'ytkit-switch' + (appState.settings.ytAdBlock ? ' active' : '');

            const toggleInput = document.createElement('input');
            toggleInput.type = 'checkbox';
            toggleInput.id = 'ytkit-toggle-ytAdBlock';
            toggleInput.checked = appState.settings.ytAdBlock;
            toggleInput.onchange = async () => {
                appState.settings.ytAdBlock = toggleInput.checked;
                toggleSwitch.classList.toggle('active', toggleInput.checked);
                settingsManager.save(appState.settings);
                if (toggleInput.checked) adblockFeature?.init?.(); else adblockFeature?.destroy?.();
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

            // ── Sub-feature toggles ──
            const subGrid = document.createElement('div');
            subGrid.className = 'ytkit-features-grid';
            subFeatures.forEach(sf => { subGrid.appendChild(buildFeatureCard(sf, config.color, true)); });
            pane.appendChild(subGrid);

            // ── Shared styles for this pane ──
            const sectionStyle = 'background:var(--ytkit-bg-elevated);border-radius:10px;padding:16px;margin-top:12px;';
            const labelStyle = 'font-size:13px;font-weight:600;color:var(--ytkit-text);margin-bottom:8px;display:flex;align-items:center;gap:6px;';
            const inputStyle = 'width:100%;background:var(--ytkit-bg-card);color:var(--ytkit-text);border:1px solid var(--ytkit-border);border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;transition:border-color 0.2s;';
            const btnStyle = `background:${config.color};color:#000;border:none;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity 0.2s;`;
            const btnSecStyle = 'background:var(--ytkit-bg-card);color:var(--ytkit-text);border:1px solid var(--ytkit-border);padding:8px 16px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;transition:opacity 0.2s;';

            // ── Stats Section ──
            const statsSection = document.createElement('div');
            statsSection.style.cssText = sectionStyle;

            const statsLabel = document.createElement('div');
            statsLabel.style.cssText = labelStyle;
            statsLabel.textContent = 'Session Stats';
            statsSection.appendChild(statsLabel);

            const statsGrid = document.createElement('div');
            statsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px;';

            function makeStat(label, valueGetter, color) {
                const box = document.createElement('div');
                box.style.cssText = 'background:var(--ytkit-bg-card);padding:12px;border-radius:8px;text-align:center;';
                const num = document.createElement('div');
                num.style.cssText = `font-size:22px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;`;
                num.textContent = valueGetter();
                num.dataset.statKey = label;
                const lbl = document.createElement('div');
                lbl.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);margin-top:4px;';
                lbl.textContent = label;
                box.appendChild(num);
                box.appendChild(lbl);
                return box;
            }

            const s = _rw.__ytab?.stats || { blocked: 0, pruned: 0, ssapSkipped: 0 };
            statsGrid.appendChild(makeStat('Ads Blocked', () => s.blocked, config.color));
            statsGrid.appendChild(makeStat('JSON Pruned', () => s.pruned, '#a78bfa'));
            statsGrid.appendChild(makeStat('SSAP Skipped', () => s.ssapSkipped, '#f59e0b'));
            statsSection.appendChild(statsGrid);

            // Auto-refresh stats
            let statsInterval = null;
            const refreshStats = () => {
                const st = _rw.__ytab?.stats || { blocked: 0, pruned: 0, ssapSkipped: 0 };
                statsGrid.querySelectorAll('[data-stat-key]').forEach(el => {
                    const key = el.dataset.statKey;
                    if (key === 'Ads Blocked') el.textContent = st.blocked;
                    else if (key === 'JSON Pruned') el.textContent = st.pruned;
                    else if (key === 'SSAP Skipped') el.textContent = st.ssapSkipped;
                });
            };
            // Start/stop interval when pane is visible
            new MutationObserver(() => {
                if (pane.classList.contains('active')) {
                    refreshStats();
                    if (!statsInterval) statsInterval = setInterval(refreshStats, 2000);
                } else {
                    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
                }
            }).observe(pane, { attributes: true, attributeFilter: ['class'] });

            pane.appendChild(statsSection);

            // ── Filter List Management ──
            const filterSection = document.createElement('div');
            filterSection.style.cssText = sectionStyle;

            const filterLabel = document.createElement('div');
            filterLabel.style.cssText = labelStyle;
            filterLabel.textContent = 'Remote Filter List';
            filterSection.appendChild(filterLabel);

            // URL row
            const urlRow = document.createElement('div');
            urlRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.style.cssText = inputStyle + 'flex:1;';
            urlInput.value = appState.settings.adblockFilterUrl || '';
            urlInput.placeholder = 'Filter list URL (.txt format)';
            urlInput.spellcheck = false;

            const saveUrlBtn = document.createElement('button');
            saveUrlBtn.style.cssText = btnSecStyle;
            saveUrlBtn.textContent = 'Save';
            saveUrlBtn.onclick = async () => {
                appState.settings.adblockFilterUrl = urlInput.value.trim();
                settingsManager.save(appState.settings);
                createToast('Filter URL saved', 'success');
            };

            urlRow.appendChild(urlInput);
            urlRow.appendChild(saveUrlBtn);
            filterSection.appendChild(urlRow);

            // Info + Update row
            const infoRow = document.createElement('div');
            infoRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:10px;';

            const filterInfo = document.createElement('div');
            filterInfo.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);';
            const cachedTime = GM_getValue('ytab_filter_update_time', 0);
            const cachedCount = GM_getValue('ytab_cached_selector_count', 0);
            filterInfo.textContent = cachedTime
                ? `${cachedCount} selectors | Updated ${new Date(cachedTime).toLocaleString()}`
                : 'No filters loaded yet';

            const updateBtn = document.createElement('button');
            updateBtn.style.cssText = btnStyle;
            updateBtn.textContent = 'Update Filters';
            updateBtn.onclick = () => {
                updateBtn.textContent = 'Fetching...';
                updateBtn.style.opacity = '0.6';
                const url = (appState.settings.adblockFilterUrl || '').trim();
                if (!url) { createToast('No filter URL set', 'error'); updateBtn.textContent = 'Update Filters'; updateBtn.style.opacity = '1'; return; }

                GM.xmlHttpRequest({
                    method: 'GET',
                    url: url + '?_=' + Date.now(),
                    timeout: 15000,
                    onload(resp) {
                        if (resp.status >= 200 && resp.status < 400) {
                            const text = resp.responseText || '';
                            const selectors = _rw.__ytab?.parseFilterList?.(text) || [];
                            const selectorStr = selectors.join(',\n');
                            GM_setValue('ytab_cached_selectors', selectorStr);
                            GM_setValue('ytab_filter_update_time', Date.now());
                            GM_setValue('ytab_cached_selector_count', selectors.length);
                            GM_setValue('ytab_raw_filters', text);
                            // Apply live
                            const custom = GM_getValue('ytab_custom_filters', '');
                            const combined = [selectorStr, custom].filter(Boolean).join(',\n');
                            _rw.__ytab?.updateCSS?.(combined);
                            filterInfo.textContent = `${selectors.length} selectors | Updated ${new Date().toLocaleString()}`;
                            createToast(`Filters updated: ${selectors.length} cosmetic selectors parsed`, 'success');
                            // Refresh preview if open
                            if (previewArea.style.display !== 'none') renderPreview();
                        } else {
                            createToast(`Filter fetch failed: HTTP ${resp.status}`, 'error');
                        }
                        updateBtn.textContent = 'Update Filters';
                        updateBtn.style.opacity = '1';
                    },
                    onerror() { createToast('Filter fetch failed (network error)', 'error'); updateBtn.textContent = 'Update Filters'; updateBtn.style.opacity = '1'; },
                    ontimeout() { createToast('Filter fetch timed out', 'error'); updateBtn.textContent = 'Update Filters'; updateBtn.style.opacity = '1'; }
                });
            };

            infoRow.appendChild(filterInfo);
            infoRow.appendChild(updateBtn);
            filterSection.appendChild(infoRow);

            // ── Bootstrap Status Indicator ──
            const statusRow = document.createElement('div');
            statusRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:10px;padding:8px 10px;background:var(--ytkit-bg-card);border-radius:6px;';
            const statusDot = document.createElement('span');
            const isActive = !!_rw.__ytab?.active;
            statusDot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${isActive ? config.color : '#ef4444'};flex-shrink:0;`;
            const statusText = document.createElement('span');
            statusText.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);';
            statusText.textContent = isActive
                ? 'Proxy engines active (installed at document-start)'
                : 'Proxies not installed - enable Ad Blocker and reload page';
            statusRow.appendChild(statusDot);
            statusRow.appendChild(statusText);
            filterSection.appendChild(statusRow);

            pane.appendChild(filterSection);

            // ── Custom Filters Section ──
            const customSection = document.createElement('div');
            customSection.style.cssText = sectionStyle;

            const customLabel = document.createElement('div');
            customLabel.style.cssText = labelStyle;
            customLabel.textContent = 'Custom Filters';

            const customHint = document.createElement('span');
            customHint.style.cssText = 'font-weight:400;color:var(--ytkit-text-muted);font-size:11px;';
            customHint.textContent = '(CSS selectors, one per line)';
            customLabel.appendChild(customHint);
            customSection.appendChild(customLabel);

            const customTextarea = document.createElement('textarea');
            customTextarea.style.cssText = inputStyle + 'min-height:100px;resize:vertical;font-family:"Cascadia Code","Fira Code",monospace;font-size:12px;line-height:1.5;';
            customTextarea.value = (GM_getValue('ytab_custom_filters', '') || '').replace(/,\n/g, '\n').replace(/,/g, '\n');
            customTextarea.placeholder = 'ytd-merch-shelf-renderer\n.ytp-ad-overlay-slot\n#custom-ad-element';
            customTextarea.spellcheck = false;

            customSection.appendChild(customTextarea);

            const customBtnRow = document.createElement('div');
            customBtnRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

            const saveCustomBtn = document.createElement('button');
            saveCustomBtn.style.cssText = btnStyle;
            saveCustomBtn.textContent = 'Apply Filters';
            saveCustomBtn.onclick = () => {
                const lines = customTextarea.value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!') && !l.startsWith('//'));
                const selectorStr = lines.join(',\n');
                GM_setValue('ytab_custom_filters', selectorStr);
                // Apply live
                const remote = GM_getValue('ytab_cached_selectors', '');
                const combined = [remote, selectorStr].filter(Boolean).join(',\n');
                _rw.__ytab?.updateCSS?.(combined);
                createToast(`${lines.length} custom filter${lines.length !== 1 ? 's' : ''} applied`, 'success');
            };

            const clearCustomBtn = document.createElement('button');
            clearCustomBtn.style.cssText = btnSecStyle;
            clearCustomBtn.textContent = 'Clear';
            clearCustomBtn.onclick = () => {
                customTextarea.value = '';
                GM_setValue('ytab_custom_filters', '');
                const remote = GM_getValue('ytab_cached_selectors', '');
                _rw.__ytab?.updateCSS?.(remote);
                createToast('Custom filters cleared', 'success');
            };

            customBtnRow.appendChild(saveCustomBtn);
            customBtnRow.appendChild(clearCustomBtn);
            customSection.appendChild(customBtnRow);
            pane.appendChild(customSection);

            // ── Active Filters Preview (collapsible) ──
            const previewSection = document.createElement('div');
            previewSection.style.cssText = sectionStyle;

            const previewHeader = document.createElement('div');
            previewHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;cursor:pointer;';

            const previewLabel = document.createElement('div');
            previewLabel.style.cssText = labelStyle + 'margin-bottom:0;';
            previewLabel.textContent = 'Active Filters Preview';

            const previewToggle = document.createElement('span');
            previewToggle.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);';
            previewToggle.textContent = 'Show';

            previewHeader.appendChild(previewLabel);
            previewHeader.appendChild(previewToggle);

            const previewArea = document.createElement('pre');
            previewArea.style.cssText = 'display:none;margin-top:10px;padding:10px;background:var(--ytkit-bg-card);border-radius:6px;font-size:11px;color:var(--ytkit-text-muted);font-family:"Cascadia Code","Fira Code",monospace;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;line-height:1.6;';

            function renderPreview() {
                const remote = (GM_getValue('ytab_cached_selectors', '') || '').split(',\n').filter(Boolean);
                const custom = (GM_getValue('ytab_custom_filters', '') || '').split(',\n').filter(Boolean);
                let text = '';
                if (remote.length) text += `/* Remote (${remote.length}) */\n` + remote.join('\n') + '\n\n';
                if (custom.length) text += `/* Custom (${custom.length}) */\n` + custom.join('\n');
                if (!text) text = 'No filters loaded. Click "Update Filters" to fetch from remote URL.';
                previewArea.textContent = text;
            }

            previewHeader.onclick = () => {
                const showing = previewArea.style.display !== 'none';
                previewArea.style.display = showing ? 'none' : 'block';
                previewToggle.textContent = showing ? 'Show' : 'Hide';
                if (!showing) renderPreview();
            };

            previewSection.appendChild(previewHeader);
            previewSection.appendChild(previewArea);
            pane.appendChild(previewSection);

            return pane;
        }

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

            const paneIcon = document.createElement('span');
            paneIcon.className = 'ytkit-pane-icon';
            paneIcon.style.setProperty('--cat-color', config.color);
            const paneIconFn = ICONS['eye-off'] || ICONS.settings;
            paneIcon.appendChild(paneIconFn());

            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = 'Video Hider';

            paneTitle.appendChild(paneIcon);
            paneTitle.appendChild(paneTitleH2);

            // Enable toggle for Video Hider
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
                if (toggleInput.checked) {
                    videoHiderFeature?.init?.();
                } else {
                    videoHiderFeature?.destroy?.();
                }
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
            tabNav.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--ytkit-border);margin-bottom:20px;';

            const tabs = ['Videos', 'Channels', 'Keywords', 'Settings'];
            tabs.forEach((tabName, i) => {
                const tab = document.createElement('button');
                tab.className = 'ytkit-vh-tab' + (i === 0 ? ' active' : '');
                tab.dataset.tab = tabName.toLowerCase();
                tab.textContent = tabName;
                tab.style.cssText = `
                    flex:1;padding:12px 16px;background:transparent;border:none;
                    color:var(--ytkit-text-muted);font-size:13px;font-weight:500;
                    cursor:pointer;transition:all 0.2s;border-bottom:2px solid transparent;
                `;
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
                if (i === 0) {
                    tab.style.color = config.color;
                    tab.style.borderBottomColor = config.color;
                }
                tabNav.appendChild(tab);
            });
            pane.appendChild(tabNav);

            // Tab content container
            const tabContent = document.createElement('div');
            tabContent.id = 'ytkit-vh-content';
            pane.appendChild(tabContent);

            function renderTabContent(tab) {
                while (tabContent.firstChild) tabContent.removeChild(tabContent.firstChild);

                if (tab === 'videos') {
                    const videos = videoHiderFeature?._getHiddenVideos() || [];
                    if (videos.length === 0) {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--ytkit-text-muted);';

                        const emptyIcon = document.createElement('div');
                        emptyIcon.style.cssText = 'font-size:48px;margin-bottom:16px;opacity:0.5;';
                        emptyIcon.textContent = '📺';

                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:15px;margin-bottom:8px;';
                        emptyTitle.textContent = 'No hidden videos yet';

                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:13px;opacity:0.7;';
                        emptyDesc.textContent = 'Click the X button on video thumbnails to hide them';

                        empty.appendChild(emptyIcon);
                        empty.appendChild(emptyTitle);
                        empty.appendChild(emptyDesc);
                        tabContent.appendChild(empty);
                    } else {
                        const grid = document.createElement('div');
                        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;';

                        videos.forEach(vid => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;background:var(--ytkit-bg-surface);border-radius:8px;border:1px solid var(--ytkit-border);';

                            const thumb = document.createElement('img');
                            thumb.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
                            thumb.style.cssText = 'width:100px;height:56px;object-fit:cover;border-radius:4px;flex-shrink:0;';
                            thumb.onerror = () => { thumb.style.background = 'var(--ytkit-bg-elevated)'; };

                            const info = document.createElement('div');
                            info.style.cssText = 'flex:1;min-width:0;';
                            const vidId = document.createElement('div');
                            vidId.style.cssText = 'font-size:12px;color:var(--ytkit-text-secondary);font-family:monospace;margin-bottom:4px;';
                            vidId.textContent = vid;
                            const link = document.createElement('a');
                            link.href = `https://youtube.com/watch?v=${vid}`;
                            link.target = '_blank';
                            link.style.cssText = 'font-size:12px;color:var(--ytkit-accent);text-decoration:none;';
                            link.textContent = 'View on YouTube →';
                            info.appendChild(vidId);
                            info.appendChild(link);

                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unhide';
                            removeBtn.style.cssText = 'padding:6px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);color:var(--ytkit-text-secondary);border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s;';
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

                        // Clear all button
                        const clearBtn = document.createElement('button');
                        clearBtn.textContent = `Clear All Hidden Videos (${videos.length})`;
                        clearBtn.style.cssText = 'margin-top:20px;padding:12px 24px;width:100%;background:#dc2626;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;transition:background 0.2s;';
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
                        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--ytkit-text-muted);';

                        const emptyIcon = document.createElement('div');
                        emptyIcon.style.cssText = 'font-size:48px;margin-bottom:16px;opacity:0.5;';
                        emptyIcon.textContent = '📢';

                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:15px;margin-bottom:8px;';
                        emptyTitle.textContent = 'No blocked channels yet';

                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:13px;opacity:0.7;';
                        emptyDesc.textContent = 'Right-click the X button on thumbnails to block channels';

                        empty.appendChild(emptyIcon);
                        empty.appendChild(emptyTitle);
                        empty.appendChild(emptyDesc);
                        tabContent.appendChild(empty);
                    } else {
                        const list = document.createElement('div');
                        list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

                        channels.forEach(ch => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;background:var(--ytkit-bg-surface);border-radius:8px;border:1px solid var(--ytkit-border);';

                            const icon = document.createElement('div');
                            icon.style.cssText = 'width:40px;height:40px;border-radius:50%;background:var(--ytkit-bg-elevated);display:flex;align-items:center;justify-content:center;font-size:18px;';
                            icon.textContent = '📺';

                            const info = document.createElement('div');
                            info.style.cssText = 'flex:1;';
                            const name = document.createElement('div');
                            name.style.cssText = 'font-size:14px;color:var(--ytkit-text-primary);font-weight:500;';
                            name.textContent = ch.name || ch.id;
                            const handle = document.createElement('div');
                            handle.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);';
                            handle.textContent = ch.id;
                            info.appendChild(name);
                            info.appendChild(handle);

                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unblock';
                            removeBtn.style.cssText = 'padding:6px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);color:var(--ytkit-text-secondary);border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s;';
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

                        // Clear all button
                        const clearBtn = document.createElement('button');
                        clearBtn.textContent = `Unblock All Channels (${channels.length})`;
                        clearBtn.style.cssText = 'margin-top:20px;padding:12px 24px;width:100%;background:#dc2626;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;transition:background 0.2s;';
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
                    container.style.cssText = 'padding:0;';

                    const desc = document.createElement('div');
                    desc.style.cssText = 'color:var(--ytkit-text-muted);font-size:13px;margin-bottom:16px;line-height:1.5;';
                    desc.textContent = 'Videos with titles containing these keywords will be automatically hidden. Separate multiple keywords with commas.';
                    container.appendChild(desc);

                    const textarea = document.createElement('textarea');
                    textarea.style.cssText = 'width:100%;min-height:150px;padding:12px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:8px;color:var(--ytkit-text-primary);font-size:13px;resize:vertical;font-family:inherit;';
                    textarea.placeholder = 'e.g., reaction, unboxing, prank, shorts';
                    textarea.value = appState.settings.hideVideosKeywordFilter || '';
                    textarea.onchange = async () => {
                        appState.settings.hideVideosKeywordFilter = textarea.value;
                        settingsManager.save(appState.settings);
                        videoHiderFeature?._processAllVideos();
                    };
                    container.appendChild(textarea);

                    const hint = document.createElement('div');
                    hint.style.cssText = 'color:var(--ytkit-text-muted);font-size:11px;margin-top:8px;';
                    hint.textContent = 'Changes apply immediately. Keywords are case-insensitive.';
                    container.appendChild(hint);

                    tabContent.appendChild(container);
                } else if (tab === 'settings') {
                    const container = document.createElement('div');
                    container.style.cssText = 'display:flex;flex-direction:column;gap:24px;';

                    // Duration filter
                    const durSection = document.createElement('div');
                    durSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:12px;padding:20px;';

                    const durTitle = document.createElement('div');
                    durTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:8px;';
                    durTitle.textContent = 'Duration Filter';
                    durSection.appendChild(durTitle);

                    const durDesc = document.createElement('div');
                    durDesc.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-bottom:12px;';
                    durDesc.textContent = 'Automatically hide videos shorter than the specified duration.';
                    durSection.appendChild(durDesc);

                    const durRow = document.createElement('div');
                    durRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

                    const durInput = document.createElement('input');
                    durInput.type = 'number';
                    durInput.min = '0';
                    durInput.max = '60';
                    durInput.value = appState.settings.hideVideosDurationFilter || 0;
                    durInput.style.cssText = 'width:80px;padding:8px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:6px;color:var(--ytkit-text-primary);font-size:14px;';
                    durInput.onchange = async () => {
                        appState.settings.hideVideosDurationFilter = parseInt(durInput.value) || 0;
                        settingsManager.save(appState.settings);
                        videoHiderFeature?._processAllVideos();
                    };

                    const durLabel = document.createElement('span');
                    durLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;';
                    durLabel.textContent = 'minutes (0 = disabled)';

                    durRow.appendChild(durInput);
                    durRow.appendChild(durLabel);
                    durSection.appendChild(durRow);
                    container.appendChild(durSection);

                    // Subscription Load Limiter
                    const limiterSection = document.createElement('div');
                    limiterSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:12px;padding:20px;';

                    const limiterTitle = document.createElement('div');
                    limiterTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:8px;';
                    limiterTitle.textContent = 'Subscription Page Load Limiter';
                    limiterSection.appendChild(limiterTitle);

                    const limiterDesc = document.createElement('div');
                    limiterDesc.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-bottom:16px;line-height:1.5;';
                    limiterDesc.textContent = 'Prevents infinite scrolling when many consecutive videos are hidden. Useful if you\'ve hidden years of subscription videos.';
                    limiterSection.appendChild(limiterDesc);

                    // Enable toggle
                    const limiterToggleRow = document.createElement('div');
                    limiterToggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding:12px;background:var(--ytkit-bg-elevated);border-radius:8px;';

                    const limiterToggleLabel = document.createElement('span');
                    limiterToggleLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;';
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

                    // Threshold setting
                    const thresholdRow = document.createElement('div');
                    thresholdRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

                    const thresholdLabel = document.createElement('span');
                    thresholdLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;flex:1;';
                    thresholdLabel.textContent = 'Stop after consecutive hidden batches:';

                    const thresholdInput = document.createElement('input');
                    thresholdInput.type = 'number';
                    thresholdInput.min = '1';
                    thresholdInput.max = '20';
                    thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold || 3;
                    thresholdInput.style.cssText = 'width:70px;padding:8px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:6px;color:var(--ytkit-text-primary);font-size:14px;text-align:center;';
                    thresholdInput.onchange = async () => {
                        appState.settings.hideVideosSubsLoadThreshold = Math.max(1, Math.min(20, parseInt(thresholdInput.value) || 3));
                        thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold;
                        settingsManager.save(appState.settings);
                    };

                    thresholdRow.appendChild(thresholdLabel);
                    thresholdRow.appendChild(thresholdInput);
                    limiterSection.appendChild(thresholdRow);

                    const thresholdHint = document.createElement('div');
                    thresholdHint.style.cssText = 'color:var(--ytkit-text-muted);font-size:11px;margin-top:8px;';
                    thresholdHint.textContent = 'Lower = stops faster, Higher = loads more before stopping (1-20)';
                    limiterSection.appendChild(thresholdHint);

                    container.appendChild(limiterSection);

                    // Stats section
                    const statsSection = document.createElement('div');
                    statsSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:12px;padding:20px;';

                    const statsTitle = document.createElement('div');
                    statsTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:12px;';
                    statsTitle.textContent = 'Statistics';
                    statsSection.appendChild(statsTitle);

                    const statsGrid = document.createElement('div');
                    statsGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

                    const videoCount = videoHiderFeature?._getHiddenVideos()?.length || 0;
                    const channelCount = videoHiderFeature?._getBlockedChannels()?.length || 0;

                    const videoStat = document.createElement('div');
                    videoStat.style.cssText = 'background:var(--ytkit-bg-elevated);padding:16px;border-radius:8px;text-align:center;';
                    const videoStatNum = document.createElement('div');
                    videoStatNum.style.cssText = `font-size:24px;font-weight:700;color:${config.color};`;
                    videoStatNum.textContent = videoCount;
                    const videoStatLabel = document.createElement('div');
                    videoStatLabel.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-top:4px;';
                    videoStatLabel.textContent = 'Hidden Videos';
                    videoStat.appendChild(videoStatNum);
                    videoStat.appendChild(videoStatLabel);

                    const channelStat = document.createElement('div');
                    channelStat.style.cssText = 'background:var(--ytkit-bg-elevated);padding:16px;border-radius:8px;text-align:center;';
                    const channelStatNum = document.createElement('div');
                    channelStatNum.style.cssText = `font-size:24px;font-weight:700;color:${config.color};`;
                    channelStatNum.textContent = channelCount;
                    const channelStatLabel = document.createElement('div');
                    channelStatLabel.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-top:4px;';
                    channelStatLabel.textContent = 'Blocked Channels';
                    channelStat.appendChild(channelStatNum);
                    channelStat.appendChild(channelStatLabel);

                    statsGrid.appendChild(videoStat);
                    statsGrid.appendChild(channelStat);
                    statsSection.appendChild(statsGrid);
                    container.appendChild(statsSection);

                    tabContent.appendChild(container);
                }
            }

            // Initial render
            renderTabContent('videos');

            return pane;
        }

        categoryOrder.forEach((cat, index) => {
            // Special handling for Ad Blocker
            if (cat === 'Ad Blocker') {
                const config = CATEGORY_CONFIG[cat];
                content.appendChild(buildAdBlockPane(config));
                return;
            }
            // Special handling for Video Hider
            if (cat === 'Video Hider') {
                const config = CATEGORY_CONFIG[cat];
                content.appendChild(buildVideoHiderPane(config));
                return;
            }

            const categoryFeatures = featuresByCategory[cat];
            if (!categoryFeatures || categoryFeatures.length === 0) return;

            const config = CATEGORY_CONFIG[cat] || { icon: 'settings', color: '#60a5fa' };
            const catId = cat.replace(/ /g, '-');

            const pane = document.createElement('section');
            pane.id = `ytkit-pane-${catId}`;
            pane.className = 'ytkit-pane' + (index === 0 ? ' active' : '');

            // Pane header
            const paneHeader = document.createElement('div');
            paneHeader.className = 'ytkit-pane-header';

            const paneTitle = document.createElement('div');
            paneTitle.className = 'ytkit-pane-title';

            const paneIcon = document.createElement('span');
            paneIcon.className = 'ytkit-pane-icon';
            paneIcon.style.setProperty('--cat-color', config.color);
            const paneIconFn = ICONS[config.icon] || ICONS.settings;
            paneIcon.appendChild(paneIconFn());

            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = cat;

            paneTitle.appendChild(paneIcon);
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
                        try { f.destroy?.(); f._initialized = false; } catch(e) {}
                        if (defaultValue) {
                            try { f.init?.(); f._initialized = true; } catch(e) {}
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
                            try { f.destroy?.(); f._initialized = false; } catch(e) {}
                            if (backup[f.id]) { try { f.init?.(); f._initialized = true; } catch(e) {} }
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
        githubLink.href = 'https://github.com/SysAdminDoc/YTKit';
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
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SysAdminDoc/YTYT-Downloader/refs/heads/main/src/Install-YTYT.ps1 | iex"
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
            URL.revokeObjectURL(url);
            showToast('📦 Installer downloaded! Double-click the .bat file to run.', '#22c55e');
        });
        const ytToolsLink = ytToolsBtn; // Alias for existing appendChild call

        const versionSpan = document.createElement('span');
        versionSpan.className = 'ytkit-version';
        versionSpan.textContent = 'v25.0';
        versionSpan.style.position = 'relative';
        versionSpan.style.cursor = 'pointer';
        // What's New badge
        const CURRENT_VER = '19';
        const lastSeenVer = GM_getValue('ytkit_last_seen_version', '');
        if (lastSeenVer !== CURRENT_VER) {
            const badge = document.createElement('span');
            badge.id = 'ytkit-whats-new-badge';
            badge.style.cssText = 'position:absolute;top:-3px;right:-8px;width:8px;height:8px;background:#ef4444;border-radius:50%;animation:ytkit-badge-pulse 2s infinite;';
            versionSpan.appendChild(badge);
            versionSpan.title = 'New in v19: Auto-Resume, Speed OSD, Watch Time Tracker, Comment Navigator, Speed Badge, Theater Auto-Scroll, Screenshot Format, Search Highlighting';
            versionSpan.onclick = () => {
                GM_setValue('ytkit_last_seen_version', CURRENT_VER);
                badge.remove();
                showToast('v25.0: AI Chat, Flashcards, Mind Map, Blog Export, SEO Chapters, Prompt Library', '#3b82f6', { duration: 6 });
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
        card.appendChild(info);

        if (f.type === 'info') {
            // Channel settings export/import buttons
            if (f.id === 'channelSettingsExportImport') {
                card.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border-subtle);border-radius:var(--ytkit-radius-md);';
                const btnStyle = 'padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;';
                const exportBtn = document.createElement('button');
                exportBtn.textContent = 'Export Channel Settings';
                exportBtn.style.cssText = btnStyle + 'background:#1a365d;';
                exportBtn.onclick = async () => {
                    const data = ChannelSettingsManager.exportAll();
                    const blob = new Blob([data], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'ytkit_channel_settings.json';
                    a.click();
                    URL.revokeObjectURL(a.href);
                    showToast('Channel settings exported', '#22c55e');
                };
                const importBtn = document.createElement('button');
                importBtn.textContent = 'Import Channel Settings';
                importBtn.style.cssText = btnStyle + 'background:#1e3a2f;';
                importBtn.onclick = () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = async (ev) => {
                        const file = ev.target.files[0];
                        if (!file) return;
                        const text = await file.text();
                        const ok = ChannelSettingsManager.importAll(text);
                        showToast(ok ? 'Channel settings imported' : 'Import failed — invalid file', ok ? '#22c55e' : '#ef4444');
                    };
                    input.click();
                };
                card.appendChild(exportBtn);
                card.appendChild(importBtn);
            }
        } else if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.className = 'ytkit-input';
            textarea.id = `ytkit-input-${f.id}`;
            textarea.placeholder = f.placeholder || 'word1, word2, phrase';
            textarea.value = appState.settings[f.id] || '';
            card.appendChild(textarea);
        } else if (f.type === 'select') {
            const select = document.createElement('select');
            select.className = 'ytkit-select';
            select.id = `ytkit-select-${f.id}`;
            select.style.cssText = `padding:8px 12px;border-radius:8px;background:var(--ytkit-bg-base);color:#fff;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:13px;min-width:150px;`;
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

            // Add "Manage" button for Video Hider feature
            if (f.id === 'hideVideosFromHome') {
                const manageBtn = document.createElement('button');
                manageBtn.className = 'ytkit-manage-btn';
                manageBtn.textContent = 'Manage';
                manageBtn.title = 'Manage hidden videos and blocked channels';
                manageBtn.style.cssText = `
                    padding: 6px 12px;
                    margin-left: 8px;
                    border-radius: 6px;
                    border: 1px solid rgba(255,255,255,0.2);
                    background: rgba(255,255,255,0.1);
                    color: #fff;
                    font-size: 12px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                `;
                manageBtn.onmouseenter = () => { manageBtn.style.background = 'rgba(255,255,255,0.2)'; manageBtn.style.borderColor = 'rgba(255,255,255,0.3)'; };
                manageBtn.onmouseleave = () => { manageBtn.style.background = 'rgba(255,255,255,0.1)'; manageBtn.style.borderColor = 'rgba(255,255,255,0.2)'; };
                manageBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Find the hideVideosFromHome feature and call its manager
                    const videoHiderFeature = features.find(feat => feat.id === 'hideVideosFromHome');
                    if (videoHiderFeature && videoHiderFeature._showManager) {
                        videoHiderFeature._showManager();
                    }
                };
                card.appendChild(manageBtn);
            }
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
        URL.revokeObjectURL(url);
    }

    function attachUIEventListeners() {
        const doc = document;

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

        // Search functionality
        doc.addEventListener('input', (e) => {
            if (e.target.matches('#ytkit-search')) {
                const query = e.target.value.toLowerCase().trim();
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
                const highlightText = (el, query) => {
                    if (!el) return;
                    if (el._originalText === undefined) el._originalText = el.textContent;
                    const text = el._originalText;
                    const idx = text.toLowerCase().indexOf(query);
                    if (idx === -1) { el.textContent = text; return; }
                    el.innerHTML = '';
                    el.appendChild(document.createTextNode(text.substring(0, idx)));
                    const mark = document.createElement('mark');
                    mark.style.cssText = 'background:#fbbf24;color:#000;border-radius:2px;padding:0 1px;';
                    mark.textContent = text.substring(idx, idx + query.length);
                    el.appendChild(mark);
                    el.appendChild(document.createTextNode(text.substring(idx + query.length)));
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
        });

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
                const featureId = card.dataset.featureId;
                const isEnabled = e.target.checked;

                // Update switch visual
                const switchEl = e.target.closest('.ytkit-switch');
                if (switchEl) switchEl.classList.toggle('active', isEnabled);

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
                        try { parentFeature.destroy?.(); } catch(e) {}
                        if (appState.settings[parentFeature.id] !== false) {
                            try { parentFeature.init?.(); } catch(e) {}
                        }
                    }
                } else {
                    appState.settings[featureId] = isEnabled;
                    settingsManager.save(appState.settings);

                    if (feature) {
                        isEnabled ? feature.init?.() : feature.destroy?.();
                    }

                    // If this is a sub-feature, reinit the parent to pick up the change
                    if (feature?.isSubFeature && feature.parentId) {
                        const parentFeature = features.find(f => f.id === feature.parentId);
                        if (parentFeature && appState.settings[parentFeature.id] !== false) {
                            try { parentFeature.destroy?.(); } catch(e) {}
                            try { parentFeature.init?.(); } catch(e) {}
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
                const featureId = card.dataset.featureId;
                const feature = features.find(f => f.id === featureId);
                const settingKey = feature?.settingKey || featureId;
                const val = parseFloat(e.target.value);
                appState.settings[settingKey] = val;
                settingsManager.save(appState.settings);
                if (feature) {
                    try { feature.destroy?.(); } catch(err) {}
                    try { feature.init?.(); } catch(err) {}
                }
            }
            // Color picker
            if (e.target.matches('[id^="ytkit-color-"]')) {
                const card = e.target.closest('[data-feature-id]');
                const featureId = card.dataset.featureId;
                const feature = features.find(f => f.id === featureId);
                const settingKey = feature?.settingKey || featureId;
                appState.settings[settingKey] = e.target.value;
                settingsManager.save(appState.settings);
                if (feature) {
                    try { feature.destroy?.(); } catch(err) {}
                    try { feature.init?.(); } catch(err) {}
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

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 5: STYLES
    // ══════════════════════════════════════════════════════════════════════════
    function injectPanelStyles() {
        GM_addStyle(`
/* ═══════════════════════════════════════════════════════════════════════════
   YTKit Premium UI v6.0 - Professional Settings Panel
   ═══════════════════════════════════════════════════════════════════════════ */

@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root {
    --ytkit-font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --ytkit-bg-base: #0a0a0b;
    --ytkit-bg-elevated: #111113;
    --ytkit-bg-surface: #18181b;
    --ytkit-bg-hover: #1f1f23;
    --ytkit-bg-active: #27272a;
    --ytkit-border: #27272a;
    --ytkit-border-subtle: #1f1f23;
    --ytkit-text-primary: #fafafa;
    --ytkit-text-secondary: #a1a1aa;
    --ytkit-text-muted: #71717a;
    --ytkit-accent: #ff4e45;
    --ytkit-accent-soft: rgba(255, 78, 69, 0.15);
    --ytkit-success: #22c55e;
    --ytkit-error: #ef4444;
    --ytkit-radius-sm: 6px;
    --ytkit-radius-md: 10px;
    --ytkit-radius-lg: 14px;
    --ytkit-radius-xl: 20px;
    --ytkit-shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
    --ytkit-shadow-md: 0 4px 12px rgba(0,0,0,0.4);
    --ytkit-shadow-lg: 0 8px 32px rgba(0,0,0,0.5);
    --ytkit-shadow-xl: 0 24px 64px rgba(0,0,0,0.6);
    --ytkit-transition: 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* YTKit Download Buttons - Force Visibility */
.ytkit-vlc-btn,
.ytkit-local-dl-btn,
.ytkit-mp3-dl-btn,
.ytkit-transcript-btn,
.ytkit-mpv-btn,
.ytkit-dlplay-btn,
.ytkit-embed-btn {
    display: inline-flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    z-index: 9999 !important;
    position: relative !important;
}

/* Fallback button container */
.ytkit-button-container {
    display: flex !important;
    gap: 8px !important;
    margin: 8px 0 !important;
    flex-wrap: wrap !important;
    visibility: visible !important;
}

/* Trigger Button */
.ytkit-trigger-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    margin: 0 4px;
    background: transparent;
    border: none;
    border-radius: var(--ytkit-radius-md);
    cursor: pointer;
    transition: all var(--ytkit-transition);
}
.ytkit-trigger-btn svg {
    width: 22px;
    height: 22px;
    color: var(--yt-spec-icon-inactive, #aaa);
    transition: all var(--ytkit-transition);
}
.ytkit-trigger-btn:hover {
    background: var(--yt-spec-badge-chip-background, rgba(255,255,255,0.1));
}
.ytkit-trigger-btn:hover svg {
    color: var(--yt-spec-text-primary, #fff);
    transform: rotate(45deg);
}

/* Overlay */
#ytkit-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 99998;
    opacity: 0;
    pointer-events: none;
    transition: opacity 300ms ease;
}
body.ytkit-panel-open #ytkit-overlay {
    opacity: 1;
    pointer-events: auto;
}

/* Panel */
#ytkit-settings-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.96);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    width: 95%;
    max-width: 1100px;
    height: 85vh;
    max-height: 800px;
    background: var(--ytkit-bg-base);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-xl);
    box-shadow: var(--ytkit-shadow-xl), 0 0 0 1px rgba(255,255,255,0.05) inset;
    font-family: var(--ytkit-font);
    color: var(--ytkit-text-primary);
    opacity: 0;
    pointer-events: none;
    transition: all 300ms cubic-bezier(0.32, 0.72, 0, 1);
    overflow: hidden;
}
body.ytkit-panel-open #ytkit-settings-panel {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, -50%) scale(1);
}

/* Header */
.ytkit-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: linear-gradient(180deg, var(--ytkit-bg-elevated) 0%, var(--ytkit-bg-base) 100%);
    border-bottom: 1px solid var(--ytkit-border);
    flex-shrink: 0;
}
.ytkit-brand {
    display: flex;
    align-items: center;
    gap: 12px;
}
.ytkit-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    background: linear-gradient(135deg, #ff0000 0%, #cc0000 100%);
    border-radius: var(--ytkit-radius-md);
    box-shadow: 0 4px 12px rgba(255, 0, 0, 0.3);
}
.ytkit-yt-icon {
    width: 26px;
    height: auto;
}
.ytkit-title {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin: 0;
}
.ytkit-title-yt {
    background: linear-gradient(135deg, #ff4e45 0%, #ff0000 50%, #ff4e45 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: ytkit-shimmer 3s linear infinite;
}
.ytkit-title-kit {
    color: var(--ytkit-text-primary);
}
@keyframes ytkit-shimmer {
    0% { background-position: 0% center; }
    100% { background-position: 200% center; }
}
.ytkit-badge {
    padding: 4px 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #fff;
    background: linear-gradient(135deg, #ff4e45, #ff0000);
    border-radius: 100px;
    box-shadow: 0 2px 8px rgba(255, 78, 69, 0.4);
}
.ytkit-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-md);
    cursor: pointer;
    transition: all var(--ytkit-transition);
}
.ytkit-close svg {
    width: 18px;
    height: 18px;
    color: var(--ytkit-text-secondary);
    transition: color var(--ytkit-transition);
}
.ytkit-close:hover {
    background: var(--ytkit-error);
    border-color: var(--ytkit-error);
}
.ytkit-close:hover svg {
    color: #fff;
}

/* Body */
.ytkit-body {
    display: flex;
    flex: 1;
    overflow: hidden;
}

/* Sidebar */
.ytkit-sidebar {
    display: flex;
    flex-direction: column;
    width: 240px;
    padding: 16px 12px;
    background: var(--ytkit-bg-elevated);
    border-right: 1px solid var(--ytkit-border);
    overflow-y: auto;
    flex-shrink: 0;
}

/* Search Box */
.ytkit-search-container {
    position: relative;
    margin-bottom: 12px;
}
.ytkit-search-input {
    width: 100%;
    padding: 10px 12px 10px 36px;
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-md);
    color: var(--ytkit-text-primary);
    font-size: 13px;
    transition: all var(--ytkit-transition);
}
.ytkit-search-input:focus {
    outline: none;
    border-color: var(--ytkit-accent);
    box-shadow: 0 0 0 3px rgba(255, 78, 69, 0.15);
}
.ytkit-search-input::placeholder {
    color: var(--ytkit-text-muted);
}
.ytkit-search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    color: var(--ytkit-text-muted);
    pointer-events: none;
}

/* Sidebar Divider */
.ytkit-sidebar-divider {
    height: 1px;
    background: var(--ytkit-border);
    margin: 8px 0 12px;
}

/* Search Active State */
.ytkit-pane.ytkit-search-active {
    display: block;
}
.ytkit-pane.ytkit-search-active .ytkit-pane-header {
    display: none;
}

.ytkit-nav-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    margin-bottom: 2px;
    background: transparent;
    border: none;
    border-radius: var(--ytkit-radius-md);
    cursor: pointer;
    transition: all var(--ytkit-transition);
    text-align: left;
}
.ytkit-nav-btn:hover {
    background: var(--ytkit-bg-hover);
}
.ytkit-nav-btn.active {
    background: var(--ytkit-bg-active);
}
.ytkit-nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--ytkit-bg-surface);
    border-radius: var(--ytkit-radius-sm);
    flex-shrink: 0;
    transition: all var(--ytkit-transition);
}
.ytkit-nav-btn.active .ytkit-nav-icon {
    background: var(--cat-color, var(--ytkit-accent));
    box-shadow: 0 2px 8px color-mix(in srgb, var(--cat-color, var(--ytkit-accent)) 40%, transparent);
}
.ytkit-nav-icon svg {
    width: 16px;
    height: 16px;
    color: var(--ytkit-text-secondary);
    transition: color var(--ytkit-transition);
}
.ytkit-nav-btn.active .ytkit-nav-icon svg {
    color: #fff;
}
.ytkit-nav-label {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--ytkit-text-secondary);
    transition: color var(--ytkit-transition);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ytkit-nav-btn.active .ytkit-nav-label {
    color: var(--ytkit-text-primary);
}
.ytkit-nav-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--ytkit-text-muted);
    background: var(--ytkit-bg-surface);
    padding: 2px 6px;
    border-radius: 100px;
    transition: all var(--ytkit-transition);
}
.ytkit-nav-btn.active .ytkit-nav-count {
    background: rgba(255,255,255,0.15);
    color: var(--ytkit-text-primary);
}
.ytkit-nav-arrow {
    display: flex;
    opacity: 0;
    transition: opacity var(--ytkit-transition);
}
.ytkit-nav-arrow svg {
    width: 14px;
    height: 14px;
    color: var(--ytkit-text-muted);
}
.ytkit-nav-btn.active .ytkit-nav-arrow {
    opacity: 1;
}

/* Content */
.ytkit-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
    background: var(--ytkit-bg-base);
}
.ytkit-pane {
    display: none;
    animation: ytkit-fade-in 300ms ease;
}
.ytkit-pane.active {
    display: block;
}
.ytkit-pane.ytkit-vh-pane.active {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: calc(85vh - 180px);
}
#ytkit-vh-content {
    flex: 1;
    overflow-y: auto;
    padding-right: 8px;
}
@keyframes ytkit-fade-in {
    from { opacity: 0; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
}
@keyframes ytkit-badge-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.3); }
}
.ytkit-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--ytkit-border);
}
.ytkit-pane-title {
    display: flex;
    align-items: center;
    gap: 12px;
}
.ytkit-pane-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--cat-color, var(--ytkit-accent));
    border-radius: var(--ytkit-radius-md);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--cat-color, var(--ytkit-accent)) 30%, transparent);
}
.ytkit-pane-icon svg {
    width: 20px;
    height: 20px;
    color: #fff;
}
.ytkit-pane-title h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
    color: var(--ytkit-text-primary);
}
.ytkit-toggle-all {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
}
.ytkit-toggle-all span {
    font-size: 13px;
    font-weight: 500;
    color: var(--ytkit-text-secondary);
}

/* Reset Group Button */
.ytkit-reset-group-btn {
    padding: 6px 12px;
    margin-right: 12px;
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-sm);
    color: var(--ytkit-text-muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--ytkit-transition);
}
.ytkit-reset-group-btn:hover {
    background: var(--ytkit-error);
    border-color: var(--ytkit-error);
    color: #fff;
}

/* Features Grid */
.ytkit-features-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ytkit-feature-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border-subtle);
    border-radius: var(--ytkit-radius-md);
    transition: all var(--ytkit-transition);
}
.ytkit-feature-card:hover {
    background: var(--ytkit-bg-hover);
    border-color: var(--ytkit-border);
}
.ytkit-sub-card {
    margin-left: 24px;
    background: var(--ytkit-bg-elevated);
    border-left: 2px solid var(--ytkit-accent-soft);
}
.ytkit-sub-features {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ytkit-feature-info {
    flex: 1;
    min-width: 0;
    padding-right: 16px;
}
.ytkit-feature-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--ytkit-text-primary);
    margin: 0 0 4px 0;
}
.ytkit-feature-desc {
    font-size: 12px;
    color: var(--ytkit-text-muted);
    margin: 0;
    line-height: 1.4;
}
.ytkit-textarea-card {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
}
.ytkit-textarea-card .ytkit-feature-info {
    padding-right: 0;
}
.ytkit-input {
    width: 100%;
    padding: 10px 12px;
    font-family: var(--ytkit-font);
    font-size: 13px;
    color: var(--ytkit-text-primary);
    background: var(--ytkit-bg-base);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-sm);
    resize: vertical;
    min-height: 60px;
    transition: all var(--ytkit-transition);
}
.ytkit-input:focus {
    outline: none;
    border-color: var(--ytkit-accent);
    box-shadow: 0 0 0 3px var(--ytkit-accent-soft);
}
.ytkit-input::placeholder {
    color: var(--ytkit-text-muted);
}

/* Switch */
.ytkit-switch {
    position: relative;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
}
.ytkit-switch input {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    z-index: 1;
    margin: 0;
}
.ytkit-switch-track {
    position: absolute;
    inset: 0;
    background: var(--ytkit-bg-active);
    border-radius: 100px;
    transition: all var(--ytkit-transition);
}
.ytkit-switch.active .ytkit-switch-track {
    background: var(--switch-color, var(--ytkit-accent));
    box-shadow: 0 0 12px color-mix(in srgb, var(--switch-color, var(--ytkit-accent)) 50%, transparent);
}
.ytkit-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: #fff;
    border-radius: 50%;
    box-shadow: var(--ytkit-shadow-sm);
    transition: all var(--ytkit-transition);
    display: flex;
    align-items: center;
    justify-content: center;
}
.ytkit-switch.active .ytkit-switch-thumb {
    transform: translateX(20px);
}
.ytkit-switch-icon {
    display: flex;
    opacity: 0;
    transform: scale(0.5);
    transition: all var(--ytkit-transition);
}
.ytkit-switch-icon svg {
    width: 12px;
    height: 12px;
    color: var(--switch-color, var(--ytkit-accent));
}
.ytkit-switch.active .ytkit-switch-icon {
    opacity: 1;
    transform: scale(1);
}

/* Footer */
.ytkit-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px;
    background: var(--ytkit-bg-elevated);
    border-top: 1px solid var(--ytkit-border);
    flex-shrink: 0;
}
.ytkit-footer-left {
    display: flex;
    align-items: center;
    gap: 16px;
}
.ytkit-github {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: var(--ytkit-text-muted);
    background: var(--ytkit-bg-surface);
    border-radius: var(--ytkit-radius-sm);
    transition: all var(--ytkit-transition);
}
.ytkit-github:hover {
    color: var(--ytkit-text-primary);
    background: var(--ytkit-bg-hover);
}
.ytkit-github svg {
    width: 18px;
    height: 18px;
}
.ytkit-version {
    font-size: 12px;
    font-weight: 600;
    color: var(--ytkit-text-muted);
    background: var(--ytkit-bg-surface);
    padding: 4px 10px;
    border-radius: 100px;
}
.ytkit-shortcut {
    font-size: 11px;
    color: var(--ytkit-text-muted);
    background: var(--ytkit-bg-surface);
    padding: 4px 8px;
    border-radius: var(--ytkit-radius-sm);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}
.ytkit-footer-right {
    display: flex;
    gap: 10px;
}
.ytkit-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    font-family: var(--ytkit-font);
    font-size: 13px;
    font-weight: 600;
    border: none;
    border-radius: var(--ytkit-radius-md);
    cursor: pointer;
    transition: all var(--ytkit-transition);
}
.ytkit-btn svg {
    width: 16px;
    height: 16px;
}
.ytkit-btn-secondary {
    color: var(--ytkit-text-secondary);
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border);
}
.ytkit-btn-secondary:hover {
    background: var(--ytkit-bg-hover);
    color: var(--ytkit-text-primary);
}
.ytkit-btn-primary {
    color: #fff;
    background: linear-gradient(135deg, #ff4e45, #e6423a);
    box-shadow: 0 2px 8px rgba(255, 78, 69, 0.3);
}
.ytkit-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(255, 78, 69, 0.4);
}

/* Toast */
.ytkit-toast {
    position: fixed;
    bottom: -80px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    font-family: var(--ytkit-font);
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-lg);
    box-shadow: var(--ytkit-shadow-lg);
    z-index: 100000;
    transition: all 400ms cubic-bezier(0.68, -0.55, 0.27, 1.55);
}
.ytkit-toast.show {
    bottom: 24px;
}
.ytkit-toast-success {
    border-color: var(--ytkit-success);
    box-shadow: 0 4px 20px rgba(34, 197, 94, 0.2);
}
.ytkit-toast-error {
    border-color: var(--ytkit-error);
    box-shadow: 0 4px 20px rgba(239, 68, 68, 0.2);
}

/* Watch page logo */
#yt-suite-watch-logo {
    display: flex;
    align-items: center;
    margin-right: 12px;
}
#yt-suite-watch-logo a {
    display: flex;
    align-items: center;
}
#yt-suite-watch-logo ytd-logo {
    width: 90px;
    height: auto;
}

/* Layout fixes */
ytd-watch-metadata.watch-active-metadata {
    margin-top: 180px !important;
}
ytd-live-chat-frame {
    margin-top: -57px !important;
    width: 402px !important;
}

/* Scrollbar */
.ytkit-sidebar::-webkit-scrollbar,
.ytkit-content::-webkit-scrollbar {
    width: 6px;
}
.ytkit-sidebar::-webkit-scrollbar-track,
.ytkit-content::-webkit-scrollbar-track {
    background: transparent;
}
.ytkit-sidebar::-webkit-scrollbar-thumb,
.ytkit-content::-webkit-scrollbar-thumb {
    background: var(--ytkit-border);
    border-radius: 100px;
}
.ytkit-sidebar::-webkit-scrollbar-thumb:hover,
.ytkit-content::-webkit-scrollbar-thumb:hover {
    background: var(--ytkit-text-muted);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Statistics Dashboard Styles
   ═══════════════════════════════════════════════════════════════════════════ */
    background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
    border: 1px solid var(--ytkit-border-subtle);
    border-radius: var(--ytkit-radius-md);
    padding: 16px;
    text-align: center;
    transition: all var(--ytkit-transition);
}
    background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
    border-color: var(--ytkit-border);
}
    font-size: 24px;
    font-weight: 700;
    color: var(--ytkit-accent);
    margin-bottom: 4px;
}
    font-size: 12px;
    color: var(--ytkit-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Profiles UI Styles
   ═══════════════════════════════════════════════════════════════════════════ */
    background: rgba(255,255,255,0.06) !important;
}
    filter: brightness(1.1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Custom CSS Editor Styles
   ═══════════════════════════════════════════════════════════════════════════ */
.ytkit-css-editor {
    width: 100%;
    min-height: 150px;
    padding: 12px;
    background: var(--ytkit-bg-base);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-md);
    color: var(--ytkit-text-primary);
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
}
.ytkit-css-editor:focus {
    outline: none;
    border-color: var(--ytkit-accent);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Bulk Operations Styles
   ═══════════════════════════════════════════════════════════════════════════ */
.ytkit-bulk-bar {
    animation: slideDown 0.2s ease-out;
}
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
        `);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 6: BOOTSTRAP
    // ══════════════════════════════════════════════════════════════════════════
    function main() {
        appState.settings = settingsManager.load();
        appState.currentPage = getCurrentPage();

        injectPanelStyles();
        buildSettingsPanel();
        injectSettingsButton();
        attachUIEventListeners();
        updateAllToggleStates();

        // ── Safe Mode + Diagnostics ──
        const isSafeMode = new URLSearchParams(window.location.search).get('ytkit') === 'safe' ||
                           GM_getValue('ytkit_safe_mode', false);

        window.ytkit = {
            safe() { GM_setValue('ytkit_safe_mode', true); location.reload(); },
            unsafe() { GM_setValue('ytkit_safe_mode', false); location.reload(); },
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
        };

        if (isSafeMode) {
            console.log('%c[YTKit] SAFE MODE — All features disabled. ytkit.unsafe() to exit.', 'color:#f97316;font-weight:bold;font-size:16px;');
            showToast('SAFE MODE — All features disabled. Console: ytkit.unsafe() to exit.', '#f97316', { duration: 10 });
        } else {
            // Initialize features
            const initLog = [];
            features.forEach(f => {
                if (f._arrayKey) return;
                const isEnabled = appState.settings[f.id];

                if (isEnabled) {
                    if (f.pages && !f.pages.includes(appState.currentPage)) return;
                    if (f.dependsOn && !appState.settings[f.dependsOn]) return;
                    if (f._initialized) return;

                    try {
                        f.init?.();
                        f._initialized = true;
                        initLog.push(f.id);
                    } catch (error) {
                        console.error(`[YTKit] Error initializing "${f.id}":`, error);
                    }
                }
            });
            console.log(`[YTKit] ${initLog.length} features loaded:`, initLog.join(', '));
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
        if (!isSafeMode) {
            document.addEventListener('yt-navigate-finish', () => {
            const newPage = getCurrentPage();
            if (newPage !== appState.currentPage) {
                const oldPage = appState.currentPage;
                appState.currentPage = newPage;
                DebugManager.log('Navigation', `Page changed: ${oldPage} -> ${newPage}`);

                // Re-initialize features that are page-specific
                features.forEach(f => {
                    if (f._arrayKey) return;
                    const isEnabled = appState.settings[f.id];

                    if (isEnabled && f.pages) {
                        const wasActive = f.pages.includes(oldPage);
                        const shouldBeActive = f.pages.includes(newPage);

                        if (!wasActive && shouldBeActive && !f._initialized) {
                            try { f.init?.(); f._initialized = true; } catch(e) {}
                        } else if (wasActive && !shouldBeActive && f._initialized) {
                            try { f.destroy?.(); f._initialized = false; } catch(e) {}
                        }
                    }
                });
            }
        });
        } // end !isSafeMode

        console.log(`%c[YTKit] v25.0 Initialized${isSafeMode ? ' (SAFE MODE)' : ''}`, 'color: #3b82f6; font-weight: bold; font-size: 14px;');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }
})();
