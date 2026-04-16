# Codex Change Log

Purpose: quick handoff notes for other agents working in this repo. This is not the public release changelog.

Last updated: 2026-04-15
Scope: wider audit + repair pass on the MV3 extension build in `extension/`

## What Codex repaired

### 1. Popup, settings, and options flow
- Repaired popup storage wiring so quick toggles read/write `ytSuiteSettings` instead of broken top-level `chrome.storage.local` keys.
- Added migration for legacy popup writes and `chrome.storage.onChanged` syncing.
- Replaced the dead popup `returnYoutubeDislike` toggle with working `commentSearch`.
- Upgraded popup accessibility and UX:
  - real button/switch controls instead of clickable `div`s
  - visible focus states
  - labeled search
  - reduced-motion-safe transitions
- Hardened popup YouTube tab detection and options-page fallback behavior.
- Files: `extension/popup.js`, `extension/popup.html`, `extension/popup.css`

### 2. Background bridge, permissions, and network paths
- Hardened `background.js` request proxying:
  - cookie reads limited to YouTube-family domains
  - request body normalization fixed so object payloads do not become `"[object Object]"`
- Moved AI summary provider calls off direct content-script cross-origin fetches and onto the extension bridge.
- Added/updated host permissions for OpenAI, Anthropic, Gemini, and common local Ollama endpoints.
- Moved transcript-related remote fetches to bridged helpers where needed.
- Files: `extension/background.js`, `extension/manifest.json`, `extension/ytkit.js`

### 3. Download, transcript, and watch-page feature fixes
- Fixed thumbnail download quality probing through the extension bridge.
- Moved transcript download/sidebar/export/AI-summary caption fetches onto the bridged fetch path.
- Repaired age restriction bypass to use bridged fetches plus cancellable retry scheduling.
- Fixed `hideCollaborations` cleanup so delayed navigation work does not survive disable/teardown.
- Files: `extension/ytkit.js`, `extension/background.js`, `extension/manifest.json`

### 4. Comment-system and performance fixes
- Fixed handle revealer so concurrent comment-author lookups update all waiting anchors instead of only the first.
- Added in-flight request dedupe and abort-on-destroy behavior for comment handle resolution.
- Scoped handle revealer to watch/shorts pages instead of observing the whole site.
- Added caching + in-flight dedupe for channel video count so repeated same-channel watch navigation does not keep refetching `/about`.
- Files: `extension/ytkit.js`

### 5. Accessibility and interaction cleanup
- Added ARIA live-region semantics to toast notifications.
- Improved in-page modal/page-control accessibility:
  - `aria-expanded` sync on launcher
  - switch semantics on cards
  - reduced-motion handling
  - overscroll containment
- Rebuilt Digital Wellbeing overlay as a proper modal dialog with labels, focus placement, Escape close, and teardown-safe key handlers.
- Fixed `dearrowPeekButton` blur-listener leak.
- Files: `extension/ytkit.js`, `extension/options.html`

### 6. Feature catalog / retired-settings regression
- Fixed a high-impact catalog bug where live comment features were incorrectly listed as retired in multiple places.
- Before this repair, these live settings were being stripped from saved state and from generated defaults:
  - `chatStyleComments`
  - `hidePinnedComments`
  - `hideCommentDislikeButton`
  - `hideCommentActionMenu`
  - `condenseComments`
  - `hideCommentTeaser`
  - `autoExpandComments`
  - `commentEnhancements`
  - `commentSearch`
  - `commentNavigator`
- Cleared stale retired-setting lists in:
  - `extension/options.js`
  - `extension/ytkit.js`
  - `build-extension.js`
- Rebuilt `extension/default-settings.json` so it now matches the runtime defaults again.

### 7. Delayed injector / teardown cleanup
- Fixed several newer watch-page features that used delayed `setTimeout` injection without cancellation, which could cause UI to reappear after disable or during rapid SPA navigation.
- Added managed timer cleanup for:
  - `frameByFrameButtons`
  - `subtitleDownload`
  - `videoVisualFilters`
  - `watchPageTabs`
  - `redditComments`
  - `watchHistoryAnalytics`
  - `aiVideoSummary`
  - `copyChapterMarkdown`
  - `chapterJumpButtons`
- Also fixed style cleanup for feature-local CSS that previously remained after disable.
- Files: `extension/ytkit.js`

### 8. Older delayed injector cleanup + Claude doc drift
- Continued the timeout cleanup pass into older feature clusters that still used fire-and-forget reinjection after SPA navigation.
- Added cancellation/scheduled reinjection handling for:
  - `reversePlaylist`
  - `rssFeedLink`
  - `videoScreenshot`
  - `popOutPlayer`
  - `chapterNavButtons`
  - `videoLoopButton`
  - `transcriptViewer`
  - `commentSearch`
- This prevents those features from recreating buttons/panels after disable or during fast route changes.
- Also corrected stale agent-facing documentation in `CLAUDE.md` so it no longer claims:
  - Return YouTube Dislike is shipped in the extension build
  - `aiVideoSummary` uses direct content-script cross-origin `fetch()`
  - toolbar popup / settings profiles / digital wellbeing are still unimplemented
- Files: `extension/ytkit.js`, `CLAUDE.md`

### 9. More delayed UI lifecycle cleanup
- Continued the same teardown race cleanup into another group of watch/player UI features that already had cleanup logic but did not cancel delayed creation work.
- Added managed timer cleanup for:
  - `miniPlayerBar`
  - `playbackStatsOverlay`
  - `copyVideoTitle`
  - `channelAgeDisplay`
  - `speedIndicatorOverlay`
  - `pipButton`
- This closes another set of cases where controls/overlays could reappear after disable or during fast SPA navigation.
- Files: `extension/ytkit.js`

### 10. Delayed apply/process cleanup
- Continued the same teardown-race cleanup into non-UI delayed work so scheduled post-navigation processing does not outlive feature disable.
- Added managed timer cleanup for:
  - `showPlaylistDuration`
  - `antiTranslate`
  - `persistentSpeed`
  - `autoTheaterMode`
  - `rememberVolume`
  - `autoSubtitles`
  - `disableAutoplayNext`
- This reduces another class of “feature still acts once after disable” behavior on rapid SPA transitions.
- Files: `extension/ytkit.js`

### 11. Remaining delayed-work tail cleanup
- Cleared most of the remaining timeout-driven tail in `ytkit.js` by converting the last obvious post-navigation delayed work into managed timers.
- Added managed timer cleanup for:
  - `preciseViewCounts`
  - `hideWatchedVideos`
  - `abLoop`
  - `timestampBookmarks`
  - `disableInfiniteScroll`
  - `thumbnailQualityUpgrade`
  - `playlistEnhancer`
  - `likeViewRatio`
  - `downloadThumbnail`
  - `channelSubCount`
  - `customSpeedButtons`
- This significantly reduces stale UI/actions after disable or fast SPA route changes across the older watch-page feature set.
- Files: `extension/ytkit.js`

### 12. Older lifecycle follow-up + title restore repair
- Continued the teardown audit into older features that still used raw delayed navigation work or had disable-state cleanup gaps.
- Added managed timer cleanup for:
  - `titleNormalization`
  - `watchProgress`
  - `remainingTimeDisplay`
  - `fineSpeedControl`
  - `redirectHomeToSubs`
  - `sortCommentsNewest`
  - `autoExpandDescription`
  - `resumePlayback`
  - `watchLaterQuickAdd`
  - `autoClosePopups`
  - `videoResolutionBadge`
  - `preventAutoplay`
  - `autoOpenChapters`
  - `autoOpenTranscript`
- Fixed a real disable bug in `titleNormalization`: normalized nodes are now marked with `data-ytkit-normalized`, so the feature can actually restore original titles when turned off.
- Hardened `resumePlayback` against async init/teardown races by guarding `_positions` before saving.
- Files: `extension/ytkit.js`

### 13. Last obvious timeout stragglers in this area
- Cleaned the chip-filter delayed second pass in the hide-videos flow so it cannot fire after disable.
- Converted `cinemaAmbientGlow` delayed setup into managed scheduling so a pending setup cannot resurrect the glow after teardown/navigation.
- After this pass, the targeted raw post-navigation timeout tail in `ytkit.js` is effectively exhausted; remaining timers in this area are managed/debounced and cleaned up on destroy.
- Files: `extension/ytkit.js`

### 14. Claude handoff prompt
- Added a repo-local Claude handoff prompt at `CLAUDE-HANDOFF-PROMPT.md`.
- The prompt tells Claude to start with `CODEX-CHANGELOG.md`, respect the dirty worktree, avoid unrelated roadmap files, continue the wider audit, and keep the changelog current.
- Files: `CLAUDE-HANDOFF-PROMPT.md`, `CODEX-CHANGELOG.md`

### 15. Four real behavior bugs repaired
All bugs were in `extension/ytkit.js`.

#### 15a. Popup quick-toggle double init/destroy
- **Bug**: `YTKIT_SETTING_CHANGED` handler (popup quick toggles) called `feat.init()` / `feat.destroy()` directly without updating `feat._initialized`. The popup also writes to `chrome.storage`, which triggers `applyExternalSettingsUpdate` shortly after via the storage-change listener. Because `_initialized` was stale, `safeInitFeature` / `safeDestroyFeature` would run a second init/destroy on the same feature — duplicating interval registrations, DOM elements, or needlessly double-tearing-down state.
- **Fix**: Set `feat._initialized = true/false` immediately after the direct init/destroy call in the handler so the storage-change path skips re-doing the same operation.

#### 15b. `titleNormalization` Polymer recycling skips new text
- **Bug**: `_processTitle` used `el._ytkitNormalized` as a simple boolean guard and returned early on any already-processed element. YouTube's Polymer renderer recycles DOM elements (same JS object, new text content). The new text content would never be normalized because the guard fired before checking whether the text had changed.
- **Fix**: Store the normalized text as `el._ytkitNormalizedText`. On subsequent `_processTitle` calls, compare current `textContent` to that stored value. If they differ, the element has been recycled with new content — reset the normalization state and re-process. Also clear `el.title` and `_ytkitNormalizedText` in `destroy()`.

#### 15c. `resumePlayback` navigate rule saved position for the wrong video
- **Bug**: The navigate rule called `_savePosition()` at the start of the `yt-navigate-finish` handler. By the time `yt-navigate-finish` fires, `location.href` already reflects the new video. So `_getVideoId()` returned the new video's ID rather than the one being left. This would either: (a) delete a legitimate saved position for the incoming video (if near start/end guards triggered), or (b) save `currentTime≈0` for the new video before it loaded.
- **Fix**: Removed `_savePosition()` from the navigate rule. The 15-second save interval and the `destroy()` final save already ensure the last position is recorded.

#### 15d. `commentNavigator` + `preloadComments` unmanaged post-navigate timers
- **Bug**: `commentNavigator.init()` and its navigate rule both used bare `setTimeout(refresh, 2200)`. If `destroy()` ran within that 2200ms window (rapid toggle or fast navigation), `refresh()` would fire after teardown — potentially recreating the nav overlay with no CSS (since the style element had been removed). Similarly, `preloadComments` used a recursive chain of up to 30 bare `setTimeout` calls (up to 15s) that could not be cancelled on disable or rapid navigation, allowing multiple parallel retry chains to build up.
- **Fix** (`commentNavigator`): Added `_refreshTimer: null` field. Both the navigate rule and `init()` now go through a `scheduleRefresh()` helper that cancels any pending timer before scheduling a new one. `destroy()` cancels `_refreshTimer`.
- **Fix** (`preloadComments`): Added `_preloadTimer: null` field. The initial 1500ms delay and all 500ms retry steps now store their timer ID in `_preloadTimer`. Entering a new navigation or calling `destroy()` clears the pending timer, preventing stale retry chains. A guard in `tryPreload` also aborts any call that fires after the timer was cleared.

#### Verification
- `node --check extension/ytkit.js` ✓
- `node --check extension/popup.js` ✓
- `node --check extension/options.js` ✓
- `node --check extension/background.js` ✓
- `node build-extension.js` → all four v3.10.0 artifacts rebuilt cleanly ✓

### 16. Build, release, and contributor workflow hardening
- CI was previously bypassing the hardened local build path and just zipping `extension/` directly. That meant local releases and GitHub releases were not actually validated the same way.
- Fixed the release/build path so local and CI now share the same guarded workflow:
  - added `.nvmrc` with Node 22
  - added `package.json` scripts for `build`, `build:userscript`, `check`, and `test`
  - updated `.github/workflows/build.yml` to run `npm ci`, `npm test`, `npm run check`, and `npm run build:userscript`
  - CI/release uploads now come from the generated `build/` artifacts instead of a raw zip shortcut
- Hardened `build-extension.js` itself:
  - removed duplicated catalog parsing logic by extracting reusable helpers to `scripts/catalog-utils.js`
  - replaced `process.exit(1)` inside the build flow with thrown errors so `finally` cleanup still runs
  - stopped synthesizing the userscript from extension internals during build; the build now packages the tracked repo userscript directly
- Replaced the old `sync-userscript.js` generator with a safer metadata sync utility that only updates version/header fields in `ytkit.user.js`.
- Added focused tests in `tests/catalog-utils.test.js` so `default-settings.json` and `settings-meta.json` stay in sync with `extension/ytkit.js`.
- Files: `.github/workflows/build.yml`, `.nvmrc`, `package.json`, `build-extension.js`, `scripts/catalog-utils.js`, `sync-userscript.js`, `tests/catalog-utils.test.js`, `README.md`, `CONTRIBUTING.md`

### 17. Settings/import/export hardening and options UX cleanup
- Hardened settings import/export paths in both `extension/options.js` and `extension/ytkit.js`:
  - unsafe object keys like `__proto__`, `prototype`, and `constructor` are now rejected
  - imported hidden-video, blocked-channel, and bookmark payloads are sanitized, deduped, and size-limited
  - empty or oversized imports are rejected instead of partially applying questionable data
  - modern save/import flows now explicitly retire the old `ytkit_sidebar_order` legacy key
  - exports are sanitized before writing to disk
- Removed the brittle options-page fallback that used dynamic function evaluation to parse settings defaults from `ytkit.js`; version fallback is now regex-based and defensive.
- Improved options-page save UX:
  - invalid controls now get `aria-invalid`
  - failed saves focus the first invalid control instead of leaving the user to hunt for the problem
- Tightened popup-side settings normalization and replaced quick-toggle row `innerHTML` rendering with explicit DOM construction.
- Files: `extension/options.js`, `extension/popup.js`, `extension/ytkit.js`

### 18. Shared runtime/core request hardening
- Fixed cleanup gaps in `extension/core/navigation.js`:
  - `waitForElement()` now clears its timeout when it succeeds
  - `waitForPageContent()` now clears both its fallback timer and event listener once it fires
  - the shared navigate listener and flexy observer are now fully detached when the last navigate rule is removed
- Hardened extension fetch plumbing:
  - `extension/background.js` now detects object/array request bodies, serializes them to JSON, and adds `Content-Type: application/json` when needed
  - `extensionFetchJson()` in `extension/ytkit.js` now treats non-2xx responses as HTTP errors first, instead of masking them as JSON parse failures
- Files: `extension/core/navigation.js`, `extension/background.js`, `extension/ytkit.js`

### 19. Additional delayed teardown fixes in older features
- Found another small cluster of raw delayed navigation work in `extension/ytkit.js` that could still fire after disable or fast SPA navigation.
- Added managed timer cleanup for:
  - `theaterAutoScroll`
  - `autoDownloadOnVisit`
  - `sponsorBlock` reload scheduling
  - `deArrow` post-navigation reset processing
- This closes more of the stale post-teardown action class: auto-scroll, auto-download, bar/segment reloads, and DeArrow page processing can no longer re-run once the feature has been torn down.
- Files: `extension/ytkit.js`

### 20. Theater Split lifecycle hardening + core storage preload dedupe
- Continued the deep lifecycle audit inside the large `stickyVideo` / Theater Split feature.
- Fixed several real stale-action paths in `extension/ytkit.js`:
  - late live-chat watcher safety timeout is now tracked and cleared instead of potentially disconnecting a newer observer after rapid teardown/re-enable
  - deferred comment pre-scroll is now cancellable on unmount, so Theater Split cannot scroll the page after the feature has already been torn down
  - post-expand fallback work and delayed `checkAllButtons()` reinjection are now tracked and canceled on collapse/unmount
  - resize-observer debounce is now tracked on the feature instance, so a queued resize callback cannot mutate player sizing after teardown
  - `_unmount()` now clears the pending Theater Split timers/idle callbacks and resets `_entering` defensively
- Hardened shared storage startup in `extension/core/storage.js`:
  - the in-memory storage cache now uses a null-prototype object
  - `preloadExtensionState()` now dedupes concurrent startup calls through a shared promise instead of fanning out duplicate `chrome.storage.local.get(null)` reads
- Extended `package.json`'s `npm run check` to syntax-check all `extension/core/*.js` modules too, not just the top-level runtime files.
- Files: `extension/ytkit.js`, `extension/core/storage.js`, `package.json`

### 21. Background auth-header forwarding bug repaired
- Found a real service-worker regression in `extension/background.js`: the EXT_FETCH proxy was stripping `Authorization` from all forwarded request headers.
- That meant the AI summary bridge could not actually authenticate OpenAI-compatible/Ollama requests even though the UI, permissions, and provider wiring were present.
- Fixed it defensively:
  - `Authorization` is no longer blanket-blocked
  - it is forwarded only to an explicit allowlist of BYO-key/local service origins (`api.openai.com`, `api.anthropic.com`, local Ollama, local MediaDL)
  - YouTube/session-bound origins still do not receive forwarded `Authorization` headers from the content-script side
- Updated agent/public docs to reflect the narrower, correct security model instead of the older “Authorization is always stripped” note.
- Files: `extension/background.js`, `README.md`, `CLAUDE.md`

### 22. `waitForPageContent()` observer leak fixed in both runtimes
- Found another shared-helper issue: `waitForPageContent()` could fire from `yt-page-data-updated` first while its nested `waitForElement()` observer kept running until timeout because there was no cancellation handle.
- Fixed the helper at the root:
  - `waitForElement()` now returns a cleanup function in both `extension/core/navigation.js` and the tracked `ytkit.user.js`
  - `waitForPageContent()` now cancels its pending element observer when it fires from any path (page event, DOM match, or hard timeout)
  - the userscript fast-path was also corrected so a direct node match clears the pending timeout instead of only disconnecting the observer
- Extended `npm run check` again so the shipped `ytkit.user.js` file is syntax-checked alongside the extension/runtime files.
- Files: `extension/core/navigation.js`, `ytkit.user.js`, `package.json`

### 23. Shared video-id parsing hardened + userscript page parity restored
- Found another shared-helper gap in `extension/core/url.js`: `getVideoId()` only understood `?v=` URLs, so canonical YouTube routes like `/shorts/<id>`, `/live/<id>`, and `/embed/<id>` silently returned `null`.
- Hardened the helper:
  - added explicit 11-character video-id validation
  - added path-based extraction for shorts/live/embed routes
  - exported `extractVideoIdFromUrl()` so the behavior can be regression-tested directly
- Applied the same route parsing upgrade in the tracked `ytkit.user.js` and replaced a handful of remaining current-page `?v=` scrapes with `getVideoId()`:
  - transcript download
  - MediaDL/Innertube fallback
  - persistent button video-change tracking
  - auto-download-on-visit
  - statistics dashboard watch counting
- Also fixed a userscript-only page-classification drift bug: `/playlist` was still being classified as `library`, and `/feed/you` was not recognized as library at all.
- Added `tests/core-page-url.test.js` so the core helpers are now explicitly checked for:
  - `/feed/you` vs `/playlist` page classification
  - watch query video IDs
  - shorts/live/embed route video IDs
  - rejection of invalid route segments / malformed URLs
- Files: `extension/core/url.js`, `extension/ytkit.js`, `ytkit.user.js`, `tests/core-page-url.test.js`

### 24. Userscript settings import/storage path hardened
- Found a second userscript-specific weakness in `ytkit.user.js`: unlike the extension options page, the userscript import path still trusted arbitrary object keys and unbounded collections too much.
- Hardened the userscript settings path:
  - `StorageManager` now uses a null-prototype cache and safe own-property checks
  - added safe-key filtering for settings objects
  - added bounded sanitizers for imported hidden videos, blocked channels, and bookmarks
  - import payload size is now checked before applying
  - versioned imports now preserve the ability to clear collections intentionally while still rejecting malformed object/array shapes
  - exports now sanitize the same collections before serializing them back out
- Also made `SettingsManager.load()` / `save()` sanitize stored settings so stray unknown/prototype-poisoning keys do not keep circulating in the userscript state layer.
- Files: `ytkit.user.js`

### 25. Premium UX polish for popup + settings workspace
- Did a deeper product-quality pass on the two main extension-owned surfaces that users actually touch directly: the popup and the options/settings workspace.
- Popup refinements (`extension/popup.html`, `extension/popup.css`, `extension/popup.js`):
  - rebuilt the popup into a branded quick-controls surface with stronger hierarchy, summary pills, tab-context messaging, richer search affordances, loading skeletons, and a proper empty state
  - added contextual CTA labeling so the primary action now explains whether it will open the inline settings workspace, fall back to the full options page, or open YouTube first
  - added inline success/error feedback via a dedicated status banner so toggling settings feels acknowledged instead of silent
- Options/settings workspace refinements (`extension/options.html`, `extension/options.js`):
  - upgraded the settings modal shell with a problem chip, search clear affordance, richer workspace banner, and an actionable empty state
  - wired the new UI states properly in JS: filter recovery, clear-search behavior, dynamic workspace banner messaging, invalid-count surfacing, and stronger summary copy
  - added busy states for the main page actions (`Open Settings`, `Export`, `Import`, `Reset`) plus modal save, so long-running actions now communicate progress instead of freezing abruptly
  - improved per-setting polish with clearer key/group/type badges, better modified vs invalid card states, more helpful hint copy, focusable cards for recovery, and scroll-to-invalid guidance when save is blocked
- preserved editor scroll position during draft-wide rerenders like save/discard/reset-to-default, reducing the “jump back to top” feel during review
- hardened modal open failure handling so a bad storage/defaults read now reports a clean status message instead of risking a noisy async failure
- This batch was aimed at making Astra Deck feel more cohesive and premium rather than just “styled”: clearer statefulness, calmer messaging, and better recovery paths when the user is searching, editing, or fixing settings.
- Files: `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `extension/options.html`, `extension/options.js`

### 26. Premium polish for the injected in-page settings panel
- Extended the premium pass into the big inline settings workspace inside `extension/ytkit.js`, which was still functionally solid but visually flatter and harder to search than the popup/options surfaces.
- Header + sidebar refinements:
  - added real brand hierarchy in the panel header with eyebrow text, live-apply intro copy, and compact version / shortcut badges
  - activated the previously dormant sidebar card pattern to surface enabled-feature counts, total features, section counts, current page context, and shortcut guidance
  - restored category summary copy in the nav so the left rail now explains what each section controls instead of just listing names
- Search/discoverability refinements:
  - upgraded the panel search input to a proper search field with a clear button, helper copy, and a live search-results banner with better empty-state recovery
  - fixed a real discoverability bug by restoring `.ytkit-feature-desc` content in feature cards, so search now matches feature descriptions instead of effectively searching titles only
  - kept category context visible while searching, hid zero-match sections cleanly, and surfaced parent cards when a sub-feature matches so results do not lose their meaning
  - preserved search mode correctly during live toggles by re-running the search state instead of dropping nav counts back to enabled totals mid-session
- Content/pane refinements:
  - enriched each pane header with category summaries and descriptions so sections feel curated instead of raw
  - tightened the premium compact-mode CSS so it no longer hides the richer hierarchy elements that now power the improved experience
- This batch was aimed at making the on-page control center feel like the same premium product as the popup and modal settings editor, not a separate older UI.
- Files: `extension/ytkit.js`

### 27. Premium page-controls modal + cleanup hardening
- Continued the product polish pass into the lightweight page-controls modal inside `extension/ytkit.js`, which was still behaving more like a generic utility sheet than a page-aware quick-control surface.
- UX/UI refinements:
  - upgraded the modal header with a proper eyebrow, page-specific title, live-apply guidance, and stat chips for enabled controls / shortcut count
  - made the page-control launcher button labels page-aware (`Home`, `Watch`, `Subscriptions`, `Channel`) instead of the generic “Open page controls”
  - added per-card state badges (`On` / `Off`), better descriptions, and more specific full-settings CTA/footer copy
  - added a graceful empty state so config drift or future missing features no longer produce a blank modal shell
- Accessibility / semantics:
  - switched the dialog from a generic `aria-label` to explicit `aria-labelledby` / `aria-describedby` wiring
  - improved card and close-button labels so assistive tech gets the current state and page context more clearly
- Reliability fix bundled with the polish:
  - repaired a real close-teardown bug where the modal and overlay removal timers referenced `_pageModalEl` / `_pageModalOverlay` after those refs had already been nulled, which could leave hidden stale nodes behind in the DOM
  - also stopped stacking stale `yt-navigate-start` listeners across repeated open/close cycles by tracking and cleaning up the page-modal navigation listener explicitly
- This batch was aimed at making the quick page controls feel premium and trustworthy while also removing a subtle DOM-leak / teardown bug in the same surface.
- Files: `extension/ytkit.js`

### 28. Premium quick-links launcher polish + keyboard/touch hardening
- Continued the premium UX pass on the quick-links launcher/menu in `extension/ytkit.js`, which still had a mix of hover-only behavior, weak empty/edit states, and a couple of state-sync rough edges.
- UX/UI refinements:
  - added an explicit chevron toggle button next to the launcher so opening the menu is now discoverable and comfortable on touch devices instead of depending on hover alone
  - upgraded the quick-links empty state and add-link form with clearer copy, less cramped input sizing, validation guidance, and better disabled-button behavior
  - polished both the topbar and watch-player launcher chrome so the new toggle, hover states, and spacing feel intentional and consistent in both surfaces
  - added stronger `:focus-visible` states across the launcher, toggle, quick-link items, destructive controls, and add action so keyboard use feels deliberate instead of incidental
- Accessibility / semantics:
  - the toggle now keeps `aria-expanded`, `aria-label`, and `title` in sync with the real open/closed state
  - action items that behave like buttons (`Edit`, `Settings`) now remain button semantics end-to-end, while external quick links open safely in a new tab with `rel="noopener noreferrer"`
  - the edit toggle now resets `aria-pressed` correctly when the menu is dismissed, instead of leaving assistive-tech state out of sync with the visible UI
- Reliability fix bundled with the polish:
  - centralized menu open/close behavior so rebuilds no longer stack repeated hover/focus/outside-click wiring on the same wrapper
  - fixed launcher routing/label drift by rebuilding menus when `logoToSubscriptions` changes, not just when the quick-link list itself changes
- This batch was aimed at making the quick-links launcher feel like a premium, keyboard-safe navigation tool rather than a fragile hover utility.
- Files: `extension/ytkit.js`

### 29. Premium transcript + local downloader workflow refinement
- Continued the premium UX pass into the transcript sidebar and local downloader utility flow in `extension/ytkit.js`, where the product still felt more like a raw helper tool than a polished, confidence-building workflow.
- UX/UI refinements:
  - upgraded the transcript panel with a richer header, live status/meta row, clearer export labels, and structured loading / empty / error states instead of bare text dumps
  - upgraded the local downloader install prompt with stronger hierarchy, step-by-step guidance, clearer primary-vs-fallback actions, and calmer “recommended path” copy so first-run setup feels intentional instead of improvised
  - upgraded the download progress card with explicit state copy (`Preparing`, `Downloading`, `Finishing`, `Needs Attention`), cleaner stat pills, and an inline repair CTA when recovery is likely needed
- Accessibility / semantics:
  - transcript jump rows are now real buttons with keyboard/focus support and explicit labels instead of clickable `div`s
  - the transcript/export surfaces and downloader progress now expose clearer live-status messaging rather than making assistive tech infer meaning from visual changes alone
  - added reduced-motion-safe transcript loading skeleton behavior and better touch affordances on utility controls
- Reliability / quality fixes bundled with the polish:
  - transcript export filenames now use the shared `getVideoId()` helper instead of only looking for `?v=`, which keeps filenames sane on newer route shapes too
  - download progress stats no longer sit blank or carry stale values as the poller moves between prepare / active / failure states
  - removed a subtle setup-prompt state bug where `aria-busy` could drift out of sync after button state changes
- This batch was aimed at making captions and local downloads feel like first-class, premium product workflows instead of backup utility panels.
- Files: `extension/ytkit.js`

### 30. Shared toast polish + Video Hider action recovery
- Continued the premium UX pass on the shared feedback layer in `extension/ytkit.js`, which multiple features rely on but which still felt flatter and less trustworthy than the newer polished surfaces.
- UX/UI refinements:
  - rebuilt the global toast shell with stronger spacing, hierarchy, tone-aware badges, calmer dark-surface layering, and a dedicated dismiss control so notifications feel intentional instead of bolted on
  - added hover/focus pause behavior, better action-button treatment, and reduced-motion-safe transitions so actionable toasts feel calmer and easier to use in longer workflows
  - gave the shared toast system explicit neutral/info/warning/error/success presentation instead of relying on a single generic visual treatment
- Accessibility / semantics:
  - shared toasts now support Escape dismissal alongside the close button, making the interaction model more predictable for keyboard users
  - the new action layout keeps focus-visible treatment and live-region semantics consistent across success/error and utility-style notifications
- Reliability / quality fixes bundled with the polish:
  - fixed a real Video Hider bug where only the first toast action was being forwarded, so secondary actions like `Manage` silently disappeared even when the UI suggested they existed
  - Video Hider now passes both `Undo` and `Manage` through the shared `actions` API for single-video hides, channel blocks, and bulk hide operations
  - removed the dead `ytkit-hide-toast` DOM/CSS path, its stale cleanup calls, and the now-unused `_toastTimeout` state so the feature no longer carries a half-migrated legacy toast implementation
- This batch was aimed at making shared feedback feel premium and consistent while also restoring a genuinely broken recovery/manage path in one of the more interactive content tools.
- Files: `extension/ytkit.js`

### 31. Premium Video Hider workspace overhaul
- Continued the premium UX pass inside the custom Video Hider pane in `extension/ytkit.js`, which still felt like a developer utility view instead of a polished management workspace.
- UX/UI refinements:
  - upgraded the pane header with a real eyebrow/description, live status chips, and hidden/block counts so the feature explains itself before the user starts clicking around
  - rebuilt the tab row into a proper control strip with badges and clearer labels (`Hidden Videos`, `Blocked Channels`, `Keyword Rules`, `Filters & Limits`) instead of generic one-word tabs
  - replaced the old raw list rows with richer cards, calmer empty states, stronger section leads, better link affordances, and clearer restore/unblock copy
  - refined the keyword and settings tabs into proper settings sections with labels, helper text, pill-style examples, cleaner number inputs, and a more intentional stats area
- Accessibility / semantics:
  - the custom tab strip now behaves like actual tabs with `tablist`/`tab`/`tabpanel` semantics plus arrow-key, Home, and End keyboard navigation
  - custom switches now have explicit labels, the textarea/number fields are properly named and described, placeholders use an ellipsis, and thumbnail previews include dimensions/lazy loading
  - added responsive tuning for narrower panel widths so the workspace remains readable when the settings UI gets tight
- Reliability / quality fixes bundled with the polish:
  - restoring a single hidden video or unblocking one channel now re-renders the tab body so the hero copy and counts never drift stale after item-level actions
  - the subscription load limiter controls now clamp inputs defensively and disable the threshold field when the limiter is off, instead of leaving inactive controls looking live
  - disabling the load limiter from the pane now also clears any active blocker state immediately, which is a better match for user expectations
- This batch was aimed at turning Video Hider into a premium control center rather than a raw storage inspector, while also fixing a couple of subtle count/state mismatches inside that workflow.
- Files: `extension/ytkit.js`

### 32. Premium timestamp bookmarks workflow refinement
- Continued the premium UX pass in the watch-page bookmarks panel in `extension/ytkit.js`, which was still useful but visually and behaviorally closer to an older utility widget than the newer polished surfaces.
- UX/UI refinements:
  - upgraded the bookmarks header with an eyebrow, clearer title, live status copy, and a saved-count pill so the panel immediately explains its purpose and current state
  - rebuilt the empty state into a calmer guidance block instead of a single flat line of text
  - turned each bookmark into a richer card with a dedicated jump action, clearer metadata, a more intentional note editor shell, and better spacing/hierarchy throughout
  - renamed the primary CTA to `Save Current Time`, which reads more like a deliberate action than a generic utility button
- Accessibility / semantics:
  - bookmark rows now expose a real jump button instead of relying on a clickable container, and destructive controls have explicit labels
  - note fields now have names, note-specific labels, bounded input length, `autocomplete="off"`, and an ellipsis placeholder
  - the panel announces updates through its live region and keeps timestamp pills/code-like values marked as non-translatable where appropriate
- Reliability / quality fixes bundled with the polish:
  - deleting a bookmark now offers an undo toast instead of being an immediate irreversible action
  - note edits now respect the same character limit as imported bookmark data, so live editing and import sanitization no longer drift
  - header count/status state now re-syncs on add, delete, undo, note edits, and SPA navigation instead of leaving stale helper copy behind
- This batch was aimed at making bookmarks feel like a premium “save this moment” workflow while also fixing destructive-action confidence and a small data-consistency gap.
- Files: `extension/ytkit.js`

### 33. Premium Digital Wellbeing modal + local-day hardening
- Continued the premium UX pass on the Digital Wellbeing interruption flow in `extension/ytkit.js`, where trust and calmness matter more than almost any other surface.
- UX/UI refinements:
  - rebuilt the wellbeing overlay into a calmer modal with richer hierarchy, supporting eyebrow/badge context, stronger typography, clearer supportive copy, and kind-specific styling for breaks versus daily-cap notices
  - refined the CTA copy to read more intentionally (`Resume Video`, `Dismiss Until Tomorrow`) and made the card feel more like a premium pause screen than a raw alert box
  - added mobile-safe spacing and responsive treatment so the modal still feels composed on tighter viewports
- Accessibility / semantics:
  - the modal now uses clearer contextual labeling inside the card and keeps keyboard interaction predictable with focus placement, Escape dismissal, and backdrop dismissal
  - added reduced-motion-safe behavior without leaving the experience feeling abrupt
- Reliability / quality fixes bundled with the polish:
  - fixed a real trust bug: the “until tomorrow” dismissal path is now keyed to the user’s local day instead of UTC, so daily-cap behavior matches user expectations
  - daily-cap dismissal now actually suppresses that notice until the next local day instead of reappearing almost immediately
  - break reminders can still continue after a daily-cap notice is dismissed, rather than being accidentally suppressed by that dismissal path
- This batch was aimed at making Digital Wellbeing feel calm, premium, and credible while also repairing the mismatch between what the daily-cap UI promised and what it actually did.
- Files: `extension/ytkit.js`

### 34. Premium comment discovery workspace + live filter sync
- Continued the premium UX pass on the watch-page comment discovery flow in `extension/ytkit.js`, where `Comment Search` and `Comment Navigator` still worked but felt like separate utility widgets rather than one coherent workflow.
- UX/UI refinements:
  - rebuilt `Comment Search` into a richer discovery card with a real eyebrow, live summary copy, clearer search placeholder, stronger count pill, a dedicated clear control, and a calmer no-results state with recovery guidance
  - added better in-flow helper copy so the feature explains what it searches and reassures users that the filter stays active as more comments load
  - upgraded `Comment Navigator` with a more premium floating shell, stronger hierarchy, a filtered-search badge, clearer status language, and larger/friendlier next/previous controls so it visually matches the newer polished watch-page tools
- Accessibility / semantics:
  - the search clear control is now a real labeled button with focus-visible treatment instead of relying only on Escape
  - the upgraded search summary/count state continues to announce changes via live regions, and the no-results card now exposes a proper recovery action
  - active comment navigation now gets `scroll-margin-top`, which makes keyboard/button-driven jumping feel less abrupt near the top of the viewport
- Reliability / quality fixes bundled with the polish:
  - fixed a real bug where active comment search only filtered the threads that existed when the user typed; new comments loaded later could ignore the current search until the user typed again
  - search text caching now resets when comment content changes, so expanded comments and newly loaded threads are re-evaluated correctly instead of using stale cached text
  - navigator counts/status now stay aligned with filtered comment state, including pending/no-match cases
- This batch was aimed at making comment discovery feel premium and cohesive while also repairing a trust issue in long sessions where active filtering could silently drift out of date.
- Files: `extension/ytkit.js`

### 35. Comment enhancements polish + missing reply-toggle recovery
- Continued the premium UX pass on the comment-enhancement layer in `extension/ytkit.js`, which still felt visually older than the refreshed comment tools and, more importantly, was advertising reply-collapse behavior it did not actually implement.
- UX/UI refinements:
  - upgraded creator/OP highlighting into a calmer premium treatment with richer surface tinting and a cleaner emphasis style instead of a harsher legacy accent stripe
  - refined like-heat indicators into more intentional pill badges with stronger hierarchy, better spacing, and tabular-number styling so high-engagement replies scan more cleanly
  - added a dedicated reply-tools row with a polished `Collapse Replies` / `Expand Replies` control so long reply chains are easier to manage without relying only on YouTube’s default thread controls
- Accessibility / semantics:
  - the new reply-toggle control is a real button with `aria-expanded`, explicit labels, visible focus treatment, and touch-friendly sizing
  - creator/OP badges and heat pills now mark count-like values as non-translatable so browser auto-translation is less likely to garble short metadata tokens
- Reliability / quality fixes bundled with the polish:
  - fixed a real product bug: `Comment Enhancements` now actually includes the promised per-thread reply collapse toggle instead of only shipping creator highlights and like heat
  - the feature now processes existing comments immediately on init, which makes mid-session enablement more reliable instead of waiting for a future mutation to happen first
  - like-count parsing is more defensive for localized `K` / `M` style values, so heat badges are less likely to disappear on compact-number variants that use commas or non-breaking spaces
- This batch was aimed at making comment enhancements feel like part of the newer premium comments workflow while also closing a clear functionality gap between the feature description and the shipped behavior.
- Files: `extension/ytkit.js`

### 36. Subscription load-blocker state polish + recovery chip
- Continued the premium UX pass on the subscriptions load-limiter surface in `extension/ytkit.js`, where the blocker banner still felt more like a raw warning than a polished stateful workflow.
- UX/UI refinements:
  - rebuilt the blocker into a richer “feed paused” surface with a real eyebrow/title hierarchy, clearer explanatory copy, and compact stats for hidden, scanned, and streak counts
  - replaced the old abrupt action row with clearer decisions: `Resume Loading`, `Review Filters`, and `Keep Paused`
  - added a minimized recovery chip so the blocked state can stay out of the way without becoming invisible
- Accessibility / semantics:
  - both the full banner and the minimized chip now expose polite status updates and keep keyboard-focusable recovery controls visible
  - the recovery controls now use clearer button labels instead of an ambiguous icon-only dismiss affordance
  - count-heavy status tokens are rendered with tabular numerics and marked non-translatable where appropriate
- Reliability / quality fixes bundled with the polish:
  - fixed a real UX bug: dismissing the old banner could hide the only recovery controls while subscription loading remained blocked, effectively trapping the user in a paused state with no visible way back
  - blocker teardown now removes both the full banner and the minimized chip, so navigation/disable flows cannot leave stale subscription-blocker chrome behind
  - resume behavior is now routed through one shared recovery path instead of splitting that logic across ad hoc click handlers
- This batch was aimed at making the subscriptions load limiter feel calmer and more premium while also ensuring the paused state always remains recoverable.
- Files: `extension/ytkit.js`

### 37. Watch Later quick action polish + broader route support
- Continued the premium UX pass on the thumbnail-level `Watch Later Quick Button` in `extension/ytkit.js`, which was still carrying older utility patterns like inline styling, emoji-only states, and hover-only visibility.
- UX/UI refinements:
  - replaced the old emoji/inline-style overlay with a proper icon button that uses the shared thumbnail-action styling and clearer state-specific visuals for idle, saving, saved, and error cases
  - made the control discoverable beyond desktop hover by supporting `focus-within` visibility and coarse-pointer devices, so touch and keyboard users are not left with a hidden action
  - added calmer state feedback instead of abruptly swapping raw text/emoji inside the button
- Accessibility / semantics:
  - the quick action is now a real `type="button"` control with explicit `aria-label` updates as state changes, instead of relying on a hover-only affordance plus a static title
  - focus-visible and touch-friendly behavior now match the newer premium action surfaces more closely
- Reliability / quality fixes bundled with the polish:
  - fixed a real route-assumption bug by switching the quick-add button to shared `getVideoId()` parsing instead of only accepting `?v=` watch URLs, so newer `/shorts/` and `/live/` card links can participate too when present
  - removed the older split between inline styles and stylesheet behavior, which was making the control brittle and harder to evolve consistently
  - failure states now surface actionable warning feedback when the native save menu or Watch Later entry cannot be reached, instead of silently doing nothing
- This batch was aimed at making the Watch Later quick action feel like a polished first-class control while also removing a brittle URL assumption from one of the higher-traffic feed overlays.
- Files: `extension/ytkit.js`

### 38. Watch metadata chip system polish + date/count hardening
- Continued the premium watch-page refinement in `extension/ytkit.js` by upgrading the small metadata utilities that still felt like old one-off badges instead of part of the newer product language.
- `Video Age Display`:
  - replaced the old rough “days ÷ 30 / days ÷ 365” age math with calendar-aware relative formatting, so labels now read more naturally as `Today`, `Yesterday`, `Tomorrow`, `3 months ago`, or `2 years ago`
  - hardened date sourcing to prefer YouTube’s own player response and metadata tags before falling back to parsed DOM text, which makes premieres, live uploads, and delayed metadata hydration more reliable
  - added mutation-driven refreshes so the badge keeps up with SPA watch-page changes instead of depending on a single delayed render
  - visually tuned the age badge so future/current states read as intentional status chips instead of a generic gray pill
- `Like-to-View Ratio`:
  - replaced the old inline-styled text badge with a structured premium chip that matches the rest of the watch metadata system and exposes a clearer `Like Rate` label/value pairing
  - added more defensive compact-number parsing plus better accessible titles/labels, so the ratio is less brittle when YouTube exposes counts through different button text or `aria-label` shapes
  - added mutation-safe refreshes so late-loading metadata and SPA navigation do not leave the ratio stale
- `Enhanced Channel Info`:
  - removed the last inline-style subscriber badge path and converted it to the same calmer chip styling used by the rest of the watch metadata
  - added accessible labeling plus mutation-driven refreshes so the badge stays accurate as watch metadata hydrates
- This batch was aimed at making the watch metadata strip feel like one cohesive premium surface while also fixing older brittle assumptions around dates, compact counts, and delayed YouTube metadata hydration.
- Files: `extension/ytkit.js`, `CODEX-CHANGELOG.md`

### 39. Watch utility action polish + clipboard/download hardening
- Continued the premium watch-page action pass in `extension/ytkit.js` by upgrading the smaller utility controls that still felt more like ad hoc add-ons than part of the extension’s newer action language.
- `Copy Video Title Button`:
  - rebuilt the old icon-only title button into a compact expanding pill that reveals clearer state labels like `Copy`, `Copying…`, `Copied`, and `Retry` on hover, focus, and active states
  - added a real clipboard fallback path using `document.execCommand('copy')` when `navigator.clipboard.writeText()` is unavailable or blocked, so the feature no longer fails silently in stricter clipboard contexts
  - added actionable warning/error feedback for missing title text or blocked clipboard access instead of doing nothing
  - fixed the transient state timer so it is cleared on teardown/navigation instead of potentially firing after the feature is disabled
- `Download Thumbnail Button`:
  - hardened video-id handling by switching to shared `getVideoId()` parsing instead of manually reading only `?v=` from the URL
  - upgraded filenames to use a sanitized video-title-based name rather than only `${videoId}_thumbnail.jpg`, which makes downloads easier to recognize in the file system
  - added mutation-driven retries so the button still appears when YouTube’s watch action row hydrates late, instead of sometimes missing the surface until the next navigation
  - added button state styling for `Checking…`, `Downloading…`, `Downloaded`, and `Retry` so watch actions feel more trustworthy and consistent with the newer premium surfaces
- Regression coverage:
  - added focused checks in `tests/bugfix-validation.test.js` for the title-copy fallback/timer behavior and the thumbnail-action `getVideoId()` + mutation-retry path
- This batch was aimed at making the watch utility actions feel calmer and more dependable while removing two older classes of failure: silent clipboard denial and missed watch-action injection on late page hydration.
- Files: `extension/ytkit.js`, `tests/bugfix-validation.test.js`, `CODEX-CHANGELOG.md`

### 40. Thumbnail resolution badge overhaul + missing SD recovery
- Continued the premium content-surface pass in `extension/ytkit.js` by upgrading `Resolution Badge on Thumbnails`, which was still using older inline-style badge injection and only partially delivering the quality states the feature promised.
- UX/UI refinements:
  - replaced the old raw square badge with a calmer pill-style quality chip that matches the extension’s newer thumbnail overlays more closely
  - introduced clearer visual tiers for `8K`, `4K`, `QHD`, `HD`, and `SD`, so higher-quality thumbnails feel more intentionally differentiated instead of sharing one generic treatment
  - added accessible titles/labels and `translate="no"` handling so the badge reads more cleanly for assistive tech and auto-translation scenarios
- Reliability / quality fixes bundled with the polish:
  - restored the missing `SD` path the feature description already claimed to support, instead of silently showing only `4K` and `HD`
  - replaced the direct `thumb.style.position = 'relative'` mutation with a dedicated host class, which makes the badge compose more safely with the other thumbnail overlays and cleans up on destroy
  - changed badge updates from one-shot injection to refreshable stateful rendering, so late metadata hydration can upgrade or remove the badge instead of leaving stale badge output behind once a thumbnail has been processed
  - broadened quality detection by reading multiple metadata/title/overlay sources instead of relying on a narrower pair of badge checks
- Regression coverage:
  - added a focused check in `tests/bugfix-validation.test.js` to ensure the feature keeps its `SD` tier and avoids direct inline thumbnail position mutation
- This batch was aimed at making the resolution badge feel like a polished first-class thumbnail signal while also fixing the incomplete `SD` implementation and the brittle direct-style mutation underneath it.
- Files: `extension/ytkit.js`, `tests/bugfix-validation.test.js`, `CODEX-CHANGELOG.md`

### 41. Playlist tools overhaul + duplicate-handling recovery
- Continued the premium watch-page control pass in `extension/ytkit.js` by rebuilding `Playlist Enhancer`, which still felt like an older utility strip and had drifted away from its own promised behavior.
- UX/UI refinements:
  - turned the old two-button strip into a more intentional `Playlist Tools` toolbar with a status chip, cleaner grouping, and clearer state styling for copy and duplicate actions
  - upgraded the action language so the controls now read as `Shuffle`, `Copy URLs`, and `Hide Duplicates` / `Show Duplicates` instead of a bare utility pair with no context
  - added visible busy/success/error states for the copy flow instead of silently changing text or failing with no feedback
- Reliability / quality fixes bundled with the polish:
  - restored duplicate-handling behavior the feature description had been implying but not actually shipping by adding a real hide/show duplicates control for playlist panels
  - added clipboard fallback support for playlist URL copying so the control still works in stricter clipboard contexts instead of failing silently
  - added mutation-driven resync so the toolbar and duplicate state keep up with late playlist-panel hydration during SPA navigation
  - preserved the currently playing row when duplicates are hidden, so the active playlist item does not disappear from the panel just because it is a repeated video
- Regression coverage:
  - added a focused check in `tests/bugfix-validation.test.js` for the duplicate-toggle contract, copy fallback, and mutation-driven playlist resync
- This batch was aimed at making the playlist toolbar feel like a premium first-class control strip while also fixing the missing duplicate-handling behavior and the old silent copy failure path.
- Files: `extension/ytkit.js`, `tests/bugfix-validation.test.js`, `CODEX-CHANGELOG.md`

### 42. Speed preset bar refresh + video rebind hardening
- Continued the premium player-controls pass in `extension/ytkit.js` by upgrading `Speed Preset Buttons`, which still looked like a flat utility tag row and could drift stale when YouTube swapped the active video element.
- UX/UI refinements:
  - rebuilt the preset bar into a clearer `Speed Presets` control strip with a live current-speed chip, stronger grouping, and better spacing/hierarchy
  - added more intentional active-state semantics so the selected preset now reads as a pressed control rather than only a passive color change
  - improved touch polish and smaller-viewport layout so the preset strip feels closer to the extension’s newer watch-page tool surfaces
- Reliability / quality fixes bundled with the polish:
  - added explicit video rebinding logic so the feature can detach from an old `<video>` and reattach to the current one when YouTube swaps the player node during SPA updates
  - added mutation-driven resync so the bar can recover when the watch-page body hydrates late instead of only trusting the first render
  - kept the live speed chip in sync with playback-rate changes so the bar communicates the current state even when speed changes happen outside the preset buttons
- Regression coverage:
  - added a focused check in `tests/bugfix-validation.test.js` to ensure the feature keeps its rebinding/resync path and exposes active preset state via `aria-pressed`
- This batch was aimed at making the speed preset strip feel like a premium first-class playback control while also fixing the stale-state failure mode caused by YouTube swapping the underlying video element.

### 43. Screenshot control refresh + capture-state hardening
- Continued the premium player-controls pass in `extension/ytkit.js` by rebuilding `Video Screenshot`, which still felt like an older icon-only utility and was silently swallowing several important success/failure paths.
- UX/UI refinements:
  - turned the old bare camera glyph into a compact `Shot` pill with explicit `Saving…`, `Saved`, and `Retry` states so the control feels like a first-class action instead of a silent one-off button
  - added calmer success/error visual states and a live `aria-live` label update so the control communicates progress more clearly for both sighted users and assistive tech
  - improved filename quality with safer title sanitization plus timestamped PNG names that are easier to recognize once downloaded
- Reliability / quality fixes bundled with the polish:
  - replaced the silent best-effort clipboard call with explicit clipboard outcome handling, so users now get honest feedback when the image was copied, when clipboard image copy is unsupported, or when browser policy blocks it
  - hardened capture against missing video frames, missing canvas contexts, and protected/cross-origin frame errors with clearer recovery copy instead of generic failure toasts
  - added mutation-driven reinjection so the screenshot control can recover when YouTube swaps or hydrates the player controls late during watch-page navigation
- Regression coverage:
  - added a focused check in `tests/bugfix-validation.test.js` to keep the new capture-state flow, clipboard handling path, and mutation-based reinjection contract in place
- This batch was aimed at making screenshot capture feel dependable and premium during real use, not just technically available when the happy path happens to work.
- Files: `extension/ytkit.js`, `tests/bugfix-validation.test.js`, `CODEX-CHANGELOG.md`

## Files changed by Codex in this audit sequence
- `.github/workflows/build.yml`
- `.nvmrc`
- `CONTRIBUTING.md`
- `README.md`
- `CHANGELOG.md`
- `CLAUDE.md`
- `CLAUDE-HANDOFF-PROMPT.md`
- `CODEX-CHANGELOG.md`
- `build-extension.js`
- `package.json`
- `scripts/catalog-utils.js`
- `sync-userscript.js`
- `tests/core-page-url.test.js`
- `tests/catalog-utils.test.js`
- `ytkit.user.js`
- `extension/background.js`
- `extension/core/navigation.js`
- `extension/core/storage.js`
- `extension/core/url.js`
- `extension/default-settings.json`
- `extension/manifest.json`
- `extension/options.html`
- `extension/options.js`
- `extension/popup.css`
- `extension/popup.html`
- `extension/popup.js`
- `extension/ytkit.js`

## Verification run by Codex
- `npm test`
- `npm run check`
- `node --check extension\\popup.js`
- `node --check extension\\options.js`
- `node --check extension\\background.js`
- `node --check extension\\ytkit.js`
- `node --check build-extension.js`
- `node build-extension.js`
- `node build-extension.js --with-userscript`
- `node --check ytkit.user.js`

Latest successful build output:
- `build/astra-deck-chrome-v3.10.1.zip`
- `build/astra-deck-chrome-v3.10.1.crx`
- `build/astra-deck-firefox-v3.10.1.zip`
- `build/astra-deck-firefox-v3.10.1.xpi`
- `build/ytkit-v3.10.1.user.js`

## Known doc drift / caveats
- `CLAUDE.md` was refreshed during this audit and should be treated as current for the major extension-architecture changes called out above.
- `CODEX-CHANGELOG.md` is still the most complete agent-facing record of the repair sequence; public-facing docs may lag some of the smaller lifecycle/teardown hardening batches.
- Userscript packaging now assumes the tracked `ytkit.user.js` file is the source of truth; `sync-userscript.js` only keeps its metadata/version header aligned with `extension/ytkit.js`.

## Residual risk / suggested next QA
- Live manual browser QA is still the main gap.
- Highest-value paths to click through (updated after batches 16-22):
  - ~~popup quick toggles on watch pages~~ — double init/destroy race now fixed (batch 15a)
  - ~~title normalization enable/disable restore behavior~~ — Polymer recycling now handled (batch 15b)
  - ~~resume playback across fast watch-page navigation~~ — wrong-video save now fixed (batch 15c)
  - ~~comment navigator teardown after rapid navigation~~ — timer now managed (batch 15d)
  - ~~sponsor block post-navigation reload after disable~~ — timer now managed (batch 19)
  - ~~DeArrow post-navigation reset after disable~~ — timer now managed (batch 19)
  - ~~theater auto-scroll and auto-download delayed actions after disable~~ — timers now managed (batch 19)
  - Theater Split rapid mount/collapse/fullscreen and late live-chat insertion — still worth a manual pass after batch 20
  - quick-links launcher/menu on both masthead and watch-player surfaces after batch 28, especially keyboard open/close, empty state, add-link validation, and `logoToSubscriptions` refresh behavior
  - transcript sidebar after batch 29, especially loading/empty/error states, long-caption videos, export actions, and keyboard jumping through transcript lines
  - local downloader setup / retry flow after batch 29, especially first-run guidance, button busy states, and the in-card repair CTA on connection failures
  - shared toasts after batch 30, especially Video Hider `Undo` + `Manage` multi-action behavior, hover/focus pause, and dismiss behavior during longer workflows
  - Video Hider pane after batch 31, especially tab keyboard navigation, per-item restore/unblock counts, keyword-rule editing, and limiter enable/disable behavior on narrow panel widths
  - timestamp bookmarks after batch 32, especially add/save, jump-to-time, note editing, undo delete, and narrow secondary-column layouts on long videos
  - Digital Wellbeing after batch 33, especially local-day daily-cap dismissal, break reminder resume flow, Escape/backdrop dismissal, and smaller viewport behavior
  - comment discovery after batch 34, especially live filtering as new threads load, no-results recovery, search clear behavior, and navigator counts on filtered watch pages
  - comment enhancements after batch 35, especially creator/OP badge behavior, localized like-count parsing, and custom collapse/expand reply controls alongside YouTube’s native reply toggles
  - subscription load limiter after batch 36, especially the new “Keep Paused” chip, resume/review flows, and repeated block/unblock cycles during long subscriptions sessions
  - Watch Later quick add after batch 37, especially touch-device visibility, saved/error state resets, and localized YouTube menus where the native “Watch Later” text may differ
  - watch metadata chips after batch 38, especially scheduled/premiere videos, localized like/subscriber text, and late-hydrating watch metadata on long SPA sessions
  - watch utility actions after batch 39, especially blocked clipboard permissions, the expanding title-copy pill on narrow layouts, title-copy fallback behavior in stricter browser contexts, and thumbnail-button injection when the watch action row hydrates late
  - thumbnail resolution badges after batch 40, especially QHD/SD detection on localized metadata strings, late-hydrating feed cards, and coexistence with the other thumbnail overlays on dense Home/Subscriptions grids
  - playlist tools after batch 41, especially duplicate hiding on active playlist items, URL copy fallback behavior in stricter clipboard contexts, and toolbar resync during playlist-panel hydration or playlist changes
  - speed preset bar after batch 42, especially current-speed sync after autoplay or SPA video swaps, active preset state after non-button speed changes, and narrower watch-page layouts
  - screenshot control after batch 43, especially saved/error state reset timing, clipboard-image copy behavior across stricter browsers, protected/cross-origin frame failures, and reinjection after late player-controls hydration
  - AI summary with OpenAI/Anthropic/Ollama credentials after batch 21
  - long SPA sessions/navigation churn that repeatedly hit `waitForPageContent()` after batch 22
  - userscript transcript/download/watch-count flows on shorts/live canonical URLs after batch 23
  - userscript import/export of large or intentionally malformed settings payloads after batch 24
  - transcript export and AI summary
  - rapid SPA navigation while enabling/disabling watch-page features
  - Digital Wellbeing modal lifecycle (overlay focus, Escape, daily-cap re-trigger)
  - auto-open transcript / chapters and auto-expand description when toggled on mid-session
- The biggest remaining risk is now broader live behavior coverage. Build/test hardening is much stronger, but there is still no browser-level automated integration suite.

## Unrelated local changes left alone
- `roadmap.md`
- `ROADMAP-COMPLETED.md`
