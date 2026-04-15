# Changelog

All notable changes to Astra Deck are documented here. Versions are listed newest-first.

---

## [3.6.7] - Theater Split Overhaul + SponsorBlock Cleanup

### Fixed

- **Seek stutter on quality lock.** `autoMaxResolution` triggered quality DOM-click cascade on every `canplay`/`playing` media event, including seeks. Added `_qualityLocked` flag that short-circuits the handler once quality is set for the current video. Eliminates 3x stutter on every forward/backward seek.
- **Settings panel listener leak.** `_panelUIListenersAttached` was never reset when the panel closed, causing duplicate document-level listeners on every open/close cycle. Now reset in the panel-close MutationObserver callback.
- **SponsorBlock skip toasts removed.** Skip notifications (`showToast`) overlaid the video during playback. Removed entirely — segments still auto-skip silently. Deleted the dead `sbShowSkipNotice` setting and sub-feature definition.
- **Theater Split close button invisible.** CSS set `display:none` but expand code only set `opacity:0.3` without switching to `display:flex`. Close button now properly shows/hides on expand/collapse.
- **Theater Split dismiss not honored.** The `dismissed` parameter in `_collapseSplit()` was accepted but never used. Closing via the X button or Escape would not prevent scroll-down from immediately re-expanding. Now sets `_dismissed = true` which blocks `_expandSplit()` until the next video navigation.
- **Theater Split scroll-up collapse too sensitive.** A single scroll-up tick at `scrollTop=0` instantly collapsed the right panel. Now requires 3 consecutive scroll-up ticks within 600ms to trigger collapse.
- **Theater Split fullscreen conflict.** Native fullscreen (F key) with the overlay active caused the z-index:9999 overlay to block player controls. Added `fullscreenchange` listener that hides the overlay and restores natural player sizing during fullscreen, then re-mounts on exit.
- **Theater Split destroy leak.** `_lastVideoId` was not reset in `destroy()`, so disabling and re-enabling the feature on the same video could leave `_dismissed` stuck as `true`.

### Improved

- **SponsorBlock scheduled skipping.** Replaced 500ms `setInterval` polling with scheduled `setTimeout` that computes delay to the next segment boundary. Event-driven reschedule on `playing`/`seeked`/`ratechange`, clears on `pause`.
- **SponsorBlock hash-prefix privacy.** Full video ID was sent to the SponsorBlock API. Now uses SHA-256 hash-prefix lookup (`/api/skipSegments/{first4chars}`) with client-side filtering.
- **A/B Loop event-driven.** Replaced 100ms `setInterval` with `timeupdate` event listener on the video element.
- **Auto-skip chapters event-driven.** Replaced 1s `setInterval` with `timeupdate` event via document capture phase.
- **MiniPlayerBar IntersectionObserver.** Replaced scroll event polling with `IntersectionObserver` on the player element (threshold 0.1).
- **Codec filtering: MediaCapabilities.decodingInfo.** YouTube bypassed `canPlayType`/`isTypeSupported` overrides via `MediaCapabilities.decodingInfo`. Added third API override in `ytkit-main.js`.
- **Theater Split divider touch drag.** Added `touchstart`/`touchmove`/`touchend` handlers using shared drag logic. Works on tablets/touchscreens.
- **Theater Split double-click divider reset.** Double-clicking the divider resets the split ratio to the default 75/25. Extracted `_applyDividerRatio()` shared helper.
- **Theater Split escape key.** Pressing Escape collapses the split panel (with input/textarea/contentEditable guard).
- **Theater Split mount animation.** Overlay fades in over 300ms instead of snapping into place.
- **Theater Split divider grip pattern.** Replaced plain rectangle pip with three-dot vertical grip (universal drag indicator). Always partially visible (opacity 0.4), full opacity on hover.
- **Theater Split collapse strip.** Increased height from 24px to 32px, indicator bar always visible with subtle gradient at rest, thicker handle on hover.
- **Settings panel click delegation.** Consolidated 4 separate `document.addEventListener('click', ...)` into 1 delegated handler.
- **Custom CSS injection event-driven.** Replaced 2s `setInterval` polling with `ytkit-settings-changed` event listener.
- **Hex color regex fix.** `themeAccentColor` regex accepted invalid lengths like 5 or 7. Now validates exact lengths (3, 4, 6, or 8 hex chars).
- **Background fetch timeout floor.** Added 1s minimum to prevent near-zero timeouts from aborting fetches.
- **Navigate rule cleanup.** Debounce timer cleared when the last navigate rule is removed.
- **Storage change listener resilience.** Wrapped `chrome.storage.onChanged` in try-catch.
- **Cinema ambient glow hidden-tab cleanup.** Removed pointless RAF wrapper around setTimeout when tab is hidden, added `_hiddenTimer` cleanup.
- **Download poll panel disconnect.** Added `if (!panel.isConnected)` guard to clear orphaned download progress intervals.
- **Auto-dismiss "Still Watching" popup.** Added `yt-popup-opened` event listener for faster detection.
- **Video screenshot improved.** Filename includes video title, `URL.revokeObjectURL` delayed to 5 seconds.

### Dead code removed

- Unused `_headerH()` method and dead `const hh` variable in `_buildOverlay()`
- No-op `_initDividerDrag(divider, left, null)` call (null guard returned immediately)
- `sbShowSkipNotice` default setting and sub-feature definition

---

## [3.6.5] - Settings Panel Handler Performance

### Fixed

- **Settings panel event listeners ran on every YouTube interaction.** `attachUIEventListeners()` registers seven document-level event listeners (four `click`, two `input`, one `change`) that power the in-page settings panel — search box, feature toggles, nav tabs, export/import buttons, textareas, selects, ranges, color pickers. These listeners are registered once per session (guarded by `_panelUIListenersAttached`) and then fire on **every** click / input / change anywhere on the page for the rest of the session, not just while the panel is open. Each handler did `e.target.matches(...)` or `closest(...)` on a panel-scoped selector and silently fell through when the target wasn't in the panel. On a session full of YouTube comment typing, thumbnail clicks, and scroll/click interactions, that's hundreds of wasted DOM walks per minute. Each handler now short-circuits with `if (!isSettingsPanelOpen()) return;` as its first line — the selectors it's looking for only exist inside the panel DOM, so guarding on panel-open state is semantically equivalent but cuts the work to zero when the panel is closed (which is 99% of the time).

### Notes

Fifth audit pass. Focused on the `buildSettingsPanel` / `attachUIEventListeners` surface which hadn't been inspected in earlier passes. Purely a performance fix — no user-visible behavior change.

---

## [3.6.4] - Theater Split Audit Pass

### Fixed

- **Theater Split: wheel-gesture collision with YouTube volume.** The document-level `wheel` handler in `stickyVideo` was registered with `{ passive: true, capture: true }` but never called `stopPropagation()` on events it acted on, so YouTube's own wheel-to-volume listener on `#movie_player` fired on the same event. Scrolling over the player to expand the split, or scrolling the split-open right panel past the top to collapse, was also adjusting the video volume at the same time. `passive: true` only prevents `preventDefault()` — `stopPropagation()` is still legal and is now called in each action branch. Same treatment applied to the matching touchmove handler.
- **Theater Split: `_entering` flag leak on early collapse.** `_expandSplit` sets `_entering = true` and arms a 500 ms fallback timer that calls `onExpanded()` if `_entering` is still true. `_collapseSplit` did not reset the flag, so collapsing the split before the expand transition finished left the fallback timer to fire on an already-collapsed panel, re-running `_triggerPlayerResize()` and `checkAllButtons()` on stale state. `_collapseSplit` now clears `_entering`.
- **Theater Split: divider drag orphans on alt-tab.** The divider drag listener attaches `mousemove` / `mouseup` to `window` plus a full-viewport `dragShield` overlay. If the user alt-tabs mid-drag or the pointer leaves the document before releasing the mouse, `mouseup` may never deliver, leaving the shield covering the page and both listeners attached until the next drag replaces them. `onUp` is now also fired on `window.blur` and `document.mouseleave` so the drag cannot orphan.

### Notes

Fourth and final defensive-hardening pass. The wheel/volume collision is the highest-impact user-visible fix in this series — it's a direct UX regression that anyone using Theater Split with a mouse wheel would feel every time they expanded or collapsed the split.

---

## [3.6.3] - Third QA Audit Pass

### Fixed

- **Pop-Out Player — Document PiP window leak + duplicate listeners.** Two separate `pagehide` listeners were attached to the PiP window (one to restore the video, one to clear the `__ytkit_videoPopped` flag), and the internal `_timeInterval` that polled `currentTime` every 500 ms for the time display was only cleared in `destroy()` — not when the PiP window itself closed. Closing the PiP window therefore left the interval running forever, continuing to read `currentTime` from the reparented video and write to a detached DOM node. The three cleanup steps are now merged into a single `pagehide` handler that stops the interval, reparents the video, clears the flag, and nulls the window reference
- **Watch Time Tracker — 90-day retention off-by-one.** The pruning loop used `if (dk < cutoffKey) delete stats.days[dk]`, which kept the day exactly 90 days ago in addition to the 90 days since, resulting in 91 days of history instead of the labeled 90. Changed to `<=` so the retention window matches the label exactly

### Notes

Third consecutive defensive-hardening pass. Every finding in this release was verified in-situ (not just pattern-matched) — several audit-agent claims were rejected as false positives during verification (e.g. `removeEventListener({capture:true})` vs `true` being "mismatched"; `pauseOtherTabs` BroadcastChannel leak; `contextMenuPlayer` player-element tracking).

---

## [3.6.2] - Second QA Audit Pass

### Fixed

- **Cinema Ambient Glow background-tab CPU waste** — the canvas sampling loop ran at full rate while the tab was hidden even though the glow was invisible. Now short-circuits when `document.hidden` is true and falls back to a 2 s poll until the tab is visible again
- **Video Screenshot cross-origin silent failure** — `ctx.drawImage(video, ...)` on a tainted frame was throwing a `SecurityError` that the caller swallowed, leaving the user with no feedback. `drawImage` and `toBlob` are now wrapped in targeted try/catch blocks that surface a clear "Screenshot blocked: cross-origin video frame" toast
- **CPU Tamer pump interval leak + destroy clarity** — the internal rAF pump `origSetInterval(..., 125)` was orphaned (no handle captured), so disabling the feature left the pump firing forever. The handle is now stored on `_pumpInterval` and destroy clears it using the *preserved native* `clearInterval` so teardown is robust even while the wrappers are still in place. Init also captures the originals before flipping the global flag so a failed setup does not desync restore state
- **Options page: redundant toggle change listeners** — `renderToggleControl` was attaching two separate `change` handlers per toggle input (one for draft state, one for label text). Merged into a single handler; halves the per-click work without changing behavior

### Build system

- **`--bump` argument validation** — running `node build-extension.js --bump` with no type (or with a bogus type) previously silently no-op'd the bump because the falsy check skipped the whole block. Now fails loudly with a usage error and non-zero exit
- **YTKIT_VERSION regex hard-fail** — if the `const YTKIT_VERSION = '...'` line in `ytkit.js` ever stops matching the replacement regex (e.g. refactored to template literal), the build now aborts with an explicit error instead of silently shipping a stale embedded version
- **Userscript version sync** — `ytkit.user.js` is now kept in sync with the extension version on every `--bump`, regardless of the `--with-userscript` flag. The flag still controls whether a `build/` artifact copy is emitted. Fixes the drift where the repo-tracked userscript was stuck at 3.2.0 while the extension was at 3.6.x
- **Build cleanup on failure** — the build function now wraps Chrome + Firefox staging in a `try/finally` so orphan `chrome-stage/` and `firefox-stage/` directories can't survive a mid-flight crash
- **Skip `node_modules/` during staging** — an accidental `node_modules/` under `extension/` would previously get copied into the ZIP. Now unconditionally excluded
- **Deleted dead `build.js`** — it targeted a `YTKit.user.js` file that no longer exists (renamed to lowercase) and produced a `YTKit.min.user.js` that nothing consumed. Confirmed disconnected from the pipeline before removal

### Notes

No user-visible feature changes. This is a second defensive-hardening pass following 3.6.1.

---

## [3.6.1] - QA Audit Hardening

### Fixed

- **Innertube client version parsing (ISOLATED world)** — `_getClientVersion()` previously read `window.ytcfg`, which is invisible to content scripts running in the ISOLATED world, so the value was always `null` and the Innertube API fallback used a hardcoded stale version. It now parses `INNERTUBE_CLIENT_VERSION` out of page `<script>` tags (same pattern as `_getInnertubeApiKey()`), with a recent default. This fixes silent failures of the caption-extraction Method 2 path weeks after each YouTube client rotation
- **`ytInitialPlayerResponse` brace-counting parser** — the fallback JSON extractor tracked `{` / `}` depth without respecting string literals, so any JSON value containing `}` inside a string (e.g. comment text, video titles, descriptions) caused the extracted substring to be truncated early and `JSON.parse()` to throw. Parser now properly tracks string state and `\` escapes
- **TrustedHTML fallback innerHTML sink** — the non-policy branch of `TrustedHTML.setHTML()` did `element.innerHTML = ''` to clear before appending parsed nodes; replaced with `element.replaceChildren()` so no innerHTML assignment happens on the fallback path
- **Settings panel modal Escape handler** — guarded the `keydown` listener installation with `injectPageModalButton._escInstalled` so future refactors that call the injector twice cannot stack duplicate listeners
- **`setInterval` double-init guards** — `resumePlayback._saveInterval`, `watchProgress._saveInterval`, and `SponsorBlock._skipHandler` now clear any existing interval before creating a new one. Fixes a stacking leak when `init()` runs twice before `destroy()` (rapid disable/enable toggles or async load overlap)
- **`background.js` message guard** — the top-level `onMessage` listener now rejects malformed payloads (`!msg || typeof msg !== 'object' || typeof msg.type !== 'string'`) before reading `msg.type`, eliminating a potential uncaught throw on corrupt messages
- **`EXT_FETCH` default timeout** — callers that omit `timeout` previously got an unbounded fetch; the proxy now defaults to a 30 s timeout (still clamped to `MAX_FETCH_TIMEOUT_MS`) so a hung upstream cannot pin the service worker
- **`EXT_FETCH` body size enforcement** — the response reader now streams chunks through a bounded loop and aborts as soon as the cumulative byte count exceeds `MAX_RESPONSE_BYTES`, so a chunked response without a `Content-Length` header cannot allocate past the limit before the size check runs

### Notes

No user-visible feature changes. All fixes are defensive hardening driven by a dedicated QA audit pass across `ytkit.js`, `background.js`, and the runtime cores.

---

## [3.6.0] - Runtime Modularization & Hardening

### Changed

- **Modular runtime architecture** — extracted shared helpers from the monolithic `ytkit.js` into seven dedicated `extension/core/*.js` modules: `env.js`, `storage.js`, `styles.js`, `url.js`, `page.js`, `navigation.js`, `player.js`. Modules are loaded in the ISOLATED world before `ytkit.js` via `manifest.json` `content_scripts`, cutting `ytkit.js` by roughly 3,100 lines and isolating state from feature code
- **Hardened settings flow** — `options.js` now consumes the generated `default-settings.json` + `settings-meta.json` catalogs instead of re-implementing defaults inline; settings reads/writes go through `StorageManager` with consistent fallback/migration paths
- **Hardened runtime paths** — player lookup, URL parsing, and navigation helpers now live behind a single source of truth (`core/player.js`, `core/url.js`, `core/navigation.js`); removed duplicated ad-hoc implementations in `ytkit.js`
- **Background script hardening** — tightened `background.js` permission checks and message routing alongside the runtime extraction
- **Build pipeline** — `build-extension.js` now emits `extension/default-settings.json` + `extension/settings-meta.json` on every build by brace-balanced parsing of the `defaults:` block and the `SETTINGS_VERSION` constant in `ytkit.js`, so the runtime catalog cannot drift from source

### Notes

No user-facing features added or removed. This release is a behind-the-scenes refactor to make future feature work faster and reduce regressions from shared-state bugs.

---

## [3.2.0] - 115+ Features Mega Update

### Added

- **115+ new features** across 8 feature waves, all off by default
- **Firefox extension support** — build system produces `.xpi` with auto-patched manifest (Gecko `browser_specific_settings`, `background.scripts` array)
- **SharedAudio manager** — volumeBoost, skipSilence, audioNormalization, audioEqualizer share one MediaElementSource via `SharedAudio.register()`/`unregister()`, preventing Web Audio API conflicts
- **StorageManager** — unified persistent storage for resumePlayback (500-entry cap), per-channel speed, timestamp bookmarks, watch time tracking
- **CONFLICT_MAP** — automatic mutual-exclusion for conflicting features (persistentSpeed vs perChannelSpeed, removeAllShorts vs redirectShorts, etc.)

#### Wave 1 — Quick Wins
autoDismissStillWatching, remainingTimeDisplay, showPlaylistDuration, showTimeInTabTitle, customProgressBarColor, reversePlaylist, rssFeedLink, preciseViewCounts, videoScreenshot, compactUnfixedHeader, returnYoutubeDislike, volumeBoost, perChannelSpeed, hideWatchedVideos, antiTranslate, pauseOtherTabs

#### Wave 2 — Complex & Differentiating
skipSilence, abLoop, fineSpeedControl, showChannelVideoCount, redirectHomeToSubs, notInterestedButton, timestampBookmarks, blueLightFilter, disableInfiniteScroll, audioNormalization, popOutPlayer (Document PiP API + fallback)

#### Wave 3 — Audio & Automation
audioEqualizer (10-band EQ, 9 presets), watchTimeTracker, alwaysShowProgressBar, sortCommentsNewest, autoSkipChapters, chapterNavButtons, videoLoopButton, persistentSpeed, codecSelector (H.264/VP9/AV1), ageRestrictionBypass, autoLikeSubscribed, thumbnailPreviewSize

#### Wave 4 — Polish & Deep Enhancement
cinemaAmbientGlow, transcriptViewer, searchFilterDefaults, forceStandardFps, stickyChat, autoExpandDescription, scrollToPlayer, hideEndCards, hideInfoCards, keyMoments

#### Wave 5 — Power User & QoL
autoTheaterMode, resumePlayback, miniPlayerBar, playbackStatsOverlay, hideNotificationBadge, autoPauseOnSwitch, creatorCommentHighlight, copyVideoTitle, channelAgeDisplay, speedIndicatorOverlay, hideAutoplayToggle, fullscreenOnDoubleClick

#### Wave 6 — Interaction & Media Control
volumeScrollWheel, rememberVolume, pipButton, autoSubtitles, focusedMode, thumbnailQualityUpgrade, watchLaterQuickAdd, playlistEnhancer, commentSearch, videoZoom, forceDarkEverywhere

#### Wave 7 — Customization & Utilities
customCssInjection, shareMenuCleaner, autoClosePopups, videoResolutionBadge, likeViewRatio, downloadThumbnail, grayscaleThumbnails, disableAutoplayNext, channelSubCount, customSpeedButtons, openInNewTab, muteAdAudio

#### Wave 8 — Restored Archive Features
**SponsorBlock per-category controls:** sbCat_sponsor, sbCat_selfpromo, sbCat_interaction, sbCat_intro, sbCat_outro, sbCat_preview, sbCat_filler, sbCat_music_offtopic
**Playback & navigation:** preventAutoplay, scrollWheelSpeed (Shift+scroll, yields to volumeScrollWheel/videoZoom), playbackSpeedOSD, persistentSpeed step config (speedStep)
**Comments & interaction:** preloadComments, commentNavigator (J/K navigation), enableHandleRevealer (resolves @handles in comments)
**Chapters & transcript:** autoOpenChapters, autoOpenTranscript
**Notifications:** chronologicalNotifications (sorts newest-first)
**Live streams:** adaptiveLiveLayout (dynamic chat/video sizing)
**Shorts:** shortsAsRegularVideo (redirects /shorts/ to /watch)
**Theme & styling:** themeAccentColor (custom accent color picker), nyanCatProgressBar (rainbow animated progress bar), noFrostedGlass (removes backdrop-filter blur)
**Player behavior:** theaterAutoScroll (scroll to player on theater mode), enableCPU_Tamer (requestAnimationFrame timer throttling)
**Downloads & external players:** showVlcQueueButton, showMpvButton, showDownloadPlayButton, autoDownloadOnVisit, downloadQuality selector, preferredMediaPlayer selector, subsVlcPlaylist (export subscriptions feed to VLC)
**Advanced:** enableEmbedPlayer (custom HTML5 embed player), deArrow (DeArrow API — clickbait title/thumbnail replacement with 6 sub-settings), showStatisticsDashboard (detailed extension stats panel), settingsProfiles (save/load settings presets), debugMode (verbose console logging)
**CSS-only:** hideNotificationButton, hideLatestPosts, disableMiniPlayer

#### Wave 9 — Final Archive Restoration
squareSearchBar (square search bar corners), squareAvatars (square channel avatars), fitPlayerToWindow (player fills entire browser viewport), disableSpaNavigation (force full page loads instead of SPA transitions)

### Fixed

- **Feature conflicts resolved through code cooperation** rather than mutual exclusion:
  - forceH264 + codecSelector share a single canPlayType patch reading settings at call-time
  - focusedMode hides only related videos, not `#secondary` — cooperates with transcriptViewer, timestampBookmarks, stickyVideo
  - popOutPlayer sets `__ytkit_videoPopped` flag — pipButton and fullscreenOnDoubleClick check before acting
  - autoPauseOnSwitch + pauseOtherTabs tag pause reasons on the video element to avoid resume conflicts
  - volumeScrollWheel yields Ctrl+scroll to videoZoom via ctrlKey guard
  - hideEndCards merged into hideVideoEndContent as sub-feature (eliminates CSS overlap)
  - hideInfoCards corrected to target info card selectors, not end card selectors

### Changed

- **Build system** — `node build-extension.js` now outputs Chrome ZIP+CRX3 and Firefox ZIP+XPI
- **Settings panel** — feature groups reorganized for 79+ features with search
- **Userscript** synced to extension source with native GM_* APIs

---

## [2.8.0] - Maintenance & Ad Blocker Tuning

### Changed

- **Ad blocker cosmetic filters updated** — Refreshed CSS selector list to cover YouTube's current ad container patterns, including updated masthead, player overlay, and feed ad slot selectors
- **PRUNE_KEYS updated** — Added newer ad payload keys seen in current YouTube API responses (`auxiliaryUi`, `adBreakServiceRenderer`, `watchNextAdsRenderer`)
- **SponsorBlock category list** — Updated to include `selfpromo` and `preview` categories introduced in recent SponsorBlock API versions
- **Theater Split** — Improved detection of YouTube's responsive layout breakpoints to prevent Theater Split from activating on narrower viewports where it degrades layout

### Fixed

- **VLC/yt-dlp buttons not appearing on initial load** — Added retry loop for button injection when YouTube's player controls render late during SPA navigation
- **Video Hider keyword filter false positives** — Regex compilation no longer throws unhandled exceptions on invalid patterns; invalid regexes are silently skipped with a console warning

---

## [2.7.5] - Feature Cleanup

### Removed

- **Playback category** — Removed entire Playback settings group and all 5 features:
  - Mousewheel Speed Control (Shift+scroll speed adjust)
  - Video Screenshot (S key frame capture)
  - Return YouTube Dislike (API-based dislike counts)
  - Cinema Mode (dim overlay with C key)
  - A-B Loop (bracket-key loop points)
- **Fit to Window** — Removed redundant player sizing feature (Theater Split handles this)
- **RYD API connection** — Removed `@connect returnyoutubedislikeapi.com` from userscript header
- **Conflict rules** — Removed fitPlayerToWindow vs stickyVideo conflict entries

### Changed

- **Expand Video Width** — Simplified CSS selector (no longer excludes removed fit-to-window class)

---

## [2.7.4] - Userscript Research & Hardening

### Changed

- **Shorts redirect** — Switched from `location.href` to `location.replace()` so redirected Shorts don't create back-button history entries (pattern from popular redirect scripts)
- **SPA navigation** — Added `yt-page-data-updated` as backup event alongside `yt-navigate-finish`, catching edge cases where navigation finish fires before DOM is ready (pattern from YouTube Alchemy)
- **Return YouTube Dislike formatting** — Replaced manual K/M/B formatter with `Intl.NumberFormat` compact notation for locale-aware dislike counts (e.g. "1,2K" in French, "1.2K" in English)
- **Return YouTube Dislike button detection** — Replaced single CSS selector with multi-layout fallback chain (6 selectors) that handles YouTube's segmented button, toggle button, and menu container layouts (pattern from official RYD script)

### Fixed

- **v2.7.2** — Added Disable Seek Preview as CSS-only feature
- **v2.7.3** — Upgraded Disable Seek Preview to full JS+CSS feature with MutationObserver tooltip detection and mousemove gesture blocking (CSS-only approach was insufficient)

---

## [2.7.1] - Debloat & Build Pipeline

### Changed

- **Color theme compression** — Replaced 21-property theme objects with comma-separated hex strings + `_getTheme()` decompressor, cutting theme data by ~60%
- **Theater Split deduplication** — Extracted `_setStyles`, `_removeStyles`, `_setupChat` helpers; simplified live/VOD/standard branching (~43 lines saved)
- **Settings sidebar deduplication** — Extracted `makeNavBtn` and `addDragReorder` helpers for sidebar button creation (~65 lines saved)

### Added

- **build.js** — Node.js build script that strips comments and collapses whitespace for production builds (25% size reduction: 607KB -> 455KB)

---

## [2.7.0] - Progress Bar & Seek Fix

### Fixed

- **Seek bar completely broken** — Removed all CSS dimension overrides (height, margin-top, width) on YouTube's progress bar container, progress bar, and progress list that were breaking YouTube's internal seek coordinate calculations
- **SponsorBlock blocking manual seeks** — Skip loop running at 60fps was fighting with user scrubbing, immediately bouncing playback out of sponsor segments during drag. Added mousedown/mouseup detection on progress bar to pause skip loop while scrubbing, plus 800ms grace period after release
- **Video going black on window un-maximize** — Added resize event listener to Theater Split overlay that forces video GPU re-composite via will-change toggle when window geometry changes
- **Theater Split fighting with player controls** — Removed CSS overrides that forced width/left on .ytp-chrome-bottom and .ytp-progress-bar-container, and removed forcePlayerSize code that kept stripping/re-setting those values

### Changed

- **Nyan Cat theme scrubber** — Kept cat.gif on scrubber handle but removed all dimension overrides (width, height, margins) that broke seek hit detection
- **Removed starfall scrubber pull indicator** — Decorative overlay that contributed to progress bar dimension misalignment
- **Settings panel padding** — Added small breathing room (4px) to sidebar, nav buttons, feature cards, pane headers, footer, and search container so elements don't ride on borders

---

## [2.6.9] - Ultra-Condensed Settings Panel

### Changed

- **Zero-padding layout** — Header, sidebar, nav buttons, feature cards, pane headers, and footer all use zero vertical padding for maximum density
- **Responsive breakpoints updated** — All three breakpoints (900px, 700px, 480px) adjusted to match condensed dimensions

### Removed

- **Logo icon** — Removed the red YouTube logo from the settings header
- **Pane icons** — Removed category icon badges from all pane headers (regular, Ad Blocker, Video Hider)
- **Status badges** — Removed Active/Off/Enabled/Crashed state badges from feature cards
- **Recently changed section** — Removed the recently changed pills, tracking function, and event dispatch

---

## [2.6.7] - Disable Autoplay Next

### Added
- **Disable Autoplay Next** — New feature (enabled by default) that prevents YouTube from automatically playing the next suggested video when the current one ends. Turns off YouTube's native autoplay toggle and cancels pending navigation on video end

---

## [2.6.6] - Comment Enhancements Cleanup

### Removed
- **Collapse replies button** — Removed the per-thread collapse/show replies toggle entirely
- **Cold/warm heat indicators** — Heat indicators now only appear on comments with 1K+ likes (hot/fire tiers); removed the low-value cold (<100) and warm (100-999) tiers

---

## [2.6.5] - Survey Spam Blocked

### Added
- **Survey cosmetic hiding** — Block `ytd-inline-survey-renderer` and `ytd-single-option-survey-renderer` spam popups via the ad blocker cosmetic selector list

---

## [2.6.4] - Seek Preview Fix

### Fixed
- **Playback bar hidden** — The Disable Seek Preview CSS was too broad, hiding the entire time tooltip and chapter markers. Narrowed selectors to only target the storyboard frame preview image while preserving the normal progress bar UI

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

- Removed ChapterForge (AI chapter generation, LLM providers, batch processing) → see [Chapterizer](https://github.com/SysAdminDoc/Chapterizer) for this functionality
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
