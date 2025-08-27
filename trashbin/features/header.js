(function() {
    'use strict';

    const headerFeatures = [
        {
            id: 'hideCreateButton',
            name: 'Hide "Create" Button',
            description: 'Hides the "Create" button in the main YouTube header.',
            group: 'Header',
            _styleElement: null,
            init() { this._styleElement = window.YTKit.injectStyle('ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])', this.id); },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'hideVoiceSearch',
            name: 'Hide Voice Search Button',
            description: 'Hides the microphone icon for voice search in the header.',
            group: 'Header',
            _styleElement: null,
            init() { this._styleElement = window.YTKit.injectStyle('#voice-search-button', this.id); },
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
                window.YTKit.addNavigateRule('relinkLogoRule', () => this._relinkLogo());
            },
            destroy() {
                window.YTKit.removeNavigateRule('relinkLogoRule');
                const logoLink = document.querySelector('ytd-topbar-logo-renderer a#logo');
                if (logoLink) logoLink.href = '/';
            }
        },
        {
            id: 'widenSearchBar',
            name: 'Widen Search Bar',
            description: 'Stretches the search bar to fill more of the header space.',
            group: 'Header',
            _styleElement: null,
            init() {
                const css = `ytd-masthead yt-searchbox { margin-left: -180px; margin-right: -300px; }`;
                this._styleElement = window.YTKit.injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        }
    ];

    if (typeof window.YTKit !== 'undefined') {
        window.YTKit.YTKitFeatures.header = headerFeatures;
    }

})();