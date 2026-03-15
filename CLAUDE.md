# YouTube-Kit

## Overview
Chrome MV3 extension + Tampermonkey userscript for comprehensive YouTube enhancement. Ad blocking, theater mode, ChapterForge AI chapters, DeArrow, filler skip, transcript extraction, video/channel hiding.

## Architecture
- Split-context ad blocking: MAIN world (page JS intercept) + ISOLATED world (DOM manipulation)
- GM_* compatibility shim for userscript mode
- YTYT-Downloader consolidated into this repo (separate repo was deleted)
- Content scripts use multiple `run_at` entries for early CSS + late logic
- Settings panel cleanup registry (`_panelCleanups`) prevents memory leaks from intervals/observers
- Lifetime ad block stats use delta-based accumulation to avoid double-counting across sessions
- Options page (`options.html`/`options.js`) uses `chrome.storage.local` directly — no dependency on gm-compat or ytkit.js
- Build script (`build-extension.js`) packages extension/ into ZIP with optional `--bump` version management

## Gotchas
- MAIN world cannot access `chrome.*` APIs — needs localStorage mirroring or CustomEvent bridge from ISOLATED world
- ISOLATED world cannot access page JS globals (`window.ytcfg`, `ytInitialPlayerResponse`) — needs fallback parsing or cross-world CustomEvent bridge
- Stats counters shared between worlds can overwrite each other if both write to same DOM element
- `trustedTypes.createPolicy()` required for all innerHTML on YouTube
- `el.innerHTML = ''` still violates trustedTypes CSP — use `el.textContent = ''` to clear
- YouTube filter chips (e.g. "Recently uploaded") replace grid content via Polymer recycling without firing `yt-navigate-finish` — need capture-phase click listener on `yt-chip-cloud-chip-renderer` to trigger reprocessing
- Video element processing must always re-check for missing X buttons even on already-processed elements, since YouTube's Polymer re-renders can strip child DOM nodes while keeping the parent element in place
- Sandbox iframes (`sandbox` attribute without `allow-scripts`) will throw if you access `contentWindow` — check sandbox attribute BEFORE appending

## Current Version: v3.1.0
