// ==UserScript==
// @name         YouTube Customization Suite
// @namespace    https://github.com/user/yt-enhancement-suite
// @version      3.0
// @description  Ultimate YouTube customization. Hide elements, control layout, and enhance your viewing experience.
// @author       Matthew Parker
// @match        https://*.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_getResourceText
// @updateURL    https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/YouTube%20Customization%20Suite.user.js
// @downloadURL  https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/YouTube%20Customization%20Suite.user.js
// @resource     betterDarkMode https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/Themes/youtube-dark-theme.css
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ——————————————————————————————————————————————————————————————————————————
    //  ~ YouTube Customization Suite v3.0 ~
    //
    //  - Added feature to hide live chat engagement messages.
    //  - Added default CSS fixes for watch page metadata and live chat layout.
    //  - Relocated watch page controls (Logo, Settings Cog) from a floating
    //    position to the top metadata bar, next to the channel avatar.
    //
    // ——————————————————————————————————————————————————————————————————————————


    // —————————————————————
    // 0. DYNAMIC CONTENT/STYLE ENGINE
    // —————————————————————
    let dynamicObserver = null;
    const activeRules = new Map();

    const runAllRules = (targetNode) => {
        for (const rule of activeRules.values()) {
            try {
                rule(targetNode);
            } catch (e) {
                console.error('[YT Suite] Error applying rule:', e);
            }
        }
    };

    const observerCallback = (mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                 runAllRules(document.body);
            }
            if (mutation.type === 'attributes') {
                runAllRules(mutation.target);
            }
        }
    };

    function startObserver() {
        if (dynamicObserver) return;
        dynamicObserver = new MutationObserver(observerCallback);
        dynamicObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['theater', 'fullscreen', 'hidden', 'video-id']
        });
        // Also listen for YouTube's own navigation event for SPA
        window.addEventListener('yt-navigate-finish', () => runAllRules(document.body));
    }

    function stopObserver() {
        if (dynamicObserver) {
            dynamicObserver.disconnect();
            dynamicObserver = null;
        }
        window.removeEventListener('yt-navigate-finish', () => runAllRules(document.body));
    }

    function addRule(id, ruleFn) {
        if (activeRules.size === 0) {
            startObserver();
        }
        activeRules.set(id, ruleFn);
        ruleFn(document.body); // Run rule immediately on addition
    }

    function removeRule(id) {
        activeRules.delete(id);
        if (activeRules.size === 0) {
            stopObserver();
        }
    }


    // —————————————————————
    // 1. SETTINGS MANAGER
    // —————————————————————
    const settingsManager = {
        defaults: {
            // Core UI
            settingsButton: true,

            // Header
            hideCreateButton: false,
            hideVoiceSearch: false,
            logoToSubscriptions: false,

            // Sidebar
            hideSidebar: false,

            // Themes
            nativeDarkMode: false,
            betterDarkMode: false,

            // General Content
            removeAllShorts: true,
            fullWidthSubscriptions: false,
            fiveVideosPerRow: false,

            // Watch Page - Layout
            fitPlayerToWindow: false,
            hideRelatedVideos: false,
            expandVideoWidth: true,
            floatingLogoOnWatch: false, // This ID is kept for settings compatibility

            // Watch Page - Other Elements
            hideMerchShelf: false,
            hideDescriptionExtras: false,
            hidePinnedComments: false,
            hideLiveChatEngagement: false,

            // Watch Page - Action Buttons
            autolikeVideos: false,
            hideLikeButton: false,
            hideDislikeButton: false,
            hideShareButton: false,
            hideDownloadButton: false,
            hideSponsorButton: false,
            hideMoreActionsButton: false,

            // Watch Page - Player Controls
            autoMaxResolution: false,
            hideNextButton: false,
            hideAutoplayToggle: false,
            hideSubtitlesToggle: false,
            hideMiniplayerButton: false,
            hidePipButton: false,
            hideTheaterButton: false,
            hideFullscreenButton: false,

        },
        async load() {
            let savedSettings = await GM_getValue('ytSuiteSettings', {});
            // Migration for older setting name
            if (savedSettings.hasOwnProperty('collapsibleGuide')) {
                delete savedSettings.collapsibleGuide;
            }
            if (savedSettings.hasOwnProperty('hideShortsFeed')) {
                savedSettings.removeAllShorts = savedSettings.hideShortsFeed;
                delete savedSettings.hideShortsFeed;
            }
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
    // 2. FEATURE DEFINITIONS
    // —————————————————————
    const features = [
        // Group: Core UI
        {
            id: 'settingsButton',
            name: 'Settings Button',
            description: 'Shows a settings cog. On watch pages, it appears next to the channel info. On other pages, it appears in the main header.',
            group: 'Core UI',
            _elements: { watch: null, masthead: null },
            _ruleId: 'settingsButtonRule',
            _handleDisplay() {
                const isWatch = window.location.pathname.startsWith('/watch');

                // --- Handle Watch Page ---
                if (isWatch) {
                    this._elements.masthead?.remove(); // Clean up other page's cog
                    this._elements.masthead = null;
                    document.getElementById('yt-floating-cog')?.remove(); // Clean up old floating cog

                    const ownerDiv = document.querySelector('#top-row #owner');
                    if (ownerDiv && !document.getElementById('yt-suite-watch-cog')) {
                        const cog = document.createElement('div');
                        cog.id = 'yt-suite-watch-cog';
                        const btn = document.createElement('button');
                        btn.title = 'Open YouTube Suite Settings';
                        btn.appendChild(createCogSvg());
                        btn.onclick = () => document.body.classList.toggle('yt-suite-panel-open');
                        cog.appendChild(btn);
                        this._elements.watch = cog;

                        // Insert into DOM, respecting logo order
                        const logo = document.getElementById('yt-suite-watch-logo');
                        if (logo && logo.parentElement === ownerDiv) {
                            ownerDiv.insertBefore(cog, logo.nextSibling);
                        } else {
                            ownerDiv.prepend(cog);
                        }
                    }
                }
                // --- Handle Non-Watch Page ---
                else {
                    this._elements.watch?.remove(); // Clean up watch page's cog
                    this._elements.watch = null;

                    const masthead = document.querySelector('ytd-topbar-logo-renderer');
                    if (masthead && !document.getElementById('yt-masthead-cog')) {
                        const cog = document.createElement('div');
                        cog.id = 'yt-masthead-cog';
                        const btn = document.createElement('button');
                        btn.title = 'Open YouTube Suite Settings';
                        btn.appendChild(createCogSvg());
                        btn.onclick = () => document.body.classList.toggle('yt-suite-panel-open');
                        cog.appendChild(btn);
                        masthead.appendChild(cog);
                        this._elements.masthead = cog;
                    }
                }
            },
            init() {
                addRule(this._ruleId, this._handleDisplay.bind(this));
            },
            destroy() {
                removeRule(this._ruleId);
                this._elements.watch?.remove();
                this._elements.masthead?.remove();
                document.getElementById('yt-suite-watch-cog')?.remove(); // Extra cleanup
                this._elements = { watch: null, masthead: null };
            }
        },

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
            _observer: null,
            _relinkLogo() {
                const logoRenderer = document.querySelector('ytd-topbar-logo-renderer');
                if (!logoRenderer) return;
                const link = logoRenderer.querySelector('a#logo');
                if (link) {
                    link.href = '/feed/subscriptions';
                }
            },
            init() {
                addRule('relinkLogoRule', () => this._relinkLogo());
            },
            destroy() {
                removeRule('relinkLogoRule');
                const logoLink = document.querySelector('ytd-topbar-logo-renderer a#logo');
                if (logoLink) logoLink.href = '/'; // Restore original link
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
                this._applyTheme(); // Apply immediately
                addRule(this._ruleId, this._applyTheme.bind(this));
            },
            destroy() {
                document.documentElement.removeAttribute('dark');
                removeRule(this._ruleId);
            }
        },
        {
            id: 'betterDarkMode',
            name: 'Better Full Dark Theme',
            description: 'Enhances the native dark theme. Requires "YouTube Native Dark Theme" to be enabled.',
            group: 'Themes', // Note: This feature is only controllable as a sub-setting
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('betterDarkMode');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                } else {
                    console.error('[YT Suite] Could not load betterDarkMode resource. Was the script installed correctly?');
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
                addRule(this.id, removeShortsRule);
                const css = `
                    ytd-reel-shelf-renderer,
                    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]) {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id + '-style', true);
            },
            destroy() {
                removeRule(this.id);
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
                    const watchFlexy = document.querySelector('ytd-watch-flexy:not([theater])');
                    if (watchFlexy) {
                         document.querySelector('button.ytp-size-button')?.click();
                    }
                }
            },
            init() {
                this._styleElement = document.createElement('style');
                this._styleElement.id = `yt-suite-style-${this.id}`;
                this._styleElement.textContent = `
                    /* allow the page to scroll */
                    html.yt-suite-fit-to-window,
                    body.yt-suite-fit-to-window {
                        overflow-y: auto !important;
                        height: auto !important;
                    }

                    /* pin the player full-screen */
                    body.yt-suite-fit-to-window #movie_player {
                        position: absolute !important;
                        top: 0 !important;
                        left: 0 !important;
                        width: 100% !important;
                        height: 100vh !important;
                        z-index: 9999 !important;
                        background-color: #000 !important;
                    }

                    /* create space for the player and header */
                    html.yt-suite-fit-to-window {
                        padding-top: calc(100vh) !important;
                    }

                    /* Hide the header */
                    html.yt-suite-fit-to-window ytd-masthead {
                       display: none !important;
                    }

                    /* ensure the rest of the content flows correctly */
                    body.yt-suite-fit-to-window #page-manager {
                        margin-top: 0 !important;
                    }
                `;
                document.head.appendChild(this._styleElement);
                addRule(this._ruleId, () => this.applyStyles());
            },
            destroy() {
                document.documentElement.classList.remove('yt-suite-fit-to-window');
                document.body.classList.remove('yt-suite-fit-to-window');
                this._styleElement?.remove();
                this._styleElement = null;
                removeRule(this._ruleId);
                const watchElement = document.querySelector('ytd-watch-flexy[theater]');
                if (watchElement) {
                    const sizeButton = document.querySelector('button.ytp-size-button');
                    if(sizeButton) sizeButton.click();
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
                const isWatchPage = window.location.pathname.startsWith('/watch');
                const ownerDiv = document.querySelector('#top-row #owner');

                // Cleanup old floating version from body
                document.getElementById('yt-floating-logo')?.remove();

                if (isWatchPage && ownerDiv) {
                    let logoEl = document.getElementById('yt-suite-watch-logo');
                    if (!logoEl) {
                        logoEl = document.createElement('div');
                        logoEl.id = 'yt-suite-watch-logo';
                        const link = document.createElement('a');
                        link.href = 'https://www.youtube.com/feed/subscriptions';
                        link.title = 'YouTube Subscriptions';

                        const originalLogo = document.querySelector('ytd-topbar-logo-renderer ytd-logo');
                        if (originalLogo) {
                            const clonedLogo = originalLogo.cloneNode(true);
                            link.appendChild(clonedLogo);
                        } else {
                            const fallbackLogo = document.createElement('ytd-logo');
                            fallbackLogo.className = 'style-scope ytd-topbar-logo-renderer';
                            fallbackLogo.setAttribute('is-red-logo', '');
                            link.appendChild(fallbackLogo);
                        }
                        logoEl.appendChild(link);
                        ownerDiv.prepend(logoEl);
                    }
                    this._element = logoEl;
                } else if (this._element) {
                    this._element.remove();
                    this._element = null;
                }
            },
            init() {
                addRule(this._ruleId, this.handleLogoDisplay.bind(this));
            },
            destroy() {
                removeRule(this._ruleId);
                this._element?.remove();
                document.getElementById('yt-suite-watch-logo')?.remove();
                this._element = null;
            }
        },

        // Group: Watch Page - Other Elements
        { id: 'hideMerchShelf', name: 'Hide Merch Shelf', description: 'Hides the merchandise shelf that appears below the video.', group: 'Watch Page - Other Elements', _styleElement: null, init() { this._styleElement = injectStyle('ytd-merch-shelf-renderer', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideDescriptionExtras', name: 'Hide Description Extras', description: 'Hides extra content below the description like transcripts, podcasts, etc.', group: 'Watch Page - Other Elements', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata [slot="extra-content"]', this.id); }, destroy() { this._styleElement?.remove(); }},
        {
            id: 'hidePinnedComments',
            name: 'Hide Pinned Comments',
            description: 'Hides the pinned comment thread on video watch pages.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            init() {
                const css = `
                    ytd-comment-view-model[pinned],
                    ytd-comment-thread-renderer:has(ytd-comment-view-model[pinned]) {
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
            id: 'hideLiveChatEngagement',
            name: 'Hide Live Chat Engagement',
            description: 'Removes "Welcome to live chat!" and other engagement messages.',
            group: 'Watch Page - Other Elements',
            _styleElement: null,
            _ruleId: 'hideLiveChatEngagementRule',
            _runRemoval() {
                // This function is called by the main observer to remove elements from the DOM
                document.querySelectorAll('yt-live-chat-viewer-engagement-message-renderer').forEach(el => el.remove());
            },
            init() {
                // Inject a style for immediate hiding, preventing flashes of content
                const css = `
                    yt-live-chat-viewer-engagement-message-renderer {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
                // Use the main rule engine to periodically clean up the DOM
                addRule(this._ruleId, this._runRemoval);
            },
            destroy() {
                this._styleElement?.remove();
                removeRule(this._ruleId);
            }
        },

        // Group: Watch Page - Action Buttons
        {
            id: 'autolikeVideos',
            name: 'Autolike Videos',
            description: 'Automatically likes videos from channels you are subscribed to.',
            group: 'Watch Page - Action Buttons',
            _observer: null,
            _intervalId: null,
            init() {
                const ytLiker = () => {
                    const subscribeButton = document.querySelector('#subscribe-button-shape .yt-core-attributed-string--white-space-no-wrap');
                    const likeButton = document.querySelector('button.yt-spec-button-shape-next--segmented-start');

                    if (!subscribeButton || subscribeButton.innerHTML !== 'Subscribed') {
                        console.log('[YT Suite Autolike] Not subscribed.');
                        return;
                    }

                    if (likeButton && likeButton.ariaPressed === 'false') {
                        likeButton.click();
                        console.log('[YT Suite Autolike] Video Liked!');
                    } else {
                        console.log('[YT Suite Autolike] Video already liked or button not found.');
                    }
                };

                const setupObserver = () => {
                    this._observer = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            if (mutation.type === "attributes" && mutation.attributeName === 'video-id') {
                                console.log('[YT Suite Autolike] Video changed, checking...');
                                setTimeout(ytLiker, 2000); // Wait for elements to settle
                            }
                        }
                    });

                    const targetNode = document.querySelector('ytd-watch-flexy');
                    if (targetNode) {
                        this._observer.observe(targetNode, { attributes: true, attributeFilter: ['video-id'] });
                        console.log('[YT Suite Autolike] Observer attached.');
                    } else {
                         console.log('[YT Suite Autolike] Watch flexy not found for observer.');
                    }
                };
                // Initial run
                setTimeout(() => {
                    ytLiker();
                    setupObserver();
                }, 3000); // Initial delay
            },
            destroy() {
                if (this._observer) this._observer.disconnect();
                if (this._intervalId) clearInterval(this._intervalId);
                console.log('[YT Suite Autolike] Disabled.');
            }
        },
        { id: 'hideLikeButton', name: 'Hide Like Button', description: 'Hides the Like button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner .yt-like-button-view-model, ytd-watch-metadata like-button-view-model', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideDislikeButton', name: 'Hide Dislike Button', description: 'Hides the Dislike button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner .yt-dislike-button-view-model, ytd-watch-metadata dislike-button-view-model', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideShareButton', name: 'Hide Share Button', description: 'Hides the Share button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner ytd-button-renderer:has(button[aria-label="Share"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideDownloadButton', name: 'Hide Download/Offline Button', description: 'Hides the Download or Offline button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner ytd-download-button-renderer, ytd-button-renderer:has(button[aria-label="Offline"])', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSponsorButton', name: 'Hide Join/Sponsor Button', description: 'Hides the channel membership "Join" button.', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#sponsor-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMoreActionsButton', name: 'Hide "More actions" Button', description: 'Hides the three-dots "More actions" button (includes Thanks, Clip, etc.).', group: 'Watch Page - Action Buttons', _styleElement: null, init() { this._styleElement = injectStyle('#actions-inner #button-shape.ytd-menu-renderer, #actions-inner ytd-button-renderer:has(button[aria-label*="Clip"]), #actions-inner ytd-button-renderer:has(button[aria-label*="Thanks"])', this.id); }, destroy() { this._styleElement?.remove(); }},

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

                    const best = levels
                        .map(label => ({ label, num: parseInt((label.match(/\d+/) || [])[0], 10) || 0 }))
                        .sort((a, b) => b.num - a.num)[0].label;

                    try {
                        player.setPlaybackQualityRange(best);
                        console.log('[YT Suite AutoMaxRes] Set quality to', best);
                    } catch (e) {
                        console.warn('[YT Suite AutoMaxRes] Could not set quality', e);
                    }
                };

                this._onPlayerUpdated = (evt) => {
                    const player = evt?.target?.player_ || document.getElementById('movie_player');
                    setMaxQuality(player);
                };

                this._onNavigateFinish = () => {
                    const player = document.getElementById('movie_player');
                    setTimeout(() => setMaxQuality(player), 500);
                };

                window.addEventListener('yt-player-updated', this._onPlayerUpdated, true);
                window.addEventListener('yt-navigate-finish', this._onNavigateFinish, true);

                // Initial check for already loaded player
                this._onNavigateFinish();
                console.log('[YT Suite AutoMaxRes] Initialized.');
            },
            destroy() {
                if (this._onPlayerUpdated) window.removeEventListener('yt-player-updated', this._onPlayerUpdated, true);
                if (this._onNavigateFinish) window.removeEventListener('yt-navigate-finish', this._onNavigateFinish, true);
                console.log('[YT Suite AutoMaxRes] Disabled.');
            }
        },
        { id: 'hideNextButton', name: 'Hide "Next video" Button', description: 'Hides the next video button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-next-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideAutoplayToggle', name: 'Hide Autoplay Toggle', description: 'Hides the autoplay toggle in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-autonav-toggle-button-container', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSubtitlesToggle', name: 'Hide Subtitles Toggle', description: 'Hides the subtitles/CC button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-subtitles-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMiniplayerButton', name: 'Hide Miniplayer Button', description: 'Hides the miniplayer button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-miniplayer-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hidePipButton', name: 'Hide Picture-in-Picture Button', description: 'Hides the Picture-in-Picture button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-pip-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideTheaterButton', name: 'Hide Theater Mode Button', description: 'Hides the theater mode button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-size-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideFullscreenButton', name: 'Hide Fullscreen Button', description: 'Hides the fullscreen button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-fullscreen-button', this.id); }, destroy() { this._styleElement?.remove(); }},
    ];

    function injectStyle(selector, featureId, isRawCss = false) {
        const style = document.createElement('style');
        style.id = `yt-suite-style-${featureId}`;
        if (isRawCss) {
            style.textContent = selector;
        } else {
            style.textContent = `${selector} { display: none !important; }`;
        }
        document.head.appendChild(style);
        return style;
    }

    // —————————————————————
    // 3. DOM HELPERS & TOAST NOTIFICATIONS
    // —————————————————————
    let appState = {};

    function createCogSvg() {
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "currentColor");
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        const path1 = document.createElementNS(svgNS, "path");
        path1.setAttribute("d", "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69-.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z");
        svg.appendChild(path1);
        return svg;
    }

    function showToast(message, isError = false) {
        let toast = document.getElementById('yt-suite-toast-notification');
        if (toast) toast.remove();
        toast = document.createElement('div');
        toast.id = 'yt-suite-toast-notification';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px;
            background-color: ${isError ? '#d9534f' : '#0f9d58'};
            color: white; padding: 10px 20px; border-radius: 5px; z-index: 10002;
            opacity: 0; transition: opacity 0.3s, bottom 0.3s;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.bottom = '30px';
        }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.bottom = '20px';
            toast.addEventListener('transitionend', () => toast.remove());
        }, 3000);
    }


    // —————————————————————
    // 4. UI & SETTINGS PANEL
    // —————————————————————
    function buildPanel(appState) {
        const groups = features.reduce((acc, f) => {
            acc[f.group] = acc[f.group] || [];
            // Exclude sub-features from being rendered as top-level items
            if (f.id !== 'betterDarkMode' && f.id !== 'expandVideoWidth') {
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
        version.textContent = 'v3.0';
        header.append(title, version);

        const main = document.createElement('main');
        const groupOrder = [
            'Core UI',
            'Header',
            'Sidebar',
            'Themes',
            'General Content',
            'Watch Page - Layout',
            'Watch Page - Other Elements',
            'Watch Page - Action Buttons',
            'Watch Page - Player Controls'
        ];

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
                if (subFeat.destroy) subFeat.destroy();
                if (isChecked && subFeat.init) subFeat.init();
                await settingsManager.save(appState.settings);
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
                    // Fire the change event to trigger destroy() and save the state
                    input.dispatchEvent(new Event('change'));
                }
            });
            return wrapper;
        };


        groupOrder.forEach(groupName => {
            if (!groups[groupName] || groups[groupName].length === 0) return;

            const fieldset = document.createElement('fieldset');
            fieldset.className = 'yt-suite-feature-group';
            const legend = document.createElement('legend');
            legend.textContent = groupName;
            fieldset.appendChild(legend);

            groups[groupName].forEach(f => {
                const wrapper = document.createElement('div');
                wrapper.className = 'yt-suite-switch-wrapper';
                wrapper.dataset.tooltip = f.description;
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
                    appState.settings[id] = e.target.checked;
                    const feat = features.find(x => x.id === id);
                    if (feat.destroy) feat.destroy();
                    if (appState.settings[id] && feat.init) feat.init();
                    await settingsManager.save(appState.settings);
                };
                const slider = document.createElement('span');
                slider.className = 'slider';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'label';
                nameSpan.textContent = f.name;

                label.append(input, slider);
                wrapper.append(label, nameSpan);
                fieldset.appendChild(wrapper);

                // Attach sub-settings to their parents
                if (f.id === 'hideRelatedVideos') {
                    fieldset.append(createSubSetting('expandVideoWidth', input));
                }
                if (f.id === 'nativeDarkMode') {
                    fieldset.append(createSubSetting('betterDarkMode', input));
                }
            });
            main.appendChild(fieldset);
        });

        const footer = document.createElement('footer');
        const footerControls = document.createElement('div');
        footerControls.className = 'yt-suite-footer-controls';
        const closeBtn = document.createElement('button');
        closeBtn.id = 'yt-suite-close-btn';
        closeBtn.className = 'yt-suite-btn-primary';
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => document.body.classList.remove('yt-suite-panel-open');
        footer.append(footerControls, closeBtn);

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
            .yt-suite-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 10000; opacity: 0; pointer-events: none; transition: opacity .3s ease; }
            .yt-suite-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 90%; max-width: 520px; background: var(--yt-suite-panel-bg); color: var(--yt-suite-panel-fg); border-radius: var(--panel-radius); box-shadow: var(--panel-shadow); font-family: var(--panel-font); opacity: 0; pointer-events: none; transition: opacity .3s ease, transform .3s ease; z-index: 10001; display: flex; flex-direction: column; }
            body.yt-suite-panel-open .yt-suite-panel { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
            .yt-suite-panel header { padding: 20px 24px; border-bottom: 1px solid var(--yt-suite-border-color); display: flex; justify-content: space-between; align-items: center; }
            .yt-suite-panel h2 { margin: 0; font-size: 18px; font-weight: 700; }
            .yt-suite-panel .version { font-size: 12px; opacity: 0.6; }
            .yt-suite-panel main { padding: 16px 24px; flex-grow: 1; max-height: 70vh; overflow-y: auto; }
            .yt-suite-panel footer { padding: 16px 24px; border-top: 1px solid var(--yt-suite-border-color); display: flex; justify-content: flex-end; align-items: center; }
            .yt-suite-feature-group { border: 1px solid var(--yt-suite-border-color); border-radius: 8px; padding: 16px; margin: 0 0 16px; }
            .yt-suite-feature-group legend { padding: 0 8px; font-size: 14px; font-weight: 500; color: var(--yt-suite-accent-color); }
            .yt-suite-switch-wrapper { display: flex; align-items: center; margin-bottom: 12px; position: relative; }
            .yt-suite-switch-wrapper:last-child { margin-bottom: 0; }
            .yt-suite-switch { display: flex; align-items: center; cursor: pointer; }
            .yt-suite-switch-wrapper .label { margin-left: 12px; flex: 1; font-size: 15px; }
            .yt-suite-switch input { display: none; }
            .yt-suite-switch .slider { width: 40px; height: 22px; background: #555; border-radius: 11px; position: relative; transition: background .2s ease; }
            .yt-suite-switch .slider:before { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform .2s ease; }
            .yt-suite-switch input:checked + .slider { background: var(--yt-suite-accent-color); }
            .yt-suite-switch input:checked + .slider:before { transform: translateX(18px); }
            .yt-suite-switch-wrapper::after { content: attr(data-tooltip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; background: #111; color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 10003; }
            .yt-suite-switch-wrapper:hover::after { opacity: 1; }
            .yt-suite-sub-setting-wrapper { margin-left: 20px; padding-left: 10px; border-left: 2px solid var(--yt-suite-border-color); }
            .yt-suite-footer-controls { display: flex; gap: 10px; }
            .yt-suite-btn-primary { background-color: var(--yt-suite-accent-color); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-family: var(--panel-font); font-weight: 500; cursor: pointer; transition: background-color .2s; }
            .yt-suite-btn-primary:hover { background-color: #cc0000; }

            /* -- Watch Page Header Controls -- */
            #yt-suite-watch-logo, #yt-suite-watch-cog {
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
            #yt-suite-watch-cog button {
                background: transparent;
                border: none;
                width: 40px;
                height: 40px;
                cursor: pointer;
                padding: 8px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #yt-suite-watch-cog svg {
                 width: 24px;
                 height: 24px;
                 fill: var(--yt-spec-icon-inactive);
            }
            #yt-suite-watch-cog button:hover {
                background-color: var(--yt-spec-badge-chip-background);
            }

            /* -- Masthead Settings Cog -- */
            ytd-topbar-logo-renderer {
                position: relative;
            }
            #yt-masthead-cog {
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                left: 135px; /* Position right of the logo */
            }
            #yt-masthead-cog button {
                background: transparent;
                border: none;
                width: 40px;
                height: 40px;
                cursor: pointer;
                padding: 8px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #yt-masthead-cog svg {
                 fill: var(--yt-spec-icon-inactive);
            }
            #yt-masthead-cog button:hover {
                background-color: var(--yt-spec-badge-chip-background);
            }

            /* -- General Watch Page Fixes -- */
            ytd-watch-metadata {
                margin-top: 180px !important;
            }
            ytd-live-chat-frame#chat {
                width: 402px !important;
                margin-top: -58px !important;
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

        features.forEach(f => {
            if (appState.settings[f.id]) {
                try {
                    if (f.init) f.init();
                } catch (error) {
                    console.error(`[YT Suite] Error initializing feature "${f.id}":`, error);
                }
            }
        });

        settingsManager.getFirstRunStatus().then(hasRun => {
            if (!hasRun) {
                document.body.classList.add('yt-suite-panel-open');
                settingsManager.setFirstRunStatus(true);
            }
        });
    }

    // Since @run-at is document-end, we can likely run main() directly
    // But it's safer to wait for the window to be fully loaded.
    if (document.readyState === 'complete') {
        main();
    } else {
        window.addEventListener('load', main);
    }

})();
