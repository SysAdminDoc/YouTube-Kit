(() => {
    'use strict';

    const core = globalThis.YTKitCore || (globalThis.YTKitCore = {});
    if (core.appendStyleSheet) return;

    function appendStyleSheet(css) {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        return style;
    }

    function injectStyle(selector, featureId, isRawCss = false) {
        const id = `yt-suite-style-${featureId}`;
        document.getElementById(id)?.remove();
        const style = document.createElement('style');
        style.id = id;
        style.textContent = isRawCss ? selector : `${selector} { display: none !important; }`;
        (document.head || document.documentElement).appendChild(style);
        return style;
    }

    function stripCommentRestyleCss(css = '') {
        if (!css) return css;
        const commentPattern = /(#comments\b|#simple-box\b|#placeholder-area\b|#action-buttons\b|#vote-count-middle\b|#reply-button-end\b|#header-author\b|#author-thumbnail\b|#contenteditable-textarea\b|#contenteditable-root\b|ytd-comments\b|ytd-comments-header-renderer\b|ytd-comment(?:-[a-z-]+)?\b|ytd-commentbox\b|ytd-comment-engagement-bar\b|ytd-comment-replies-renderer\b|yt-user-mention-autosuggest-input\b|ytkit-comment-|ytSubThread|thread-hitbox\.style-scope\.ytd-comment-thread-renderer|#author-text\b|#published-time-text\b|#content-text\b|#action-menu\.ytd-comment|\[data-ytkit-comment-current)/i;
        return css
            .split('}')
            .map((chunk) => chunk.trim())
            .filter(Boolean)
            .filter((chunk) => !commentPattern.test(chunk))
            .map((chunk) => `${chunk}}`)
            .join('');
    }

    function cleanupRetiredCommentUi(root = document) {
        if (!root?.querySelectorAll) return;
        [
            'chatStyleComments',
            'chatStyleComments-premium',
            'chatStyleComments-premium-2',
            'commentEnhancements',
            'commentNavigator',
            'autoExpandComments',
            'hideCommentDislikeButton',
            'hideCommentActionMenu',
            'condenseComments',
            'hideCommentTeaser',
            'hidePinnedComments',
            'watchPageRestyle-comments'
        ].forEach((styleId) => {
            document.getElementById(`yt-suite-style-${styleId}`)?.remove();
        });
        root.querySelectorAll('.ytkit-comment-search, #ytkit-comment-nav, .ytkit-vote-badge, .ytkit-heat-indicator').forEach((el) => el.remove());
        root.querySelectorAll('[data-ytkit-chat], [data-ytkit-pinned], [data-ytkit-heart], [data-ytkit-linked], [data-ytkit-enhanced], [data-ytkit-creator], [data-ytkit-comment-current]').forEach((el) => {
            delete el.dataset.ytkitChat;
            delete el.dataset.ytkitPinned;
            delete el.dataset.ytkitHeart;
            delete el.dataset.ytkitLinked;
            delete el.dataset.ytkitEnhanced;
            delete el.dataset.ytkitCreator;
            delete el.dataset.ytkitCommentCurrent;
        });
        root.querySelectorAll('.ytkit-replying').forEach((el) => el.classList.remove('ytkit-replying'));
        root.querySelectorAll('ytd-comment-thread-renderer').forEach((thread) => {
            if (thread instanceof HTMLElement && thread.style.display === 'none') thread.style.display = '';
        });
    }

    Object.assign(core, {
        appendStyleSheet,
        cleanupRetiredCommentUi,
        injectStyle,
        stripCommentRestyleCss
    });
})();
