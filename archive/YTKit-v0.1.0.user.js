// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      0.1.0
// @description  Ultimate YouTube customization. Hide elements, control layout, and enhance your viewing experience with a modern UI.
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
// @resource     nyanCatProgressBar https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/Themes/nyan-cat-progress-bar.css
// @updateURL    https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @downloadURL  https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ——————————————————————————————————————————————————————————————————————————
    //  ~ CHANGELOG ~
    //
    //  v5.9 - Theme Integration
    //  - ADDED: Integrated the Modern Dark Theme directly into the settings panel.
    //  - ADDED: Added granular controls for the Modern Dark Theme, including toggles for blur, zen mode, padded sections, and more.
    //
    //  v5.8 - Critical UI Fix
    //  - FIXED: Resolved a critical SyntaxError in the UI builder that prevented the script from loading entirely.
    //
    //  v5.7 - Merged & Finalized
    //  - MERGED: Ensured all features from the modular version are present in this monolithic script.
    //  - ENHANCED: Carried over the latest bug fixes and code improvements for stability and performance.
    //
    //  v5.6 - Watch Page Button Fix
    //  - FIXED: Re-implemented the logic to display the settings gear icon on video watch pages, next to the uploader's channel info. The button now correctly appears in either the main header or on the watch page as you navigate.
    //
    // ——————————————————————————————————————————————————————————————————————————


    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 0: DYNAMIC CONTENT/STYLE ENGINE
    // This is the core engine that makes the script work on YouTube's dynamic,
    // single-page application structure. It watches for page changes and new
    // content, then applies the enabled features at the right time.
    // ——————————————————————————————————————————————————————————————————————————
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

    /**
     * Waits for a specific element to appear in the DOM before executing a callback.
     * This is essential for a site like YouTube where elements are loaded dynamically.
     * @param {string} selector - The CSS selector of the element to wait for.
     * @param {function} callback - The function to call once the element is found.
     * @param {number} [timeout=10000] - The maximum time to wait in milliseconds.
     */
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
            if (elapsedTime >= timeout) {
                clearInterval(interval);
            }
        }, intervalTime);
    }

    // --- YouTube Navigation Handling ---
    // These functions handle YouTube's custom navigation events ('yt-navigate-finish').
    const runNavigateRules = () => {
        for (const rule of navigateRules.values()) {
            try { rule(document.body); } catch (e) { console.error('[YT Suite] Error applying navigate rule:', e); }
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
        ruleFn(document.body); // Run on initial load
    }
    function removeNavigateRule(id) {
        navigateRules.delete(id);
    }

    // --- DOM Mutation Handling ---
    // These functions use a MutationObserver to watch for changes in the page's HTML.
    // This is how we apply features to elements that are loaded in after the initial page load.
    const runMutationRules = (targetNode) => {
        for (const rule of mutationRules.values()) {
            try { rule(targetNode); } catch (e) { console.error('[YT Suite] Error applying mutation rule:', e); }
        }
    };
    const observerCallback = () => {
        runMutationRules(document.body);
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
        ruleFn(document.body); // Run on initial load
    }
    function removeMutationRule(id) {
        mutationRules.delete(id);
        if (mutationRules.size === 0) stopObserver();
    }


    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 1: SETTINGS MANAGER
    // This object handles loading, saving, and defining the default settings for
    // all features. It uses GM_setValue and GM_getValue to persist user
    // preferences across sessions.
    // ——————————————————————————————————————————————————————————————————————————
    const settingsManager = {
        defaults: {
            panelTheme: "dark",
            hideCreateButton: true,
            hideVoiceSearch: true,
            logoToSubscriptions: true,
            widenSearchBar: true,
            hideSidebar: true,
            nativeDarkMode: true,
            betterDarkMode: true,
            catppuccinMocha: false,
            // START: New Modern Dark Theme Settings
            modernDarkTheme: true,
            modernDarkVideoInfoStyle: true,
            modernDarkBlur: true,
            modernDarkFakePremium: false,
            modernDarkEnablePip: false,
            modernDarkZenMode: false,
            modernDarkHideBranding: false,
            modernDarkDisableProgressGradient: true,
            // END: New Modern Dark Theme Settings
            squarify: false,
            nyanCatProgressBar: false,
            removeAllShorts: true,
            redirectShorts: true,
            disablePlayOnHover: true,
            fullWidthSubscriptions: true,
            hideSubscriptionOptions: true,
            fiveVideosPerRow: true,
            hidePaidContentOverlay: true,
            redirectToVideosTab: true,
            fitPlayerToWindow: true,
            hideRelatedVideos: true,
            adaptiveLiveLayout: true,
            expandVideoWidth: true,
            floatingLogoOnWatch: true,
            hideDescriptionRow: false,
            preventAutoplay: false,
            autoExpandDescription: false,
            sortCommentsNewestFirst: false,
            skipSponsors: true,
            hideSponsorBlockLabels: true,
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
            playerEnhancements: false,
            autoMaxResolution: true,
            useEnhancedBitrate: true,
            hideQualityPopup: true,
            hideSponsorBlockButton: true,
            hideNextButton: true,
            hideAutoplayToggle: true,
            hideSubtitlesToggle: true,
            hideCaptionsContainer: true,
            hideMiniplayerButton: true,
            hidePipButton: true,
            hideTheaterButton: true,
            hideFullscreenButton: true,
            enableAdblock: false,
            enableCPU_Tamer: false,
            enableHandleRevealer: false,
            enableYoutubetoYout_ube: false,
            yout_ube_redirectShorts: true,
            yout_ube_redirectEmbed: true,
            yout_ube_redirectNoCookie: true,
            yout_ube_rewriteLinks: true,
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
                if (typeof importedSettings !== 'object' || importedSettings === null) {
                    return false;
                }
                const newSettings = { ...this.defaults, ...importedSettings };
                await this.save(newSettings);
                return true;
            } catch (e) {
                console.error("[YTKit] Failed to import settings:", e);
                return false;
            }
        }
    };

    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 2: FEATURE DEFINITIONS & LOGIC
    // This is the heart of the script. Each object in the `features` array
    // represents a single toggleable feature. It contains metadata for the UI
    // (name, description) and the core `init()` and `destroy()` methods that
    // add or remove the feature's functionality from the page.
    // ——————————————————————————————————————————————————————————————————————————

    const features = [
        // Group: Header
        {
            id: 'hideCreateButton',
            name: 'Hide "Create" Button',
            description: 'Hides the "Create" button in the main YouTube header.',
            group: 'Header',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVoiceSearch',
            name: 'Hide Voice Search Button',
            description: 'Hides the microphone icon for voice search in the header.',
            group: 'Header',
            _styleElement: null,
            init() { this._styleElement = injectStyle('#voice-search-button', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'logoToSubscriptions',
            name: 'Logo Links to Subscriptions',
            description: 'Changes the YouTube logo link to go to your Subscriptions feed.',
            group: 'Header',
            _relinkLogo() {
                const logoRenderer = document.querySelector('ytd-topbar-logo-renderer');
                if (!logoRenderer) return;
                const link = logoRenderer.querySelector('a#logo');
                if (link) {
                    link.href = '/feed/subscriptions';
                }
            },
            init() {
                addNavigateRule('relinkLogoRule', () => this._relinkLogo());
            },
            destroy() {
                removeNavigateRule('relinkLogoRule');
                const logoLink = document.querySelector('ytd-topbar-logo-renderer a#logo');
                if (logoLink) logoLink.href = '/';
            }
        },
        {
            id: 'widenSearchBar',
            name: 'Widen Search Bar',
            description: 'Stretches the search bar to fill more of the header space.',
            group: 'Header',
            _styleElement: null,
            init() {
                const css = `ytd-masthead yt-searchbox { margin-left: -180px; margin-right: -300px; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },

        // Group: Sidebar
        {
            id: 'hideSidebar',
            name: 'Hide Sidebar',
            description: 'Completely removes the left sidebar and its toggle button.',
            group: 'Sidebar',
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
            destroy() {
                this._styleElement?.remove();
            }
        },

        // Group: Themes
        {
            id: 'nativeDarkMode',
            name: 'YouTube Native Dark Theme',
            description: 'Forces YouTube\'s built-in dark theme to be active.',
            group: 'Themes',
            isManagement: true,
            _ruleId: 'nativeDarkModeRule',
            _applyTheme() {
                document.documentElement.setAttribute('dark', '');
            },
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
            name: 'Better Full Dark Theme',
            description: 'Enhances the native dark theme. Requires "YouTube Native Dark Theme" to be enabled.',
            group: 'Themes',
            isSubFeature: true,
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('betterDarkMode');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                } else {
                    console.error('[YT Suite] Could not load betterDarkMode resource. Make sure the @resource URL is correct and accessible.');
                }
            },
            destroy() {
                this._styleElement?.remove();
            }
        },
        {
            id: 'catppuccinMocha',
            name: 'Catppuccin Mocha Theme',
            description: 'A soothing dark theme for YouTube. Requires "YouTube Native Dark Theme" to be enabled.',
            group: 'Themes',
            isSubFeature: true,
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('catppuccinMocha');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                } else {
                    console.error('[YT Suite] Could not load catppuccinMocha resource. Make sure the @resource URL is correct and accessible.');
                }
            },
            destroy() {
                this._styleElement?.remove();
            }
        },
        // START: NEW MODERN DARK THEME
        {
            id: 'modernDarkTheme',
            name: 'Modern Dark Theme',
            description: 'A modern, customizable dark theme with blur effects and layout tweaks. Requires "YouTube Native Dark Theme".',
            group: 'Themes',
            isManagement: true,
            _styleElement: null,
            _updateStyles() {
                // Remove existing style block to rebuild it
                this._styleElement?.remove();

                let css = `
                    /* --- Base Variables & Styles --- */
                    :root { --my-selected-button: #3a3a3a; --border-radius: 10px; --round20: 20px; --darker-background: inherit; --blur-30: blur(60px); --bg-1-100: #767676; --bg-1-200: #f4f4f4; --bg-2-popups: #fff; --bg-90-gray: #e9e9e9d9; --search-bg: #8a8a8a1f; --gray: #272727; --blur-primary-bg: rgba(255, 255, 255, .9); --blur-secondary-bg: rgba(0, 0, 0, .5); --shadow-popup-renderer: 0 4px 32px 0 rgba(89, 89, 89, .44); --search-item-hover: #0000000f; --playlist-panel-bg: #e8e8e8; --playlist-panel-bg-alt: #f5f5f5; --playlist-items-bg: #e8e8e8; --playlist-items-bg-alt: #f5f5f5; --video-preview-radius: 12px; }
                    html[dark], [dark] { color-scheme: dark; --bg-1-100: #1c1c1c; --bg-1-200: #141414; --bg-2-popups: #101010; --bg-90-gray: #1c1c1cd9; --search-bg: #ffffff1f; --gray: #272727; --blur-primary-bg: rgba(13, 13, 13, .77); --shadow-popup-renderer: 0 4px 32px 0 rgba(13, 13, 13, .77); --search-item-hover: #ffffff0f; --playlist-panel-bg: #0c0c0c; --playlist-items-bg: #181818; }
                    /* --- Rounded Video Previews & Other Tweaks --- */
                    div#inline-preview-player, #player-container.ytd-video-preview, #thumbnail-container.ytd-video-preview, div#media-container, video.video-stream.html5-main-video { border-radius: var(--video-preview-radius); }
                    #thumbnail-container.ytd-video-preview, div#media-container { overflow: hidden; }
                    ytd-compact-video-renderer.ytd-item-section-renderer:first-of-type { margin-top: 0; }
                    ytd-voice-search-dialog-renderer[dialog] { margin: 0 !important; }
                    tp-yt-paper-dialog:has(ytd-voice-search-dialog-renderer) { border-radius: 10px; overflow: hidden; }
                    ytd-watch-flexy[rounded-info-panel] #clarify-box.ytd-watch-flexy, ytd-watch-metadata.ytd-watch-flexy { margin-top: 0 !important; margin-bottom: 0 !important; }
                    ytd-playlist-sidebar-renderer { background-color: var(--bg-2-popups) !important; }
                    ytd-browse[page-subtype="playlist"] ytd-two-column-browse-results-renderer.ytd-browse, ytd-browse[page-subtype="show"] ytd-two-column-browse-results-renderer.ytd-browse { background-color: var(--darker-background); }
                    ytd-multi-page-menu-renderer { border: 0 !important; background: var(--bg-2-popups) !important; }
                    #logo.ytd-primetime-promo-header-renderer > * > img.yt-img-shadow { border-radius: 0 !important; }
                    ytd-rich-section-renderer > * > #action-button.ytd-primetime-promo-panel-renderer { border-radius: 8px; margin-top: 8px; }
                    #container.ytd-playlist-panel-renderer { border: none !important; }
                    .header.ytd-playlist-panel-renderer { background-color: var(--playlist-panel-bg); border-radius: 8px 8px 0 0; }
                    .playlist-items.ytd-playlist-panel-renderer { background-color: var(--playlist-items-bg); border-radius: 0 0 8px 8px; }
                    tp-yt-paper-item.ytd-menu-service-item-renderer:hover { border-radius: var(--border-radius); }
                    ytd-menu-popup-renderer { background: var(--gray); border-radius: var(--border-radius); box-shadow: var(--shadow-popup-renderer); }
                    #button-container.ytd-about-channel-renderer { padding-bottom: 12px; }
                    #header.ytd-engagement-panel-title-header-renderer { margin-top: -10px; }
                    tp-yt-paper-listbox { padding: 10px; }
                    tp-yt-paper-item.style-scope.ytd-menu-service-item-renderer, tp-yt-paper-item#primary-entry { border-radius: calc(var(--border-radius) / 2); }
                    ytd-mini-guide-entry-renderer { background: none !important; }
                    #info.ytd-video-primary-info-renderer { display: flex; flex-direction: column !important; align-items: flex-start !important; }
                    yt-chip-cloud-chip-renderer[chip-style="STYLE_DEFAULT"], yt-chip-cloud-chip-renderer[chip-style="STYLE_HOME_FILTER"], yt-chip-cloud-chip-renderer[chip-style="STYLE_REFRESH_TO_NOVEL_CHIP"], #chips-wrapper.ytd-feed-filter-chip-bar-renderer { border: 0 !important; border-top: 0 !important; border-bottom: 0 !important; }
                    ytd-app { display: block; background: var(--darker-background) !important; --app-drawer-content-container-background-color: var( --darker-background) !important; }
                    ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"] { background-color: #000000b3; }
                    ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"] #text.ytd-thumbnail-overlay-time-status-renderer { color: var(--yt-spec-text-primary) !important; }
                    #search { display: flex; justify-content: center; align-items: center; }
                    ytd-searchbox.ytd-masthead { flex-direction: row; align-items: center; position: relative !important; }
                    .ytSearchboxComponentDesktop .ytSearchboxComponentClearButton { margin-right: 72px; width: 32px; height: 32px; }
                    .ytSearchboxComponentInputBox { margin-left: 0 !important; background: var(--search-bg) !important; border: none !important; border-radius: 25px !important; box-shadow: none !important; padding: 10px 10px 10px 25px !important; }
                    .ytSearchboxComponentInnerSearchIcon { display: none; }
                    .ytSearchboxComponentSearchButton { background-color: transparent; transition: all cubic-bezier(0, 0.79, 0.58, 1) 0.2s; border: none !important; width: 38px; border-radius: 51px; padding: 4px; right: 8px; top: 4px; position: absolute; }
                    .ytSearchboxComponentSearchButton:hover { background-color: hsla(0, 0%, 100%, .2); }
                    #sections.ytd-multi-page-menu-renderer > *.ytd-multi-page-menu-renderer { padding: 6px 0 !important; }
                    ytd-thumbnail.ytd-rich-grid-media:before { background-color: transparent !important; }
                    ytd-multi-page-menu-renderer[scrollbar-rework] .menu-container.ytd-multi-page-menu-renderer { padding: 5px 10px !important; }
                    ytd-multi-page-menu-renderer[scrollbar-rework] .menu-container.ytd-multi-page-menu-renderer { padding: 10px; }
                    paper-ripple { border-radius: 35px !important; }
                    tp-yt-paper-tab.iron-selected.ytd-c4-tabbed-header-renderer { background-color: var(--my-selected-button) !important; border-radius: 35px !important; margin-top: 5px; padding: 0 20px; }
                    .selection-bar.tp-yt-paper-tabs { display: none !important; }
                    ytd-button-renderer.style-primary[is-paper-button], tp-yt-paper-button.ytd-subscribe-button-renderer { background-color: #ffffff14 !important; color: #fff !important; border-radius: var(--border-radius) !important; }
                    ytd-watch-flexy[flexy] #player-container-inner.ytd-watch-flexy { border-radius: var(--round20); }
                    ytd-backstage-poll-renderer:not([is-image-poll]) .choice-info.ytd-backstage-poll-renderer { border: 1px solid var(--yt-spec-10-percent-layer); }
                    ytd-compact-link-renderer.style-scope.yt-multi-page-menu-section-renderer, ytd-toggle-theme-compact-link-renderer.style-scope.yt-multi-page-menu-section-renderer { border-radius: 5px; }
                    #sections.ytd-multi-page-menu-renderer > *.ytd-multi-page-menu-renderer:not(:last-child) { border: 0!important; }
                    ytd-multi-page-menu-renderer.style-scope.ytd-popup-container { border-radius: 10px!important; }
                    div#submenu { padding: 0!important; }
                    ytd-multi-page-menu-renderer.style-scope.ytd-multi-page-menu-renderer { background: none!important; backdrop-filter: none!important; box-shadow: none; }
                    ytd-menu-service-item-renderer.style-scope.ytd-menu-popup-renderer[is-selected] { border-radius: 5px; }
                    #header ytd-simple-menu-header-renderer.style-scope.ytd-multi-page-menu-renderer { background: none; }
                    yt-report-form-modal-renderer[dialog][dialog][dialog] { background: none; }
                    ytd-engagement-panel-title-header-renderer[shorts-panel] #header.ytd-engagement-panel-title-header-renderer { margin: 0; }
                    ytd-engagement-panel-section-list-renderer.style-scope.ytd-popup-container { margin-bottom: 0; }
                `;

                if (appState.settings.modernDarkHideBranding) {
                    css += `.iv-branding { display: none; }`;
                }
                if (appState.settings.modernDarkZenMode) {
                    css += `#secondary, #items.ytd-watch-next-secondary-results-renderer { display: none !important; }`;
                }
                if (appState.settings.modernDarkEnablePip) {
                    css += `button.ytp-pip-button.ytp-button { display: inline-block !important; }`;
                }
                if (appState.settings.modernDarkDisableProgressGradient) {
                    css += `ytd-thumbnail-overlay-resume-playback-renderer[enable-refresh-signature-moments-web] #progress.ytd-thumbnail-overlay-resume-playback-renderer, #progress.ytd-thumbnail-overlay-resume-playback-renderer, .ytp-play-progress { background: #ef1313; }`;
                }
                if (appState.settings.modernDarkVideoInfoStyle) {
                    // This is the default style in the CSS (padding enabled), so the 'else' handles the disabled case.
                } else {
                    css += `#below { background-color: unset!important; padding: 0!important; } ytd-item-section-renderer.ytd-watch-next-secondary-results-renderer { background-color: transparent!important; padding: 0!important; } .header.ytd-playlist-panel-renderer { background-color: var(--playlist-panel-bg-alt)!important; } .playlist-items.ytd-playlist-panel-renderer { background-color: var(--playlist-items-bg-alt)!important; }`;
                }
                if (appState.settings.modernDarkBlur) {
                    css += `ytd-multi-page-menu-renderer[menu-style=multi-page-menu-style-type-system], ytd-multi-page-menu-renderer.style-scope.ytd-popup-container, #contentContainer[swipe-open][opened]:not([persistent]), div#ytp-id-18, div#watch-while-engagement-panel, .ytSearchboxComponentSuggestionsContainerDark, .ytSearchboxComponentSuggestionsContainer { backdrop-filter: var(--blur-30) contrast(0.9) !important; background: var(--blur-primary-bg) !important; box-shadow: 0 16px 24px 12px var(--paper-dialog-shadow-color, rgba(0, 0, 0, 0.15)); } div#ytp-id-18 { background: var(--blur-secondary-bg) !important; } ytd-voice-search-dialog-renderer[dialog], ytd-engagement-panel-section-list-renderer[dialog] #content.ytd-engagement-panel-section-list-renderer, #header.ytd-engagement-panel-title-header-renderer { background-color: transparent!important; } ytd-menu-popup-renderer, ytd-menu-popup-renderer.style-scope.ytd-popup-container, tp-yt-paper-dialog, .yt-contextual-sheet-layout-wiz { background: var(--bg-90-gray) !important; backdrop-filter: var(--blur-30) saturate(2.5) contrast(1.5); } #guide-content.ytd-app { background-color: transparent; box-shadow: none; }`;
                }
                if (appState.settings.modernDarkFakePremium) {
                    css += `html[dark] #logo-icon, html[dark] #logo-icon-container { width: 98px !important; content: url("data:image/svg+xml,%3Csvg xmlns:dc='http://purl.org/dc/elements/1.1/' xmlns:cc='http://creativecommons.org/ns%23' xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns%23' xmlns:svg='http://www.w3.org/2000/svg' xmlns='http://www.w3.org/2000/svg' id='SVGRoot' version='1.1' viewBox='0 0 846 174' height='24px' width='98px'%3E%3Cdefs id='defs855'%3E%3Cstyle id='style2' /%3E%3C/defs%3E%3Cmetadata id='metadata858'%3E%3Crdf:RDF%3E%3Ccc:Work rdf:about=''%3E%3Cdc:format%3Eimage/svg+xml%3C/dc:format%3E%3Cdc:type rdf:resource='http://purl.org/dc/dcmitype/StillImage' /%3E%3Cdc:title%3E%3C/dc:title%3E%3C/cc:Work%3E%3C/rdf:RDF%3E%3C/metadata%3E%3Cg id='layer1'%3E%3Cg transform='translate(0,0.36)' data-name='Layer 2' id='Layer_2'%3E%3Cg data-name='Layer 1' id='Layer_1-2'%3E%3Cpath style='fill:%23ff0000' id='path6' d='M 242.88,27.11 A 31.07,31.07 0 0 0 220.95,5.18 C 201.6,0 124,0 124,0 124,0 46.46,0 27.11,5.18 A 31.07,31.07 0 0 0 5.18,27.11 C 0,46.46 0,86.82 0,86.82 c 0,0 0,40.36 5.18,59.71 a 31.07,31.07 0 0 0 21.93,21.93 c 19.35,5.18 96.92,5.18 96.92,5.18 0,0 77.57,0 96.92,-5.18 a 31.07,31.07 0 0 0 21.93,-21.93 c 5.18,-19.35 5.18,-59.71 5.18,-59.71 0,0 0,-40.36 -5.18,-59.71 z' /%3E%3Cpath style='fill:%23ffffff' id='path8' d='M 99.22,124.03 163.67,86.82 99.22,49.61 Z' /%3E%3Cpath style='fill:%23ffffff' id='path10' d='m 358.29,55.1 v 6 c 0,30 -13.3,47.53 -42.39,47.53 h -4.43 v 52.5 H 287.71 V 12.36 H 318 c 27.7,0 40.29,11.71 40.29,42.74 z m -25,2.13 c 0,-21.64 -3.9,-26.78 -17.38,-26.78 h -4.43 v 60.48 h 4.08 c 12.77,0 17.74,-9.22 17.74,-29.26 z m 81.22,-6.56 -1.24,28.2 c -10.11,-2.13 -18.45,-0.53 -22.17,6 v 76.26 H 367.52 V 52.44 h 18.8 L 388.45,76 h 0.89 c 2.48,-17.2 10.46,-25.89 20.75,-25.89 a 22.84,22.84 0 0 1 4.42,0.56 z M 441.64,115 v 5.5 c 0,19.16 1.06,25.72 9.22,25.72 7.8,0 9.58,-6 9.75,-18.44 l 21.1,1.24 c 1.6,23.41 -10.64,33.87 -31.39,33.87 -25.18,0 -32.63,-16.49 -32.63,-46.46 v -19 c 0,-31.57 8.34,-47 33.34,-47 25.18,0 31.57,13.12 31.57,45.93 V 115 Z m 0,-22.35 v 7.8 h 17.91 V 92.7 c 0,-20 -1.42,-25.72 -9,-25.72 -7.58,0 -8.91,5.86 -8.91,25.72 z M 604.45,79 v 82.11 H 580 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8.16,2.48 -10.82,7.09 a 35.59,35.59 0 0 1 0.18,4.43 v 82.11 H 537.24 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8,2.48 -10.64,6.92 v 86.72 H 494.5 V 52.44 h 19.33 L 516,66.28 h 0.35 c 5.5,-10.46 14.37,-16.14 24.83,-16.14 10.29,0 16.14,5.14 18.8,14.37 5.68,-9.4 14.19,-14.37 23.94,-14.37 14.86,0 20.53,10.64 20.53,28.86 z m 12.24,-54.4 c 0,-11.71 4.26,-15.07 13.3,-15.07 9.22,0 13.3,3.9 13.3,15.07 0,12.06 -4.08,15.08 -13.3,15.08 -9.04,-0.01 -13.3,-3.02 -13.3,-15.08 z m 1.42,27.84 h 23.41 v 108.72 h -23.41 z m 103.39,0 v 108.72 h -19.15 l -2.13,-13.3 h -0.53 c -5.5,10.64 -13.48,15.07 -23.41,15.07 -14.54,0 -21.11,-9.22 -21.11,-29.26 V 52.44 h 24.47 v 79.81 c 0,9.58 2,13.48 6.92,13.48 A 12.09,12.09 0 0 0 697,138.81 V 52.44 Z M 845.64,79 v 82.11 H 821.17 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8.16,2.48 -10.82,7.09 A 35.59,35.59 0 0 1 802.9,79 v 82.11 H 778.43 V 80.82 c 0,-8.87 -2.31,-13.3 -7.63,-13.3 -4.26,0 -8,2.48 -10.64,6.92 v 86.72 H 735.69 V 52.44 H 755 l 2.13,13.83 h 0.35 c 5.5,-10.46 14.37,-16.14 24.83,-16.14 10.29,0 16.14,5.14 18.8,14.37 5.68,-9.4 14.19,-14.37 23.94,-14.37 14.95,0.01 20.59,10.65 20.59,28.87 z' /%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/svg%3E%0A") !important; }`;
                }

                // This is the combined CSS for padded video info sections, which is the default
                if (appState.settings.modernDarkVideoInfoStyle) {
                    css += `
                        ytd-item-section-renderer.ytd-watch-next-secondary-results-renderer { background-color: var(--bg-1-200); padding: 15px; border-radius: var(--round20); }
                        #below { background-color: var(--bg-1-200); padding: 15px; margin: 15px 0; border-radius: var(--round20); }
                    `;
                }


                this._styleElement = document.createElement('style');
                this._styleElement.id = `yt-suite-style-${this.id}`;
                this._styleElement.textContent = css;
                document.head.appendChild(this._styleElement);
            },
            init() {
                this._updateStyles();
            },
            destroy() {
                this._styleElement?.remove();
            }
        },
        { id: 'modernDarkVideoInfoStyle', name: 'Padded Video Sections', description: 'Adds padding and a background to the video description and related videos sections.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        { id: 'modernDarkBlur', name: 'Enable Blur Effects', description: 'Adds a blur effect to popups, menus, and other UI elements.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        { id: 'modernDarkFakePremium', name: 'Enable "Premium" Logo', description: 'Replaces the default YouTube logo with the Premium version.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        { id: 'modernDarkEnablePip', name: 'Enable Hidden PiP Button', description: 'Forces the Picture-in-Picture button to be visible in the player controls.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        { id: 'modernDarkZenMode', name: 'Enable Zen Mode', description: 'Hides the right sidebar (related videos, chat) for a focused view of the video player.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        { id: 'modernDarkHideBranding', name: 'Hide In-Video Channel Branding', description: 'Hides the small channel watermark/branding that appears in the corner of videos.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        { id: 'modernDarkDisableProgressGradient', name: 'Disable Progress Bar Gradient', description: 'Changes the video progress bar from a red-to-pink gradient to solid red.', group: 'Themes', isSubFeature: true, init() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() }, destroy() { features.find(f=>f.id==='modernDarkTheme')._updateStyles() } },
        // END: NEW MODERN DARK THEME
        {
            id: 'squarify',
            name: 'Squarify',
            description: 'Removes rounded corners from most elements for a sharper look.',
            group: 'Themes',
            _styleElement: null,
            init() {
                const css = `* { border-radius: 0 !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },

        // Group: Progress Bar Themes
        {
            id: 'nyanCatProgressBar',
            name: 'Nyan Cat Progress Bar',
            description: 'Replaces the video progress bar with the one and only Nyan Cat.',
            group: 'Progress Bar Themes',
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('nyanCatProgressBar');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                } else {
                    console.error('[YT Suite] Could not load nyanCatProgressBar resource. Make sure the @resource URL is correct and accessible.');
                }
            },
            destroy() {
                this._styleElement?.remove();
            }
        },


        // Group: General Content
        {
            id: 'removeAllShorts',
            name: 'Remove All Shorts Videos',
            description: 'Removes all Shorts videos from any page (Home, Subscriptions, Search, etc.).',
            group: 'General Content',
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
            name: 'Redirect Shorts to Standard Player',
            description: 'Automatically redirects any Shorts video to the normal watch page.',
            group: 'General Content',
            init() {
                const redirectRule = () => {
                    if (window.location.pathname.startsWith('/shorts/')) {
                        window.location.href = window.location.href.replace('/shorts/', '/watch?v=');
                    }
                };
                addNavigateRule(this.id, redirectRule);
            },
            destroy() {
                removeNavigateRule(this.id);
            }
        },
        {
            id: 'disablePlayOnHover',
            name: 'Disable Play on Hover',
            description: 'Prevents videos from auto-playing when you hover over their thumbnails.',
            group: 'General Content',
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
            destroy() {
                this._styleElement?.remove();
            }
        },
        {
            id: 'fullWidthSubscriptions',
            name: 'Make Subscriptions Full-Width',
            description: 'Expands the subscription grid to use the full page width.',
            group: 'General Content',
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
            name: 'Hide Subscriptions Layout Options',
            description: 'Hides the "Latest" header and grid/list view options on the Subscriptions page.',
            group: 'General Content',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-browse[page-subtype="subscriptions"] ytd-rich-section-renderer:has(.grid-subheader)', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'fiveVideosPerRow',
            name: '5 Videos Per Row',
            description: 'Changes the video grid layout to show 5 videos per row.',
            group: 'General Content',
            _styleElement: null,
            init() {
                const videosPerRow = 5;
                const css = `
                    #contents.ytd-rich-grid-renderer {
                        --ytd-rich-grid-items-per-row: ${videosPerRow} !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePaidContentOverlay',
            name: 'Hide "Paid promotion" overlay',
            description: 'Hides the "Includes paid promotion" message on video thumbnails.',
            group: 'General Content',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-paid-content-overlay-renderer, ytm-paid-content-overlay-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'redirectToVideosTab',
            name: 'Open Channel Pages on "Videos" Tab',
            description: 'Redirects channel homepages to their "Videos" tab by default.',
            group: 'General Content',
            _mousedownListener: null,
            init() {
                const RX_CHANNEL_HOME = /^(https?:\/\/www\.youtube\.com)((\/(user|channel|c)\/[^/]+)(\/?$|\/featured[^/])|(\/@(?!.*\/)[^/]+))/;
                const DEFAULT_TAB_HREF = "/videos";

                const handleDirectNavigation = () => {
                    if (RX_CHANNEL_HOME.test(location.href)) {
                        const newUrl = RegExp.$2 + DEFAULT_TAB_HREF;
                        if (location.href !== newUrl) {
                            location.href = newUrl;
                        }
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
                if (this._mousedownListener) {
                    document.removeEventListener('mousedown', this._mousedownListener, true);
                }
                removeNavigateRule('channelRedirectorNav');
            }
        },

        // Group: Watch Page - Layout
        {
            id: 'fitPlayerToWindow',
            name: 'Fit Player to Window',
            description: 'Makes the player fill the window, with page content scrolling underneath.',
            group: 'Watch Page - Layout',
            _styleElement: null,
            _ruleId: 'fitPlayerToWindowRule',
            applyStyles() {
                const isWatchPage = window.location.pathname.startsWith('/watch');
                document.documentElement.classList.toggle('yt-suite-fit-to-window', isWatchPage);
                document.body.classList.toggle('yt-suite-fit-to-window', isWatchPage);

                if (isWatchPage) {
                    setTimeout(() => {
                        const watchFlexy = document.querySelector('ytd-watch-flexy:not([theater])');
                        if (watchFlexy) {
                             document.querySelector('button.ytp-size-button')?.click();
                        }
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
            name: 'Hide Related Videos Sidebar',
            description: 'Hides the entire right-hand sidebar containing related videos, chat, etc.',
            group: 'Watch Page - Layout',
            isManagement: true,
            _styleElement: null,
            _subFeatureStyle: null,
            init() {
                this._styleElement = injectStyle('#secondary', this.id);
                if (appState.settings.expandVideoWidth) {
                    this._subFeatureStyle = document.createElement('style');
                    this._subFeatureStyle.id = 'yt-suite-expand-width';
                    this._subFeatureStyle.textContent = `ytd-watch-flexy:not(.yt-suite-fit-to-window) #primary { max-width: none !important; }`;
                    document.head.appendChild(this._subFeatureStyle);
                }
            },
            destroy() {
                this._styleElement?.remove();
                this._subFeatureStyle?.remove();
            }
        },
        {
            id: 'adaptiveLiveLayout',
            name: 'Adaptive Live Video Layout',
            description: 'On live streams, arranges the player and chat side-by-side to maximize player size. Works best with Theater Mode.',
            group: 'Watch Page - Layout',
            _styleElement: null,
            _ruleId: 'adaptiveLiveLayoutRule',
            _applyLayout() {
                const isLive = document.querySelector('ytd-live-chat-frame');
                document.body.classList.toggle('ytkit-adaptive-live', !!isLive);
            },
            init() {
                const css = `
                    body.ytkit-adaptive-live ytd-watch-flexy[theater]:not([fullscreen]) #primary.ytd-watch-flexy,
                    body.ytkit-adaptive-live ytd-watch-flexy:not([theater]):not([fullscreen]) #primary.ytd-watch-flexy {
                        width: calc(100% - var(--ytd-watch-flexy-sidebar-width, 402px));
                        max-width: none !important;
                    }
                    body.ytkit-adaptive-live ytd-watch-flexy[theater]:not([fullscreen]) #secondary.ytd-watch-flexy {
                        margin-top: 0 !important;
                    }
                    body.ytkit-adaptive-live ytd-watch-flexy:not([theater]):not([fullscreen]) #player-container-outer.ytd-watch-flexy {
                        max-width: none !important;
                    }
                    body.ytkit-adaptive-live ytd-live-chat-frame {
                        margin-top: -57px !important;
                        width: 402px !important;
                        height: 100vh !important;
                    }
                    body.ytkit-adaptive-live ytd-watch-metadata.watch-active-metadata {
                        margin-top: 180px !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                addNavigateRule(this._ruleId, this._applyLayout);
            },
            destroy() {
                this._styleElement?.remove();
                removeNavigateRule(this._ruleId);
                document.body.classList.remove('ytkit-adaptive-live');
            }
        },
        {
            id: 'expandVideoWidth',
            name: 'Expand Video Width',
            description: 'When the related videos sidebar is hidden, this expands the video to fill the available space.',
            group: 'Watch Page - Layout',
            isSubFeature: true,
            _styleElement: null,
            init() {
                if (appState.settings.hideRelatedVideos) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = 'yt-suite-expand-width';
                    this._styleElement.textContent = `ytd-watch-flexy:not(.yt-suite-fit-to-window) #primary { max-width: none !important; }`;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() {
                this._styleElement?.remove();
            }
        },
        {
            id: 'floatingLogoOnWatch',
            name: 'Logo in Video Header',
            description: 'On watch pages, adds a YouTube logo (linking to Subscriptions) next to the channel avatar.',
            group: 'Watch Page - Layout',
            init() {
                addNavigateRule(this.id, this.handleLogoDisplay.bind(this));
            },
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
                    if (originalLogo) {
                        link.appendChild(originalLogo.cloneNode(true));
                    }
                    logoEl.appendChild(link);
                    ownerDiv.prepend(logoEl);
                });
            }
        },
        {
            id: 'hideDescriptionRow',
            name: 'Hide Video Description Row',
            description: 'Hides the entire video description, including view count, date, and hashtags.',
            group: 'Watch Page - Layout',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-watch-metadata #bottom-row', this.id); },
            destroy() { this._styleElement?.remove(); }
        },

        // Group: Watch Page - Behavior
        {
            id: 'preventAutoplay',
            name: 'Prevent Autoplay',
            description: 'Stops videos from automatically playing when the page loads.',
            group: 'Watch Page - Behavior',
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
                setTimeout(pauseRule, 500); // For initial load
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
            name: 'Auto Expand Video Description',
            description: 'Automatically expands the video description to show all content.',
            group: 'Watch Page - Behavior',
            init() {
                const expandRule = () => {
                    if (window.location.pathname.startsWith('/watch')) {
                        document.querySelector('ytd-text-inline-expander tp-yt-paper-button#expand')?.click();
                    }
                };
                addNavigateRule(this.id, expandRule);
            },
            destroy() {
                removeNavigateRule(this.id);
            }
        },
        {
            id: 'sortCommentsNewestFirst',
            name: 'Sort Comments to "Newest first"',
            description: 'Automatically changes the comment sort order to "Newest first".',
            group: 'Watch Page - Behavior',
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
                                // Close the menu if option isn't found
                                document.body.click();
                            }
                        }, 200);
                    }
                };
                addNavigateRule(this.id, sortRule);
            },
            destroy() {
                removeNavigateRule(this.id);
            }
        },
        {
            id: 'skipSponsors',
            name: 'SponsorBlock (Enhanced)',
            description: 'Automatically skips sponsored segments and other annoying parts of videos. (Based on sb.js)',
            group: 'Watch Page - Behavior',
            isManagement: true,
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

                if (document.querySelector("#previewbar"))
                    return console.log("[YT Suite] SponsorBlock detected another SB instance, exiting.");

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
                const serverEndpoint = "https://sponsor.ajay.app";
                const url = `${serverEndpoint}/api/skipSegments?videoID=${videoID}&categories=${JSON.stringify(categories)}&actionTypes=${JSON.stringify(actionTypes)}`;

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
                const serverEndpoint = "https://sponsor.ajay.app";
                GM.xmlHttpRequest({
                    method: 'POST',
                    url: `${serverEndpoint}/api/viewedVideoSponsorTime?UUID=${uuid}`
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
                        const fvString = cat => `The entire video is ${cat} and is too tightly integrated to be able to seperate`;
                        const styles = {
                            sponsor: ["#0d0", "#111", fvString("sponsor")],
                            selfpromo: ["#ff0", "#111", fvString("selfpromo")],
                            exclusive_access: ["#085", "#fff", "This video showcases a product, service or location that they've received free or subsidized access to"],
                            poi_highlight: ["#f18", "#fff", `Press ${highlightKey} to skip to the highlight`],
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
                        setTimeout(check, 200);
                    }
                };
                check();
            }
        },
        {
            id: 'hideSponsorBlockLabels',
            name: 'Hide SponsorBlock Labels in Title',
            description: 'Hides the labels (e.g., "sponsor", "poi") that appear next to the video title.',
            group: 'Watch Page - Behavior',
            isSubFeature: true,
            _styleElement: null,
            init() {
                this._styleElement = injectStyle('[id^="sbjs-label-"]', this.id);
            },
            destroy() {
                this._styleElement?.remove();
            }
        },


        // Group: Watch Page - Other Elements
        { id: 'hideMerchShelf', name: 'Hide Merch Shelf', description: 'Hides the merchandise shelf that appears below the video.', group: 'Watch Page - Other Elements', _styleElement: null, init() { this._styleElement = injectStyle('ytd-merch-shelf-renderer', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'hideClarifyBoxes',
            name: 'Hide Clarify Boxes',
            description: 'Hides information panels (e.g., for COVID, elections) that appear below videos.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() { this._styleElement = injectStyle('#clarify-box', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'hideDescriptionExtras', name: 'Hide Description Extras', description: 'Hides extra content below the description like transcripts, podcasts, etc.', group: 'Watch Page - Other Elements', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata [slot="extra-content"]', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'hideHashtags',
            name: 'Hide Hashtags',
            description: 'Hides hashtags shown below the video title.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() {
                const css = `ytd-watch-metadata[description-collapsed] #description.ytd-watch-metadata a.yt-simple-endpoint[href^="/hashtag/"] { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hidePinnedComments',
            name: 'Hide Pinned Comments',
            description: 'Hides the pinned comment thread on video watch pages.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() {
                const css = `ytd-comment-view-model[pinned], ytd-comment-thread-renderer:has(ytd-comment-view-model[pinned]) { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideCommentActionMenu',
            name: 'Hide Comment Action Menu',
            description: 'Hides the three-dot action menu on individual comments.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() { this._styleElement = injectStyle('ytd-comment-view-model #action-menu', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideLiveChatEngagement',
            name: 'Hide Live Chat Engagement',
            description: 'Removes "Welcome to live chat!" and other engagement messages.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            _ruleId: 'hideLiveChatEngagementRule',
            _runRemoval() {
                document.querySelectorAll('yt-live-chat-viewer-engagement-message-renderer').forEach(el => el.remove());
            },
            init() {
                const css = `yt-live-chat-viewer-engagement-message-renderer { display: none !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
                addMutationRule(this._ruleId, this._runRemoval);
            },
            destroy() {
                this._styleElement?.remove();
                removeMutationRule(this._ruleId);
            }
        },
        {
            id: 'hidePaidPromotionWatch',
            name: 'Hide Paid Promotion Overlay',
            description: 'Hides the "Includes paid promotion" overlay on the video player itself.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() { this._styleElement = injectStyle('.ytp-paid-content-overlay', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVideoEndCards',
            name: 'Hide Video End Cards',
            description: 'Hides the interactive cards that appear over the video near the end.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() { this._styleElement = injectStyle('.ytp-ce-element', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVideoEndScreen',
            name: 'Hide Video End Screen',
            description: 'Hides the grid of suggested videos that appears when a video finishes.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() {
                const css = `
                    .html5-endscreen.videowall-endscreen { display: none !important; }
                    .ended-mode .ytp-cued-thumbnail-overlay:not([aria-hidden="true"]) { display: block !important; }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },

        // Group: Watch Page - Live Chat
        { id: 'hideLiveChatHeader', name: 'Hide Live Chat Header', description: 'Hides the entire header bar at the top of the live chat.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-header-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatMenu', name: 'Hide Chat Menu Button (3-dot)', description: 'Hides the three-dot menu at the top of live chat.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-header-renderer #menu-button', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hidePopoutChatButton', name: 'Hide "Popout chat" Button', description: 'Hides the "Popout chat" button inside the chat menu.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('ytd-menu-service-item-renderer:has(yt-formatted-string:contains("Popout chat"))', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatReactionsButton', name: 'Hide "Reactions" Toggle', description: 'Hides the "Reactions" toggle inside the chat menu.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-toggle-renderer:has(span:contains("Reactions"))', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatTimestampsButton', name: 'Hide "Timestamps" Toggle', description: 'Hides the "Timestamps" toggle inside the chat menu.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-toggle-renderer:has(span:contains("Timestamps"))', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatPolls', name: 'Hide Chat Polls', description: 'Hides polls that appear inside the live chat feed.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-poll-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatPollBanner', name: 'Hide Chat Poll Banner', description: 'Hides the banner at the top of chat that announces a poll.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-banner-renderer[is-poll-banner]', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatBanner', name: 'Hide Pinned Announcement Banner', description: 'Hides the pinned announcement banner at the top of chat.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-banner-manager', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatTicker', name: 'Hide Super Chat Ticker', description: 'Hides the ticker bar that shows Super Chats and new members.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-ticker-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideSuperChats', name: 'Hide Super Chats', description: 'Hides all paid Super Chats and Super Stickers from the chat feed.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        {
            id: 'hideLevelUp',
            name: 'Hide "Level Up" Messages',
            description: 'Hides member "Level Up" notifications in live chat.',
            group: 'Watch Page - Live Chat',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-live-chat-membership-item-renderer', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'hideViewerLeaderboard', name: 'Hide Viewer Leaderboard', description: 'Hides the viewer leaderboard button in the chat header.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('#viewer-leaderboard-entry-point', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatSupportButtons', name: 'Hide Support/Reaction Buttons', description: 'Hides the "Show your support" and emoji reaction buttons in the input bar.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('#picker-buttons.yt-live-chat-message-input-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideChatEmojiButton', name: 'Hide Emoji Button', description: 'Hides the emoji/emote button in the chat input bar.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('#emoji-picker-button.yt-live-chat-message-input-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        { id: 'hideTopFanIcons', name: 'Hide Top Fan Icons', description: 'Hides the ranked top fan icons next to usernames in chat.', group: 'Watch Page - Live Chat', _styleElement: null, init() { this._styleElement = injectStyle('#before-content-buttons.yt-live-chat-text-message-renderer', this.id); }, destroy() { this._styleElement?.remove(); } },
        {
            id: 'hideChatBots',
            name: 'Hide Chat Messages from Bots',
            description: 'Hides live chat messages from any user with "bot" in their name (case-insensitive).',
            group: 'Watch Page - Live Chat',
            init() { addMutationRule('botFilterRule', applyBotFilter); },
            destroy() {
                removeMutationRule('botFilterRule');
                document.querySelectorAll('yt-live-chat-text-message-renderer.yt-suite-hidden-bot').forEach(el => {
                    el.classList.remove('yt-suite-hidden-bot');
                    el.style.display = '';
                });
            }
        },
        {
            id: 'keywordFilterList', name: 'Keyword-Based Chat Filter', description: 'Hides chat messages containing any of these comma-separated words.', group: 'Watch Page - Live Chat', type: 'textarea',
            init() { addMutationRule('keywordFilterRule', applyKeywordFilter); },
            destroy() {
                removeMutationRule('keywordFilterRule');
                document.querySelectorAll('yt-live-chat-text-message-renderer.yt-suite-hidden-keyword').forEach(el => {
                    el.classList.remove('yt-suite-hidden-keyword');
                    el.style.display = '';
                });
            }
        },

        // Group: Watch Page - Action Buttons
        {
            id: 'autolikeVideos',
            name: 'Autolike Videos',
            description: 'Automatically likes videos from channels you are subscribed to.',
            group: 'Watch Page - Action Buttons',
            _observer: null,
            init() {
                const ytLiker = () => {
                    const subscribeButton = document.querySelector('#subscribe-button-shape .yt-core-attributed-string--white-space-no-wrap');
                    const likeButton = document.querySelector('ytd-watch-metadata like-button-view-model button');
                    if (!subscribeButton || subscribeButton.innerHTML !== 'Subscribed') return;
                    if (likeButton && likeButton.ariaPressed === 'false') likeButton.click();
                };
                const setupObserver = () => {
                    this._observer = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            if (mutation.type === "attributes" && mutation.attributeName === 'video-id') {
                                setTimeout(ytLiker, 2000);
                            }
                        }
                    });
                    const targetNode = document.querySelector('ytd-watch-flexy');
                    if (targetNode) this._observer.observe(targetNode, { attributes: true, attributeFilter: ['video-id'] });
                };
                setTimeout(() => { ytLiker(); setupObserver(); }, 3000);
            },
            destroy() { if (this._observer) this._observer.disconnect(); }
        },
        { id: 'hideLikeButton', name: 'Hide Like Button', description: 'Hides the Like button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner .yt-like-button-view-model, ytd-watch-metadata like-button-view-model', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideDislikeButton', name: 'Hide Dislike Button', description: 'Hides the Dislike button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner .yt-dislike-button-view-model, ytd-watch-metadata dislike-button-view-model', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideShareButton', name: 'Hide Share Button', description: 'Hides the Share button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('yt-button-view-model:has(button[aria-label="Share"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'hideAskButton',
            name: 'Hide "Ask" Button',
            description: 'Hides the "Ask" button for video Q&A.',
            group: 'Watch Page - Action Buttons',
            _styleElement: null,
            init() { this._styleElement = injectStyle('yt-button-view-model:has(button[aria-label="Ask"])', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'hideClipButton', name: 'Hide Clip Button', description: 'Hides the Clip button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('yt-button-view-model:has(button[aria-label="Clip"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideThanksButton', name: 'Hide Thanks Button', description: 'Hides the Thanks button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('yt-button-view-model:has(button[aria-label="Thanks"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSaveButton', name: 'Hide Save Button', description: 'Hides the "Save to playlist" button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('yt-button-view-model:has(button[aria-label="Save to playlist"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'replaceWithCobaltDownloader',
            name: 'Replace with Cobalt Downloader',
            description: 'Replaces the native YouTube download button with a custom downloader using Cobalt.',
            group: 'Watch Page - Action Buttons',
            _styleElement: null,
            _getFrontendUrl() { return `https://cobalt.meowing.de/#`; },
            _isWatchPage() { return window.location.pathname.startsWith('/watch'); },
            _injectButton() {
                if (!this._isWatchPage()) return;
                waitForElement('#actions-inner #end-buttons, #top-level-buttons-computed', (parent) => {
                    if (document.querySelector('button[id^="cobaltBtn"]')) return;
                    const id = 'cobaltBtn' + Math.random().toString(36).substr(2, 5);
                    const btn = document.createElement('button');
                    btn.id = id; btn.textContent = 'Download';
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
                const cobaltBtn = document.querySelector('button[id^="cobaltBtn"]');
                if (cobaltBtn) cobaltBtn.remove();
                this._styleElement?.remove();
            }
        },
        { id: 'hideSponsorButton', name: 'Hide Join/Sponsor Button', description: 'Hides the channel membership "Join" button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#sponsor-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMoreActionsButton', name: 'Hide "More actions" (3-dot) Button', description: 'Hides the three-dots "More actions" menu button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner #button-shape > button[aria-label="More actions"]', this.id); }, destroy() { this._styleElement?.remove(); }},

        // Group: Player
        {
            id: 'playerEnhancements',
            name: 'Player Enhancements (Loop, Screenshot)',
            description: 'Adds handy buttons for looping and capturing screenshots from the player.',
            group: 'Player',
            _styleElement: null,
            _observer: null,
            _contextMenuListener: null,

            _iconUtils: {
                createBaseSVG(viewBox, fill = '#e8eaed') {
                    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svg.setAttribute('viewBox', viewBox);
                    svg.setAttribute('fill', fill);
                    svg.setAttribute('width', '100%');
                    svg.setAttribute('height', '100%');
                    return svg;
                },
                paths: {
                    loopPath: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
                    screenshotPath: 'M20 5h-3.17L15 3.17V2H9v1.17L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-3 12H7a.5.5 0 0 1-.4-.8l2-2.67c.2-.27.6-.27.8 0L11.25 16l2.6-3.47c.2-.27.6-.27.8 0l2.75 3.67a.5.5 0 0 1-.4.8',
                    copyScreenshotPath: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'
                },
                createLoopIcon() {
                    const svg = this.createBaseSVG('0 0 24 24');
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', this.paths.loopPath);
                    svg.appendChild(path);
                    return svg;
                },
                createSaveScreenshotIcon() {
                    const svg = this.createBaseSVG('0 0 24 24');
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', this.paths.screenshotPath);
                    svg.appendChild(path);
                    return svg;
                },
                createCopyScreenshotIcon() {
                    const svg = this.createBaseSVG('0 0 24 24');
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', this.paths.copyScreenshotPath);
                    svg.appendChild(path);
                    return svg;
                }
            },

            _buttonUtils: {
                getVideoId() {
                    const urlParams = new URLSearchParams(window.location.search);
                    return urlParams.get('v') || window.location.pathname.split('/').pop();
                },
                async getVideoTitle() {
                    try {
                        if (window.ytInitialPlayerResponse?.videoDetails?.title) {
                            return window.ytInitialPlayerResponse.videoDetails.title;
                        }
                        return 'YouTube_Screenshot';
                    } catch (error) {
                        return 'YouTube_Screenshot';
                    }
                },
                formatTime(time) {
                    const date = new Date();
                    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const timeString = [Math.floor(time / 3600), Math.floor((time % 3600) / 60), Math.floor(time % 60)].map(v => String(v).padStart(2, '0')).join('-');
                    return `${dateString}_${timeString}`;
                },
                async captureScreenshot(action = 'download') {
                    const player = document.querySelector('.html5-main-video');
                    if (!player) return;

                    const canvas = document.createElement("canvas");
                    canvas.width = player.videoWidth;
                    canvas.height = player.videoHeight;
                    canvas.getContext('2d').drawImage(player, 0, 0, canvas.width, canvas.height);

                    const title = await this.getVideoTitle();
                    const filename = `${title}_${this.formatTime(player.currentTime)}.png`;

                    canvas.toBlob(async (blob) => {
                        if (action === 'copy') {
                            try {
                                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                                createToast('Screenshot copied to clipboard!', 'success');
                            } catch (e) {
                                createToast('Failed to copy screenshot.', 'error');
                                console.error(e);
                            }
                        } else {
                            GM_download({ url: URL.createObjectURL(blob), name: filename, saveAs: true });
                            createToast('Screenshot download started!', 'success');
                        }
                    }, 'image/png');
                }
            },

            init() {
                const buttonCSS = `
                    .yt-suite-enhancer-btn {
                        height: 25px;
                        width: 25px;
                    }
                    .yt-suite-enhancer-btn svg { fill: #fff; }
                    .yt-suite-enhancer-btn:hover svg { fill: #ff0000; }
                    .yt-suite-enhancer-btn.active svg { fill: #3ea6ff; }
                    .yt-suite-enhancer-btn.clicked svg { animation: suite-enhancer-click-anim 0.5s; }
                    @keyframes suite-enhancer-click-anim { 0%, 100% { fill: #fff; } 50% { fill: #0f9d58; } }
                `;
                this._styleElement = injectStyle(buttonCSS, 'playerEnhancements-style', true);
                addNavigateRule('playerEnhancementsNav', this.insertButtons.bind(this));
            },

            destroy() {
                this._styleElement?.remove();
                this._observer?.disconnect();
                this._observer = null;
                const video = document.querySelector('.html5-main-video');
                if (video && this._contextMenuListener) video.removeEventListener('contextmenu', this._contextMenuListener);
                this._contextMenuListener = null;
                document.querySelector('.yt-suite-enhancer-loop-btn')?.remove();
                document.querySelector('.yt-suite-enhancer-save-btn')?.remove();
                document.querySelector('.yt-suite-enhancer-copy-btn')?.remove();
                removeNavigateRule('playerEnhancementsNav');
            },

            insertButtons() {
                if (!window.location.pathname.startsWith('/watch')) return;

                waitForElement('.ytp-right-controls', (controls) => {
                    if (document.querySelector('.yt-suite-enhancer-loop-btn')) return;

                    const settingsButton = controls.querySelector('.ytp-settings-button');
                    const createButton = (className, title, icon, clickHandler) => {
                        const btn = document.createElement('button');
                        btn.className = `ytp-button yt-suite-enhancer-btn ${className}`;
                        btn.title = title;
                        btn.appendChild(icon);
                        btn.addEventListener('click', clickHandler);
                        return btn;
                    };

                    const loopBtn = createButton('yt-suite-enhancer-loop-btn', 'Loop Video', this._iconUtils.createLoopIcon(), this.toggleLoopState.bind(this));
                    const saveBtn = createButton('yt-suite-enhancer-save-btn', 'Save Screenshot', this._iconUtils.createSaveScreenshotIcon(), this.handleScreenshotClick.bind(this, 'download'));
                    const copyBtn = createButton('yt-suite-enhancer-copy-btn', 'Copy Screenshot', this._iconUtils.createCopyScreenshotIcon(), this.handleScreenshotClick.bind(this, 'copy'));

                    if (settingsButton) {
                        controls.insertBefore(loopBtn, settingsButton);
                        controls.insertBefore(saveBtn, settingsButton);
                        controls.insertBefore(copyBtn, settingsButton);
                    } else {
                        controls.appendChild(loopBtn);
                        controls.appendChild(saveBtn);
                        controls.appendChild(copyBtn);
                    }

                    this.addLoopObserver();
                });
            },

            toggleLoopState() {
                const video = document.querySelector('.html5-main-video');
                if (!video) return;
                video.loop = !video.loop;
                this.updateLoopControls();
            },

            updateLoopControls() {
                const video = document.querySelector('.html5-main-video');
                const loopButton = document.querySelector('.yt-suite-enhancer-loop-btn');
                if (!video || !loopButton) return;

                const isActive = video.loop;
                loopButton.classList.toggle('active', isActive);
                loopButton.setAttribute('title', isActive ? 'Stop Looping' : 'Loop Video');
            },

            addLoopObserver() {
                const video = document.querySelector('.html5-main-video');
                if (!video) return;

                this.updateLoopControls(); // Initial check

                this._observer = new MutationObserver(() => this.updateLoopControls());
                this._observer.observe(video, { attributes: true, attributeFilter: ['loop'] });

                this._contextMenuListener = () => {
                    setTimeout(() => {
                        const checkbox = document.querySelector('.ytp-menuitem[role="menuitemcheckbox"]');
                        if (checkbox) {
                            checkbox.setAttribute('aria-checked', video.loop);
                            checkbox.addEventListener('click', () => this.toggleLoopState(), { once: true });
                        }
                    }, 50);
                };
                video.addEventListener('contextmenu', this._contextMenuListener);
            },

            handleScreenshotClick(event, action) {
                const button = event.currentTarget;
                button.classList.add('clicked');
                setTimeout(() => button.classList.remove('clicked'), 500);
                this._buttonUtils.captureScreenshot(action);
            }
        },

        // Group: Watch Page - Player Controls
        {
            id: 'autoMaxResolution',
            name: 'Auto Max Resolution',
            description: 'Automatically sets the video quality to the highest available resolution.',
            group: 'Watch Page - Player Controls',
            isManagement: true,
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
                if (this._onPlayerUpdated) {
                    window.removeEventListener('yt-player-updated', this._onPlayerUpdated, true);
                }
                this._styleElement?.remove();
                this._lastProcessedVideoId = null;
            },

            setMaxQuality(player) {
                const currentVideoId = (new URLSearchParams(window.location.search)).get('v');
                if (!player || !currentVideoId || currentVideoId === this._lastProcessedVideoId) {
                    return;
                }

                if (typeof player.getAvailableQualityLevels !== 'function') return;
                const levels = player.getAvailableQualityLevels();
                if (!levels || !levels.length) return;

                this._lastProcessedVideoId = currentVideoId;
                const best = levels[0];
                try {
                    player.setPlaybackQualityRange(best);
                } catch (e) { /* ignore */ }

                if (best.includes('1080') && appState.settings.useEnhancedBitrate) {
                    const settingsButton = document.querySelector('.ytp-settings-button');
                    if (!settingsButton) return;

                    settingsButton.click(); // Open settings

                    setTimeout(() => {
                        const qualityMenu = Array.from(document.querySelectorAll('.ytp-menuitem-label')).find(el => el.textContent.includes('Quality'));
                        if (qualityMenu) {
                            qualityMenu.parentElement.click();

                            setTimeout(() => {
                                const premiumOption = Array.from(document.querySelectorAll('.ytp-menuitem-label')).find(label => label.textContent.includes('1080p Premium'));
                                if (premiumOption) {
                                    premiumOption.parentElement.click();
                                } else {
                                    const backButton = document.querySelector('.ytp-panel-back-button');
                                    if(backButton) backButton.click();
                                }
                                setTimeout(() => {
                                    if (document.querySelector('.ytp-popup.ytp-settings-menu')) {
                                        settingsButton.click();
                                    }
                                }, 500);
                            }, 400);
                        } else {
                            if (document.querySelector('.ytp-popup.ytp-settings-menu')) {
                                settingsButton.click();
                            }
                        }
                    }, 400);
                }
            }
        },
        {
            id: 'useEnhancedBitrate',
            name: 'Use Enhanced Bitrate (for Premium users)',
            description: 'If max resolution is 1080p, attempts to select the "Premium" enhanced bitrate option. Requires YouTube Premium.',
            group: 'Watch Page - Player Controls',
            isSubFeature: true,
            init() {},
            destroy() {}
        },
        {
            id: 'hideQualityPopup',
            name: 'Hide Quality Popup',
            description: 'Prevents the quality selection menu from appearing visually when auto-quality is active.',
            group: 'Watch Page - Player Controls',
            isSubFeature: true,
            init() {},
            destroy() {}
        },
        {
            id: 'hideSponsorBlockButton',
            name: 'Hide SponsorBlock Button',
            description: 'Hides the SponsorBlock icon from the player controls.',
            group: 'Watch Page - Player Controls',
            _styleElement: null,
            init() { this._styleElement = injectStyle('button.playerButton[title*="SponsorBlock"]', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'hideNextButton', name: 'Hide "Next video" Button', description: 'Hides the next video button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-next-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideAutoplayToggle', name: 'Hide Autoplay Toggle', description: 'Hides the autoplay toggle in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-autonav-toggle-button-container', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSubtitlesToggle', name: 'Hide Subtitles Toggle', description: 'Hides the subtitles/CC button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-subtitles-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'hideCaptionsContainer',
            name: 'Hide Captions Box',
            description: 'Hides the container box for subtitles/captions on the video.',
            group: 'Watch Page - Player Controls',
            _styleElement: null,
            init() { this._styleElement = injectStyle('.ytp-caption-window-container', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        { id: 'hideMiniplayerButton', name: 'Hide Miniplayer Button', description: 'Hides the miniplayer button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-miniplayer-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hidePipButton', name: 'Hide Picture-in-Picture Button', description: 'Hides the Picture-in-Picture button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-pip-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideTheaterButton', name: 'Hide Theater Mode Button', description: 'Hides the theater mode button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-size-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideFullscreenButton', name: 'Hide Fullscreen Button', description: 'Hides the fullscreen button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-fullscreen-button', this.id); }, destroy() { this._styleElement?.remove(); }},

        // ——————————————————————————————————————————————————————————————————————————
        // Group: Modules (Newly Integrated)
        // ——————————————————————————————————————————————————————————————————————————
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
                // Store original functions before overwriting
                this._originals.setTimeout = window.setTimeout;
                this._originals.setInterval = window.setInterval;
                this._originals.clearTimeout = window.clearTimeout;
                this._originals.clearInterval = window.clearInterval;

                // Encapsulate and run the CPU Tamer logic
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
                // Restore original functions
                if (this._originals.setTimeout) window.setTimeout = this._originals.setTimeout;
                if (this._originals.setInterval) window.setInterval = this._originals.setInterval;
                if (this._originals.clearTimeout) window.clearTimeout = this._originals.clearTimeout;
                if (this._originals.clearInterval) window.clearInterval = this._originals.clearInterval;
                window.yt_cpu_tamer_by_animationframe = false; // Flag to allow re-initialization
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
                                        nameMap.set(handle, null); // Prevent duplicate fetches
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
                addNavigateRule('yout-ube-redirector', this._urlChangeListener);
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

    function injectStyle(selector, featureId, isRawCss = false) {
        const style = document.createElement('style');
        style.id = `yt-suite-style-${featureId}`;
        style.textContent = isRawCss ? selector : `${selector} { display: none !important; }`;
        document.head.appendChild(style);
        return style;
    }

    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 3: DOM HELPERS & CORE UI LOGIC
    // ——————————————————————————————————————————————————————————————————————————
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

// ——————————————————————————————————————————————————————————————————————————
// SECTION 4: UI & SETTINGS PANEL
// ——————————————————————————————————————————————————————————————————————————

const ICONS = {
    cog: { viewBox: '0 0 24 24', strokeWidth: 2, paths: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M12 2v2', 'M12 22v-2', 'm17 20.66-1-1.73', 'M11 10.27 7 3.34', 'm20.66 17-1.73-1', 'm3.34 7 1.73 1', 'M14 12h8', 'M2 12h2', 'm20.66 7-1.73 1', 'm3.34 17 1.73-1', 'm17 3.34-1 1.73', 'M11 13.73 7 20.66'] },
    close: { viewBox: '0 0 24 24', strokeWidth: 2.5, paths: ['M18 6 6 18', 'M6 6l12 12'] },
    github: { viewBox: '0 0 24 24', fill: 'currentColor', paths: ['M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z'] },
    upload: { viewBox: '0 0 24 24', strokeWidth: 2, paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8 12 3 7 8', 'M12 3v15'] },
    download: { viewBox: '0 0 24 24', strokeWidth: 2, paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'] },
    ytLogo: { viewBox: '0 0 28 20', paths: [{ d: "M27.5 3.1s-.3-2.2-1.3-3.2C25.2-1 24.1-.1 23.6-.1 19.8 0 14 0 14 0S8.2 0 4.4-.1c-.5 0-1.6 0-2.6 1-1 .9-1.3 3.2-1.3 3.2S0 5.4 0 7.7v4.6c0 2.3.4 4.6.4 4.6s.3 2.2 1.3 3.2c1 .9 2.3 1 2.8 1.1 2.5.2 9.5.2 9.5.2s5.8 0 9.5-.2c.5-.1 1.8-0.2 2.8-1.1 1-.9 1.3-3.2 1.3-3.2s.4-2.3.4-4.6V7.7c0-2.3-.4-4.6-.4-4.6z", fill: '#FF0000'}, { d: "M11.2 14.6V5.4l8 4.6-8 4.6z", fill: 'white'}] },
};

function createIcon(iconData) {
    if (!iconData) return null;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute('viewBox', iconData.viewBox);
    if (iconData.strokeWidth) {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', iconData.strokeWidth);
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
    } else {
        svg.setAttribute('fill', iconData.fill || 'currentColor');
    }

    iconData.paths.forEach(pathData => {
        const path = document.createElementNS(svgNS, 'path');
        if (typeof pathData === 'string') {
            path.setAttribute('d', pathData);
        } else { // Handle object path for fills
            path.setAttribute('d', pathData.d);
            if(pathData.fill) path.setAttribute('fill', pathData.fill);
        }
        svg.appendChild(path);
    });
    return svg;
}

function injectSettingsButton() {
    const handleDisplay = () => {
        // First, remove any buttons from the previous page view
        document.getElementById('ytkit-masthead-button-container')?.remove();
        document.getElementById('ytkit-watch-button-container')?.remove();

        const isWatchPage = window.location.pathname.startsWith('/watch');

        const createButton = () => {
            const btn = document.createElement('button');
            btn.className = 'ytkit-settings-button'; // Use a class for styling
            btn.title = 'YTKit Settings (Ctrl+Alt+Y)';
            btn.appendChild(createIcon(ICONS.cog));
            btn.onclick = () => document.body.classList.toggle('ytkit-panel-open');
            return btn;
        };

        if (isWatchPage) {
            waitForElement('#top-row #owner', (ownerDiv) => {
                if (document.getElementById('ytkit-watch-button-container')) return;
                const container = document.createElement('div');
                container.id = 'ytkit-watch-button-container';
                container.appendChild(createButton());

                const logo = document.getElementById('yt-suite-watch-logo');
                if (logo && logo.parentElement === ownerDiv) {
                    // Insert after the floating logo
                    ownerDiv.insertBefore(container, logo.nextSibling);
                } else {
                    // Otherwise, put it at the start
                    ownerDiv.prepend(container);
                }
            });
        } else {
            waitForElement('ytd-masthead #end', (mastheadEnd) => {
                if (document.getElementById('ytkit-masthead-button-container')) return;
                const container = document.createElement('div');
                container.id = 'ytkit-masthead-button-container';
                container.appendChild(createButton());
                mastheadEnd.prepend(container);
            });
        }
    };
    addNavigateRule("settingsButtonRule", handleDisplay);
}


function buildSettingsPanel() {
    if (document.getElementById('ytkit-settings-panel')) return;

    const categoryOrder = [ 'Header', 'Sidebar', 'Themes', 'Progress Bar Themes', 'General Content', 'Watch Page - Layout', 'Watch Page - Behavior', 'Watch Page - Other Elements', 'Watch Page - Live Chat', 'Watch Page - Action Buttons', 'Player', 'Watch Page - Player Controls', 'Modules' ];
    const featuresByCategory = categoryOrder.reduce((acc, cat) => ({...acc, [cat]: []}), {});
    features.forEach(f => { if (f.group && featuresByCategory[f.group]) featuresByCategory[f.group].push(f); });

    const overlay = document.createElement('div');
    overlay.id = 'ytkit-panel-overlay';
    overlay.onclick = () => document.body.classList.remove('ytkit-panel-open');

    const panel = document.createElement('div');
    panel.id = 'ytkit-settings-panel';
    panel.setAttribute('role', 'dialog');

    const header = document.createElement('div');
    header.className = 'ytkit-settings-header';
    const headerTitle = document.createElement('div');
    headerTitle.className = 'ytkit-header-title';
    headerTitle.id = 'ytkit-panel-title';

    const logoIcon = createIcon(ICONS.ytLogo);
    if (logoIcon) {
        logoIcon.style.width = '32px';
        logoIcon.style.height = '32px';
        headerTitle.appendChild(logoIcon);
    }

    const h2 = document.createElement('h2');
    const brandSpan = document.createElement('span');
    brandSpan.className = 'ytkit-header-brand';
    brandSpan.textContent = 'YTKit';
    h2.appendChild(brandSpan);
    headerTitle.appendChild(h2);

    const closeButton = document.createElement('button');
    closeButton.id = 'ytkit-close-settings';
    closeButton.className = 'ytkit-header-button';
    closeButton.title = 'Close (Esc)';
    closeButton.appendChild(createIcon(ICONS.close));
    header.appendChild(headerTitle);
    header.appendChild(closeButton);

    const body = document.createElement('div');
    body.className = 'ytkit-settings-body';
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'ytkit-settings-tabs';
    const contentContainer = document.createElement('div');
    contentContainer.className = 'ytkit-settings-content';

    categoryOrder.forEach((cat, index) => {
        const categoryFeatures = featuresByCategory[cat];
        if (!categoryFeatures || categoryFeatures.length === 0) return;

        const catId = cat.replace(/ /g, '-').replace(/&/g, 'and');
        const tabBtn = document.createElement('button');
        tabBtn.className = 'ytkit-tab-btn';
        if (index === 0) tabBtn.classList.add('active');
        tabBtn.dataset.tab = catId;
        tabBtn.textContent = cat;
        tabsContainer.appendChild(tabBtn);

        const pane = document.createElement('div');
        pane.id = `ytkit-pane-${catId}`;
        pane.className = 'ytkit-settings-pane';
        if (index === 0) pane.classList.add('active');

        const toggleAllRow = document.createElement('div');
        toggleAllRow.className = 'ytkit-setting-row ytkit-toggle-all-row';
        toggleAllRow.dataset.categoryId = catId;
        const toggleAllText = document.createElement('div');
        toggleAllText.className = 'ytkit-setting-row-text';
        const toggleAllLabel = document.createElement('label');
        toggleAllLabel.htmlFor = `ytkit-toggle-all-${catId}`;
        toggleAllLabel.textContent = 'Toggle All';
        const toggleAllSmall = document.createElement('small');
        toggleAllSmall.textContent = `Enable or disable all settings in this category.`;
        toggleAllText.appendChild(toggleAllLabel);
        toggleAllText.appendChild(toggleAllSmall);
        toggleAllRow.appendChild(toggleAllText);
        const toggleAllSwitch = document.createElement('label');
        toggleAllSwitch.className = 'ytkit-switch';
        const toggleAllInput = document.createElement('input');
        toggleAllInput.type = 'checkbox';
        toggleAllInput.id = `ytkit-toggle-all-${catId}`;
        toggleAllInput.className = 'ytkit-toggle-all-cb';
        const toggleAllSlider = document.createElement('span');
        toggleAllSlider.className = 'ytkit-slider';
        toggleAllSwitch.appendChild(toggleAllInput);
        toggleAllSwitch.appendChild(toggleAllSlider);
        toggleAllRow.appendChild(toggleAllSwitch);
        pane.appendChild(toggleAllRow);

        const managementFeatures = categoryFeatures.filter(f => f.isManagement);
        const regularFeatures = categoryFeatures.filter(f => !f.isManagement && !f.isSubFeature);
        const subFeatures = categoryFeatures.filter(f => f.isSubFeature);

        const appendFeatures = (featureList) => {
             featureList.forEach(f => {
                pane.appendChild(buildSettingRow(f));
                const relatedSubFeatures = subFeatures.filter(sf =>
                    (f.id === 'nativeDarkMode' && (sf.id === 'betterDarkMode' || sf.id === 'catppuccinMocha')) ||
                    (f.id === 'skipSponsors' && sf.id === 'hideSponsorBlockLabels') ||
                    (f.id === 'autoMaxResolution' && (sf.id === 'useEnhancedBitrate' || sf.id === 'hideQualityPopup')) ||
                    (f.id === 'hideRelatedVideos' && sf.id === 'expandVideoWidth') ||
                    (f.id === 'enableYoutubetoYout_ube' && (sf.id.startsWith('yout_ube_'))) ||
                    (f.id === 'modernDarkTheme' && (sf.id.startsWith('modernDark')))
                );

                if (relatedSubFeatures.length > 0) {
                    const subPanel = document.createElement('div');
                    subPanel.className = 'ytkit-sub-panel';
                    subPanel.dataset.parentFeature = f.id;
                    relatedSubFeatures.forEach(sf => subPanel.appendChild(buildSettingRow(sf)));
                    pane.appendChild(subPanel);
                }
            });
        };

        appendFeatures(managementFeatures);
        appendFeatures(regularFeatures);
        contentContainer.appendChild(pane);
    });

    body.appendChild(tabsContainer);
    body.appendChild(contentContainer);

    const footer = document.createElement('div');
    footer.className = 'ytkit-settings-footer';
    const footerLeft = document.createElement('div');
    footerLeft.className = 'ytkit-footer-left';
    const githubLink = document.createElement('a');
    githubLink.href = 'https://github.com/SysAdminDoc/YTKit';
    githubLink.target = '_blank';
    githubLink.className = 'ytkit-github-link';
    githubLink.title = 'View on GitHub';
    githubLink.appendChild(createIcon(ICONS.github));
    const versionSpan = document.createElement('span');
    versionSpan.className = 'ytkit-version';
    versionSpan.title = 'Keyboard Shortcut: Ctrl+Alt+Y';
    versionSpan.textContent = 'v5.9';
    footerLeft.appendChild(githubLink);
    footerLeft.appendChild(versionSpan);

    const footerRight = document.createElement('div');
    footerRight.className = 'ytkit-footer-right';
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'ytkit-button-group';

    const importButton = document.createElement('button');
    importButton.id = 'ytkit-import-all-settings';
    importButton.className = 'ytkit-button';
    importButton.title = 'Import all YTKit settings from a file';
    importButton.appendChild(createIcon(ICONS.upload));
    importButton.append(' Import');

    const exportButton = document.createElement('button');
    exportButton.id = 'ytkit-export-all-settings';
    exportButton.className = 'ytkit-button';
    exportButton.title = 'Export all YTKit settings to a file';
    exportButton.appendChild(createIcon(ICONS.download));
    exportButton.append(' Export');

    buttonGroup.appendChild(importButton);
    buttonGroup.appendChild(exportButton);
    footerRight.appendChild(buttonGroup);

    footer.appendChild(footerLeft);
    footer.appendChild(footerRight);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    updateAllToggleStates();
}

function buildSettingRow(f) {
    const row = document.createElement('div');
    row.className = f.isManagement ? 'ytkit-management-row' : (f.isSubFeature ? 'ytkit-setting-row ytkit-sub-setting' : 'ytkit-setting-row');
    row.dataset.featureId = f.id;

    const textDiv = document.createElement('div');
    textDiv.className = 'ytkit-setting-row-text';
    const label = document.createElement('label');
    label.htmlFor = `ytkit-toggle-${f.id}`;
    label.textContent = f.name;
    const small = document.createElement('small');
    small.textContent = f.description;
    textDiv.appendChild(label);
    textDiv.appendChild(small);
    row.appendChild(textDiv);

    if (f.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.id = `ytkit-input-${f.id}`;
        textarea.className = 'ytkit-input';
        textarea.placeholder = 'e.g. word1, phrase two';
        textarea.value = appState.settings[f.id];
        row.appendChild(textarea);
    } else {
        const switchLabel = document.createElement('label');
        switchLabel.className = 'ytkit-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `ytkit-toggle-${f.id}`;
        input.checked = appState.settings[f.id];
        input.className = 'ytkit-feature-cb';
        const slider = document.createElement('span');
        slider.className = 'ytkit-slider';
        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        row.appendChild(switchLabel);
    }
    return row;
}

function createToast(message, type = 'success', duration = 3000) {
    document.querySelector('.ytkit-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `ytkit-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

function updateAllToggleStates() {
    document.querySelectorAll('.ytkit-toggle-all-row').forEach(row => {
        const catId = row.dataset.categoryId;
        const pane = document.getElementById(`ytkit-pane-${catId}`);
        if (!pane) return;
        const featureToggles = pane.querySelectorAll('.ytkit-feature-cb');
        const allChecked = featureToggles.length > 0 && Array.from(featureToggles).every(t => t.checked);
        row.querySelector('.ytkit-toggle-all-cb').checked = allChecked;
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

    doc.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('#ytkit-close-settings') || target.matches('#ytkit-panel-overlay')) {
            doc.body.classList.remove('ytkit-panel-open');
        }
        const tabBtn = target.closest('.ytkit-tab-btn');
        if (tabBtn) {
            doc.querySelectorAll('.ytkit-tab-btn, .ytkit-settings-pane').forEach(el => el.classList.remove('active'));
            tabBtn.classList.add('active');
            doc.querySelector(`#ytkit-pane-${tabBtn.dataset.tab}`)?.classList.add('active');
        }
    });

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

    doc.addEventListener('change', async (e) => {
        const target = e.target;
        if (target.matches('.ytkit-feature-cb')) {
            const row = target.closest('[data-feature-id]');
            const featureId = row.dataset.featureId;
            const isEnabled = target.checked;

            appState.settings[featureId] = isEnabled;
            await settingsManager.save(appState.settings);

            const feature = features.find(f => f.id === featureId);
            if (feature) {
                isEnabled ? feature.init?.() : feature.destroy?.();
            }

            const subPanel = doc.querySelector(`.ytkit-sub-panel[data-parent-feature="${featureId}"]`);
            if (subPanel) {
                subPanel.style.display = isEnabled ? 'grid' : 'none';
            }
            updateAllToggleStates();
        } else if (target.matches('.ytkit-toggle-all-cb')) {
            const isEnabled = target.checked;
            const pane = target.closest('.ytkit-settings-pane');
            if (pane) {
                pane.querySelectorAll('.ytkit-feature-cb').forEach(cb => {
                    if (cb.checked !== isEnabled) {
                        cb.checked = isEnabled;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }
        }
    });

    doc.addEventListener('input', async (e) => {
        if (e.target.matches('.ytkit-input')) {
            const featureId = e.target.closest('[data-feature-id]').dataset.featureId;
            appState.settings[featureId] = e.target.value;
            await settingsManager.save(appState.settings);
            const feature = features.find(f => f.id === featureId);
            if (feature) {
                feature.destroy?.();
                feature.init?.();
            }
        }
    });

    doc.addEventListener('click', async (e) => {
        if (e.target.closest('#ytkit-export-all-settings')) {
            const configString = await settingsManager.exportAllSettings();
            handleFileExport('ytkit_settings_backup.json', configString);
            createToast('Settings exported!', 'success');
        }
        if (e.target.closest('#ytkit-import-all-settings')) {
            handleFileImport(async (content) => {
                const success = await settingsManager.importAllSettings(content);
                if (success) {
                    if (confirm("Settings imported successfully. The page will now reload to apply all changes.")) {
                        location.reload();
                    }
                } else {
                    createToast('Import failed. The file may be corrupt or invalid.', 'error');
                }
            });
        }
    });
}


// ——————————————————————————————————————————————————————————————————————————
// SECTION 5: STYLES
// ——————————————————————————————————————————————————————————————————————————
function injectPanelStyles() {
    GM_addStyle(`
:root {
    --ytkit-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
    --ytkit-bg-primary: #181a1b;
    --ytkit-bg-secondary: #25282a;
    --ytkit-bg-tertiary: #34383b;
    --ytkit-bg-hover: #3d4245;
    --ytkit-text-primary: #e8e6e3;
    --ytkit-text-secondary: #b3b0aa;
    --ytkit-border-color: #454a4d;
    --ytkit-accent: #5a93ff;
    --ytkit-accent-hover: #7eb0ff;
    --ytkit-accent-glow: rgba(90, 147, 255, 0.3);
    --ytkit-success: #22c55e;
    --ytkit-error: #ef4444;
    --ytkit-error-hover: #ff5252;
    --ytkit-header-icon-color: #aaa;
    --ytkit-header-icon-hover-bg: #31363f;
}

@keyframes ytkit-gradient-scroll {
    0% { background-position: 0% center; }
    100% { background-position: 200% center; }
}
@keyframes ytkit-fade-in {
    from { opacity: 0; transform: translateX(10px); }
    to { opacity: 1; transform: translateX(0); }
}

/* === Global Controls === */
.ytkit-settings-button { background: transparent; border: none; cursor: pointer; padding: 8px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background-color 0.2s ease, transform 0.2s ease; }
.ytkit-settings-button:hover { background-color: var(--yt-spec-badge-chip-background); transform: scale(1.1) rotate(15deg); }
.ytkit-settings-button svg { width: 24px; height: 24px; color: var(--yt-spec-icon-inactive); }
#ytkit-watch-button-container { margin: 0 8px 0 16px; display: flex; align-items: center; }
#ytkit-masthead-button-container { margin: 0 4px; }


/* === Settings Panel: Overlay & Container === */
#ytkit-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); z-index: 99998; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
#ytkit-settings-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); z-index: 99999; opacity: 0; pointer-events: none; transition: opacity 0.3s ease, transform 0.3s ease; display: flex; flex-direction: column; width: 95%; max-width: 1024px; max-height: 90vh; background: var(--ytkit-bg-primary); color: var(--ytkit-text-primary); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); font-family: var(--ytkit-font); border-radius: 16px; border: 1px solid var(--ytkit-border-color); overflow: hidden; }
body.ytkit-panel-open #ytkit-panel-overlay { opacity: 1; pointer-events: auto; }
body.ytkit-panel-open #ytkit-settings-panel { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }

/* === Settings Panel: Header, Body, Footer === */
.ytkit-settings-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 12px 24px; border-bottom: 1px solid var(--ytkit-border-color); flex-shrink: 0; }
.ytkit-header-title { display: flex; align-items: center; gap: 14px; }
.ytkit-header-title h2 { font-size: 22px; font-weight: 700; margin: 0; }
.ytkit-header-brand { background: linear-gradient(120deg, #FF0000, #FFFFFF, #FF0000); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-size: 200% auto; animation: ytkit-gradient-scroll 4s linear infinite; }
.ytkit-header-button { background: none; border: none; cursor: pointer; padding: 8px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background-color 0.2s ease, transform 0.2s ease; }
.ytkit-header-button:hover { background: var(--ytkit-bg-secondary); transform: scale(1.1); }
.ytkit-header-button svg { width: 20px; height: 20px; color: var(--ytkit-text-secondary); }
.ytkit-settings-body { display: flex; flex-grow: 1; overflow: hidden; }
.ytkit-settings-tabs { display: flex; flex-direction: column; gap: 4px; padding: 24px 16px; border-right: 1px solid var(--ytkit-border-color); flex-shrink: 0; overflow-y: auto; width: 220px; }
.ytkit-tab-btn { background: none; border: none; color: var(--ytkit-text-secondary); font-family: var(--ytkit-font); font-size: 15px; text-align: left; padding: 10px 16px; cursor: pointer; transition: all 0.2s; font-weight: 500; border-radius: 8px; border-left: 3px solid transparent; width: 100%; }
.ytkit-tab-btn:hover { background-color: var(--ytkit-bg-secondary); color: var(--ytkit-text-primary); }
.ytkit-tab-btn.active { color: var(--ytkit-accent); border-left-color: var(--ytkit-accent); font-weight: 600; background-color: var(--ytkit-bg-secondary); }
.ytkit-settings-content { flex-grow: 1; overflow-y: auto; padding: 24px; }
.ytkit-settings-pane { display: none; }
.ytkit-settings-pane.active { display: grid; gap: 16px; animation: ytkit-fade-in 0.4s ease-out; }
.ytkit-settings-footer { padding: 12px 24px; border-top: 1px solid var(--ytkit-border-color); flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; background: var(--ytkit-bg-secondary); }
.ytkit-footer-left { display: flex; align-items: center; gap: 16px; }
.ytkit-github-link { color: var(--ytkit-text-secondary); display: flex; align-items: center; transition: color .2s; }
.ytkit-github-link:hover { color: var(--ytkit-text-primary); }
.ytkit-github-link svg { width: 22px; height: 22px; }
.ytkit-footer-right { display: flex; align-items: center; gap: 16px; }
.ytkit-version { font-size: 12px; color: var(--ytkit-text-secondary); cursor: help; }

/* === Settings Panel: Setting Rows & Toggles === */
.ytkit-setting-row, .ytkit-management-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 20px; padding: 16px; background: var(--ytkit-bg-secondary); border: 1px solid var(--ytkit-border-color); border-radius: 12px; transition: box-shadow .2s; }
.ytkit-setting-row:hover, .ytkit-management-row:hover { box-shadow: 0 0 15px rgba(0,0,0,0.1); }
.ytkit-toggle-all-row { background: var(--ytkit-bg-primary); border-style: dashed; }
.ytkit-setting-row-text { display: flex; flex-direction: column; gap: 4px; }
.ytkit-setting-row label[for], .ytkit-management-row label { font-size: 16px; font-weight: 500; cursor: pointer; color: var(--ytkit-text-primary); }
.ytkit-setting-row small, .ytkit-management-row small { color: var(--ytkit-text-secondary); font-size: 13px; line-height: 1.4; }
.ytkit-switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0;}
.ytkit-switch input { opacity: 0; width: 0; height: 0; }
.ytkit-slider { position: absolute; cursor: pointer; inset: 0; background-color: var(--ytkit-bg-tertiary); transition: .4s; border-radius: 34px; }
.ytkit-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
.ytkit-switch input:checked + .ytkit-slider { background-color: var(--ytkit-accent); box-shadow: 0 0 10px var(--ytkit-accent-glow); }
.ytkit-switch input:checked + .ytkit-slider:before { transform: translateX(20px); }
.ytkit-sub-panel { background: var(--ytkit-bg-primary); border: 1px dashed var(--ytkit-border-color); border-radius: 12px; padding: 16px; display: none; gap: 12px; margin-top: -8px; border-top: none; border-top-left-radius: 0; border-top-right-radius: 0; grid-column: 1 / -1; }
.ytkit-management-row + .ytkit-sub-panel { margin-top: -1px; border-top: 1px solid var(--ytkit-border-color); display: none; grid-template-columns: 1fr; }
.ytkit-sub-setting { margin-left: 20px; }


/* === Buttons & Inputs === */
.ytkit-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 14px; font-size: 14px; font-weight: 500; border-radius: 8px; border: 1px solid var(--ytkit-border-color); cursor: pointer; transition: all .2s; background-color: var(--ytkit-bg-tertiary); color: var(--ytkit-text-primary); }
.ytkit-button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
.ytkit-button svg { width: 16px; height: 16px; }
.ytkit-button-group { display: flex; gap: 8px; }
.ytkit-input { background: var(--ytkit-bg-primary); color: var(--ytkit-text-primary); border: 1px solid var(--ytkit-border-color); border-radius: 6px; padding: 8px 10px; font-family: var(--ytkit-font); font-size: 14px; width: auto; transition: border-color .2s, box-shadow .2s; }
.ytkit-input:focus { outline: none; border-color: var(--ytkit-accent); box-shadow: 0 0 0 3px var(--ytkit-accent-glow); }

/* === Toast Notifications === */
.ytkit-toast { position: fixed; bottom: -100px; left: 50%; transform: translateX(-50%); color: white; padding: 12px 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: var(--ytkit-font); font-size: 15px; font-weight: 500; z-index: 100002; transition: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55); border-radius: 8px; }
.ytkit-toast.show { bottom: 20px; }
.ytkit-toast.success { background-color: var(--ytkit-success); }
.ytkit-toast.error { background-color: var(--ytkit-error); }

/* === Logo injection on watch page === */
#yt-suite-watch-logo { display: flex; align-items: center; margin-right: 16px; }
#yt-suite-watch-logo a { display: flex; align-items: center; }
#yt-suite-watch-logo ytd-logo { width: 90px; height: auto; }

/* === v5.0 specific layout fixes === */
ytd-watch-metadata.watch-active-metadata {
    margin-top: 180px !important;
}
ytd-live-chat-frame {
    margin-top: -57px !important;
    width: 402px !important;
}
`);
}


// ——————————————————————————————————————————————————————————————————————————
// SECTION 6: MAIN BOOTSTRAP
// This is the entry point of the script. It loads settings, builds the UI,
// injects the necessary styles and buttons, and then initializes all the
// features that the user has enabled.
// ——————————————————————————————————————————————————————————————————————————
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
                console.error(`[YTKit] Error initializing feature "${f.id}":`, error);
            }
        }
    });

    document.querySelectorAll('.ytkit-feature-cb:checked').forEach(cb => {
        const row = cb.closest('[data-feature-id]');
        if(row) {
            const featureId = row.dataset.featureId;
            const subPanel = document.querySelector(`.ytkit-sub-panel[data-parent-feature="${featureId}"]`);
            if (subPanel) subPanel.style.display = 'grid';
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