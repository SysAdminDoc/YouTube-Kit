# YouTube Customization Suite

A powerful userscript for ultimate YouTube customization, allowing you to hide elements, control layout, and enhance your viewing experience. There is no other free userscript that can do what this can do.

## BETA: Working out small bugs, still adding additional features. Script is stable.

## Introduction

The YouTube interface, while functional, can often feel cluttered with features you don't use or lack options you wish you had. The **YouTube Customization Suite** was created to solve this problem by providing a single, comprehensive script to take back control. Its core purpose is to allow users to meticulously tailor their viewing experience, from decluttering the UI to automating common actions and redesigning page layouts. All features are modular and can be toggled on or off from a clean, integrated settings panel.

-----

## Features

The script is organized into logical groups of features.

### Feature Overview

#### **Header**
* Hide "Create" Button
* Hide Voice Search
* Logo Links to Subscriptions
* Widen Search Bar

#### **Sidebar**
* Hide Sidebar

#### **Themes**
* YouTube Native Dark Theme
* Better Full Dark Theme
* Squarify

#### **Progress Bar Themes**
* Nyan Cat Progress Bar

#### **General Content**
* Remove All Shorts Videos
* Redirect Shorts to Standard Player
* Make Subscriptions Full-Width
* 5 Videos Per Row
* Open Channel Pages on "Videos" Tab

#### **Watch Page - Layout**
* Fit Player to Window
* Hide Related Videos Sidebar
* Logo in Video Header
* Hide Video Description Row

#### **Watch Page - Behavior**
* SponsorBlock (Enhanced)
* Hide SponsorBlock Labels

#### **Watch Page - Action Buttons**
* Autolike Videos
* Replace with Cobalt Downloader
* Hide Action Buttons (Like, Dislike, Share, etc.)

#### **Player Enhancements**
* Add Loop & Screenshot Buttons

#### **Watch Page - Player Controls**
* Auto Max Resolution
* Use Enhanced Bitrate (for YouTube Premium)
* Hide Quality Popup
* Hide Player Controls (Next, Autoplay, Subtitles, etc.)

<img width="1235" height="1297" alt="Settings1" src="https://github.com/user-attachments/assets/d6d54b3c-da6e-4e77-b728-4cc7b1069e1e" />
<img width="1218" height="1323" alt="Settings2" src="https://github.com/user-attachments/assets/7a556743-c011-406d-914a-3d070ff6ab24" />
<img width="1203" height="1357" alt="Settings3" src="https://github.com/user-attachments/assets/69aa742e-1e6f-4ab9-b844-e453ec82aa95" />

### Core UI

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Settings Button** | Adds a settings cog icon to the YouTube interface. | Provides a consistent and easily accessible entry point to configure all script features without leaving the YouTube page. |

<img width="546" height="159" alt="SettingsMainPage" src="https://github.com/user-attachments/assets/a89be257-31f6-4195-bfef-26a77f1aeb29" />
<img width="1362" height="528" alt="Settings" src="https://github.com/user-attachments/assets/296b420f-c05e-424e-8e97-ec6374af4051" />

### Header

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Hide "Create" Button** | Hides the "Create" button (camera icon) in the main header. | Declutters the header for users who only consume content. |
| **Hide Voice Search** | Hides the microphone icon for voice search. | Removes a potentially unused button from the search bar. |
| **Logo Links to Subscriptions** | Changes the main YouTube logo's link to point to `/feed/subscriptions` instead of the homepage. | Provides one-click access to the subscriptions feed, a common destination for many users. |
| **Widen Search Bar** | Expands the search bar to fill more of the available space in the header. | Makes the search bar more prominent and easier to use, especially on wide screens. |

### Sidebar

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Hide Sidebar** | Completely removes the left sidebar (guide) and its hamburger menu toggle. | Maximizes horizontal space for content, creating a wider, more focused view. |

### Themes

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **YouTube Native Dark Theme** | Forces YouTube's built-in dark theme to be active at all times. | Ensures a consistent dark mode experience without needing to toggle it in YouTube's settings. |
| **Better Full Dark Theme** | Enhances the native dark theme with deeper blacks and more consistent coloring across all elements. | Provides a more polished and aesthetically pleasing dark mode that covers parts of the UI the native theme misses. |
| **Squarify** | Removes rounded corners from most UI elements like buttons, thumbnails, and avatars. | Gives the YouTube interface a sharper, more modern, and less "bubbly" appearance. |

### Progress Bar Themes

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Nyan Cat Progress Bar** | Replaces the standard red video progress bar with an animated Nyan Cat. | Adds a fun, nostalgic, and visually entertaining element to the video player. |

### General Content

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Remove All Shorts Videos** | Hides all YouTube Shorts from the homepage, subscriptions feed, and search results. | Allows users to completely opt out of the Shorts format if they prefer long-form content. |
| **Redirect Shorts to Standard Player** | Automatically opens any Shorts video in the normal, horizontal video player. | Provides a consistent viewing experience with familiar controls for all video content. |
| **Make Subscriptions Full-Width** | Expands the subscription grid to use the full available page width. | Displays more videos on screen at once, reducing the need for scrolling. |
| **5 Videos Per Row** | Changes the video grid layout to show 5 videos per row instead of the default 4. | Increases content density, allowing you to see more videos at a glance. |
| **Open Channel Pages on "Videos" Tab** | Automatically redirects all channel links (`/user/`, `/channel/`, `/@name`) to their `/videos` tab. | Skips the default "Home" or "Featured" tab, taking you directly to the creator's full list of uploads. |

### Watch Page - Layout

### Live Chat on side, full scaled video on the left.

<img width="3840" height="1776" alt="5row" src="https://github.com/user-attachments/assets/53520c93-132b-4c36-be8e-24cbd51014ec" />

### Full screen scrollable to show comments and the rest of the watch page.

<img width="3837" height="1689" alt="View" src="https://github.com/user-attachments/assets/b0e1a69a-ad2e-4250-95ff-aeaabb35d457" />

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Fit Player to Window** | Makes the video player fill the entire browser window, with the page content (comments, etc.) scrolling underneath it. | Creates an immersive, "true theater" mode that utilizes all available screen real estate. |
| **Hide Related Videos Sidebar** | Hides the entire right-hand sidebar containing related videos, live chat, and transcripts. | Creates a distraction-free viewing environment focused solely on the video and its primary metadata. |
| **Logo in Video Header** | Moves the YouTube logo (linking to subscriptions) into the video header next to the channel name. | Maintains key navigation while allowing the main site header to be hidden for a cleaner look. |
| **Hide Video Description Row** | Hides the entire description box below the video title, including views, date, and hashtags. | Maximizes vertical space for comments by removing the often lengthy description text block. |

### Watch Page - Behavior

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **SponsorBlock (Enhanced)** | Automatically skips or mutes various segments in videos (sponsors, intros, self-promotion) using the SponsorBlock API. | Saves time and removes interruptions by seamlessly skipping unwanted sections of videos. |
| **Hide SponsorBlock Labels** | Hides the labels (e.g., "sponsor", "poi") that appear next to the video title when a segment is detected by SponsorBlock. | Declutters the video title for a cleaner look while still benefiting from automatic segment skipping. |

### Watch Page - Action Buttons

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Autolike Videos** | Automatically clicks the "Like" button on videos from channels you are subscribed to. | Saves a click and automates support for your favorite creators. |
| **Replace with Cobalt Downloader** | Replaces the native Download button with a more powerful downloader powered by Cobalt. | Provides a feature-rich download menu for various formats (MP4, WEBM, MP3) and qualities, bypassing YouTube Premium restrictions. The Cobalt popup allows for on-the-fly format selection. |
| **Hide Action Buttons** | Hide Like, Dislike, Share, Clip, Thanks, Save, Join, and the "More actions" (...) buttons. | Allows for complete decluttering of the action bar below the video, hiding buttons you never use. |

### Player Enhancements

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Add Loop & Screenshot Buttons** | Adds three new buttons to the player controls: Loop, Save Screenshot, and Copy Screenshot. | Provides quick, one-click access to loop a video indefinitely or capture a frame without needing external tools or right-click menus. |

### Watch Page - Player Controls

| Name | What it does | How it improves the target interface |
| :--- | :--- | :--- |
| **Auto Max Resolution** | Automatically sets the video quality to the highest available resolution upon loading. | Ensures you are always watching in the best possible quality without manual adjustment. |
| **Use Enhanced Bitrate** | If max resolution is 1080p, this will attempt to select the "1080p Premium" option for higher bitrate. Requires YouTube Premium. | Improves visual fidelity for Premium users by automating the selection of the best available 1080p stream. |
| **Hide Quality Popup** | Prevents the quality settings menu from appearing visually when "Auto Max Resolution" is active. | Creates a seamless experience by hiding the menu flashes while the script works in the background. |
| **Hide Player Controls** | Hide the Next, Autoplay, Subtitles, Miniplayer, Theater, and Fullscreen buttons from the player overlay. | Simplifies the player interface by removing redundant or unwanted control buttons. |

-----

## Installation

### Prerequisites

  * A modern web browser like Chrome, Firefox, or Edge.
  * A userscript manager extension. The most popular options are:
      * **Tampermonkey** (Recommended)
      * Greasemonkey
      * Violentmonkey

### Step-by-step instructions

1.  Install a userscript manager from your browser's extension store.
2.  Install the script by navigating to its download URL: [**Click here to install**](https://github.com/SysAdminDoc/Youtube_Customization_Suite/raw/refs/heads/main/YouTube%20Customization%20Suite.user.js).
3.  Your userscript manager will intercept the request and show you an installation screen detailing what permissions the script needs.
4.  Confirm the installation. The script is now active and will run automatically on YouTube.

-----

## Usage

Once installed, the script runs automatically on all YouTube pages.

To configure the script, click the **Settings Cog** icon added to the YouTube UI.

  * On most pages (Homepage, Subscriptions, etc.), the cog appears in the header to the right of the YouTube logo.
  * On a video watch page, the cog appears below the video title, next to the channel's name.

Clicking this cog will open a modal panel where you can toggle every feature on or off. Changes are saved and applied instantly.

-----

## Configuration

All configuration is managed through the UI panel. There are no manual configuration files to edit. Your preferences are stored in your browser by the userscript manager.

### Core modules and their responsibilities

  * **Dynamic Content/Style Engine:** The script uses a `MutationObserver` to watch for page changes. Since YouTube is a Single-Page Application (SPA), content loads dynamically without a full page refresh. This engine ensures that all enabled features are correctly applied to new content as it appears.
  * **Settings Manager:** A simple module responsible for loading and saving the user's settings. It uses the `GM_getValue` and `GM_setValue` functions provided by the userscript manager to persist your configuration.
  * **Feature Definitions:** A central array (`features`) where every feature is defined as an object containing its ID, name, description, and `init()`/`destroy()` methods. This modular structure makes it easy to manage, add, or remove features.
  * **UI & Settings Panel:** The `buildPanel` function dynamically creates the settings panel HTML and CSS from the `features` array. This ensures the panel is always in sync with the available features.

-----

## API / Function Reference

These are key functions that drive the script's core logic.

| Function | Parameters | Return Value | Purpose within the extension |
| :--- | :--- | :--- | :--- |
| **`addNavigateRule(id, ruleFn)`** | `id` (String): Unique ID for the rule.\<br\>`ruleFn` (Function): Function to run on navigation events. | `void` | Adds a function that executes on YouTube's `yt-navigate-finish` event, ideal for actions on page changes in a SPA environment. |
| **`addMutationRule(id, ruleFn)`** | `id` (String): A unique identifier for the rule.\<br\>`ruleFn` (Function): The function to execute on DOM changes. | `void` | Adds a function to the `MutationObserver` engine. The `ruleFn` will be executed whenever a relevant DOM mutation is observed. |
| **`settingsManager.load()`** | *None* | `Promise<Object>` | Asynchronously loads the user's saved settings from storage, merging them with the default settings. |
| **`settingsManager.save(settings)`** | `settings` (Object): The settings object to save. | `Promise<void>` | Asynchronously saves the provided settings object to storage. |
| **`injectStyle(selector, featureId, isRawCss)`** | `selector` (String): A CSS selector or raw CSS code.\<br\>`featureId` (String): The ID of the feature this style belongs to.\<br\>`isRawCss` (Boolean): Flag indicating if the selector is raw CSS. | `HTMLElement` | Creates a `<style>` element and injects it into the document's head. Returns the element so it can be removed later. This is the primary mechanism for hiding UI elements. |
| **`_cobaltApiCall(...)`** | Various | `Promise<String\|null>` | A private function within the Cobalt feature that makes a POST request to the Cobalt API to get a direct download link for a video. |

-----

## Contributing

### How to report issues

  * Please report any bugs, issues, or feature requests by opening an issue on the [GitHub Issues](https://www.google.com/search?q=https://github.com/user/yt-enhancement-suite/issues) page.
  * When reporting a bug, please include:
      * A clear and descriptive title.
      * A detailed description of the problem and the steps to reproduce it.
      * Your browser and userscript manager version.
      * Any relevant errors from the browser's developer console.

### How to submit pull requests

1.  Fork the repository.
2.  Create a new branch for your feature or bugfix (e.g., `feature/add-new-button` or `fix/header-layout-issue`).
3.  Make your changes, adhering to the existing code style.
4.  Submit a pull request with a clear description of the changes you have made and why.

### Coding style guidelines

  * The project uses modern JavaScript (ES6+).
  * Follow the existing code formatting and patterns. The code is structured with clear, commented sections.
  * Ensure that new features are added to the `features` array and follow the established object structure (`id`, `name`, `description`, `init`, `destroy`).

-----

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for details. You are free to modify and distribute this script, but please provide attribution and never paywall it. My scripts are always free and open source.

-----

## Disclosure

This userscript is a third-party project and is not affiliated with, endorsed by, or in any way officially connected with YouTube or Google LLC. It is a personal project created for the purpose of customizing the user experience on the YouTube website. The script is provided "as-is," without any warranty of any kind, express or implied.
