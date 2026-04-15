# Astra Deck — Continuation Prompt

Copy everything below into a new Claude Code chat to resume work on Astra Deck.

---

You are continuing work on **Astra Deck** (formerly YouTube-Kit), a Chrome + Firefox MV3 extension and Tampermonkey userscript for comprehensive YouTube enhancement. It ships from `~/repos/YouTube-Kit/` (GitHub: `SysAdminDoc/YouTube-Kit`, renamed to `Astra-Deck` upstream; local dir still named YouTube-Kit).

Read these first, in order, before touching code:

1. `~/repos/YouTube-Kit/CLAUDE.md` — per-repo working notes, current version, recent changes, architecture.
2. `~/repos/YouTube-Kit/roadmap.md` — the authoritative roadmap. v3.7.0 and v3.8.0 execution status is annotated inline.
3. `~/repos/YouTube-Kit/CHANGELOG.md` — what just shipped.
4. `~/.claude/projects/c--Users----repos\memory\MEMORY.md` and `~/.claude/projects/c--Users----repos\memory\youtube-kit.md` — user preferences and project-specific memory.

**Current state (as of handoff)**: v3.8.0 just shipped. Already built and tagged in the roadmap as done:
- v3.7.0: `credentials:'omit'` security fix, expanded URL tracking-param strip (UTM + click IDs), transcript export (Copy/.txt/.srt/LLM).
- v3.8.0: Toolbar popup with 15 quick-toggles + live filter, full `settingsProfiles` implementation, `digitalWellbeing` (break reminders + daily cap), `videoRotation`, `frameByFrameButtons`, `YTKIT_SETTING_CHANGED` live-toggle message type.
- Already-existing discoveries from the audit: SponsorBlock seekbar segments, basic URL cleaner, transcriptViewer, videosPerRow — all were already implemented pre-v3.7.

**Your mission**: Keep building Astra Deck into a fully featured, larger product. Work from the roadmap's priority matrix top-down. The user wants breadth — ship many features, not one perfect one. Dense output, no fluff.

## Immediate next-up (v3.9.0 candidates, pick the highest-value 5-8)

From the roadmap's v3.8.0 and v3.9.0 sections — several are still open:
- **Subtitle/caption download** (SRT/VTT) — pattern exists in `transcriptViewer` export; extract to a standalone feature that works without opening the sidebar.
- **Subtitle/caption styling panel** — font/size/color/position/background/dual-subs.
- **Video visual filters** — brightness/contrast/saturation/hue/grayscale/sepia sliders as CSS filters on the `<video>` element.
- **DeArrow "show original" peek button** — on-hover reveal of original title/thumbnail.
- **Color-coded video age on feeds** — thumbnail borders by upload age.
- **AI video summary** — user-provided LLM key (OpenAI/Anthropic/Gemini/Ollama), uses existing transcript fetch.
- **Reddit comments integration** — `https://www.reddit.com/search.json?q=url:youtube.com/watch?v={id}` (add to `ALLOWED_FETCH_ORIGINS` in `background.js`).
- **Audio compressor/normalizer via Web Audio API** — MAIN-world bridge in `ytkit-main.js`.
- **10-band equalizer** — `BiquadFilterNode` chain in MAIN world.
- **Watch history analytics dashboard** — visualize existing `watchTimeTracker` data with CSS-only bar charts.
- **Tab view for watch page** — horizontal tabs for description/comments/chapters/transcript.
- **Storage quota enforcement** — LRU caps on `hiddenVideos`, `hiddenChannels`, `timestampBookmarks`, `deArrowCache`; declare `unlimitedStorage` permission.
- **API retry with exponential backoff** — 1s/2s/4s on SponsorBlock/RYD/DeArrow failures.
- **Structured error log** — `_errors` array, diagnostic report button.
- **Mouseover storyboard preview on feed thumbnails** — fetch storyboard spec from `/youtubei/v1/player`.

## Non-negotiable patterns

- **Feature registration**: add a new object to the `features` array in `extension/ytkit.js` (just before the closing `];`). Required keys: `id`, `name`, `description`, `group`, `icon`, `init()`, `destroy()`. Optional: `type: 'select'` + `options` + `settingKey` for dropdowns, `isParent`/`parentId` for parent-child features, `pages: [PageTypes.WATCH]` to gate by page type.
- **Defaults**: every feature gets a default value in the `defaults:` object in the `settingsManager` (currently around line 2059 of `ytkit.js`). Booleans default `false` unless the feature is a default-on cosmetic.
- **Styles**: use `injectStyle(css, id, isolate)` helper, not raw `<style>` appends.
- **Navigation**: use `addNavigateRule('ruleId', fn)` + `removeNavigateRule('ruleId')`. For mutation-driven features: `addMutationRule` / `removeMutationRule`.
- **External fetches**: go through `background.js` EXT_FETCH proxy via the `extensionFetchJson` / `extensionFetch` helpers. Origins must be allowlisted in `ALLOWED_FETCH_ORIGINS`. Third-party origins get `credentials: 'omit'` — don't allowlist them in `CREDENTIALED_FETCH_ORIGINS` unless explicitly required.
- **Toasts**: `showToast(text, color, options?)`. Never block user with modals except for the digital-wellbeing break overlay pattern.
- **No tests** unless the user asks.
- **No emoji** in PowerShell; emoji OK in JS/Python.
- **No Co-Authored-By** in commits.

## Build & ship workflow

```bash
cd ~/repos/YouTube-Kit
node build-extension.js --bump patch   # or --bump minor for v3.9.0, --bump major for v4.0.0
# Produces in build/: chrome .zip + .crx, firefox .zip + .xpi (all four required per release policy)
```

After every version bump, sync ALL of these in the SAME working state before committing:
- `CHANGELOG.md` — new versioned entry at top, describe what / why.
- `CLAUDE.md` — update `## Current Version:` section with new entry and demote prior.
- `README.md` — version badge (line 18, `version-X.Y.Z-ff4e45`).
- `roadmap.md` — annotate completed items inline with status markers.
- `~/.claude/projects/c--Users----repos\memory\youtube-kit.md` — memory file update.

Validate before shipping:

```bash
node --check extension/ytkit.js
node --check extension/background.js
node --check extension/popup.js
unzip -l build/astra-deck-chrome-vX.Y.Z.zip | grep -E "popup|manifest"
```

## Gotchas from prior sessions

- **Audit before adding**. The codebase is 21K+ lines; many "new" roadmap items already exist. Grep for `id: 'featureName'` first.
- **`features` array is monolithic** (~13,000 lines of feature bodies inside ytkit.js). Insertion point for new features is immediately before the closing `];` of the array — look for the `disableSpaNavigation` feature, then `];` right after it (and the v3.8.0 wave header).
- **`settingsManager.defaults` object** must include every new setting key or the settings sanitizer will drop them. Don't forget `dw*`-style supporting keys.
- **Firefox manifest** is auto-patched by `build-extension.js` — don't manually edit for Firefox compat. Just edit `manifest.json` for Chrome; the build tool handles `background.scripts` array + `browser_specific_settings.gecko`.
- **Content script lives in ISOLATED world**; `ytkit-main.js` is the MAIN-world bridge for page API access (currently just `canPlayType`). Use data-attribute bridges for communication.
- **`chrome.tabs.sendMessage`** from popup.js may fail with "Receiving end does not exist" on tabs that haven't loaded ytkit.js. Always swallow `chrome.runtime.lastError`.
- **Live toggle broadcast**: popup.js sends `YTKIT_SETTING_CHANGED`; the handler in ytkit.js near `PANEL_MESSAGE_TYPES.close` will re-init/destroy the matching feature. Respect this seam when adding toggleable features.

## What to do RIGHT NOW after reading this

1. Run `git -C ~/repos/YouTube-Kit status` and `git log --oneline -10` to see if the v3.7/v3.8 work was committed. If not, that's the first task — commit with a terse "why"-focused message and tag `vX.Y.Z`.
2. Read `roadmap.md` end-to-end once. Note which Ship-Next / v3.8 / v3.9 items still have no implementation.
3. Pick the top 5-8 unbuilt items from the list above, batch them into a v3.9.0 wave, and ship.
4. Before coding: grep each feature ID to confirm it isn't already implemented.
5. After each substantive feature, update the in-memory todo list via TodoWrite.
6. At the end of the wave: bump version, update all four doc files, build all four artifacts, validate syntax.

Keep going until you hit context limits or the roadmap backlog is empty. The user wants LARGE and FEATURED. Ship density over polish.
