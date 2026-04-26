# Astra Deck — Hardening Audit (v3.14.0 → v3.15.0)

Deep engineering audit of the Astra Deck MV3 extension (Chrome + Firefox) and
companion Tampermonkey userscript. Findings are split into **real issues**
(verified in code) and **false positives** (items that looked like bugs from
the outside but turned out to already be mitigated). The false-positive list
is retained deliberately — it documents existing invariants so future audits
don't re-raise the same noise.

Scope:

- `extension/ytkit.js` (~31,400 lines, ISOLATED world)
- `extension/background.js` (MV3 service worker / EXT_FETCH proxy)
- `extension/ytkit-main.js` (MAIN world bridge)
- `extension/popup.js`, `extension/options.js`
- `extension/core/` (env, storage, styles, url, page, navigation, player)
- `extension/manifest.json`, `extension/early.css`

---

## Real Issues (Addressed in v3.14.0)

### Critical

**C1 — ReDoS guard in video-title filter is incomplete**
`ytkit.js` `videoHider._processVideoElement()` parses a user-supplied regex
when `hideVideosKeywordFilter` starts with `/`. The current guard rejects
`(a+)+` (nested group quantifier) and `a*+` (stacked quantifier) but does
not catch alternation-wrapped quantifier stacks such as `(a|b+)+` or
`(foo|bar*)+`. A malicious paste into the filter textarea could stall video
grid rendering.

Fix: broaden the guard to reject any group whose body contains a quantifier
when the group itself is followed by `+`, `*`, `?`, or `{`.

**C3 — Profile import stamps current `_settingsVersion` without migrating**
`options.js:312 applySettingsVersion()` overwrites `_settingsVersion` on every
imported payload. A profile exported at schema v2 imported into a v3 build
bypasses the migration path entirely and silently skips new-default
initialization for added settings.

Fix: preserve the imported `_settingsVersion`, run the migration chain from
that version forward, and only stamp the current version after migration.

### Medium

**C4 — 19 empty `catch (_) {}` blocks in `ytkit.js`**
Empty catches are correct in many cases (e.g. sandbox iframe `contentWindow`
access) but the pattern makes it impossible to distinguish intentional
silence from accidental swallowing. No single site is a bug today; the
pattern as a whole is the issue.

Fix: every `catch (_) {}` either carries a `// reason:` comment explaining
why the silence is safe, or routes through `DebugManager.log()` so
diagnosticLog captures it.

### Low

**L1 — `chrome.downloads.show()` fired via `setTimeout(900)`**
`background.js:477` schedules the file-reveal 900 ms after the download
starts, but the MV3 service worker can be terminated in that window. On
large or slow downloads the reveal silently fails.

Fix: listen to `chrome.downloads.onChanged` for the `complete` state and
fire `show()` from the event.

**L2 — `storageQuotaLRU` not triggered when `diagnosticLog` is toggled off**
The LRU sweeper runs every 5 minutes; disabling diagnosticLog mid-session
leaves `_errors` in storage until the next sweep.

Fix: when `diagnosticLog` transitions to off, clear `_errors` and run a
single LRU pass.

---

## Infrastructure Additions (v3.14.0)

**`getSetting(key, default)`**
Null-safe reader over `appState.settings`. Replaces the scattered
`appState.settings.X || default` / `appState?.settings?.X ?? default` pattern
with a single choke point. Reduces the surface area for future settings-race
classes of bug.

**`selectorChain(selectors, { root, onMiss })`**
Tries each selector in order; returns the first matching element. If all
miss, calls `onMiss` (default: log once per session to `diagnosticLog`).
Adopted at the highest-churn YouTube DOM regions so drift is detected
without user reports.

Initial adoption sites:

- Chip cloud (`yt-chip-cloud-chip-renderer` → fallback chain)
- Related videos (`ytd-watch-next-secondary-results-renderer` → fallback)
- Macro-markers list (chapter extraction)

---

## False Positives — Already Mitigated

Documented so future audits don't re-raise these.

| Claim | Reality |
|-------|---------|
| Settings-init race: TIER 1 rAF runs before settings load | `await preloadExtensionState()` at `ytkit.js:364` completes before `main()` is called. `settingsManager.load()` is synchronous against the preloaded cache. |
| `DiagnosticLog.record()` crashes on early init | Guard `if (!appState?.settings) return;` exists at `ytkit.js:233`. |
| Theater-split `_chatWatcherObs` leaks on destroy | `destroy()` at `ytkit.js:7212` disconnects and nulls the observer. |
| Theater-split `_chatObs` local leaks | Scoped to a closure and cleared by a 10 s safety timeout at `ytkit.js:6454` plus cleanup at `ytkit.js:6423`. |
| Resume-playback `_saveInterval` orphans on SPA nav | `destroy()` at `ytkit.js:14944` clears the interval; `init()` at `ytkit.js:14935` guards against stacking. Same pattern at `ytkit.js:11818-11825` for watchProgress. |
| Video-hider click-listener stacking | `_processVideoElement()` early-returns if `.ytkit-video-hide-btn` already exists in the thumbnail (`ytkit.js:10284`), preventing duplicate listeners. |
| Options JSON textarea needs debounce | Import is file-based (`file.text()` at `options.js:691`), not a live textarea. |
| `apiRetryBackoff` doesn't retry on SW timeout | `extensionRequestAsync` rejects with `isTimeout` error (`ytkit.js:195`); `extensionRequestWithRetry` catches and retries (`ytkit.js:216-220`). |
| DeArrow `_pending` race on first concurrent call | `_pending: {}` is declared in the feature object at `ytkit.js:19181`, not lazy-initialized. |

---

## YouTube Platform Drift Watchlist — 2024/2025

Regions where YouTube has shipped visible DOM changes in the last 18 months.
These are where drift is most likely and where `selectorChain` protection is
most valuable.

1. **Masthead** — three class-rotation events in 2024-2025.
2. **Watch-next sidebar** — A/B tested carousel vs. stacked grid.
3. **Comments** — "Top comments" grouping introduced late 2025.
4. **Shorts reel renderer** — `ytd-reel-video-renderer` class churn.
5. **Player chrome** — "Cinematic lighting" overlay can conflict with
   `cinemaAmbientGlow`.
6. **Innertube client version** — already extracted dynamically; monitor
   for constant renames.

## MV3 Lifecycle Notes

- **Service worker keepalive**: MV3 terminates the SW after ~30 s idle.
  Long EXT_FETCH reads stream the body (keepalive), but TTFB pauses on
  cold endpoints can still kill it. `apiRetryBackoff` covers the retry
  case for features that care.
- **Long-running operations**: nothing in background.js currently holds
  state across SW restarts. All stateful work lives in the content script.

## Recommended Invariants

1. **Single cleanup path** — every `feature.init()` that creates an
   interval/timeout/observer/listener registers a matching teardown in
   `destroy()`. Audited: no feature in ytkit.js creates resources without
   a destroy path.
2. **`getSetting()` for all settings reads** (new in v3.14.0) — single
   null-safe choke point.
3. **`selectorChain()` for all high-churn DOM regions** (new in v3.14.0) —
   miss detection funnels into `diagnosticLog`.
4. **No silent catches without justification** — every `catch (_) {}`
   carries a `// reason:` comment or routes through `DebugManager.log()`.
5. **Profile import preserves `_settingsVersion`** — migration chain runs
   from the imported version forward, not from current.

## Release Plan

### v3.14.0 — Hardening Pass 4

- C1: Strengthened ReDoS guard
- C3: Migration-aware profile import
- C4: Empty catches routed through DebugManager or documented
- L1: `chrome.downloads.show` via `onChanged` event
- L2: `storageQuotaLRU` wired to `diagnosticLog` off toggle
- Infrastructure: `getSetting()` and `selectorChain()` helpers + adoption
  at 3 highest-churn regions

### Follow-ups (not shipped this release)

- ESLint custom rule flagging `catch (_) {}` without `// reason:`
- Feature-level init/destroy/init smoke tests for top 20 features
- `unlimitedStorage` permission decision (trade-off with store review)
- Firefox-specific `commands` shortcut remap (Firefox reserves
  `Ctrl+Shift+Y`)
- Broader `selectorChain` adoption across comments, masthead, player
  controls

---

## v3.15.0 — Hardening Pass 5 (repo-wide deep audit)

Pass 4 focused on the extension content script. Pass 5 expands to the
three surfaces it didn't cover: the Python Flask downloader, the
build/release pipeline, and the userscript build artifacts.

### New Real Issues (Addressed in v3.15.0)

#### Security — Astra Downloader

**S1 — DNS-rebinding vulnerability on the token-discovery path**
A webpage whose host is rebound to `127.0.0.1:9751` after load could send
a `fetch('/health')` with `X-MDL-Client: MediaDL`. The rebound request is
treated as same-origin by the browser, so the `Origin` header is omitted
— which the original handler treated as "no origin, return the token".
The token is local-machine IPC only, but disclosure enables the attacker
page to submit download requests and write files anywhere the server has
write access.

Fix: `before_request` hook rejects any request whose `Host` header isn't
`127.0.0.1`, `localhost`, or `::1` (with or without port). Browsers
always send the literal hostname the user navigated to in `Host`, so the
rebound request presents `Host: attacker.com` and is rejected with
`421 Misdirected Request`.

#### Reliability — Astra Downloader

**R1 — `_bootstrap()` swallowed every install failure**
The three pip strategies iterated through bare `except Exception`, so a
missing pip, blocked registry, or proxy error produced a cryptic
`ImportError: No module named 'PyQt6'` at line 43. No diagnostic for
the user.

Fix: typed exception handling — `FileNotFoundError` (no pip on PATH) short-
circuits; `CalledProcessError` preserves the exit code; other exceptions
preserve the class name. If all strategies fail, a pointed stderr message
lists the missing packages and the exact manual `pip install` command.

#### Link / Rebrand Hygiene

**H1 — 12 hardcoded `SysAdminDoc/YouTube-Kit` URLs**
The repo was renamed to `Astra-Deck` before v3.12.0 but several URLs
still pointed at the old path and relied on GitHub's redirect. The
repro-critical ones are userscript `@updateURL` / `@downloadURL` —
Tampermonkey and Violentmonkey cache these and update-check failures
when the redirect hiccuped meant stale userscripts in the wild.

Fix: migrated every non-archival reference — build-extension.js, sync-
userscript.js, both userscript headers, userscript runtime `INSTALLER_URL`
+ `INSTALLER_COMMAND` + GitHub link + nyan cat asset + installer .bat
emission, CONTRIBUTING.md, package-lock.json, the CI workflow artifact
name, and the repo-paths test.

#### CI Release Safety

**CI1 — Tag-version check only covered `manifest.json`**
A release could be tagged with a version that matched `manifest.json` but
disagreed with `ytkit.js` `YTKIT_VERSION` or the userscript `@version`,
shipping artifacts where internal version reporting disagreed with the
store listing.

Fix: workflow now verifies all four sources match the tag
(`manifest.json`, `extension/ytkit.js`, `YTKit.user.js`, `package.json`)
before artifacts are uploaded. Any drift fails the build with a specific
error pointing at which file is out of sync.

### New Test Coverage

- **Python** — 2 new tests: DNS rebinding rejection (3 attack hosts, 3
  legit hosts including IPv6), bootstrap failure stderr surfacing.
  Total: 15 pass.
- **JS** — 10 new tests in `tests/hardening.test.js` capturing v3.14.0
  invariants (ReDoS guard, profile-import migration, `selectorChain`
  helper + adoption, `getSetting`, `downloads.onChanged`, zero empty
  catches, `diagnosticLog` destroy clearing). Total: 47 pass.

### Residual Trust Boundaries (documented, not bugs)

- **`/download` endpoint** accepts a client-supplied `outputDir`. The
  extension is trusted; any authenticated request can create directories
  and drop files anywhere the server user has write access. This is the
  intentional trust model for the local helper. If the extension is
  ever compromised, this boundary becomes the attack surface — consider
  gating `outputDir` to a config-allowed list in a future pass.
- **Protocol handlers (`ytdl://`, `mediadl://`)** launch the installed
  executable with a URL argument. The URL is passed as a single argv
  element (no shell), so command injection is not possible, but the
  target exe receives attacker-controlled input and must defend itself.

### Follow-ups (Pass 6 candidates)

- `outputDir` allowlist for `/download` (see residual boundary above).
- Rate limiting on `/download` to prevent runaway queueing from a
  compromised extension (currently gated only by `MAX_CONCURRENT=3`).
- CORS preflight cache headers (`Access-Control-Max-Age`) to reduce
  round-trips.
- Werkzeug → Waitress / Hypercorn (production WSGI) — currently running
  werkzeug dev server, which is acceptable for localhost-only but
  noted in werkzeug's own docs as not production-grade.
- Userscript parity audit — ensure the standalone `YTKit.user.js` has
  v3.14.0 hardening ported (most fixes are in the extension build only).

---

## v1.2.0 — Hardening Pass 6 (Astra Downloader companion)

Pass 6 is scoped to the Python/Flask companion (`astra_downloader.py`) and
its first-run setup. Five Pass 5 follow-ups landed in this release plus a
batch of new findings around trust on the yt-dlp / ffmpeg install path and
the install-day UX. The extension side is unchanged; `/health` gains three
additive fields but the wire contract is backward-compatible (older builds
ignore unknown keys).

### New Real Issues (Addressed in v1.2.0)

#### Security — Astra Downloader

**S1 — `outputDir` accepted any absolute path (Pass 5 follow-up)**
The `/download` endpoint passed a client-supplied `outputDir` straight into
`normalize_output_dir`, which called `mkdir(parents=True, exist_ok=True)`
on whatever it received and then let yt-dlp write there. A compromised
extension context or malicious content script running with extension
privileges could drop files anywhere the server user had write access —
the service runs as a normal user, but that's still home dir, Documents,
the Downloads folder, anywhere the user's profile can reach.

Fix: `normalize_output_dir` now takes an optional `allowed_roots`
argument; when supplied, the resolved path must sit inside one of those
roots or the request is rejected with 400 *before* `mkdir` runs. The
`/download` handler always enforces confinement when the client supplies
`outputDir`; it skips the check when the server falls back to its
configured defaults (those are always inside the allowlist by
construction, and skipping avoids a chicken-and-egg on first run). Users
who want a wider set of roots without widening `DownloadPath` itself can
add them via the new `ExtraOutputRoots` config list.

**S2 — No rate limit on `/download` (Pass 5 follow-up)**
`MAX_CONCURRENT=3` gated *running* jobs, but the HTTP endpoint itself had
no throughput ceiling. A compromised extension could POST 10k
`/download` requests per second, spending CPU on URL / cookie / path
normalization for every one. Each rejected request still ran through the
sanitize pipeline, so rejection didn't bound the cost.

Fix: token-bucket sliding window (`RateLimiter`, 30 req / 60 s by
default). Burst budget is far above what a real user can produce but
clamps a runaway client. Rejection runs early (after auth, before body
parsing) so CPU stays flat under attack. 429 responses include a
`Retry-After` header.

**S3 — First-run binaries not checksum-verified**
`SetupWorker` pulled `yt-dlp.exe` and the ffmpeg zip over TLS from GitHub
but never verified them against the release SHA-256 sidecars. Both
upstreams ship per-release checksums; a TLS-stripping proxy, a corrupted
cached copy at a CDN edge, or an incomplete download could install a
poisoned or broken binary that then executes with user privileges for
every subsequent download.

Fix: `verify_file_sha256` + `fetch_expected_sha256`. The setup worker
fetches the sidecar from the same release the binary came from, verifies
the SHA-256, and hard-fails the install on mismatch (the downloaded
file is unlinked before the error bubbles up, so the next retry
re-fetches). If the sidecar itself is 404 / rate-limited / unreachable,
we soft-fail (log + continue) so a sidecar outage doesn't block a
legitimate install. The "Reinstall ffmpeg" button in Settings →
Tools re-runs the same verified download path.

#### Reliability — Astra Downloader

**R1 — Werkzeug dev server in production (Pass 5 follow-up)**
werkzeug's own documentation warns that `make_server` / `serve_forever`
is a development server; acceptable on localhost but without the thread
pool, graceful drain, or graceful shutdown that a real WSGI needs.

Fix: switched to `waitress` (production-grade, battle-tested, single
wheel dependency) via a `_ServerAdapter` shim that presents a uniform
`run()` / `stop()` over both backends. Werkzeug is retained only as a
fallback when waitress isn't installed (legacy source runs, test
containers). The server start log now reports which backend is active.

**R2 — CORS preflight re-negotiated on every POST (Pass 5 follow-up)**
Every `POST /download` previously triggered a fresh `OPTIONS` preflight
because the server returned no `Access-Control-Max-Age`.

Fix: `cors_response()` now sets `Access-Control-Max-Age: 600`. Multi-
video sessions cut their preflight round-trips to once per 10 min.

**R3 — yt-dlp auto-update fired on every launch**
`AutoUpdateYtDlp` ran `yt-dlp.exe -U` every time the server started,
captured no exit code, and logged nothing. Update-check failures were
invisible until downloads silently regressed.

Fix: new `LastYtDlpUpdateCheck` config stamp gates the update to at most
once per 24 h; `maybe_auto_update_ytdlp()` runs it in a daemon thread
with a 2-minute timeout and logs the exit code + captured stdout/stderr
on both success and failure. Invalidates the `/health` version cache
on success so `/health` reports the new version within a minute.

**R4 — Orphan cookie jars leaked session credentials across crashes**
The per-download `.cookies.{id}.txt` files are cleaned in the `_run_download`
`finally` block, but that doesn't run if the server is killed with
`taskkill /F` or the host loses power mid-download. The jars accumulated
in `INSTALL_DIR` indefinitely, each holding a live YouTube session.

Fix: `cleanup_stale_cookie_jars()` sweeps any `.cookies.*.txt` older
than 5 minutes from `INSTALL_DIR` when the `DownloadManager` is
constructed. The 5-minute horizon is long enough that no legitimate
download-in-flight gets its jar stolen (running downloads refresh the
mtime by being open; new downloads are <5 min old by definition).

**R5 — `ensure_system_integrations()` ran on every launch**
Shortcut registration, the `schtasks /Create` call, protocol handler
writes, and the Apps-&-Features entry all re-fired on every launch of
the frozen exe. That spawned a PowerShell process + 3 `winreg` writes
+ a `schtasks.exe` invocation just to reconfirm state that hadn't
changed. Adds ~100 ms and a visible window flash on some Windows setups.

Fix: `HKCU\Software\Classes\AstraDownloader\IntegrationsVersion` stamp.
`ensure_system_integrations()` now short-circuits when the stamp equals
`APP_VERSION`. Force re-registration is available via `force=True`
(used after setup). Uninstall removes the stamp.

#### UX — Astra Downloader

**U1 — ffmpeg download had no byte-level progress**
The setup progress bar jumped 35 → 60 once the zip finished downloading,
which took a minute or more on slow connections with zero intermediate
feedback.

Fix: `download_file_atomic` now accepts a `progress_cb`; `SetupWorker`
passes a callback that maps downloaded bytes into the [35, 55] range of
the overall setup bar. Throttled to ~10 Hz so fast connections don't
flood the Qt event loop. Same helper is available to other callers
(icon download, future ffmpeg reinstall flows).

**U2 — Version readouts and tool maintenance moved to Settings**
Users had no in-app way to see which yt-dlp / ffmpeg they were running
or to force a yt-dlp update or reinstall ffmpeg. Both were only
reachable by poking at `%LOCALAPPDATA%\AstraDownloader` directly.

Fix: new Settings → Tools section showing live version strings plus
"Check yt-dlp Update" (runs `-U`, logs the result, refreshes the
version cache) and "Reinstall ffmpeg" (unlinks the current binary and
re-runs the verified download path). `/health` exposes the same
version strings so the extension's install/retry prompt can show them.

**U3 — JSON-parsed yt-dlp progress**
The existing MDLP regex on yt-dlp stdout still works but was fragile to
upstream format tweaks. Added a parallel JSON progress template
(`MDLP_JSON %(progress)j`) that emits the full progress dict; the
parser tries JSON first and falls back to the legacy regex on parse
failure. No behavioral change in the success path — just insulation
against yt-dlp drift.

### New Config Fields

| Key | Default | Purpose |
|-----|---------|---------|
| `LastYtDlpUpdateCheck` | `""` | ISO-ish timestamp of last yt-dlp `-U`. Gates the 24h throttle. |
| `LastFfmpegCheck` | `""` | Monthly ffmpeg refresh nag timestamp (reserved for future use). |
| `ExtraOutputRoots` | `[]` | Additional directories that may be passed as `outputDir` by the extension. |

### Wire Contract — `/health` Additions

```json
{
  "ytDlpVersion": "2026.04.01",
  "ffmpegVersion": "n7.0",
  "rateLimit": { "downloadMaxPerWindow": 30, "downloadWindowSeconds": 60 }
}
```

All three keys are optional in the extension's `_isAstraDownloaderHealth`
check; older builds ignore them.

### New Test Coverage

- `PathConfinementTests` (3) — allowlist accepts subfolders, rejects
  outside paths, rejects `..` traversal.
- `RateLimiterTests` (2) — exhausts window + separate-key isolation.
- `Sha256VerifyTests` (5) — match / mismatch / malformed sidecar /
  multi-asset parsing / single-line sidecar.
- `CookieJarSweepTests` (1) — stale jars removed, fresh jars + unrelated
  files preserved.
- `ApiRateLimitTests` (1) — end-to-end 429 via Flask test client.
- `CorsHeaderTests` (1) — `Access-Control-Max-Age` present on /health.
- `HealthAdditionsTests` (1) — new /health keys present.
- `AutoUpdateThrottleTests` (3) — no stamp → check / recent stamp → skip /
  corrupt stamp → check.

Python: 37 pass (was 19). JS: 81 pass (unchanged).

### Residual Trust Boundaries (still documented, still not bugs)

- **Protocol handlers (`ytdl://`, `mediadl://`)** — unchanged trust
  boundary. Single argv element, no shell. URL is attacker-controlled
  input that the app must validate before acting on.
- **yt-dlp executes with user privileges** — hardened by SHA-256
  verification at install time but not at run time. yt-dlp self-updates
  via `-U`; those updates are not re-verified. Upstream signs its
  updates internally (the `-U` path fetches + checksums).

### Follow-ups (Pass 7 candidates)

- Extend S3 to the yt-dlp `-U` self-update path — currently trusts
  yt-dlp's own update chain; we could cross-verify after it completes.
- Extension-side UI to show `/health.ytDlpVersion` in the repair prompt
  (the field is there, no consumer yet).
- Monthly ffmpeg freshness nag using `LastFfmpegCheck` (reserved but
  not yet wired to UI).
- Optional per-download output confinement log entry for defense-in-
  depth auditing.

---

## Hardening Pass 7 (v3.20.0 — 2026-04-24)

Audit-only release. Closes three of the six audit-pass open items from
2026-04-23 plus two platform-drift fixes (storage ceiling, Firefox
shortcut). No new features.

### Real Issues

**P7-C1 — `_pendingReveals` in-memory only across MV3 SW restarts**
`background.js#_pendingReveals` was a `const Set()`. When the user
queued a download with `showInFolder: true`, the id was added to the
Set; the `chrome.downloads.onChanged` listener then fired
`chrome.downloads.show(id)` on the `state.complete` transition. If
the MV3 service worker went idle between those two events (normal on
slow networks or when other extension work isn't keeping it alive),
the Set was recreated fresh on SW restart and the `.has(id)` check
returned false — silently dropping the reveal.

Fix: mirror writes into `chrome.storage.session` (MV3-only, survives
SW restart, cleared on browser restart — correct semantics for a
transient reveal intent). `_pendingRevealsReady` is a module-level
hydration promise awaited by the onChanged listener so a reveal
queued before a cold-start is still honoured when the event arrives.

Regression: `tests/hardening.test.js` →
`_pendingReveals is mirrored to chrome.storage.session for SW-restart survival`.

**P7-C2 — `astra_downloader._run_download` dead regex assignment**
Line 1613 had `m = re.search(r'\[download\] Downloading video (?:\d+ of \d+|\d+)', line)` — assigned but never read. Harmless, but masked
whether title detection was intentional or vestigial.

Fix: deleted the match. Filename detection (Merger merge target +
`[download] Destination: …`) keeps its matches; everything else
continues through the existing progress-parsing loop.

Regression: `_run_download no longer contains the dead "Downloading video" regex match`.

### Platform Drift / UX

**P7-D1 — `chrome.storage.local` 10 MB ceiling with no release valve**
`storageQuotaLRU` (Pass 1) trims hot caches on a 5-minute cadence but
cannot prevent steady-state growth from outpacing LRU eviction (long
watch-history windows, large DeArrow caches, diagnostic error
ring-buffer spikes).

Fix: declared `"unlimitedStorage"` in `manifest.permissions`.
Zero-risk — only effect is raising the storage.local ceiling. LRU is
retained so normal usage stays well under typical user-profile disk
budgets.

Regression: `manifest declares unlimitedStorage to exceed the 10 MB default quota`.

**P7-D2 — Firefox `Ctrl+Shift+Y` collision**
Firefox reserves `Ctrl+Shift+Y` for "Show Downloads". Since Astra
Deck's manifest declared the same key for `toggle-control-center`, no
command fired on Firefox (the browser-level binding won). MV3
`commands` can't branch per vendor, so the fix has to happen at
build-manifest-patch time.

Fix: `build-extension.js` Firefox patch now also rewrites
`ffManifest.commands['toggle-control-center'].suggested_key.default`
to `Ctrl+Alt+Y`. The patch is guarded on the Chrome-side default so
a future Chrome-side remap stays idempotent. Chrome manifest
unchanged.

Regression: `Firefox build rewrites Ctrl+Shift+Y (reserved by Firefox Downloads) to Ctrl+Alt+Y`.

### Still Open (deferred to Pass 8)

- **SponsorBlock POI category semantics** — `poi_highlight` segments
  still get the skip treatment (`currentTime = end`) rather than
  jump-to-marker treatment. Mitigated by the zero-length segment
  filter dropping most of them on arrival; only matters if the
  category is ever re-enabled by default.
- **`ytkit.js` monolith uncovered paths** — DeArrow cache lifetime,
  theater-split cleanup on fast SPA navigations, Wave-8/9 restored
  features. Per-area audits rather than another whole-file pass.
- **Extension cookie `expirationDate || 0` fragility** — correct for
  the current Netscape-format server-side writer; flagged for
  re-review if the cookie wire format ever changes.

---

## Hardening Pass 8 (v3.20.1 — 2026-04-24)

Audit-only follow-up to Pass 7. Closes the two remaining roadmap
audit-pass items that had concrete, bounded fixes; leaves the
`ytkit.js` monolith audit and the extension-cookie expiration
fragility open (both are watchlist items, not active bugs).

### Real Issues (addressed in this pass)

**P8-1 — `_pendingReveals` had no prune path for erased downloads** (LOW security finding)
Pass 7's session-mirror guaranteed reveals survived a service-worker
restart, but an id could still outlive the download it referenced.
Specifically, if the user cancelled + erased a download (or crash
recovery wiped the row) before the download reached
`state.complete` / `state.interrupted`, the id stayed in both the
in-memory `Set` and the session mirror forever. Over a long browser
session with many interrupted downloads, the Set grew
unboundedly — bounded by session lifetime but not by anything
stronger.

Fix: new `chrome.downloads.onErased` listener that awaits the same
`_pendingRevealsReady` hydration promise as `onChanged`, calls
`_pendingReveals.delete(downloadId)`, and persists the delete via
`_persistPendingReveals()`. `Set.delete` is idempotent, so a normal
complete → erase sequence is a safe no-op on the second fire.
Listener is guarded behind `chrome.downloads?.onErased?.addListener`
so older Firefox builds (which didn't ship `onErased` until
129+) don't throw at load time.

Regression: `_pendingReveals is pruned when a tracked download is erased from history`.

**P8-2 — SponsorBlock `poi_highlight` auto-skipped instead of rendering as marker** (correctness)
The SponsorBlock API defines `poi_highlight` as a jump-to highlight
reference (the user can seek TO it), not a segment to skip PAST.
Both `sponsorBlock._checkSkip()` and `sponsorBlock._scheduleNextSkip()`
iterated the category list and treated every segment the same way:
if `currentTime >= start && currentTime < end - 0.3` set
`video.currentTime = end`. A user who enabled `sbCat_poi_highlight`
from the settings UI (off by default) would find the player
fast-forwarding past every highlight marker — exactly the opposite
of what the category is for.

Fix: both methods now `continue` past any segment whose `category`
is `poi_highlight`. The progress-bar renderer (`_renderBarSegments`)
is untouched and continues to paint the marker in its existing
`#ff1684` colour.

Mitigations that were already in place (and remain): zero-length
segments are rejected on ingest, the category is off by default,
and the enabled-category allowlist controls whether any logic
fires at all.

Regression: `SponsorBlock never auto-skips poi_highlight (API contract: marker, not skip)`.

### Still Open (deferred to Pass 9)

- **`ytkit.js` monolith uncovered paths** — DeArrow cache lifetime,
  theater-split cleanup on fast SPA navigations, Wave-8/9 restored
  features. Per-area audits rather than another whole-file pass.
- **Extension cookie `expirationDate || 0` fragility** — correct for
  the current Netscape-format server-side writer; flagged for
  re-review if the cookie wire format ever changes.

## Ongoing Hardening (Unreleased)

### H1 — TrustedTypes createPolicy failures are now observable

`extension/ytkit.js` formerly swallowed `createPolicy('ytkit-policy', …)`
throws in a silent catch block. Peer-extension collisions on the
policy name and CSP-forbidden policy creation were therefore invisible
in the field: the userscript fell back to DOMParser with no signal in
the diagnostic ring buffer.

The fallback reason is now captured at IIFE init and lazy-logged to
`DiagnosticLog` on the first `setHTML`/`create` call (after
`appState.settings` has loaded so `DiagnosticLog.record` is safe).
Two distinct tags make field logs diagnosable:

- `TT_UNAVAILABLE` — TrustedTypes API missing entirely (Firefox, older
  browsers).
- `TT_POLICY_FAIL: <ErrorName>: <message>` — `createPolicy` threw,
  either because another extension already claimed `'ytkit-policy'`
  or because CSP on the page disallows policy creation. `http(s)://`
  URLs in the error message are redacted to `<url>` before logging
  so diagnostic dumps do not leak page context.

The DOMParser + `replaceChildren()` fallback path is unchanged. Four
regressions in `tests/hardening.test.js` pin the observability
behaviour.

### H2 — Python dependency upper-major bounds

`astra_downloader/requirements.txt` now carries both lower and upper
bounds on every dep:

```
PyQt6>=6.6.0,<7
flask>=3.0.0,<4
requests>=2.31.0,<3
waitress>=3.0.0,<4
```

The downloader ships as a PyInstaller-frozen exe to users, but the
repo's own test/dev workflow resolves against whatever `pip install
-r requirements.txt` returns at that moment. Without upper bounds a
silent major-version bump (PyQt7, Flask 4.x, requests 3, waitress 4)
would surface first on a contributor's machine or in CI, never
having run against the downloader's tests. The bounds keep the
resolver inside the majors we have exercised; patch + minor bumps
still flow in automatically.

Rationale for the specific caps:

- **PyQt6<7** — Qt 7 is the next major binding rewrite; API breakage
  on signal/slot/QVariant is likely.
- **flask<4** — Flask's async handler surface has been churning;
  a major bump on a frozen companion app is not a place to discover
  that.
- **requests<3** — requests 3 is planned to drop chardet + shift to
  urllib3 2.x defaults; needs a deliberate migration pass.
- **waitress<4** — Waitress is a WSGI server; a major bump on a
  localhost listener is not worth absorbing without review.

### H3 — Selector-drift canary via MHTML token signatures

YouTube rolls out A/B selector renames without notice. Previously
the only signal was a user-filed bug "feature X stopped working."
The `mhtml/` directory has held reference snapshots of the home and
watch pages for a while but wasn't wired into tests. v3.20.x lights
them up as a regression canary.

- `scripts/build-selector-fixtures.js` decodes the quoted-printable
  HTML body out of each `mhtml/*.mhtml` capture (the raw 5 MB files
  are gitignored) and writes one token signature per page to
  `tests/fixtures/*.tokens.txt`. Tokens harvested: `ytd-*`, `ytp-*`,
  `yt-*`, `html5-*`, `movie_player`, and a handful of YT layout ids
  (`primary`, `secondary`, `contents`, `masthead-container`).
- `tests/selector-regression.test.js` maintains a 9-entry list of
  critical selectors (layout, player, feed grid, comments) and
  asserts each one appears in BOTH the fixture signatures AND
  `extension/ytkit.js`. The two-sided assertion catches both
  YouTube-side renames (when the fixture is refreshed and the
  selector drops) and our-side refactor loss (when ytkit.js stops
  referencing a selector we still canary).
- Refresh cycle: when YouTube A/B drift is suspected, recapture
  `mhtml/YouTube.mhtml` + `mhtml/WatchPage.mhtml` via Chrome
  "Save As → Webpage, Single File", then run
  `npm run build:fixtures` and commit the updated token files. The
  diff shows exactly which selectors entered/left YouTube's DOM
  since the last refresh.

### H4 — Popup surfaces the TrustedTypes diagnostic signal

H1 captured `TT_POLICY_FAIL` / `TT_UNAVAILABLE` in the diagnostic ring
buffer but the signal was only visible to users who deliberately
dumped the full diagnostic JSON. That meant a peer-extension
policy-name collision would silently degrade the userscript and
never surface in a bug report.

The toolbar popup now reads `ytSuiteSettings._errors` on render,
filters entries tagged `ctx === 'trusted-types'`, and paints a
conditional warning-toned banner between the storage grid and the
data-management actions row. The banner stays `hidden` on the happy
path; when ≥1 event exists it shows the event count and the latest
(already URL-redacted) reason message. A Copy button drops a
structured payload on the clipboard — event count, ISO timestamp of
the latest event, and the reason string — so a user filing a bug
report pastes the precise reason code instead of "something broke."

Implementation details:

- Banner element is `role="status"` with `aria-live="polite"` so
  screen readers announce it non-intrusively when it materializes.
- `healthCopyPayload` is reset to the empty string on every null /
  zero-count render, so a stale payload can never reach the
  clipboard on a later click.
- Clipboard fallback logs the payload to the console if
  `navigator.clipboard.writeText` throws (e.g. popup loaded over
  `file://` during development).
- Amber palette (not red) — this is a "fallback active" notice,
  not a destructive state. Existing features continue to work via
  the DOMParser path.

Four regressions in `tests/hardening.test.js` pin the HTML scaffold,
the `ctx === 'trusted-types'` filter predicate, the hidden-on-empty
guard (including payload reset), and the CSS + focus-visible
coverage for the Copy button.

### H5 — storageQuotaLRU swept a nonexistent key for a year

The `storageQuotaLRU` feature's cap list included
`['deArrowCache', 1000]`, iterated against
`appState.settings.deArrowCache`. That key has never existed —
DeArrow's branding cache is stored under the top-level
`chrome.storage.local` key `da_branding_cache`, written via
`storageWriteJSON('da_branding_cache', …)`, not inside the
settings object. The cap never matched anything regardless of
whether DeArrow was running.

Dead code by itself is a readability problem. Worse, the feature
description claimed to cover "deArrowCache," misleading anyone
auditing the quota story into thinking DeArrow's persisted cache
was bounded by the voluntary LRU sweep. It was — by DeArrow's own
`_schedulePersist` which caps at 2000 on every write — but the
external sweep was doing nothing.

Fix:

- Remove the dead `['deArrowCache', 1000]` entry from the in-settings
  cap list.
- Add a belt-and-suspenders sweep on the real `da_branding_cache`
  top-level key: read via `storageReadJSON`, sort entries by
  descending `_ts`, slice to 2000 most-recent, write back via
  `storageWriteJSON`. Triggers only when the on-disk set has
  drifted past 2000 entries (shouldn't happen under DeArrow's own
  cap, but catches any future regression that skips the persist
  path).
- Update the feature description to name `da_branding_cache` so a
  user auditing the quota feature sees what actually gets swept.

Two regressions in `tests/hardening.test.js` pin the absence of the
dead reference AND the presence of the real-key sweep.

### H6 — Cookie-jar wire contract is now explicit

Three sites previously inlined the cookie-expiry coercion as
`expirationDate: c.expirationDate || 0`:

- `extension/ytkit.js` (MediaDL cookie mapper, near line 2633)
- `extension/background.js` (`EXT_COOKIE_LIST` handler, near line 620)
- `YTKit.user.js` (GM_cookie fallback, near line 1851)

The wire contract — "send 0 for session cookies; send a positive
Number of seconds since epoch for persistent cookies" — was implicit:
JavaScript truthiness happened to coerce `null`, `undefined`,
negative numbers, and non-numeric strings to 0 because all of those
are falsy. Three problems with that:

1. The wire format is not documented in code; a future reader has
   to deduce it from JS truthiness rules.
2. `Number.isFinite(NaN)` is false, but `NaN || 0` returns `0`. Both
   land at the same wire value but the path is opaque.
3. If a future Chrome cookies API returns `expirationDate` as an
   ISO 8601 string (not currently planned, but not impossible),
   `'2026-01-01T00:00:00Z' || 0` evaluates to the truthy string and
   ships it raw to the Python side, which would then `int(float(…))`
   and throw. Defaulting to 0 on parse failure is the right behaviour
   but the code didn't show that.

Fix: a single named helper, defined in all three files (kept inline
rather than via shared module — extension/core/ is ISOLATED-world
only; userscript build pipeline doesn't import from core/):

```js
function normalizeCookieExpiry(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
}
```

Wire contract documented in the function name, the inline comment,
and the regression tests. The Python downloader at
`astra_downloader/astra_downloader.py:830-838` already implements
the matching defensive parsing; the existing
`test_dns_rebinding_attack_is_rejected_before_handler`-adjacent
tests at `test_astra_downloader.py:333-335` cover bogus-string and
negative-int inputs.

Three regressions in `tests/hardening.test.js`:

- The function is parsed out of each file via `Function()` and
  exercised against 15 input shapes (undefined, null, 0, positive
  int, positive float, negative int/float, NaN, ±Infinity, empty
  string, "bogus", numeric string, true, false). Output must match
  across all three sites — drift = test failure.
- The legacy `c.expirationDate || 0` literal must not appear at any
  cookie-mapper site.
- The JS output must round-trip through Python's `int(float(x))`
  truncation without value drift.

### H7 — Selector-drift canary widened to 18 selectors

H3 launched the canary with 9 critical selectors. Iter-3 research
(YouTube DOM-fingerprinting + server-side ad-injection arms race
escalating; selector-churn cadence moving from quarterly to weekly)
made the case for wider coverage.

Added 9 new selectors (already present in BOTH the watch + home
fixture token sets AND `extension/ytkit.js` source — verified before
adoption):

- Layout: `ytd-watch-metadata`, `ytd-comments`
- Player chrome / controls: `ytp-play-button`, `ytp-settings-button`,
  `ytp-fullscreen-button`, `ytp-time-display`
- Comments — new DOM shape: `ytd-comment-view-model` (alongside
  the existing `ytd-comment-thread-renderer`; YouTube ships both
  during the A/B period)
- Text rendering wrappers: `yt-formatted-string` (older shape, still
  widely used), `yt-attributed-string` (newer shape, recurring
  rewrite target — broke comment-text selection in v1.0.6)

The two-sided assertion (selector present in BOTH the fixtures AND
ytkit.js) catches:

- YouTube renaming a selector — fixture refresh drops it, test
  fails on the fixture side.
- Internal refactor losing a reference — test fails on the source
  side.

Refresh procedure unchanged from H3: recapture
`mhtml/YouTube.mhtml` + `mhtml/WatchPage.mhtml`, then
`npm run build:fixtures`, then commit the regenerated
`tests/fixtures/*.tokens.txt`. The diff shows exactly which
selectors entered or left the YouTube DOM since the last refresh.

### H8 — theater-split divider drag survives SPA navigation (v1.0.7)

The `theater-split.user.js` divider-drag handler attached
`mousemove` and `mouseup` listeners to `window` and a
position:fixed shield element to `document.body`. The only cleanup
path was the `mouseup` handler — but if a `yt-navigate-finish`
event fired between mousedown and mouseup (URL bar nav, browser
back, keyboard shortcut to next video), `teardown()` would remove
the splitWrapper while leaving the window listeners and the
dragShield orphaned. Those listeners would keep firing closures
over the disposed wrapper for the rest of the session, holding
references to GC'd DOM nodes.

Likelihood is low (requires the user to be mid-drag during the
navigation event), but the consequence — listeners that never
clean up until tab close — was a long-running memory leak.

Fix:

- Hoist `dragShield`, `dragOnMove`, `dragOnUp` to module-scope
  state vars in the same block where `splitWrapper`,
  `playerResizeObs`, `chatObserver`, etc. already live. This is
  the same pattern the rest of the userscript uses — closure-local
  state was the outlier.
- Add an idempotent `abortDividerDrag()` helper that removes the
  shield (try/catch in case it was already detached), removes the
  window listeners, and resets `cursor` / `userSelect` on
  `document.body`.
- Call `abortDividerDrag()` from `teardown()` so SPA-nav mid-drag
  is clean.
- Defensively pre-call from the `mousedown` handler so a re-entrant
  mousedown (rare — would require a browser bug or extension
  conflict) cannot stack listeners.

Theater Split userscript header bumped to v1.0.7. Three regressions
in `tests/hardening.test.js` pin: the version bump + helper +
hoisted state, the `teardown` → `abortDividerDrag` call, and the
mousedown defensive pre-clear.

### H9 — EXT_FETCH controller.abort() consistency on size-limit early returns

The EXT_FETCH proxy in `extension/background.js` has five
"responded = true; sendResponse(...); return" paths in the success
branch:

1. Timeout fires and the timer aborts the controller.
2. Redirect lands on a non-allowlisted origin → `controller.abort()`.
3. Declared content-length exceeds `MAX_RESPONSE_BYTES` → `controller.abort()`.
4. Streamed body exceeds the limit while reading → `reader.cancel()` only.
5. Non-streaming body exceeds the limit after measuring → no abort, no cancel.

Paths (4) and (5) leaked: we'd already responded to the content
script with "too large", but the SW kept reading bytes off the wire
until natural EOF. Wasted bandwidth; wasted SW lifetime under MV3's
30 s idle clock; a malicious upstream could keep the SW alive
indefinitely by trickling bytes after the cap.

`reader.cancel()` closes the reader but does not always tear down
the underlying network request — the spec leaves the behaviour to
the underlying Source. `controller.abort()` is the authoritative
signal that the request is done.

Fix: every "too large" early-return now calls `controller.abort()`
in addition to whatever else (reader.cancel, response.error path).
The four catches are wrapped in try/catch because the controller
may already be aborted by the timeout path.

One regression in `tests/hardening.test.js` counts the `abort()`
call sites in the EXT_FETCH handler (≥5 expected) and pins both
the streamed-too-large block and the non-streaming-too-large block
explicitly.

### H10 — `npm run check` catches pre-push version-string drift

The Build & Release workflow validates that the four canonical
version strings — `package.json#version`,
`extension/manifest.json#version`,
`extension/ytkit.js#YTKIT_VERSION`, and
`YTKit.user.js#@version` — all match the pushed tag. That gate
fires AFTER the tag has landed on remote. A developer who bumps
three of four locally and forgets to run `node sync-userscript.js`
will ship the drift to GitHub and watch CI fail post-tag.

`scripts/check-versions.js` ports the same comparison to local-
side. On the happy path it prints `[check-versions] All 4 sources
agree at v<...>` and exits 0. On drift it prints every source's
value side-by-side, a remediation hint pointing at
`node sync-userscript.js`, and exits 1.

Wired into `npm run check` so `npm test && npm run check` is now
sufficient pre-push. Also exposed standalone as
`npm run check:versions` for tight CI/dev loops.

A subtle implementation note pinned by a regression test: the
"all sources match" guard uses `sources[0].value !== ''` instead
of `!sources[0].value.includes('')`. The latter would always
evaluate true (every string contains the empty substring) and
would silently break the happy path — a draft-stage bug caught by
running the script before shipping. The test exists so a future
refactor can't regress it.

Two regressions in `tests/hardening.test.js`:

- The script exists, reads all four canonical sources, is wired
  into `npm run check`, and uses the correct empty-string guard.
- `execFileSync` against the current tree — if any source has
  drifted, this test fails before any other test runs.

### H11 — Settings import migration + popup dialog semantics

Two roadmap items shipped together because they both touch the toolbar
popup, which is the only extension-surface settings UI after v3.19.0.

**N1: profile-import migration.** The popup import path wrote imported
settings directly to `ytSuiteSettings`; the in-page settings manager did
the same through `importAllSettings()`. Both paths preserved only safe
object keys, but neither ran the `_settingsVersion` migration chain
before stamping the current schema. A profile exported before v6 could
therefore skip migrations for added/retired settings until a later load
path happened to repair it.

Fix:

- `extension/ytkit.js` now routes imported settings through
  `_prepareImportedSettings()`, which sanitizes, runs `_migrate(...,
  'profile-import')`, merges over current defaults, and stamps
  `_settingsVersion` only after migration.
- `extension/popup.js` now reads generated `default-settings.json` and
  `settings-meta.json` before import, applies the same migration steps
  locally, restores missing defaults, strips retired settings, and writes
  the migrated result in one storage update.
- Every migration step appends a small `ctx: 'settings-migration'`
  diagnostic entry. Future-version imports preserve safe unknown fields
  while clamping local schema metadata to the current build so later
  upgrades do not skip migrations.

**N3: popup modal semantics and focus management.** Chrome extension
popups are browser-hosted windows, but the DOM still needs the same
keyboard contract expected of a modal surface: a named dialog root,
initial focus inside the popup, Tab/Shift-Tab containment, and Escape
close. The popup already had visible focus styling and an aria-live
health banner; it lacked the root semantics and trap.

Fix:

- `extension/popup.html` sets `role="dialog"`,
  `aria-modal="true"`, and `aria-labelledby="popup-title"` on the
  popup body.
- `extension/popup.js` installs one dialog-level key handler. It moves
  initial focus to the first visible control after render, wraps Tab
  from the last control to the first, wraps Shift-Tab from the first
  control to the last, delegates to the nested confirmation dialog when
  it is open, and closes the popup on Escape when no nested control has
  handled the key.

Two regressions in `tests/hardening.test.js` pin the import migration
contract and the popup dialog/focus contract. `node --test
tests/hardening.test.js` reports 47/47 passing for this pass.

### H12 — Profile import migration round-trip fixtures

Pass 12 fixed the import path. This pass pins the behavior with
executable fixtures so a future settings-schema edit cannot silently
skip an older profile.

`tests/fixtures/settings-import-roundtrip.json` now contains one
known-shape settings profile for every historical schema before the
current v6 schema. The fixtures include user-overridden settings,
settings added by prior migrations, retired Auto Quality keys, safe
unknown fields that must survive forward, and unsafe object keys that
must be rejected.

`tests/settings-migration-roundtrip.test.js` extracts the real
`settingsManager` object from `extension/ytkit.js` with the same
brace-balanced helper used by the build catalog tests, then executes
`_prepareImportedSettings()` against each fixture. The test asserts:

- every generated default setting exists after import;
- v1-v2 profiles receive `hidePinnedComments` and
  `autoExpandComments` through the migration chain;
- v3+ user choices remain preserved when those settings already
  existed in the imported schema;
- retired keys (`preferredQuality`, `useEnhancedBitrate`,
  `hideQualityPopup`) and unsafe object keys are absent;
- every migration step emits both stored `_errors` diagnostics and
  `DiagnosticLog.record('settings-migration', ...)`;
- re-importing the migrated profile is idempotent.

`node --test tests/settings-migration-roundtrip.test.js` reports 1/1
passing for this pass.

### H13 — SponsorBlock segment cache + stale fallback

SponsorBlock previously depended on a fresh API response for every
video. That was correct when online, but a transient 5xx, timeout, or
offline session meant existing segment knowledge was discarded and the
seekbar had no continuity. NX3 keeps the current behavior on a healthy
network while making failure states recoverable.

`extension/ytkit.js` now stores normalized SponsorBlock segments under
the top-level `sb_segments_cache` key. Fresh entries are reused for
12 hours. Entries older than 12 hours but younger than 7 days are
eligible only when the network fetch fails, and that path emits a
`DiagnosticLog` breadcrumb so field reports can distinguish API failure
from "no segments exist".

The cache is intentionally conservative:

- It is keyed by videoId and the enabled category set used for the
  request. A cached entry is only reused when it covers the currently
  enabled categories.
- Segment payloads are normalized before storage and again before
  rendering so malformed times, negative spans, and missing categories
  cannot leak into skip logic.
- The in-memory cache is flushed on `destroy()` before the feature
  releases state, so an SPA navigation does not drop a pending persist.
- Both the SponsorBlock cache's own prune path and `storageQuotaLRU`
  cap `sb_segments_cache` at 500 newest video entries. Expired entries
  beyond the 7-day stale window are removed.

Stale UI is explicit but quiet. `_fetchSegments()` annotates stale
fallback segments with `_ytkitCacheSource: 'stale'` and
`_ytkitCachedAt`; `_renderBarSegments()` still filters every segment
through the current category toggles, and stale progress-bar markers
receive a `data-ytkit-cache-source="stale"` marker plus a tooltip of
`<category> (cached at <time>)`. Skip behavior stays compatible; stale
segments use the same scheduler and category checks as fresh segments.

Two regressions in `tests/hardening.test.js` pin the cache constants,
fresh-before-network lookup, stale fallback diagnostic path, destroy
flush, stale marker tooltip, and category-filtered rendering. The
storageQuotaLRU regressions now also assert that `sb_segments_cache`
is named in the description and pruned through the real top-level key.

### H14 — Selector canary covers player overlay anchors

Pass 10 widened the selector canary to 18 core YouTube DOM tokens.
NX4 extends that coverage to the player overlay tier that SponsorBlock,
chapter hover, Jump Ahead suppression, and progress-bar rendering all
depend on.

Two more watch-page tokens are now critical:

- `ytp-progress-bar-padding` — the padded player timeline wrapper that
  surrounds the real `.ytp-progress-bar` target. `core/player.js`
  now looks for `.ytp-progress-bar` through this wrapper before falling
  back to the broad progress-bar query.
- `ytp-tooltip-text` — the inner text node for player hover/overlay
  messages. `hideJumpAheadButton` now scans both `.ytp-tooltip-text`
  and `.ytp-tooltip-text-wrapper` so a wrapper-only rename does not
  hide text-bearing overlay nodes from the suppressor.

`tests/selector-regression.test.js` now checks 20 critical selectors
plus the fixture sanity test. The source-side assertion changed from a
plain substring check to a token-boundary check against the extension
runtime sources (`extension/ytkit.js` plus `extension/core/player.js`).
This matters because `ytp-tooltip-text` should not pass merely because
`ytp-tooltip-text-wrapper` contains the same substring.

The committed `tests/fixtures/yt-watch.tokens.txt` snapshot already
contains both overlay tokens, so this pass only widens the canary list
and strengthens matching. If a future `npm run build:fixtures` refresh
loses either token, the selector test fails before release and forces
an intentional runtime update.
