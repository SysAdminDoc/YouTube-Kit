(function() {
    'use strict';

    const moduleFeatures = [
        {
            id: 'enableAdblock',
            name: 'Enable Adblock',
            description: 'Blocks video ads, static ads, and anti-adblock popups.',
            group: 'Modules',
            _styleElement: null,
            _observer: null,
            init() {
                const injectAdblockCss = () => {
                    const styleId = 'ytkit-adblock-styles';
                    if (document.getElementById(styleId)) return;
                    const cssSelectors = [
                        '#masthead-ad',
                        'ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer)',
                        '.video-ads.ytp-ad-module',
                        'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
                        'ytd-popup-container:has(a[href="/premium"])',
                        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
                        '#related #player-ads',
                        '#related ytd-ad-slot-renderer',
                        'ytd-ad-slot-renderer',
                        'ad-slot-renderer',
                        'ytm-companion-ad-renderer',
                    ];
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = styleId;
                    this._styleElement.textContent = `${cssSelectors.join(', ')} { display: none !important; }`;
                    (document.head || document.documentElement).appendChild(this._styleElement);
                };

                const processVideoAd = () => {
                    const video = document.querySelector('.ad-showing video');
                    if (!video) return;
                    video.muted = true;
                    if (video.duration) video.currentTime = video.duration;
                    document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')?.click();
                };

                const removeAntiAdblockPopup = (node) => {
                    const isPopupContainer = node.tagName === 'YTD-POPUP-CONTAINER';
                    const hasEnforcementMessage = !!node.querySelector('ytd-enforcement-message-view-model');
                    if (isPopupContainer && hasEnforcementMessage) {
                        node.remove();
                        document.querySelector('tp-yt-iron-overlay-backdrop[opened]')?.remove();
                        const mainVideo = document.querySelector('video.html5-main-video');
                        if (mainVideo && mainVideo.paused) mainVideo.play();
                    }
                };

                const observeDOMChanges = () => {
                    this._observer = new MutationObserver((mutations) => {
                        processVideoAd();
                        for (const mutation of mutations) {
                            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                                for (const node of mutation.addedNodes) {
                                    if (node.nodeType === Node.ELEMENT_NODE) {
                                        removeAntiAdblockPopup(node);
                                    }
                                }
                            }
                        }
                    });
                    this._observer.observe(document.body, { childList: true, subtree: true });
                };

                injectAdblockCss();
                observeDOMChanges();
            },
            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                this._observer = null;
            }
        },
        {
            id: 'enableCPU_Tamer',
            name: 'Enable CPU Tamer',
            description: 'Reduces browser energy impact by throttling background tasks. Note: May have reduced effectiveness as it cannot run at document-start.',
            group: 'Modules',
            _originals: {},
            init() {
                this._originals.setTimeout = window.setTimeout;
                this._originals.setInterval = window.setInterval;
                this._originals.clearTimeout = window.clearTimeout;
                this._originals.clearInterval = window.clearInterval;

                (function(originals) {
                    const win = window;
                    const hkey_script = 'yt_cpu_tamer_by_animationframe';
                    if (win[hkey_script]) return;
                    win[hkey_script] = true;

                    const Promise = (async () => {})().constructor;
                    const isGPUAccelerationAvailable = (() => {
                        try {
                            const canvas = document.createElement('canvas');
                            return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
                        } catch (e) { return false; }
                    })();

                    if (!isGPUAccelerationAvailable) {
                        console.warn('YTKit CPU Tamer: GPU Acceleration not available.');
                        return;
                    }

                    const timeupdateDT = (() => {
                        const timeupdateKey = '__yt_cpu_tamer_timeupdate__';
                        win[timeupdateKey] = 1;
                        document.addEventListener('timeupdate', () => { win[timeupdateKey] = Date.now(); }, true);
                        let topTimeupdateValue = -1;
                        try { topTimeupdateValue = top[timeupdateKey]; } catch (e) {}
                        return topTimeupdateValue >= 1 ? () => top[timeupdateKey] : () => win[timeupdateKey];
                    })();

                    const { setTimeout, setInterval, clearTimeout, clearInterval, requestAnimationFrame } = originals;
                    let afInterruptHandler = null;

                    const requestAnimationFramePromise = (resolve) => requestAnimationFrame(afInterruptHandler = resolve);

                    let p1 = { resolved: true }, p2 = { resolved: true };
                    let executionCounter = 0;

                    const resolveAnimationFrame = async (promiseWrapper) => {
                        await new Promise(requestAnimationFramePromise);
                        promiseWrapper.resolved = true;
                        const ticket = ++executionCounter;
                        if (promiseWrapper.resolve) promiseWrapper.resolve(ticket);
                        return ticket;
                    };

                    const executeThrottled = async () => {
                        const promise1Pending = !p1.resolved ? p1 : null;
                        const promise2Pending = !p2.resolved ? p2 : null;
                        if (promise1Pending && promise2Pending) await Promise.all([promise1Pending, promise2Pending]);
                        else if (promise1Pending) await promise1Pending;
                        else if (promise2Pending) await promise2Pending;
                        if (!p1.resolved) p1 = { resolve: null, resolved: false };
                        if (!p2.resolved) p2 = { resolve: null, resolved: false };
                        const ticket1 = resolveAnimationFrame(p1);
                        const ticket2 = resolveAnimationFrame(p2);
                        return await Promise.race([ticket1, ticket2]);
                    };

                    const inExecution = new Set();
                    const throttledWrapper = async (handler, store) => {
                        try {
                            const now = Date.now();
                            if (now - timeupdateDT() < 800 && now - store.lastCall < 800) {
                                const cid = store.cid;
                                inExecution.add(cid);
                                const ticket = await executeThrottled();
                                const wasInExecution = inExecution.delete(cid);
                                if (!wasInExecution || ticket === store.lastExecutionTicket) return;
                                store.lastExecutionTicket = ticket;
                            }
                            store.lastCall = now;
                            handler();
                        } catch (e) { console.error("YTKit CPU Tamer:", e); }
                    };

                    const scheduleFunction = (originalFn) => (func, ms = 0, ...args) => {
                        if (typeof func === 'function') {
                            const store = { lastCall: Date.now() };
                            const handler = args.length > 0 ? func.bind(null, ...args) : func;
                            store.cid = originalFn(() => throttledWrapper(handler, store), ms);
                            return store.cid;
                        }
                        return originalFn(func, ms, ...args);
                    };

                    win.setTimeout = scheduleFunction(setTimeout);
                    win.setInterval = scheduleFunction(setInterval);

                    const clearFunction = (originalClearFn) => (cid) => {
                        if (cid) {
                            inExecution.delete(cid);
                            originalClearFn(cid);
                        }
                    };

                    win.clearTimeout = clearFunction(clearTimeout);
                    win.clearInterval = clearFunction(clearInterval);

                    let lastInterruptHandler = null;
                    setInterval(() => {
                        if (lastInterruptHandler === afInterruptHandler) {
                            if (lastInterruptHandler) {
                                afInterruptHandler();
                                lastInterruptHandler = afInterruptHandler = null;
                            }
                        } else {
                            lastInterruptHandler = afInterruptHandler;
                        }
                    }, 125);

                })(this._originals);
            },
            destroy() {
                if (this._originals.setTimeout) window.setTimeout = this._originals.setTimeout;
                if (this._originals.setInterval) window.setInterval = this._originals.setInterval;
                if (this._originals.clearTimeout) window.clearTimeout = this._originals.clearTimeout;
                if (this._originals.clearInterval) window.clearInterval = this._originals.clearInterval;
                window.yt_cpu_tamer_by_animationframe = false;
            }
        },
        {
            id: 'enableHandleRevealer',
            name: 'Enable Comment Handle Revealer',
            description: 'Reveals the original channel name next to the user\'s @handle in comments.',
            group: 'Modules',
            _observer: null,
            init() {
                const nameMap = new Map();
                const pageManager = document.getElementById('page-manager');
                if (!pageManager) return;

                const isHTMLElement = node => node instanceof HTMLElement;
                const decode = (() => {
                    const ENTITIES = [['amp', '&'], ['apos', '\''], ['quot', '"'], ['nbsp', ' '], ['lt', '<'], ['gt', '>'], ['#39', '\'']];
                    return s => ENTITIES.reduce((acc, [entity, sym]) => acc.replaceAll(`&${entity};`, sym), s);
                })();

                const appendName = (anchor, name) => {
                    const existingSpan = anchor.querySelector(`span[data-ytkit-name]`);
                    if (existingSpan) existingSpan.remove();

                    const span = Object.assign(document.createElement('span'), {
                        textContent: `( ${name} )`,
                        style: 'margin-left: 4px; color: var(--yt-spec-text-secondary);'
                    });
                    span.dataset.ytkitName = name;
                    const channelNameElement = anchor.querySelector('#author-text') ?? anchor;
                    channelNameElement.append(span);
                };

                this._observer = new MutationObserver(records => {
                    const addedElements = records.flatMap(r => [...r.addedNodes]).filter(isHTMLElement);
                    for (const el of addedElements) {
                        const commentsWrapper = el.querySelector('ytd-comments');
                        if (commentsWrapper && !commentsWrapper.dataset.handleRevealerAttached) {
                            commentsWrapper.dataset.handleRevealerAttached = 'true';
                            const contentsObserver = new MutationObserver(records => {
                                const addedCommentNodes = records.flatMap(r => [...r.addedNodes]).filter(isHTMLElement);
                                const viewModels = new Set();
                                for (const node of addedCommentNodes) {
                                    if (node.tagName === 'YTD-COMMENT-THREAD-RENDERER') {
                                        node.querySelectorAll('ytd-comment-view-model').forEach(vm => viewModels.add(vm));
                                    } else if (node.tagName === 'YTD-COMMENT-VIEW-MODEL') {
                                        viewModels.add(node);
                                    }
                                }

                                for (const vm of viewModels) {
                                    for (const author of vm.querySelectorAll('#author-text')) {
                                        const handle = author.textContent.trim();
                                        if (!handle) continue;
                                        if (nameMap.has(handle)) {
                                            const name = nameMap.get(handle);
                                            if (name) appendName(author, name);
                                            continue;
                                        }
                                        nameMap.set(handle, null);
                                        fetch(author.href).then(async response => {
                                            const text = await response.text();
                                            const [name] = text.match(/(?<=\<title\>).+?(?= - YouTube)/) ?? [];
                                            if (name) {
                                                const decodedName = decode(name);
                                                appendName(author, decodedName);
                                                nameMap.set(handle, decodedName);
                                            } else {
                                                nameMap.delete(handle);
                                            }
                                        }).catch(() => nameMap.delete(handle));
                                    }
                                }
                            });
                            contentsObserver.observe(commentsWrapper, { childList: true, subtree: true });
                        }
                    }
                });
                this._observer.observe(pageManager, { childList: true });
            },
            destroy() {
                this._observer?.disconnect();
                this._observer = null;
                document.querySelectorAll('span[data-ytkit-name]').forEach(span => span.remove());
            }
        },
        {
            id: 'enableYoutubetoYout_ube',
            name: 'Enable YouTube to yout-ube.com Redirector',
            description: 'Redirects YouTube video links to yout-ube.com. Disclaimer: Using a VPN may break this feature\'s functionality.',
            group: 'Modules',
            isManagement: true,
            _linkObserver: null,
            _clickInterceptor: null,
            _urlChangeListener: null,
            _lastHref: '',
            _timer: null,
            init() {
                const appState = window.YTKit.appState;
                const isYouTubeHost = (host) => host === 'youtube.com' || host.endsWith('.youtube.com');
                const isNoCookieHost = (host) => host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
                const isYoutuDotBeHost = (host) => host === 'youtu.be';
                const onYoutUbeDotCom = (host) => host === 'yout-ube.com' || host.endsWith('.yout-ube.com');

                const extractVideoIdFromUrlObj = (urlObj) => {
                    const { host, pathname, searchParams } = urlObj;
                    if (isYouTubeHost(host) && pathname.startsWith('/watch')) return searchParams.get('v');
                    if (isYoutuDotBeHost(host)) return pathname.split('/').filter(Boolean)[0];
                    if ((isYouTubeHost(host) || isNoCookieHost(host)) && pathname.startsWith('/shorts/')) {
                        if (!appState.settings.yout_ube_redirectShorts) return null;
                        return pathname.split('/').filter(Boolean)[1];
                    }
                    if ((isYouTubeHost(host) || isNoCookieHost(host)) && pathname.startsWith('/embed/')) {
                        if (!appState.settings.yout_ube_redirectEmbed) return null;
                        const second = pathname.split('/').filter(Boolean)[1] || '';
                        if (second && second !== 'videoseries') return second;
                    }
                    return null;
                };

                const buildYoutUbeUrl = (videoId, srcUrlObj) => {
                    const p = new URLSearchParams({ v: videoId });
                    const t = srcUrlObj.searchParams.get('t') || srcUrlObj.searchParams.get('start') || srcUrlObj.searchParams.get('time_continue');
                    if (t) p.set('t', t);
                    const list = srcUrlObj.searchParams.get('list') || srcUrlObj.searchParams.get('playlist');
                    if (list) p.set('list', list);
                    const index = srcUrlObj.searchParams.get('index');
                    if (index) p.set('index', index);
                    return `https://yout-ube.com/watch?${p.toString()}`;
                };

                const shouldHandleHost = (host) => {
                    if (onYoutUbeDotCom(host)) return false;
                    if (window.top !== window.self && isNoCookieHost(host)) return false;
                    if (isNoCookieHost(host)) {
                        if (document.referrer.toLowerCase().includes('yout-ube.com')) return false;
                        return !!appState.settings.yout_ube_redirectNoCookie;
                    }
                    return isYouTubeHost(host) || isYoutuDotBeHost(host);
                };

                const attemptRedirect = () => {
                    try {
                        const current = new URL(location.href);
                        if (!shouldHandleHost(current.host)) return;
                        const vid = extractVideoIdFromUrlObj(current);
                        if (!vid) return;
                        const target = buildYoutUbeUrl(vid, current);
                        if (target !== location.href) location.replace(target);
                    } catch (e) {}
                };

                const toYoutUbeHref = (href) => {
                    try {
                        const u = new URL(href, location.href);
                        const vid = extractVideoIdFromUrlObj(u);
                        return vid ? buildYoutUbeUrl(vid, u) : null;
                    } catch { return null; }
                };

                const rewriteAnchor = (a) => {
                    if (!a || !a.href || a.dataset.yt2rewritten === '1') return;
                    const newHref = toYoutUbeHref(a.href);
                    if (newHref) { a.href = newHref; a.dataset.yt2rewritten = '1'; }
                };

                const rewriteAllLinks = (root = document) => {
                    if (!appState.settings.yout_ube_rewriteLinks) return;
                    root.querySelectorAll('a[href*="watch?v="], a[href^="https://youtu.be/"], a[href*="/shorts/"], a[href*="/embed/"]').forEach(rewriteAnchor);
                };

                this._linkObserver = new MutationObserver((mutList) => {
                    if (!appState.settings.yout_ube_rewriteLinks) return;
                    for (const m of mutList) {
                        if (m.type === 'childList') {
                            m.addedNodes.forEach(n => {
                                if (n.nodeType !== 1) return;
                                if (n.tagName === 'A') rewriteAnchor(n);
                                else rewriteAllLinks(n);
                            });
                        } else if (m.type === 'attributes' && m.target?.tagName === 'A') {
                            rewriteAnchor(m.target);
                        }
                    }
                });
                this._linkObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

                this._clickInterceptor = (e) => {
                    if (e.button !== 0 && e.button !== 1) return;
                    const anchor = e.composedPath().find(el => el.tagName === 'A');
                    if (!anchor || !anchor.href) return;
                    const targetHref = toYoutUbeHref(anchor.href);
                    if (!targetHref) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const openNew = e.button === 1 || e.metaKey || e.ctrlKey;
                    if (openNew) GM_openInTab(targetHref, { active: true, insert: true });
                    else location.href = targetHref;
                };
                document.addEventListener('click', this._clickInterceptor, true);
                document.addEventListener('auxclick', this._clickInterceptor, true);

                this._urlChangeListener = () => {
                    if (location.href === this._lastHref) return;
                    this._lastHref = location.href;
                    if (this._timer) clearTimeout(this._timer);
                    this._timer = setTimeout(() => {
                        attemptRedirect();
                        rewriteAllLinks();
                    }, 50);
                };
                window.YTKit.addNavigateRule('yout-ube-redirector', this._urlChangeListener);
            },
            destroy() {
                this._linkObserver?.disconnect();
                this._linkObserver = null;
                if (this._clickInterceptor) {
                    document.removeEventListener('click', this._clickInterceptor, true);
                    document.removeEventListener('auxclick', this._clickInterceptor, true);
                }
                this._clickInterceptor = null;
                window.YTKit.removeNavigateRule('yout-ube-redirector');
                if (this._timer) clearTimeout(this._timer);
            }
        },
        { id: 'yout_ube_redirectShorts', name: 'Redirect Shorts', description: 'Redirects /shorts/ URLs to the standard player.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
        { id: 'yout_ube_redirectEmbed', name: 'Redirect Embeds', description: 'Redirects /embed/ URLs to the standard player.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
        { id: 'yout_ube_redirectNoCookie', name: 'Redirect youtube-nocookie.com', description: 'Redirects videos from the privacy-enhanced domain.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
        { id: 'yout_ube_rewriteLinks', name: 'Rewrite In-Page Links', description: 'Proactively changes video links on the page (e.g., in subscriptions) to point to yout-ube.com.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} }
    ];

	if (typeof window.YTKit !== 'undefined') {
        window.YTKit.YTKitFeatures.modules = moduleFeatures;
	}
})();