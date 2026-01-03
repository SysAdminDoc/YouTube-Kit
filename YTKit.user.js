// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      6.0
// @description  Ultimate YouTube customization. Hide elements, control layout, and enhance your viewing experience with a premium UI.
// @author       Matthew Parker
// @match        https://*.youtube.com/*
// @match        https://*.youtube-nocookie.com/*
// @match        https://youtu.be/*
// @exclude      https://*.youtube.com/embed/*
// @exclude      https://music.youtube.com/*
// @exclude      https://www.youtube.com/shorts/*
// @exclude      https://m.youtube.com/*
// @exclude      https://www.youtube.com/playlist?list=*
// @icon         https://github.com/SysAdminDoc/YTKit/blob/main/assets/ytlogo.png?raw=true
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @grant        GM_notification
// @grant        GM_download
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @connect      sponsor.ajay.app
// @resource     betterDarkMode https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/Themes/youtube-dark-theme.css
// @resource     catppuccinMocha https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/Themes/youtube-catppuccin-theme.css
// @updateURL    https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @downloadURL  https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0: DYNAMIC CONTENT/STYLE ENGINE
    // ══════════════════════════════════════════════════════════════════════════
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

    function waitForElement(selector, callback, timeout = 10000) {
        const intervalTime = 100;
        let elapsedTime = 0;
        const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(interval);
                callback(element);
            }
            elapsedTime += intervalTime;
            if (elapsedTime >= timeout) clearInterval(interval);
        }, intervalTime);
    }

    const runNavigateRules = () => {
        for (const rule of navigateRules.values()) {
            try { rule(document.body); } catch (e) { console.error('[YTKit] Navigate rule error:', e); }
        }
    };

    const ensureNavigateListener = () => {
        if (isNavigateListenerAttached) return;
        window.addEventListener('yt-navigate-finish', runNavigateRules);
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

    const observerCallback = () => runMutationRules(document.body);

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
            // Interface
            hideCreateButton: true,
            hideVoiceSearch: true,
            logoToSubscriptions: true,
            widenSearchBar: true,
            hideSidebar: true,
            // Appearance
            nativeDarkMode: true,
            betterDarkMode: true,
            catppuccinMocha: false,
            squarify: false,
            // Content
            removeAllShorts: true,
            redirectShorts: true,
            disablePlayOnHover: true,
            fullWidthSubscriptions: true,
            hideSubscriptionOptions: true,
            fiveVideosPerRow: true,
            hidePaidContentOverlay: true,
            redirectToVideosTab: true,
            // Video Player Layout
            fitPlayerToWindow: true,
            hideRelatedVideos: true,
            adaptiveLiveLayout: true,
            expandVideoWidth: true,
            floatingLogoOnWatch: true,
            hideDescriptionRow: false,
            // Playback
            preventAutoplay: false,
            autoExpandDescription: false,
            sortCommentsNewestFirst: false,
            // SponsorBlock
            skipSponsors: true,
            hideSponsorBlockLabels: true,
            // Video Quality
            autoMaxResolution: true,
            useEnhancedBitrate: true,
            hideQualityPopup: true,
            // Clutter
            hideMerchShelf: true,
            hideClarifyBoxes: true,
            hideDescriptionExtras: true,
            hideHashtags: true,
            hidePinnedComments: true,
            hideCommentActionMenu: true,
            hideLiveChatEngagement: true,
            hidePaidPromotionWatch: true,
            hideVideoEndCards: true,
            hideVideoEndScreen: true,
            // Live Chat
            hideLiveChatHeader: true,
            hideChatMenu: true,
            hidePopoutChatButton: true,
            hideChatReactionsButton: true,
            hideChatTimestampsButton: true,
            hideChatPolls: true,
            hideChatPollBanner: true,
            hideChatTicker: true,
            hideViewerLeaderboard: true,
            hideChatSupportButtons: true,
            hideChatBanner: true,
            hideChatEmojiButton: true,
            hideTopFanIcons: true,
            hideSuperChats: true,
            hideLevelUp: true,
            hideChatBots: true,
            keywordFilterList: "",
            // Action Buttons
            autolikeVideos: true,
            hideLikeButton: true,
            hideDislikeButton: true,
            hideShareButton: true,
            hideAskButton: true,
            hideClipButton: true,
            hideThanksButton: true,
            hideSaveButton: true,
            replaceWithCobaltDownloader: true,
            hideSponsorButton: true,
            hideMoreActionsButton: true,
            // Player Controls
            hideSponsorBlockButton: true,
            hideNextButton: true,
            hideAutoplayToggle: true,
            hideSubtitlesToggle: true,
            hideCaptionsContainer: true,
            hideMiniplayerButton: true,
            hidePipButton: true,
            hideTheaterButton: true,
            hideFullscreenButton: true,
            // Advanced
            enableAdblock: false,
            enableCPU_Tamer: false,
        },
        async load() {
            let savedSettings = await GM_getValue('ytSuiteSettings', {});
            return { ...this.defaults, ...savedSettings };
        },
        async save(settings) {
            await GM_setValue('ytSuiteSettings', settings);
        },
        async getFirstRunStatus() {
            return await GM_getValue('ytSuiteHasRun', false);
        },
        async setFirstRunStatus(hasRun) {
            await GM_setValue('ytSuiteHasRun', hasRun);
        },
        async exportAllSettings() {
            const settings = await this.load();
            return JSON.stringify(settings, null, 2);
        },
        async importAllSettings(jsonString) {
            try {
                const importedSettings = JSON.parse(jsonString);
                if (typeof importedSettings !== 'object' || importedSettings === null) return false;
                const newSettings = { ...this.defaults, ...importedSettings };
                await this.save(newSettings);
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
    const features = [
        // ─── Interface ───
        {
            id: 'hideCreateButton',
            name: 'Hide Create Button',
            description: 'Remove the "Create" button from the header toolbar',
            group: 'Interface',
            icon: 'plus-circle',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVoiceSearch',
            name: 'Hide Voice Search',
            description: 'Remove the microphone icon from the search bar',
            group: 'Interface',
            icon: 'mic-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('#voice-search-button', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
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
        {
            id: 'widenSearchBar',
            name: 'Widen Search Bar',
            description: 'Expand the search bar to use more available space',
            group: 'Interface',
            icon: 'search',
            _styleElement: null,
            init() {
                const css = `ytd-masthead yt-searchbox { margin-left: -180px; margin-right: -300px; }`;
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
                const appElement = document.querySelector('ytd-app');
                if (appElement) {
                    appElement.removeAttribute('guide-persistent-and-visible');
                    const guideDrawer = appElement.querySelector('tp-yt-app-drawer#guide');
                    if (guideDrawer && guideDrawer.hasAttribute('opened')) {
                        guideDrawer.removeAttribute('opened');
                    }
                }
                const css = `
                    #guide, #guide-button, ytd-mini-guide-renderer, tp-yt-app-drawer:not([persistent]) { display: none !important; }
                    ytd-page-manager { margin-left: 0 !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },

        // ─── Appearance ───
        {
            id: 'nativeDarkMode',
            name: 'Force Dark Theme',
            description: 'Always use YouTube\'s dark theme',
            group: 'Appearance',
            icon: 'moon',
            isParent: true,
            _ruleId: 'nativeDarkModeRule',
            _applyTheme() { document.documentElement.setAttribute('dark', ''); },
            init() {
                this._applyTheme();
                addMutationRule(this._ruleId, this._applyTheme.bind(this));
            },
            destroy() {
                document.documentElement.removeAttribute('dark');
                removeMutationRule(this._ruleId);
            }
        },
        {
            id: 'betterDarkMode',
            name: 'Enhanced Dark Theme',
            description: 'Deeper blacks and better contrast for the dark theme',
            group: 'Appearance',
            icon: 'contrast',
            isSubFeature: true,
            parentId: 'nativeDarkMode',
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('betterDarkMode');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'catppuccinMocha',
            name: 'Catppuccin Mocha',
            description: 'Warm, soothing color palette for a cozy viewing experience',
            group: 'Appearance',
            icon: 'palette',
            isSubFeature: true,
            parentId: 'nativeDarkMode',
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('catppuccinMocha');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'squarify',
            name: 'Square Corners',
            description: 'Remove rounded corners for a sharper aesthetic',
            group: 'Appearance',
            icon: 'square',
            _styleElement: null,
            init() {
                const css = `* { border-radius: 0 !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },

        // ─── Content ───
        {
            id: 'removeAllShorts',
            name: 'Remove Shorts',
            description: 'Hide all Shorts videos from feeds and recommendations',
            group: 'Content',
            icon: 'video-off',
            _styleElement: null,
            init() {
                const removeShortsRule = () => {
                    document.querySelectorAll('a[href^="/shorts"]').forEach(a => {
                        let parent = a.parentElement;
                        while (parent && (!parent.tagName.startsWith('YTD-') || parent.tagName === 'YTD-THUMBNAIL')) {
                            parent = parent.parentElement;
                        }
                        if (parent) parent.style.display = 'none';
                    });
                };
                addMutationRule(this.id, removeShortsRule);
                const css = `
                    ytd-reel-shelf-renderer,
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id + '-style', true);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove();
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
        {
            id: 'disablePlayOnHover',
            name: 'Disable Hover Preview',
            description: 'Stop videos from playing when hovering over thumbnails',
            group: 'Content',
            icon: 'pause',
            _styleElement: null,
            init() {
                const css = `
                    ytd-video-preview, #preview, #mouseover-overlay,
                    ytd-moving-thumbnail-renderer,
                    ytd-thumbnail-overlay-loading-preview-renderer {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'fullWidthSubscriptions',
            name: 'Full-Width Subscriptions',
            description: 'Expand the subscription grid to fill the page',
            group: 'Content',
            icon: 'maximize',
            _styleElement: null,
            init() {
                const css = `
                    ytd-browse[page-subtype="subscriptions"] #grid-container.ytd-two-column-browse-results-renderer {
                        max-width: 100% !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideSubscriptionOptions',
            name: 'Hide Layout Options',
            description: 'Remove the "Latest" header and view toggles on subscriptions',
            group: 'Content',
            icon: 'layout',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(.grid-subheader)', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'fiveVideosPerRow',
            name: '5 Videos Per Row',
            description: 'Display five video thumbnails per row in grids',
            group: 'Content',
            icon: 'grid',
            _styleElement: null,
            init() {
                const css = `#contents.ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: 5 !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePaidContentOverlay',
            name: 'Hide Promotion Badges',
            description: 'Remove "Includes paid promotion" overlays on thumbnails',
            group: 'Content',
            icon: 'badge',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-paid-content-overlay-renderer, ytm-paid-content-overlay-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
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
        {
            id: 'hideRelatedVideos',
            name: 'Hide Sidebar',
            description: 'Remove the related videos panel on watch pages',
            group: 'Video Player',
            icon: 'panel-right',
            isParent: true,
            _styleElement: null,
            init() {
                const css = `ytd-watch-flexy #secondary { display: none !important; } ytd-watch-flexy #primary { max-width: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
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
            name: 'Show Logo on Videos',
            description: 'Display the YouTube logo next to channel info on watch pages',
            group: 'Video Player',
            icon: 'youtube',
            init() { addNavigateRule(this.id, this.handleLogoDisplay.bind(this)); },
            destroy() {
                removeNavigateRule(this.id);
                document.getElementById('yt-suite-watch-logo')?.remove();
            },
            handleLogoDisplay() {
                if (!window.location.pathname.startsWith('/watch')) {
                    document.getElementById('yt-suite-watch-logo')?.remove();
                    return;
                }
                waitForElement('#top-row #owner', (ownerDiv) => {
                    if (document.getElementById('yt-suite-watch-logo')) return;
                    let logoEl = document.createElement('div');
                    logoEl.id = 'yt-suite-watch-logo';
                    const link = document.createElement('a');
                    link.href = '/feed/subscriptions';
                    link.title = 'YouTube Subscriptions';
                    const originalLogo = document.querySelector('ytd-topbar-logo-renderer ytd-logo');
                    if (originalLogo) link.appendChild(originalLogo.cloneNode(true));
                    logoEl.appendChild(link);
                    ownerDiv.prepend(logoEl);
                });
            }
        },
        {
            id: 'hideDescriptionRow',
            name: 'Hide Description',
            description: 'Remove the video description panel below the player',
            group: 'Video Player',
            icon: 'file-minus',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-watch-metadata #bottom-row', this.id); },
            destroy() { this._styleElement?.remove(); }
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

        // ─── SponsorBlock ───
        {
            id: 'skipSponsors',
            name: 'Skip Sponsors',
            description: 'Automatically skip sponsored segments using SponsorBlock',
            group: 'SponsorBlock',
            icon: 'skip-forward',
            isParent: true,
            _video: null,
            _videoID: null,
            _muteEndTime: 0,
            _skipSegments: new Map(),
            _muteSegments: new Map(),
            _poi_listener: null,
            _timeUpdateListener: null,

            init() {
                this._timeUpdateListener = this.skipOrMute.bind(this);
                document.addEventListener("yt-navigate-start", this.reset.bind(this));
                document.addEventListener("yt-navigate-finish", this.setup.bind(this));
                this.setup();
            },
            destroy() {
                document.removeEventListener("yt-navigate-start", this.reset.bind(this));
                document.removeEventListener("yt-navigate-finish", this.setup.bind(this));
                if (this._video && this._timeUpdateListener) {
                    this._video.removeEventListener("timeupdate", this._timeUpdateListener);
                }
                document.querySelectorAll('[id^="sbjs-label-"]').forEach(e => e.remove());
                this.reset();
            },
            setup() {
                const getVideoID = () => new URL(window.location.href).searchParams.get("v");
                if (this._videoID === getVideoID()) return;
                if (document.querySelector("#previewbar")) return;
                this.reset();
                this._video = document.querySelector("video");
                this._videoID = getVideoID();
                this.fetchSegments(this._videoID);
                if (!this._video) return;
                this._video.addEventListener("timeupdate", this._timeUpdateListener);
            },
            reset() {
                if (this._video && this._timeUpdateListener) this._video.removeEventListener("timeupdate", this._timeUpdateListener);
                this._video = null;
                this._videoID = null;
                this._muteEndTime = 0;
                this._skipSegments = new Map();
                this._muteSegments = new Map();
                document.querySelectorAll('[id^="sbjs-label-"]').forEach(e => e.remove());
                if (this._poi_listener) document.removeEventListener("keydown", this._poi_listener);
            },
            fetchSegments(videoID) {
                const categories = ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "music_offtopic", "exclusive_access", "poi_highlight"];
                const actionTypes = ["skip", "mute", "full", "poi"];
                const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoID}&categories=${JSON.stringify(categories)}&actionTypes=${JSON.stringify(actionTypes)}`;
                GM.xmlHttpRequest({
                    method: 'GET',
                    url: url,
                    onload: (response) => {
                        if (response.status !== 200) return;
                        const data = JSON.parse(response.responseText);
                        const convertSegment = s => [s.segment[0], { end: s.segment[1], uuid: s.UUID }];
                        data.forEach(s => {
                            if (s.actionType === "skip") this._skipSegments.set(...convertSegment(s));
                            else if (s.actionType === "mute") this._muteSegments.set(...convertSegment(s));
                            else if (s.actionType === "full") this.createVideoLabel(s);
                            else if (s.actionType === "poi") this.createPOILabel(s);
                        });
                    }
                });
            },
            trackSkip(uuid) {
                GM.xmlHttpRequest({
                    method: 'POST',
                    url: `https://sponsor.ajay.app/api/viewedVideoSponsorTime?UUID=${uuid}`
                });
            },
            skipOrMute() {
                if (!this._video) return;
                const currentTime = this._video.currentTime;
                if (this._video.muted && currentTime >= this._muteEndTime) {
                    this._video.muted = false;
                    this._muteEndTime = 0;
                }
                const skipEnd = this.findEndTime(currentTime, this._skipSegments);
                if (skipEnd) this._video.currentTime = skipEnd;
                const muteEnd = this.findEndTime(currentTime, this._muteSegments);
                if (muteEnd) {
                    this._video.muted = true;
                    this._muteEndTime = muteEnd;
                }
            },
            findEndTime(now, map) {
                const skipThreshold = [0.2, 1];
                let endTime;
                for (const startTime of map.keys()) {
                    if (now + skipThreshold[0] >= startTime && now - startTime <= skipThreshold[1]) {
                        const segment = map.get(startTime);
                        endTime = segment.end;
                        this.trackSkip(segment.uuid);
                        map.delete(startTime);
                        for (const overlapStart of map.keys()) {
                            if (endTime >= overlapStart && overlapStart >= now) {
                                const overSegment = map.get(overlapStart);
                                endTime = overSegment.end;
                                this.trackSkip(overSegment.uuid);
                                map.delete(overlapStart);
                            }
                        }
                        return endTime;
                    }
                }
                return endTime;
            },
            createPOILabel(poiLabel) {
                this.createVideoLabel(poiLabel, "poi");
                const highlightKey = "Enter";
                this._poi_listener = e => {
                    if (e.key === highlightKey) {
                        this._video.currentTime = poiLabel.segment[1];
                        this.trackSkip(poiLabel.UUID);
                        const label = document.querySelector("#sbjs-label-poi");
                        if (label) label.style.display = "none";
                        document.removeEventListener("keydown", this._poi_listener);
                        this._poi_listener = null;
                    }
                };
                document.addEventListener("keydown", this._poi_listener);
            },
            createVideoLabel(videoLabel, type = "full") {
                const check = () => {
                    const title = document.querySelector("#title h1, h1.title.ytd-video-primary-info-renderer");
                    if (title) {
                        const highlightKey = "Enter";
                        const category = videoLabel.category;
                        const fvString = cat => `The entire video is ${cat}`;
                        const styles = {
                            sponsor: ["#0d0", "#111", fvString("sponsor")],
                            selfpromo: ["#ff0", "#111", fvString("selfpromo")],
                            exclusive_access: ["#085", "#fff", "Showcases free/subsidized access"],
                            poi_highlight: ["#f18", "#fff", `Press ${highlightKey} to skip to highlight`],
                        };
                        const style = styles[category] || ["#ccc", "#111", fvString(category)];
                        const label = document.createElement("span");
                        label.title = style[2];
                        label.innerText = category;
                        label.id = `sbjs-label-${type}`;
                        label.style = `color: ${style[1]}; background-color: ${style[0]}; display: flex; margin: 0 5px; padding: 2px 6px; font-size: 12px; font-weight: bold; border-radius: 4px;`;
                        title.style.display = "flex";
                        title.prepend(label);
                    } else {
                        setTimeout(check, 500);
                    }
                };
                check();
            }
        },
        {
            id: 'hideSponsorBlockLabels',
            name: 'Hide SponsorBlock Labels',
            description: 'Hide the category labels added by SponsorBlock',
            group: 'SponsorBlock',
            icon: 'tag-off',
            isSubFeature: true,
            parentId: 'skipSponsors',
            _styleElement: null,
            init() { this._styleElement = injectStyle('[id^="sbjs-label-"]', this.id); },
            destroy() { this._styleElement?.remove(); }
        },

        // ─── Quality ───
        {
            id: 'autoMaxResolution',
            name: 'Auto Max Quality',
            description: 'Automatically select the highest available video quality',
            group: 'Quality',
            icon: 'sparkles',
            isParent: true,
            _lastProcessedVideoId: null,
            _onPlayerUpdated: null,
            _styleElement: null,
            init() {
                this._onPlayerUpdated = (evt) => {
                    const player = evt?.target?.player_ || document.getElementById('movie_player');
                    this.setMaxQuality(player);
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
            setMaxQuality(player) {
                const currentVideoId = (new URLSearchParams(window.location.search)).get('v');
                if (!player || !currentVideoId || currentVideoId === this._lastProcessedVideoId) return;
                if (typeof player.getAvailableQualityLevels !== 'function') return;
                const levels = player.getAvailableQualityLevels();
                if (!levels || !levels.length) return;
                this._lastProcessedVideoId = currentVideoId;
                const best = levels[0];
                try { player.setPlaybackQualityRange(best); } catch (e) { /* ignore */ }
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
        {
            id: 'hideMerchShelf',
            name: 'Hide Merch Shelf',
            description: 'Remove merchandise promotions below videos',
            group: 'Clutter',
            icon: 'shopping-bag',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-merch-shelf-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideClarifyBoxes',
            name: 'Hide Info Cards',
            description: 'Remove "clarification" and "fact check" boxes',
            group: 'Clutter',
            icon: 'info',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-clarification-renderer, .ytp-info-panel-preview', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideDescriptionExtras',
            name: 'Hide Description Extras',
            description: 'Remove extra elements in the description area',
            group: 'Clutter',
            icon: 'file-x',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-video-description-transcript-section-renderer, ytd-structured-description-content-renderer > *:not(ytd-text-inline-expander)', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideHashtags',
            name: 'Hide Hashtags',
            description: 'Remove hashtag links above video titles',
            group: 'Clutter',
            icon: 'hash',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-watch-metadata .super-title, ytd-video-primary-info-renderer .super-title', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePinnedComments',
            name: 'Hide Pinned Comments',
            description: 'Remove pinned comments from the comments section',
            group: 'Clutter',
            icon: 'pin-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-comment-thread-renderer:has(#pinned-comment-badge)', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideCommentActionMenu',
            name: 'Hide Comment Actions',
            description: 'Remove action menu from individual comments',
            group: 'Clutter',
            icon: 'more-horizontal',
            _styleElement: null,
            init() { this._styleElement = injectStyle('#action-menu.ytd-comment-view-model, #action-menu.ytd-comment-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideLiveChatEngagement',
            name: 'Hide Chat Engagement',
            description: 'Remove engagement prompts in live chat',
            group: 'Clutter',
            icon: 'message-circle-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-viewer-engagement-message-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePaidPromotionWatch',
            name: 'Hide Paid Promotion',
            description: 'Remove "paid promotion" labels on watch pages',
            group: 'Clutter',
            icon: 'dollar-sign',
            _styleElement: null,
            init() { this._styleElement = injectStyle('.ytp-paid-content-overlay', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVideoEndCards',
            name: 'Hide End Cards',
            description: 'Remove end-of-video card overlays',
            group: 'Clutter',
            icon: 'square-x',
            _styleElement: null,
            init() { this._styleElement = injectStyle('.ytp-ce-element', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVideoEndScreen',
            name: 'Hide End Screen',
            description: 'Remove the end screen with video suggestions',
            group: 'Clutter',
            icon: 'layout-grid',
            _styleElement: null,
            init() { this._styleElement = injectStyle('.ytp-endscreen-content', this.id); },
            destroy() { this._styleElement?.remove(); }
        },

        // ─── Live Chat ───
        {
            id: 'hideLiveChatHeader',
            name: 'Hide Chat Header',
            description: 'Remove the header bar from live chat',
            group: 'Live Chat',
            icon: 'panel-top',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-header-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatMenu',
            name: 'Hide Chat Menu',
            description: 'Remove the three-dot menu in chat',
            group: 'Live Chat',
            icon: 'menu',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-header-renderer #overflow', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePopoutChatButton',
            name: 'Hide Popout Button',
            description: 'Remove the "pop out chat" button',
            group: 'Live Chat',
            icon: 'external-link',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-header-renderer button[aria-label="Popout chat"]', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatReactionsButton',
            name: 'Hide Reactions',
            description: 'Remove the reactions button from chat',
            group: 'Live Chat',
            icon: 'smile',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-reaction-control-panel-overlay-view-model, yt-reaction-control-panel-view-model', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatTimestampsButton',
            name: 'Hide Timestamps',
            description: 'Remove timestamp toggles from chat',
            group: 'Live Chat',
            icon: 'timer',
            _styleElement: null,
            init() { this._styleElement = injectStyle('#show-hide-button.ytd-live-chat-frame', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatPolls',
            name: 'Hide Polls',
            description: 'Hide poll messages in chat',
            group: 'Live Chat',
            icon: 'bar-chart',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-poll-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatPollBanner',
            name: 'Hide Poll Banner',
            description: 'Hide the poll notification banner',
            group: 'Live Chat',
            icon: 'megaphone-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-banner-manager, yt-live-chat-action-panel-renderer:has(yt-live-chat-poll-renderer)', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatTicker',
            name: 'Hide Super Chat Ticker',
            description: 'Remove the scrolling Super Chat bar',
            group: 'Live Chat',
            icon: 'ticket',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-ticker-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideViewerLeaderboard',
            name: 'Hide Leaderboard',
            description: 'Remove the viewer leaderboard panel',
            group: 'Live Chat',
            icon: 'trophy',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-participant-list-renderer, yt-pdg-buy-flow-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatSupportButtons',
            name: 'Hide Support Buttons',
            description: 'Remove Super Chat and membership buttons',
            group: 'Live Chat',
            icon: 'heart',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-message-buy-flow-renderer, #product-picker, .yt-live-chat-message-input-renderer[id="picker-buttons"]', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatBanner',
            name: 'Hide Chat Banner',
            description: 'Remove announcement banners in chat',
            group: 'Live Chat',
            icon: 'flag-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-banner-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatEmojiButton',
            name: 'Hide Emoji Button',
            description: 'Remove the emoji picker button',
            group: 'Live Chat',
            icon: 'smile-plus',
            _styleElement: null,
            init() { this._styleElement = injectStyle('#emoji-picker-button, yt-live-chat-message-input-renderer #picker-buttons yt-icon-button', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideTopFanIcons',
            name: 'Hide Fan Badges',
            description: 'Remove top fan and membership badges',
            group: 'Live Chat',
            icon: 'award',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-author-badge-renderer[type="member"], yt-live-chat-author-badge-renderer[type="top-gifter"]', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideSuperChats',
            name: 'Hide Super Chats',
            description: 'Remove Super Chat messages from chat',
            group: 'Live Chat',
            icon: 'zap-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideLevelUp',
            name: 'Hide Level Up',
            description: 'Remove "level up" animations and messages',
            group: 'Live Chat',
            icon: 'trending-up',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-viewer-engagement-message-renderer[engagement-type="VIEWER_ENGAGEMENT_MESSAGE_TYPE_LEVEL_UP"]', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideChatBots',
            name: 'Hide Bot Messages',
            description: 'Filter out messages from accounts with "bot" in their name',
            group: 'Live Chat',
            icon: 'bot',
            init() { addMutationRule(this.id, applyBotFilter); },
            destroy() { removeMutationRule(this.id); }
        },
        {
            id: 'keywordFilterList',
            name: 'Keyword Filter',
            description: 'Hide chat messages containing these words (comma-separated)',
            group: 'Live Chat',
            icon: 'filter',
            type: 'textarea',
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
        { id: 'hideLikeButton', name: 'Hide Like Button', description: 'Remove the like button', group: 'Action Buttons', icon: 'thumbs-up', _styleElement: null, init() { this._styleElement = injectStyle('ytd-segmented-like-dislike-button-renderer like-button-view-model, #segmented-like-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideDislikeButton', name: 'Hide Dislike Button', description: 'Remove the dislike button', group: 'Action Buttons', icon: 'thumbs-down', _styleElement: null, init() { this._styleElement = injectStyle('ytd-segmented-like-dislike-button-renderer dislike-button-view-model, #segmented-dislike-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideShareButton', name: 'Hide Share Button', description: 'Remove the share button', group: 'Action Buttons', icon: 'share', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Share"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Share"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideAskButton', name: 'Hide AI Button', description: 'Remove the AI chat button', group: 'Action Buttons', icon: 'message-square', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label*="AI"]), conversational-ui-watch-metadata-button-view-model', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideClipButton', name: 'Hide Clip Button', description: 'Remove the clip button', group: 'Action Buttons', icon: 'scissors', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Clip"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Clip"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideThanksButton', name: 'Hide Thanks Button', description: 'Remove the thanks/super thanks button', group: 'Action Buttons', icon: 'gift', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Thanks"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Thanks"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSaveButton', name: 'Hide Save Button', description: 'Remove the save to playlist button', group: 'Action Buttons', icon: 'bookmark', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Save to playlist"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Save"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'replaceWithCobaltDownloader',
            name: 'Cobalt Download Button',
            description: 'Add a download button using Cobalt.tools',
            group: 'Action Buttons',
            icon: 'download',
            _styleElement: null,
            _getFrontendUrl() { return `https://cobalt.meowing.de/#`; },
            _isWatchPage() { return window.location.pathname.startsWith('/watch'); },
            _injectButton() {
                if (!this._isWatchPage()) return;
                waitForElement('#actions-inner #end-buttons, #top-level-buttons-computed', (parent) => {
                    if (document.querySelector('button[id^="cobaltBtn"]')) return;
                    const id = 'cobaltBtn' + Math.random().toString(36).substr(2, 5);
                    const btn = document.createElement('button');
                    btn.id = id;
                    btn.textContent = 'Download';
                    btn.setAttribute('aria-label', 'Download video');
                    btn.style.cssText = `font-size:14px;padding:6px 12px;margin-left:8px;border-radius:20px;border:2px solid #ff5722;background:transparent;color:#ff5722;cursor:pointer;transition:background .2s,color .2s;`;
                    btn.onmouseenter = () => { btn.style.background = '#ff5722'; btn.style.color = '#fff'; };
                    btn.onmouseleave = () => { btn.style.background = 'transparent'; btn.style.color = '#ff5722'; };
                    btn.addEventListener('click', () => {
                        const videoUrl = window.location.href;
                        const cobaltUrl = this._getFrontendUrl() + encodeURIComponent(videoUrl);
                        window.open(cobaltUrl, '_blank');
                    });
                    parent.appendChild(btn);
                });
            },
            init() {
                this._styleElement = injectStyle('ytd-download-button-renderer', 'hideNativeDownload');
                addNavigateRule('cobaltDownloader', this._injectButton.bind(this));
            },
            destroy() {
                removeNavigateRule('cobaltDownloader');
                document.querySelector('button[id^="cobaltBtn"]')?.remove();
                this._styleElement?.remove();
            }
        },
        { id: 'hideSponsorButton', name: 'Hide Join Button', description: 'Remove the channel membership button', group: 'Action Buttons', icon: 'users', _styleElement: null, init() { this._styleElement = injectStyle('#sponsor-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMoreActionsButton', name: 'Hide More Actions', description: 'Remove the three-dot menu button', group: 'Action Buttons', icon: 'more-vertical', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner #button-shape > button[aria-label="More actions"]', this.id); }, destroy() { this._styleElement?.remove(); }},

        // ─── Player Controls ───
        { id: 'hideSponsorBlockButton', name: 'Hide SponsorBlock Button', description: 'Remove the SponsorBlock button from controls', group: 'Player Controls', icon: 'shield-off', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-sb-button, .ytp-sponsorblock-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideNextButton', name: 'Hide Next Button', description: 'Remove the next video button', group: 'Player Controls', icon: 'skip-forward', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-next-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideAutoplayToggle', name: 'Hide Autoplay Toggle', description: 'Remove the autoplay switch', group: 'Player Controls', icon: 'repeat', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-autonav-toggle-button-container', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSubtitlesToggle', name: 'Hide Subtitles Button', description: 'Remove the closed captions button', group: 'Player Controls', icon: 'captions-off', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-subtitles-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideCaptionsContainer', name: 'Hide Captions', description: 'Hide on-screen captions entirely', group: 'Player Controls', icon: 'subtitles', _styleElement: null, init() { this._styleElement = injectStyle('.caption-window', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMiniplayerButton', name: 'Hide Miniplayer Button', description: 'Remove the miniplayer button', group: 'Player Controls', icon: 'pip', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-miniplayer-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hidePipButton', name: 'Hide PiP Button', description: 'Remove the picture-in-picture button', group: 'Player Controls', icon: 'picture-in-picture', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-pip-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideTheaterButton', name: 'Hide Theater Button', description: 'Remove the theater mode button', group: 'Player Controls', icon: 'monitor', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-size-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideFullscreenButton', name: 'Hide Fullscreen Button', description: 'Remove the fullscreen button', group: 'Player Controls', icon: 'maximize', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-fullscreen-button', this.id); }, destroy() { this._styleElement?.remove(); }},

        // ─── Advanced ───
        {
            id: 'enableAdblock',
            name: 'Block Ads',
            description: 'Attempt to skip or block YouTube advertisements',
            group: 'Advanced',
            icon: 'shield',
            _styleElement: null,
            init() {
                const adRule = () => {
                    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern');
                    if (skipBtn) skipBtn.click();
                    const video = document.querySelector('video');
                    if (video && document.querySelector('.ad-showing')) {
                        video.currentTime = video.duration || 0;
                        video.playbackRate = 16;
                    }
                };
                addMutationRule(this.id, adRule);
                const css = `.ytp-ad-overlay-container, .ytp-ad-text-overlay, ytd-ad-slot-renderer, ytd-rich-item-renderer:has(ytd-ad-slot-renderer), ytd-in-feed-ad-layout-renderer { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() {
                removeMutationRule(this.id);
                this._styleElement?.remove();
            }
        },
        {
            id: 'enableCPU_Tamer',
            name: 'CPU Tamer',
            description: 'Reduce CPU usage by throttling background timers',
            group: 'Advanced',
            icon: 'cpu',
            _originals: {},
            init() {
                if (window.yt_cpu_tamer_by_animationframe === true) return;
                window.yt_cpu_tamer_by_animationframe = true;
                ((win) => {
                    const { setTimeout, setInterval, clearTimeout, clearInterval } = win;
                    this._originals = { setTimeout, setInterval, clearTimeout, clearInterval };
                    let afInterruptHandler = null;
                    const timeupdateDT = (() => {
                        let dt = Date.now();
                        document.addEventListener('timeupdate', () => { dt = Date.now(); }, true);
                        return () => dt;
                    })();
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
    ];

    function injectStyle(selector, featureId, isRawCss = false) {
        const style = document.createElement('style');
        style.id = `yt-suite-style-${featureId}`;
        style.textContent = isRawCss ? selector : `${selector} { display: none !important; }`;
        document.head.appendChild(style);
        return style;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 3: HELPERS
    // ══════════════════════════════════════════════════════════════════════════
    let appState = {};

    function applyBotFilter() {
        if (!window.location.pathname.startsWith('/watch')) return;
        const messages = document.querySelectorAll('yt-live-chat-text-message-renderer:not(.yt-suite-hidden-bot)');
        messages.forEach(msg => {
            const authorName = msg.querySelector('#author-name')?.textContent.toLowerCase() || '';
            if (authorName.includes('bot')) {
                msg.style.display = 'none';
                msg.classList.add('yt-suite-hidden-bot');
            }
        });
    }

    function applyKeywordFilter() {
        if (!window.location.pathname.startsWith('/watch')) return;
        const keywordsRaw = appState.settings.keywordFilterList;
        const messages = document.querySelectorAll('yt-live-chat-text-message-renderer');
        if (!keywordsRaw || !keywordsRaw.trim()) {
            messages.forEach(el => {
                if (el.classList.contains('yt-suite-hidden-keyword')) {
                    el.style.display = '';
                    el.classList.remove('yt-suite-hidden-keyword');
                }
            });
            return;
        }
        const keywords = keywordsRaw.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        messages.forEach(msg => {
            const messageText = msg.querySelector('#message')?.textContent.toLowerCase() || '';
            const authorText = msg.querySelector('#author-name')?.textContent.toLowerCase() || '';
            const shouldHide = keywords.some(k => messageText.includes(k) || authorText.includes(k));
            if (shouldHide) {
                msg.style.display = 'none';
                msg.classList.add('yt-suite-hidden-keyword');
            } else if (msg.classList.contains('yt-suite-hidden-keyword')) {
                msg.style.display = '';
                msg.classList.remove('yt-suite-hidden-keyword');
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
    };

    const CATEGORY_CONFIG = {
        'Interface': { icon: 'interface', color: '#60a5fa' },
        'Appearance': { icon: 'appearance', color: '#f472b6' },
        'Content': { icon: 'content', color: '#34d399' },
        'Video Player': { icon: 'player', color: '#a78bfa' },
        'Playback': { icon: 'playback', color: '#fb923c' },
        'SponsorBlock': { icon: 'sponsor', color: '#22d3ee' },
        'Quality': { icon: 'quality', color: '#facc15' },
        'Clutter': { icon: 'clutter', color: '#f87171' },
        'Live Chat': { icon: 'livechat', color: '#4ade80' },
        'Action Buttons': { icon: 'actions', color: '#c084fc' },
        'Player Controls': { icon: 'controls', color: '#38bdf8' },
        'Advanced': { icon: 'advanced', color: '#fb7185' },
    };

    function injectSettingsButton() {
        const handleDisplay = () => {
            document.getElementById('ytkit-masthead-btn')?.remove();
            document.getElementById('ytkit-watch-btn')?.remove();

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

        const categoryOrder = ['Interface', 'Appearance', 'Content', 'Video Player', 'Playback', 'SponsorBlock', 'Quality', 'Clutter', 'Live Chat', 'Action Buttons', 'Player Controls', 'Advanced'];
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

        categoryOrder.forEach((cat, index) => {
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

        categoryOrder.forEach((cat, index) => {
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

            toggleAllSwitch.appendChild(toggleAllInput);
            toggleAllSwitch.appendChild(toggleAllTrack);
            toggleAllLabel.appendChild(toggleAllText);
            toggleAllLabel.appendChild(toggleAllSwitch);

            paneHeader.appendChild(paneTitle);
            paneHeader.appendChild(toggleAllLabel);
            pane.appendChild(paneHeader);

            // Features grid
            const grid = document.createElement('div');
            grid.className = 'ytkit-features-grid';

            const parentFeatures = categoryFeatures.filter(f => !f.isSubFeature);
            const subFeatures = categoryFeatures.filter(f => f.isSubFeature);

            parentFeatures.forEach(f => {
                const card = buildFeatureCard(f, config.color);
                grid.appendChild(card);

                // Add sub-features if any
                const children = subFeatures.filter(sf => sf.parentId === f.id);
                if (children.length > 0) {
                    const subContainer = document.createElement('div');
                    subContainer.className = 'ytkit-sub-features';
                    subContainer.dataset.parentId = f.id;
                    if (!appState.settings[f.id]) subContainer.style.display = 'none';
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

        const versionSpan = document.createElement('span');
        versionSpan.className = 'ytkit-version';
        versionSpan.textContent = 'v6.0';

        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'ytkit-shortcut';
        shortcutSpan.textContent = 'Ctrl+Alt+Y';

        footerLeft.appendChild(githubLink);
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
        card.className = 'ytkit-feature-card' + (isSubFeature ? ' ytkit-sub-card' : '') + (f.type === 'textarea' ? ' ytkit-textarea-card' : '');
        card.dataset.featureId = f.id;

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

        if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.className = 'ytkit-input';
            textarea.id = `ytkit-input-${f.id}`;
            textarea.placeholder = 'word1, word2, phrase';
            textarea.value = appState.settings[f.id] || '';
            card.appendChild(textarea);
        } else {
            const isEnabled = appState.settings[f.id];
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
        document.querySelector('.ytkit-toast')?.remove();
        const toast = document.createElement('div');
        toast.className = `ytkit-toast ytkit-toast-${type}`;
        const span = document.createElement('span');
        span.textContent = message;
        toast.appendChild(span);
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('show'));
        });
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, duration);
    }

    function updateAllToggleStates() {
        document.querySelectorAll('.ytkit-toggle-all-cb').forEach(cb => {
            const catId = cb.dataset.category;
            const pane = document.getElementById(`ytkit-pane-${catId}`);
            if (!pane) return;
            const featureToggles = pane.querySelectorAll('.ytkit-feature-cb');
            const allChecked = featureToggles.length > 0 && Array.from(featureToggles).every(t => t.checked);
            cb.checked = allChecked;
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
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
                doc.querySelector(`#ytkit-pane-${navBtn.dataset.tab}`)?.classList.add('active');
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

        // Feature toggles
        doc.addEventListener('change', async (e) => {
            if (e.target.matches('.ytkit-feature-cb')) {
                const card = e.target.closest('[data-feature-id]');
                const featureId = card.dataset.featureId;
                const isEnabled = e.target.checked;

                // Update switch visual
                const switchEl = e.target.closest('.ytkit-switch');
                if (switchEl) switchEl.classList.toggle('active', isEnabled);

                appState.settings[featureId] = isEnabled;
                await settingsManager.save(appState.settings);

                const feature = features.find(f => f.id === featureId);
                if (feature) {
                    isEnabled ? feature.init?.() : feature.destroy?.();
                }

                // Toggle sub-features visibility
                const subContainer = doc.querySelector(`.ytkit-sub-features[data-parent-id="${featureId}"]`);
                if (subContainer) {
                    subContainer.style.display = isEnabled ? '' : 'none';
                }

                updateAllToggleStates();
            }

            // Toggle all
            if (e.target.matches('.ytkit-toggle-all-cb')) {
                const isEnabled = e.target.checked;
                const catId = e.target.dataset.category;
                const pane = doc.getElementById(`ytkit-pane-${catId}`);
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
        doc.addEventListener('input', async (e) => {
            if (e.target.matches('.ytkit-input')) {
                const card = e.target.closest('[data-feature-id]');
                const featureId = card.dataset.featureId;
                appState.settings[featureId] = e.target.value;
                await settingsManager.save(appState.settings);
                const feature = features.find(f => f.id === featureId);
                if (feature) {
                    feature.destroy?.();
                    feature.init?.();
                }
            }
        });

        // Import/Export
        doc.addEventListener('click', async (e) => {
            if (e.target.closest('#ytkit-export')) {
                const configString = await settingsManager.exportAllSettings();
                handleFileExport('ytkit_settings.json', configString);
                createToast('Settings exported successfully', 'success');
            }
            if (e.target.closest('#ytkit-import')) {
                handleFileImport(async (content) => {
                    const success = await settingsManager.importAllSettings(content);
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
@keyframes ytkit-fade-in {
    from { opacity: 0; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
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
        `);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 6: BOOTSTRAP
    // ══════════════════════════════════════════════════════════════════════════
    async function main() {
        appState.settings = await settingsManager.load();

        injectPanelStyles();
        buildSettingsPanel();
        injectSettingsButton();
        attachUIEventListeners();
        updateAllToggleStates();

        features.forEach(f => {
            if (appState.settings[f.id]) {
                try {
                    f.init?.();
                } catch (error) {
                    console.error(`[YTKit] Error initializing "${f.id}":`, error);
                }
            }
        });

        // Show sub-features for enabled parents
        document.querySelectorAll('.ytkit-sub-features').forEach(container => {
            const parentId = container.dataset.parentId;
            if (appState.settings[parentId]) {
                container.style.display = '';
            }
        });

        const hasRun = await settingsManager.getFirstRunStatus();
        if (!hasRun) {
            document.body.classList.add('ytkit-panel-open');
            await settingsManager.setFirstRunStatus(true);
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }
})();
