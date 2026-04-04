// ==UserScript==
// @name         Theater Split v1.0.1
// @namespace    https://github.com/SysAdminDoc/YouTube-Kit
// @version      1.0.2
// @description  Fullscreen video on YouTube watch pages. Scroll down to split: video left, comments/chat right. Scroll up to return.
// @author       Matthew Parker
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ── Early CSS (anti-FOUC) ──────────────────────────────────────────────
    const earlyStyle = document.createElement('style');
    earlyStyle.textContent = `
        /* Hide masthead when overlay is active */
        body.ts-active ytd-masthead,
        body.ts-active #masthead-container { display: none !important; }
        /* Prevent page scroll behind overlay */
        body.ts-active { overflow: hidden !important; }
        /* Split overlay base */
        #ts-wrapper { display:none; }
        body.ts-active #ts-wrapper { display:flex; }
        /* Fullscreen guard — never interfere with native fullscreen */
        ytd-watch-flexy[fullscreen] ~ #ts-wrapper,
        body:fullscreen #ts-wrapper { display:none !important; }

        /* ── CRITICAL: Kill view-transition-name containing blocks ──
           YouTube sets view-transition-name on #secondary, #below, and
           #player-full-bleed-container. This creates containing blocks
           that trap position:fixed children — they position relative to
           the ancestor instead of the viewport. Must clear these so our
           position:fixed chat/comments can escape to the viewport. */
        body.ts-active #secondary,
        body.ts-active #below,
        body.ts-active #player-full-bleed-container,
        body.ts-active #columns,
        body.ts-active ytd-watch-flexy {
            view-transition-name: none !important;
        }

        /* ── Chat frame overrides when split is active ── */
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
        /* Override loading visibility:hidden on chat */
        body.ts-active ytd-watch-flexy.loading ytd-live-chat-frame#chat,
        body.ts-active ytd-watch-flexy:not([ghost-cards-enabled]).loading #chat {
            visibility: visible !important;
        }
    `;
    (document.head || document.documentElement).appendChild(earlyStyle);

    // ── Constants ──────────────────────────────────────────────────────────
    const SPLIT_RATIO_KEY = 'ts_split_ratio';
    const TRANSITION = '0.35s cubic-bezier(0.4,0,0.2,1)';

    // ── State ──────────────────────────────────────────────────────────────
    let isActive = false;
    let isSplit = false;
    let entering = false;
    let videoType = 'standard'; // 'standard' | 'live' | 'vod'
    let splitWrapper = null;
    let origPlayerParent = null;
    let origPlayerNextSibling = null;
    let positionedEls = [];
    let scrollTarget = null;
    let wheelHandler = null;
    let touchHandler = null;
    let touchMoveHandler = null;
    let touchStartY = 0;
    let windowResizeHandler = null;
    let playerResizeObs = null;
    let clickToPauseHandler = null;
    let clickToPauseMp = null;
    let resizeTimer = null;
    let lastVideoId = null;
    let chatObserver = null;

    // ── Helpers ─────────────────────────────────────────────────────────────
    function getVideoId() {
        const u = new URL(location.href);
        return u.searchParams.get('v') || '';
    }

    function isWatchPage() {
        return location.pathname === '/watch';
    }

    function getPlayer() {
        return document.querySelector('#player-container');
    }

    function getBelow() {
        return document.querySelector('#below') || document.querySelector('ytd-watch-metadata')?.parentElement;
    }

    function getChatEl() {
        return document.querySelector('ytd-live-chat-frame#chat') || document.querySelector('ytd-live-chat-frame');
    }

    function setStyles(el, props) {
        if (!el) return;
        for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
    }

    function removeStyles(el, props) {
        if (!el) return;
        props.forEach(p => el.style.removeProperty(p));
    }

    function getSavedRatio() {
        try { return parseFloat(localStorage.getItem(SPLIT_RATIO_KEY)) || 75; }
        catch { return 75; }
    }

    function saveRatio(v) {
        try { localStorage.setItem(SPLIT_RATIO_KEY, v); } catch {}
    }

    // ── Video Type Detection ────────────────────────────────────────────────
    function detectVideoType() {
        const chatEl = getChatEl();

        // Primary: check ytInitialPlayerResponse (most reliable on initial load)
        try {
            const vd = window.ytInitialPlayerResponse?.videoDetails;
            if (vd?.isLiveContent) {
                return vd.isLive ? 'live' : 'vod';
            }
        } catch {}

        // SPA fallback: check the Polymer element's data (ytInitialPlayerResponse
        // can be stale after SPA navigation)
        try {
            const flexy = document.querySelector('ytd-watch-flexy');
            const pd = flexy?.playerData_ || flexy?.__data?.playerData_;
            if (pd?.videoDetails?.isLiveContent) {
                return pd.videoDetails.isLive ? 'live' : 'vod';
            }
        } catch {}

        // DOM fallback: chat frame presence + live badge
        if (chatEl) {
            const liveBadge = document.querySelector('.ytp-live-badge');
            if (liveBadge && !liveBadge.hasAttribute('disabled')) return 'live';
            return 'vod';
        }

        // Attribute fallback: YouTube sets this on ytd-watch-flexy
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

    // ── Player Resize ───────────────────────────────────────────────────────
    function triggerPlayerResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const vid = document.querySelector('#ts-left video.html5-main-video');
            if (vid) {
                const wasPaused = vid.paused;
                const parent = vid.parentNode;
                const next = vid.nextSibling;
                parent.removeChild(vid);
                void parent.offsetHeight;
                parent.insertBefore(vid, next);
                if (!wasPaused) vid.play().catch(() => {});
            }
            window.dispatchEvent(new Event('resize'));
        }, 50);
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

    // ── Position helpers ────────────────────────────────────────────────────
    function positionOverRight(el, rightPct, topOffset, heightStr) {
        if (!el) return;
        setStyles(el, {
            position: 'fixed', top: topOffset || '0', right: '0',
            width: `calc(${rightPct}% - 6px)`, 'max-width': 'none',
            height: heightStr || '100vh', 'max-height': 'none',
            'min-height': '0', margin: '0',
            'overflow-y': 'auto', 'overflow-x': 'hidden',
            'z-index': '10001', background: '#0f0f0f', padding: '0',
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

    // ── Chat helpers ────────────────────────────────────────────────────────
    function forceChatFill(chatEl) {
        if (!chatEl) return;

        // ytd-live-chat-frame is a flex column container — keep it that way
        setStyles(chatEl, {
            display: 'flex', 'flex-direction': 'column',
            'max-height': 'none', 'min-height': '0',
            overflow: 'hidden', border: 'none'
        });

        // Hide the show/hide toggle button
        const showHide = chatEl.querySelector('#show-hide-button');
        if (showHide) setStyles(showHide, { display: 'none' });

        // Force iframe to fill via both flex AND explicit height
        const iframe = chatEl.querySelector('iframe');
        if (iframe) {
            setStyles(iframe, {
                flex: '1', width: '100%', height: '100%',
                'min-height': '0', 'max-height': 'none',
                border: 'none', 'border-radius': '0'
            });
        }

        // Also ensure #chat-container parent is not constraining
        const chatContainer = chatEl.closest('#chat-container');
        if (chatContainer) {
            setStyles(chatContainer, {
                display: 'block', height: 'auto', 'max-height': 'none',
                overflow: 'visible', visibility: 'visible'
            });
        }
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
        setStyles(chatEl, {
            width: `calc(${rightPct}% - 2px)`, padding: '0',
            'border-radius': '0'
        });
        forceChatFill(chatEl);
    }

    function waitForChat(rightPct, topOffset, heightStr) {
        if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
        const onFound = (chatEl) => {
            if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
            if (!isSplit || !isActive) return;

            // Update video type now that chat is confirmed
            if (videoType === 'standard') {
                videoType = detectVideoType();
                if (videoType === 'standard') videoType = 'live'; // chat exists = at least live
            }

            positionOverRight(chatEl, rightPct, topOffset, heightStr);
            chatEl.removeAttribute('collapsed');
            chatEl.removeAttribute('hide-chat-frame');
            setStyles(chatEl, {
                width: `calc(${rightPct}% - 2px)`, padding: '0',
                'border-radius': '0'
            });
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

    // ── Build Overlay ───────────────────────────────────────────────────────
    function buildOverlay() {
        const wrapper = document.createElement('div');
        wrapper.id = 'ts-wrapper';
        wrapper.style.cssText = `display:flex;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#000;overflow:hidden;`;

        const left = document.createElement('div');
        left.id = 'ts-left';
        left.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;background:#000;position:relative;`;

        const divider = document.createElement('div');
        divider.id = 'ts-divider';
        divider.style.cssText = `flex:0 0 0;width:0;cursor:col-resize;position:relative;background:rgba(255,255,255,0.04);transition:flex-basis ${TRANSITION};overflow:hidden;z-index:10;`;
        const pip = document.createElement('div');
        pip.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:40px;border-radius:2px;background:rgba(255,255,255,0.18);pointer-events:none;`;
        divider.appendChild(pip);
        divider.addEventListener('mouseenter', () => { divider.style.background = 'rgba(59,130,246,0.22)'; pip.style.background = 'rgba(59,130,246,0.8)'; });
        divider.addEventListener('mouseleave', () => { divider.style.background = 'rgba(255,255,255,0.04)'; pip.style.background = 'rgba(255,255,255,0.18)'; });

        const right = document.createElement('div');
        right.id = 'ts-right';
        right.style.cssText = `flex:0 0 0;width:0;height:100%;overflow-y:auto;overflow-x:hidden;background:#0f0f0f;border-left:1px solid rgba(255,255,255,0.06);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;padding:0;box-sizing:border-box;opacity:0;transition:flex-basis ${TRANSITION},opacity 0.3s;`;

        initDividerDrag(divider, left, right);

        const closeBtn = document.createElement('button');
        closeBtn.id = 'ts-close';
        closeBtn.title = 'Close side panel';
        closeBtn.style.cssText = `position:absolute;top:8px;right:8px;z-index:10010;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s;color:rgba(255,255,255,0.7);padding:0;`;
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
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

    // ── Mount Overlay ───────────────────────────────────────────────────────
    function mountOverlay() {
        if (isActive) return;
        const player = getPlayer();
        const below = getBelow();
        const chatEl = getChatEl();
        if (!player) return;
        if (!below && !chatEl) return;

        positionedEls = [];
        scrollTarget = null;
        origPlayerParent = player.parentElement;
        origPlayerNextSibling = player.nextSibling;
        isActive = true;

        const wrapper = buildOverlay();
        splitWrapper = wrapper;
        document.body.appendChild(wrapper);
        document.body.classList.add('ts-active');

        const left = wrapper.querySelector('#ts-left');

        // Move player into left panel
        const video = document.querySelector('video.html5-main-video');
        const wasPlaying = video && !video.paused;
        left.insertBefore(player, wrapper.querySelector('#ts-close'));
        setStyles(player, {
            width: '100%', height: '100%', flex: '1',
            'min-height': '0', display: 'flex', 'flex-direction': 'column'
        });
        if (wasPlaying && video) {
            requestAnimationFrame(() => video.play().catch(() => {}));
        }

        // Force player to fill container
        let fpsCount = 0;
        const doForce = () => {
            if (fpsCount > 5) return;
            fpsCount++;
            requestAnimationFrame(() => { if (isActive) forcePlayerSize(); });
        };
        doForce();

        let resizeDebounce = null;
        playerResizeObs = new ResizeObserver(() => {
            clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => { fpsCount = 0; doForce(); }, 200);
        });
        playerResizeObs.observe(left);

        setTimeout(() => triggerPlayerResize(), 600);

        // Block interaction on elements behind overlay
        if (below) setStyles(below, { 'pointer-events': 'none' });
        if (chatEl) {
            setStyles(chatEl, { 'pointer-events': 'none' });
            chatEl.removeAttribute('collapsed');
            chatEl.removeAttribute('hide-chat-frame');
        }

        // Pre-scroll to comments so YT's IntersectionObserver fires (behind overlay)
        if (videoType !== 'live' && below) {
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

        // Kill view-transition-name containing blocks that trap position:fixed
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy) flexy.style.setProperty('view-transition-name', 'none', 'important');
        if (below) below.style.setProperty('view-transition-name', 'none', 'important');

        // Hide #related but keep #secondary visible (chat is inside #secondary)
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

        wheelHandler = (e) => {
            if (!isActive) return;
            if (!isSplit && e.deltaY > 0) { expandSplit(); return; }
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
            if (!isSplit && touchStartY - t.clientY > 30) { expandSplit(); return; }
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
        splitWrapper.addEventListener('wheel', wheelHandler, { passive: true, capture: true });
        splitWrapper.addEventListener('touchstart', touchHandler, { passive: true, capture: true });
        splitWrapper.addEventListener('touchmove', touchMoveHandler, { passive: true, capture: true });

        windowResizeHandler = () => { if (isActive) triggerPlayerResize(); };
        window.addEventListener('resize', windowResizeHandler);

        clickToPauseHandler = (e) => {
            const t = e.target;
            if (t.closest('.ytp-chrome-bottom, .ytp-chrome-top, .ytp-ce-element, .ytp-cards-teaser, .ytp-ad-overlay-container, .ytp-settings-menu, .ytp-popup, .ytp-paid-content-overlay, a')) return;
            const vid = document.querySelector('video.html5-main-video');
            if (!vid) return;
            if (t !== vid && !t.closest('.html5-video-container')) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            if (vid.paused) vid.play().catch(() => {});
            else vid.pause();
        };
        const mp = document.getElementById('movie_player');
        if (mp) mp.addEventListener('click', clickToPauseHandler, true);
        clickToPauseMp = mp;
    }

    // ── Expand Split ────────────────────────────────────────────────────────
    function expandSplit() {
        if (isSplit || !isActive) return;
        isSplit = true;
        entering = true;
        positionedEls = [];

        // Add split class for CSS overrides
        document.body.classList.add('ts-split');

        const wrapper = splitWrapper;
        const right = wrapper.querySelector('#ts-right');
        const divider = wrapper.querySelector('#ts-divider');
        const below = getBelow();
        const chatEl = getChatEl();

        // Re-detect type at expand time — chat may have appeared since mount
        if (chatEl && videoType === 'standard') {
            videoType = detectVideoType();
            if (videoType === 'standard') videoType = 'live'; // chat frame exists = treat as live
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

        // Re-enable pointer events on positioned content
        if (below) removeStyles(below, ['pointer-events']);
        if (chatEl) removeStyles(chatEl, ['pointer-events']);
    }

    // ── Collapse Split ──────────────────────────────────────────────────────
    function collapseSplit(full) {
        if (!isActive) return;
        isSplit = false;

        document.body.classList.remove('ts-split');

        const wrapper = splitWrapper;
        const right = wrapper.querySelector('#ts-right');
        const divider = wrapper.querySelector('#ts-divider');
        const closeBtn = wrapper.querySelector('#ts-close');

        if (right) {
            right.style.flexBasis = '0';
            right.style.width = '0';
            right.style.opacity = '0';
        }
        if (divider) {
            divider.style.flexBasis = '0';
            divider.style.width = '0';
        }
        if (closeBtn) closeBtn.style.opacity = '0';

        unpositionAll();
        if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }

        const below = getBelow();
        const chatEl = getChatEl();
        if (below) setStyles(below, { 'pointer-events': 'none' });
        if (chatEl) {
            setStyles(chatEl, { 'pointer-events': 'none' });
            restoreChatFill(chatEl);
        }

        setTimeout(() => triggerPlayerResize(), 400);

        if (full) teardown();
    }

    // ── Teardown ────────────────────────────────────────────────────────────
    function teardown() {
        if (!isActive) return;
        isActive = false;
        isSplit = false;

        const player = getPlayer();
        if (player && origPlayerParent) {
            const video = document.querySelector('video.html5-main-video');
            const wasPlaying = video && !video.paused;
            if (origPlayerNextSibling && origPlayerNextSibling.parentNode === origPlayerParent) {
                origPlayerParent.insertBefore(player, origPlayerNextSibling);
            } else {
                origPlayerParent.appendChild(player);
            }
            removeStyles(player, ['width', 'height', 'flex', 'min-height', 'display', 'flex-direction']);
            if (wasPlaying && video) requestAnimationFrame(() => video.play().catch(() => {}));
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

        if (clickToPauseMp && clickToPauseHandler) {
            clickToPauseMp.removeEventListener('click', clickToPauseHandler, true);
        }
        clickToPauseHandler = null;
        clickToPauseMp = null;

        if (playerResizeObs) { playerResizeObs.disconnect(); playerResizeObs = null; }
        if (windowResizeHandler) { window.removeEventListener('resize', windowResizeHandler); windowResizeHandler = null; }
        if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }

        if (splitWrapper) { splitWrapper.remove(); splitWrapper = null; }

        document.body.classList.remove('ts-active', 'ts-split');

        unpositionAll();
        const below = getBelow();
        if (below) removeStyles(below, ['pointer-events']);
        const chatEl = getChatEl();
        if (chatEl) {
            removeStyles(chatEl, ['pointer-events']);
            restoreChatFill(chatEl);
        }
        const sec = document.querySelector('#secondary');
        if (sec) {
            delete sec.dataset.tsHidden;
            removeStyles(sec, ['display', 'pointer-events', 'view-transition-name']);
            const related = sec.querySelector('#related');
            if (related) { delete related.dataset.tsHidden; related.style.removeProperty('display'); }
        }
        // Restore view-transition-name on elements we cleared it from
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy) flexy.style.removeProperty('view-transition-name');
        if (below) below.style.removeProperty('view-transition-name');
        const cols = document.querySelector('#columns');
        if (cols) cols.style.removeProperty('view-transition-name');

        origPlayerParent = null;
        origPlayerNextSibling = null;

        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    }

    // ── Activate / Deactivate ───────────────────────────────────────────────
    function activate() {
        if (isActive) return;
        videoType = detectVideoType();
        mountOverlay();
    }

    function deactivate() {
        if (!isActive) return;
        teardown();
    }

    // ── Navigation handler ──────────────────────────────────────────────────
    function onNavigate() {
        const vid = getVideoId();
        if (!isWatchPage()) {
            deactivate();
            lastVideoId = null;
            return;
        }
        if (vid !== lastVideoId) {
            if (isActive) teardown();
            lastVideoId = vid;
            // Wait for DOM + player data to settle
            setTimeout(() => {
                if (isWatchPage() && getVideoId() === vid) {
                    activate();
                }
            }, 800);
        }
    }

    // ── Fullscreen detection ────────────────────────────────────────────────
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

    // ── Init ────────────────────────────────────────────────────────────────
    function init() {
        window.addEventListener('yt-navigate-finish', onNavigate);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        window.addEventListener('popstate', () => setTimeout(onNavigate, 300));

        if (isWatchPage()) {
            lastVideoId = getVideoId();
            const waitForPlayer = () => {
                if (getPlayer()) {
                    activate();
                } else {
                    setTimeout(waitForPlayer, 200);
                }
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => setTimeout(waitForPlayer, 800));
            } else {
                setTimeout(waitForPlayer, 800);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
