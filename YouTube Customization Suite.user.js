// ==UserScript==
// @name         YouTube Customization Suite
// @namespace    https://github.com/user/yt-enhancement-suite
// @version      1.7
// @description  Ultimate YouTube UI customization. Hide elements, control layout, and enhance your viewing experience.
// @author       Your Name
// @match        https://*.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ——————————————————————————————————————————————————————————————————————————
    //  ~ YouTube Customization Suite v1.7 ~
    //
    //  - Added new "Autolike Videos" feature based on the provided script.
    //    This can be toggled in the "Watch Page - Action Buttons" section.
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
    }

    function stopObserver() {
        if (dynamicObserver) {
            dynamicObserver.disconnect();
            dynamicObserver = null;
        }
    }

    function addRule(id, ruleFn) {
        activeRules.set(id, ruleFn);
        if (activeRules.size === 1) {
            startObserver();
        }
        ruleFn(document.body);
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

            // Sidebar
            collapsibleGuide: false,

            // General Content
            removeAllShorts: true,

            // Watch Page - Layout
            fitPlayerToWindow: false,
            hideRelatedVideos: false,
            expandVideoWidth: true,

            // Watch Page - Other Elements
            hideMerchShelf: false,
            hideDescriptionExtras: false,

            // Watch Page - Action Buttons
            autolikeVideos: false,
            hideLikeButton: false,
            hideDislikeButton: false,
            hideShareButton: false,
            hideDownloadButton: false,
            hideSponsorButton: false,
            hideMoreActionsButton: false,

            // Watch Page - Player Controls
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
            name: 'Floating Settings Button',
            description: 'Shows a floating gear icon to open the settings panel.',
            group: 'Core UI',
            _element: null,
            init() {
                const btn = document.createElement('button');
                btn.id = 'yt-suite-floating-settings-btn';
                btn.title = 'Open YouTube Suite Settings';
                btn.appendChild(createCogSvg());
                btn.onclick = () => document.body.classList.toggle('yt-suite-panel-open');
                document.body.appendChild(btn);
                this._element = btn;
            },
            destroy() {
                this._element?.remove();
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

        // Group: Sidebar
        {
            id: 'collapsibleGuide',
            name: 'Collapsible Hover Sidebar',
            description: 'Collapses the left sidebar (guide) and reveals it on hover.',
            group: 'Sidebar',
            _styleElement: null,
            init() {
                this._styleElement = document.createElement('style');
                this._styleElement.id = 'yt-suite-collapsible-guide';
                this._styleElement.textContent = `
                    ytd-mini-guide-renderer { display: none !important; }
                    ytd-app[guide-persistent-and-visible] #guide {
                        transform: translateX(-100%);
                        transition: transform 0.2s ease-in-out;
                        z-index: 1000;
                    }
                    ytd-app[guide-persistent-and-visible] #guide:hover {
                        transform: translateX(0);
                    }
                    ytd-page-manager[video-id] { margin-left: 0 !important; }
                `;
                document.head.appendChild(this._styleElement);
                document.querySelector('ytd-app')?.setAttribute('guide-persistent-and-visible', '');
            },
            destroy() {
                this._styleElement?.remove();
                document.querySelector('ytd-app')?.removeAttribute('guide-persistent-and-visible');
            }
        },

        // Group: General Content
        {
            id: 'removeAllShorts',
            name: 'Remove All Shorts Videos',
            description: 'Removes all Shorts videos from any page (Home, Subscriptions, Search, etc.).',
            group: 'General Content',
            init() {
                const removeShortsRule = () => {
                    document.querySelectorAll('a[href^="/shorts"]').forEach(a => {
                        let parent = a.parentElement;
                        while (parent && (!parent.tagName.startsWith('YTD-') || parent.tagName === 'YTD-THUMBNAIL')) {
                            parent = parent.parentElement;
                        }
                        if (parent) parent.remove();
                    });
                    document.querySelectorAll('ytd-reel-shelf-renderer').forEach(el => el.remove());
                };
                addRule(this.id, removeShortsRule);
            },
            destroy() {
                removeRule(this.id);
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

        // Group: Watch Page - Other Elements
        { id: 'hideMerchShelf', name: 'Hide Merch Shelf', description: 'Hides the merchandise shelf that appears below the video.', group: 'Watch Page - Other Elements', _styleElement: null, init() { this._styleElement = injectStyle('ytd-merch-shelf-renderer', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideDescriptionExtras', name: 'Hide Description Extras', description: 'Hides extra content below the description like transcripts, podcasts, etc.', group: 'Watch Page - Other Elements', _styleElement: null, init() { this._styleElement = injectStyle('ytd-watch-metadata [slot="extra-content"]', this.id); }, destroy() { this._styleElement?.remove(); }},

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
        { id: 'hideNextButton', name: 'Hide "Next video" Button', description: 'Hides the next video button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-next-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideAutoplayToggle', name: 'Hide Autoplay Toggle', description: 'Hides the autoplay toggle in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-autonav-toggle-button-container', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideSubtitlesToggle', name: 'Hide Subtitles Toggle', description: 'Hides the subtitles/CC button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-subtitles-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideMiniplayerButton', name: 'Hide Miniplayer Button', description: 'Hides the miniplayer button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-miniplayer-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hidePipButton', name: 'Hide Picture-in-Picture Button', description: 'Hides the Picture-in-Picture button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-pip-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideTheaterButton', name: 'Hide Theater Mode Button', description: 'Hides the theater mode button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-size-button', this.id); }, destroy() { this._styleElement?.remove(); }},
        { id: 'hideFullscreenButton', name: 'Hide Fullscreen Button', description: 'Hides the fullscreen button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-fullscreen-button', this.id); }, destroy() { this._styleElement?.remove(); }},
    ];

    function injectStyle(selector, featureId) {
        const style = document.createElement('style');
        style.id = `yt-suite-style-${featureId}`;
        style.textContent = `${selector} { display: none !important; }`;
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
            acc[f.group].push(f);
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
        version.textContent = 'v1.7';
        header.append(title, version);

        const main = document.createElement('main');
        const groupOrder = [
            'Core UI',
            'Header',
            'Sidebar',
            'General Content',
            'Watch Page - Layout',
            'Watch Page - Other Elements',
            'Watch Page - Action Buttons',
            'Watch Page - Player Controls'
        ];

        const createSubSetting = (id, name, description, parentInput, parentFeatureId) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'yt-suite-switch-wrapper yt-suite-sub-setting-wrapper';
            wrapper.dataset.tooltip = description;
            const label = document.createElement('label');
            label.className = 'yt-suite-switch';
            label.htmlFor = `switch-${id}`;
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `switch-${id}`;
            input.checked = appState.settings[id];
            input.onchange = async (e) => {
                appState.settings[id] = e.target.checked;
                const parentFeat = features.find(x => x.id === parentFeatureId);
                if (parentFeat) {
                    if (parentFeat.destroy) parentFeat.destroy();
                    if (appState.settings[parentFeatureId] && parentFeat.init) {
                        parentFeat.init();
                    }
                }
                await settingsManager.save(appState.settings);
            };
            const slider = document.createElement('span');
            slider.className = 'slider';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'label';
            nameSpan.textContent = name;
            label.append(input, slider);
            wrapper.append(label, nameSpan);
            wrapper.style.display = parentInput.checked ? 'flex' : 'none';
            parentInput.addEventListener('change', (e) => {
                wrapper.style.display = e.target.checked ? 'flex' : 'none';
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

                if (f.id === 'hideRelatedVideos') {
                    const expandWidthSub = createSubSetting('expandVideoWidth', "Expand video to full width", "When related videos are hidden, this makes the video player fill the available space.", input, 'hideRelatedVideos');
                    fieldset.append(expandWidthSub);
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
            .yt-suite-sub-setting-wrapper { margin-left: 20px; }
            .yt-suite-footer-controls { display: flex; gap: 10px; }
            .yt-suite-btn-primary { background-color: var(--yt-suite-accent-color); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-family: var(--panel-font); font-weight: 500; cursor: pointer; transition: background-color .2s; }
            .yt-suite-btn-primary:hover { background-color: #cc0000; }
            #yt-suite-floating-settings-btn {
                position: fixed; bottom: 24px; left: 24px; width: 56px; height: 56px;
                background-color: var(--yt-suite-accent-color); color: white; border: none;
                border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.2); cursor: pointer;
                display: flex; align-items: center; justify-content: center; z-index: 9999;
                transition: transform .2s ease, background-color .2s ease;
            }
            #yt-suite-floating-settings-btn:hover { transform: scale(1.05); background-color: #cc0000; }
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
