# YTKit: YouTube Customization Suite

![Version](https://img.shields.io/badge/version-16-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Firefox%20%7C%20Edge-4285F4)
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-5.x-black?logo=tampermonkey&logoColor=white)
![Status](https://img.shields.io/badge/status-active-success)

> The ultimate YouTube userscript — ad blocking, VLC/MPV streaming, video/channel hiding, SponsorBlock, playback enhancements, premium themes, and 100+ configurable features in a single install.

<img width="1128" height="805" alt="2026-01-03 06_56_06-_new 8 - Notepad++  Administrator" src="https://github.com/user-attachments/assets/15776005-b776-40b9-80a8-767cdff9f0c7" />

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) or [Violentmonkey](https://violentmonkey.github.io/) (Firefox)
2. **[Click here to install YTKit](https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js)**
3. Confirm installation when prompted
4. Open YouTube — YTKit is active immediately

Open settings anytime with **Ctrl+Alt+Y** or click the YTKit gear icon.

## Features

### Ad Blocker

YTKit includes a built-in multi-layer ad blocker that runs at `document-start` before YouTube's scripts load. No external extension required.

| Layer | Engine | What It Does |
|-------|--------|--------------|
| API Pruning | JSON.parse proxy | Strips ad data from every parsed API response |
| Network Intercept | fetch() + XHR proxy | Intercepts `/player`, `/browse`, `/search`, `/next` endpoints and removes ad payloads |
| DOM Bypass | Node.appendChild proxy | Prevents YouTube from restoring ad infrastructure via iframes |
| Timer Neutralization | setTimeout proxy | Defeats timed ad reinsertion (16–18s delay pattern) |
| Anti-Detection | Promise.then proxy | Blocks `onAbnormalityDetected` callbacks |
| Property Traps | Object.defineProperty | Intercepts `ytInitialPlayerResponse` ad data before YouTube reads it |
| Video Ad Skip | MutationObserver + polling | Auto-clicks skip buttons the moment they appear |
| Cosmetic CSS | 150+ selectors | Hides ad containers, overlays, promoted content, merch shelves, premium upsells |
| DOM Cleaner | MutationObserver | Actively removes 23 ad element types as YouTube inserts them |

The ad blocker supports remote filter lists (uBO/EasyList `.txt` syntax) and custom CSS selectors via the settings panel.

### Themes

| Theme | Description |
|-------|-------------|
| System Default | Uses YouTube's native dark/light mode |
| Native Dark | YouTube's built-in dark theme |
| Better Dark | Deep dark theme with enhanced contrast and OLED-friendly blacks |
| Catppuccin Mocha | Popular pastel dark theme with warm tones |

Themes are loaded as external CSS resources and can be combined with UI style options (rounded or square corners).

### Content Control

| Feature | Description | Default |
|---------|-------------|---------|
| Remove All Shorts | Hides Shorts shelves from home, search, and subscriptions | On |
| Redirect Shorts | Converts Shorts URLs to regular video player | On |
| Disable Hover Previews | Stops videos from auto-playing on mouseover | On |
| Five Videos Per Row | Forces 5-column grid layout on home and subscriptions | On |
| Full-Width Subscriptions | Removes sidebar padding on subscriptions page | On |
| Redirect to Videos Tab | Channel pages open directly to the Videos tab | On |
| Hide Playables | Removes YouTube's game content | On |
| Hide Members Only | Hides members-only content you can't access | On |
| Hide News on Home | Removes news/breaking shelves from home feed | On |
| Hide Playlists on Home | Removes playlist shelves from home feed | On |
| Hide Paid Content Overlay | Removes "Paid" badges on sponsored content | On |

### Video Hider

A powerful content filter that hides videos and channels across YouTube.

- **Channel blocking** — hide all content from specific channels site-wide
- **Keyword filtering** — hide videos by title keywords (supports regex with `/pattern/` syntax)
- **Duration filtering** — hide videos shorter than a specified length
- **Subscriptions page integration** — "Hide All" button in the header for bulk management
- **Smart load limiting** — stops infinite scroll on subscriptions when too many videos are hidden (configurable threshold)

### Video Player

| Feature | Description | Default |
|---------|-------------|---------|
| Fit Player to Window | Expands video player to fill the browser width | On |
| Expand Video Width | Wider player on watch pages | On |
| Hide Related Videos | Removes the sidebar recommendation panel | On |
| Sticky Video | Video follows you as you scroll (picture-in-picture style) | On |
| Auto Theater Mode | Automatically enters theater mode on watch pages | Off |
| Persistent Progress Bar | Always shows the video progress bar | Off |
| Hide End Cards/Screens | Removes end-of-video overlays and suggestions | On |
| Floating Logo | Shows YTKit logo on watch pages for quick settings access | On |
| Adaptive Live Layout | Adjusts layout for live streams | On |

### Playback Enhancements

| Feature | Description | Default |
|---------|-------------|---------|
| Playback Speed Presets | Quick speed selection buttons in the player | On |
| Default Playback Speed | Set a global default speed (1x–3x) | 1x |
| Remember Speed | Persists your last-used speed across videos | Off |
| Per-Channel Speed | Set custom playback speeds for individual channels | On |
| Watch Progress Tracking | Visual indicator of how much you've watched | On |
| Timestamp Bookmarks | Save and return to specific timestamps | On |
| Auto-Skip Intro/Outro | Skips intro and outro segments automatically | Off |
| Auto-Skip "Still Watching?" | Dismisses the idle timeout prompt | On |
| Prevent Autoplay | Stops the next video from auto-playing | Off |

### SponsorBlock Integration

Built-in [SponsorBlock](https://sponsor.ajay.app/) client that auto-skips community-submitted sponsor segments, intros, outros, and other non-content sections. Uses the SponsorBlock API directly — no separate extension needed.

### Video Quality

| Feature | Description | Default |
|---------|-------------|---------|
| Auto Max Resolution | Automatically selects the highest available quality | On |
| Enhanced Bitrate | Requests premium bitrate streams when available | On |
| Hide Quality Popup | Suppresses the quality selection UI during auto-switching | On |

### VLC / MPV Streaming & Downloads

YTKit integrates with **[YTYT-Downloader](https://github.com/SysAdminDoc/YTYT-Downloader)** for local media player streaming and downloads.

| Button | Action |
|--------|--------|
| **VLC** | Stream the current video directly in VLC |
| **+Q** | Queue the current video in VLC (plays after current) |
| **Download** | Download video locally via YTYT-Downloader |
| **MP3** | Extract and download audio only |
| **Transcript** | Download the video transcript |
| **MPV** | Stream in MPV player (alternative to VLC) |

Additional download features include a web-based download button (Cobalt provider), configurable download quality (up to 4K), a right-click context menu with download/stream options, subscriptions page VLC playlist export, and an optional custom embed player that replaces YouTube's native player.

> **Note:** VLC/MPV streaming and local downloads require [YTYT-Downloader](https://github.com/SysAdminDoc/YTYT-Downloader) running locally. Install it and the embed server starts automatically on boot. The web-based Cobalt download button works without it.

### Clutter Removal

YTKit removes visual noise from every YouTube page:

- Merch shelves and shopping sections
- Info panels and clarification boxes
- Description extras (hashtags, key moments)
- Pinned comments
- Live chat engagement prompts, polls, ticker, leaderboard, super chats
- Paid promotion disclosures
- Fundraiser modules
- Action buttons (like/dislike/share/clip/thanks/save — individually toggleable)
- Player controls (miniplayer/PiP/theater/fullscreen/subtitles — individually toggleable)

### Interface Cleanup

| Feature | Description | Default |
|---------|-------------|---------|
| Hide Create Button | Removes the "+" create button from the header | On |
| Hide Voice Search | Removes the microphone icon from the search bar | On |
| Logo → Subscriptions | Clicking the YouTube logo goes to subscriptions instead of home | On |
| Widen Search Bar | Makes the search input wider | On |
| Subscriptions Grid | Forces grid layout on the subscriptions page | On |
| Hide Sidebar | Collapses the left navigation sidebar | On |
| Compact Layout | Tighter spacing throughout the UI | On |
| Thin Scrollbar | Minimal scrollbar styling | On |
| No Ambient Mode | Disables the color glow effect behind videos | On |
| No Frosted Glass | Removes blur/glass effects from UI elements | On |

### Settings Panel

A full-featured settings UI accessible via **Ctrl+Alt+Y** or the gear icon. Features include categorized toggles for every feature (Interface, Appearance, Content, Player, Playback, Ad Blocker, Downloads, Advanced), per-feature descriptions, import/export settings as JSON, a custom CSS editor, ad blocker statistics dashboard, remote filter list management, and debug mode.

## How It Works

```
┌──────────────────────────────────────────────────────────────────────┐
│                        document-start                                │
│                                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐     │
│  │  PHASE 1: Page Ctx  │    │  PHASE 2: Sandbox                │     │
│  │  (unsafeWindow)     │    │  (Tampermonkey GM_* APIs)        │     │
│  │                     │    │                                  │     │
│  │  • JSON.parse proxy │    │  • 150+ CSS cosmetic selectors   │     │
│  │  • fetch() proxy    │    │  • DOM MutationObserver cleanup  │     │
│  │  • XHR proxy        │    │  • SSAP ad skip delegation       │     │
│  │  • appendChild proxy│    │  • GM_getValue/setValue storage  │     │
│  │  • setTimeout proxy │    │  • Remote filter list fetching   │     │
│  │  • Promise.then     │    │  • CSS re-injection protection   │     │
│  │  • Property traps   │    │                                  │     │
│  │  • Video ad skipper │    │                                  │     │
│  └─────────────────────┘    └──────────────────────────────────┘     │
│              │                            │                          │
│              ▼                            ▼                          │
│     Real window object            Shared DOM access                  │
│     (YouTube sees proxies)        (CSS/elements work from sandbox)   │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    DOMContentLoaded
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    MAIN YTKIT (13,000+ lines)                        │
│                                                                      │
│  Section 0: Core Utilities, Storage, Navigation Engine               │
│  Section 1: Settings Manager (100+ options, migration system)        │
│  Section 2: Feature Definitions (105 features, lazy-loaded)          │
│  Section 3: Helpers (toast, persistent buttons, keyboard manager)    │
│  Section 4: Premium UI (Settings panel, statistics dashboard)        │
│  Section 5: Styles (Trusted Types safe CSS injection)                │
│  Section 6: Bootstrap (feature activation, page type detection)      │
└──────────────────────────────────────────────────────────────────────┘
```

The ad blocker uses a **split-architecture bootstrap** to solve Tampermonkey's sandbox isolation. When a userscript declares `@grant GM_*` directives, Tampermonkey wraps it in a sandbox where `window` is a proxy — not the real page `window`. YouTube's scripts never see proxy modifications made in the sandbox.

YTKit solves this by running the proxy engine through `unsafeWindow` (Tampermonkey's bridge to the real page context), targeting `W.JSON`, `W.fetch`, `W.XMLHttpRequest`, etc. directly on the real window object. CSS injection and DOM observers stay in the sandbox since they operate on the shared DOM.

## Configuration

All settings persist across sessions via `GM_setValue`. Open the settings panel with **Ctrl+Alt+Y** to configure everything visually, or export/import settings as JSON for backup and cross-browser sharing.

### Ad Blocker Configuration

- **Master toggle** — enable/disable all ad blocking
- **Cosmetic hide** — toggle CSS-based hiding of ad containers
- **SSAP auto-skip** — toggle video ad skip button auto-clicking
- **Anti-detect** — toggle the abnormality detection bypass
- **Filter list URL** — point to any uBO/EasyList-compatible filter list
- **Custom filters** — add your own CSS selectors
- **Live stats** — blocked/pruned/skipped counts in real-time

Default remote filter list: [`youtube-adblock-filters.txt`](https://raw.githubusercontent.com/SysAdminDoc/YoutubeAdblock/refs/heads/main/youtube-adblock-filters.txt)

## FAQ

**Ads still showing?**
Disable other YouTube ad-blocker userscripts — they can conflict with YTKit's proxy engine. YTKit handles everything internally.

**VLC/Download buttons not working?**
These require [YTYT-Downloader](https://github.com/SysAdminDoc/YTYT-Downloader) running locally. The Cobalt web download works without it.

**How do I reset all settings?**
Open DevTools console and run `GM_setValue('ytkit_settings', '{}')`, then reload.

**Works on Firefox?**
Yes, with Violentmonkey or Tampermonkey. All features are cross-browser.

**Works on mobile?**
The script targets desktop `youtube.com`. Mobile (`m.youtube.com`) is excluded.

## Contributing

Issues and PRs welcome. When reporting bugs, include browser version, userscript manager version, console errors (F12 → Console), and which features are enabled.

## License

[MIT](LICENSE) — Matthew Parker

---

## 🙏 Acknowledgments

- [SponsorBlock](https://sponsor.ajay.app/) - For the sponsor segment API
- [Cobalt](https://cobalt.tools/) - For video download functionality
- [Catppuccin](https://github.com/catppuccin) - For the beautiful color palette
- YouTube Alchemy, SponsorBlock Lite, and other userscripts for inspiration

---

<p align="center">
  Made with ❤️ for a better YouTube experience
</p>

<p align="center">
  <a href="#-ytkit---youtube-customization-suite">Back to Top ↑</a>
</p>
