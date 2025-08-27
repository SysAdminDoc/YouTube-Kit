// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      5.3
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
// @resource     nyanCatProgressBar https://raw.githubusercontent.com/SysAdminDoc/YTKit/raw/refs/heads/main/Themes/nyan-cat-progress-bar.css
// @updateURL    https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @downloadURL  https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @require      https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/features/header.js
// @require      https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/features/sidebar.js
// @require      https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/features/themes.js
// @require      https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/features/general.js
// @require      https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/features/watch-page.js
// @require      https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/features/modules.js
// @run-at       document-start
// ==/UserScript==

// -----------------------------------------------------------------------------
// YTKit Global Object
// Defines the core engine and makes it available to all feature modules.
// This must be defined before the main IIFE and before modules are loaded.
// -----------------------------------------------------------------------------
(function() {
    'use strict';

    // --- Engine Setup ---
    let mutationObserver = null;
    const mutationRules = new Map();
    const navigateRules = new Map();
    let isNavigateListenerAttached = false;

    const runNavigateRules = () => {
        for (const rule of navigateRules.values()) {
            try { rule(document.body); } catch (e) { console.error('[YTKit] Error applying navigate rule:', e); }
        }
    };

    const ensureNavigateListener = () => {
        if (isNavigateListenerAttached) return;
        window.addEventListener('yt-navigate-finish', runNavigateRules);
        isNavigateListenerAttached = true;
    };

    const runMutationRules = (targetNode) => {
        for (const rule of mutationRules.values()) {
            try { rule(targetNode); } catch (e) { console.error('[YTKit] Error applying mutation rule:', e); }
        }
    };

    const observerCallback = () => {
        runMutationRules(document.body);
    };

    // --- Global YTKit Object ---
    window.YTKit = {
        features: [],
        appState: {},
        YTKitFeatures: {}, // Staging area for features from modules

        waitForElement: function(selector, callback, timeout = 10000) {
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
        },

        addNavigateRule: function(id, ruleFn) {
            ensureNavigateListener();
            navigateRules.set(id, ruleFn);
            if (document.body) {
                ruleFn(document.body);
            } else {
                window.addEventListener('DOMContentLoaded', () => ruleFn(document.body));
            }
        },

        removeNavigateRule: function(id) {
            navigateRules.delete(id);
        },

        startObserver: function() {
            if (mutationObserver) return;
            mutationObserver = new MutationObserver(observerCallback);
            mutationObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['theater', 'fullscreen', 'hidden', 'video-id', 'page-subtype']
            });
        },

        stopObserver: function() {
            if (mutationObserver) {
                mutationObserver.disconnect();
                mutationObserver = null;
            }
        },

        addMutationRule: function(id, ruleFn) {
            if (mutationRules.size === 0) this.startObserver();
            mutationRules.set(id, ruleFn);
            if (document.body) {
                ruleFn(document.body);
            } else {
                window.addEventListener('DOMContentLoaded', () => ruleFn(document.body));
            }
        },

        removeMutationRule: function(id) {
            mutationRules.delete(id);
            if (mutationRules.size === 0) this.stopObserver();
        },

        injectStyle: function(selector, featureId, isRawCss = false) {
            const style = document.createElement('style');
            style.id = `yt-suite-style-${featureId}`;
            style.textContent = isRawCss ? selector : `${selector} { display: none !important; }`;
            (document.head || document.documentElement).appendChild(style);
            return style;
        },

        createToast: function(message, type = 'success', duration = 3000) {
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
    };
})();


// -----------------------------------------------------------------------------
// Main Script Logic (UI and Bootstrap)
// This runs after the YTKit global object is ready and after all feature
// modules have been loaded and have pushed their data to YTKit.features.
// -----------------------------------------------------------------------------
(function() {
    'use strict';

    // --- [FIX] FEATURE AGGREGATION ---
    // Consolidate all feature arrays from the modules into the main features array.
    if (window.YTKit && window.YTKit.YTKitFeatures) {
        for (const key in window.YTKit.YTKitFeatures) {
            if (Object.prototype.hasOwnProperty.call(window.YTKit.YTKitFeatures, key)) {
                const featureArray = window.YTKit.YTKitFeatures[key];
                if (Array.isArray(featureArray)) {
                    window.YTKit.features.push(...featureArray);
                }
            }
        }
    }

    // Destructure from the global object for convenience AFTER aggregation
    const { features, appState, waitForElement, addNavigateRule, createToast } = window.YTKit;

    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 1: SETTINGS MANAGER
    // ——————————————————————————————————————————————————————————————————————————
    const settingsManager = {
        defaults: {
            panelTheme: "dark", hideCreateButton: true, hideVoiceSearch: true, logoToSubscriptions: true, widenSearchBar: true, hideSidebar: true, nativeDarkMode: true, betterDarkMode: true, catppuccinMocha: false, squarify: true, nyanCatProgressBar: false, removeAllShorts: true, redirectShorts: true, disablePlayOnHover: true, fullWidthSubscriptions: true, hideSubscriptionOptions: true, fiveVideosPerRow: true, hidePaidContentOverlay: true, redirectToVideosTab: true, fitPlayerToWindow: true, hideRelatedVideos: true, expandVideoWidth: true, floatingLogoOnWatch: true, hideDescriptionRow: false, preventAutoplay: false, autoExpandDescription: false, sortCommentsNewestFirst: false, skipSponsors: true, hideSponsorBlockLabels: true, hideMerchShelf: true, hideClarifyBoxes: true, hideDescriptionExtras: true, hideHashtags: true, hidePinnedComments: true, hideCommentActionMenu: true, hideLiveChatEngagement: true, hidePaidPromotionWatch: true, hideVideoEndCards: true, hideVideoEndScreen: true, hideLiveChatHeader: true, hideChatMenu: true, hidePopoutChatButton: true, hideChatReactionsButton: true, hideChatTimestampsButton: true, hideChatPolls: true, hideChatPollBanner: true, hideChatTicker: true, hideViewerLeaderboard: true, hideChatSupportButtons: true, hideChatBanner: true, hideChatEmojiButton: true, hideTopFanIcons: true, hideSuperChats: true, hideLevelUp: true, hideChatBots: true, keywordFilterList: "", autolikeVideos: true, hideLikeButton: true, hideDislikeButton: true, hideShareButton: true, hideAskButton: true, hideClipButton: true, hideThanksButton: true, hideSaveButton: true, replaceWithCobaltDownloader: true, hideSponsorButton: true, hideMoreActionsButton: true, playerEnhancements: false, autoMaxResolution: true, useEnhancedBitrate: true, hideQualityPopup: true, hideSponsorBlockButton: true, hideNextButton: true, hideAutoplayToggle: true, hideSubtitlesToggle: true, hideCaptionsContainer: true, hideMiniplayerButton: true, hidePipButton: true, hideTheaterButton: true, hideFullscreenButton: true, enableAdblock: false, enableCPU_Tamer: false, enableHandleRevealer: false, enableYoutubetoYout_ube: false, yout_ube_redirectShorts: true, yout_ube_redirectEmbed: true, yout_ube_redirectNoCookie: true, yout_ube_rewriteLinks: true,
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
    // SECTION 2: UI & SETTINGS PANEL
    // ——————————————————————————————————————————————————————————————————————————
    const ICONS = {
        cog: { viewBox: '0 0 24 24', paths: ['M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84 c-0.24,0-0.44,0.17-0.48,0.41L9.22,5.72C8.63,5.96,8.1,6.29,7.6,6.67L5.21,5.71C4.99,5.62,4.74,5.69,4.62,5.91L2.7,9.23 c-0.11,0.2-0.06,0.47,0.12,0.61l2.03,1.58C4.8,11.69,4.78,12,4.78,12.31c0,0.31,0.02,0.62,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.04,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.48-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0.01,0.59-0.22l1.92-3.32c0.11-0.2,0.06-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z'], },
        close: { viewBox: '0 0 24 24', paths: ['M18 6l-12 12', 'M6 6l12 12'], strokeWidth: '2.5' },
        header: { viewBox: '0 0 24 24', paths: ['M2 3h20v6H2z', 'M2 9h20v12H2z', 'M6 13h4', 'M6 17h2'], strokeWidth: '2' },
        sidebar: { viewBox: '0 0 24 24', paths: ['M3 3h18v18H3z', 'M9 3v18'], strokeWidth: '2' },
        themes: { viewBox: '0 0 24 24', paths: ['m12 3-1.41 1.41L9.17 3l-1.42 1.41L6.34 3l-1.42 1.41L3.5 3 2.09 4.41 3.5 5.83l-1.41 1.41L3.5 8.66l-1.41 1.41L3.5 11.5l-1.41 1.41L3.5 14.34l-1.41 1.42L3.5 17.17l-1.41 1.42L3.5 20.01l1.41 1.41L6.34 20l1.42 1.41L9.17 20l1.41 1.41L12 20l1.41-1.41L14.83 20l1.42-1.41L17.66 20l1.42-1.41L20.5 20l1.41-1.41L20.5 17.17l1.41-1.42L20.5 14.34l1.41-1.41L20.5 11.5l1.41-1.41L20.5 8.66l1.41-1.41L20.5 5.83 22 4.41 20.5 3l-1.41 1.41L17.66 3l-1.42 1.41L14.83 3l-1.42 1.41L12 3z', 'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0z'], strokeWidth: '2' },
        progressBar: { viewBox: '0 0 24 24', paths: ['M3 12h18', 'M18 6h3', 'M3 6h10', 'M10 18h11', 'M3 18h2'], strokeWidth: '2' },
        general: { viewBox: '0 0 24 24', paths: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'], strokeWidth: '2' },
        watchLayout: { viewBox: '0 0 24 24', paths: ['M3 3h18v18H3z', 'M21 12H3', 'M12 3v18'], strokeWidth: '2' },
        watchBehavior: { viewBox: '0 0 24 24', paths: ['M12 20v-6M6 20v-4M18 20v-2', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M6 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M18 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'], strokeWidth: '2' },
        watchElements: { viewBox: '0 0 24 24', paths: ['M12.22 2h-4.44l-2 4h-3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3l-2-4z', 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], strokeWidth: '2' },
        liveChat: { viewBox: '0 0 24 24', paths: ['m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z'], strokeWidth: '2' },
        actionButtons: { viewBox: '0 0 24 24', paths: ['M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'], strokeWidth: '2' },
        playerEnhancements: { viewBox: '0 0 24 24', paths: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'], strokeWidth: '2' },
        playerControls: { viewBox: '0 0 24 24', paths: ['M5 3l14 9-14 9V3z'], strokeWidth: '2' },
        modules: { viewBox: '0 0 24 24', paths: ['M12.89 1.45l8 4A2 2 0 0 1 22 7.24v9.53a2 2 0 0 1-1.11 1.79l-8 4a2 2 0 0 1-1.78 0l-8-4A2 2 0 0 1 2 16.77V7.24a2 2 0 0 1 1.11-1.79l8-4a2 2 0 0 1 1.78 0z', 'M2.32 6.16l7.55 3.77a2 2 0 0 0 1.78 0l7.55-3.77', 'M12 22.08V12'], strokeWidth: '2' },
    };

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
        return svg;
    }

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
        if (headerIcon) headerTitle.appendChild(headerIcon);
        headerTitle.appendChild(headerH2);
        const closeButton = document.createElement('button');
        closeButton.id = 'ycs-close-settings';
        closeButton.className = 'ycs-header-button';
        closeButton.title = 'Close (Esc)';
        const closeIcon = createIcon(ICONS.close);
        if (closeIcon) closeButton.appendChild(closeIcon);
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
        versionSpan.textContent = 'v5.3';
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
        const groupOrder = ['Header', 'Sidebar', 'Themes', 'Progress Bar Themes', 'General Content', 'Watch Page - Layout', 'Watch Page - Behavior', 'Watch Page - Other Elements', 'Watch Page - Live Chat', 'Watch Page - Action Buttons', 'Player Enhancements', 'Watch Page - Player Controls', 'Modules'];
        const categoryIcons = { 'Header': ICONS.header, 'Sidebar': ICONS.sidebar, 'Themes': ICONS.themes, 'Progress Bar Themes': ICONS.progressBar, 'General Content': ICONS.general, 'Watch Page - Layout': ICONS.watchLayout, 'Watch Page - Behavior': ICONS.watchBehavior, 'Watch Page - Other Elements': ICONS.watchElements, 'Watch Page - Live Chat': ICONS.liveChat, 'Watch Page - Action Buttons': ICONS.actionButtons, 'Player Enhancements': ICONS.playerEnhancements, 'Watch Page - Player Controls': ICONS.playerControls, 'Modules': ICONS.modules };
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
            if (tabIcon) tabBtn.appendChild(tabIcon);
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
                    if (f.id === 'enableYoutubetoYout_ube' && (sf.id.startsWith('yout_ube_'))) return true;
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

    function injectPanelStyles() {
        GM_addStyle(`
:root { --ycs-font: 'Roboto', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
html[data-ycs-theme='dark'] { --ycs-bg-primary: #181a1b; --ycs-bg-secondary: #25282a; --ycs-bg-tertiary: #34383b; --ycs-bg-hover: #3d4245; --ycs-text-primary: #e8e6e3; --ycs-text-secondary: #b3b0aa; --ycs-border-color: #454a4d; --ycs-accent: #ff4500; --ycs-accent-hover: #ff6a33; --ycs-accent-glow: rgba(255, 69, 0, 0.3); --ycs-success: #22c55e; --ycs-error: #ef4444; --ycs-error-hover: #ff5252; --ycs-info: #3b82f6; --ycs-header-icon-color: var(--yt-spec-icon-inactive); --ycs-header-icon-hover-bg: var(--yt-spec-badge-chip-background); }
html[data-ycs-theme='light'] { --ycs-bg-primary: #ffffff; --ycs-bg-secondary: #f1f3f5; --ycs-bg-tertiary: #e9ecef; --ycs-bg-hover: #dee2e6; --ycs-text-primary: #212529; --ycs-text-secondary: #6c757d; --ycs-border-color: #ced4da; --ycs-accent: #d9480f; --ycs-accent-hover: #e8591a; --ycs-accent-glow: rgba(217, 72, 15, 0.25); --ycs-success: #198754; --ycs-error: #dc3545; --ycs-error-hover: #e44d5b; --ycs-info: #0ea5e9; --ycs-header-icon-color: var(--yt-spec-icon-inactive); --ycs-header-icon-hover-bg: var(--yt-spec-badge-chip-background); }
#ycs-settings-button-masthead, #ycs-settings-button-watch { background: transparent; border: none; cursor: pointer; padding: 6px; margin: 0 8px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: background-color 0.2s ease, transform 0.2s ease; }
#ycs-settings-button-masthead:hover, #ycs-settings-button-watch:hover { background-color: var(--ycs-header-icon-hover-bg); transform: scale(1.1) rotate(15deg); }
#ycs-settings-button-masthead svg, #ycs-settings-button-watch svg { width: 26px; height: 26px; color: var(--ycs-header-icon-color); }
#ycs-watch-cog { margin: 0 8px 0 16px; display: flex; align-items: center; }
ytd-masthead #end { position: relative; }
#ycs-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(4px); z-index: 99998; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
#ycs-settings-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); z-index: 99999; opacity: 0; pointer-events: none; transition: opacity 0.3s ease, transform 0.3s ease; display: flex; flex-direction: column; width: 95%; max-width: 900px; height: 90vh; max-height: 750px; background: var(--ycs-bg-primary); color: var(--ycs-text-primary); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); font-family: var(--ycs-font); border-radius: 16px; border: 1px solid var(--ycs-border-color); overflow: hidden; }
body.ycs-panel-open #ycs-panel-overlay { opacity: 1; pointer-events: auto; }
body.ycs-panel-open #ycs-settings-panel { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
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
.ycs-input { background: var(--ycs-bg-primary); color: var(--ycs-text-primary); border: 1px solid var(--ycs-border-color); border-radius: 6px; padding: 8px 10px; font-family: var(--ycs-font); font-size: 14px; width: 100%; transition: border-color .2s, box-shadow .2s; flex-shrink: 0; max-width: 50%; }
.ycs-input:focus { outline: none; border-color: var(--ycs-accent); box-shadow: 0 0 0 3px var(--ycs-accent-glow); }
.ycs-management-row { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: none; }
.ycs-sub-panel { background: var(--ycs-bg-secondary); border: 1px solid var(--ycs-border-color); border-radius: 0 0 12px 12px; padding: 16px; display: none; flex-direction: column; gap: 12px; margin-top: -17px; }
.ycs-sub-setting { margin-left: 20px; }
.ycs-toast { position: fixed; bottom: -100px; left: 50%; transform: translateX(-50%); color: white; padding: 12px 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: var(--ycs-font); font-size: 15px; font-weight: 500; z-index: 100002; transition: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55); border-radius: 8px; }
.ycs-toast.show { bottom: 20px; }
.ycs-toast.success { background-color: var(--ycs-success); }
.ycs-toast.error { background-color: var(--ycs-error); }
.ycs-toast.info { background-color: var(--ycs-info); }
#yt-suite-watch-logo { display: flex; align-items: center; }
#yt-suite-watch-logo a { display: flex; align-items: center; }
#yt-suite-watch-logo ytd-logo { width: 90px; height: auto; }
ytd-watch-metadata.watch-active-metadata { margin-top: 180px !important; }
ytd-live-chat-frame { margin-top: -57px !important; width: 402px !important; }
`);
    }

    // ——————————————————————————————————————————————————————————————————————————
    // SECTION 3: MAIN BOOTSTRAP
    // ——————————————————————————————————————————————————————————————————————————
    async function main() {
        window.YTKit.appState.settings = await settingsManager.load();
        
        // Local alias for convenience within this scope
        const localAppState = window.YTKit.appState;

        document.documentElement.setAttribute('data-ycs-theme', localAppState.settings.panelTheme);

        injectPanelStyles();
        buildSettingsPanel();
        injectSettingsButton();
        attachUIEventListeners();
        updateAllToggleStates();

        features.forEach(f => {
            if (localAppState.settings[f.id]) {
                try {
                    f.init?.();
                } catch (error) {
                    console.error(`[YTKit] Error initializing feature "${f.id}":`, error);
                }
            }
        });

        document.querySelectorAll('.ycs-feature-cb:checked').forEach(cb => {
            const row = cb.closest('[data-feature-id]');
            if (row) {
                const featureId = row.dataset.featureId;
                const subPanel = document.querySelector(`.ycs-sub-panel[data-parent-feature="${featureId}"]`);
                if (subPanel) subPanel.style.display = 'flex';
            }
        });

        const hasRun = await settingsManager.getFirstRunStatus();
        if (!hasRun) {
            document.body.classList.add('ycs-panel-open');
            await settingsManager.setFirstRunStatus(true);
        }
    }

    // Wait for the DOM to be ready before executing the script.
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

})();