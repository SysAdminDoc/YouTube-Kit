// ==UserScript==
// @name         Video Speed and Loop Controller
// @version      2.0.0
// @description  Enhances YouTube and Rumble with playback speeds beyond 2x, custom looping, and other features.
// @author       Matthew Parker
// @namespace    https://github.com/SysAdminDoc/YTKit
// @homepage     https://github.com/SysAdminDoc/YTKit
// @match        https://*.youtube.com/*
// @match        https://rumble.com/*
// @grant        none
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/Video_Speed_and_Loop_Controller.user.js
// @updateURL    https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/Video_Speed_and_Loop_Controller.user.js
// ==/UserScript==

(function() {
    'use strict';

    const PANEL_ID = 'video-enhancements-panel';
    let isInitializing = false;

    // --- Site-specific configurations ---
    const siteConfigs = {
        'youtube.com': {
            anchorSelector: 'ytd-masthead #end #buttons',
            videoSelector: '#movie_player video',
            confirmDialogSelector: 'yt-confirm-dialog-renderer',
            confirmButtonSelector: '#confirm-button',
            isWatchPage: () => window.location.pathname.startsWith('/watch'),
        },
        'rumble.com': {
            anchorSelector: '.header-user-menu',
            videoSelector: '.rumble-player-video video',
            confirmDialogSelector: null, // Rumble does not have a "continue watching" dialog
            confirmButtonSelector: null,
            isWatchPage: () => window.location.pathname.includes('/v'),
        }
    };

    function getSiteConfig() {
        const hostname = window.location.hostname;
        if (hostname.includes('youtube.com')) {
            return siteConfigs['youtube.com'];
        }
        if (hostname.includes('rumble.com')) {
            return siteConfigs['rumble.com'];
        }
        return null;
    }

    const panelCSS = `
        :root {
            --primary-bg: transparent; --hover-bg: rgba(255, 255, 255, 0.1); --active-bg: #f00;
            --panel-bg: #282828; --text-color: #fff; --shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            --input-bg: rgba(0, 0, 0, 0.3); --input-border: rgba(255, 255, 255, 0.2);
        }
        .yt-custom-control-panel {
            position: relative; z-index: 99999; font-family: Roboto, Arial, sans-serif;
            align-self: center; margin-right: 8px;
        }
        .yt-custom-control-toggle {
            background-color: var(--primary-bg); color: var(--text-color);
            border: 1px solid rgba(255, 255, 255, 0.1); font-weight: 500; cursor: pointer;
            transition: background-color 0.3s; display: flex; align-items: center; justify-content: center;
            width: 40px; height: 40px; box-sizing: border-box; border-radius: 50%;
            font-size: 2rem; line-height: 0;
        }
        .yt-custom-control-toggle:hover { background-color: var(--hover-bg); }
        .yt-custom-control-content {
            position: absolute; top: calc(100% + 10px); right: 0; transform: none; left: auto;
            background-color: var(--panel-bg); color: var(--text-color); padding: 12px;
            border: 1px solid var(--input-border); border-radius: 12px; box-shadow: var(--shadow);
            display: none; flex-direction: column; gap: 12px; min-width: 320px; white-space: nowrap;
        }
        .yt-custom-control-panel.expanded .yt-custom-control-content { display: flex; }
        .yt-custom-control-title {
            font-weight: bold; margin-bottom: 8px; padding: 0 5px; font-size: 16px;
        }
        .yt-custom-control-section { padding: 8px; border-radius: 8px; transition: background-color 0.2s; }
        .yt-custom-control-section:hover { background-color: rgba(255, 255, 255, 0.05); }
        .yt-custom-btn {
            background-color: rgba(255, 255, 255, 0.15); border: none; color: var(--text-color);
            padding: 6px 12px; border-radius: 18px; cursor: pointer; font-size: 13px;
            white-space: nowrap; text-align: center; flex-grow: 1; margin-right: 8px;
        }
        .yt-custom-btn:last-child { margin-right: 0; }
        .yt-custom-btn:hover { background-color: rgba(255, 255, 255, 0.25); }
        .yt-custom-btn.active { background-color: var(--active-bg); }
        .yt-custom-btn-group { display: flex; justify-content: space-between; }
        .yt-speed-controls { display: flex; flex-direction: column; gap: 8px; white-space: nowrap; }
        .yt-slider-row { display: flex; align-items: center; width: 100%; }
        .yt-custom-slider { flex-grow: 1; min-width: 100px; }
        .yt-preset-speeds { display: flex; gap: 5px; width: 100%; }
        .loop-input-container {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; margin-top: 10px;
        }
        .loop-time-input {
            width: 100%; background-color: var(--input-bg);
            border: 1px solid var(--input-border); color: var(--text-color);
            border-radius: 8px; padding: 8px; font-family: 'Courier New', Courier, monospace;
            font-size: 14px; text-align: center; transition: border-color 0.3s, box-shadow 0.3s;
        }
        .loop-time-input:focus {
            outline: none; border-color: #3ea6ff;
            box-shadow: 0 0 5px rgba(62, 166, 255, 0.5);
        }
        .yt-custom-toggle-section {
            display: flex; justify-content: space-between; align-items: center;
            padding: 4px 8px;
        }
        .yt-custom-toggle-section .yt-custom-btn {
            flex-grow: 0; min-width: 60px; margin-right: 0;
        }
    `;
    const styleEl = document.createElement('style');
    styleEl.textContent = panelCSS;
    document.head.appendChild(styleEl);

    function getFormattedTimestamp() {
        const now = new Date();
        return now.toLocaleTimeString();
    }

    function createElement(tag, id, className, textContent) {
        const el = document.createElement(tag);
        if (id) el.id = id;
        if (className) el.className = className;
        if (textContent) el.textContent = textContent;
        return el;
    }

    let playbackRateDisconnect = () => {};
    let loopDisconnect = () => {};

    function cleanUpVideoFeatures() {
        playbackRateDisconnect();
        loopDisconnect();
        AutoConfirmController.stop();
        playbackRateDisconnect = () => {};
        loopDisconnect = () => {};
    }

    function createAndSetupControlPanel(container) {
        const panel = createElement('div', PANEL_ID, 'yt-custom-control-panel');
        const toggleBtn = createElement('button', null, 'yt-custom-control-toggle', '≡');
        const contentDiv = createElement('div', null, 'yt-custom-control-content');
        toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('expanded'); toggleBtn.textContent = panel.classList.contains('expanded') ? '×' : '≡'; });
        document.addEventListener('click', () => { if (panel.classList.contains('expanded')) { panel.classList.remove('expanded'); toggleBtn.textContent = '≡'; } });
        contentDiv.addEventListener('click', (e) => e.stopPropagation());

        const titleDiv = createElement('div', null, 'yt-custom-control-title', 'Enhanced Video Controls');

        const speedSection = createElement('div', null, 'yt-custom-control-section');
        const speedText = createElement('div', null, null, 'Playback Speed: ');
        const speedValue = createElement('span', null, null, '1.0');
        speedText.appendChild(speedValue); speedText.append('x');
        const speedControls = createElement('div', null, 'yt-speed-controls');
        const sliderRow = createElement('div', null, 'yt-slider-row');
        const speedSlider = createElement('input', null, 'yt-custom-slider');
        speedSlider.type = 'range'; speedSlider.min = '0.25'; speedSlider.max = '5'; speedSlider.step = '0.25'; speedSlider.value = '1';
        sliderRow.appendChild(speedSlider);
        const presetSpeeds = createElement('div', null, 'yt-preset-speeds yt-custom-btn-group');
        [1, 1.5, 2, 3, 4, 5].forEach(speed => { const btn = createElement('button', null, 'yt-custom-btn yt-speed-preset', `${speed}x`); btn.dataset.speed = speed; presetSpeeds.appendChild(btn); });
        speedControls.append(sliderRow, presetSpeeds);
        speedSection.append(speedText, speedControls);

        const loopSection = createElement('div', null, 'yt-custom-control-section yt-custom-toggle-section');
        loopSection.appendChild(createElement('span', null, null, 'Loop Playback'));
        const loopToggle = createElement('button', null, 'yt-custom-btn', 'Off');
        loopSection.appendChild(loopToggle);

        const loopRangeSection = createElement('div', null, 'yt-custom-control-section');
        loopRangeSection.appendChild(createElement('span', null, null, 'Loop Range'));
        const rangeButtons = createElement('div', null, 'yt-custom-btn-group');
        const loopStartBtn = createElement('button', null, 'yt-custom-btn', 'Set Start');
        const loopEndBtn = createElement('button', null, 'yt-custom-btn', 'Set End');
        const loopClearBtn = createElement('button', null, 'yt-custom-btn', 'Clear');
        rangeButtons.append(loopStartBtn, loopEndBtn, loopClearBtn);
        const loopInputContainer = createElement('div', null, 'loop-input-container');
        const loopStartInput = createElement('input', null, 'loop-time-input');
        loopStartInput.type = 'text'; loopStartInput.placeholder = '00:00.000';
        const loopInputSeparator = createElement('span', null, null, '→');
        const loopEndInput = createElement('input', null, 'loop-time-input');
        loopEndInput.type = 'text'; loopEndInput.placeholder = '00:00.000';
        loopInputContainer.append(loopStartInput, loopInputSeparator, loopEndInput);
        loopRangeSection.append(rangeButtons, loopInputContainer);

        const autoConfirmSection = createElement('div', null, 'yt-custom-control-section yt-custom-toggle-section');
        autoConfirmSection.appendChild(createElement('span', null, null, 'Auto-Click "Continue watching?"'));
        const autoConfirmToggle = createElement('button', null, 'yt-custom-btn', 'Off');
        autoConfirmSection.appendChild(autoConfirmToggle);

        contentDiv.append(titleDiv, speedSection, loopSection, loopRangeSection, autoConfirmSection);
        panel.append(toggleBtn, contentDiv);
        container.prepend(panel);

        return {
            speedSection, speedValue, speedSlider, presetSpeeds,
            loopSection, loopToggle,
            loopRangeSection, loopStartBtn, loopEndBtn, loopClearBtn, loopStartInput, loopEndInput,
            autoConfirmToggle, autoConfirmSection
        };
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    clearTimeout(timer);
                    resolve(element);
                }
            }, 250);
            const timer = setTimeout(() => {
                clearInterval(interval);
                reject(new Error(`Element not found: ${selector}`));
            }, timeout);
        });
    }

    const SpeedController = {
        updatePlaybackRate(rate, elements) {
            if (!document.querySelector('video') || !elements) return;
            elements.speedValue.textContent = parseFloat(rate).toFixed(2);
            elements.speedSlider.value = rate;
            elements.presetSpeeds.querySelectorAll('.yt-speed-preset').forEach(btn => {
                btn.classList.toggle('active', parseFloat(btn.dataset.speed) === parseFloat(rate));
            });
        },
        init(video, elements) {
            elements.speedSlider.addEventListener('input', () => { video.playbackRate = parseFloat(elements.speedSlider.value); this.updatePlaybackRate(video.playbackRate, elements); });
            elements.presetSpeeds.addEventListener('click', (e) => { const btn = e.target.closest('.yt-speed-preset'); if (btn) { video.playbackRate = parseFloat(btn.dataset.speed); this.updatePlaybackRate(video.playbackRate, elements); } });
            let lastRate = video.playbackRate;
            const observer = setInterval(() => { const cv = document.querySelector('video'); if (cv && cv.playbackRate !== lastRate) { lastRate = cv.playbackRate; this.updatePlaybackRate(lastRate, elements); } }, 500);
            playbackRateDisconnect = () => clearInterval(observer);
        }
    };

    const LoopController = {
        loopStart: null,
        loopEnd: null,
        formatTime(seconds) { if (seconds === null || isNaN(seconds)) return ''; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); const ms = Math.round((seconds - Math.floor(seconds)) * 1000); return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`; },
        parseTime(timeStr) { if (!timeStr) return null; const parts = timeStr.split(':'); let seconds = 0; try { if (parts.length === 2) { seconds = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]); } else { seconds = parseFloat(parts[0]); } return isNaN(seconds) ? null : seconds; } catch (e) { return null; } },
        init(video, elements) {
            let isLooping = video.loop;
            const { loopToggle, loopStartBtn, loopEndBtn, loopClearBtn, loopStartInput, loopEndInput } = elements;
            const updateLoopInputs = () => { loopStartInput.value = this.formatTime(this.loopStart); loopEndInput.value = this.formatTime(this.loopEnd); };
            const updateLoopState = (newState) => { isLooping = newState; loopToggle.textContent = isLooping ? 'On' : 'Off'; loopToggle.classList.toggle('active', isLooping); };
            updateLoopState(isLooping);
            updateLoopInputs();
            loopToggle.addEventListener('click', () => { video.loop = !video.loop; updateLoopState(video.loop); });
            loopStartBtn.addEventListener('click', () => { this.loopStart = video.currentTime; updateLoopInputs(); });
            loopEndBtn.addEventListener('click', () => { this.loopEnd = video.currentTime; updateLoopInputs(); });
            loopClearBtn.addEventListener('click', () => { this.loopStart = null; this.loopEnd = null; updateLoopInputs(); });
            loopStartInput.addEventListener('change', () => { const parsed = this.parseTime(loopStartInput.value); this.loopStart = parsed; loopStartInput.value = this.formatTime(parsed); });
            loopEndInput.addEventListener('change', () => { const parsed = this.parseTime(loopEndInput.value); this.loopEnd = parsed; loopEndInput.value = this.formatTime(parsed); });
            video.addEventListener('timeupdate', () => { if (isLooping && this.loopStart !== null && this.loopEnd !== null && this.loopStart < this.loopEnd && video.currentTime >= this.loopEnd) { video.currentTime = this.loopStart; } });
            let lastLoopState = video.loop;
            const observer = setInterval(() => { const cv = document.querySelector('video'); if (cv && cv.loop !== lastLoopState) { lastLoopState = cv.loop; updateLoopState(lastLoopState); } }, 500);
            loopDisconnect = () => clearInterval(observer);
        }
    };

    const AutoConfirmController = {
        observer: null,
        isEnabled: false,
        storageKey: 'video-auto-confirm-enabled',
        init(toggleButton, siteConfig) {
            if (!siteConfig.confirmDialogSelector) {
                toggleButton.closest('.yt-custom-toggle-section').style.display = 'none';
                return;
            }
            const savedState = localStorage.getItem(this.storageKey);
            this.isEnabled = savedState === 'true';
            this.updateButtonState(toggleButton);
            if (this.isEnabled) this.start(siteConfig);
            toggleButton.addEventListener('click', () => { this.isEnabled = !this.isEnabled; localStorage.setItem(this.storageKey, this.isEnabled); this.updateButtonState(toggleButton); this.isEnabled ? this.start(siteConfig) : this.stop(); });
        },
        updateButtonState(toggleButton) {
            if (toggleButton) { toggleButton.textContent = this.isEnabled ? 'On' : 'Off'; toggleButton.classList.toggle('active', this.isEnabled); }
        },
        start(siteConfig) {
            if (this.observer || !siteConfig.confirmDialogSelector) return;
            this.observer = new MutationObserver(() => {
                const dialog = document.querySelector(siteConfig.confirmDialogSelector);
                if (dialog && dialog.offsetParent !== null) {
                    console.log(`[Video Enhanced Controls] [${getFormattedTimestamp()}] Auto-clicked "Continue Watching?" dialog.`);
                    dialog.querySelector(siteConfig.confirmButtonSelector)?.click();
                }
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
        },
        stop() {
            if (this.observer) { this.observer.disconnect(); this.observer = null; }
        }
    };

    async function init() {
        if (isInitializing) return;
        isInitializing = true;

        try {
            document.getElementById(PANEL_ID)?.remove();
            cleanUpVideoFeatures();

            const siteConfig = getSiteConfig();
            if (!siteConfig) {
                console.error('[Video Enhanced Controls] Unsupported site.');
                return;
            }

            const anchorElement = await waitForElement(siteConfig.anchorSelector);
            const panelElements = createAndSetupControlPanel(anchorElement);
            AutoConfirmController.init(panelElements.autoConfirmToggle, siteConfig);

            if (siteConfig.isWatchPage()) {
                try {
                    const video = await waitForElement(siteConfig.videoSelector);
                    panelElements.speedSection.style.display = 'block';
                    panelElements.loopSection.style.display = 'flex';
                    panelElements.loopRangeSection.style.display = 'block';
                    SpeedController.init(video, panelElements);
                    LoopController.init(video, panelElements);
                    SpeedController.updatePlaybackRate(video.playbackRate, panelElements);
                } catch (error) {
                    console.warn('[Video Enhanced Controls] Video player not found on this page.', error);
                    panelElements.speedSection.style.display = 'none';
                    panelElements.loopSection.style.display = 'none';
                    panelElements.loopRangeSection.style.display = 'none';
                }
            } else {
                panelElements.speedSection.style.display = 'none';
                panelElements.loopSection.style.display = 'none';
                panelElements.loopRangeSection.style.display = 'none';
            }
        } catch (error) {
            console.error('[Video Enhanced Controls] Initialization failed:', error);
        } finally {
            isInitializing = false;
        }
    }

    // --- Universal Page Change Observer ---
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            init();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial run
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

})();
