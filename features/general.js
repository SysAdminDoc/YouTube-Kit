// YTKit General Content Features Module
(function() {
    'use strict';
    if (!window.YTKit) { window.YTKit = {}; }

    const generalFeatures = [
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
    ];

    window.YTKit.registerFeatures(generalFeatures);

})();
