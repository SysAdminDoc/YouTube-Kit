# YouTube-Kit (Astra Deck) — Roadmap

**No further features are planned.** The forward-looking feature backlog (v3.9.0 leftovers, v4.0.0 audio stack, v4.1.0 privacy/wellbeing, v4.2.0+ exploratory, and the cross-cutting infrastructure waves tied to them) has been removed at the user's direction.

This document is kept as a historical record of shipped work, architectural analysis, and cross-project notes that remain relevant regardless of feature plans.

---

## Shipped Releases

> Moved to ROADMAP-COMPLETED.md.

## Research & Strategic Gaps

Architectural analysis captured during the v3.7.0 research phase. These are *notes*, not a to-do list — no work is scheduled against them.

### High-Priority Architectural Notes

- **Monolithic content script (~1.1MB, 22K+ LOC).** `ytkit.js` holds every feature in one file. Load time, parseability, and maintainability will degrade as the file grows. The `core/` extraction (env, storage, styles, url, page, navigation, player) covers shared utilities only.
- **No minification or bundling.** `build-extension.js` copies files verbatim. A minifier would cut payload by ~60-70%.
- **Unbounded storage growth addressed in v3.9.0** via `storageQuotaLRU`. The underlying concern — `chrome.storage.local`'s 10MB quota with `unlimitedStorage` not declared — remains.
- **No rate limiting on EXT_FETCH proxy.** No per-origin limits on SponsorBlock/RYD/DeArrow. Rapid SPA navigation could trigger community-expected rate limits.
- **`credentials: 'omit'` default** shipped in v3.7.0 via `CREDENTIALED_FETCH_ORIGINS` allowlist.

### Medium-Priority Architectural Notes

- **Crash/error telemetry** addressed in v3.9.0 via `diagnosticLog`. No UI badge yet.
- **Feature dependency graph.** `CONFLICT_MAP` handles mutually exclusive features. No dependency graph for features requiring other features (e.g., chapter-dependent features silently no-op).
- **Options page disconnected from runtime.** `options.html`/`options.js` is a settings editor, not a dashboard. It doesn't know which features initialized successfully.
- **Cross-browser parity assumed, not verified.** Firefox support relies on implicit WebExtension API aliasing. No Firefox-specific test path.
- **Service worker lifecycle not hardened.** No keep-alive strategy for in-flight EXT_FETCH or DOWNLOAD_FILE operations.

### Low-Priority Architectural Notes

- **DeArrow cache** has no size bound (unlike resume playback and watch time).
- **Build system version sync is regex-based** across `manifest.json`, `ytkit.js` `YTKIT_VERSION`, and userscript header. Fragile on format drift.
- **No extension update notification.** Sideloaded CRX/XPI don't auto-update; GitHub Releases API check would surface new versions.
- **No internationalization.** All UI strings hardcoded in English.

---

## Competitive Landscape

Research across 20+ extensions, userscripts, and open-source frontends. Projects analyzed: ImprovedTube, Enhancer for YouTube, SponsorBlock, Return YouTube Dislike, DeArrow, Unhook, BlockTube, YouTube Redux, Clickbait Remover, YouTube NonStop, YouTube Alchemy, Tube-Insights, FreeTube, Invidious, Piped, NewPipe, SmartTube, Grayjay, yt-dlp, Tubular.

**Astra Deck's position (as of v3.10.0):** 175+ features, top 3 by feature count alongside ImprovedTube (~250 tweaks) and YouTube Alchemy (~200 features). Consolidation of SponsorBlock, DeArrow, RYD, downloads, theater split, content controls, transcript tools, visual filters, AI summary, and watch analytics into a single extension is a strong differentiator — most users install 4-6 separate extensions to get equivalent coverage.

---

## External Ecosystem — Comparable Open-Source Projects

Kept for reference when auditing selector fragility, architectural patterns, or cross-browser support.

### Tier 1 — Direct Competitors

| Project | Stars | License | Language | Pattern worth studying |
|---------|-------|---------|----------|------------------------|
| [ajayyy/SponsorBlock](https://github.com/ajayyy/SponsorBlock) | 13,050 | GPL-3.0 | TypeScript | `previewBar.ts` creates `<ul id="previewbar">` overlay with colored `<li>` elements positioned by percentage. Per-browser manifest merging via overlay JSONs. Shared `maze-utils` library for SPA navigation detection. |
| [Anarios/return-youtube-dislike](https://github.com/Anarios/return-youtube-dislike) | 13,503 | GPL-3.0 | JavaScript | `externally_connectable` for cross-extension communication. `createSmartimationObserver` for like/dislike animation detection. Multi-browser manifest strategy. Shorts detection via `is-active` on `YTD-REEL-VIDEO-RENDERER`. |
| [code-charity/youtube](https://github.com/code-charity/youtube) (ImprovedTube) | 4,312 | custom | JavaScript | Two-world split architecture: ISOLATED world for Chrome APIs, web-accessible scripts injected via `<script>` tag. Custom event system. 250+ features proves the domain scales. |
| [zerodytrash/Simple-YouTube-Age-Restriction-Bypass](https://github.com/zerodytrash/Simple-YouTube-Age-Restriction-Bypass) | 2,413 | MIT | JavaScript | Data-layer interception: proxies `JSON.parse`, `XMLHttpRequest.prototype.open`, `Request`, and `Object.defineProperty` on `playerResponse`. Strategy pattern with fallback unlock methods. |
| [TimMacy/YouTubeAlchemy](https://github.com/TimMacy/YouTubeAlchemy) | N/A | AGPL-3.0 | JavaScript | 200+ features in one 568KB file proves single-file can scale but gets unwieldy. Tab view, SponsorBlock progress bar, transcript export. |

### Tier 2 — Adjacent Projects

| Project | Stars | What we can reference |
|---------|-------|-----------------------|
| [TeamPiped/Piped](https://github.com/TeamPiped/Piped) | 9,892 | Privacy-first architecture, federated proxy network. |
| [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) | 14K+ | Subscription profiles/groups, local-only watch history, watch statistics dashboard. |
| [polymorphicshade/Tubular](https://github.com/polymorphicshade/Tubular) | 3,103 | NewPipe fork with SponsorBlock + RYD integration. |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 156,879 | SponsorBlock-aware chapter marking, metadata embedding, subtitle extraction. Reference for format/codec selection logic. |

---

## v3.7.0 Execution Plan (historical)

Concrete implementation sketches retained as reference for how shipped features were scoped. All items below are shipped.

### 1. SponsorBlock Seekbar Segments (shipped pre-v3.7)
- `ytkit.js` `_renderBarSegments` / `.ytkit-sb-segment`. Segments painted into `.ytp-progress-bar-padding`, keyed to `startTime/videoDuration * 100%` and width `(endTime-startTime)/videoDuration * 100%`.
- Redraw triggers: `yt-navigate-finish`, `durationchange`, `ResizeObserver` on the progress bar.

### 2. Transcript Export (shipped v3.7.0)
- Transcript JSON3 already fetched into `{ start, dur, text }` cues. Added four buttons in transcript sidebar header: Copy, .txt, .srt, LLM prompt.
- SRT converter: ~40 lines inline, `HH:MM:SS,mmm` timestamps, sequential cue numbers.
- LLM prompt: `"Summarize this YouTube transcript. Title: {title}. Transcript:\n{text}"`.

### 3. Toolbar Popup (shipped v3.8.0)
- `extension/popup.html` + `popup.js` + `popup.css`. `action.default_popup` set in manifest.
- 15 curated toggles. Reads/writes `chrome.storage.local` directly, broadcasts `YTKIT_SETTING_CHANGED` to active YouTube tabs.

### 4. Strip URL Tracking Parameters (shipped v3.7.0)
- `cleanShareUrls` expanded. Params stripped: `si`, `pp`, `feature`, `utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `igshid`, `twclid`, `yclid`.
- Preserved: `v`, `t`, `list`, `index`, `ab_channel`.

### 5. Settings Profiles (shipped v3.8.0)
- Storage shape: `{ _activeProfile: "default", _profiles: { default: {...}, ... } }`.
- Exposed as `window.__ytkitProfiles`. Schema versioned (`schemaVersion: 1`).

### 6. `credentials: 'omit'` Fix (shipped v3.7.0)
- `background.js` EXT_FETCH handler defaults to `credentials: 'omit'`. `CREDENTIALED_FETCH_ORIGINS` allowlist covers only YouTube family and MediaDL localhost.

### 7. Digital Wellbeing (shipped v3.8.0)
- Storage: `dwWatchTimeToday: { date, seconds }`, `dwBreakIntervalMin`, `dwDailyCapMin`.
- Ticker in content script, gated by `!document.hidden && !video.paused`. Full-viewport overlay on break/cap, auto-pauses video.

---

## Implementation Risk Register

Risks that materialized (or were pre-mitigated) during v3.7.0–v3.10.0.

| Risk | Status | Mitigation |
|------|--------|-----------|
| Progress bar DOM rewrites on theater/miniplayer transitions break segment overlay | Mitigated | Segment renderer listens for `ResizeObserver` + `MutationObserver` and re-paints. |
| YouTube A/B test serves new comment DOM classes, breaking `commentSearch` and creator highlight | Ongoing | Quarterly selector audit in CLAUDE.md; `diagnosticLog` surfaces selector failures. |
| Settings profile schema migration when new settings added in future versions | Mitigated | Profile load shallow-merges over current `defaults`; JSON exports include `schemaVersion`. |
| Toolbar popup broadcasts hit tabs that have never loaded `ytkit.js` → "Receiving end does not exist" | Mitigated | `chrome.tabs.sendMessage` wrapped; `chrome.runtime.lastError` swallowed. |
| Digital wellbeing interval keeps service worker alive | Mitigated | Ticker runs in content script, not SW. Persist on `visibilitychange` + 30s intervals. |
| URL param stripping breaks YouTube Music's `si=` linking | Mitigated | `stripTrackingParams` scoped to `www.youtube.com` only; skips `music.youtube.com`. |
| `credentials: 'omit'` breaks RYD's user-vote attribution | Mitigated | RYD public endpoints don't require auth. |

---

## Cross-Project Ecosystem Integration

Opportunities unique to this repo's position within the user's existing project set. Not scheduled work — notes for future decisions.

- **Share quick-toggle popup architecture with BetterNext & ScriptVault** — all three ship MV3 popups. A shared `popup-kit.css` with the Catppuccin Mocha palette + toggle/slider/select primitives could be consumed by copy-paste.
- **StreamKeep handoff** — Astra Deck's "Download" button could deep-link into StreamKeep (`streamkeep://add?url=...`) when installed.
- **CUE parallels** — CUE's Shadow DOM isolation pattern on claude.ai is applicable if Astra Deck ever renders controls *inside* YouTube's DOM (persistent speed slider, etc.).
- **RES-Slim selector-resilience pattern** — per-module selector fallbacks are more defensive than Astra Deck's direct-selector approach. Worth adopting for volatile DOM regions (comments, related videos, masthead).

---

## Deprecation & Cleanup Backlog

Accumulated cruft. Not scheduled; noted so it isn't forgotten.

- **Archived MHTML samples** — `Live Video Example.mhtml`, `Regular Video Example.mhtml`, `Subscriptions example.mhtml`, `YouTube.mhtml` in repo root bloat clones.
- **Loose PNGs in repo root** — `banner.png`, `comments.png`, `menu.png`, `12305612-*.png`. Belong under `assets/`.
- **Duplicate icon files** — `favicon.ico`, `icon.ico`, `icon.png`, `icon.svg` at root overlap with `icons/` and `extension/icons/`.
- **`Install-YTYT.ps1`** — YTYT-Downloader was consolidated into this repo; installer may be redundant.
- **Pre-v3.0 userscript headers** — audit `YTKit-v1.2.0.user.js` for `@grant` declarations no longer needed.

---

## Performance Budget

No shipped feature has regressed these budgets (measured on i5-1235U, 16GB, Chrome stable, against `/watch?v=dQw4w9WgXcQ` cold cache).

| Metric | Current | Target | Hard Ceiling |
|--------|---------|--------|--------------|
| `ytkit.js` raw size | ~1.25 MB | ≤ 1.2 MB | 1.5 MB |
| Parse + execute time (cold) | ~200 ms | ≤ 150 ms | 250 ms |
| Time to first feature paint | ~420 ms | ≤ 350 ms | 600 ms |
| Memory (idle, after 5 min) | ~45 MB | ≤ 50 MB | 80 MB |
| Memory (after 100 SPA navs) | ~75 MB | ≤ 60 MB | 100 MB |
| `chrome.storage.local` usage (typical 30-day user) | ~500 KB | ≤ 1 MB | 5 MB |

---

## Quality Gates by Release Stage

Still applied on every release.

### Feature branch
- [ ] Feature registers cleanly under the feature-array pattern
- [ ] Default is OFF in `default-settings.json`
- [ ] No new global variables; scoped to feature namespace
- [ ] No syntax error after build (`node --check`)
- [ ] Local Chrome dev-mode install loads without console errors

### Main
- [ ] CHANGELOG entry added
- [ ] Settings-meta entry with label and description
- [ ] No regression in existing features (manual smoke test of related features)

### Release
- [ ] All four artifacts build (Chrome ZIP, CRX, Firefox ZIP, XPI)
- [ ] Clean-profile test on Chrome stable
- [ ] Version string synced across `manifest.json`, `ytkit.js` `YTKIT_VERSION`, userscript header, README badge
- [ ] CHANGELOG versioned entry with date
- [ ] GitHub release with all four artifacts
- [ ] Git tag pushed
- [ ] Memory file updated with new version and any gotchas learned

---

*Last updated: 2026-04-14 — forward-looking feature backlog removed per user direction after v3.10.0 shipped.*
