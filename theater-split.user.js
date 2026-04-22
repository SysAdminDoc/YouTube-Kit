// ==UserScript==
// @name         Theater Split v1.0.5
// @namespace    https://github.com/SysAdminDoc/Astra-Deck
// @version      1.0.6
// @updateURL      https://raw.githubusercontent.com/SysAdminDoc/Astra-Deck/main/theater-split.user.js
// @downloadURL    https://raw.githubusercontent.com/SysAdminDoc/Astra-Deck/main/theater-split.user.js
// @description  Fullscreen video on YouTube watch pages. Scroll down to split: video left, comments/chat right. Scroll up to return.
// @author       Matthew Parker
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @exclude      https://m.youtube.com/*
// @exclude      https://studio.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ── Early CSS (anti-FOUC) ──────────────────────────────────────────────
    const earlyStyle = document.createElement('style');
    earlyStyle.textContent = `
        /* Hide masthead when overlay is active */
        body.ts-active ytd-masthead,
        body.ts-active #masthead-container { display: none !important; }
        /* Prevent page scroll behind overlay */
        body.ts-active { overflow: hidden !important; }
        /* Split overlay base */
        #ts-wrapper { display:none; }
        body.ts-active #ts-wrapper { display:flex; }
        /* Fullscreen guard — never interfere with native fullscreen */
        ytd-watch-flexy[fullscreen] ~ #ts-wrapper,
        body:fullscreen #ts-wrapper { display:none !important; }

        /* ── CRITICAL: Kill view-transition-name containing blocks ──
           YouTube sets view-transition-name on #secondary, #below, and
           #player-full-bleed-container. This creates containing blocks
           that trap position:fixed children — they position relative to
           the ancestor instead of the viewport. Must clear these so our
           position:fixed chat/comments can escape to the viewport. */
        body.ts-active #secondary,
        body.ts-active #below,
        body.ts-active #player-full-bleed-container,
        body.ts-active #columns,
        body.ts-active ytd-watch-flexy {
            view-transition-name: none !important;
        }

        /* ── Chat frame overrides when split is active ── */
        body.ts-split ytd-live-chat-frame#chat,
        body.ts-split ytd-live-chat-frame {
            height: 100vh !important;
            max-height: none !important;
            min-height: 0 !important;
            visibility: visible !important;
            display: flex !important;
            flex-direction: column !important;
        }
        body.ts-split #chat-container {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            visibility: visible !important;
        }
        body.ts-split ytd-live-chat-frame#chat > iframe,
        body.ts-split ytd-live-chat-frame > iframe {
            flex: 1 !important;
            height: 100% !important;
            min-height: 0 !important;
            max-height: none !important;
        }
        /* Override loading visibility:hidden on chat */
        body.ts-active ytd-watch-flexy.loading ytd-live-chat-frame#chat,
        body.ts-active ytd-watch-flexy:not([ghost-cards-enabled]).loading #chat {
            visibility: visible !important;
        }

        /* ── Theater Split comments polish ── */
        body.ts-active {
            --ts-accent-rgb: var(--ytkit-accent-rgb, 245, 158, 11);
        }
        body.ts-split #below[style*="position"] {
            color-scheme: dark !important;
        }
        body.ts-split ytd-popup-container,
        body.ts-split tp-yt-iron-dropdown,
        body.ts-split ytd-menu-popup-renderer,
        body.ts-split ytd-multi-page-menu-renderer {
            z-index: 2147483647 !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata {
            margin: 0 0 14px !important;
            padding: 0 0 14px !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #top-row {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) !important;
            width: 100% !important;
            max-width: none !important;
            min-width: 0 !important;
            justify-self: stretch !important;
            box-sizing: border-box !important;
            gap: 12px !important;
            margin: 0 0 12px !important;
            padding: 0 !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title {
            position: relative !important;
            z-index: 60 !important;
            margin: 0 !important;
            padding: 10px 12px 10px 14px !important;
            border: 1px solid rgba(255, 255, 255, 0.075) !important;
            border-left: 2px solid rgba(var(--ts-accent-rgb), 0.42) !important;
            border-radius: 15px !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.050), rgba(255, 255, 255, 0.018)),
                rgba(11, 15, 23, 0.76) !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.034), 0 12px 24px rgba(2, 6, 12, 0.18) !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title:has(#ytkit-po-logo-wrap.ytkit-ql-open) {
            z-index: 2147483646 !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-title-bar {
            display: flex !important;
            align-items: center !important;
            flex-wrap: wrap !important;
            gap: 7px !important;
            min-width: 0 !important;
            margin: 0 0 8px !important;
            position: relative !important;
            z-index: 5 !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-youtube-link {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex: 0 0 auto !important;
            width: 32px !important;
            min-width: 32px !important;
            height: 28px !important;
            min-height: 28px !important;
            padding: 0 !important;
            border-radius: 10px !important;
            border: 1px solid rgba(255, 255, 255, 0.12) !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.095), rgba(255, 255, 255, 0.030)),
                rgba(255, 255, 255, 0.045) !important;
            color: #ff0033 !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.20), 0 8px 18px rgba(0, 0, 0, 0.26) !important;
            text-decoration: none !important;
            transition: transform 140ms ease, filter 140ms ease !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-youtube-link:hover {
            filter: brightness(1.12) !important;
            transform: translateY(-1px) !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-youtube-link:active {
            transform: translateY(0) scale(0.96) !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-youtube-link svg {
            width: 24px !important;
            height: 18px !important;
            display: block !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-header-actions {
            display: inline-flex !important;
            align-items: center !important;
            flex: 0 0 auto !important;
            gap: 4px !important;
            min-width: 0 !important;
            position: relative !important;
            z-index: 30 !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-header-actions[hidden] {
            display: none !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap {
            position: relative !important;
            z-index: 30 !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 3px !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap.ytkit-ql-open {
            z-index: 2147483647 !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap::before {
            content: none !important;
            display: none !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-launcher--player,
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-toggle {
            width: 30px !important;
            min-width: 30px !important;
            height: 28px !important;
            min-height: 28px !important;
            border-radius: 10px !important;
            border: 1px solid rgba(255, 255, 255, 0.095) !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.024)),
                rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.90) !important;
            box-shadow: none !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-launcher--player:hover,
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-toggle:hover {
            border-color: rgba(var(--ts-accent-rgb), 0.28) !important;
            background:
                linear-gradient(180deg, rgba(var(--ts-accent-rgb), 0.15), rgba(var(--ts-accent-rgb), 0.045)),
                rgba(255, 255, 255, 0.052) !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-launcher-glyph,
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-launcher-glyph svg {
            width: 15px !important;
            height: 15px !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-toggle {
            width: 25px !important;
            min-width: 25px !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title #ytkit-po-logo-wrap .ytkit-ql-drop {
            top: calc(100% + 8px) !important;
            right: auto !important;
            bottom: auto !important;
            left: 0 !important;
            z-index: 2147483647 !important;
            min-width: 232px !important;
            max-width: min(260px, calc(100vw - 34px)) !important;
            max-height: min(440px, calc(100vh - 92px)) !important;
            overflow: auto !important;
            transform-origin: top left !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-upload-date {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            flex: 0 1 auto !important;
            max-width: 100% !important;
            min-height: 24px !important;
            margin-left: auto !important;
            padding: 0 9px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(var(--ts-accent-rgb), 0.18) !important;
            background:
                linear-gradient(180deg, rgba(var(--ts-accent-rgb), 0.115), rgba(var(--ts-accent-rgb), 0.035)),
                rgba(255, 255, 255, 0.035) !important;
            color: rgba(226, 232, 240, 0.90) !important;
            font-size: 11px !important;
            line-height: 1 !important;
            font-weight: 650 !important;
            letter-spacing: 0 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-upload-date[hidden],
        body.ts-split #below[style*="position"] ytd-watch-metadata #title .ytkit-split-upload-date:empty {
            display: none !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title h1,
        body.ts-split #below[style*="position"] ytd-watch-metadata h1.style-scope.ytd-watch-metadata,
        body.ts-split #below[style*="position"] ytd-watch-metadata h1.ytd-watch-metadata {
            margin: 0 !important;
            padding: 0 !important;
            font-size: 17px !important;
            line-height: 1.24 !important;
            letter-spacing: 0 !important;
            text-align: left !important;
            text-transform: none !important;
            font-weight: 800 !important;
            color: rgba(248, 250, 252, 0.96) !important;
            text-wrap: balance !important;
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #title yt-formatted-string {
            color: inherit !important;
            font-size: inherit !important;
            font-weight: inherit !important;
            line-height: inherit !important;
            letter-spacing: 0 !important;
        }
        body.ts-split #below[style*="position"] #owner,
        body.ts-split #below[style*="position"] #owner.ytd-watch-metadata {
            position: relative !important;
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) !important;
            width: 100% !important;
            max-width: none !important;
            min-width: 0 !important;
            justify-self: stretch !important;
            box-sizing: border-box !important;
            gap: 8px !important;
            margin: 0 !important;
            padding: 10px 12px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 16px !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
                rgba(12, 16, 24, 0.82) !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer {
            display: grid !important;
            grid-template-columns: 42px minmax(0, 1fr) !important;
            align-items: center !important;
            gap: 11px !important;
            justify-self: start !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            margin: 0 !important;
        }
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer #avatar,
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer #avatar img,
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer #avatar yt-img-shadow {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            width: 42px !important;
            height: 42px !important;
            min-width: 42px !important;
            border-radius: 14px !important;
            overflow: hidden !important;
        }
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer #avatar img,
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer #avatar yt-img-shadow {
            box-shadow: 0 10px 22px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.10) !important;
        }
        body.ts-split #below[style*="position"] #owner ytd-video-owner-renderer #upload-info {
            display: grid !important;
            justify-items: start !important;
            gap: 3px !important;
            min-width: 0 !important;
            text-align: left !important;
        }
        body.ts-split #below[style*="position"] #owner #channel-name,
        body.ts-split #below[style*="position"] #owner #channel-name a,
        body.ts-split #below[style*="position"] #owner #channel-name yt-formatted-string {
            color: rgba(248, 250, 252, 0.96) !important;
            font-size: 13px !important;
            line-height: 1.2 !important;
            font-weight: 760 !important;
            letter-spacing: 0 !important;
            text-align: left !important;
            justify-self: start !important;
        }
        body.ts-split #below[style*="position"] #owner #owner-sub-count,
        body.ts-split #below[style*="position"] #owner #owner-sub-count yt-formatted-string {
            color: rgba(148, 163, 184, 0.88) !important;
            font-size: 11px !important;
            line-height: 1.25 !important;
        }
        body.ts-split #below[style*="position"] #owner #subscribe-button,
        body.ts-split #below[style*="position"] #owner #notification-preference-button,
        body.ts-split #below[style*="position"] #owner ytd-subscription-notification-toggle-button-renderer-next {
            position: relative !important;
            align-self: center !important;
            justify-self: start !important;
            margin: 0 !important;
            overflow: visible !important;
            pointer-events: auto !important;
            z-index: 40 !important;
        }
        body.ts-split #below[style*="position"] #owner #notification-preference-button *,
        body.ts-split #below[style*="position"] #owner ytd-subscription-notification-toggle-button-renderer-next * {
            pointer-events: auto !important;
        }
        body.ts-split #below[style*="position"] #owner #subscribe-button .yt-spec-button-shape-next,
        body.ts-split #below[style*="position"] #owner #notification-preference-button .yt-spec-button-shape-next,
        body.ts-split #below[style*="position"] #owner yt-subscribe-button-view-model .yt-spec-button-shape-next {
            min-height: 32px !important;
            height: 32px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.055) !important;
            color: rgba(248, 250, 252, 0.92) !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
        }
        body.ts-split #below[style*="position"] #actions,
        body.ts-split #below[style*="position"] #actions.ytd-watch-metadata {
            display: block !important;
            width: 100% !important;
            margin: 0 0 16px !important;
            padding: 0 !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] #actions-inner,
        body.ts-split #below[style*="position"] #top-level-buttons-computed,
        body.ts-split #below[style*="position"] #actions ytd-menu-renderer,
        body.ts-split #below[style*="position"] #flexible-item-buttons {
            display: flex !important;
            flex-wrap: wrap !important;
            align-items: center !important;
            justify-content: flex-start !important;
            gap: 8px !important;
            row-gap: 8px !important;
        }
        body.ts-split #below[style*="position"] #actions .yt-spec-button-shape-next,
        body.ts-split #below[style*="position"] #actions button,
        body.ts-split #below[style*="position"] .ytkit-local-dl-btn {
            min-height: 32px !important;
            height: 32px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.88) !important;
            font-size: 11px !important;
            font-weight: 720 !important;
            letter-spacing: 0 !important;
            transform: none !important;
        }
        body.ts-split #below[style*="position"] #actions .yt-spec-button-shape-next:hover,
        body.ts-split #below[style*="position"] #actions button:hover,
        body.ts-split #below[style*="position"] .ytkit-local-dl-btn:hover {
            border-color: rgba(var(--ts-accent-rgb), 0.24) !important;
            background: rgba(255, 255, 255, 0.075) !important;
            color: rgba(248, 250, 252, 0.98) !important;
        }
        body.ts-split #below[style*="position"] ytd-watch-metadata #top-row[data-ytkit-split-actions-docked="1"] > #actions,
        body.ts-split #below[style*="position"] ytd-watch-metadata #top-row[data-ytkit-split-actions-docked="1"] > #actions.ytd-watch-metadata {
            display: none !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions),
        body.ts-split #below[style*="position"] #owner.ytd-watch-metadata:has(.ytkit-split-owner-actions) {
            grid-template-columns: minmax(0, 1fr) auto auto auto !important;
            grid-template-areas:
                "owner dock page watch"
                "sub sub sub sub" !important;
            align-items: center !important;
            column-gap: 8px !important;
            row-gap: 8px !important;
        }
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions) ytd-video-owner-renderer {
            grid-area: owner !important;
        }
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions) #subscribe-button {
            grid-area: sub !important;
        }
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions) #notification-preference-button,
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions) ytd-subscription-notification-toggle-button-renderer-next {
            grid-area: sub !important;
        }
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions) > #ytkit-page-btn-watch {
            grid-area: page !important;
            justify-self: end !important;
            align-self: center !important;
            margin: 0 !important;
        }
        body.ts-split #below[style*="position"] #owner:has(.ytkit-split-owner-actions) > #ytkit-watch-btn {
            grid-area: watch !important;
            justify-self: end !important;
            align-self: center !important;
            margin: 0 !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions {
            grid-area: dock !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: flex-start !important;
            flex-wrap: wrap !important;
            gap: 6px !important;
            min-width: 0 !important;
            margin: 0 !important;
            position: relative !important;
            z-index: 20 !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions[hidden] {
            display: none !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions > * {
            flex: 0 0 auto !important;
            margin: 0 !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytkit-local-dl-btn,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions button,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .yt-spec-button-shape-next {
            min-height: 32px !important;
            height: 32px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.88) !important;
            font-size: 11px !important;
            font-weight: 720 !important;
            letter-spacing: 0 !important;
            transform: none !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytkit-local-dl-btn {
            gap: 5px !important;
            padding-inline: 10px !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions dislike-button-view-model,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions #segmented-dislike-button,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytDislikeButtonViewModelHost {
            display: none !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions segmented-like-dislike-button-view-model,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions ytd-segmented-like-dislike-button-renderer,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions like-button-view-model,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions segmented-like-dislike-button-view-model,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions ytd-segmented-like-dislike-button-renderer {
            overflow: hidden !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            box-shadow: none !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper {
            gap: 0 !important;
            overflow: hidden !important;
            border: 0 !important;
            border-radius: 999px !important;
            background: transparent !important;
            box-shadow: none !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper::before,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper::after,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions like-button-view-model::before,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions like-button-view-model::after {
            content: none !important;
            display: none !important;
            border: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
        }
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytSpecButtonShapeNextSegmentedStart,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .ytSpecButtonShapeNextSegmentedEnd,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .yt-spec-button-shape-next--segmented-start,
        body.ts-split #below[style*="position"] #owner .ytkit-split-owner-actions .yt-spec-button-shape-next--segmented-end {
            border: 0 !important;
            border-radius: 999px !important;
            background: transparent !important;
            box-shadow: none !important;
        }
        body.ts-split #below[style*="position"] #comments {
            margin: 0 !important;
            padding: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments#comments,
        body.ts-split #below[style*="position"] ytd-comments#comments {
            display: block !important;
            visibility: visible !important;
            margin: 0 !important;
            padding: 0 0 64px !important;
            border: none !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            overflow: visible !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) auto !important;
            grid-template-areas:
                "count sort"
                "box box" !important;
            gap: 10px !important;
            align-content: start !important;
            align-items: center !important;
            min-height: 0 !important;
            margin: 0 0 12px !important;
            padding: 10px 12px 9px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-radius: 16px !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.018)),
                rgba(13, 17, 25, 0.82) !important;
            box-sizing: border-box !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #title {
            grid-area: count !important;
            display: inline-flex !important;
            align-items: center !important;
            gap: 8px !important;
            margin: 0 !important;
            min-width: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments #count.ytd-comments-header-renderer,
        body.ts-split #below[style*="position"] #comments yt-formatted-string.count-text.style-scope.ytd-comments-header-renderer {
            display: inline-flex !important;
            align-items: baseline !important;
            gap: 0.26em !important;
            margin: 0 !important;
            color: rgba(248, 250, 252, 0.96) !important;
            font-size: 15px !important;
            font-weight: 780 !important;
            line-height: 1.15 !important;
            letter-spacing: 0 !important;
            white-space: nowrap !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #sort-menu,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer yt-sort-filter-sub-menu-renderer {
            grid-area: sort !important;
            justify-self: end !important;
            margin: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #sort-menu tp-yt-paper-button,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer yt-sort-filter-sub-menu-renderer tp-yt-paper-button,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #sort-menu button {
            min-height: 30px !important;
            height: 30px !important;
            padding: 0 12px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.86) !important;
            font-size: 11px !important;
            font-weight: 720 !important;
            letter-spacing: 0 !important;
            text-transform: none !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #simple-box,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer ytd-comment-simplebox-renderer {
            grid-area: box !important;
            grid-column: 1 / -1 !important;
            width: 100% !important;
            min-width: 0 !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #thumbnail-input-row {
            display: grid !important;
            grid-template-columns: 32px minmax(0, 1fr) !important;
            align-items: center !important;
            gap: 10px !important;
            width: 100% !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #author-thumbnail,
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #author-thumbnail img,
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #author-thumbnail yt-img-shadow,
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #avatar,
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #avatar img,
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #avatar yt-img-shadow {
            width: 32px !important;
            height: 32px !important;
            border-radius: 11px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #placeholder-area,
        body.ts-split #below[style*="position"] #comments ytd-commentbox #contenteditable-textarea {
            display: flex !important;
            align-items: center !important;
            width: 100% !important;
            min-height: 38px !important;
            margin: 0 !important;
            padding: 0 11px !important;
            border-radius: 13px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.74) !important;
            box-sizing: border-box !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-thread-renderer {
            margin: 0 0 10px !important;
            padding: 0 !important;
            border: none !important;
            background: transparent !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer {
            position: relative !important;
            display: block !important;
            margin: 0 !important;
            padding: 12px 54px 12px 12px !important;
            border-radius: 17px !important;
            border: 1px solid rgba(255, 255, 255, 0.085) !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.046), rgba(255, 255, 255, 0.022)),
                rgba(12, 16, 24, 0.82) !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035), 0 14px 30px rgba(2, 6, 12, 0.22) !important;
            transition: border-color 160ms ease, background 160ms ease, transform 160ms ease !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model:hover,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer:hover {
            border-color: rgba(var(--ts-accent-rgb), 0.22) !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.03)),
                rgba(14, 19, 29, 0.9) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model > #body,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer > #body {
            display: flex !important;
            align-items: flex-start !important;
            gap: 11px !important;
            position: static !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #author-thumbnail,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #author-thumbnail,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #author-thumbnail img,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #author-thumbnail img,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #author-thumbnail yt-img-shadow,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #author-thumbnail yt-img-shadow {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            flex: 0 0 34px !important;
            width: 34px !important;
            height: 34px !important;
            border-radius: 12px !important;
            overflow: hidden !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model > #body > #main,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer > #body > #main {
            min-width: 0 !important;
            flex: 1 1 auto !important;
            padding-right: 0 !important;
            position: static !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #header-author,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #header-author {
            display: flex !important;
            flex-wrap: wrap !important;
            align-items: baseline !important;
            gap: 6px !important;
            margin: 0 0 4px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #author-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #author-text {
            color: rgba(248, 250, 252, 0.96) !important;
            font-size: 12.5px !important;
            font-weight: 760 !important;
            letter-spacing: 0 !important;
            line-height: 1.25 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #published-time-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #published-time-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model .published-time-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer .published-time-text {
            color: rgba(148, 163, 184, 0.78) !important;
            font-size: 11px !important;
            line-height: 1.25 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #content-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #content-text {
            display: block !important;
            margin: 0 !important;
            padding: 0 !important;
            color: rgba(241, 245, 249, 0.95) !important;
            font-size: 14px !important;
            line-height: 1.54 !important;
            letter-spacing: 0 !important;
            word-break: break-word !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #content-text a,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #content-text a {
            color: rgba(var(--ts-accent-rgb), 0.92) !important;
            text-decoration: none !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu {
            position: absolute !important;
            top: 11px !important;
            right: 11px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 28px !important;
            height: 28px !important;
            min-width: 28px !important;
            min-height: 28px !important;
            opacity: 0.64 !important;
            margin: 0 !important;
            z-index: 3 !important;
            pointer-events: auto !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu ytd-menu-renderer,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu ytd-menu-renderer,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu ytd-menu-renderer,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu ytd-menu-renderer,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu yt-icon-button,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu yt-icon-button,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu yt-icon-button,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu yt-icon-button,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu button,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu button,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu button,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu button {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 28px !important;
            height: 28px !important;
            min-width: 28px !important;
            min-height: 28px !important;
            padding: 0 !important;
            border-radius: 999px !important;
            background: rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.82) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model:hover #action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer:hover #action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model:hover #inline-action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer:hover #inline-action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model:focus-within #action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer:focus-within #action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model:focus-within #inline-action-menu,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer:focus-within #inline-action-menu {
            opacity: 1 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu button:hover,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu button:hover,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu button:hover,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu button:hover {
            background: rgba(255, 255, 255, 0.075) !important;
            color: rgba(255, 255, 255, 0.96) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu yt-icon,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu yt-icon,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu yt-icon,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu yt-icon,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #action-menu svg,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #action-menu svg,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #inline-action-menu svg,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #inline-action-menu svg {
            width: 18px !important;
            height: 18px !important;
            color: inherit !important;
            fill: currentColor !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar {
            display: block !important;
            margin: 9px 0 0 !important;
            padding: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar #toolbar {
            display: flex !important;
            flex-wrap: wrap !important;
            align-items: center !important;
            gap: 6px !important;
            margin: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar #toolbar button,
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar #toolbar .yt-spec-button-shape-next {
            min-height: 28px !important;
            height: 28px !important;
            padding: 0 10px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            color: rgba(226, 232, 240, 0.82) !important;
            font-size: 11px !important;
            letter-spacing: 0 !important;
            transform: none !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer {
            position: relative !important;
            margin: 9px 0 0 12px !important;
            padding: 8px 0 0 7px !important;
            border-left: 1px solid rgba(var(--ts-accent-rgb), 0.18) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-replies-renderer {
            margin-left: 8px !important;
            padding-left: 6px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-view-model,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-renderer {
            padding: 10px 40px 10px 10px !important;
            border-radius: 14px !important;
            box-shadow: none !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.034), rgba(255, 255, 255, 0.016)),
                rgba(9, 13, 20, 0.72) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-view-model > #body,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-renderer > #body {
            gap: 8px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail img,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail img,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-view-model #author-thumbnail yt-img-shadow,
        body.ts-split #below[style*="position"] #comments ytd-comment-replies-renderer ytd-comment-renderer #author-thumbnail yt-img-shadow {
            flex-basis: 28px !important;
            width: 28px !important;
            height: 28px !important;
            border-radius: 10px !important;
        }

        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer {
            gap: 7px !important;
            min-height: 0 !important;
            margin-bottom: 10px !important;
            padding: 9px 10px 7px !important;
            border-radius: 14px !important;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.014)),
                rgba(12, 16, 24, 0.74) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #title,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #leading-section,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #additional-section {
            min-height: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments #count.ytd-comments-header-renderer,
        body.ts-split #below[style*="position"] #comments yt-formatted-string.count-text.style-scope.ytd-comments-header-renderer {
            font-size: 14px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #sort-menu tp-yt-paper-button,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer yt-sort-filter-sub-menu-renderer tp-yt-paper-button,
        body.ts-split #below[style*="position"] #comments ytd-comments-header-renderer #sort-menu button {
            min-height: 28px !important;
            height: 28px !important;
            padding: 0 10px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer {
            min-height: 0 !important;
            height: auto !important;
            margin-bottom: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #thumbnail-input-row {
            display: block !important;
            min-height: 0 !important;
            gap: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #author-thumbnail,
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #avatar {
            display: none !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-simplebox-renderer #placeholder-area,
        body.ts-split #below[style*="position"] #comments ytd-commentbox #contenteditable-textarea {
            min-height: 34px !important;
            padding: 0 11px !important;
            border-radius: 12px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-thread-renderer {
            margin-bottom: 8px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer {
            padding: 11px 54px 10px 11px !important;
            border-radius: 14px !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.028), 0 10px 22px rgba(2, 6, 12, 0.2) !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #author-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #author-text,
        body.ts-split #below[style*="position"] #comments ytd-comment-view-model #author-text *,
        body.ts-split #below[style*="position"] #comments ytd-comment-renderer #author-text * {
            background: transparent !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            color: rgba(248, 250, 252, 0.96) !important;
            padding: 0 !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar {
            margin-top: 8px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar #toolbar {
            gap: 5px !important;
        }
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar #toolbar button,
        body.ts-split #below[style*="position"] #comments ytd-comment-engagement-bar #toolbar .yt-spec-button-shape-next,
        body.ts-split #below[style*="position"] #comments #creator-heart-button,
        body.ts-split #below[style*="position"] #comments #creator-heart-button button,
        body.ts-split #below[style*="position"] #comments #creator-heart-button yt-icon-button,
        body.ts-split #below[style*="position"] #comments #creator-heart-button tp-yt-paper-icon-button,
        body.ts-split #below[style*="position"] #comments #creator-heart-button .yt-spec-button-shape-next {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: auto !important;
            min-width: 28px !important;
            height: 26px !important;
            min-height: 26px !important;
            margin: 0 !important;
            padding: 0 8px !important;
            border-radius: 999px !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            background: rgba(255, 255, 255, 0.045) !important;
            box-shadow: none !important;
            overflow: hidden !important;
        }
        body.ts-split #below[style*="position"] #comments #creator-heart-button img,
        body.ts-split #below[style*="position"] #comments #creator-heart-button yt-img-shadow,
        body.ts-split #below[style*="position"] #comments #creator-heart-button yt-icon,
        body.ts-split #below[style*="position"] #comments #creator-heart-button svg {
            max-width: 15px !important;
            max-height: 15px !important;
        }
    `;
    (document.head || document.documentElement).appendChild(earlyStyle);

    // ── Constants ──────────────────────────────────────────────────────────
    const SPLIT_RATIO_KEY = 'ts_split_ratio';
    const TRANSITION = '0.35s cubic-bezier(0.4,0,0.2,1)';

    // ── State ──────────────────────────────────────────────────────────────
    let isActive = false;
    let isSplit = false;
    let entering = false;
    let videoType = 'standard'; // 'standard' | 'live' | 'vod'
    let splitWrapper = null;
    let origPlayerParent = null;
    let origPlayerNextSibling = null;
    let positionedEls = [];
    let scrollTarget = null;
    let wheelHandler = null;
    let middleMouseHandler = null;
    let autoscrollState = null;
    let touchHandler = null;
    let touchMoveHandler = null;
    let touchStartY = 0;
    let windowResizeHandler = null;
    let playerResizeObs = null;
    let clickToPauseHandler = null;
    let clickToPauseMp = null;
    let resizeTimer = null;
    let lastVideoId = null;
    let chatObserver = null;
    let actionDock = null;
    let actionDockMoved = null;
    let actionDockObserver = null;
    let actionDockTimer = null;
    let splitHeaderBar = null;
    let splitHeaderMovedLogo = null;

    // ── Helpers ─────────────────────────────────────────────────────────────
    function getVideoId() {
        const u = new URL(location.href);
        return u.searchParams.get('v') || '';
    }

    function isWatchPage() {
        return location.pathname === '/watch';
    }

    function getPlayer() {
        return document.querySelector('#player-container');
    }

    function getBelow() {
        return document.querySelector('#below') || document.querySelector('ytd-watch-metadata')?.parentElement;
    }

    function getChatEl() {
        return document.querySelector('ytd-live-chat-frame#chat') || document.querySelector('ytd-live-chat-frame');
    }

    function setStyles(el, props) {
        if (!el) return;
        for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
    }

    function removeStyles(el, props) {
        if (!el) return;
        props.forEach(p => el.style.removeProperty(p));
    }

    function getSavedRatio() {
        try { return parseFloat(localStorage.getItem(SPLIT_RATIO_KEY)) || 75; }
        catch { return 75; }
    }

    function saveRatio(v) {
        try { localStorage.setItem(SPLIT_RATIO_KEY, v); } catch {}
    }

    // ── Video Type Detection ────────────────────────────────────────────────
    function detectVideoType() {
        const chatEl = getChatEl();

        // Primary: check ytInitialPlayerResponse (most reliable on initial load)
        try {
            const vd = window.ytInitialPlayerResponse?.videoDetails;
            if (vd?.isLiveContent) {
                return vd.isLive ? 'live' : 'vod';
            }
        } catch {}

        // SPA fallback: check the Polymer element's data (ytInitialPlayerResponse
        // can be stale after SPA navigation)
        try {
            const flexy = document.querySelector('ytd-watch-flexy');
            const pd = flexy?.playerData_ || flexy?.__data?.playerData_;
            if (pd?.videoDetails?.isLiveContent) {
                return pd.videoDetails.isLive ? 'live' : 'vod';
            }
        } catch {}

        // DOM fallback: chat frame presence + live badge
        if (chatEl) {
            const liveBadge = document.querySelector('.ytp-live-badge');
            if (liveBadge && !liveBadge.hasAttribute('disabled')) return 'live';
            return 'vod';
        }

        // Attribute fallback: YouTube sets this on ytd-watch-flexy
        try {
            const flexy = document.querySelector('ytd-watch-flexy');
            if (flexy?.hasAttribute('live-chat-present-and-expanded')) {
                const liveBadge = document.querySelector('.ytp-live-badge');
                if (liveBadge && !liveBadge.hasAttribute('disabled')) return 'live';
                return 'vod';
            }
        } catch {}

        return 'standard';
    }

    // ── Player Resize ───────────────────────────────────────────────────────
    function triggerPlayerResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const vid = document.querySelector('#ts-left video.html5-main-video');
            if (vid) {
                const wasPaused = vid.paused;
                const parent = vid.parentNode;
                const next = vid.nextSibling;
                parent.removeChild(vid);
                void parent.offsetHeight;
                parent.insertBefore(vid, next);
                if (!wasPaused) vid.play().catch(() => {});
            }
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }

    function forcePlayerSize() {
        if (!isActive) return;
        const mp = document.getElementById('movie_player');
        if (!mp) return;
        setStyles(mp, { width: '100%', height: '100%' });
        const vc = mp.querySelector('.html5-video-container');
        const vid = mp.querySelector('video.html5-main-video');
        if (vc) setStyles(vc, { width: '100%', height: '100%' });
        if (vid) setStyles(vid, { width: '100%', height: '100%', 'object-fit': 'contain' });
        const ytdP = mp.closest('ytd-player');
        const innerCont = ytdP?.querySelector('#container');
        if (innerCont) setStyles(innerCont, { width: '100%', height: '100%', 'padding-bottom': '0' });
    }

    // ── Position helpers ────────────────────────────────────────────────────
    function positionOverRight(el, rightPct, topOffset, heightStr) {
        if (!el) return;
        setStyles(el, {
            position: 'fixed', top: topOffset || '0', right: '0',
            width: `calc(${rightPct}% - 6px)`, 'max-width': 'none',
            height: heightStr || '100vh', 'max-height': 'none',
            'min-height': '0', margin: '0',
            'overflow-y': 'auto', 'overflow-x': 'hidden',
            'z-index': '10001', background: 'linear-gradient(180deg, #0b0f16 0%, #070a10 100%)', padding: '0',
            'box-sizing': 'border-box', visibility: 'visible',
            'pointer-events': 'auto',
            'scrollbar-width': 'thin', 'scrollbar-color': 'rgba(255,255,255,0.15) transparent'
        });
        positionedEls.push(el);
    }

    function unpositionEl(el) {
        removeStyles(el, ['position', 'top', 'right', 'width', 'max-width', 'height', 'max-height',
            'min-height', 'margin', 'overflow-y', 'overflow-x', 'z-index', 'background', 'padding',
            'box-sizing', 'visibility', 'pointer-events', 'display', 'flex-direction',
            'scrollbar-width', 'scrollbar-color', 'border-radius', 'border-bottom']);
    }

    function unpositionAll() {
        positionedEls.forEach(el => unpositionEl(el));
        positionedEls = [];
        scrollTarget = null;
    }

    function isSplitScrollable(el) {
        return !!(el && el.scrollHeight > el.clientHeight + 1);
    }

    function shouldIgnoreSplitAutoscroll(target) {
        const node = target instanceof Element ? target : target?.parentElement;
        if (!node) return true;
        return !!node.closest([
            'a[href]',
            'button',
            'input',
            'textarea',
            'select',
            'option',
            'summary',
            '[role="button"]',
            '[role="menuitem"]',
            '[contenteditable="true"]',
            'yt-icon-button',
            'tp-yt-paper-button',
            'ytd-button-renderer',
            'ytd-menu-renderer',
            'ytd-toggle-button-renderer'
        ].join(','));
    }

    function getSplitAutoscrollTarget(target) {
        if (!isActive || !isSplit) return null;
        const node = target instanceof Element ? target : target?.parentElement;
        if (!node) return null;

        const positionedHit = positionedEls.find(el => el?.contains?.(node) && isSplitScrollable(el));
        if (positionedHit) return positionedHit;

        const right = splitWrapper?.querySelector('#ts-right');
        if (right?.contains(node) && isSplitScrollable(right)) return right;

        return isSplitScrollable(scrollTarget) ? scrollTarget : null;
    }

    function startSplitAutoscroll(e) {
        if (!isActive || !isSplit || e.button !== 1) return;
        if (shouldIgnoreSplitAutoscroll(e.target)) return;
        const scrollEl = getSplitAutoscrollTarget(e.target);
        if (!scrollEl) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        stopSplitAutoscroll();

        const state = {
            scrollEl,
            originY: e.clientY,
            currentY: e.clientY,
            rafId: 0,
            lastTs: performance.now(),
            moveHandler: null,
            upHandler: null,
            keyHandler: null,
            blurHandler: null
        };

        state.moveHandler = (moveEvent) => {
            state.currentY = moveEvent.clientY;
        };
        state.upHandler = (upEvent) => {
            if (upEvent.button !== 1) return;
            upEvent.preventDefault();
            upEvent.stopPropagation();
            stopSplitAutoscroll();
        };
        state.keyHandler = (keyEvent) => {
            if (keyEvent.key !== 'Escape') return;
            keyEvent.preventDefault();
            stopSplitAutoscroll();
        };
        state.blurHandler = () => stopSplitAutoscroll();

        autoscrollState = state;
        document.addEventListener('mousemove', state.moveHandler, true);
        document.addEventListener('mouseup', state.upHandler, true);
        document.addEventListener('keydown', state.keyHandler, true);
        window.addEventListener('blur', state.blurHandler);

        const tick = (now) => {
            if (autoscrollState !== state) return;
            const dy = state.currentY - state.originY;
            const distance = Math.abs(dy);
            const deadZone = 10;
            const velocity = distance <= deadZone
                ? 0
                : Math.sign(dy) * Math.min(42, Math.pow((distance - deadZone) / 8, 1.25));
            const dt = Math.min(48, now - state.lastTs) / 16.67;
            state.lastTs = now;
            if (velocity) state.scrollEl.scrollTop += velocity * dt;
            state.rafId = requestAnimationFrame(tick);
        };
        state.rafId = requestAnimationFrame(tick);
    }

    function stopSplitAutoscroll() {
        const state = autoscrollState;
        if (!state) return;
        autoscrollState = null;
        if (state.rafId) cancelAnimationFrame(state.rafId);
        if (state.moveHandler) document.removeEventListener('mousemove', state.moveHandler, true);
        if (state.upHandler) document.removeEventListener('mouseup', state.upHandler, true);
        if (state.keyHandler) document.removeEventListener('keydown', state.keyHandler, true);
        if (state.blurHandler) window.removeEventListener('blur', state.blurHandler);
    }

    function scheduleActionDock(delay = 80) {
        clearTimeout(actionDockTimer);
        actionDockTimer = setTimeout(() => {
            actionDockTimer = null;
            dockSplitHeader();
            dockSplitActions();
        }, delay);
    }

    function getSplitTitleEl() {
        const below = getBelow();
        return below?.querySelector('ytd-watch-metadata #title, #title.ytd-watch-metadata')
            || document.querySelector('ytd-watch-metadata #title, #title.ytd-watch-metadata');
    }

    function createSplitYoutubeIcon() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 28 20');
        svg.setAttribute('aria-hidden', 'true');

        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', '1.5');
        rect.setAttribute('y', '1.5');
        rect.setAttribute('width', '25');
        rect.setAttribute('height', '17');
        rect.setAttribute('rx', '5');
        rect.setAttribute('fill', 'currentColor');
        svg.appendChild(rect);

        const play = document.createElementNS(ns, 'path');
        play.setAttribute('d', 'M11 6.25 18.5 10 11 13.75Z');
        play.setAttribute('fill', '#fff');
        svg.appendChild(play);

        return svg;
    }

    function ensureSplitHeaderBar() {
        const title = getSplitTitleEl();
        if (!title) return null;

        let bar = title.querySelector(':scope > .ytkit-split-title-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'ytkit-split-title-bar';

            const homeLink = document.createElement('a');
            homeLink.className = 'ytkit-split-youtube-link';
            homeLink.href = 'https://www.youtube.com/feed/subscriptions';
            homeLink.title = 'Go to subscriptions';
            homeLink.setAttribute('aria-label', 'Go to subscriptions');
            homeLink.appendChild(createSplitYoutubeIcon());
            bar.appendChild(homeLink);

            const actions = document.createElement('div');
            actions.className = 'ytkit-split-header-actions';
            actions.setAttribute('aria-label', 'Quick links');
            bar.appendChild(actions);

            const date = document.createElement('span');
            date.className = 'ytkit-split-upload-date';
            date.setAttribute('translate', 'no');
            bar.appendChild(date);

            title.insertBefore(bar, title.firstChild);
        }

        splitHeaderBar = bar;
        return bar;
    }

    function getPagePlayerResponse() {
        try {
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            return pageWindow?.ytInitialPlayerResponse || window.ytInitialPlayerResponse || null;
        } catch (_) {
            return window.ytInitialPlayerResponse || null;
        }
    }

    function extractSplitFallbackDate(text) {
        const normalized = String(text || '').replace(/\u00A0/g, ' ').trim();
        if (!normalized) return null;

        const segments = normalized.split(/[•|]/).map(part => part.trim()).filter(Boolean);
        const preferred = segments.find(segment => /(?:premiered|streamed|published|uploaded|\b\d{4}\b)/i.test(segment))
            || normalized;
        const cleaned = preferred
            .replace(/^(Premiered|Published on|Published|Uploaded|Streamed live on|Started streaming on|Streamed)\s*/i, '')
            .trim();
        const parsed = new Date(cleaned);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getSplitDateAnchor() {
        const root = getBelow() || document;
        const candidates = Array.from(root.querySelectorAll(
            '#info-strings yt-formatted-string, ytd-watch-metadata #info-container yt-formatted-string, ytd-watch-metadata #info-text yt-formatted-string'
        ));
        return candidates.find(el => /(?:premiered|streamed|published|uploaded|\b\d{4}\b)/i.test(el.textContent || ''))
            || candidates[0]
            || null;
    }

    function getSplitPublishDate(anchorEl) {
        const currentVideoId = getVideoId();

        try {
            const playerResponse = getPagePlayerResponse();
            const responseVideoId = playerResponse?.videoDetails?.videoId;
            if (!responseVideoId || !currentVideoId || responseVideoId === currentVideoId) {
                const microformat = playerResponse?.microformat?.playerMicroformatRenderer;
                const raw = microformat?.publishDate
                    || microformat?.uploadDate
                    || microformat?.liveBroadcastDetails?.startTimestamp
                    || microformat?.liveBroadcastDetails?.endTimestamp;
                if (raw) {
                    const parsed = new Date(raw);
                    if (!Number.isNaN(parsed.getTime())) return parsed;
                }
            }
        } catch (_) {}

        const meta = document.querySelector('meta[itemprop="datePublished"], meta[itemprop="uploadDate"]');
        const metaValue = meta?.getAttribute('content');
        if (metaValue) {
            const parsed = new Date(metaValue);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }

        return extractSplitFallbackDate(anchorEl?.textContent || '');
    }

    function formatSplitUploadDate(date) {
        return new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }

    function getSplitUploadDateText() {
        const anchor = getSplitDateAnchor();
        const publishDate = getSplitPublishDate(anchor);
        if (publishDate) return `Uploaded ${formatSplitUploadDate(publishDate)}`;

        const rawText = String(anchor?.textContent || '').replace(/\u00A0/g, ' ').trim();
        if (!rawText) return '';

        const segments = rawText.split(/[•|]/).map(part => part.trim()).filter(Boolean);
        const preferred = segments.find(segment => /(?:premiered|streamed|published|uploaded|\b\d{4}\b)/i.test(segment))
            || segments[0]
            || rawText;

        if (/^Published on\s+/i.test(preferred)) return preferred.replace(/^Published on\s+/i, 'Uploaded ');
        if (/^(Uploaded|Published|Premiered|Streamed)/i.test(preferred)) return preferred;
        return `Uploaded ${preferred}`;
    }

    function dockSplitHeader() {
        if (!isActive || !isSplit) return;

        const bar = ensureSplitHeaderBar();
        if (!bar) return;

        const dateEl = bar.querySelector('.ytkit-split-upload-date');
        if (dateEl) {
            const dateText = getSplitUploadDateText();
            dateEl.textContent = dateText;
            dateEl.hidden = !dateText;
            if (dateText) {
                dateEl.title = dateText;
                dateEl.setAttribute('aria-label', dateText);
            } else {
                dateEl.removeAttribute('title');
                dateEl.removeAttribute('aria-label');
            }
        }

        const actions = bar.querySelector('.ytkit-split-header-actions');
        const logoWrap = document.getElementById('ytkit-po-logo-wrap');
        if (actions && logoWrap && logoWrap.parentElement !== actions) {
            if (!splitHeaderMovedLogo) {
                splitHeaderMovedLogo = {
                    parent: logoWrap.parentNode,
                    next: logoWrap.nextSibling
                };
            }
            logoWrap.dataset.ytkitSplitHeaderDocked = '1';
            actions.appendChild(logoWrap);
        }
        if (actions) actions.hidden = !logoWrap;
    }

    function restoreSplitHeader() {
        const logoWrap = document.getElementById('ytkit-po-logo-wrap');
        if (logoWrap) delete logoWrap.dataset.ytkitSplitHeaderDocked;
        if (logoWrap && splitHeaderMovedLogo) {
            const fallbackParent = document.getElementById('ytkit-player-controls');
            const parent = splitHeaderMovedLogo.parent?.isConnected ? splitHeaderMovedLogo.parent : fallbackParent;
            if (parent) {
                if (splitHeaderMovedLogo.next?.parentNode === parent) parent.insertBefore(logoWrap, splitHeaderMovedLogo.next);
                else parent.appendChild(logoWrap);
            }
        }
        splitHeaderMovedLogo = null;

        document.querySelectorAll('.ytkit-split-title-bar').forEach(bar => bar.remove());
        splitHeaderBar = null;
    }

    function getSplitOwner() {
        const below = getBelow();
        return below?.querySelector('ytd-watch-metadata #owner, #owner.ytd-watch-metadata')
            || document.querySelector('ytd-watch-metadata #owner, #owner.ytd-watch-metadata');
    }

    function ensureActionDock() {
        const owner = getSplitOwner();
        if (!owner) return null;

        let dock = owner.querySelector(':scope > .ytkit-split-owner-actions');
        if (!dock) {
            dock = document.createElement('div');
            dock.className = 'ytkit-split-owner-actions';
            dock.setAttribute('aria-label', 'Video actions');
            const subscribe = owner.querySelector('#subscribe-button');
            if (subscribe?.nextSibling) owner.insertBefore(dock, subscribe.nextSibling);
            else owner.appendChild(dock);
        }

        actionDock = dock;
        return dock;
    }

    function findLikeControl() {
        const root = getBelow() || document;
        const selectors = [
            'ytd-watch-metadata #actions segmented-like-dislike-button-view-model',
            'ytd-watch-metadata #actions ytd-segmented-like-dislike-button-renderer',
            'ytd-watch-metadata #actions like-button-view-model',
            'ytd-watch-metadata #actions #segmented-like-button'
        ];

        for (const selector of selectors) {
            const el = root.querySelector(selector);
            if (el && !el.closest('.ytkit-split-owner-actions')) return el;
        }
        return null;
    }

    function findDownloadControl() {
        const root = getBelow() || document;
        const controls = Array.from(root.querySelectorAll(
            'ytd-watch-metadata #actions .ytkit-local-dl-btn, ytd-watch-metadata #top-level-buttons-computed .ytkit-local-dl-btn'
        ));
        return controls.find(el => !el.closest('.ytkit-split-owner-actions')) || null;
    }

    function dockControl(control, dock) {
        if (!control || !dock) return false;
        if (control.parentElement === dock) {
            control.dataset.ytkitSplitDocked = '1';
            return false;
        }

        if (!actionDockMoved) actionDockMoved = new Map();
        if (!actionDockMoved.has(control)) {
            actionDockMoved.set(control, {
                parent: control.parentNode,
                next: control.nextSibling
            });
        }

        control.dataset.ytkitSplitDocked = '1';
        dock.appendChild(control);
        return true;
    }

    function dockSplitActions() {
        if (!isActive || !isSplit) return;
        dockSplitHeader();

        const dock = ensureActionDock();
        if (!dock) return;

        dockControl(findLikeControl(), dock);
        dockControl(findDownloadControl(), dock);

        const hasControls = dock.children.length > 0;
        dock.hidden = !hasControls;
        const topRow = dock.closest('#top-row');
        if (topRow) {
            if (hasControls) topRow.dataset.ytkitSplitActionsDocked = '1';
            else delete topRow.dataset.ytkitSplitActionsDocked;
        }
    }

    function startActionDock() {
        if (!isActive || !isSplit) return;

        dockSplitHeader();
        dockSplitActions();
        if (actionDockObserver) return;

        const metadata = getBelow()?.querySelector('ytd-watch-metadata')
            || document.querySelector('ytd-watch-metadata');
        if (!metadata) return;

        actionDockObserver = new MutationObserver(() => {
            scheduleActionDock(80);
        });
        actionDockObserver.observe(metadata, { childList: true, subtree: true });
    }

    function restoreActionDock() {
        clearTimeout(actionDockTimer);
        actionDockTimer = null;
        if (actionDockObserver) {
            actionDockObserver.disconnect();
            actionDockObserver = null;
        }
        restoreSplitHeader();

        if (actionDockMoved) {
            actionDockMoved.forEach(({ parent, next }, control) => {
                delete control.dataset.ytkitSplitDocked;
                if (!control.isConnected || !parent?.isConnected) return;
                if (next?.parentNode === parent) parent.insertBefore(control, next);
                else parent.appendChild(control);
            });
            actionDockMoved.clear();
        }
        actionDockMoved = null;

        document.querySelectorAll('.ytkit-split-owner-actions').forEach(dock => dock.remove());
        document.querySelectorAll('[data-ytkit-split-actions-docked]').forEach(row => {
            delete row.dataset.ytkitSplitActionsDocked;
        });
        actionDock = null;
    }

    // ── Chat helpers ────────────────────────────────────────────────────────
    function forceChatFill(chatEl) {
        if (!chatEl) return;

        // ytd-live-chat-frame is a flex column container — keep it that way
        setStyles(chatEl, {
            display: 'flex', 'flex-direction': 'column',
            'max-height': 'none', 'min-height': '0',
            overflow: 'hidden', border: 'none'
        });

        // Hide the show/hide toggle button
        const showHide = chatEl.querySelector('#show-hide-button');
        if (showHide) setStyles(showHide, { display: 'none' });

        // Force iframe to fill via both flex AND explicit height
        const iframe = chatEl.querySelector('iframe');
        if (iframe) {
            setStyles(iframe, {
                flex: '1', width: '100%', height: '100%',
                'min-height': '0', 'max-height': 'none',
                border: 'none', 'border-radius': '0'
            });
        }

        // Also ensure #chat-container parent is not constraining
        const chatContainer = chatEl.closest('#chat-container');
        if (chatContainer) {
            setStyles(chatContainer, {
                display: 'block', height: 'auto', 'max-height': 'none',
                overflow: 'visible', visibility: 'visible'
            });
        }
    }

    function restoreChatFill(chatEl) {
        if (!chatEl) return;
        removeStyles(chatEl, ['display', 'flex-direction', 'max-height', 'min-height', 'overflow', 'border']);
        const showHide = chatEl.querySelector('#show-hide-button');
        if (showHide) removeStyles(showHide, ['display']);
        const iframe = chatEl.querySelector('iframe');
        if (iframe) removeStyles(iframe, ['flex', 'width', 'height', 'min-height', 'max-height', 'border', 'border-radius']);
        const chatContainer = chatEl.closest('#chat-container');
        if (chatContainer) removeStyles(chatContainer, ['display', 'height', 'max-height', 'overflow', 'visibility']);
    }

    function setupChat(chatEl, rightPct, top, height) {
        if (!chatEl) { waitForChat(rightPct, top, height); return; }
        positionOverRight(chatEl, rightPct, top, height);
        chatEl.removeAttribute('collapsed');
        chatEl.removeAttribute('hide-chat-frame');
        setStyles(chatEl, {
            width: `calc(${rightPct}% - 2px)`, padding: '0',
            'border-radius': '0'
        });
        forceChatFill(chatEl);
    }

    function waitForChat(rightPct, topOffset, heightStr) {
        if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
        const onFound = (chatEl) => {
            if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
            if (!isSplit || !isActive) return;

            // Update video type now that chat is confirmed
            if (videoType === 'standard') {
                videoType = detectVideoType();
                if (videoType === 'standard') videoType = 'live'; // chat exists = at least live
            }

            positionOverRight(chatEl, rightPct, topOffset, heightStr);
            chatEl.removeAttribute('collapsed');
            chatEl.removeAttribute('hide-chat-frame');
            setStyles(chatEl, {
                width: `calc(${rightPct}% - 2px)`, padding: '0',
                'border-radius': '0'
            });
            forceChatFill(chatEl);
            if (!scrollTarget) scrollTarget = chatEl;
            if (videoType === 'vod') {
                setStyles(chatEl, { 'border-bottom': '2px solid rgba(255,255,255,0.1)' });
                const below = getBelow();
                if (below && below.style.getPropertyValue('top') === '0') {
                    setStyles(below, { top: '45vh', height: '55vh' });
                }
            }
        };
        const existing = getChatEl();
        if (existing) { onFound(existing); return; }
        chatObserver = new MutationObserver(() => {
            const chatEl = getChatEl();
            if (chatEl) onFound(chatEl);
        });
        chatObserver.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { if (chatObserver) { chatObserver.disconnect(); chatObserver = null; } }, 15000);
    }

    // ── Build Overlay ───────────────────────────────────────────────────────
    function buildOverlay() {
        const wrapper = document.createElement('div');
        wrapper.id = 'ts-wrapper';
        wrapper.style.cssText = `display:flex;position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#000;overflow:hidden;`;

        const left = document.createElement('div');
        left.id = 'ts-left';
        left.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;background:#000;position:relative;`;

        const divider = document.createElement('div');
        divider.id = 'ts-divider';
        divider.style.cssText = `flex:0 0 0;width:0;cursor:col-resize;position:relative;background:rgba(255,255,255,0.04);transition:flex-basis ${TRANSITION};overflow:hidden;z-index:10;`;
        const pip = document.createElement('div');
        pip.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:4px;height:40px;border-radius:2px;background:rgba(255,255,255,0.18);pointer-events:none;`;
        divider.appendChild(pip);
        divider.addEventListener('mouseenter', () => { divider.style.background = 'rgba(59,130,246,0.22)'; pip.style.background = 'rgba(59,130,246,0.8)'; });
        divider.addEventListener('mouseleave', () => { divider.style.background = 'rgba(255,255,255,0.04)'; pip.style.background = 'rgba(255,255,255,0.18)'; });

        const right = document.createElement('div');
        right.id = 'ts-right';
        right.style.cssText = `flex:0 0 0;width:0;height:100%;overflow-y:auto;overflow-x:hidden;background:#0f0f0f;border-left:1px solid rgba(255,255,255,0.06);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;padding:0;box-sizing:border-box;opacity:0;transition:flex-basis ${TRANSITION},opacity 0.3s;`;

        initDividerDrag(divider, left, right);

        const closeBtn = document.createElement('button');
        closeBtn.id = 'ts-close';
        closeBtn.title = 'Close side panel';
        closeBtn.style.cssText = `position:absolute;top:8px;right:8px;z-index:10010;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.2s;color:rgba(255,255,255,0.7);padding:0;`;
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.onclick = () => collapseSplit(true);
        left.appendChild(closeBtn);

        wrapper.appendChild(left);
        wrapper.appendChild(divider);
        wrapper.appendChild(right);
        return wrapper;
    }

    function initDividerDrag(divider, left, right) {
        divider.addEventListener('mousedown', (e) => {
            if (!isSplit) return;
            e.preventDefault();
            const wrapper = splitWrapper;
            const totalW = wrapper.getBoundingClientRect().width;
            const startX = e.clientX;
            const startLeftPct = left.getBoundingClientRect().width / totalW * 100;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const dragShield = document.createElement('div');
            dragShield.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:col-resize;';
            document.body.appendChild(dragShield);

            const onMove = (me) => {
                const dx = me.clientX - startX;
                const newLeftPct = Math.max(25, Math.min(85, startLeftPct + (dx / totalW * 100)));
                const newRightPct = 100 - newLeftPct;
                right.style.flexBasis = newRightPct + '%';
                right.style.width = newRightPct + '%';
                divider.style.flexBasis = '6px';
                positionedEls.forEach(el => {
                    el.style.setProperty('width', `calc(${newRightPct}% - 2px)`, 'important');
                });
                saveRatio(100 - newRightPct);
            };
            const onUp = () => {
                dragShield.remove();
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                triggerPlayerResize();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    }

    // ── Mount Overlay ───────────────────────────────────────────────────────
    function mountOverlay() {
        if (isActive) return;
        const player = getPlayer();
        const below = getBelow();
        const chatEl = getChatEl();
        if (!player) return;
        if (!below && !chatEl) return;

        positionedEls = [];
        scrollTarget = null;
        origPlayerParent = player.parentElement;
        origPlayerNextSibling = player.nextSibling;
        isActive = true;

        const wrapper = buildOverlay();
        splitWrapper = wrapper;
        document.body.appendChild(wrapper);
        document.body.classList.add('ts-active');

        const left = wrapper.querySelector('#ts-left');

        // Move player into left panel
        const video = document.querySelector('video.html5-main-video');
        const wasPlaying = video && !video.paused;
        left.insertBefore(player, wrapper.querySelector('#ts-close'));
        setStyles(player, {
            width: '100%', height: '100%', flex: '1',
            'min-height': '0', display: 'flex', 'flex-direction': 'column'
        });
        if (wasPlaying && video) {
            requestAnimationFrame(() => video.play().catch(() => {}));
        }

        // Force player to fill container
        let fpsCount = 0;
        const doForce = () => {
            if (fpsCount > 5) return;
            fpsCount++;
            requestAnimationFrame(() => { if (isActive) forcePlayerSize(); });
        };
        doForce();

        let resizeDebounce = null;
        playerResizeObs = new ResizeObserver(() => {
            clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => { fpsCount = 0; doForce(); }, 200);
        });
        playerResizeObs.observe(left);

        setTimeout(() => triggerPlayerResize(), 600);

        // Block interaction on elements behind overlay
        if (below) setStyles(below, { 'pointer-events': 'none' });
        if (chatEl) {
            setStyles(chatEl, { 'pointer-events': 'none' });
            chatEl.removeAttribute('collapsed');
            chatEl.removeAttribute('hide-chat-frame');
        }

        // Pre-scroll to comments so YT's IntersectionObserver fires (behind overlay)
        if (videoType !== 'live' && below) {
            const scrollToComments = () => {
                const commentsEl = below.querySelector('ytd-comments');
                if (commentsEl) commentsEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(scrollToComments, { timeout: 2000 });
            } else {
                setTimeout(scrollToComments, 800);
            }
        }

        // Kill view-transition-name containing blocks that trap position:fixed
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy) flexy.style.setProperty('view-transition-name', 'none', 'important');
        if (below) below.style.setProperty('view-transition-name', 'none', 'important');

        // Hide #related but keep #secondary visible (chat is inside #secondary)
        const sec = document.querySelector('#secondary');
        if (sec) {
            sec.style.setProperty('view-transition-name', 'none', 'important');
            const related = sec.querySelector('#related');
            if (related) { related.dataset.tsHidden = '1'; related.style.display = 'none'; }
            setStyles(sec, { display: 'block', 'pointer-events': 'none' });
            sec.dataset.tsHidden = '1';
        }
        const cols = document.querySelector('#columns');
        if (cols) cols.style.setProperty('view-transition-name', 'none', 'important');

        const right = wrapper.querySelector('#ts-right');

        const isInRightContent = (target) => {
            if (right.contains(target)) return true;
            return positionedEls.some(el => el.contains(target));
        };

        wheelHandler = (e) => {
            if (!isActive) return;
            if (!isSplit && e.deltaY > 0) { expandSplit(); return; }
            if (isSplit && !isInRightContent(e.target)) {
                const sEl = scrollTarget;
                if (sEl) {
                    if (e.deltaY < 0 && sEl.scrollTop <= 0) { collapseSplit(false); return; }
                    sEl.scrollTop += e.deltaY;
                }
            }
        };
        touchStartY = 0;
        touchHandler = (e) => { const t = e.touches[0]; if (t) touchStartY = t.clientY; };
        touchMoveHandler = (e) => {
            if (!isActive) return;
            const t = e.touches[0]; if (!t) return;
            if (!isSplit && touchStartY - t.clientY > 30) { expandSplit(); return; }
            if (isSplit && !isInRightContent(e.target)) {
                const delta = touchStartY - t.clientY;
                const sEl = scrollTarget;
                if (sEl) {
                    if (delta < -40 && sEl.scrollTop <= 0) { collapseSplit(false); return; }
                    sEl.scrollTop += delta * 0.5;
                }
                touchStartY = t.clientY;
            }
        };
        splitWrapper.addEventListener('wheel', wheelHandler, { passive: true, capture: true });
        splitWrapper.addEventListener('touchstart', touchHandler, { passive: true, capture: true });
        splitWrapper.addEventListener('touchmove', touchMoveHandler, { passive: true, capture: true });
        middleMouseHandler = startSplitAutoscroll;
        document.addEventListener('mousedown', middleMouseHandler, true);

        windowResizeHandler = () => { if (isActive) triggerPlayerResize(); };
        window.addEventListener('resize', windowResizeHandler);

        clickToPauseHandler = (e) => {
            const t = e.target;
            if (t.closest('.ytp-chrome-bottom, .ytp-chrome-top, .ytp-ce-element, .ytp-cards-teaser, .ytp-ad-overlay-container, .ytp-settings-menu, .ytp-popup, .ytp-paid-content-overlay, a')) return;
            const vid = document.querySelector('video.html5-main-video');
            if (!vid) return;
            if (t !== vid && !t.closest('.html5-video-container')) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            if (vid.paused) vid.play().catch(() => {});
            else vid.pause();
        };
        const mp = document.getElementById('movie_player');
        if (mp) mp.addEventListener('click', clickToPauseHandler, true);
        clickToPauseMp = mp;
    }

    // ── Expand Split ────────────────────────────────────────────────────────
    function expandSplit() {
        if (isSplit || !isActive) return;
        isSplit = true;
        entering = true;
        positionedEls = [];

        // Add split class for CSS overrides
        document.body.classList.add('ts-split');

        const wrapper = splitWrapper;
        const right = wrapper.querySelector('#ts-right');
        const divider = wrapper.querySelector('#ts-divider');
        const below = getBelow();
        const chatEl = getChatEl();

        // Re-detect type at expand time — chat may have appeared since mount
        if (chatEl && videoType === 'standard') {
            videoType = detectVideoType();
            if (videoType === 'standard') videoType = 'live'; // chat frame exists = treat as live
        }
        const type = videoType;

        const closeBtn = wrapper.querySelector('#ts-close');
        if (closeBtn) closeBtn.style.opacity = '0.3';

        let leftPct = getSavedRatio();
        leftPct = Math.max(25, Math.min(85, leftPct));
        const rightPct = 100 - leftPct;

        right.style.flexBasis = rightPct + '%';
        right.style.width = rightPct + '%';
        divider.style.flexBasis = '6px';
        divider.style.width = '6px';

        if (type === 'live' || type === 'vod') {
            right.style.opacity = '0';
            right.style.background = 'transparent';
            right.style.borderLeft = 'none';
        } else {
            right.style.opacity = '1';
        }

        if (type === 'live') {
            setupChat(chatEl, rightPct, '0', '100vh');
            scrollTarget = chatEl;
        } else if (type === 'vod') {
            setupChat(chatEl, rightPct, '0', '45vh');
            if (chatEl) setStyles(chatEl, { 'border-bottom': '2px solid rgba(255,255,255,0.1)' });
            if (below) {
                const hasChat = !!chatEl;
                positionOverRight(below, rightPct, hasChat ? '45vh' : '0', hasChat ? '55vh' : '100vh');
                setStyles(below, { width: `calc(${rightPct}% - 2px)`, padding: '16px 14px 72px', display: 'block' });
            }
            scrollTarget = chatEl || below;
        } else {
            if (chatEl) {
                videoType = 'live';
                right.style.opacity = '0';
                right.style.background = 'transparent';
                right.style.borderLeft = 'none';
                setupChat(chatEl, rightPct, '0', '100vh');
                scrollTarget = chatEl;
            } else if (below) {
                positionOverRight(below, rightPct, '0', '100vh');
                setStyles(below, { width: `calc(${rightPct}% - 2px)`, padding: '16px 14px 72px', display: 'block' });
                scrollTarget = below;
                waitForChat(rightPct, '0', '100vh');
            }
        }
        startActionDock();

        const onExpanded = () => {
            if (right) right.removeEventListener('transitionend', onTransEnd);
            entering = false;
            triggerPlayerResize();
            if (type !== 'live' && below) below.scrollTop = 0;
            scheduleActionDock(0);
        };
        const onTransEnd = (e) => {
            if (e.propertyName === 'flex-basis' || e.propertyName === 'opacity') onExpanded();
        };
        right.addEventListener('transitionend', onTransEnd);
        setTimeout(() => { if (entering) onExpanded(); }, 500);

        const rightWheelHandler = (e) => {
            if (!isSplit) return;
            const sEl = scrollTarget;
            if (!sEl) return;
            if (e.deltaY < 0 && sEl.scrollTop <= 0) { collapseSplit(false); e.stopPropagation(); }
        };
        right.addEventListener('wheel', rightWheelHandler, { passive: true });

        // Re-enable pointer events on positioned content
        if (below) removeStyles(below, ['pointer-events']);
        if (chatEl) removeStyles(chatEl, ['pointer-events']);
    }

    // ── Collapse Split ──────────────────────────────────────────────────────
    function collapseSplit(full) {
        if (!isActive) return;
        isSplit = false;

        document.body.classList.remove('ts-split');
        restoreActionDock();
        stopSplitAutoscroll();

        const wrapper = splitWrapper;
        const right = wrapper.querySelector('#ts-right');
        const divider = wrapper.querySelector('#ts-divider');
        const closeBtn = wrapper.querySelector('#ts-close');

        if (right) {
            right.style.flexBasis = '0';
            right.style.width = '0';
            right.style.opacity = '0';
        }
        if (divider) {
            divider.style.flexBasis = '0';
            divider.style.width = '0';
        }
        if (closeBtn) closeBtn.style.opacity = '0';

        unpositionAll();
        if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }

        const below = getBelow();
        const chatEl = getChatEl();
        if (below) setStyles(below, { 'pointer-events': 'none' });
        if (chatEl) {
            setStyles(chatEl, { 'pointer-events': 'none' });
            restoreChatFill(chatEl);
        }

        setTimeout(() => triggerPlayerResize(), 400);

        if (full) teardown();
    }

    // ── Teardown ────────────────────────────────────────────────────────────
    function teardown() {
        if (!isActive) return;
        isActive = false;
        isSplit = false;
        stopSplitAutoscroll();

        const player = getPlayer();
        if (player && origPlayerParent) {
            const video = document.querySelector('video.html5-main-video');
            const wasPlaying = video && !video.paused;
            if (origPlayerNextSibling && origPlayerNextSibling.parentNode === origPlayerParent) {
                origPlayerParent.insertBefore(player, origPlayerNextSibling);
            } else {
                origPlayerParent.appendChild(player);
            }
            removeStyles(player, ['width', 'height', 'flex', 'min-height', 'display', 'flex-direction']);
            if (wasPlaying && video) requestAnimationFrame(() => video.play().catch(() => {}));
        }

        const mp = document.getElementById('movie_player');
        if (mp) {
            removeStyles(mp, ['width', 'height']);
            const vc = mp.querySelector('.html5-video-container');
            const vid = mp.querySelector('video.html5-main-video');
            if (vc) removeStyles(vc, ['width', 'height']);
            if (vid) removeStyles(vid, ['width', 'height', 'object-fit']);
            const ytdP = mp.closest('ytd-player');
            const innerCont = ytdP?.querySelector('#container');
            if (innerCont) removeStyles(innerCont, ['width', 'height', 'padding-bottom']);
        }

        if (clickToPauseMp && clickToPauseHandler) {
            clickToPauseMp.removeEventListener('click', clickToPauseHandler, true);
        }
        clickToPauseHandler = null;
        clickToPauseMp = null;

        if (playerResizeObs) { playerResizeObs.disconnect(); playerResizeObs = null; }
        if (windowResizeHandler) { window.removeEventListener('resize', windowResizeHandler); windowResizeHandler = null; }
        if (chatObserver) { chatObserver.disconnect(); chatObserver = null; }
        if (middleMouseHandler) {
            document.removeEventListener('mousedown', middleMouseHandler, true);
            middleMouseHandler = null;
        }

        if (splitWrapper) { splitWrapper.remove(); splitWrapper = null; }

        document.body.classList.remove('ts-active', 'ts-split');
        restoreActionDock();

        unpositionAll();
        const below = getBelow();
        if (below) removeStyles(below, ['pointer-events']);
        const chatEl = getChatEl();
        if (chatEl) {
            removeStyles(chatEl, ['pointer-events']);
            restoreChatFill(chatEl);
        }
        const sec = document.querySelector('#secondary');
        if (sec) {
            delete sec.dataset.tsHidden;
            removeStyles(sec, ['display', 'pointer-events', 'view-transition-name']);
            const related = sec.querySelector('#related');
            if (related) { delete related.dataset.tsHidden; related.style.removeProperty('display'); }
        }
        // Restore view-transition-name on elements we cleared it from
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy) flexy.style.removeProperty('view-transition-name');
        if (below) below.style.removeProperty('view-transition-name');
        const cols = document.querySelector('#columns');
        if (cols) cols.style.removeProperty('view-transition-name');

        origPlayerParent = null;
        origPlayerNextSibling = null;

        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    }

    // ── Activate / Deactivate ───────────────────────────────────────────────
    function activate() {
        if (isActive) return;
        videoType = detectVideoType();
        mountOverlay();
    }

    function deactivate() {
        if (!isActive) return;
        teardown();
    }

    // ── Navigation handler ──────────────────────────────────────────────────
    function onNavigate() {
        const vid = getVideoId();
        if (!isWatchPage()) {
            deactivate();
            lastVideoId = null;
            return;
        }
        if (vid !== lastVideoId) {
            if (isActive) teardown();
            lastVideoId = vid;
            // Wait for DOM + player data to settle
            setTimeout(() => {
                if (isWatchPage() && getVideoId() === vid) {
                    activate();
                }
            }, 800);
        }
    }

    // ── Fullscreen detection ────────────────────────────────────────────────
    function onFullscreenChange() {
        const flexy = document.querySelector('ytd-watch-flexy');
        if (flexy?.hasAttribute('fullscreen') || document.fullscreenElement) {
            if (splitWrapper) splitWrapper.style.display = 'none';
        } else {
            if (splitWrapper && isActive) {
                splitWrapper.style.display = 'flex';
                setTimeout(() => triggerPlayerResize(), 200);
            }
        }
    }

    // ── Init ────────────────────────────────────────────────────────────────
    function init() {
        window.addEventListener('yt-navigate-finish', onNavigate);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        window.addEventListener('popstate', () => setTimeout(onNavigate, 300));

        if (isWatchPage()) {
            lastVideoId = getVideoId();
            const waitForPlayer = () => {
                if (getPlayer()) {
                    activate();
                } else {
                    setTimeout(waitForPlayer, 200);
                }
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => setTimeout(waitForPlayer, 800));
            } else {
                setTimeout(waitForPlayer, 800);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
