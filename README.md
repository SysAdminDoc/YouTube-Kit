<p align="center">
  <img src="assets/ytlogo.png" alt="YTKit Logo" width="80">
</p>

<h1 align="center">YTKit: YouTube Customization Suite</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.4-ff4e45?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/YouTube-Desktop-ff0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube">
</p>

<p align="center">
  A single userscript that transforms YouTube into a clean, ad-free, distraction-free experience with a premium dark interface — no extensions to manage, no bloat, just one file.
</p>

<p align="center">
  <a href="https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js"><strong>⬇ Install YTKit</strong></a>
</p>

---

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. **[Click here to install YTKit](https://github.com/SysAdminDoc/YTKit/raw/refs/heads/main/YTKit.user.js)**
3. Confirm installation when prompted
4. Open YouTube — everything works immediately with zero configuration

YTKit auto-updates through your userscript manager. Every feature is enabled by default and fully configurable through the built-in settings panel.

---

## What It Does

YTKit replaces the need for multiple browser extensions by combining ad blocking, SponsorBlock, UI customization, download integration, and playback enhancements into a single userscript. Every feature runs at `document-start` for instant ad prevention, and the entire settings panel is built in — no external dashboards or config files.

---

## Features

### Ad Blocking

| Feature | Description | Default |
|---------|-------------|---------|
| YouTube Ad Blocker | Block video ads via API proxy interception, JSON response pruning, and cosmetic hiding | Off |
| Cosmetic Element Hiding | Hide ad slots, banners, merch shelves, and promoted content via CSS filter lists | On |
| SSAP Auto-Skip | Detect and auto-skip server-side ad stitching in videos | On |
| Anti-Detection Bypass | Block YouTube's ad-blocker detection and countermeasure scripts | On |

The ad blocker uses a split architecture: Phase 1 injects a proxy engine into the real page context (bypassing the userscript sandbox) to intercept `fetch`/`XMLHttpRequest` and prune ad payloads from YouTube's API responses. Phase 2 runs CSS cosmetic filters and a DOM mutation observer to remove ad elements that slip through. Supports remote filter lists with auto-update.

### SponsorBlock

| Feature | Description | Default |
|---------|-------------|---------|
| Skip Sponsors | Auto-skip sponsored segments, intros, outros, self-promo, interaction reminders, and filler using the SponsorBlock API | On |
| Hide SponsorBlock Labels | Hide the colored category labels on the seek bar | On |

### Interface

| Feature | Description | Default |
|---------|-------------|---------|
| Logo → Subscriptions | Clicking the YouTube logo navigates to subscriptions instead of home | On |
| Logo Quick Links | Hover over the YouTube logo to reveal a customizable dropdown with quick navigation links (History, Watch Later, Playlists, Liked Videos, Subscriptions, For You Page) | On |
| Edit Quick Links | Customize dropdown items via the settings panel — one link per line in `Label \| URL` format | — |
| Hide Create Button | Remove the "Create" button from the header toolbar | On |
| Hide Voice Search | Remove the microphone icon from the search bar | On |
| Widen Search Bar | Expand the search bar to use more available space | On |
| Subscriptions Grid | Use a denser grid layout on the subscriptions page | On |
| Homepage Grid Align | Force uniform thumbnail grid — prevents misaligned rows from variable title heights | On |
| Styled Filter Chips | Polished filter chips on the homepage with glassmorphism and hover effects | On |
| Hide Sidebar | Remove the left navigation sidebar | On |
| Videos Per Row | Set thumbnail columns per row (0 = dynamic, 3–8 = fixed) | Dynamic |

### Appearance

| Feature | Description | Default |
|---------|-------------|---------|
| UI Style | Choose rounded or square UI elements | Square |
| Watch Page Restyle | Polished watch page layout with glassmorphism accents, refined title/metadata/description styling | On |
| Refined Comments | Card-based comment layout with avatars and clean thread lines | On |
| Disable Ambient Mode | Turn off the glowing background effect that matches video colors | On |
| Compact Layout | Reduce spacing and padding for a denser interface | On |
| Thin Scrollbar | Slim, unobtrusive scrollbar | On |

### Content Filtering

| Feature | Description | Default |
|---------|-------------|---------|
| Remove Shorts | Hide all Shorts from feeds and recommendations | On |
| Redirect Shorts | Open Shorts URLs in the standard video player | On |
| Channels → Videos Tab | Open channel pages directly on the Videos tab | On |
| Hide Collaborations | Hide videos from channels you're not subscribed to in your subscriptions feed | On |
| Hide News Section | Remove news sections from the homepage | On |
| Hide Playlist Shelves | Remove playlist sections from the homepage | On |
| Hide Playables | Hide YouTube Playables gaming content | On |
| Hide Members Only | Hide members-only content from channels | On |
| Full-Width Subscriptions | Expand the subscription grid to fill the page | On |
| Hide Layout Options | Remove the "Latest" header and view toggles on subscriptions | On |
| Disable Hover Preview | Stop videos from auto-playing on thumbnail hover | On |
| Hide Promotion Badges | Remove "Includes paid promotion" overlays | On |
| Hide Info Panels | Remove Wikipedia/context info boxes (FEMA, COVID, etc.) | On |
| Clean Share URLs | Strip tracking params (`si`, `pp`, `feature`) from copied/shared YouTube links | On |

### Video Player

| Feature | Description | Default |
|---------|-------------|---------|
| Theater Split | Fullscreen video on watch pages — scroll down to reveal comments side-by-side, scroll back up to return to fullscreen | On |
| Fit to Window | Make the player fill your entire browser window | On |
| Expand Video Width | Stretch the video to fill available space when sidebar is hidden | On |
| YTKit Player Controls | Replace native player right-controls with YouTube logo (quick links dropdown) and settings gear | On |
| Auto-Resume Position | Resume videos from where you left off | On |
| Resume Threshold | Seconds into a video before saving resume position | 15s |
| Monitor Switch Fix | Auto-recover video when moving browser between monitors (fixes black screen with audio) | On |
| Auto Quality | Automatically select preferred video quality (max, 4K, 1440p, 1080p, 720p, 480p) | Max |
| Enhanced Bitrate | Request higher bitrate streams when available | On |
| Hide Quality Popup | Suppress the quality selection popup during auto-selection | On |
| Hide Description | Remove the video description panel | On |
| Hide Related Videos | Remove the related videos panel | On |
| Hide Video End Content | Remove end cards, end screen, and video grid when videos finish | On |

### Clutter Removal

| Feature | Description | Default |
|---------|-------------|---------|
| Hide Merch Shelf | Remove merchandise promotions below videos | On |
| Hide AI Summary | Remove AI-generated summaries and Ask AI buttons | On |
| Hide Description Extras | Remove extra elements in the description area | On |
| Hide Hashtags | Remove hashtag links above video titles | On |
| Hide Pinned Comments | Remove pinned comments from the comments section | On |
| Hide Comment Actions | Remove action menu from individual comments | On |
| Condense Comments | Reduce spacing between comments | On |
| Hide Comment Teaser | Remove the "Scroll for comments" prompt | On |
| Hide Chat Engagement | Remove engagement prompts in live chat | On |
| Hide Paid Promotion | Remove "paid promotion" labels on watch pages | On |
| Hide Channel Join Button | Remove the Join/membership button | On |
| Hide Fundraisers | Remove fundraiser and donation badges | On |

### Configurable Element Managers

These features provide granular toggle controls through the settings panel:

| Manager | Controls |
|---------|----------|
| **Hide Action Buttons** | Like, Dislike, Share, Ask/AI, Clip, Thanks, Save, Join/Sponsor, More Actions |
| **Hide Player Controls** | SponsorBlock, Next, Autoplay, Subtitles, Captions, Miniplayer, PiP, Theater, Fullscreen |
| **Hide Watch Elements** | Join Button, Ask Button, Save Button, More Actions, Ask AI Section, Podcast Section, Transcript Section, Channel Info Cards |
| **Hide Chat Elements** | Header, Menu, Popout, Reactions, Timestamps, Polls, Ticker, Leaderboard, Support, Banner, Emoji, Top Fan, Super Chats, Level Up, Bots |
| **Chat Keyword Filter** | Comma-separated list of words to hide from live chat |

### Downloads & Streaming

| Feature | Description | Default |
|---------|-------------|---------|
| Video Context Menu | Right-click on video player for download options, VLC/MPV streaming, transcript download, embed player, copy URL/ID | On |
| Web Download Button | Add a Cobalt-based web download button below videos | Off |
| VLC Player Button | Stream video directly in VLC media player | Off |
| Local Download Button | Download video locally via `yt-dlp` | On |
| MP3 Download Button | Download audio as MP3 via `yt-dlp` | On |
| Configurable Cobalt URL | Set custom Cobalt instance URL | `cobalt.meowing.de` |

> **Note:** VLC/MPV streaming and local downloads require [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) installed locally with a URI handler configured. The web download button uses [Cobalt](https://github.com/imputnet/cobalt) and works without any local tools.

---

## Settings Panel

Access the settings panel by clicking the gear icon in the YouTube masthead or in the player controls. The panel features:

- **Searchable sidebar** with categorized feature groups
- **Toggle switches** for every feature with instant apply
- **Sub-feature controls** for granular element hiding
- **Textarea editors** for custom filter lists, quick links, and chat keywords
- **Quick access bar** at the bottom of the panel for frequently used toggles
- **Export/Import/Reset** for backing up and restoring your configuration

All settings persist across sessions via the userscript manager's storage (`GM_setValue`/`GM_getValue`).

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  document-start (before YouTube loads)                          │
│                                                                 │
│  ┌──────────────────┐   ┌──────────────────┐                   │
│  │  Phase 1: Proxy   │   │  Phase 2: CSS    │                   │
│  │  Engine (page ctx) │   │  + DOM Observer  │                   │
│  │                    │   │  (sandbox ctx)   │                   │
│  │  • fetch proxy     │   │                  │                   │
│  │  • XHR proxy       │   │  • Cosmetic CSS  │                   │
│  │  • JSON pruning    │   │  • Ad element    │                   │
│  │  • Response rewrite│   │    removal       │                   │
│  │  • SSAP neutralizer│   │  • Filter lists  │                   │
│  └──────────────────┘   └──────────────────┘                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Main Script (after DOM ready)                            │   │
│  │                                                           │   │
│  │  Features → Settings Manager → Navigate/Mutation Rules    │   │
│  │                                                           │   │
│  │  • CSS features: inject/remove <style> elements           │   │
│  │  • JS features: DOM observers, event listeners, timers    │   │
│  │  • SPA-aware: re-runs on YouTube's client-side navigation │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Key architectural decisions:

- **Split-context ad blocking** — The proxy engine runs in the real page context (not the userscript sandbox) so YouTube's player sees the modified responses. This avoids Trusted Types CSP issues entirely.
- **SPA navigation handling** — YouTube is a single-page app. YTKit hooks into `yt-navigate-finish` events and uses a centralized navigate/mutation rule system so features re-apply on every page transition.
- **Lazy feature loading** — Critical features (ad blocking, Theater Split) load immediately. Network-bound features (SponsorBlock) are deferred via `requestIdleCallback`.
- **Trusted Types compliance** — All innerHTML operations use a `TrustedHTML` wrapper that creates a Trusted Types policy, preventing CSP violations on YouTube's strict pages.

---

## Compatibility

| Browser | Userscript Manager | Status |
|---------|-------------------|--------|
| Chrome / Edge / Brave | Tampermonkey | ✅ Fully supported |
| Firefox | Tampermonkey / Violentmonkey | ✅ Fully supported |
| Opera | Tampermonkey | ✅ Fully supported |
| Safari | Userscripts (App Store) | ⚠️ Limited (no `GM.xmlHttpRequest`) |

**Not supported:** Mobile browsers, YouTube Music, YouTube Studio, embedded players on other sites.

---

## FAQ

**Q: The ad blocker is off by default?**
A: Yes. YTKit's ad blocker uses aggressive API proxying that may conflict with other ad-blocking extensions. If you're already running uBlock Origin, you may not need it. Enable it in Settings → Ad Blocker if you want YTKit to handle ads instead.

**Q: How do I get VLC/MPV streaming working?**
A: Install [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and register a `vlc://` or `mpv://` URI protocol handler on your system. The buttons pass the video URL to your local player via URI scheme.

**Q: Can I use this with other YouTube extensions?**
A: Yes, but avoid running multiple ad blockers simultaneously. YTKit's cosmetic CSS filters and SponsorBlock integration work alongside most extensions without conflict.

**Q: My settings disappeared after an update.**
A: YTKit stores settings in your userscript manager's storage, which persists across updates. If settings are lost, your userscript manager's data was cleared. Use the Export button in the settings panel to back up your config.

**Q: Theater Split doesn't show comments.**
A: Scroll down. Theater Split starts in fullscreen video mode — scrolling reveals the comments panel side-by-side. Scroll back up to return to fullscreen.

---

## Contributing

Issues and PRs welcome. If you find a YouTube layout change that breaks a feature, open an issue with the affected page URL and a screenshot.

When submitting a PR:
- Test on both Chrome + Tampermonkey and Firefox + Violentmonkey
- Maintain the existing code style (single-file, no build tools, no external dependencies beyond CDN)
- Scope CSS selectors to avoid global side effects

---

## License

[MIT](LICENSE) — Matthew Parker
