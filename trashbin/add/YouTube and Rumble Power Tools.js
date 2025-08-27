// ==UserScript==
// @name         YouTube and Rumble Power Tools
// @version      1.0.0
// @description  Adds powerful hotkeys to the YouTube and Rumble video players: screenshot, picture-in-picture, fullscreen, playback speed, frame-by-frame, and more.
// @author       Matthew Parker
// @namespace    https://github.com/SysAdminDoc/YTKit
// @homepageURL  https://github.com/SysAdminDoc/YTKit
// @match        https://*.youtube.com/*
// @match        https://rumble.com/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @license      MIT
// @downloadURL  https://github.com/SysAdminDoc/YTKit/YouTube%20and%20Rumble%20Power%20Tools.user.js
// @updateURL    https://github.com/SysAdminDoc/YTKit/YouTube%20and%20Rumble%20Power%20Tools.meta.js
// ==/UserScript==

'use strict';

const HELP_BODY = `
Double-click video: Toggle web full screen
Middle-mouse-click video: Fast forward 5 seconds

P key: Take a screenshot of the video
I key: Toggle Picture-in-Picture mode

←/→ Arrow keys: Rewind/Fast forward 5 seconds
Shift + ←/→: Rewind/Fast forward 20 seconds
↑/↓ Arrow keys: Adjust volume

Spacebar: Play/Pause
Enter: Toggle native full screen
Shift + Enter: Toggle web full screen (fit to window)

ESC: Exit native or web full screen

N key: Play the next video
D key: Go to the previous frame
F key (E on YouTube): Go to the next frame

Z key: Toggle between normal and saved playback speed
X key: Decrease playback speed by 0.1
C key (V on YouTube): Increase playback speed by 0.1
`;

// --- Configuration for Supported Sites ---
const SITE_CONFIG = {
    'youtube.com': {
        shellCSS: '#player-container, #player',
        playCSS: 'button.ytp-play-button',
        nextCSS: 'a.ytp-next-button',
        fullCSS: 'button.ytp-fullscreen-button',
        webFullCSS: '.ytp-size-button', // The "Theater mode" button
        isClickOnVideo: true,
        // YouTube hijacks some keys, so we remap them
        hotkeyOverrides: {
            'F': 'E', // Use 'E' for next frame
            'C': 'V', // Use 'V' to speed up
        }
    },
    'rumble.com': {
        shellCSS: '.rumble-player',
        playCSS: '.rumble-player-controls-play',
        fullCSS: '.rumble-player-controls-fullscreen',
        // Next video is the first one in the sidebar list
        nextCSS: '.video-listing-container .video-item:first-of-type > a',
        isClickOnVideo: true,
        hotkeyOverrides: {}
    }
};

// --- Main Application ---
const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
const d = document;
let v, _fp, _fs, by, cfg = {};
let msgElement;

const observeOpt = { childList: true, subtree: true };
const noopFn = function() {};
const q = (css, p = d) => p.querySelector(css);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const log = console.log.bind(
    console,
    '%c[%s] %c%s',
    'color:#c3c;font-weight:bold;',
    GM_info.script.name,
    'color:initial;font-weight:normal;',
);

// --- Classes for Fullscreen Management ---

class FullScreen {
    constructor(e) {
        let fn = d.exitFullscreen || d.webkitExitFullscreen || d.mozCancelFullScreen || d.msExitFullscreen || noopFn;
        this.exit = fn.bind(d);
        fn = e.requestFullscreen || e.webkitRequestFullScreen || e.mozRequestFullScreen || e.msRequestFullScreen || noopFn;
        this.enter = fn.bind(e);
    }
    static isFull() {
        return !!(d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement);
    }
    toggle() {
        FullScreen.isFull() ? this.exit() : this.enter();
    }
}

class FullPage {
    constructor(container) {
        this._isFull = false;
        this.container = container || this.getPlayerContainer(v);
        this.injectStyles();
    }

    injectStyles() {
        GM_addStyle(`
			.gm-fp-body .gm-fp-zTop {
				position: relative !important;
				z-index: 2147483646 !important;
			}
			.gm-fp-body, .gm-fp-wrapper {
                overflow: hidden !important;
            }
			.gm-fp-wrapper {
				display: block !important;
				position: fixed !important;
				width: 100% !important;
				height: 100% !important;
				padding: 0 !important;
				margin: 0 !important;
				top: 0 !important;
				left: 0 !important;
				background: #000 !important;
				z-index: 2147483646 !important;
			}
            .gm-fp-wrapper .gm-fp-innerBox {
				width: 100% !important;
				height: 100% !important;
			}
		`);
    }

    getPlayerContainer(video) {
        let e = video, p = e.parentNode;
        const { clientWidth: wid, clientHeight: h } = e;
        if (!p) return e;
        do {
            e = p;
            p = e.parentNode;
        } while (p && p !== by && p.clientWidth - wid < 5 && p.clientHeight - h < 5);
        return e;
    }

    static isFull(e) {
        if (!e) return false;
        return w.innerWidth - e.clientWidth < 5 && w.innerHeight - e.clientHeight < 5;
    }

    toggle() {
        if (!this.container || !this.container.contains(v)) {
            this.container = this.getPlayerContainer(v);
        }
        by.classList.toggle('gm-fp-body');
        let e = v;
        while (e && e !== this.container) {
            e.classList.toggle('gm-fp-innerBox');
            e = e.parentNode;
        }
        if (this.container) {
            this.container.classList.toggle('gm-fp-wrapper');
            e = this.container.parentNode;
            while (e && e !== by) {
                e.classList.toggle('gm-fp-zTop');
                e = e.parentNode;
            }
        }
        this._isFull = !this._isFull;
    }
}

// --- Core Functions ---

const tip = (msg) => {
    if (!msgElement) {
        msgElement = d.createElement('div');
        Object.assign(msgElement.style, {
            position: 'fixed',
            top: '-50px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2147483647',
            background: '#333',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '16px',
            transition: 'top 0.4s ease-out',
            opacity: '0',
            textAlign: 'center'
        });
        by.appendChild(msgElement);
    }
    msgElement.textContent = msg;
    msgElement.style.opacity = '1';
    msgElement.style.top = '20px';
    setTimeout(() => {
        msgElement.style.top = '-50px';
        msgElement.style.opacity = '0';
    }, 2000);
};

const doClick = (selectorOrElement) => {
    const e = typeof selectorOrElement === 'string' ? q(selectorOrElement) : selectorOrElement;
    if (e) {
        e.click();
    }
};

const inRange = (n, min, max) => Math.max(min, n) === Math.min(n, max);

const adjustRate = n => {
    if (!v) return;
    let newRate = v.playbackRate + n;
    v.playbackRate = Math.max(0.1, Math.min(newRate, 16)).toFixed(2);
};

const adjustVolume = n => {
    if (!v) return;
    let newVolume = v.volume + n;
    if (inRange(newVolume, 0, 1)) {
        v.volume = +newVolume.toFixed(2);
        v.muted = false;
    }
};

// --- Hotkey Actions ---
const actList = new Map();
actList.set('KeyZ', () => { // Z: Toggle between 1.0 and saved speed
    if (!v) return;
    if (v.playbackRate === 1.0) {
        v.playbackRate = +localStorage.getItem('mvPlayRate') || 1.5;
    } else {
        v.playbackRate = 1.0;
    }
    tip(`Speed: ${v.playbackRate}x`);
});
actList.set('KeyX', () => adjustRate(-0.1));
actList.set('KeyC', () => adjustRate(0.1));
actList.set('KeyV', () => adjustRate(0.1)); // For YouTube
actList.set('ArrowDown', () => adjustVolume(-0.05));
actList.set('ArrowUp', () => adjustVolume(0.05));
actList.set('ArrowLeft', () => { if (v) v.currentTime -= 5; });
actList.set('Shift+ArrowLeft', () => { if (v) v.currentTime -= 20; });
actList.set('ArrowRight', () => { if (v) v.currentTime += 5; });
actList.set('Shift+ArrowRight', () => { if (v) v.currentTime += 20; });
actList.set('KeyD', () => { if (v) { v.currentTime -= 0.03; v.pause(); }});
actList.set('KeyF', () => { if (v) { v.currentTime += 0.03; v.pause(); }});
actList.set('KeyE', () => { if (v) { v.currentTime += 0.03; v.pause(); }}); // For YouTube
actList.set('Space', () => {
    if (q(cfg.playCSS)) {
        doClick(q(cfg.playCSS));
    } else if (v) {
        v.paused ? v.play() : v.pause();
    }
});
actList.set('Enter', () => {
    _fs ? _fs.toggle() : doClick(cfg.fullCSS);
});
actList.set('Shift+Enter', () => {
    _fp ? _fp.toggle() : doClick(cfg.webFullCSS);
});
actList.set('Escape', () => {
    if (FullScreen.isFull()) {
        _fs ? _fs.exit() : doClick(cfg.fullCSS);
    } else if (FullPage.isFull(_fp ? _fp.container : q('.gm-fp-wrapper'))) {
        _fp ? _fp.toggle() : doClick(cfg.webFullCSS);
    }
});
actList.set('KeyI', () => { // I: Picture-in-Picture
    if (!v) return;
    if (!d.pictureInPictureElement) {
        v.requestPictureInPicture().catch(err => {
            alert(`Unable to enter Picture-in-Picture mode:\n${err}`);
        });
    } else {
        d.exitPictureInPicture().catch(err => {
            alert(`Unable to exit Picture-in-Picture mode:\n${err}`);
        });
    }
});
actList.set('KeyP', () => { // P: Screenshot
    if (!v) return;
    const canvas = d.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const link = d.createElement('a');
        link.href = url;
        link.download = `screenshot-${Date.now()}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
});
actList.set('KeyN', () => { // N: Next Video
    doClick(cfg.nextCSS);
});


const app = {
    _vList: null,
    _findMV: null,
    _timer: null,

    shellEvent() {
        const shell = cfg.isClickOnVideo ? v : q(cfg.shellCSS);
        if (!shell) return;

        shell.addEventListener('dblclick', ev => {
            if (ev.target.closest('button, a')) return;
            ev.stopPropagation();
            ev.preventDefault();
            this.checkUI();
            actList.get('Shift+Enter')();
        });

        shell.addEventListener('mousedown', ev => {
            if (ev.button === 1) { // Middle mouse button
                ev.preventDefault();
                ev.stopPropagation();
                if (v && v.duration !== Infinity) {
                    actList.get('ArrowRight')();
                }
            }
        });
    },

    checkMV() {
        if (!this._findMV) return null;
        const currentVideo = this._findMV();
        if (currentVideo && currentVideo !== v) {
            v = currentVideo;
            _fs = _fp = null; // Reset fullscreen helpers
            if (GM_getValue('rememberRate', true)) {
                v.playbackRate = +localStorage.getItem('mvPlayRate') || 1.0;
                v.addEventListener('ratechange', () => {
                    if (v && v.playbackRate && v.playbackRate !== 1.0) {
                        localStorage.setItem('mvPlayRate', v.playbackRate);
                    }
                });
            }
            this.checkUI();
        }
        return v;
    },

    hotKey(e) {
        const t = e.target;
        if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.nodeName)) {
            return;
        }

        if (!this.checkMV()) return;

        // Allow player's own space/arrow key handling if focused inside the player
        const shell = q(cfg.shellCSS);
        if (!e.shiftKey && shell && shell.contains(t) && ['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            return;
        }

        let key = e.code;
        if (e.shiftKey) key = 'Shift+' + key;

        // Apply site-specific hotkey overrides
        if (cfg.hotkeyOverrides) {
            const baseKey = e.code.replace('Key', '');
            if (cfg.hotkeyOverrides[baseKey]) {
                const newKey = `Key${cfg.hotkeyOverrides[baseKey]}`;
                if (key === e.code) key = newKey; // Non-shifted
            }
        }

        if (actList.has(key)) {
            e.preventDefault();
            e.stopPropagation();
            actList.get(key)();
            if (['KeyC', 'KeyX', 'KeyV'].includes(e.code)) {
                tip(`Speed: ${v.playbackRate}x`);
            }
        }
    },

    checkUI() {
        if (!_fp) _fp = new FullPage(q(cfg.shellCSS));
        if (!_fs) _fs = new FullScreen(v);
    },

    bindEvents() {
        clearInterval(this._timer);
        by = d.body;
        v = v || this._findMV();
        if (!v || !by) {
            log('Video element or body not found, retrying...');
            this._timer = setTimeout(() => this.init(), 500);
            return;
        }

        log('Video element found, binding events.', v);

        v.addEventListener('canplay', () => {
            if (GM_getValue('rememberRate', true)) {
                v.playbackRate = +localStorage.getItem('mvPlayRate') || 1.0;
                v.addEventListener('ratechange', () => {
                    if (v.playbackRate && v.playbackRate !== 1.0) {
                        localStorage.setItem('mvPlayRate', v.playbackRate);
                    }
                });
            }
            this.checkUI();
            this.shellEvent();
        }, { once: true });

        by.addEventListener('keydown', this.hotKey.bind(this), true); // Use capture phase

        // Handle dynamic page navigation
        this.observeUrlChanges();

        tip(`${GM_info.script.name} is active.`);
    },

    observeUrlChanges() {
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                // Give the new page/video time to load
                setTimeout(() => {
                    log('URL changed, re-initializing video search.');
                    this.checkMV();
                }, 1000);
            }
        }).observe(d.body, { childList: true, subtree: true });
    },

    init() {
        const host = location.hostname;
        const siteKey = Object.keys(SITE_CONFIG).find(k => host.includes(k));
        if (!siteKey) return;

        cfg = SITE_CONFIG[siteKey];

        this._vList = d.getElementsByTagName('video');
        this._findMV = Array.prototype.find.bind(this._vList, el => el.offsetWidth > 100 && el.offsetHeight > 100);

        this._timer = setInterval(() => {
            if (this._findMV()) {
                this.bindEvents();
            }
        }, 300);

        // Stop trying after 15 seconds if no video is found
        setTimeout(() => clearInterval(this._timer), 15000);
    }
};

// --- Script Entry Point ---
GM_registerMenuCommand('Hotkeys List', () => alert(HELP_BODY));
GM_registerMenuCommand((GM_getValue('rememberRate', true) ? '✔️ ' : '') + 'Remember playback speed', () => {
    GM_setValue('rememberRate', !GM_getValue('rememberRate', true));
    location.reload();
});


if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', app.init.bind(app));
} else {
    app.init();
}