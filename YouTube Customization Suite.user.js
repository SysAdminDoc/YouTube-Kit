// ==UserScript==
// @name         YouTube Customization Suite
// @namespace    https://github.com/user/yt-enhancement-suite
// @version      3.19.1
// @description  Ultimate YouTube customization. Hide elements, control layout, and enhance your viewing experience.
// @author       Matthew Parker
// @match        https://*.youtube.com/*
// @exclude      https://*.youtube.com/embed/*
// @exclude      https://*.youtube.com/shorts/*
// @icon         https://raw.githubusercontent.com/SysAdminDoc/Youtube_Customization_Suite/refs/heads/main/ytlogo.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @grant        GM_notification
// @grant        GM_download
// @grant        GM.xmlHttpRequest
// @connect      sponsor.ajay.app
// @updateURL    https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/YouTube%20Customization%20Suite.user.js
// @downloadURL  https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/YouTube%20Customization%20Suite.user.js
// @resource     betterDarkMode https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/Themes/youtube-dark-theme.css
// @resource     catppuccinMocha https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/Themes/youtube-catppuccin-theme.css
// @resource     nyanCatProgressBar https://raw.githubusercontent.com/SysAdminDoc/Youtube_Customization_Suite/refs/heads/main/Themes/nyan-cat-progress-bar.css
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

// ——————————————————————————————————————————————————————————————————————————
//  ~ CHANGELOG ~
//
//  v3.19.1
//  - FIXED: Race condition on watch pages where the player would sometimes fail to expand. Added a delay to the theater mode click to ensure the player is ready.
//  - FIXED: Conflicting CSS rule that could cause layout issues when "Fit Player to Window" is active. The rule is now conditional.
//
//  v3.19
//  - ADDED: New option "Hide Clarify Boxes" to hide informational panels on sensitive topics below videos.
//  - ADDED: New option "Hide Chat Messages from Bots" to filter live chat messages from users with "bot" in their name.
//
//  v3.18
//  - FIXED: Baked in new CSS rules for ytd-watch-metadata and ytd-live-chat-frame to correct the layout on watch pages by default.
//
// ——————————————————————————————————————————————————————————————————————————


    // —————————————————————
    // 0. DYNAMIC CONTENT/STYLE ENGINE (OPTIMIZED)
    // —————————————————————
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

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
        ruleFn(document.body);
    }
    function removeNavigateRule(id) {
        navigateRules.delete(id);
    }

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
        ruleFn(document.body);
    }
    function removeMutationRule(id) {
        mutationRules.delete(id);
        if (mutationRules.size === 0) stopObserver();
    }


    // —————————————————————
    // 1. SETTINGS MANAGER
    // —————————————————————
    const settingsManager = {
        defaults: {
            // Header
            hideCreateButton: false,
            hideVoiceSearch: false,
            logoToSubscriptions: false,

            // Sidebar
            hideSidebar: false,

            // Themes
            nativeDarkMode: false,
            betterDarkMode: false,
            catppuccinMocha: false,

            // Progress Bar Themes
            nyanCatProgressBar: false,

            // General Content
            removeAllShorts: true,
            redirectShorts: false,
            disablePlayOnHover: false,
            fullWidthSubscriptions: false,
            hideSubscriptionOptions: false,
            fiveVideosPerRow: false,
            hidePaidContentOverlay: false,

            // Watch Page - Layout
            fitPlayerToWindow: false,
            hideRelatedVideos: false,
            expandVideoWidth: true,
            floatingLogoOnWatch: false,

            // Watch Page - Behavior
            preventAutoplay: false,
            autoExpandDescription: false,
            sortCommentsNewestFirst: false,
            skipSponsors: false,

            // Watch Page - Other Elements
            hideMerchShelf: false,
            hideClarifyBoxes: false, // <-- NEW SETTING
            hideDescriptionExtras: false,
            hideHashtags: false,
            hidePinnedComments: false,
            hideCommentActionMenu: false,
            hideLiveChatEngagement: false,
            hidePaidPromotionWatch: false,
            hideVideoEndCards: false,
            hideVideoEndScreen: false,

            // Watch Page - Live Chat
            hideLiveChatHeader: false,
            hideChatMenu: false,
            hidePopoutChatButton: false,
            hideChatReactionsButton: false,
            hideChatTimestampsButton: false,
            hideChatPolls: false,
            hideChatPollBanner: false,
            hideChatTicker: false,
            hideViewerLeaderboard: false,
            hideChatSupportButtons: false,
            hideChatBanner: false,
            hideChatEmojiButton: false,
            hideTopFanIcons: false,
            hideSuperChats: false,
            hideLevelUp: false,
            hideChatBots: false, // <-- NEW SETTING
            keywordFilterList: '',

            // Watch Page - Action Buttons
            autolikeVideos: false,
            hideLikeButton: false,
            hideDislikeButton: false,
            hideShareButton: false,
            hideAskButton: false,
            hideClipButton: false,
            hideThanksButton: false,
            hideSaveButton: false,
            replaceWithCobaltDownloader: false,
            hideSponsorButton: false,
            hideMoreActionsButton: false,

            // Watch Page - Player Controls
            autoMaxResolution: false,
            useEnhancedBitrate: false,
            hideSponsorBlockButton: false,
            hideNextButton: false,
            hideAutoplayToggle: false,
            hideSubtitlesToggle: false,
            hideCaptionsContainer: false,
            hideMiniplayerButton: false,
            hidePipButton: false,
            hideTheaterButton: false,
            hideFullscreenButton: false,
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

    // —————————————————————
    // 2. FEATURE DEFINITIONS & LOGIC
    // —————————————————————

    // --- SponsorBlock Logic ---
    let sponsorSegments = [];
    let sponsorVideoId = null;
    let sponsorCheckInterval = null;

    function fetchSponsorSegments() {
        const urlParams = new URLSearchParams(window.location.search);
        const newVideoId = urlParams.get('v');

        if (newVideoId && newVideoId !== sponsorVideoId) {
            sponsorVideoId = newVideoId;
            sponsorSegments = [];

            GM.xmlHttpRequest({
                method: 'GET',
                url: `https://sponsor.ajay.app/api/skipSegments?videoID=${sponsorVideoId}&categories=["sponsor","selfpromo"]`,
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            sponsorSegments = data.map(item => item.segment);
                        } catch (e) {
                            console.error('[YT Suite SponsorBlock] Error parsing segments:', e);
                            sponsorSegments = [];
                        }
                    } else {
                        sponsorSegments = [];
                    }
                },
                onerror: function(error) {
                    console.error('[YT Suite SponsorBlock] API request failed:', error);
                    sponsorSegments = [];
                }
            });
        }
    }

    function checkSponsorSegment() {
        const video = document.querySelector('video.html5-main-video');
        if (video && !video.paused && sponsorSegments.length > 0) {
            const currentTime = video.currentTime;
            for (const segment of sponsorSegments) {
                if (currentTime >= segment[0] && currentTime < segment[1]) {
                    video.currentTime = segment[1];
                    console.log(`[YT Suite] Sponsored segment skipped to ${segment[1]}`);
                    break;
                }
            }
        }
    }
    // --- End SponsorBlock Logic ---


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
                    // Add a delay to ensure the player is ready for the click
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
            id: 'floatingLogoOnWatch',
            name: 'Logo in Video Header',
            description: 'On watch pages, adds a YouTube logo (linking to Subscriptions) next to the channel avatar.',
            group: 'Watch Page - Layout',
            _element: null,
            _ruleId: 'floatingLogoRule',
            handleLogoDisplay() {
                if (!window.location.pathname.startsWith('/watch')) {
                    this._element?.remove();
                    this._element = null;
                    document.getElementById('yt-suite-watch-logo')?.remove();
                    return;
                }
                const ownerDiv = document.querySelector('#top-row #owner');

                if (ownerDiv && !document.getElementById('yt-suite-watch-logo')) {
                    let logoEl = document.createElement('div');
                    logoEl.id = 'yt-suite-watch-logo';
                    const link = document.createElement('a');
                    link.href = '/feed/subscriptions';
                    link.title = 'YouTube Subscriptions';

                    const originalLogo = document.querySelector('ytd-topbar-logo-renderer ytd-logo');
                    if (originalLogo) {
                        link.appendChild(originalLogo.cloneNode(true));
                    } else {
                        const fallbackLogo = document.createElement('ytd-logo');
                        fallbackLogo.className = 'style-scope ytd-topbar-logo-renderer';
                        fallbackLogo.setAttribute('is-red-logo', '');
                        link.appendChild(fallbackLogo);
                    }
                    logoEl.appendChild(link);
                    ownerDiv.prepend(logoEl);
                    this._element = logoEl;
                }
            },
            init() {
                addNavigateRule(this._ruleId, this.handleLogoDisplay.bind(this));
            },
            destroy() {
                removeNavigateRule(this._ruleId);
                this._element?.remove();
                document.getElementById('yt-suite-watch-logo')?.remove();
                this._element = null;
            }
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
            destroy() { /* No cleanup needed as it's a one-time action on load */ }
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
            name: 'Skip Sponsored Segments',
            description: 'Automatically skips sponsored sections and self-promotion in videos using the SponsorBlock API.',
            group: 'Watch Page - Behavior',
            init() {
                if (window.location.pathname.startsWith('/watch')) {
                    fetchSponsorSegments();
                }
                window.addEventListener('yt-navigate-finish', fetchSponsorSegments);
                sponsorCheckInterval = setInterval(checkSponsorSegment, 500);
            },
            destroy() {
                window.removeEventListener('yt-navigate-finish', fetchSponsorSegments);
                if (sponsorCheckInterval) {
                    clearInterval(sponsorCheckInterval);
                    sponsorCheckInterval = null;
                }
                sponsorSegments = [];
                sponsorVideoId = null;
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
                    const likeButton = document.querySelector('button.yt-spec-button-shape-next--segmented-start');
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
            _lastUrl: '',
            _navigateListener: null,
            _styleElement: null,

            _INSTANCE: { protocol: 'https', apiHost : 'cobalt-api.meowing.de', frontend: 'cobalt.meowing.de' },
            _API_KEY: 'e4d331cc8267e6d04ecad6a5e22da9c7b31e97df',
            _getApiUrl() { return `${this._INSTANCE.protocol}://${this._INSTANCE.apiHost}/`; },
            _getFrontendUrl() { return `${this._INSTANCE.protocol}://${this._INSTANCE.frontend}/#`; },

            _isWatchPage() { return window.location.href.includes('/watch?'); },
            _removeElement(sel) { const e = document.querySelector(sel); if (e) e.remove(); },

            async _cobaltApiCall(videoUrl, audio = false, quality = '1080', format = 'webm') {
                const codec = format === 'webm' ? 'vp9' : 'h264';
                const body = { url: videoUrl, videoQuality: quality.replace('p',''), youtubeVideoCodec: codec, filenameStyle: 'pretty', downloadMode: audio ? 'audio' : 'auto' };
                try {
                    const resp = await window.fetch(this._getApiUrl(), {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json', 'X-API-Key': this._API_KEY },
                        body: JSON.stringify(body)
                    });
                    const data = await resp.json();
                    if (data.status === 'error') {
                        const c = data.error?.code || '';
                        GM_notification(c.includes('no_matching_format') ? 'Format unavailable – try a lower quality' : 'Cobalt error: ' + (data.error.message || data.error));
                        return null;
                    }
                    return data.url || data.downloadUrl || null;
                } catch(err) {
                    console.error('Cobalt request failed', err);
                    return null;
                }
            },

            async _listQualities() {
                const set = new Set();
                const fmts = window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats;
                if (fmts) {
                    fmts.forEach(f => { if (f.qualityLabel) { const m = f.qualityLabel.match(/^(\d+)/); if (m) set.add(m[1]); } });
                } else {
                    let html = ''; try { html = await (await fetch(location.href)).text() } catch {}
                    let m; const re = /"qualityLabel":"(\d+)p\d*"/g;
                    while ((m = re.exec(html)) !== null) set.add(m[1]);
                }
                return [...set].map(Number).sort((a, b) => b - a);
            },

            async _listFormats() {
                const set = new Set();
                const fmts = window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats;
                if (fmts) {
                    fmts.forEach(f => { const m = f.mimeType.match(/\/([^;]+)/); if (m) set.add(m[1]); });
                } else {
                    let html = ''; try { html = await (await fetch(location.href)).text() } catch {}
                    let m; const re = /"mimeType":"video\/([^;]+);/g;
                    while ((m = re.exec(html)) !== null) set.add(m[1]);
                }
                set.add('mp3');
                const arr = [...set];
                const idx = arr.indexOf('webm');
                if (idx > -1) { arr.splice(idx, 1); arr.unshift('webm'); }
                return arr;
            },

            _showPopup(videoUrl) {
                this._removeElement('#cobalt-popup');
                const dark = window.matchMedia('(prefers-color-scheme:dark)').matches;
                const c = document.createElement('div');
                c.id = 'cobalt-popup';
                c.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;padding:16px;border-radius:8px;background:${dark?'#1e1e1e':'#fff'};color:${dark?'#ddd':'#000'};border:2px solid ${dark?'#444':'#888'};box-shadow:0 4px 12px rgba(0,0,0,0.5);width:300px;max-height:80vh;overflow:auto;font-family:sans-serif;font-size:14px;`;
                const lblFmt = document.createElement('label'); lblFmt.textContent = 'format';
                const selFmt = document.createElement('select'); selFmt.id = 'cobalt-format'; selFmt.style.cssText = 'width:100%;margin:8px 0;padding:4px';
                const lblQ = document.createElement('label'); lblQ.id = 'label-quality'; lblQ.textContent = 'quality';
                const selQ = document.createElement('select'); selQ.id = 'cobalt-quality'; selQ.style.cssText = 'width:100%;margin:8px 0;padding:4px';
                const loading = document.createElement('div'); loading.id = 'cobalt-loading'; loading.textContent = 'loading…'; loading.style.cssText = 'display:none;text-align:center;margin:8px 0';
                const btn = document.createElement('button'); btn.id = 'cobalt-start'; btn.textContent = 'loading…'; btn.disabled = true;
                btn.style.cssText = `width:100%;padding:8px;background:#ff5722;color:#fff;border:none;border-radius:4px;font-size:15px;cursor:pointer;transition:background .2s;`;
                btn.onmouseenter = () => btn.style.background = '#e64a19';
                btn.onmouseleave = () => btn.style.background = '#ff5722';
                c.append(lblFmt, selFmt, lblQ, selQ, loading, btn);
                document.body.appendChild(c);

                setTimeout(() => { document.addEventListener('click', e => { if (!c.contains(e.target)) this._removeElement('#cobalt-popup'); }, { once: true }); }, 200);

                this._listFormats().then(arr => {
                    arr.forEach(fmt => { const o = document.createElement('option'); o.value = fmt; o.textContent = fmt; selFmt.append(o); });
                    btn.disabled = false; btn.textContent = 'Download';
                });
                this._listQualities().then(arr => { arr.forEach(q => { const o = document.createElement('option'); o.value = q; o.textContent = `${q}p`; selQ.append(o); }); });

                selFmt.addEventListener('change', () => {
                    const audio = ['mp3', 'opus', 'wav'].includes(selFmt.value);
                    lblQ.style.display = audio ? 'none' : 'block';
                    selQ.style.display = audio ? 'none' : 'block';
                });

                btn.addEventListener('click', async () => {
                    btn.disabled = true; loading.style.display = 'block';
                    const fmt = selFmt.value, qu = selQ.value;
                    const audio = ['mp3', 'opus', 'wav'].includes(fmt);
                    const link = await this._cobaltApiCall(videoUrl, audio, qu, fmt);
                    loading.style.display = 'none'; btn.disabled = false; this._removeElement('#cobalt-popup');
                    if (!link) { window.open(this._getFrontendUrl() + encodeURIComponent(videoUrl), '_blank'); return; }
                    const raw = document.title.replace(/\s*-\s*YouTube.*$/, '').trim();
                    const safe = raw.replace(/[\/\\?%*:|"<>]/g, '_');
                    const ext = audio ? 'mp3' : fmt;
                    const name = `${safe}_${qu}.${ext}`;
                    GM_download({ url: link, name, saveAs: true });
                });
            },

            _injectButton() {
                if (!this._isWatchPage() || document.querySelector('button[id^="cobaltBtn"]')) return;
                const id = 'cobaltBtn' + Math.random().toString(36).substr(2, 5);
                const btn = document.createElement('button');
                btn.id = id; btn.textContent = 'Download';
                btn.setAttribute('aria-label', 'Download video');
                btn.style.cssText = `font-size:14px;padding:6px 12px;margin-left:8px;border-radius:20px;border:2px solid #ff5722;background:transparent;color:#ff5722;cursor:pointer;transition:background .2s,color .2s;`;
                btn.onmouseenter = () => { btn.style.background = '#ff5722'; btn.style.color = '#fff'; };
                btn.onmouseleave = () => { btn.style.background = 'transparent'; btn.style.color = '#ff5722'; };
                btn.addEventListener('click', () => this._showPopup(window.location.href));
                const parent = document.querySelector('#actions-inner #end-buttons, #top-level-buttons-computed');
                if (parent) parent.appendChild(btn);
            },

            _runInitLogic() {
                if (window.location.href === this._lastUrl) return;
                this._lastUrl = window.location.href;
                this._injectButton();
                this._removeElement('#cobalt-popup');
            },

            init() {
                this._styleElement = injectStyle('ytd-download-button-renderer', 'hideNativeDownload');
                this._navigateListener = () => setTimeout(() => this._runInitLogic(), 1000);
                window.addEventListener('yt-navigate-finish', this._navigateListener);
                setTimeout(() => this._runInitLogic(), 2000);
            },

            destroy() {
                if (this._navigateListener) window.removeEventListener('yt-navigate-finish', this._navigateListener);
                this._removeElement('button[id^="cobaltBtn"]');
                this._removeElement('#cobalt-popup');
                this._styleElement?.remove();
                this._lastUrl = '';
            }
        },
        { id: 'hideSponsorButton', name: 'Hide Join/Sponsor Button', description: 'Hides the channel membership "Join" button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#sponsor-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMoreActionsButton', name: 'Hide "More actions" (3-dot) Button', description: 'Hides the three-dots "More actions" menu button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner #button-shape > button[aria-label="More actions"]', this.id); }, destroy() { this._styleElement?.remove(); }},

        // Group: Watch Page - Player Controls
        {
            id: 'autoMaxResolution',
            name: 'Auto Max Resolution',
            description: 'Automatically sets the video quality to the highest available resolution.',
            group: 'Watch Page - Player Controls',
            _onPlayerUpdated: null,
            _onNavigateFinish: null,
            init() {
                const setMaxQuality = (player) => {
                    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;
                    const levels = player.getAvailableQualityLevels();
                    if (!levels || !levels.length) return;
                    const best = levels.map(l => ({ l, n: parseInt((l.match(/\d+/) || [])[0], 10) || 0 })).sort((a, b) => b.n - a.n)[0].l;
                    try {
                        player.setPlaybackQualityRange(best);
                    } catch (e) {
                        console.warn('[YT Suite AutoMaxRes] Could not set quality', e);
                    }

                    if (best === 'hd1080' && appState.settings.useEnhancedBitrate) {
                        const settingsButton = document.querySelector('.ytp-settings-button');
                        if (!settingsButton) return;

                        const tempStyle = document.createElement('style');
                        tempStyle.id = 'yt-suite-temp-hide-menu';
                        tempStyle.textContent = '.ytp-popup.ytp-settings-menu { opacity: 0 !important; pointer-events: none !important; }';
                        document.head.appendChild(tempStyle);

                        try {
                            settingsButton.click();
                            setTimeout(() => {
                                const qualityMenu = Array.from(document.querySelectorAll('.ytp-menuitem-label')).find(el => el.textContent.includes('Quality'));
                                if (qualityMenu) {
                                    qualityMenu.parentElement.click();
                                    setTimeout(() => {
                                        const premiumOption = Array.from(document.querySelectorAll('.ytp-menuitem-label')).find(label => label.textContent.includes('1080p Premium'));
                                        if (premiumOption) {
                                            premiumOption.parentElement.click();
                                        } else {
                                            settingsButton.click();
                                        }
                                    }, 400);
                                } else {
                                    settingsButton.click();
                                }
                            }, 400);
                        } finally {
                            setTimeout(() => tempStyle.remove(), 1500);
                        }
                    }
                };

                this._onPlayerUpdated = (evt) => setMaxQuality(evt?.target?.player_ || document.getElementById('movie_player'));
                this._onNavigateFinish = () => setTimeout(() => setMaxQuality(document.getElementById('movie_player')), 1500);

                window.addEventListener('yt-player-updated', this._onPlayerUpdated, true);
                window.addEventListener('yt-navigate-finish', this._onNavigateFinish, true);
                this._onNavigateFinish();
            },
            destroy() {
                if (this._onPlayerUpdated) window.removeEventListener('yt-player-updated', this._onPlayerUpdated, true);
                if (this._onNavigateFinish) window.removeEventListener('yt-navigate-finish', this._onNavigateFinish, true);
            }
        },
        {
            id: 'useEnhancedBitrate',
            name: 'Use Enhanced Bitrate (for Premium users)',
            description: 'If max resolution is 1080p, attempts to select the "Premium" enhanced bitrate option. Requires YouTube Premium.',
            group: 'Watch Page - Player Controls',
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

    // —————————————————————
    // 3. DOM HELPERS & CORE UI
    // —————————————————————
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

    function createCogSvg() {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "currentColor");
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        const path1 = document.createElementNS(svgNS, "path");
        path1.setAttribute("d", "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69-.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22-.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z");
        svg.appendChild(path1);
        return svg;
    }

    function injectSettingsButton() {
        const handleDisplay = () => {
            const isWatch = window.location.pathname.startsWith('/watch');

            document.getElementById('yt-masthead-cog')?.remove();
            document.getElementById('yt-suite-watch-cog')?.remove();

            if (isWatch) {
                const ownerDiv = document.querySelector('#top-row #owner');
                if (ownerDiv) {
                    const cog = document.createElement('div');
                    cog.id = 'yt-suite-watch-cog';
                    const btn = document.createElement('button');
                    btn.title = 'Open YouTube Suite Settings';
                    btn.appendChild(createCogSvg());
                    btn.onclick = () => document.body.classList.toggle('yt-suite-panel-open');
                    cog.appendChild(btn);
                    const logo = document.getElementById('yt-suite-watch-logo');
                    if (logo && logo.parentElement === ownerDiv) {
                        ownerDiv.insertBefore(cog, logo.nextSibling);
                    } else {
                        ownerDiv.prepend(cog);
                    }
                }
            } else {
                const masthead = document.querySelector('ytd-topbar-logo-renderer');
                if (masthead) {
                    const cog = document.createElement('div');
                    cog.id = 'yt-masthead-cog';
                    const btn = document.createElement('button');
                    btn.title = 'Open YouTube Suite Settings';
                    btn.appendChild(createCogSvg());
                    btn.onclick = () => document.body.classList.toggle('yt-suite-panel-open');
                    cog.appendChild(btn);
                    masthead.appendChild(cog);
                }
            }
        };
        addNavigateRule("settingsButtonRule", handleDisplay);
    }


    // —————————————————————
    // 4. UI & SETTINGS PANEL
    // —————————————————————
    function buildPanel(appState) {
        const groups = features.reduce((acc, f) => {
            acc[f.group] = acc[f.group] || [];
            if (!['betterDarkMode', 'expandVideoWidth', 'useEnhancedBitrate', 'catppuccinMocha'].includes(f.id)) {
                 acc[f.group].push(f);
            }
            return acc;
        }, {});


        const panelContainer = document.createElement('div');
        panelContainer.id = 'yt-suite-panel-container';
        const overlay = document.createElement('div');
        overlay.className = 'yt-suite-panel-overlay';
        overlay.onclick = () => document.body.classList.remove('yt-suite-panel-open');
        const panel = document.createElement('div');
        panel.className = 'yt-suite-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-labelledby', 'yt-suite-panel-title');
        const header = document.createElement('header');
        const title = document.createElement('h2');
        title.id = 'yt-suite-panel-title';
        title.textContent = 'YouTube Customization Suite';
        const version = document.createElement('span');
        version.className = 'version';
        version.textContent = 'v3.19.1';
        header.append(title, version);

        const main = document.createElement('main');
        const groupOrder = [ 'Header', 'Sidebar', 'Themes', 'Progress Bar Themes', 'General Content', 'Watch Page - Layout', 'Watch Page - Behavior', 'Watch Page - Other Elements', 'Watch Page - Live Chat', 'Watch Page - Action Buttons', 'Watch Page - Player Controls' ];

        const createSubSetting = (subFeatureId, parentInput) => {
            const subFeat = features.find(x => x.id === subFeatureId);
            if (!subFeat) return null;
            const wrapper = document.createElement('div');
            wrapper.className = 'yt-suite-switch-wrapper yt-suite-sub-setting-wrapper';
            wrapper.dataset.tooltip = subFeat.description;
            const label = document.createElement('label');
            label.className = 'yt-suite-switch';
            label.htmlFor = `switch-${subFeat.id}`;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `switch-${subFeat.id}`;
            input.checked = appState.settings[subFeat.id];
            input.onchange = async (e) => {
                const isChecked = e.target.checked;
                appState.settings[subFeat.id] = isChecked;
                await settingsManager.save(appState.settings);
                const feat = features.find(x => x.id === subFeat.id);
                if (feat) {
                    if (isChecked) { if (feat.init) feat.init(); }
                    else { if (feat.destroy) feat.destroy(); }
                }
            };
            const slider = document.createElement('span');
            slider.className = 'slider';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'label';
            nameSpan.textContent = subFeat.name;
            label.append(input, slider);
            wrapper.append(label, nameSpan);
            wrapper.style.display = parentInput.checked ? 'flex' : 'none';
            parentInput.addEventListener('change', (e) => {
                wrapper.style.display = e.target.checked ? 'flex' : 'none';
                if (!e.target.checked && input.checked) {
                    input.checked = false;
                    input.dispatchEvent(new Event('change'));
                }
            });
            return wrapper;
        };

        const masterControlFieldset = document.createElement('fieldset');
        masterControlFieldset.className = 'yt-suite-feature-group';
        const masterLegend = document.createElement('legend');
        masterLegend.textContent = 'Master Controls';
        masterControlFieldset.appendChild(masterLegend);

        const recommendedIds = new Set([
            'hideCreateButton', 'hideVoiceSearch', 'hideSidebar', 'nativeDarkMode',
            'betterDarkMode', 'removeAllShorts', 'redirectShorts', 'disablePlayOnHover',
            'fullWidthSubscriptions', 'hideSubscriptionOptions', 'fiveVideosPerRow', 'hidePaidContentOverlay',
            'fitPlayerToWindow', 'hideRelatedVideos', 'floatingLogoOnWatch', 'hideMerchShelf',
            'hideDescriptionExtras', 'hideHashtags', 'hidePinnedComments', 'hideCommentActionMenu',
            'hideLiveChatEngagement', 'hidePaidPromotionWatch', 'hideVideoEndCards',
            'hideVideoEndScreen', 'hideLiveChatHeader', 'hideChatMenu', 'hidePopoutChatButton',
            'hideChatReactionsButton', 'hideChatTimestampsButton', 'hideChatPolls',
            'hideChatPollBanner', 'hideChatBanner', 'hideSuperChats', 'hideLevelUp',
            'hideViewerLeaderboard', 'hideChatSupportButtons', 'hideChatEmojiButton',
            'hideTopFanIcons', 'autolikeVideos', 'hideLikeButton', 'hideDislikeButton',
            'hideShareButton', 'hideAskButton', 'hideClipButton', 'hideThanksButton',
            'hideSaveButton', 'replaceWithCobaltDownloader', 'hideSponsorButton',
            'hideMoreActionsButton', 'autoMaxResolution', 'hideSponsorBlockButton',
            'hideNextButton', 'hideAutoplayToggle', 'hideSubtitlesToggle',
            'hideMiniplayerButton', 'hidePipButton', 'hideTheaterButton',
            'hideFullscreenButton'
        ]);

        const createMasterToggle = (id, name, description, action) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'yt-suite-input-wrapper yt-suite-switch-wrapper';
            wrapper.dataset.tooltip = description;
            const label = document.createElement('label');
            label.className = 'yt-suite-switch';
            label.htmlFor = `switch-${id}`;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `switch-${id}`;
            input.onchange = (e) => {
                if (!e.target.checked) return;
                action();
                e.target.checked = false;
            };
            const slider = document.createElement('span');
            slider.className = 'slider';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'label';
            nameSpan.textContent = name;
            label.append(input, slider);
            wrapper.append(label, nameSpan);
            return wrapper;
        };

        const enableRecommendedAction = () => {
            features.forEach(feat => {
                const shouldBeOn = recommendedIds.has(feat.id);
                const uiSwitch = document.getElementById(`switch-${feat.id}`);
                if (uiSwitch && uiSwitch.checked !== shouldBeOn) {
                    uiSwitch.checked = shouldBeOn;
                    uiSwitch.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        };

        const disableAllAction = () => {
            features.forEach(feat => {
                const uiSwitch = document.getElementById(`switch-${feat.id}`);
                if (uiSwitch && uiSwitch.checked) {
                    uiSwitch.checked = false;
                    uiSwitch.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        };

        masterControlFieldset.appendChild(createMasterToggle('recommended', 'Enable Recommended', 'Enable a curated set of features for an enhanced experience.', enableRecommendedAction));
        masterControlFieldset.appendChild(createMasterToggle('disableAll', 'Disable All', 'Disable all active features.', disableAllAction));
        main.appendChild(masterControlFieldset);


        groupOrder.forEach(groupName => {
            if (!groups[groupName] || groups[groupName].length === 0) return;
            const fieldset = document.createElement('fieldset');
            fieldset.className = 'yt-suite-feature-group';
            const legend = document.createElement('legend');
            legend.textContent = groupName;
            fieldset.appendChild(legend);
            groups[groupName].forEach(f => {
                const wrapper = document.createElement('div');
                wrapper.className = 'yt-suite-input-wrapper';
                wrapper.dataset.tooltip = f.description;

                if (f.type === 'textarea') {
                    wrapper.classList.add('yt-suite-textarea-wrapper');
                    const label = document.createElement('label');
                    label.htmlFor = `input-${f.id}`;
                    label.textContent = f.name;
                    label.className = 'yt-suite-textarea-label';
                    const textarea = document.createElement('textarea');
                    textarea.id = `input-${f.id}`;
                    textarea.placeholder = 'e.g. word1, phrase two, user3';
                    textarea.value = appState.settings[f.id];
                    textarea.oninput = async () => {
                        appState.settings[f.id] = textarea.value;
                        await settingsManager.save(appState.settings);
                        const feat = features.find(x => x.id === f.id);
                        if(feat) {
                            if(feat.destroy) feat.destroy();
                            if(feat.init) feat.init();
                        }
                    };
                    textarea.onfocus = () => panelContainer.classList.add('yt-suite-revealing');
                    textarea.onblur = () => panelContainer.classList.remove('yt-suite-revealing');

                    wrapper.append(label, textarea);

                } else {
                    wrapper.classList.add('yt-suite-switch-wrapper');
                    const label = document.createElement('label');
                    label.className = 'yt-suite-switch';
                    label.htmlFor = `switch-${f.id}`;
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.id = `switch-${f.id}`;
                    input.dataset.featureId = f.id;
                    input.checked = appState.settings[f.id];
                    input.onchange = async (e) => {
                        const id = e.target.dataset.featureId;
                        const isChecked = e.target.checked;
                        appState.settings[id] = isChecked;
                        await settingsManager.save(appState.settings);
                        const feat = features.find(x => x.id === id);
                        if (feat) {
                            if (isChecked) { if (feat.init) feat.init(); }
                            else { if (feat.destroy) feat.destroy(); }
                        }
                    };
                    const slider = document.createElement('span');
                    slider.className = 'slider';
                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'label';
                    nameSpan.textContent = f.name;
                    label.append(input, slider);
                    wrapper.append(label, nameSpan);

                    fieldset.appendChild(wrapper);

                    if (f.id === 'hideRelatedVideos') {
                        const sub = createSubSetting('expandVideoWidth', input);
                        if (sub) wrapper.after(sub);
                    }
                    if (f.id === 'nativeDarkMode') {
                        const betterDark = createSubSetting('betterDarkMode', input);
                        const catppuccin = createSubSetting('catppuccinMocha', input);
                        if(catppuccin) wrapper.after(catppuccin);
                        if(betterDark) wrapper.after(betterDark);
                    }
                    if (f.id === 'autoMaxResolution') {
                        const sub = createSubSetting('useEnhancedBitrate', input);
                        if (sub) wrapper.after(sub);
                    }
                    return;
                }
                fieldset.appendChild(wrapper);
            });
            main.appendChild(fieldset);
        });

        const footer = document.createElement('footer');
        const closeBtn = document.createElement('button');
        closeBtn.id = 'yt-suite-close-btn';
        closeBtn.className = 'yt-suite-btn-primary';
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => document.body.classList.remove('yt-suite-panel-open');
        footer.append(closeBtn);

        panel.append(header, main, footer);
        panelContainer.append(overlay, panel);
        document.body.appendChild(panelContainer);
    }


    // —————————————————————
    // 5. STYLES
    // —————————————————————
    function injectPanelStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
            :root { --panel-font: 'Roboto', sans-serif; --panel-radius: 12px; --panel-shadow: 0 10px 30px -5px rgba(0,0,0,0.3); --yt-suite-panel-bg: #282828; --yt-suite-panel-fg: #f1f1f1; --yt-suite-border-color: #4d4d4d; --yt-suite-accent-color: #ff0000; }
            body.yt-suite-panel-open #yt-suite-panel-container .yt-suite-panel-overlay { opacity: 1; pointer-events: auto; }
            .yt-suite-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 10000; opacity: 0; pointer-events: none; transition: background .3s ease, opacity .3s ease; }
            #yt-suite-panel-container.yt-suite-revealing .yt-suite-panel-overlay { background: transparent !important; pointer-events: none !important; }
            .yt-suite-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 90%; max-width: 520px; background: var(--yt-suite-panel-bg); color: var(--yt-suite-panel-fg); border-radius: var(--panel-radius); box-shadow: var(--panel-shadow); font-family: var(--panel-font); opacity: 0; pointer-events: none; transition: opacity .3s ease, transform .3s ease; z-index: 10001; display: flex; flex-direction: column; }
            body.yt-suite-panel-open .yt-suite-panel { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
            .yt-suite-panel header { padding: 20px 24px; border-bottom: 1px solid var(--yt-suite-border-color); display: flex; justify-content: space-between; align-items: center; }
            .yt-suite-panel h2 { margin: 0; font-size: 18px; font-weight: 700; }
            .yt-suite-panel .version { font-size: 12px; opacity: 0.6; }
            .yt-suite-panel main { padding: 16px 24px; flex-grow: 1; max-height: 70vh; overflow-y: auto; }
            .yt-suite-panel footer { padding: 16px 24px; border-top: 1px solid var(--yt-suite-border-color); display: flex; justify-content: flex-end; align-items: center; }
            .yt-suite-feature-group { border: 1px solid var(--yt-suite-border-color); border-radius: 8px; padding: 16px; margin: 0 0 16px; }
            .yt-suite-feature-group legend { padding: 0 8px; font-size: 14px; font-weight: 500; color: var(--yt-suite-accent-color); }
            .yt-suite-input-wrapper { margin-bottom: 12px; position: relative; }
            .yt-suite-switch-wrapper { display: flex; align-items: center; }
            .yt-suite-input-wrapper:last-child { margin-bottom: 0; }
            .yt-suite-switch { display: flex; align-items: center; cursor: pointer; }
            .yt-suite-switch-wrapper .label { margin-left: 12px; flex: 1; font-size: 15px; }
            .yt-suite-switch input { display: none; }
            .yt-suite-switch .slider { width: 40px; height: 22px; background: #555; border-radius: 11px; position: relative; transition: background .2s ease; }
            .yt-suite-switch .slider:before { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform .2s ease; }
            .yt-suite-switch input:checked + .slider { background: var(--yt-suite-accent-color); }
            .yt-suite-switch input:checked + .slider:before { transform: translateX(18px); }
            .yt-suite-input-wrapper::after { content: attr(data-tooltip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; background: #111; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 10003; }
            .yt-suite-input-wrapper:hover::after { opacity: 1; }
            .yt-suite-sub-setting-wrapper { margin-left: 20px; padding-left: 10px; border-left: 2px solid var(--yt-suite-border-color); margin-top: 8px; margin-bottom: 12px; }
            .yt-suite-textarea-wrapper { display: flex; flex-direction: column; }
            .yt-suite-textarea-label { margin-bottom: 8px; font-size: 15px; }
            .yt-suite-textarea-wrapper textarea { width: 100%; min-height: 80px; background-color: #1a1a1a; border: 1px solid var(--yt-suite-border-color); color: var(--yt-suite-panel-fg); border-radius: 4px; padding: 8px; font-family: inherit; font-size: 14px; resize: vertical; }
            .yt-suite-textarea-wrapper textarea:focus { border-color: var(--yt-suite-accent-color); outline: none; }
            .yt-suite-btn-primary { background-color: var(--yt-suite-accent-color); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-family: var(--panel-font); font-weight: 500; cursor: pointer; transition: background-color .2s; }
            .yt-suite-btn-primary:hover { background-color: #cc0000; }
            #yt-suite-watch-logo, #yt-suite-watch-cog { display: flex; align-items: center; }
            #yt-suite-watch-cog { margin: 0 8px 0 24px; }
            #yt-suite-watch-logo a { display: flex; align-items: center; }
            #yt-suite-watch-logo ytd-logo { width: 90px; height: auto; }
            #yt-suite-watch-cog button { background: transparent; border: none; width: 40px; height: 40px; cursor: pointer; padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
            #yt-suite-watch-cog svg { width: 24px; height: 24px; fill: var(--yt-spec-icon-inactive); }
            #yt-suite-watch-cog button:hover { background-color: var(--yt-spec-badge-chip-background); }
            ytd-topbar-logo-renderer { position: relative; }
            #yt-masthead-cog { position: absolute; top: 50%; transform: translateY(-50%); left: 135px; }
            #yt-masthead-cog button { background: transparent; border: none; width: 40px; height: 40px; cursor: pointer; padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
            #yt-masthead-cog svg { fill: var(--yt-spec-icon-inactive); }
            #yt-masthead-cog button:hover { background-color: var(--yt-spec-badge-chip-background); }
            body:not(.yt-suite-fit-to-window) ytd-watch-metadata.watch-active-metadata.style-scope.ytd-watch-flexy.style-scope.ytd-watch-flexy {
                margin-top: 180px !important;
            }
            body:not(.yt-suite-fit-to-window) ytd-live-chat-frame {
                margin-top: -57px !important;
                width: 402px !important;
            }
        `;
        document.head.appendChild(style);
    }


    // —————————————————————
    // 6. MAIN BOOTSTRAP
    // —————————————————————
    async function main() {
        appState.settings = await settingsManager.load();
        injectPanelStyles();
        buildPanel(appState);
        injectSettingsButton();

        features.forEach(f => {
            if (appState.settings[f.id]) {
                try {
                    if (f.init) f.init();
                } catch (error) {
                    console.error(`[YT Suite] Error initializing feature "${f.id}":`, error);
                }
            }
        });

        const hasRun = await settingsManager.getFirstRunStatus();
        if (!hasRun) {
            document.body.classList.add('yt-suite-panel-open');
            await settingsManager.setFirstRunStatus(true);
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }

})();
