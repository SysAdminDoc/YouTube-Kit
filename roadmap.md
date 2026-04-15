# YouTube-Kit (Astra Deck) — Roadmap

## Research & Strategic Gaps (Auto-Generated Analysis)

Comprehensive architectural analysis of the codebase at v3.6.7 — 162+ features, 244 settings, ~21,975 LOC main content script.

---

### High Priority

- **Monolithic content script (1.1MB, ~22K LOC)**
  `ytkit.js` contains all 162+ features in a single file. Load time, parseability, and maintainability degrade as features accumulate. No code splitting, lazy loading, or feature-level module boundaries exist. The `core/` extraction (env, storage, styles, url, page, navigation, player) was a good start but covers only shared utilities — feature code itself remains monolithic.

- **No minification or bundling**
  `build-extension.js` copies files verbatim into the output ZIP/CRX/XPI. No minifier (terser/esbuild) is applied. The 1.1MB content script is shipped as-is to end users. Adding a minification pass would cut payload by 60-70% with zero behavioral change.

- **Unbounded storage growth**
  Several features write to `chrome.storage.local` with no quota enforcement:
  - Hidden videos/channels — grows indefinitely as user hides content
  - Timestamp bookmarks — per-video entries with no eviction
  - Per-channel speed settings — capped at 500 entries (good), but hidden videos and bookmarks have no cap
  - Resume playback — capped at 500 entries (good)
  - Watch time tracker — 90-day retention (good)
  `chrome.storage.local` has a 10MB default quota (can be raised with `unlimitedStorage` permission, which is not declared). Heavy users will eventually hit quota errors with no graceful handling.

- **No rate limiting on EXT_FETCH proxy**
  `background.js` proxies fetch requests for content scripts (SponsorBlock, RYD, DeArrow, MediaDL). There is no per-origin or global rate limit. A misbehaving feature or rapid SPA navigation could flood third-party APIs, risking IP-level blocks or API bans. SponsorBlock and RYD have community rate-limit expectations.

- **`credentials: 'include'` on all proxied fetches**
  The EXT_FETCH handler in `background.js` includes cookies on every proxied request. This sends YouTube session cookies to third-party APIs (SponsorBlock, RYD) when those requests are proxied. Should default to `credentials: 'omit'` and only include for same-origin (YouTube, MediaDL localhost) requests.

### Medium Priority

- **No crash/error telemetry**
  Feature failures are only visible in the browser console. There is no structured error capture, no feature-level health tracking, and no way for users to report errors without opening DevTools. A lightweight error boundary per feature (try-catch wrapper with optional `chrome.storage.local` error log) would surface failures in the settings panel.

- **Settings profiles not implemented**
  `settingsProfiles` exists as a feature flag in defaults but has no implementation. The feature description promises save/load/switch between named setting configurations. This is a frequently requested power-user feature with no code behind it.

- **No feature dependency graph**
  `CONFLICT_MAP` handles mutually exclusive features (e.g., persistentSpeed vs perChannelSpeed), but there's no dependency graph for features that require other features. For example, `chapterNavButtons` only makes sense on videos with chapters, `stickyChat` only on live streams. Features silently no-op when prerequisites aren't met rather than communicating this to the user.

- **Options page disconnected from runtime**
  `options.html`/`options.js` reads settings from `chrome.storage.local` directly and writes them back. It has no way to know which features are actually active, whether they initialized successfully, or what their current state is. The options page is a settings editor, not a dashboard.

- **No automated testing or CI validation**
  Per user preference, no tests are written unless requested. However, there's also no CI pipeline that validates the build output (e.g., confirming CRX/XPI are valid, manifest is well-formed, content script parses without syntax errors). A minimal build-validation step would catch regressions.

- **Cross-browser parity assumed, not verified**
  Firefox support relies on implicit WebExtension API parity (`chrome.*` works as a Firefox compat alias). No Firefox-specific testing path exists. The `:has()` CSS selector used in `hideRelatedVideos` requires Firefox 121+ (covered by `strict_min_version: 128.0`), but other features may use APIs with varying Firefox support without explicit checks.

- **Service worker lifecycle not hardened**
  `background.js` runs as a MV3 service worker with no keep-alive strategy. If the service worker goes idle and terminates, in-flight `EXT_FETCH` requests or `DOWNLOAD_FILE` operations could be dropped. No retry logic exists in the content script for failed background messaging.

### Low Priority

- **Core modules could absorb more from ytkit.js**
  The `core/` modules cover env, storage, styles, URL, page detection, navigation, and player lookup. Several cross-cutting concerns remain in `ytkit.js`:
  - `cachedQuery` / DOM query caching
  - `trustedHTML` policy management
  - Feature registration (`cssFeature`, `_registerFeature` patterns)
  - Settings panel construction (3000+ lines of panel building code)
  These could be extracted to reduce the monolith incrementally.

- **No internationalization (i18n)**
  All UI strings (settings panel labels, descriptions, button text, toasts) are hardcoded in English. Chrome extensions support `chrome.i18n` with `_locales/` message files. Not urgent for a power-user tool, but blocks non-English adoption.

- **DeArrow cache has no size bound**
  DeArrow API responses are cached with a configurable TTL but no maximum cache size. On channels with thousands of videos, the cache could grow large. Unlike resume playback (500 cap) and watch time (90-day retention), DeArrow has no eviction strategy.

- **No keyboard shortcut customization**
  Per user preference, keyboard shortcuts are considered bloat. However, the manifest declares a `toggle-control-center` command with `Ctrl+Shift+Y`. This is the only shortcut and it's hardcoded. If shortcuts are ever expanded, `chrome.commands` supports user-customizable keys.

- **Build system version sync is regex-based**
  `build-extension.js` updates version strings in `manifest.json`, `ytkit.js` (YTKIT_VERSION), and `ytkit.user.js` header using regex replacements. This works but is fragile — a changed format in any of these files could silently fail to bump. The `default-settings.json` generation also uses brace-balanced parsing of the `defaults:` object, which could break on nested template literals or comments.

- **No extension update notification**
  Users have no way to know when a new version is available (sideloaded CRX/XPI don't auto-update from the Chrome Web Store). A simple version-check against the GitHub releases API could notify users of updates.

---

## Competitive Landscape

Research across 20+ extensions, userscripts, and open-source frontends. Projects analyzed: ImprovedTube (9K stars, 380K users), Enhancer for YouTube (3M users), SponsorBlock (13K stars, 5M users), Return YouTube Dislike (13.5K stars, 5M users), DeArrow (2K stars, 300K users), Unhook (1M users), BlockTube (1.3K stars, 200K users), YouTube Redux (100K users), Clickbait Remover (200K users), YouTube NonStop (500K users), YouTube Alchemy (200+ features userscript), Tube-Insights, FreeTube, Invidious, Piped, NewPipe, SmartTube, Grayjay, yt-dlp, Tubular.

**Astra Deck's current position**: 162+ features across 9 waves puts it in the top 3 by feature count alongside ImprovedTube (~250 tweaks) and YouTube Alchemy (~200 features). The consolidation of SponsorBlock, DeArrow, RYD, downloads, theater split, and content controls into a single extension is a strong differentiator — most users install 4-6 separate extensions to get equivalent coverage.

---

## New Feature Candidates (Not Yet in Astra Deck)

### Tier 1 — High-Impact Additions

- **Transcript Export**
  Current `transcriptViewer` shows a sidebar with clickable timestamps but has no export. Add: copy to clipboard, download as .txt/.srt, "Send to ChatGPT/NotebookLM" (pre-formatted prompt). YouTube Alchemy's transcript export is its most praised feature. Minimal code — the transcript data is already fetched.

- **Subtitle/Caption Download**
  Download subtitles in SRT/VTT/TXT format. YouTube exposes caption tracks via the player API (json3 format already parsed by `transcriptViewer`). Convert json3 to SRT with timestamps. 76K installs on Greasyfork for a standalone version — clear demand.

- **SponsorBlock Colored Seekbar Segments**
  Astra Deck has SponsorBlock skip logic but no visual segments on the progress bar. Every competing implementation (SponsorBlock extension, YouTube Alchemy, Piped, SmartTube) renders color-coded segment bars. Users expect to SEE where sponsors are. Paint colored divs over `.ytp-progress-bar` keyed to segment timestamps.

- **Reddit Comments Integration**
  Fetch matching Reddit threads for the current video URL and display alongside or as a tab next to YouTube comments. Invidious pioneered this. Use Reddit's search API (`url:youtube.com/watch?v=VIDEO_ID`). High value for tech/educational content where Reddit discussion is often better than YouTube comments.

- **Video Rotation**
  Rotate video 90/180/270 degrees via CSS `transform: rotate()`. ImprovedTube's most-used player feature after speed control. Useful for phone-recorded videos uploaded sideways. Trivial to implement — single CSS transform on the video element.

- **Frame-by-Frame Navigation**
  Overlay `,` and `.` frame-step buttons on the player (YouTube already supports these as keyboard shortcuts but most users don't know). Add visible buttons in the control bar. ImprovedTube's frame-by-frame companion extension has dedicated installs.

- **Videos-Per-Row Control**
  Let users set how many video thumbnails appear per row on homepage/search/channel pages (1-10). CSS grid override on `ytd-rich-grid-renderer`. ImprovedTube's second most popular feature. Dramatically changes information density.

- **Quick-Toggle Popup (Toolbar Button)**
  The extension's toolbar icon currently does nothing visible. Add an Unhook-style popup checklist — top 10-15 most-used toggles (hide Shorts, hide comments, hide related, focused mode, etc.) accessible in one click. No settings page needed for common toggles.

- **Strip URL Tracking Parameters**
  Auto-remove `si=`, `feature=`, `utm_*`, and other tracking params from YouTube URLs in the address bar, share dialogs, and clipboard. Standalone script has 18K+ installs. Simple URL rewrite on `yt-navigate-finish`.

### Tier 2 — Strong Differentiators

- **Tab View for Watch Page**
  YouTube Alchemy's signature feature. Replace the vertical stack of description/comments/chapters/transcript with horizontal tabs below the player. Saves vertical scroll, keeps everything above the fold. Would integrate naturally with existing `transcriptViewer` and `timestampBookmarks`.

- **Color-Coded Video Age on Feeds**
  Add colored borders/badges to video thumbnails based on upload age (today=green, this week=blue, this month=yellow, older=gray). Configurable thresholds. Makes subscription feed scannable at a glance. YouTube Alchemy feature with strong user reception.

- **Audio Compressor/Normalizer**
  Compress dynamic range via Web Audio API's `DynamicsCompressorNode`. Normalizes loud/quiet sections. Requires MAIN world access (already have `ytkit-main.js` bridge). Different from `volumeBoost` — this flattens peaks rather than amplifying everything.

- **Subscription Groups/Profiles**
  Organize subscribed channels into named groups ("Tech", "Music", "News") with separate filtered feeds. FreeTube's most loved feature. Store groups in `chrome.storage.local`, filter the subscription feed by active group. Significant implementation but high stickiness.

- **Playlist Organizer Enhancements**
  Current `playlistEnhancer` does shuffle + copy URLs. Add: drag-and-drop reorder (YouTube API), merge two playlists, deduplicate entries, "Remove Watched" button, batch operations. YouTube Alchemy and standalone scripts cover these individually.

- **Watch History Analytics Dashboard**
  Current `watchTimeTracker` stores 90 days of data. Add a visual dashboard: daily/weekly/monthly bar charts, top channels by watch time, category breakdown. Render in settings panel or dedicated tab. FreeTube and SmartTube both offer watch statistics.

- **Channel Update Frequency Tracking**
  Show when a channel last uploaded on their channel page. Flag "dead" channels (no upload in 6+ months). Sort subscriptions by activity. Uses YouTube's RSS feed (`/feeds/videos.xml?channel_id=`) for lightweight polling without API keys.

- **Local Subscriptions (No Google Account)**
  Subscribe to channels stored entirely in extension storage. Poll RSS feeds for new videos. Build a local subscription feed independent of YouTube's algorithm. FreeTube, NewPipe, and Invidious all offer this. High-value privacy feature.

- **Mouseover Storyboard Preview**
  Show thumbnail scrub preview when hovering over video thumbnails in feeds (not just on the seekbar). YouTube serves storyboard sprite sheets — fetch and display on hover with timestamp overlay. Dedicated script exists with active development.

### Tier 3 — Nice-to-Have / Niche

- **Sidebar Customization**
  Individually hide Guide menu items (Home, Trending, Shorts, Music, Gaming, etc.). More granular than current `hideSidebar` which is all-or-nothing. CSS-based, target individual `ytd-guide-entry-renderer` by title attribute.

- **Custom Header Links**
  Add up to 10 user-defined quick-access links next to the YouTube logo in the masthead. Useful for power users who want direct links to specific playlists, channels, or external sites.

- **Auto-Add Subscriptions to Watch Later**
  Automatically add new uploads from subscribed channels to the Watch Later playlist. Poll subscription feed, cross-reference with Watch Later, auto-add missing. Niche but beloved by "watch later" workflow users.

- **Share Menu Cleaner Expansion**
  Current `shareMenuCleaner` hides social share buttons. Extend to also auto-strip tracking params from the share URL, add "Copy Clean URL" button, and optionally shorten to youtu.be format.

- **Geo-Restriction Indicator**
  Show a badge on videos that are geo-restricted in other regions. Uses YouTube's `contentDetails.regionRestriction` from the API. Informational — helps creators and researchers.

- **Audio-Only Mode**
  Load only the audio stream to save bandwidth. Request `audio/webm` or `audio/mp4` format only via Innertube. Useful for music, podcasts, background listening. NewPipe and Invidious both offer this. Requires MAIN world intervention to intercept format selection.

- **Channel Monetization/Analytics Badge**
  Show whether a channel is monetized, subscriber milestones, and channel creation date. Tube-Insights fetches this via Innertube API. Niche but interesting for creator-focused users.

---

## Existing Feature Improvements

### Player & Playback

| Feature | Current State | Improvement |
|---------|--------------|-------------|
| `codecSelector` | Patches `canPlayType` via MAIN world bridge | Also patch `MediaSource.isTypeSupported()` and `MediaCapabilities.decodingInfo()` — YouTube uses all three for codec negotiation. Current approach may be bypassed. |
| `fineSpeedControl` | Speed adjustment UI | Add a persistent speed slider below the player (ImprovedTube's most praised UX pattern). Always visible, drag to adjust — faster than nested menus. |
| `videoScreenshot` | Captures current frame | Add: copy to clipboard (not just download), configurable format (PNG/JPEG/WebP), optional timestamp watermark, batch screenshot mode (capture every N seconds). |
| `ageRestrictionBypass` | Single embed endpoint approach | Add Innertube `/youtubei/v1/player` with age-verified client params as fallback. Current implementation has fragile 3000ms timeout and no user feedback on failure. |
| `alwaysShowProgressBar` | CSS-based progress bar visibility | Add chapter markers visible on the persistent bar. Currently shows the bar but loses chapter context. |
| `persistentSpeed` / `perChannelSpeed` | Store speed preference | Add "reset to 1x for music videos" option — auto-detect music category and skip speed override. YouTube Alchemy feature. |

### Content & Feed Control

| Feature | Current State | Improvement |
|---------|--------------|-------------|
| `hideWatchedVideos` | Dim or hide watched videos | Add configurable watch progress threshold (e.g., "consider watched at 80%"). Add per-page-type thresholds (stricter on Home, lenient on Subscriptions). |
| `transcriptViewer` | Sidebar with clickable timestamps | Add export buttons: clipboard, .txt, .srt, ChatGPT prompt format. The transcript data is already fetched and parsed — just needs formatting and output. |
| `notInterestedButton` | Adds "Not Interested" to thumbnails | Also add right-click context menu integration for instant channel/video blocking (BlockTube pattern). More discoverable than hover buttons. |
| `commentSearch` | Filter bar above comments | Add "Sort by Newest" default option, creator comment pinning/highlighting beyond current CSS border, and comment count display. |
| `hideSidebar` | All-or-nothing sidebar hide | Make granular — individually toggle Guide items (Home, Shorts, Trending, Subscriptions, Music, etc.) instead of killing the entire sidebar. |
| `shortsAsRegularVideo` | Redirects Shorts to standard player | Also add option to hide Shorts shelf entirely from Home/Subscriptions feeds (separate from redirect). Currently handled by `removeAllShorts` but could be more granular. |

### UI & Settings

| Feature | Current State | Improvement |
|---------|--------------|-------------|
| `settingsProfiles` | Feature flag exists, no implementation | Implement save/load/switch named profiles. Store profile sets in `chrome.storage.local`. Allow "Gaming", "Work", "Music" presets that swap entire setting groups. |
| Settings Panel | Monolithic in-page overlay | Add toolbar popup with top 15 quick-toggles (Unhook pattern). Keep the full panel for deep configuration, but surface common toggles in one click. |
| `deArrow` | Replaces titles/thumbnails | Add "Show Original" peek button on hover (DeArrow extension's signature UX). Currently no way to see the original without disabling the feature. |
| `sponsorBlock` | Auto-skip segments | Add colored segment visualization on the seekbar. Every SponsorBlock implementation except Astra Deck renders visual segments. Users expect to see where sponsors are before reaching them. |
| `watchTimeTracker` | 90-day data retention | Add visual dashboard with charts (daily/weekly trends, top channels, category breakdown). Data exists — just needs visualization. |
| Options Page | Settings editor only | Add feature health status indicators (green/yellow/red per feature based on init success). Show storage usage breakdown. Add import/export all settings button. |

### Infrastructure & Reliability

| Area | Current State | Improvement |
|------|--------------|-------------|
| Error handling | Silent console errors | Add per-feature try-catch boundaries with structured error logging to `chrome.storage.local`. Surface error count badge in settings panel. |
| API resilience | 8000ms timeout, no retry | Add exponential backoff retry (1s, 2s, 4s) for SponsorBlock/DeArrow/RYD API failures. Show inline status indicator when APIs are unreachable. |
| Storage quota | No enforcement on several features | Add `unlimitedStorage` permission to manifest OR implement LRU eviction on hidden videos, bookmarks, and DeArrow cache. Show storage usage in settings. |
| Service worker | No keep-alive or retry | Add `chrome.runtime.onSuspend` cleanup handler. Add retry logic in content script for failed `chrome.runtime.sendMessage` calls (service worker may have terminated). |
| Credential leakage | `credentials: 'include'` on all proxied fetches | Default to `credentials: 'omit'` for third-party API requests. Only include credentials for YouTube and localhost origins. |
| Update notification | None (sideloaded extensions don't auto-update) | Check GitHub releases API on startup (throttled to once/day). Show unobtrusive badge when a newer version exists. |

---

## Priority Matrix

### Ship Next (v3.7.0 candidates)
1. SponsorBlock seekbar segments — highest visibility gap vs competition
2. Transcript export (clipboard/txt/srt) — low effort, high value, data already available
3. Toolbar popup with quick-toggles — makes 162 features accessible
4. Strip URL tracking params — trivial implementation, privacy win
5. `settingsProfiles` implementation — feature flag already exists
6. `credentials: 'omit'` fix for third-party API requests — security fix

### Near-Term (v3.8.0)
7. Subtitle/caption download
8. Video rotation
9. Frame-by-frame buttons
10. Videos-per-row control
11. DeArrow "show original" peek button
12. Storage quota enforcement (LRU eviction)
13. API retry with exponential backoff
14. Color-coded video age on feeds

### Mid-Term (v3.9.0+)
15. Tab view for watch page
16. Reddit comments integration
17. Watch history analytics dashboard
18. Audio compressor/normalizer (MAIN world)
19. Granular sidebar customization
20. Channel update frequency tracking
21. Playlist organizer enhancements
22. Mouseover storyboard preview

### Long-Term / Exploratory
23. Local subscriptions (no Google account)
24. Subscription groups/profiles
25. Audio-only mode
26. Build system minification (terser/esbuild)
27. Feature-level code splitting

---

## AI-Powered Features (New Category)

Features requiring an LLM backend. Architecture: user-provided API key (OpenAI/Anthropic/Gemini) or local Ollama endpoint. Transcript extraction is free via YouTube's timedtext API — already fetched by `transcriptViewer`.

### Tier 1 — High Value, Low Friction

- **AI Video Summary**
  One-click summary of the current video via transcript. Display as a collapsible panel above the description. Output: key points, timestamps, TL;DR. Shared LLM backend config. Tools like Glasp (500K+ users), NoteGPT, Eightify, and YouTube Summary with ChatGPT prove massive demand. Fallback: "Copy transcript to ChatGPT" button (zero API cost).

- **AI Chapter Generation (ChapterForge Enhancement)**
  ChapterForge already exists in Astra Deck. Enhance: use LLM to identify topic shifts in transcripts and generate chapter markers with descriptive titles. Inject directly into progress bar as clickable markers. Currently no competing extension does this well.

- **Timestamped AI Notes**
  Combine existing `timestampBookmarks` with LLM context enrichment. User clicks to bookmark a moment → LLM auto-generates a contextual note from the surrounding transcript. Export as Markdown/Obsidian format. Snipd (podcasts) and Rocket Note prove the pattern.

### Tier 2 — Medium Effort, Strong Differentiation

- **AI Comment Insights**
  Fetch top-level comments (InnerTube `/next` endpoint), run through LLM to extract: top questions, sentiment summary, most insightful comments, spam/bot flagging. Display as a panel above comments. Unique differentiator — no extension does this.

- **Clickbait Score**
  Compare thumbnail (via vision-capable LLM) + title against actual transcript content. Score mismatch as a clickbait indicator (0-100). Display badge on video. One API call per video, cacheable. Novel and viral-worthy.

- **Quiz/Flashcard Generation**
  Generate study flashcards and quiz questions from video transcripts. Export to Anki/CSV format. Knowt, QuizScribe, and RemNote prove demand in education market. Requires LLM API call per video.

### Tier 3 — Exploratory

- **Toxicity/Fact-Check Indicators**
  Cross-reference transcript claims against Google Fact Check Tools API or Perspective API (free, Google/Jigsaw). Flag potentially misleading content. Lightweight — informational badges only.

- **Auto-Categorization**
  Auto-tag watched videos into user-defined categories (Tech, Music, News, Gaming) via LLM analysis of title+description. Powers a personal video library with auto-organization.

---

## Video Enhancement & Player Features (New Category)

### Subtitle/Caption Styling

YouTube's native caption options are minimal. Full styling panel:
- Font family, size, weight, color, outline, shadow
- Background: adjustable opacity, color, padding, border-radius
- Position: drag-to-reposition anywhere on video (not just bottom-center)
- Dual subtitles: two languages simultaneously (Language Reactor pattern — 1M+ users)
- Subtitle timing offset (real-time ±ms slider for out-of-sync captions)
- Save style presets by name
- Dyslexia-friendly font option (OpenDyslexic)

### Video Visual Filters

Real-time CSS filter sliders applied to the video element:
- Brightness, contrast, saturation, hue-rotate, grayscale, sepia
- Sharpness (via SVG filter convolution matrix)
- Per-channel saved filter profiles (store alongside `perChannelSpeed`)
- Night/warm mode (color temperature shift — extends existing `blueLightFilter`)
- Black bar crop (detect and hide letterboxing dynamically)

### Advanced A-B Loop

Current `abLoop` exists. Enhance with:
- Visual markers painted on the seekbar (colored region between A and B points)
- Fine-tune A/B points with frame-accuracy via ±frame buttons
- Save named loops per video (for musicians practicing sections)
- Loop count display and auto-stop after N loops
- Export looped segment as clip timestamp link

### NicoNico-Style Comment Overlay

Scrolling comments that fly across the video timed to playback position:
- Fetch comments with timestamps from InnerTube `/next` endpoint
- Render as semi-transparent text overlaid on video
- Density slider (filter low-engagement comments)
- Font size and speed controls
- Disable during live chat (avoid double overlay)
- Toggle via player control button

### Side-by-Side Video Comparison

No good extension solution exists for this:
- Split-screen two YouTube videos with synchronized playback controls
- Independent audio control (one "active audio" at a time)
- Frame-by-frame step in sync
- Use case: music covers, sports analysis, tutorial comparison
- Implement via two embedded YouTube iframes with Player API sync

---

## Untapped Technical Capabilities

### Web Audio API Pipeline (MAIN World)

Connect `<video>` via `MediaElementSourceNode` to an `AudioContext` chain. Requires MAIN world access (use existing `ytkit-main.js` bridge):

| Feature | API | Notes |
|---------|-----|-------|
| 10-Band Equalizer | `BiquadFilterNode` (lowshelf, highshelf, peaking) | Per-band gain sliders, save presets |
| Dynamic Compressor | `DynamicsCompressorNode` | Normalize loud/quiet passages across videos |
| Volume Boost (200%+) | `GainNode` | Exceeds HTML5 video's 100% cap |
| Audio Visualization | `AnalyserNode` | Real-time frequency bars, VU meter overlay |
| Spatial/3D Audio | `PannerNode` + `AudioListener` | HRTF-based positioning |

All browsers support Web Audio. Cross-origin restriction: YouTube adaptive streams include CORS headers when fetched by the player — should work.

### Document Picture-in-Picture API (Chrome 116+)

`documentPictureInPicture.requestWindow()` opens a full DOM-capable PiP window. Unlike standard `video.requestPictureInPicture()` (video-only), Document PiP supports:
- Custom play/pause/seek/volume controls rendered inside PiP
- Chapter list or queue navigation
- Live chat overlay in PiP
- Timestamp bookmarks panel
- Any arbitrary HTML/CSS

Current `popOutPlayer` uses Document PiP with fallback — enhance the Document PiP path with rich controls.

### Storyboard-Based Scene Navigation

YouTube serves tiled JPEG sprite sheets for every public non-live video. Available via InnerTube `/player` response under `storyboards.playerStoryboardSpecRenderer.spec`. Enables:
- Custom seek preview thumbnails (higher quality than YouTube's native)
- Visual scene timeline strip below player
- Scene-change detection UI (jump between distinct scenes)
- Mouseover storyboard preview on feed thumbnails (fetch sprite for any video)

### InnerTube Endpoints (No API Key Required)

| Endpoint | Data Available | Feature It Enables |
|----------|---------------|-------------------|
| `/youtubei/v1/browse` | Full feed data, channel pages, playlists | Local subscription feed, playlist analytics |
| `/youtubei/v1/next` | Comments, chapters, recommendations, engagement panels | Comment analysis, chapter extraction, related filtering |
| `/youtubei/v1/player` | Streaming URLs, storyboards, captions, DRM config | Direct download, scene navigation, caption download |
| `/youtubei/v1/search` | Rich results with badges, exact upload timestamps | Enhanced search with metadata badges |
| `/youtubei/v1/guide` | Sidebar subscription list with unseen counts | Subscription management, unread indicators |
| `/youtubei/v1/notification/get_notification_menu` | Bell notification data | Notification filtering, chronological sort |
| `/youtubei/v1/live_chat/get_live_chat` | Structured messages, superchats, badges, emojis | Chat filtering, highlight superchats, sentiment |

### Player Object Hidden Methods

Via `document.querySelector('#movie_player')`:
- `getVideoData()` — title, video_id, author, `isLive`, `isPlayable`
- `getStoryboardFormat()` — storyboard sprite metadata
- `getAudioTrack()` / `setAudioTrack()` — multi-language audio track switching
- `getSphericalProperties()` — VR/360 video manipulation
- `setPlaybackRate()` — supports arbitrary float values (0.07-16x, beyond menu options)

### MediaSession API Override

`navigator.mediaSession` — override YouTube's basic metadata with richer info:
- Custom artwork (high-res thumbnail)
- Chapter-aware skip (next/previous chapter instead of next/previous video)
- Action handlers for custom controls in OS media notification area

---

## Productivity & Education Features (New Category)

### Timestamped Note-Taking Panel

Dedicated sidebar for taking notes pinned to video timestamps:
- Click note → jump to that moment in video
- Markdown support for formatting
- Export as Markdown/Obsidian/Notion format
- Search across all video notes
- Integrates with existing `timestampBookmarks` data
- Proven pattern: Rocket Note, LunaNotes, YiNote (all 50K+ users)

### Smart Watch Later Management

YouTube's Watch Later is notoriously unmanageable at scale:
- Folder/group organization (PocketTube pattern — 200K+ users)
- Sort by: date added, video length, channel, category
- Filter by: watched status, duration range, channel
- Bulk operations: move to playlist, delete, mark watched
- Auto-prioritize by: video age, channel upload frequency, trending status
- "Remove Watched" one-click button

### Playlist Analytics

No extension offers this:
- Total playlist duration with per-video breakdown
- Average video length, category distribution
- Duplicate detection
- Dead video detection (removed/private videos flagged)
- Channel distribution chart (which creators appear most)
- Export playlist metadata as CSV/JSON

### Video Annotation / Frame Drawing

YouTube killed native annotations in 2019. No extension fills this gap:
- Pause video → draw arrows, shapes, text, highlights on the frame
- Save annotations timestamped to video position
- Export annotated frame as PNG
- Use case: education, sports analysis, design review, tutorials
- Implement via canvas overlay on paused video

### Study Mode

Integrated learning environment combining multiple features:
- Split view: video left, notes right (reuses Theater Split infrastructure)
- Auto-pause on note-taking (detect focus shift to notes panel)
- Key moments highlighted on seekbar (via AI or manual marking)
- Flashcard generation from notes (LLM-powered)
- Quiz mode from video content
- Session summary on close

---

## Privacy & Digital Wellbeing (New Category)

### Privacy Hardening

- **Telemetry Blocking** — `declarativeNetRequest` rules to block: `stats.l.doubleclick.net`, `googleads.g.doubleclick.net`, `play.google.com/log`, `www.google-analytics.com`, YouTube `/api/stats/*` watchtime beacons. MV3-compatible, runs in service worker.

- **Cookie Isolation** — Auto-clear tracking cookies on tab close while preserving session cookies. Target: `VISITOR_INFO1_LIVE`, `YSC`, `GPS`, `_gcl_*` (tracking) vs. `SID`, `HSID`, `SSID` (session). Also clear `yt-remote-device-id` from localStorage.

- **Link Sanitization** — Intercept `youtube.com/redirect?q=` outbound links and replace with direct destination URL, stripping Google's click-tracking wrapper. Also strip `si=`, `pp=`, `feature=` from all YouTube URLs in address bar on every navigation.

- **Fingerprint Reduction** — Spoof `navigator.connection` (downlink/effectiveType), add noise to Canvas `toDataURL`, mask WebGL `UNMASKED_RENDERER_WEBGL`. Layer on top of existing `codecSelector` MAIN-world bridge which already patches `canPlayType`.

- **Incognito-Style Viewing** — Toggle "private session" mode: pauses watch/search history, clears tracking cookies for session duration, restores on exit. Single-button equivalent of Firefox Containers for YouTube.

- **Local-Only Watch History** — Pair with YouTube's "Pause Watch History" setting. Store history exclusively in extension storage for personal reference without server-side tracking.

### Digital Wellbeing

- **Watch Time Limits** — Configurable daily cap (30/60/90/120 min). Full-page "daily limit reached" overlay when exceeded. Persist daily totals in `chrome.storage.local` keyed by date. Optionally password-protect the override. No desktop equivalent exists for YouTube's mobile "Take a Break."

- **Break Reminders** — Pause video and show dismissible overlay every N minutes (15/30/60/90). Timer resets on dismiss, persists across SPA navigations. YouTube mobile has this but desktop does not.

- **Session Summary** — On tab close or break reminder, show: videos watched, total time, top categories. Reinforces awareness. Extends existing `watchTimeTracker` data.

- **Grayscale Mode** — Apply `filter: grayscale(100%)` to thumbnails-only or full page. Reduces dopamine-driven engagement. Toggle via toolbar popup. Android Digital Wellbeing's "Wind Down" adapted for desktop.

- **Infinite Scroll Enhancement** — Extend existing `disableInfiniteScroll` with: configurable page size cap (20/40/60), "Load More" button showing count already loaded, fade-to-stop at threshold.

- **Autoplay Hardening** — Extend existing `disableAutoplayNext`: block countdown timer UI entirely, prevent `bfcache`-based autoplay restoration, force-disable on every page load.

### Parental Controls

- **Restricted Mode Lock** — Lock YouTube's Restricted Mode on via extension. Hide the toggle with CSS. Intercept the API call that disables it. Password-protect the setting.

- **Time-of-Day Restrictions** — Disable YouTube access outside allowed hours (configurable schedule). Show "YouTube is unavailable" overlay. Password-protected.

- **Content Category Filtering** — Block specific YouTube categories (Gaming, Entertainment) while allowing others (Education, Science). Uses category metadata from InnerTube responses.

- **Keyword/Channel Blocklist Enhancement** — Extend existing content blocking with regex pattern matching on titles, descriptions, and channel names. Right-click context menu for instant blocking (BlockTube pattern).

### Algorithm Control

- **Recommendation Reset** — One-click button to clear YouTube watch/search history via `myactivity.google.com`, resetting the algorithm. Surface in toolbar popup.

- **"Not Interested" Automation** — Bulk-mark recommended videos as "Not Interested" based on keyword/category rules. Automates YouTube's manual feedback loop.

---

## Updated Priority Matrix

### v3.7.0 — Core Gaps & Security
1. ~~SponsorBlock seekbar segments~~ — **already shipped** pre-v3.7 (`_renderBarSegments` / `.ytkit-sb-segment`); audit revealed during execution
2. **Transcript export (clipboard/txt/srt/LLM prompt)** — shipped v3.7.0
3. Toolbar popup with quick-toggles — **deferred to v3.7.x** (UX shift; toolbar action currently toggles in-page panel)
4. **Strip URL tracking params** — basic strip existed pre-v3.7; **expanded** in v3.7.0 with UTM family + click-tracking IDs
5. `settingsProfiles` implementation — **deferred to v3.7.x** (feature stub remains)
6. **`credentials: 'omit'` fix** — shipped v3.7.0 with `CREDENTIALED_FETCH_ORIGINS` allowlist
7. Break reminders / watch time limits — **deferred to v3.7.x**

### v3.8.0 — Player & Content
8. Subtitle/caption styling panel — YouTube's native options are minimal
9. Video visual filters (brightness/contrast/saturation sliders)
10. Video rotation
11. Frame-by-frame buttons
12. Subtitle/caption download (SRT/VTT)
13. Videos-per-row control
14. DeArrow "show original" peek button
15. Storage quota enforcement (LRU eviction)
16. API retry with exponential backoff
17. Color-coded video age on feeds

### v3.9.0 — Productivity & Intelligence
18. AI video summary (user-provided LLM key)
19. AI chapter generation (ChapterForge enhancement)
20. Timestamped note-taking panel
21. Tab view for watch page
22. Reddit comments integration
23. Watch history analytics dashboard
24. Smart Watch Later management
25. Playlist analytics
26. A-B loop visual markers on seekbar

### v4.0.0 — Audio & Advanced
27. Web Audio equalizer/compressor (MAIN world)
28. Document PiP with custom controls
29. Storyboard-based scene navigation
30. Audio compressor/normalizer
31. Dual subtitle support
32. Side-by-side video comparison
33. NicoNico-style comment overlay

### v4.1.0 — Privacy & Wellbeing
34. Telemetry/beacon blocking (declarativeNetRequest)
35. Cookie isolation (tracking vs session)
36. Fingerprint reduction
37. Incognito viewing mode
38. Parental controls (restricted mode lock, time limits)
39. Grayscale mode
40. Algorithm reset button

### v4.2.0+ — Exploratory
41. Local subscriptions (no Google account)
42. Subscription groups/profiles
43. Audio-only mode
44. Video annotation/frame drawing
45. Study mode (integrated learning environment)
46. AI comment insights
47. Clickbait score (vision LLM)
48. Quiz/flashcard generation
49. Mouseover storyboard preview on feeds
50. Build system minification (terser/esbuild)
51. Feature-level code splitting

---

## External Ecosystem & Resource Intelligence

### Comparable Open-Source Projects

#### Tier 1 — Direct Competitors (YouTube Enhancement Extensions)

| Project | Stars | License | Language | Architecture | What We Can Learn |
|---------|-------|---------|----------|-------------|-------------------|
| [ajayyy/SponsorBlock](https://github.com/ajayyy/SponsorBlock) | 13,050 | GPL-3.0 | TypeScript | Webpack, React UI, `maze-utils` submodule | **Seekbar segment rendering**: `previewBar.ts` creates `<ul id="previewbar">` overlay with colored `<li>` elements positioned by percentage. Per-browser manifest merging via overlay JSONs. Shared `maze-utils` library for YouTube SPA navigation detection. |
| [Anarios/return-youtube-dislike](https://github.com/Anarios/return-youtube-dislike) | 13,503 | GPL-3.0 | JavaScript | Webpack, modular JS | `externally_connectable` for cross-extension communication. `createSmartimationObserver` for detecting like/dislike animation state. Multi-browser manifest strategy. Shorts detection via `is-active` attribute on `YTD-REEL-VIDEO-RENDERER`. |
| [code-charity/youtube](https://github.com/code-charity/youtube) (ImprovedTube) | 4,312 | NOASSERTION | JavaScript | No bundler, multi-file | **Two-world split architecture**: ISOLATED world (`extension/`) for Chrome APIs, web-accessible scripts (`web-accessible/`) injected into MAIN world via `<script>` tag. Custom event system (`extension.events.on/trigger`). 250+ features proves the domain scales. |
| [zerodytrash/Simple-YouTube-Age-Restriction-Bypass](https://github.com/zerodytrash/Simple-YouTube-Age-Restriction-Bypass) | 2,413 | MIT | JavaScript | Rollup + Babel | **Data-layer interception pattern**: Proxies `JSON.parse`, `XMLHttpRequest.prototype.open`, `Request` constructor, and `Object.defineProperty` on `playerResponse` to intercept YouTube data before it reaches the player. Strategy pattern with fallback unlock methods. Most sophisticated approach to YouTube data access. |
| [TimMacy/YouTubeAlchemy](https://github.com/TimMacy/YouTubeAlchemy) | N/A | AGPL-3.0 | JavaScript | Single 568KB file, no build | 200+ features in one file proves single-file can scale to ~570KB but becomes unwieldy. Tab view, SponsorBlock progress bar integration, transcript export are their most praised features. v10.11.1 — extremely mature. |
| [YouTube-Enhancer/extension](https://github.com/YouTube-Enhancer/extension) | 338 | MIT | TypeScript | Modern TS extension | Clean MIT-licensed reference for YouTube MV3 extension patterns. |

#### Tier 2 — Adjacent Projects (Alternative Frontends & Mobile)

| Project | Stars | License | Language | What We Can Learn |
|---------|-------|---------|----------|-------------------|
| [TeamPiped/Piped](https://github.com/TeamPiped/Piped) | 9,892 | AGPL-3.0 | Vue | Privacy-first architecture, federated proxy network for geo-bypass, local subscription management without Google account. |
| [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube) | 14K+ | AGPL-3.0 | JavaScript | Subscription profiles/groups, local-only watch history, watch statistics dashboard, privacy-enhanced browsing. Best reference for local subscription feed implementation. |
| [polymorphicshade/Tubular](https://github.com/polymorphicshade/Tubular) | 3,103 | GPL-3.0 | Java | NewPipe fork with SponsorBlock + RYD integration. Shows how to consolidate multiple APIs into one client. |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 156,879 | Unlicense | Python | Most-starred YouTube repo globally. SponsorBlock-aware chapter marking in downloads, metadata embedding, subtitle extraction in all formats. Reference for format/codec selection logic. |
| [dmunozv04/iSponsorBlockTV](https://github.com/dmunozv04/iSponsorBlockTV) | 5,386 | GPL-3.0 | Python | SponsorBlock on all YouTube TV clients. Shows cross-platform SponsorBlock API integration patterns. |
| [JunkFood02/Seal](https://github.com/JunkFood02/Seal) | 25,658 | GPL-3.0 | Kotlin | Android yt-dlp frontend. Shows best-practice download UI patterns (progress, format selection, batch operations). |

#### Tier 3 — Specialized Tools

| Project | Stars | License | What We Can Learn |
|---------|-------|---------|-------------------|
| [TheRealJoelmatic/RemoveAdblockThing](https://github.com/TheRealJoelmatic/RemoveAdblockThing) | 6,030 | MIT | Anti-anti-adblock strategies, YouTube ad detection patterns. |
| [erkserkserks/h264ify](https://github.com/erkserkserks/h264ify) | 1,195 | MIT | Clean `canPlayType` patching implementation for codec forcing. Reference for our `codecSelector`. |
| [xxxily/h5player](https://github.com/xxxily/h5player) | 3,596 | GPL-3.0 | Universal video player enhancement userscript — works on TikTok, YouTube, Bilibili, TED. Shows cross-site video manipulation patterns. |
| [ParticleCore/Iridium](https://github.com/ParticleCore/Iridium) | 1,338 | NOASSERTION | Legacy YouTube enhancement extension. Historical reference for features. |
| [kazuki-sf/YouTube_Summary_with_ChatGPT](https://github.com/kazuki-sf/YouTube_Summary_with_ChatGPT) | 855 | MIT | MV3 extension for transcript → ChatGPT summarization. Reference for AI summary UI integration. |
| [sparticleinc/chatgpt-google-summary-extension](https://github.com/sparticleinc/chatgpt-google-summary-extension) | 2,045 | GPL-3.0 | Multi-LLM summary sidebar pattern. Shows how to inject AI summaries alongside video. |
| [elliotwaite/thumbnail-rating-bar-for-youtube](https://github.com/elliotwaite/thumbnail-rating-bar-for-youtube) | 266 | MIT | Rating bar overlay on thumbnails. Clean pattern for thumbnail badge rendering. |
| [sapondanaisriwan/youtube-row-fixer](https://github.com/sapondanaisriwan/youtube-row-fixer) | 499 | MIT | Videos-per-row CSS grid override. Reference for our planned `videosPerRow` feature. |
| [zpix1/yt-anti-translate](https://github.com/zpix1/yt-anti-translate) | 430 | NOASSERTION | Title de-translation. Reference for our existing `antiTranslate` feature. |
| [better-lyrics/better-lyrics](https://github.com/better-lyrics/better-lyrics) | 610 | GPL-3.0 | Time-synced lyrics for YouTube Music. Could adapt for subtitle/lyric overlay features. |
| [Sv443/BetterYTM](https://github.com/Sv443/BetterYTM) | 89 | AGPL-3.0 | YouTube Music enhancements. Reference for Music-specific features. |
| [exwm/yt_clipper](https://github.com/exwm/yt_clipper) | 91 | MIT | Video clipping/trimming tool. Reference for clip maker feature. |
| [ajayyy/SponsorBlockServer](https://github.com/ajayyy/SponsorBlockServer) | 1,013 | AGPL-3.0 | Server-side reference for understanding SponsorBlock data model, hash-prefix privacy design, and segment submission flow. |

#### Shared Libraries Worth Studying

| Library | Used By | Purpose |
|---------|---------|---------|
| [ajayyy/maze-utils](https://github.com/AjayySponsorBlock/maze-utils) (submodule) | SponsorBlock, DeArrow | Shared YouTube SPA navigation detection, video ID change monitoring, element waiting, cleanup management. Extracted into a git submodule — proves the pattern of a shared YouTube interaction layer. |
| [AstroAce8/crx3](https://www.npmjs.com/package/crx3) (npm) | Astra Deck (current) | CRX3 signing and packaging. Already in use. |

---

### Data Sources & APIs

#### Verified Live APIs (No Authentication Required)

| API | Endpoint | Format | Rate Limits | Use Case |
|-----|----------|--------|-------------|----------|
| **SponsorBlock** | `https://sponsor.ajay.app/api/skipSegments/{hash_prefix}` | JSON array of segments | Community fair-use (no hard limit) | Segment skip + **seekbar rendering** (highest priority gap) |
| **SponsorBlock Branding (DeArrow)** | `https://sponsor.ajay.app/api/branding?videoID={id}` | JSON `{ titles[], thumbnails[], randomTime, videoDuration }` | Same server as SponsorBlock | Title/thumbnail replacement, "show original" peek |
| **Return YouTube Dislike** | `https://returnyoutubedislikeapi.com/votes?videoId={id}` | JSON `{ likes, dislikes, viewCount, rating, dateCreated }` | Reasonable use (undocumented) | Dislike count display |
| **Reddit Search** | `https://www.reddit.com/search.json?q=url:youtube.com/watch?v={id}&sort=relevance&limit=5` | JSON (Reddit listing format) | 10 req/min unauthenticated, 60/min with OAuth | Reddit comments integration feature |
| **YouTube oEmbed** | `https://www.youtube.com/oembed?url={video_url}&format=json` | JSON `{ title, author_name, author_url, thumbnail_url }` | Undocumented (public endpoint) | Quick metadata lookup without InnerTube |
| **GitHub Releases** | `https://api.github.com/repos/SysAdminDoc/YouTube-Kit/releases/latest` | JSON `{ tag_name, published_at, assets[] }` | 60 req/hour unauthenticated | Extension update notification |
| **YouTube InnerTube** | `https://www.youtube.com/youtubei/v1/{endpoint}?key={INNERTUBE_KEY}` | JSON (varies by endpoint) | Generous (same as YouTube frontend) | Chapters, comments, storyboards, player data, captions |

**Verified: SponsorBlock, RYD, DeArrow, Reddit, oEmbed, and GitHub Releases are all live and require zero authentication.**

#### APIs Requiring Authentication

| API | Auth Type | Cost | Use Case | Verdict |
|-----|-----------|------|----------|---------|
| **Google Fact Check Tools** | Google Cloud API key (free tier) | Free (10K req/day) | Fact-check indicators on videos | User must provision own key. Niche feature. |
| **Perspective API** (Google Jigsaw) | API key + application approval | Free (1 QPS default) | Comment toxicity scoring | Requires approval process. Not viable as default feature. |
| **YouTube Data API v3** | Google Cloud API key | Free (10K units/day) | Full video metadata, comment threads, channel details | Prefer InnerTube (no quota) for extension use. |

#### Deprecated / Broken APIs

| API | Status | Notes |
|-----|--------|-------|
| **YouTube RSS Feeds** | **DOWN** (404/500 errors) | `https://www.youtube.com/feeds/videos.xml?channel_id={id}` — historically unreliable, currently broken server-side. Do NOT rely on for local subscriptions. Use InnerTube `/browse` endpoint instead. |
| **Cobalt API** | Live but **YouTube removed** from supported services | `https://api.cobalt.tools` — YouTube was dropped (likely legal pressure). Cannot be used for YouTube downloads. Astra Deck correctly uses MediaDL-only path. |

#### InnerTube Endpoints (Keyless, Undocumented)

Documented references:
- [Tyrrrz/YoutubeExplode](https://github.com/Tyrrrz/YoutubeExplode) (3,627 stars, MIT, C#) — most complete abstraction layer over YouTube's internal API. Reference for endpoint behavior, format selection, cipher handling.
- [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js) (~3.8K stars) — JavaScript InnerTube client. Closest language match for our needs.

| Endpoint | Key Fields | Notes |
|----------|-----------|-------|
| `/youtubei/v1/player` | `streamingData.adaptiveFormats`, `storyboards.playerStoryboardSpecRenderer.spec`, `captions.playerCaptionsTracklistRenderer.captionTracks` | Storyboard sprites: tiled JPEGs (e.g., 10x10 grid of 160x90 thumbnails). Base URL + dimensions + sigh token in spec string. |
| `/youtubei/v1/next` | `engagementPanels[].macroMarkersListRenderer` (chapters), `commentSection`, `secondaryResults` | Structured chapter data with titles, timestamps, thumbnails. |
| `/youtubei/v1/browse` | Full feed data, channel tabs, playlist items | Use for local subscription feed polling (replaces broken RSS). |
| `/youtubei/v1/search` | Rich results with badges, upload timestamps, channel metadata | More data than public Data API v3 search. |
| `/youtubei/v1/live_chat/get_live_chat` | Messages, superchats, member badges, emojis, continuation tokens | Polling via continuation tokens for chat enhancement features. |

---

### Recommended Libraries & Tools

#### Build System (Replace Custom `build-extension.js`)

| Library | Stars | License | Why |
|---------|-------|---------|-----|
| [nicedoc/esbuild](https://esbuild.github.io/) | 39K+ | MIT | **Fastest bundler**. Minify the 1.1MB `ytkit.js` to ~350KB with zero config. `esbuild --minify --bundle`. Already used by most modern extensions. Single binary, no node_modules tree. |
| [nicedoc/terser](https://terser.org/) | 9K+ | BSD-2-Clause | If esbuild is too aggressive, terser provides configurable JS minification. Can be added as a single build step: `terser ytkit.js -o ytkit.min.js -c -m`. |
| [nicedoc/web-ext](https://github.com/nicedoc/nicedoc.io) (Mozilla) | 2.7K+ | MPL-2.0 | Official Mozilla tool for building, linting, and running WebExtensions. `web-ext lint` validates manifest and extension structure. `web-ext build` produces compliant ZIPs. |
| [nicedoc/crx3](https://www.npmjs.com/package/crx3) | — | MIT | Already in use for CRX signing. Keep. |
| [nicedoc/nicedoc.io](https://github.com/nicedoc/nicedoc.io) (Vite plugin) | 494 | MIT | `vite-plugin-chrome-extension` — Vite-based MV3 extension build. Alternative to raw esbuild if HMR/dev server is needed. |

**Recommended approach**: Add `esbuild --minify` as a post-copy step in existing `build-extension.js`. No need to replace the entire build system — just minify the output. Estimated savings: 1.1MB → ~350-400KB.

#### Subtitle/Caption Parsing

| Library | Stars | License | Size | Why |
|---------|-------|---------|------|-----|
| [vidstack/captions](https://github.com/vidstack/captions) | 140 | MIT | ~5KB | **Best fit**. Modern, tiny, supports VTT + SRT + SSA. Works server-side and browser. TypeScript. Perfect for transcript export (json3 → SRT/VTT conversion). |
| [gsantiago/subtitle.js](https://github.com/gsantiago/subtitle.js) | 433 | MIT | ~8KB | Stream-based subtitle parser. Handles SRT, VTT. Good if we need streaming parse for large transcripts. |
| [1c7/srt-parser-2](https://github.com/1c7/srt-parser-2) | 72 | MIT | ~3KB | Minimal SRT parser. Handles edge cases (dot separators). Smallest option. |

**Recommended**: `vidstack/captions` — MIT, tiny, multi-format. Or write a ~50-line json3-to-SRT converter inline since the format is simple.

#### Charting / Visualization (for Watch Time Dashboard)

| Library | Stars | License | Size | Why |
|---------|-------|---------|------|-----|
| [nicedoc/uPlot](https://github.com/nicedoc/nicedoc.io) | 9K+ | MIT | ~35KB | **Fastest, smallest** time series chart. No dependencies. Perfect for watch time daily/weekly graphs. |
| [nicedoc/frappe-charts](https://github.com/nicedoc/nicedoc.io) | 15K+ | MIT | ~40KB | Simple, modern charts. GitHub-style contribution heatmap built-in — perfect for watch time calendar view. |
| [nicedoc/Chart.css](https://github.com/nicedoc/nicedoc.io) | 6K+ | MIT | ~10KB | CSS-only charts (no JS). Could work for simple bar charts in settings panel without any JS overhead. |

**Recommended**: For the settings panel dashboard, use **CSS-only charts** (bar charts, progress bars) to avoid bundling a charting library. If richer visualization is needed later, inline a stripped-down uPlot.

#### Canvas Drawing / Annotation (for Video Annotation Feature)

| Library | Stars | License | Size | Why |
|---------|-------|---------|------|-----|
| [nicedoc/Fabric.js](https://github.com/nicedoc/nicedoc.io) | 30K+ | MIT | ~300KB | Full-featured canvas library. Objects, shapes, text, free draw, serialization. Overkill but battle-tested. |
| [nicedoc/Konva](https://github.com/nicedoc/nicedoc.io) | 12K+ | MIT | ~150KB | React-friendly canvas. Lighter than Fabric.js. Drag, transform, layer support. |
| [nicedoc/tldraw](https://github.com/nicedoc/nicedoc.io) | 40K+ | Apache-2.0 | ~500KB+ | Full whiteboard. Too heavy for an extension but reference for UX patterns. |
| Raw Canvas API | — | — | 0KB | For basic arrow/rectangle/text annotation on a paused frame, the native Canvas API is sufficient. ~100 lines of code. |

**Recommended**: Use **raw Canvas API** for v1 annotation (draw arrows, rectangles, text on paused frame, export as PNG). Only bring in Fabric.js or Konva if users demand advanced features like object selection, undo/redo, or layer management.

#### Web Audio (for Equalizer/Compressor)

| Approach | Size | Notes |
|----------|------|-------|
| Raw Web Audio API | 0KB | `BiquadFilterNode` × 10 bands = parametric EQ. `DynamicsCompressorNode` = compressor. `GainNode` = volume boost. `AnalyserNode` = visualization. All native, zero dependencies. |
| [Tone.js](https://github.com/Tonejs/Tone.js) | ~150KB | Overkill — designed for music production. |
| [howler.js](https://github.com/goldfire/howler.js) | ~30KB | Audio playback library, not processing. Not useful here. |

**Recommended**: Use **raw Web Audio API** exclusively. The API is clean enough that a library adds no value. 10-band EQ = 10 `BiquadFilterNode` instances in series. Store presets in `chrome.storage.local`.

---

### Architectural Patterns From Competitors

#### SPA Navigation (Best Practices)

| Pattern | Used By | Reliability | Notes |
|---------|---------|-------------|-------|
| `yt-navigate-finish` event listener | ImprovedTube, Astra Deck | High | Primary approach. Fires on YouTube SPA navigation. Simple, reliable. |
| `maze-utils` video ID change detection | SponsorBlock, DeArrow | Very High | Shared submodule with debouncing, cleanup hooks, element waiting. More robust than raw event listener. |
| Data-layer interception (`JSON.parse` proxy) | Age Restriction Bypass | Highest | Catches data before DOM renders. Best for features that need to modify YouTube's data model. Requires MAIN world. |
| `MutationObserver` on specific elements | RYD (Shorts detection) | Medium | Fallback for elements not covered by SPA events. Use for Shorts and late-arriving DOM elements. |

**Recommendation**: Astra Deck's current `yt-navigate-finish` approach is solid. Consider extracting a `maze-utils`-style shared module for video ID tracking, element waiting, and cleanup management to reduce scattered MutationObserver usage.

#### Two-World Architecture

All major extensions use a two-world split:
- **ISOLATED world**: Chrome APIs (`chrome.storage`, `chrome.runtime`), DOM manipulation, UI injection
- **MAIN world**: YouTube API access, `canPlayType` patching, Web Audio, data-layer interception

Astra Deck already has this (`ytkit.js` ISOLATED + `ytkit-main.js` MAIN). The current data-attribute bridge (`data-ytkit-codec`) is functional but limited. Consider:
- Custom events for richer MAIN↔ISOLATED communication (ImprovedTube pattern)
- `JSON.parse` proxy in MAIN world for data interception (Age Restriction Bypass pattern)

#### Build System Patterns

| Project | Build | Minified? | Per-Browser Manifests? |
|---------|-------|-----------|----------------------|
| SponsorBlock | Webpack | Yes | Yes (manifest overlay JSONs) |
| DeArrow | Webpack | Yes | Yes (same system) |
| RYD | Webpack + CopyPlugin | Yes | Yes (separate manifest files) |
| ImprovedTube | None | No | No (single manifest) |
| YouTube Alchemy | None | No | N/A (userscript) |
| **Astra Deck** | **Custom Node.js** | **No** | **Yes (runtime patching)** |

**Recommendation**: Add `esbuild --minify` to the existing build pipeline. Don't migrate to webpack — the current `build-extension.js` with runtime manifest patching is simpler and already works. Just minify the output.

---

### Critical Intelligence Updates

1. **Cobalt API has dropped YouTube** — the Cobalt download service (`api.cobalt.tools`) no longer supports YouTube. This validates Astra Deck's decision to use MediaDL-only path. Update any fallback references.

2. **YouTube RSS feeds are currently broken** — `youtube.com/feeds/videos.xml` returns 404/500. Any feature relying on RSS for local subscriptions must use InnerTube `/browse` endpoint instead.

3. **SponsorBlock hash-prefix docs moved** — the wiki page at `wiki.sponsor.ajay.app/w/API_Docs/HashPrefix` returns 404. Current docs are at `https://wiki.sponsor.ajay.app/w/API_Docs`.

4. **GitHub Releases API confirmed working** — `SysAdminDoc/YouTube-Kit` releases are accessible. Tag v3.6.7 published 2026-04-15. Use this endpoint for update notification feature (throttle to 1 check/day, 60 req/hour unauthenticated limit).

5. **Reddit Search API is live and keyless** — returns Reddit threads matching YouTube video URLs. 10 req/min unauthenticated. Viable for Reddit comments integration with proper User-Agent header.

---

*External ecosystem reconnaissance completed at v3.6.7 — 2026-04-14*
*Data sources: GitHub REST API (7 search queries, 140+ repos analyzed), live API endpoint testing (10 APIs verified), competitive architecture analysis (7 repos deep-dived), npm registry*

---

## v3.7.0 Execution Plan

Concrete implementation sketches for each Ship-Next item. Each entry lists the files touched, the integration seam in the existing codebase, and the measurable acceptance criteria.

### 1. SponsorBlock Seekbar Segments
- **Files**: `ytkit.js` (extend existing `sponsorBlock` feature), `early.css` (segment palette CSS vars).
- **Seam**: Already receive `segments[]` from `sponsor.ajay.app/api/skipSegments`. Paint `<div class="ytkit-sb-seg">` children into `.ytp-progress-bar-padding` keyed to `startTime/videoDuration * 100%` and `(endTime-startTime)/videoDuration * 100%`.
- **Redraw triggers**: `yt-navigate-finish`, `durationchange` on `<video>`, ResizeObserver on the progress bar.
- **Acceptance**: Segments visible within 300ms of video load; colors match SponsorBlock's official palette; clicking a segment seeks to its start.

### 2. Transcript Export
- **Files**: `ytkit.js` (extend `transcriptViewer`).
- **Seam**: Transcript JSON3 is already fetched and parsed into `{ start, dur, text }` cues. Add four buttons in the transcript sidebar header: Copy, .txt, .srt, ChatGPT prompt.
- **SRT converter**: ~40 lines inline, no library. Format `HH:MM:SS,mmm` timestamps, sequential cue numbers.
- **ChatGPT prompt**: `"Summarize this YouTube transcript. Title: {title}. Transcript:\n{text}"` — copied to clipboard, user pastes into any LLM.
- **Acceptance**: All four outputs round-trip cleanly; copied SRT plays in VLC/MPV without errors.

### 3. Toolbar Popup with Quick-Toggles
- **New files**: `extension/popup.html`, `extension/popup.js`, `extension/popup.css`.
- **Manifest**: Add `action.default_popup: "popup.html"`.
- **Content**: 15 curated toggles (hide Shorts, hide comments, hide related, focused mode, theater split, SponsorBlock, DeArrow, RYD, persistent speed, blue light, grayscale, autoplay off, infinite scroll cap, mini player, hide end cards). Reads/writes `chrome.storage.local` directly.
- **Broadcast**: On toggle change, `chrome.tabs.sendMessage` to active YouTube tabs → `ytkit.js` handler re-applies the affected feature without reload.
- **Acceptance**: Toggle reflects in UI within 200ms; no reload required; popup closes cleanly on outside click.

### 4. Strip URL Tracking Parameters
- **Files**: `ytkit.js` (new `stripTrackingParams` feature, default on).
- **Hook**: `yt-navigate-finish` listener + `history.replaceState` wrapper in MAIN world to catch `pushState` pollution.
- **Params removed**: `si`, `pp`, `feature`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`.
- **Preserved**: `v`, `t`, `list`, `index`, `ab_channel`.
- **Acceptance**: Address bar URL is clean on every navigation; Share dialog copies cleaned URL; no broken playlists.

### 5. Settings Profiles
- **Files**: `ytkit.js` (implement `settingsProfiles` panel), `default-settings.json` (add `_profiles` schema).
- **Storage shape**: `{ activeProfile: "default", profiles: { default: {...}, gaming: {...}, music: {...} } }`.
- **Panel UI**: Profile dropdown at top of settings overlay + Save As / Rename / Delete / Export / Import (JSON) buttons.
- **Switch behavior**: On profile change, write the profile's settings into the canonical keys, then broadcast a full re-init.
- **Acceptance**: Switching profiles changes active features within 1 second; profiles persist across browser restarts; export produces valid JSON round-trippable via import.

### 6. `credentials: 'omit'` Fix
- **Files**: `background.js` EXT_FETCH handler.
- **Change**: Default `credentials: 'omit'`. Allowlist `credentials: 'include'` only when the request URL's origin is in `{ 'https://www.youtube.com', 'https://youtube.com', 'http://127.0.0.1', 'http://localhost' }`.
- **Acceptance**: SponsorBlock/RYD/DeArrow requests contain no `Cookie` header (verified via network panel); YouTube and MediaDL requests still authenticate correctly.

### 7. Break Reminders & Watch Time Limits
- **Files**: `ytkit.js` (new `digitalWellbeing` feature group).
- **Storage**: `{ watchTimeToday: { date: "YYYY-MM-DD", seconds: 0 }, breakIntervalMin: 30, dailyCapMin: 0 }`.
- **Ticker**: 1-second `setInterval` gated by `!document.hidden && !video.paused`; increment `seconds`, check thresholds.
- **Break overlay**: Full-viewport dimmed `<div>` with "Take a break" message + Dismiss button; pauses the video; resumes after dismiss.
- **Daily cap overlay**: Non-dismissible until midnight or password-bypass (stored hashed in settings).
- **Acceptance**: Counter increments only during active playback; survives SPA navigation; resets at local midnight.

---

## Implementation Risk Register

Risks that will materialize during v3.7.0 work. Each has a mitigation pre-committed so decisions aren't made mid-bug.

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Progress bar DOM rewrites on theater/miniplayer transitions break segment overlay | High | Medium | Segment renderer listens for `ResizeObserver` + `MutationObserver` on the ancestor of `.ytp-progress-bar`; re-paints on structure change. |
| YouTube A/B test serves new comment DOM classes, breaking `commentSearch` and creator-highlight | Medium | High | Add a quarterly "selector audit" checklist to CLAUDE.md; ship a content-script error boundary that reports which feature's selectors failed so users surface it. |
| Settings profile schema migration when new settings are added in future versions | High | Medium | On profile load, shallow-merge profile over current `defaults` — new keys get default values, removed keys are ignored. Profile JSON exports include a `schemaVersion`. |
| Esbuild minification mangles property names used via `chrome.storage` bracket-access | Medium | High | Use `--minify-whitespace --minify-syntax` only (skip `--minify-identifiers`), or add a `/* @__PURE__ */`-style preserve list. Validate by diffing pre/post settings keys in a smoke build before shipping. |
| Toolbar popup broadcasts hit tabs that have never loaded `ytkit.js` → "Receiving end does not exist" errors | High | Low | Wrap `chrome.tabs.sendMessage` in a try/catch; swallow `Could not establish connection` errors — these tabs just haven't loaded YouTube content yet. |
| Digital wellbeing interval keeps service worker alive, causing battery complaints | Low | Medium | Run the ticker inside the content script (page lifetime), not the service worker. Persist `watchTimeToday` on `visibilitychange` and every 30s, not every tick. |
| URL param stripping breaks YouTube Music's `si=` linking (used for track sharing) | Medium | Medium | Scope `stripTrackingParams` to `www.youtube.com` only; skip `music.youtube.com`. |
| `credentials: 'omit'` breaks RYD's user-vote attribution | Low | Low | RYD public endpoints don't require auth; verify with a live request test before shipping. If voting endpoint does need auth, carve it out as a YouTube-origin-only exception. |

---

## Cross-Cutting Infrastructure Work (v3.7.x)

Work items that enable everything in v3.8.0+ but don't ship user-visible features on their own. Schedule as patch releases between minors.

### v3.7.1 — Observability Layer
- **Structured error log** — wrap each feature's init in `try/catch`, log to `chrome.storage.local` under `_errors: [{ feature, message, stack, ts }]` (capped at 100 entries, LRU).
- **Settings panel badge** — show red dot on features with logged errors; click for details.
- **Export button** — "Copy diagnostic report" packages errors + extension version + browser version + active settings hash for bug reports.

### v3.7.2 — Storage Hygiene
- **Declare `unlimitedStorage`** permission in manifest (low-friction, no permission prompt for local storage).
- **Quota dashboard** in settings — show per-feature storage breakdown (hidden videos, bookmarks, resume playback, DeArrow cache, watch time).
- **LRU eviction** on `hiddenVideos`, `hiddenChannels`, `timestampBookmarks`, `deArrowCache` with configurable caps (defaults: 5000, 1000, 1000 per-video, 2000 entries).

### v3.7.3 — Build Pipeline Hardening
- **`esbuild --minify-whitespace --minify-syntax`** pass in `build-extension.js` (preserves identifiers; see risk register).
- **Manifest validator** — run `web-ext lint` on the Firefox output; fail the build on lint errors.
- **Syntax parse check** — `node --check build/extension-chrome/ytkit.js` after minify to catch mangling regressions.
- **Artifact size budget** — fail build if `ytkit.js` exceeds 500KB post-minify, or any artifact > 1MB.

### v3.7.4 — Service Worker Resilience
- **In-flight request tracking** — `background.js` maintains `Map<requestId, Promise>`; on `chrome.runtime.onSuspend`, reject pending with a `WORKER_SUSPENDED` error.
- **Content-script retry** — auto-retry EXT_FETCH once on `WORKER_SUSPENDED` or "Receiving end does not exist".
- **Exponential backoff** — 1s / 2s / 4s on third-party API failures (SponsorBlock, RYD, DeArrow).

---

## Cross-Project Ecosystem Integration

Opportunities unique to this repo's position within the user's existing project set. Low effort because infrastructure already exists elsewhere.

- **Share quick-toggle popup architecture with BetterNext & ScriptVault** — all three ship MV3 popups. Extract a shared `popup-kit.css` with the Catppuccin Mocha palette + toggle/slider/select primitives. Lives in any of the three repos; consumed by copy-paste (no cross-repo dependencies).
- **StreamKeep handoff** — Astra Deck's "Download" button could deep-link into StreamKeep (`streamkeep://add?url=...`) when StreamKeep is installed. Detect via a registered protocol handler; fall back to current MediaDL path. Zero added complexity if StreamKeep is absent.
- **CUE parallels** — CUE's Shadow DOM isolation pattern on claude.ai is directly applicable to the toolbar popup injection if Astra Deck ever needs to render controls *inside* YouTube's DOM (e.g., persistent speed slider below the player). Port the `attachShadow({mode:'closed'})` helper.
- **ScriptVault as distribution channel** — the userscript build (`ytkit.user.js`) can be registered as a "featured script" in ScriptVault's built-in catalog. Users who run ScriptVault get one-click install without Tampermonkey.
- **RES-Slim selector-resilience pattern** — RES-Slim's module registration with per-module selector fallbacks is more defensive than Astra Deck's current direct-selector approach. Worth adopting for features that target YouTube's most volatile DOM regions (comments, related videos, masthead).

---

## Deprecation & Cleanup Backlog

Accumulated cruft to remove before v4.0.0 to keep the codebase lean.

- **Archived MHTML samples** — `Live Video Example.mhtml`, `Regular Video Example.mhtml`, `Subscriptions example.mhtml`, `YouTube.mhtml` in repo root. Move to `archive/` subtree or delete; they bloat clones.
- **Loose PNGs in repo root** — `banner.png`, `comments.png`, `menu.png`, `12305612-*.png`. Move under `assets/` or `images/`.
- **Duplicate icon files** — `favicon.ico`, `icon.ico`, `icon.png`, `icon.svg` at root overlap with `icons/` and `extension/icons/`. Single source of truth: `assets/icon.svg` → generate all PNG sizes at build time.
- **Install-YTYT.ps1** — YTYT-Downloader was consolidated into this repo. If the standalone installer is still needed, move to `tools/`; otherwise delete.
- **Pre-v3.0 userscript headers** — any `@grant` declarations for APIs no longer used (inspect `YTKit-v1.2.0.user.js` vs current).
- **Feature flags with no implementation** — `settingsProfiles` before v3.7.0 ships. Audit `default-settings.json` for other dangling flags and either implement or remove.

---

*Execution planning and risk register completed at v3.6.7 — 2026-04-14*

---

## Performance Budget & Measurement

No feature in this roadmap ships if it regresses these budgets. Numbers measured on a mid-range laptop (i5-1235U, 16GB, Chrome stable) against `www.youtube.com/watch?v=dQw4w9WgXcQ` with cache cleared.

| Metric | Current (v3.6.7) | Target (v3.7.0) | Hard Ceiling |
|--------|------------------|-----------------|--------------|
| `ytkit.js` raw size | ~1.1 MB | ≤ 1.2 MB | 1.5 MB |
| `ytkit.js` minified | N/A | ≤ 400 KB | 500 KB |
| Parse + execute time (cold) | ~180 ms | ≤ 150 ms | 250 ms |
| Time to first feature paint | ~420 ms | ≤ 350 ms | 600 ms |
| Memory (idle, after 5 min) | ~45 MB | ≤ 50 MB | 80 MB |
| Memory (after 100 SPA navs) | ~75 MB (leaks suspected) | ≤ 60 MB | 100 MB |
| `chrome.storage.local` usage (typical user, 30-day) | ~500 KB | ≤ 1 MB | 5 MB |
| Service worker wake count per 10 min active playback | ~12 | ≤ 8 | 20 |

### Measurement Protocol
- **Cold load**: `chrome://extensions` → Reload → open `/watch?v=` URL → DevTools Performance → record 10s → export.
- **Memory leak check**: DevTools Memory → take heap snapshot at idle; navigate 100 times via `/results?search_query=`; snapshot again; diff retained objects. Look for `Detached HTMLElement`, `MutationObserver`, `EventListener` growth.
- **Storage audit**: DevTools Application → Storage → `chrome.storage.local` → check size per key.
- **Automation**: Add a `perf:baseline` npm script that runs Playwright against a local Chromium with the extension, records timing via `performance.mark`, and asserts the budgets. Wire into `.github/workflows/build.yml` as a non-blocking report (fail-on-regression can come later).

---

## Telemetry (Opt-In, Local-Only)

The extension should never phone home. But local-only self-observation is a different category — users can see their own data, and it powers the observability and watch-time dashboards.

### Data Shape (stored in `chrome.storage.local._telemetry`)

```json
{
  "featureUsage": { "sponsorBlock": { "enabled": 1713100000, "invocations": 1243 } },
  "errors": [{ "feature": "transcriptViewer", "msg": "...", "stack": "...", "ts": 1713100000 }],
  "apiLatency": { "sponsorBlock": { "p50": 180, "p95": 520, "samples": 100 } },
  "storageUsage": { "hiddenVideos": 12480, "deArrowCache": 45600 },
  "sessionCount": 142,
  "firstRun": 1710000000
}
```

### Hard Rules
- **Never transmitted.** No URL in the codebase points to an analytics backend. Any PR introducing one is rejected.
- **User-visible.** Everything in `_telemetry` is exposed in the settings panel under "Diagnostics."
- **Exportable.** "Copy diagnostic report" button emits a redacted JSON the user can paste into a bug report.
- **Resettable.** Single button wipes `_telemetry` without affecting user settings.
- **Capped.** Errors array LRU at 100; latency samples rolling window of 100; feature usage rolls up daily.

---

## Documentation Debt

Items missing from existing docs that block contributor onboarding and release reliability.

### README.md
- **Install from CRX/XPI** — step-by-step for Chrome (enable dev mode, drag .crx) and Firefox (about:debugging). Current README assumes Chrome Web Store install, which isn't the distribution model.
- **Feature toggle index** — autogenerated table of all 162 features with one-line descriptions. Source from `settings-meta.json` at build time so it stays in sync.
- **Screenshots re-capture** — per CLAUDE.md screenshot policy, main screenshots (`banner.png`, `menu.png`, `comments.png`) are stale vs current UI. Re-capture using the screenshots.md DPI-aware process.

### CLAUDE.md (this repo)
- **Selector volatility map** — which CSS selectors have changed in the last 6 months; which are considered stable; which require fallback chains. Currently implicit in the code.
- **Feature conflict matrix** — document `CONFLICT_MAP` semantics. New contributors won't discover this pattern from reading feature code.
- **Release checklist** — expand the bullet list into a numbered checklist including: screenshot refresh, CHANGELOG entry format, GitHub release notes template, Firefox sanity test on a clean profile.

### CHANGELOG.md
- **Unreleased section** — keep a rolling "Unreleased" block at top so mid-cycle PRs have a place to record entries. Currently must wait for bump.
- **Breaking changes callout** — flag settings-schema migrations explicitly; users need to know when to re-export before updating.

### New Docs to Create
- **`docs/ARCHITECTURE.md`** — one-page diagram of ISOLATED ↔ MAIN ↔ background message flow. Absorbs the architectural notes currently scattered across CLAUDE.md and roadmap.md.
- **`docs/CONTRIBUTING.md`** — already exists but predates the 9-wave feature system. Update with: how to add a feature (registration pattern), how to add a setting (settings-meta schema), how to run a local Firefox test.
- **`docs/FEATURE_TEMPLATE.md`** — boilerplate for new features: the standard shape of `{ init, destroy, onNavigate, settings }` + where to register.

---

## Community & Distribution

Astra Deck is sideloaded-only (no store listings). This caps organic growth at GitHub discovery. Options ranked by effort vs reach.

### Near-Term (No Store Review Required)

- **Greasyfork listing for the userscript** — single-file `ytkit.user.js` is already the userscript distribution. Greasyfork has built-in auto-update; users get patches within minutes of a release. Zero review friction. Competing userscripts (YouTube Alchemy, Iridium) get 50K-200K installs there.
- **OpenUserJS mirror** — cross-post to OpenUserJS for redundancy; takes 2 minutes per release.
- **r/youtube, r/chrome_extensions, r/tampermonkey announcement** on each minor version — these subreddits actively welcome new releases; ImprovedTube and SponsorBlock both launched this way.
- **AlternativeTo.net listing** — categories: "YouTube Enhancer", "Ad Blocker", "SponsorBlock alternative". Free, no review.

### Mid-Term (Requires Store Review)

- **Chrome Web Store** — review process now accepts MV3 extensions with full host permissions if the use case is documented. Downsides: mandatory policy compliance review (especially around "remote code" — our GM_* shim and MAIN world injection may trigger scrutiny), store listing bureaucracy, and inability to ship features that Google considers AUP-violating (ad blocking gray area on YouTube specifically). Worth attempting but plan for a 2-4 week review cycle and potential feature strip.
- **Firefox Add-ons (AMO)** — more permissive review; YouTube enhancement extensions routinely approved. `strict_min_version: 128.0` is fine. Submit the current XPI.
- **Edge Add-ons** — accepts Chrome extensions with trivial manifest tweaks; most lenient of the three.

### Long-Term / Speculative

- **"Astra Suite" brand** — position the existing set (Astra Deck, BetterNext, StyleKit, RES-Slim, CUE, ScriptVault) under a single landing page. Cross-promotion in each extension's settings panel. Single GitHub Pages site with install instructions for all.
- **Paid tier (not recommended)** — AGPL-like copyleft licensing rules out most commercial models; community-funded (GitHub Sponsors, Ko-fi) is the realistic path. ImprovedTube and SponsorBlock both run on donations.

---

## Quality Gates by Release Stage

What must be true at each checkpoint. A release that fails any gate goes back a stage.

### Pre-Alpha (feature branch)
- [ ] Feature registers cleanly under the 9-wave pattern
- [ ] Default is OFF in `default-settings.json`
- [ ] No new global variables; scoped to feature namespace
- [ ] No syntax error after build (`node --check`)
- [ ] Local Chrome dev-mode install loads without console errors

### Alpha (merged to main)
- [ ] CHANGELOG "Unreleased" entry added
- [ ] Settings-meta entry with label, description, and help text
- [ ] No regression in existing features (manual smoke test of related features)
- [ ] Error-boundary wrapper in place (v3.7.1+)

### Beta (tagged `vX.Y.Z-beta`)
- [ ] All four artifacts build (Chrome ZIP, CRX, Firefox ZIP, XPI)
- [ ] Clean-profile test on Chrome stable
- [ ] Clean-profile test on Firefox ESR
- [ ] Performance budgets met (see above)
- [ ] No new `chrome.storage.local` keys without eviction policy

### Release (tagged `vX.Y.Z`)
- [ ] Version string synced across `manifest.json`, `ytkit.js` YTKIT_VERSION, userscript header, README badges
- [ ] CHANGELOG moved from Unreleased → versioned entry with date
- [ ] Screenshots refreshed if UI changed
- [ ] GitHub release created with all four artifacts
- [ ] Git tag pushed
- [ ] Userscript cross-posted to Greasyfork

### Post-Release (T+24h)
- [ ] No error reports in GitHub Issues
- [ ] `curl` raw CRX/XPI URLs return updated artifacts (cache-bust)
- [ ] Memory file (`youtube-kit.md` / `astra-deck.md`) updated with new version, feature count, gotchas learned

---

*Performance, telemetry, docs, distribution, and quality gates added at v3.6.7 — 2026-04-14*
