// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      9.3
// @description  Ultimate YouTube customization with VLC streaming, video/channel hiding with bulk hide support, playback enhancements, Return YouTube Dislike, and more.
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
// @connect      returnyoutubedislikeapi.com
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

    // Global toast notification function
    function showToast(message, color = '#22c55e') {
        const toast = document.createElement('div');
        toast.textContent = message;
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
            animation: ytkit-toast-fade 2.5s ease-out forwards;
        `;

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
        setTimeout(() => toast.remove(), 2500);
    }

    // Aggressive button injection system with MutationObserver
    const persistentButtons = new Map(); // id -> { parentSelector, checkSelector, injectFn }
    let buttonObserver = null;
    let buttonCheckInterval = null;
    let buttonCheckStarted = false;

    function registerPersistentButton(id, parentSelector, checkSelector, injectFn) {
        persistentButtons.set(id, { parentSelector, checkSelector, injectFn });
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

    // Track recently injected buttons to prevent re-injection loops
    const recentlyInjected = new Map(); // id -> timestamp

    function tryInjectButton(id) {
        if (!window.location.pathname.startsWith('/watch')) return false;

        const config = persistentButtons.get(id);
        if (!config) return false;

        // Check if we recently injected this button (within last 2 seconds)
        const lastInjected = recentlyInjected.get(id);
        if (lastInjected && Date.now() - lastInjected < 2000) {
            return true; // Skip, we just injected this
        }

        // Check if button exists AND is in a valid container
        const existingBtn = document.querySelector(config.checkSelector);
        if (existingBtn) {
            // Verify it's actually in the action buttons area
            const parent = existingBtn.closest('#top-level-buttons-computed, .ytkit-button-container');
            if (parent) {
                return true; // Button exists and is in correct container
            } else {
                // Button exists but is detached - remove it so we can re-add
                existingBtn.remove();
            }
        }

        // Try MANY possible parent selectors - YouTube changes these frequently
        const parentSelectors = [
            '#top-level-buttons-computed',
            'ytd-watch-metadata #top-level-buttons-computed',
            'ytd-menu-renderer #top-level-buttons-computed',
            '#actions #top-level-buttons-computed',
            '#actions-inner #top-level-buttons-computed',
            '#actions ytd-menu-renderer #top-level-buttons-computed',
            '#actions-inner #menu #top-level-buttons-computed',
            'ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed',
            '#below ytd-watch-metadata #top-level-buttons-computed',
            '#actions #menu',
            '#actions-inner #menu',
            'ytd-watch-metadata #actions #menu',
            '#actions ytd-menu-renderer',
            '#actions-inner ytd-menu-renderer',
            'ytd-watch-metadata #actions-inner',
            '#owner #actions',
            '#above-the-fold #top-level-buttons-computed',
            '#above-the-fold #actions ytd-menu-renderer',
            'ytd-watch-metadata ytd-menu-renderer',
            '#below #actions',
        ];

        let parent = null;
        let foundSelector = null;
        for (const sel of parentSelectors) {
            try {
                parent = document.querySelector(sel);
                if (parent) {
                    foundSelector = sel;
                    break;
                }
            } catch (e) {
                // Invalid selector, skip
            }
        }

        // Also check if our fallback container exists
        if (!parent) {
            parent = document.querySelector('.ytkit-button-container');
            if (parent) {
                foundSelector = '.ytkit-button-container (existing)';
            }
        }

        if (!parent) {
            // Ultimate fallback: create our own button container near the video title
            const titleArea = document.querySelector('#above-the-fold #title, ytd-watch-metadata #title, #info-contents #container');
            if (titleArea) {
                const container = document.createElement('div');
                container.className = 'ytkit-button-container';
                container.style.cssText = 'display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;';
                titleArea.parentElement?.insertBefore(container, titleArea.nextSibling);
                parent = container;
                foundSelector = '.ytkit-button-container (created)';
            }
        }

        if (!parent) {
            return false;
        }

        try {
            config.injectFn(parent);
            recentlyInjected.set(id, Date.now()); // Track injection time
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

        // Check if video changed - if so, clear injection tracking
        const currentVideoId = new URLSearchParams(window.location.search).get('v');
        if (currentVideoId && currentVideoId !== lastVideoId) {
            lastVideoId = currentVideoId;
            recentlyInjected.clear(); // Allow fresh injection for new video
        }

        // Skip if we have no buttons to inject
        if (persistentButtons.size === 0) {
            return;
        }

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
        const MIN_CHECK_INTERVAL = 500; // Don't check more than once per 500ms

        // MutationObserver to detect when button container appears OR buttons are removed
        if (!buttonObserver) {
            buttonObserver = new MutationObserver((mutations) => {
                // Skip if we checked very recently
                if (Date.now() - lastCheckTime < MIN_CHECK_INTERVAL) return;

                let needsRecheck = false;

                for (const m of mutations) {
                    // Check for added containers
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

                    // Check for removed YTKit buttons (with proper grouping)
                    if (m.type === 'childList' && m.removedNodes.length > 0) {
                        for (const node of m.removedNodes) {
                            if (node.nodeType === 1 && node.classList && (
                                node.classList.contains('ytkit-vlc-btn') ||
                                node.classList.contains('ytkit-local-dl-btn') ||
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

                // Debounce: wait 300ms for mutations to settle before checking
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

        // Initial checks - staggered
        checkAllButtons();
        setTimeout(checkAllButtons, 500);
        setTimeout(checkAllButtons, 1500);
        setTimeout(checkAllButtons, 3000);

        // Less aggressive backup - every 3 seconds
        buttonCheckInterval = setInterval(checkAllButtons, 3000);
    }

    function stopButtonChecker() {
        if (buttonObserver) {
            buttonObserver.disconnect();
            buttonObserver = null;
        }
        if (buttonCheckInterval) {
            clearInterval(buttonCheckInterval);
            buttonCheckInterval = null;
        }
        buttonCheckStarted = false;
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
        navigateDebounceTimer = setTimeout(runNavigateRules, 50);
    };

    const ensureNavigateListener = () => {
        if (isNavigateListenerAttached) return;

        // Method 1: yt-navigate-finish event (SPA navigation)
        window.addEventListener('yt-navigate-finish', debouncedRunNavigateRules);

        // Method 2: yt-page-data-updated event (data loaded)
        window.addEventListener('yt-page-data-updated', debouncedRunNavigateRules);

        // Method 3: popstate for browser back/forward
        window.addEventListener('popstate', debouncedRunNavigateRules);

        // Method 4: MutationObserver on ytd-app and ytd-watch-flexy
        const pageObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                // Check for video-id changes or page-subtype changes
                if (m.type === 'attributes' &&
                    (m.attributeName === 'video-id' ||
                     m.attributeName === 'page-subtype' ||
                     m.attributeName === 'player-state')) {
                    debouncedRunNavigateRules();
                    return;
                }
                // Check for added nodes that indicate page change
                if (m.type === 'childList' && m.addedNodes.length > 0) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === 1 &&
                            (node.tagName === 'YTD-WATCH-FLEXY' ||
                             node.id === 'movie_player' ||
                             node.id === 'top-level-buttons-computed')) {
                            debouncedRunNavigateRules();
                            return;
                        }
                    }
                }
            }
        });

        // Observe document body for major changes
        pageObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['video-id', 'page-subtype', 'player-state', 'hidden']
        });

        // Method 5: Interval check for initial load (fallback)
        let checkCount = 0;
        const maxChecks = 20;
        const initialLoadCheck = setInterval(() => {
            checkCount++;
            runNavigateRules();
            if (checkCount >= maxChecks) {
                clearInterval(initialLoadCheck);
            }
        }, 500);

        // Also run immediately
        runNavigateRules();

        isNavigateListenerAttached = true;
        console.log('[YTKit] Navigation listeners attached');
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
            hideNotificationButton: false,
            hideNotificationBadge: false,
            squareSearchBar: false,
            // Appearance
            nativeDarkMode: true,
            betterDarkMode: true,
            catppuccinMocha: false,
            squarify: false,
            squareAvatars: false,
            noAmbientMode: false,
            noFrostedGlass: false,
            compactLayout: false,
            // Content
            removeAllShorts: true,
            redirectShorts: true,
            disablePlayOnHover: true,
            fullWidthSubscriptions: true,
            hideSubscriptionOptions: true,
            fiveVideosPerRow: true,
            hidePaidContentOverlay: true,
            redirectToVideosTab: true,
            hidePlayables: false,
            hideMembersOnly: false,
            hideNewsHome: false,
            hidePlaylistsHome: false,
            // Video Hider (Enhanced)
            hideVideosFromHome: true,
            hideVideosBlockChannels: true,
            hideVideosKeywordFilter: '',
            hideVideosDurationFilter: 0,
            hideVideosBlockedChannels: [],
            hideVideosSubsLoadLimit: true,
            hideVideosSubsLoadThreshold: 3,
            // Video Player Layout
            fitPlayerToWindow: true,
            hideRelatedVideos: true,
            adaptiveLiveLayout: true,
            expandVideoWidth: true,
            floatingLogoOnWatch: true,
            hideDescriptionRow: false,
            autoTheaterMode: false,
            persistentProgressBar: false,
            // Playback
            preventAutoplay: false,
            autoExpandDescription: false,
            sortCommentsNewestFirst: false,
            autoOpenChapters: false,
            autoOpenTranscript: false,
            chronologicalNotifications: false,
            // Playback Enhancements
            playbackSpeedPresets: true,
            defaultPlaybackSpeed: 1,
            rememberPlaybackSpeed: false,
            channelPlaybackSpeeds: {},
            returnYouTubeDislike: true,
            showWatchProgress: true,
            timestampBookmarks: true,
            autoSkipIntroOutro: false,
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
            condenseComments: true,
            hideLiveChatEngagement: true,
            hidePaidPromotionWatch: true,
            hideVideoEndCards: true,
            hideVideoEndScreen: true,
            hideEndVideoStills: true,
            hideInfoPanel: false,
            hideFundraiser: false,
            hideLatestPosts: false,
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
            // Downloads (YouTube Tools Integration)
            showVlcButton: true,
            showVlcQueueButton: false,
            showLocalDownloadButton: true,
            showTranscriptButton: true,
            showMpvButton: false,
            showDownloadPlayButton: false,
            subsVlcPlaylist: true,
            enableEmbedPlayer: false,
            autoEmbedOnVisit: false,
            videoContextMenu: true,
            autoDownloadOnVisit: false,
            downloadQuality: '1080',
            preferredMediaPlayer: 'vlc',
            // Advanced
            downloadProvider: 'cobalt',
            hideCollaborations: false,
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
            // Include hidden videos and blocked channels in export
            let hiddenVideos = [];
            let blockedChannels = [];
            try {
                hiddenVideos = GM_getValue('ytkit-hidden-videos', []);
                blockedChannels = GM_getValue('ytkit-blocked-channels', []);
            } catch(e) {
                try {
                    const hv = localStorage.getItem('ytkit-hidden-videos');
                    const bc = localStorage.getItem('ytkit-blocked-channels');
                    hiddenVideos = hv ? JSON.parse(hv) : [];
                    blockedChannels = bc ? JSON.parse(bc) : [];
                } catch(e2) {}
            }
            const exportData = {
                settings: settings,
                hiddenVideos: hiddenVideos,
                blockedChannels: blockedChannels,
                exportVersion: 2,
                exportDate: new Date().toISOString()
            };
            return JSON.stringify(exportData, null, 2);
        },
        async importAllSettings(jsonString) {
            try {
                const importedData = JSON.parse(jsonString);
                if (typeof importedData !== 'object' || importedData === null) return false;

                // Handle both old format (just settings) and new format (with hidden videos)
                let settings, hiddenVideos, blockedChannels;
                if (importedData.exportVersion >= 2) {
                    // New format with hidden videos
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                } else {
                    // Old format - just settings object
                    settings = importedData;
                    hiddenVideos = null;
                    blockedChannels = null;
                }

                const newSettings = { ...this.defaults, ...settings };
                await this.save(newSettings);

                // Import hidden videos and blocked channels if present
                if (hiddenVideos !== null) {
                    try {
                        GM_setValue('ytkit-hidden-videos', hiddenVideos);
                    } catch(e) {
                        localStorage.setItem('ytkit-hidden-videos', JSON.stringify(hiddenVideos));
                    }
                }
                if (blockedChannels !== null) {
                    try {
                        GM_setValue('ytkit-blocked-channels', blockedChannels);
                    } catch(e) {
                        localStorage.setItem('ytkit-blocked-channels', JSON.stringify(blockedChannels));
                    }
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
        {
            id: 'hideNotificationButton',
            name: 'Hide Notification Bell',
            description: 'Remove the notification bell icon from the header',
            group: 'Interface',
            icon: 'bell-off',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-masthead ytd-notification-topbar-button-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideNotificationBadge',
            name: 'Hide Notification Badge',
            description: 'Hide the red notification count badge',
            group: 'Interface',
            icon: 'bell-minus',
            _styleElement: null,
            init() {
                const css = `ytd-notification-topbar-button-renderer .yt-spec-icon-badge-shape__badge { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'squareSearchBar',
            name: 'Square Search Bar',
            description: 'Remove rounded corners from the search bar',
            group: 'Interface',
            icon: 'search',
            _styleElement: null,
            init() {
                const css = `
                    ytd-searchbox #container.ytd-searchbox,
                    ytd-searchbox #container.ytd-searchbox input#search,
                    #search-icon-legacy { border-radius: 0 !important; }
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
        {
            id: 'squareAvatars',
            name: 'Square Avatars',
            description: 'Make channel avatars square instead of round',
            group: 'Appearance',
            icon: 'user-square',
            _styleElement: null,
            init() {
                const css = `
                    yt-img-shadow, #avatar-link, #author-thumbnail,
                    ytd-channel-avatar-editor img, yt-img-shadow img,
                    .yt-spec-avatar-shape--circle { border-radius: 0 !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'noAmbientMode',
            name: 'Disable Ambient Mode',
            description: 'Turn off the glowing background effect that matches video colors',
            group: 'Appearance',
            icon: 'sun-dim',
            _styleElement: null,
            init() {
                const css = `
                    #cinematics, #cinematics-container,
                    .ytp-autonav-endscreen-upnext-cinematics,
                    #player-container.ytd-watch-flexy::before { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'noFrostedGlass',
            name: 'Disable Frosted Glass',
            description: 'Remove blur effects from UI elements',
            group: 'Appearance',
            icon: 'droplet-off',
            _styleElement: null,
            init() {
                const css = `
                    * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'compactLayout',
            name: 'Compact Layout',
            description: 'Reduce spacing and padding for a denser interface',
            group: 'Appearance',
            icon: 'minimize',
            _styleElement: null,
            init() {
                const css = `
                    ytd-rich-grid-renderer { --ytd-rich-grid-row-padding: 0 !important; }
                    ytd-rich-item-renderer { margin-bottom: 8px !important; }
                    #contents.ytd-rich-grid-renderer { padding-top: 8px !important; }
                    ytd-two-column-browse-results-renderer { padding: 8px !important; }
                    ytd-watch-flexy[flexy] #primary.ytd-watch-flexy { padding-top: 0 !important; }
                `;
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
        {
            id: 'hidePlayables',
            name: 'Hide Playables',
            description: 'Hide YouTube Playables gaming content from feeds',
            group: 'Content',
            icon: 'gamepad',
            _styleElement: null,
            init() {
                const css = `ytd-rich-section-renderer:has([is-playables]) { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideMembersOnly',
            name: 'Hide Members Only',
            description: 'Hide members-only content from channels',
            group: 'Content',
            icon: 'lock',
            _styleElement: null,
            init() {
                const css = `
                    ytd-badge-supported-renderer:has([aria-label*="Members only"]),
                    ytd-rich-item-renderer:has([aria-label*="Members only"]),
                    ytd-video-renderer:has([aria-label*="Members only"]) { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideNewsHome',
            name: 'Hide News Section',
            description: 'Hide news sections from the homepage',
            group: 'Content',
            icon: 'newspaper',
            _styleElement: null,
            init() {
                const css = `
                    ytd-rich-section-renderer:has([is-news]),
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[type="news"]) { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePlaylistsHome',
            name: 'Hide Playlist Shelves',
            description: 'Hide playlist sections from the homepage',
            group: 'Content',
            icon: 'list-x',
            _styleElement: null,
            init() {
                const css = `
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-playlist]),
                    ytd-rich-section-renderer:has([is-mixes]) { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
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

                // Hide the continuation spinner/trigger to prevent more loading
                const continuations = document.querySelectorAll('ytd-continuation-item-renderer, #continuations, ytd-browse[page-subtype="subscriptions"] ytd-continuation-item-renderer');
                continuations.forEach(cont => {
                    cont.style.display = 'none';
                    cont.dataset.ytkitBlocked = 'true';
                });

                // Create info banner
                this._showLoadBlockedBanner();
                console.log('[YTKit] Subscription loading blocked - too many consecutive hidden batches');
            },

            _removeLoadBlocker() {
                this._subsLoadState.loadingBlocked = false;
                // Restore continuation elements
                document.querySelectorAll('[data-ytkit-blocked="true"]').forEach(el => {
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
                icon.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

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
                    console.log(`[YTKit] Subs load: batch ${this._subsLoadState.consecutiveHiddenBatches}/${threshold} all hidden (${hiddenCount}/${batchSize})`);

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
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '14');
                svg.setAttribute('height', '14');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathD);
                svg.appendChild(path);
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
                let toast = document.getElementById('ytkit-hide-toast');
                if (!toast) {
                    toast = document.createElement('div');
                    toast.id = 'ytkit-hide-toast';
                    document.body.appendChild(toast);
                }
                toast.textContent = '';
                const span = document.createElement('span');
                span.textContent = message;
                toast.appendChild(span);
                buttons.forEach(b => {
                    const btn = document.createElement('button');
                    btn.textContent = b.text;
                    btn.addEventListener('click', b.onClick);
                    toast.appendChild(btn);
                });
                if (this._toastTimeout) clearTimeout(this._toastTimeout);
                requestAnimationFrame(() => toast.classList.add('show'));
                this._toastTimeout = setTimeout(() => toast.classList.remove('show'), 5000);
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

            _showManager() {
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
                let manager = document.getElementById('ytkit-hide-manager');
                if (manager) { manager.classList.add('show'); return; }

                const overlay = document.createElement('div');
                overlay.id = 'ytkit-hide-manager-overlay';
                overlay.addEventListener('click', () => this._closeManager());

                manager = document.createElement('div');
                manager.id = 'ytkit-hide-manager';

                const header = document.createElement('div');
                header.className = 'ytkit-hm-header';
                const title = document.createElement('h3');
                title.textContent = 'Hidden Videos Manager';
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '×';
                closeBtn.onclick = () => this._closeManager();
                header.appendChild(title);
                header.appendChild(closeBtn);

                const tabs = document.createElement('div');
                tabs.className = 'ytkit-hm-tabs';
                ['Videos', 'Channels', 'Keywords', 'Settings'].forEach((t, i) => {
                    const tab = document.createElement('button');
                    tab.textContent = t;
                    tab.className = i === 0 ? 'active' : '';
                    tab.onclick = () => this._switchManagerTab(t.toLowerCase());
                    tabs.appendChild(tab);
                });

                const content = document.createElement('div');
                content.className = 'ytkit-hm-content';
                content.id = 'ytkit-hm-content';

                manager.appendChild(header);
                manager.appendChild(tabs);
                manager.appendChild(content);
                document.body.appendChild(overlay);
                document.body.appendChild(manager);
                this._switchManagerTab('videos');
                requestAnimationFrame(() => { overlay.classList.add('show'); manager.classList.add('show'); });
            },

            _closeManager() {
                document.getElementById('ytkit-hide-manager-overlay')?.classList.remove('show');
                document.getElementById('ytkit-hide-manager')?.classList.remove('show');
            },

            _switchManagerTab(tab) {
                const content = document.getElementById('ytkit-hm-content');
                if (!content) return;
                content.textContent = '';
                document.querySelectorAll('.ytkit-hm-tabs button').forEach((b, i) => {
                    b.className = ['videos', 'channels', 'keywords', 'settings'][i] === tab ? 'active' : '';
                });

                if (tab === 'videos') {
                    const videos = this._getHiddenVideos();
                    if (videos.length === 0) {
                        const empty = document.createElement('p');
                        empty.className = 'ytkit-hm-empty';
                        empty.textContent = 'No hidden videos yet. Click X on thumbnails to hide videos.';
                        content.appendChild(empty);
                    } else {
                        const list = document.createElement('div');
                        list.className = 'ytkit-hm-list';
                        videos.forEach(vid => {
                            const item = document.createElement('div');
                            item.className = 'ytkit-hm-item';
                            const thumb = document.createElement('img');
                            thumb.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
                            thumb.onerror = () => { thumb.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' };
                            const info = document.createElement('div');
                            info.className = 'ytkit-hm-info';
                            const vidId = document.createElement('span');
                            vidId.textContent = vid;
                            const link = document.createElement('a');
                            link.href = `https://youtube.com/watch?v=${vid}`;
                            link.target = '_blank';
                            link.textContent = 'View →';
                            info.appendChild(vidId);
                            info.appendChild(link);
                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unhide';
                            removeBtn.onclick = () => {
                                const h = this._getHiddenVideos();
                                const idx = h.indexOf(vid);
                                if (idx > -1) { h.splice(idx, 1); this._setHiddenVideos(h); }
                                item.remove();
                                this._processAllVideos();
                            };
                            item.appendChild(thumb);
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            list.appendChild(item);
                        });
                        const clearBtn = document.createElement('button');
                        clearBtn.className = 'ytkit-hm-clear';
                        clearBtn.textContent = `Clear All (${videos.length})`;
                        clearBtn.onclick = () => {
                            if (confirm('Unhide all videos?')) { this._setHiddenVideos([]); this._processAllVideos(); this._switchManagerTab('videos'); }
                        };
                        content.appendChild(list);
                        content.appendChild(clearBtn);
                    }
                } else if (tab === 'channels') {
                    const channels = this._getBlockedChannels();
                    if (channels.length === 0) {
                        const empty = document.createElement('p');
                        empty.className = 'ytkit-hm-empty';
                        empty.textContent = 'No blocked channels. Right-click X button to block a channel.';
                        content.appendChild(empty);
                    } else {
                        const list = document.createElement('div');
                        list.className = 'ytkit-hm-list';
                        channels.forEach(ch => {
                            const item = document.createElement('div');
                            item.className = 'ytkit-hm-item ytkit-hm-channel';
                            const info = document.createElement('div');
                            info.className = 'ytkit-hm-info';
                            const name = document.createElement('span');
                            name.textContent = ch.name || ch.id;
                            const id = document.createElement('small');
                            id.textContent = ch.id;
                            info.appendChild(name);
                            info.appendChild(id);
                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unblock';
                            removeBtn.onclick = () => {
                                const c = this._getBlockedChannels();
                                const idx = c.findIndex(x => x.id === ch.id);
                                if (idx > -1) { c.splice(idx, 1); this._setBlockedChannels(c); }
                                item.remove();
                                this._processAllVideos();
                            };
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            list.appendChild(item);
                        });
                        content.appendChild(list);
                    }
                } else if (tab === 'keywords') {
                    const kwLabel = document.createElement('label');
                    kwLabel.textContent = 'Auto-hide videos with these words in title (comma-separated):';
                    const kwInput = document.createElement('textarea');
                    kwInput.className = 'ytkit-hm-textarea';
                    kwInput.placeholder = 'reaction, unboxing, shorts';
                    kwInput.value = appState.settings.hideVideosKeywordFilter || '';
                    kwInput.onchange = async () => {
                        appState.settings.hideVideosKeywordFilter = kwInput.value;
                        await settingsManager.save(appState.settings);
                        this._processAllVideos();
                    };
                    content.appendChild(kwLabel);
                    content.appendChild(kwInput);
                } else if (tab === 'settings') {
                    const durLabel = document.createElement('label');
                    durLabel.textContent = 'Auto-hide videos shorter than (minutes, 0 = disabled):';
                    const durInput = document.createElement('input');
                    durInput.type = 'number';
                    durInput.min = '0';
                    durInput.max = '60';
                    durInput.value = appState.settings.hideVideosDurationFilter || 0;
                    durInput.onchange = async () => {
                        appState.settings.hideVideosDurationFilter = parseInt(durInput.value) || 0;
                        await settingsManager.save(appState.settings);
                        this._processAllVideos();
                    };
                    content.appendChild(durLabel);
                    content.appendChild(durInput);

                    // Subscription Load Limiter Section
                    const limiterSection = document.createElement('div');
                    limiterSection.style.cssText = 'margin-top: 20px; padding-top: 16px; border-top: 1px solid #444;';

                    const limiterTitle = document.createElement('div');
                    limiterTitle.style.cssText = 'color: #fff; font-size: 14px; font-weight: 600; margin-bottom: 12px;';
                    limiterTitle.textContent = 'Subscription Page Load Limiter';
                    limiterSection.appendChild(limiterTitle);

                    const limiterDesc = document.createElement('div');
                    limiterDesc.style.cssText = 'color: #888; font-size: 12px; margin-bottom: 12px;';
                    limiterDesc.textContent = 'Prevents infinite scrolling when many consecutive videos are hidden. Useful if you\'ve hidden years of videos.';
                    limiterSection.appendChild(limiterDesc);

                    const limiterToggleContainer = document.createElement('div');
                    limiterToggleContainer.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 12px;';

                    const limiterCheckbox = document.createElement('input');
                    limiterCheckbox.type = 'checkbox';
                    limiterCheckbox.id = 'ytkit-subs-load-limit';
                    limiterCheckbox.checked = appState.settings.hideVideosSubsLoadLimit !== false;
                    limiterCheckbox.style.cssText = 'width: 18px; height: 18px; accent-color: #3ea6ff;';
                    limiterCheckbox.onchange = async () => {
                        appState.settings.hideVideosSubsLoadLimit = limiterCheckbox.checked;
                        await settingsManager.save(appState.settings);
                    };

                    const limiterCheckboxLabel = document.createElement('label');
                    limiterCheckboxLabel.htmlFor = 'ytkit-subs-load-limit';
                    limiterCheckboxLabel.style.cssText = 'color: #ccc; font-size: 13px; cursor: pointer;';
                    limiterCheckboxLabel.textContent = 'Enable load limiter on subscriptions page';

                    limiterToggleContainer.appendChild(limiterCheckbox);
                    limiterToggleContainer.appendChild(limiterCheckboxLabel);
                    limiterSection.appendChild(limiterToggleContainer);

                    const thresholdLabel = document.createElement('label');
                    thresholdLabel.style.cssText = 'color: #ccc; font-size: 13px; display: block; margin-bottom: 8px;';
                    thresholdLabel.textContent = 'Stop loading after consecutive hidden batches:';

                    const thresholdInput = document.createElement('input');
                    thresholdInput.type = 'number';
                    thresholdInput.min = '1';
                    thresholdInput.max = '20';
                    thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold || 3;
                    thresholdInput.style.cssText = 'width: 80px; padding: 8px; background: #2a2a2a; border: 1px solid #444; border-radius: 4px; color: #fff;';
                    thresholdInput.onchange = async () => {
                        appState.settings.hideVideosSubsLoadThreshold = Math.max(1, Math.min(20, parseInt(thresholdInput.value) || 3));
                        thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold;
                        await settingsManager.save(appState.settings);
                    };

                    const thresholdHint = document.createElement('div');
                    thresholdHint.style.cssText = 'color: #666; font-size: 11px; margin-top: 4px;';
                    thresholdHint.textContent = 'Lower = stops faster, Higher = loads more before stopping (1-20)';

                    limiterSection.appendChild(thresholdLabel);
                    limiterSection.appendChild(thresholdInput);
                    limiterSection.appendChild(thresholdHint);
                    content.appendChild(limiterSection);

                    const stats = document.createElement('div');
                    stats.className = 'ytkit-hm-stats';
                    stats.textContent = `Stats: ${this._getHiddenVideos().length} hidden videos, ${this._getBlockedChannels().length} blocked channels`;
                    content.appendChild(stats);
                }
            },

            _shouldHide(element) {
                const videoId = this._extractVideoId(element);
                if (videoId && this._getHiddenVideos().includes(videoId)) return true;
                const channelInfo = this._extractChannelInfo(element);
                if (channelInfo && this._getBlockedChannels().find(c => c.id === channelInfo.id)) return true;
                const keywords = (appState.settings.hideVideosKeywordFilter || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
                if (keywords.length > 0) {
                    const title = this._extractTitle(element);
                    if (keywords.some(k => title.includes(k))) return true;
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
                    #ytkit-hide-manager-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99998;opacity:0;transition:opacity 0.3s;pointer-events:none; }
                    #ytkit-hide-manager-overlay.show { opacity:1;pointer-events:auto; }
                    #ytkit-hide-manager { position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.9);background:#212121;border-radius:12px;width:90%;max-width:600px;max-height:80vh;z-index:99999;opacity:0;transition:all 0.3s;display:flex;flex-direction:column;overflow:hidden; }
                    #ytkit-hide-manager.show { opacity:1;transform:translate(-50%,-50%) scale(1); }
                    .ytkit-hm-header { display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #333; }
                    .ytkit-hm-header h3 { margin:0;color:#fff;font-size:18px; }
                    .ytkit-hm-header button { background:none;border:none;color:#aaa;font-size:24px;cursor:pointer;padding:0 8px; }
                    .ytkit-hm-tabs { display:flex;border-bottom:1px solid #333; }
                    .ytkit-hm-tabs button { flex:1;padding:12px;background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;transition:all 0.2s; }
                    .ytkit-hm-tabs button.active { color:#fff;background:#333; }
                    .ytkit-hm-content { padding:20px;overflow-y:auto;flex:1; }
                    .ytkit-hm-empty { color:#888;text-align:center;padding:40px; }
                    .ytkit-hm-list { display:flex;flex-direction:column;gap:8px; }
                    .ytkit-hm-item { display:flex;align-items:center;gap:12px;padding:8px;background:#2a2a2a;border-radius:8px; }
                    .ytkit-hm-item img { width:80px;height:45px;object-fit:cover;border-radius:4px; }
                    .ytkit-hm-info { flex:1;display:flex;flex-direction:column;gap:4px; }
                    .ytkit-hm-info span { color:#fff;font-size:13px; }
                    .ytkit-hm-info small { color:#888;font-size:11px; }
                    .ytkit-hm-info a { color:#3ea6ff;font-size:12px;text-decoration:none; }
                    .ytkit-hm-item button { padding:6px 12px;background:#333;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:12px; }
                    .ytkit-hm-item button:hover { background:#c00; }
                    .ytkit-hm-clear { margin-top:16px;padding:10px;width:100%;background:#c00;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:14px; }
                    .ytkit-hm-textarea { width:100%;min-height:100px;margin-top:8px;padding:12px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:13px;resize:vertical; }
                    .ytkit-hm-content label { color:#ccc;font-size:13px; }
                    .ytkit-hm-content input[type="number"] { width:80px;margin:8px 0 16px;padding:8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#fff; }
                    .ytkit-hm-stats { margin-top:20px;padding:12px;background:#2a2a2a;border-radius:8px;color:#888;font-size:12px; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                this._processAllVideos();
                const selectors = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer';

                // Debounce for batch tracking
                let batchBuffer = [];
                let batchTimeout = null;

                const processBatch = () => {
                    if (batchBuffer.length > 0) {
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
                const checkSubsPage = () => {
                    if (window.location.pathname === '/feed/subscriptions') {
                        // Reset load state when entering subscriptions page
                        this._resetSubsLoadState();
                        setTimeout(() => this._createSubsHideAllButton(), 1000);
                    } else {
                        this._removeSubsHideAllButton();
                        this._removeLoadBlocker();
                    }
                };

                addNavigateRule('hideVideosFromHomeNav', () => {
                    setTimeout(() => this._processAllVideos(), 500);
                    checkSubsPage();
                });

                // Initial check for subscriptions page
                checkSubsPage();

                console.log('[YTKit] Video Hider initialized:', this._getHiddenVideos().length, 'videos,', this._getBlockedChannels().length, 'channels');
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
        {
            id: 'autoTheaterMode',
            name: 'Auto Theater Mode',
            description: 'Automatically enter theater mode on video pages',
            group: 'Video Player',
            icon: 'tv',
            init() {
                const enableTheater = () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    setTimeout(() => {
                        const watchFlexy = document.querySelector('ytd-watch-flexy');
                        if (watchFlexy && !watchFlexy.hasAttribute('theater')) {
                            document.querySelector('button.ytp-size-button')?.click();
                        }
                    }, 300);
                };
                addNavigateRule(this.id, enableTheater);
            },
            destroy() { removeNavigateRule(this.id); }
        },
        {
            id: 'persistentProgressBar',
            name: 'Always Show Progress Bar',
            description: 'Keep the video progress bar visible at all times',
            group: 'Video Player',
            icon: 'align-horizontal-justify-center',
            _styleElement: null,
            init() {
                const css = `
                    .ytp-chrome-bottom { opacity: 1 !important; }
                    .ytp-autohide .ytp-chrome-bottom { opacity: 1 !important; visibility: visible !important; }
                    .ytp-autohide .ytp-progress-bar-container { bottom: 0 !important; opacity: 1 !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
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
        {
            id: 'returnYouTubeDislike',
            name: 'Return YouTube Dislike',
            description: 'Show dislike counts using the Return YouTube Dislike API',
            group: 'Playback',
            icon: 'thumbs-down',
            _styleElement: null,
            _lastVideoId: null,

            async _fetchDislikes(videoId) {
                return new Promise((resolve) => {
                    GM.xmlHttpRequest({
                        method: 'GET',
                        url: `https://returnyoutubedislikeapi.com/votes?videoId=${videoId}`,
                        headers: { Accept: 'application/json' },
                        onload: (response) => {
                            if (response.status === 200) {
                                try { resolve(JSON.parse(response.responseText)); }
                                catch { resolve(null); }
                            } else { resolve(null); }
                        },
                        onerror: () => resolve(null)
                    });
                });
            },

            _formatNumber(num) {
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
                return num.toString();
            },

            async _updateDislikeCount() {
                if (!window.location.pathname.startsWith('/watch')) return;
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId || videoId === this._lastVideoId) return;
                this._lastVideoId = videoId;

                const data = await this._fetchDislikes(videoId);
                if (!data || typeof data.dislikes !== 'number') return;

                const dislikeBtn = document.querySelector('ytd-menu-renderer button[aria-label*="islike"], dislike-button-view-model button, ytd-toggle-button-renderer:has([aria-label*="islike"])');
                if (!dislikeBtn) return;

                let countEl = document.querySelector('.ytkit-dislike-count');
                if (!countEl) {
                    countEl = document.createElement('span');
                    countEl.className = 'ytkit-dislike-count';
                    const container = dislikeBtn.closest('ytd-toggle-button-renderer, dislike-button-view-model, ytd-segmented-like-dislike-button-view-model');
                    if (container) container.appendChild(countEl);
                }
                countEl.textContent = this._formatNumber(data.dislikes);
            },

            init() {
                const css = `
                    .ytkit-dislike-count { margin-left:6px;font-size:14px;color:#aaa;font-weight:500; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                addNavigateRule(this.id, () => {
                    this._lastVideoId = null;
                    setTimeout(() => this._updateDislikeCount(), 1500);
                });
                setTimeout(() => this._updateDislikeCount(), 1500);
            },

            destroy() {
                this._styleElement?.remove();
                removeNavigateRule(this.id);
                document.querySelector('.ytkit-dislike-count')?.remove();
            }
        },
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
                this._observer = new MutationObserver(() => this._showProgressBars());
                this._observer.observe(document.body, { childList: true, subtree: true });
                addNavigateRule(this.id, () => { this._trackProgress(); this._showProgressBars(); });
            },

            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                removeNavigateRule(this.id);
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
            _categories: ["sponsor", "selfpromo", "exclusive_access", "interaction", "outro", "music_offtopic"],
            _categoryColors: {
                sponsor: "#00d400",
                selfpromo: "#ffff00",
                exclusive_access: "#008a5c",
                interaction: "#cc00ff",
                outro: "#0202ed",
                music_offtopic: "#ff9900"
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
                                console.log(`[YTKit SponsorBlock] Skipping ${seg.category} segment`);
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
                container.style.cssText = "position:absolute;width:100%;height:100%;padding:0;margin:0;overflow:visible;pointer-events:none;z-index:42;list-style:none;transform:scaleY(0.6);transition:transform 0.1s cubic-bezier(0, 0, 0.2, 1);";
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
                    bar.style.cssText = `position:absolute;height:100%;min-width:1px;display:inline-block;opacity:0.7;left:${startPercent}%;right:${100 - endPercent}%;background-color:${this._categoryColors[segment.category] || "#888"};`;
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
                        console.log(`[YTKit SponsorBlock] Found ${this._state.segments.length} segments`);
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
                const check = () => {
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
                console.log(`[YTKit SponsorBlock] Video changed to: ${newVideoID}`);
                this._reset();
                this._state.videoID = newVideoID;
                let attempts = 0;
                const checkVideo = setInterval(() => {
                    attempts++;
                    const video = document.querySelector("video");
                    if (video) {
                        clearInterval(checkVideo);
                        this._state.video = video;
                        video.addEventListener("play", () => this._startRAFSkipLoop());
                        video.addEventListener("pause", () => this._stopRAFSkipLoop());
                        video.addEventListener("seeked", () => { this._state.lastSkippedUUID = null; });
                        this._loadSegmentsAndSetup();
                    } else if (attempts >= 50) {
                        clearInterval(checkVideo);
                    }
                }, 100);
            },

            init() {
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
        {
            id: 'hideSponsorBlockLabels',
            name: 'Hide SponsorBlock Labels',
            description: 'Hide the category labels added by SponsorBlock',
            group: 'SponsorBlock',
            icon: 'tag-off',
            isSubFeature: true,
            parentId: 'skipSponsors',
            _styleElement: null,
            init() { this._styleElement = injectStyle('[id^="ytkit-sb-label-"]', this.id); },
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
            init() {
                const css = `
                    ytd-comment-thread-renderer:has(ytd-pinned-comment-badge-renderer) { display: none !important; }
                    ytd-pinned-comment-badge-renderer { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
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
            id: 'condenseComments',
            name: 'Condense Comments',
            description: 'Reduce spacing between comments for a tighter layout',
            group: 'Clutter',
            icon: 'minimize-2',
            _styleElement: null,
            init() {
                const css = `
                    ytd-comment-thread-renderer.style-scope.ytd-item-section-renderer {
                        margin-top: 5px !important;
                        margin-bottom: 1px !important;
                    }
                    ytd-comment-thread-renderer.style-scope.ytd-comment-replies-renderer {
                        padding-top: 0px !important;
                        padding-bottom: 0px !important;
                        margin-top: 0px !important;
                        margin-bottom: 0px !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
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
        {
            id: 'hideEndVideoStills',
            name: 'Hide End Video Grid',
            description: 'Remove the fullscreen video grid that appears when a video ends',
            group: 'Clutter',
            icon: 'grid-3x3',
            _styleElement: null,
            init() {
                const css = `div.ytp-fullscreen-grid-stills-container { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideInfoPanel',
            name: 'Hide Info Panels',
            description: 'Remove info cards and panels below videos',
            group: 'Clutter',
            icon: 'info',
            _styleElement: null,
            init() {
                const css = `
                    ytd-info-panel-content-renderer,
                    ytd-info-panel-container-renderer,
                    ytd-clarification-renderer { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideFundraiser',
            name: 'Hide Fundraisers',
            description: 'Remove fundraiser and donation badges',
            group: 'Clutter',
            icon: 'heart-off',
            _styleElement: null,
            init() {
                const css = `
                    ytd-donation-shelf-renderer,
                    ytd-button-renderer[button-next]:has([aria-label*="Donate"]),
                    .ytp-donation-shelf { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideLatestPosts',
            name: 'Hide Latest Posts',
            description: 'Remove community posts and updates sections',
            group: 'Clutter',
            icon: 'message-square-off',
            _styleElement: null,
            init() {
                const css = `
                    ytd-post-renderer,
                    ytd-backstage-post-thread-renderer,
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[type="posts"]) { display: none !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
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
        { id: 'hideAskButton', name: 'Hide Ask Button', description: 'Remove the AI Ask button', group: 'Action Buttons', icon: 'message-square', _styleElement: null, init() { this._styleElement = injectStyle('#flexible-item-buttons yt-button-view-model:has(button[aria-label="Ask"]), ytd-watch-metadata button-view-model:has(button[aria-label*="AI"]), ytd-watch-metadata button-view-model:has(button[aria-label="Ask"]), conversational-ui-watch-metadata-button-view-model', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideClipButton', name: 'Hide Clip Button', description: 'Remove the clip button', group: 'Action Buttons', icon: 'scissors', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Clip"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Clip"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideThanksButton', name: 'Hide Thanks Button', description: 'Remove the thanks/super thanks button', group: 'Action Buttons', icon: 'gift', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Thanks"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Thanks"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSaveButton', name: 'Hide Save Button', description: 'Remove the save to playlist button', group: 'Action Buttons', icon: 'bookmark', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata button-view-model:has(button[aria-label="Save to playlist"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Save"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'replaceWithCobaltDownloader',
            name: 'Download Button',
            description: 'Add a download button using your chosen provider',
            group: 'Action Buttons',
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
        {
            id: 'downloadProvider',
            name: 'Download Provider',
            description: 'Choose which service to use for video downloads',
            group: 'Downloads',
            icon: 'download-cloud',
            type: 'select',
            options: {
                'cobalt': 'Cobalt (cobalt.tools)',
                'y2mate': 'Y2Mate',
                'savefrom': 'SaveFrom.net',
                'ssyoutube': 'SSYouTube'
            },
            _providers: {
                'cobalt': 'https://cobalt.tools/#',
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
                    console.log('[YTKit] Hiding collaboration from:', title);
                    cardNode.remove();
                }
            },

            async init() {
                if (window.location.pathname !== '/feed/subscriptions') return;
                if (!this._initialized) {
                    this._subscriptions = await this._fetchSubscriptions();
                    this._initialized = true;
                    console.log(`[YTKit] Loaded ${this._subscriptions.length} subscriptions`);
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

        // ─── Downloads (YouTube Tools Integration) ───
        {
            id: 'youtubeToolsInfo',
            name: '📦 YouTube Tools Setup',
            description: 'VLC/MPV streaming, local downloads, and the Embed Player require the YouTube Tools helper. Click the orange/green button in the footer to download the installer. The embed server starts automatically on boot.',
            group: 'Downloads',
            icon: 'info',
            type: 'info',
            init() {},
            destroy() {}
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
                btn.title = 'Stream in VLC Player (requires YouTube Tools)';
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
                btn.title = 'Add to VLC Queue (requires YouTube Tools)';
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
                btn.title = 'Download to PC (requires YouTube Tools)';
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
            id: 'showTranscriptButton',
            name: 'Download Transcript Button',
            description: 'Add button to download video transcript/captions as a text file',
            group: 'Downloads',
            icon: 'file-text',

            async _downloadTranscript() {
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId) {
                    showToast('❌ No video ID found', '#ef4444');
                    return;
                }

                showToast('📝 Fetching transcript...', '#3b82f6');

                try {
                    let playerResponse = null;

                    // Method 1: Try window.ytInitialPlayerResponse (only works on fresh load)
                    if (window.ytInitialPlayerResponse &&
                        window.ytInitialPlayerResponse.videoDetails &&
                        window.ytInitialPlayerResponse.videoDetails.videoId === videoId) {
                        playerResponse = window.ytInitialPlayerResponse;
                    }

                    // Method 2: Fetch fresh data if the variable is stale (SPA navigation)
                    if (!playerResponse) {
                        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
                        const html = await response.text();
                        // Extract the player response JSON from the HTML
                        const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
                        if (match && match[1]) {
                            playerResponse = JSON.parse(match[1]);
                        }
                    }

                    if (!playerResponse || !playerResponse.captions) {
                        showToast('❌ No transcript available for this video', '#ef4444');
                        return;
                    }

                    // Navigate the JSON object to find caption tracks
                    const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (!captionTracks || captionTracks.length === 0) {
                        showToast('❌ No transcript tracks found', '#ef4444');
                        return;
                    }

                    // Get first available track (usually auto-generated or primary language)
                    const trackUrl = captionTracks[0].baseUrl;
                    const videoTitle = (playerResponse.videoDetails?.title || videoId)
                        .replace(/[^a-z0-9]/gi, '_')
                        .toLowerCase()
                        .substring(0, 50);

                    // Fetch the XML transcript
                    const transcriptResponse = await fetch(trackUrl);
                    const transcriptXml = await transcriptResponse.text();

                    // Parse XML to text
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(transcriptXml, 'text/xml');
                    const textElements = xmlDoc.getElementsByTagName('text');

                    let transcript = '';
                    for (let i = 0; i < textElements.length; i++) {
                        const node = textElements[i];
                        const startSeconds = parseFloat(node.getAttribute('start'));
                        const text = node.textContent
                            .replace(/&#39;/g, "'")
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>');

                        // Format time as HH:MM:SS
                        const date = new Date(0);
                        date.setSeconds(startSeconds);
                        const timestamp = date.toISOString().substring(11, 19);

                        transcript += `[${timestamp}] ${text}\n`;
                    }

                    // Download as text file
                    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${videoTitle}_transcript.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    showToast('✅ Transcript downloaded!', '#22c55e');

                } catch (e) {
                    console.error('[YTKit] Transcript download error:', e);
                    showToast('❌ Failed to download transcript', '#ef4444');
                }
            },

            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-transcript-btn';
                btn.title = 'Download Transcript';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'white');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                // File-text icon
                const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path1.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
                const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', '14 2 14 8 20 8');
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '16'); line1.setAttribute('y1', '13');
                line1.setAttribute('x2', '8'); line1.setAttribute('y2', '13');
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '16'); line2.setAttribute('y1', '17');
                line2.setAttribute('x2', '8'); line2.setAttribute('y2', '17');
                svg.appendChild(path1);
                svg.appendChild(polyline);
                svg.appendChild(line1);
                svg.appendChild(line2);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' CC'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#3b82f6;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#2563eb'; };
                btn.onmouseleave = () => { btn.style.background = '#3b82f6'; };
                btn.addEventListener('click', () => this._downloadTranscript());
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('transcriptButton', '#top-level-buttons-computed', '.ytkit-transcript-btn', this._createButton.bind(this));
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('transcriptButton');
                document.querySelector('.ytkit-transcript-btn')?.remove();
            }
        },
        {
            id: 'showMpvButton',
            name: 'MPV Player Button',
            description: 'Add button to stream video in MPV player (for advanced users)',
            group: 'Downloads',
            icon: 'clapperboard',
            _createButton(parent) {
                const btn = document.createElement('button');
                btn.className = 'ytkit-mpv-btn';
                btn.title = 'Stream in MPV Player';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M4 8V4h16v4M12 4v16M8 20h8');
                path.setAttribute('stroke', 'white');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('fill', 'none');
                svg.appendChild(path);
                btn.appendChild(svg);
                btn.appendChild(document.createTextNode(' MPV'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#8b5cf6;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { btn.style.background = '#7c3aed'; };
                btn.onmouseleave = () => { btn.style.background = '#8b5cf6'; };
                btn.addEventListener('click', () => {
                    showToast('🎬 Sending to MPV...', '#8b5cf6');
                    window.location.href = 'ytmpv://' + encodeURIComponent(window.location.href);
                });
                parent.appendChild(btn);
            },
            init() {
                registerPersistentButton('mpvButton', '#top-level-buttons-computed', '.ytkit-mpv-btn', this._createButton.bind(this));
                startButtonChecker();
            },
            destroy() {
                unregisterPersistentButton('mpvButton');
                document.querySelector('.ytkit-mpv-btn')?.remove();
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
                    console.log('[YTKit] Auto-downloading:', videoUrl);
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
                document.addEventListener('yt-navigate-finish', checkAndCreate);
                checkAndCreate();

                // Re-apply marks when new content loads
                const observer = new MutationObserver(() => {
                    if (window.location.pathname === '/feed/subscriptions') {
                        this._applyQueuedMarks();
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                this._observer = observer;
            },

            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                document.querySelector('.ytkit-subs-vlc-btn')?.remove();
                document.querySelector('.ytkit-subs-clear-btn')?.remove();
                document.querySelectorAll('.ytkit-queued-badge').forEach(el => el.remove());
            }
        },
        {
            id: 'enableEmbedPlayer',
            name: 'Embed Player (Beta)',
            description: 'Replace YouTube player with custom HTML5 player. Requires YouTube Tools server running.',
            group: 'Downloads',
            icon: 'monitor-play',
            _serverPort: 9547,
            _player: null,
            _audioElement: null,
            _sponsorSegments: [],
            _skipTimer: null,
            _keyboardHandler: null,
            _styleElement: null,
            _isActive: false,
            _persistenceObserver: null,
            _persistenceInterval: null,

            async _checkServer() {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const response = await fetch(`http://localhost:${this._serverPort}/status`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    const data = await response.json();
                    return data.success;
                } catch {
                    return false;
                }
            },

            async _getStreamUrls(videoId) {
                try {
                    const response = await fetch(`http://localhost:${this._serverPort}/stream?id=${videoId}`);
                    return await response.json();
                } catch (e) {
                    console.error('[YTKit Embed] Failed to get stream URLs:', e);
                    return null;
                }
            },

            async _getSponsorSegments(videoId) {
                try {
                    const response = await fetch(`http://localhost:${this._serverPort}/sponsorblock?id=${videoId}`);
                    const data = await response.json();
                    return data.success ? data.segments : [];
                } catch {
                    return [];
                }
            },

            _injectStyles() {
                if (this._styleElement) return;

                this._styleElement = document.createElement('style');
                this._styleElement.id = 'ytkit-embed-styles';
                this._styleElement.textContent = `
                    /* Embed player inherits all sizing from #movie_player */
                    #movie_player.ytkit-embed-active {
                        position: relative !important;
                    }

                    /* NUCLEAR OPTION: Hide ALL YouTube player internals */
                    #movie_player.ytkit-embed-active > *:not(.ytkit-embed-video):not(.ytkit-embed-overlay):not(.ytkit-embed-audio) {
                        display: none !important;
                        visibility: hidden !important;
                        opacity: 0 !important;
                        pointer-events: none !important;
                        z-index: -1 !important;
                    }

                    /* Explicit hide for major containers */
                    #movie_player.ytkit-embed-active .html5-video-container,
                    #movie_player.ytkit-embed-active .html5-video-player,
                    #movie_player.ytkit-embed-active video.html5-main-video,
                    #movie_player.ytkit-embed-active .ytp-chrome-bottom,
                    #movie_player.ytkit-embed-active .ytp-chrome-top,
                    #movie_player.ytkit-embed-active .ytp-chrome-controls,
                    #movie_player.ytkit-embed-active .ytp-gradient-bottom,
                    #movie_player.ytkit-embed-active .ytp-gradient-top,
                    #movie_player.ytkit-embed-active .ytp-progress-bar-container,
                    #movie_player.ytkit-embed-active .ytp-progress-bar,
                    #movie_player.ytkit-embed-active .ytp-time-display,
                    #movie_player.ytkit-embed-active .ytp-left-controls,
                    #movie_player.ytkit-embed-active .ytp-right-controls,
                    #movie_player.ytkit-embed-active .ytp-spinner,
                    #movie_player.ytkit-embed-active .ytp-spinner-container,
                    #movie_player.ytkit-embed-active .ytp-cued-thumbnail-overlay,
                    #movie_player.ytkit-embed-active .ytp-pause-overlay,
                    #movie_player.ytkit-embed-active .ytp-player-content,
                    #movie_player.ytkit-embed-active .ytp-iv-player-content,
                    #movie_player.ytkit-embed-active .ytp-ce-element,
                    #movie_player.ytkit-embed-active .ytp-ce-covering-overlay,
                    #movie_player.ytkit-embed-active .ytp-endscreen-content,
                    #movie_player.ytkit-embed-active .ytp-title,
                    #movie_player.ytkit-embed-active .ytp-title-text,
                    #movie_player.ytkit-embed-active .ytp-share-panel,
                    #movie_player.ytkit-embed-active .annotation,
                    #movie_player.ytkit-embed-active .ytp-cards-teaser,
                    #movie_player.ytkit-embed-active .ytp-cards-button,
                    #movie_player.ytkit-embed-active .ytp-tooltip,
                    #movie_player.ytkit-embed-active .ytp-tooltip-text,
                    #movie_player.ytkit-embed-active .ytp-bezel-text-wrapper,
                    #movie_player.ytkit-embed-active .ytp-bezel,
                    #movie_player.ytkit-embed-active .ytp-bezel-text,
                    #movie_player.ytkit-embed-active .ytp-watermark,
                    #movie_player.ytkit-embed-active .ytp-chapter-hover-container,
                    #movie_player.ytkit-embed-active .ytp-scrubber-container,
                    #movie_player.ytkit-embed-active .ytp-swatch-background-color,
                    #movie_player.ytkit-embed-active .ytp-play-button,
                    #movie_player.ytkit-embed-active .ytp-volume-panel,
                    #movie_player.ytkit-embed-active .ytp-settings-button,
                    #movie_player.ytkit-embed-active .ytp-subtitles-button,
                    #movie_player.ytkit-embed-active .ytp-miniplayer-button,
                    #movie_player.ytkit-embed-active .ytp-size-button,
                    #movie_player.ytkit-embed-active .ytp-fullscreen-button {
                        display: none !important;
                        visibility: hidden !important;
                        opacity: 0 !important;
                        pointer-events: none !important;
                        z-index: -1 !important;
                    }

                    /* Hide ads and overlays */
                    #movie_player.ytkit-embed-active .ytp-ad-module,
                    #movie_player.ytkit-embed-active .ytp-ad-overlay-container,
                    #movie_player.ytkit-embed-active .ytp-ad-player-overlay,
                    #movie_player.ytkit-embed-active .ytp-ad-text-overlay,
                    #movie_player.ytkit-embed-active .ytp-ad-skip-button-container,
                    #movie_player.ytkit-embed-active .ytp-ad-preview-container,
                    #movie_player.ytkit-embed-active .video-ads,
                    #movie_player.ytkit-embed-active .ytp-paid-content-overlay,
                    #movie_player.ytkit-embed-active .ytp-ad-info-dialog-container {
                        display: none !important;
                    }

                    /* The embed video fills #movie_player completely - HIGHEST z-index */
                    .ytkit-embed-video {
                        position: absolute !important;
                        top: 0 !important;
                        left: 0 !important;
                        width: 100% !important;
                        height: 100% !important;
                        z-index: 99999 !important;
                        background: #000 !important;
                        object-fit: contain !important;
                    }

                    /* Overlay container for UI elements - above video */
                    .ytkit-embed-overlay {
                        position: absolute !important;
                        top: 0 !important;
                        left: 0 !important;
                        width: 100% !important;
                        height: 100% !important;
                        z-index: 100000 !important;
                        pointer-events: none !important;
                    }

                    .ytkit-embed-overlay > * {
                        pointer-events: auto;
                    }

                    /* Title bar */
                    .ytkit-embed-title {
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        padding: 12px 16px;
                        background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
                        color: white;
                        font-size: 14px;
                        font-weight: 500;
                        opacity: 0;
                        transition: opacity 0.3s;
                        pointer-events: none;
                    }

                    #movie_player.ytkit-embed-active:hover .ytkit-embed-title {
                        opacity: 1;
                    }

                    /* Embed badge */
                    .ytkit-embed-badge {
                        position: absolute;
                        top: 12px;
                        right: 12px;
                        padding: 4px 8px;
                        background: rgba(59, 130, 246, 0.9);
                        color: white;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        opacity: 0;
                        transition: opacity 0.3s;
                        pointer-events: none;
                    }

                    #movie_player.ytkit-embed-active:hover .ytkit-embed-badge {
                        opacity: 1;
                    }

                    /* Skip button */
                    .ytkit-skip-indicator {
                        position: absolute;
                        bottom: 80px;
                        right: 16px;
                        padding: 10px 20px;
                        background: #00d400;
                        color: white;
                        border-radius: 4px;
                        font-size: 14px;
                        font-weight: 500;
                        display: none;
                        cursor: pointer;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        transition: transform 0.2s, background 0.2s;
                        z-index: 100;
                    }

                    .ytkit-skip-indicator:hover {
                        transform: scale(1.05);
                        background: #00b800;
                    }

                    /* Fit to window mode - embed inherits automatically via % sizing */
                    body.yt-suite-fit-to-window #movie_player.ytkit-embed-active .ytkit-embed-video {
                        width: 100% !important;
                        height: 100% !important;
                    }

                    /* Theater mode */
                    ytd-watch-flexy[theater] #movie_player.ytkit-embed-active .ytkit-embed-video {
                        width: 100% !important;
                        height: 100% !important;
                    }

                    /* Fullscreen */
                    #movie_player.ytkit-embed-active:fullscreen .ytkit-embed-video {
                        width: 100vw !important;
                        height: 100vh !important;
                    }

                    #movie_player.ytkit-embed-active:fullscreen .ytkit-skip-indicator {
                        bottom: 100px;
                        right: 24px;
                    }
                `;
                document.head.appendChild(this._styleElement);
            },

            _createPlayer(streamData) {
                // Clean up any existing embed
                this._cleanupPlayer();

                const moviePlayer = document.querySelector('#movie_player');
                if (!moviePlayer) {
                    console.error('[YTKit Embed] #movie_player not found');
                    return null;
                }

                // Mark player as embed active
                moviePlayer.classList.add('ytkit-embed-active');

                // Pause and clear YouTube's video
                const ytVideo = moviePlayer.querySelector('video.html5-main-video');
                if (ytVideo) {
                    ytVideo.pause();
                    ytVideo.muted = true;
                    // Remove src to stop buffering and free memory
                    try {
                        ytVideo.src = '';
                        ytVideo.load(); // Force release of media resources
                    } catch(e) {}
                }

                // Create our video element
                const video = document.createElement('video');
                video.className = 'ytkit-embed-video';
                video.controls = true;
                video.autoplay = true;
                video.playsInline = true;
                video.src = streamData.videoUrl;

                // Handle separate audio stream
                let audioElement = null;
                if (streamData.audioUrl && streamData.audioUrl !== streamData.videoUrl) {
                    audioElement = document.createElement('audio');
                    audioElement.className = 'ytkit-embed-audio';
                    audioElement.src = streamData.audioUrl;
                    audioElement.style.display = 'none';

                    // Throttled sync - only run every 500ms instead of every timeupdate
                    let lastSyncTime = 0;
                    const syncAudio = () => {
                        const now = Date.now();
                        if (now - lastSyncTime < 500) return; // Throttle to 2 times/second
                        lastSyncTime = now;
                        if (Math.abs(audioElement.currentTime - video.currentTime) > 0.3) {
                            audioElement.currentTime = video.currentTime;
                        }
                    };

                    video.addEventListener('play', () => {
                        audioElement.currentTime = video.currentTime;
                        audioElement.play().catch(() => {});
                    });
                    video.addEventListener('pause', () => audioElement.pause());
                    video.addEventListener('seeked', () => { audioElement.currentTime = video.currentTime; });
                    video.addEventListener('seeking', () => { audioElement.currentTime = video.currentTime; });
                    video.addEventListener('ratechange', () => { audioElement.playbackRate = video.playbackRate; });
                    video.addEventListener('volumechange', () => {
                        audioElement.volume = video.volume;
                        audioElement.muted = video.muted;
                    });
                    video.addEventListener('timeupdate', syncAudio);

                    moviePlayer.appendChild(audioElement);
                    this._audioElement = audioElement;
                }

                // Create overlay container
                const overlayContainer = document.createElement('div');
                overlayContainer.className = 'ytkit-embed-overlay';

                // Title overlay
                const titleOverlay = document.createElement('div');
                titleOverlay.className = 'ytkit-embed-title';
                titleOverlay.textContent = streamData.title || 'YouTube Video';

                // Skip button (for SponsorBlock)
                const skipIndicator = document.createElement('div');
                skipIndicator.className = 'ytkit-skip-indicator';
                skipIndicator.textContent = 'Skip Sponsor ▸';

                overlayContainer.appendChild(titleOverlay);
                overlayContainer.appendChild(skipIndicator);

                // Insert elements
                moviePlayer.appendChild(video);
                moviePlayer.appendChild(overlayContainer);

                // Double-click for fullscreen
                video.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    } else {
                        moviePlayer.requestFullscreen().catch(() => {});
                    }
                });

                // Keyboard shortcuts
                this._keyboardHandler = (e) => {
                    if (document.activeElement.tagName === 'INPUT' ||
                        document.activeElement.tagName === 'TEXTAREA' ||
                        document.activeElement.isContentEditable) return;

                    const key = e.key.toLowerCase();

                    if (key === ' ' || key === 'k') {
                        e.preventDefault();
                        video.paused ? video.play() : video.pause();
                    } else if (key === 'f') {
                        e.preventDefault();
                        document.fullscreenElement ? document.exitFullscreen() : moviePlayer.requestFullscreen();
                    } else if (key === 'm') {
                        e.preventDefault();
                        video.muted = !video.muted;
                    } else if (key === 'arrowleft') {
                        e.preventDefault();
                        video.currentTime -= 5;
                    } else if (key === 'arrowright') {
                        e.preventDefault();
                        video.currentTime += 5;
                    } else if (key === 'j') {
                        e.preventDefault();
                        video.currentTime -= 10;
                    } else if (key === 'l') {
                        e.preventDefault();
                        video.currentTime += 10;
                    } else if (key === 'arrowup') {
                        e.preventDefault();
                        video.volume = Math.min(1, video.volume + 0.1);
                    } else if (key === 'arrowdown') {
                        e.preventDefault();
                        video.volume = Math.max(0, video.volume - 0.1);
                    } else if (key === '0') {
                        e.preventDefault();
                        video.currentTime = 0;
                    } else if (key >= '1' && key <= '9') {
                        e.preventDefault();
                        video.currentTime = video.duration * (parseInt(key) / 10);
                    }
                };
                document.addEventListener('keydown', this._keyboardHandler);

                // PERSISTENCE: Watch for YouTube trying to restore its player
                this._persistenceObserver = new MutationObserver((mutations) => {
                    const moviePlayer = document.querySelector('#movie_player');
                    if (!moviePlayer || !this._isActive) return;

                    // Ensure our class stays on
                    if (!moviePlayer.classList.contains('ytkit-embed-active')) {
                        moviePlayer.classList.add('ytkit-embed-active');
                        console.log('[YTKit Embed] Re-applied ytkit-embed-active class');
                    }

                    // Stop YouTube video if it tries to play
                    const ytVideo = moviePlayer.querySelector('video.html5-main-video');
                    if (ytVideo && !ytVideo.paused) {
                        ytVideo.pause();
                        try { ytVideo.currentTime = 0; } catch(e) {}
                    }

                    // Force hide any YouTube elements that become visible
                    const ytElements = moviePlayer.querySelectorAll('.html5-video-container, .ytp-chrome-bottom, .ytp-chrome-top, .ytp-gradient-bottom');
                    ytElements.forEach(el => {
                        if (el.style.display !== 'none' || el.style.visibility !== 'hidden') {
                            el.style.setProperty('display', 'none', 'important');
                            el.style.setProperty('visibility', 'hidden', 'important');
                        }
                    });
                });

                this._persistenceObserver.observe(moviePlayer, {
                    childList: true,
                    subtree: false, // Changed from true - less expensive
                    attributes: true,
                    attributeFilter: ['class']
                });

                // Use interval as backup but less frequently (was 500ms, now 2000ms)
                // Stop after embed is stable for a while
                let stableCount = 0;
                this._persistenceInterval = setInterval(() => {
                    if (!this._isActive) {
                        clearInterval(this._persistenceInterval);
                        return;
                    }
                    const mp = document.querySelector('#movie_player');
                    if (mp && !mp.classList.contains('ytkit-embed-active')) {
                        mp.classList.add('ytkit-embed-active');
                        stableCount = 0; // Reset if we had to fix it
                    } else {
                        stableCount++;
                        // If stable for 30 checks (60 seconds), reduce to very slow checking
                        if (stableCount > 30 && this._persistenceInterval) {
                            clearInterval(this._persistenceInterval);
                            // Switch to very slow checking (every 10 seconds)
                            this._persistenceInterval = setInterval(() => {
                                if (!this._isActive) {
                                    clearInterval(this._persistenceInterval);
                                    return;
                                }
                                const mp2 = document.querySelector('#movie_player');
                                if (mp2 && !mp2.classList.contains('ytkit-embed-active')) {
                                    mp2.classList.add('ytkit-embed-active');
                                }
                            }, 10000);
                        }
                    }
                    // Keep YouTube video paused and unloaded
                    const ytv = document.querySelector('#movie_player video.html5-main-video');
                    if (ytv) {
                        if (!ytv.paused) ytv.pause();
                        if (ytv.src && ytv.src !== '') {
                            try { ytv.src = ''; ytv.load(); } catch(e) {}
                        }
                    }
                }, 2000);

                this._player = video;
                this._isActive = true;
                console.log('[YTKit Embed] Player created successfully with persistence');
                return video;
            },

            _setupSponsorSkip(video, segments) {
                if (!segments || segments.length === 0) return;

                this._sponsorSegments = segments;
                const skipIndicator = document.querySelector('.ytkit-skip-indicator');

                // Throttle sponsor check to every 500ms
                let lastCheck = 0;
                video.addEventListener('timeupdate', () => {
                    const now = Date.now();
                    if (now - lastCheck < 500) return;
                    lastCheck = now;

                    const currentTime = video.currentTime;

                    for (const seg of segments) {
                        if (currentTime >= seg.start && currentTime < seg.end) {
                            if (skipIndicator) {
                                skipIndicator.style.display = 'block';
                                skipIndicator.onclick = () => {
                                    video.currentTime = seg.end + 0.1;
                                    skipIndicator.style.display = 'none';
                                };
                            }

                            // Auto-skip if enabled
                            if (appState.settings.skipSponsors) {
                                video.currentTime = seg.end + 0.1;
                                console.log(`[YTKit Embed] Skipped ${seg.category}: ${seg.start}s - ${seg.end}s`);
                            }
                            return;
                        }
                    }

                    if (skipIndicator) skipIndicator.style.display = 'none';
                });

                console.log(`[YTKit Embed] SponsorBlock: ${segments.length} segments loaded`);
            },

            _cleanupPlayer() {
                // Stop persistence mechanisms
                if (this._persistenceObserver) {
                    this._persistenceObserver.disconnect();
                    this._persistenceObserver = null;
                }
                if (this._persistenceInterval) {
                    clearInterval(this._persistenceInterval);
                    this._persistenceInterval = null;
                }

                // Remove embed elements
                document.querySelector('.ytkit-embed-video')?.remove();
                document.querySelector('.ytkit-embed-audio')?.remove();
                document.querySelector('.ytkit-embed-overlay')?.remove();

                // Remove keyboard handler
                if (this._keyboardHandler) {
                    document.removeEventListener('keydown', this._keyboardHandler);
                    this._keyboardHandler = null;
                }

                // Remove embed active class and restore YouTube player
                const moviePlayer = document.querySelector('#movie_player');
                if (moviePlayer) {
                    moviePlayer.classList.remove('ytkit-embed-active');
                }

                this._player = null;
                this._audioElement = null;
                this._isActive = false;
            },

            _createEmbedButton(parent) {
                const self = this;

                const btn = document.createElement('button');
                btn.className = 'ytkit-embed-btn';
                btn.title = 'Use Embed Player (requires local server)';

                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '20');
                svg.setAttribute('height', '20');
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', '2');
                rect.setAttribute('y', '3');
                rect.setAttribute('width', '20');
                rect.setAttribute('height', '14');
                rect.setAttribute('rx', '2');
                rect.setAttribute('stroke', 'white');
                rect.setAttribute('stroke-width', '2');
                rect.setAttribute('fill', 'none');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'm10 8 5 3-5 3z');
                path.setAttribute('fill', 'white');
                svg.appendChild(rect);
                svg.appendChild(path);

                btn.appendChild(svg.cloneNode(true));
                btn.appendChild(document.createTextNode(' Embed'));
                btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:36px;margin-left:8px;border-radius:18px;border:none;background:#3b82f6;color:white;font-family:"Roboto","Arial",sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:background 0.2s;`;
                btn.onmouseenter = () => { if (!self._isActive) btn.style.background = '#2563eb'; };
                btn.onmouseleave = () => { if (!self._isActive) btn.style.background = '#3b82f6'; };

                // Store reference to svg for later use
                btn._svgTemplate = svg;

                btn.addEventListener('click', async () => {
                    // If already active, deactivate
                    if (self._isActive) {
                        self._cleanupPlayer();
                        btn.style.background = '#3b82f6';
                        while (btn.lastChild) btn.removeChild(btn.lastChild);
                        btn.appendChild(btn._svgTemplate.cloneNode(true));
                        btn.appendChild(document.createTextNode(' Embed'));
                        window.location.reload();
                        return;
                    }

                    // Show loading
                    while (btn.lastChild) btn.removeChild(btn.lastChild);
                    btn.appendChild(document.createTextNode('⏳ Loading...'));
                    btn.disabled = true;

                    const success = await self.activateEmbed(true);

                    if (success) {
                        while (btn.lastChild) btn.removeChild(btn.lastChild);
                        btn.appendChild(document.createTextNode('✓ Active'));
                        btn.style.background = '#22c55e';
                    } else {
                        while (btn.lastChild) btn.removeChild(btn.lastChild);
                        btn.appendChild(btn._svgTemplate.cloneNode(true));
                        btn.appendChild(document.createTextNode(' Embed'));
                        btn.style.background = '#3b82f6';
                    }
                    btn.disabled = false;
                });

                parent.appendChild(btn);
            },

            init() {
                this._injectStyles();
                registerPersistentButton('embedButton', '#top-level-buttons-computed', '.ytkit-embed-btn', this._createEmbedButton.bind(this));
                startButtonChecker();
            },

            destroy() {
                unregisterPersistentButton('embedButton');
                this._cleanupPlayer();
                this._styleElement?.remove();
                this._styleElement = null;
                document.querySelector('.ytkit-embed-btn')?.remove();
            },

            // Expose method for auto-embed feature to use
            async activateEmbed(showAlerts = false) {
                if (this._isActive) return true;
                if (!window.location.pathname.startsWith('/watch')) return false;

                const serverOk = await this._checkServer();
                if (!serverOk) {
                    console.log('[YTKit Embed] Server not running');
                    if (showAlerts) {
                        alert('YouTube Tools server not running!\n\nStart it from:\nC:\\YouTubeTools\\embed-server-launcher.vbs\n\nOr restart your PC to auto-start it.');
                    }
                    return false;
                }

                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId) return false;

                const streamData = await this._getStreamUrls(videoId);
                if (!streamData || !streamData.success) {
                    console.log('[YTKit Embed] Failed to get stream URLs');
                    if (showAlerts) {
                        alert('Failed to get stream URLs. Video may be restricted.');
                    }
                    return false;
                }

                const video = this._createPlayer(streamData);
                if (video) {
                    const segments = await this._getSponsorSegments(videoId);
                    this._setupSponsorSkip(video, segments);

                    // Update button if it exists
                    const btn = document.querySelector('.ytkit-embed-btn');
                    if (btn) {
                        while (btn.lastChild) btn.removeChild(btn.lastChild);
                        btn.appendChild(document.createTextNode('✓ Active'));
                        btn.style.background = '#22c55e';
                    }
                    return true;
                }
                return false;
            }
        },
        {
            id: 'autoEmbedOnVisit',
            name: 'Auto-Embed on Visit',
            description: 'Automatically activate embed player when visiting videos (requires server running)',
            group: 'Downloads',
            icon: 'play',
            _lastVideoId: null,
            _observer: null,
            _attempting: false,

            async _tryEmbed() {
                if (this._attempting) return;
                if (!window.location.pathname.startsWith('/watch')) return;

                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId || videoId === this._lastVideoId) return;

                // Check if movie_player exists
                const moviePlayer = document.querySelector('#movie_player');
                if (!moviePlayer) return;

                this._attempting = true;
                this._lastVideoId = videoId;
                console.log('[YTKit] Auto-embed triggered for:', videoId);

                // Find the enableEmbedPlayer feature and call its activateEmbed method
                const embedFeature = features.find(f => f.id === 'enableEmbedPlayer');
                if (embedFeature && typeof embedFeature.activateEmbed === 'function') {
                    embedFeature._injectStyles();
                    const success = await embedFeature.activateEmbed();
                    console.log('[YTKit] Auto-embed result:', success ? 'success' : 'failed');
                }

                this._attempting = false;
            },

            init() {
                // Method 1: Navigation events
                addNavigateRule('autoEmbedRule', this._tryEmbed.bind(this));

                // Method 2: MutationObserver for instant detection of video player
                this._observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.type === 'childList' && m.addedNodes.length > 0) {
                            for (const node of m.addedNodes) {
                                if (node.nodeType === 1) {
                                    if (node.id === 'movie_player' ||
                                        node.querySelector?.('#movie_player') ||
                                        node.tagName === 'YTD-WATCH-FLEXY') {
                                        // Video player appeared - try embed immediately
                                        setTimeout(() => this._tryEmbed(), 0);
                                        setTimeout(() => this._tryEmbed(), 100);
                                        setTimeout(() => this._tryEmbed(), 300);
                                        return;
                                    }
                                }
                            }
                        }
                        // Also watch for video-id attribute changes
                        if (m.type === 'attributes' && m.attributeName === 'video-id') {
                            this._lastVideoId = null; // Reset to allow new embed
                            setTimeout(() => this._tryEmbed(), 0);
                            setTimeout(() => this._tryEmbed(), 100);
                        }
                    }
                });

                this._observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['video-id']
                });

                // Method 3: Aggressive initial attempts
                this._tryEmbed();
                setTimeout(() => this._tryEmbed(), 100);
                setTimeout(() => this._tryEmbed(), 300);
                setTimeout(() => this._tryEmbed(), 500);
                setTimeout(() => this._tryEmbed(), 1000);
            },

            destroy() {
                removeNavigateRule('autoEmbedRule');
                if (this._observer) {
                    this._observer.disconnect();
                    this._observer = null;
                }
                this._lastVideoId = null;
                this._attempting = false;
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
                const videoId = new URLSearchParams(window.location.search).get('v');
                if (!videoId) {
                    showToast('❌ No video ID found', '#ef4444');
                    return;
                }

                showToast('📝 Fetching transcript...', '#3b82f6');

                try {
                    let playerResponse = null;

                    // Method 1: Try window.ytInitialPlayerResponse (only works on fresh load)
                    if (window.ytInitialPlayerResponse &&
                        window.ytInitialPlayerResponse.videoDetails &&
                        window.ytInitialPlayerResponse.videoDetails.videoId === videoId) {
                        playerResponse = window.ytInitialPlayerResponse;
                    }

                    // Method 2: Fetch fresh data if the variable is stale (SPA navigation)
                    if (!playerResponse) {
                        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
                        const html = await response.text();
                        // Extract the player response JSON from the HTML
                        const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
                        if (match && match[1]) {
                            playerResponse = JSON.parse(match[1]);
                        }
                    }

                    if (!playerResponse || !playerResponse.captions) {
                        showToast('❌ No transcript available for this video', '#ef4444');
                        return;
                    }

                    // Navigate the JSON object to find caption tracks
                    const captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (!captionTracks || captionTracks.length === 0) {
                        showToast('❌ No transcript tracks found', '#ef4444');
                        return;
                    }

                    // Get first available track (usually auto-generated or primary language)
                    const trackUrl = captionTracks[0].baseUrl;
                    const videoTitle = (playerResponse.videoDetails?.title || videoId)
                        .replace(/[^a-z0-9]/gi, '_')
                        .toLowerCase()
                        .substring(0, 50);

                    // Fetch the XML transcript
                    const transcriptResponse = await fetch(trackUrl);
                    const transcriptXml = await transcriptResponse.text();

                    // Parse XML to text
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(transcriptXml, 'text/xml');
                    const textElements = xmlDoc.getElementsByTagName('text');

                    let transcript = '';
                    for (let i = 0; i < textElements.length; i++) {
                        const node = textElements[i];
                        const startSeconds = parseFloat(node.getAttribute('start'));
                        const text = node.textContent
                            .replace(/&#39;/g, "'")
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>');

                        // Format time as HH:MM:SS
                        const date = new Date(0);
                        date.setSeconds(startSeconds);
                        const timestamp = date.toISOString().substring(11, 19);

                        transcript += `[${timestamp}] ${text}\n`;
                    }

                    // Download as text file
                    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${videoTitle}_transcript.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    showToast('✅ Transcript downloaded!', '#22c55e');

                } catch (e) {
                    console.error('[YTKit] Transcript download error:', e);
                    showToast('❌ Failed to download transcript', '#ef4444');
                }
            },

            _streamVLC() {
                const url = window.location.href;
                showToast('🎬 Sending to VLC...', '#f97316');
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
                const embedFeature = features.find(f => f.id === 'enableEmbedPlayer');
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
                const toast = document.createElement('div');
                toast.textContent = message;
                toast.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #22c55e;
                    color: white;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-family: "Roboto", Arial, sans-serif;
                    font-size: 14px;
                    z-index: 999999;
                    animation: ytkit-toast-fade 2s ease-out forwards;
                `;

                // Add animation keyframes if not exists
                if (!document.getElementById('ytkit-toast-animation')) {
                    const style = document.createElement('style');
                    style.id = 'ytkit-toast-animation';
                    style.textContent = `
                        @keyframes ytkit-toast-fade {
                            0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                            15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                            85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                            100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                        }
                    `;
                    document.head.appendChild(style);
                }

                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
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
                document.addEventListener('scroll', () => this._hideMenu());

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
                removeNavigateRule('contextMenuAttach');
                this._menu?.remove();
                this._menu = null;
                this._styleElement?.remove();
                this._styleElement = null;
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
        'Downloads': { icon: 'downloads', color: '#f97316' },
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

        const categoryOrder = ['Interface', 'Appearance', 'Content', 'Video Player', 'Playback', 'SponsorBlock', 'Quality', 'Clutter', 'Live Chat', 'Action Buttons', 'Player Controls', 'Downloads'];
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

        // Preset profiles
        const presetsContainer = document.createElement('div');
        presetsContainer.className = 'ytkit-presets-container';
        const presetsLabel = document.createElement('span');
        presetsLabel.className = 'ytkit-presets-label';
        presetsLabel.textContent = 'Presets';
        presetsContainer.appendChild(presetsLabel);

        const presetConfigs = {
            minimal: { name: 'Minimal', desc: 'Clean, distraction-free experience', settings: {
                hideCreateButton: true, hideVoiceSearch: true, hideSidebar: true, removeAllShorts: true,
                hideMerchShelf: true, hideVideoEndCards: true, hideVideoEndScreen: true, hideHashtags: true,
                hidePinnedComments: true, hideRelatedVideos: true, hideDescriptionExtras: true
            }},
            privacy: { name: 'Privacy', desc: 'Maximum privacy protection', settings: {
                disablePlayOnHover: true, preventAutoplay: true, hideNotificationButton: true,
                hideNotificationBadge: true, hideLiveChatEngagement: true, hidePaidPromotionWatch: true
            }},
            power: { name: 'Power User', desc: 'All productivity features enabled', settings: {
                playbackSpeedPresets: true, rememberPlaybackSpeed: true, returnYouTubeDislike: true,
                showWatchProgress: true, timestampBookmarks: true, skipSponsors: true, autoMaxResolution: true,
                autoExpandDescription: true, fiveVideosPerRow: true, hideVideosFromHome: true
            }}
        };

        Object.entries(presetConfigs).forEach(([key, preset]) => {
            const btn = document.createElement('button');
            btn.className = 'ytkit-preset-btn';
            btn.textContent = preset.name;
            btn.title = preset.desc;
            btn.onclick = async () => {
                if (confirm(`Apply "${preset.name}" preset?\n\n${preset.desc}\n\nThis will change ${Object.keys(preset.settings).length} settings.`)) {
                    Object.assign(appState.settings, preset.settings);
                    await settingsManager.save(appState.settings);
                    // Re-init changed features
                    features.forEach(f => {
                        if (preset.settings.hasOwnProperty(f.id)) {
                            try { f.destroy?.(); } catch(e) {}
                            if (appState.settings[f.id]) {
                                try { f.init?.(); } catch(e) {}
                            }
                        }
                    });
                    updateAllToggleStates();
                    createToast(`Applied "${preset.name}" preset`, 'success');
                }
            };
            presetsContainer.appendChild(btn);
        });
        sidebar.appendChild(presetsContainer);

        // Divider
        const divider = document.createElement('div');
        divider.className = 'ytkit-sidebar-divider';
        sidebar.appendChild(divider);

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

            // Reset group button
            const resetBtn = document.createElement('button');
            resetBtn.className = 'ytkit-reset-group-btn';
            resetBtn.title = 'Reset this group to defaults';
            resetBtn.textContent = 'Reset';
            resetBtn.onclick = async () => {
                if (!confirm(`Reset all "${cat}" settings to defaults?`)) return;
                const categoryFeatures = featuresByCategory[cat];
                categoryFeatures.forEach(f => {
                    const defaultValue = settingsManager.defaults[f.id];
                    if (defaultValue !== undefined) {
                        appState.settings[f.id] = defaultValue;
                        try { f.destroy?.(); } catch(e) {}
                        if (defaultValue) {
                            try { f.init?.(); } catch(e) {}
                        }
                    }
                });
                await settingsManager.save(appState.settings);
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
            };
            paneHeader.appendChild(resetBtn);
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

        // YouTube Tools Installer Link
        const ytToolsLink = document.createElement('a');
        ytToolsLink.href = 'https://github.com/SysAdminDoc/YTKit/releases/download/v7.0/Install-YouTubeTools.ps1';
        ytToolsLink.target = '_blank';
        ytToolsLink.className = 'ytkit-github';
        ytToolsLink.title = 'Download YouTube Tools (VLC/Download integration)';
        ytToolsLink.style.cssText = 'background: linear-gradient(135deg, #f97316, #22c55e) !important;';
        const dlIcon = ICONS.download();
        dlIcon.style.color = 'white';
        ytToolsLink.appendChild(dlIcon);

        const versionSpan = document.createElement('span');
        versionSpan.className = 'ytkit-version';
        versionSpan.textContent = 'v9.2';

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
            // Info card - just show a help link
            const helpLink = document.createElement('a');
            helpLink.href = 'https://github.com/SysAdminDoc/YTKit/wiki/YouTube-Tools-Setup';
            helpLink.target = '_blank';
            helpLink.textContent = 'Setup Guide →';
            helpLink.style.cssText = 'color: #f97316; font-weight: 600; text-decoration: none; padding: 8px 16px; background: rgba(249, 115, 22, 0.2); border-radius: 8px; transition: background 0.2s;';
            helpLink.onmouseenter = () => { helpLink.style.background = 'rgba(249, 115, 22, 0.3)'; };
            helpLink.onmouseleave = () => { helpLink.style.background = 'rgba(249, 115, 22, 0.2)'; };
            card.appendChild(helpLink);
        } else if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.className = 'ytkit-input';
            textarea.id = `ytkit-input-${f.id}`;
            textarea.placeholder = 'word1, word2, phrase';
            textarea.value = appState.settings[f.id] || '';
            card.appendChild(textarea);
        } else if (f.type === 'select') {
            const select = document.createElement('select');
            select.className = 'ytkit-select';
            select.id = `ytkit-select-${f.id}`;
            select.style.cssText = `padding:8px 12px;border-radius:8px;background:var(--ytkit-bg-base);color:#fff;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:13px;min-width:150px;`;
            const currentValue = appState.settings[f.id] || Object.keys(f.options)[0];
            for (const [value, label] of Object.entries(f.options)) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                option.selected = value === currentValue;
                select.appendChild(option);
            }
            card.appendChild(select);
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

        // Search functionality
        doc.addEventListener('input', (e) => {
            if (e.target.matches('#ytkit-search')) {
                const query = e.target.value.toLowerCase().trim();
                const allCards = doc.querySelectorAll('.ytkit-feature-card');
                const allPanes = doc.querySelectorAll('.ytkit-pane');
                const allNavBtns = doc.querySelectorAll('.ytkit-nav-btn');

                if (!query) {
                    // Reset to normal view
                    allCards.forEach(card => card.style.display = '');
                    allPanes.forEach(pane => pane.classList.remove('ytkit-search-active'));
                    doc.querySelectorAll('.ytkit-sub-features').forEach(sub => {
                        const parentId = sub.dataset.parentId;
                        sub.style.display = appState.settings[parentId] ? '' : 'none';
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
                doc.querySelectorAll('.ytkit-sub-features').forEach(sub => sub.style.display = '');

                // Filter cards
                let matchCount = 0;
                allCards.forEach(card => {
                    const name = card.querySelector('.ytkit-feature-name')?.textContent.toLowerCase() || '';
                    const desc = card.querySelector('.ytkit-feature-desc')?.textContent.toLowerCase() || '';
                    const matches = name.includes(query) || desc.includes(query);
                    card.style.display = matches ? '' : 'none';
                    if (matches) matchCount++;
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
            // Select dropdown
            if (e.target.matches('.ytkit-select')) {
                const card = e.target.closest('[data-feature-id]');
                const featureId = card.dataset.featureId;
                appState.settings[featureId] = e.target.value;
                await settingsManager.save(appState.settings);
                createToast(`Download provider set to ${e.target.options[e.target.selectedIndex].text}`, 'success');
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

/* YTKit Download Buttons - Force Visibility */
.ytkit-vlc-btn,
.ytkit-local-dl-btn,
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

/* Preset Profiles */
.ytkit-presets-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
}
.ytkit-presets-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ytkit-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0 4px;
    margin-bottom: 4px;
}
.ytkit-preset-btn {
    padding: 8px 12px;
    background: var(--ytkit-bg-surface);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-sm);
    color: var(--ytkit-text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--ytkit-transition);
    text-align: left;
}
.ytkit-preset-btn:hover {
    background: var(--ytkit-bg-hover);
    color: var(--ytkit-text-primary);
    border-color: var(--ytkit-accent);
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

        // Button injection is handled by startButtonChecker() called from each button feature's init()

        const hasRun = await settingsManager.getFirstRunStatus();
        if (!hasRun) {
            document.body.classList.add('ytkit-panel-open');
            await settingsManager.setFirstRunStatus(true);
        }

        console.log('[YTKit] Initialized');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }
})();
