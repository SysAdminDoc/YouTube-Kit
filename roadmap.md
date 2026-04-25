# Astra-Deck — Roadmap

> **Version:** v3.20.4 — last updated 2026-04-25
> **Charter:** maintenance-mode, security-focused. New user-facing
> features are not planned. Hardening, observability, resilience,
> testability, distribution, and infrastructure are in scope.

This roadmap is a working document. It supersedes the prior `roadmap.md`
which was a historical snapshot. Every Now/Next/Later/Under-Consideration/
Rejected entry below is traceable to a source in the **Appendix** at the
bottom — items without sources are not allowed.

---

## Reading this document

| Tier | Meaning |
|---|---|
| **Now** | Active queue, targeted for the next patch release. P0/P1. |
| **Next** | Queued behind Now. Lands once Now drains. P2. |
| **Later** | Backlog. Real value but low urgency. |
| **Under Consideration** | Would extend the charter (i.e. add a user-facing feature). Listed with explicit `CHARTER-REVIEW:` so the maintainer can decide whether to expand scope. Default: deferred. |
| **Rejected** | Considered and explicitly declined. Reason recorded so future research passes don't silently resurrect them. |

**Charter test for any new item:** if it adds user-visible capability the
extension didn't have before, it goes to **Under Consideration** with a
`CHARTER-REVIEW:` tag. If it hardens, observes, resilience-ifies,
documents, packages, or fixes a bug in something that already exists, it
can land in Now/Next/Later.

---

## Recently shipped (last 30 days)

Pass 9 → Pass 11 in chronological order. Sources are commit + tag URL on
GitHub. Older shipped work is in `CHANGELOG.md`.

| Tag | Pass | Items |
|---|---|---|
| `v3.20.0` | Pass 7 | `_pendingReveals` session mirror; `unlimitedStorage` permission; Firefox `Ctrl+Shift+Y` reserved-key remap; theater-split v1.0.6 attributed-string selection. [src-shipped-1] |
| `v3.20.1` | Pass 8 | `chrome.downloads.onErased` prune for `_pendingReveals`; SponsorBlock `poi_highlight` marker-not-skip; `protocol-buffers-schema` 3.6.0→3.6.1 (GHSA-j452-xhg8-qg39). [src-shipped-2] |
| `v3.20.2` | Pass 9 | H1 TrustedTypes createPolicy observability (`TT_UNAVAILABLE`/`TT_POLICY_FAIL` in DiagnosticLog); H2 Python deps upper-major pins; H3 selector-drift canary via committed token signatures; H4 popup TT-diagnostic banner; H5 storageQuotaLRU dead-ref fix. [src-shipped-3] |
| `v3.20.3` | Pass 10 | H6 cookie-jar wire contract via `normalizeCookieExpiry`; H7 selector canary expanded 9 → 18; H8 theater-split divider-drag SPA-nav memory leak (v1.0.6 → v1.0.7). [src-shipped-4] |
| `v3.20.4` | Pass 11 | H9 EXT_FETCH `controller.abort()` consistency on every size-limit early-return; H10 `scripts/check-versions.js` pre-push version-string drift gate. [src-shipped-5] |

Test count trajectory across these passes: 86 → 124 (+38 regressions).
0 npm audit vulnerabilities at every pass.

---

## Now (P0/P1, targeted next release)

Three items. Large-Repo Mode cap. Each has a PEC rubric.

### N1. Profile-import migration: preserve `_settingsVersion`, run migration chain forward

- **Severity:** Real bug. Documented in iter-1 audit pass [src-1].
- **Files:** `extension/popup.js` (import path), `extension/ytkit.js`
  (settings migration logic), `tests/hardening.test.js`.
- **Goal:** Profile imported with an older `_settingsVersion` must run the
  migration chain forward to current, not stamp the imported value as-is.
- **Acceptance criteria:**
  1. Importing a v3 profile into a v6-schema build produces v6 settings
     with no missing fields and no type errors.
  2. Round-trip test in `tests/hardening.test.js`: export → reset →
     import → all expected keys present.
  3. Migration chain logs each step to DiagnosticLog under
     `ctx === 'settings-migration'`.
  4. Unknown future-version fields preserved on import (forward-compat).
- **Failure modes:**
  - Migration applies twice on re-imported file (idempotency required).
  - Type mismatches between fields renamed in a prior schema version.
- **Rollback trigger:** Any existing JS test fails OR a real exported
  profile from a known prior release fails to import cleanly.
- **Source:** [src-1] iter-1-audit.md C3 finding.

### N2. RYD fetch wrapper: exponential backoff + jitter + 24 h dislike cache

- **Severity:** Resilience hardening on an existing feature. RYD API hits
  hard rate limits and intermittent 429s in practice [src-2] [src-3].
- **Files:** `extension/ytkit.js` (RYD integration), `tests/hardening.test.js`.
- **Goal:** RYD calls survive transient 429/5xx without disabling the
  feature. Cache dislike count per videoId for 24 h, falling back to
  cache on consecutive failures.
- **Acceptance criteria:**
  1. On 429, retry with exponential backoff (250 ms, 500 ms, 1 s + ≤200 ms
     jitter) up to 3 attempts; abort with cached fallback if all fail.
  2. Per-video cache stored under `chrome.storage.local` key
     `ryd_cache` keyed by videoId, 24 h TTL by `_ts`.
  3. After 5 consecutive failures within 10 min, suspend RYD calls for
     5 min (circuit breaker).
  4. Behavior of dislike-display feature is degraded-but-functional
     when RYD is unreachable for ≥5 min (cached values shown with a
     subtle "cached" badge in the popup, surfaced via the existing
     H4 health-banner infra).
- **Failure modes:**
  - Cache key collision with a different feature (mitigation: distinct
    `ryd_*` namespace).
  - Circuit-breaker open-state preventing recovery (mitigation: half-open
    test fetch every 5 min).
- **Rollback trigger:** Existing RYD smoke test fails, OR cached values
  surface stale data from before a vote-reset window.
- **Sources:** [src-2] RYD API docs; [src-3] RYD rate-limit best practices.

### N3. WCAG 2.2 AA — popup focus trap + ARIA dialog semantics

- **Severity:** Accessibility hardening. Popup is the primary UI surface;
  current build has no focus trap and no role/labelledby attributes
  [src-4] [src-5].
- **Files:** `extension/popup.html`, `extension/popup.js`, `extension/popup.css`,
  `tests/hardening.test.js`.
- **Goal:** Popup is a fully-keyboard-navigable modal dialog. Focus
  trapped on open; Escape closes; focus returns to trigger; assistive
  tech announces the dialog title.
- **Acceptance criteria:**
  1. `<body>` of popup has `role="dialog"` + `aria-labelledby="popup-title"`
     + `aria-modal="true"`.
  2. On open, focus moves to the first interactive control. Tab from
     last control wraps to first. Shift-Tab from first wraps to last.
  3. Escape from any focus state closes the popup.
  4. The TT-diagnostic health banner (shipped in H4) surfaces to
     screen readers via `aria-live="polite"` (already there — just
     verify it's announced on appearance).
  5. Regression in `tests/hardening.test.js` pins the `role="dialog"`,
     `aria-modal`, and the focus-trap-cycle code in popup.js.
- **Failure modes:**
  - Focus trap traps the user when the popup contains an iframe (none
    today, but guard for future).
  - Escape conflicts with browser-level shortcut on some platforms.
- **Rollback trigger:** Any popup-related JS test fails, OR keyboard
  navigation regression on a manual NVDA/JAWS smoke pass.
- **Sources:** [src-4] WCAG 2.2; [src-5] W3C ARIA Modal Dialog example.

---

## Next (P2, queued)

After Now drains.

### NX1. i18n — scaffold `_locales/en/messages.json`

The unblocker for community translation. No translation work today;
just the infrastructure so a future contributor can add
`_locales/<lang>/messages.json` without touching source. [src-6] [src-7]

- ~200 message keys covering popup, options, content-script overlays.
- Build-time validator: every `chrome.i18n.getMessage("key")` call in
  source must have a matching key in `_locales/en/messages.json`.
- Strings remain hardcoded English in source until each one is moved
  to a key — no big-bang migration.

### NX2. Mobile — Firefox Android XPI smoke test

Validate the existing XPI on Firefox 128+ Android. Outcome is one of:
"works as-is", "fails on API X — feature toggle / shim required", or
"fails fundamentally — document as desktop-only". Either way, the
README gains a definitive support-matrix entry. [src-8] [src-9]

### NX3. SponsorBlock segment cache + stale-fallback

Cache fetched segments per videoId for 6-12 h. On 5xx or timeout, serve
stale cache with a "cached at <ts>" tooltip in the seekbar overlay.
Pattern from DeArrow API docs (90-min TTL on their side). [src-10] [src-11]

### NX4. Selector-drift canary expansion to player-controls overlay tier

Current canary covers 18 selectors (layout, comments, controls). Adds
SponsorBlock-rendered overlay anchors (`.ytp-progress-bar-padding`,
`.ytp-tooltip-text`) and the comment-attributed-string text wrappers
that broke twice in the last 60 days. Two-sided assertion still applies
(must be in both fixtures and ytkit.js). [src-12] [src-13]

### NX5. Mozilla AMO listing for the Firefox XPI

Submit `unlisted` to AMO so signed XPI auto-update works. 2-4 week
review window per Mozilla policy. Charter-compatible because the XPI
content is unchanged — only the distribution path. [src-14]

### NX6. Profile-import migration round-trip suite

Companion to N1. For every prior `SETTINGS_VERSION` (1 → 5 currently),
emit a known-shape profile fixture, import into the v6 build, assert
equality with the corresponding v6 expected output. Runs in
`tests/hardening.test.js`. [src-1]

### NX7. Storage size audit for sync-eligibility

One-off measurement — exact byte count of a typical Astra-Deck
`chrome.storage.local` payload. If <100 KB, `chrome.storage.sync` is
viable for UI preferences. If >100 KB, document the constraint and
defer sync forever. Decision-blocking measurement. [src-15] [src-16]

---

## Later (backlog)

Concrete value, low urgency. Each line is one item.

- **L1** ESLint custom rule flagging non-top-level `addListener` in
  `background.js` (post-await loss across SW restart). [src-17]
- **L2** ARIA live region for SponsorBlock skip + DeArrow title-replace
  events. [src-5] [src-18]
- **L3** Dependabot or Snyk on the repo for transitive pip + npm CVE
  tracking (we already run `npm audit --omit=dev` on every release;
  Dependabot moves it earlier in the loop). [src-19]
- **L4** Migrate `extension/ytkit.js` to per-area test fixtures so the
  monolith can be audited per-feature without re-scanning 36 K LOC.
  Modularization sub-step, not a full split. [src-20]
- **L5** Greasy Fork mirror of `YTKit.user.js` so the userscript surface
  is discoverable outside the GitHub release feed. [src-21] [src-22]
- **L6** Documented signing-key rotation policy for `ytkit.pem`. The key
  is gitignored and persistent; document rotation cadence and the
  release-side migration path. [src-23]
- **L7** WCAG 2.2 a11y audit beyond N3 — full popup keyboard map,
  focus-visible outlines, color-contrast pass on the H4 health-banner
  amber palette, screen-reader text on all icon-only buttons. [src-4]
- **L8** Async-write race instrumentation in popup ↔ ytkit.js — popup
  writes hiddenVideos, blockedChannels, bookmarks via direct
  `chrome.storage.local.set`; ytkit.js reads via `storage.onChanged`.
  Add a write-vector-clock so two near-simultaneous writes from
  popup + ytkit don't lose data. (No reproducer yet.) [src-24]
- **L9** Toggle-button to clear DiagnosticLog from the popup. Currently
  the only path is reset-all or Storage Quota LRU eviction. [src-25]
- **L10** "Wave 8/9 feature coverage audit" — pick three features added
  in v3.16-v3.17 that lack regression tests in `hardening.test.js`,
  add tests. Blocked on concrete scoping (which features specifically). [src-25]

---

## Under Consideration (CHARTER-REVIEW)

Items that would expand the "no new features" charter. Listed so the
maintainer can decide whether to lift the freeze. **Default: deferred.**

### UC1. Settings sync via `chrome.storage.sync`

`CHARTER-REVIEW: feature-extension.` Adds cross-device behaviour the
extension does not have today. Trade-off: 100 KB cap is tight for
267 settings; would require selective sync (an opt-in toggle per
setting group). Decision blocked on **NX7** (size audit). [src-15] [src-16]

### UC2. User-account cloud backup

`CHARTER-REVIEW: feature-extension + service-extension.` Would require
a backend. Out of scope per charter. Bitwarden's pattern is the
reference. [src-26]

### UC3. Greasy Fork userscript fork that re-implements MAIN-world ad blocking the extension cannot ship under MV3

`CHARTER-REVIEW: feature-divergence.` The extension stopped shipping
MAIN-world ad blocking when MV3 made `webRequestBlocking` unavailable.
A userscript fork could re-add it with `@grant` permissions. Adds
maintenance surface and a divergent feature matrix between extension
and userscript. [src-27] [src-28]

### UC4. Audio-track download + transcode features (Wave-restored)

`CHARTER-REVIEW: feature-extension.` Several archive-restoration items
(SharedAudio volume boost, Cobalt downloader fallback, mute-ad-audio)
were left in the userscript-only path during the v3.7 → v3.10 wave.
Re-porting to the extension is feature work, not maintenance. [src-29]

### UC5. AI summary + transcript-handoff provider expansion

`CHARTER-REVIEW: feature-extension.` Current providers: OpenAI,
Anthropic, Google. Community asks frequently for Mistral, Ollama,
local-llama.cpp. Each new provider is a new feature with new key
storage + auth shapes. [src-30]

---

## Rejected (with reason)

Preserved so future research passes don't silently resurrect them.

| Item | Reason |
|---|---|
| Pin `curl_cffi >=0.15.0` | `curl_cffi` is not a dependency of `astra_downloader.py`. Verified by grep. CVE-2026-33752 does not apply. [src-31] |
| Pin `yt-dlp` in `requirements.txt` | `yt-dlp` is shelled out as `yt-dlp.exe` with SHA256 verification (`YTDLP_SHA256_URL`), not a pip dep. Pinning in `requirements.txt` is meaningless. [src-32] |
| DNS-rebinding defence in `astra_downloader.py` | Already shipped in v3.15.0. Test exists at `test_dns_rebinding_attack_is_rejected_before_handler`. [src-33] |
| Firefox 152 `moz-extension://` injection audit | Verified: `extension/` has zero `scripting.executeScript` calls targeting `moz-extension://` origins. Fix not needed. [src-34] |
| Chrome DNR `isUrlFilterCaseSensitive` audit | Astra-Deck does not use `declarativeNetRequest`. Not applicable. [src-35] |
| Node 22 LTS migration in CI | `.nvmrc` already pins Node 22. `package.json#engines.node` says `>=22`. Already done. [src-36] |
| Bound DeArrow cache | DeArrow already self-caps at 2000 entries on every fetch + persist (`extension/ytkit.js` `_doFetch` + `_schedulePersist`). The H5 fix added a belt-and-suspenders sweep on the real `da_branding_cache` storage key. Closed. [src-37] |
| Tampermonkey #2673 SPA-nav workaround | Requires rewriting userscript distribution architecture. Extension is the primary ship vehicle; userscript is mirror. Charter-violation if implemented. [src-38] |
| Flask-HTTPAuth CVE-2026-34531 mitigation | Astra-Deck's downloader does not import Flask-HTTPAuth. Not applicable. [src-39] |
| Mass migrate to ESM modules in extension | Would require rewriting the build pipeline and is invisible to users. Cost > value at current size. [src-40] |
| AGPL relicense (per YouTubeAlchemy precedent) | Astra-Deck is MIT and the maintainer prefers MIT. Charter-aligned to keep. [src-41] |

---

## Risk register

Carried over from prior `roadmap.md`. Status updated to reflect Pass
9-11 ship state.

| Risk | Status | Mitigation |
|------|--------|-----------|
| Progress-bar DOM rewrites on theater/miniplayer transitions break segment overlay | Mitigated | Segment renderer listens for `ResizeObserver` + `MutationObserver` and re-paints. |
| YouTube A/B serves new comment DOM classes | Ongoing | Quarterly selector audit. v3.20.3 expanded selector-drift canary 9 → 18 [src-shipped-4]. Iter-3 research surfaced cadence shifting to weekly [src-13]. |
| Settings-profile schema migration on new settings | **Open — N1** | Profile load shallow-merges over current defaults; export includes `schemaVersion`. C3 import bug remains open and is N1. |
| Toolbar popup broadcasts hit tabs without ytkit.js loaded | Mitigated | `chrome.tabs.sendMessage` wrapped; `chrome.runtime.lastError` swallowed. |
| Digital wellbeing interval keeps SW alive | Mitigated | Ticker runs in content script, not SW. Persists on `visibilitychange` + 30s. |
| URL-strip breaks YouTube Music `si=` | Mitigated | `stripTrackingParams` scoped to `www.youtube.com`. |
| `credentials: 'omit'` breaks RYD vote attribution | Mitigated | RYD public endpoints don't require auth. |
| TrustedTypes peer-extension policy collision | **Observable as of v3.20.2** | H1 logs `TT_POLICY_FAIL` to DiagnosticLog; H4 surfaces in popup banner [src-shipped-3]. |
| EXT_FETCH SW socket retention on too-large response | **Mitigated v3.20.4** | H9 added `controller.abort()` to all five size-limit paths [src-shipped-5]. |
| Theater-split divider-drag mid-SPA-nav listener orphan | **Mitigated v3.20.3** | H8 hoisted drag handles; teardown calls `abortDividerDrag()` [src-shipped-4]. |
| Cookie-jar wire format drift | **Mitigated v3.20.3** | H6 introduced `normalizeCookieExpiry()` with documented contract + parity tests across all three sites [src-shipped-4]. |
| Pre-push version-string drift between four canonical sources | **Mitigated v3.20.4** | H10 wired `scripts/check-versions.js` into `npm run check` [src-shipped-5]. |

---

## Architectural watchlist

Notes that are not scheduled work but inform priority decisions. Ported
from prior `roadmap.md` with status updates.

### High-priority

- **Monolithic content script (~36 K LOC).** `extension/ytkit.js`
  remains a single file. The `core/` extraction covers shared
  utilities only. Per-area audit (rather than full split) is L4 above.
- **No bundling / minification.** `build-extension.js` copies files
  verbatim. A bundler would cut payload ~60-70 % at the cost of
  shipping non-readable code (and the userscript variant must remain
  readable per `stack-javascript.md` convention). Trade-off blocks the
  change.
- **Unbounded storage growth.** Addressed v3.9.0 (`storageQuotaLRU`),
  v3.20.0 (`unlimitedStorage`), v3.20.2 H5 (real-key LRU sweep on
  `da_branding_cache`). Considered closed; monitor.

### Medium-priority

- **Crash/error telemetry.** `diagnosticLog` exists. Popup banner
  surfaces TrustedTypes failures (H4). No badge for non-TT errors yet.
- **Feature dependency graph.** `CONFLICT_MAP` handles mutually-exclusive
  features. No graph for features REQUIRING other features (e.g.
  chapter-dependent features no-op silently).
- **Cross-browser parity assumed.** Firefox support relies on implicit
  WebExtension API aliasing. NX2 (Firefox-Android smoke test) opens
  visibility into mobile parity; desktop Firefox remains untested.
- **SW lifecycle hardening.** Top-level listener registration is
  enforced socially, not by lint. L1 above turns it into ESLint.

### Low-priority

- **Build-system version sync.** Regex-based across four files.
  `scripts/check-versions.js` (v3.20.4 H10) catches drift pre-push.
  Considered closed.
- **Sideloaded CRX/XPI auto-update.** GitHub Releases API check could
  surface new versions in-extension. Not scheduled. Fits NX5 (AMO
  listing) for the Firefox path.
- **No internationalization.** All UI strings hardcoded in English.
  NX1 unblocks community translation.

---

## Quality gates by release stage

Unchanged from prior `roadmap.md`. Applied on every release.

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
- [ ] Version string synced across `package.json`, `manifest.json`,
      `ytkit.js#YTKIT_VERSION`, userscript header
      (enforced by `npm run check:versions`)
- [ ] CHANGELOG versioned entry with date
- [ ] GitHub release with all four artifacts
- [ ] Git tag pushed
- [ ] Memory file updated with new version and any gotchas learned

---

## Performance budget

No shipped feature has regressed these. Measured on i5-1235U / 16 GB /
Chrome stable / cold cache against `/watch?v=dQw4w9WgXcQ`.

| Metric | Current | Target | Hard ceiling |
|--------|---------|--------|---------------|
| `ytkit.js` raw size | ~1.25 MB | ≤1.2 MB | 1.5 MB |
| Parse + execute (cold) | ~200 ms | ≤150 ms | 250 ms |
| Time to first feature paint | ~420 ms | ≤350 ms | 600 ms |
| Memory (idle, after 5 min) | ~45 MB | ≤50 MB | 80 MB |
| Memory (after 100 SPA navs) | ~75 MB | ≤60 MB | 100 MB |
| `chrome.storage.local` typical 30-day | ~500 KB | ≤1 MB | 5 MB |

---

## Category coverage audit (Phase 5 self-check)

Every category from the research directive is covered or explicitly
flagged thin. **All 13 categories addressed below.**

| Category | Coverage | Where |
|---|---|---|
| Security | Strong | Pass 7-11 ship items; Risk Register; rejected items 1-3, 9. |
| Accessibility (a11y) | Now (N3) + backlog (L7); audit covers it. | Now N3, Later L7. |
| i18n / l10n | Next (NX1); deferred but infra-ready | NX1. |
| Observability / telemetry | Strong — H1 + H4 shipped; L1 ESLint open | Risk register, watchlist medium. |
| Testing | Strong — 124 tests, +38 new, +canary infra | Recently-shipped, Now (all 3 add regressions), NX6, L4. |
| Docs | Strong — CHANGELOG/HARDENING.md/this roadmap synced after every change per user instruction | This document; per-pass HARDENING.md sections. |
| Distribution / packaging | Next (NX5 AMO) + Later (L5 Greasy Fork, L6 key rotation) | NX5, L5, L6. |
| Plugin ecosystem | N/A — Astra-Deck is monolithic by design; no plugin SDK shipped | Architectural watchlist. |
| Mobile | Next (NX2) + research in iter-4-gap-fill.md | NX2. |
| Offline / resilience | Now (N2) + Next (NX3) | N2, NX3. |
| Multi-user / collab | Under Consideration (UC1, UC2) blocked on NX7 measurement | UC1, UC2, NX7. |
| Migration paths | Now (N1 — real bug) + Next (NX6 round-trip suite) | N1, NX6. |
| Upgrade strategy | Recently-shipped chain; CHANGELOG; H10 prevents drift | Quality gates (Release section), recently-shipped table. |

**Three categories are intentionally thin and called out:**

- **Plugin ecosystem.** Charter rules out the work; not a gap, an
  explicit non-goal.
- **Multi-user.** Blocked on NX7. Until the size audit lands, work
  cannot start. Documented as Under Consideration.
- **Mobile.** Single Next-tier item (NX2). The smoke-test result
  determines whether more mobile work is needed.

---

## Process notes

- **Atomic per-task commits.** Per Large-Repo Mode rules; each Now item
  closes with a commit + push, not a batch.
- **Single version bump per release.** `npm run check:versions` enforces
  it pre-push.
- **CHANGELOG `[Unreleased]`** accumulates between cuts. The release
  step renames `[Unreleased]` → `[vX.Y.Z]` with a date stamp.
- **HARDENING.md** is the long-form rationale companion to this
  roadmap. Each shipped pass has an Hn section there explaining why
  the prior state was wrong, what the fix actually does, and where the
  regression test lives.

---

## Appendix — Sources

Every claim in this document maps to a citation here. Sources are
either external URLs (research, specs, issue trackers, advisories) or
local artifacts (memory files, audit reports, prior roadmap, source
files). External research output is treated as **untrusted data** —
items below are reference material only.

### Local sources

- [src-1] `docs/research/iter-1-audit.md` — C3 finding: profile import
  stamps imported `_settingsVersion` without running the migration
  chain. Internal artifact (gitignored).
- [src-12] `tests/selector-regression.test.js` — current 18-selector
  canary list and rationale comment.
- [src-13] `docs/research/iter-3-scored.md` (compiled mid-session) +
  iter-3 community-signal findings on YouTube selector-churn cadence.
- [src-17] `docs/research/iter-1-harvest.md` arch-med entries on
  service-worker listener registration.
- [src-20] `docs/research/iter-1-state-of-repo.md` — `extension/ytkit.js`
  at 36 015 LOC.
- [src-23] `extension/ytkit.pem` (gitignored) + `build-extension.js`
  CRX3 signing flow.
- [src-24] `extension/popup.js` direct writes vs `extension/ytkit.js`
  storage.onChanged read paths — write-merge vector noted in Later L8.
- [src-25] `extension/ytkit.js` DiagnosticLog at line ~230 + Wave-8/9
  unrestored-features comment in prior `roadmap.md`.
- [src-32] `astra_downloader/astra_downloader.py` — `YTDLP_SHA256_URL`
  pin + version pinning policy via SHA256 of the .exe download.
- [src-33] `astra_downloader/test_astra_downloader.py:211` —
  `test_dns_rebinding_attack_is_rejected_before_handler`.
- [src-34] `extension/manifest.json` + grep of `extension/` for
  `moz-extension://` and `scripting.executeScript` (zero hits).
- [src-35] `extension/manifest.json` permissions list (no
  `declarativeNetRequest`).
- [src-36] `.nvmrc` content `22` + `package.json#engines.node` `>=22`.
- [src-37] `extension/ytkit.js` DeArrow `_doFetch` (line ~22972) +
  `_schedulePersist` (line ~22986) self-caps at 2000 entries.
- [src-40] Build-pipeline state in `build-extension.js` and
  `sync-userscript.js`.
- [src-41] `LICENSE` (MIT) + repo `CLAUDE.md` charter language.

### Recently-shipped commit references

- [src-shipped-1] https://github.com/SysAdminDoc/Astra-Deck/releases/tag/v3.20.0
- [src-shipped-2] https://github.com/SysAdminDoc/Astra-Deck/releases/tag/v3.20.1
- [src-shipped-3] https://github.com/SysAdminDoc/Astra-Deck/releases/tag/v3.20.2
- [src-shipped-4] https://github.com/SysAdminDoc/Astra-Deck/releases/tag/v3.20.3
- [src-shipped-5] https://github.com/SysAdminDoc/Astra-Deck/releases/tag/v3.20.4

### External — accessibility (a11y)

- [src-4] W3C WCAG 2.2 specification — https://www.w3.org/TR/WCAG22/
- [src-5] W3C ARIA Modal Dialog example — https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/dialog/
- [src-18] MDN ARIA Live Regions — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions

### External — i18n

- [src-6] Chrome i18n API — https://developer.chrome.com/docs/extensions/reference/api/i18n
- [src-7] MDN WebExtension i18n directory layout — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization

### External — mobile

- [src-8] Mozilla blog: MV3 in Firefox 128 — https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/
- [src-9] Mozilla: Android extension support FAQ — https://blog.mozilla.org/addons/2020/02/11/faq-for-extension-support-in-new-firefox-for-android/

### External — offline / resilience

- [src-2] Return YouTube Dislike API — https://returnyoutubedislikeapi.com/swagger/index.html
- [src-3] Ayrshare guide to handling 429 rate limits — https://www.ayrshare.com/complete-guide-to-handling-rate-limits-prevent-429-errors/
- [src-10] DeArrow API documentation — https://wiki.sponsor.ajay.app/w/API_Docs/DeArrow
- [src-11] SponsorBlock API — https://wiki.sponsor.ajay.app/w/API_Docs

### External — multi-user / sync

- [src-15] Chrome storage API quotas — https://developer.chrome.com/docs/extensions/reference/api/storage
- [src-16] MDN storage.sync — https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync
- [src-26] Bitwarden release notes — https://bitwarden.com/help/releasenotes/

### External — distribution

- [src-14] Mozilla — submitting an add-on (AMO) — https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- [src-21] Tampermonkey FAQ — https://www.tampermonkey.net/faq.php
- [src-22] Greasy Fork — https://greasyfork.org/

### External — security advisories

- [src-19] GitHub Advisory Database — https://github.com/advisories
- [src-31] CVE-2026-33752 (curl_cffi SSRF) — referenced in iter-1-sources
- [src-39] Flask-HTTPAuth CVE-2026-34531 — referenced in iter-3-sources

### External — direct competitors / community signal

- [src-27] uBlock Origin Lite (uBOLite) MV3 — https://github.com/uBlockOrigin/uBOL-home
- [src-28] Tampermonkey changelog — https://www.tampermonkey.net/changelog.php
- [src-29] YouTube Alchemy releases — https://github.com/TimMacy/YouTubeAlchemy
- [src-30] Enhancer for YouTube — https://github.com/Maximilianos/enhancer-for-youtube
- [src-38] Tampermonkey issue #2673 — https://github.com/tampermonkey/tampermonkey/issues/2673

> Phase-1 source breadth in `docs/research/iter-1-sources.md` (77
> distinct URLs, gitignored). The references above are the subset
> directly cited in this document.

---

*Last updated: 2026-04-25 — Hardening Pass 11 (v3.20.4). Next review:
when N1/N2/N3 ship or when iter-5 research surfaces a higher-leverage
item.*
