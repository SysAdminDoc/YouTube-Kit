# YouTube-Kit

## Overview
Chrome + Firefox MV3 extension and Tampermonkey userscript for comprehensive YouTube enhancement. Theater mode, ChapterForge AI chapters, DeArrow, filler skip, transcript extraction, video/channel hiding.

## Architecture
- ISOLATED world content script (`ytkit.js`) at `document_idle` — all DOM manipulation and feature logic
- MAIN world bridge script (`ytkit-main.js`) at `document_start` — handles `canPlayType` patching for codec/format filtering via data attribute bridge (`data-ytkit-codec`)
- Early CSS injection (`early.css`) at `document_start` for anti-FOUC (hide end cards, info cards, autoplay toggle, etc.)
- GM_* compatibility shim for userscript mode
- YTYT-Downloader consolidated into this repo (separate repo was deleted)
- Settings panel cleanup registry (`_panelCleanups`) prevents memory leaks from intervals/observers
- Options page (`options.html`/`options.js`) uses `chrome.storage.local` directly — no dependency on gm-compat or ytkit.js

## Build System
- `node build-extension.js [--bump patch|minor|major]` — produces all artifacts in `build/`
- Outputs: Chrome ZIP + CRX3, Firefox ZIP + XPI, userscript copy
- CRX3 signing via `crx3` npm package with persistent `ytkit.pem` key (gitignored)
- Firefox manifest auto-patched: `background.scripts` array instead of `service_worker`, `browser_specific_settings.gecko` added
- XPI is a renamed ZIP — Firefox's native extension format
- `--bump` updates version in `manifest.json`, `ytkit.js` (YTKIT_VERSION), and `ytkit.user.js` header

## Release Policy
- **Always compile a CRX and an XPI for every release.** Don't wait to be asked. Running `node build-extension.js --bump <patch|minor|major>` already emits Chrome ZIP + CRX3 and Firefox ZIP + XPI in one pass — use it, and attach **all four** artifacts to the GitHub release (`.crx`, `.zip` Chrome, `.xpi`, `.zip` Firefox).
- Standard release flow: bump + build → commit the version bump + CHANGELOG → push main → `gh release create vX.Y.Z` with all four build artifacts from `build/`.
- Never ship a release that has only the ZIPs. Users install directly from the `.crx` / `.xpi` — missing them is a regression.

## Firefox Differences
- Manifest uses `background.scripts` array instead of `service_worker` (broader Firefox MV3 compat)
- `browser_specific_settings.gecko.id` set to `ytkit@sysadmindoc.github.io`
- `strict_min_version: "128.0"` — requires Firefox 128+
- `chrome.*` APIs work in Firefox as a compat alias — no code changes needed

## v3.2.0 Features (9 waves)

### Wave 1 — Quick Wins + Medium
**All off by default:** autoDismissStillWatching, remainingTimeDisplay, showPlaylistDuration, showTimeInTabTitle, reversePlaylist, rssFeedLink, preciseViewCounts, videoScreenshot, compactUnfixedHeader, returnYoutubeDislike, perChannelSpeed, hideWatchedVideos (select: dim/hide), antiTranslate, pauseOtherTabs
**Theme:** customProgressBarColor (color picker, default #ff0000)

### Wave 2 — Complex & Differentiating
**All off by default:** abLoop, fineSpeedControl, showChannelVideoCount, redirectHomeToSubs, notInterestedButton, timestampBookmarks, blueLightFilter (intensity range 10-80), disableInfiniteScroll, popOutPlayer (Document PiP API + fallback)

### Wave 3 — Player Polish
**All off by default:** watchTimeTracker (90-day retention), alwaysShowProgressBar, sortCommentsNewest, autoSkipChapters (textarea patterns), chapterNavButtons, videoLoopButton, persistentSpeed (select), codecSelector (H.264/VP9/AV1), ageRestrictionBypass, autoLikeSubscribed, thumbnailPreviewSize

### Wave 4 — Polish & Deep Enhancement
**All off by default:** cinemaAmbientGlow (canvas color sampling), transcriptViewer (sidebar with clickable timestamps), searchFilterDefaults (select: upload_date/view_count/rating), forceStandardFps (block 60fps), stickyChat, autoExpandDescription, scrollToPlayer, hideEndCards (CSS), hideInfoCards (CSS), keyMoments (chapter highlight CSS)

### Wave 5 — Power User & QoL
**All off by default:** autoTheaterMode, resumePlayback (StorageManager, 500 entry cap, 15s save interval), miniPlayerBar (floating bar with progress/play/pause on scroll-past), playbackStatsOverlay (codec/resolution/dropped frames/bandwidth), hideNotificationBadge (CSS), autoPauseOnSwitch (visibilitychange API), creatorCommentHighlight (CSS border+badge), copyVideoTitle (button next to title), channelAgeDisplay (calculated age badge), speedIndicatorOverlay (monospace overlay at 1x+ speeds), hideAutoplayToggle (CSS), fullscreenOnDoubleClick (dblclick capture handler)

### Wave 6 — Interaction & Media Control
**All off by default:** rememberVolume (persist volume level), pipButton (one-click PiP in controls), autoSubtitles (auto-enable CC), focusedMode (hide everything except video+comments), thumbnailQualityUpgrade (maxresdefault replacement with fallback), watchLaterQuickAdd (clock overlay on thumbnails), playlistEnhancer (shuffle + copy all URLs), commentSearch (filter bar above comments), videoZoom (Ctrl+scroll to zoom, drag to pan up to 5x), forceDarkEverywhere (dark theme on all YT pages)

### Wave 7 — Customization & Utilities
**All off by default:** customCssInjection (textarea for user CSS), shareMenuCleaner (hide social share buttons), autoClosePopups (cookie/survey/premium popup auto-dismiss), videoResolutionBadge (4K/HD badges on thumbnails), likeViewRatio (like:view % badge), downloadThumbnail (maxres download button), grayscaleThumbnails (grayscale until hover), disableAutoplayNext (clicks autoplay toggle off), channelSubCount (prominent sub count badge), customSpeedButtons (0.5x-3x preset bar), openInNewTab (video links open new tabs)

### Wave 8 — Restored Archive Features
**All off by default:** preventAutoplay, hideNotificationButton, noFrostedGlass, autoOpenChapters, autoOpenTranscript, chronologicalNotifications, hideLatestPosts, disableMiniPlayer, adaptiveLiveLayout, commentNavigator, shortsAsRegularVideo, themeAccentColor (color picker), theaterAutoScroll, scrollWheelSpeed (Shift+scroll), playbackSpeedOSD, enableCPU_Tamer (rAF timer throttling), enableHandleRevealer (@handle resolution), autoDownloadOnVisit, deArrow (DeArrow API with 6 sub-settings), showStatisticsDashboard, settingsProfiles, debugMode, nyanCatProgressBar

### Wave 9 — Final Archive Restoration
**squareSearchBar** (on by default), **squareAvatars** (on by default), **fitPlayerToWindow** (off by default, conflicts with stickyVideo), **disableSpaNavigation** (off by default)

### Not Yet Ported to Extension (userscript-only)
The following features exist in the userscript but have NOT been implemented in the extension build:
- **SharedAudio system** (volumeBoost, skipSilence, audioNormalization, audioEqualizer) — requires MAIN world access to Web Audio API
- **SponsorBlock integration** — ported in v3.4.0 with 9 category toggles + progress bar segments
- **Cobalt download fallback** (_tryCobaltApiDownload, _webDownloadFallback) — extension uses MediaDL-only path
- **Direct YouTube stream download** (_tryDirectDownload) — extension uses MediaDL-only path
- **muteAdAudio** — requires MAIN world ad detection
- **MAIN world ad blocking** (adblock-main.js) — not present in extension
- **Protocol scheme handlers** (ytdl://, ytvlc://, ytmpv://) — not ported

### Architecture Notes
- **CONFLICT_MAP** covers: persistentSpeed <> perChannelSpeed, autoPauseOnSwitch <> pauseOtherTabs, focusedMode <> hideSidebar+hideRelatedVideos+transcriptViewer+timestampBookmarks+stickyVideo, forceH264 <> codecSelector, hideEndCards <> hideVideoEndContent, popOutPlayer <> fullscreenOnDoubleClick+pipButton
- RYD API added to manifest host_permissions
- Screenshot also added to right-click context menu
- Per-Channel Speed stores in StorageManager keyed by channel handle, capped at 500 entries
- Pause Other Tabs uses BroadcastChannel API
- Timestamp Bookmarks persist in StorageManager with inline note editing
- Cinema Ambient Glow uses requestAnimationFrame + 500ms throttled canvas sampling
- Transcript Viewer fetches json3 format from YouTube caption tracks API
- **SponsorBlock** fetches segments from `sponsor.ajay.app/api/skipSegments`, auto-skips during playback via 500ms interval check on `video.currentTime`, renders colored segment bars on the progress bar. 9 category toggles (all skip-categories on by default, poi_highlight off). Shows toast on skip.
- **DeArrow** caches API responses with configurable TTL, formats titles (sentence/title case), falls back to original on API miss
- **enableCPU_Tamer** patches `setTimeout`/`setInterval` to use `requestAnimationFrame` when tab is background
- **sync-userscript.js** — converts extension source to userscript: strips gm-compat preamble, removes `_rw` bridge, replaces `_rw.` -> `window.`

## Download Architecture

### Overview
All download entry points (context menu, player buttons, DL/MP3 buttons) call `ytKitDownload(url, audioOnly)`. The legacy `mediaDLDownload()` wrapper delegates to it for backward compatibility.

### Download Flow (ytKitDownload)
The extension uses a **MediaDL-only** download path (no Cobalt/direct-stream fallbacks):
1. **MediaDL server** (cached check via `MediaDLManager.check()`) — best quality: 1080p+, video+audio muxing via ffmpeg, background downloads with progress tracking
2. **Auto-start** (`MediaDLManager.tryAutoStart()`) — fires `mediadl://start` protocol, polls health endpoint up to 4 times at 1.5s intervals
3. **Install prompt** — if server unavailable, guides user through install (PowerShell one-liner or .ps1 download)

### MediaDLManager Singleton
- `check(force?)` — GET `http://127.0.0.1:9751/health`, caches result for 30s. Returns `{ ok, token, version }` or `{ ok: false }`
- `tryAutoStart(retries?)` — fires `mediadl://start` protocol once per page load, polls health
- `resetAutoStart()` — clears `_autoStartAttempted` and `_status` so retry/recheck buttons can trigger fresh attempts
- `showInstallPrompt(mode)` — floating panel with two modes:
  - `'install'` mode: "Copy Install Command" + "Download Installer Script (.ps1)" + "I just installed it — check again" + "Not now" (permanent dismiss via `ytkit_mediadl_prompt_dismissed`)
  - `'retry'` mode: "Try Starting Server Again" (with inline status feedback) + all install buttons, no permanent dismiss

### chrome.downloads Integration
- `manifest.json` has `"downloads"` permission
- `background.js` handles `DOWNLOAD_FILE` messages -> `chrome.downloads.download()` with browser cookie jar
- `triggerDownload(url, filename)` sends message to background

### Context Menu Integration
- Right-click video player -> YTKit Downloads menu
- Download Video / Audio / Transcript + Stream VLC/MPV + Screenshot + Copy URL
- "Setup MediaDL (1080p+ Downloads)" option appears at bottom when server isn't running

## Security (background.js)
- **EXT_FETCH proxy** uses domain allowlist — only YouTube, RYD, SponsorBlock, MediaDL localhost, and Cobalt instances are permitted
- Request headers filtered: `Host`, `Origin`, `Cookie`, `Authorization`, etc. are stripped before forwarding
- Response headers filtered: `Set-Cookie`, `Authorization`, etc. are stripped before returning to content script
- Response body capped at 10 MB to prevent memory exhaustion
- Fetch timeout capped at 60 seconds
- HTTP method validated against allowlist (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS)
- `DOWNLOAD_FILE` validates URL protocol (HTTP/S only) and sanitizes filenames
- `OPEN_URL` validates protocol (HTTP/S only)
- Explicit CSP on extension pages: `script-src 'self'; object-src 'self'`

## Gotchas
- ISOLATED world cannot access page JS globals (`window.ytcfg`, `ytInitialPlayerResponse`) — uses regex + brace-counting fallback parsing from `<script>` tags, with Innertube API as second method
- ISOLATED world prototype overrides (e.g. `HTMLVideoElement.prototype.canPlayType`) do NOT affect MAIN world — codec filtering MUST go through the MAIN world bridge (`ytkit-main.js`)
- YouTube deprecated `setPlaybackQuality()` and `setPlaybackQualityRange()` — they are no-ops. Quality forcing uses DOM click simulation through the settings menu (`.ytp-settings-button` -> Quality submenu -> target resolution)
- `trustedTypes.createPolicy()` required for all innerHTML on YouTube
- `el.innerHTML = ''` still violates trustedTypes CSP — use `el.textContent = ''` to clear
- YouTube filter chips (e.g. "Recently uploaded") replace grid content via Polymer recycling without firing `yt-navigate-finish` — need capture-phase click listener on `yt-chip-cloud-chip-renderer` to trigger reprocessing
- Video element processing must always re-check for missing X buttons even on already-processed elements, since YouTube's Polymer re-renders can strip child DOM nodes while keeping the parent element in place
- Sandbox iframes (`sandbox` attribute without `allow-scripts`) will throw if you access `contentWindow` — check sandbox attribute BEFORE appending
- **`_rw` bridge regex fragility**: The ISOLATED world parses `ytInitialPlayerResponse` from `<script>` tags. YouTube frequently changes the surrounding code. The parser now uses multiple regex patterns plus a brace-counting JSON extraction fallback. If all fail, the Innertube API is used as a second method.
- **Innertube client version**: Hardcoding `clientVersion` causes YouTube to reject requests when the version drifts too far. The download code now dynamically extracts `INNERTUBE_CLIENT_VERSION` from page scripts, falling back to a recent default.
- **`chrome.downloads` cookies**: `chrome.downloads.download()` uses the browser's own cookie jar for the URL's domain — unlike `fetch()` in the background script which runs in the extension's context.
- **MediaDL auto-start protocol**: `mediadl://start` is silently ignored if the protocol handler isn't registered (no error dialog). The `_autoStartAttempted` flag prevents repeated protocol launches on the same page load, but `resetAutoStart()` clears it for explicit retry actions.

## Runtime Module Layout (v3.6.0+)
Shared runtime helpers extracted from `ytkit.js` into `extension/core/`:
- `core/env.js` — environment/browser detection, runtime globals
- `core/storage.js` — StorageManager, settings persistence, chrome.storage wrappers
- `core/styles.js` — GM_addStyle shim, scoped style injection
- `core/url.js` — URL parsing/manipulation helpers (video id, channel handle, etc.)
- `core/page.js` — page type detection, DOM landmarks
- `core/navigation.js` — yt-navigate-finish handling, SPA route change dispatch
- `core/player.js` — `<video>` element lookup, player state helpers

All core modules are loaded in the ISOLATED world before `ytkit.js` via the `content_scripts` entry in `manifest.json`. Modules attach to a shared namespace so `ytkit.js` can consume them without imports (MV3 content scripts are classic scripts, not modules).

`default-settings.json` is generated by `build-extension.js` from the `defaults:` object in `ytkit.js` (brace-balanced parser). `settings-meta.json` tracks `SETTINGS_VERSION`. Both are written on every build and consumed by `options.js`/`ytkit.js` at runtime instead of the previous inline objects.

## Current Version: v3.6.0
