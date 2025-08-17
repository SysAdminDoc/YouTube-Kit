 
// YTKit Themes Features Module
(function() {
    'use strict';
    if (!window.YTKit) { window.YTKit = {}; }

    const themeFeatures = [
        {
            id: 'nativeDarkMode',
            name: 'YouTube Native Dark Theme',
            description: 'Forces YouTube\'s built-in dark theme to be active.',
            group: 'Themes',
            isManagement: true,
            _ruleId: 'nativeDarkModeRule',
            _applyTheme() {
                document.documentElement.setAttribute('dark', '');
            },
            init() {
                this._applyTheme();
                addMutationRule(this._ruleId, this._applyTheme.bind(this));
            },
            destroy() {
                document.documentElement.removeAttribute('dark');
                removeMutationRule(this._ruleId);
            }
        },
        {
            id: 'betterDarkMode',
            name: 'Better Full Dark Theme',
            description: 'Enhances the native dark theme. Requires "YouTube Native Dark Theme" to be enabled.',
            group: 'Themes',
            isSubFeature: true,
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('betterDarkMode');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'catppuccinMocha',
            name: 'Catppuccin Mocha Theme',
            description: 'A soothing dark theme for YouTube. Requires "YouTube Native Dark Theme" to be enabled.',
            group: 'Themes',
            isSubFeature: true,
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('catppuccinMocha');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'squarify',
            name: 'Squarify',
            description: 'Removes rounded corners from most elements for a sharper look.',
            group: 'Themes',
            _styleElement: null,
            init() {
                const css = `* { border-radius: 0 !important; }`;
                this._styleElement = injectStyle(css, this.id, true);
            },
            destroy() { this._styleElement?.remove(); }
        },
        {
            id: 'nyanCatProgressBar',
            name: 'Nyan Cat Progress Bar',
            description: 'Replaces the video progress bar with the one and only Nyan Cat.',
            group: 'Progress Bar Themes',
            _styleElement: null,
            init() {
                const customCss = GM_getResourceText('nyanCatProgressBar');
                if (customCss) {
                    this._styleElement = document.createElement('style');
                    this._styleElement.id = `yt-suite-style-${this.id}`;
                    this._styleElement.textContent = customCss;
                    document.head.appendChild(this._styleElement);
                }
            },
            destroy() { this._styleElement?.remove(); }
        },
    ];

    window.YTKit.registerFeatures(themeFeatures);

})();
