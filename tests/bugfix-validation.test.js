'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findBalancedObjectLiteral } = require('../scripts/catalog-utils');

// ── searchFilterDefaults: sp values must be raw (not double-encoded) ──

test('searchFilterDefaults sp values are valid base64 sort parameters', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Extract the spMap from the searchFilterDefaults feature
    const spMapMatch = source.match(/const spMap\s*=\s*\{([^}]+)\}/);
    assert.ok(spMapMatch, 'spMap should exist in source');

    const spMapStr = spMapMatch[1];
    // Values should NOT contain %25 (double-encoded percent signs)
    assert.ok(!spMapStr.includes('%25'), 'sp values must not be double-encoded (%25 found)');

    // Values should be raw base64: CAI=, CAM=, CAE=
    assert.ok(spMapStr.includes("'CAI='") || spMapStr.includes('"CAI="'), 'upload_date should map to CAI=');
    assert.ok(spMapStr.includes("'CAM='") || spMapStr.includes('"CAM="'), 'view_count should map to CAM=');
    assert.ok(spMapStr.includes("'CAE='") || spMapStr.includes('"CAE="'), 'rating should map to CAE=');
});

// ── _sanitizeFilename: must preserve Unicode characters ──

test('_sanitizeFilename preserves Unicode and produces valid filenames', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Verify the sanitizer no longer strips non-ASCII
    assert.ok(!source.includes("[^\\x00-\\x7F]"), '_sanitizeFilename must not strip non-ASCII characters');
    // Verify it strips control characters
    assert.ok(source.includes("[\\x00-\\x1f]") || source.includes('\\x00-\\x1f'), '_sanitizeFilename should strip control characters');
});

test('copyVideoTitle uses a clipboard fallback path and clears reset timers', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'copyVideoTitle'");
    const end = source.indexOf("id: 'channelAgeDisplay'");
    assert.ok(start > -1 && end > start, 'copyVideoTitle block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes("document.execCommand('copy')"), 'copyVideoTitle should fall back to document.execCommand(\'copy\')');
    assert.ok(block.includes('_resetTimer'), 'copyVideoTitle should keep a reset timer for transient button states');
    assert.ok(block.includes('this._clearResetTimer();'), 'copyVideoTitle should clear reset timers during lifecycle changes');
});

test('downloadThumbnail uses shared video id parsing and mutation retries', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'downloadThumbnail'");
    const end = source.indexOf("id: 'grayscaleThumbnails'");
    assert.ok(start > -1 && end > start, 'downloadThumbnail block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('const videoId = getVideoId();'), 'downloadThumbnail should use getVideoId() for the active video');
    assert.ok(block.includes("addMutationRule('downloadThumbnail'"), 'downloadThumbnail should retry when the watch action row hydrates late');
    assert.ok(block.includes('_sanitizeFilename('), 'downloadThumbnail should sanitize title-based filenames');
});

test('videoResolutionBadge supports SD and avoids direct thumbnail style mutation', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'videoResolutionBadge'");
    const end = source.indexOf("id: 'likeViewRatio'");
    assert.ok(start > -1 && end > start, 'videoResolutionBadge block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes("label: 'SD'"), 'videoResolutionBadge should include an SD quality path');
    assert.ok(block.includes("thumb.classList.add('ytkit-res-host')"), 'videoResolutionBadge should use a host class for positioning');
    assert.ok(!block.includes("thumb.style.position = 'relative'"), 'videoResolutionBadge should not mutate thumbnail inline position styles');
});

test('playlistEnhancer restores duplicate hiding and copy fallback behavior', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'playlistEnhancer'");
    const end = source.indexOf("id: 'commentSearch'");
    assert.ok(start > -1 && end > start, 'playlistEnhancer block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('Hide Duplicates'), 'playlistEnhancer should expose a duplicate-hiding control');
    assert.ok(block.includes("document.execCommand('copy')"), 'playlistEnhancer should fall back to document.execCommand(\'copy\') for URL copy');
    assert.ok(block.includes("addMutationRule('playlistEnhancer'"), 'playlistEnhancer should resync when playlist panel content hydrates late');
});

test('customSpeedButtons rebinds to swapped videos and exposes pressed states', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'customSpeedButtons'");
    const end = source.indexOf("id: 'openInNewTab'");
    assert.ok(start > -1 && end > start, 'customSpeedButtons block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('_bindVideo(video)'), 'customSpeedButtons should rebind when the active video element changes');
    assert.ok(block.includes("addMutationRule('customSpeedButtons'"), 'customSpeedButtons should resync during late watch-page hydration');
    assert.ok(block.includes("button.setAttribute('aria-pressed'"), 'customSpeedButtons should expose active preset state via aria-pressed');
});

test('player quick links edit mode keeps delete buttons on the same row', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf('#ytkit-po-drop .ytkit-ql-row');
    assert.ok(start > -1, 'player quick links row styles should exist');
    const block = source.slice(start, start + 2500);
    assert.match(block, /display:\s*flex\s*!important/, 'player quick links rows should use flex layout');
    assert.ok(!block.includes('display: block !important'), 'player quick links rows must not stack delete buttons as separate rows');
    assert.match(block, /#ytkit-po-drop\.ytkit-ql-editing \.ytkit-ql-del[\s\S]*?display:\s*inline-flex\s*!important/,
        'player quick links edit mode should show compact inline delete buttons');
});

test('hidePinnedComments defaults on and targets modern pinned comment markup', () => {
    const fs = require('fs');
    const path = require('path');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'default-settings.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const coreStyles = fs.readFileSync(path.join(__dirname, '..', 'extension', 'core', 'styles.js'), 'utf8');

    assert.equal(defaults.hidePinnedComments, true, 'pinned comments should be hidden by default');
    assert.match(source, /3:\s*\(s\)\s*=>\s*\{[\s\S]*?s\.hidePinnedComments\s*=\s*true;/,
        'settings migration should enable pinned comment hiding for existing profiles');

    const start = source.indexOf("id: 'hidePinnedComments'");
    assert.ok(start > -1, 'hidePinnedComments feature should exist');
    const end = source.indexOf("cssFeature('hideCommentDislikeButton'", start);
    assert.ok(end > start, 'hidePinnedComments feature should be before hideCommentDislikeButton');
    const block = source.slice(start, end);

    assert.ok(block.includes("'Comments'"), 'hidePinnedComments should appear in the Comments settings group');
    assert.ok(block.includes('ytd-comment-view-model[pinned]'), 'hidePinnedComments should target the modern pinned attribute');
    assert.ok(block.includes('#pinned-comment-badge:not(:empty)'), 'hidePinnedComments should target populated pinned badge containers');
    assert.ok(block.includes('ytd-pinned-comment-badge-renderer'), 'hidePinnedComments should target the pinned badge renderer');
    assert.ok(block.includes('data-ytkit-pinned-comment-hidden'), 'hidePinnedComments should add a durable hidden-thread marker');
    assert.ok(block.includes("thread.style.display = 'none'"), 'hidePinnedComments should hide matched threads directly');
    assert.ok(block.includes('addMutationRule(this.id'), 'hidePinnedComments should handle newly loaded comments');
    assert.ok(!coreStyles.includes("'hidePinnedComments'"), 'retired comment cleanup should not remove the active pinned comment style');
    assert.ok(coreStyles.includes("thread.dataset.ytkitPinnedCommentHidden !== '1'"),
        'retired comment cleanup should not unhide pinned comments marked by the active feature');
});

test('commentSearch only restores threads it hid and respects pinned comment hiding', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'commentSearch'");
    const end = source.indexOf("id: 'videoZoom'", start);
    assert.ok(start > -1 && end > start, 'commentSearch block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('ytkitCommentSearchHidden'), 'commentSearch should track which threads it hid');
    assert.ok(block.includes('ytkitCommentSearchDisplay'), 'commentSearch should preserve prior inline display values');
    assert.ok(block.includes('_restoreSearchHiddenThread(thread)'), 'commentSearch should use a dedicated restore path');
    assert.ok(block.includes("thread.dataset.ytkitPinnedCommentHidden === '1'"),
        'commentSearch restore should leave pinned comments hidden');
    assert.ok(block.includes('ytd-comment-thread-renderer[data-ytkit-comment-search-hidden="1"]'),
        'commentSearch destroy should only restore threads hidden by the search feature');
    assert.ok(!block.includes('ytd-comment-thread-renderer[style*="display: none"]'),
        'commentSearch destroy should not blindly unhide every hidden comment thread');
});

test('hideMembersOnly defaults on and detects modern lockup badges', () => {
    const fs = require('fs');
    const path = require('path');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'default-settings.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    assert.equal(defaults.hideMembersOnly, true, 'members-only feed filtering should be enabled by default');

    const start = source.indexOf("id: 'hideMembersOnly'");
    const end = source.indexOf("id: 'hideNewsHome'", start);
    assert.ok(start > -1 && end > start, 'hideMembersOnly block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('pages: [PageTypes.HOME, PageTypes.SUBSCRIPTIONS]'),
        'hideMembersOnly should only run on Home and Subscriptions');
    assert.ok(block.includes("_cardSelector: 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer'"),
        'hideMembersOnly should scan modern feed card renderers');
    assert.ok(block.includes("'badge-shape .ytBadgeShapeText'"),
        'hideMembersOnly should inspect modern badge text nodes');
    assert.ok(block.includes("'.ytContentMetadataViewModelBadge'"),
        'hideMembersOnly should inspect metadata badge wrappers used by new lockups');
    assert.ok(block.includes("includes('members only')"),
        'hideMembersOnly should match the visible members-only badge text');
    assert.ok(block.includes('addScopedMutationRule(this.id, this._cardSelector'),
        'hideMembersOnly should react to newly inserted feed cards efficiently');
    assert.ok(block.includes("card.style.display = 'none'"),
        'hideMembersOnly should hide matched feed cards directly');
    assert.ok(!block.includes('[aria-label*="Members only"] { display: none !important; }'),
        'hideMembersOnly should no longer rely on the outdated aria-label-only CSS rule');
});

test('hideJumpAheadButton defaults on and targets player jump-ahead overlays safely', () => {
    const fs = require('fs');
    const path = require('path');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'default-settings.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    assert.equal(defaults.hideJumpAheadButton, true, 'jump-ahead hiding should be enabled by default');
    assert.match(source, /hideJumpAheadButton:\s*true/, 'settings defaults should enable jump-ahead hiding');

    const start = source.indexOf("id: 'hideJumpAheadButton'");
    const end = source.indexOf("cssFeature('hideFundraiser'", start);
    assert.ok(start > -1 && end > start, 'hideJumpAheadButton block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes("pages: [PageTypes.WATCH]"),
        'hideJumpAheadButton should only run on watch pages');
    assert.ok(block.includes("_hiddenAttr: 'data-ytkit-jump-ahead-hidden'"),
        'hideJumpAheadButton should mark hidden nodes for safe cleanup');
    assert.ok(block.includes("'jump ahead'"),
        'hideJumpAheadButton should look for the visible Jump Ahead label');
    assert.ok(block.includes("'jumping over commonly skipped section'"),
        'hideJumpAheadButton should also cover the follow-up overlay copy');
    assert.ok(block.includes("'#movie_player, .html5-video-player'"),
        'hideJumpAheadButton should stay scoped to the actual player surface');
    assert.ok(block.includes('button[aria-label*="Jump ahead" i]'),
        'hideJumpAheadButton should include an attribute-based CSS fallback');
    assert.ok(block.includes("style.setProperty('display', 'none', 'important');"),
        'hideJumpAheadButton should hide matched controls directly');
    assert.ok(block.includes('addMutationRule(this.id'),
        'hideJumpAheadButton should react to overlays appearing during playback');
    assert.ok(block.includes('addNavigateRule(this.id'),
        'hideJumpAheadButton should rescan on SPA watch navigation');
    assert.ok(!block.includes('ytSpecTouchFeedbackShapeOverlayTouchResponseInverse { display: none !important; }'),
        'hideJumpAheadButton should not hide the generic touch-feedback class globally');
});

test('hideLiveChatEngagement also suppresses the subscriber-visibility live chat tooltip', () => {
    const fs = require('fs');
    const path = require('path');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'default-settings.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    assert.equal(defaults.hideLiveChatEngagement, true, 'live chat engagement cleanup should stay enabled by default');

    const start = source.indexOf("id: 'hideLiveChatEngagement'");
    const end = source.indexOf("id: 'premiumLiveChat'", start);
    assert.ok(start > -1 && end > start, 'hideLiveChatEngagement block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('yt-live-chat-viewer-engagement-message-renderer, yt-live-chat-toast-renderer'),
        'hideLiveChatEngagement should still hide the broad live chat engagement surfaces');
    assert.ok(block.includes('people will be able to see that you subscribe to this channel'),
        'hideLiveChatEngagement should target the subscriber-visibility tooltip copy');
    assert.ok(block.includes("tooltip.closest('tp-yt-iron-dropdown')"),
        'hideLiveChatEngagement should hide the live chat tooltip container, not just the tooltip node');
    assert.ok(block.includes('addMutationRule(this.id'),
        'hideLiveChatEngagement should rescan for tooltip popups that appear on hover');
});

test('autoExpandComments defaults on and expands existing comment truncation immediately', () => {
    const fs = require('fs');
    const path = require('path');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'default-settings.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    assert.equal(defaults.autoExpandComments, true, 'comment auto-expansion should be enabled by default');
    assert.match(source, /4:\s*\(s\)\s*=>\s*\{[\s\S]*?s\.autoExpandComments\s*=\s*true;/,
        'settings migration should enable comment auto-expansion for existing profiles');

    const start = source.indexOf("id: 'autoExpandComments'");
    const end = source.indexOf("id: 'commentEnhancements'", start);
    assert.ok(start > -1 && end > start, 'autoExpandComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes("const moreBtn = exp.querySelector('#more, [slot=\"more\"], tp-yt-paper-button#more');")
        || block.includes("const moreBtn = exp.querySelector('#more, [slot=\"more\"], tp-yt-paper-button#more')"),
        'autoExpandComments should still click Read more when present');
    assert.ok(block.includes('tp-yt-paper-button#less'),
        'autoExpandComments should explicitly target Show less button variants');
    assert.ok(block.includes("control.style.setProperty('display', 'none', 'important');"),
        'autoExpandComments should directly hide expand controls after expansion');
    assert.ok(block.includes('expandComments();'),
        'autoExpandComments should expand already-rendered comments immediately on init');
    assert.ok(block.includes("addMutationRule(this.id, expandComments);"),
        'autoExpandComments should continue expanding newly loaded comments');
});

test('video hider exposes split hide-all and restore-page controls', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'hideVideosFromHome'");
    const end = source.indexOf("id: 'showLocalDownloadButton'", start);
    assert.ok(start > -1 && end > start, 'video hider block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('_restoreHiddenVideosOnPage()'),
        'video hider should include a restore-on-page action');
    assert.ok(block.includes('ytkit-hide-all-group'),
        'video hider should build a grouped hide/restore control');
    assert.ok(block.includes('Restore hidden videos on this page'),
        'video hider should label the restore action clearly');
    assert.ok(block.includes("document.querySelectorAll('.ytkit-hide-all-restore-btn')"),
        'video hider should keep restore controls in sync with page state');
});

test('studio comments preserve native text selection on watch pages', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'removeAllShorts'", start);
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('_commentSelectionSelectStartHandler'),
        'studio comments should track a watch-page comment selection selectstart guard');
    assert.ok(block.includes('_isCommentTextSelectionTarget(target)'),
        'studio comments should detect when the user is targeting selectable comment text');
    assert.ok(block.includes('.thread-hitbox.style-scope.ytd-comment-thread-renderer'),
        'studio comments should disable the invisible comment hitbox overlay');
    assert.ok(block.includes('yt-core-attributed-string'),
        'studio comments should explicitly cover the newer attributed-string host');
    assert.ok(block.includes('-webkit-user-select: text !important;'),
        'studio comments should explicitly re-enable text selection');
    assert.ok(block.includes('cursor: text !important;'),
        'studio comments should use a text cursor for comment content');
    assert.ok(block.includes('#published-time-text a'),
        'studio comments should keep timestamp links in the interactive foreground');
    assert.ok(block.includes("style.setProperty('display', 'none', 'important');"),
        'studio comments should inline-hide legacy comment hitboxes when they appear');
    assert.ok(block.includes("window.addEventListener('selectstart', this._commentSelectionSelectStartHandler, true);"),
        'studio comments should protect selection before downstream handlers can cancel it');
    assert.ok(!block.includes("window.addEventListener('mousedown', this._commentSelectionMouseDownHandler, true);"),
        'studio comments should avoid a global mousedown capture guard that starves native text and link interactions');
    assert.ok(block.includes("window.removeEventListener('selectstart', this._commentSelectionSelectStartHandler, true);"),
        'studio comments should clean up the watch-page selection guard on destroy');
});

test('global comment text selection support covers community posts and comment surfaces', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const start = source.indexOf('const commentTextSelectionSupport = {');
    const end = source.indexOf('//  SECTION 4: PREMIUM UI', start);
    assert.ok(start > -1 && end > start, 'global comment selection support block should exist');
    const block = source.slice(start, end);

    assert.ok(source.includes('const COMMENT_TEXT_SELECTION_ROOT_SELECTORS = ['),
        'global comment selection support should define comment/post root selectors');
    assert.ok(source.includes("'ytd-backstage-comment-renderer'"),
        'global comment selection support should cover backstage comment renderers');
    assert.ok(source.includes("'ytd-post-renderer'"),
        'global comment selection support should cover post renderers');
    assert.ok(source.includes("'ytd-backstage-post-thread-renderer'"),
        'global comment selection support should cover backstage post thread renderers');
    assert.ok(source.includes("'#home-content-text'"),
        'global comment selection support should cover compact post text');
    assert.ok(source.includes("'#post-text'"),
        'global comment selection support should cover full post text');
    assert.ok(source.includes('const commentTextSelectionSupport = {'),
        'global comment selection support should be centralized in a singleton helper');
    assert.ok(block.includes("_styleElement = injectStyle(css, 'ytkit-comment-text-selection', true);"),
        'global comment selection support should inject a dedicated style block');
    assert.ok(block.includes('#published-time-text a'),
        'global comment selection support should preserve timestamp link interactivity');
    assert.ok(block.includes('_normalizeCommentSurface(root)'),
        'global comment selection support should normalize comment interaction surfaces');
    assert.ok(block.includes('new MutationObserver((records) => {'),
        'global comment selection support should re-apply safeguards as YouTube lazily renders new comments');
    assert.ok(block.includes("window.addEventListener('selectstart', this._selectStartHandler, true);"),
        'global comment selection support should guard selectstart in the capture phase');
    assert.ok(!block.includes("window.addEventListener('mousedown', this._mouseDownHandler, true);"),
        'global comment selection support should avoid a mousedown capture guard that blocks native text and link behavior');
    assert.ok(source.includes('COMMENT_TEXT_SELECTION_INTERACTIVE_SELECTORS'),
        'global comment selection support should exclude interactive targets');
    assert.ok(!source.includes("const COMMENT_TEXT_SELECTION_INTERACTIVE_SELECTORS = [\r\n        'a[href]'")
        && !source.includes("const COMMENT_TEXT_SELECTION_INTERACTIVE_SELECTORS = [\n        'a[href]'"),
        'global comment selection support should allow selection to begin inside linked text');
});

test('split comment replies keep nested cards readable', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const theaterSplit = fs.readFileSync(path.join(__dirname, '..', 'theater-split.user.js'), 'utf8');

    assert.ok(source.includes('margin: 7px 0 0 12px !important;'),
        'extension split replies should use a shallow left offset');
    assert.ok(source.includes('padding: 10px 40px 10px 10px !important;'),
        'extension split reply cards should reclaim text width from the action-menu gutter');
    assert.ok(source.includes('ytd-comment-replies-renderer ytd-comment-replies-renderer'),
        'extension split replies should handle nested reply indentation separately');
    assert.ok(source.includes('flex-basis: 28px !important;'),
        'extension split replies should use smaller avatars to preserve text width');
    assert.ok(source.includes('-webkit-user-select: text !important;'),
        'extension split comments should allow selecting comment text');
    assert.ok(source.includes('yt-core-attributed-string'),
        'extension split comments should cover the newer attributed-string host');
    assert.ok(source.includes('cursor: text !important;'),
        'extension split comment text should use a text cursor');
    assert.ok(source.includes('.thread-hitbox.style-scope.ytd-comment-thread-renderer'),
        'extension split comments should disable the invisible thread hitbox overlay');
    assert.ok(source.includes('pointer-events: auto !important;'),
        'extension split comments should force pointer events onto the actual text containers');
    assert.ok(source.includes('_isSplitCommentTextTarget(target)'),
        'extension split should detect selectable comment-text targets explicitly');
    assert.ok(source.includes("window.addEventListener('selectstart', this._commentSelectionSelectStartHandler, true);"),
        'extension split should protect comment selection before downstream handlers can cancel it');
    assert.ok(source.includes('font-weight: 650 !important;'),
        'extension split replies toggle should read as a deliberate pill control');
    assert.ok(source.includes('margin: 6px 0 0 !important;'),
        'extension split replies toggle should stay visually centered on the guide rail');
    assert.ok(source.includes('padding: 0 14px !important;'),
        'extension split replies toggle should have room to breathe');

    assert.ok(theaterSplit.includes('margin: 7px 0 0 12px !important;'),
        'standalone split replies should use the same shallow left offset');
    assert.ok(theaterSplit.includes('padding: 10px 40px 10px 10px !important;'),
        'standalone split reply cards should reclaim text width from the action-menu gutter');
    assert.ok(theaterSplit.includes('ytd-comment-replies-renderer ytd-comment-replies-renderer'),
        'standalone split replies should handle nested reply indentation separately');
    assert.ok(theaterSplit.includes('-webkit-user-select: text !important;'),
        'standalone split comments should allow selecting comment text');
    assert.ok(theaterSplit.includes('yt-core-attributed-string'),
        'standalone split comments should cover the newer attributed-string host');
    assert.ok(theaterSplit.includes('cursor: text !important;'),
        'standalone split comment text should use a text cursor');
    assert.ok(theaterSplit.includes('.thread-hitbox.style-scope.ytd-comment-thread-renderer'),
        'standalone split comments should disable the invisible thread hitbox overlay');
    assert.ok(theaterSplit.includes('pointer-events: auto !important;'),
        'standalone split comments should force pointer events onto the actual text containers');
    assert.ok(theaterSplit.includes('function isSplitCommentTextTarget(target)'),
        'standalone split should detect selectable comment-text targets explicitly');
    assert.ok(theaterSplit.includes("window.addEventListener('selectstart', commentSelectionSelectStartHandler, true);"),
        'standalone split should protect comment selection before downstream handlers can cancel it');
    assert.ok(theaterSplit.includes('font-weight: 650 !important;'),
        'standalone split replies toggle should read as a deliberate pill control');
    assert.ok(theaterSplit.includes('margin: 6px 0 0 !important;'),
        'standalone split replies toggle should stay visually centered on the guide rail');
    assert.ok(theaterSplit.includes('padding: 0 14px !important;'),
        'standalone split replies toggle should have room to breathe');
});

test('split title header and comment composer stay visually compact', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const theaterSplit = fs.readFileSync(path.join(__dirname, '..', 'theater-split.user.js'), 'utf8');

    assert.ok(source.includes('border-left: 2px solid rgba(var(--ytkit-split-accent-rgb), 0.42) !important;'),
        'extension split title should have a scoped accent edge');
    assert.ok(source.includes('text-wrap: balance !important;'),
        'extension split title should balance long titles');
    assert.ok(source.includes('padding: 8px 10px 8px !important;'),
        'extension comments header should trim the composer bottom padding');
    assert.ok(source.includes('min-height: 34px !important;'),
        'extension split composer placeholder should stay condensed');
    assert.ok(source.includes('ytd-comment-simplebox-renderer:has(> #comment-dialog:not([hidden])) > #thumbnail-input-row'),
        'extension expanded split composer should hide the stale placeholder row');
    assert.ok(source.includes('grid-template-columns: minmax(0, 1fr) !important;'),
        'extension expanded split composer should let the editor take the full width');

    assert.ok(theaterSplit.includes('border-left: 2px solid rgba(var(--ts-accent-rgb), 0.42) !important;'),
        'standalone split title should have the same accent edge');
    assert.ok(theaterSplit.includes('padding: 8px 10px 8px !important;'),
        'standalone comments header should trim the composer bottom padding');
    assert.ok(theaterSplit.includes('min-height: 34px !important;'),
        'standalone split composer placeholder should stay condensed');
    assert.ok(theaterSplit.includes('ytd-comment-simplebox-renderer:has(> #comment-dialog:not([hidden])) > #thumbnail-input-row'),
        'standalone expanded split composer should hide the stale placeholder row');
    assert.ok(theaterSplit.includes('grid-template-columns: minmax(0, 1fr) !important;'),
        'standalone expanded split composer should let the editor take the full width');
});

test('split title header shows upload date and docks quick links beside YouTube logo', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const theaterSplit = fs.readFileSync(path.join(__dirname, '..', 'theater-split.user.js'), 'utf8');

    assert.ok(source.includes('_dockSplitHeader()'),
        'extension split should have a title-header docking routine');
    assert.ok(source.includes('ytkit-split-youtube-link'),
        'extension split should inject a YouTube subscriptions link beside the title');
    assert.ok(source.includes("homeLink.href = 'https://www.youtube.com/feed/subscriptions';"),
        'extension split YouTube logo should navigate to subscriptions');
    assert.ok(source.includes('ytkit-split-upload-date'),
        'extension split should render an upload-date chip in the header');
    assert.ok(source.includes('grid-template-columns: auto auto minmax(0, 1fr) !important;'),
        'extension split title header should reserve a right-aligned date column without crowding controls');
    assert.ok(source.includes('-webkit-line-clamp: 3 !important;'),
        'extension split title should clamp long titles before they overlap the owner card');
    assert.ok(source.includes('overflow-wrap: anywhere !important;'),
        'extension split title should protect the side rail from very long title tokens');
    assert.ok(source.includes("microformat?.publishDate"),
        'extension split upload date should prefer YouTube microformat publishDate');
    assert.ok(source.includes("actions.appendChild(logoWrap);"),
        'extension split should move the player quick-link launcher into the title header');
    assert.ok(source.includes("getFeatureById('stickyVideo')?._dockSplitHeader?.();"),
        'player quick-link injection should hand off to the split title when split is open');
    assert.ok(source.includes("logoWrap?.remove();"),
        'floating launcher cleanup should remove a title-docked launcher when disabled');

    assert.ok(theaterSplit.includes('function dockSplitHeader()'),
        'standalone split should mirror the title-header docking routine');
    assert.ok(theaterSplit.includes('ytkit-split-youtube-link'),
        'standalone split should inject a YouTube subscriptions link beside the title');
    assert.ok(theaterSplit.includes("homeLink.href = 'https://www.youtube.com/feed/subscriptions';"),
        'standalone split YouTube logo should navigate to subscriptions');
    assert.ok(theaterSplit.includes('ytkit-split-upload-date'),
        'standalone split should render the upload-date chip styling');
    assert.ok(theaterSplit.includes('grid-template-columns: auto auto minmax(0, 1fr) !important;'),
        'standalone split title header should reserve a right-aligned date column without crowding controls');
    assert.ok(theaterSplit.includes('-webkit-line-clamp: 3 !important;'),
        'standalone split title should clamp long titles before they overlap the owner card');
    assert.ok(theaterSplit.includes('overflow-wrap: anywhere !important;'),
        'standalone split title should protect the side rail from very long title tokens');
    assert.ok(theaterSplit.includes("actions.appendChild(logoWrap);"),
        'standalone split should move an existing player quick-link launcher if present');
});

test('split live chat gets a video info header and neutral divider hover', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const theaterSplit = fs.readFileSync(path.join(__dirname, '..', 'theater-split.user.js'), 'utf8');

    assert.ok(source.includes('_ensureSplitLiveHeader(rightPct)'),
        'extension split should create a live video info header');
    assert.ok(source.includes("const type = domType === 'live' ? 'live' : (responseType || domType || 'standard');"),
        'extension video type detection should let hydrated DOM live signals override stale playerResponse VOD');
    assert.ok(source.includes("if (chatEl) this._videoType = VideoTypeDetector.refresh();"),
        'extension split should re-detect chat video type at expand time');
    assert.ok(source.includes("classList.toggle('ytkit-split-live', type === 'live')"),
        'extension split should mark live splits distinctly for cleanup and styling');
    assert.ok(source.includes('ytkit-split-live-header'),
        'extension live header should use a durable class for cleanup');
    assert.ok(source.includes("actions.className = 'ytkit-split-live-actions';"),
        'extension live header should include an actions dock');
    assert.ok(source.includes('_findSplitSubscribeControl()'),
        'extension live header should locate the native subscribe/unsubscribe control');
    assert.ok(source.includes('_pinSplitLiveHeaderActions(controls, actions)'),
        'extension live header should visually pin native live actions without moving them from YouTube metadata');
    assert.ok(source.includes("control.dataset.ytkitSplitLivePinned = '1';"),
        'extension live header should tag pinned native controls for restoration');
    assert.ok(source.includes("control.style.setProperty('position', 'fixed', 'important');"),
        'extension live header should place native controls with fixed positioning so native menus keep working');
    assert.ok(source.includes('calc(100vh - ${liveHeaderTop}px)'),
        'extension live chat should be offset below the live header');
    assert.ok(source.includes('background:#0a0d13'),
        'extension divider base should be opaque enough to prevent accent bleed-through');
    assert.ok(source.includes("divider.style.background='#111827'"),
        'extension divider hover should use opaque neutral gray instead of blue-purple');
    assert.ok(source.includes("pip.style.color='rgba(148,163,184,0.64)'"),
        'extension divider grip should pin currentColor to neutral gray');
    assert.ok(!source.includes("divider.style.background='rgba(59,130,246,0.22)'"),
        'extension divider hover should not use the old blue-purple color');

    assert.ok(theaterSplit.includes('function ensureSplitLiveHeader(rightPct)'),
        'standalone split should mirror the live video info header');
    assert.ok(theaterSplit.includes('const liveBadgeActive = liveBadge'),
        'standalone split should prefer hydrated live badge signals before treating chat as VOD');
    assert.ok(theaterSplit.includes("document.body.classList.toggle('ts-live', type === 'live')"),
        'standalone split should mark live splits distinctly for cleanup and styling');
    assert.ok(theaterSplit.includes('ytkit-split-live-header'),
        'standalone live header should use the same durable class');
    assert.ok(theaterSplit.includes("actions.className = 'ytkit-split-live-actions';"),
        'standalone live header should include an actions dock');
    assert.ok(theaterSplit.includes('function findSubscribeControl()'),
        'standalone live header should locate the native subscribe/unsubscribe control');
    assert.ok(theaterSplit.includes('function pinLiveHeaderActions(controls, actions)'),
        'standalone live header should visually pin native live actions without moving them from YouTube metadata');
    assert.ok(theaterSplit.includes("control.dataset.ytkitSplitLivePinned = '1';"),
        'standalone live header should tag pinned native controls for restoration');
    assert.ok(theaterSplit.includes("control.style.setProperty('position', 'fixed', 'important');"),
        'standalone live header should place native controls with fixed positioning so native menus keep working');
    assert.ok(theaterSplit.includes('calc(100vh - ${liveHeaderTop}px)'),
        'standalone live chat should be offset below the live header');
    assert.ok(theaterSplit.includes('background:#0a0d13'),
        'standalone divider base should be opaque enough to prevent accent bleed-through');
    assert.ok(theaterSplit.includes("divider.style.background = '#111827'"),
        'standalone divider hover should use opaque neutral gray instead of blue-purple');
    assert.ok(theaterSplit.includes("pip.style.color = 'rgba(148,163,184,0.64)'"),
        'standalone divider grip should pin currentColor to neutral gray');
    assert.ok(!theaterSplit.includes("divider.style.background = 'rgba(59,130,246,0.22)'"),
        'standalone divider hover should not use the old blue-purple color');

    const extensionRestoreStart = source.indexOf('_restoreSplitActionDock()');
    const extensionRestore = source.slice(extensionRestoreStart, source.indexOf('// Bulk set/remove style properties', extensionRestoreStart));
    assert.ok(extensionRestore.indexOf('this._splitActionDockMoved = null;') < extensionRestore.indexOf('this._removeSplitLiveHeader();'),
        'extension should restore moved native controls before removing the live header');
    assert.ok(extensionRestore.indexOf('this._restoreSplitLiveHeaderActionPins();') < extensionRestore.indexOf('this._removeSplitLiveHeader();'),
        'extension should restore visually pinned native controls before removing the live header');

    const standaloneRestoreStart = theaterSplit.indexOf('function restoreActionDock()');
    const standaloneRestore = theaterSplit.slice(standaloneRestoreStart, theaterSplit.indexOf('// ── Chat helpers', standaloneRestoreStart));
    assert.ok(standaloneRestore.indexOf('actionDockMoved = null;') < standaloneRestore.indexOf('removeSplitLiveHeader();'),
        'standalone should restore moved native controls before removing the live header');
    assert.ok(standaloneRestore.indexOf('restoreLiveHeaderActionPins();') < standaloneRestore.indexOf('removeSplitLiveHeader();'),
        'standalone should restore visually pinned native controls before removing the live header');
});

test('split title and owner cards align while quick links stay above the video', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const theaterSplit = fs.readFileSync(path.join(__dirname, '..', 'theater-split.user.js'), 'utf8');

    const blockBetween = (contents, startNeedle, endNeedle, label, { fromStart = false } = {}) => {
        const start = fromStart ? contents.indexOf(startNeedle) : contents.lastIndexOf(startNeedle);
        assert.ok(start > -1, `${label} should exist`);
        const end = contents.indexOf(endNeedle, start);
        assert.ok(end > start, `${label} should end after it starts`);
        return contents.slice(start, end);
    };

    const extensionTopRow = blockBetween(
        source,
        '#below[style*="position"] ytd-watch-metadata #top-row',
        '#below[style*="position"] ytd-watch-metadata #title',
        'extension split top-row rule'
    );
    const extensionOwner = blockBetween(
        source,
        '#below[style*="position"] #owner,',
        '#below[style*="position"] #owner ytd-video-owner-renderer',
        'extension split owner rule'
    );
    const standaloneTopRow = blockBetween(
        theaterSplit,
        '#below[style*="position"] ytd-watch-metadata #top-row',
        '#below[style*="position"] ytd-watch-metadata #title',
        'standalone split top-row rule',
        { fromStart: true }
    );
    const standaloneOwner = blockBetween(
        theaterSplit,
        '#below[style*="position"] #owner,',
        '#below[style*="position"] #owner ytd-video-owner-renderer',
        'standalone split owner rule'
    );
    const extensionTitleCard = blockBetween(
        source,
        '#below[style*="position"] ytd-watch-metadata #title {',
        '#below[style*="position"] ytd-watch-metadata #title:has',
        'extension split title card rule'
    );
    const standaloneTitleCard = blockBetween(
        theaterSplit,
        '#below[style*="position"] ytd-watch-metadata #title {',
        '#below[style*="position"] ytd-watch-metadata #title:has',
        'standalone split title card rule',
        { fromStart: true }
    );
    const extensionTitleBar = blockBetween(
        source,
        '#title .ytkit-split-title-bar {',
        '#title .ytkit-split-youtube-link',
        'extension split title header rule'
    );
    const standaloneTitleBar = blockBetween(
        theaterSplit,
        '#title .ytkit-split-title-bar {',
        '#title .ytkit-split-youtube-link',
        'standalone split title header rule',
        { fromStart: true }
    );
    const extensionTitleText = blockBetween(
        source,
        '#title h1,',
        '#title yt-formatted-string',
        'extension split title text rule'
    );
    const standaloneTitleText = blockBetween(
        theaterSplit,
        '#title h1,',
        '#title yt-formatted-string',
        'standalone split title text rule',
        { fromStart: true }
    );

    for (const [block, label] of [
        [extensionTopRow, 'extension top row'],
        [extensionOwner, 'extension owner card'],
        [standaloneTopRow, 'standalone top row'],
        [standaloneOwner, 'standalone owner card'],
    ]) {
        assert.ok(block.includes('width: 100% !important;'), `${label} should span the metadata column`);
        assert.ok(block.includes('max-width: none !important;'), `${label} should not keep YouTube's narrow card width`);
        assert.ok(block.includes('justify-self: stretch !important;'), `${label} should align with the title card`);
    }

    for (const [block, label] of [
        [extensionTitleCard, 'extension title card'],
        [standaloneTitleCard, 'standalone title card'],
    ]) {
        assert.ok(block.includes('display: grid !important;'), `${label} should stack header and title text predictably`);
        assert.ok(block.includes('row-gap: 10px !important;'), `${label} should keep breathing room between controls and title`);
        assert.ok(block.includes('box-sizing: border-box !important;'), `${label} should include padding in its measured height`);
    }

    for (const [block, label] of [
        [extensionTitleBar, 'extension title header'],
        [standaloneTitleBar, 'standalone title header'],
    ]) {
        assert.ok(block.includes('grid-template-columns: auto auto minmax(0, 1fr) !important;'),
            `${label} should reserve a right-aligned date column without crowding controls`);
        assert.ok(block.includes('width: 100% !important;'), `${label} should span the full title card`);
    }

    for (const [block, label] of [
        [extensionTitleText, 'extension title text'],
        [standaloneTitleText, 'standalone title text'],
    ]) {
        assert.ok(block.includes('-webkit-line-clamp: 3 !important;'), `${label} should clamp before it overlaps the owner card`);
        assert.ok(block.includes('overflow: hidden !important;'), `${label} should be contained inside the title card`);
        assert.ok(block.includes('overflow-wrap: anywhere !important;'), `${label} should protect against long unbroken tokens`);
    }

    for (const [contents, label] of [
        [source, 'extension owner card'],
        [theaterSplit, 'standalone owner card'],
    ]) {
        assert.ok(contents.includes('"owner dock page watch"'), `${label} should keep channel identity and actions on one row`);
        assert.ok(contents.includes('"sub dock page watch"'), `${label} should keep the subscribe row visually tied to the docked actions`);
        assert.ok(!contents.includes('"owner owner owner owner"'), `${label} should not reserve a full empty row for identity`);
        assert.ok(contents.includes('justify-items: start !important;'), `${label} should anchor channel text to the avatar`);
        assert.ok(contents.includes('text-align: left !important;'), `${label} should keep channel metadata left-aligned`);
        assert.ok(contents.includes('min-width: 118px !important;'), `${label} should give the subscribe control an intentional pill width`);
    }

    const standaloneNotification = blockBetween(
        theaterSplit,
        '#below[style*="position"] #owner #subscribe-button,',
        '#below[style*="position"] #owner #subscribe-button .yt-spec-button-shape-next',
        'standalone owner notification controls',
        { fromStart: true }
    );

    assert.match(
        source,
        /#below\[style\*="position"\] #owner #subscribe-button,[\s\S]*?overflow: visible !important;[\s\S]*?pointer-events: auto !important;[\s\S]*?#notification-preference-button \*[\s\S]*?z-index: 40 !important;/,
        'extension notification controls should not clip or deactivate the bell dropdown'
    );

    for (const [block, label] of [[standaloneNotification, 'standalone notification controls']]) {
        assert.ok(block.includes('overflow: visible !important;'), `${label} should not clip the bell dropdown trigger`);
        assert.ok(block.includes('pointer-events: auto !important;'), `${label} should keep the native bell click target active`);
        assert.ok(block.includes('z-index: 40 !important;'), `${label} should sit above the owner action dock`);
        assert.ok(block.includes('#notification-preference-button *'), `${label} should preserve clicks on nested YouTube button parts`);
    }

    assert.ok(source.includes('html:is(.ytkit-split-active, .ytkit-split-open) ytd-popup-container'),
        'extension split should raise YouTube popup containers from the polished split layer');
    assert.ok(source.includes('html.ytkit-split-active ytd-popup-container'),
        'extension split should raise YouTube popup containers from the early split layer');
    assert.ok(source.includes('html:is(.ytkit-split-active, .ytkit-split-open) tp-yt-iron-dropdown'),
        'extension split should raise YouTube iron dropdowns');
    assert.ok(source.includes('html:is(.ytkit-split-active, .ytkit-split-open) ytd-menu-popup-renderer'),
        'extension split should raise native menu popup renderers');
    assert.ok(theaterSplit.includes('body.ts-split ytd-popup-container'),
        'standalone split should raise YouTube popup containers');
    assert.ok(theaterSplit.includes('body.ts-split tp-yt-iron-dropdown'),
        'standalone split should raise YouTube iron dropdowns');
    assert.ok(theaterSplit.includes('body.ts-split ytd-menu-popup-renderer'),
        'standalone split should raise native menu popup renderers');
    const extensionNativePopup = blockBetween(
        source,
        'html:is(.ytkit-split-active, .ytkit-split-open) ytd-popup-container',
        '#below[style*="position"] ytd-watch-metadata',
        'extension native split popup stack rule'
    );
    const standaloneNativePopup = blockBetween(
        theaterSplit,
        'body.ts-split ytd-popup-container',
        'body.ts-split #below[style*="position"] ytd-watch-metadata',
        'standalone native split popup stack rule',
        { fromStart: true }
    );
    assert.ok(extensionNativePopup.includes('z-index: 2147483647 !important;'),
        'extension native popup stack should sit above the split player');
    assert.ok(standaloneNativePopup.includes('z-index: 2147483647 !important;'),
        'standalone native popup stack should sit above the split player');

    const extensionQuickLinks = blockBetween(
        source,
        '#ytkit-po-logo-wrap .ytkit-ql-drop',
        '#title .ytkit-split-upload-date',
        'extension split quick links dropdown rule'
    );
    const standaloneQuickLinks = blockBetween(
        theaterSplit,
        '#ytkit-po-logo-wrap .ytkit-ql-drop',
        '#title .ytkit-split-upload-date',
        'standalone split quick links dropdown rule'
    );

    for (const [contents, block, label] of [
        [source, extensionQuickLinks, 'extension quick links'],
        [theaterSplit, standaloneQuickLinks, 'standalone quick links'],
    ]) {
        assert.ok(contents.includes('#ytkit-po-logo-wrap.ytkit-ql-open'), `${label} should raise the open launcher`);
        assert.ok(contents.includes('#title:has(#ytkit-po-logo-wrap.ytkit-ql-open)'), `${label} should raise the title card above sibling controls`);
        assert.ok(contents.includes('z-index: 2147483646 !important;'), `${label} should lift the open title stack above split cards`);
        assert.ok(block.includes('right: auto !important;'), `${label} should stop opening behind the video edge`);
        assert.ok(block.includes('left: 0 !important;'), `${label} should open into the metadata panel`);
        assert.ok(block.includes('z-index: 2147483647 !important;'), `${label} should stack above the player`);
        assert.ok(block.includes('max-height: min(440px, calc(100vh - 92px)) !important;'),
            `${label} should remain scrollable in shorter viewports`);
    }
});

test('split theater supports middle-mouse autoscroll in the right column', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');
    const theaterSplit = fs.readFileSync(path.join(__dirname, '..', 'theater-split.user.js'), 'utf8');

    assert.ok(source.includes('_middleMouseHandler'),
        'extension split should keep a removable middle-mouse listener');
    assert.ok(source.includes('_startSplitAutoscroll(e)'),
        'extension split should start a custom autoscroll loop');
    assert.ok(source.includes('e.button !== 1'),
        'extension autoscroll should only arm from the middle mouse button');
    assert.ok(source.includes('_shouldIgnoreSplitAutoscroll(e.target)'),
        'extension autoscroll should skip links and native YouTube controls');
    assert.ok(source.includes("'a[href]'"),
        'extension autoscroll ignore list should preserve middle-click-open-new-tab');
    assert.ok(source.includes('state.scrollEl.scrollTop += velocity * dt'),
        'extension autoscroll should scroll at a cursor-distance-controlled rate');
    assert.ok(source.includes('requestAnimationFrame(tick)'),
        'extension autoscroll should use animation frames instead of timers');
    assert.ok(source.includes("document.addEventListener('mouseup', state.upHandler, true);"),
        'extension autoscroll should only run while the middle mouse button is held');
    assert.ok(source.includes("document.removeEventListener('mouseup', state.upHandler, true);"),
        'extension autoscroll should clean up the hold-to-scroll mouseup listener');
    assert.ok(!source.includes('ytkit-split-autoscroll-marker'),
        'extension autoscroll should not show a custom on-screen marker');
    assert.ok(source.includes("document.addEventListener('mousedown', this._middleMouseHandler, true);"),
        'extension split should listen on document capture for fixed-position comment panes');
    assert.ok(source.includes("document.removeEventListener('mousedown', this._middleMouseHandler, true);"),
        'extension split should remove the middle-mouse listener on teardown');
    assert.ok(source.includes('this._stopSplitAutoscroll();'),
        'extension split should stop autoscroll during collapse and teardown');

    assert.ok(theaterSplit.includes('middleMouseHandler = startSplitAutoscroll;'),
        'standalone split should keep a removable middle-mouse listener');
    assert.ok(theaterSplit.includes('function startSplitAutoscroll(e)'),
        'standalone split should start a custom autoscroll loop');
    assert.ok(theaterSplit.includes('e.button !== 1'),
        'standalone autoscroll should only arm from the middle mouse button');
    assert.ok(theaterSplit.includes('shouldIgnoreSplitAutoscroll(e.target)'),
        'standalone autoscroll should skip links and native YouTube controls');
    assert.ok(theaterSplit.includes('state.scrollEl.scrollTop += velocity * dt'),
        'standalone autoscroll should scroll at a cursor-distance-controlled rate');
    assert.ok(theaterSplit.includes('requestAnimationFrame(tick)'),
        'standalone autoscroll should use animation frames instead of timers');
    assert.ok(theaterSplit.includes("document.addEventListener('mouseup', state.upHandler, true);"),
        'standalone autoscroll should only run while the middle mouse button is held');
    assert.ok(theaterSplit.includes("document.removeEventListener('mouseup', state.upHandler, true);"),
        'standalone autoscroll should clean up the hold-to-scroll mouseup listener');
    assert.ok(!theaterSplit.includes('ts-autoscroll-marker'),
        'standalone autoscroll should not show a custom on-screen marker');
    assert.ok(theaterSplit.includes("document.addEventListener('mousedown', middleMouseHandler, true);"),
        'standalone split should listen on document capture for fixed-position comment panes');
    assert.ok(theaterSplit.includes("document.removeEventListener('mousedown', middleMouseHandler, true);"),
        'standalone split should remove the middle-mouse listener on teardown');
    assert.ok(theaterSplit.includes('stopSplitAutoscroll();'),
        'standalone split should stop autoscroll during collapse and teardown');
});

test('watchPageRestyle gives native service popups the premium comment-card treatment', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'watchPageRestyle'");
    const end = source.indexOf("id: 'chatStyleComments'");
    assert.ok(start > -1 && end > start, 'watchPageRestyle block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('const popupCss = `'), 'watchPageRestyle should define a dedicated native popup restyle');
    assert.ok(block.includes('_popupStyleElement'), 'watchPageRestyle should manage native popup styles separately from the core watch-page CSS');
    assert.ok(block.includes(':is(ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer)'),
        'watchPageRestyle should cover both service and navigation-style native popups');
    assert.ok(block.includes(':is(ytd-popup-container tp-yt-iron-dropdown, tp-yt-iron-dropdown.yt-live-chat-app)'),
        'watchPageRestyle should target both standard and live-chat native popup hosts');
    assert.ok(block.includes('#contentWrapper:has(ytd-menu-popup-renderer :is(ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer))'),
        'watchPageRestyle should target native YouTube service and navigation popup wrappers');
    assert.ok(block.includes('border-radius: 18px !important;'),
        'watchPageRestyle should give native service popups a rounded premium surface');
    assert.ok(block.includes('backdrop-filter: blur(18px) saturate(1.08) !important;'),
        'watchPageRestyle should add a layered glass treatment to native service popups');
    assert.ok(block.includes(':is(ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer).iron-selected'),
        'watchPageRestyle should style the active popup row state');
    assert.ok(block.includes('margin-right: 10px !important;'),
        'watchPageRestyle should preserve a readable icon-to-label gap for native popup rows');
    assert.ok(block.includes('ytd-menu-navigation-item-renderer > a'),
        'watchPageRestyle should stretch navigation popup anchors across the full menu width');
    assert.ok(block.includes('width: 100% !important;'),
        'watchPageRestyle should stretch native popup rows to the full menu width');
    assert.ok(block.includes('tp-yt-paper-listbox.yt-dropdown-menu'),
        'watchPageRestyle should also cover YouTube two-line dropdown menus');
    assert.ok(block.includes('#subtitle.style-scope.yt-dropdown-menu'),
        'watchPageRestyle should style two-line dropdown subtitles to match the premium popup treatment');
});

test('chatStyleComments gives creator hearts a dedicated compact badge treatment', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'sponsorBlock'"); 
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('ytd-comment-engagement-bar #creator-heart-button #hearted-thumbnail'),
        'chatStyleComments should hide the creator avatar thumbnail inside the compact heart control');
    assert.ok(block.includes('ytd-comment-engagement-bar #creator-heart-button #hearted-border'),
        'chatStyleComments should remove the oversized native heart border layer');
    assert.ok(block.includes('ytd-comment-engagement-bar #creator-heart-button #hearted'),
        'chatStyleComments should keep a dedicated heart glyph visible');
    assert.ok(block.includes('radial-gradient(circle at 30% 30%'),
        'chatStyleComments should give creator hearts a purpose-built compact badge surface');
});

test('chatStyleComments styles creator-heart tooltips to match the premium comment UI', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'sponsorBlock'");
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('tp-yt-paper-tooltip.ytd-creator-heart-renderer #tooltip'),
        'chatStyleComments should target the creator-heart tooltip body');
    assert.ok(block.includes('backdrop-filter: blur(12px) saturate(1.08) !important;'),
        'chatStyleComments should give the creator-heart tooltip the same premium glass finish');
    assert.ok(block.includes('rgba(255, 228, 232, 0.96)'),
        'chatStyleComments should tint the creator-heart tooltip copy to match the heart accent');
});

test('chatStyleComments removes reply-composer underline chrome', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'sponsorBlock'");
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('#reply-dialog ytd-commentbox tp-yt-paper-input-container[use-v2-underline]::before'),
        'chatStyleComments should disable the reply composer underline pseudo-element');
    assert.ok(block.includes('#reply-dialog ytd-commentbox .add-on-content'),
        'chatStyleComments should also hide reply composer add-on chrome below the field');
    assert.ok(block.includes('#reply-dialog ytd-commentbox #creation-box'),
        'chatStyleComments should clear reply composer box borders');
});

test('chatStyleComments keeps comment action controls on a single row', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'sponsorBlock'");
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('flex-wrap: nowrap !important;'),
        'chatStyleComments should keep comment action rows from wrapping onto a second line');
    assert.ok(block.includes('#comments ytd-comment-engagement-bar #toolbar > *'),
        'chatStyleComments should lock every comment action item to its own non-stretching flex slot');
    assert.ok(block.includes('#comments ytd-comment-engagement-bar #reply-button-end .yt-spec-button-shape-next'),
        'chatStyleComments should keep the Reply control inline with the rest of the action row');
});

test('chatStyleComments hides dislike buttons in compact comment actions', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'sponsorBlock'");
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('#comments ytd-comment-engagement-bar #dislike-button'),
        'chatStyleComments should target the comment dislike control directly');
    assert.ok(block.includes('display: none !important;'),
        'chatStyleComments should hide the comment dislike control to preserve action-row space');
});

test('chatStyleComments lets comment text use nearly the full card width', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'chatStyleComments'");
    const end = source.indexOf("id: 'sponsorBlock'");
    assert.ok(start > -1 && end > start, 'chatStyleComments block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes('padding: 6px 6px 6px !important;'),
        'chatStyleComments should slim the comment card padding so text can use more of the card width');
    assert.ok(block.includes('gap: 6px !important;'),
        'chatStyleComments should reduce the avatar-to-text gutter');
    assert.ok(block.includes('padding-right: 6px !important;'),
        'chatStyleComments should reduce the reserved right-side gutter on comment content');
    assert.ok(block.includes("--ytd-comment-thumb-dimension', '24px'"),
        'chatStyleComments should tighten the renderer thumb dimension so the avatar lane stops wasting comment width');
    assert.ok(block.includes('max-width: none !important;'),
        'chatStyleComments should remove remaining content-width caps from comment text wrappers');
    assert.ok(block.includes("removeAttribute('optimal-reading-width-comments')"),
        'chatStyleComments should neutralize YouTube optimal-reading-width comment mode when it constrains the compact layout');
});

test('videoScreenshot exposes capture states and mutation-driven reinjection', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf("id: 'videoScreenshot'");
    const end = source.indexOf("id: 'perChannelSpeed'");
    assert.ok(start > -1 && end > start, 'videoScreenshot block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes("_setState('capturing')"), 'videoScreenshot should expose an explicit capturing state');
    assert.ok(block.includes('_copyBlobToClipboard(blob)'), 'videoScreenshot should report clipboard-copy outcomes instead of silently ignoring them');
    assert.ok(block.includes("addMutationRule('videoScreenshot'"), 'videoScreenshot should recover when player controls hydrate late');
    assert.ok(block.includes("btn.addEventListener('click'"), 'videoScreenshot should use an event listener rather than relying on btn.onclick');
});

// ── textarea input handler: must be debounced ──

test('textarea input handler uses debounce for feature reinit', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Find the textarea input handler section
    const idx = source.indexOf('_textareaReinitTimer');
    assert.ok(idx > -1, 'textarea reinit should use a debounce timer (_textareaReinitTimer)');

    // Should not have direct destroy/init in the input handler without debounce
    const handlerSection = source.substring(
        source.indexOf("// Textarea input"),
        source.indexOf("// Select dropdown")
    );
    assert.ok(handlerSection.includes('setTimeout'), 'textarea handler should use setTimeout for debounce');
});

// ── textarea value: must use nullish coalescing ──

test('textarea value uses nullish coalescing to preserve falsy values', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // The textarea value assignment should use ?? not ||
    const textareaValueMatch = source.match(/textarea\.value\s*=\s*appState\.settings\[f\.settingKey \|\| f\.id\]\s*\?\?/);
    assert.ok(textareaValueMatch, 'textarea value should use ?? operator, not ||');
});

// ── guard block: all destructured functions must be checked ──

test('guard block checks all destructured core functions', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Key functions that must be in the guard block
    const mustGuard = [
        'flushPendingStorageWrites',
        'shouldBuildPrimaryUI',
        'isTopLevelFrame',
        'isLiveChatFrame',
        'storageReadJSON',
        'storageWriteJSON',
    ];

    const guardBlock = source.substring(
        source.indexOf('if (\n        !addMutationRule'),
        source.indexOf("console.error('[YTKit] Core helpers missing")
    );

    for (const fn of mustGuard) {
        assert.ok(guardBlock.includes(`!${fn}`), `guard block must check for ${fn}`);
    }
});

test('MediaDL probe rejects legacy localhost services without Astra health identity', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf('const MediaDLManager = {');
    const end = source.indexOf('showInstallPrompt(mode)', start);
    assert.ok(start > -1 && end > start, 'MediaDLManager block should exist');

    const block = source.slice(start, end);
    assert.ok(block.includes("_SERVICE_ID: 'astra-downloader'"), 'MediaDLManager should define the expected service id');
    assert.ok(block.includes('data.service === this._SERVICE_ID'), 'MediaDLManager should prefer explicit Astra health identity');
    assert.ok(block.includes('data.token_required === true && Number.isInteger(data.port)'), 'MediaDLManager should only accept legacy health responses with the Astra schema');
    assert.ok(block.includes('Ignoring non-Astra downloader response'), 'MediaDLManager should log ignored localhost impostor responses');
});

// ── findBalancedObjectLiteral: edge cases ──

test('findBalancedObjectLiteral handles nested braces in strings', () => {
    const source = `
        defaults: {
            key: "value with { braces }",
            nested: { a: 1 }
        }
    `;
    const result = findBalancedObjectLiteral(source, 'defaults:');
    assert.ok(result, 'should find the object literal');
    assert.ok(result.startsWith('{'), 'should start with {');
    assert.ok(result.endsWith('}'), 'should end with }');
});

test('findBalancedObjectLiteral handles template literals', () => {
    const source = "defaults: { key: `template with { braces }`, b: 2 }";
    const result = findBalancedObjectLiteral(source, 'defaults:');
    assert.ok(result, 'should handle template literals');
    assert.ok(result.includes('b: 2'), 'should include full object');
});

test('findBalancedObjectLiteral handles comments with braces', () => {
    const source = `
        defaults: {
            // this { brace should be ignored
            key: true,
            /* also { this one } */
            other: false
        }
    `;
    const result = findBalancedObjectLiteral(source, 'defaults:');
    assert.ok(result, 'should handle comments');
    assert.ok(result.includes('other: false'), 'should include full object after comments');
});

test('findBalancedObjectLiteral returns null for missing token', () => {
    assert.equal(findBalancedObjectLiteral('no match here', 'defaults:'), null);
});

// ── Hardening pass: ensure previously-dead unsafe innerHTML assignments stayed removed ──

test('ytkit.js has no unsafe innerHTML reset on freshly created elements', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Pattern: assign innerHTML to empty string on a variable that was just
    // created via document.createElement. Such assignments are dead code and
    // also trigger Trusted Types violations on strict YouTube pages.
    const badPattern = /document\.createElement\([^)]+\)[\s\S]{0,200}?\.innerHTML\s*=\s*['"]['"]\s*;/;
    assert.ok(!badPattern.test(source), 'freshly created DOM elements must not be reset via innerHTML = ""');
});

test('ytkit.js Reddit discussion links validate permalink via URL constructor', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // The hardened flow replaces raw concatenation with a URL constructor
    // guard that also requires the result to stay on reddit.com.
    assert.ok(source.includes("new URL(String(d.permalink || ''), 'https://www.reddit.com')"),
        'Reddit permalink should be normalised through the URL constructor');
    assert.ok(/reddit discussion|ytkit-rc-row[\s\S]*?rel = 'noopener noreferrer'/i.test(source)
        || source.includes("row.rel = 'noopener noreferrer';"),
        'Reddit discussion rows should set rel="noopener noreferrer"');
});

test('subtitle download no longer carries the unused unsafe _decode helper', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Dead code that violated Trusted Types has been removed.
    assert.ok(!/_decode\s*\(\s*s\s*\)\s*\{[\s\S]{0,100}?t\.innerHTML\s*=\s*s/.test(source),
        'subtitle _decode(s) with innerHTML=s must stay removed');
});

test('blocked channel avatar initial survives surrogate-pair names', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // Array.from() iterates by code point so emoji/CJK-only channel names
    // no longer render half of a surrogate pair in the avatar bubble.
    assert.ok(source.includes("Array.from(ch.name || ch.id || '?')[0]"),
        'blocked channel avatar initial should iterate by code point, not UTF-16 unit');
});

test('download progress panel close button stops the poll loop immediately', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    // The close handler synchronously flips `stopped` and clears the pending
    // setTimeout (via stopPolling()) so we don't keep hitting the local
    // downloader for a panel the user dismissed. The switch from setInterval
    // to a self-scheduling setTimeout chain (audit pass) also prevents two
    // polls from overlapping when the downloader is slow.
    const start = source.indexOf('function showDownloadProgress');
    assert.ok(start > -1, 'showDownloadProgress should exist');
    const block = source.slice(start, start + 16000);
    assert.ok(/closeBtn\.addEventListener\('click'[\s\S]*?stopPolling\(\)[\s\S]*?panel\.remove\(\)/.test(block),
        'close button should call stopPolling() before removing the panel');
    assert.ok(/const\s+stopPolling\s*=\s*\(\s*\)\s*=>\s*\{[\s\S]*?stopped\s*=\s*true[\s\S]*?clearTimeout\(pollTimer\)/.test(block),
        'stopPolling must flip the stopped flag and clear any pending setTimeout');
});

test('handleFileImport guards against oversized files and FileReader errors', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'ytkit.js'), 'utf8');

    const start = source.indexOf('function handleFileImport');
    assert.ok(start > -1, 'handleFileImport should exist');
    const block = source.slice(start, start + 1500);
    assert.ok(block.includes('IMPORT_MAX_BYTES'), 'handleFileImport should enforce an import size cap');
    assert.ok(block.includes('reader.onerror'), 'handleFileImport should surface FileReader errors');
});

test('core storage retry rebuild uses a prototype-less merge target', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'core', 'storage.js'), 'utf8');

    // Regression check: before this fix, a retry would replace the no-prototype
    // pendingStorageWrites with a regular object literal, reintroducing a
    // proto-pollution footgun on a hot storage path.
    assert.ok(!/pendingStorageWrites\s*=\s*\{\s*\.\.\.writes/.test(source),
        'storage retry must not rebuild pendingStorageWrites with an object literal');
    assert.ok(source.includes('Object.create(null)'),
        'storage module should keep using Object.create(null) for pending writes');
});
