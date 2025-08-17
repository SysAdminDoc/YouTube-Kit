// ==UserScript==
// @name         YTKit Adblock
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      1.0.0
// @description  Blocks YouTube ads (video and static) safely and efficiently without interfering with network requests.
// @author       Matthew Parker
// @match        *://*.youtube.com/*
// @match        *://rumble.com/*
// @grant        none
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/YT-Adblock.user.js
// @updateURL    https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/YT-Adblock.user.js
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Main function to initialize the script based on the current website.
     */
    const initialize = () => {
        const hostname = window.location.hostname;

        if (hostname.includes('youtube.com')) {
            initYouTube();
        } else if (hostname.includes('rumble.com')) {
            // Rumble ad-blocking logic can be added here in the future.
            // The script currently only targets YouTube selectors.
            console.log('YTKit Adblock: Loaded on Rumble.com (no active rules).');
        }
    };

    /**
     * Initializes all ad-blocking functionalities for YouTube.
     */
    const initYouTube = () => {
        // Inject CSS to hide static ad elements on the page.
        injectAdblockCss();

        // Start observing the DOM for dynamic changes, like video ads and popups.
        observeDOMChanges();
    };

    /**
     * Creates and injects a <style> element to hide static ad containers.
     */
    const injectAdblockCss = () => {
        const styleId = 'ytkit-adblock-styles';
        if (document.getElementById(styleId)) return;

        const cssSelectors = [
            // Top banner ad on homepage
            '#masthead-ad',
            // Ads in the video feed/grid
            'ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer)',
            // Ads at the bottom of the video player
            '.video-ads.ytp-ad-module',
            // Premium promotion popups
            'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
            'ytd-popup-container:has(a[href="/premium"])',
            // Ad panels on the right side of the video player
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
            // Promoted ads in the sidebar
            '#related #player-ads',
            '#related ytd-ad-slot-renderer',
            // Ads in search results
            'ytd-ad-slot-renderer',
            // Mobile-specific ad elements
            'ad-slot-renderer',
            'ytm-companion-ad-renderer',
        ];

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `${cssSelectors.join(', ')} { display: none !important; }`;
        (document.head || document.documentElement).appendChild(style);
    };

    /**
     * Handles the logic for skipping or fast-forwarding video ads.
     */
    const processVideoAd = () => {
        const video = document.querySelector('.ad-showing video');
        if (!video) return;

        // Mute, fast-forward, and click the skip button if available.
        video.muted = true;
        if (video.duration) {
            video.currentTime = video.duration;
        }

        const skipButton = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
        skipButton?.click();
    };

    /**
     * Removes the anti-adblock enforcement popups and the overlay backdrop.
     * @param {HTMLElement} node - The node to check for popups.
     */
    const removeAntiAdblockPopup = (node) => {
        const isPopupContainer = node.tagName === 'YTD-POPUP-CONTAINER';
        const hasEnforcementMessage = !!node.querySelector('ytd-enforcement-message-view-model');

        if (isPopupContainer && hasEnforcementMessage) {
            node.remove();

            // Remove the grey backdrop that locks the page.
            const backdrop = document.querySelector('tp-yt-iron-overlay-backdrop[opened]');
            backdrop?.remove();

            // Ensure the main video continues playing.
            const mainVideo = document.querySelector('video.html5-main-video');
            if (mainVideo && mainVideo.paused) {
                mainVideo.play();
            }
        }
    };

    /**
     * Sets up a MutationObserver to watch for ads and popups being added to the page.
     */
    const observeDOMChanges = () => {
        const observer = new MutationObserver((mutations) => {
            // Always check for video ads, as their container might already exist.
            processVideoAd();

            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        // Ensure we only check element nodes.
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the added node is or contains an anti-adblock popup.
                            removeAntiAdblockPopup(node);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    // Run the script once the DOM is ready.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();