# Changelog

All notable changes to Astra Deck are documented here. Versions are listed newest-first.

---

## [Unreleased] - Hardening Pass 8

Audit-only follow-up to Pass 7. Closes the two remaining roadmap
audit-pass items that had concrete, bounded fixes: the LOW security
finding on `_pendingReveals` lifetime, and the SponsorBlock POI
category correctness note.

### Fixed

- **`_pendingReveals` pruned on `chrome.downloads.onErased`.** The
  Pass 7 session mirror guaranteed reveals survived a service-worker
  restart, but a download that was cancelled + erased (or wiped by
  crash recovery) before reaching `state.complete` / `state.interrupted`
  left its id in the `Set` and the session mirror forever. The new
  `onErased` listener awaits the same hydration promise as `onChanged`,
  removes the id, and persists the delete. `Set.delete` is idempotent,
  so a normal complete → erase sequence is a safe no-op on the second
  fire. Listener is guarded behind `chrome.downloads?.onErased?.addListener`
  for older Firefox builds. Regression in `tests/hardening.test.js`.
- **SponsorBlock `poi_highlight` is a marker, never an auto-skip target.**
  Per the SponsorBlock API, `poi_highlight` is a jump-to reference, not
  a segment to scrub past. The previous code path treated it identically
  to `sponsor` / `selfpromo` / `interaction` — `video.currentTime = end`.
  Both `sponsorBlock._checkSkip` and `_scheduleNextSkip` now short-circuit
  the category explicitly; the progress-bar renderer continues to paint
  the marker. The category is still off by default (`sbCat_poi_highlight: false`),
  and zero-length POI entries are still dropped on ingest, but enabling
  the toggle from the settings UI no longer fast-forwards through the
  highlight. Regression in `tests/hardening.test.js`.

---

## [3.20.0] - Hardening Pass 7

Audit-only release. Closes three of the open items from the 2026-04-23
audit pass, lifts the `chrome.storage.local` ceiling for long-term
users, and stops Firefox users from triple-binding the built-in
"Show Downloads" shortcut.

### Fixed

- **`_pendingReveals` survives service-worker restarts.** The "show in
  folder" reveal for `chrome.downloads.download({ showInFolder: true })`
  used an in-memory `Set` only. If the MV3 service worker was terminated
  between the download being queued and the `state.complete` transition,
  the reveal was silently dropped. The Set now mirrors into
  `chrome.storage.session`, the onChanged listener awaits a one-time
  hydration promise on SW cold-start, and the DOWNLOAD_FILE handler
  persists every add. Regression test in `tests/hardening.test.js`.
- **`astra_downloader._run_download` dead code removed.** The
  `re.search(r'\[download\] Downloading video …', line)` match was
  assigned to `m` and never read — leftover from an earlier title-
  detection draft. Deleting it keeps the hot log-parsing loop focused
  on filename detection + progress.
- **Theater Split userscript honours the new comment DOM.** YouTube's
  Polymer renderer now wraps comment text in `yt-core-attributed-string`;
  split-theater CSS and the `isSplitCommentTextTarget` selector chain
  didn't match it, so text selection silently broke on the current
  rollout. CSS rulesets for `pointer-events`, `user-select`, and
  `cursor` now cover the new class, and a capture-phase `selectstart`
  listener stops the autoscroll handler from swallowing the selection.
  Shipped as `theater-split.user.js` v1.0.6.

### Added

- **`unlimitedStorage` permission.** Watch history, DeArrow cache, and
  `storageQuotaLRU` can collectively push `chrome.storage.local` past
  the 10 MB default for long-term users. Declaring `unlimitedStorage`
  removes the ceiling without changing any other permission surface.
  LRU continues to trim hot caches on its 5-minute cadence.

### Changed

- **Firefox rebinds `toggle-control-center` to `Ctrl+Alt+Y`.** Firefox
  reserves `Ctrl+Shift+Y` for "Show Downloads", which previously shadowed
  the Astra Deck toggle shortcut. The Chrome manifest keeps the original
  binding (no vendor conflict there); the Firefox manifest-patch step in
  `build-extension.js` rewrites only the Firefox staged copy. Users can
  still remap via `about:addons` → Manage Extension Shortcuts.

### Tests

- 84/84 JS tests pass (+4 new Pass 7 regressions:
  `_pendingReveals` session mirror, `unlimitedStorage` permission,
  Firefox shortcut patch, dead-regex removal).
- 37 Python tests + 10 subtests still pass.

---

## [3.19.0] - Toolbar popup absorbs the options page

The standalone settings page (`chrome-extension://…/options.html`) is gone.
All of its functionality — export/import backup, reset-all-data, storage
statistics, and version chip — now lives inside the toolbar popup, styled
in the flame-accented workspace language the options page introduced. The
popup grew slightly (360×560 → 420×600) to fit the hero, stat grid, data
actions, and quick-toggle list in one surface.

### Removed
- `extension/options.html`, `extension/options.js`, and the
  `options_ui` block in `manifest.json`. Users reach full settings via the
  in-page YouTube workspace (same flow as before). The Settings Editor
  modal that rendered every 150+ setting in a separate tab is retired; the
  in-page control centre on YouTube tabs remains the authoritative editor.
- The popup's secondary "Settings Editor" ghost button (it opened the
  removed options page).

### Added
- **Hero workspace card** at the top of the popup — flame-accented
  header, brand name + version chip, "Settings workspace" eyebrow, and
  the primary "Open Full Settings" CTA inside the card.
- **Storage overview** — five live-updating stat cards (Keys, Storage,
  Hidden, Blocked, Bookmarks) that refresh on every `chrome.storage`
  change.
- **Data actions row** — Export, Import, Reset. Export uses
  `chrome.downloads.download` when available so the JSON lands in the
  user's downloads folder even after the popup closes. Reset now shows
  an in-popup confirmation dialog matching the options page's tone.
- **Quick toggles section** given its own framed panel with an eyebrow
  header + live count so data controls and quick toggles read as two
  related but distinct surfaces.

### Changed
- Popup theme tokens synced to the options page: same page background,
  workspace card gradient, stat card treatment, flame accent, focus ring.
- `background.js#togglePanelForTab` opens a new YouTube tab when the
  panel-toggle message can't be delivered, instead of calling the
  now-removed `chrome.runtime.openOptionsPage()`.
- Popup context model simplified — the `showSecondary` flag and the
  secondary footer button are gone.

### Tests
- 80/80 passing. `tests/hardening.test.js` rewritten around the new
  popup: removed options-source invariants, added a regression test that
  fails if `options_ui`, `options.html`, or `options.js` ever come back;
  relocated the export/import-parity check to run against `popup.js`.

---

## [3.18.0] - Premium-aware Auto Quality (no popup flash)

Auto Quality rewritten end-to-end. The previous implementation opened
YouTube's player settings menu via DOM clicks, walked the Quality
submenu, and clicked the highest item — hiding the popup with CSS for a
brief window. When the click sequence finished but YouTube didn't auto-
close (or timing slipped), the menu became visible to the user.

The new implementation calls `movie_player.setPlaybackQualityRange()`
directly from the MAIN-world bridge — the same API used by Auto-HD-FPS,
Iridium, Enhancer for YouTube, and the popular YouTube HD Premium
userscript. There is no gear-menu interaction at any point, so there is
nothing to flash.

### Changed
- **Always Best Quality** (renamed from Auto Quality) — single toggle.
  No dropdown. Picks the highest non-`auto` entry from
  `getAvailableQualityData()` and prefers any entry whose `qualityLabel`
  contains "Premium" (so 1080p Premium / Enhanced Bitrate is selected
  automatically when the account/video offers it). Falls back to legacy
  `getAvailableQualityLevels()` when the newer API is missing.
- The ISOLATED content script now only flips `<html data-ytkit-quality="on">`.
  All quality logic lives in `ytkit-main.js`, which listens for
  `loadstart` / `loadedmetadata` / `canplay` on the video element plus
  `yt-navigate-finish` and `yt-page-data-updated`. Re-application is
  deduplicated per `videoId:quality:label`.
- Userscript build (`YTKit.user.js`) injects an inline `<script>` with the
  same Premium-aware forcer so it works under any userscript manager
  regardless of injection mode.

### Removed
- `preferredQuality` setting (the dropdown — now always best).
- `useEnhancedBitrate` sub-feature (Premium is detected automatically).
- `hideQualityPopup` sub-feature (no popup is ever opened).
- `_setQualityViaDOM`, `_temporarilyHideQualityPopup`, `_closeSettingsMenu`,
  `_releasePopupHider`, the retry-timer schedule, and the watchdog interval.
  All kept as RETIRED keys via `RETIRED_SETTING_KEYS` so existing user
  storage is sanitized on next load. Migration v6 drops them from
  exported settings snapshots.

### Settings schema
- `SETTINGS_VERSION` 5 → 6 with no-op-style migration that strips the
  three retired keys.

### Tests
- 84/84 pass. The v3.14.0 hardening regression that asserted the gear-
  click `selectorChain` adoption was rewritten to assert the new
  invariant: ISOLATED sets `data-ytkit-quality`, MAIN calls
  `setPlaybackQualityRange` + `getAvailableQualityData` with Premium
  detection, and the gear-menu DOM-click path stays deleted.

---

## [3.17.0] - Alchemy-inspired additions (Wave 10)

Eleven new features imported after a feature review of the YouTube Alchemy
userscript. Every toggle is **OFF by default** so existing setups are
unchanged — users opt in from Settings. Grouped under a new "Wave 10"
block at the end of the features array for easy isolation.

### Added — CSS-only toggles (fast, zero-cost)
- `hideAirplayButton` — remove Airplay icon from player controls.
- `hideQueueOnThumbnails` — remove "Add to queue" hover button on grid items.
- `fullTitles` — unclamp the 2-line truncation on thumbnail titles.
- `titleCaseTransform` + `titleCaseMode` (select: `none` / `uppercase` /
  `lowercase` / `capitalize`) — override YouTube's SHOUTY UPPERCASE titles.
- `customSelectionColor` + `selectionColor` (color picker) — override the
  default `::selection` background.

### Added — Behaviour toggles
- `bypassPlaylistMode` — capture-phase click handler strips `&list=` /
  `&index=` / `&pp=` from thumbnail anchors so videos don't trap you inside
  someone's playlist.
- `musicVideoSpeedLock` — when Persistent Playback Speed is on, detects
  music-category videos and forces 1× so songs aren't sped up.

### Added — DOM features
- `playlistQuickRemove` — trash-icon overlay on each item in playlists you
  own; click-chains the native "Remove from playlist" menu item. Appears
  only on owned playlists (detected via the presence of the edit action).
- `watchLaterCleanup` — injects a "Remove Watched" button into the Watch
  Later playlist header (only on `?list=WL`). Removes items with ≥90%
  progress via the native menu path, sequentially with a 350 ms gap to
  let YouTube's Polymer mutations process.

### Added — Complex features
- `transcriptAiHandoff` + `transcriptAiTarget` (select: `notebooklm` /
  `chatgpt` / `claude` / `gemini` / `perplexity`) — adds a sparkle button
  to the player right-controls. Click fetches the transcript via the
  existing `TranscriptService`, builds a summary prompt, copies to
  clipboard, and opens the chosen AI tool. ChatGPT uses its native `?q=`
  URL for a pre-filled prompt (truncated to 6 KB); others open their
  landing page and the user pastes. No API key required.
- `audioTrackLanguage` + `preferredAudioLang` (24-locale select) — on
  every nav, drives the player's Settings → Audio Track menu to select
  the requested language. Silently no-ops when the video has no alternate
  audio track (single-track videos, Shorts, music).

### Settings plumbing
- `SETTINGS_VERSION` bumped 4 → 5. Migration v5 is a no-op marker — new
  defaults seed via the existing merge-during-load path (additive, so the
  marker exists only to advance `_settingsVersion` cleanly for future
  migrations).
- All 15 new keys regenerated into `default-settings.json` via the
  existing `build-extension.js` brace-balanced parser. No code changes
  to the settings-UI renderer needed — the `type: 'select' | 'color'` +
  `settingKey` pattern is already wired.

### Notes
- Parse-clean (new Function() validates). All 81 existing JS tests pass.
- Build artifacts regenerated: Chrome ZIP + CRX, Firefox ZIP + XPI all at
  375 KB.
- Competitor-review source: Alchemy's audio-track picker, header quick
  links (already covered by Astra Deck's `quickLinkMenu`), tab view
  (covered by `watchPageTabs`), and the colored transcript buttons
  (subsumed into the single `transcriptAiHandoff` selector-driven design).

---

## Astra Downloader [1.2.0] - Hardening Pass 6 (companion service)

Deep audit of the Python/Flask `astra_downloader` companion. Clears every
named Pass 6 follow-up from HARDENING.md plus a batch of new findings.
Extension wire-compatible (`/health` gains three additive keys, older
builds ignore unknown keys).

### Added
- **Path confinement on `/download`** (S1). Client-supplied `outputDir` is
  now bounded to `DownloadPath` + `AudioDownloadPath` + optional
  `ExtraOutputRoots`. Resolved before `mkdir`, so a rejected request no
  longer leaves a directory behind.
- **`/download` rate limit** (S2). Token-bucket sliding window (30 / 60 s
  default). Rejection happens before body parsing; CPU stays flat under
  abuse. 429 responses include `Retry-After`.
- **SHA-256 verification for yt-dlp + ffmpeg** (S3). First-run downloads
  verify against the upstream release sidecar. Hard-fail on mismatch
  (file unlinked so retry re-downloads). Soft-fail on missing sidecar
  (logged, install continues).
- **Settings → Tools section.** Shows live `yt-dlp` / `ffmpeg` versions,
  "Check yt-dlp Update" button (runs `-U`, refreshes version cache), and
  "Reinstall ffmpeg" (unlink + re-run the verified download path).
- **ffmpeg download byte-level progress** (U1). Setup bar now advances in
  the [35, 55] range as the zip streams, throttled to ~10 Hz.
- **JSON progress template for yt-dlp output** (U3). `MDLP_JSON` lines
  parsed in addition to legacy MDLP regex — insulates against upstream
  format drift.
- **`/health` additions.** `ytDlpVersion`, `ffmpegVersion`, `rateLimit`
  policy object. Extension consumers can render versions in the repair
  prompt.
- **`Access-Control-Max-Age: 600`** (R2) — preflight cache horizon cuts
  CORS round-trips during multi-video sessions.
- **Config fields:** `LastYtDlpUpdateCheck`, `LastFfmpegCheck`,
  `ExtraOutputRoots`.

### Changed
- **Waitress replaces werkzeug** as the WSGI server (R1). `_ServerAdapter`
  shim presents uniform `run()` / `stop()`; werkzeug remains as a last-
  resort fallback when waitress isn't installed. Server-start log reports
  the active backend.
- **yt-dlp auto-update throttled to once per 24 h** (R3). Previously fired
  on every launch with no result logging. New `maybe_auto_update_ytdlp()`
  runs in a daemon thread, captures exit code + output, invalidates the
  version cache on success.
- **`ensure_system_integrations()` is idempotent** (R5). Writes a version
  stamp to `HKCU\Software\Classes\AstraDownloader\IntegrationsVersion`
  after successful registration; subsequent launches at the same version
  skip the shortcut / schtasks / winreg / protocol passes.
- **`_bootstrap` installs waitress** alongside PyQt6 / flask / requests.

### Security
- Orphan session cookie jars (`.cookies.*.txt`) from crashed downloads
  are swept on `DownloadManager` init (R4). 5-minute horizon preserves
  in-flight jars.
- Rate limiter decouples CPU cost from client request rate.
- SHA-256 verification closes the integrity gap on first-run binaries.

### Fixed
- Setup worker now logs crash context (`log_crash`) on exception instead
  of dropping the traceback.
- Icon download failure logged instead of silently swallowed.

### Tests
- 37 Python tests pass (was 19). New suites: `PathConfinementTests`,
  `RateLimiterTests`, `Sha256VerifyTests`, `CookieJarSweepTests`,
  `ApiRateLimitTests`, `CorsHeaderTests`, `HealthAdditionsTests`,
  `AutoUpdateThrottleTests`.
- 81 JS tests unchanged (no extension behavior touched).

See [HARDENING.md](HARDENING.md) v1.2.0 section for the full audit.

---

## [3.16.1] - Remove Workspace summary card from settings sidebar

Settings panel reclaimed ~180 px of vertical space by removing the "Workspace / Home controls" summary card (kicker + title + copy + 3 stat counters + "Live apply" footnote). The section was decorative — the stats (enabled count, total features, populated sections) added no actionable information that wasn't visible elsewhere in the panel.

### Removed
- `<section class="ytkit-sidebar-card">` DOM construction in `ytkit.js` (~56 lines).
- The 4 computed variables that fed it (`totalTopLevelFeatures`, `enabledTopLevelFeatures`, `populatedCategoryCount`, `currentPageLabel`) — each was read only by the card, so removing the card made the computations dead weight.

### Notes
- CSS rules for `.ytkit-sidebar-card*` classes remain in the stylesheet, unused. They're one-line declarations each; left in place in case a future stat strip wants to reuse the styling. Can be pruned in a future cleanup pass.
- No behavioral change to any feature — only the summary card was touched.

---

## [3.16.0] - Baked-in UI preferences (no more Stylebot + uBlock needed)

Rolls the maintainer's previously-external Stylebot CSS overrides and uBlock element-hiding rules into `extension/early.css`. Clean installs now reproduce the intended compact-settings, no-avatars, no-shelf look without two extra extensions.

### Changed — settings panel chrome
- `.ytkit-brand-intro`, `.ytkit-brand-badges`, `.ytkit-search-container`, `.ytkit-pane-header`, `.ytkit-nav-count`, `.ytkit-shortcut`, `.ytkit-version` are hidden in the in-page settings panel.
- `.ytkit-nav-btn` margins/padding zeroed and `.ytkit-nav-list` given a `-10px` vertical margin so more feature toggles fit in view.
- `.ytkit-global-toast` suppressed; inline status banners and `diagnosticLog` still surface feedback.
- `.ytkit-subs-load-banner` hidden on the subscriptions feed.
- Watch-page owner row (`ytd-video-owner-renderer`) gets a `margin-top: 10px` to keep the collapsed header from crowding the title.

### Changed — YouTube page chrome
- Skeleton / continuation placeholders removed: `ytd-ghost-grid-renderer`, `ytd-continuation-item-renderer` inside `ytd-rich-grid-renderer`.
- Rich-section shelves removed: the outer `ytd-rich-section-renderer` wrapper and its inner `div.style-scope.ytd-rich-section-renderer`.
- Avatars collapsed site-wide: `img.style-scope.yt-img-shadow` is hidden, plus the watch-page owner-row wrapper `yt-img-shadow.ytd-video-owner-renderer.no-transition`.

### Notes
- All rules are injected at `document_start` via `early.css`, so they apply before YouTube's first paint.
- Rules use `!important` to defeat YouTube's and the extension's own inline styles without needing specificity tuning.
- The upstream Stylebot line `a.yt-simple-endpoint.style-scope.yt-formatted-string { margin-bottom: -px; }` was dropped because `-px` is not a valid CSS length. Drop-in a concrete value (e.g. `-4px`) to restore that tweak.
- Opt-out path: if any of these ever need to become user-toggleable, re-scope the selectors under a `body.ytkit-cleanUi` class the same way `body.ytkit-hideEndCards` etc. gate the existing rules in `early.css`.

---

## [3.15.0] - Hardening Pass 5 — Repo-wide deep audit

End-to-end audit covering the Python downloader, build system, CI pipeline, and ancillary scripts. Ships coordinated fixes across three surfaces the v3.14.0 pass didn't touch.

### Security (Astra Downloader / Flask API)
- **DNS-rebinding defense** (`astra_downloader.py`) — added a `before_request` Host-header check that rejects any request whose Host isn't `127.0.0.1`, `localhost`, or `[::1]` (with or without a port). A malicious webpage that rebinds `attacker.com` to the downloader's port now receives `421 Misdirected Request` before any route handler runs. Protects the token-discovery path on `/health` and every authenticated endpoint.
- **`/health` token-disclosure trust boundary documented** — the Host check is the primary defense; the extension-origin + no-Origin paths are preserved for legitimate local tooling (curl, the GUI's own health probe). Comment at the handler explains the defense-in-depth layering so a future refactor doesn't remove the wrong piece.
- **IPv6 literal host support** — the Host parser handles `[::1]:9751` correctly so IPv6 clients aren't erroneously rejected.

### Reliability (Astra Downloader)
- **`_bootstrap()` surfaces install failures** — previously every pip install strategy silently fell through to an `ImportError` on the subsequent imports, hiding the real cause (missing pip, blocked PyPI, proxy). The helper now captures the last failure and writes a pointed `[Astra Downloader] Failed to auto-install dependencies (...)` message to stderr with the exact manual command to run.
- **`FileNotFoundError` short-circuits retries** — if `python -m pip` can't locate pip at all, we stop iterating through strategies since retrying won't help.

### Rebrand / Link Hygiene
- **12 hardcoded `SysAdminDoc/YouTube-Kit` URLs migrated to `Astra-Deck`** across `build-extension.js`, `sync-userscript.js`, `YTKit.user.js` (update/download URLs, GitHub link, installer URL, nyan cat asset, installer .bat emission), `theater-split.user.js` (namespace + update/download), `CONTRIBUTING.md`, `package-lock.json`. Userscript auto-updaters (Tampermonkey, Violentmonkey) cached the old URL and were relying on GitHub's redirect; the direct URL is now canonical.
- **CONTRIBUTING.md project tree** updated to say `Astra-Deck/` not `YouTube-Kit/`.

### CI / Release Pipeline (`.github/workflows/build.yml`)
- **Tag-vs-version check expanded** — was only comparing `manifest.json`. Now also verifies `ytkit.js` `YTKIT_VERSION`, `YTKit.user.js` `@version`, and `package.json`. Any drift across the four version strings fails the release build before artifacts are uploaded.
- **Artifact name renamed** from `YouTube-Kit-build-artifacts` to `astra-deck-build-artifacts`.

### Tests
- **2 new Python tests** — `test_dns_rebinding_attack_is_rejected_before_handler` covers the Host validation with 3 attack hosts and 3 legitimate hosts (IPv4, localhost, IPv6); `test_bootstrap_surfaces_failure_to_stderr` asserts the helpful stderr message is emitted when all pip strategies fail. Total: 15 Python tests pass.
- **10 new JS hardening regression tests** in `tests/hardening.test.js` — capture v3.14.0 invariants so future refactors can't silently regress the fixes: ReDoS guard (alternation coverage), `applyImportedSettingsVersion` preserving exporter version, `importSettings` routing through the migration-aware helper, `selectorChain` helper shape + `all:true` + first-miss logging, adoption at macro-markers (2 sites) and player settings button, `getSetting` null-safety, `chrome.downloads.onChanged` reveal path, zero empty `catch (_) {}` blocks across extension source, `diagnosticLog.destroy()` clearing `_errors`. Total: 47 JS tests pass (was 37).
- **`tests/repo-paths.test.js` updated** to assert the new `Astra-Deck` URL pattern.

### Documentation
- **`HARDENING.md`** — extended with Pass 5 section.
- **README badge** bumped to 3.15.0.
- **CHANGELOG**, **CLAUDE.md**, memory file — synced.

---

## [3.14.0] - Hardening Pass 4

Deep audit pass — correctness, MV3 lifecycle, platform-drift resilience. No new features; see `HARDENING.md` for findings, including false-positive list retained so future audits don't re-raise the same noise.

### Fixed
- **ReDoS guard in video-title filter** (`ytkit.js:videoHider`) — broadened to reject alternation-wrapped quantifier stacks like `(a|b+)+` and `(foo|bar*)+`. The previous guard only caught `(a+)+`-style patterns, leaving a path for malicious paste into `hideVideosKeywordFilter` to stall grid rendering.
- **Profile import preserves `_settingsVersion`** (`options.js:applyImportedSettingsVersion`) — imports no longer stamp the current schema version over whatever the exporter wrote. Imports from an older schema now run through the runtime's migration chain from the exported version forward, instead of silently bypassing it.
- **`chrome.downloads.show` reveal** (`background.js`) — switched from `setTimeout(900)` to `chrome.downloads.onChanged` listening for `state.complete`. The service worker can be terminated inside the 900 ms window on slow networks; the event-driven path fires exactly when the file exists and keeps the SW alive while downloads are in flight.
- **`diagnosticLog` off drops `_errors` immediately** (`ytkit.js`) — disabling the feature now calls `DiagnosticLog.clear()` in `destroy()` instead of waiting up to 5 minutes for the next `storageQuotaLRU` sweep.
- **Feature re-init failures surface to `diagnosticLog`** (`ytkit.js`) — settings-panel textarea re-init now routes `destroy()`/`init()` catches through `DebugManager.log()` instead of swallowing silently.

### Added — Infrastructure
- **`getSetting(key, default)`** (`ytkit.js`) — null-safe reader over `appState.settings`. Single choke point for settings access; replaces the scattered `appState.settings.X || default` pattern. Lays groundwork for gradual adoption across hot paths.
- **`selectorChain(selectors, { label, all, root, onMiss })`** (`ytkit.js`) — fallback-chain selector with first-miss diagnostics. Each miss is logged once per session per label, surfacing YouTube DOM drift to `diagnosticLog` instead of silent feature no-ops. Supports `all: true` for NodeList results.
- **`selectorChain` adopted at 3 high-churn regions** — macro-markers (chapter extract and chapter-jump features, with `ytd-macro-markers-list-renderer` + `[data-testid="chapter-item"]` fallbacks), player settings button (quality-forcing path, with `aria-label` and tooltip-target fallbacks).
- **Audit doc `HARDENING.md`** — checked-in audit covering real issues fixed in this release, false positives (already-mitigated claims documented so future audits skip them), YouTube platform drift watchlist, MV3 lifecycle notes, and recommended invariants.

### Changed
- **Empty `catch (_) {}` blocks** across `ytkit.js`, `background.js`, `popup.js` now either carry a `// reason:` comment explaining why silence is safe, or route through `DebugManager.log()` / `DiagnosticLog`. Pattern documentation for future audits; no behavioral change in the success path.
- **`_pendingReveals` set in `background.js`** — tracks downloads awaiting "show in folder" so the reveal survives service-worker restarts.

---

## [3.13.0] - Download Options Popup, Format/Quality/Directory Controls

### Added
- **Download options popup** — clicking the player download button now opens a popup with Video/Audio mode tabs, format chips (MP4/MKV/WebM for video; MP3/M4A/Opus/FLAC/WAV for audio), quality selector, and a custom save directory field.
- **Context menu expanded** — right-click player now shows "Download Video (MP4)", "Download Audio (MP3)", and "Download Options..." entries.
- **New settings** — `downloadVideoFormat` (default: mp4), `downloadAudioFormat` (default: mp3) with corresponding feature entries in the Downloads settings group.
- **Format passthrough** — download requests now send `format`, `quality`, and `outputDir` to the MediaDL server.
- **Server `/config` endpoint** — GET returns current download path and available formats/qualities; PUT updates the download directory.
- **Server format support** — video downloads now respect `format` parameter for merge output (mp4/mkv/webm). Audio downloads support mp3/m4a/opus/flac/wav with proper ffmpeg codec selection.
- **Server quality unlocked** — removed hardcoded 1080p cap; quality parameter (`best`/`2160`/`1440`/`1080`/`720`/`480`) now fully controls yt-dlp format selection.
- **Custom output directory** — per-download directory override with path validation and auto-creation.

### Fixed
- **Installer URLs** — MediaDLManager now points to `MediaDL` repo instead of deprecated `YouTube-Kit` installer.
- **GitHub link** — settings panel footer link updated to Astra-Deck repo.
- **Nyan cat GIF URL** — updated from YouTube-Kit to Astra-Deck.

---

## [3.12.0] - Options Page Redesign, Security Hardening, Rebrand Cleanup

### Changed — Options Page Redesign
- **Layout narrowed** from 1180px to 820px max-width for focused readability.
- **CSS variables simplified** — renamed `--panel-bg`/`--panel-border` to `--surface`/`--border`, added `--surface-raised`, `--accent-mid`, `--accent-border`.
- **Radii tightened** — `--radius-sm/md/lg` now 10/14/18px (was 16/22px).
- **Shadow simplified** to single `--shadow` token (was `--shadow-lg`/`--shadow-hover`).
- **Background gradient** simplified from 3-layer to single radial ellipse.
- **Toggle cards** use compact single-row layout (title left, toggle right) — no more "Enabled/Disabled" text labels.
- **Card structure refactored** — `.is-toggle` and `.is-complex` CSS classes for differentiated styling. Footer hidden until dirty/invalid for simple items.
- **Badges trimmed** — removed per-card key badge and type badge (type badge retained only for complex items). Group tag shown inline.
- **Description removed** from toggle and text/number cards — shown only for complex (list/json/textarea) items.
- **Hover lift effects removed** from stat cards (false affordance on read-only content).
- **HTML reduced** from ~1500 lines to ~1100 lines.

### Security
- **Quick Links URI scheme guard** — blocks `javascript:`, `data:`, and `vbscript:` URIs in user-configured quick link URLs.

### Housekeeping
- **Legacy branding removed** — deleted all old YTYT root-level images (banner.png, icon.png/ico/svg, favicon.ico, menu.png, icons/, images/).
- **Userscript URLs updated** — `@namespace`, `@updateURL`, `@downloadURL` now point to `Astra-Deck` repo (was `YouTube-Kit`).
- **manifest.json `homepage_url`** updated to Astra-Deck repo URL.
- **package.json** renamed to `astra-deck`, added `version` field, updated repository URL.
- **Build script** excludes `.claude-octopus` directories from staging.

---

## [3.11.1] - Deep Audit, Bugfixes, and Premium Polish

### Fixed

- **DiagnosticLog null safety.** `record()`, `get()`, and `clear()` now use optional chaining on `appState?.settings` to prevent crashes before settings initialization. `record()` catch block logs warnings instead of silently swallowing. `clear()` guards against missing `settingsManager`.
- **DeArrow fetch deduplication.** In-flight fetch dedup map (`_pending`) now declared in the feature object instead of lazy-initialized inside `_fetchBranding()`, preventing race conditions on first concurrent access.
- **CPU Tamer init ordering.** Native timer snapshot moved after WebGL prerequisite checks pass. Added `_patched` flag so `destroy()` only restores timers if they were actually patched, preventing stale restoration on early bail.
- **Video rotation validation.** `videoRotationAngle` now clamped to `[0, 90, 180, 270]` via allowlist, preventing arbitrary CSS from corrupted settings values.
- **Subtitle download guard.** Added `_downloading` flag to prevent parallel downloads from rapid double-clicks on the SRT button.
- **CI workflow.** Moved tag-vs-manifest version check before the build step to fail fast. Removed `2>/dev/null` on `gh release create` to surface real errors.

### Changed — Premium UI Polish

- **Popup header compressed** from 180px lockup to 70px compact header. Reclaims ~110px for toggle list.
- **Toggle on-state redesigned** with warm-gradient background and accent-tinted name text for instant visual scannability.
- **Toggle density tightened** — 4px gap (was 8px), 10px padding (was 12px), 1-line descriptions (was 2). Fits 2-3 more toggles in viewport.
- **Switch resized** from 42x24 to 38x22 for better proportion.
- **Footer buttons shortened** — "Open Settings On This Tab" → "Open Full Settings", "Open Options Page" → "Options".
- **Contextual notes simplified** from 30+ words to 5-8 words.
- **Options page copy tightened** across hero, action cards, stat subtexts, and notes panel.
- **CSS custom properties** added for radius tokens (`--radius-sm/md/lg`).
- **Padding grid standardized** to 8/10/12/16px increments.
- **Transitions snapped** from 220ms to 140-160ms for faster feel.
- **package.json** — added name, description, author, license, and repository fields.

---

## [3.11.0] - Hardening, Accessibility, and Cross-Surface Polish

### Fixed

- **Reddit Comments link hardening.** `d.permalink` from the Reddit JSON API is now validated through the `URL` constructor against a `reddit.com` allowlist before being used as `href`, and the row is promoted to `rel="noopener noreferrer"` to match every other external link.
- **Subtitle Download dead code removed.** Deleted an unused `_decode(s)` helper that set `textarea.innerHTML = s` — dead path that also tripped strict Trusted Types on YouTube pages.
- **Removed three `element.innerHTML = ''` resets** on freshly created `document.createElement` nodes (Reddit Comments, Watch-Time Analytics, AI Summary) — dead code and additional TT sinks.
- **Blocked-channel avatar surrogate pair.** The first-letter avatar initial now iterates by code point (`Array.from(str)[0]`) so emoji / CJK-only channel names no longer render a dangling half-surrogate glyph.
- **Download progress panel** — close button now synchronously clears the 1 s poll interval before removing the panel, so dismissing a download no longer wastes a full polling cycle on local HTTP hits.
- **File import guard.** In-page settings import now refuses files larger than 10 MB up-front and surfaces `FileReader` errors via toast instead of silently dropping them. Export object-URL revoke extended from 1 s → 60 s to match the options page exporter and avoid cancelled downloads on slower save-dialog paths.
- **Core storage retry integrity.** A failing `chrome.storage.local.set` retry used to merge pending writes into a regular object literal, replacing the `Object.create(null)` target with an `Object.prototype`-linked target. Retries now rebuild on a fresh prototype-less target.

### Added

- **Visual spinner on `aria-busy` buttons** (options page). Every long-running action (export, import, reset, save, open-settings) now shows a 12×12 spinner glyph next to its label while in flight.
- **Popup keyboard ergonomics.** Pressing Enter in the quick-toggle search now focuses the first visible toggle so it can be activated with Space. Pressing Escape clears the filter in one keystroke.
- **Forced-colors / Windows High Contrast support.** Both the popup and the options page restate borders, toggle surfaces, and focus indicators using system `CanvasText` / `Canvas` / `Highlight` keywords so every control stays distinguishable under forced-color themes.
- **Inline sliders glyph** on the popup empty state — a data-URI SVG layered over the accent gradient, no extra asset required.
- **Accessible reset button titles.** Each settings card's Reset button now explains its target value (`Reset AI Summary Model to gpt-4o-mini`) or the reason it's disabled (`No catalog default is available for this setting.`) via both `title` and `aria-label`.
- **Version chip tooltip** on the popup, showing the full `Astra Deck v3.11.0` string on hover.
- **7 new regression tests** guarding the bug-hardening fixes.

### Changed — cross-surface premium polish

- **Shared motion tokens** (`--ease-out`, `--ease-spring`, `--ytkit-ease-out`, `--ytkit-ease-spring`) introduced on the popup, options page, and in-page content-script CSS. Every interactive surface now breathes on the same curves.
- **Unified double-halo focus ring** across every interactive control on all three surfaces.
- **Toggle rows lift** on hover with a subtle `translateY(-1px)` + shadow on the popup; spring-eased thumb transitions on both popup and options toggles.
- **Action cards** on the options page elevate on hover; stat cards are now static (removed false-affordance hover lift since they are informational readouts).
- **Modal entrance animation.** The options settings modal fades + scales in (260ms) with a 220ms backdrop fade.
- **Scrollbar-gutter stability** on every scrollable region prevents horizontal jitter when scrollbars appear.
- **Download progress fill sheen.** A subtle 1.8s forward-moving highlight sweeps across active downloads. Auto-suppressed on success/error and under `prefers-reduced-motion`.
- **Status banner fade-ins** on the page-level and modal-level status banners.
- **Video-hider × button redesign.** Translucent bordered pill + 4px backdrop blur, enumerated transitions, visible `:focus-visible` for keyboard users.
- **Text overflow hardening** on popup toggle rows — names ellipsize, descriptions cap at two lines.
- **Options action-card grid** caps at 4 columns on ≥1240px viewports.
- **Settings workspace banner** now cross-fades between in-sync / unsaved / needs-attention / filtered states.
- **Microcopy** tightened across the options hero, action cards, and version card for more active phrasing.

---

## [3.10.0] - Watch Analytics, Subtitle Styling, AI Summary, Chapters

### Added

- **Watch History Analytics.** Modal dashboard plotting your last 30 days of YouTube watch time as a CSS bar chart. Stats row: 30-day total, daily average, active days, all-time. Entry via "📊 Watch Stats" button next to like/share on watch page, or `window.__ytkitOpenAnalytics()` from console. Uses the existing `watchTimeTracker` data store — enable both for it to populate.
- **Subtitle Styling.** Override YouTube caption appearance — font size (50–300%), font family (default / sans / serif / mono / YouTube Sans), color, background color + opacity, vertical offset, optional text shadow. Pure CSS override on `.ytp-caption-segment`, reacts live to setting changes.
- **AI Video Summary.** Bring-your-own-key LLM summarization button in player controls. Supports OpenAI-compatible, Anthropic (with `anthropic-dangerous-direct-browser-access: true`), Gemini, and Ollama (localhost). Fetches JSON3 transcript, truncates to 120k chars, renders response in a floating Catppuccin panel with Copy button. API key persists via `chrome.storage.local`. Fetch is direct from the content script (not through EXT_FETCH) so users can point to any endpoint without allowlist edits.
- **Copy Chapters as Markdown.** Player-button copies all chapters as a Markdown timestamped list with `youtu.be/<id>?t=<secs>` deep links. Falls back to parsing the description if no macro-markers are present.
- **Chapter Jump Buttons.** Prev / Next chapter buttons in the player right-controls, seeking to surrounding chapter start times.

### Changed

- `DiagnosticLog.record()` hooks for `aiVideoSummary` and `subtitleDownload` failures so errors show up in the diagnostic export.

---

## [3.9.0] - Visual Filters, Subtitle Download, Reddit Comments, Diagnostics

### Added

- **Subtitle Download (SRT).** One-click player-button download of the active caption track as SRT. Reuses the existing JSON3 caption fetch path, no sidebar required. Filename is `${videoId}_${languageCode}.srt`.
- **Video Visual Filters.** Floating panel with six CSS-filter sliders (brightness, contrast, saturation, hue, grayscale, sepia) applied live to `.html5-main-video`. Includes Reset button; filter persists across navigations. Catppuccin-mocha panel anchored to a new player-controls button.
- **DeArrow Peek Button.** Hold Alt to temporarily overlay original titles on top of DeArrow/custom rewrites. Lightweight CSS-only overlay — works with anything that sets `data-ytkit-orig-title` or `.ytkit-dearrow-rewritten`.
- **Video Age Color Coding.** Thumbnails on Home / Subscriptions / Search / sidebar get colored borders by upload age — green (fresh), blue (week), yellow (month), orange (year), red/dimmed (year+). Re-scans on mutations and SPA navigations.
- **Watch Page Tabs.** Description / Comments / Chapters / Transcript tabs injected above `#below` on watch pages. One view at a time, no scrolling between sections. Catppuccin pill-style tabs.
- **Reddit Comments.** Secondary-sidebar panel with "Load threads" button → fetches `reddit.com/search.json` for threads linking the current video. Shows top 15 with subreddit / score / comments. Origin added to `ALLOWED_FETCH_ORIGINS` (non-credentialed — no cookies sent).
- **Diagnostic Error Log.** Captures a rolling 500-entry ring buffer of YTKit errors (console + window.onerror + internal `DiagnosticLog.record`). `window.__ytkitDiagnostics.download()` emits a JSON bug report including version, user agent, URL, and entries.
- **Storage Quota LRU.** Periodic 5-minute sweep caps growing collections: `hiddenVideos` (5k), `hiddenChannels` (2k), `timestampBookmarks` (2k), `deArrowCache` (1k), `_errors` (500). Oldest entries pruned first; prevents `chrome.storage.local` quota exhaustion.
- **API Retry with Exponential Backoff.** `extensionFetchJson` now transparently retries 1s / 2s / 4s on 429 / 5xx / network errors. Default ON (`apiRetryBackoff: true`); feature flag exposed for disabling.

### Security

- `reddit.com` added to `ALLOWED_FETCH_ORIGINS` only (not `CREDENTIALED_FETCH_ORIGINS`) — no cookies ever forwarded to Reddit.

---

## [3.8.0] - Toolbar Popup, Digital Wellbeing, Settings Profiles, New Player Features

### Added

- **Toolbar popup with quick-toggles.** Clicking the toolbar icon now opens a Catppuccin-Mocha popup with 15 curated toggles (hide Shorts, hide related, SponsorBlock, DeArrow, comment search, no autoplay, cap scroll, persistent speed, blue-light, clean URLs, auto theater, transcript sidebar, mini player bar, digital wellbeing, debug mode), a live filter search, and buttons to open the full in-page panel or options page. Toggles broadcast via `YTKIT_SETTING_CHANGED` to the active YouTube tab for live init/destroy with no reload. Replaces the previous click-to-toggle-panel behavior; the full panel is one click deeper via the footer.
- **Settings Profiles (real implementation).** The previous stub is replaced with working save / load / delete / export / import JSON. State lives in `_profiles` and `_activeProfile`. Profile import merges on top of current defaults so missing keys pick up new-version defaults automatically. Exposed as `window.__ytkitProfiles` for panel / popup integration. Schema is versioned (`schemaVersion: 1`) for future migrations.
- **Digital Wellbeing.** Break reminders every N minutes of active playback + optional daily watch-time cap. Ticker runs only while the video is playing AND the tab is visible (no battery drain when idle). Persists `dwWatchTimeToday` keyed by local date — resets at midnight. Full-viewport overlay with Catppuccin card UI on break / cap; auto-pauses the video.
- **Video Rotation.** Rotate the active video 90° / 180° / 270° via CSS transform. 90/270° apply a 0.5625 scale to keep the rotated frame inside the player's 16:9 box. Useful for sideways phone-recorded videos.
- **Frame-by-Frame Buttons.** Visible ⏮ / ⏭ buttons inserted into the player's right-controls, stepping 1/30s at a time and auto-pausing the video. Surfaces YouTube's built-in `,` / `.` keyboard shortcuts for users who don't know they exist.

### Changed

- **Toolbar action behavior.** `default_popup` is now set in the manifest, so `chrome.action.onClicked` no longer fires — the popup handles it. `Ctrl+Shift+Y` still toggles the in-page panel directly.
- **`YTKIT_SETTING_CHANGED` message type.** Content script gains a new live-toggle path that re-inits / destroys the matching feature without a page reload.

---

## [3.7.0] - Transcript Export, Privacy Hardening, Tracking-Param Strip

### Added

- **Transcript export.** The `transcriptViewer` sidebar now has four export buttons under the header: **Copy** (plain-text to clipboard), **.txt** (download), **.srt** (download SubRip subtitles with `HH:MM:SS,mmm` timestamps), and **LLM** (copies a ready-to-paste summarization prompt with title, URL, and timestamped transcript). All exports use the already-fetched JSON3 caption data — no extra network requests. SRT cue end-times derive from `dDurationMs` when available, falling back to the next cue's start.
- **Expanded URL tracking-param strip.** `cleanShareUrls` now strips UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`) and click-tracking IDs (`gclid`, `fbclid`, `mc_cid`, `mc_eid`, `igshid`, `twclid`, `yclid`) in addition to the existing YouTube-internal params. Applies on copy, share-panel display, and address-bar replaceState.

### Security

- **Cookie isolation on EXT_FETCH proxy.** `background.js` previously sent `credentials: 'include'` on every proxied fetch, leaking YouTube session cookies to third-party APIs (SponsorBlock, Return YouTube Dislike, DeArrow). The proxy now defaults to `credentials: 'omit'` and only includes credentials for the explicit allowlist of YouTube-family origins and the local MediaDL endpoint. No behavior change for SponsorBlock/RYD/DeArrow — those endpoints don't require auth.

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
