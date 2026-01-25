// ==UserScript==
// @name         YTKit: YouTube Customization Suite
// @namespace    https://github.com/SysAdminDoc/YTKit
// @version      12.1
// @description  Ultimate YouTube customization with VLC streaming, video/channel hiding, playback enhancements, and more. Optimized for performance.
// @author       Matthew Parker
// @match        https://*.youtube.com/*
// @match        https://*.youtube-nocookie.com/*
// @match        https://youtu.be/*
// @exclude      https://*.youtube.com/embed/*
// @exclude      https://music.youtube.com/*
// @exclude      https://www.youtube.com/shorts/*
// @exclude      https://m.youtube.com/*
// @exclude      https://www.youtube.com/playlist?list=*
// @exclude      https://studio.youtube.com/*
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
// @updateURL    https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @downloadURL  https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0A: CORE UTILITIES & UNIFIED STORAGE
    // ══════════════════════════════════════════════════════════════════════════

    // Settings version for migrations
    const SETTINGS_VERSION = 3;

    // Page type detection for lazy-loading features
    const PageTypes = {
        HOME: 'home',
        WATCH: 'watch',
        SEARCH: 'search',
        CHANNEL: 'channel',
        SUBSCRIPTIONS: 'subscriptions',
        PLAYLIST: 'playlist',
        SHORTS: 'shorts',
        HISTORY: 'history',
        LIBRARY: 'library',
        OTHER: 'other'
    };

    function getCurrentPage() {
        const path = window.location.pathname;
        if (path === '/' || path === '/feed/trending') return PageTypes.HOME;
        if (path.startsWith('/watch')) return PageTypes.WATCH;
        if (path.startsWith('/results')) return PageTypes.SEARCH;
        if (path.startsWith('/shorts')) return PageTypes.SHORTS;
        if (path.startsWith('/feed/subscriptions')) return PageTypes.SUBSCRIPTIONS;
        if (path.startsWith('/feed/history')) return PageTypes.HISTORY;
        if (path.startsWith('/feed/library') || path.startsWith('/playlist')) return PageTypes.LIBRARY;
        if (path.startsWith('/@') || path.startsWith('/channel') || path.startsWith('/c/') || path.startsWith('/user/')) return PageTypes.CHANNEL;
        return PageTypes.OTHER;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Trusted Types Safe HTML Helper
    // ══════════════════════════════════════════════════════════════════════════
    // YouTube enforces Trusted Types which blocks direct innerHTML assignments
    const TrustedHTML = (() => {
        let policy = null;
        
        // Try to create a Trusted Types policy
        if (typeof window.trustedTypes !== 'undefined' && window.trustedTypes.createPolicy) {
            try {
                policy = window.trustedTypes.createPolicy('ytkit-policy', {
                    createHTML: (string) => string
                });
            } catch (e) {
                // Policy already exists or can't be created
                console.log('[YTKit] Trusted Types policy creation failed, using fallback');
            }
        }
        
        return {
            // Set innerHTML safely
            setHTML(element, html) {
                if (policy) {
                    element.innerHTML = policy.createHTML(html);
                } else {
                    // Fallback: use DOMParser to parse HTML safely
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(`<template>${html}</template>`, 'text/html');
                        const template = doc.querySelector('template');
                        element.innerHTML = '';
                        if (template && template.content) {
                            element.appendChild(template.content.cloneNode(true));
                        }
                    } catch (e) {
                        // Last resort: use Range.createContextualFragment
                        try {
                            const range = document.createRange();
                            range.selectNode(document.body);
                            const fragment = range.createContextualFragment(html);
                            element.innerHTML = '';
                            element.appendChild(fragment);
                        } catch (e2) {
                            console.error('[YTKit] Failed to set HTML:', e2);
                        }
                    }
                }
            },
            
            // Create HTML string (for cases where we need TrustedHTML)
            create(html) {
                if (policy) {
                    return policy.createHTML(html);
                }
                return html;
            }
        };
    })();

    // Unified Storage Manager
    const StorageManager = {
        _cache: {},
        _dirty: new Set(),
        _saveTimeout: null,

        async get(key, defaultVal = null) {
            if (this._cache.hasOwnProperty(key)) {
                return this._cache[key];
            }
            try {
                const val = await GM_getValue(key, defaultVal);
                this._cache[key] = val;
                return val;
            } catch (e) {
                console.warn('[YTKit Storage] Failed to get:', key, e);
                return defaultVal;
            }
        },

        async set(key, value) {
            this._cache[key] = value;
            this._dirty.add(key);
            this._scheduleSave();
        },

        _scheduleSave() {
            if (this._saveTimeout) return;
            this._saveTimeout = setTimeout(() => this._flush(), 500);
        },

        async _flush() {
            this._saveTimeout = null;
            const toSave = [...this._dirty];
            this._dirty.clear();
            for (const key of toSave) {
                try {
                    await GM_setValue(key, this._cache[key]);
                } catch (e) {
                    console.error('[YTKit Storage] Failed to save:', key, e);
                }
            }
        },

        async getSync(key, defaultVal = null) {
            try {
                return GM_getValue(key, defaultVal);
            } catch (e) {
                return defaultVal;
            }
        },

        setSync(key, value) {
            this._cache[key] = value;
            try {
                GM_setValue(key, value);
            } catch (e) {
                console.error('[YTKit Storage] Sync save failed:', key, e);
            }
        }
    };

    // Settings Migration System
    const SettingsMigration = {
        migrations: {
            // Migration from version 1 to 2
            1: (settings) => {
                // Rename old setting keys if needed
                if (settings.hideYouTubeShorts !== undefined) {
                    settings.removeAllShorts = settings.hideYouTubeShorts;
                    delete settings.hideYouTubeShorts;
                }
                return settings;
            },
            // Migration from version 2 to 3
            2: (settings) => {
                // Add keyboard shortcuts defaults if missing
                if (!settings.keyboardShortcuts) {
                    settings.keyboardShortcuts = {
                        openSettings: 'ctrl+alt+y',
                        hideVideo: 'shift+h',
                        downloadVideo: 'ctrl+shift+d'
                    };
                }
                return settings;
            }
        },

        async migrate(settings) {
            let currentVersion = settings._version || 1;
            let migrated = { ...settings };

            while (currentVersion < SETTINGS_VERSION) {
                const migrationFn = this.migrations[currentVersion];
                if (migrationFn) {
                    try {
                        migrated = migrationFn(migrated);
                        console.log(`[YTKit] Migrated settings from v${currentVersion} to v${currentVersion + 1}`);
                    } catch (e) {
                        console.error(`[YTKit] Migration ${currentVersion} failed:`, e);
                    }
                }
                currentVersion++;
            }

            migrated._version = SETTINGS_VERSION;
            return migrated;
        }
    };

    // Undo System for Video Hiding
    const UndoManager = {
        _stack: [],
        _maxItems: 10,

        push(action) {
            this._stack.push({
                ...action,
                timestamp: Date.now()
            });
            if (this._stack.length > this._maxItems) {
                this._stack.shift();
            }
        },

        pop() {
            return this._stack.pop();
        },

        peek() {
            return this._stack[this._stack.length - 1];
        },

        canUndo() {
            return this._stack.length > 0;
        },

        clear() {
            this._stack = [];
        }
    };

    // Keyboard Shortcuts Manager
    const KeyboardManager = {
        _shortcuts: new Map(),
        _enabled: true,
        _initialized: false,

        init() {
            if (this._initialized) return;
            this._initialized = true;

            document.addEventListener('keydown', (e) => {
                if (!this._enabled) return;
                // Don't trigger shortcuts when typing in inputs
                if (e.target.matches('input, textarea, [contenteditable]')) return;

                const combo = this._getCombo(e);
                const handler = this._shortcuts.get(combo);
                if (handler) {
                    e.preventDefault();
                    e.stopPropagation();
                    handler();
                }
            });
        },

        _getCombo(e) {
            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push('ctrl');
            if (e.altKey) parts.push('alt');
            if (e.shiftKey) parts.push('shift');
            parts.push(e.key.toLowerCase());
            return parts.join('+');
        },

        register(combo, handler, description = '') {
            const normalized = combo.toLowerCase().split('+').sort().join('+');
            this._shortcuts.set(normalized, handler);
        },

        unregister(combo) {
            const normalized = combo.toLowerCase().split('+').sort().join('+');
            this._shortcuts.delete(normalized);
        },

        setEnabled(enabled) {
            this._enabled = enabled;
        },

        getRegistered() {
            return [...this._shortcuts.keys()];
        }
    };

    // Debug Mode Manager
    const DebugManager = {
        _enabled: false,
        _logs: [],
        _maxLogs: 100,

        enable() {
            this._enabled = true;
            this._expose();
            console.log('[YTKit Debug] Debug mode enabled');
        },

        disable() {
            this._enabled = false;
            delete window.YTKit;
        },

        log(category, message, data = null) {
            if (!this._enabled) return;
            const entry = {
                time: new Date().toISOString(),
                category,
                message,
                data
            };
            this._logs.push(entry);
            if (this._logs.length > this._maxLogs) this._logs.shift();
            console.log(`[YTKit ${category}]`, message, data || '');
        },

        _expose() {
            window.YTKit = {
                version: '12.0',
                debug: this,
                getSettings: () => appState.settings,
                getFeatures: () => features.map(f => ({
                    id: f.id,
                    name: f.name,
                    enabled: !!appState.settings[f.id],
                    group: f.group
                })),
                getLogs: () => [...this._logs],
                clearLogs: () => { this._logs = []; },
                storage: StorageManager,
                undo: UndoManager,
                getCurrentPage: getCurrentPage,
                forceRefresh: () => location.reload(),
                resetSettings: async () => {
                    if (confirm('Reset all YTKit settings to defaults?')) {
                        await StorageManager.set('ytSuiteSettings', {});
                        location.reload();
                    }
                },
                exportDiagnostics: () => {
                    return JSON.stringify({
                        version: '10.0',
                        userAgent: navigator.userAgent,
                        url: location.href,
                        page: getCurrentPage(),
                        settings: appState.settings,
                        features: features.map(f => ({ id: f.id, enabled: !!appState.settings[f.id] })),
                        logs: this._logs
                    }, null, 2);
                }
            };
        }
    };

    // Statistics Tracker
    const StatsTracker = {
        _STORAGE_KEY: 'ytkit-statistics',
        _stats: null,
        _sessionStart: Date.now(),

        async load() {
            if (this._stats) return this._stats;
            this._stats = await StorageManager.get(this._STORAGE_KEY, {
                videosWatched: 0,
                videosHidden: 0,
                channelsBlocked: 0,
                sponsorTimeSkipped: 0,
                introOutroSkipped: 0,
                totalTimeOnYouTube: 0,
                downloadsInitiated: 0,
                vlcStreams: 0,
                firstUsed: Date.now(),
                lastUsed: Date.now(),
                sessionsCount: 0
            });
            this._stats.sessionsCount++;
            this._stats.lastUsed = Date.now();
            await this.save();
            return this._stats;
        },

        async save() {
            if (!this._stats) return;
            await StorageManager.set(this._STORAGE_KEY, this._stats);
        },

        async increment(stat, amount = 1) {
            await this.load();
            if (this._stats.hasOwnProperty(stat)) {
                this._stats[stat] += amount;
                await this.save();
            }
        },

        async get(stat) {
            await this.load();
            return this._stats[stat];
        },

        async getAll() {
            await this.load();
            // Add session time
            const sessionTime = Math.floor((Date.now() - this._sessionStart) / 1000);
            return {
                ...this._stats,
                currentSessionTime: sessionTime
            };
        },

        async reset() {
            this._stats = {
                videosWatched: 0,
                videosHidden: 0,
                channelsBlocked: 0,
                sponsorTimeSkipped: 0,
                introOutroSkipped: 0,
                totalTimeOnYouTube: 0,
                downloadsInitiated: 0,
                vlcStreams: 0,
                firstUsed: Date.now(),
                lastUsed: Date.now(),
                sessionsCount: 1
            };
            await this.save();
        },

        formatTime(seconds) {
            if (seconds < 60) return `${seconds}s`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
    };

    // Settings Profiles Manager
    const ProfilesManager = {
        _STORAGE_KEY: 'ytkit-profiles',
        _profiles: null,

        _builtInProfiles: {
            minimal: {
                name: 'Minimal',
                description: 'Clean, distraction-free experience',
                icon: 'minimize',
                settings: {
                    hideCreateButton: true, hideVoiceSearch: true, hideSidebar: true,
                    removeAllShorts: true, hideMerchShelf: true, hideVideoEndCards: true,
                    hideVideoEndScreen: true, hideHashtags: true, hidePinnedComments: true,
                    hideRelatedVideos: true, hideDescriptionExtras: true, hideInfoPanels: true
                }
            },
            privacy: {
                name: 'Privacy',
                description: 'Maximum privacy protection',
                icon: 'shield-off',
                settings: {
                    disablePlayOnHover: true, preventAutoplay: true, hideNotificationButton: true,
                    hideNotificationBadge: true, hideLiveChatEngagement: true, hidePaidPromotionWatch: true
                }
            },
            powerUser: {
                name: 'Power User',
                description: 'All productivity features enabled',
                icon: 'zap-off',
                settings: {
                    playbackSpeedPresets: true, rememberPlaybackSpeed: true,
                    showWatchProgress: true, timestampBookmarks: true, skipSponsors: true,
                    autoMaxResolution: true, autoExpandDescription: true, fiveVideosPerRow: true,
                    hideVideosFromHome: true, keyboardShortcutsFeature: true
                }
            },
            download: {
                name: 'Download Mode',
                description: 'All download buttons visible',
                icon: 'download',
                settings: {
                    showVlcButton: true, showVlcQueueButton: true, showLocalDownloadButton: true,
                    showTranscriptButton: true, videoContextMenu: true, replaceWithCobaltDownloader: true
                }
            },
            binge: {
                name: 'Binge Mode',
                description: 'Optimized for long viewing sessions',
                icon: 'tv',
                settings: {
                    autoTheaterMode: true, fitPlayerToWindow: true, hideRelatedVideos: false,
                    preventAutoplay: false, autoSkipStillWatching: true, skipSponsors: true,
                    autoSkipIntroOutro: true
                }
            }
        },

        async load() {
            if (this._profiles) return this._profiles;
            this._profiles = await StorageManager.get(this._STORAGE_KEY, {});
            return this._profiles;
        },

        async save() {
            if (!this._profiles) return;
            await StorageManager.set(this._STORAGE_KEY, this._profiles);
        },

        async getAll() {
            await this.load();
            return {
                builtIn: this._builtInProfiles,
                custom: this._profiles
            };
        },

        async saveCustomProfile(name, settings) {
            await this.load();
            this._profiles[name] = {
                name: name,
                description: 'Custom profile',
                icon: 'user-square',
                settings: { ...settings },
                createdAt: Date.now()
            };
            await this.save();
        },

        async deleteCustomProfile(name) {
            await this.load();
            delete this._profiles[name];
            await this.save();
        },

        async applyProfile(profileKey, isBuiltIn = true) {
            const profiles = isBuiltIn ? this._builtInProfiles : this._profiles;
            const profile = profiles[profileKey];
            if (!profile) return false;

            // Merge profile settings with current settings
            Object.assign(appState.settings, profile.settings);
            await settingsManager.save(appState.settings);
            return true;
        }
    };

    // Per-Channel Settings Manager
    const ChannelSettingsManager = {
        _STORAGE_KEY: 'ytkit-channel-settings',
        _settings: null,

        async load() {
            if (this._settings) return this._settings;
            this._settings = await StorageManager.get(this._STORAGE_KEY, {});
            return this._settings;
        },

        async save() {
            if (!this._settings) return;
            await StorageManager.set(this._STORAGE_KEY, this._settings);
        },

        async getForChannel(channelId) {
            await this.load();
            return this._settings[channelId] || null;
        },

        async setForChannel(channelId, settings) {
            await this.load();
            this._settings[channelId] = {
                ...this._settings[channelId],
                ...settings,
                updatedAt: Date.now()
            };
            await this.save();
        },

        async removeChannel(channelId) {
            await this.load();
            delete this._settings[channelId];
            await this.save();
        },

        async getAllChannels() {
            await this.load();
            return Object.entries(this._settings).map(([id, settings]) => ({
                id,
                ...settings
            }));
        },

        getCurrentChannelId() {
            // Try to extract channel ID from various sources
            const channelLink = document.querySelector('#owner #channel-name a, #upload-info #channel-name a, ytd-video-owner-renderer a');
            if (channelLink) {
                const href = channelLink.href;
                const match = href.match(/\/@([^\/\?]+)|\/channel\/([^\/\?]+)/);
                if (match) return match[1] || match[2];
            }
            return null;
        },

        getCurrentChannelName() {
            const channelName = document.querySelector('#owner #channel-name, #upload-info #channel-name, ytd-video-owner-renderer #channel-name');
            return channelName?.textContent?.trim() || null;
        }
    };

    // IntersectionObserver Helper for Performance
    const VisibilityObserver = {
        _observer: null,
        _callbacks: new Map(),
        _options: {
            root: null,
            rootMargin: '200px',
            threshold: 0
        },

        init() {
            if (this._observer) return;
            this._observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const callback = this._callbacks.get(entry.target);
                    if (callback) {
                        callback(entry.isIntersecting, entry);
                    }
                });
            }, this._options);
        },

        observe(element, callback) {
            this.init();
            this._callbacks.set(element, callback);
            this._observer.observe(element);
        },

        unobserve(element) {
            if (!this._observer) return;
            this._callbacks.delete(element);
            this._observer.unobserve(element);
        },

        disconnect() {
            if (this._observer) {
                this._observer.disconnect();
                this._callbacks.clear();
            }
        }
    };

    // ══════════════════════════════════════════════════════════════════════════
    //  Unified Tick Manager - Consolidates all intervals into single loop
    // ══════════════════════════════════════════════════════════════════════════
    const TickManager = {
        _handlers: new Map(),
        _running: false,
        _lastTick: 0,
        _frameId: null,

        register(id, callback, intervalMs) {
            this._handlers.set(id, {
                callback,
                interval: intervalMs,
                lastRun: 0
            });
            if (!this._running) this._start();
        },

        unregister(id) {
            this._handlers.delete(id);
            if (this._handlers.size === 0) this._stop();
        },

        _start() {
            if (this._running) return;
            this._running = true;
            this._tick();
        },

        _stop() {
            this._running = false;
            if (this._frameId) {
                cancelAnimationFrame(this._frameId);
                this._frameId = null;
            }
        },

        _tick() {
            if (!this._running) return;

            const now = performance.now();
            
            for (const [id, handler] of this._handlers) {
                if (now - handler.lastRun >= handler.interval) {
                    try {
                        handler.callback();
                    } catch (e) {
                        console.error(`[YTKit Tick] Error in ${id}:`, e);
                    }
                    handler.lastRun = now;
                }
            }

            this._frameId = requestAnimationFrame(() => this._tick());
        }
    };

    // Throttle utility for expensive operations
    function throttle(fn, limit) {
        let inThrottle = false;
        let lastArgs = null;
        
        return function(...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                    if (lastArgs) {
                        fn.apply(this, lastArgs);
                        lastArgs = null;
                    }
                }, limit);
            } else {
                lastArgs = args;
            }
        };
    }

    // Debounce utility
    function debounce(fn, delay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 0B: DYNAMIC CONTENT/STYLE ENGINE
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

    // Global toast notification function with optional action button
    function showToast(message, color = '#22c55e', options = {}) {
        // Remove existing toast if present
        document.querySelector('.ytkit-global-toast')?.remove();

        const toast = document.createElement('div');
        toast.className = 'ytkit-global-toast';
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
            display: flex;
            align-items: center;
            gap: 12px;
            animation: ytkit-toast-fade ${options.duration || 2.5}s ease-out forwards;
        `;

        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        toast.appendChild(textSpan);

        // Add action button if provided (e.g., for Undo)
        if (options.action) {
            const actionBtn = document.createElement('button');
            actionBtn.textContent = options.action.text || 'Undo';
            actionBtn.style.cssText = `
                background: rgba(255,255,255,0.2);
                border: 1px solid rgba(255,255,255,0.3);
                color: white;
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
            `;
            actionBtn.onmouseenter = () => { actionBtn.style.background = 'rgba(255,255,255,0.3)'; };
            actionBtn.onmouseleave = () => { actionBtn.style.background = 'rgba(255,255,255,0.2)'; };
            actionBtn.onclick = (e) => {
                e.stopPropagation();
                toast.remove();
                options.action.onClick?.();
            };
            toast.appendChild(actionBtn);
        }

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
        const duration = (options.duration || 2.5) * 1000;
        setTimeout(() => toast.remove(), duration);

        return toast;
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

        // Check if button exists AND is in a valid container (NOT in clarify-box)
        const existingBtn = document.querySelector(config.checkSelector);
        if (existingBtn) {
            // Verify it's actually in the action buttons area and NOT in the clarify-box info panel
            const parent = existingBtn.closest('#top-level-buttons-computed, .ytkit-button-container');
            const inClarifyBox = existingBtn.closest('#clarify-box, ytd-info-panel-container-renderer, ytd-clarification-renderer');
            if (parent && !inClarifyBox) {
                return true; // Button exists and is in correct container
            } else {
                // Button exists but is detached or in wrong container - remove it so we can re-add
                existingBtn.remove();
            }
        }

        // Try MANY possible parent selectors - YouTube changes these frequently
        // IMPORTANT: Exclude #clarify-box which has its own #top-level-buttons-computed
        const parentSelectors = [
            'ytd-watch-metadata #top-level-buttons-computed',
            '#actions #top-level-buttons-computed',
            '#actions-inner #top-level-buttons-computed',
            '#actions ytd-menu-renderer #top-level-buttons-computed',
            '#actions-inner #menu #top-level-buttons-computed',
            'ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed',
            '#below ytd-watch-metadata #top-level-buttons-computed',
            '#above-the-fold #top-level-buttons-computed',
            '#above-the-fold #actions ytd-menu-renderer',
            'ytd-watch-metadata #actions #menu',
            '#actions #menu',
            '#actions-inner #menu',
            '#actions ytd-menu-renderer',
            '#actions-inner ytd-menu-renderer',
            'ytd-watch-metadata #actions-inner',
            '#owner #actions',
            'ytd-watch-metadata ytd-menu-renderer',
            '#below #actions',
        ];

        let parent = null;
        let foundSelector = null;
        for (const sel of parentSelectors) {
            try {
                const candidate = document.querySelector(sel);
                // IMPORTANT: Skip if this element is inside the clarify-box info panel
                if (candidate && !candidate.closest('#clarify-box, ytd-info-panel-container-renderer, ytd-clarification-renderer')) {
                    parent = candidate;
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
            if (parent && !parent.closest('#clarify-box, ytd-info-panel-container-renderer')) {
                foundSelector = '.ytkit-button-container (existing)';
            } else {
                parent = null;
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
            // ═══ Interface ═══
            hideCreateButton: true,
            hideVoiceSearch: true,
            logoToSubscriptions: true,
            widenSearchBar: true,
            hideSidebar: true,
            hideNotificationButton: false,
            hideNotificationBadge: false,
            
            // ═══ Appearance ═══
            theme: 'betterDark',
            uiStyle: 'square',
            noAmbientMode: true,
            noFrostedGlass: true,
            compactLayout: true,
            
            // ═══ Content ═══
            removeAllShorts: true,
            redirectShorts: true,
            disablePlayOnHover: true,
            fullWidthSubscriptions: true,
            hideSubscriptionOptions: true,
            fiveVideosPerRow: true,
            hidePaidContentOverlay: true,
            redirectToVideosTab: true,
            hidePlayables: true,
            hideMembersOnly: true,
            hideNewsHome: true,
            hidePlaylistsHome: true,
            
            // ═══ Video Hider ═══
            hideVideosFromHome: true,
            hideVideosBlockChannels: true,
            hideVideosKeywordFilter: '',
            hideVideosDurationFilter: 0,
            hideVideosBlockedChannels: [],
            hideVideosSubsLoadLimit: true,
            hideVideosSubsLoadThreshold: 3,
            
            // ═══ Video Player ═══
            fitPlayerToWindow: true,
            hideRelatedVideos: true,
            adaptiveLiveLayout: true,
            expandVideoWidth: true,
            floatingLogoOnWatch: true,
            hideDescriptionRow: false,
            autoTheaterMode: false,
            persistentProgressBar: false,
            hideVideoEndContent: true,
            
            // ═══ Playback ═══
            preventAutoplay: false,
            autoExpandDescription: false,
            sortCommentsNewestFirst: false,
            autoOpenChapters: false,
            autoOpenTranscript: false,
            chronologicalNotifications: false,
            autoSkipStillWatching: true,
            
            // ═══ Playback Enhancements ═══
            playbackSpeedPresets: true,
            defaultPlaybackSpeed: 1,
            rememberPlaybackSpeed: false,
            showWatchProgress: true,
            timestampBookmarks: true,
            autoSkipIntroOutro: false,
            enablePerChannelSettings: true,
            
            // ═══ SponsorBlock ═══
            skipSponsors: true,
            hideSponsorBlockLabels: true,
            
            // ═══ Video Quality ═══
            autoMaxResolution: true,
            useEnhancedBitrate: true,
            hideQualityPopup: true,
            
            // ═══ Clutter ═══
            hideMerchShelf: true,
            hideInfoPanel: true,
            hideInfoPanels: true,
            hideDescriptionExtras: true,
            hideHashtags: true,
            hidePinnedComments: true,
            hideCommentActionMenu: false,
            condenseComments: true,
            hideLiveChatEngagement: true,
            hidePaidPromotionWatch: true,
            hideFundraiser: true,
            hideLatestPosts: false,
            
            // ═══ Live Chat - Consolidated into array ═══
            hiddenChatElements: [
                'header', 'menu', 'popout', 'reactions', 'timestamps',
                'polls', 'ticker', 'leaderboard', 'support', 'banner',
                'emoji', 'topFan', 'superChats', 'levelUp', 'bots'
            ],
            chatKeywordFilter: '',
            
            // ═══ Action Buttons - Consolidated into array ═══
            hiddenActionButtons: [
                'like', 'dislike', 'share', 'ask', 'clip', 
                'thanks', 'save', 'sponsor', 'moreActions'
            ],
            autolikeVideos: true,
            replaceWithCobaltDownloader: true,
            
            // ═══ Player Controls - Consolidated into array ═══
            hiddenPlayerControls: [
                'sponsorBlock', 'next', 'autoplay', 'subtitles',
                'captions', 'miniplayer', 'pip', 'theater', 'fullscreen'
            ],
            
            // ═══ Watch Page Elements ═══
            hiddenWatchElements: [],
            
            // ═══ Downloads ═══
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
            downloadQuality: 'best',
            preferredMediaPlayer: 'vlc',
            downloadProvider: 'cobalt',
            
            // ═══ Advanced ═══
            hideCollaborations: true,
            keyboardShortcuts: {
                openSettings: 'ctrl+alt+y',
                hideVideo: 'shift+h',
                downloadVideo: 'ctrl+shift+d'
            },
            debugMode: false,
            showStatisticsDashboard: true,
            customCssEnabled: false,
            customCssCode: '',
            useIntersectionObserver: true,
            _version: 3,
        },

        // Migration map for old settings to new
        _migrationMap: {
            // Theme consolidation
            'nativeDarkMode': (val, settings) => { if (val && !settings.betterDarkMode) settings.theme = 'dark'; },
            'betterDarkMode': (val, settings) => { if (val) settings.theme = 'betterDark'; },
            'catppuccinMocha': (val, settings) => { if (val) settings.theme = 'catppuccin'; },
            // UI style consolidation
            'squarify': (val, settings) => { if (val) settings.uiStyle = 'square'; },
            'squareAvatars': (val, settings) => { if (val) settings.uiStyle = 'square'; },
            'squareSearchBar': (val, settings) => { if (val) settings.uiStyle = 'square'; },
            // Video end consolidation
            'hideVideoEndCards': (val, settings) => { settings.hideVideoEndContent = val; },
            'hideVideoEndScreen': (val, settings) => { if (val) settings.hideVideoEndContent = true; },
            'hideEndVideoStills': (val, settings) => { if (val) settings.hideVideoEndContent = true; },
            // Info panel consolidation
            'hideClarifyBoxes': (val, settings) => { if (val) settings.hideInfoPanel = true; },
            // Regex filter consolidation
            'useRegexKeywordFilter': () => {}, // No longer needed - auto-detected
            'hideVideosRegexFilter': (val, settings) => { 
                if (val) settings.hideVideosKeywordFilter = val; 
            },
        },

        async load() {
            let savedSettings = await StorageManager.get('ytSuiteSettings', {});
            
            // Migrate old settings to new format
            savedSettings = this._migrateOldSettings(savedSettings);
            
            // Run version migrations if needed
            if (!savedSettings._version || savedSettings._version < SETTINGS_VERSION) {
                savedSettings = await SettingsMigration.migrate(savedSettings);
                await this.save(savedSettings);
            }
            return { ...this.defaults, ...savedSettings };
        },

        _migrateOldSettings(saved) {
            const migrated = { ...saved };
            
            // Migrate action buttons to array format
            if (saved.hideLikeButton !== undefined) {
                const hidden = [];
                if (saved.hideLikeButton) hidden.push('like');
                if (saved.hideDislikeButton) hidden.push('dislike');
                if (saved.hideShareButton) hidden.push('share');
                if (saved.hideAskButton) hidden.push('ask');
                if (saved.hideClipButton) hidden.push('clip');
                if (saved.hideThanksButton) hidden.push('thanks');
                if (saved.hideSaveButton) hidden.push('save');
                if (saved.hideSponsorButton) hidden.push('sponsor');
                if (saved.hideMoreActionsButton) hidden.push('moreActions');
                migrated.hiddenActionButtons = hidden;
                // Clean up old keys
                delete migrated.hideLikeButton; delete migrated.hideDislikeButton;
                delete migrated.hideShareButton; delete migrated.hideAskButton;
                delete migrated.hideClipButton; delete migrated.hideThanksButton;
                delete migrated.hideSaveButton; delete migrated.hideSponsorButton;
                delete migrated.hideMoreActionsButton;
            }
            
            // Migrate player controls to array format
            if (saved.hideSponsorBlockButton !== undefined) {
                const hidden = [];
                if (saved.hideSponsorBlockButton) hidden.push('sponsorBlock');
                if (saved.hideNextButton) hidden.push('next');
                if (saved.hideAutoplayToggle) hidden.push('autoplay');
                if (saved.hideSubtitlesToggle) hidden.push('subtitles');
                if (saved.hideCaptionsContainer) hidden.push('captions');
                if (saved.hideMiniplayerButton) hidden.push('miniplayer');
                if (saved.hidePipButton) hidden.push('pip');
                if (saved.hideTheaterButton) hidden.push('theater');
                if (saved.hideFullscreenButton) hidden.push('fullscreen');
                migrated.hiddenPlayerControls = hidden;
                // Clean up old keys
                delete migrated.hideSponsorBlockButton; delete migrated.hideNextButton;
                delete migrated.hideAutoplayToggle; delete migrated.hideSubtitlesToggle;
                delete migrated.hideCaptionsContainer; delete migrated.hideMiniplayerButton;
                delete migrated.hidePipButton; delete migrated.hideTheaterButton;
                delete migrated.hideFullscreenButton;
            }
            
            // Migrate chat elements to array format
            if (saved.hideLiveChatHeader !== undefined) {
                const hidden = [];
                if (saved.hideLiveChatHeader) hidden.push('header');
                if (saved.hideChatMenu) hidden.push('menu');
                if (saved.hidePopoutChatButton) hidden.push('popout');
                if (saved.hideChatReactionsButton) hidden.push('reactions');
                if (saved.hideChatTimestampsButton) hidden.push('timestamps');
                if (saved.hideChatPolls || saved.hideChatPollBanner) hidden.push('polls');
                if (saved.hideChatTicker) hidden.push('ticker');
                if (saved.hideViewerLeaderboard) hidden.push('leaderboard');
                if (saved.hideChatSupportButtons) hidden.push('support');
                if (saved.hideChatBanner) hidden.push('banner');
                if (saved.hideChatEmojiButton) hidden.push('emoji');
                if (saved.hideTopFanIcons) hidden.push('topFan');
                if (saved.hideSuperChats) hidden.push('superChats');
                if (saved.hideLevelUp) hidden.push('levelUp');
                if (saved.hideChatBots) hidden.push('bots');
                migrated.hiddenChatElements = hidden;
                migrated.chatKeywordFilter = saved.keywordFilterList || '';
                // Clean up old keys
                delete migrated.hideLiveChatHeader; delete migrated.hideChatMenu;
                delete migrated.hidePopoutChatButton; delete migrated.hideChatReactionsButton;
                delete migrated.hideChatTimestampsButton; delete migrated.hideChatPolls;
                delete migrated.hideChatPollBanner; delete migrated.hideChatTicker;
                delete migrated.hideViewerLeaderboard; delete migrated.hideChatSupportButtons;
                delete migrated.hideChatBanner; delete migrated.hideChatEmojiButton;
                delete migrated.hideTopFanIcons; delete migrated.hideSuperChats;
                delete migrated.hideLevelUp; delete migrated.hideChatBots;
                delete migrated.keywordFilterList;
            }
            
            // Apply other migrations
            for (const [oldKey, migrateFn] of Object.entries(this._migrationMap)) {
                if (saved[oldKey] !== undefined) {
                    migrateFn(saved[oldKey], migrated);
                    delete migrated[oldKey];
                }
            }
            
            // Remove returnYouTubeDislike completely
            delete migrated.returnYouTubeDislike;
            delete migrated.channelPlaybackSpeeds;
            
            return migrated;
        },

        async save(settings) {
            settings._version = SETTINGS_VERSION;
            await StorageManager.set('ytSuiteSettings', settings);
        },
        async getFirstRunStatus() {
            return await StorageManager.get('ytSuiteHasRun', false);
        },
        async setFirstRunStatus(hasRun) {
            await StorageManager.set('ytSuiteHasRun', hasRun);
        },
        async exportAllSettings() {
            const settings = await this.load();
            // Include hidden videos, blocked channels, and bookmarks in export
            let hiddenVideos = [];
            let blockedChannels = [];
            let bookmarks = {};
            try {
                hiddenVideos = await StorageManager.get('ytkit-hidden-videos', []);
                blockedChannels = await StorageManager.get('ytkit-blocked-channels', []);
                bookmarks = await StorageManager.get('ytkit-bookmarks', {});
            } catch(e) {
                console.warn('[YTKit] Failed to load data for export:', e);
            }
            const exportData = {
                settings: settings,
                hiddenVideos: hiddenVideos,
                blockedChannels: blockedChannels,
                bookmarks: bookmarks,
                exportVersion: 3,
                exportDate: new Date().toISOString(),
                ytkitVersion: '10.0'
            };
            return JSON.stringify(exportData, null, 2);
        },
        async importAllSettings(jsonString) {
            try {
                const importedData = JSON.parse(jsonString);
                if (typeof importedData !== 'object' || importedData === null) return false;

                // Handle different export versions
                let settings, hiddenVideos, blockedChannels, bookmarks;
                if (importedData.exportVersion >= 3) {
                    // Version 3 format with bookmarks
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                    bookmarks = importedData.bookmarks || {};
                } else if (importedData.exportVersion >= 2) {
                    // Version 2 format with hidden videos
                    settings = importedData.settings || {};
                    hiddenVideos = importedData.hiddenVideos || [];
                    blockedChannels = importedData.blockedChannels || [];
                    bookmarks = null;
                } else {
                    // Version 1 format - just settings object
                    settings = importedData;
                    hiddenVideos = null;
                    blockedChannels = null;
                    bookmarks = null;
                }

                const newSettings = { ...this.defaults, ...settings };
                await this.save(newSettings);

                // Import hidden videos, blocked channels, and bookmarks if present
                if (hiddenVideos !== null) {
                    await StorageManager.set('ytkit-hidden-videos', hiddenVideos);
                }
                if (blockedChannels !== null) {
                    await StorageManager.set('ytkit-blocked-channels', blockedChannels);
                }
                if (bookmarks !== null) {
                    await StorageManager.set('ytkit-bookmarks', bookmarks);
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
            // ═══ Consolidated Theme Feature ═══
            id: 'themeManager',
            name: 'Theme',
            description: 'Choose your preferred color theme',
            group: 'Appearance',
            icon: 'moon',
            type: 'select',
            options: {
                'system': 'System Default',
                'dark': 'Dark',
                'betterDark': 'Enhanced Dark',
                'catppuccin': 'Catppuccin Mocha'
            },
            settingKey: 'theme',
            _styleElement: null,
            _ruleId: 'themeManagerRule',
            
            init() {
                const theme = appState.settings.theme || 'betterDark';
                this._applyTheme(theme);
                addMutationRule(this._ruleId, () => this._applyTheme(theme));
            },
            
            _applyTheme(theme) {
                // Remove existing theme styles
                document.getElementById('ytkit-theme-style')?.remove();
                
                // Always force dark mode for non-system themes
                if (theme !== 'system') {
                    document.documentElement.setAttribute('dark', '');
                }
                
                // Apply specific theme CSS
                if (theme === 'betterDark') {
                    const customCss = GM_getResourceText('betterDarkMode');
                    if (customCss) {
                        const style = document.createElement('style');
                        style.id = 'ytkit-theme-style';
                        style.textContent = customCss;
                        document.head.appendChild(style);
                        this._styleElement = style;
                    }
                } else if (theme === 'catppuccin') {
                    const customCss = GM_getResourceText('catppuccinMocha');
                    if (customCss) {
                        const style = document.createElement('style');
                        style.id = 'ytkit-theme-style';
                        style.textContent = customCss;
                        document.head.appendChild(style);
                        this._styleElement = style;
                    }
                }
            },
            
            destroy() {
                document.documentElement.removeAttribute('dark');
                this._styleElement?.remove();
                document.getElementById('ytkit-theme-style')?.remove();
                removeMutationRule(this._ruleId);
            }
        },
        {
            // ═══ Consolidated UI Style Feature ═══
            id: 'uiStyleManager',
            name: 'UI Style',
            description: 'Choose rounded or square UI elements',
            group: 'Appearance',
            icon: 'square',
            type: 'select',
            options: {
                'rounded': 'Rounded (Default)',
                'square': 'Square'
            },
            settingKey: 'uiStyle',
            _styleElement: null,
            
            init() {
                const style = appState.settings.uiStyle || 'rounded';
                if (style === 'square') {
                    const css = `
                        * { border-radius: 0 !important; }
                        yt-img-shadow, #avatar-link, #author-thumbnail,
                        ytd-channel-avatar-editor img, yt-img-shadow img,
                        .yt-spec-avatar-shape--circle { border-radius: 0 !important; }
                    `;
                    this._styleElement = injectStyle(css, this.id, true);
                }
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
                        if (parent instanceof HTMLElement) parent.style.display = 'none';
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
            id: 'hideInfoPanels',
            name: 'Hide Info Panels',
            description: 'Remove Wikipedia/context info boxes that appear below videos (FEMA, COVID, etc.)',
            group: 'Content',
            icon: 'info-off',
            _styleElement: null,
            init() {
                const css = `
                    #clarify-box,
                    #clarify-box.attached-message,
                    ytd-info-panel-container-renderer,
                    ytd-watch-flexy #clarify-box,
                    ytd-watch-flexy ytd-info-panel-container-renderer,
                    ytd-clarification-renderer,
                    .ytd-info-panel-container-renderer {
                        display: none !important;
                    }
                `;
                this._styleElement = injectStyle(css, this.id, true);
            },
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
        // ═══ Watch Page Elements Hiding ═══
        {
            id: 'hiddenWatchElementsManager',
            name: 'Hide Watch Page Elements',
            description: 'Choose which elements to hide below videos',
            group: 'Content',
            icon: 'eye-off',
            type: 'multiSelect',
            settingKey: 'hiddenWatchElements',
            options: [
                { value: 'title', label: 'Video Title' },
                { value: 'views', label: 'View Count' },
                { value: 'date', label: 'Upload Date' },
                { value: 'channelAvatar', label: 'Channel Avatar' },
                { value: 'channelName', label: 'Channel Name' },
                { value: 'subCount', label: 'Subscriber Count' },
                { value: 'joinButton', label: 'Join Button' },
                { value: 'subscribeButton', label: 'Subscribe Button' },
                { value: 'likeDislike', label: 'Like/Dislike Buttons' },
                { value: 'shareButton', label: 'Share Button' },
                { value: 'askButton', label: 'Ask Button' },
                { value: 'saveButton', label: 'Save Button' },
                { value: 'moreActions', label: 'More Actions (...)' },
                { value: 'description', label: 'Description Box' },
                { value: 'askAISection', label: 'Ask AI Section (in description)' },
                { value: 'podcastSection', label: 'Podcast/Course Section' },
                { value: 'transcriptSection', label: 'Transcript Section' },
                { value: 'channelInfoCards', label: 'Channel Info Cards' }
            ],
            _styleElement: null,
            _ruleId: 'watchElementsHider',
            // CSS selectors for elements that can be hidden with pure CSS
            _cssSelectors: {
                title: 'ytd-watch-metadata #title',
                views: 'ytd-watch-info-text #view-count',
                date: 'ytd-watch-info-text #date-text',
                channelAvatar: 'ytd-video-owner-renderer #avatar',
                channelName: 'ytd-video-owner-renderer #channel-name',
                subCount: 'ytd-video-owner-renderer #owner-sub-count',
                joinButton: 'ytd-video-owner-renderer #sponsor-button',
                subscribeButton: 'ytd-watch-metadata #subscribe-button',
                likeDislike: 'segmented-like-dislike-button-view-model',
                description: 'ytd-watch-metadata #description',
                askAISection: 'yt-video-description-youchat-section-view-model',
                podcastSection: 'ytd-video-description-course-section-renderer',
                transcriptSection: 'ytd-video-description-transcript-section-renderer',
                channelInfoCards: 'ytd-video-description-infocards-section-renderer'
            },
            // Button aria-labels for JS-based hiding (find parent yt-button-view-model)
            _buttonAriaLabels: {
                shareButton: 'Share',
                askButton: 'Ask',
                saveButton: 'Save to playlist',
                moreActions: 'More actions'
            },
            _hideButtons() {
                const hidden = appState.settings.hiddenWatchElements || [];
                const metadata = document.querySelector('ytd-watch-metadata');
                if (!metadata) return;
                
                // Hide buttons by finding them via aria-label
                Object.entries(this._buttonAriaLabels).forEach(([key, ariaLabel]) => {
                    if (hidden.includes(key)) {
                        // Find button with this aria-label
                        const btn = metadata.querySelector(`button[aria-label="${ariaLabel}"]`);
                        if (btn) {
                            // Hide the parent yt-button-view-model or yt-button-shape
                            const parent = btn.closest('yt-button-view-model') || btn.closest('yt-button-shape');
                            // Validate parent is an actual HTMLElement (YouTube's Polymer can return Symbol objects)
                            if (parent instanceof HTMLElement && !parent.hasAttribute('ytkit-hidden')) {
                                parent.style.display = 'none';
                                parent.setAttribute('ytkit-hidden', key);
                            }
                        }
                    }
                });
            },
            init() {
                const hidden = appState.settings.hiddenWatchElements || [];
                if (hidden.length === 0) return;
                
                // Build CSS for elements that can use pure CSS hiding
                const cssSelectors = hidden
                    .filter(key => this._cssSelectors[key])
                    .map(key => this._cssSelectors[key])
                    .filter(Boolean);
                
                if (cssSelectors.length > 0) {
                    this._styleElement = injectStyle(cssSelectors.join(', '), this.id);
                }
                
                // Use mutation observer for button hiding (aria-label based)
                const hasButtonsToHide = hidden.some(key => this._buttonAriaLabels[key]);
                if (hasButtonsToHide) {
                    // Initial hide attempt
                    this._hideButtons();
                    
                    // Add mutation rule to catch dynamically loaded content
                    addMutationRule(this._ruleId, () => this._hideButtons());
                }
            },
            destroy() {
                this._styleElement?.remove();
                this._styleElement = null;
                removeMutationRule(this._ruleId);
                
                // Restore hidden buttons
                document.querySelectorAll('[ytkit-hidden]').forEach(el => {
                    if (!(el instanceof HTMLElement)) return;
                    el.style.display = '';
                    el.removeAttribute('ytkit-hidden');
                });
            }
        },
        {
            id: 'hideVideosFromHome',
            name: 'Video Hider',
            description: 'Hide videos/channels from feeds. Includes keyword filter, duration filter, and channel blocking.',
            group: 'Video Hider',
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

                // Clear any pending batch processing
                if (this._clearBatchBuffer) this._clearBatchBuffer();

                // Hide the continuation spinner/trigger to prevent more loading
                const continuations = document.querySelectorAll('ytd-continuation-item-renderer, #continuations, ytd-browse[page-subtype="subscriptions"] ytd-continuation-item-renderer');
                continuations.forEach(cont => {
                    if (!(cont instanceof HTMLElement)) return;
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
                    if (!(el instanceof HTMLElement)) return;
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
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('width', '24');
                svg.setAttribute('height', '24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', '#f59e0b');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '12');
                circle.setAttribute('cy', '12');
                circle.setAttribute('r', '10');
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '12');
                line1.setAttribute('y1', '8');
                line1.setAttribute('x2', '12');
                line1.setAttribute('y2', '12');
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '12');
                line2.setAttribute('y1', '16');
                line2.setAttribute('x2', '12.01');
                line2.setAttribute('y2', '16');
                svg.appendChild(circle);
                svg.appendChild(line1);
                svg.appendChild(line2);
                icon.appendChild(svg);

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
                // Push to UndoManager for extended undo capability
                UndoManager.push({
                    type: 'video-restore',
                    data: this._lastHidden
                });
                this._lastHidden = null;
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
            },

            // Public method to unhide a specific video by ID
            _unhideVideo(videoId) {
                const hidden = this._getHiddenVideos();
                const idx = hidden.indexOf(videoId);
                if (idx > -1) {
                    hidden.splice(idx, 1);
                    this._setHiddenVideos(hidden);
                    // Remove hidden class from any matching elements
                    document.querySelectorAll(`[data-ytkit-video-id="${videoId}"]`)?.forEach(el => {
                        el.classList.remove('ytkit-video-hidden');
                    });
                    this._processAllVideos(); // Refresh visibility
                    return true;
                }
                return false;
            },

            _showManager() {
                document.getElementById('ytkit-hide-toast')?.classList.remove('show');
                // Open main settings panel and switch to Video Hider tab
                document.body.classList.add('ytkit-panel-open');
                // Wait for panel to be visible then switch tab
                setTimeout(() => {
                    const navBtn = document.querySelector('.ytkit-nav-btn[data-tab="Video-Hider"]');
                    if (navBtn) navBtn.click();
                }, 100);
            },

            _closeManager() {
                // No longer needed - handled by main settings panel
            },

            _shouldHide(element) {
                const videoId = this._extractVideoId(element);
                if (videoId && this._getHiddenVideos().includes(videoId)) return true;
                const channelInfo = this._extractChannelInfo(element);
                if (channelInfo && this._getBlockedChannels().find(c => c.id === channelInfo.id)) return true;
                
                // Unified keyword/regex filter - auto-detects regex if starts with /
                const filterStr = (appState.settings.hideVideosKeywordFilter || '').trim();
                if (filterStr) {
                    const title = this._extractTitle(element);
                    
                    // Check if it's a regex pattern (starts with /)
                    if (filterStr.startsWith('/')) {
                        try {
                            const regexMatch = filterStr.match(/^\/(.+)\/([gimsuy]*)$/);
                            if (regexMatch) {
                                const regex = new RegExp(regexMatch[1], regexMatch[2]);
                                if (regex.test(title)) return true;
                            }
                        } catch (e) {
                            DebugManager.log('Regex', 'Invalid regex pattern', e.message);
                        }
                    } else {
                        // Plain comma-separated keywords
                        const keywords = filterStr.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
                        if (keywords.some(k => title.includes(k))) return true;
                    }
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
                `;
                this._styleElement = injectStyle(css, this.id, true);
                this._processAllVideos();
                const selectors = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer';

                // Debounce for batch tracking
                let batchBuffer = [];
                let batchTimeout = null;
                // Store reference for clearing when blocking
                this._clearBatchBuffer = () => {
                    batchBuffer = [];
                    if (batchTimeout) {
                        clearTimeout(batchTimeout);
                        batchTimeout = null;
                    }
                };

                const processBatch = () => {
                    if (batchBuffer.length > 0 && !this._subsLoadState.loadingBlocked) {
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
                let wasOnSubsPage = window.location.pathname === '/feed/subscriptions';
                const checkSubsPage = () => {
                    const isOnSubsPage = window.location.pathname === '/feed/subscriptions';
                    if (isOnSubsPage) {
                        // Only reset load state when ENTERING subscriptions page (not while staying on it)
                        if (!wasOnSubsPage) {
                            this._resetSubsLoadState();
                        }
                        setTimeout(() => this._createSubsHideAllButton(), 1000);
                    } else {
                        this._removeSubsHideAllButton();
                        this._removeLoadBlocker();
                    }
                    wasOnSubsPage = isOnSubsPage;
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
        // REMOVED: Return YouTube Dislike - API dependency removed for performance
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
            // ═══ Consolidated Video End Content Feature ═══
            id: 'hideVideoEndContent',
            name: 'Hide Video End Content',
            description: 'Remove end cards, end screen, and video grid when videos finish',
            group: 'Clutter',
            icon: 'square-x',
            _styleElement: null,
            init() {
                const css = `
                    .ytp-ce-element,
                    .ytp-endscreen-content,
                    div.ytp-fullscreen-grid-stills-container { display: none !important; }
                `;
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

        // ═══ Consolidated Live Chat Feature ═══
        {
            id: 'hiddenChatElementsManager',
            name: 'Hide Chat Elements',
            description: 'Choose which live chat elements to hide',
            group: 'Live Chat',
            icon: 'eye-off',
            type: 'multiSelect',
            settingKey: 'hiddenChatElements',
            options: [
                { value: 'header', label: 'Chat Header' },
                { value: 'menu', label: 'Chat Menu (...)' },
                { value: 'popout', label: 'Popout Button' },
                { value: 'reactions', label: 'Reactions' },
                { value: 'timestamps', label: 'Timestamps' },
                { value: 'polls', label: 'Polls & Poll Banner' },
                { value: 'ticker', label: 'Super Chat Ticker' },
                { value: 'leaderboard', label: 'Leaderboard' },
                { value: 'support', label: 'Support Buttons' },
                { value: 'banner', label: 'Chat Banner' },
                { value: 'emoji', label: 'Emoji Button' },
                { value: 'topFan', label: 'Fan Badges' },
                { value: 'superChats', label: 'Super Chats' },
                { value: 'levelUp', label: 'Level Up Messages' },
                { value: 'bots', label: 'Bot Messages' }
            ],
            _styleElement: null,
            _selectors: {
                header: 'yt-live-chat-header-renderer',
                menu: 'yt-live-chat-header-renderer #overflow',
                popout: 'yt-live-chat-header-renderer button[aria-label="Popout chat"]',
                reactions: 'yt-reaction-control-panel-overlay-view-model, yt-reaction-control-panel-view-model',
                timestamps: '#show-hide-button.ytd-live-chat-frame',
                polls: 'yt-live-chat-poll-renderer, yt-live-chat-banner-manager, yt-live-chat-action-panel-renderer:has(yt-live-chat-poll-renderer)',
                ticker: 'yt-live-chat-ticker-renderer',
                leaderboard: 'yt-live-chat-participant-list-renderer, yt-pdg-buy-flow-renderer',
                support: 'yt-live-chat-message-buy-flow-renderer, #product-picker, .yt-live-chat-message-input-renderer[id="picker-buttons"]',
                banner: 'yt-live-chat-banner-renderer',
                emoji: '#emoji-picker-button, yt-live-chat-message-input-renderer #picker-buttons yt-icon-button',
                topFan: 'yt-live-chat-author-badge-renderer[type="member"], yt-live-chat-author-badge-renderer[type="top-gifter"]',
                superChats: 'yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer',
                levelUp: 'yt-live-chat-viewer-engagement-message-renderer[engagement-type="VIEWER_ENGAGEMENT_MESSAGE_TYPE_LEVEL_UP"]'
            },
            init() {
                const hidden = appState.settings.hiddenChatElements || [];
                const selectors = hidden
                    .filter(key => key !== 'bots') // bots handled separately via mutation rule
                    .map(key => this._selectors[key])
                    .filter(Boolean)
                    .join(', ');
                
                if (selectors) {
                    this._styleElement = injectStyle(selectors, this.id);
                }
                
                // Bot filter uses mutation observer
                if (hidden.includes('bots')) {
                    addMutationRule('chatBotFilter', applyBotFilter);
                }
            },
            destroy() {
                this._styleElement?.remove();
                removeMutationRule('chatBotFilter');
            }
        },
        {
            id: 'chatKeywordFilter',
            name: 'Chat Keyword Filter',
            description: 'Hide chat messages containing these words (comma-separated)',
            group: 'Live Chat',
            icon: 'filter',
            type: 'textarea',
            settingKey: 'chatKeywordFilter',
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
        
        // ═══ Consolidated Action Buttons Feature ═══
        {
            id: 'hiddenActionButtonsManager',
            name: 'Hide Action Buttons',
            description: 'Choose which action buttons to hide below videos',
            group: 'Action Buttons',
            icon: 'eye-off',
            type: 'multiSelect',
            settingKey: 'hiddenActionButtons',
            options: [
                { value: 'like', label: 'Like Button' },
                { value: 'dislike', label: 'Dislike Button' },
                { value: 'share', label: 'Share Button' },
                { value: 'ask', label: 'Ask/AI Button' },
                { value: 'clip', label: 'Clip Button' },
                { value: 'thanks', label: 'Thanks Button' },
                { value: 'save', label: 'Save Button' },
                { value: 'sponsor', label: 'Join/Sponsor Button' },
                { value: 'moreActions', label: 'More Actions (...)' }
            ],
            _styleElement: null,
            _selectors: {
                like: 'ytd-segmented-like-dislike-button-renderer like-button-view-model, #segmented-like-button',
                dislike: 'ytd-segmented-like-dislike-button-renderer dislike-button-view-model, #segmented-dislike-button',
                share: 'ytd-watch-metadata button-view-model:has(button[aria-label="Share"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Share"])',
                ask: '#flexible-item-buttons yt-button-view-model:has(button[aria-label="Ask"]), ytd-watch-metadata button-view-model:has(button[aria-label*="AI"]), ytd-watch-metadata button-view-model:has(button[aria-label="Ask"]), conversational-ui-watch-metadata-button-view-model',
                clip: 'ytd-watch-metadata button-view-model:has(button[aria-label="Clip"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Clip"])',
                thanks: 'ytd-watch-metadata button-view-model:has(button[aria-label="Thanks"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Thanks"])',
                save: 'ytd-watch-metadata button-view-model:has(button[aria-label="Save to playlist"]), #top-level-buttons-computed ytd-button-renderer:has(button[aria-label="Save"])',
                sponsor: '#sponsor-button',
                moreActions: '#actions-inner #button-shape > button[aria-label="More actions"]'
            },
            init() {
                const hidden = appState.settings.hiddenActionButtons || [];
                const selectors = hidden.map(key => this._selectors[key]).filter(Boolean).join(', ');
                if (selectors) {
                    this._styleElement = injectStyle(selectors, this.id);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'replaceWithCobaltDownloader',
            name: 'Download Button',
            description: 'Add a download button using your chosen provider',
            group: 'Action Buttons',
            icon: 'download',
            _styleElement: null,
            _providers: {
                'cobalt': 'https://cobalt.meowing.de/#',
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

        // ═══ Consolidated Player Controls Feature ═══
        {
            id: 'hiddenPlayerControlsManager',
            name: 'Hide Player Controls',
            description: 'Choose which player control buttons to hide',
            group: 'Player Controls',
            icon: 'eye-off',
            type: 'multiSelect',
            settingKey: 'hiddenPlayerControls',
            options: [
                { value: 'sponsorBlock', label: 'SponsorBlock Button' },
                { value: 'next', label: 'Next Video Button' },
                { value: 'autoplay', label: 'Autoplay Toggle' },
                { value: 'subtitles', label: 'Subtitles Button' },
                { value: 'captions', label: 'Captions Display' },
                { value: 'miniplayer', label: 'Miniplayer Button' },
                { value: 'pip', label: 'Picture-in-Picture' },
                { value: 'theater', label: 'Theater Mode Button' },
                { value: 'fullscreen', label: 'Fullscreen Button' }
            ],
            _styleElement: null,
            _selectors: {
                sponsorBlock: '.ytp-sb-button, .ytp-sponsorblock-button',
                next: '.ytp-next-button',
                autoplay: '.ytp-autonav-toggle-button-container',
                subtitles: '.ytp-subtitles-button',
                captions: '.caption-window',
                miniplayer: '.ytp-miniplayer-button',
                pip: '.ytp-pip-button',
                theater: '.ytp-size-button',
                fullscreen: '.ytp-fullscreen-button'
            },
            init() {
                const hidden = appState.settings.hiddenPlayerControls || [];
                const selectors = hidden.map(key => this._selectors[key]).filter(Boolean).join(', ');
                if (selectors) {
                    this._styleElement = injectStyle(selectors, this.id);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        // Individual player control features removed - now consolidated in hiddenPlayerControlsManager

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
            id: 'downloadProvider',
            name: 'Download Provider',
            description: 'Choose which service to use for video downloads',
            group: 'Downloads',
            icon: 'download-cloud',
            type: 'select',
            options: {
                'cobalt': 'Cobalt (cobalt.meowing.de)',
                'y2mate': 'Y2Mate',
                'savefrom': 'SaveFrom.net',
                'ssyoutube': 'SSYouTube'
            },
            _providers: {
                'cobalt': 'https://cobalt.meowing.de/#',
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

                    // Parse XML using regex (CSP-safe, avoids TrustedHTML requirement)
                    const textRegex = /<text[^>]*start="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
                    const matches = [...transcriptXml.matchAll(textRegex)];

                    let transcript = '';
                    for (const match of matches) {
                        const startSeconds = parseFloat(match[1]);
                        const text = match[2]
                            .replace(/&#39;/g, "'")
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/<[^>]*>/g, '');

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

                    // Parse XML using regex (CSP-safe, avoids TrustedHTML requirement)
                    const textRegex = /<text[^>]*start="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
                    const matches = [...transcriptXml.matchAll(textRegex)];

                    let transcript = '';
                    for (const match of matches) {
                        const startSeconds = parseFloat(match[1]);
                        const text = match[2]
                            .replace(/&#39;/g, "'")
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/<[^>]*>/g, '');

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

        // ─── Advanced ───
        {
            id: 'debugMode',
            name: 'Debug Mode',
            description: 'Enable diagnostic logging and expose window.YTKit for troubleshooting',
            group: 'Advanced',
            icon: 'bug',
            init() {
                DebugManager.enable();
                DebugManager.log('Init', 'Debug mode enabled');
            },
            destroy() {
                DebugManager.disable();
            }
        },
        {
            id: 'keyboardShortcutsFeature',
            name: 'Keyboard Shortcuts',
            description: 'Enable custom keyboard shortcuts (Ctrl+Alt+Y for settings, Shift+H to hide video)',
            group: 'Advanced',
            icon: 'keyboard',
            init() {
                KeyboardManager.init();
                
                // Register default shortcuts
                const shortcuts = appState.settings.keyboardShortcuts || {};
                
                // Open settings panel
                if (shortcuts.openSettings) {
                    KeyboardManager.register(shortcuts.openSettings, () => {
                        document.body.classList.toggle('ytkit-panel-open');
                    }, 'Open YTKit Settings');
                }
                
                // Hide current video (only on watch page)
                if (shortcuts.hideVideo) {
                    KeyboardManager.register(shortcuts.hideVideo, () => {
                        if (!window.location.pathname.startsWith('/watch')) return;
                        const videoId = new URLSearchParams(window.location.search).get('v');
                        if (videoId) {
                            const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');
                            if (videoHiderFeature && typeof videoHiderFeature._hideVideo === 'function') {
                                const title = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata')?.textContent || 'Unknown';
                                const channelName = document.querySelector('#owner #channel-name, #upload-info #channel-name')?.textContent?.trim() || 'Unknown';
                                videoHiderFeature._hideVideo(videoId, title, channelName);
                                showToast('Video hidden (Shift+H)', '#ef4444', {
                                    duration: 4,
                                    action: {
                                        text: 'Undo',
                                        onClick: () => {
                                            if (typeof videoHiderFeature._unhideVideo === 'function') {
                                                videoHiderFeature._unhideVideo(videoId);
                                                showToast('Video restored', '#22c55e');
                                            }
                                        }
                                    }
                                });
                            }
                        }
                    }, 'Hide Current Video');
                }
                
                // Download video shortcut
                if (shortcuts.downloadVideo) {
                    KeyboardManager.register(shortcuts.downloadVideo, () => {
                        if (!window.location.pathname.startsWith('/watch')) return;
                        showToast('Starting download...', '#22c55e');
                        window.location.href = 'ytdl://' + encodeURIComponent(window.location.href);
                    }, 'Download Video');
                }
            },
            destroy() {
                const shortcuts = appState.settings.keyboardShortcuts || {};
                if (shortcuts.openSettings) KeyboardManager.unregister(shortcuts.openSettings);
                if (shortcuts.hideVideo) KeyboardManager.unregister(shortcuts.hideVideo);
                if (shortcuts.downloadVideo) KeyboardManager.unregister(shortcuts.downloadVideo);
            }
        },

        // ─── Auto-Skip "Still Watching?" Prompt ───
        {
            id: 'autoSkipStillWatching',
            name: 'Auto-Skip "Still Watching?"',
            description: 'Automatically dismiss the "Video paused. Continue watching?" popup',
            group: 'Playback',
            icon: 'skip-forward',
            _observer: null,
            _checkInterval: null,
            init() {
                const dismissPopup = () => {
                    // Look for the "Still watching?" / "Continue watching?" dialog
                    const confirmButton = document.querySelector(
                        'yt-confirm-dialog-renderer #confirm-button, ' +
                        '.ytp-pause-overlay-container button, ' +
                        'ytd-popup-container yt-confirm-dialog-renderer button.yt-spec-button-shape-next--filled, ' +
                        'tp-yt-paper-dialog #confirm-button, ' +
                        'ytd-enforcement-message-view-model button'
                    );
                    if (confirmButton) {
                        const dialogText = confirmButton.closest('yt-confirm-dialog-renderer, tp-yt-paper-dialog')?.textContent?.toLowerCase() || '';
                        if (dialogText.includes('still watching') || dialogText.includes('continue watching') || dialogText.includes('video paused')) {
                            confirmButton.click();
                            showToast('Auto-dismissed "Still watching?" popup', '#22c55e');
                            StatsTracker.increment('stillWatchingDismissed');
                            DebugManager.log('StillWatching', 'Dismissed popup');
                        }
                    }
                    
                    // Also check for the pause overlay
                    const pauseOverlay = document.querySelector('.ytp-pause-overlay');
                    if (pauseOverlay && pauseOverlay.style.display !== 'none') {
                        const playButton = document.querySelector('.ytp-play-button');
                        if (playButton) {
                            playButton.click();
                            showToast('Auto-resumed playback', '#22c55e');
                        }
                    }
                };

                // Check periodically
                this._checkInterval = setInterval(dismissPopup, 2000);

                // Also observe for new dialogs
                this._observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        if (mutation.addedNodes.length > 0) {
                            setTimeout(dismissPopup, 100);
                        }
                    }
                });

                this._observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            },
            destroy() {
                if (this._checkInterval) clearInterval(this._checkInterval);
                if (this._observer) this._observer.disconnect();
            }
        },

        // ─── Per-Channel Settings ───
        {
            id: 'enablePerChannelSettings',
            name: 'Per-Channel Settings',
            description: 'Remember playback speed, volume, and quality per channel',
            group: 'Playback',
            icon: 'users',
            _lastVideoId: null,
            init() {
                const applyChannelSettings = async () => {
                    if (!window.location.pathname.startsWith('/watch')) return;

                    const videoId = new URLSearchParams(window.location.search).get('v');
                    if (videoId === this._lastVideoId) return;
                    this._lastVideoId = videoId;

                    const channelId = ChannelSettingsManager.getCurrentChannelId();
                    if (!channelId) return;

                    const settings = await ChannelSettingsManager.getForChannel(channelId);
                    if (!settings) return;

                    const video = document.querySelector('video');
                    if (!video) return;

                    // Apply playback speed
                    if (settings.playbackSpeed && settings.playbackSpeed !== video.playbackRate) {
                        video.playbackRate = settings.playbackSpeed;
                        DebugManager.log('ChannelSettings', `Applied speed ${settings.playbackSpeed}x for channel ${channelId}`);
                    }

                    // Apply volume
                    if (settings.volume !== undefined && settings.volume !== video.volume) {
                        video.volume = settings.volume;
                    }
                };

                // Save current settings for channel
                const saveChannelSettings = async () => {
                    if (!window.location.pathname.startsWith('/watch')) return;

                    const channelId = ChannelSettingsManager.getCurrentChannelId();
                    const channelName = ChannelSettingsManager.getCurrentChannelName();
                    if (!channelId) return;

                    const video = document.querySelector('video');
                    if (!video) return;

                    await ChannelSettingsManager.setForChannel(channelId, {
                        name: channelName,
                        playbackSpeed: video.playbackRate,
                        volume: video.volume
                    });
                };

                // Apply on navigation
                addNavigateRule('perChannelSettings', () => {
                    setTimeout(applyChannelSettings, 1000);
                });

                // Save periodically when video is playing
                this._saveInterval = setInterval(() => {
                    const video = document.querySelector('video');
                    if (video && !video.paused) {
                        saveChannelSettings();
                    }
                }, 30000); // Save every 30 seconds while playing
            },
            destroy() {
                removeNavigateRule('perChannelSettings');
                if (this._saveInterval) clearInterval(this._saveInterval);
            }
        },

        // ─── Statistics Dashboard ───
        {
            id: 'showStatisticsDashboard',
            name: 'Statistics Dashboard',
            description: 'Track videos watched, time saved from sponsors, videos hidden, and more',
            group: 'Advanced',
            icon: 'bar-chart',
            init() {
                // Track video watches
                let lastVideoId = null;
                addNavigateRule('statsVideoWatch', () => {
                    if (!window.location.pathname.startsWith('/watch')) return;
                    const videoId = new URLSearchParams(window.location.search).get('v');
                    if (videoId && videoId !== lastVideoId) {
                        lastVideoId = videoId;
                        StatsTracker.increment('videosWatched');
                    }
                });

                // Update time on YouTube
                this._timeInterval = setInterval(() => {
                    StatsTracker.increment('totalTimeOnYouTube', 60); // Add 60 seconds
                }, 60000);
            },
            destroy() {
                removeNavigateRule('statsVideoWatch');
                if (this._timeInterval) clearInterval(this._timeInterval);
            }
        },

        // ─── Regex Keyword Filter ───
        {
            id: 'useRegexKeywordFilter',
            name: 'Regex Keyword Filter',
            description: 'Use regular expressions for advanced keyword filtering (e.g., /\\[.*\\]/ to hide bracketed titles)',
            group: 'Video Hider',
            icon: 'filter',
            subFeatureOf: 'hideVideosFromHome',
            init() {
                // This modifies the behavior of hideVideosFromHome
                // The actual regex matching is handled in _shouldHide
            },
            destroy() {
                // Nothing to clean up
            }
        },

        // ─── Custom CSS Injection ───
        {
            id: 'customCssEnabled',
            name: 'Custom CSS',
            description: 'Inject your own custom CSS rules for advanced customization',
            group: 'Appearance',
            icon: 'palette',
            _styleElement: null,
            init() {
                const css = appState.settings.customCssCode || '';
                if (css.trim()) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = 'ytkit-custom-css';
                    this._styleElement.textContent = css;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() {
                this._styleElement?.remove();
                this._styleElement = null;
            },
            updateCss(newCss) {
                if (this._styleElement) {
                    this._styleElement.textContent = newCss;
                } else if (newCss.trim()) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = 'ytkit-custom-css';
                    this._styleElement.textContent = newCss;
                    document.head.appendChild(this._styleElement);
                }
            }
        },
        {
            id: 'customCssCode',
            name: 'Custom CSS Code',
            description: 'Enter your CSS rules here (applied when Custom CSS is enabled)',
            group: 'Appearance',
            icon: 'code',
            type: 'textarea',
            placeholder: '/* Your custom CSS */\n.ytp-chrome-bottom { opacity: 0.8; }',
            init() {},
            destroy() {}
        },

        // ─── IntersectionObserver Performance Mode ───
        {
            id: 'useIntersectionObserver',
            name: 'Performance Mode',
            description: 'Use IntersectionObserver to only process visible videos (improves performance on long feeds)',
            group: 'Advanced',
            icon: 'gauge',
            init() {
                VisibilityObserver.init();
                
                // Add CSS containment for better rendering performance
                const style = document.createElement('style');
                style.id = 'ytkit-performance-css';
                style.textContent = `
                    ytd-rich-item-renderer,
                    ytd-video-renderer,
                    ytd-grid-video-renderer,
                    ytd-compact-video-renderer {
                        contain: content;
                    }
                    
                    ytd-thumbnail {
                        contain: strict;
                    }
                `;
                document.head.appendChild(style);
                this._styleElement = style;
            },
            destroy() {
                VisibilityObserver.disconnect();
                this._styleElement?.remove();
            }
        },

        // ─── Settings Profiles ───
        {
            id: 'settingsProfiles',
            name: 'Settings Profiles',
            description: 'Save and load different configurations (Minimal, Privacy, Power User, Download Mode, Binge)',
            group: 'Advanced',
            icon: 'list-tree',
            init() {
                // Profiles are managed through the settings panel UI
                // This feature just enables the functionality
            },
            destroy() {
                // Nothing to clean up
            }
        },
    ];

    // ══════════════════════════════════════════════════════════════════════════
    //  HELPER: Channel Settings Dialog
    // ══════════════════════════════════════════════════════════════════════════
    function showChannelSettingsDialog(channelId, channelName, existingSettings) {
        // Remove existing dialog
        document.getElementById('ytkit-channel-dialog')?.remove();

        const dialog = document.createElement('div');
        dialog.id = 'ytkit-channel-dialog';
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 24px;
            z-index: 999999;
            min-width: 350px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.5);
            font-family: "Roboto", Arial, sans-serif;
            color: #e2e8f0;
        `;

        const currentSpeed = existingSettings?.playbackSpeed || 1;
        const currentVolume = existingSettings?.volume !== undefined ? Math.round(existingSettings.volume * 100) : 100;

        TrustedHTML.setHTML(dialog, `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 600;">Channel Settings</h3>
                <button id="ytkit-channel-close" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 20px;">&times;</button>
            </div>
            <p style="color: #94a3b8; margin-bottom: 20px; font-size: 14px;">Settings for: <strong style="color: #60a5fa;">${channelName || channelId}</strong></p>
            
            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #94a3b8;">Playback Speed</label>
                <select id="ytkit-channel-speed" style="width: 100%; padding: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 14px;">
                    <option value="0.25" ${currentSpeed === 0.25 ? 'selected' : ''}>0.25x</option>
                    <option value="0.5" ${currentSpeed === 0.5 ? 'selected' : ''}>0.5x</option>
                    <option value="0.75" ${currentSpeed === 0.75 ? 'selected' : ''}>0.75x</option>
                    <option value="1" ${currentSpeed === 1 ? 'selected' : ''}>1x (Normal)</option>
                    <option value="1.25" ${currentSpeed === 1.25 ? 'selected' : ''}>1.25x</option>
                    <option value="1.5" ${currentSpeed === 1.5 ? 'selected' : ''}>1.5x</option>
                    <option value="1.75" ${currentSpeed === 1.75 ? 'selected' : ''}>1.75x</option>
                    <option value="2" ${currentSpeed === 2 ? 'selected' : ''}>2x</option>
                </select>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #94a3b8;">Default Volume: <span id="ytkit-vol-display">${currentVolume}%</span></label>
                <input type="range" id="ytkit-channel-volume" min="0" max="100" value="${currentVolume}" style="width: 100%; accent-color: #60a5fa;">
            </div>
            
            <div style="display: flex; gap: 12px;">
                <button id="ytkit-channel-save" style="flex: 1; padding: 12px; background: #3b82f6; border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; transition: background 0.2s;">Save</button>
                <button id="ytkit-channel-reset" style="flex: 1; padding: 12px; background: #334155; border: none; border-radius: 8px; color: #e2e8f0; font-weight: 600; cursor: pointer; transition: background 0.2s;">Reset</button>
            </div>
        `);

        // Add backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'ytkit-channel-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 999998;
        `;
        backdrop.onclick = () => {
            dialog.remove();
            backdrop.remove();
        };

        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);

        // Volume display update
        const volumeSlider = dialog.querySelector('#ytkit-channel-volume');
        const volDisplay = dialog.querySelector('#ytkit-vol-display');
        volumeSlider.oninput = () => {
            volDisplay.textContent = volumeSlider.value + '%';
        };

        // Close button
        dialog.querySelector('#ytkit-channel-close').onclick = () => {
            dialog.remove();
            backdrop.remove();
        };

        // Save button
        dialog.querySelector('#ytkit-channel-save').onclick = async () => {
            const speed = parseFloat(dialog.querySelector('#ytkit-channel-speed').value);
            const volume = parseInt(volumeSlider.value) / 100;
            
            await ChannelSettingsManager.setForChannel(channelId, {
                name: channelName,
                playbackSpeed: speed,
                volume: volume
            });

            // Apply immediately
            const video = document.querySelector('video');
            if (video) {
                video.playbackRate = speed;
                video.volume = volume;
            }

            showToast(`Settings saved for ${channelName}`, '#22c55e');
            dialog.remove();
            backdrop.remove();
        };

        // Reset button
        dialog.querySelector('#ytkit-channel-reset').onclick = async () => {
            await ChannelSettingsManager.removeChannel(channelId);
            showToast(`Settings reset for ${channelName}`, '#f97316');
            dialog.remove();
            backdrop.remove();
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HELPER: Statistics Dashboard Builder
    // ══════════════════════════════════════════════════════════════════════════
    async function buildStatisticsDashboard() {
        const stats = await StatsTracker.getAll();
        
        const container = document.createElement('div');
        container.className = 'ytkit-stats-dashboard';
        TrustedHTML.setHTML(container, `
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
                <div class="ytkit-stat-card">
                    <div class="ytkit-stat-value">${stats.videosWatched || 0}</div>
                    <div class="ytkit-stat-label">Videos Watched</div>
                </div>
                <div class="ytkit-stat-card">
                    <div class="ytkit-stat-value">${stats.videosHidden || 0}</div>
                    <div class="ytkit-stat-label">Videos Hidden</div>
                </div>
                <div class="ytkit-stat-card">
                    <div class="ytkit-stat-value">${stats.channelsBlocked || 0}</div>
                    <div class="ytkit-stat-label">Channels Blocked</div>
                </div>
                <div class="ytkit-stat-card">
                    <div class="ytkit-stat-value">${StatsTracker.formatTime(stats.sponsorTimeSkipped || 0)}</div>
                    <div class="ytkit-stat-label">Sponsor Time Skipped</div>
                </div>
                <div class="ytkit-stat-card">
                    <div class="ytkit-stat-value">${stats.downloadsInitiated || 0}</div>
                    <div class="ytkit-stat-label">Downloads</div>
                </div>
                <div class="ytkit-stat-card">
                    <div class="ytkit-stat-value">${stats.vlcStreams || 0}</div>
                    <div class="ytkit-stat-label">VLC Streams</div>
                </div>
                <div class="ytkit-stat-card" style="grid-column: span 2;">
                    <div class="ytkit-stat-value">${StatsTracker.formatTime(stats.totalTimeOnYouTube || 0)}</div>
                    <div class="ytkit-stat-label">Total Time on YouTube</div>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="ytkit-stats-reset" style="flex: 1; padding: 8px; background: #334155; border: none; border-radius: 6px; color: #94a3b8; cursor: pointer; font-size: 12px;">Reset Statistics</button>
            </div>
        `);

        container.querySelector('.ytkit-stats-reset').onclick = async () => {
            if (confirm('Reset all statistics? This cannot be undone.')) {
                await StatsTracker.reset();
                showToast('Statistics reset', '#f97316');
                // Refresh the dashboard
                const parent = container.parentElement;
                container.remove();
                parent?.appendChild(await buildStatisticsDashboard());
            }
        };

        return container;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HELPER: Profiles Manager UI
    // ══════════════════════════════════════════════════════════════════════════
    async function buildProfilesUI() {
        const profiles = await ProfilesManager.getAll();
        
        const container = document.createElement('div');
        container.className = 'ytkit-profiles-ui';
        
        let html = '<div style="margin-bottom: 16px;"><h4 style="margin: 0 0 12px 0; color: #94a3b8; font-size: 13px; text-transform: uppercase;">Built-in Profiles</h4>';
        
        // Built-in profiles
        for (const [key, profile] of Object.entries(profiles.builtIn)) {
            html += `
                <div class="ytkit-profile-item" data-profile="${key}" data-builtin="true" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; cursor: pointer; transition: background 0.2s;">
                    <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #334155, #1e293b); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #60a5fa;"></div>
                    <div style="flex: 1;">
                        <div style="font-weight: 500; color: #e2e8f0;">${profile.name}</div>
                        <div style="font-size: 12px; color: #64748b;">${profile.description}</div>
                    </div>
                    <button class="ytkit-profile-apply" style="padding: 6px 12px; background: #3b82f6; border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer;">Apply</button>
                </div>
            `;
        }
        
        html += '</div>';
        
        // Custom profiles section
        html += '<div style="margin-bottom: 16px;"><h4 style="margin: 0 0 12px 0; color: #94a3b8; font-size: 13px; text-transform: uppercase;">Custom Profiles</h4>';
        
        if (Object.keys(profiles.custom).length === 0) {
            html += '<p style="color: #64748b; font-size: 13px; margin: 0;">No custom profiles yet.</p>';
        } else {
            for (const [key, profile] of Object.entries(profiles.custom)) {
                html += `
                    <div class="ytkit-profile-item" data-profile="${key}" data-builtin="false" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px;">
                        <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #334155, #1e293b); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #a78bfa;"></div>
                        <div style="flex: 1;">
                            <div style="font-weight: 500; color: #e2e8f0;">${profile.name}</div>
                            <div style="font-size: 12px; color: #64748b;">${profile.description}</div>
                        </div>
                        <button class="ytkit-profile-apply" style="padding: 6px 12px; background: #3b82f6; border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer;">Apply</button>
                        <button class="ytkit-profile-delete" style="padding: 6px 12px; background: #ef4444; border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer;">Delete</button>
                    </div>
                `;
            }
        }
        
        html += '</div>';
        
        // Save current as profile button
        html += `
            <button id="ytkit-save-profile" style="width: 100%; padding: 12px; background: #334155; border: none; border-radius: 8px; color: #e2e8f0; font-weight: 500; cursor: pointer; transition: background 0.2s;">
                Save Current Settings as Profile
            </button>
        `;
        
        TrustedHTML.setHTML(container, html);
        
        // Event listeners
        container.querySelectorAll('.ytkit-profile-apply').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const item = btn.closest('.ytkit-profile-item');
                const profileKey = item.dataset.profile;
                const isBuiltIn = item.dataset.builtin === 'true';
                
                if (confirm(`Apply the "${profileKey}" profile? This will change your current settings.`)) {
                    await ProfilesManager.applyProfile(profileKey, isBuiltIn);
                    showToast(`Profile "${profileKey}" applied! Refreshing...`, '#22c55e');
                    setTimeout(() => location.reload(), 1000);
                }
            };
        });
        
        container.querySelectorAll('.ytkit-profile-delete').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const item = btn.closest('.ytkit-profile-item');
                const profileKey = item.dataset.profile;
                
                if (confirm(`Delete the "${profileKey}" profile?`)) {
                    await ProfilesManager.deleteCustomProfile(profileKey);
                    showToast(`Profile "${profileKey}" deleted`, '#f97316');
                    // Refresh profiles UI
                    const parent = container.parentElement;
                    container.remove();
                    parent?.appendChild(await buildProfilesUI());
                }
            };
        });
        
        container.querySelector('#ytkit-save-profile').onclick = async () => {
            const name = prompt('Enter a name for this profile:');
            if (name && name.trim()) {
                await ProfilesManager.saveCustomProfile(name.trim(), appState.settings);
                showToast(`Profile "${name}" saved`, '#22c55e');
                // Refresh profiles UI
                const parent = container.parentElement;
                container.remove();
                parent?.appendChild(await buildProfilesUI());
            }
        };
        
        return container;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HELPER: Bulk Operations for Hidden Videos
    // ══════════════════════════════════════════════════════════════════════════
    function addBulkOperationsUI(container) {
        const bulkBar = document.createElement('div');
        bulkBar.className = 'ytkit-bulk-bar';
        bulkBar.style.cssText = `
            display: none;
            padding: 12px;
            background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%);
            border-radius: 8px;
            margin-bottom: 12px;
            align-items: center;
            gap: 12px;
        `;
        TrustedHTML.setHTML(bulkBar, `
            <span class="ytkit-bulk-count" style="color: #60a5fa; font-weight: 500;">0 selected</span>
            <div style="flex: 1;"></div>
            <button class="ytkit-bulk-unhide" style="padding: 6px 12px; background: #22c55e; border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer;">Unhide Selected</button>
            <button class="ytkit-bulk-cancel" style="padding: 6px 12px; background: #64748b; border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer;">Cancel</button>
        `);
        
        container.insertBefore(bulkBar, container.firstChild);
        
        let selectedItems = new Set();
        
        const updateBulkBar = () => {
            bulkBar.style.display = selectedItems.size > 0 ? 'flex' : 'none';
            bulkBar.querySelector('.ytkit-bulk-count').textContent = `${selectedItems.size} selected`;
        };
        
        bulkBar.querySelector('.ytkit-bulk-cancel').onclick = () => {
            selectedItems.clear();
            container.querySelectorAll('.ytkit-item-checkbox').forEach(cb => cb.checked = false);
            updateBulkBar();
        };
        
        bulkBar.querySelector('.ytkit-bulk-unhide').onclick = () => {
            if (selectedItems.size === 0) return;
            
            const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');
            if (videoHiderFeature) {
                selectedItems.forEach(id => {
                    if (typeof videoHiderFeature._unhideVideo === 'function') {
                        videoHiderFeature._unhideVideo(id);
                    }
                });
                showToast(`Unhid ${selectedItems.size} videos`, '#22c55e');
                selectedItems.clear();
                updateBulkBar();
                
                // Trigger refresh of the list
                container.dispatchEvent(new CustomEvent('ytkit-refresh-list'));
            }
        };
        
        return {
            addCheckbox: (item, id) => {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'ytkit-item-checkbox';
                checkbox.style.cssText = 'margin-right: 8px; accent-color: #60a5fa;';
                checkbox.onchange = () => {
                    if (checkbox.checked) {
                        selectedItems.add(id);
                    } else {
                        selectedItems.delete(id);
                    }
                    updateBulkBar();
                };
                item.insertBefore(checkbox, item.firstChild);
            },
            selectAll: () => {
                container.querySelectorAll('.ytkit-item-checkbox').forEach(cb => {
                    cb.checked = true;
                    const id = cb.closest('[data-video-id]')?.dataset.videoId;
                    if (id) selectedItems.add(id);
                });
                updateBulkBar();
            },
            deselectAll: () => {
                selectedItems.clear();
                container.querySelectorAll('.ytkit-item-checkbox').forEach(cb => cb.checked = false);
                updateBulkBar();
            }
        };
    }

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
        const keywordsRaw = appState.settings.chatKeywordFilter;
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

        // ─── Additional Feature Icons ───
        'eye-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bell-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M13.73 21a2 2 0 0 1-3.46 0' },
            { type: 'path', d: 'M18.63 13A17.89 17.89 0 0 1 18 8' },
            { type: 'path', d: 'M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14' },
            { type: 'path', d: 'M18 8a6 6 0 0 0-9.33-5' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bell-minus': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' },
            { type: 'path', d: 'M13.73 21a2 2 0 0 1-3.46 0' },
            { type: 'line', x1: 8, y1: 2, x2: 16, y2: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'moon': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'sun-dim': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 4 },
            { type: 'path', d: 'M12 4h.01M12 20h.01M4 12h.01M20 12h.01M6.34 6.34h.01M17.66 6.34h.01M6.34 17.66h.01M17.66 17.66h.01' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'contrast': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'path', d: 'M12 2v20' },
            { type: 'path', d: 'M12 2a10 10 0 0 1 0 20', fill: 'currentColor' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'palette': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 13.5, cy: 6.5, r: 0.5, fill: 'currentColor' },
            { type: 'circle', cx: 17.5, cy: 10.5, r: 0.5, fill: 'currentColor' },
            { type: 'circle', cx: 8.5, cy: 7.5, r: 0.5, fill: 'currentColor' },
            { type: 'circle', cx: 6.5, cy: 12.5, r: 0.5, fill: 'currentColor' },
            { type: 'path', d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'square': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'user-square': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'circle', cx: 12, cy: 10, r: 3 },
            { type: 'path', d: 'M7 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'droplet-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2v5' },
            { type: 'path', d: 'M6.8 11.2A6 6 0 0 0 12 22a6 6 0 0 0 5.3-8.8' },
            { type: 'path', d: 'M12 2l3.5 5.5' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'minimize': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 3v3a2 2 0 0 1-2 2H3' },
            { type: 'path', d: 'M21 8h-3a2 2 0 0 1-2-2V3' },
            { type: 'path', d: 'M3 16h3a2 2 0 0 1 2 2v3' },
            { type: 'path', d: 'M16 21v-3a2 2 0 0 1 2-2h3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'video-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8' },
            { type: 'path', d: 'M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'external-link': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
            { type: 'polyline', points: '15 3 21 3 21 9' },
            { type: 'line', x1: 10, y1: 14, x2: 21, y2: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pause': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 6, y: 4, width: 4, height: 16 },
            { type: 'rect', x: 14, y: 4, width: 4, height: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'maximize': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 3H5a2 2 0 0 0-2 2v3' },
            { type: 'path', d: 'M21 8V5a2 2 0 0 0-2-2h-3' },
            { type: 'path', d: 'M3 16v3a2 2 0 0 0 2 2h3' },
            { type: 'path', d: 'M16 21h3a2 2 0 0 0 2-2v-3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'layout': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 3, y1: 9, x2: 21, y2: 9 },
            { type: 'line', x1: 9, y1: 21, x2: 9, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'grid': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 7, height: 7 },
            { type: 'rect', x: 14, y: 3, width: 7, height: 7 },
            { type: 'rect', x: 14, y: 14, width: 7, height: 7 },
            { type: 'rect', x: 3, y: 14, width: 7, height: 7 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'badge': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'info-off': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 12, y1: 16, x2: 12, y2: 12 },
            { type: 'line', x1: 12, y1: 8, x2: 12.01, y2: 8 },
            { type: 'line', x1: 4, y1: 4, x2: 20, y2: 20 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'folder-video': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' },
            { type: 'polygon', points: '10 13 15 10.5 10 8 10 13' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'gamepad': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 6, y1: 12, x2: 10, y2: 12 },
            { type: 'line', x1: 8, y1: 10, x2: 8, y2: 14 },
            { type: 'line', x1: 15, y1: 13, x2: 15.01, y2: 13 },
            { type: 'line', x1: 18, y1: 11, x2: 18.01, y2: 11 },
            { type: 'rect', x: 2, y: 6, width: 20, height: 12, rx: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'lock': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 11, width: 18, height: 11, rx: 2 },
            { type: 'path', d: 'M7 11V7a5 5 0 0 1 10 0v4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'newspaper': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2' },
            { type: 'path', d: 'M18 14h-8M15 18h-5M10 6h8v4h-8V6Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'list-x': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 11, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 11, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 11, y1: 18, x2: 21, y2: 18 },
            { type: 'line', x1: 3, y1: 4, x2: 7, y2: 8 },
            { type: 'line', x1: 7, y1: 4, x2: 3, y2: 8 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'fullscreen': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '15 3 21 3 21 9' },
            { type: 'polyline', points: '9 21 3 21 3 15' },
            { type: 'polyline', points: '21 15 21 21 15 21' },
            { type: 'polyline', points: '3 9 3 3 9 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'panel-right': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 15, y1: 3, x2: 15, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'arrows-horizontal': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '18 8 22 12 18 16' },
            { type: 'polyline', points: '6 8 2 12 6 16' },
            { type: 'line', x1: 2, y1: 12, x2: 22, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'cast': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6' },
            { type: 'path', d: 'M2 12a9 9 0 0 1 8 8' },
            { type: 'path', d: 'M2 16a5 5 0 0 1 4 4' },
            { type: 'line', x1: 2, y1: 20, x2: 2.01, y2: 20 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'youtube': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z' },
            { type: 'polygon', points: '9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'file-minus': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 9, y1: 15, x2: 15, y2: 15 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'tv': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 7, width: 20, height: 15, rx: 2 },
            { type: 'polyline', points: '17 2 12 7 7 2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'align-horizontal-justify-center': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 5, width: 6, height: 14, rx: 2 },
            { type: 'rect', x: 16, y: 7, width: 6, height: 10, rx: 2 },
            { type: 'line', x1: 12, y1: 2, x2: 12, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pause-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 10, y1: 15, x2: 10, y2: 9 },
            { type: 'line', x1: 14, y1: 15, x2: 14, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'chevrons-down': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '7 13 12 18 17 13' },
            { type: 'polyline', points: '7 6 12 11 17 6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'plus-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 12, y1: 8, x2: 12, y2: 16 },
            { type: 'line', x1: 8, y1: 12, x2: 16, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'mic-off': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 },
            { type: 'path', d: 'M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6' },
            { type: 'path', d: 'M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23' },
            { type: 'line', x1: 12, y1: 19, x2: 12, y2: 23 },
            { type: 'line', x1: 8, y1: 23, x2: 16, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'home': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
            { type: 'polyline', points: '9 22 9 12 15 12 15 22' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'sidebar': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 9, y1: 3, x2: 9, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'skip-forward': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 4 15 12 5 20 5 4' },
            { type: 'line', x1: 19, y1: 5, x2: 19, y2: 19 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'thumbs-up': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'play-circle': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'polygon', points: '10 8 16 12 10 16 10 8' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'monitor': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'line', x1: 8, y1: 21, x2: 16, y2: 21 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'monitor-play': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 3, width: 20, height: 14, rx: 2 },
            { type: 'polygon', points: '10 8 15 10 10 12 10 8' },
            { type: 'line', x1: 8, y1: 21, x2: 16, y2: 21 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'menu': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 3, y1: 12, x2: 21, y2: 12 },
            { type: 'line', x1: 3, y1: 6, x2: 21, y2: 6 },
            { type: 'line', x1: 3, y1: 18, x2: 21, y2: 18 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'hash': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 4, y1: 9, x2: 20, y2: 9 },
            { type: 'line', x1: 4, y1: 15, x2: 20, y2: 15 },
            { type: 'line', x1: 10, y1: 3, x2: 8, y2: 21 },
            { type: 'line', x1: 16, y1: 3, x2: 14, y2: 21 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'file-text': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 16, y1: 13, x2: 8, y2: 13 },
            { type: 'line', x1: 16, y1: 17, x2: 8, y2: 17 },
            { type: 'polyline', points: '10 9 9 9 8 9' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'info': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'line', x1: 12, y1: 16, x2: 12, y2: 12 },
            { type: 'line', x1: 12, y1: 8, x2: 12.01, y2: 8 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'link': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' },
            { type: 'path', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'music': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M9 18V5l12-2v13' },
            { type: 'circle', cx: 6, cy: 18, r: 3 },
            { type: 'circle', cx: 18, cy: 16, r: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'hard-drive-download': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M12 2v8' },
            { type: 'path', d: 'm16 6-4 4-4-4' },
            { type: 'rect', x: 2, y: 14, width: 20, height: 8, rx: 2 },
            { type: 'line', x1: 6, y1: 18, x2: 6.01, y2: 18 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'zap-off': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '12.41 6.75 13 2 10.57 4.92' },
            { type: 'polyline', points: '18.57 12.91 21 10 15.66 10' },
            { type: 'polyline', points: '8 8 3 14 12 14 11 22 16 16' },
            { type: 'line', x1: 1, y1: 1, x2: 23, y2: 23 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'trophy': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6' },
            { type: 'path', d: 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18' },
            { type: 'path', d: 'M4 22h16' },
            { type: 'path', d: 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22' },
            { type: 'path', d: 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22' },
            { type: 'path', d: 'M18 2H6v7a6 6 0 0 0 12 0V2Z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'trending-up': () => createSVG('0 0 24 24', [
            { type: 'polyline', points: '23 6 13.5 15.5 8.5 10.5 1 18' },
            { type: 'polyline', points: '17 6 23 6 23 12' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'timer': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 14, r: 8 },
            { type: 'line', x1: 12, y1: 14, x2: 12, y2: 10 },
            { type: 'line', x1: 12, y1: 2, x2: 12, y2: 4 },
            { type: 'line', x1: 8, y1: 2, x2: 16, y2: 2 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'ticket': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z' },
            { type: 'path', d: 'M13 5v2' },
            { type: 'path', d: 'M13 17v2' },
            { type: 'path', d: 'M13 11v2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'users': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
            { type: 'circle', cx: 9, cy: 7, r: 4 },
            { type: 'path', d: 'M23 21v-2a4 4 0 0 0-3-3.87' },
            { type: 'path', d: 'M16 3.13a4 4 0 0 1 0 7.75' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'users-x': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' },
            { type: 'circle', cx: 9, cy: 7, r: 4 },
            { type: 'line', x1: 18, y1: 8, x2: 23, y2: 13 },
            { type: 'line', x1: 23, y1: 8, x2: 18, y2: 13 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'award': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 8, r: 6 },
            { type: 'path', d: 'M15.477 12.89 17 22l-5-3-5 3 1.523-9.11' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bar-chart': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 12, y1: 20, x2: 12, y2: 10 },
            { type: 'line', x1: 18, y1: 20, x2: 18, y2: 4 },
            { type: 'line', x1: 6, y1: 20, x2: 6, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bell-ring': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' },
            { type: 'path', d: 'M13.73 21a2 2 0 0 1-3.46 0' },
            { type: 'path', d: 'M2 8c0-2.2.7-4.3 2-6' },
            { type: 'path', d: 'M22 8a10 10 0 0 0-2-6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bot': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 11, width: 18, height: 10, rx: 2 },
            { type: 'circle', cx: 12, cy: 5, r: 2 },
            { type: 'path', d: 'M12 7v4' },
            { type: 'line', x1: 8, y1: 16, x2: 8, y2: 16 },
            { type: 'line', x1: 16, y1: 16, x2: 16, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'captions-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.5 5H19a2 2 0 0 1 2 2v8.5' },
            { type: 'path', d: 'M17 11h-.5' },
            { type: 'path', d: 'M19 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2' },
            { type: 'path', d: 'M2 2 22 22' },
            { type: 'path', d: 'M7 11h4' },
            { type: 'path', d: 'M7 15h2.5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'clapperboard': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8H4Z' },
            { type: 'path', d: 'm4 11-.88-2.87a2 2 0 0 1 1.33-2.5l11.48-3.5a2 2 0 0 1 2.5 1.32l.87 2.87L4 11.01Z' },
            { type: 'path', d: 'm6.6 4.99 3.38 4.2' },
            { type: 'path', d: 'm11.86 3.38 3.38 4.2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'clock': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'polyline', points: '12 6 12 12 16 14' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'dollar-sign': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 12, y1: 2, x2: 12, y2: 22 },
            { type: 'path', d: 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'download-cloud': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' },
            { type: 'path', d: 'M12 12v9' },
            { type: 'path', d: 'm8 17 4 4 4-4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'filter': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'file-x': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
            { type: 'polyline', points: '14 2 14 8 20 8' },
            { type: 'line', x1: 9.5, y1: 12.5, x2: 14.5, y2: 17.5 },
            { type: 'line', x1: 14.5, y1: 12.5, x2: 9.5, y2: 17.5 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'flag-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 2c3 0 5 2 8 2s4-1 4-1v11' },
            { type: 'path', d: 'M4 22V4' },
            { type: 'path', d: 'M4 15s1-1 4-1 5 2 8 2' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'gift': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 8, width: 18, height: 4, rx: 1 },
            { type: 'path', d: 'M12 8v13' },
            { type: 'path', d: 'M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7' },
            { type: 'path', d: 'M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'heart': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'heart-off': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 },
            { type: 'path', d: 'M16.5 16.5 12 21l-7-7c-1.5-1.45-3-3.2-3-5.5a5.5 5.5 0 0 1 2.14-4.35' },
            { type: 'path', d: 'M8.76 3.1c1.15.22 2.13.78 3.24 1.9 1.5-1.5 2.74-2 4.5-2A5.5 5.5 0 0 1 22 8.5c0 2.12-1.3 3.78-2.67 5.17' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'layout-grid': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 1 },
            { type: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'list-tree': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 12h-8' },
            { type: 'path', d: 'M21 6H8' },
            { type: 'path', d: 'M21 18h-8' },
            { type: 'path', d: 'M3 6v4c0 1.1.9 2 2 2h3' },
            { type: 'path', d: 'M3 10v6c0 1.1.9 2 2 2h3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'megaphone-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M9.26 9.26 3 11v3l14.14 3.14' },
            { type: 'path', d: 'M21 15.34V6l-7.31 2.03' },
            { type: 'path', d: 'M11.6 16.8a3 3 0 1 1-5.8-1.6' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'message-circle-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M20.5 14.9A9 9 0 0 0 9.1 3.5' },
            { type: 'path', d: 'M5.5 5.5A9 9 0 0 0 3 12c0 .78.1 1.53.28 2.25a9 9 0 0 0 .61 1.6l-1.7 5.47a.5.5 0 0 0 .61.63l5.58-1.48c.48.27.99.49 1.52.66' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'message-square': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'message-square-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M21 15V5a2 2 0 0 0-2-2H9' },
            { type: 'path', d: 'M3 3l18 18' },
            { type: 'path', d: 'M3 6v15l4-4h5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'more-horizontal': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 1 },
            { type: 'circle', cx: 19, cy: 12, r: 1 },
            { type: 'circle', cx: 5, cy: 12, r: 1 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'more-vertical': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 1 },
            { type: 'circle', cx: 12, cy: 5, r: 1 },
            { type: 'circle', cx: 12, cy: 19, r: 1 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'panel-top': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 3, y1: 9, x2: 21, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'picture-in-picture': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'rect', x: 12, y: 12, width: 8, height: 6 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pip': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'rect', x: 12, y: 12, width: 8, height: 6 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'pin-off': () => createSVG('0 0 24 24', [
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 },
            { type: 'line', x1: 12, y1: 17, x2: 12, y2: 22 },
            { type: 'path', d: 'M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12' },
            { type: 'path', d: 'M15 9.34V6h1a2 2 0 0 0 0-4H7.89' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'play': () => createSVG('0 0 24 24', [
            { type: 'polygon', points: '5 3 19 12 5 21 5 3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'repeat': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'm17 2 4 4-4 4' },
            { type: 'path', d: 'M3 11v-1a4 4 0 0 1 4-4h14' },
            { type: 'path', d: 'm7 22-4-4 4-4' },
            { type: 'path', d: 'M21 13v1a4 4 0 0 1-4 4H3' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'scissors': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 6, cy: 6, r: 3 },
            { type: 'circle', cx: 6, cy: 18, r: 3 },
            { type: 'line', x1: 20, y1: 4, x2: 8.12, y2: 15.88 },
            { type: 'line', x1: 14.47, y1: 14.48, x2: 20, y2: 20 },
            { type: 'line', x1: 8.12, y1: 8.12, x2: 12, y2: 12 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'scroll-text': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4' },
            { type: 'path', d: 'M19 17V5a2 2 0 0 0-2-2H4' },
            { type: 'path', d: 'M15 8h-5' },
            { type: 'path', d: 'M15 12h-5' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'settings-2': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M20 7h-9' },
            { type: 'path', d: 'M14 17H5' },
            { type: 'circle', cx: 17, cy: 17, r: 3 },
            { type: 'circle', cx: 7, cy: 7, r: 3 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'share': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 18, cy: 5, r: 3 },
            { type: 'circle', cx: 6, cy: 12, r: 3 },
            { type: 'circle', cx: 18, cy: 19, r: 3 },
            { type: 'line', x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 },
            { type: 'line', x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'shield-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M19.7 14a6.9 6.9 0 0 0 .3-2V5l-8-3-3.2 1.2' },
            { type: 'path', d: 'M4.7 4.7 4 5v7c0 6 8 10 8 10a20.3 20.3 0 0 0 5.62-4.38' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'shopping-bag': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z' },
            { type: 'line', x1: 3, y1: 6, x2: 21, y2: 6 },
            { type: 'path', d: 'M16 10a4 4 0 0 1-8 0' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'smile': () => createSVG('0 0 24 24', [
            { type: 'circle', cx: 12, cy: 12, r: 10 },
            { type: 'path', d: 'M8 14s1.5 2 4 2 4-2 4-2' },
            { type: 'line', x1: 9, y1: 9, x2: 9.01, y2: 9 },
            { type: 'line', x1: 15, y1: 9, x2: 15.01, y2: 9 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'smile-plus': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M22 11v1a10 10 0 1 1-9-10' },
            { type: 'path', d: 'M8 14s1.5 2 4 2 4-2 4-2' },
            { type: 'line', x1: 9, y1: 9, x2: 9.01, y2: 9 },
            { type: 'line', x1: 15, y1: 9, x2: 15.01, y2: 9 },
            { type: 'path', d: 'M16 5h6' },
            { type: 'path', d: 'M19 2v6' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'sparkles': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'm12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z' },
            { type: 'path', d: 'M5 3v4' },
            { type: 'path', d: 'M19 17v4' },
            { type: 'path', d: 'M3 5h4' },
            { type: 'path', d: 'M17 19h4' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'square-x': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
            { type: 'line', x1: 9, y1: 9, x2: 15, y2: 15 },
            { type: 'line', x1: 15, y1: 9, x2: 9, y2: 15 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'subtitles': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'line', x1: 6, y1: 12, x2: 9, y2: 12 },
            { type: 'line', x1: 6, y1: 16, x2: 13, y2: 16 },
            { type: 'line', x1: 12, y1: 12, x2: 18, y2: 12 },
            { type: 'line', x1: 16, y1: 16, x2: 18, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'tag-off': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M10.02 2.03 2.03 10.02a2 2 0 0 0 0 2.83l8.12 8.12a2 2 0 0 0 2.83 0l8.01-8.01a2.02 2.02 0 0 0 .38-2.29' },
            { type: 'path', d: 'M7.5 7.5a.5.5 0 1 0 1 0 .5.5 0 1 0-1 0Z' },
            { type: 'path', d: 'M21.95 12.05 12.05 21.95' },
            { type: 'line', x1: 2, y1: 2, x2: 22, y2: 22 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        // Keyboard/debug icons
        'keyboard': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 2, y: 4, width: 20, height: 16, rx: 2 },
            { type: 'line', x1: 6, y1: 8, x2: 6, y2: 8 },
            { type: 'line', x1: 10, y1: 8, x2: 10, y2: 8 },
            { type: 'line', x1: 14, y1: 8, x2: 14, y2: 8 },
            { type: 'line', x1: 18, y1: 8, x2: 18, y2: 8 },
            { type: 'line', x1: 8, y1: 12, x2: 8, y2: 12 },
            { type: 'line', x1: 12, y1: 12, x2: 12, y2: 12 },
            { type: 'line', x1: 16, y1: 12, x2: 16, y2: 12 },
            { type: 'line', x1: 7, y1: 16, x2: 17, y2: 16 }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'bug': () => createSVG('0 0 24 24', [
            { type: 'rect', x: 8, y: 6, width: 8, height: 14, rx: 4 },
            { type: 'path', d: 'M19 7l-3 2' },
            { type: 'path', d: 'M5 7l3 2' },
            { type: 'path', d: 'M19 19l-3-2' },
            { type: 'path', d: 'M5 19l3-2' },
            { type: 'path', d: 'M20 13h-4' },
            { type: 'path', d: 'M4 13h4' },
            { type: 'path', d: 'M10 4l1 2' },
            { type: 'path', d: 'M14 4l-1 2' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),

        'undo': () => createSVG('0 0 24 24', [
            { type: 'path', d: 'M3 7v6h6' },
            { type: 'path', d: 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13' }
        ], { strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    };

    const CATEGORY_CONFIG = {
        'Interface': { icon: 'interface', color: '#60a5fa' },
        'Appearance': { icon: 'appearance', color: '#f472b6' },
        'Content': { icon: 'content', color: '#34d399' },
        'Video Hider': { icon: 'eye-off', color: '#ef4444' },
        'Video Player': { icon: 'player', color: '#a78bfa' },
        'Playback': { icon: 'playback', color: '#fb923c' },
        'SponsorBlock': { icon: 'sponsor', color: '#22d3ee' },
        'Quality': { icon: 'quality', color: '#facc15' },
        'Clutter': { icon: 'clutter', color: '#f87171' },
        'Live Chat': { icon: 'livechat', color: '#4ade80' },
        'Action Buttons': { icon: 'actions', color: '#c084fc' },
        'Player Controls': { icon: 'controls', color: '#38bdf8' },
        'Downloads': { icon: 'downloads', color: '#f97316' },
        'Advanced': { icon: 'advanced', color: '#94a3b8' },
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

        const categoryOrder = ['Interface', 'Appearance', 'Content', 'Video Hider', 'Video Player', 'Playback', 'SponsorBlock', 'Quality', 'Clutter', 'Live Chat', 'Action Buttons', 'Player Controls', 'Downloads', 'Advanced'];
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

        // Divider
        const divider = document.createElement('div');
        divider.className = 'ytkit-sidebar-divider';
        sidebar.appendChild(divider);

        categoryOrder.forEach((cat, index) => {
            // Special handling for Video Hider
            if (cat === 'Video Hider') {
                const config = CATEGORY_CONFIG[cat];
                const catId = cat.replace(/ /g, '-');
                const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');
                const videoCount = (typeof videoHiderFeature?._getHiddenVideos === 'function' ? videoHiderFeature._getHiddenVideos() : []).length;
                const channelCount = (typeof videoHiderFeature?._getBlockedChannels === 'function' ? videoHiderFeature._getBlockedChannels() : []).length;

                const btn = document.createElement('button');
                btn.className = 'ytkit-nav-btn';
                btn.dataset.tab = catId;

                const iconWrap = document.createElement('span');
                iconWrap.className = 'ytkit-nav-icon';
                iconWrap.style.setProperty('--cat-color', config.color);
                const iconFn = ICONS['eye-off'] || ICONS.settings;
                iconWrap.appendChild(iconFn());

                const labelSpan = document.createElement('span');
                labelSpan.className = 'ytkit-nav-label';
                labelSpan.textContent = cat;

                const countSpan = document.createElement('span');
                countSpan.className = 'ytkit-nav-count';
                countSpan.textContent = `${videoCount + channelCount}`;
                countSpan.title = `${videoCount} videos, ${channelCount} channels`;

                const arrowSpan = document.createElement('span');
                arrowSpan.className = 'ytkit-nav-arrow';
                arrowSpan.appendChild(ICONS.chevronRight());

                btn.appendChild(iconWrap);
                btn.appendChild(labelSpan);
                btn.appendChild(countSpan);
                btn.appendChild(arrowSpan);

                sidebar.appendChild(btn);
                return;
            }

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

        // Special builder for Video Hider pane
        function buildVideoHiderPane(config) {
            const videoHiderFeature = features.find(f => f.id === 'hideVideosFromHome');

            const pane = document.createElement('section');
            pane.id = 'ytkit-pane-Video-Hider';
            pane.className = 'ytkit-pane ytkit-vh-pane';

            // Pane header
            const paneHeader = document.createElement('div');
            paneHeader.className = 'ytkit-pane-header';

            const paneTitle = document.createElement('div');
            paneTitle.className = 'ytkit-pane-title';

            const paneIcon = document.createElement('span');
            paneIcon.className = 'ytkit-pane-icon';
            paneIcon.style.setProperty('--cat-color', config.color);
            const paneIconFn = ICONS['eye-off'] || ICONS.settings;
            paneIcon.appendChild(paneIconFn());

            const paneTitleH2 = document.createElement('h2');
            paneTitleH2.textContent = 'Video Hider';

            paneTitle.appendChild(paneIcon);
            paneTitle.appendChild(paneTitleH2);

            // Enable toggle for Video Hider
            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'ytkit-toggle-all';
            toggleLabel.style.marginLeft = 'auto';

            const toggleText = document.createElement('span');
            toggleText.textContent = 'Enabled';

            const toggleSwitch = document.createElement('div');
            toggleSwitch.className = 'ytkit-switch' + (appState.settings.hideVideosFromHome ? ' active' : '');

            const toggleInput = document.createElement('input');
            toggleInput.type = 'checkbox';
            toggleInput.id = 'ytkit-toggle-hideVideosFromHome';
            toggleInput.checked = appState.settings.hideVideosFromHome;
            toggleInput.onchange = async () => {
                appState.settings.hideVideosFromHome = toggleInput.checked;
                toggleSwitch.classList.toggle('active', toggleInput.checked);
                await settingsManager.save(appState.settings);
                if (toggleInput.checked) {
                    videoHiderFeature?.init?.();
                } else {
                    videoHiderFeature?.destroy?.();
                }
                updateAllToggleStates();
            };

            const toggleTrack = document.createElement('span');
            toggleTrack.className = 'ytkit-switch-track';

            toggleSwitch.appendChild(toggleInput);
            toggleSwitch.appendChild(toggleTrack);
            toggleLabel.appendChild(toggleText);
            toggleLabel.appendChild(toggleSwitch);

            paneHeader.appendChild(paneTitle);
            paneHeader.appendChild(toggleLabel);
            pane.appendChild(paneHeader);

            // Tab navigation
            const tabNav = document.createElement('div');
            tabNav.className = 'ytkit-vh-tabs';
            tabNav.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--ytkit-border);margin-bottom:20px;';

            const tabs = ['Videos', 'Channels', 'Keywords', 'Settings'];
            tabs.forEach((tabName, i) => {
                const tab = document.createElement('button');
                tab.className = 'ytkit-vh-tab' + (i === 0 ? ' active' : '');
                tab.dataset.tab = tabName.toLowerCase();
                tab.textContent = tabName;
                tab.style.cssText = `
                    flex:1;padding:12px 16px;background:transparent;border:none;
                    color:var(--ytkit-text-muted);font-size:13px;font-weight:500;
                    cursor:pointer;transition:all 0.2s;border-bottom:2px solid transparent;
                `;
                tab.onmouseenter = () => { if (!tab.classList.contains('active')) tab.style.color = 'var(--ytkit-text-secondary)'; };
                tab.onmouseleave = () => { if (!tab.classList.contains('active')) tab.style.color = 'var(--ytkit-text-muted)'; };
                tab.onclick = () => {
                    tabNav.querySelectorAll('.ytkit-vh-tab').forEach(t => {
                        t.classList.remove('active');
                        t.style.color = 'var(--ytkit-text-muted)';
                        t.style.borderBottomColor = 'transparent';
                    });
                    tab.classList.add('active');
                    tab.style.color = config.color;
                    tab.style.borderBottomColor = config.color;
                    renderTabContent(tabName.toLowerCase());
                };
                if (i === 0) {
                    tab.style.color = config.color;
                    tab.style.borderBottomColor = config.color;
                }
                tabNav.appendChild(tab);
            });
            pane.appendChild(tabNav);

            // Tab content container
            const tabContent = document.createElement('div');
            tabContent.id = 'ytkit-vh-content';
            pane.appendChild(tabContent);

            function renderTabContent(tab) {
                while (tabContent.firstChild) tabContent.removeChild(tabContent.firstChild);

                if (tab === 'videos') {
                    const videos = videoHiderFeature?._getHiddenVideos() || [];
                    if (videos.length === 0) {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--ytkit-text-muted);';

                        const emptyIcon = document.createElement('div');
                        emptyIcon.style.cssText = 'font-size:48px;margin-bottom:16px;opacity:0.5;';
                        emptyIcon.textContent = '📺';

                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:15px;margin-bottom:8px;';
                        emptyTitle.textContent = 'No hidden videos yet';

                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:13px;opacity:0.7;';
                        emptyDesc.textContent = 'Click the X button on video thumbnails to hide them';

                        empty.appendChild(emptyIcon);
                        empty.appendChild(emptyTitle);
                        empty.appendChild(emptyDesc);
                        tabContent.appendChild(empty);
                    } else {
                        const grid = document.createElement('div');
                        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;';

                        videos.forEach(vid => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;background:var(--ytkit-bg-surface);border-radius:8px;border:1px solid var(--ytkit-border);';

                            const thumb = document.createElement('img');
                            thumb.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
                            thumb.style.cssText = 'width:100px;height:56px;object-fit:cover;border-radius:4px;flex-shrink:0;';
                            thumb.onerror = () => { thumb.style.background = 'var(--ytkit-bg-elevated)'; };

                            const info = document.createElement('div');
                            info.style.cssText = 'flex:1;min-width:0;';
                            const vidId = document.createElement('div');
                            vidId.style.cssText = 'font-size:12px;color:var(--ytkit-text-secondary);font-family:monospace;margin-bottom:4px;';
                            vidId.textContent = vid;
                            const link = document.createElement('a');
                            link.href = `https://youtube.com/watch?v=${vid}`;
                            link.target = '_blank';
                            link.style.cssText = 'font-size:12px;color:var(--ytkit-accent);text-decoration:none;';
                            link.textContent = 'View on YouTube →';
                            info.appendChild(vidId);
                            info.appendChild(link);

                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unhide';
                            removeBtn.style.cssText = 'padding:6px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);color:var(--ytkit-text-secondary);border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s;';
                            removeBtn.onmouseenter = () => { removeBtn.style.background = '#dc2626'; removeBtn.style.color = '#fff'; removeBtn.style.borderColor = '#dc2626'; };
                            removeBtn.onmouseleave = () => { removeBtn.style.background = 'var(--ytkit-bg-elevated)'; removeBtn.style.color = 'var(--ytkit-text-secondary)'; removeBtn.style.borderColor = 'var(--ytkit-border)'; };
                            removeBtn.onclick = () => {
                                const h = videoHiderFeature._getHiddenVideos();
                                const idx = h.indexOf(vid);
                                if (idx > -1) { h.splice(idx, 1); videoHiderFeature._setHiddenVideos(h); }
                                item.remove();
                                videoHiderFeature._processAllVideos();
                                if (videoHiderFeature._getHiddenVideos().length === 0) renderTabContent('videos');
                            };

                            item.appendChild(thumb);
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            grid.appendChild(item);
                        });

                        tabContent.appendChild(grid);

                        // Clear all button
                        const clearBtn = document.createElement('button');
                        clearBtn.textContent = `Clear All Hidden Videos (${videos.length})`;
                        clearBtn.style.cssText = 'margin-top:20px;padding:12px 24px;width:100%;background:#dc2626;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;transition:background 0.2s;';
                        clearBtn.onmouseenter = () => { clearBtn.style.background = '#b91c1c'; };
                        clearBtn.onmouseleave = () => { clearBtn.style.background = '#dc2626'; };
                        clearBtn.onclick = () => {
                            if (!confirm(`Clear all ${videos.length} hidden videos?`)) return;
                            videoHiderFeature._setHiddenVideos([]);
                            videoHiderFeature._processAllVideos();
                            renderTabContent('videos');
                        };
                        tabContent.appendChild(clearBtn);
                    }
                } else if (tab === 'channels') {
                    const channels = videoHiderFeature?._getBlockedChannels() || [];
                    if (channels.length === 0) {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--ytkit-text-muted);';

                        const emptyIcon = document.createElement('div');
                        emptyIcon.style.cssText = 'font-size:48px;margin-bottom:16px;opacity:0.5;';
                        emptyIcon.textContent = '📢';

                        const emptyTitle = document.createElement('div');
                        emptyTitle.style.cssText = 'font-size:15px;margin-bottom:8px;';
                        emptyTitle.textContent = 'No blocked channels yet';

                        const emptyDesc = document.createElement('div');
                        emptyDesc.style.cssText = 'font-size:13px;opacity:0.7;';
                        emptyDesc.textContent = 'Right-click the X button on thumbnails to block channels';

                        empty.appendChild(emptyIcon);
                        empty.appendChild(emptyTitle);
                        empty.appendChild(emptyDesc);
                        tabContent.appendChild(empty);
                    } else {
                        const list = document.createElement('div');
                        list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

                        channels.forEach(ch => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;background:var(--ytkit-bg-surface);border-radius:8px;border:1px solid var(--ytkit-border);';

                            const icon = document.createElement('div');
                            icon.style.cssText = 'width:40px;height:40px;border-radius:50%;background:var(--ytkit-bg-elevated);display:flex;align-items:center;justify-content:center;font-size:18px;';
                            icon.textContent = '📺';

                            const info = document.createElement('div');
                            info.style.cssText = 'flex:1;';
                            const name = document.createElement('div');
                            name.style.cssText = 'font-size:14px;color:var(--ytkit-text-primary);font-weight:500;';
                            name.textContent = ch.name || ch.id;
                            const handle = document.createElement('div');
                            handle.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);';
                            handle.textContent = ch.id;
                            info.appendChild(name);
                            info.appendChild(handle);

                            const removeBtn = document.createElement('button');
                            removeBtn.textContent = 'Unblock';
                            removeBtn.style.cssText = 'padding:6px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);color:var(--ytkit-text-secondary);border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s;';
                            removeBtn.onmouseenter = () => { removeBtn.style.background = '#22c55e'; removeBtn.style.color = '#fff'; removeBtn.style.borderColor = '#22c55e'; };
                            removeBtn.onmouseleave = () => { removeBtn.style.background = 'var(--ytkit-bg-elevated)'; removeBtn.style.color = 'var(--ytkit-text-secondary)'; removeBtn.style.borderColor = 'var(--ytkit-border)'; };
                            removeBtn.onclick = () => {
                                const c = videoHiderFeature._getBlockedChannels();
                                const idx = c.findIndex(x => x.id === ch.id);
                                if (idx > -1) { c.splice(idx, 1); videoHiderFeature._setBlockedChannels(c); }
                                item.remove();
                                videoHiderFeature._processAllVideos();
                                if (videoHiderFeature._getBlockedChannels().length === 0) renderTabContent('channels');
                            };

                            item.appendChild(icon);
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            list.appendChild(item);
                        });

                        tabContent.appendChild(list);

                        // Clear all button
                        const clearBtn = document.createElement('button');
                        clearBtn.textContent = `Unblock All Channels (${channels.length})`;
                        clearBtn.style.cssText = 'margin-top:20px;padding:12px 24px;width:100%;background:#dc2626;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;transition:background 0.2s;';
                        clearBtn.onmouseenter = () => { clearBtn.style.background = '#b91c1c'; };
                        clearBtn.onmouseleave = () => { clearBtn.style.background = '#dc2626'; };
                        clearBtn.onclick = () => {
                            if (!confirm(`Unblock all ${channels.length} channels?`)) return;
                            videoHiderFeature._setBlockedChannels([]);
                            videoHiderFeature._processAllVideos();
                            renderTabContent('channels');
                        };
                        tabContent.appendChild(clearBtn);
                    }
                } else if (tab === 'keywords') {
                    const container = document.createElement('div');
                    container.style.cssText = 'padding:0;';

                    const desc = document.createElement('div');
                    desc.style.cssText = 'color:var(--ytkit-text-muted);font-size:13px;margin-bottom:16px;line-height:1.5;';
                    desc.textContent = 'Videos with titles containing these keywords will be automatically hidden. Separate multiple keywords with commas.';
                    container.appendChild(desc);

                    const textarea = document.createElement('textarea');
                    textarea.style.cssText = 'width:100%;min-height:150px;padding:12px;background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:8px;color:var(--ytkit-text-primary);font-size:13px;resize:vertical;font-family:inherit;';
                    textarea.placeholder = 'e.g., reaction, unboxing, prank, shorts';
                    textarea.value = appState.settings.hideVideosKeywordFilter || '';
                    textarea.onchange = async () => {
                        appState.settings.hideVideosKeywordFilter = textarea.value;
                        await settingsManager.save(appState.settings);
                        videoHiderFeature?._processAllVideos();
                    };
                    container.appendChild(textarea);

                    const hint = document.createElement('div');
                    hint.style.cssText = 'color:var(--ytkit-text-muted);font-size:11px;margin-top:8px;';
                    hint.textContent = 'Changes apply immediately. Keywords are case-insensitive.';
                    container.appendChild(hint);

                    tabContent.appendChild(container);
                } else if (tab === 'settings') {
                    const container = document.createElement('div');
                    container.style.cssText = 'display:flex;flex-direction:column;gap:24px;';

                    // Duration filter
                    const durSection = document.createElement('div');
                    durSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:12px;padding:20px;';

                    const durTitle = document.createElement('div');
                    durTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:8px;';
                    durTitle.textContent = 'Duration Filter';
                    durSection.appendChild(durTitle);

                    const durDesc = document.createElement('div');
                    durDesc.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-bottom:12px;';
                    durDesc.textContent = 'Automatically hide videos shorter than the specified duration.';
                    durSection.appendChild(durDesc);

                    const durRow = document.createElement('div');
                    durRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

                    const durInput = document.createElement('input');
                    durInput.type = 'number';
                    durInput.min = '0';
                    durInput.max = '60';
                    durInput.value = appState.settings.hideVideosDurationFilter || 0;
                    durInput.style.cssText = 'width:80px;padding:8px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:6px;color:var(--ytkit-text-primary);font-size:14px;';
                    durInput.onchange = async () => {
                        appState.settings.hideVideosDurationFilter = parseInt(durInput.value) || 0;
                        await settingsManager.save(appState.settings);
                        videoHiderFeature?._processAllVideos();
                    };

                    const durLabel = document.createElement('span');
                    durLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;';
                    durLabel.textContent = 'minutes (0 = disabled)';

                    durRow.appendChild(durInput);
                    durRow.appendChild(durLabel);
                    durSection.appendChild(durRow);
                    container.appendChild(durSection);

                    // Subscription Load Limiter
                    const limiterSection = document.createElement('div');
                    limiterSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:12px;padding:20px;';

                    const limiterTitle = document.createElement('div');
                    limiterTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:8px;';
                    limiterTitle.textContent = 'Subscription Page Load Limiter';
                    limiterSection.appendChild(limiterTitle);

                    const limiterDesc = document.createElement('div');
                    limiterDesc.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-bottom:16px;line-height:1.5;';
                    limiterDesc.textContent = 'Prevents infinite scrolling when many consecutive videos are hidden. Useful if you\'ve hidden years of subscription videos.';
                    limiterSection.appendChild(limiterDesc);

                    // Enable toggle
                    const limiterToggleRow = document.createElement('div');
                    limiterToggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding:12px;background:var(--ytkit-bg-elevated);border-radius:8px;';

                    const limiterToggleLabel = document.createElement('span');
                    limiterToggleLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;';
                    limiterToggleLabel.textContent = 'Enable load limiter';

                    const limiterSwitch = document.createElement('div');
                    limiterSwitch.className = 'ytkit-switch' + (appState.settings.hideVideosSubsLoadLimit !== false ? ' active' : '');
                    limiterSwitch.style.cssText = 'cursor:pointer;';

                    const limiterInput = document.createElement('input');
                    limiterInput.type = 'checkbox';
                    limiterInput.checked = appState.settings.hideVideosSubsLoadLimit !== false;
                    limiterInput.onchange = async () => {
                        appState.settings.hideVideosSubsLoadLimit = limiterInput.checked;
                        limiterSwitch.classList.toggle('active', limiterInput.checked);
                        await settingsManager.save(appState.settings);
                    };

                    const limiterTrack = document.createElement('span');
                    limiterTrack.className = 'ytkit-switch-track';

                    limiterSwitch.appendChild(limiterInput);
                    limiterSwitch.appendChild(limiterTrack);
                    limiterToggleRow.appendChild(limiterToggleLabel);
                    limiterToggleRow.appendChild(limiterSwitch);
                    limiterSection.appendChild(limiterToggleRow);

                    // Threshold setting
                    const thresholdRow = document.createElement('div');
                    thresholdRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

                    const thresholdLabel = document.createElement('span');
                    thresholdLabel.style.cssText = 'color:var(--ytkit-text-secondary);font-size:13px;flex:1;';
                    thresholdLabel.textContent = 'Stop after consecutive hidden batches:';

                    const thresholdInput = document.createElement('input');
                    thresholdInput.type = 'number';
                    thresholdInput.min = '1';
                    thresholdInput.max = '20';
                    thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold || 3;
                    thresholdInput.style.cssText = 'width:70px;padding:8px 12px;background:var(--ytkit-bg-elevated);border:1px solid var(--ytkit-border);border-radius:6px;color:var(--ytkit-text-primary);font-size:14px;text-align:center;';
                    thresholdInput.onchange = async () => {
                        appState.settings.hideVideosSubsLoadThreshold = Math.max(1, Math.min(20, parseInt(thresholdInput.value) || 3));
                        thresholdInput.value = appState.settings.hideVideosSubsLoadThreshold;
                        await settingsManager.save(appState.settings);
                    };

                    thresholdRow.appendChild(thresholdLabel);
                    thresholdRow.appendChild(thresholdInput);
                    limiterSection.appendChild(thresholdRow);

                    const thresholdHint = document.createElement('div');
                    thresholdHint.style.cssText = 'color:var(--ytkit-text-muted);font-size:11px;margin-top:8px;';
                    thresholdHint.textContent = 'Lower = stops faster, Higher = loads more before stopping (1-20)';
                    limiterSection.appendChild(thresholdHint);

                    container.appendChild(limiterSection);

                    // Stats section
                    const statsSection = document.createElement('div');
                    statsSection.style.cssText = 'background:var(--ytkit-bg-surface);border:1px solid var(--ytkit-border);border-radius:12px;padding:20px;';

                    const statsTitle = document.createElement('div');
                    statsTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--ytkit-text-primary);margin-bottom:12px;';
                    statsTitle.textContent = 'Statistics';
                    statsSection.appendChild(statsTitle);

                    const statsGrid = document.createElement('div');
                    statsGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';

                    const videoCount = videoHiderFeature?._getHiddenVideos()?.length || 0;
                    const channelCount = videoHiderFeature?._getBlockedChannels()?.length || 0;

                    const videoStat = document.createElement('div');
                    videoStat.style.cssText = 'background:var(--ytkit-bg-elevated);padding:16px;border-radius:8px;text-align:center;';
                    const videoStatNum = document.createElement('div');
                    videoStatNum.style.cssText = `font-size:24px;font-weight:700;color:${config.color};`;
                    videoStatNum.textContent = videoCount;
                    const videoStatLabel = document.createElement('div');
                    videoStatLabel.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-top:4px;';
                    videoStatLabel.textContent = 'Hidden Videos';
                    videoStat.appendChild(videoStatNum);
                    videoStat.appendChild(videoStatLabel);

                    const channelStat = document.createElement('div');
                    channelStat.style.cssText = 'background:var(--ytkit-bg-elevated);padding:16px;border-radius:8px;text-align:center;';
                    const channelStatNum = document.createElement('div');
                    channelStatNum.style.cssText = `font-size:24px;font-weight:700;color:${config.color};`;
                    channelStatNum.textContent = channelCount;
                    const channelStatLabel = document.createElement('div');
                    channelStatLabel.style.cssText = 'font-size:12px;color:var(--ytkit-text-muted);margin-top:4px;';
                    channelStatLabel.textContent = 'Blocked Channels';
                    channelStat.appendChild(channelStatNum);
                    channelStat.appendChild(channelStatLabel);

                    statsGrid.appendChild(videoStat);
                    statsGrid.appendChild(channelStat);
                    statsSection.appendChild(statsGrid);
                    container.appendChild(statsSection);

                    tabContent.appendChild(container);
                }
            }

            // Initial render
            renderTabContent('videos');

            return pane;
        }

        categoryOrder.forEach((cat, index) => {
            // Special handling for Video Hider
            if (cat === 'Video Hider') {
                const config = CATEGORY_CONFIG[cat];
                content.appendChild(buildVideoHiderPane(config));
                return;
            }

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

            const toggleAllThumb = document.createElement('span');
            toggleAllThumb.className = 'ytkit-switch-thumb';

            toggleAllTrack.appendChild(toggleAllThumb);
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

            // Sort features: dropdowns/selects first, then others
            const sortedParentFeatures = [...parentFeatures].sort((a, b) => {
                const aIsDropdown = a.type === 'select' || a.type === 'multiSelect';
                const bIsDropdown = b.type === 'select' || b.type === 'multiSelect';
                if (aIsDropdown && !bIsDropdown) return -1;
                if (!aIsDropdown && bIsDropdown) return 1;
                return 0;
            });

            sortedParentFeatures.forEach(f => {
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

        // YouTube Tools Installer Button - Downloads a .bat launcher
        const ytToolsBtn = document.createElement('button');
        ytToolsBtn.className = 'ytkit-github';
        ytToolsBtn.title = 'Download & run this script to setup local YouTube downloads (VLC/MPV streaming, yt-dlp)';
        ytToolsBtn.style.cssText = 'background: linear-gradient(135deg, #f97316, #22c55e) !important; border: none; cursor: pointer;';
        const dlIcon = ICONS.download();
        dlIcon.style.color = 'white';
        ytToolsBtn.appendChild(dlIcon);

        ytToolsBtn.addEventListener('click', () => {
            // Generate a .bat file that runs the PowerShell installer
            const batContent = `@echo off
title YouTube Tools Installer
echo ========================================
echo   YouTube Tools Installer
echo   VLC/MPV Streaming ^& Local Downloads
echo ========================================
echo.
echo Downloading and running installer...
echo.
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SysAdminDoc/YTKit/refs/heads/main/Install-YouTubeTools.ps1 | iex"
echo.
echo If the window closes immediately, right-click and Run as Administrator.
pause
`;
            const blob = new Blob([batContent], { type: 'application/x-bat' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Install-YouTubeTools.bat';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('📦 Installer downloaded! Double-click the .bat file to run.', '#22c55e');
        });
        const ytToolsLink = ytToolsBtn; // Alias for existing appendChild call

        const versionSpan = document.createElement('span');
        versionSpan.className = 'ytkit-version';
        versionSpan.textContent = 'v12.1';

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
            // Info card - no additional controls needed (installer is in footer)
        } else if (f.type === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.className = 'ytkit-input';
            textarea.id = `ytkit-input-${f.id}`;
            textarea.placeholder = f.placeholder || 'word1, word2, phrase';
            textarea.value = appState.settings[f.id] || '';
            // Make CSS textareas larger
            if (f.id === 'customCssCode') {
                textarea.style.cssText = 'min-height: 150px; font-family: monospace; font-size: 12px;';
            }
            card.appendChild(textarea);
        } else if (f.type === 'select') {
            const select = document.createElement('select');
            select.className = 'ytkit-select';
            select.id = `ytkit-select-${f.id}`;
            select.style.cssText = `padding:8px 12px;border-radius:8px;background:var(--ytkit-bg-base);color:#fff;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:13px;min-width:150px;`;
            const settingKey = f.settingKey || f.id;
            const currentValue = appState.settings[settingKey] || Object.keys(f.options)[0];
            for (const [value, label] of Object.entries(f.options)) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                option.selected = value === currentValue;
                select.appendChild(option);
            }
            card.appendChild(select);
        } else if (f.type === 'multiSelect') {
            // Multi-select with checkboxes
            const settingKey = f.settingKey || f.id;
            const currentValues = appState.settings[settingKey] || [];
            
            const wrapper = document.createElement('div');
            wrapper.className = 'ytkit-multiselect';
            wrapper.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;max-width:300px;';
            
            // Create "Edit" button to expand options
            const editBtn = document.createElement('button');
            editBtn.className = 'ytkit-multiselect-btn';
            editBtn.style.cssText = 'padding:6px 12px;border-radius:6px;background:var(--ytkit-bg-hover);color:#fff;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:12px;';
            editBtn.textContent = `${currentValues.length} of ${f.options.length} selected`;
            
            const dropdown = document.createElement('div');
            dropdown.className = 'ytkit-multiselect-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;right:0;top:100%;background:var(--ytkit-bg-elevated);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;z-index:100;max-height:200px;overflow-y:auto;min-width:200px;';
            
            f.options.forEach(opt => {
                const label = document.createElement('label');
                label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:12px;color:#e2e8f0;';
                label.onmouseenter = () => { label.style.background = 'rgba(255,255,255,0.05)'; };
                label.onmouseleave = () => { label.style.background = 'transparent'; };
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = opt.value;
                cb.checked = currentValues.includes(opt.value);
                cb.style.cssText = 'accent-color:#3b82f6;';
                cb.dataset.featureId = f.id;
                cb.dataset.settingKey = settingKey;
                cb.className = 'ytkit-multiselect-cb';
                
                label.appendChild(cb);
                label.appendChild(document.createTextNode(opt.label));
                dropdown.appendChild(label);
            });
            
            editBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            };
            
            wrapper.style.position = 'relative';
            wrapper.appendChild(editBtn);
            wrapper.appendChild(dropdown);
            card.appendChild(wrapper);
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!wrapper.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });
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
            
            // Update switch visual state
            const switchEl = cb.closest('.ytkit-switch');
            if (switchEl) {
                switchEl.classList.toggle('active', allChecked);
            }
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
                
                // Update the switch visual state
                const switchEl = e.target.closest('.ytkit-switch');
                if (switchEl) {
                    switchEl.classList.toggle('active', isEnabled);
                }
                
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
                
                // Special case: if customCssCode changed, update the customCssEnabled feature
                if (featureId === 'customCssCode' && appState.settings.customCssEnabled) {
                    const cssFeature = features.find(f => f.id === 'customCssEnabled');
                    if (cssFeature && typeof cssFeature.updateCss === 'function') {
                        cssFeature.updateCss(e.target.value);
                    }
                }
            }
            // Select dropdown
            if (e.target.matches('.ytkit-select')) {
                const card = e.target.closest('[data-feature-id]');
                const featureId = card.dataset.featureId;
                const feature = features.find(f => f.id === featureId);
                
                // Use settingKey if specified, otherwise use featureId
                const settingKey = feature?.settingKey || featureId;
                const newValue = e.target.value;
                
                appState.settings[settingKey] = newValue;
                await settingsManager.save(appState.settings);
                
                // Reinitialize the feature to apply changes immediately
                if (feature) {
                    if (typeof feature.destroy === 'function') {
                        try { feature.destroy(); } catch (e) { /* ignore */ }
                    }
                    if (typeof feature.init === 'function') {
                        try { feature.init(); } catch (e) { console.warn('[YTKit] Feature reinit error:', e); }
                    }
                }
                
                const selectedText = e.target.options[e.target.selectedIndex].text;
                createToast(`${feature?.name || 'Setting'} changed to ${selectedText}`, 'success');
            }
            // MultiSelect checkbox
            if (e.target.matches('.ytkit-multiselect-cb')) {
                const card = e.target.closest('[data-feature-id]');
                const featureId = card.dataset.featureId;
                const settingKey = e.target.dataset.settingKey;
                const feature = features.find(f => f.id === featureId);
                
                // Get current array and update it
                let currentValues = appState.settings[settingKey] || [];
                if (!Array.isArray(currentValues)) currentValues = [];
                
                const value = e.target.value;
                if (e.target.checked) {
                    if (!currentValues.includes(value)) {
                        currentValues.push(value);
                    }
                } else {
                    currentValues = currentValues.filter(v => v !== value);
                }
                
                appState.settings[settingKey] = currentValues;
                await settingsManager.save(appState.settings);
                
                // Update button text
                const btn = card.querySelector('.ytkit-multiselect-btn');
                if (btn && feature) {
                    btn.textContent = `${currentValues.length} of ${feature.options.length} selected`;
                }
                
                // Reinitialize the feature to apply changes immediately
                if (feature) {
                    if (typeof feature.destroy === 'function') {
                        try { feature.destroy(); } catch (err) { /* ignore */ }
                    }
                    if (typeof feature.init === 'function') {
                        try { feature.init(); } catch (err) { console.warn('[YTKit] Feature reinit error:', err); }
                    }
                }
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
.ytkit-pane.ytkit-vh-pane.active {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: calc(85vh - 180px);
}
#ytkit-vh-content {
    flex: 1;
    overflow-y: auto;
    padding-right: 8px;
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

/* ═══════════════════════════════════════════════════════════════════════════
   Statistics Dashboard Styles
   ═══════════════════════════════════════════════════════════════════════════ */
.ytkit-stat-card {
    background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
    border: 1px solid var(--ytkit-border-subtle);
    border-radius: var(--ytkit-radius-md);
    padding: 16px;
    text-align: center;
    transition: all var(--ytkit-transition);
}
.ytkit-stat-card:hover {
    background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
    border-color: var(--ytkit-border);
}
.ytkit-stat-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--ytkit-accent);
    margin-bottom: 4px;
}
.ytkit-stat-label {
    font-size: 12px;
    color: var(--ytkit-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Profiles UI Styles
   ═══════════════════════════════════════════════════════════════════════════ */
.ytkit-profile-item:hover {
    background: rgba(255,255,255,0.06) !important;
}
.ytkit-profile-item button:hover {
    filter: brightness(1.1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Custom CSS Editor Styles
   ═══════════════════════════════════════════════════════════════════════════ */
.ytkit-css-editor {
    width: 100%;
    min-height: 150px;
    padding: 12px;
    background: var(--ytkit-bg-base);
    border: 1px solid var(--ytkit-border);
    border-radius: var(--ytkit-radius-md);
    color: var(--ytkit-text-primary);
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
}
.ytkit-css-editor:focus {
    outline: none;
    border-color: var(--ytkit-accent);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Bulk Operations Styles
   ═══════════════════════════════════════════════════════════════════════════ */
.ytkit-bulk-bar {
    animation: slideDown 0.2s ease-out;
}
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
}
        `);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION 6: BOOTSTRAP
    // ══════════════════════════════════════════════════════════════════════════
    async function main() {
        appState.settings = await settingsManager.load();
        appState.currentPage = getCurrentPage();

        // Initialize keyboard manager with default settings shortcut
        KeyboardManager.init();
        KeyboardManager.register('ctrl+alt+y', () => {
            document.body.classList.toggle('ytkit-panel-open');
        }, 'Open YTKit Settings');

        injectPanelStyles();
        buildSettingsPanel();
        injectSettingsButton();
        attachUIEventListeners();
        updateAllToggleStates();

        // Initialize features with lazy-loading support
        features.forEach(f => {
            // For multiSelect features, check if the settingKey array has items
            // For regular features, check if the feature is enabled
            const isMultiSelect = f.type === 'multiSelect';
            const settingKey = f.settingKey || f.id;
            const isEnabled = isMultiSelect 
                ? (appState.settings[settingKey] && appState.settings[settingKey].length > 0)
                : appState.settings[f.id];
            
            if (isEnabled) {
                // Check if feature should run on this page (lazy-loading)
                if (f.pages && !f.pages.includes(appState.currentPage)) {
                    return; // Skip this feature on this page
                }
                
                // Check feature dependencies
                if (f.dependsOn && !appState.settings[f.dependsOn]) {
                    return; // Skip if dependency not enabled
                }

                try {
                    f.init?.();
                    DebugManager.log('Feature', `Initialized: ${f.id}`);
                } catch (error) {
                    console.error(`[YTKit] Error initializing "${f.id}":`, error);
                    DebugManager.log('Error', `Failed to init ${f.id}`, error.message);
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

        // Track page changes for lazy loading
        window.addEventListener('yt-navigate-finish', () => {
            const newPage = getCurrentPage();
            if (newPage !== appState.currentPage) {
                const oldPage = appState.currentPage;
                appState.currentPage = newPage;
                DebugManager.log('Navigation', `Page changed: ${oldPage} -> ${newPage}`);
                
                // Re-initialize features that are page-specific
                features.forEach(f => {
                    const isMultiSelect = f.type === 'multiSelect';
                    const settingKey = f.settingKey || f.id;
                    const isEnabled = isMultiSelect 
                        ? (appState.settings[settingKey] && appState.settings[settingKey].length > 0)
                        : appState.settings[f.id];
                    
                    if (isEnabled && f.pages) {
                        const wasActive = f.pages.includes(oldPage);
                        const shouldBeActive = f.pages.includes(newPage);
                        
                        if (!wasActive && shouldBeActive) {
                            try { f.init?.(); } catch(e) {}
                        } else if (wasActive && !shouldBeActive) {
                            try { f.destroy?.(); } catch(e) {}
                        }
                    }
                });
            }
        });

        // Initialize statistics tracker
        await StatsTracker.load();

        console.log('[YTKit] v12.1 Initialized - Optimized Edition');
        DebugManager.log('Init', 'YTKit v12.1 started', { page: appState.currentPage, features: Object.keys(appState.settings).filter(k => appState.settings[k]).length });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        main();
    } else {
        window.addEventListener('DOMContentLoaded', main);
    }
})();
