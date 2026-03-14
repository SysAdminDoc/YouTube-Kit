// ==UserScript==
// @name         YTKit v3.0.0
// @namespace    https://github.com/SysAdminDoc/YouTube-Kit
// @version      3.0.0
// @description  YouTube customization: Theater Split, Subscriptions Grid, Downloads, Logo Quick Links, Video Hider
// @author       Matthew Parker
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0: TRUSTED TYPES, CONSTANTS, SETTINGS
    // ══════════════════════════════════════════════════════════════════════════

    const YTKIT_VERSION = '3.0.0';

    // Trusted Types policy for YouTube's CSP
    const TrustedHTML = (() => {
        let policy = null;
        if (typeof window.trustedTypes !== 'undefined' && window.trustedTypes.createPolicy) {
            try {
                policy = window.trustedTypes.createPolicy('ytkit-policy', { createHTML: (s) => s });
            } catch (e) {}
        }
        return {
            setHTML(el, html) {
                if (policy) { el.innerHTML = policy.createHTML(html); }
                else {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(`<template>${html}</template>`, 'text/html');
                    const tpl = doc.querySelector('template');
                    el.innerHTML = '';
                    if (tpl?.content) el.appendChild(tpl.content.cloneNode(true));
                }
            }
        };
    })();

    // Z-Index hierarchy
    const Z = {
        HIDE_BTN: 1000,
        BUTTONS: 9999,
        TS_OVERLAY: 9999,
        TS_CONTENT: 10001,
        BANNER: 50000,
        CONTEXT_MENU: 60000,
        TOAST: 70000,
        DL_PROGRESS: 2147483647
    };

    // ── Settings with defaults ──
    const DEFAULTS = {
        // Theater Split
        ts_split_ratio: 75,
        // Subscriptions
        subscriptionsGrid: true,
        fullWidthSubscriptions: true,
        // Downloads
        showLocalDownloadButton: true,
        showMp3DownloadButton: true,
        showVlcButton: true,
        videoContextMenu: true,
        cobaltUrl: 'https://cobalt.meowing.de/#',
        // Quick Links
        floatingLogoOnWatch: true,
        quickLinkMenu: true,
        quickLinkItems: 'History | /feed/history\nWatch Later | /playlist?list=WL\nPlaylists | /feed/library\nLiked Videos | /playlist?list=LL\nSubscriptions | /feed/subscriptions\nFor You Page | /',
        // Video Hider
        hideVideosFromHome: true,
        hideVideosKeywordFilter: '',
        hideVideosDurationFilter: 0,
        hideVideosSubsLoadLimit: true,
        hideVideosSubsLoadThreshold: 3,
    };

    function getSetting(key) {
        return GM_getValue('ytkit_' + key, DEFAULTS[key]);
    }

    function setSetting(key, val) {
        GM_setValue('ytkit_' + key, val);
    }

    // ── Page Type ──
    function getCurrentPage() {
        const p = location.pathname;
        if (p === '/' || p === '/feed/trending') return 'home';
        if (p.startsWith('/watch')) return 'watch';
        if (p.startsWith('/results')) return 'search';
        if (p.startsWith('/shorts')) return 'shorts';
        if (p.startsWith('/feed/subscriptions')) return 'subscriptions';
        if (p.startsWith('/@') || p.startsWith('/channel') || p.startsWith('/c/') || p.startsWith('/user/')) return 'channel';
        return 'other';
    }

    function isWatchPage() { return location.pathname === '/watch'; }

    function getVideoId() {
        return new URL(location.href).searchParams.get('v') || '';
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0A: EARLY CSS (anti-FOUC) — injected at document-start
    // ══════════════════════════════════════════════════════════════════════════

    const earlyStyle = document.createElement('style');
    earlyStyle.textContent = `
        /* ── Theater Split ── */
        body.ts-active ytd-masthead,
        body.ts-active #masthead-container { display: none !important; }
        html:has(body.ts-active), body.ts-active { overflow: hidden !important; }
        #ts-wrapper { display:none; }
        body.ts-active #ts-wrapper { display:flex; }
        ytd-watch-flexy[fullscreen] ~ #ts-wrapper,
        body:fullscreen #ts-wrapper { display:none !important; }
        body.ts-active #secondary,
        body.ts-active #below,
        body.ts-active #player-full-bleed-container,
        body.ts-active #columns,
        body.ts-active ytd-watch-flexy {
            view-transition-name: none !important;
        }
        body.ts-split ytd-live-chat-frame#chat,
        body.ts-split ytd-live-chat-frame {
            height: 100vh !important;
            max-height: none !important;
            min-height: 0 !important;
            visibility: visible !important;
            display: flex !important;
            flex-direction: column !important;
        }
        body.ts-split #chat-container {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            visibility: visible !important;
        }
        body.ts-split ytd-live-chat-frame#chat > iframe,
        body.ts-split ytd-live-chat-frame > iframe {
            flex: 1 !important;
            height: 100% !important;
            min-height: 0 !important;
            max-height: none !important;
        }
        body.ts-active ytd-watch-flexy.loading ytd-live-chat-frame#chat,
        body.ts-active ytd-watch-flexy:not([ghost-cards-enabled]).loading #chat {
            visibility: visible !important;
        }

        /* ── Video Hider ── */
        .ytkit-video-hide-btn { position:absolute;top:8px;right:8px;width:28px;height:28px;background:rgba(0,0,0,0.8);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:${Z.HIDE_BTN};opacity:0;transition:all 0.15s;padding:0;color:#fff; }
        .ytkit-video-hide-btn:hover { background:rgba(200,0,0,0.9);transform:scale(1.1); }
        .ytkit-video-hide-btn svg { width:16px;height:16px;fill:#fff;pointer-events:none; }
        ytd-rich-item-renderer:hover .ytkit-video-hide-btn, ytd-video-renderer:hover .ytkit-video-hide-btn, ytd-grid-video-renderer:hover .ytkit-video-hide-btn, ytd-compact-video-renderer:hover .ytkit-video-hide-btn { opacity:1; }
        .ytkit-video-hidden { display:none !important; }

        /* ── Toast animation ── */
        @keyframes ytkit-toast-fade { 0%{opacity:0;transform:translateX(-50%) translateY(20px)} 8%{opacity:1;transform:translateX(-50%) translateY(0)} 75%{opacity:1;transform:translateX(-50%) translateY(0)} 100%{opacity:0;transform:translateX(-50%) translateY(-10px)} }

        /* ── Download progress animation ── */
        @keyframes ytkit-slide-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .ytkit-dl-fill{transition:width 0.3s ease}
    `;
    (document.head || document.documentElement).appendChild(earlyStyle);


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 1: SHARED UTILITIES
    // ══════════════════════════════════════════════════════════════════════════

    function showToast(message, color = '#22c55e', options = {}) {
        document.querySelector('.ytkit-global-toast')?.remove();
        const toast = document.createElement('div');
        toast.className = 'ytkit-global-toast';
        toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${color};color:white;padding:12px 24px;border-radius:8px;font-family:"Roboto",Arial,sans-serif;font-size:14px;font-weight:500;z-index:${Z.TOAST};box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:12px;animation:ytkit-toast-fade ${options.duration || 2.5}s ease-out forwards;`;
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        toast.appendChild(textSpan);
        if (options.action) {
            const actionBtn = document.createElement('button');
            actionBtn.textContent = options.action.text || 'Action';
            actionBtn.style.cssText = 'background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:white;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;';
            actionBtn.onclick = (e) => { e.stopPropagation(); options.action.onClick?.(); toast.remove(); };
            toast.appendChild(actionBtn);
        }
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), (options.duration || 2.5) * 1000 + 200);
    }

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

    function injectStyle(css, id) {
        const styleId = `ytkit-style-${id}`;
        document.getElementById(styleId)?.remove();
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        return s;
    }

    // Navigation event tracking
    const _navCallbacks = new Map();
    function addNavigateRule(id, fn) { _navCallbacks.set(id, fn); }
    function removeNavigateRule(id) { _navCallbacks.delete(id); }
    function fireNavigateRules() { _navCallbacks.forEach(fn => fn()); }

    function setStyles(el, props) {
        if (!el) return;
        for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
    }

    function removeStyles(el, props) {
        if (!el) return;
        props.forEach(p => el.style.removeProperty(p));
    }


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 2: THEATER SPLIT
    // ══════════════════════════════════════════════════════════════════════════

    const TheaterSplit = (() => {
        const TRANSITION = '0.35s cubic-bezier(0.4,0,0.2,1)';

        let isActive = false;
        let isSplit = false;
        let entering = false;
        let videoType = 'standard';
        let splitWrapper = null;
        let positionedEls = [];
        let scrollTarget = null;
        let wheelHandler = null;
        let touchHandler = null;
        let touchMoveHandler = null;
        let touchStartY = 0;
        let windowResizeHandler = null;
        let playerResizeObs = null;
        let resizeTimer = null;
        let lastVideoId = null;
        let chatObserver = null;

        function getPlayer() { return document.querySelector('#player-container'); }
        function getBelow() { return document.querySelector('#below') || document.querySelector('ytd-watch-metadata')?.parentElement; }
        function getChatEl() { return document.querySelector('ytd-live-chat-frame#chat') || document.querySelector('ytd-live-chat-frame'); }

        function getSavedRatio() {
            try { return parseFloat(getSetting('ts_split_ratio')) || 75; } catch { return 75; }
        }
        function saveRatio(v) { setSetting('ts_split_ratio', v); }

        function detectVideoType() {
            const chatEl = getChatEl();
            try {
                const vd = window.ytInitialPlayerResponse?.videoDetails;
                if (vd?.isLiveContent) return vd.isLive ? 'live' : 'vod';
            } catch {}
            try {
                const flexy = document.querySelector('ytd-watch-flexy');
                const pd = flexy?.playerData_ || flexy?.__data?.playerData_;
                if (pd?.videoDetails?.isLiveContent) return pd.videoDetails.isLive ? 'live' : 'vod';
            } catch {}
            if (chatEl) {
                const liveBadge = document.querySelector('.ytp-live-badge');
                if (liveBadge && !liveBadge.hasAttribute('disabled')) return 'live';
                return 'vod';
            }
            try {
                const flexy = document.querySelector('ytd-watch-flexy');
                if (flexy?.hasAttribute('live-chat-present-and-expanded')) {
                    const liveBadge = document.querySelector('.ytp-live-badge');
                    if (liveBadge && !liveBadge.hasAttribute('disabled')) return 'live';
                    return 'vod';
                }
            } catch {}
            return 'standard';
        }

        function triggerPlayerResize() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 200);
        }

        function forcePlayerSize() {
            if (!isActive) return;
            const mp = document.getElementById('movie_player');
            if (!mp) return;
            setStyles(mp, { width: '100%', height: '100%' });
            const vc = mp.querySelector('.html5-video-container');
            const vid = mp.querySelector('video.html5-main-video');
            if (vc) setStyles(vc, { width: '100%', height: '100%' });
            if (vid) setStyles(vid, { width: '100%', height: '100%', 'object-fit': 'contain' });
            const ytdP = mp.closest('ytd-player');
            const innerCont = ytdP?.querySelector('#container');
            if (innerCont) setStyles(innerCont, { width: '100%', height: '100%', 'padding-bottom': '0' });
        }

        function positionOverRight(el, rightPct, topOffset, heightStr) {
            if (!el) return;
            setStyles(el, {
                position: 'fixed', top: topOffset || '0', right: '0',
                width: `calc(${rightPct}% - 6px)`, 'max-width': 'none',
                height: heightStr || '100vh', 'max-height': 'none',
                'min-height': '0', margin: '0',
                'overflow-y': 'auto', 'overflow-x': 'hidden',
                'z-index': String(Z.TS_CONTENT), background: '#0f0f0f', padding: '0',
                'box-sizing': 'border-box', visibility: 'visible',
                'pointer-events': 'auto',
                'scrollbar-width': 'thin', 'scrollbar-color': 'rgba(255,255,255,0.15) transparent'
            });
            positionedEls.push(el);
        }

        function unpositionEl(el) {
            removeStyles(el, ['position', 'top', 'right', 'width', 'max-width', 'height', 'max-height',
                'min-height', 'margin', 'overflow-y', 'overflow-x', 'z-index', 'background', 'padding',
                'box-sizing', 'visibility', 'pointer-events', 'display', 'flex-direction',
                'scrollbar-width', 'scrollbar-color', 'border-radius', 'border-bottom']);
        }

        function unpositionAll() {
            positionedEls.forEach(el => unpositionEl(el));
            positionedEls = [];
            scrollTarget = null;
        }

        function forceChatFill(chatEl) {
            if (!chatEl) return;
            setStyles(chatEl, { display: 'flex', 'flex-direction': 'column', 'max-height': 'none', 'min-height': '0', overflow: 'hidden', border: 'none' });
            const showHide = chatEl.querySelector('#show-hide-button');
            if (showHide) setStyles(showHide, { display: 'none' });
            const iframe = chatEl.querySelector('iframe');
            if (iframe) setStyles(iframe, { flex: '1', width: '100%', height: '100%', 'min-height': '0', 'max-height': 'none', border: 'none', 'border-radius': '0' });
            const chatContainer = chatEl.closest('#chat-container');
            if (chatContainer) setStyles(chatContainer, { display: 'block', height: 'auto', 'max-height': 'none', overflow: 'visible', visibility: 'visible' });
        }

        function restoreChatFill(chatEl) {
            if (!chatEl) return;
            removeStyles(chatEl, ['display', 'flex-direction', 'max-height', 'min-height', 'overflow', 'border']);
            const showHide = chatEl.querySelector('#show-hide-button');
            if (showHide) removeStyles(showHide, ['display']);
            const iframe = chatEl.querySelector('iframe');
            if (iframe) removeStyles(iframe, ['flex', 'width', 'height', 'min-height', 'max-height', 'border', 'border-radius']);
            const chatContainer = chatEl.closest('#chat-container');
            if (chatContainer) removeStyles(chatContainer, ['display', 'height', 'max-height', 'overflow', 'visibility']);
        }

        function setupChat(chatEl, rightPct, top, height) {
            if (!chatEl) { waitForChat(rightPct, top, height); return; }
            positionOverRight(chatEl, rightPct, top, height);
            chatEl.removeAttribute('collapsed');
            chatEl.removeAttribute('hide-chat-frame');
            setStyles(chatEl, { width: `calc(${rightPct}% - 2px)`, padding: '0', 'border-radius': '0' });
            forceChatFill(chatEl);
        }

        function waitForChat(rightPct, topOffset, heightStr) {
            if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
            const onFound = (chatEl) => {
                if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
                if (!isSplit || !isActive) return;
                if (videoType === 'standard') {
                    videoType = detectVideoType();
                    if (videoType === 'standard') videoType = 'live';
                }
                positionOverRight(chatEl, rightPct, topOffset, heightStr);
                chatEl.removeAttribute('collapsed');
                chatEl.removeAttribute('hide-chat-frame');
                setStyles(chatEl, { width: `calc(${rightPct}% - 2px)`, padding: '0', 'border-radius': '0' });
                forceChatFill(chatEl);
                if (!scrollTarget) scrollTarget = chatEl;
                if (videoType === 'vod') {
                    setStyles(chatEl, { 'border-bottom': '2px solid rgba(255,255,255,0.1)' });
                    const below = getBelow();
                    if (below && below.style.getPropertyValue('top') === '0') {
                        setStyles(below, { top: '45vh', height: '55vh' });
                    }
                }
            };
            const existing = getChatEl();
            if (existing) { onFound(existing); return; }
            chatObserver = new MutationObserver(() => {
                const chatEl = getChatEl();
                if (chatEl) onFound(chatEl);
            });
            chatObserver.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { if (chatObserver) { chatObserver.disconnect(); chatObserver = null; } }, 15000);
        }

        function buildOverlay() {
            const wrapper = document.createElement('div');
            wrapper.id = 'ts-wrapper';
            wrapper.style.cssText = `display:flex;position:fixed;top:0;left:0;right:0;bottom:0;z-index:${Z.TS_OVERLAY};background:transparent;overflow:hidden;pointer-events:none;`;

            const left = document.createElement('div');
            left.id = 'ts-left';
            left.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;background:transparent;position:relative;pointer-events:none;';

            const divider = document.createElement('div');
            divider.id = 'ts-divider';
            divider.style.cssText = `flex:0 0 0;width:0;cursor:col-resize;position:relative;background:rgba(255,255,255,0.04);transition:flex-basis ${TRANSITION};overflow:hidden;z-index:10;pointer-events:auto;scrollbar-width:none;`;
            const pip = document.createElement('div');
            pip.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:40px;border-radius:2px;background:rgba(255,255,255,0.18);pointer-events:none;';
            divider.appendChild(pip);
            divider.addEventListener('mouseenter', () => { divider.style.background = 'rgba(59,130,246,0.22)'; pip.style.background = 'rgba(59,130,246,0.8)'; });
            divider.addEventListener('mouseleave', () => { divider.style.background = 'rgba(255,255,255,0.04)'; pip.style.background = 'rgba(255,255,255,0.18)'; });

            const right = document.createElement('div');
            right.id = 'ts-right';
            right.style.cssText = `flex:0 0 0;width:0;height:100%;overflow-y:auto;overflow-x:hidden;background:#0f0f0f;border-left:1px solid rgba(255,255,255,0.06);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;padding:0;box-sizing:border-box;opacity:0;transition:flex-basis ${TRANSITION},opacity 0.3s;pointer-events:auto;`;

            initDividerDrag(divider, left, right);

            const closeBtn = document.createElement('button');
            closeBtn.id = 'ts-close';
            closeBtn.title = 'Close side panel';
            closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:10010;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s;color:rgba(255,255,255,0.7);padding:0;pointer-events:auto;';
            TrustedHTML.setHTML(closeBtn, '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>');
            closeBtn.onclick = () => collapseSplit(true);
            left.appendChild(closeBtn);

            wrapper.appendChild(left);
            wrapper.appendChild(divider);
            wrapper.appendChild(right);
            return wrapper;
        }

        function initDividerDrag(divider, left, right) {
            divider.addEventListener('mousedown', (e) => {
                if (!isSplit) return;
                e.preventDefault();
                const wrapper = splitWrapper;
                const totalW = wrapper.getBoundingClientRect().width;
                const startX = e.clientX;
                const startLeftPct = left.getBoundingClientRect().width / totalW * 100;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const dragShield = document.createElement('div');
                dragShield.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;';
                document.body.appendChild(dragShield);

                const onMove = (me) => {
                    const dx = me.clientX - startX;
                    const newLeftPct = Math.max(25, Math.min(85, startLeftPct + (dx / totalW * 100)));
                    const newRightPct = 100 - newLeftPct;
                    right.style.flexBasis = newRightPct + '%';
                    right.style.width = newRightPct + '%';
                    divider.style.flexBasis = '6px';
                    const player = getPlayer();
                    if (player) player.style.setProperty('width', newLeftPct + '%', 'important');
                    positionedEls.forEach(el => {
                        el.style.setProperty('width', `calc(${newRightPct}% - 2px)`, 'important');
                    });
                    saveRatio(100 - newRightPct);
                };
                const onUp = () => {
                    dragShield.remove();
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    triggerPlayerResize();
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        function mountOverlay() {
            if (isActive) return;
            const player = getPlayer();
            const below = getBelow();
            const chatEl = getChatEl();
            if (!player) return;
            if (!below && !chatEl) return;

            positionedEls = [];
            scrollTarget = null;
            isActive = true;

            const wrapper = buildOverlay();
            splitWrapper = wrapper;
            document.body.appendChild(wrapper);
            document.body.classList.add('ts-active');

            const left = wrapper.querySelector('#ts-left');

            // Fix player in place — NO reparenting. Avoids Chrome losing the video
            // GPU compositor surface when the window moves between monitors.
            // The overlay's left panel is transparent, so the player shows through.
            setStyles(player, {
                position: 'fixed', top: '0', left: '0',
                width: '100%', height: '100vh',
                'z-index': '9998', background: '#000',
                'min-height': '0', margin: '0', padding: '0',
                'max-width': 'none', overflow: 'hidden'
            });

            let fpsCount = 0;
            const doForce = () => { if (fpsCount > 5) return; fpsCount++; requestAnimationFrame(() => { if (isActive) forcePlayerSize(); }); };
            doForce();

            let resizeDebounce = null;
            playerResizeObs = new ResizeObserver(() => {
                clearTimeout(resizeDebounce);
                resizeDebounce = setTimeout(() => {
                    fpsCount = 0; doForce();
                    const leftW = left.getBoundingClientRect().width;
                    if (leftW > 0) player.style.setProperty('width', leftW + 'px', 'important');
                }, 200);
            });
            playerResizeObs.observe(left);

            setTimeout(() => triggerPlayerResize(), 600);

            if (below) setStyles(below, { 'pointer-events': 'none' });
            if (chatEl) {
                setStyles(chatEl, { 'pointer-events': 'none' });
                chatEl.removeAttribute('collapsed');
                chatEl.removeAttribute('hide-chat-frame');
            }

            if (videoType !== 'live' && below) {
                const scrollToComments = () => {
                    const commentsEl = below.querySelector('ytd-comments');
                    if (commentsEl) commentsEl.scrollIntoView({ behavior: 'instant', block: 'center' });
                };
                if (typeof requestIdleCallback === 'function') requestIdleCallback(scrollToComments, { timeout: 2000 });
                else setTimeout(scrollToComments, 800);
            }

            const flexy = document.querySelector('ytd-watch-flexy');
            if (flexy) flexy.style.setProperty('view-transition-name', 'none', 'important');
            if (below) below.style.setProperty('view-transition-name', 'none', 'important');

            const sec = document.querySelector('#secondary');
            if (sec) {
                sec.style.setProperty('view-transition-name', 'none', 'important');
                const related = sec.querySelector('#related');
                if (related) { related.dataset.tsHidden = '1'; related.style.display = 'none'; }
                setStyles(sec, { display: 'block', 'pointer-events': 'none' });
                sec.dataset.tsHidden = '1';
            }
            const cols = document.querySelector('#columns');
            if (cols) cols.style.setProperty('view-transition-name', 'none', 'important');

            const right = wrapper.querySelector('#ts-right');

            const isInRightContent = (target) => {
                if (right.contains(target)) return true;
                return positionedEls.some(el => el.contains(target));
            };

            // Wheel/touch on document capture — the overlay has pointer-events:none
            // so events target the player directly. Use capture on document to intercept
            // before YouTube's player can stopPropagation (volume control).
            const isOverPlayer = (target) => {
                const mp = document.getElementById('movie_player');
                return mp && mp.contains(target);
            };
            wheelHandler = (e) => {
                if (!isActive) return;
                if (!isOverPlayer(e.target) && !isInRightContent(e.target)) return;
                if (!isSplit && e.deltaY > 0 && isOverPlayer(e.target)) { expandSplit(); return; }
                if (isSplit && !isInRightContent(e.target)) {
                    const sEl = scrollTarget;
                    if (sEl) {
                        if (e.deltaY < 0 && sEl.scrollTop <= 0) { collapseSplit(false); return; }
                        sEl.scrollTop += e.deltaY;
                    }
                }
            };
            touchStartY = 0;
            touchHandler = (e) => { const t = e.touches[0]; if (t) touchStartY = t.clientY; };
            touchMoveHandler = (e) => {
                if (!isActive) return;
                const t = e.touches[0]; if (!t) return;
                if (!isSplit && touchStartY - t.clientY > 30 && isOverPlayer(e.target)) { expandSplit(); return; }
                if (isSplit && !isInRightContent(e.target)) {
                    const delta = touchStartY - t.clientY;
                    const sEl = scrollTarget;
                    if (sEl) {
                        if (delta < -40 && sEl.scrollTop <= 0) { collapseSplit(false); return; }
                        sEl.scrollTop += delta * 0.5;
                    }
                    touchStartY = t.clientY;
                }
            };
            document.addEventListener('wheel', wheelHandler, { passive: true, capture: true });
            document.addEventListener('touchstart', touchHandler, { passive: true, capture: true });
            document.addEventListener('touchmove', touchMoveHandler, { passive: true, capture: true });

            windowResizeHandler = () => { if (isActive) triggerPlayerResize(); };
            window.addEventListener('resize', windowResizeHandler);
        }

        function expandSplit() {
            if (isSplit || !isActive) return;
            isSplit = true;
            entering = true;
            positionedEls = [];
            document.body.classList.add('ts-split');

            const wrapper = splitWrapper;
            const right = wrapper.querySelector('#ts-right');
            const divider = wrapper.querySelector('#ts-divider');
            const below = getBelow();
            const chatEl = getChatEl();

            if (chatEl && videoType === 'standard') {
                videoType = detectVideoType();
                if (videoType === 'standard') videoType = 'live';
            }
            const type = videoType;

            const closeBtn = wrapper.querySelector('#ts-close');
            if (closeBtn) closeBtn.style.opacity = '0.3';

            let leftPct = getSavedRatio();
            leftPct = Math.max(25, Math.min(85, leftPct));
            const rightPct = 100 - leftPct;

            right.style.flexBasis = rightPct + '%';
            right.style.width = rightPct + '%';
            divider.style.flexBasis = '6px';
            divider.style.width = '6px';

            // Sync player width — player is fixed-positioned separately
            const player = getPlayer();
            if (player) player.style.setProperty('width', leftPct + '%', 'important');

            if (type === 'live' || type === 'vod') {
                right.style.opacity = '0';
                right.style.background = 'transparent';
                right.style.borderLeft = 'none';
            } else {
                right.style.opacity = '1';
            }

            if (type === 'live') {
                setupChat(chatEl, rightPct, '0', '100vh');
                scrollTarget = chatEl;
            } else if (type === 'vod') {
                setupChat(chatEl, rightPct, '0', '45vh');
                if (chatEl) setStyles(chatEl, { 'border-bottom': '2px solid rgba(255,255,255,0.1)' });
                if (below) {
                    const hasChat = !!chatEl;
                    positionOverRight(below, rightPct, hasChat ? '45vh' : '0', hasChat ? '55vh' : '100vh');
                    setStyles(below, { width: `calc(${rightPct}% - 2px)`, padding: '0 8px 60px 2px', display: 'block' });
                }
                scrollTarget = chatEl || below;
            } else {
                if (chatEl) {
                    videoType = 'live';
                    right.style.opacity = '0';
                    right.style.background = 'transparent';
                    right.style.borderLeft = 'none';
                    setupChat(chatEl, rightPct, '0', '100vh');
                    scrollTarget = chatEl;
                } else if (below) {
                    positionOverRight(below, rightPct, '0', '100vh');
                    setStyles(below, { width: `calc(${rightPct}% - 2px)`, padding: '0 8px 60px 2px', display: 'block' });
                    scrollTarget = below;
                    waitForChat(rightPct, '0', '100vh');
                }
            }

            const onExpanded = () => {
                if (right) right.removeEventListener('transitionend', onTransEnd);
                entering = false;
                triggerPlayerResize();
                if (type !== 'live' && below) below.scrollTop = 0;
            };
            const onTransEnd = (e) => {
                if (e.propertyName === 'flex-basis' || e.propertyName === 'opacity') onExpanded();
            };
            right.addEventListener('transitionend', onTransEnd);
            setTimeout(() => { if (entering) onExpanded(); }, 500);

            const rightWheelHandler = (e) => {
                if (!isSplit) return;
                const sEl = scrollTarget;
                if (!sEl) return;
                if (e.deltaY < 0 && sEl.scrollTop <= 0) { collapseSplit(false); e.stopPropagation(); }
            };
            right.addEventListener('wheel', rightWheelHandler, { passive: true });

            if (below) removeStyles(below, ['pointer-events']);
            if (chatEl) removeStyles(chatEl, ['pointer-events']);
        }

        function collapseSplit(full) {
            if (!isActive) return;
            isSplit = false;
            document.body.classList.remove('ts-split');

            const wrapper = splitWrapper;
            const right = wrapper.querySelector('#ts-right');
            const divider = wrapper.querySelector('#ts-divider');
            const closeBtn = wrapper.querySelector('#ts-close');

            if (right) { right.style.flexBasis = '0'; right.style.width = '0'; right.style.opacity = '0'; }
            if (divider) { divider.style.flexBasis = '0'; divider.style.width = '0'; }
            if (closeBtn) closeBtn.style.opacity = '0';

            // Restore player to full width
            const player = getPlayer();
            if (player) player.style.setProperty('width', '100%', 'important');

            unpositionAll();
            if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }

            const below = getBelow();
            const chatEl = getChatEl();
            if (below) setStyles(below, { 'pointer-events': 'none' });
            if (chatEl) { setStyles(chatEl, { 'pointer-events': 'none' }); restoreChatFill(chatEl); }

            setTimeout(() => triggerPlayerResize(), 400);
            if (full) teardown();
        }

        function teardown() {
            if (!isActive) return;
            isActive = false;
            isSplit = false;

            // Clear fixed positioning — player never left its original DOM location
            const player = getPlayer();
            if (player) {
                removeStyles(player, ['position', 'top', 'left', 'width', 'height',
                    'z-index', 'background', 'min-height', 'margin', 'padding', 'max-width', 'overflow']);
            }

            const mp = document.getElementById('movie_player');
            if (mp) {
                removeStyles(mp, ['width', 'height']);
                const vc = mp.querySelector('.html5-video-container');
                const vid = mp.querySelector('video.html5-main-video');
                if (vc) removeStyles(vc, ['width', 'height']);
                if (vid) removeStyles(vid, ['width', 'height', 'object-fit']);
                const ytdP = mp.closest('ytd-player');
                const innerCont = ytdP?.querySelector('#container');
                if (innerCont) removeStyles(innerCont, ['width', 'height', 'padding-bottom']);
            }

            if (wheelHandler) {
                document.removeEventListener('wheel', wheelHandler, true);
                document.removeEventListener('touchstart', touchHandler, true);
                document.removeEventListener('touchmove', touchMoveHandler, true);
            }
            wheelHandler = null;
            touchHandler = null;
            touchMoveHandler = null;

            if (playerResizeObs) { playerResizeObs.disconnect(); playerResizeObs = null; }
            if (windowResizeHandler) { window.removeEventListener('resize', windowResizeHandler); windowResizeHandler = null; }
            if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
            if (splitWrapper) { splitWrapper.remove(); splitWrapper = null; }

            document.body.classList.remove('ts-active', 'ts-split');
            unpositionAll();

            const below = getBelow();
            if (below) removeStyles(below, ['pointer-events']);
            const chatEl = getChatEl();
            if (chatEl) { removeStyles(chatEl, ['pointer-events']); restoreChatFill(chatEl); }
            const sec = document.querySelector('#secondary');
            if (sec) {
                delete sec.dataset.tsHidden;
                removeStyles(sec, ['display', 'pointer-events', 'view-transition-name']);
                const related = sec.querySelector('#related');
                if (related) { delete related.dataset.tsHidden; related.style.removeProperty('display'); }
            }
            const flexy = document.querySelector('ytd-watch-flexy');
            if (flexy) flexy.style.removeProperty('view-transition-name');
            if (below) below.style.removeProperty('view-transition-name');
            const cols = document.querySelector('#columns');
            if (cols) cols.style.removeProperty('view-transition-name');

            setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
        }

        function activate() {
            if (isActive) return;
            videoType = detectVideoType();
            mountOverlay();
        }

        function deactivate() {
            if (!isActive) return;
            teardown();
        }

        function onNavigate() {
            const vid = getVideoId();
            if (!isWatchPage()) { deactivate(); lastVideoId = null; return; }
            if (vid !== lastVideoId) {
                if (isActive) teardown();
                lastVideoId = vid;
                setTimeout(() => {
                    if (isWatchPage() && getVideoId() === vid) activate();
                }, 800);
            }
        }

        function onFullscreenChange() {
            const flexy = document.querySelector('ytd-watch-flexy');
            if (flexy?.hasAttribute('fullscreen') || document.fullscreenElement) {
                if (splitWrapper) splitWrapper.style.display = 'none';
            } else {
                if (splitWrapper && isActive) {
                    splitWrapper.style.display = 'flex';
                    setTimeout(() => triggerPlayerResize(), 200);
                }
            }
        }

        return {
            init() {
                window.addEventListener('yt-navigate-finish', onNavigate);
                document.addEventListener('fullscreenchange', onFullscreenChange);
                window.addEventListener('popstate', () => setTimeout(onNavigate, 300));

                if (isWatchPage()) {
                    lastVideoId = getVideoId();
                    const waitForPlayer = () => {
                        if (getPlayer()) activate();
                        else setTimeout(waitForPlayer, 200);
                    };
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', () => setTimeout(waitForPlayer, 800));
                    } else {
                        setTimeout(waitForPlayer, 800);
                    }
                }

                addNavigateRule('theaterSplit', onNavigate);
            }
        };
    })();


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 3: SUBSCRIPTIONS GRID
    // ══════════════════════════════════════════════════════════════════════════

    const SubscriptionsGrid = (() => {
        let gridStyle = null;
        let fullWidthStyle = null;

        function applyGrid() {
            if (getCurrentPage() !== 'subscriptions') return;
            if (getSetting('subscriptionsGrid') && !gridStyle) {
                gridStyle = injectStyle(`
                    ytd-browse[page-subtype="subscriptions"] #contents.ytd-rich-grid-renderer{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:8px;width:99%;}
                    ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer.ytd-rich-grid-renderer{width:100% !important;margin:0 !important;margin-left:2px !important;}
                `, 'subscriptions-grid');
            }
            if (getSetting('fullWidthSubscriptions') && !fullWidthStyle) {
                fullWidthStyle = injectStyle(`
                    ytd-browse[page-subtype="subscriptions"] #grid-container.ytd-two-column-browse-results-renderer{max-width:100% !important;}
                `, 'full-width-subs');
            }
        }

        function removeGrid() {
            gridStyle?.remove(); gridStyle = null;
            fullWidthStyle?.remove(); fullWidthStyle = null;
        }

        return {
            init() {
                applyGrid();
                addNavigateRule('subsGrid', () => {
                    if (getCurrentPage() === 'subscriptions') applyGrid();
                    else removeGrid();
                });
            }
        };
    })();


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 4: DOWNLOADS
    // ══════════════════════════════════════════════════════════════════════════

    const Downloads = (() => {

        function showDownloadProgress(id, token, audioOnly) {
            const panelId = 'ytkit-dl-progress-' + id;
            document.getElementById(panelId)?.remove();

            const panel = document.createElement('div');
            panel.id = panelId;
            panel.style.cssText = `position:fixed;bottom:16px;right:16px;width:260px;background:#1a1a2e;border:1px solid #30363d;border-radius:10px;padding:10px 12px;z-index:${Z.DL_PROGRESS};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);color:#e6edf3;animation:ytkit-slide-in 0.25s ease-out;font-size:11px;`;

            const existing = document.querySelectorAll('[id^="ytkit-dl-progress-"]');
            if (existing.length > 0) panel.style.bottom = (16 + existing.length * 72) + 'px';

            TrustedHTML.setHTML(panel, `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span class="ytkit-dl-title" style="font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;margin-right:8px;">Starting...</span>
                    <button class="ytkit-dl-close" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:13px;line-height:1;padding:0 0 0 4px;">&#x2715;</button>
                </div>
                <div style="background:#30363d;border-radius:3px;height:4px;overflow:hidden;margin-bottom:4px;">
                    <div class="ytkit-dl-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:3px;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;color:#8b949e;font-size:10px;">
                    <span class="ytkit-dl-pct">0%</span>
                    <span class="ytkit-dl-speed"></span>
                    <span class="ytkit-dl-eta"></span>
                </div>
            `);
            document.body.appendChild(panel);
            panel.querySelector('.ytkit-dl-close')?.addEventListener('click', () => panel.remove());

            let pollInterval = null;
            let pollErrors = 0;
            async function poll() {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 3000);
                    const res = await fetch('http://127.0.0.1:9751/status/' + id, { headers: { 'X-Auth-Token': token }, signal: controller.signal });
                    clearTimeout(timer);
                    const data = await res.json();
                    pollErrors = 0;

                    const fill = panel.querySelector('.ytkit-dl-fill');
                    const pct = panel.querySelector('.ytkit-dl-pct');
                    const spd = panel.querySelector('.ytkit-dl-speed');
                    const eta = panel.querySelector('.ytkit-dl-eta');
                    const ttl = panel.querySelector('.ytkit-dl-title');
                    if (!fill) { clearInterval(pollInterval); return; }

                    if (data.title && data.title !== 'Unknown') ttl.textContent = data.title;
                    const p = Math.min(data.progress || 0, 100);
                    fill.style.width = p + '%';
                    pct.textContent = p.toFixed(1) + '%';
                    if (data.speed) spd.textContent = data.speed;
                    if (data.eta) eta.textContent = data.eta;
                    if (data.status === 'merging') pct.textContent = 'Merging...';
                    if (data.status === 'extracting') pct.textContent = 'Extracting...';

                    if (data.status === 'done' || data.status === 'complete') {
                        clearInterval(pollInterval);
                        fill.style.width = '100%';
                        fill.style.background = 'linear-gradient(90deg,#22c55e,#16a34a)';
                        pct.textContent = 'Done!';
                        spd.textContent = '';
                        eta.textContent = '';
                        setTimeout(() => panel.remove(), 4000);
                    } else if (data.status === 'error' || data.status === 'failed' || data.status === 'cancelled') {
                        clearInterval(pollInterval);
                        fill.style.background = '#ef4444';
                        pct.textContent = 'Failed';
                        spd.textContent = '';
                        eta.textContent = '';
                        setTimeout(() => panel.remove(), 8000);
                    }
                } catch (_) { pollErrors++; if (pollErrors > 5) clearInterval(pollInterval); }
            }
            pollInterval = setInterval(poll, 1000);
            poll();
        }

        function webDownloadFallback(videoUrl) {
            const cobaltUrl = getSetting('cobaltUrl') || 'https://cobalt.meowing.de/#';
            const downloadUrl = cobaltUrl + encodeURIComponent(videoUrl);
            showToast('YTYT-Downloader not installed. Opening web downloader...', '#3b82f6', { duration: 4 });
            window.open(downloadUrl, '_blank');
        }

        function mediaDLDownload(videoUrl, audioOnly) {
            healthCheck(videoUrl, audioOnly, false);
        }

        async function healthCheck(videoUrl, audioOnly, isRetry) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 3000);
                const res = await fetch('http://127.0.0.1:9751/health', { headers: { 'X-MDL-Client': 'MediaDL' }, signal: controller.signal });
                clearTimeout(timer);
                const text = await res.text();
                let token = null;
                try { token = JSON.parse(text).token; } catch (_) {}
                if (!token) { webDownloadFallback(videoUrl); return; }
                sendDownload(videoUrl, audioOnly, token).catch(e => showToast('Download failed: ' + e.message, '#ef4444', { duration: 5 }));
            } catch (err) {
                if (!isRetry) autoStart(videoUrl, audioOnly);
                else webDownloadFallback(videoUrl);
            }
        }

        function autoStart(videoUrl, audioOnly) {
            showToast('Starting MediaDL server...', '#3b82f6', { duration: 4 });
            openProtocol('mediadl://start');
            let retries = 0;
            const tryConnect = async () => {
                retries++;
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 2000);
                    const res = await fetch('http://127.0.0.1:9751/health', { headers: { 'X-MDL-Client': 'MediaDL' }, signal: controller.signal });
                    clearTimeout(timer);
                    const data = await res.json();
                    if (data.token) {
                        showToast('MediaDL server started!', '#22c55e', { duration: 2 });
                        sendDownload(videoUrl, audioOnly, data.token).catch(e => showToast('Download failed: ' + e.message, '#ef4444', { duration: 5 }));
                    } else if (retries < 4) setTimeout(tryConnect, 1500);
                    else webDownloadFallback(videoUrl);
                } catch (_) {
                    if (retries < 4) setTimeout(tryConnect, 1500);
                    else webDownloadFallback(videoUrl);
                }
            };
            setTimeout(tryConnect, 2000);
        }

        async function sendDownload(videoUrl, audioOnly, token) {
            const payload = { url: videoUrl, audioOnly: audioOnly || false };
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 5000);
                const res = await fetch('http://127.0.0.1:9751/download', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
                clearTimeout(timer);
                const resp = JSON.parse(await res.text());
                if (resp.status === 'complete' && resp.message === 'Already downloaded') {
                    showToast('File already exists - skipping download', '#3b82f6', { duration: 3 });
                } else if (resp.message === 'Already downloading') {
                    showToast('Already downloading this video', '#f59e0b', { duration: 3 });
                } else if (resp.id) {
                    showDownloadProgress(resp.id, token, audioOnly);
                } else {
                    showToast('MediaDL: ' + (resp.error || 'Unknown error'), '#ef4444', { duration: 5 });
                }
            } catch (err) {
                showToast('MediaDL download request failed: ' + err.message, '#ef4444', { duration: 5 });
            }
        }

        // ── Download Buttons (below video) ──
        let buttonObserver = null;

        function createButton(className, title, bgColor, hoverColor, iconPath, labelText, onClick) {
            const btn = document.createElement('button');
            btn.className = className;
            btn.title = title;
            btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:${bgColor};color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
            btn.onmouseenter = () => { btn.style.background = hoverColor; };
            btn.onmouseleave = () => { btn.style.background = bgColor; };
            btn.addEventListener('click', onClick);

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('width', '20');
            svg.setAttribute('height', '20');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', iconPath);
            path.setAttribute('fill', 'white');
            svg.appendChild(path);
            btn.appendChild(svg);
            btn.appendChild(document.createTextNode(' ' + labelText));
            return btn;
        }

        function injectButtons() {
            if (!isWatchPage()) return;
            let target = null;
            const allBtnContainers = document.querySelectorAll('#top-level-buttons-computed');
            for (const el of allBtnContainers) {
                if (!el.closest('#clarify-box, ytd-info-panel-container-renderer, ytd-clarification-renderer')) {
                    target = el; break;
                }
            }
            if (!target) {
                const fallbacks = ['ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed', '#menu #top-level-buttons-computed', 'ytd-watch-metadata #actions #top-level-buttons-computed'];
                for (const sel of fallbacks) { target = document.querySelector(sel); if (target) break; }
            }
            if (!target) return;

            if (getSetting('showLocalDownloadButton') && !target.querySelector('.ytkit-local-dl-btn')) {
                target.appendChild(createButton('ytkit-local-dl-btn', 'Download to PC (requires YTYT-Downloader)', '#22c55e', '#16a34a',
                    'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', 'DL', () => {
                    showToast('Starting download...', '#22c55e', { duration: 2 });
                    mediaDLDownload(location.href, false);
                }));
            }
            if (getSetting('showMp3DownloadButton') && !target.querySelector('.ytkit-mp3-dl-btn')) {
                target.appendChild(createButton('ytkit-mp3-dl-btn', 'Download MP3 (requires YTYT-Downloader)', '#8b5cf6', '#7c3aed',
                    'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z', 'MP3', () => {
                    showToast('Starting MP3 download...', '#8b5cf6', { duration: 2 });
                    mediaDLDownload(location.href, true);
                }));
            }
            if (getSetting('showVlcButton') && !target.querySelector('.ytkit-vlc-btn')) {
                target.appendChild(createButton('ytkit-vlc-btn', 'Stream in VLC Player (requires YTYT-Downloader)', '#f97316', '#ea580c',
                    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z', 'VLC', () => {
                    showToast('Sending to VLC...', '#f97316', { duration: 2 });
                    openProtocol('ytvlc://' + encodeURIComponent(location.href), 'VLC protocol handler not found. Install YTYT-Downloader.');
                }));
            }
        }

        function removeButtons() {
            document.querySelectorAll('.ytkit-local-dl-btn, .ytkit-mp3-dl-btn, .ytkit-vlc-btn').forEach(b => b.remove());
        }

        // ── Context Menu (right-click on player) ──
        let contextMenu = null;
        let contextHandler = null;
        let contextClickHandler = null;
        let contextScrollHandler = null;

        function buildContextMenu() {
            const menu = document.createElement('div');
            menu.className = 'ytkit-context-menu';
            menu.style.display = 'none';

            const header = document.createElement('div');
            header.className = 'ytkit-context-menu-header';
            header.textContent = 'YTKit Downloads';
            menu.appendChild(header);

            const items = [
                { label: 'Download Video (MP4)', cls: 'ytkit-item-video', color: '#22c55e', icon: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z', action: () => { showToast('Starting video download...', '#22c55e'); mediaDLDownload(location.href, false); } },
                { label: 'Download Audio (MP3)', cls: 'ytkit-item-audio', color: '#8b5cf6', icon: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z', action: () => { showToast('Starting audio download...', '#a855f7'); mediaDLDownload(location.href, true); } },
                { divider: true },
                { label: 'Stream in VLC', cls: 'ytkit-item-vlc', color: '#f97316', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z', action: () => { showToast('Sending to VLC...', '#f97316'); openProtocol('ytvlc://' + encodeURIComponent(location.href), 'VLC protocol handler not found.'); } },
                { label: 'Add to VLC Queue', cls: 'ytkit-item-vlc', color: '#f97316', icon: 'M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z', action: () => { showToast('Adding to VLC queue...', '#f97316'); openProtocol('ytvlcq://' + encodeURIComponent(location.href), 'VLC Queue handler not found.'); } },
                { label: 'Stream in MPV', cls: 'ytkit-item-mpv', color: '#ec4899', icon: 'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-5-7l-7-4v8z', action: () => { showToast('Sending to MPV...', '#8b5cf6'); openProtocol('ytmpv://' + encodeURIComponent(location.href), 'MPV protocol handler not found.'); } },
                { divider: true },
                { label: 'Copy Video URL', cls: 'ytkit-item-copy', color: '#fbbf24', icon: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z', action: () => { navigator.clipboard.writeText(location.href).then(() => showToast('URL copied to clipboard', '#22c55e')).catch(() => showToast('Clipboard access denied', '#ef4444')); } },
                { label: 'Copy URL at Timestamp', cls: 'ytkit-item-copy', color: '#fbbf24', icon: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z', action: () => {
                    const video = document.querySelector('video');
                    if (video) {
                        const t = Math.floor(video.currentTime);
                        const url = new URL(location.href);
                        url.searchParams.set('t', t + 's');
                        navigator.clipboard.writeText(url.toString()).then(() => showToast(`URL copied at ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`, '#22c55e')).catch(() => showToast('Clipboard access denied', '#ef4444'));
                    } else {
                        navigator.clipboard.writeText(location.href).then(() => showToast('URL copied', '#22c55e'));
                    }
                } },
                { label: 'Copy Video ID', cls: 'ytkit-item-copy', color: '#fbbf24', icon: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 9h-2V9h-2v4H9l3 3 3-3z', action: () => {
                    const vid = getVideoId();
                    if (vid) navigator.clipboard.writeText(vid).then(() => showToast('Video ID copied: ' + vid, '#22c55e')).catch(() => showToast('Clipboard access denied', '#ef4444'));
                } },
            ];

            items.forEach(item => {
                if (item.divider) {
                    const d = document.createElement('div');
                    d.className = 'ytkit-context-menu-divider';
                    menu.appendChild(d);
                    return;
                }
                const el = document.createElement('div');
                el.className = `ytkit-context-menu-item ${item.cls}`;

                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '18');
                svg.setAttribute('height', '18');
                svg.style.color = item.color;
                const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p.setAttribute('d', item.icon);
                p.setAttribute('fill', 'currentColor');
                svg.appendChild(p);
                el.appendChild(svg);

                const span = document.createElement('span');
                span.textContent = item.label;
                el.appendChild(span);

                el.addEventListener('click', (e) => { e.stopPropagation(); hideContextMenu(); item.action(); });
                menu.appendChild(el);
            });

            document.body.appendChild(menu);
            return menu;
        }

        function showContextMenu(x, y) {
            if (!contextMenu) contextMenu = buildContextMenu();
            contextMenu.style.display = 'block';
            contextMenu.style.left = Math.min(x, window.innerWidth - 260) + 'px';
            contextMenu.style.top = Math.min(y, window.innerHeight - contextMenu.offsetHeight - 10) + 'px';
        }

        function hideContextMenu() {
            if (contextMenu) contextMenu.style.display = 'none';
        }

        function initContextMenu() {
            if (!getSetting('videoContextMenu')) return;

            injectStyle(`
                .ytkit-context-menu{position:fixed;z-index:${Z.CONTEXT_MENU};background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:6px 0;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:"Roboto",Arial,sans-serif;font-size:14px;animation:ytkit-menu-fade 0.15s ease-out;}
                @keyframes ytkit-menu-fade{from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)}}
                .ytkit-context-menu-header{padding:8px 14px;color:#888;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #333;margin-bottom:4px;}
                .ytkit-context-menu-item{display:flex;align-items:center;gap:12px;padding:10px 14px;color:#e0e0e0;cursor:pointer;transition:background 0.1s;}
                .ytkit-context-menu-item:hover{background:#2d2d44;}
                .ytkit-context-menu-item svg{width:18px;height:18px;flex-shrink:0;}
                .ytkit-context-menu-divider{height:1px;background:#333;margin:6px 0;}
            `, 'context-menu');

            contextHandler = (e) => {
                const moviePlayer = document.querySelector('#movie_player');
                if (!moviePlayer) return;
                if (moviePlayer.contains(e.target) || e.target === moviePlayer) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    showContextMenu(e.clientX, e.clientY);
                    return false;
                }
            };
            contextClickHandler = (e) => {
                if (contextMenu && !contextMenu.contains(e.target)) hideContextMenu();
            };
            contextScrollHandler = () => hideContextMenu();

            document.addEventListener('contextmenu', contextHandler, true);
            document.addEventListener('click', contextClickHandler);
            document.addEventListener('scroll', contextScrollHandler, { passive: true });
        }

        return {
            init() {
                if (isWatchPage()) setTimeout(injectButtons, 1000);

                buttonObserver = new MutationObserver(() => {
                    if (isWatchPage()) injectButtons();
                });
                buttonObserver.observe(document.body, { childList: true, subtree: true });

                addNavigateRule('downloads', () => {
                    if (isWatchPage()) setTimeout(injectButtons, 500);
                    else removeButtons();
                });

                initContextMenu();
            },
            mediaDLDownload
        };
    })();


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 5: LOGO QUICK LINKS
    // ══════════════════════════════════════════════════════════════════════════

    const QuickLinks = (() => {
        const ICON_PATHS = {
            '/feed/history': 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
            '/playlist?list=WL': 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
            '/feed/library': 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
            '/playlist?list=LL': 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 2 7.59 8.59C7.22 8.95 7 9.45 7 10v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
            '/feed/subscriptions': 'M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2zm-6 4l-6-3.27v6.53L16 16z',
            '/': 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
            '/feed/trending': 'M17.53 11.2c-.23-.3-.5-.56-.76-.82-.65-.6-1.4-1.03-1.8-1.87-.55-1.15-.13-2.49.67-3.41-1.05.38-1.78 1.36-2.09 2.38-.44 1.45-.06 3.06.98 4.12.34.34.77.58.95 1.05.23.58-.05 1.22-.46 1.65-.82.87-2.17.93-3.23.44-1.3-.6-1.8-2.12-1.43-3.46-1.64 1.53-2.09 4.04-.83 5.87 1.36 1.95 4.18 2.72 6.27 1.81 2.28-.98 3.4-3.71 2.53-5.95-.1-.26-.22-.51-.33-.76-.2-.42-.4-.85-.3-1.34.16-.67.67-1.18 1.11-1.7.14-.16.28-.33.4-.53-1.02.27-1.64.98-2.18 1.79-.08.12-.16.24-.24.37-.13.2-.24.4-.28.63-.04.22-.01.45.1.65z',
            '_default': 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'
        };

        let menuStyle = null;
        let navMenuWrap = null;
        let playerMenuWrap = null;

        function parseItems() {
            const raw = getSetting('quickLinkItems');
            if (!raw) return [];
            return raw.split('\n').map(line => {
                const parts = line.split('|').map(s => s.trim());
                if (parts.length >= 2 && parts[0] && parts[1]) return { label: parts[0], url: parts[1] };
                return null;
            }).filter(Boolean);
        }

        function getIconPath(url) {
            for (const [key, path] of Object.entries(ICON_PATHS)) {
                if (key !== '_default' && url.startsWith(key)) return path;
            }
            return ICON_PATHS._default;
        }

        function buildMenu(parentEl, dropId) {
            const drop = document.createElement('div');
            drop.className = 'ytkit-ql-drop';
            drop.id = dropId;

            const items = parseItems();
            items.forEach((item, i) => {
                const row = document.createElement('div');
                row.className = 'ytkit-ql-row';

                const a = document.createElement('a');
                a.className = 'ytkit-ql-item';
                a.href = item.url;

                const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                iconSvg.setAttribute('viewBox', '0 0 24 24');
                iconSvg.setAttribute('class', 'ytkit-ql-icon');
                const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                iconPath.setAttribute('d', getIconPath(item.url));
                iconPath.setAttribute('fill', 'currentColor');
                iconSvg.appendChild(iconPath);
                a.appendChild(iconSvg);
                a.appendChild(document.createTextNode(item.label));

                const delBtn = document.createElement('button');
                delBtn.className = 'ytkit-ql-del';
                delBtn.title = 'Remove link';
                TrustedHTML.setHTML(delBtn, '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>');
                delBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const currentItems = parseItems();
                    currentItems.splice(i, 1);
                    setSetting('quickLinkItems', currentItems.map(it => `${it.label} | ${it.url}`).join('\n'));
                    rebuildMenus();
                });

                row.appendChild(a);
                row.appendChild(delBtn);
                drop.appendChild(row);
            });

            const divider = document.createElement('div');
            divider.className = 'ytkit-ql-divider';
            drop.appendChild(divider);

            const bottom = document.createElement('div');
            bottom.className = 'ytkit-ql-bottom';
            const editBtn = document.createElement('a');
            editBtn.className = 'ytkit-ql-item ytkit-ql-bottom-btn';
            editBtn.href = '#';
            editBtn.title = 'Edit links';
            editBtn.textContent = 'Edit';

            const addForm = document.createElement('div');
            addForm.className = 'ytkit-ql-add-form';
            addForm.style.display = 'none';
            const labelInput = document.createElement('input');
            labelInput.className = 'ytkit-ql-input';
            labelInput.placeholder = 'Label';
            const urlInput = document.createElement('input');
            urlInput.className = 'ytkit-ql-input';
            urlInput.placeholder = '/path';
            const addBtn = document.createElement('button');
            addBtn.className = 'ytkit-ql-add-btn';
            addBtn.textContent = 'Add';
            addBtn.addEventListener('click', () => {
                const lbl = labelInput.value.trim();
                const url = urlInput.value.trim();
                if (lbl && url) {
                    const current = getSetting('quickLinkItems') || '';
                    setSetting('quickLinkItems', current ? current + '\n' + lbl + ' | ' + url : lbl + ' | ' + url);
                    rebuildMenus();
                }
            });
            addForm.appendChild(labelInput);
            addForm.appendChild(urlInput);
            addForm.appendChild(addBtn);

            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                drop.classList.toggle('ytkit-ql-editing');
                addForm.style.display = drop.classList.contains('ytkit-ql-editing') ? 'flex' : 'none';
            });

            bottom.appendChild(editBtn);
            drop.appendChild(bottom);
            drop.appendChild(addForm);

            parentEl.appendChild(drop);

            let hideTimer = null;
            const show = () => { clearTimeout(hideTimer); drop.classList.add('ytkit-ql-visible'); };
            const scheduleHide = () => { hideTimer = setTimeout(() => drop.classList.remove('ytkit-ql-visible'), 300); };
            parentEl.addEventListener('mouseenter', show);
            parentEl.addEventListener('mouseleave', scheduleHide);
            drop.addEventListener('mouseenter', show);
            drop.addEventListener('mouseleave', scheduleHide);

            return drop;
        }

        function rebuildMenus() {
            if (navMenuWrap) { navMenuWrap.querySelector('.ytkit-ql-drop')?.remove(); buildMenu(navMenuWrap, 'ytkit-ql-menu'); }
            if (playerMenuWrap) { playerMenuWrap.querySelector('.ytkit-ql-drop')?.remove(); buildMenu(playerMenuWrap, 'ytkit-po-drop'); }
        }

        function injectNavbarMenu() {
            if (navMenuWrap) return;
            const logo = document.querySelector('#logo, ytd-topbar-logo-renderer a, a#logo');
            if (!logo) return;
            const wrap = document.createElement('div');
            wrap.id = 'ytkit-ql-wrap';
            logo.parentNode.insertBefore(wrap, logo);
            wrap.appendChild(logo);
            navMenuWrap = wrap;
            buildMenu(wrap, 'ytkit-ql-menu');
        }

        function injectPlayerControls() {
            if (!isWatchPage()) return;
            const rightControls = document.querySelector('.ytp-right-controls');
            if (!rightControls || rightControls.querySelector('#ytkit-player-controls')) return;

            const controlsWrap = document.createElement('div');
            controlsWrap.id = 'ytkit-player-controls';

            const logoWrap = document.createElement('div');
            logoWrap.id = 'ytkit-po-logo-wrap';
            const logoBtn = document.createElement('a');
            logoBtn.className = 'ytp-button ytkit-po-btn';
            logoBtn.href = '/';
            logoBtn.title = 'YouTube Home';
            TrustedHTML.setHTML(logoBtn, '<svg viewBox="0 0 90 20" width="67" height="15"><path d="M27.97 3.74V18.2h-1.97l-.1-.91a4.5 4.5 0 0 1-3.3 1.1c-2.96 0-4.77-2.06-4.77-5.44 0-3.44 1.93-5.55 5.02-5.55 1.1 0 2.12.38 2.96 1.07V3.74h2.16zm-2.16 9.52V9.64a3.28 3.28 0 0 0-2.65-1.22c-2 0-3.18 1.6-3.18 3.78 0 2.12 1.1 3.63 3.05 3.63a3.4 3.4 0 0 0 2.78-1.39z" fill="#fff"/></svg>');
            logoWrap.appendChild(logoBtn);
            buildMenu(logoWrap, 'ytkit-po-drop');
            controlsWrap.appendChild(logoWrap);

            const mkSvg = (d) => {
                const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                s.setAttribute('viewBox', '0 0 24 24');
                s.setAttribute('width', '18');
                s.setAttribute('height', '18');
                const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p.setAttribute('d', d);
                p.setAttribute('fill', 'rgba(255,255,255,0.8)');
                s.appendChild(p);
                return s;
            };

            if (getSetting('showLocalDownloadButton')) {
                const dlBtn = document.createElement('button');
                dlBtn.className = 'ytp-button ytkit-po-btn ytkit-po-dl';
                dlBtn.title = 'Download Video';
                dlBtn.appendChild(mkSvg('M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'));
                dlBtn.addEventListener('click', (e) => { e.stopPropagation(); showToast('Starting download...', '#22c55e', { duration: 2 }); Downloads.mediaDLDownload(location.href, false); });
                controlsWrap.appendChild(dlBtn);
            }
            if (getSetting('showMp3DownloadButton')) {
                const mp3Btn = document.createElement('button');
                mp3Btn.className = 'ytp-button ytkit-po-btn ytkit-po-mp3';
                mp3Btn.title = 'Download MP3';
                mp3Btn.appendChild(mkSvg('M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'));
                mp3Btn.addEventListener('click', (e) => { e.stopPropagation(); showToast('Starting MP3 download...', '#8b5cf6', { duration: 2 }); Downloads.mediaDLDownload(location.href, true); });
                controlsWrap.appendChild(mp3Btn);
            }
            if (getSetting('showVlcButton')) {
                const vlcBtn = document.createElement('button');
                vlcBtn.className = 'ytp-button ytkit-po-btn ytkit-po-vlc';
                vlcBtn.title = 'Stream in VLC';
                vlcBtn.appendChild(mkSvg('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z'));
                vlcBtn.addEventListener('click', (e) => { e.stopPropagation(); openProtocol('ytvlc://' + encodeURIComponent(location.href), 'VLC protocol handler not found.'); });
                controlsWrap.appendChild(vlcBtn);
            }

            rightControls.appendChild(controlsWrap);
            playerMenuWrap = logoWrap;
        }

        return {
            init() {
                if (!getSetting('quickLinkMenu')) return;

                menuStyle = injectStyle(`
                    #ytkit-ql-wrap{position:relative;display:inline-block;}
                    .ytkit-ql-drop{position:absolute;flex-direction:column;background:rgba(18,18,18,0.97);border:1px solid rgba(255,255,255,0.08);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.6);padding:3px 0;z-index:9999;min-width:160px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(4px);transition:opacity 0.2s ease,visibility 0.2s ease,transform 0.2s ease;display:flex;}
                    .ytkit-ql-drop.ytkit-ql-visible{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0);}
                    #ytkit-ql-menu{top:38px;left:0;}
                    #ytkit-po-drop{bottom:calc(100% + 6px);right:0;}
                    .ytkit-ql-row{display:flex;align-items:center;}
                    .ytkit-ql-item{display:flex;align-items:center;padding:5px 12px;color:#fff;text-decoration:none;font-size:12px;font-family:"Roboto","Arial",sans-serif;transition:background 0.12s;gap:8px;flex:1;min-width:0;}
                    .ytkit-ql-item:hover{background:rgba(255,255,255,0.07);}
                    .ytkit-ql-icon{fill:#fff;width:16px;height:16px;flex-shrink:0;}
                    .ytkit-ql-del{display:none;background:none;border:none;cursor:pointer;padding:4px 8px 4px 0;opacity:0.4;transition:opacity 0.15s;}
                    .ytkit-ql-del:hover{opacity:1;}
                    .ytkit-ql-editing .ytkit-ql-del{display:flex;}
                    .ytkit-ql-divider{height:1px;background:rgba(255,255,255,0.06);margin:2px 0;}
                    .ytkit-ql-bottom{display:flex;gap:0;}
                    .ytkit-ql-bottom-btn{opacity:0.4;font-size:11px;flex:1;justify-content:center;}
                    .ytkit-ql-bottom-btn:hover{opacity:0.85;}
                    .ytkit-ql-editing .ytkit-ql-bottom-btn{opacity:1;color:#3ea6ff;}
                    .ytkit-ql-add-form{display:flex;gap:4px;padding:4px 8px;align-items:center;}
                    .ytkit-ql-input{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;font-size:11px;padding:4px 6px;width:70px;outline:none;font-family:"Roboto","Arial",sans-serif;}
                    .ytkit-ql-input:focus{border-color:rgba(62,166,255,0.4);}
                    .ytkit-ql-add-btn{background:#3ea6ff;border:none;color:#000;font-size:11px;font-weight:500;padding:4px 8px;border-radius:4px;cursor:pointer;font-family:"Roboto","Arial",sans-serif;white-space:nowrap;}
                    .ytkit-ql-add-btn:hover{background:#5bb8ff;}
                    #ytkit-player-controls{display:flex;align-items:center;gap:2px;height:100%;}
                    #ytkit-po-logo-wrap{position:relative;display:inline-flex;align-items:center;}
                    .ytkit-po-btn{display:flex;align-items:center;justify-content:center;padding:6px;border:none;background:transparent;cursor:pointer;border-radius:6px;transition:background 0.15s;text-decoration:none;color:#fff;}
                    .ytkit-po-btn:hover{background:rgba(255,255,255,0.12);}
                    .ytkit-po-dl:hover{background:rgba(34,197,94,0.2)!important;}
                    .ytkit-po-mp3:hover{background:rgba(139,92,246,0.2)!important;}
                    .ytkit-po-vlc:hover{background:rgba(249,115,22,0.2)!important;}
                `, 'quick-links');

                const tryNavbar = () => { if (!navMenuWrap) injectNavbarMenu(); };
                setTimeout(tryNavbar, 1000);

                addNavigateRule('quickLinks', () => {
                    tryNavbar();
                    if (isWatchPage()) setTimeout(injectPlayerControls, 800);
                });

                if (isWatchPage()) setTimeout(injectPlayerControls, 1500);
            }
        };
    })();


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 6: VIDEO HIDER
    // ══════════════════════════════════════════════════════════════════════════

    const VideoHider = (() => {
        const STORAGE_KEY = 'ytkit-hidden-videos';
        const CHANNELS_KEY = 'ytkit-blocked-channels';

        let hiddenSet = null;
        let hiddenList = null;
        let channelsCache = null;
        let observer = null;
        let lastHidden = null;
        let toastTimeout = null;
        let processAllTimer = null;
        let clearBatchBuffer = null;

        let subsLoadState = {
            consecutiveHiddenBatches: 0,
            lastBatchSize: 0,
            lastBatchHidden: 0,
            loadingBlocked: false,
            totalVideosLoaded: 0,
            totalVideosHidden: 0
        };

        function getHiddenVideos() {
            if (hiddenList === null) {
                hiddenList = GM_getValue(STORAGE_KEY, []);
                hiddenSet = new Set(hiddenList);
            }
            return hiddenList;
        }
        function isVideoIdHidden(videoId) {
            if (hiddenSet === null) getHiddenVideos();
            return hiddenSet.has(videoId);
        }
        function setHiddenVideos(videos) {
            hiddenList = videos;
            hiddenSet = new Set(videos);
            GM_setValue(STORAGE_KEY, videos);
        }
        function getBlockedChannels() {
            if (channelsCache === null) channelsCache = GM_getValue(CHANNELS_KEY, []);
            return channelsCache;
        }
        function setBlockedChannels(channels) {
            channelsCache = channels;
            GM_setValue(CHANNELS_KEY, channels);
        }

        function extractVideoId(el) {
            const lockup = el.querySelector('.yt-lockup-view-model[class*="content-id-"]');
            if (lockup) { const m = lockup.className.match(/content-id-([a-zA-Z0-9_-]+)/); if (m) return m[1]; }
            const links = el.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]');
            for (const link of links) {
                const wm = link.href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
                if (wm) return wm[1];
                const sm = link.href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
                if (sm) return sm[1];
            }
            const vidEl = el.querySelector('[data-video-id]');
            return vidEl ? vidEl.getAttribute('data-video-id') : null;
        }

        function extractChannelInfo(el) {
            const channelLink = el.querySelector('a[href*="/@"], a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"]');
            if (!channelLink) return null;
            const href = channelLink.href;
            let channelId = null;
            const handleMatch = href.match(/\/@([^/?]+)/);
            if (handleMatch) channelId = '@' + handleMatch[1];
            else { const idMatch = href.match(/\/(channel|c|user)\/([^/?]+)/); if (idMatch) channelId = idMatch[2]; }
            const channelName = el.querySelector('#channel-name a, .ytd-channel-name a, [id="text"] a')?.textContent?.trim() ||
                                el.querySelector('#channel-name, .ytd-channel-name')?.textContent?.trim() || channelId;
            return channelId ? { id: channelId, name: channelName } : null;
        }

        function extractDuration(el) {
            const badge = el.querySelector('ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer, [aria-label*=":"]');
            if (!badge) return 0;
            const text = badge.textContent?.trim() || badge.getAttribute('aria-label') || '';
            const match = text.match(/(\d+):(\d+):?(\d+)?/);
            if (!match) return 0;
            if (match[3]) return parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]);
            return parseInt(match[1])*60 + parseInt(match[2]);
        }

        function extractTitle(el) {
            return el.querySelector('#video-title, .title, [id="video-title"]')?.textContent?.trim()?.toLowerCase() || '';
        }

        function findThumbnailContainer(el) {
            const sels = ['a.yt-lockup-view-model__content-image', 'yt-thumbnail-view-model', '#thumbnail', 'ytd-thumbnail'];
            for (const sel of sels) { const c = el.querySelector(sel); if (c) return c; }
            return null;
        }

        function shouldHide(el) {
            const videoId = extractVideoId(el);
            if (videoId && isVideoIdHidden(videoId)) return true;
            const channelInfo = extractChannelInfo(el);
            if (channelInfo && getBlockedChannels().find(c => c.id === channelInfo.id)) return true;

            const filterStr = (getSetting('hideVideosKeywordFilter') || '').trim();
            if (filterStr) {
                const title = extractTitle(el);
                const channelName = channelInfo?.name?.toLowerCase() || '';
                const searchText = (title + ' ' + channelName).toLowerCase();

                if (filterStr.startsWith('/')) {
                    try {
                        const regexMatch = filterStr.match(/^\/(.+)\/([gimsuy]*)$/);
                        if (regexMatch) {
                            if (/([+*?]|\{\d+,?\d*\})\s*[+*?]|\(\?[^)]*[+*]/.test(regexMatch[1])) {
                                /* ReDoS risk - skip */
                            } else {
                                const regex = new RegExp(regexMatch[1], regexMatch[2]);
                                if (regex.test(title) || regex.test(channelName)) return true;
                            }
                        }
                    } catch (e) {}
                } else {
                    const keywords = filterStr.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
                    const positiveKw = keywords.filter(k => !k.startsWith('!'));
                    const negativeKw = keywords.filter(k => k.startsWith('!')).map(k => k.slice(1));
                    if (negativeKw.length && negativeKw.some(k => searchText.includes(k))) return false;
                    if (positiveKw.length && positiveKw.some(k => searchText.includes(k))) return true;
                }
            }

            const minDuration = (getSetting('hideVideosDurationFilter') || 0) * 60;
            if (minDuration > 0) {
                const duration = extractDuration(el);
                if (duration > 0 && duration < minDuration) return true;
            }
            return false;
        }

        function hideVideo(videoId, element) {
            const hidden = getHiddenVideos();
            if (!hidden.includes(videoId)) { hidden.push(videoId); setHiddenVideos(hidden); }
            element.classList.add('ytkit-video-hidden');
            lastHidden = { type: 'video', id: videoId, element };
            showHideToast('Video hidden', [
                { text: 'Undo', onClick: () => undoHide() },
                { text: 'Manage', onClick: () => showManager() }
            ]);
        }

        function blockChannel(channelInfo, element) {
            if (!channelInfo) return;
            const channels = getBlockedChannels();
            if (!channels.find(c => c.id === channelInfo.id)) {
                channels.push(channelInfo);
                setBlockedChannels(channels);
            }
            hideChannelVideos(channelInfo.id);
            lastHidden = { type: 'channel', info: channelInfo };
            showHideToast(`Blocked: ${channelInfo.name}`, [
                { text: 'Undo', onClick: () => undoHide() },
                { text: 'Manage', onClick: () => showManager() }
            ]);
        }

        function hideChannelVideos(channelId) {
            document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer').forEach(el => {
                const info = extractChannelInfo(el);
                if (info && info.id === channelId) el.classList.add('ytkit-video-hidden');
            });
        }

        function undoHide() {
            if (!lastHidden) return;
            if (lastHidden.type === 'video') {
                const hidden = getHiddenVideos();
                const idx = hidden.indexOf(lastHidden.id);
                if (idx >= 0) { hidden.splice(idx, 1); setHiddenVideos(hidden); }
                lastHidden.element?.classList.remove('ytkit-video-hidden');
            } else if (lastHidden.type === 'channel') {
                const channels = getBlockedChannels();
                const idx = channels.findIndex(c => c.id === lastHidden.info.id);
                if (idx >= 0) { channels.splice(idx, 1); setBlockedChannels(channels); }
                processAllVideos();
            }
            lastHidden = null;
            showToast('Undone', '#3b82f6', { duration: 1.5 });
        }

        function showHideToast(msg, buttons) {
            clearTimeout(toastTimeout);
            document.getElementById('ytkit-hide-toast')?.remove();
            const toast = document.createElement('div');
            toast.id = 'ytkit-hide-toast';
            toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(100px);background:#323232;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;z-index:${Z.TOAST};opacity:0;transition:all 0.3s;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
            const span = document.createElement('span');
            span.textContent = msg;
            toast.appendChild(span);
            buttons?.forEach(b => {
                const btn = document.createElement('button');
                btn.textContent = b.text;
                btn.style.cssText = 'background:transparent;border:none;color:#3ea6ff;cursor:pointer;font-size:14px;font-weight:500;padding:4px 8px;border-radius:4px;';
                btn.addEventListener('click', b.onClick);
                toast.appendChild(btn);
            });
            document.body.appendChild(toast);
            requestAnimationFrame(() => toast.classList.add('show'));
            toastTimeout = setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 5000);
        }

        function createHideButton() {
            const btn = document.createElement('button');
            btn.className = 'ytkit-video-hide-btn';
            btn.title = 'Hide this video (right-click to block channel)';
            TrustedHTML.setHTML(btn, '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>');
            return btn;
        }

        function processVideoElement(el) {
            if (el.dataset.ytkitHideProcessed) return el.classList.contains('ytkit-video-hidden');
            el.dataset.ytkitHideProcessed = 'true';
            const videoId = extractVideoId(el);
            if (videoId) el.dataset.ytkitVideoId = videoId;
            const hide = shouldHide(el);
            if (hide) el.classList.add('ytkit-video-hidden');
            else el.classList.remove('ytkit-video-hidden');

            const thumbnail = findThumbnailContainer(el);
            if (thumbnail && !thumbnail.querySelector('.ytkit-video-hide-btn')) {
                if (window.getComputedStyle(thumbnail).position === 'static') thumbnail.style.position = 'relative';
                const btn = createHideButton();
                const channelInfo = extractChannelInfo(el);
                btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (videoId) hideVideo(videoId, el); });
                btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (channelInfo) blockChannel(channelInfo, el); });
                thumbnail.appendChild(btn);
            }
            return hide;
        }

        function processAllVideos() {
            if (clearBatchBuffer) clearBatchBuffer();
            document.querySelectorAll('[data-ytkit-hide-processed]').forEach(el => { delete el.dataset.ytkitHideProcessed; });
            document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer')
                .forEach(el => processVideoElement(el));
        }

        function processAllDebounced(delay = 300) {
            if (processAllTimer) clearTimeout(processAllTimer);
            processAllTimer = setTimeout(() => { processAllTimer = null; processAllVideos(); }, delay);
        }

        function resetSubsLoadState() {
            subsLoadState = { consecutiveHiddenBatches: 0, lastBatchSize: 0, lastBatchHidden: 0, loadingBlocked: false, totalVideosLoaded: 0, totalVideosHidden: 0 };
            removeLoadBlocker();
        }

        function blockSubsLoading() {
            if (subsLoadState.loadingBlocked) return;
            subsLoadState.loadingBlocked = true;
            if (clearBatchBuffer) clearBatchBuffer();
            document.querySelectorAll('ytd-continuation-item-renderer, #continuations').forEach(cont => {
                if (!(cont instanceof HTMLElement)) return;
                cont.style.display = 'none';
                cont.dataset.ytkitBlocked = 'true';
            });
            showLoadBlockedBanner();
        }

        function removeLoadBlocker() {
            subsLoadState.loadingBlocked = false;
            document.querySelectorAll('[data-ytkit-blocked="true"]').forEach(el => {
                if (!(el instanceof HTMLElement)) return;
                el.style.display = '';
                delete el.dataset.ytkitBlocked;
            });
            document.getElementById('ytkit-subs-load-banner')?.remove();
        }

        function trackSubsLoadBatch(processedVideos) {
            if (location.pathname !== '/feed/subscriptions') return;
            if (!getSetting('hideVideosSubsLoadLimit')) return;
            if (subsLoadState.loadingBlocked) return;
            const hiddenCount = processedVideos.filter(v => v.hidden).length;
            const batchSize = processedVideos.length;
            if (batchSize === 0) return;
            subsLoadState.totalVideosLoaded += batchSize;
            subsLoadState.totalVideosHidden += hiddenCount;
            const allHidden = hiddenCount === batchSize;
            const threshold = getSetting('hideVideosSubsLoadThreshold') || 3;
            if (allHidden) {
                subsLoadState.consecutiveHiddenBatches++;
                if (subsLoadState.consecutiveHiddenBatches >= threshold) blockSubsLoading();
            } else {
                subsLoadState.consecutiveHiddenBatches = 0;
            }
        }

        function showLoadBlockedBanner() {
            if (document.getElementById('ytkit-subs-load-banner')) return;
            const banner = document.createElement('div');
            banner.id = 'ytkit-subs-load-banner';
            banner.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:12px;padding:16px 24px;display:flex;align-items:center;gap:16px;z-index:${Z.BANNER};box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:"Roboto",Arial,sans-serif;max-width:600px;`;

            const textContainer = document.createElement('div');
            textContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;';
            const title = document.createElement('div');
            title.style.cssText = 'color:#f1f5f9;font-size:14px;font-weight:600;';
            title.textContent = 'Infinite scroll stopped';
            const subtitle = document.createElement('div');
            subtitle.style.cssText = 'color:#94a3b8;font-size:12px;';
            subtitle.textContent = `${subsLoadState.totalVideosHidden} of ${subsLoadState.totalVideosLoaded} videos were hidden.`;
            textContainer.appendChild(title);
            textContainer.appendChild(subtitle);

            const resumeBtn = document.createElement('button');
            resumeBtn.textContent = 'Load More';
            resumeBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:none;background:#3b82f6;color:white;font-size:13px;font-weight:500;cursor:pointer;';
            resumeBtn.onclick = () => {
                subsLoadState.consecutiveHiddenBatches = 0;
                removeLoadBlocker();
                window.scrollBy(0, 100);
                setTimeout(() => window.scrollBy(0, -100), 100);
            };
            const dismissBtn = document.createElement('button');
            dismissBtn.textContent = '\u2715';
            dismissBtn.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94a3b8;font-size:14px;cursor:pointer;';
            dismissBtn.onclick = () => banner.remove();

            banner.appendChild(textContainer);
            banner.appendChild(resumeBtn);
            banner.appendChild(dismissBtn);
            document.body.appendChild(banner);
        }

        function showManager() {
            document.getElementById('ytkit-hider-manager')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'ytkit-hider-manager';
            overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:80000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:"Roboto",Arial,sans-serif;`;
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

            const panel = document.createElement('div');
            panel.style.cssText = 'background:#1a1a2e;border:1px solid #333;border-radius:12px;width:500px;max-height:80vh;overflow-y:auto;padding:24px;color:#e0e0e0;';

            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
            const h2 = document.createElement('h2');
            h2.textContent = 'Video Hider Manager';
            h2.style.cssText = 'margin:0;font-size:18px;font-weight:600;';
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '\u2715';
            closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:18px;cursor:pointer;';
            closeBtn.onclick = () => overlay.remove();
            titleRow.appendChild(h2);
            titleRow.appendChild(closeBtn);
            panel.appendChild(titleRow);

            const hidden = getHiddenVideos();
            const vidSection = document.createElement('div');
            vidSection.style.cssText = 'margin-bottom:16px;';
            const vidHeader = document.createElement('div');
            vidHeader.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:8px;color:#94a3b8;';
            vidHeader.textContent = `Hidden Videos (${hidden.length})`;
            vidSection.appendChild(vidHeader);

            if (hidden.length > 0) {
                const clearAllBtn = document.createElement('button');
                clearAllBtn.textContent = 'Clear All';
                clearAllBtn.style.cssText = 'padding:4px 12px;border-radius:6px;border:1px solid #dc2626;background:transparent;color:#dc2626;font-size:12px;cursor:pointer;margin-bottom:8px;';
                clearAllBtn.onclick = () => { setHiddenVideos([]); overlay.remove(); processAllVideos(); showToast('All hidden videos cleared', '#22c55e'); };
                vidSection.appendChild(clearAllBtn);

                const list = document.createElement('div');
                list.style.cssText = 'max-height:200px;overflow-y:auto;';
                hidden.slice(-50).reverse().forEach(id => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #222;font-size:12px;';
                    const link = document.createElement('a');
                    link.href = `https://www.youtube.com/watch?v=${id}`;
                    link.target = '_blank';
                    link.textContent = id;
                    link.style.cssText = 'color:#3ea6ff;text-decoration:none;';
                    const unhideBtn = document.createElement('button');
                    unhideBtn.textContent = 'Unhide';
                    unhideBtn.style.cssText = 'background:none;border:1px solid #444;border-radius:4px;color:#ccc;font-size:11px;cursor:pointer;padding:2px 8px;';
                    unhideBtn.onclick = () => {
                        const h = getHiddenVideos();
                        const idx = h.indexOf(id);
                        if (idx >= 0) { h.splice(idx, 1); setHiddenVideos(h); }
                        row.remove();
                        processAllVideos();
                    };
                    row.appendChild(link);
                    row.appendChild(unhideBtn);
                    list.appendChild(row);
                });
                vidSection.appendChild(list);
            } else {
                const empty = document.createElement('div');
                empty.textContent = 'No hidden videos';
                empty.style.cssText = 'color:#666;font-size:12px;';
                vidSection.appendChild(empty);
            }
            panel.appendChild(vidSection);

            const channels = getBlockedChannels();
            const chSection = document.createElement('div');
            chSection.style.cssText = 'margin-bottom:16px;';
            const chHeader = document.createElement('div');
            chHeader.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:8px;color:#94a3b8;';
            chHeader.textContent = `Blocked Channels (${channels.length})`;
            chSection.appendChild(chHeader);

            if (channels.length > 0) {
                channels.forEach((ch, i) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #222;font-size:12px;';
                    const name = document.createElement('span');
                    name.textContent = ch.name || ch.id;
                    name.style.color = '#ccc';
                    const unblockBtn = document.createElement('button');
                    unblockBtn.textContent = 'Unblock';
                    unblockBtn.style.cssText = 'background:none;border:1px solid #444;border-radius:4px;color:#ccc;font-size:11px;cursor:pointer;padding:2px 8px;';
                    unblockBtn.onclick = () => {
                        const chs = getBlockedChannels();
                        chs.splice(i, 1);
                        setBlockedChannels(chs);
                        row.remove();
                        processAllVideos();
                    };
                    row.appendChild(name);
                    row.appendChild(unblockBtn);
                    chSection.appendChild(row);
                });
            } else {
                const empty = document.createElement('div');
                empty.textContent = 'No blocked channels';
                empty.style.cssText = 'color:#666;font-size:12px;';
                chSection.appendChild(empty);
            }
            panel.appendChild(chSection);

            overlay.appendChild(panel);
            document.body.appendChild(overlay);
        }

        return {
            init() {
                if (!getSetting('hideVideosFromHome')) return;

                processAllVideos();

                const selectors = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer';
                let batchBuffer = [];
                let batchTimeout = null;
                clearBatchBuffer = () => { batchBuffer = []; if (batchTimeout) { clearTimeout(batchTimeout); batchTimeout = null; } };

                const processBatch = () => {
                    if (batchBuffer.length > 0 && !subsLoadState.loadingBlocked) {
                        trackSubsLoadBatch(batchBuffer);
                        batchBuffer = [];
                    }
                };

                observer = new MutationObserver(mutations => {
                    for (const m of mutations) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType !== 1) continue;
                            if (node.matches?.(selectors)) {
                                const wasHidden = processVideoElement(node);
                                batchBuffer.push({ element: node, hidden: wasHidden });
                            }
                            node.querySelectorAll?.(selectors).forEach(el => {
                                const wasHidden = processVideoElement(el);
                                batchBuffer.push({ element: el, hidden: wasHidden });
                            });
                        }
                    }
                    if (batchTimeout) clearTimeout(batchTimeout);
                    batchTimeout = setTimeout(processBatch, 300);
                });

                const observeTarget = document.querySelector('ytd-app') || document.body;
                observer.observe(observeTarget, { childList: true, subtree: true });

                addNavigateRule('videoHider', () => {
                    processAllDebounced(500);
                    if (location.pathname === '/feed/subscriptions') resetSubsLoadState();
                    else removeLoadBlocker();
                });
            }
        };
    })();


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 7: INITIALIZATION
    // ══════════════════════════════════════════════════════════════════════════

    function init() {
        window.addEventListener('yt-navigate-finish', () => fireNavigateRules());
        window.addEventListener('popstate', () => setTimeout(() => fireNavigateRules(), 300));

        TheaterSplit.init();
        SubscriptionsGrid.init();
        Downloads.init();
        QuickLinks.init();

        const initHider = () => {
            const app = document.querySelector('ytd-app');
            if (app) VideoHider.init();
            else setTimeout(initHider, 500);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(initHider, 500));
        } else {
            setTimeout(initHider, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
