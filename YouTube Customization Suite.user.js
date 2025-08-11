// ==UserScript==
// @name         YouTube Customization Suite
// @namespace    https://github.com/user/yt-enhancement-suite
// @version      5.0
// @description  Ultimate YouTube customization. Hide elements, control layout, and enhance your viewing experience with a modern UI.
// @author       Matthew Parker & Gemini
// @match        https://*.youtube.com/*
// @exclude      https://*.youtube.com/embed/*
// @exclude      https://music.youtube.com/*
// @exclude      https://www.youtube.com/shorts/*
// @exclude      https://m.youtube.com/*
// @exclude      https://www.youtube.com/playlist?list=*
// @icon         https://raw.githubusercontent.com/SysAdminDoc/Youtube_Customization_Suite/refs/heads/main/ytlogo.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @grant        GM_notification
// @grant        GM_download
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @connect      sponsor.ajay.app
// @resource     betterDarkMode https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/Themes/youtube-dark-theme.css
// @resource     catppuccinMocha https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/Themes/youtube-catppuccin-theme.css
// @resource     nyanCatProgressBar https://raw.githubusercontent.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/Themes/nyan-cat-progress-bar.css
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ——————————————————————————————————————————————————————————————————————————
    //  ~ CHANGELOG ~
    //
    //  v5.0 - The Polished Public Release
    //  - MAJOR: Implemented a professional, modern, and tabbed settings UI, replacing the older, simpler design for a more intuitive user experience.
    //  - ADDED: New default settings provide a clean, enhanced experience for first-time users right out of the box.
    //  - UPDATED: The Cobalt Downloader feature has been streamlined. It now immediately opens the Cobalt website in a new tab for a faster, simpler download process without extra popups.
    //  - UPDATED: The entire script has been commented and documented to be friendly and accessible for the open-source community.
    //  - FIXED: All underlying logic is based on the stable v3.23 release to ensure watch pages, comments, and live chat function perfectly.
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
            squarify: true,
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
            hideFullscreenButton: true
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
                window.addEventListener('yt-navigate-finish', () => setTimeout(pauseRule, 500));
                setTimeout(pauseRule, 500);
            },
            destroy() { /* No cleanup needed */ }
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
            _getFrontendUrl() { return `https://cobalt.tools/#`; },
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

        // Group: Player Enhancements
        {
            id: 'playerEnhancements',
            name: 'Add Loop & Screenshot Buttons',
            description: 'Adds buttons to loop the video, save a screenshot, or copy a screenshot to the clipboard.',
            group: 'Player Enhancements',
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

            handleScreenshotClick(action, event) {
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
    // This section contains helper functions that are used by various features,
    // such as the live chat filters. It keeps the main feature definitions clean.
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
    // These functions programmatically build the settings panel, its tabs,
    // and all the toggles. It also attaches all the necessary event listeners
    // to make the UI interactive.
    // ——————————————————————————————————————————————————————————————————————————
    const ICONS = {
        cog: {
            viewBox: '0 0 24 24',
            paths: ['M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84 c-0.24,0-0.44,0.17-0.48,0.41L9.22,5.72C8.63,5.96,8.1,6.29,7.6,6.67L5.21,5.71C4.99,5.62,4.74,5.69,4.62,5.91L2.7,9.23 c-0.11,0.2-0.06,0.47,0.12,0.61l2.03,1.58C4.8,11.69,4.78,12,4.78,12.31c0,0.31,0.02,0.62,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.04,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.48-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0.01,0.59-0.22l1.92-3.32c0.11-0.2,0.06-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z'],
        },
        close: {
            viewBox: '0 0 24 24',
            paths: ['M18 6l-12 12', 'M6 6l12 12'],
            strokeWidth: '2.5'
        },
        header: {
            viewBox: '0 0 24 24',
            paths: ['M2 3h20v6H2z', 'M2 9h20v12H2z', 'M6 13h4', 'M6 17h2'],
            strokeWidth: '2'
        },
        sidebar: {
            viewBox: '0 0 24 24',
            paths: ['M3 3h18v18H3z', 'M9 3v18'],
            strokeWidth: '2'
        },
        themes: {
            viewBox: '0 0 24 24',
            paths: ['m12 3-1.41 1.41L9.17 3l-1.42 1.41L6.34 3l-1.42 1.41L3.5 3 2.09 4.41 3.5 5.83l-1.41 1.41L3.5 8.66l-1.41 1.41L3.5 11.5l-1.41 1.41L3.5 14.34l-1.41 1.42L3.5 17.17l-1.41 1.42L3.5 20.01l1.41 1.41L6.34 20l1.42 1.41L9.17 20l1.41 1.41L12 20l1.41-1.41L14.83 20l1.42-1.41L17.66 20l1.42-1.41L20.5 20l1.41-1.41L20.5 17.17l1.41-1.42L20.5 14.34l1.41-1.41L20.5 11.5l1.41-1.41L20.5 8.66l1.41-1.41L20.5 5.83 22 4.41 20.5 3l-1.41 1.41L17.66 3l-1.42 1.41L14.83 3l-1.42 1.41L12 3z', 'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0z'],
            strokeWidth: '2'
        },
        progressBar: {
            viewBox: '0 0 24 24',
            paths: ['M3 12h18', 'M18 6h3', 'M3 6h10', 'M10 18h11', 'M3 18h2'],
            strokeWidth: '2'
        },
        general: {
            viewBox: '0 0 24 24',
            paths: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
            strokeWidth: '2'
        },
        watchLayout: {
            viewBox: '0 0 24 24',
            paths: ['M3 3h18v18H3z', 'M21 12H3', 'M12 3v18'],
            strokeWidth: '2'
        },
        watchBehavior: {
            viewBox: '0 0 24 24',
            paths: ['M12 20v-6M6 20v-4M18 20v-2', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M6 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M18 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
            strokeWidth: '2'
        },
        watchElements: {
            viewBox: '0 0 24 24',
            paths: ['M12.22 2h-4.44l-2 4h-3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3l-2-4z', 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
            strokeWidth: '2'
        },
        liveChat: {
            viewBox: '0 0 24 24',
            paths: ['m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z'],
            strokeWidth: '2'
        },
        actionButtons: {
            viewBox: '0 0 24 24',
            paths: ['M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'],
            strokeWidth: '2'
        },
        playerEnhancements: {
            viewBox: '0 0 24 24',
            paths: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
            strokeWidth: '2'
        },
        playerControls: {
            viewBox: '0 0 24 24',
            paths: ['M5 3l14 9-14 9V3z'],
            strokeWidth: '2'
        },
    };

    /**
     * Creates an SVG icon element from a predefined object structure.
     * @param {object} iconData - The icon data containing viewBox and path information.
     * @returns {Element | null} The created SVG element or null if data is invalid.
     */
    function createIcon(iconData) {
        if (!iconData || !iconData.viewBox || !iconData.paths) return null;
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute('viewBox', iconData.viewBox);
        svg.setAttribute('fill', iconData.strokeWidth ? 'none' : 'currentColor');
        if (iconData.strokeWidth) {
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', iconData.strokeWidth);
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
        }

        iconData.paths.forEach(pathData => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', pathData);
            svg.appendChild(path);
        });

        if (iconData.circle) {
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', iconData.circle.cx);
            circle.setAttribute('cy', iconData.circle.cy);
            circle.setAttribute('r', iconData.circle.r);
            svg.appendChild(circle);
        }
        return svg;
    }

    /**
     * Injects the main settings button into the YouTube header or watch page.
     */
    function injectSettingsButton() {
        const handleDisplay = () => {
            const isWatch = window.location.pathname.startsWith('/watch');

            document.getElementById('ycs-masthead-cog')?.remove();
            document.getElementById('ycs-watch-cog')?.remove();

            const cogButton = document.createElement('button');
            cogButton.title = 'YouTube Customization Suite Settings (Ctrl+Alt+Y)';
            const cogIcon = createIcon(ICONS.cog);
            if (cogIcon) cogButton.appendChild(cogIcon);
            cogButton.onclick = () => document.body.classList.toggle('ycs-panel-open');

            if (isWatch) {
                waitForElement('#top-row #owner', (ownerDiv) => {
                    if (document.getElementById('ycs-watch-cog')) return;
                    const cogContainer = document.createElement('div');
                    cogContainer.id = 'ycs-watch-cog';
                    cogButton.id = 'ycs-settings-button-watch';
                    cogContainer.appendChild(cogButton);

                    const logo = document.getElementById('yt-suite-watch-logo');
                    if (logo && logo.parentElement === ownerDiv) {
                        ownerDiv.insertBefore(cogContainer, logo.nextSibling);
                    } else {
                        ownerDiv.prepend(cogContainer);
                    }
                });
            } else {
                waitForElement('ytd-masthead #end', (mastheadEnd) => {
                    if (document.getElementById('ycs-settings-button-masthead')) return;
                    cogButton.id = 'ycs-settings-button-masthead';
                    mastheadEnd.prepend(cogButton);
                });
            }
        };
        addNavigateRule("settingsButtonRule", handleDisplay);
    }

    /**
     * Builds the entire settings panel from scratch and appends it to the DOM.
     */
    function buildSettingsPanel() {
        const panelContainer = document.createElement('div');
        panelContainer.id = 'ycs-panel-container';
        document.body.appendChild(panelContainer);

        const overlay = document.createElement('div');
        overlay.id = 'ycs-panel-overlay';
        overlay.onclick = () => document.body.classList.remove('ycs-panel-open');

        const panel = document.createElement('div');
        panel.id = 'ycs-settings-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'ycs-panel-title');

        const header = document.createElement('div');
        header.className = 'ycs-settings-header';
        const headerTitle = document.createElement('div');
        headerTitle.className = 'ycs-header-title';
        headerTitle.id = 'ycs-panel-title';
        const headerIcon = createIcon(ICONS.cog);
        const headerH2 = document.createElement('h2');
        headerH2.textContent = 'YouTube Customization Suite';
        if(headerIcon) headerTitle.appendChild(headerIcon);
        headerTitle.appendChild(headerH2);
        const closeButton = document.createElement('button');
        closeButton.id = 'ycs-close-settings';
        closeButton.className = 'ycs-header-button';
        closeButton.title = 'Close (Esc)';
        const closeIcon = createIcon(ICONS.close);
        if(closeIcon) closeButton.appendChild(closeIcon);
        header.appendChild(headerTitle);
        header.appendChild(closeButton);

        const body = document.createElement('div');
        body.className = 'ycs-settings-body';
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'ycs-settings-tabs';
        const contentContainer = document.createElement('div');
        contentContainer.className = 'ycs-settings-content';
        const contentInner = document.createElement('div');
        contentInner.className = 'ycs-settings-content-inner';
        contentContainer.appendChild(contentInner);
        body.appendChild(tabsContainer);
        body.appendChild(contentContainer);

        const footer = document.createElement('div');
        footer.className = 'ycs-settings-footer';
        const versionSpan = document.createElement('span');
        versionSpan.className = 'ycs-version';
        versionSpan.title = 'Keyboard Shortcut: Ctrl+Alt+Y';
        versionSpan.textContent = 'v5.0';
        const themeLabel = document.createElement('label');
        themeLabel.className = 'ycs-theme-select';
        const themeSpan = document.createElement('span');
        themeSpan.textContent = 'Panel Theme:';
        const themeSelect = document.createElement('select');
        themeSelect.id = 'ycs-panel-theme-selector';
        const optionDark = document.createElement('option');
        optionDark.value = 'dark';
        optionDark.textContent = 'Professional Dark';
        optionDark.selected = appState.settings.panelTheme === 'dark';
        const optionLight = document.createElement('option');
        optionLight.value = 'light';
        optionLight.textContent = 'Professional Light';
        optionLight.selected = appState.settings.panelTheme === 'light';
        themeSelect.appendChild(optionDark);
        themeSelect.appendChild(optionLight);
        themeLabel.appendChild(themeSpan);
        themeLabel.appendChild(themeSelect);
        footer.appendChild(versionSpan);
        footer.appendChild(themeLabel);

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);

        const groupOrder = [ 'Header', 'Sidebar', 'Themes', 'Progress Bar Themes', 'General Content', 'Watch Page - Layout', 'Watch Page - Behavior', 'Watch Page - Other Elements', 'Watch Page - Live Chat', 'Watch Page - Action Buttons', 'Player Enhancements', 'Watch Page - Player Controls' ];
        const categoryIcons = {
            'Header': ICONS.header, 'Sidebar': ICONS.sidebar, 'Themes': ICONS.themes, 'Progress Bar Themes': ICONS.progressBar, 'General Content': ICONS.general, 'Watch Page - Layout': ICONS.watchLayout, 'Watch Page - Behavior': ICONS.watchBehavior, 'Watch Page - Other Elements': ICONS.watchElements, 'Watch Page - Live Chat': ICONS.liveChat, 'Watch Page - Action Buttons': ICONS.actionButtons, 'Player Enhancements': ICONS.playerEnhancements, 'Watch Page - Player Controls': ICONS.playerControls
        };
        const featuresByGroup = features.reduce((acc, f) => {
            (acc[f.group] = acc[f.group] || []).push(f);
            return acc;
        }, {});

        groupOrder.forEach((groupName, index) => {
            const groupFeatures = featuresByGroup[groupName];
            if (!groupFeatures || groupFeatures.length === 0) return;

            const groupId = groupName.replace(/ /g, '-').toLowerCase();
            const tabBtn = document.createElement('button');
            tabBtn.className = 'ycs-tab-btn';
            if (index === 0) tabBtn.classList.add('active');
            tabBtn.dataset.tab = groupId;
            const tabIcon = createIcon(categoryIcons[groupName]);
            const tabSpan = document.createElement('span');
            tabSpan.textContent = groupName;
            if(tabIcon) tabBtn.appendChild(tabIcon);
            tabBtn.appendChild(tabSpan);
            tabsContainer.appendChild(tabBtn);

            const pane = document.createElement('div');
            pane.id = `ycs-pane-${groupId}`;
            pane.className = 'ycs-settings-pane';
            if (index === 0) pane.classList.add('active');

            pane.appendChild(buildToggleAllRow(groupId, groupName));

            const managementFeatures = groupFeatures.filter(f => f.isManagement);
            const regularFeatures = groupFeatures.filter(f => !f.isManagement && !f.isSubFeature);
            const subFeatures = groupFeatures.filter(f => f.isSubFeature);

            managementFeatures.forEach(f => {
                pane.appendChild(buildSettingRow(f));
                const relatedSubFeatures = subFeatures.filter(sf => {
                    if (f.id === 'nativeDarkMode' && (sf.id === 'betterDarkMode' || sf.id === 'catppuccinMocha')) return true;
                    if (f.id === 'skipSponsors' && sf.id === 'hideSponsorBlockLabels') return true;
                    if (f.id === 'autoMaxResolution' && (sf.id === 'useEnhancedBitrate' || sf.id === 'hideQualityPopup')) return true;
                    if (f.id === 'hideRelatedVideos' && sf.id === 'expandVideoWidth') return true;
                    return false;
                });

                if (relatedSubFeatures.length > 0) {
                    const subPanel = document.createElement('div');
                    subPanel.className = 'ycs-sub-panel';
                    subPanel.dataset.parentFeature = f.id;
                    relatedSubFeatures.forEach(sf => subPanel.appendChild(buildSettingRow(sf)));
                    pane.appendChild(subPanel);
                }
            });

             if (regularFeatures.length > 0 && managementFeatures.length > 0) {
                 const divider = document.createElement('div');
                 divider.className = 'ycs-pane-divider';
                 pane.appendChild(divider);
            }

            regularFeatures.forEach(f => pane.appendChild(buildSettingRow(f)));
            contentInner.appendChild(pane);
        });

        panelContainer.appendChild(overlay);
        panelContainer.appendChild(panel);
    }

    /**
     * Builds the "Toggle All" switch for a specific category tab.
     * @param {string} groupId - The unique ID for the group.
     * @param {string} groupName - The display name of the group.
     * @returns {HTMLElement} The complete row element for the toggle.
     */
    function buildToggleAllRow(groupId, groupName) {
        const row = document.createElement('div');
        row.className = 'ycs-setting-row ycs-toggle-all-row';
        row.dataset.categoryId = groupId;

        const textDiv = document.createElement('div');
        textDiv.className = 'ycs-setting-row-text';
        const label = document.createElement('label');
        label.htmlFor = `ycs-toggle-all-${groupId}`;
        label.textContent = `Toggle All ${groupName}`;
        const small = document.createElement('small');
        small.textContent = `Enable or disable all settings in this category.`;
        textDiv.appendChild(label);
        textDiv.appendChild(small);
        row.appendChild(textDiv);

        const switchLabel = document.createElement('label');
        switchLabel.className = 'ycs-switch';
        switchLabel.htmlFor = `ycs-toggle-all-${groupId}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `ycs-toggle-all-${groupId}`;
        input.className = 'ycs-toggle-all-cb';
        const slider = document.createElement('span');
        slider.className = 'ycs-slider';
        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        row.appendChild(switchLabel);

        return row;
    }

    /**
     * Builds a single row in the settings panel for a feature.
     * @param {object} f - The feature object from the main features array.
     * @returns {HTMLElement} The complete row element for the feature.
     */
    function buildSettingRow(f) {
        const row = document.createElement('div');
        row.className = f.isManagement ? 'ycs-management-row' : (f.isSubFeature ? 'ycs-setting-row ycs-sub-setting' : 'ycs-setting-row');
        row.dataset.featureId = f.id;

        const textDiv = document.createElement('div');
        textDiv.className = 'ycs-setting-row-text';
        const label = document.createElement('label');
        label.htmlFor = f.type === 'textarea' ? `ycs-input-${f.id}` : `ycs-toggle-${f.id}`;
        label.textContent = f.name;
        const small = document.createElement('small');
        small.textContent = f.description;
        textDiv.appendChild(label);
        textDiv.appendChild(small);
        row.appendChild(textDiv);

        if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.id = `ycs-input-${f.id}`;
            textarea.className = 'ycs-input';
            textarea.placeholder = 'e.g. word1, phrase two, user3';
            textarea.value = appState.settings[f.id];
            row.appendChild(textarea);
        } else {
            const switchLabel = document.createElement('label');
            switchLabel.className = 'ycs-switch';
            switchLabel.htmlFor = `ycs-toggle-${f.id}`;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `ycs-toggle-${f.id}`;
            input.checked = appState.settings[f.id];
            input.className = 'ycs-feature-cb';
            const slider = document.createElement('span');
            slider.className = 'ycs-slider';
            switchLabel.appendChild(input);
            switchLabel.appendChild(slider);
            row.appendChild(switchLabel);
        }
        return row;
    }

    /**
     * Creates and displays a short-lived notification toast at the bottom of the screen.
     * @param {string} message - The text to display in the toast.
     * @param {string} [type='success'] - The type of toast ('success', 'error', 'info').
     * @param {number} [duration=3000] - How long the toast should be visible in milliseconds.
     */
    function createToast(message, type = 'success', duration = 3000) {
        const existingToast = document.querySelector('.ycs-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = `ycs-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 500);
        }, duration);
    }

    /**
     * Checks the state of all toggles within each category and updates the
     * main "Toggle All" switch to reflect if all are checked.
     */
    function updateAllToggleStates() {
        document.querySelectorAll('.ycs-toggle-all-row').forEach(row => {
            const catId = row.dataset.categoryId;
            const pane = document.getElementById(`ycs-pane-${catId}`);
            if (!pane) return;
            const featureToggles = pane.querySelectorAll('.ycs-feature-cb');
            const allChecked = featureToggles.length > 0 && Array.from(featureToggles).every(t => t.checked);
            row.querySelector('.ycs-toggle-all-cb').checked = allChecked;
        });
    }

    /**
     * Attaches all global event listeners for the settings panel, including
     * clicks, key presses, and changes to the toggles.
     */
    function attachUIEventListeners() {
        const doc = document;
        doc.addEventListener('click', (e) => {
            if (e.target.closest('#ycs-close-settings') || e.target.matches('#ycs-panel-overlay')) {
                doc.body.classList.remove('ycs-panel-open');
            }
            if (e.target.closest('.ycs-tab-btn')) {
                const tabBtn = e.target.closest('.ycs-tab-btn');
                doc.querySelectorAll('.ycs-tab-btn, .ycs-settings-pane').forEach(el => el.classList.remove('active'));
                tabBtn.classList.add('active');
                doc.querySelector(`#ycs-pane-${tabBtn.dataset.tab}`)?.classList.add('active');
            }
            if (e.target.closest('.ycs-setting-row-text')) {
                const row = e.target.closest('.ycs-setting-row, .ycs-management-row');
                const checkbox = row?.querySelector('.ycs-feature-cb, .ycs-toggle-all-cb');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });

        doc.addEventListener('keydown', (e) => {
            if (e.key === "Escape" && doc.body.classList.contains('ycs-panel-open')) {
                doc.body.classList.remove('ycs-panel-open');
            }
            if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                e.stopPropagation();
                doc.body.classList.toggle('ycs-panel-open');
            }
        });

        doc.addEventListener('change', async (e) => {
            if (e.target.matches('.ycs-feature-cb')) {
                const row = e.target.closest('[data-feature-id]');
                const featureId = row.dataset.featureId;
                const isEnabled = e.target.checked;

                appState.settings[featureId] = isEnabled;
                await settingsManager.save(appState.settings);

                const feature = features.find(f => f.id === featureId);
                if (feature) {
                    if (isEnabled) {
                        feature.init?.();
                    } else {
                        feature.destroy?.();
                    }
                    createToast(`${feature.name} ${isEnabled ? 'Enabled' : 'Disabled'}`);
                }

                const subPanel = doc.querySelector(`.ycs-sub-panel[data-parent-feature="${featureId}"]`);
                if (subPanel) {
                    subPanel.style.display = isEnabled ? 'flex' : 'none';
                    if (!isEnabled) {
                        subPanel.querySelectorAll('.ycs-feature-cb:checked').forEach(cb => {
                            cb.checked = false;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                    }
                }
                updateAllToggleStates();
            } else if (e.target.matches('#ycs-panel-theme-selector')) {
                appState.settings.panelTheme = e.target.value;
                await settingsManager.save(appState.settings);
                document.documentElement.setAttribute('data-ycs-theme', appState.settings.panelTheme);
            } else if (e.target.matches('.ycs-toggle-all-cb')) {
                const isEnabled = e.target.checked;
                const pane = e.target.closest('.ycs-settings-pane');
                if (pane) {
                    pane.querySelectorAll('.ycs-feature-cb').forEach(cb => {
                        if (cb.checked !== isEnabled) {
                            cb.checked = isEnabled;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                }
            }
        });

        doc.addEventListener('input', async (e) => {
            if (e.target.matches('.ycs-input')) {
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
    }

    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 5: STYLES
    // This section injects all the CSS needed for the settings panel and other
    // custom elements. It's done via GM_addStyle to keep it all contained
    // within the script.
    // ——————————————————————————————————————————————————————————————————————————
    function injectPanelStyles() {
        GM_addStyle(`
:root { --ycs-font: 'Roboto', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
html[data-ycs-theme='dark'] { --ycs-bg-primary: #181a1b; --ycs-bg-secondary: #25282a; --ycs-bg-tertiary: #34383b; --ycs-bg-hover: #3d4245; --ycs-text-primary: #e8e6e3; --ycs-text-secondary: #b3b0aa; --ycs-border-color: #454a4d; --ycs-accent: #ff4500; --ycs-accent-hover: #ff6a33; --ycs-accent-glow: rgba(255, 69, 0, 0.3); --ycs-success: #22c55e; --ycs-error: #ef4444; --ycs-error-hover: #ff5252; --ycs-info: #3b82f6; --ycs-header-icon-color: var(--yt-spec-icon-inactive); --ycs-header-icon-hover-bg: var(--yt-spec-badge-chip-background); }
html[data-ycs-theme='light'] { --ycs-bg-primary: #ffffff; --ycs-bg-secondary: #f1f3f5; --ycs-bg-tertiary: #e9ecef; --ycs-bg-hover: #dee2e6; --ycs-text-primary: #212529; --ycs-text-secondary: #6c757d; --ycs-border-color: #ced4da; --ycs-accent: #d9480f; --ycs-accent-hover: #e8591a; --ycs-accent-glow: rgba(217, 72, 15, 0.25); --ycs-success: #198754; --ycs-error: #dc3545; --ycs-error-hover: #e44d5b; --ycs-info: #0ea5e9; --ycs-header-icon-color: var(--yt-spec-icon-inactive); --ycs-header-icon-hover-bg: var(--yt-spec-badge-chip-background); }

/* === Global Controls === */
#ycs-settings-button-masthead, #ycs-settings-button-watch { background: transparent; border: none; cursor: pointer; padding: 6px; margin: 0 8px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background-color 0.2s ease, transform 0.2s ease; }
#ycs-settings-button-masthead:hover, #ycs-settings-button-watch:hover { background-color: var(--ycs-header-icon-hover-bg); transform: scale(1.1) rotate(15deg); }
#ycs-settings-button-masthead svg, #ycs-settings-button-watch svg { width: 26px; height: 26px; color: var(--ycs-header-icon-color); }
#ycs-watch-cog { margin: 0 8px 0 16px; display: flex; align-items: center; }
ytd-masthead #end { position: relative; }

/* === Settings Panel: Overlay & Container === */
#ycs-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); z-index: 99998; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
#ycs-settings-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); z-index: 99999; opacity: 0; pointer-events: none; transition: opacity 0.3s ease, transform 0.3s ease; display: flex; flex-direction: column; width: 95%; max-width: 900px; height: 90vh; max-height: 750px; background: var(--ycs-bg-primary); color: var(--ycs-text-primary); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); font-family: var(--ycs-font); border-radius: 16px; border: 1px solid var(--ycs-border-color); overflow: hidden; }
body.ycs-panel-open #ycs-panel-overlay { opacity: 1; pointer-events: auto; }
body.ycs-panel-open #ycs-settings-panel { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }

/* === Settings Panel: Header, Body, Footer === */
.ycs-settings-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 12px 24px; border-bottom: 1px solid var(--ycs-border-color); flex-shrink: 0; }
.ycs-header-title { display: flex; align-items: center; gap: 14px; }
.ycs-header-title svg { color: var(--ycs-accent); }
.ycs-header-title h2 { font-size: 18px; font-weight: 600; margin: 0; }
.ycs-header-button { background: none; border: none; cursor: pointer; padding: 8px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background-color 0.2s ease, transform 0.2s ease; }
.ycs-header-button:hover { background: var(--ycs-bg-secondary); transform: scale(1.1); }
.ycs-header-button svg { width: 20px; height: 20px; color: var(--ycs-text-secondary); }
.ycs-settings-body { display: flex; flex-grow: 1; overflow: hidden; }
.ycs-settings-tabs { display: flex; flex-direction: column; gap: 4px; padding: 16px; border-right: 1px solid var(--ycs-border-color); flex-shrink: 0; overflow-y: auto; width: 240px; }
.ycs-tab-btn { display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--ycs-text-secondary); font-family: var(--ycs-font); font-size: 15px; text-align: left; padding: 10px 16px; cursor: pointer; transition: all 0.2s; font-weight: 500; border-radius: 8px; border-left: 3px solid transparent; width: 100%; }
.ycs-tab-btn:hover { background-color: var(--ycs-bg-secondary); color: var(--ycs-text-primary); }
.ycs-tab-btn.active { color: var(--ycs-accent); border-left-color: var(--ycs-accent); font-weight: 600; background-color: var(--ycs-bg-secondary); }
.ycs-tab-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
.ycs-settings-content { flex-grow: 1; overflow-y: auto; }
.ycs-settings-content-inner { padding: 24px; }
.ycs-settings-pane { display: none; }
.ycs-settings-pane.active { display: grid; gap: 16px; animation: ycs-fade-in 0.4s ease-out; }
@keyframes ycs-fade-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
.ycs-settings-footer { padding: 12px 24px; border-top: 1px solid var(--ycs-border-color); flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; background: var(--ycs-bg-secondary); }
.ycs-theme-select { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.ycs-theme-select select { background: var(--ycs-bg-tertiary); color: var(--ycs-text-primary); border: 1px solid var(--ycs-border-color); border-radius: 6px; padding: 6px 8px; font-family: var(--ycs-font); font-size: 14px; }
.ycs-version { font-size: 12px; color: var(--ycs-text-secondary); cursor: help; }

/* === Settings Panel: Setting Rows & Toggles === */
.ycs-setting-row, .ycs-management-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 16px; background: var(--ycs-bg-secondary); border: 1px solid var(--ycs-border-color); border-radius: 12px; transition: box-shadow .2s, border-color .2s; }
.ycs-setting-row:hover, .ycs-management-row:hover { border-color: color-mix(in srgb, var(--ycs-border-color) 50%, var(--ycs-text-secondary)); }
.ycs-toggle-all-row { background: transparent; border-style: dashed; }
.ycs-setting-row-text { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; cursor: pointer; }
.ycs-setting-row-text label, .ycs-management-row label { font-size: 16px; font-weight: 500; cursor: pointer; color: var(--ycs-text-primary); display: flex; align-items: center; gap: 8px; }
.ycs-setting-row-text small { color: var(--ycs-text-secondary); font-size: 13px; line-height: 1.4; }
.ycs-switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; cursor: pointer; }
.ycs-switch input { opacity: 0; width: 0; height: 0; }
.ycs-slider { position: absolute; cursor: pointer; inset: 0; background-color: var(--ycs-bg-tertiary); transition: .4s; border-radius: 34px; border: 1px solid var(--ycs-border-color); }
.ycs-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: var(--ycs-text-secondary); transition: .4s; border-radius: 50%; }
.ycs-switch input:checked + .ycs-slider { background-color: var(--ycs-accent); border-color: var(--ycs-accent); box-shadow: 0 0 10px var(--ycs-accent-glow); }
.ycs-switch input:checked + .ycs-slider:before { background-color: white; transform: translateX(20px); }
.ycs-pane-divider { height: 1px; background-color: var(--ycs-border-color); margin: 8px 0; }

/* === Buttons & Inputs === */
.ycs-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 14px; font-size: 14px; font-weight: 500; border-radius: 8px; border: 1px solid var(--ycs-border-color); cursor: pointer; transition: all .2s; background-color: var(--ycs-bg-tertiary); color: var(--ycs-text-primary); }
.ycs-button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.2); border-color: var(--ycs-text-secondary); }
.ycs-button-primary { background-color: var(--ycs-accent); border-color: var(--ycs-accent); color: white; }
.ycs-button-primary:hover:not(:disabled) { background-color: var(--ycs-accent-hover); border-color: var(--ycs-accent-hover); }
.ycs-button-danger { background-color: var(--ycs-error); border-color: var(--ycs-error); color: white; }
.ycs-button-danger:hover:not(:disabled) { background-color: var(--ycs-error-hover); border-color: var(--ycs-error-hover); }
.ycs-input { background: var(--ycs-bg-primary); color: var(--ycs-text-primary); border: 1px solid var(--ycs-border-color); border-radius: 6px; padding: 8px 10px; font-family: var(--ycs-font); font-size: 14px; width: 100%; transition: border-color .2s, box-shadow .2s; flex-shrink: 0; max-width: 50%; }
.ycs-input:focus { outline: none; border-color: var(--ycs-accent); box-shadow: 0 0 0 3px var(--ycs-accent-glow); }
.ycs-input:disabled { background-color: var(--ycs-bg-tertiary); opacity: 0.7; cursor: not-allowed; }

/* === Management & Sub-Panels === */
.ycs-management-row { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: none; }
.ycs-sub-panel { background: var(--ycs-bg-secondary); border: 1px solid var(--ycs-border-color); border-radius: 0 0 12px 12px; padding: 16px; display: none; flex-direction: column; gap: 12px; margin-top: -17px; }
.ycs-sub-setting { margin-left: 20px; }

/* === Toast Notifications === */
@keyframes ycs-spin { to { transform: rotate(360deg); } }
.ycs-spinner-svg { animation: ycs-spin 1.2s cubic-bezier(0.5, 0.15, 0.5, 0.85) infinite; }
.ycs-toast { position: fixed; bottom: -100px; left: 50%; transform: translateX(-50%); color: white; padding: 12px 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: var(--ycs-font); font-size: 15px; font-weight: 500; z-index: 100002; transition: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55); border-radius: 8px; }
.ycs-toast.show { bottom: 20px; }
.ycs-toast.success { background-color: var(--ycs-success); }
.ycs-toast.error { background-color: var(--ycs-error); }
.ycs-toast.info { background-color: var(--ycs-info); }

/* === Logo injection on watch page (v3.23) === */
#yt-suite-watch-logo { display: flex; align-items: center; }
#yt-suite-watch-logo a { display: flex; align-items: center; }
#yt-suite-watch-logo ytd-logo { width: 90px; height: auto; }

/* === Custom rules from v3.23 for layout fixes === */
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
        // Load user's saved settings, or use defaults if none are found.
        appState.settings = await settingsManager.load();

        // Set the theme for the settings panel.
        document.documentElement.setAttribute('data-ycs-theme', appState.settings.panelTheme);

        // Build and inject all UI elements.
        injectPanelStyles();
        buildSettingsPanel();
        injectSettingsButton();
        attachUIEventListeners();
        updateAllToggleStates();

        // Loop through all features and initialize the ones that are enabled.
        features.forEach(f => {
            if (appState.settings[f.id]) {
                try {
                    f.init?.();
                } catch (error) {
                    console.error(`[YT Suite] Error initializing feature "${f.id}":`, error);
                }
            }
        });

        // Make sub-panels (like "Better Dark Mode") visible if their parent feature is enabled.
        document.querySelectorAll('.ycs-feature-cb:checked').forEach(cb => {
            const row = cb.closest('[data-feature-id]');
            if(row) {
                const featureId = row.dataset.featureId;
                const subPanel = document.querySelector(`.ycs-sub-panel[data-parent-feature="${featureId}"]`);
                if (subPanel) subPanel.style.display = 'flex';
            }
        });

        // On the very first run, open the settings panel automatically.
        const hasRun = await settingsManager.getFirstRunStatus();
        if (!hasRun) {
            document.body.classList.add('ycs-panel-open');
            await settingsManager.setFirstRunStatus(true);
        }
    }

    // Wait for the DOM to be ready before executing the script.
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }

})();
