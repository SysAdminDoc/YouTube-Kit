# Changelog

All notable changes to YTKit are documented here. Versions are listed newest-first.

---

## [2.6.3] - Bug Audit & Stability Fixes

### Fixed
- **StorageManager data loss** — `_flush()` no longer clears the dirty set before confirming each save succeeded; failed keys are retried on next flush
- **Settings load race condition** — `settingsManager.load()` no longer reads storage twice for version comparison; uses the value from the initial read
- **Settings panel null crash** — Added null guards on all `.closest('[data-feature-id]')` calls in event handlers (feature toggle, select, range, color, textarea) to prevent crash if DOM structure is unexpected
- **Feature init dependency ordering** — `topoSort` now resolves `dependsOn` dependencies in addition to `parentId`, ensuring dependent features always initialize after their prerequisites
- **Clipboard silent failures** — All `navigator.clipboard.writeText()` calls now have `.catch()` handlers that show error toast feedback instead of failing silently
- **Ad blocker circular reference guard** — `deepPruneAds()` now uses a WeakSet to skip already-visited objects, preventing potential stack overflow on circular JSON references in YouTube API responses

---

## [2.6.2] - Black Video Fix

### Fixed
- **Conflict enforcement at init time** — Features in CONFLICT_MAP (e.g., Fit Player to Window vs Theater Split) are now checked during initialization, not just when toggling in settings. Previously, both could initialize simultaneously and fight over the player layout, causing a black video with only audio
- **Default settings** — Changed `fitPlayerToWindow` default to `false` since Theater Split (stickyVideo) is the preferred default and initializes as a critical feature

---

## [2.6.1] - Seek Preview Fix

### Added
- **Disable Seek Preview** — New feature (enabled by default) that hides the large video frame preview overlay on the progress bar, fixing issues where the preview blocks click-to-seek

---

## [2.6.0] - Unified Theme System

### Changed
- **Theme-aware accents** — Watch Page Restyle, Refined Comments, Comment Enhancements, and reply box styling now follow the selected Color Theme instead of using hardcoded purple
- **CSS custom properties** — Introduced `--ytkit-accent`, `--ytkit-accent-rgb`, and `--ytkit-accent-light` variables that all visual features share; defaults to purple when no theme is selected
- **Cosmic comments** — The accent-tinted comment section background (previously Nyan Cat-exclusive) is now part of Refined Comments and adapts to any Color Theme
- **Nyan Cat theme** — Updated to use the shared accent variable system; cosmic comments background now derives from accent color

### How it works
Selecting a Color Theme (e.g., Gruvbox, Nord, Tokyo Night) now automatically tints the Watch Page Restyle buttons/borders, Refined Comments thread lines/author names, and the comment section background to match the theme's accent color. No extra configuration needed.

---

## [2.5.0] - Quality & Infrastructure

### Removed
- **Mousewheel Volume Control** — Removed entirely; intercepting scroll events on the player prevented normal page scrolling to reach comments

### Changed
- **Conflict enforcement** — CONFLICT_MAP now auto-disables conflicting features when you enable one (instead of just showing a warning toast)
- **Settings search debounce** — Search input is now debounced (150ms) for smoother filtering on large feature lists
- **API key caching** — `_getInnertubeApiKey` result is cached to avoid repeated script tag scanning
- **Navigation listener guard** — `yt-navigate-finish` listener is now guarded against duplicate registration

### Added
- `.github/ISSUE_TEMPLATE/bug_report.md` — Structured bug report template
- `.github/ISSUE_TEMPLATE/feature_request.md` — Feature request template
- `.github/pull_request_template.md` — PR template with testing checklist
- `CONTRIBUTING.md` — Contributor guide with architecture overview and code style guidelines

---

## [2.4.0] - Competitive Feature Parity

New features inspired by research across Enhancer for YouTube, ImprovedTube, Return YouTube Dislike, Unhook, BlockTube, YouTube NonStop, Nova YouTube, and DeArrow:

- **Mousewheel Speed Control** (Playback) - Hold Shift + scroll on video to adjust playback speed (0.25x - 4x) with overlay indicator
- **Mousewheel Volume Control** (Playback) - Scroll on video to adjust volume in 5% increments with overlay indicator
- **Video Screenshot** (Playback) - Press S while watching to capture current frame as PNG (copies to clipboard + downloads)
- **Return YouTube Dislike** (Playback) - Shows dislike counts and like/dislike ratio bar using the RYD API
- **Cinema Mode** (Playback) - Press C to dim everything except the video player; press again to toggle off
- **A-B Loop** (Playback) - Press [ for loop start, ] for loop end, \ to toggle. Visual markers on progress bar.
- **Force H.264 Codec** (Quality) - Prefer H.264 over VP9/AV1 for lower CPU usage on older hardware
- **Normalize Clickbait Titles** (Content) - Converts ALL CAPS titles to Title Case while preserving acronyms
- **Watch Progress Indicators** (Content) - Shows colored progress bars on thumbnails based on locally-saved watch history
- Enhanced "Still Watching?" prevention with proactive activity simulation
- New "Playback" settings category for player interaction features

## [2.3.0] - Robustness & Polish

- Protocol handler error handling: try/catch with informative toast for ytdl://, ytvlc://, ytmpv://, ytvlcq:// failures
- SponsorBlock hash prefix fallback: retries with 6-char prefix on 404 (improves segment detection)
- Updated ad blocker PRUNE_KEYS with 2025+ YouTube ad payload keys
- Updated AD_RENDERER_KEYS_ARR with newer ad renderer types
- Cobalt instance health check: HEAD request on init, auto-switches to fallback if unreachable
- Established z-index hierarchy constants (Z.TOAST, Z.CONTEXT_MENU, Z.SETTINGS_PANEL, etc.) to prevent layer collisions
- Settings import rollback protection: validates import data and restores backup on failure
- Crash counter resets on manual feature toggle (previously stayed stuck after SPA navigation crashes)
- Merged duplicate _showToast wrappers into direct showToast calls
- SponsorBlock category descriptions now show detailed explanations in settings
- Added "Copy URL at Timestamp" to video context menu
- SponsorBlock segment count toast shown when segments are found
- Standardized web download button styling to match VLC/DL/MP3 pill buttons

## [2.2.0] - Architecture Hardening

- Centralized error boundaries for all feature init/destroy/toggle paths with DebugManager logging
- Settings migration versioning system (auto-migrates stored settings across version upgrades)
- Topological sort for feature initialization (parents always init before children)
- Fixed 37+ silent catch blocks with structured error logging
- Fixed empty destroy() methods: quickLinkEditor event listener leak, cobaltUrl GM storage cleanup
- Fixed playerContextMenu moviePlayer listener leak (stored reference + cleanup in destroy)
- Fixed Video Hider batch buffer not cleared on destroy
- Migrated chatStyleComments from standalone MutationObserver to central dispatcher
- Added DOM element cache (`cachedQuery`) with SPA navigation invalidation
- Debounced Video Hider `_processAllVideos()` to prevent rapid reprocessing on navigation
- Consistent `_initialized` state tracking across all toggle, reset, and navigation paths
- Fixed stale version strings (was showing 1.3.6 in console/exports)

## [2.1.0] - Refined Core

- Re-added auto-resume video position with configurable threshold
- Re-added GPU context recovery (monitor switch fix)
- Re-added sticky video (picture-in-picture while scrolling)
- Clean share URL stripping
- Video context menu with quick actions
- Quick link navigation menu
- Chat-style comments option
- Conflict detection for incompatible settings
- Feature preview descriptions in settings panel
- Dismissible page controls via `wrapPageControl`
- External ad filter list support via URL

## [2.0.0] - Core Rewrite

**Breaking:** Removed ChapterForge AI chapters and DeArrow clickbait removal to produce a lighter, focused core script.

- Removed ChapterForge (AI chapter generation, LLM providers, batch processing)
- Removed DeArrow (crowdsourced title/thumbnail replacement)
- Removed external theme `@resource` dependencies (themes now inline)
- Enhanced ad blocker: extended prune keys, new ad renderer interception, regex-optimized `replaceAdKeys`, `jsonNeedsPruning` pre-check for performance
- Added endpoint interception for `/log_event`, `/ad_break`, `/pagead/`, `/doubleclick.net/`
- New Page Quick Settings modal (floating per-page context toggles)
- New `stripTracking` feature (removes `si`, `pp`, `feature`, `cbrd` params from shared links)
- New `quickLinkMenu` header navigation
- Added MIT license in script header
- Reduced script size by 54% (16,320 -> 7,413 lines)

## [1.3.0] - ChapterForge AutoSkip & Summary

- ChapterForge AutoSkip mode with 4 levels: off, gentle (long pauses), normal (pauses + fillers), aggressive (all gaps + speed silence)
- ChapterForge Summary mode: paragraph (clean prose) or timestamped (indexed format)
- DeArrow debug logging toggle for verbose console output
- SponsorBlock label retry limit (`LABEL_MAX_ATTEMPTS: 20`)
- Settings manager refactored for compactness

## [1.2.1] - Bug Fixes & Polish

- Minor refinements across existing features
- Stability fixes throughout the codebase
- No new major features

## [1.2.0] - DeArrow Integration

- DeArrow integration: crowdsourced better titles and thumbnails from the DeArrow database
- Replaces clickbait titles and thumbnails automatically
- Connects to `dearrow-thumb.ajay.app` for thumbnail replacements

## [1.1.0] - ChapterForge & Theme Manager

- ChapterForge: AI-powered chapter and point-of-interest generation
  - LLM provider support (OpenAI, OpenRouter, built-in)
  - Batch processing for multiple videos
  - Audio download via Innertube + Cobalt
- Theme Manager: consolidated Better Dark Mode and Catppuccin Mocha themes
- UI Style Manager: glassmorphism, gradient metallic styles
- Sticky video (picture-in-picture style player while scrolling)
- `cssFeature()` factory for boilerplate-free CSS-only features
- `IntersectionObserver` helper for performance
- Watch page element hider with granular toggles (title, views, date, channel avatar, etc.)
- Auto-skip "Still Watching" prompts
- Settings panel search functionality

## [1.0.0] - Stable Release

**First stable release.** Cleaned up experimental features for a focused, reliable core.

- Removed ProfilesManager (settings profiles)
- Removed KeyboardManager (keyboard shortcuts)
- Removed Statistics Dashboard
- Removed theater auto-scroll and comment navigator
- Simplified DebugManager to stub
- Retained full ad blocker with all 8 proxy/interception layers
- Retained TranscriptService, UndoManager, StorageManager, ChannelSettingsManager
- All core feature groups stable and tested

## [0.8.0] - Ad Blocker

**Major addition:** Full-featured ad blocker with split-architecture bootstrap.

- Two-phase ad blocker design:
  - Phase 1: Page-context proxy engine (bypasses Tampermonkey sandbox)
  - Phase 2: CSS/DOM observer + SSAP in userscript sandbox
- JSON.parse proxy to prune ad objects from parsed responses
- fetch() and XMLHttpRequest proxies to strip ad keys from network responses
- DOM bypass prevention and timer neutralization
- Promise.then anti-detection and property traps
- Video ad neutralizer (MutationObserver for `.ad-showing` class)
- Deep recursive ad pruner with 17+ ad renderer key types
- Massive CSS ad-hiding stylesheet (masthead, player, feed, search, sidebar, shorts, mobile)
- SSAP (Server-Side Ad Playback) detection and auto-skip
- Switched from `document-end` to `document-start` for early interception
- Auto-resume video position with configurable threshold
- Watch time tracker
- Speed indicator badge
- Playback speed on-screen display
- Theater auto-scroll
- Comment navigator
- Ad blocker settings pane in UI
- External filter list support via URL

## [0.7.0] - Broadened Scope

- Removed URL exclusions for `embed`, `shorts`, `playlist`, `results` pages
- Script now runs on more YouTube page types
- Minor refinements and fixes across existing features

## [0.6.0] - Architecture Overhaul

**Major rewrite** introducing service-based architecture.

- Unified `StorageManager` with cache, dirty-tracking, and debounced flush
- `TranscriptService`: multi-method transcript extraction with failover and language selection
- `UndoManager` for reversible actions
- `KeyboardManager` for shortcut handling
- `DebugManager` for structured logging
- `ProfilesManager`: save/load multiple settings configurations
- `ChannelSettingsManager`: per-channel setting overrides
- `TickManager`: periodic task execution engine
- `Trusted Types` safe HTML helpers for YouTube CSP compliance
- Page type detection (`PageTypes` enum + `getCurrentPage()`) for lazy-loading
- Settings version migration system
- Statistics dashboard in settings panel
- Profiles management UI
- Script size nearly doubled (8K -> 12K lines)

## [0.5.0] - Expanded Features

- Speed presets for playback
- Return YouTube Dislike integration
- Timestamp bookmarks
- Watch progress tracking
- Expanded content hiding options
- Embed player download option
- Video context menu additions

## [0.4.0] - Video Hider

- "Hide Videos" button: X overlay on video thumbnails in home/feeds
- Persistent hidden video list stored via `GM_setValue` with `localStorage` fallback
- Video ID extraction from multiple DOM patterns
- Undo toast with action button
- MutationObserver to continuously apply hiding to dynamically loaded content

## [0.3.0] - Downloads & Persistent Buttons

- Downloads group: VLC Player streaming (`ytvlc://` protocol)
- VLC Queue button (`ytvlcq://`)
- Local download via yt-dlp (`ytdl://` protocol)
- MPV Player button (`ytmpv://`)
- Download+Play button
- Subscriptions VLC Playlist
- Auto-download on visit option
- Download quality selector and preferred media player
- Persistent button injection system with 20+ fallback parent selectors
- Toast notification system with animations

## [0.2.0] - SponsorBlock & Trusted Types

- SponsorBlock (Lite): segment fetching from `sponsor.ajay.app` with category-based skipping
- Trusted Types safe SVG creation (`createSVG`)
- Notification button and badge hiding
- Square search bar and square avatars options
- No ambient mode, no frosted glass toggles
- Compact layout option
- Auto theater mode
- Persistent progress bar
- Auto-open chapters and transcript
- Chronological notifications
- Download provider selection (Cobalt/y2mate/savefrom)
- Hide playables, members-only content, news, playlists on home
- Premium UI with feature cards and accent colors
- Removed Modern Dark Theme sub-features and Nyan Cat progress bar

## [0.1.0] - Initial Release

The first version of YTKit as a Tampermonkey userscript.

- Header tweaks: hide Create button, Voice Search, logo redirect to subscriptions, widen search bar
- Sidebar hiding
- Theme support: native dark mode, Better Dark Mode, Catppuccin Mocha, Modern Dark Theme (blur, zen mode, padded sections, premium logo, PiP, branding, progress gradient, squarify)
- Nyan Cat progress bar
- Content: remove/redirect Shorts, disable hover preview, 5 videos per row, hide paid content
- Watch page: fit player, hide related, adaptive live layout, expand video width, floating logo
- Behavior: prevent autoplay, auto-expand description, sort comments newest first
- Clutter: hide merch shelf, clarify boxes, hashtags, pinned comments, end cards
- Live chat: 12+ individual toggles (header, menu, popout, reactions, timestamps, polls, ticker, super chats, bots, etc.)
- Action buttons: hide like/dislike/share/clip/thanks/save/sponsor, Cobalt downloader
- Player controls: hide SponsorBlock, next, autoplay, subtitles, miniplayer, PiP, theater, fullscreen
- Quality: auto max resolution, enhanced bitrate
- Advanced: external adblock toggle, CPU tamer, handle revealer, yout.ube redirect
- Settings panel with import/export, toast notifications
- Bot filter and keyword filter for comments
