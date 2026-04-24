<p align="center">
  <img src="logo.png" alt="Astra Deck" width="100">
</p>

<h1 align="center">Astra Deck</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.19.0-ff4e45?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/manifest-V3-blue?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/YouTube-Desktop-ff0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube">
</p>

<p align="center">
  Premium YouTube enhancement extension for Chrome and Firefox with 150+ features — theater split, DeArrow, downloads with format/quality controls, transcript viewer, video/channel hiding, and deep playback customization. Zero configuration required.
</p>

<p align="center">
  <a href="https://github.com/SysAdminDoc/Astra-Deck/releases/latest"><strong>Download Latest Release</strong></a>
</p>

---

## Installation

### Chrome / Edge / Brave

**Option A — CRX sideload:**
1. Download `astra-deck-chrome-v*.crx` from the [latest release](https://github.com/SysAdminDoc/Astra-Deck/releases/latest)
2. Open `chrome://extensions/`, enable **Developer mode**
3. Drag and drop the `.crx` file onto the page

**Option B — Unpacked:**
1. Download or clone the `extension/` folder
2. Open `chrome://extensions/`, enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder

### Firefox

1. Download `astra-deck-firefox-v*.xpi` from the [latest release](https://github.com/SysAdminDoc/Astra-Deck/releases/latest)
2. Open `about:addons`, click the gear icon, select **Install Add-on From File**
3. Select the `.xpi` file

Requires Firefox 128+.

### Userscript (Tampermonkey / Violentmonkey)

A userscript build is also available. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/), then **[click here to install](https://github.com/SysAdminDoc/Astra-Deck/raw/refs/heads/main/YTKit.user.js)**.

> Some features (SharedAudio, Return YouTube Dislike, SponsorBlock per-category, Cobalt downloads) are only available in the userscript. The extension uses a MediaDL-only download path.

---

## Features

### Core

| Feature | Default |
|---------|---------|
| Theater Split — fullscreen video, scroll to reveal comments side-by-side | On |
| Video Hider — hide videos/channels from feeds with X buttons, keyword filter, regex, duration filter | On |
| Video Context Menu — right-click player for downloads, VLC/MPV streaming, transcript, screenshot | On |
| Settings Panel — searchable, categorized, instant-apply, export/import/reset | On |
| Comment Search — filter watch-page comments inline | Off |
| DeArrow — replace clickbait titles/thumbnails via crowdsourced database | Off |

### Interface

| Feature | Default |
|---------|---------|
| Logo Quick Links — hover dropdown with History, Watch Later, Playlists, Liked, Subs | On |
| Hide Sidebar / Hide Shorts / Hide Related / Hide Description | On |
| Subscriptions Grid / Homepage Grid Align / Videos Per Row | On |
| Styled Filter Chips / Compact Layout / Thin Scrollbar | On |
| Square Search Bar / Square Avatars | On |
| Compact Unfixed Header / Force Dark Everywhere | Off |

### Watch Page

| Feature | Default |
|---------|---------|
| Watch Page Restyle — glassmorphism accents, refined metadata | On |
| Native Comments Layout — keep YouTube comments clean without extension restyling | On |
| Expand Video Width / Disable Ambient Mode | On |
| Hide Merch, AI Summary, Hashtags, Pinned Comments, Info Panels | On |
| Clean Share URLs — strip tracking params | On |
| Auto-Expand Description / Sticky Chat / Scroll to Player | Off |

### Video Player

| Feature | Default |
|---------|---------|
| Always Best Quality — picks highest available stream, prefers 1080p Premium when offered | On |
| Auto-Resume Position (configurable threshold) | On |
| Custom Progress Bar Color (color picker) | Off |
| Remaining Time Display / Time in Tab Title | Off |
| A-B Loop / Fine Speed Control / Persistent Speed / Per-Channel Speed | Off |
| Codec Selector (H.264/VP9/AV1) / Force Standard FPS | Off |
| Video Screenshot / Video Zoom (Ctrl+scroll, up to 5x) | Off |
| Cinema Ambient Glow / Nyan Cat Progress Bar | Off |
| Speed Indicator Overlay / Custom Speed Buttons (0.5x-3x) | Off |
| Pop-Out Player (Document PiP) / PiP Button / Fullscreen on Double-Click | Off |

### Content Filtering

| Feature | Default |
|---------|---------|
| Remove Shorts / Redirect Shorts to Regular Player | On |
| Channels open on Videos Tab | On |
| Hide Collaborations / News / Playlists / Playables / Members Only | On |
| Hide Watched Videos (dim or hide) / Grayscale Thumbnails | Off |
| Anti-Translate / Not Interested Button / Open in New Tab | Off |
| Disable Infinite Scroll / Disable SPA Navigation | Off |

### Downloads

| Feature | Default |
|---------|---------|
| Download Options Popup — format, quality, and save directory per download | On |
| Video Formats — MP4, MKV, WebM | MP4 |
| Audio Formats — MP3, M4A, Opus, FLAC, WAV | MP3 |
| Quality Selector — Best, 4K, 1440p, 1080p, 720p, 480p | Best |
| Custom Save Directory — override per download or set globally | Downloads |
| Context Menu — quick "Download Video" and "Download Audio" on right-click | On |
| Auto-Download on Visit | Off |
| Download Thumbnail (maxres) | Off |

> Downloads use Astra Downloader, the bundled local yt-dlp + ffmpeg companion. The extension probes `9751` plus fallback ports (`9761`, `9771`, `9781`, `9791`, `9851`) and only accepts health responses that identify as the Astra downloader service.

### Comments

| Feature | Default |
|---------|---------|
| Sort Comments Newest First | Off |
| Creator Comment Highlight | Off |
| Comment Handle Revealer — show original channel name next to @handle | Off |
| Preload Comments | Off |

### Live Chat

| Feature | Default |
|---------|---------|
| Premium Live Chat styling | On |
| Configurable element hiding (header, emoji, super chats, polls, etc.) | On |
| Chat Keyword Filter | Off |
| Adaptive Live Layout | Off |

### Automation & Behavior

| Feature | Default |
|---------|---------|
| Auto-Dismiss "Still Watching?" | Off |
| Auto Theater Mode / Auto Subtitles / Auto-Like Subscribed | Off |
| Auto-Pause on Tab Switch / Pause Other Tabs | Off |
| Auto-Open Chapters / Auto-Open Transcript | Off |
| Auto-Close Popups (cookie/survey/premium) | Off |
| Prevent Autoplay / Disable Autoplay Next | Off |
| Redirect Home to Subscriptions | Off |
| Remember Volume / Persistent Speed | Off |

### Power User

| Feature | Default |
|---------|---------|
| Resume Playback (500-entry cap, 15s save interval) | Off |
| Mini Player Bar (floating progress/play/pause on scroll-past) | Off |
| Playback Stats Overlay (codec, resolution, dropped frames, bandwidth) | Off |
| Watch Time Tracker (90-day retention) + Analytics Dashboard | Off |
| Timestamp Bookmarks (inline notes, persistent storage) | Off |
| Transcript Viewer (sidebar with clickable timestamps) + Export | Off |
| AI Video Summary (OpenAI / Anthropic / Gemini / Ollama, BYO key) | Off |
| Subtitle Styling (font, size, color, background, position) | Off |
| Blue Light Filter (adjustable 10-80%) | Off |
| Focused Mode (hide everything except video + comments) | Off |
| Custom CSS Injection | Off |
| CPU Tamer (background tab timer throttling) | Off |
| Settings Profiles / Statistics Dashboard / Debug Mode | Off |
| Fit Player to Window | Off |

### Configurable Element Managers

Toggle individual elements on/off through the settings panel:

- **Action Buttons** — Like, Dislike, Share, Ask/AI, Clip, Thanks, Save, Sponsor, More Actions
- **Player Controls** — Next, Autoplay, Subtitles, Captions, Miniplayer, PiP, Theater, Fullscreen
- **Watch Elements** — Join Button, Ask Button, Save Button, Ask AI Section, Podcast Section, Transcript Section
- **Chat Elements** — Header, Menu, Popout, Reactions, Timestamps, Polls, Ticker, Leaderboard, Super Chats, Emoji, Bots

---

## Settings Panel

Click the gear icon in the YouTube masthead or player controls, or press **Ctrl+Shift+Y**.

- Searchable sidebar with categorized feature groups
- Toggle switches with instant apply
- Sub-feature controls for granular element hiding
- Textarea editors for keyword filters, quick links, custom CSS
- Export / Import / Reset
- Conflict detection (auto-disables conflicting features with toast notification)

The extension also has a standalone **Options Page** (`chrome://extensions` > Astra Deck > Details > Extension options) with storage stats, backup/restore, and a full settings editor modal.

---

## Architecture

```
document_start
  early.css          Anti-FOUC CSS (scoped to feature body classes)
  ytkit-main.js      MAIN world — canPlayType patching for codec/format filtering

document_idle
  core/*.js          ISOLATED world — env, storage, styles, url, page, navigation, player
  ytkit.js           ISOLATED world — all features, DOM manipulation, settings UI
  background.js      Service worker — fetch proxy, downloads, cookie bridge
```

- **Split-context model** — MAIN world for page API interception, ISOLATED world for extension APIs and DOM
- **SPA-aware** — hooks `yt-navigate-finish`, `yt-page-data-updated`, `popstate`, and `video-id` attribute changes
- **Tiered feature init** — critical features load synchronously, normal features in `requestAnimationFrame`, lazy features in `requestIdleCallback`
- **Crash recovery** — features that crash 3 times auto-disable with console warning
- **Conflict map** — 6 conflict pairs enforced at both toggle and init time
- **Trusted Types compliant** — all innerHTML via `TrustedHTML` policy wrapper
- **Safe mode** — append `?ytkit=safe` to any YouTube URL, or `ytkit.unsafe()` in console to exit

---

## Security

- **EXT_FETCH proxy** uses domain allowlist — blocks SSRF to private networks
- Request/response headers filtered (`Cookie`, `Set-Cookie`, etc. stripped globally; `Authorization` only forwarded to explicit BYO-key/local service origins such as OpenAI/Anthropic/Ollama/MediaDL)
- Response body capped at 10 MB, fetch timeout capped at 60s
- HTTP methods validated, download URLs protocol-checked (HTTP/S only)
- Quick Links blocks `javascript:`, `data:`, and `vbscript:` URIs
- Explicit CSP: `script-src 'self'; object-src 'self'`

---

## Compatibility

| Browser | Method | Status |
|---------|--------|--------|
| Chrome / Edge / Brave | Extension (MV3) | Fully supported |
| Firefox 128+ | Extension (MV3) | Fully supported |
| Chrome / Firefox | Tampermonkey / Violentmonkey | Supported (userscript) |
| Safari | Userscripts app | Limited |

**Not supported:** Mobile browsers, YouTube Music, YouTube Studio, embedded players.

---

## Building

```bash
npm ci
npm test
npm run check
npm run build                             # Build at current version
npm run build:userscript                  # Include userscript artifact
node build-extension.js --bump patch      # Bump and build
node build-extension.js --bump minor --with-userscript
```

Outputs in `build/`:
- `astra-deck-chrome-v*.zip` + `.crx` (CRX3 signed with `ytkit.pem`)
- `astra-deck-firefox-v*.zip` + `.xpi`
- `ytkit-v*.user.js` (with `--with-userscript`)

Requires Node 22+ (the `crx3` packager dependency needs it).

---

## Related

| Project | Description |
|---------|-------------|
| [MediaDL](https://github.com/SysAdminDoc/MediaDL) | Local download server (yt-dlp + ffmpeg) with one-click installer |
| [YoutubeAdblock](https://github.com/SysAdminDoc/YoutubeAdblock) | Standalone aggressive ad blocker with deeper proxy hooks |
| [Chapterizer](https://github.com/SysAdminDoc/Chapterizer) | Offline AI chapter generation via NLP |

---

## License

[MIT](LICENSE) — Matthew Parker
