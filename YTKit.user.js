// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YouTube-Kit
// @version      2.4.0
// @description  Ultimate YouTube customization with ad blocking, VLC streaming, video/channel hiding, playback enhancements, sticky video, and more.
// @author       Matthew Parker
// @license      MIT
// @match        https://*.youtube.com/*
// @match        https://*.youtube-nocookie.com/*
// @match        https://youtu.be/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @icon         https://github.com/SysAdminDoc/YouTube-Kit/blob/main/assets/ytlogo.png?raw=true
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      sponsor.ajay.app
// @connect      raw.githubusercontent.com
// @connect      cobalt.meowing.de
// @connect      returnyoutubedislikeapi.com
// @connect      meowing.de
// @updateURL    https://github.com/SysAdminDoc/YouTube-Kit/raw/refs/heads/main/YTKit.user.js
// @downloadURL  https://github.com/SysAdminDoc/YouTube-Kit/raw/refs/heads/main/YTKit.user.js
// @run-at       document-start
// ==/UserScript==

//  AD BLOCKER BOOTSTRAP - Split Architecture
//  PHASE 1: Proxy engine injected into REAL page context via <script>
//           (bypasses Tampermonkey sandbox so YouTube sees the proxies)
//  PHASE 2: CSS / DOM observer / SSAP stay in sandbox (shared DOM access)
(function ytAdBlockBootstrap() {
    'use strict';

    const enabled = GM_getValue('ytab_enabled', true);
    const antiDetect = GM_getValue('ytab_antidetect', true);

    if (!enabled) {
        const rw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        rw.__ytab = { active: false, stats: { blocked: 0, pruned: 0, ssapSkipped: 0 } };
        return;
    }

    //  PHASE 1: Page-context proxy engine
    //  This function is serialized and injected via <script> element
    //  so it runs on the REAL window, not Tampermonkey's sandbox.
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
            'responseContext.adSignalsInfo',
            // Extended ad keys for newer YT player versions
            'playerResponse.adBreakParams', 'playerResponse.adParams',
            'playerConfig.adConfig', 'playerResponse.underlay',
            'topbarAdRenderer', 'companionAdRenderer',
            'fullscreenAdRenderer', 'interstitialAdRenderer',
            'sponsoredTextRenderers', 'adBreaks',
            'playerResponse.playerConfig.adConfig',
            // 2025+ ad keys
            'playerResponse.overlay.playerOverlayRenderer.autonavToggle',
            'playerResponse.adInfoRenderer', 'playerResponse.endscreen.endscreenRenderer.adElements',
            'adLayoutLoggingData', 'playerResponse.adLayoutLoggingData',
            'playerResponse.playerConfig.webPlayerConfig.useSuperPrefetchAd',
            'instreamAdPlayerOverlayRenderer', 'linearAdSequenceRenderer',
            'playerResponse.linearAdSequenceRenderer',
        ];
        const REPLACE_MAP = { adPlacements: 'no_ads', adSlots: 'no_ads', playerAds: 'no_ads', adBreakHeartbeatParams: 'no_ads' };
        const INTERCEPT_URLS = [
            '/youtubei/v1/player', '/youtubei/v1/get_watch',
            '/youtubei/v1/browse', '/youtubei/v1/search', '/youtubei/v1/next',
            '/watch?', '/playlist?list=', '/reel_watch_sequence',
            // Ad-specific endpoints to intercept aggressively
            '/youtubei/v1/log_event', '/youtubei/v1/ad_break',
            '/pagead/', '/doubleclick.net/', '/googleadservices.com/',
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
            'enforcementMessageViewModel',
            // Additional ad renderers
            'instreamVideoAdRenderer', 'adBreakServiceRenderer',
            'playerLegacyDesktopYpcOfferRenderer', 'ypcTrailerRenderer',
            'compactMovieRenderer', 'gridMovieRenderer',
            'movieRenderer', 'clarificationRenderer',
            'externalVideoRenderer', 'sponsoredItemsPreRenderer',
            // 2025+ renderers
            'linearAdSequenceRenderer', 'instreamAdPlayerOverlayRenderer',
            'adInfoRenderer', 'reelPlayerAdRenderer',
            'shoppingOverlayRenderer', 'adHoverTextButtonRenderer',
            'playerOverlayAutoplayEndpointRenderer',
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
        const _replaceRe = new W.RegExp('"(' + W.Object.keys(REPLACE_MAP).map(function(k){return k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('|') + ')"', 'g');
        function replaceAdKeys(text) {
            if (typeof text !== 'string') return text;
            return text.replace(_replaceRe, function(m, k) { return '"' + REPLACE_MAP[k] + '"'; });
        }

        // ── Deep Recursive Ad Pruner ──
        function deepPruneAds(obj, depth) {
            if (!obj || typeof obj !== 'object' || (depth || 0) > 12) return false;
            // Skip trivially small objects (0-1 keys can't contain ad renderer pairs)
            var keys = W.Array.isArray(obj) ? null : W.Object.keys(obj);
            if (keys && keys.length < 2) return false;
            let pruned = false;
            const d = (depth || 0) + 1;
            if (W.Array.isArray(obj)) {
                for (let i = obj.length - 1; i >= 0; i--) {
                    const item = obj[i];
                    if (item && typeof item === 'object') {
                        let isAd = false;
                        const itemKeys = W.Object.keys(item);
                        for (let j = 0; j < itemKeys.length; j++) { if (AD_RENDERER_SET[itemKeys[j]]) { isAd = true; break; } }
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
            var pruned = false;
            for (var i = 0; i < PRUNE_KEYS.length; i++) { if (deleteNested(obj, PRUNE_KEYS[i])) pruned = true; }
            if (obj.entries && W.Array.isArray(obj.entries)) {
                var before = obj.entries.length;
                obj.entries = obj.entries.filter(function(e) {
                    return !(e && e.command && e.command.reelWatchEndpoint &&
                             e.command.reelWatchEndpoint.adClientParams &&
                             e.command.reelWatchEndpoint.adClientParams.isAd);
                });
                if (obj.entries.length < before) pruned = true;
            }
            // Deep walk only if top-level prune didn't already strip the main ad keys —
            // avoids expensive recursive traversal on responses that were already cleaned.
            // Still runs if pruned=false (may have nested ad renderers without top-level keys).
            if (!pruned || obj.contents || obj.onResponseReceivedActions || obj.richGridRenderer) {
                pruned = deepPruneAds(obj) || pruned;
            }
            if (pruned) stats.pruned++;
            return pruned;
        }
        const origParse = W.JSON.parse;
        // Pre-check strings: known ad keys that must appear for pruneObject to do any work.
        // Avoids expensive deep traversal on the hundreds of small JSON.parse calls YouTube
        // makes per second for analytics, metrics, and UI state updates.
        const AD_KEY_HINTS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'auxiliaryUi', 'adSlotRenderer', 'promotedVideoRenderer', 'inFeedAdLayoutRenderer', 'displayAdRenderer', 'compactPromotedVideoRenderer', 'adBreakServiceRenderer'];
        function jsonNeedsPruning(str) {
            if (typeof str !== 'string' || str.length < 500) return false;
            for (let i = 0; i < AD_KEY_HINTS.length; i++) {
                if (str.indexOf(AD_KEY_HINTS[i]) !== -1) return true;
            }
            return false;
        }
        safeOverride(W.JSON, 'parse', new W.Proxy(origParse, {
            apply: function(target, thisArg, args) {
                const result = W.Reflect.apply(target, thisArg, args);
                try {
                    if (result && typeof result === 'object' && jsonNeedsPruning(args[0])) {
                        if (pruneObject(result)) stats.blocked++;
                    }
                } catch(e) {}
                return result;
            }
        }));
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
                    // Skip non-text response types (arraybuffer, blob, document)
                    const rType = xhr.responseType;
                    if (rType === 'arraybuffer' || rType === 'blob' || rType === 'document') return;
                    const text = xhr.responseText;
                    if (!text) return;
                    const obj = origParse(replaceAdKeys(text));
                    pruneObject(obj);
                    const newText = W.JSON.stringify(obj);
                    W.Object.defineProperty(xhr, 'responseText', { value: newText, configurable: true });
                    // For responseType 'json', set response to parsed object; otherwise string
                    if (rType === 'json') {
                        W.Object.defineProperty(xhr, 'response', { value: obj, configurable: true });
                    } else {
                        W.Object.defineProperty(xhr, 'response', { value: newText, configurable: true });
                    }
                    stats.blocked++;
                } catch(e) {}
            });
            return origXHRSend.call(this, body);
        });
        const origAppendChild = W.Node.prototype.appendChild;
        safeOverride(W.Node.prototype, 'appendChild', new W.Proxy(origAppendChild, {
            apply: function(target, thisArg, args) {
                const node = args[0];
                try {
                    if (node instanceof W.HTMLIFrameElement && node.src === 'about:blank') {
                        const res = W.Reflect.apply(target, thisArg, args);
                        // Skip sandboxed iframes without allow-scripts (accessing contentWindow throws)
                        try {
                            const sb = node.getAttribute('sandbox');
                            if (sb !== null && sb.indexOf('allow-scripts') === -1) return res;
                            if (node.contentWindow) { node.contentWindow.fetch = W.fetch; node.contentWindow.JSON.parse = W.JSON.parse; }
                        } catch(ignored) {}
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
        const origSetTimeout = W.setTimeout;
        safeOverride(W, 'setTimeout', new W.Proxy(origSetTimeout, {
            apply: function(target, thisArg, args) {
                const fn = args[0], delay = args[1];
                // Only intercept timers in the ad-detection delay range (16-18s)
                // Additional guards: must be a function (not string), and short source
                // suggests it's a YT-generated callback, not user/extension code
                if (typeof fn === 'function' && delay >= 16000 && delay <= 18000) {
                    try {
                        const src = fn.toString();
                        if (src.indexOf('[native code]') !== -1 || (src.length < 80 && src.length > 5)) {
                            args[1] = 1;
                        }
                    } catch(e) {}
                }
                return W.Reflect.apply(target, thisArg, args);
            }
        }));
        if (cfg.antiDetect) {
            const origThen = W.Promise.prototype.then;
            safeOverride(W.Promise.prototype, 'then', new W.Proxy(origThen, {
                apply: function(target, thisArg, args) {
                    if (typeof args[0] === 'function') {
                        try {
                            // Only inspect non-native functions with enough code to contain detection logic.
                            // Avoids expensive toString() on short lambdas and native builtins.
                            const fn = args[0];
                            if (fn.length <= 3 && typeof fn.name === 'string' && fn.name.length < 30) {
                                const src = fn.toString();
                                // Only check medium-length functions (detection callbacks are ~200-2000 chars)
                                if (src.length > 100 && src.length < 5000 && src.indexOf('onAbnormalityDetected') !== -1) {
                                    args[0] = function(){};
                                    stats.blocked++;
                                }
                            }
                        } catch(e) {}
                    }
                    return W.Reflect.apply(target, thisArg, args);
                }
            }));
        }
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
        // Strategy: Click skip buttons only. No playbackRate/mute manipulation.
        // Uses MutationObserver on player + low-frequency poll as fallback.
        // NOTE: `var` is intentional here — this code runs in the real page context
        // via unsafeWindow, and `var` hoisting avoids TDZ issues across execution contexts.
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
                    '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container'
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
            // Once observer is ready, clear the interval — observer handles the rest.
            if (adNeutTimer) return;
            var observerReady = setupObserver();
            if (observerReady) return; // Observer already watching, no poll needed
            adNeutTimer = W.setInterval(function() {
                if (!observerReady) observerReady = setupObserver();
                if (observerReady) {
                    // Observer is live — stop polling, it's redundant now
                    W.clearInterval(adNeutTimer); adNeutTimer = null;
                    return;
                }
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

    //  PHASE 2: CSS / DOM Observer / SSAP — stays in sandbox
    //  (operates on shared DOM, needs GM_* for settings)
    const realWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // ── Cosmetic CSS Injection ──
    const COSMETIC_SELECTORS = [
        '#masthead-ad',
        '#masthead-ad.ytd-rich-grid-renderer',
        '#promotion-shelf',
        '#shopping-timely-shelf',
        '#player-ads',
        '#merch-shelf',
        '#panels > ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        '[target-id="engagement-panel-ads"]',
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
        '[layout*="display-ad-"]',
        '[layout="display-ad-layout-top-landscape-image"]',
        '[layout="display-ad-layout-top-portrait-image"]',
        '[layout="display-ad-layout-bottom-landscape-image"]',
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
        '.grid.ytd-browse > #primary > .style-scope > .ytd-rich-grid-renderer > .ytd-rich-grid-renderer > .ytd-ad-slot-renderer',
        '.ytd-rich-item-renderer.style-scope > .ytd-rich-item-renderer > .ytd-ad-slot-renderer.style-scope',
        'ytd-item-section-renderer > .ytd-item-section-renderer > ytd-ad-slot-renderer.style-scope',
        '.ytd-section-list-renderer > .ytd-item-section-renderer > ytd-search-pyv-renderer.ytd-item-section-renderer',
        'ytd-search-pyv-renderer.ytd-item-section-renderer',
        '.ytd-watch-flexy > .ytd-watch-next-secondary-results-renderer > ytd-ad-slot-renderer',
        '.ytd-watch-flexy > .ytd-watch-next-secondary-results-renderer > ytd-ad-slot-renderer.ytd-watch-next-secondary-results-renderer',
        'ytd-merch-shelf-renderer',
        '#description-inner > ytd-merch-shelf-renderer',
        '#description-inner > ytd-merch-shelf-renderer > #main.ytd-merch-shelf-renderer',
        '.ytd-watch-flexy > ytd-merch-shelf-renderer',
        '.ytd-watch-flexy > ytd-merch-shelf-renderer > #main.ytd-merch-shelf-renderer',
        '#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)',
        '.ytReelMetapanelViewModelHost > .ytReelMetapanelViewModelMetapanelItem > .ytShortsSuggestedActionViewModelStaticHost',
        'lazy-list > ad-slot-renderer',
        'ytm-rich-item-renderer > ad-slot-renderer',
        'ytm-companion-slot[data-content-type] > ytm-companion-ad-renderer',
        'ytd-popup-container > .ytd-popup-container > #contentWrapper > .ytd-popup-container[position-type="OPEN_POPUP_POSITION_BOTTOMLEFT"]',
        '#mealbar\\:3 > ytm-mealbar.mealbar-promo-renderer',
        'yt-mealbar-promo-renderer',
        'ytmusic-mealbar-promo-renderer',
        'ytd-enforcement-message-view-model',
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
        'yt-slimline-survey-view-model',
        'lockup-attachments-view-model:has(yt-slimline-survey-view-model)',
        '.ytSlimlineSurveyViewModelHost',
        '.ytwTopLandscapeImageLayoutViewModelHost',
        '.ytwFeedAdMetadataViewModelHost',
        '.ytwAdButtonViewModelHost',
        '.ytwTopBannerImageTextIconButtonedLayoutViewModelHostMetadata',
        '.ytwAdImageViewModelHostImageContainer',
        'ytd-rich-item-renderer[rendered-from-rich-grid]:has(.yt-badge-shape--ad)',
        'ytd-rich-item-renderer[rendered-from-rich-grid]:has([href*="googleadservices.com"])',
        'ytd-rich-item-renderer:has([href*="doubleclick.net"])',
    ];

    const HARDCODED_CSS = COSMETIC_SELECTORS.join(',\n');

    // ── CSS Selector Sanitization ──
    // Prevents injection of dangerous CSS properties via external filter lists.
    // Blocks url(), @import, expression(), javascript:, -moz-binding, content:,
    // behavior:, and other CSS injection vectors.
    // NOTE: Validates per-line (filter lists are line-delimited), NOT per-comma,
    // because CSS selectors like :has(a, b) contain legitimate commas.
    const _CSS_DANGEROUS_PATTERNS = /(?:url\s*\(|@import|expression\s*\(|javascript\s*:|\\00|\\u00|-moz-binding|behavior\s*:|var\s*\(\s*--[^)]*url)/i;
    const _CSS_BLOCK_INJECTION = /[{}`]/;

    function sanitizeCSSSelectors(selectorStr) {
        if (!selectorStr || typeof selectorStr !== 'string') return '';
        // Split on newlines (filter list format), not commas (breaks :has/:is selectors).
        // Cached selectors are stored as "sel1,\nsel2,\n..." so strip trailing commas.
        return selectorStr.split('\n')
            .map(line => line.trim().replace(/^,+|,+$/g, '').trim())
            .filter(line => {
                if (!line) return false;
                // Block dangerous CSS injection patterns
                if (_CSS_DANGEROUS_PATTERNS.test(line)) return false;
                // Block curly braces and backticks (property block injection)
                if (_CSS_BLOCK_INJECTION.test(line)) return false;
                return true;
            })
            .join(',\n');
    }

    let cosmeticEl = null;
    function updateCSS(extraSelectors) {
        const sanitizedExtra = sanitizeCSSSelectors(extraSelectors);
        const allCSS = HARDCODED_CSS + (sanitizedExtra ? ',\n' + sanitizedExtra : '');
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
    // Scoped to tp-yt-app-drawer to avoid nuking any element with class .opened
    const _openedFix = document.createElement('style');
    _openedFix.id = 'ytkit-opened-fix';
    _openedFix.textContent = 'tp-yt-app-drawer[opened] + .opened, #scrim.opened { display: none !important; pointer-events: none !important; }';
    (document.head || document.documentElement).appendChild(_openedFix);

    // Early chat cleanup — runs at document-start in the live_chat iframe
    // (features init via main() may not reach the chat iframe context)
    if (window.location.pathname.startsWith('/live_chat')) {
        const _chatFix = document.createElement('style');
        _chatFix.id = 'ytkit-chat-early';
        _chatFix.textContent = [
            'yt-live-chat-toast-renderer, yt-live-chat-viewer-engagement-message-renderer { display: none !important; }',
            // Clean up monetization clutter in restricted participation panel
            'yt-live-chat-restricted-participation-renderer yt-live-chat-product-picker-panel-view-model { display: none !important; }',
            'yt-live-chat-restricted-participation-renderer yt-reaction-control-panel-overlay-view-model { display: none !important; }',
            'yt-live-chat-restricted-participation-renderer #picker-buttons { display: none !important; }',
            // Style the YTKit subscribe button
            '#ytkit-chat-subscribe { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 6px 14px; background: #c00; color: #fff; border: none; border-radius: 18px; font-size: 12px; font-weight: 600; font-family: "Roboto","Arial",sans-serif; cursor: pointer; transition: background 0.2s, transform 0.15s; text-decoration: none; white-space: nowrap; }',
            '#ytkit-chat-subscribe:hover { background: #e00; transform: scale(1.03); }',
            '#ytkit-chat-subscribe svg { width: 14px; height: 14px; fill: currentColor; flex-shrink: 0; }',
            // Restyle the restricted message row to be cleaner
            'yt-live-chat-restricted-participation-renderer #explanation { display: flex !important; align-items: center !important; flex-wrap: wrap !important; gap: 4px !important; }',
        ].join('\n');
        (document.head || document.documentElement).appendChild(_chatFix);

        // Inject subscribe button when "Subscribers-only mode" detected
        const _injectSubscribeBtn = () => {
            const renderer = document.querySelector('yt-live-chat-restricted-participation-renderer');
            if (!renderer || document.getElementById('ytkit-chat-subscribe')) return;
            const msgEl = renderer.querySelector('#message');
            if (!msgEl || !msgEl.textContent.includes('Subscribers-only')) return;

            // Extract channel handle from support button tooltip/aria-label
            let handle = '';
            const supportBtn = renderer.querySelector('button[aria-label*="@"]');
            if (supportBtn) {
                const m = supportBtn.getAttribute('aria-label').match(/@[\w.-]+/);
                if (m) handle = m[0];
            }
            if (!handle) {
                const tooltip = renderer.querySelector('tp-yt-paper-tooltip');
                if (tooltip) {
                    const m = (tooltip.textContent || '').match(/@[\w.-]+/);
                    if (m) handle = m[0];
                }
            }

            const btn = document.createElement('a');
            btn.id = 'ytkit-chat-subscribe';
            btn.target = '_blank';
            btn.rel = 'noopener';
            btn.href = handle ? `https://www.youtube.com/${handle}?sub_confirmation=1` : '#';
            btn.title = handle ? 'Subscribe to ' + handle : 'Subscribe to this channel';
            // Build with DOM API (chat iframe enforces Trusted Types)
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M10 20h4c0 1.1-.9 2-2 2s-2-.9-2-2zm10-2.65V11c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C9.63 5.36 8 7.92 8 11v6.35l-2 2V20h16v-.65l-2-2z');
            svg.appendChild(path);
            btn.appendChild(svg);
            btn.appendChild(document.createTextNode(' Subscribe' + (handle ? ' to ' + handle : '')));

            const body = renderer.querySelector('#body') || renderer.querySelector('#explanation');
            if (body) body.appendChild(btn);
        };

        const _chatSubObs = new MutationObserver(_injectSubscribeBtn);
        const _startChatSubObs = () => {
            _injectSubscribeBtn();
            _chatSubObs.observe(document.body, { childList: true, subtree: true });
        };
        if (document.body) _startChatSubObs();
        else document.addEventListener('DOMContentLoaded', _startChatSubObs);
    }

    // Re-inject protection (debounced — head gets many mutations from YT scripts)
    let _ensureCSSTimer = null;
    const _ensureCSS = () => {
        if (_ensureCSSTimer) return;
        _ensureCSSTimer = setTimeout(() => {
            _ensureCSSTimer = null;
            if (!cosmeticEl || !cosmeticEl.parentNode) {
                cosmeticEl = null;
                const c = [GM_getValue('ytab_cached_selectors', ''), GM_getValue('ytab_custom_filters', '')].filter(Boolean).join(',\n');
                updateCSS(c);
            }
        }, 200);
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
        // Fast path: check root itself before traversing children
        if (root.tagName && AD_REMOVAL_TAGS.has(root.tagName)) { nukeAdNode(root); return; }
        for (const tag of AD_REMOVAL_TAGS) { for (const el of root.querySelectorAll(tag.toLowerCase())) nukeAdNode(el); }
        for (const el of root.querySelectorAll('[layout*="display-ad-"]')) nukeAdNode(el);
    }
    function startDOMCleaner() {
        scanForAds(document);
        // Scan only added nodes, not the full document on every frame — avoids forced reflow.
        // addMutationRule lives in the main IIFE and isn't available at document-start.
        let _rafId = null;
        let _pendingRoots = [];
        const processBatch = () => {
            _rafId = null;
            const roots = _pendingRoots.splice(0, 50);
            for (const root of roots) scanForAds(root);
            // If more remain (or new ones arrived during processing), schedule another frame
            if (_pendingRoots.length) {
                _rafId = requestAnimationFrame(processBatch);
            }
        };
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) _pendingRoots.push(node);
                }
            }
            if (_pendingRoots.length && !_rafId) {
                _rafId = requestAnimationFrame(processBatch);
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

//  MAIN YTKIT (deferred to DOMContentLoaded via bootstrap at bottom)

(function() {
    'use strict';

    // Bridge to real page window (needed because __ytab lives in page context, not sandbox)
    const _rw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

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
        if (path.startsWith('/feed/library') || path.startsWith('/playlist')) return PageTypes.LIBRARY;
        if (path.startsWith('/@') || path.startsWith('/channel') || path.startsWith('/c/') || path.startsWith('/user/')) return PageTypes.CHANNEL;
        return PageTypes.OTHER;
    }

    // ── Version ──
    const YTKIT_VERSION = '2.6.0';

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

    // ── Timing Constants ──
    const TIMING = {
        NAV_DEBOUNCE: 50,         // Navigation detection debounce (ms)
        SAVE_DEBOUNCE: 500,       // Settings save debounce (ms)
        ELEMENT_TIMEOUT: 3000,    // waitForElement timeout (ms)
        LABEL_MAX_ATTEMPTS: 20,   // SponsorBlock label retry limit
    };

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

    //  SECTION 0B: DYNAMIC CONTENT/STYLE ENGINE
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

    function waitForElement(selector, callback, timeout = TIMING.ELEMENT_TIMEOUT) {
        const el = document.querySelector(selector);
        if (el) { callback(el); return; }
        let _fired = false;
        const obs = new MutationObserver((mutations) => {
            if (_fired) return;
            // Fast-path: check added nodes directly before full querySelectorAll
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches?.(selector)) { _fired = true; obs.disconnect(); callback(node); return; }
                }
            }
            // Fallback: full query (handles deeply nested insertions)
            const el = document.querySelector(selector);
            if (el) { _fired = true; obs.disconnect(); callback(el); }
        });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { if (!_fired) obs.disconnect(); }, timeout);
    }

    // waitForPageContent — fires callback when YouTube's page content is actually rendered,
    // rather than using blind setTimeout delays. Uses yt-page-data-updated as the primary
    // signal (fires when YT pushes data to the page) and falls back to waitForElement
    // watching for the first rendered video/item. Much faster than fixed 1-2s timeouts.
    function waitForPageContent(callback, fallbackSelector = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer') {
        let fired = false;
        const fire = () => { if (fired) return; fired = true; callback(); };

        // yt-page-data-updated fires when YT renders page data — usually within ~200ms of nav
        document.addEventListener('yt-page-data-updated', fire, { once: true });

        // Fallback: watch for first content element to appear in DOM
        waitForElement(fallbackSelector, fire);

        // Hard fallback at 3s in case neither fires (e.g. cached page, rare edge cases)
        setTimeout(fire, 3000);
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
        const currentVideoId = (window.location.search.match(/[?&]v=([^&#]+)/) || [])[1] || null;
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
            fitPlayerToWindow: true,
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
            ytAdBlock: false,
            adblockCosmeticHide: true,
            adblockSsapAutoSkip: true,
            adblockAntiDetect: true,
            adblockFilterUrl: 'https://raw.githubusercontent.com/SysAdminDoc/YoutubeAdblock/refs/heads/main/youtube-adblock-filters.txt',
            adblockFilterAutoUpdate: true,
            skipSponsors: true,
            hideSponsorBlockLabels: true,
            sponsorBlockCategories: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'music_offtopic', 'preview', 'filler'],
            autoMaxResolution: true,
            preferredQuality: 'max', // 'max' | '4320' | '2160' | '1440' | '1080' | '720' | '480'
            useEnhancedBitrate: true,
            hideQualityPopup: true,
            hideMerchShelf: true,
            hideAiSummary: true,
            autoResumePosition: true,
            gpuContextRecovery: true,
            autoResumeThreshold: 15, // seconds from start before saving position
            autoSkipStillWatching: true,
            playbackSpeedPresets: false,
            defaultPlaybackSpeed: 1,

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
                'sponsorBlock', 'next', 'autoplay', 'subtitles',
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
            cobaltUrl: 'https://cobalt.meowing.de/#',
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
            mousewheelSpeed: true,
            // mousewheelVolume removed in v2.5.0 (interfered with page scrolling)
            videoScreenshot: true,
            returnYoutubeDislike: true,
            cinemaMode: false,
            abLoop: false,
            forceH264: false,
            titleNormalization: false,
            watchProgress: false,

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
            let savedSettings = StorageManager.get('ytSuiteSettings', {});
            savedSettings = this._migrate(savedSettings);
            const merged = { ...this.defaults, ...savedSettings, _settingsVersion: this.SETTINGS_VERSION };
            // Persist migrated settings if version changed
            if ((StorageManager.get('ytSuiteSettings', {}))._settingsVersion !== this.SETTINGS_VERSION) {
                this.save(merged);
            }
            return merged;
        },

        save(settings) {
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
                ytkitVersion: YTKIT_VERSION
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

                // Validate: settings must be a plain object with at least one known key
                if (typeof settings !== 'object' || Array.isArray(settings)) return false;
                const knownKeys = Object.keys(this.defaults);
                const hasValidKey = Object.keys(settings).some(k => knownKeys.includes(k));
                if (Object.keys(settings).length > 0 && !hasValidKey) return false;

                // Backup current state before applying
                const backup = {
                    settings: { ...appState.settings },
                    hiddenVideos: StorageManager.get('ytkit-hidden-videos', []),
                    blockedChannels: StorageManager.get('ytkit-blocked-channels', []),
                    bookmarks: StorageManager.get('ytkit-bookmarks', {}),
                };

                try {
                    const newSettings = { ...this.defaults, ...settings };
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
    let _cachedVid = null, _cachedHref = '';
    function getVideoId() {
        const h = window.location.href;
        if (h === _cachedHref) return _cachedVid;
        _cachedHref = h;
        const m = window.location.search.match(/[?&]v=([^&#]+)/);
        _cachedVid = m ? m[1] : null;
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
        fitPlayerToWindow: { conflicts: ['stickyVideo'], reason: 'Both control player dimensions' },
        stickyVideo: { conflicts: ['fitPlayerToWindow'], reason: 'Theater Split overrides Fit Player' },
        hideRelatedVideos: { conflicts: [], note: 'expandVideoWidth depends on this' },
        hideSidebar: { conflicts: ['hiddenChatElementsManager'], reason: 'Sidebar hidden removes chat access' },
        removeAllShorts: { conflicts: ['redirectShorts'], reason: 'Removed shorts cannot be redirected' },
    };

    // ─── Recently Changed Tracking ───
    const _recentlyChanged = [];
    const MAX_RECENT = 6;
    function trackRecentChange(featureId, enabled) {
        const idx = _recentlyChanged.findIndex(r => r.id === featureId);
        if (idx !== -1) _recentlyChanged.splice(idx, 1);
        _recentlyChanged.unshift({ id: featureId, enabled, time: Date.now() });
        if (_recentlyChanged.length > MAX_RECENT) _recentlyChanged.length = MAX_RECENT;
        // Update the recently changed section if panel is open
        document.dispatchEvent(new CustomEvent('ytkit-recent-changed'));
    }

    // ─── Feature State Helper ───
    function getFeatureStatus(f) {
        if (f._arrayKey) return { status: 'sub', label: '', color: '' };
        if (f.type === 'select' || f.type === 'color' || f.type === 'range' || f.type === 'textarea' || f.type === 'info') return { status: 'config', label: '', color: '' };
        const isEnabled = appState.settings[f.id];
        if (!isEnabled) return { status: 'off', label: 'Off', color: '#71717a' };
        const crashCount = typeof _featureCrashCounts !== 'undefined' ? (_featureCrashCounts[f.id] || 0) : 0;
        if (crashCount >= 3) return { status: 'crashed', label: 'Crashed', color: '#ef4444' };
        if (f.dependsOn && !appState.settings[f.dependsOn]) {
            const dep = features.find(df => df.id === f.dependsOn);
            return { status: 'dep', label: 'Needs: ' + (dep?.name || f.dependsOn), color: '#f59e0b' };
        }
        if (f.pages && f.pages.length > 0 && !f.pages.includes(appState.currentPage)) {
            return { status: 'wrong-page', label: 'Wrong page', color: '#f59e0b' };
        }
        if (f._initialized) return { status: 'active', label: 'Active', color: '#22c55e' };
        return { status: 'enabled', label: 'Enabled', color: '#3b82f6' };
    }

    // ─── Feature Preview Descriptions ───
    const FEATURE_PREVIEWS = {
        logoToSubscriptions: 'Logo click goes to /feed/subscriptions instead of homepage',
        widenSearchBar: 'Search bar expands ~480px wider to fill header space',
        subscriptionsGrid: 'Subscriptions feed uses CSS grid with 340px min columns',
        homepageGridAlign: 'Homepage thumbnails snap to uniform grid rows',
        styledFilterChips: 'Filter chips get glassmorphism, hover lift, uniform sizing',
        hideSidebar: 'Left nav panel completely removed, page-manager goes full-width',
        uiStyleManager: 'Applies border-radius:0 globally for square UI look',
        chatStyleComments: 'Comments get compact card layout with inline vote badges',
        removeAllShorts: 'All shorts links and shelf renderers hidden site-wide',
        redirectShorts: 'Shorts URLs rewritten to /watch?v= for standard player',
        fitPlayerToWindow: 'Player goes position:absolute, 100vw x 100vh, masthead hidden',
        stickyVideo: 'Full-screen player with scroll-triggered side-by-side comments',
        hideRelatedVideos: 'Secondary panel hidden, primary stretches to full width',
        expandVideoWidth: 'Primary column gets max-width:none when sidebar is hidden',
        ytAdBlock: 'Proxy-based ad blocking: JSON.parse, fetch, XHR interception',
        skipSponsors: 'SponsorBlock API integration with auto-skip by category',
        autoMaxResolution: 'Forces highest available resolution on video load',
        autoExpandComments: 'Removes comment truncation, clicks Read More automatically',
        autoResumePosition: 'Saves playback position, resumes on revisit (>15s threshold)',
        commentEnhancements: 'Highlights creator replies, shows like heat, collapse toggle',
    };

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
                const css = `ytd-browse[page-subtype="subscriptions"] #contents.ytd-rich-grid-renderer{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:8px;width:99%;} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer.ytd-rich-grid-renderer{width:100% !important;margin:0 !important;margin-left:2px !important;}`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'homepageGridAlign',
            name: 'Homepage Grid Align',
            description: 'Force uniform thumbnail grid on the homepage — prevents misaligned rows caused by variable title/metadata heights',
            group: 'Interface',
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
            group: 'Interface',
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
            group: 'Interface',
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
            group: 'Appearance',
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
                        *:not(.ytp-spinner-circle):not(.ytp-spinner-dot):not(.ytp-ce-covering-overlay):not(svg):not(circle):not(path):not(use) {
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
            group: 'Appearance',
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

            _themes: {
                'catppuccin-mocha': {
                    base: '#1e1e2e', mantle: '#181825', crust: '#11111b',
                    surface0: '#313244', surface1: '#45475a', surface2: '#585b70',
                    text: '#cdd6f4', subtext0: '#a6adc8', subtext1: '#bac2de',
                    overlay0: '#6c7086', overlay1: '#7f849c', overlay2: '#9399b2',
                    accent: '#cba6f7', red: '#f38ba8', green: '#a6e3a1',
                    blue: '#89b4fa', sapphire: '#74c7ec', peach: '#fab387',
                    yellow: '#f9e2af', teal: '#94e2d5', lavender: '#b4befe'
                },
                'styled-dark': {
                    base: '#090909', mantle: '#0c0c0c', crust: '#050505',
                    surface0: '#121212', surface1: '#151515', surface2: '#202020',
                    text: '#cccccc', subtext0: '#aaaaaa', subtext1: '#888888',
                    overlay0: '#353535', overlay1: '#454545', overlay2: '#555555',
                    accent: '#3ea6ff', red: '#ff0000', green: '#0c8a1d',
                    blue: '#1563d7', sapphire: '#157ef5', peach: '#ff6600',
                    yellow: '#d6e22b', teal: '#00bfa5', lavender: '#7f9cf3'
                },
                'dracula': {
                    base: '#282a36', mantle: '#21222c', crust: '#191a21',
                    surface0: '#343746', surface1: '#3e4154', surface2: '#4a4d62',
                    text: '#f8f8f2', subtext0: '#bfbfbf', subtext1: '#a0a0a0',
                    overlay0: '#6272a4', overlay1: '#7283b5', overlay2: '#8294c6',
                    accent: '#bd93f9', red: '#ff5555', green: '#50fa7b',
                    blue: '#8be9fd', sapphire: '#6272a4', peach: '#ffb86c',
                    yellow: '#f1fa8c', teal: '#8be9fd', lavender: '#bd93f9'
                },
                'nord': {
                    base: '#2e3440', mantle: '#272c36', crust: '#242933',
                    surface0: '#3b4252', surface1: '#434c5e', surface2: '#4c566a',
                    text: '#eceff4', subtext0: '#d8dee9', subtext1: '#c0c8d8',
                    overlay0: '#616e88', overlay1: '#6e7d99', overlay2: '#7b8ca6',
                    accent: '#88c0d0', red: '#bf616a', green: '#a3be8c',
                    blue: '#81a1c1', sapphire: '#5e81ac', peach: '#d08770',
                    yellow: '#ebcb8b', teal: '#8fbcbb', lavender: '#b48ead'
                },
                'gruvbox': {
                    base: '#282828', mantle: '#1d2021', crust: '#141617',
                    surface0: '#3c3836', surface1: '#504945', surface2: '#665c54',
                    text: '#ebdbb2', subtext0: '#d5c4a1', subtext1: '#bdae93',
                    overlay0: '#7c6f64', overlay1: '#8c7e73', overlay2: '#a89984',
                    accent: '#fe8019', red: '#fb4934', green: '#b8bb26',
                    blue: '#83a598', sapphire: '#458588', peach: '#d65d0e',
                    yellow: '#fabd2f', teal: '#8ec07c', lavender: '#d3869b'
                },
                'tokyo-night': {
                    base: '#1a1b26', mantle: '#16161e', crust: '#12121a',
                    surface0: '#24283b', surface1: '#2f3447', surface2: '#3b4261',
                    text: '#c0caf5', subtext0: '#a9b1d6', subtext1: '#9aa5ce',
                    overlay0: '#565f89', overlay1: '#626a94', overlay2: '#6e76a0',
                    accent: '#7aa2f7', red: '#f7768e', green: '#9ece6a',
                    blue: '#7dcfff', sapphire: '#2ac3de', peach: '#ff9e64',
                    yellow: '#e0af68', teal: '#73daca', lavender: '#bb9af7'
                }
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
    background: url("https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/refs/heads/main/assets/cat.gif") !important;
    width: 34px !important;
    height: 21px !important;
    border: none !important;
    margin-left: -18px !important;
    margin-top: 0px !important;
}
.ytp-progress-bar-container:hover .ytp-scrubber-button,
.ytp-progress-bar-container:hover .ytp-load-progress {
    image-rendering: pixelated;
}
.html5-progress-bar-container, .ytp-progress-bar-container {
    height: 12px !important;
}
.html5-progress-bar, .ytp-progress-bar {
    margin-top: 12px !important;
}
.html5-progress-list, .ytp-progress-list,
.video-ads .html5-progress-list.html5-ad-progress-list,
.video-ads .ytp-progress-list.ytp-ad-progress-list {
    height: 12px !important;
}

/* Starfall scrubber pull indicator */
.ytp-scrubber-pull-indicator::after {
    display: block;
    position: inherit;
    content: '';
    top: -13px;
    left: -13px;
    opacity: 1;
    width: 40px;
    height: 40px;
    border: none;
    background-image: url(https://raw.githubusercontent.com/SysAdminDoc/YouTube-Kit/refs/heads/main/assets/starfall.gif);
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100%;
    transform: rotate(94deg);
    border-radius: 81px;
}
div.ytp-scrubber-pull-indicator { background-color: transparent; }

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
button.ytp-button.ytkit-po-btn.ytkit-po-gear {
    padding: 0; margin: 0; height: 35px; width: 40px;
    text-align: center; background-color: transparent;
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
                if (!this._themes[theme]) return;
                const css = this._buildCSS(this._themes[theme]);
                this._styleElement = injectStyle(css, this.id, true);
            },

            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        cssFeature('noAmbientMode', 'Disable Ambient Mode', 'Turn off the glowing background effect that matches video colors', 'Appearance', 'sun-dim',
            `#cinematics, #cinematics-container,
                    .ytp-autonav-endscreen-upnext-cinematics,
                    #player-container.ytd-watch-flexy::before { display: none !important; }`),
        cssFeature('compactLayout', 'Compact Layout', 'Reduce spacing and padding for a denser interface', 'Appearance', 'minimize',
            `ytd-rich-grid-renderer { --ytd-rich-grid-row-padding: 0 !important; }
                    ytd-rich-item-renderer { margin-bottom: 8px !important; }
                    #contents.ytd-rich-grid-renderer { padding-top: 8px !important; }
                    ytd-two-column-browse-results-renderer { padding: 8px !important; }
                    ytd-watch-flexy[flexy] #primary.ytd-watch-flexy { padding-top: 12px !important; }`),
        cssFeature('thinScrollbar', 'Thin Scrollbar', 'Use a slim, unobtrusive scrollbar', 'Appearance', 'grip-vertical',
            `*::-webkit-scrollbar { width: 5px !important; height: 5px !important; }
                    *::-webkit-scrollbar-track { background: transparent !important; }
                    *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2) !important; border-radius: 10px !important; }
                    *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.35) !important; }
                    * { scrollbar-width: thin !important; scrollbar-color: rgba(255,255,255,0.2) transparent !important; }`),
        {
            id: 'watchPageRestyle',
            name: 'Watch Page Restyle',
            description: 'Polished layout for video title, description, and metadata with glassmorphism accents',
            group: 'Appearance',
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
            group: 'Appearance',
            icon: 'message-square',
            _styleElement: null,
            _observer: null,
            init() {
                // CSS selectors are scoped to comment elements — safe to inject globally
                // (removing path guard so styles persist across SPA navigations)
                const css = `ytd-comments#comments{background:rgba(var(--ytkit-accent-rgb),0.03) !important;background-image:linear-gradient(180deg,rgba(var(--ytkit-accent-rgb),0.05) 0%,rgba(var(--ytkit-accent-rgb),0.01) 100%) !important;border-radius:12px !important;padding:4px 8px !important}ytd-comment-thread-renderer{margin:0 !important;padding:0 !important;border:none !important;background:none !important}ytd-comment-thread-renderer[is-pinned]{background:none !important;border-radius:0 !important;padding:0 !important;margin:0 !important}#contents.ytd-item-section-renderer{margin:0 !important;padding:0 !important}ytd-comment-view-model,ytd-comment-renderer{position:relative !important;padding:8px 4px 6px !important;margin:0 !important;display:block !important;border-bottom:1px solid rgba(255,255,255,0.035) !important;transition:background 0.15s ease !important}ytd-comment-view-model:last-child,ytd-comment-renderer:last-child{border-bottom:none !important}ytd-comment-view-model:hover,ytd-comment-renderer:hover{background:rgba(var(--ytkit-accent-rgb),0.03) !important}ytd-comment-view-model>#body,ytd-comment-renderer>#body{display:flex !important;flex-direction:row !important;gap:10px !important;align-items:flex-start !important}ytd-comment-view-model #author-thumbnail,ytd-comment-renderer #author-thumbnail{display:block !important;flex-shrink:0 !important;width:28px !important;height:28px !important;margin-top:2px !important}ytd-comment-view-model #author-thumbnail img,ytd-comment-renderer #author-thumbnail img,ytd-comment-view-model #author-thumbnail yt-img-shadow,ytd-comment-renderer #author-thumbnail yt-img-shadow{width:28px !important;height:28px !important;border-radius:50% !important}ytd-comment-view-model>#body>#main,ytd-comment-renderer>#body>#main{flex:1 !important;min-width:0 !important;display:block !important}ytd-comment-view-model>#body>#main>#header,ytd-comment-renderer>#body>#main>#header{display:block !important;margin-bottom:3px !important}ytd-comment-view-model>#body>#main>#header>#header-author,ytd-comment-renderer>#body>#main>#header>#header-author{display:flex !important;flex-wrap:wrap !important;align-items:baseline !important;gap:0 6px !important}ytd-comment-view-model>#body>#main>#header>#header-author>h3,ytd-comment-renderer>#body>#main>#header>#header-author>h3{display:contents !important}ytd-comment-view-model #author-text,ytd-comment-renderer #author-text{display:inline !important;font-size:12.5px !important;font-weight:600 !important;color:var(--ytkit-accent) !important;line-height:1.4 !important;text-decoration:none !important;transition:color 0.15s !important}ytd-comment-view-model #author-text:hover,ytd-comment-renderer #author-text:hover{color:var(--ytkit-accent-light) !important}ytd-comment-view-model #author-text span,ytd-comment-renderer #author-text span{font-size:12.5px !important}ytd-comment-view-model ytd-author-comment-badge-renderer,ytd-comment-renderer ytd-author-comment-badge-renderer{display:inline-flex !important;vertical-align:baseline !important;margin-left:2px !important}.ytkit-vote-badge{display:inline-flex !important;align-items:center !important;font-size:10.5px !important;color:rgba(255,255,255,0.3) !important;cursor:pointer !important;vertical-align:baseline !important;gap:2px !important;padding:1px 4px !important;border-radius:3px !important;transition:all 0.15s ease !important}.ytkit-vote-badge:hover{color:rgba(var(--ytkit-accent-rgb),0.9) !important;background:rgba(var(--ytkit-accent-rgb),0.08) !important}.ytkit-vote-badge svg{width:11px !important;height:11px !important;fill:currentColor !important;vertical-align:-1px !important}.ytkit-vote-badge.ytkit-liked{color:rgba(var(--ytkit-accent-rgb),0.9) !important}ytd-comment-view-model #published-time-text,ytd-comment-renderer #published-time-text,ytd-comment-view-model .published-time-text,ytd-comment-renderer .published-time-text{display:inline !important;font-size:11px !important;color:rgba(255,255,255,0.25) !important;line-height:1.4 !important}ytd-comment-view-model #published-time-text a,ytd-comment-renderer #published-time-text a,ytd-comment-view-model .published-time-text a,ytd-comment-renderer .published-time-text a{color:rgba(255,255,255,0.25) !important;text-decoration:none !important}ytd-comment-view-model #pinned-comment-badge,ytd-comment-renderer #pinned-comment-badge,ytd-comment-view-model #linked-comment-badge,ytd-comment-view-model #paid-comment-background,ytd-comment-view-model #creator-heart-button,ytd-comment-renderer #creator-heart-button,ytd-comment-view-model #inline-action-menu,ytd-comment-renderer #inline-action-menu,ytd-comment-view-model #action-menu,ytd-comment-renderer #action-menu,ytd-comment-view-model #more,ytd-comment-view-model [slot="more"],ytd-comment-view-model #less,ytd-comment-view-model [slot="less"],ytd-comment-renderer tp-yt-paper-button.ytd-expander,ytd-comment-view-model #sponsor-comment-badge,ytd-comment-renderer #sponsor-comment-badge,ytd-comment-engagement-bar #dislike-button{display:none !important}ytd-comment-view-model #content-text,ytd-comment-renderer #content-text{display:block !important;font-size:13px !important;line-height:1.55 !important;color:rgba(255,255,255,0.78) !important;margin:0 !important;padding:0 !important;word-break:break-word !important}ytd-comment-view-model #content-text *,ytd-comment-renderer #content-text *{font-size:13px !important;line-height:1.55 !important}ytd-comment-view-model #content-text a,ytd-comment-renderer #content-text a{color:rgba(var(--ytkit-accent-rgb),0.75) !important;text-decoration:none !important}ytd-comment-view-model #content-text a:hover,ytd-comment-renderer #content-text a:hover{color:var(--ytkit-accent-light) !important;text-decoration:underline !important}ytd-comment-view-model #error-text{display:none !important}ytd-comment-view-model ytd-comment-engagement-bar,ytd-comment-renderer ytd-comment-engagement-bar{position:absolute !important;top:6px !important;right:4px !important;margin:0 !important;padding:0 !important;z-index:2 !important;pointer-events:none !important}ytd-comment-view-model:hover ytd-comment-engagement-bar,ytd-comment-renderer:hover ytd-comment-engagement-bar{pointer-events:auto !important}ytd-comment-engagement-bar #toolbar{display:none !important;position:static !important;align-items:center !important;gap:4px !important;margin:0 !important}ytd-comment-view-model:hover>* ytd-comment-engagement-bar #toolbar,ytd-comment-view-model:hover ytd-comment-engagement-bar #toolbar,ytd-comment-renderer:hover ytd-comment-engagement-bar #toolbar{display:inline-flex !important}ytd-comment-engagement-bar #like-button,ytd-comment-engagement-bar #dislike-button,ytd-comment-engagement-bar #vote-count-middle,ytd-comment-engagement-bar #vote-count-left,ytd-comment-engagement-bar #vote-count-right,ytd-comment-engagement-bar #creator-heart-button{display:none !important}ytd-comment-engagement-bar #reply-button-end .yt-spec-button-shape-next{height:24px !important;min-height:unset !important;padding:0 10px !important;font-size:11px !important;min-width:unset !important;color:rgba(var(--ytkit-accent-rgb),0.6) !important;background:rgba(var(--ytkit-accent-rgb),0.06) !important;border-radius:4px !important;transition:all 0.15s !important}ytd-comment-engagement-bar #reply-button-end .yt-spec-button-shape-next:hover{color:rgba(var(--ytkit-accent-rgb),0.9) !important;background:rgba(var(--ytkit-accent-rgb),0.12) !important}ytd-comment-engagement-bar #reply-button-end yt-icon{display:none !important}ytd-comment-engagement-bar #reply-dialog{padding:10px 0 4px !important;margin:0 !important;position:relative !important;width:100% !important;box-sizing:border-box !important;overflow:visible !important;border:none !important;outline:none !important;background:transparent !important}ytd-comment-engagement-bar #reply-dialog #unopened-dialog{display:none !important}ytd-comment-engagement-bar #reply-dialog:not(:has(ytd-commentbox:not([hidden]))){display:none !important}ytd-comment-engagement-bar #reply-dialog:empty{display:none !important;padding:0 !important}.ytkit-replying ytd-comment-engagement-bar{position:relative !important;top:auto !important;right:auto !important;pointer-events:auto !important;margin:4px 0 0 !important;width:100% !important;display:block !important}.ytkit-replying ytd-comment-engagement-bar #toolbar{display:none !important}.ytkit-replying:hover ytd-comment-engagement-bar #toolbar{display:none !important}ytd-comment-replies-renderer{margin:0 !important;padding:4px 0 4px 20px !important;border:none !important;display:block !important}.ytSubThreadThreadline,.ytSubThreadConnection,.ytSubThreadContinuation,.ytSubThreadShadow{display:none !important}yt-sub-thread{padding:0 !important;margin:0 !important}.ytSubThreadSubThreadContent{padding:0 !important}ytd-comment-replies-renderer #expanded-threads ytd-comment-view-model,ytd-comment-replies-renderer #expanded-threads ytd-comment-renderer,ytd-comment-replies-renderer #expander-contents ytd-comment-view-model,ytd-comment-replies-renderer #expander-contents ytd-comment-renderer{padding:8px 4px 8px 12px !important;border-bottom:none !important;border-left:2px solid rgba(var(--ytkit-accent-rgb),0.12) !important;border-radius:0 !important;margin:0 !important}ytd-comment-replies-renderer #expanded-threads ytd-comment-view-model:hover,ytd-comment-replies-renderer #expanded-threads ytd-comment-renderer:hover,ytd-comment-replies-renderer #expander-contents ytd-comment-view-model:hover,ytd-comment-replies-renderer #expander-contents ytd-comment-renderer:hover{border-left-color:rgba(var(--ytkit-accent-rgb),0.3) !important;background:rgba(var(--ytkit-accent-rgb),0.025) !important}ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail,ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail{width:22px !important;height:22px !important}ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail img,ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail img,ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail yt-img-shadow,ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail yt-img-shadow{width:22px !important;height:22px !important}.show-replies-button,ytd-comment-replies-renderer #more-replies,ytd-comment-replies-renderer #more-replies-sub-thread{margin:2px 0 !important;padding:0 !important}ytd-comment-replies-renderer #more-replies .yt-spec-button-shape-next,ytd-comment-replies-renderer #more-replies-sub-thread .yt-spec-button-shape-next{font-size:11px !important;height:24px !important;padding:0 10px !important;color:rgba(var(--ytkit-accent-rgb),0.6) !important;min-height:unset !important;min-width:unset !important;background:rgba(var(--ytkit-accent-rgb),0.06) !important;border-radius:4px !important;transition:all 0.15s !important}ytd-comment-replies-renderer #more-replies .yt-spec-button-shape-next:hover,ytd-comment-replies-renderer #more-replies-sub-thread .yt-spec-button-shape-next:hover{background:rgba(var(--ytkit-accent-rgb),0.12) !important;color:rgba(var(--ytkit-accent-rgb),0.9) !important}ytd-comment-replies-renderer #more-replies .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #more-replies-sub-thread .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #more-replies svg,ytd-comment-replies-renderer #more-replies-sub-thread svg,ytd-comment-replies-renderer #more-replies yt-icon,ytd-comment-replies-renderer #more-replies-sub-thread yt-icon,ytd-comment-replies-renderer .show-replies-button yt-icon,ytd-comment-replies-renderer .show-replies-button svg{display:none !important}ytd-comment-replies-renderer #expanded-threads,ytd-comment-replies-renderer #expander-contents,#collapsed-threads.ytd-comment-replies-renderer{padding:0 !important;margin:0 !important}ytd-comment-replies-renderer #less-replies,ytd-comment-replies-renderer #less-replies-sub-thread{margin:2px 0 !important;padding:0 !important}ytd-comment-replies-renderer #less-replies .yt-spec-button-shape-next,ytd-comment-replies-renderer #less-replies-sub-thread .yt-spec-button-shape-next{font-size:11px !important;height:24px !important;padding:0 10px !important;color:rgba(var(--ytkit-accent-rgb),0.35) !important;min-height:unset !important;background:rgba(var(--ytkit-accent-rgb),0.04) !important;border-radius:4px !important}ytd-comment-replies-renderer #less-replies .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #less-replies-sub-thread .yt-spec-button-shape-next yt-icon,ytd-comment-replies-renderer #less-replies svg,ytd-comment-replies-renderer #less-replies-sub-thread svg,ytd-comment-replies-renderer #less-replies yt-icon,ytd-comment-replies-renderer #less-replies-sub-thread yt-icon{display:none !important}ytd-comments-header-renderer{margin:0 0 4px 0 !important;padding:0 !important}ytd-comments-entry-point-header-renderer,ytd-comments-entry-point-teaser-renderer{display:none !important}ytd-continuation-item-renderer{padding:4px 0 !important}`;
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
        {
            id: 'videosPerRow',
            name: 'Videos Per Row',
            description: 'Set how many video thumbnails per row (0 = dynamic based on window width)',
            group: 'Content',
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
        cssFeature('hidePaidContentOverlay', 'Hide Promotion Badges', 'Remove "Includes paid promotion" overlays on thumbnails and watch pages', 'Content', 'badge',
            `ytd-paid-content-overlay-renderer, ytm-paid-content-overlay-renderer,
                    .YtmPaidContentOverlayHost, .ytmPaidContentOverlayHost,
                    .ytp-paid-content-overlay, .ytp-paid-content-overlay-link`),
        cssFeature('hideInfoPanels', 'Hide Info Panels', 'Remove Wikipedia/context info boxes that appear below videos (FEMA, COVID, etc.)', 'Content', 'info-off',
            `#clarify-box,#clarify-box.attached-message,ytd-info-panel-container-renderer,ytd-info-panel-content-renderer,ytd-watch-flexy #clarify-box,ytd-watch-flexy ytd-info-panel-container-renderer,ytd-clarification-renderer,.ytd-info-panel-container-renderer,.ytp-info-panel-preview{display:none !important;}`),
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
        ...([['joinButton','Join Button','Hide join/membership button'],['askButton','Ask Button','Hide Ask AI button'],['saveButton','Save Button','Hide save to playlist button'],['moreActions','More Actions (...)','Hide more actions menu button'],['askAISection','Ask AI Section','Hide AI section in description'],['podcastSection','Podcast/Course Section','Hide podcast/course section in description'],['transcriptSection','Transcript Section','Hide transcript section in description'],['channelInfoCards','Channel Info Cards','Hide channel info cards in description']].map(([v,n,d])=>({id:'wpHide_'+v,name:n,description:d,group:'Content',icon:'eye-off',isSubFeature:true,parentId:'hiddenWatchElementsManager',_arrayKey:'hiddenWatchElements',_arrayValue:v,init(){},destroy(){}}))),
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
                // Theater Split takes full control on watch pages — skip this feature
                if (appState.settings.stickyVideo && window.location.pathname.startsWith('/watch')) return;
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
                this._styleElement.textContent = `html.yt-suite-fit-to-window,body.yt-suite-fit-to-window{overflow-y:auto !important;height:auto !important;} body.yt-suite-fit-to-window #movie_player{position:absolute !important;top:0 !important;left:0 !important;width:100% !important;height:100vh !important;z-index:9999 !important;background-color:#000 !important;} body.yt-suite-fit-to-window #movie_player .html5-video-container{width:100% !important;height:100% !important;} body.yt-suite-fit-to-window #movie_player video.html5-main-video{width:100% !important;height:100% !important;left:0 !important;top:0 !important;object-fit:contain !important;} html.yt-suite-fit-to-window{padding-top:calc(100vh) !important;} html.yt-suite-fit-to-window ytd-masthead{display:none !important;} body.yt-suite-fit-to-window #page-manager{margin-top:0 !important;}`;
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
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        {
            id: 'floatingLogoOnWatch',
            name: 'YTKit Player Controls',
            description: 'Replace native player right-controls with YouTube logo (quick links dropdown) and YTKit settings gear',
            group: 'Video Player',
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
                logoLink.className = 'ytkit-po-btn ytkit-po-logo';
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

                // Settings gear
                const gearBtn = document.createElement('button');
                gearBtn.className = 'ytp-button ytkit-po-btn ytkit-po-gear';
                gearBtn.title = 'YTKit Settings';
                TrustedHTML.setHTML(gearBtn, `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`);
                gearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.body.classList.toggle('ytkit-panel-open');
                });
                wrap.appendChild(gearBtn);

                rightControls.appendChild(wrap);
            },
            init() {
                this._styleEl = GM_addStyle(`/* Hide native right controls, keep our injected elements */ .ytp-right-controls > *:not(#ytkit-player-controls){display:none !important;} #ytkit-player-controls{display:flex;align-items:center;gap:2px;height:100%;} #ytkit-po-logo-wrap{position:relative;display:inline-flex;align-items:center;} .ytkit-po-btn{display:flex;align-items:center;justify-content:center;padding:6px;border:none;background:transparent;cursor:pointer;border-radius:6px;transition:background 0.15s;text-decoration:none;color:#fff;} .ytkit-po-btn:hover{background:rgba(255,255,255,0.12);} .ytkit-po-gear svg{transition:transform 0.3s ease;} .ytkit-po-gear:hover svg{transform:rotate(45deg);} button.ytp-button.ytp-autonav-toggle.delhi-fast-follow-autonav-toggle{display:none !important;}`);

                const self = this;
                addNavigateRule(this._ruleId, () => self._inject());
            },
            destroy() {
                removeNavigateRule(this._ruleId);
                this._cleanup();
            }
        },
        cssFeature('hideDescriptionRow', 'Hide Description', 'Remove the video description panel below the player', 'Video Player', 'file-minus',
            'ytd-watch-metadata #bottom-row'),
        {
            id: 'stickyVideo',
            name: 'Theater Split',
            description: 'Fullscreen video on watch pages. Scroll down to reveal comments side-by-side. Scroll back to top to return to fullscreen.',
            group: 'Video Player',
            icon: 'picture-in-picture-2',
            pages: [PageTypes.WATCH],

            // ── state ──
            _styleEl: null,
            _isSplit: false,          // right panel is open
            _isActive: false,         // overlay is mounted
            _entering: false,
            _lastVideoId: null,
            _splitWrapper: null,
            _origPlayerParent: null,
            _origPlayerNextSibling: null,
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

            // Nudge YouTube's player to recalculate control bar layout
            _triggerPlayerResize() {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = setTimeout(() => {
                    const cb = document.querySelector('#movie_player .ytp-chrome-bottom');
                    if (cb) { cb.style.removeProperty('width'); cb.style.removeProperty('left'); }
                    window.dispatchEvent(new Event('resize'));
                }, 100);
            },

            // Position an element over the right panel area via CSS fixed positioning.
            // Keeps element in original DOM so YT's IntersectionObserver fires.
            _positionOverRight(el, rightPct, topOffset, heightStr) {
                if (!el) return;
                el.style.setProperty('position', 'fixed', 'important');
                el.style.setProperty('top', topOffset || '0', 'important');
                el.style.setProperty('right', '0', 'important');
                el.style.setProperty('width', `calc(${rightPct}% - 6px)`, 'important');
                el.style.setProperty('max-width', 'none', 'important');
                el.style.setProperty('height', heightStr || '100vh', 'important');
                el.style.setProperty('margin', '0', 'important');
                el.style.setProperty('overflow-y', 'auto', 'important');
                el.style.setProperty('overflow-x', 'hidden', 'important');
                el.style.setProperty('z-index', '10001', 'important');
                el.style.setProperty('background', '#0f0f0f', 'important');
                el.style.setProperty('padding', '0', 'important');
                el.style.setProperty('box-sizing', 'border-box', 'important');
                el.style.setProperty('visibility', 'visible', 'important');
                el.style.setProperty('pointer-events', 'auto', 'important');
                el.style.setProperty('display', 'block', 'important');
                el.style.setProperty('scrollbar-width', 'thin', 'important');
                el.style.setProperty('scrollbar-color', 'rgba(255,255,255,0.15) transparent', 'important');
                this._positionedEls.push(el);
            },

            // Clear all positioning styles from an element
            _unpositionEl(el) {
                if (!el) return;
                const props = ['position','top','right','width','max-width','height','margin',
                    'overflow-y','overflow-x','z-index','background','padding','box-sizing',
                    'visibility','pointer-events','display','scrollbar-width','scrollbar-color',
                    'border-radius'];
                props.forEach(p => el.style.removeProperty(p));
            },

            // Clean up all positioned elements
            _unpositionAll() {
                (this._positionedEls || []).forEach(el => this._unpositionEl(el));
                this._positionedEls = [];
                this._scrollTarget = null;
            },

            // Force chat frame internals (iframe, container) to fill parent
            _forceChatFill(chatEl) {
                if (!chatEl) return;
                const showHide = chatEl.querySelector('#show-hide-button');
                if (showHide) showHide.style.setProperty('display', 'none', 'important');
                const container = chatEl.querySelector('#container');
                if (container) {
                    container.style.setProperty('width', '100%', 'important');
                    container.style.setProperty('height', '100%', 'important');
                    container.style.setProperty('max-height', 'none', 'important');
                    container.style.setProperty('min-height', '0', 'important');
                    container.style.setProperty('border-radius', '0', 'important');
                }
                const iframe = chatEl.querySelector('iframe');
                if (iframe) {
                    iframe.style.setProperty('width', '100%', 'important');
                    iframe.style.setProperty('height', '100%', 'important');
                    iframe.style.setProperty('min-height', '0', 'important');
                    iframe.style.setProperty('border', 'none', 'important');
                    iframe.style.setProperty('border-radius', '0', 'important');
                }
            },

            // Restore chat frame internals
            _restoreChatFill(chatEl) {
                if (!chatEl) return;
                const showHide = chatEl.querySelector('#show-hide-button');
                if (showHide) showHide.style.removeProperty('display');
                const container = chatEl.querySelector('#container');
                if (container) {
                    ['width','height','max-height','min-height','border-radius'].forEach(p => container.style.removeProperty(p));
                }
                const iframe = chatEl.querySelector('iframe');
                if (iframe) {
                    ['width','height','min-height','border','border-radius'].forEach(p => iframe.style.removeProperty(p));
                }
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
                wrapper.style.cssText = `display:flex;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#000;overflow:hidden;`;

                // LEFT — full width initially
                const left = document.createElement('div');
                left.id = 'ytkit-split-left';
                // flex:1 — left fills whatever space the right panel doesn't take.
                // No fixed width, no transition needed — it reacts automatically.
                left.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;background:#000;position:relative;`;

                // DIVIDER — hidden until split
                const divider = document.createElement('div');
                divider.id = 'ytkit-split-divider';
                divider.style.cssText = `flex:0 0 0;width:0;cursor:col-resize;position:relative;background:rgba(255,255,255,0.04);transition:flex-basis 0.35s cubic-bezier(0.4,0,0.2,1);overflow:hidden;z-index:10;`;
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
                right.style.cssText = `flex:0 0 0;width:0;height:100%;overflow-y:auto;overflow-x:hidden;background:#0f0f0f;border-left:1px solid rgba(255,255,255,0.06);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;padding:0;box-sizing:border-box;opacity:0;transition:flex-basis 0.35s cubic-bezier(0.4,0,0.2,1),opacity 0.3s;`;
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

                this._origPlayerParent      = player.parentElement;
                this._origPlayerNextSibling = player.nextSibling;
                this._isActive = true;

                const wrapper = this._buildOverlay();
                this._splitWrapper = wrapper;
                document.body.appendChild(wrapper);

                const left  = wrapper.querySelector('#ytkit-split-left');
                const right = wrapper.querySelector('#ytkit-split-right');

                // Player into left — save play state before reparenting (Chrome pauses on DOM move)
                const video = document.querySelector('video.html5-main-video');
                const wasPlaying = video && !video.paused;
                left.insertBefore(player, wrapper.querySelector('#ytkit-split-close'));
                player.style.removeProperty('height');
                player.style.removeProperty('width');
                player.style.setProperty('width', '100%', 'important');
                player.style.setProperty('height', '100%', 'important');
                player.style.setProperty('flex', '1', 'important');
                player.style.setProperty('min-height', '0', 'important');
                player.style.setProperty('display', 'flex', 'important');
                player.style.setProperty('flex-direction', 'column', 'important');
                // Resume playback if it was playing before reparent
                if (wasPlaying && video) {
                    requestAnimationFrame(() => {
                        video.play().catch(() => {});
                    });
                }

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
                        const chromeBottom = mp.querySelector('.ytp-chrome-bottom');
                        if (chromeBottom) {
                            chromeBottom.style.removeProperty('width');
                            chromeBottom.style.removeProperty('left');
                        }
                    });
                };
                forcePlayerSize();

                // Single ResizeObserver on left panel — debounced to avoid fight with YT's player
                let _resizeDebounce = null;
                this._playerResizeObs = new ResizeObserver(() => {
                    clearTimeout(_resizeDebounce);
                    _resizeDebounce = setTimeout(() => { _fpsCount = 0; forcePlayerSize(); }, 200);
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

                // Wheel/touch on wrapper → open/close comments panel, or passthrough scroll
                this._wheelHandler = (e) => {
                    if (!this._isActive) return;
                    if (!this._isSplit && e.deltaY > 0) { this._expandSplit(); return; }
                    if (this._isSplit && !isInRightContent(e.target)) {
                        // Forward scroll to the right panel
                        const scrollEl = this._scrollTarget;
                        if (scrollEl) {
                            // Collapse only when scrolled to top and scrolling up
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
                    if (!this._isSplit && this._touchStartY - t.clientY > 30) { this._expandSplit(); return; }
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
                // Use CAPTURE phase — YouTube's player calls stopPropagation() on wheel
                // events (for volume control), which prevents bubble-phase handlers from firing.
                // Capture fires parent→child before the player can stop it.
                this._splitWrapper.addEventListener('wheel', this._wheelHandler, { passive: true, capture: true });
                this._splitWrapper.addEventListener('touchstart', this._touchHandler, { passive: true, capture: true });
                this._splitWrapper.addEventListener('touchmove', this._touchMoveHandler, { passive: true, capture: true });

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
                    // LIVE: Chat frame fills right panel
                    if (chatEl) {
                        this._positionOverRight(chatEl, rightPct, '0', '100vh');
                        chatEl.removeAttribute('collapsed');
                        // Tight layout: minimal left gap (2px divider clearance), 8px right breathing room
                        chatEl.style.setProperty('width', `calc(${rightPct}% - 2px)`, 'important');
                        chatEl.style.setProperty('padding', '0 8px 0 0', 'important');
                        chatEl.style.setProperty('border-radius', '0', 'important');
                        this._forceChatFill(chatEl);
                        this._scrollTarget = chatEl;
                    } else {
                        this._waitForChat(rightPct, '0', '100vh');
                    }
                } else if (type === 'vod') {
                    // VOD: Chat replay on top (45vh), title+desc+comments below (55vh)
                    if (chatEl) {
                        this._positionOverRight(chatEl, rightPct, '0', '45vh');
                        chatEl.removeAttribute('collapsed');
                        chatEl.style.setProperty('width', `calc(${rightPct}% - 2px)`, 'important');
                        chatEl.style.setProperty('border-bottom', '2px solid rgba(255,255,255,0.1)', 'important');
                        chatEl.style.setProperty('padding', '0 8px 0 0', 'important');
                        chatEl.style.setProperty('border-radius', '0', 'important');
                        this._forceChatFill(chatEl);
                    } else {
                        this._waitForChat(rightPct, '0', '45vh');
                    }
                    if (below) {
                        const belowTop = chatEl ? '45vh' : '0';
                        const belowH   = chatEl ? '55vh' : '100vh';
                        this._positionOverRight(below, rightPct, belowTop, belowH);
                        below.style.setProperty('width', `calc(${rightPct}% - 2px)`, 'important');
                        below.style.setProperty('padding', '0 8px 60px 2px', 'important');
                    }
                    this._scrollTarget = chatEl || below;
                } else {
                    // STANDARD: #below fills right panel (title, desc, comments)
                    if (below) {
                        this._positionOverRight(below, rightPct, '0', '100vh');
                        below.style.setProperty('width', `calc(${rightPct}% - 2px)`, 'important');
                        below.style.setProperty('padding', '0 8px 60px 2px', 'important');
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
                if (this._wheelHandler && this._splitWrapper) {
                    this._splitWrapper.removeEventListener('wheel', this._wheelHandler, true);
                    this._splitWrapper.removeEventListener('touchstart', this._touchHandler, true);
                    this._splitWrapper.removeEventListener('touchmove', this._touchMoveHandler, true);
                }
                this._wheelHandler = null;
                this._touchHandler = null;
                this._touchMoveHandler = null;
                if (!keepClass) {
                    const masth = document.querySelector('ytd-masthead, #masthead');
                    if (masth && this._mastheadDisplay !== undefined) {
                        masth.style.display = this._mastheadDisplay || '';
                    }
                }
                this._mastheadDisplay = undefined;
                this._playerResizeObs?.disconnect();
                this._playerResizeObs = null;

                const player = document.querySelector('#ytkit-split-left #player-container') || this._getPlayer();

                if (player && this._origPlayerParent) {
                    const vid = document.querySelector('video.html5-main-video');
                    const wasPlaying = vid && !vid.paused;
                    player.style.cssText = '';
                    if (this._origPlayerNextSibling?.parentElement === this._origPlayerParent)
                        this._origPlayerParent.insertBefore(player, this._origPlayerNextSibling);
                    else this._origPlayerParent.appendChild(player);
                    if (wasPlaying && vid) {
                        requestAnimationFrame(() => { vid.play().catch(() => {}); });
                    }
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
                this._origPlayerParent = null;
                this._origPlayerNextSibling = null;
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
                const css = `html.ytkit-split-active ytd-watch-flexy{display:block!important;overflow:visible!important;} html.ytkit-split-active ytd-watch-flexy #columns{max-width:100%!important;} html.ytkit-split-active ytd-masthead,html.ytkit-split-active #masthead-container{display:none!important;} html.ytkit-split-active #page-manager{margin-top:0!important;} html.ytkit-split-active ytd-app{--ytd-masthead-height:0px;} html.ytkit-split-active body{padding-top:0!important;} #ytkit-split-left,#ytkit-split-left #player-container,#ytkit-split-left #player-container-inner,#ytkit-split-left #player-theater-container,#ytkit-split-left ytd-player{width:100%!important;max-width:none!important;height:100%!important;min-height:0!important;padding:0!important;margin:0!important;} #ytkit-split-left #movie_player{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;position:relative!important;left:auto!important;top:auto!important;} #ytkit-split-left .html5-video-container{width:100%!important;height:100%!important;} #ytkit-split-left .ytp-chrome-bottom{width:calc(100% - 24px)!important;left:12px!important;} #ytkit-split-left .ytp-progress-bar-container{width:100%!important;} #ytkit-split-left .ytp-chrome-controls{width:100%!important;} #ytkit-split-left video.html5-main-video{width:100%!important;height:100%!important;object-fit:contain!important;left:0!important;top:0!important;} #ytkit-split-left ytd-player > #container,#ytkit-split-left #player-container-inner #player{width:100%!important;height:100%!important;padding-bottom:0!important;} html.ytkit-split-active ytd-watch-flexy[flexy-header-flipper_] #player-container,html.ytkit-split-active ytd-watch-flexy[theater] #player-container,html.ytkit-split-active ytd-watch-flexy #player-container{width:100%!important;max-width:none!important;} #ytkit-split-right::-webkit-scrollbar{width:5px;} #ytkit-split-right::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:3px;} #ytkit-split-right::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28);} .ytkit-divider-pip{opacity:0;transition:opacity 0.2s ease;} #ytkit-split-divider:hover .ytkit-divider-pip{opacity:1;} html.ytkit-split-active #below[style*="position:fixed"],html.ytkit-split-active #below[style*="position:fixed"]{scrollbar-width:thin!important;scrollbar-color:rgba(255,255,255,0.12) transparent!important;font-size:13px!important;} html.ytkit-split-active #below[style*="position"] ytd-watch-metadata{margin:-12px 0 0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-watch-metadata .item{padding:0!important;margin:0!important;} html.ytkit-split-active #below[style*="position"] ytd-watch-metadata #title{font-size:15px!important;line-height:1.3!important;margin-bottom:2px!important;} html.ytkit-split-active #below[style*="position"] #owner{margin:2px 0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] #actions{flex-wrap:wrap!important;max-width:100%!important;margin:0!important;padding:2px 0!important;gap:4px!important;} html.ytkit-split-active #below[style*="position"] #actions ytd-menu-renderer,html.ytkit-split-active #below[style*="position"] #top-level-buttons-computed{flex-wrap:wrap!important;gap:2px!important;} html.ytkit-split-active #below[style*="position"] #actions button,html.ytkit-split-active #below[style*="position"] #actions ytd-button-renderer,html.ytkit-split-active #below[style*="position"] #actions ytd-toggle-button-renderer{transform:scale(0.88)!important;transform-origin:center!important;} html.ytkit-split-active #below[style*="position"] ytd-text-inline-expander,html.ytkit-split-active #below[style*="position"] ytd-text-inline-expander > div{padding:0!important;margin:0!important;max-width:100%!important;word-break:break-word!important;font-size:12px!important;line-height:1.4!important;} html.ytkit-split-active #below[style*="position"] #description-inline-expander{margin:4px 0!important;padding:6px 8px!important;background:rgba(255,255,255,0.04)!important;border-radius:6px!important;} html.ytkit-split-active #below[style*="position"] ytd-comments{margin:0!important;padding:0 0 40px!important;} html.ytkit-split-active #below[style*="position"] ytd-comments-header-renderer,html.ytkit-split-active #below[style*="position"] ytd-comments-header-renderer > div{padding:0!important;margin:0!important;} html.ytkit-split-active #below[style*="position"] #count.ytd-comments-header-renderer{font-size:13px!important;margin:6px 0 2px!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-simplebox-renderer{padding:0!important;margin:0 0 4px!important;transform:scale(0.92)!important;transform-origin:top left!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-thread-renderer{margin:0!important;padding:6px 4px!important;border-bottom:1px solid rgba(255,255,255,0.06)!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-thread-renderer:last-child{border-bottom:none!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-renderer{margin:0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-renderer #author-thumbnail{width:24px!important;height:24px!important;margin-right:8px!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-renderer #author-thumbnail img,html.ytkit-split-active #below[style*="position"] ytd-comment-renderer #author-thumbnail yt-img-shadow{width:24px!important;height:24px!important;border-radius:50%!important;} html.ytkit-split-active #below[style*="position"] #header-author{margin-bottom:1px!important;} html.ytkit-split-active #below[style*="position"] #author-text{font-size:12px!important;} html.ytkit-split-active #below[style*="position"] #published-time-text{font-size:11px!important;} html.ytkit-split-active #below[style*="position"] #content-text{font-size:13px!important;line-height:1.35!important;margin:0!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] #action-buttons{margin-top:2px!important;} html.ytkit-split-active #below[style*="position"] #action-buttons ytd-toggle-button-renderer,html.ytkit-split-active #below[style*="position"] #action-buttons #reply-button-end{transform:scale(0.85)!important;transform-origin:left center!important;} html.ytkit-split-active #below[style*="position"] #action-buttons #vote-count-middle{font-size:11px!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-replies-renderer{margin-left:28px!important;padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-comment-replies-renderer #expander-contents{padding:0!important;} html.ytkit-split-active #below[style*="position"] ytd-item-section-renderer,html.ytkit-split-active #below[style*="position"] ytd-item-section-renderer > #contents{padding:0!important;margin:0!important;max-width:100%!important;box-sizing:border-box!important;} html.ytkit-split-active #below[style*="position"] yt-formatted-string{max-width:100%!important;word-break:break-word!important;} html.ytkit-split-active #ytkit-split-right{border:none!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position:fixed"],html.ytkit-split-active ytd-live-chat-frame[style*="position:fixed"],html.ytkit-split-active #chat[style*="position:fixed"],html.ytkit-split-active #chat[style*="position:fixed"]{scrollbar-width:thin!important;scrollbar-color:rgba(255,255,255,0.15) transparent!important;margin:0!important;max-width:none!important;border-radius:0!important;padding:0 6px 0 0!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"] iframe,html.ytkit-split-active #chat[style*="position"] iframe{width:100%!important;height:100%!important;min-height:0!important;border:none!important;border-radius:0!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"] #container,html.ytkit-split-active #chat[style*="position"] #container{width:100%!important;height:100%!important;max-height:none!important;min-height:0!important;border-radius:0!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"] #show-hide-button,html.ytkit-split-active #chat[style*="position"] #show-hide-button{display:none!important;} html.ytkit-split-active ytd-live-chat-frame[style*="position"],html.ytkit-split-active #chat[style*="position"]{min-height:0!important;max-height:none!important;} #ytkit-split-close{position:absolute;bottom:16px;right:16px;z-index:25;width:30px;height:30px;border-radius:50%;border:none;background:rgba(0,0,0,0.5);color:rgba(255,255,255,0.55);display:none;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s,background 0.15s;} #ytkit-split-close:hover{background:rgba(220,38,38,0.75);color:#fff;opacity:1!important;} #ytkit-split-collapse-strip{position:fixed;top:0;right:0;height:24px;z-index:10002;cursor:n-resize;background:transparent;transition:background 0.2s;pointer-events:auto;} #ytkit-split-collapse-strip:hover{background:linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%);} #ytkit-split-collapse-strip::after{content:'';display:block;width:24px;height:2px;background:rgba(255,255,255,0.12);border-radius:1px;margin:8px auto 0;opacity:0;transition:opacity 0.2s;} #ytkit-split-collapse-strip:hover::after{opacity:1;}  `;
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
                        // Validate URL: only allow HTTPS to prevent file:// or javascript: injection
                        try { const u = new URL(url); if (u.protocol !== 'https:') { DebugManager.log('AdBlock', 'Filter URL rejected: must be HTTPS'); return; } } catch(e) { return; }
                        GM_xmlhttpRequest({
                            method: 'GET', url,
                            onload: (res) => {
                                if (res.status === 200 && res.responseText) {
                                    const lines = res.responseText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!') && !l.startsWith('#') && !l.startsWith('['));
                                    // Sanitize: reject lines with dangerous CSS patterns
                                    const _dangerousCSS = /(?:url\s*\(|@import|expression\s*\(|javascript\s*:|\\00|\\u00|-moz-binding|behavior\s*:|content\s*:|var\s*\(\s*--[^)]*url)/i;
                                    const safe = lines.filter(l => !_dangerousCSS.test(l) && !l.includes('{') && !l.includes('}') && !l.includes('`'));
                                    if (safe.length > 0) {
                                        const selectorStr = safe.join(',\n');
                                        GM_setValue('ytab_cached_selectors', selectorStr);
                                        GM_setValue('ytab_cached_selector_count', safe.length);
                                        GM_setValue('ytab_filter_update_time', Date.now());
                                        DebugManager.log('AdBlock', `Auto-updated ${safe.length} filter selectors (${lines.length - safe.length} rejected)`);
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
                try {
                    const msgBuffer = new TextEncoder().encode(message);
                    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
                } catch(e) {
                    // Fallback: simple hash for environments where crypto.subtle is unavailable
                    let hash = 0;
                    for (let i = 0; i < message.length; i++) {
                        const char = message.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash; // Convert to 32bit integer
                    }
                    return Math.abs(hash).toString(16).padStart(4, '0');
                }
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
                    const hash = await this._sha256(videoID);
                    const params = new URLSearchParams({
                        categories: JSON.stringify(this._categories),
                        actionTypes: JSON.stringify(["skip", "full"])
                    });
                    // Try with 4-char prefix first, fallback to 6-char on 404
                    const prefixes = [hash.slice(0, 4), hash.slice(0, 6)];
                    for (const prefix of prefixes) {
                        const result = await new Promise((resolve) => {
                            GM.xmlHttpRequest({
                                method: "GET",
                                url: `https://sponsor.ajay.app/api/skipSegments/${prefix}?${params}`,
                                headers: { Accept: "application/json" },
                                onload: (response) => {
                                    if (response.status === 200) {
                                        try {
                                            const data = JSON.parse(response.responseText);
                                            const videoData = data.find(v => v.videoID === videoID);
                                            const segs = videoData?.segments || [];
                                            segs.sort((a, b) => a.segment[0] - b.segment[0]);
                                            resolve({ found: true, segments: segs });
                                        } catch { resolve({ found: false, retry: false }); }
                                    } else if (response.status === 404) {
                                        resolve({ found: false, retry: true });
                                    } else {
                                        resolve({ found: false, retry: false });
                                    }
                                },
                                onerror: () => resolve({ found: false, retry: false })
                            });
                        });
                        if (result.found) return result.segments;
                        if (!result.retry) return [];
                    }
                    return [];
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
                // Clear any in-flight video element poll
                if (this._state._checkVideoInterval) {
                    clearInterval(this._state._checkVideoInterval);
                    this._state._checkVideoInterval = null;
                }
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
                        const skipCount = this._state.segments.filter(s => s.actionType !== 'full').length;
                        if (skipCount > 0) {
                            showToast(`SponsorBlock: ${skipCount} segment${skipCount !== 1 ? 's' : ''} found`, '#00d400', { duration: 2 });
                        }
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
                // Clear any in-flight video element poll from previous navigation
                if (this._state._checkVideoInterval) {
                    clearInterval(this._state._checkVideoInterval);
                    this._state._checkVideoInterval = null;
                }
                this._reset();
                this._state.videoID = newVideoID;
                let attempts = 0;
                this._state._checkVideoInterval = setInterval(() => {
                    attempts++;
                    const video = document.querySelector("video");
                    if (video) {
                        clearInterval(this._state._checkVideoInterval);
                        this._state._checkVideoInterval = null;
                        this._state.video = video;
                        this._state._playHandler = () => this._startRAFSkipLoop();
                        this._state._pauseHandler = () => this._stopRAFSkipLoop();
                        this._state._seekedHandler = () => { this._state.lastSkippedUUID = null; };
                        video.addEventListener("play", this._state._playHandler);
                        video.addEventListener("pause", this._state._pauseHandler);
                        video.addEventListener("seeked", this._state._seekedHandler);
                        this._loadSegmentsAndSetup();
                    } else if (attempts >= 50) {
                        clearInterval(this._state._checkVideoInterval);
                        this._state._checkVideoInterval = null;
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
                // Auto-generated SponsorBlock sub-features
        ...([['sponsor','Skip: Sponsor','Paid promotion, paid referrals, direct advertisements'],['selfpromo','Skip: Self Promotion','Unpaid self-promotion: merch, channel plugs, social media links'],['interaction','Skip: Interaction Reminder','Subscribe, like, comment reminders and engagement prompts'],['intro','Skip: Intro','Intro animation, title card, or cold open with no content'],['outro','Skip: Outro','End cards, credits, outros with no new content'],['music_offtopic','Skip: Off-Topic Music','Non-music sections in music videos (e.g. talking, behind-the-scenes)'],['preview','Skip: Preview/Recap','Preview of upcoming content or recap of previous episodes'],['filler','Skip: Filler','Tangential scenes, off-topic jokes, or filler with no value']].map(([v,n,d])=>({id:'sbCat_'+v,name:n,description:d,group:'SponsorBlock',icon:'list',isSubFeature:true,parentId:'skipSponsors',_arrayKey:'sponsorBlockCategories',_arrayValue:v,init(){},destroy(){}}))),

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
                // Lock quality with both min and max args
                try { player.setPlaybackQualityRange(target, target); } catch { /* ignore */ }
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
            `ytd-comment-thread-renderer.style-scope.ytd-item-section-renderer{margin-top:5px !important;margin-bottom:1px !important;} ytd-comment-thread-renderer.style-scope.ytd-comment-replies-renderer{padding-top:0px !important;padding-bottom:0px !important;margin-top:0px !important;margin-bottom:0px !important;}`),
        cssFeature('hideCommentTeaser', 'Hide Comment Teaser', 'Remove the "Scroll for comments" prompt on watch pages', 'Clutter', 'message-square-off',
            'ytd-comments-entry-point-header-renderer, ytd-comments-entry-point-teaser-renderer'),
        {
            id: 'autoExpandComments',
            name: 'Auto-Expand Comments',
            description: 'Automatically expand truncated comments so full text is always visible',
            group: 'Clutter',
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
            group: 'Clutter',
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
                    .ytkit-heat-cold { color: rgba(255,255,255,0.2); }
                    .ytkit-heat-warm { color: #f59e0b; background: rgba(245,158,11,0.08); }
                    .ytkit-heat-hot { color: #ef4444; background: rgba(239,68,68,0.1); }
                    .ytkit-heat-fire { color: #ff6b6b; background: rgba(255,107,107,0.12); text-shadow: 0 0 6px rgba(255,107,107,0.3); }
                    /* Collapse replies button */
                    .ytkit-collapse-replies {
                        display: inline-flex; align-items: center; gap: 4px;
                        padding: 3px 8px; margin: 4px 0 2px 20px;
                        font-size: 11px; font-weight: 500;
                        color: rgba(var(--ytkit-accent-rgb),0.5); background: rgba(var(--ytkit-accent-rgb),0.04);
                        border: none; border-radius: 4px; cursor: pointer;
                        transition: all 0.15s;
                    }
                    .ytkit-collapse-replies:hover {
                        color: rgba(var(--ytkit-accent-rgb),0.9); background: rgba(var(--ytkit-accent-rgb),0.1);
                    }
                    .ytkit-collapse-replies.collapsed + ytd-comment-replies-renderer {
                        display: none !important;
                    }
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

                            if (count > 0) {
                                const heat = document.createElement('span');
                                heat.className = 'ytkit-heat-indicator';
                                if (count >= 10000) { heat.classList.add('ytkit-heat-fire'); heat.textContent = voteText; }
                                else if (count >= 1000) { heat.classList.add('ytkit-heat-hot'); heat.textContent = voteText; }
                                else if (count >= 100) { heat.classList.add('ytkit-heat-warm'); heat.textContent = voteText; }
                                else { heat.classList.add('ytkit-heat-cold'); heat.textContent = voteText; }
                                const timeEl = comment.querySelector('#published-time-text, .published-time-text');
                                if (timeEl && !comment.querySelector('.ytkit-heat-indicator')) timeEl.after(heat);
                            }
                        }
                    });

                    // Collapse-all-replies toggle per thread
                    document.querySelectorAll('ytd-comment-thread-renderer:not([data-ytkit-collapse])').forEach(thread => {
                        thread.dataset.ytkitCollapse = '1';
                        const repliesRenderer = thread.querySelector('ytd-comment-replies-renderer');
                        if (!repliesRenderer) return;
                        const btn = document.createElement('button');
                        btn.className = 'ytkit-collapse-replies';
                        btn.textContent = 'Collapse replies';
                        btn.addEventListener('click', () => {
                            btn.classList.toggle('collapsed');
                            btn.textContent = btn.classList.contains('collapsed') ? 'Show replies' : 'Collapse replies';
                        });
                        repliesRenderer.before(btn);
                    });
                };

                addMutationRule(this.id, processCommentEnhancements);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove(); this._styleElement = null;
                document.querySelectorAll('[data-ytkit-enhanced]').forEach(el => delete el.dataset.ytkitEnhanced);
                document.querySelectorAll('[data-ytkit-creator]').forEach(el => delete el.dataset.ytkitCreator);
                document.querySelectorAll('[data-ytkit-collapse]').forEach(el => delete el.dataset.ytkitCollapse);
                document.querySelectorAll('.ytkit-heat-indicator, .ytkit-collapse-replies').forEach(el => el.remove());
            }
        },
        cssFeature('hideLiveChatEngagement', 'Hide Chat Engagement', 'Remove engagement prompts in live chat', 'Clutter', 'message-circle-off',
            'yt-live-chat-viewer-engagement-message-renderer,yt-live-chat-toast-renderer'),
        cssFeature('hidePaidPromotionWatch', 'Hide Paid Promotion', 'Remove "paid promotion" labels on watch pages', 'Clutter', 'dollar-sign',
            '.ytp-paid-content-overlay'),
        cssFeature('hideChannelJoinButton', 'Hide Channel Join Button', 'Remove the Join/membership button on channel pages', 'Clutter', 'dollar-sign',
            '.ytFlexibleActionsViewModelAction:has(button[aria-label="Join this channel"])'),
        {
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
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
        cssFeature('hideFundraiser', 'Hide Fundraisers', 'Remove fundraiser and donation badges', 'Clutter', 'heart-off',
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
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
                // Auto-generated Action Buttons sub-features
        ...([['like','Like Button','Hide like button below videos'],['dislike','Dislike Button','Hide dislike button below videos'],['share','Share Button','Hide share button below videos'],['ask','Ask/AI Button','Hide Ask or AI button below videos'],['clip','Clip Button','Hide clip button below videos'],['thanks','Thanks Button','Hide thanks button below videos'],['save','Save Button','Hide save button below videos'],['sponsor','Join/Sponsor Button','Hide join/sponsor button below videos'],['moreActions','More Actions (...)','Hide more actions button below videos']].map(([v,n,d])=>({id:'abHide_'+v,name:n,description:d,group:'Action Buttons',icon:'eye-off',isSubFeature:true,parentId:'hiddenActionButtonsManager',_arrayKey:'hiddenActionButtons',_arrayValue:v,init(){},destroy(){}}))),
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
            _cobaltFallbacks: [
                'https://cobalt.meowing.de/#',
                'https://cobalt.tools/#',
                'https://co.wuk.sh/#',
            ],
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
            _checkCobaltHealth() {
                const provider = appState.settings.downloadProvider || 'cobalt';
                if (provider !== 'cobalt') return;
                const cobaltUrl = GM_getValue('ytkit_cobalt_url', 'https://cobalt.meowing.de/#');
                try {
                    const origin = new URL(cobaltUrl).origin;
                    GM.xmlHttpRequest({
                        method: 'HEAD',
                        url: origin,
                        timeout: 5000,
                        onload: (r) => {
                            if (r.status >= 400) this._tryCobaltFallback(cobaltUrl);
                        },
                        onerror: () => this._tryCobaltFallback(cobaltUrl),
                        ontimeout: () => this._tryCobaltFallback(cobaltUrl),
                    });
                } catch(e) { /* invalid URL, ignore */ }
            },
            _tryCobaltFallback(failedUrl) {
                const fallback = this._cobaltFallbacks.find(u => u !== failedUrl);
                if (fallback) {
                    GM_setValue('ytkit_cobalt_url', fallback);
                    showToast('Cobalt instance unreachable, switched to fallback: ' + fallback, '#f59e0b', { duration: 5 });
                    DebugManager.log('Cobalt', `Switched from ${failedUrl} to ${fallback}`);
                }
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
                this._checkCobaltHealth();
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
            destroy() { this._styleElement?.remove(); this._styleElement = null; }
        },
                // Auto-generated Player Controls sub-features
        ...([['sponsorBlock','SponsorBlock Button','Hide SponsorBlock button from player'],['next','Next Video Button','Hide next video button from player'],['autoplay','Autoplay Toggle','Hide autoplay toggle from player'],['subtitles','Subtitles Button','Hide subtitles button from player'],['captions','Captions Display','Hide captions overlay on video'],['miniplayer','Miniplayer Button','Hide miniplayer button from player'],['pip','Picture-in-Picture','Hide PiP button from player'],['theater','Theater Mode Button','Hide theater mode button from player'],['fullscreen','Fullscreen Button','Hide fullscreen button from player']].map(([v,n,d])=>({id:'pcHide_'+v,name:n,description:d,group:'Player Controls',icon:'eye-off',isSubFeature:true,parentId:'hiddenPlayerControlsManager',_arrayKey:'hiddenPlayerControls',_arrayValue:v,init(){},destroy(){}}))),
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
                get cobalt() { return GM_getValue('ytkit_cobalt_url', 'https://cobalt.meowing.de/#'); },
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
            placeholder: 'https://cobalt.meowing.de/#',
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
                GM_setValue('ytkit_cobalt_url', settingsManager.defaults.cobaltUrl || 'https://cobalt.meowing.de/#');
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
        // ═══════════════════════════════════════════════════════════════════
        //  VIDEO HIDER — Hide videos/channels from feeds
        // ═══════════════════════════════════════════════════════════════════
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
                if (videoId && this._getHiddenVideos().includes(videoId)) return true;
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
                                const regex = new RegExp(regexMatch[1], regexMatch[2]);
                                if (regex.test(title) || regex.test(channelName)) return true;
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

            _processAllDebounceTimer: null,
            _processAllVideos() {
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

            _createSubsHideAllButton() {
                if (document.querySelector('.ytkit-subs-hide-all-btn')) return;
                if (window.location.pathname !== '/feed/subscriptions') return;
                const headerButtons = document.querySelector('#masthead #end #buttons');
                if (!headerButtons) return;
                const ns = 'http://www.w3.org/2000/svg';
                const createSvgElement = (tag, attrs) => {
                    const el = document.createElementNS(ns, tag);
                    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                    return el;
                };
                const hideAllBtn = document.createElement('button');
                hideAllBtn.className = 'ytkit-subs-hide-all-btn';
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
                const vlcBtn = headerButtons.querySelector('.ytkit-subs-vlc-btn');
                if (vlcBtn) headerButtons.insertBefore(hideAllBtn, vlcBtn);
                else headerButtons.appendChild(hideAllBtn);
            },

            _removeSubsHideAllButton() {
                document.querySelector('.ytkit-subs-hide-all-btn')?.remove();
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
                this._observer.observe(document.body, { childList: true, subtree: true });

                let wasOnSubsPage = window.location.pathname === '/feed/subscriptions';
                const checkSubsPage = () => {
                    const isOnSubsPage = window.location.pathname === '/feed/subscriptions';
                    if (isOnSubsPage) {
                        if (!wasOnSubsPage) this._resetSubsLoadState();
                        setTimeout(() => this._createSubsHideAllButton(), 1000);
                    } else {
                        this._removeSubsHideAllButton();
                        this._removeLoadBlocker();
                    }
                    wasOnSubsPage = isOnSubsPage;
                };

                addNavigateRule('hideVideosFromHomeNav', () => {
                    this._processAllVideosDebounced(500);
                    checkSubsPage();
                });
                checkSubsPage();
                DebugManager.log('VideoHider', 'Initialized:', this._getHiddenVideos().length, 'videos,', this._getBlockedChannels().length, 'channels');
            },

            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                this._clearBatchBuffer?.();
                if (this._processAllDebounceTimer) { clearTimeout(this._processAllDebounceTimer); this._processAllDebounceTimer = null; }
                removeNavigateRule('hideVideosFromHomeNav');
                document.querySelectorAll('.ytkit-video-hide-btn').forEach(b => b.remove());
                document.querySelectorAll('.ytkit-video-hidden').forEach(e => e.classList.remove('ytkit-video-hidden'));
                document.querySelectorAll('[data-ytkit-hide-processed]').forEach(e => delete e.dataset.ytkitHideProcessed);
                document.getElementById('ytkit-hide-toast')?.remove();
                this._removeSubsHideAllButton();
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
                    try {
                        window.location.href = 'ytvlc://' + encodeURIComponent(window.location.href);
                    } catch(e) {
                        showToast('VLC protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                    }
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
                    showToast('⬇️ Starting download...', '#22c55e');
                    try {
                        window.location.href = 'ytdl://' + encodeURIComponent(window.location.href);
                    } catch(e) {
                        showToast('yt-dlp protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                    }
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
                    showToast('🎵 Starting MP3 download...', '#8b5cf6');
                    try {
                        window.location.href = 'ytdl://' + encodeURIComponent(window.location.href) + '?ytyt_audio_only=1';
                    } catch(e) {
                        showToast('yt-dlp protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                    }
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
            _serverPort: 9547,

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
                    { id: 'copy-url', icon: 'link', label: 'Copy Video URL', class: 'ytkit-item-copy', action: () => this._copyURL() },
                    { id: 'copy-url-time', icon: 'link', label: 'Copy URL at Timestamp', class: 'ytkit-item-copy', action: () => this._copyURLAtTime() },
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
                try {
                    window.location.href = 'ytdl://' + encodeURIComponent(url);
                } catch(e) {
                    showToast('yt-dlp protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                }
            },

            _downloadAudio() {
                const url = window.location.href;
                showToast('🎵 Starting audio download...', '#a855f7');
                try {
                    window.location.href = 'ytdl://' + encodeURIComponent(url + '&ytkit_audio_only=1');
                } catch(e) {
                    showToast('yt-dlp protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                }
            },

            async _downloadTranscript() {
                await TranscriptService.downloadTranscript();
            },

            _streamVLC() {
                const url = window.location.href;
                showToast('Sending to VLC...', '#f97316');
                try {
                    window.location.href = 'ytvlc://' + encodeURIComponent(url);
                } catch(e) {
                    showToast('VLC protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                }
            },

            _streamMPV() {
                const url = window.location.href;
                showToast('🎬 Sending to MPV...', '#8b5cf6');
                try {
                    window.location.href = 'ytmpv://' + encodeURIComponent(url);
                } catch(e) {
                    showToast('MPV protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                }
            },

            _addToVLCQueue() {
                const url = window.location.href;
                showToast('📋 Adding to VLC queue...', '#f97316');
                try {
                    window.location.href = 'ytvlcq://' + encodeURIComponent(url);
                } catch(e) {
                    showToast('VLC Queue protocol handler not found. Install YTYT-Downloader.', '#ef4444', { duration: 5 });
                }
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
                });
            },

            _copyURLAtTime() {
                const video = document.querySelector('video');
                if (video) {
                    const t = Math.floor(video.currentTime);
                    const url = new URL(window.location.href);
                    url.searchParams.set('t', t + 's');
                    navigator.clipboard.writeText(url.toString()).then(() => {
                        showToast(`URL copied at ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`, '#22c55e');
                    });
                } else {
                    this._copyURL();
                }
            },

            _copyID() {
                const videoId = getVideoId();
                if (videoId) {
                    navigator.clipboard.writeText(videoId).then(() => {
                        showToast('Video ID copied: ' + videoId, '#22c55e');
                    });
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

        // ─── Auto-Resume Last Position ───
        {
            id: 'autoResumePosition',
            name: 'Auto-Resume Position',
            description: 'Resume videos from where you left off (saves position for partially watched videos)',
            group: 'Video Player',
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
                    const videoId = getVideoId();
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

                addNavigateRule(this._ruleId, () => waitForPageContent(tryResume));

                // Save position every 10 seconds
                this._saveInterval = setInterval(() => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || video.paused || video.duration < 60 || !isFinite(video.duration)) return;
                    const videoId = getVideoId();
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
            group: 'Video Player',
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
        // ─── GPU Context Recovery (monitor switch fix) ───
        {
            id: 'gpuContextRecovery',
            name: 'Monitor Switch Fix',
            description: 'Fixes black video on non-primary monitors by disabling Chromium hardware video overlays (mixed-DPI multi-monitor setups)',
            group: 'Video Player',
            icon: 'monitor',
            _styleEl: null,

            init() {
                // Chrome on Windows uses DirectComposition hardware overlays for <video>.
                // The overlay renders directly on the display, bypassing normal compositing.
                // On mixed-DPI multi-monitor setups, this only works on the primary display —
                // secondary monitors at different scaling get a black rectangle.
                //
                // Overriding the video element to use CSS-based sizing with object-fit: contain
                // forces Chrome out of the hardware overlay path because overlays cannot perform
                // CSS object-fit calculations. Falls back to normal GPU compositing which works
                // on all displays regardless of DPI.
                this._styleEl = GM_addStyle([
                    '#movie_player .html5-video-container { width: 100% !important; height: 100% !important; }',
                    '#movie_player video.html5-main-video { width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }'
                ].join('\n'));
            },
            destroy() {
                if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }
            }
        },

        // ─── Auto-Skip "Still Watching?" (YouTube NonStop) ───
        {
            id: 'autoSkipStillWatching',
            name: 'Auto-Skip "Still Watching?"',
            description: 'Automatically dismiss the "Video paused. Continue watching?" popup and prevent YouTube inactivity pauses',
            group: 'Video Player',
            icon: 'skip-forward',
            _checkInterval: null,
            _origPause: null,
            _patchedVideo: null,
            init() {
                const dismissPopup = () => {
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
                            DebugManager.log('StillWatching', 'Dismissed popup');
                        }
                    }
                    const pauseOverlay = document.querySelector('.ytp-pause-overlay');
                    if (pauseOverlay && pauseOverlay.style.display !== 'none') {
                        const playButton = document.querySelector('.ytp-play-button');
                        if (playButton) {
                            playButton.click();
                            showToast('Auto-resumed playback', '#22c55e');
                        }
                    }
                    // Proactive: simulate user activity to prevent the popup from appearing
                    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                };
                this._checkInterval = setInterval(dismissPopup, 2000);
                addMutationRule(this.id, () => setTimeout(dismissPopup, 100));
            },
            destroy() {
                if (this._checkInterval) clearInterval(this._checkInterval);
                removeMutationRule(this.id);
            }
        },

        // ─── Playback Speed Presets ───
        {
            id: 'playbackSpeedPresets',
            name: 'Speed Presets',
            description: 'Quick buttons for 1x, 1.25x, 1.5x, 1.75x, 2x speeds on the player controls',
            group: 'Video Player',
            icon: 'gauge',
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
                        appState.settings.defaultPlaybackSpeed = speed;
                        settingsManager.save(appState.settings);
                    }
                };
                return btn;
            },

            _applySpeed(video) {
                const targetSpeed = appState.settings.defaultPlaybackSpeed || 1;
                video.playbackRate = targetSpeed;
                document.querySelectorAll('.ytkit-speed-btn').forEach(b => {
                    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - targetSpeed) < 0.01);
                });
            },

            _injectSpeedControls() {
                if (!window.location.pathname.startsWith('/watch')) return;
                if (document.querySelector('.ytkit-speed-controls')) return;
                const player = cachedQuery('.ytp-right-controls');
                if (!player) return;
                const container = document.createElement('div');
                container.className = 'ytkit-speed-controls';
                const defaultSpeed = appState.settings.defaultPlaybackSpeed || 1;
                [1, 1.25, 1.5, 1.75, 2].forEach(speed => {
                    container.appendChild(this._createSpeedButton(speed, Math.abs(defaultSpeed - speed) < 0.01));
                });
                player.insertBefore(container, player.firstChild);
                this._container = container;
                const video = cachedQuery('video.html5-main-video');
                if (video) setTimeout(() => this._applySpeed(video), 500);
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

        // ALCHEMY-INSPIRED FEATURES
        {
            id: 'quickLinkMenu',
            name: 'Logo Quick Links',
            description: 'Hover over the YouTube logo to reveal a customizable dropdown menu',
            group: 'Interface',
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
            group: 'Interface',
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

        // ─── Playback Features ───
        {
            id: 'mousewheelSpeed',
            name: 'Mousewheel Speed Control',
            description: 'Hold Shift + scroll on the video player to adjust playback speed (0.25x - 4x)',
            group: 'Playback',
            icon: 'gauge',
            _handler: null,
            _overlay: null,
            _overlayTimer: null,
            _showOverlay(text) {
                if (!this._overlay) {
                    this._overlay = document.createElement('div');
                    this._overlay.className = 'ytkit-speed-overlay';
                    this._overlay.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:6px 16px;border-radius:6px;font-size:18px;font-weight:700;font-family:"Roboto",sans-serif;z-index:100;pointer-events:none;opacity:0;transition:opacity 0.15s;';
                }
                const player = document.querySelector('#movie_player');
                if (player && !player.contains(this._overlay)) player.appendChild(this._overlay);
                this._overlay.textContent = text;
                this._overlay.style.opacity = '1';
                clearTimeout(this._overlayTimer);
                this._overlayTimer = setTimeout(() => { if (this._overlay) this._overlay.style.opacity = '0'; }, 800);
            },
            init() {
                this._handler = (e) => {
                    if (!e.shiftKey) return;
                    const player = document.querySelector('#movie_player');
                    if (!player || !player.contains(e.target)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const video = document.querySelector('video.html5-main-video');
                    if (!video) return;
                    const delta = e.deltaY < 0 ? 0.25 : -0.25;
                    const newSpeed = Math.min(4, Math.max(0.25, Math.round((video.playbackRate + delta) * 100) / 100));
                    video.playbackRate = newSpeed;
                    this._showOverlay(newSpeed + 'x');
                    // Sync speed preset buttons if present
                    document.querySelectorAll('.ytkit-speed-btn').forEach(b => {
                        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - newSpeed) < 0.01);
                    });
                };
                document.addEventListener('wheel', this._handler, { passive: false, capture: true });
            },
            destroy() {
                if (this._handler) document.removeEventListener('wheel', this._handler, true);
                this._overlay?.remove();
                this._overlay = null;
                clearTimeout(this._overlayTimer);
            }
        },
        {
            id: 'videoScreenshot',
            name: 'Video Screenshot',
            description: 'Press S while watching to capture the current video frame as PNG (copies to clipboard + downloads)',
            group: 'Playback',
            icon: 'camera',
            _handler: null,
            init() {
                this._handler = (e) => {
                    if (e.key !== 's' && e.key !== 'S') return;
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
                    if (e.ctrlKey || e.altKey || e.metaKey) return;
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const video = document.querySelector('video.html5-main-video');
                    if (!video || video.readyState < 2) return;
                    e.preventDefault();
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    // Copy to clipboard
                    canvas.toBlob(blob => {
                        if (blob) {
                            try {
                                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
                                    showToast('Screenshot copied to clipboard', '#22c55e');
                                }).catch(() => {
                                    showToast('Screenshot saved (clipboard blocked)', '#f59e0b');
                                });
                            } catch(e) {
                                showToast('Screenshot saved', '#22c55e');
                            }
                            // Also trigger download
                            const url = URL.createObjectURL(blob);
                            const a = Object.assign(document.createElement('a'), {
                                href: url,
                                download: `ytkit-screenshot-${getVideoId() || 'video'}-${Math.floor(video.currentTime)}s.png`
                            });
                            a.click();
                            URL.revokeObjectURL(url);
                        }
                    }, 'image/png');
                };
                document.addEventListener('keydown', this._handler);
            },
            destroy() {
                if (this._handler) document.removeEventListener('keydown', this._handler);
                this._handler = null;
            }
        },
        {
            id: 'returnYoutubeDislike',
            name: 'Return YouTube Dislike',
            description: 'Show dislike counts on videos using the Return YouTube Dislike API',
            group: 'Playback',
            icon: 'thumbs-down',
            _lastVideoId: null,
            _styleElement: null,
            pages: ['watch'],

            async _fetchDislikes(videoId) {
                return new Promise((resolve) => {
                    GM.xmlHttpRequest({
                        method: 'GET',
                        url: `https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`,
                        headers: { Accept: 'application/json' },
                        timeout: 5000,
                        onload: (r) => {
                            if (r.status === 200) {
                                try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); }
                            } else { resolve(null); }
                        },
                        onerror: () => resolve(null),
                        ontimeout: () => resolve(null),
                    });
                });
            },

            _formatCount(n) {
                if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
                if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
                if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
                return String(n);
            },

            async _updateDislikeCount() {
                const videoId = getVideoId();
                if (!videoId || videoId === this._lastVideoId) return;
                this._lastVideoId = videoId;

                const data = await this._fetchDislikes(videoId);
                if (!data || data.dislikes === undefined) return;

                // Find the dislike button and add count
                const dislikeBtn = document.querySelector('dislike-button-view-model button, ytd-toggle-button-renderer:has(button[aria-label*="islike"]) button, segmented-like-dislike-button-view-model .YtSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper button:last-child');
                if (!dislikeBtn) return;

                // Remove existing YTKit dislike count
                dislikeBtn.querySelector('.ytkit-dislike-count')?.remove();

                const span = document.createElement('span');
                span.className = 'ytkit-dislike-count';
                span.textContent = this._formatCount(data.dislikes);
                span.style.cssText = 'margin-left:6px;font-size:12px;font-weight:500;';
                dislikeBtn.appendChild(span);

                // Also show the like/dislike ratio bar
                this._showRatioBar(data.likes, data.dislikes);
            },

            _showRatioBar(likes, dislikes) {
                document.querySelector('.ytkit-ryd-bar')?.remove();
                const total = likes + dislikes;
                if (total === 0) return;
                const likePercent = (likes / total) * 100;
                const bar = document.createElement('div');
                bar.className = 'ytkit-ryd-bar';
                bar.style.cssText = `width:100%;height:3px;border-radius:2px;margin-top:4px;background:#666;overflow:hidden;`;
                const fill = document.createElement('div');
                fill.style.cssText = `width:${likePercent}%;height:100%;background:#3ea6ff;border-radius:2px;transition:width 0.3s;`;
                bar.appendChild(fill);
                // Insert below the like/dislike buttons
                const container = document.querySelector('segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, #top-level-buttons-computed');
                if (container) {
                    container.style.position = container.style.position || 'relative';
                    container.appendChild(bar);
                }
            },

            init() {
                this._styleElement = injectStyle('.ytkit-dislike-count { font-variant-numeric: tabular-nums; }', this.id, true);
                this._updateDislikeCount();
                addNavigateRule('rydUpdate', () => {
                    this._lastVideoId = null;
                    setTimeout(() => this._updateDislikeCount(), 1500);
                });
            },
            destroy() {
                removeNavigateRule('rydUpdate');
                document.querySelector('.ytkit-dislike-count')?.remove();
                document.querySelector('.ytkit-ryd-bar')?.remove();
                this._styleElement?.remove();
                this._lastVideoId = null;
            }
        },
        {
            id: 'cinemaMode',
            name: 'Cinema Mode',
            description: 'Dims everything except the video player for a theater-like experience (toggle with C key)',
            group: 'Playback',
            icon: 'tv',
            _handler: null,
            _overlay: null,
            _active: false,

            _toggle() {
                if (!window.location.pathname.startsWith('/watch')) return;
                this._active = !this._active;
                if (this._active) {
                    if (!this._overlay) {
                        this._overlay = document.createElement('div');
                        this._overlay.className = 'ytkit-cinema-overlay';
                        this._overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:${Z.BUTTONS - 1};pointer-events:none;opacity:0;transition:opacity 0.4s ease;`;
                        document.body.appendChild(this._overlay);
                    }
                    requestAnimationFrame(() => { this._overlay.style.opacity = '1'; });
                    // Elevate player above overlay
                    const player = document.querySelector('#movie_player');
                    if (player) {
                        player.style.position = 'relative';
                        player.style.zIndex = String(Z.BUTTONS);
                    }
                    showToast('Cinema Mode ON', '#a78bfa', { duration: 1.5 });
                } else {
                    if (this._overlay) this._overlay.style.opacity = '0';
                    const player = document.querySelector('#movie_player');
                    if (player) {
                        player.style.position = '';
                        player.style.zIndex = '';
                    }
                    showToast('Cinema Mode OFF', '#71717a', { duration: 1.5 });
                }
            },

            init() {
                this._handler = (e) => {
                    if (e.key !== 'c' && e.key !== 'C') return;
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
                    if (e.ctrlKey || e.altKey || e.metaKey) return;
                    this._toggle();
                };
                document.addEventListener('keydown', this._handler);
                // Disable on navigation away from watch page
                addNavigateRule('cinemaModeNav', () => {
                    if (this._active && !window.location.pathname.startsWith('/watch')) {
                        this._active = false;
                        if (this._overlay) this._overlay.style.opacity = '0';
                        const player = document.querySelector('#movie_player');
                        if (player) { player.style.position = ''; player.style.zIndex = ''; }
                    }
                });
            },
            destroy() {
                if (this._handler) document.removeEventListener('keydown', this._handler);
                this._handler = null;
                removeNavigateRule('cinemaModeNav');
                if (this._overlay) { this._overlay.remove(); this._overlay = null; }
                const player = document.querySelector('#movie_player');
                if (player) { player.style.position = ''; player.style.zIndex = ''; }
                this._active = false;
            }
        },
        {
            id: 'abLoop',
            name: 'A-B Loop',
            description: 'Press [ to set loop start, ] to set loop end, then \\ to toggle loop on/off. Visual markers on progress bar.',
            group: 'Playback',
            icon: 'repeat',
            _handler: null,
            _loopA: null,
            _loopB: null,
            _loopActive: false,
            _rafId: null,
            _markers: null,
            _styleElement: null,

            _updateMarkers() {
                document.querySelector('.ytkit-ab-markers')?.remove();
                const video = document.querySelector('video.html5-main-video');
                const progressBar = document.querySelector('.ytp-progress-bar');
                if (!video || !progressBar || !video.duration) return;
                const duration = video.duration;
                const container = document.createElement('div');
                container.className = 'ytkit-ab-markers';
                container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:41;';
                if (this._loopA !== null) {
                    const markerA = document.createElement('div');
                    markerA.style.cssText = `position:absolute;top:-2px;bottom:-2px;width:3px;background:#22c55e;left:${(this._loopA / duration) * 100}%;border-radius:1px;`;
                    markerA.title = 'Loop Start: ' + this._formatTime(this._loopA);
                    container.appendChild(markerA);
                }
                if (this._loopB !== null) {
                    const markerB = document.createElement('div');
                    markerB.style.cssText = `position:absolute;top:-2px;bottom:-2px;width:3px;background:#ef4444;left:${(this._loopB / duration) * 100}%;border-radius:1px;`;
                    markerB.title = 'Loop End: ' + this._formatTime(this._loopB);
                    container.appendChild(markerB);
                }
                if (this._loopA !== null && this._loopB !== null && this._loopActive) {
                    const region = document.createElement('div');
                    region.style.cssText = `position:absolute;top:0;height:100%;background:rgba(34,197,94,0.2);left:${(this._loopA / duration) * 100}%;width:${((this._loopB - this._loopA) / duration) * 100}%;`;
                    container.appendChild(region);
                }
                progressBar.appendChild(container);
                this._markers = container;
            },

            _formatTime(s) {
                const m = Math.floor(s / 60);
                const sec = Math.floor(s % 60);
                return m + ':' + String(sec).padStart(2, '0');
            },

            _startLoop() {
                this._stopLoop();
                const check = () => {
                    const video = document.querySelector('video.html5-main-video');
                    if (video && this._loopActive && this._loopA !== null && this._loopB !== null) {
                        if (video.currentTime >= this._loopB) {
                            video.currentTime = this._loopA;
                        }
                    }
                    if (this._loopActive) this._rafId = requestAnimationFrame(check);
                };
                this._rafId = requestAnimationFrame(check);
            },

            _stopLoop() {
                if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
            },

            init() {
                this._handler = (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
                    if (e.ctrlKey || e.altKey || e.metaKey) return;
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const video = document.querySelector('video.html5-main-video');
                    if (!video) return;

                    if (e.key === '[') {
                        this._loopA = video.currentTime;
                        showToast('Loop Start: ' + this._formatTime(this._loopA), '#22c55e', { duration: 1.5 });
                        this._updateMarkers();
                    } else if (e.key === ']') {
                        this._loopB = video.currentTime;
                        if (this._loopA !== null && this._loopB <= this._loopA) {
                            showToast('Loop end must be after start', '#ef4444', { duration: 2 });
                            this._loopB = null;
                            return;
                        }
                        showToast('Loop End: ' + this._formatTime(this._loopB), '#ef4444', { duration: 1.5 });
                        this._updateMarkers();
                    } else if (e.key === '\\') {
                        if (this._loopA === null || this._loopB === null) {
                            showToast('Set loop points first: [ for start, ] for end', '#f59e0b', { duration: 3 });
                            return;
                        }
                        this._loopActive = !this._loopActive;
                        if (this._loopActive) {
                            this._startLoop();
                            showToast('A-B Loop ON (' + this._formatTime(this._loopA) + ' - ' + this._formatTime(this._loopB) + ')', '#22c55e', { duration: 2 });
                        } else {
                            this._stopLoop();
                            showToast('A-B Loop OFF', '#71717a', { duration: 1.5 });
                        }
                        this._updateMarkers();
                    }
                };
                document.addEventListener('keydown', this._handler);
                // Reset on navigation
                addNavigateRule('abLoopNav', () => {
                    this._loopA = null; this._loopB = null; this._loopActive = false;
                    this._stopLoop();
                    document.querySelector('.ytkit-ab-markers')?.remove();
                });
            },
            destroy() {
                if (this._handler) document.removeEventListener('keydown', this._handler);
                this._handler = null;
                this._stopLoop();
                removeNavigateRule('abLoopNav');
                document.querySelector('.ytkit-ab-markers')?.remove();
                this._loopA = null; this._loopB = null; this._loopActive = false;
            }
        },
        {
            id: 'forceH264',
            name: 'Force H.264 Codec',
            description: 'Prefer H.264 (AVC) over VP9/AV1 for lower CPU usage on older hardware. May reduce max quality.',
            group: 'Quality',
            icon: 'cpu',
            _origCanPlayType: null,

            init() {
                const videoProto = HTMLVideoElement.prototype;
                this._origCanPlayType = videoProto.canPlayType;
                videoProto.canPlayType = function(type) {
                    // Block VP9 and AV1 codecs — YouTube will fall back to H.264
                    if (/vp0?9|av01/i.test(type)) return '';
                    return videoProto.__ytkit_origCanPlayType
                        ? videoProto.__ytkit_origCanPlayType.call(this, type)
                        : '';
                };
                videoProto.__ytkit_origCanPlayType = this._origCanPlayType;
                DebugManager.log('Codec', 'Forcing H.264 — VP9/AV1 blocked');
            },
            destroy() {
                if (this._origCanPlayType) {
                    HTMLVideoElement.prototype.canPlayType = this._origCanPlayType;
                    delete HTMLVideoElement.prototype.__ytkit_origCanPlayType;
                    this._origCanPlayType = null;
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

        'moon': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }
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
        ], _S)
    };

    const CATEGORY_CONFIG = {
        'Interface': { icon: 'interface', color: '#60a5fa' },
        'Appearance': { icon: 'appearance', color: '#f472b6' },
        'Content': { icon: 'content', color: '#34d399' },
        'Video Player': { icon: 'player', color: '#a78bfa' },
        'Playback': { icon: 'gauge', color: '#fb923c' },
        'Ad Blocker': { icon: 'shield', color: '#10b981' },
        'SponsorBlock': { icon: 'sponsor', color: '#22d3ee' },
        'Quality': { icon: 'quality', color: '#facc15' },
        'Clutter': { icon: 'clutter', color: '#f87171' },
        'Live Chat': { icon: 'livechat', color: '#4ade80' },
        'Action Buttons': { icon: 'actions', color: '#c084fc' },
        'Player Controls': { icon: 'controls', color: '#38bdf8' },
        'Downloads': { icon: 'downloads', color: '#f97316' },
        'Video Hider': { icon: 'eye-off', color: '#ef4444' },
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

        const categoryOrder = ['Interface', 'Appearance', 'Content', 'Video Hider', 'Video Player', 'Playback', 'Ad Blocker', 'SponsorBlock', 'Quality', 'Clutter', 'Live Chat', 'Action Buttons', 'Player Controls', 'Downloads'];

        // Group labels: maps first category of each group → label text
        const categoryGroupLabels = {
            'Interface':       'Interface',
            'Content':         'Content',
            'Video Player':    'Player',
            'Ad Blocker':      'Filtering',
            'Live Chat':       'Controls',
        };
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
            // Insert group label before first category of each group
            if (categoryGroupLabels[cat]) {
                const groupLabel = document.createElement('div');
                groupLabel.className = 'ytkit-nav-group-label';
                groupLabel.textContent = categoryGroupLabels[cat];
                if (index > 0) groupLabel.style.marginTop = '10px';
                sidebar.appendChild(groupLabel);
            }

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
                // Live update — store reference so it can be cleared when panel is destroyed
                const _adCountInterval = setInterval(() => {
                    // Stop updating if the element has been removed from the DOM
                    if (!countSpan.isConnected) { clearInterval(_adCountInterval); return; }
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

            // Special handling for Video Hider sidebar
            if (cat === 'Video Hider') {
                const config = CATEGORY_CONFIG[cat];
                const catId = 'Video-Hider';
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
                const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');
                const videoCount = (typeof videoHiderFeature?._getHiddenVideos === 'function' ? videoHiderFeature._getHiddenVideos() : []).length;
                const channelCount = (typeof videoHiderFeature?._getBlockedChannels === 'function' ? videoHiderFeature._getBlockedChannels() : []).length;
                countSpan.textContent = `${videoCount + channelCount}`;
                countSpan.title = 'Hidden videos + blocked channels';

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

            // Drag-reorder support
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
                // Persist order
                const newOrder = Array.from(sidebar.querySelectorAll('.ytkit-nav-btn')).map(b => b.dataset.tab);
                GM_setValue('ytkit_sidebar_order', JSON.stringify(newOrder));
            });

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

        // Recently Changed section
        const recentSection = document.createElement('div');
        recentSection.id = 'ytkit-recent-section';
        recentSection.className = 'ytkit-recent-section';
        recentSection.style.display = 'none';

        function renderRecentSection() {
            while (recentSection.firstChild) recentSection.firstChild.remove();
            if (_recentlyChanged.length === 0) { recentSection.style.display = 'none'; return; }
            recentSection.style.display = 'block';

            const rHeader = document.createElement('div');
            rHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
            const rTitle = document.createElement('span');
            rTitle.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ytkit-text-muted);';
            rTitle.textContent = 'Recently Changed';
            const rClear = document.createElement('button');
            rClear.style.cssText = 'font-size:10px;color:var(--ytkit-text-muted);background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:3px;transition:all 0.15s;';
            rClear.textContent = 'Clear';
            rClear.onmouseenter = () => { rClear.style.color = '#ef4444'; rClear.style.background = 'rgba(239,68,68,0.1)'; };
            rClear.onmouseleave = () => { rClear.style.color = ''; rClear.style.background = ''; };
            rClear.onclick = () => { _recentlyChanged.length = 0; renderRecentSection(); };
            rHeader.appendChild(rTitle);
            rHeader.appendChild(rClear);
            recentSection.appendChild(rHeader);

            const rGrid = document.createElement('div');
            rGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
            _recentlyChanged.forEach(item => {
                const feat = features.find(ff => ff.id === item.id);
                if (!feat) return;
                const pill = document.createElement('button');
                pill.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 10px;font-size:11px;font-weight:500;border-radius:6px;border:1px solid var(--ytkit-border);cursor:pointer;transition:all 0.15s;background:' + (item.enabled ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)') + ';color:' + (item.enabled ? '#22c55e' : '#ef4444') + ';';
                const dot = document.createElement('span');
                dot.style.cssText = 'width:5px;height:5px;border-radius:50%;background:' + (item.enabled ? '#22c55e' : '#ef4444') + ';';
                pill.appendChild(dot);
                const lbl = document.createElement('span');
                lbl.textContent = feat.name;
                lbl.style.color = 'var(--ytkit-text-secondary)';
                pill.appendChild(lbl);
                // Click to navigate to the feature's category
                pill.onclick = () => {
                    const catId = (feat.group || '').replace(/ /g, '-');
                    const navBtn = document.querySelector('.ytkit-nav-btn[data-tab="' + catId + '"]');
                    if (navBtn) navBtn.click();
                };
                pill.onmouseenter = () => { pill.style.borderColor = item.enabled ? '#22c55e' : '#ef4444'; };
                pill.onmouseleave = () => { pill.style.borderColor = ''; };
                rGrid.appendChild(pill);
            });
            recentSection.appendChild(rGrid);
        }

        document.addEventListener('ytkit-recent-changed', renderRecentSection);
        renderRecentSection();

        //  Ad Blocker Custom Pane
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

            // ── Live Ad-Block Stats ──
            if (isActive) {
                const statsRow = document.createElement('div');
                statsRow.style.cssText = 'display:flex;gap:12px;margin-top:8px;padding:8px 10px;background:var(--ytkit-bg-card);border-radius:6px;';
                const abStats = _rw.__ytab?.stats || { blocked: 0, pruned: 0, ssapSkipped: 0 };
                const statItems = [
                    { label: 'Blocked', value: abStats.blocked, color: '#22c55e' },
                    { label: 'Pruned', value: abStats.pruned, color: '#3b82f6' },
                    { label: 'Skipped', value: abStats.ssapSkipped, color: '#f59e0b' }
                ];
                statItems.forEach(s => {
                    const item = document.createElement('div');
                    item.style.cssText = 'display:flex;align-items:center;gap:4px;';
                    const dot = document.createElement('span');
                    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + s.color + ';flex-shrink:0;';
                    const lbl = document.createElement('span');
                    lbl.style.cssText = 'font-size:11px;color:var(--ytkit-text-muted);';
                    lbl.textContent = s.label + ': ' + s.value;
                    item.appendChild(dot);
                    item.appendChild(lbl);
                    statsRow.appendChild(item);
                });
                filterSection.appendChild(statsRow);
                // Auto-refresh stats every 5s while panel is open
                const statsInterval = setInterval(() => {
                    if (!document.body.classList.contains('ytkit-panel-open')) {
                        clearInterval(statsInterval); return;
                    }
                    const live = _rw.__ytab?.stats || {};
                    const labels = statsRow.querySelectorAll('span:last-child');
                    if (labels[0]) labels[0].textContent = 'Blocked: ' + (live.blocked || 0);
                    if (labels[1]) labels[1].textContent = 'Pruned: ' + (live.pruned || 0);
                    if (labels[2]) labels[2].textContent = 'Skipped: ' + (live.ssapSkipped || 0);
                }, 5000);
            }

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
            const paneIcon = document.createElement('span');
            paneIcon.className = 'ytkit-pane-icon';
            paneIcon.style.setProperty('--cat-color', config.color);
            const paneIconFn = ICONS['eye-off'] || ICONS.settings;
            paneIcon.appendChild(paneIconFn());
            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = 'Video Hider';
            paneTitle.appendChild(paneIcon);
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
            tabNav.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--ytkit-border);margin-bottom:20px;';
            const tabs = ['Videos', 'Channels', 'Keywords', 'Settings'];
            tabs.forEach((tabName, i) => {
                const tab = document.createElement('button');
                tab.className = 'ytkit-vh-tab' + (i === 0 ? ' active' : '');
                tab.dataset.tab = tabName.toLowerCase();
                tab.textContent = tabName;
                tab.style.cssText = 'flex:1;padding:12px 16px;background:transparent;border:none;color:var(--ytkit-text-muted);font-size:13px;font-weight:500;cursor:pointer;transition:all 0.2s;border-bottom:2px solid transparent;';
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
                        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--ytkit-text-muted);';
                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:15px;margin-bottom:8px;';
                        emptyTitle.textContent = 'No hidden videos yet';
                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:13px;opacity:0.7;';
                        emptyDesc.textContent = 'Click the X button on video thumbnails to hide them';
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
                            link.textContent = 'View on YouTube';
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
                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:15px;margin-bottom:8px;';
                        emptyTitle.textContent = 'No blocked channels yet';
                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:13px;opacity:0.7;';
                        emptyDesc.textContent = 'Right-click the X button on thumbnails to block channels';
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
                            icon.style.cssText = 'width:40px;height:40px;border-radius:50%;background:var(--ytkit-bg-elevated);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--ytkit-text-muted);';
                            icon.textContent = (ch.name || ch.id || '?')[0].toUpperCase();
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
                    const desc = document.createElement('div');
                    desc.style.cssText = 'color:var(--ytkit-text-muted);font-size:13px;margin-bottom:16px;line-height:1.5;';
                    desc.textContent = 'Videos with titles containing these keywords will be automatically hidden. Separate multiple keywords with commas. Prefix with ! to whitelist. Start with / for regex.';
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
                    durInput.type = 'number'; durInput.min = '0'; durInput.max = '60';
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
                    durRow.appendChild(durInput); durRow.appendChild(durLabel);
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
                    limiterDesc.textContent = "Prevents infinite scrolling when many consecutive videos are hidden.";
                    limiterSection.appendChild(limiterDesc);
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
                    const thresholdRow = document.createElement('div');
                    thresholdRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
                    const thresholdLabel = document.createElement('span');
                    thresholdLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;flex:1;';
                    thresholdLabel.textContent = 'Stop after consecutive hidden batches:';
                    const thresholdInput = document.createElement('input');
                    thresholdInput.type = 'number'; thresholdInput.min = '1'; thresholdInput.max = '20';
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

                    // Stats
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
                    [{ label: 'Hidden Videos', value: videoCount }, { label: 'Blocked Channels', value: channelCount }].forEach(stat => {
                        const statEl = document.createElement('div');
                        statEl.style.cssText = 'padding:16px;background:var(--ytkit-bg-elevated);border-radius:8px;text-align:center;';
                        const val = document.createElement('div');
                        val.style.cssText = 'font-size:24px;font-weight:700;color:var(--ytkit-text-primary);margin-bottom:4px;';
                        val.textContent = stat.value;
                        const lbl = document.createElement('div');
                        lbl.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);';
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

        content.appendChild(recentSection);

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
            versionSpan.title = `New in v${YTKIT_VERSION}: Architecture hardening, inline Quick Links editor, settings migration, observer consolidation, leak fixes`;
            versionSpan.onclick = () => {
                GM_setValue('ytkit_last_seen_version', CURRENT_VER);
                badge.remove();
                showToast(`v${YTKIT_VERSION}: Error boundaries, settings migration, Quick Links editor, observer consolidation, leak fixes`, '#3b82f6', { duration: 6 });
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

        // Feature state badge
        const _status = getFeatureStatus(f);
        if (_status.label && !isSubFeature) {
            const statusBadge = document.createElement('span');
            statusBadge.className = 'ytkit-status-badge';
            statusBadge.dataset.status = _status.status;
            statusBadge.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:2px 7px;border-radius:100px;margin-top:4px;letter-spacing:0.02em;';
            const dot = document.createElement('span');
            dot.style.cssText = 'width:5px;height:5px;border-radius:50%;background:' + _status.color + ';flex-shrink:0;';
            if (_status.status === 'active') dot.style.boxShadow = '0 0 4px ' + _status.color;
            statusBadge.appendChild(dot);
            const lbl = document.createElement('span');
            lbl.textContent = _status.label;
            lbl.style.color = _status.color;
            statusBadge.appendChild(lbl);
            info.appendChild(statusBadge);
        }

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
                el.innerHTML = '';
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

                    // Track recently changed
                    trackRecentChange(featureId, isEnabled);

                    if (feature) {
                        if (isEnabled) {
                            // Reset crash counter on manual toggle-on
                            _featureCrashCounts[featureId] = 0;
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
        GM_addStyle(`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');:root{--ytkit-font:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;--ytkit-bg-base:#0a0a0b;--ytkit-bg-elevated:#111113;--ytkit-bg-surface:#18181b;--ytkit-bg-hover:#1f1f23;--ytkit-bg-active:#27272a;--ytkit-border:#27272a;--ytkit-border-subtle:#1f1f23;--ytkit-text-primary:#fafafa;--ytkit-text-secondary:#a1a1aa;--ytkit-text-muted:#71717a;--ytkit-accent:#ff4e45;--ytkit-accent-soft:rgba(255,78,69,0.15);--ytkit-success:#22c55e;--ytkit-error:#ef4444;--ytkit-radius-sm:6px;--ytkit-radius-md:10px;--ytkit-radius-lg:14px;--ytkit-radius-xl:20px;--ytkit-shadow-sm:0 1px 2px rgba(0,0,0,0.3);--ytkit-shadow-md:0 4px 12px rgba(0,0,0,0.4);--ytkit-shadow-lg:0 8px 32px rgba(0,0,0,0.5);--ytkit-shadow-xl:0 24px 64px rgba(0,0,0,0.6);--ytkit-transition:200ms cubic-bezier(0.4,0,0.2,1);} .ytkit-vlc-btn,.ytkit-local-dl-btn,.ytkit-mp3-dl-btn,.ytkit-transcript-btn,.ytkit-mpv-btn,.ytkit-dlplay-btn,.ytkit-embed-btn{display:inline-flex !important;visibility:visible !important;opacity:1 !important;z-index:9999 !important;position:relative !important;} /* z-index for action buttons kept at 9999 to ensure visibility within YT layout */ .ytkit-button-container{display:flex !important;gap:8px !important;margin:8px 0 !important;flex-wrap:wrap !important;visibility:visible !important;} .ytkit-trigger-btn{display:flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;margin:0 4px;background:transparent;border:none;border-radius:var(--ytkit-radius-md);cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-trigger-btn svg{width:22px;height:22px;color:var(--yt-spec-icon-inactive,#aaa);transition:all var(--ytkit-transition);} .ytkit-trigger-btn:hover{background:var(--yt-spec-badge-chip-background,rgba(255,255,255,0.1));} .ytkit-trigger-btn:hover svg{color:var(--yt-spec-text-primary,#fff);transform:rotate(45deg);} #ytkit-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:80000;opacity:0;pointer-events:none;transition:opacity 300ms ease;} body.ytkit-panel-open #ytkit-overlay{opacity:1;pointer-events:auto;} #ytkit-settings-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.96);z-index:80001;display:flex;flex-direction:column;width:95%;max-width:1100px;height:85vh;max-height:800px;background:var(--ytkit-bg-base);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-xl);box-shadow:var(--ytkit-shadow-xl),0 0 0 1px rgba(255,255,255,0.05) inset;font-family:var(--ytkit-font);color:var(--ytkit-text-primary);opacity:0;pointer-events:none;transition:all 300ms cubic-bezier(0.32,0.72,0,1);overflow:hidden;} body.ytkit-panel-open #ytkit-settings-panel{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1);} .ytkit-header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;background:linear-gradient(180deg,var(--ytkit-bg-elevated) 0%,var(--ytkit-bg-base) 100%);border-bottom:1px solid var(--ytkit-border);flex-shrink:0;} .ytkit-brand{display:flex;align-items:center;gap:12px;} .ytkit-logo{display:flex;align-items:center;justify-content:center;width:42px;height:42px;background:linear-gradient(135deg,#ff0000 0%,#cc0000 100%);border-radius:var(--ytkit-radius-md);box-shadow:0 4px 12px rgba(255,0,0,0.3);} .ytkit-yt-icon{width:26px;height:auto;} .ytkit-title{font-size:26px;font-weight:700;letter-spacing:-0.5px;margin:0;} .ytkit-title-yt{background:linear-gradient(135deg,#ff4e45 0%,#ff0000 50%,#ff4e45 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:ytkit-shimmer 3s linear infinite;} .ytkit-title-kit{color:var(--ytkit-text-primary);} @keyframes ytkit-shimmer{0%{background-position:0% center;} 100%{background-position:200% center;} } .ytkit-badge{padding:4px 10px;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#fff;background:linear-gradient(135deg,#ff4e45,#ff0000);border-radius:100px;box-shadow:0 2px 8px rgba(255,78,69,0.4);} .ytkit-close{display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-md);cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-close svg{width:18px;height:18px;color:var(--ytkit-text-secondary);transition:color var(--ytkit-transition);} .ytkit-close:hover{background:var(--ytkit-error);border-color:var(--ytkit-error);} .ytkit-close:hover svg{color:#fff;} .ytkit-body{display:flex;flex:1;overflow:hidden;} .ytkit-sidebar{display:flex;flex-direction:column;width:240px;padding:16px 12px;background:var(--ytkit-bg-elevated);border-right:1px solid var(--ytkit-border);overflow-y:auto;flex-shrink:0;} .ytkit-search-container{position:relative;margin-bottom:12px;} .ytkit-search-input{width:100%;padding:10px 12px 10px 36px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-md);color:var(--ytkit-text-primary);font-size:13px;transition:all var(--ytkit-transition);} .ytkit-search-input:focus{outline:none;border-color:var(--ytkit-accent);box-shadow:0 0 0 3px rgba(255,78,69,0.15);} .ytkit-search-input::placeholder{color:var(--ytkit-text-muted);} .ytkit-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--ytkit-text-muted);pointer-events:none;} .ytkit-sidebar-divider{height:1px;background:var(--ytkit-border);margin:8px 0 12px;} .ytkit-pane.ytkit-search-active{display:block;} .ytkit-pane.ytkit-search-active .ytkit-pane-header{display:none;} .ytkit-nav-btn{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;margin-bottom:2px;background:transparent;border:none;border-radius:var(--ytkit-radius-md);cursor:pointer;transition:all var(--ytkit-transition);text-align:left;} .ytkit-nav-btn:hover{background:var(--ytkit-bg-hover);} .ytkit-nav-btn.active{background:var(--ytkit-bg-active);} .ytkit-nav-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:var(--ytkit-bg-surface);border-radius:var(--ytkit-radius-sm);flex-shrink:0;transition:all var(--ytkit-transition);} .ytkit-nav-btn.active .ytkit-nav-icon{background:var(--cat-color,var(--ytkit-accent));box-shadow:0 2px 8px color-mix(in srgb,var(--cat-color,var(--ytkit-accent)) 40%,transparent);} .ytkit-nav-icon svg{width:16px;height:16px;color:var(--ytkit-text-secondary);transition:color var(--ytkit-transition);} .ytkit-nav-btn.active .ytkit-nav-icon svg{color:#fff;} .ytkit-nav-label{flex:1;font-size:13px;font-weight:500;color:var(--ytkit-text-secondary);transition:color var(--ytkit-transition);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .ytkit-nav-btn.active .ytkit-nav-label{color:var(--ytkit-text-primary);} .ytkit-nav-count{font-size:11px;font-weight:600;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);padding:2px 6px;border-radius:100px;transition:all var(--ytkit-transition);} .ytkit-nav-btn.active .ytkit-nav-count{background:rgba(255,255,255,0.15);color:var(--ytkit-text-primary);} .ytkit-nav-arrow{display:flex;opacity:0;transition:opacity var(--ytkit-transition);} .ytkit-nav-arrow svg{width:14px;height:14px;color:var(--ytkit-text-muted);} .ytkit-nav-btn.active .ytkit-nav-arrow{opacity:1;} .ytkit-nav-group-label{padding:4px 12px 2px;font-size:9.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ytkit-text-muted);user-select:none;pointer-events:none;} .ytkit-content{flex:1;padding:24px;overflow-y:auto;background:var(--ytkit-bg-base);} .ytkit-pane{display:none;animation:ytkit-fade-in 300ms ease;} .ytkit-pane.active{display:block;} .ytkit-pane.ytkit-vh-pane.active{display:flex;flex-direction:column;height:100%;max-height:calc(85vh - 180px);} #ytkit-vh-content{flex:1;overflow-y:auto;padding-right:8px;} @keyframes ytkit-fade-in{from{opacity:0;transform:translateX(8px);} to{opacity:1;transform:translateX(0);} } @keyframes ytkit-badge-pulse{0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.5;transform:scale(1.3);} } .ytkit-pane-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--ytkit-border);} .ytkit-pane-title{display:flex;align-items:center;gap:12px;} .ytkit-pane-icon{display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:var(--cat-color,var(--ytkit-accent));border-radius:var(--ytkit-radius-md);box-shadow:0 4px 12px color-mix(in srgb,var(--cat-color,var(--ytkit-accent)) 30%,transparent);} .ytkit-pane-icon svg{width:20px;height:20px;color:#fff;} .ytkit-pane-title h2{font-size:20px;font-weight:600;margin:0;color:var(--ytkit-text-primary);} .ytkit-toggle-all{display:flex;align-items:center;gap:10px;cursor:pointer;} .ytkit-toggle-all span{font-size:13px;font-weight:500;color:var(--ytkit-text-secondary);} .ytkit-reset-group-btn{padding:6px 12px;margin-right:12px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-sm);color:var(--ytkit-text-muted);font-size:12px;font-weight:500;cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-reset-group-btn:hover{background:var(--ytkit-error);border-color:var(--ytkit-error);color:#fff;} .ytkit-features-grid{display:flex;flex-direction:column;gap:8px;} .ytkit-feature-card{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border-subtle);border-left:3px solid transparent;border-radius:var(--ytkit-radius-md);transition:all var(--ytkit-transition);} .ytkit-feature-card:hover{background:var(--ytkit-bg-hover);border-color:var(--ytkit-border);border-left-color:transparent;} .ytkit-feature-card.ytkit-card-enabled{border-left-color:var(--cat-color,var(--ytkit-accent));} .ytkit-sub-card{margin-left:24px;background:var(--ytkit-bg-elevated);border-left:2px solid var(--ytkit-accent-soft);} .ytkit-sub-features{display:flex;flex-direction:column;gap:8px;} .ytkit-feature-info{flex:1;min-width:0;padding-right:16px;} .ytkit-feature-name{font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin:0 0 4px 0;} .ytkit-feature-desc{font-size:12px;color:var(--ytkit-text-muted);margin:0;line-height:1.4;} .ytkit-textarea-card{flex-direction:column;align-items:stretch;gap:12px;} .ytkit-textarea-card .ytkit-feature-info{padding-right:0;} .ytkit-input{width:100%;padding:10px 12px;font-family:var(--ytkit-font);font-size:13px;color:var(--ytkit-text-primary);background:var(--ytkit-bg-base);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-sm);resize:vertical;min-height:60px;transition:all var(--ytkit-transition);} .ytkit-input:focus{outline:none;border-color:var(--ytkit-accent);box-shadow:0 0 0 3px var(--ytkit-accent-soft);} .ytkit-input::placeholder{color:var(--ytkit-text-muted);} .ytkit-switch{position:relative;width:44px;height:24px;flex-shrink:0;} .ytkit-switch input{position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;z-index:1;margin:0;} .ytkit-switch-track{position:absolute;inset:0;background:var(--ytkit-bg-active);border-radius:100px;transition:all var(--ytkit-transition);} .ytkit-switch.active .ytkit-switch-track{background:var(--switch-color,var(--ytkit-accent));box-shadow:0 0 12px color-mix(in srgb,var(--switch-color,var(--ytkit-accent)) 50%,transparent);} .ytkit-switch-thumb{position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;box-shadow:var(--ytkit-shadow-sm);transition:all var(--ytkit-transition);display:flex;align-items:center;justify-content:center;} .ytkit-switch.active .ytkit-switch-thumb{transform:translateX(20px);} .ytkit-switch-icon{display:flex;opacity:0;transform:scale(0.5);transition:all var(--ytkit-transition);} .ytkit-switch-icon svg{width:12px;height:12px;color:var(--switch-color,var(--ytkit-accent));} .ytkit-switch.active .ytkit-switch-icon{opacity:1;transform:scale(1);} .ytkit-footer{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:var(--ytkit-bg-elevated);border-top:1px solid var(--ytkit-border);flex-shrink:0;} .ytkit-footer-left{display:flex;align-items:center;gap:16px;} .ytkit-github{display:flex;align-items:center;justify-content:center;width:32px;height:32px;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);border-radius:var(--ytkit-radius-sm);transition:all var(--ytkit-transition);} .ytkit-github:hover{color:var(--ytkit-text-primary);background:var(--ytkit-bg-hover);} .ytkit-github svg{width:18px;height:18px;} .ytkit-version{font-size:12px;font-weight:600;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);padding:4px 10px;border-radius:100px;} .ytkit-shortcut{font-size:11px;color:var(--ytkit-text-muted);background:var(--ytkit-bg-surface);padding:4px 8px;border-radius:var(--ytkit-radius-sm);font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;} .ytkit-footer-right{display:flex;gap:10px;} .ytkit-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;font-family:var(--ytkit-font);font-size:13px;font-weight:600;border:none;border-radius:var(--ytkit-radius-md);cursor:pointer;transition:all var(--ytkit-transition);} .ytkit-btn svg{width:16px;height:16px;} .ytkit-btn-secondary{color:var(--ytkit-text-secondary);background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);} .ytkit-btn-secondary:hover{background:var(--ytkit-bg-hover);color:var(--ytkit-text-primary);} .ytkit-btn-primary{color:#fff;background:linear-gradient(135deg,#ff4e45,#e6423a);box-shadow:0 2px 8px rgba(255,78,69,0.3);} .ytkit-btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(255,78,69,0.4);} .ytkit-toast{position:fixed;bottom:-80px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:14px 20px;font-family:var(--ytkit-font);font-size:14px;font-weight:500;color:#fff;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-lg);box-shadow:var(--ytkit-shadow-lg);z-index:90000;transition:all 400ms cubic-bezier(0.68,-0.55,0.27,1.55);} .ytkit-toast.show{bottom:24px;} .ytkit-toast-success{border-color:var(--ytkit-success);box-shadow:0 4px 20px rgba(34,197,94,0.2);} .ytkit-toast-error{border-color:var(--ytkit-error);box-shadow:0 4px 20px rgba(239,68,68,0.2);}ytd-watch-metadata.watch-active-metadata{margin-top:180px !important;} ytd-live-chat-frame:not([style*="position"]){margin-top:-57px !important;width:402px !important;} .ytkit-sidebar::-webkit-scrollbar,.ytkit-content::-webkit-scrollbar{width:6px;} .ytkit-sidebar::-webkit-scrollbar-track,.ytkit-content::-webkit-scrollbar-track{background:transparent;} .ytkit-sidebar::-webkit-scrollbar-thumb,.ytkit-content::-webkit-scrollbar-thumb{background:var(--ytkit-border);border-radius:100px;} .ytkit-sidebar::-webkit-scrollbar-thumb:hover,.ytkit-content::-webkit-scrollbar-thumb:hover{background:var(--ytkit-text-muted);}  .ytkit-css-editor{width:100%;min-height:150px;padding:12px;background:var(--ytkit-bg-base);border:1px solid var(--ytkit-border);border-radius:var(--ytkit-radius-md);color:var(--ytkit-text-primary);font-family:'Monaco','Menlo','Ubuntu Mono',monospace;font-size:13px;line-height:1.5;resize:vertical;} .ytkit-css-editor:focus{outline:none;border-color:var(--ytkit-accent);} .ytkit-bulk-bar{animation:slideDown 0.2s ease-out;} @keyframes slideDown{from{opacity:0;transform:translateY(-10px);} to{opacity:1;transform:translateY(0);} }

/* ─── Drag-reorder sidebar ─── */
.ytkit-nav-btn{cursor:grab;user-select:none;}
.ytkit-nav-btn:active{cursor:grabbing;}
.ytkit-nav-btn.ytkit-dragging{opacity:0.3;transform:scale(0.95);}
.ytkit-drag-above{box-shadow:0 -2px 0 0 var(--ytkit-accent) inset;}
.ytkit-drag-below{box-shadow:0 2px 0 0 var(--ytkit-accent) inset;}

/* ─── Recently Changed section ─── */
.ytkit-recent-section{margin-bottom:20px;padding:12px 14px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border-subtle);border-radius:var(--ytkit-radius-md);}

/* ─── Feature Preview Tooltip ─── */
.ytkit-feature-card.ytkit-has-preview{position:relative;}
.ytkit-feature-card.ytkit-has-preview::after{content:attr(data-preview);position:absolute;bottom:calc(100% + 8px);left:16px;right:16px;padding:8px 12px;background:#1a1a2e;color:var(--ytkit-text-secondary);font-size:11px;line-height:1.45;border-radius:8px;border:1px solid var(--ytkit-border);box-shadow:var(--ytkit-shadow-md);opacity:0;pointer-events:none;transition:opacity 0.2s ease 0.5s,transform 0.2s ease 0.5s;transform:translateY(4px);z-index:10;white-space:normal;}
.ytkit-feature-card.ytkit-has-preview:hover::after{opacity:1;transform:translateY(0);}

/* ─── Responsive Breakpoints ─── */
@media (max-width:900px){
    #ytkit-settings-panel{width:98%;height:92vh;max-height:none;border-radius:12px;}
    .ytkit-sidebar{width:200px;padding:10px 8px;}
    .ytkit-nav-label{font-size:12px;}
    .ytkit-nav-icon{width:28px;height:28px;}
    .ytkit-nav-icon svg{width:14px;height:14px;}
    .ytkit-content{padding:16px;}
    .ytkit-pane-title h2{font-size:17px;}
}
@media (max-width:700px){
    .ytkit-body{flex-direction:column;}
    .ytkit-sidebar{width:100%;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:none;border-bottom:1px solid var(--ytkit-border);padding:8px;gap:4px;flex-shrink:0;max-height:none;height:auto;}
    .ytkit-search-container{display:none;}
    .ytkit-sidebar-divider{display:none;}
    .ytkit-nav-group-label{display:none;}
    .ytkit-nav-btn{flex-direction:column;gap:3px;padding:6px 10px;min-width:fit-content;white-space:nowrap;margin-bottom:0;border-radius:8px;}
    .ytkit-nav-icon{width:24px;height:24px;}
    .ytkit-nav-label{font-size:10px;}
    .ytkit-nav-count{font-size:9px;padding:1px 4px;}
    .ytkit-nav-arrow{display:none !important;}
    .ytkit-content{padding:12px;flex:1;overflow-y:auto;}
    .ytkit-pane-header{flex-wrap:wrap;gap:8px;}
    .ytkit-toggle-all span{font-size:11px;}
    .ytkit-feature-card{padding:10px 12px;}
    .ytkit-feature-name{font-size:13px;}
    .ytkit-feature-desc{font-size:11px;}
    .ytkit-header{padding:12px 16px;}
    .ytkit-title{font-size:20px;}
    .ytkit-footer{padding:10px 16px;flex-wrap:wrap;gap:8px;}
    .ytkit-footer-left{gap:8px;}
    .ytkit-btn{padding:8px 12px;font-size:12px;}
    .ytkit-recent-section{margin-bottom:12px;padding:10px;}
    /* Tooltip below on mobile */
    .ytkit-feature-card.ytkit-has-preview::after{bottom:auto;top:calc(100% + 4px);left:8px;right:8px;}
}
@media (max-width:480px){
    #ytkit-settings-panel{width:100%;height:100vh;border-radius:0;max-height:100vh;}
    .ytkit-sidebar{padding:6px;gap:2px;}
    .ytkit-nav-btn{padding:5px 8px;}
    .ytkit-content{padding:10px;}
    .ytkit-pane-icon{width:32px;height:32px;}
    .ytkit-pane-icon svg{width:16px;height:16px;}
    .ytkit-pane-title h2{font-size:15px;}
    .ytkit-sub-card{margin-left:12px;}
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
            { id: 'fitPlayerToWindow',           label: 'Fit to Window' },
            { id: 'expandVideoWidth',            label: 'Expand Width' },
            { id: 'skipSponsors',                label: 'SponsorBlock' },
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
            stats() {
                const ab = _rw.__ytab?.stats || {};
                console.table({ 'Ads Blocked': ab.blocked || 0, 'Responses Pruned': ab.pruned || 0, 'SSAP Skipped': ab.ssapSkipped || 0 });
                return ab;
            },
            diagCSS() {
                document.getElementById('ytab-cosmetic')?.remove();
                document.getElementById('ytkit-opened-fix')?.remove();
                console.log('[YTKit Diag] Removed ad-blocker cosmetic CSS + .opened fix');
            },
            diagAdblock(enable = false) {
                GM_setValue('ytab_enabled', enable);
                console.log(`[YTKit Diag] Ad blocker ${enable ? 'enabled' : 'disabled'} — reloading...`);
                location.reload();
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

        const _featureCrashCounts = {};
        const MAX_FEATURE_CRASHES = 3;

        if (isSafeMode) {
            console.log('%c[YTKit] SAFE MODE — All features disabled. ytkit.unsafe() to exit.', 'color:#f97316;font-weight:bold;font-size:16px;');
            showToast('SAFE MODE — All features disabled. Console: ytkit.unsafe() to exit.', '#f97316', { duration: 10 });
        } else {
            // TIER 0: Critical — adblock, cosmetics, CSS-only, Theater Split.
            //         Must run synchronously before any page content paints.
            // TIER 1: Normal — all other non-watch-page-specific features.
            //         Run in rAF to avoid blocking first paint.
            // TIER 2: Watch-page-only — heavy features that aren't needed until
            //         the video is playing. Deferred 1500ms via requestIdleCallback.
            const CRITICAL_IDS = new Set([
                'ytAdBlock','adblockCosmeticHide','adblockSsapAutoSkip','adblockAntiDetect',
                'stickyVideo','uiStyleManager',
            ]);
            const LAZY_IDS = new Set([
                // Only defer watch-page-only features that are heavy or network-bound
                'skipSponsors',
                'autoResumePosition','chapterProgressBar',
            ]);

            const initFeature = (f) => {
                if (f._arrayKey) return;
                const isEnabled = (f.type === 'select' || f.type === 'color' || f.type === 'range')
                    ? true : appState.settings[f.id];
                if (!isEnabled) return;
                if (f.pages && !f.pages.includes(appState.currentPage)) return;
                if (f.dependsOn && !appState.settings[f.dependsOn]) return;
                if (f._initialized) return;
                // Skip features that have crashed too many times
                if ((_featureCrashCounts[f.id] || 0) >= MAX_FEATURE_CRASHES) {
                    DebugManager.log('Init', `Skipping "${f.id}" — crashed ${MAX_FEATURE_CRASHES}+ times`);
                    return;
                }
                try { f.init?.(); f._initialized = true; _featureCrashCounts[f.id] = 0; } catch(err) {
                    _featureCrashCounts[f.id] = (_featureCrashCounts[f.id] || 0) + 1;
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
                            try { f.init?.(); f._initialized = true; _featureCrashCounts[f.id] = 0; } catch(e) {
                                _featureCrashCounts[f.id] = (_featureCrashCounts[f.id] || 0) + 1;
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