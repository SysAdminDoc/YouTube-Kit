(function() {
    'use strict';

    if (typeof window.YTKit === 'undefined') { return; }
    const { addNavigateRule, removeNavigateRule, addMutationRule, removeMutationRule, injectStyle, waitForElement, createToast } = window.YTKit;

    // Helper functions for chat filters, using the global appState
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
        const keywordsRaw = window.YTKit.appState.settings.keywordFilterList;
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


    const watchPageFeatures = [
        // Watch Page - Layout
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
                if (window.YTKit.appState.settings.expandVideoWidth) {
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
                if (window.YTKit.appState.settings.hideRelatedVideos) {
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

        // Watch Page - Behavior
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

        // Watch Page - Other Elements
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

        // Watch Page - Live Chat
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

        // Watch Page - Action Buttons
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

        // Player Enhancements
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

        // Watch Page - Player Controls
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

                if (window.YTKit.appState.settings.hideQualityPopup) {
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

                if (best.includes('1080') && window.YTKit.appState.settings.useEnhancedBitrate) {
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
        { id: 'hideFullscreenButton', name: 'Hide Fullscreen Button', description: 'Hides the fullscreen button in the player controls.', group: 'Watch Page - Player Controls', _styleElement: null, init() { this._styleElement = injectStyle('.ytp-fullscreen-button', this.id); }, destroy() { this._styleElement?.remove(); }}
    ];

    if (typeof window.YTKit.YTKitFeatures !== 'undefined') {
        window.YTKit.YTKitFeatures.watchPage = watchPageFeatures;
    }

})();