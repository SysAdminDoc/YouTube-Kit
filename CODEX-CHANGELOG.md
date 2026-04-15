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
- `build/astra-deck-chrome-v3.10.0.zip`
- `build/astra-deck-chrome-v3.10.0.crx`
- `build/astra-deck-firefox-v3.10.0.zip`
- `build/astra-deck-firefox-v3.10.0.xpi`
- `build/ytkit-v3.10.0.user.js`

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
  - comment search / comment enhancements — still worth manual verification
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
