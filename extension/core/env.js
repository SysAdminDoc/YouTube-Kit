(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.isTopLevelFrame) return;

    function isTopLevelFrame() {
        try {
            return window.top === window;
        } catch (_) {
            return false;
        }
    }

    function isLiveChatPath(path = window.location.pathname) {
        return String(path).startsWith('/live_chat');
    }

    function isLiveChatFrame() {
        return isLiveChatPath();
    }

    function shouldBuildPrimaryUI() {
        return isTopLevelFrame() && !isLiveChatFrame();
    }

    function hasExtensionContext() {
        try {
            return !!chrome.runtime?.id;
        } catch (_) {
            return false;
        }
    }

    Object.assign(core, {
        hasExtensionContext,
        isLiveChatFrame,
        isLiveChatPath,
        isTopLevelFrame,
        shouldBuildPrimaryUI
    });
})();
