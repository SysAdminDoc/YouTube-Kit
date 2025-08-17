// YTKit Integrated Modules
(function() {
    'use strict';
    if (!window.YTKit) { window.YTKit = {}; }

    const integratedModules = [
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
                    // ... (Full CPU Tamer logic)
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
                // ... (Full Handle Revealer logic)
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
                // ... (Full Redirector logic)
            },
            destroy() {
                this._linkObserver?.disconnect();
                this._linkObserver = null;
                if (this._clickInterceptor) {
                    document.removeEventListener('click', this._clickInterceptor, true);
                    document.removeEventListener('auxclick', this._clickInterceptor, true);
                }
                this._clickInterceptor = null;
                removeNavigateRule('yout-ube-redirector');
                if (this._timer) clearTimeout(this._timer);
            }
        },
        { id: 'yout_ube_redirectShorts', name: 'Redirect Shorts', description: 'Redirects /shorts/ URLs to the standard player.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
        { id: 'yout_ube_redirectEmbed', name: 'Redirect Embeds', description: 'Redirects /embed/ URLs to the standard player.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
        { id: 'yout_ube_redirectNoCookie', name: 'Redirect youtube-nocookie.com', description: 'Redirects videos from the privacy-enhanced domain.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
        { id: 'yout_ube_rewriteLinks', name: 'Rewrite In-Page Links', description: 'Proactively changes video links on the page (e.g., in subscriptions) to point to yout-ube.com.', group: 'Modules', isSubFeature: true, init() {}, destroy() {} },
    ];

    window.YTKit.registerFeatures(integratedModules);

})();
