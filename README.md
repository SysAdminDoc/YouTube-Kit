# YouTube Customization Suite
A browser extension for extensively customizing the YouTube user interface, from layout adjustments to hiding specific elements.

***

## Introduction
The YouTube Customization Suite is a comprehensive userscript designed to give users granular control over their YouTube viewing experience. Frustrated with cluttered interfaces, unwanted content sections, and missing features, this script was created to put power back into the hands of the user. It allows you to selectively hide UI elements, automate common actions, and reorganize layouts to create a cleaner, more efficient, and personalized YouTube.

All features are managed through a clean, floating settings panel, making it easy to toggle functionalities on the fly without needing to edit the code.

***

## Features
The suite is organized into several categories, each containing specific, toggleable features.

### Core UI
1.  **Name**: Floating Settings Button
2.  **What it does**: Adds a floating gear icon to the corner of the page.
3.  **How it improves the target interface**: Provides a persistent, easy-to-access entry point to configure all the suite's features directly on the YouTube page.
4.  **Example usage**: Simply click the gear icon to open or close the settings panel.

### Header
1.  **Name**: Hide "Create" Button
2.  **What it does**: Hides the "Create" button (video upload icon) in the main YouTube header.
3.  **How it improves the target interface**: Declutters the header for users who primarily consume content rather than upload it.
4.  **Example usage**: Toggle the "Hide 'Create' Button" switch in the settings panel.
    
---
1.  **Name**: Hide Voice Search Button
2.  **What it does**: Hides the microphone icon for voice search next to the search bar.
3.  **How it improves the target interface**: Removes an uncommonly used button to simplify the search area.
4.  **Example usage**: Toggle the "Hide Voice Search Button" switch in the settings panel.
    
---
1.  **Name**: Logo Links to Subscriptions
2.  **What it does**: Changes the main YouTube logo's link to direct to the `/feed/subscriptions` page instead of the homepage.
3.  **How it improves the target interface**: Allows users who primarily watch content from their subscriptions to bypass the algorithm-driven homepage, creating a more direct workflow.
4.  **Example usage**: Toggle the "Logo Links to Subscriptions" switch. Once enabled, clicking the YouTube logo in the header will navigate to your subscriptions feed.

### Sidebar
1.  **Name**: Hide Sidebar
2.  **What it does**: Completely removes the left-hand sidebar (guide) and its corresponding menu button.
3.  **How it improves the target interface**: Maximizes horizontal screen real estate for video content by removing the entire sidebar navigation column.
4.  **Example usage**: Toggle the "Hide Sidebar" switch. The script will first collapse the sidebar to allow the main content to expand, then hide it from view.

### General Content
1.  **Name**: Remove All Shorts Videos
2.  **What it does**: Hides all Shorts videos and Shorts-related shelves across YouTube.
3.  **How it improves the target interface**: Allows users to completely filter out the Shorts content format from their feeds (Home, Subscriptions, Search, etc.) for a traditional video-only experience.
4.  **Example usage**: Enable the "Remove All Shorts Videos" toggle.
    
---
1.  **Name**: Make Subscriptions Full-Width
2.  **What it does**: Expands the video grid on the subscriptions page to use the full available width of the content area.
3.  **How it improves the target interface**: Removes the restrictive centered layout on the subscriptions feed, allowing more content to be displayed, which works especially well with the "5 Videos Per Row" feature.
4.  **Example usage**: Toggle the "Make Subscriptions Full-Width" switch.
    
---
1.  **Name**: 5 Videos Per Row
2.  **What it does**: Modifies the CSS of video grids to display five videos per row instead of the default four.
3.  **How it improves the target interface**: Increases content density on grid pages like the homepage and subscriptions feed, allowing users to see more videos without scrolling.
4.  **Example usage**: Enable the "5 Videos Per Row" toggle.

### Watch Page - Layout
1.  **Name**: Fit Player to Window
2.  **What it does**: Makes the video player expand to fill the entire browser window, with the rest of the page content (comments, related videos) scrolling underneath.
3.  **How it improves the target interface**: Creates an immersive, "cinema-like" viewing mode that doesn't require entering full-screen, allowing you to scroll down to read comments while the video continues to play in a large format.
4.  **Example usage**: Toggle the "Fit Player to Window" switch on a video watch page.
    
---
1.  **Name**: Hide Related Videos Sidebar
2.  **What it does**: Hides the entire right-hand sidebar on the watch page, which contains related videos and live chat. Includes an optional sub-setting to expand the video to fill the newly available space.
3.  **How it improves the target interface**: Provides a less distracting viewing experience by removing the endless feed of recommended videos.
4.  **Example usage**: Enable the "Hide Related Videos Sidebar" toggle. You can then enable the "Expand video to full width" sub-setting that appears.

### Watch Page - Other Elements
* **Hide Merch Shelf**: Removes the merchandise shelf below the video.
* **Hide Description Extras**: Hides extra content below the description like transcripts and podcast links.

### Watch Page - Action Buttons
* **Autolike Videos**: Automatically "likes" videos from channels you are subscribed to.
* **Hide Like/Dislike Button**: Hides the like and/or dislike buttons.
* **Hide Share/Download/Sponsor/More Buttons**: Hides various action buttons below the video title.

### Watch Page - Player Controls
* **Auto Max Resolution**: Automatically sets the video quality to the highest available resolution upon loading.
* **Hide Player Buttons**: Provides individual toggles to hide the "Next," "Autoplay," "Subtitles," "Miniplayer," "Theater Mode," and "Fullscreen" buttons within the video player's control bar.

***

## Installation

### Prerequisites
* A modern web browser such as Chrome, Firefox, or Edge.
* A userscript manager browser extension. Popular options include:
    * [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
    * Greasemonkey
    * Violentmonkey

### Step-by-step instructions
1.  Install a userscript manager from your browser's extension store.
2.  Click on the userscript manager's icon in your browser toolbar and select "Create a new script...".
3.  Delete the boilerplate code provided in the editor.
4.  Copy the entire code from the `YouTube Customization Suite.user.js` file.
5.  Paste the code into the userscript manager's editor.
6.  Save the script (usually via a "File" -> "Save" menu or a save icon). The script is now installed and active on YouTube.

***

## Usage
Once installed, the script runs automatically on YouTube pages.

* **Accessing Settings**: To configure the script, look for a floating gear icon ⚙️ in the bottom-left corner of any YouTube page. Clicking this icon will open the **YouTube Customization Suite** settings panel.
* **Toggling Features**: Inside the panel, all features are grouped by category. Simply click the toggle switch next to any feature to enable or disable it. Changes are applied instantly.
* **Closing Settings**: To close the panel, either click the "Close" button, click on the dark overlay outside the panel, or click the gear icon again.

***

## Configuration
All configuration is handled through the graphical user interface. The script stores your settings in your browser using the userscript manager's storage.

* **Storage Key**: Your preferences are saved under the key `ytSuiteSettings`.
* **Defaults**: If no settings are found, a default configuration is loaded. You can see these defaults in the `settingsManager.defaults` object in the script file.

### Core modules and their responsibilities
* **Dynamic Content Engine**: A `MutationObserver`-based system that watches for changes in the YouTube DOM. This allows rules (like hiding Shorts) to be re-applied as you navigate through the site without requiring a page refresh.
* **Settings Manager**: Handles loading and saving user preferences via `GM_getValue` and `GM_setValue`. It also manages the default state of all features.
* **Feature Definitions**: A central array of objects where each feature is defined with its ID, name, description, group, and its `init()` (initialization) and `destroy()` (cleanup) logic.
* **UI Builder**: A set of functions that dynamically generate the settings panel, its groups, and the toggle switches based on the `features` array.

***

## Contributing
Contributions are welcome! Please follow these guidelines to help keep the project organized and maintainable.

### How to report issues
* Before creating an issue, please search existing issues to see if your problem has already been reported.
* Use the "Bug Report" template if available.
* Provide a clear and descriptive title.
* Include the following information in your report:
    * The version of the script you are using.
    * Your browser and userscript manager versions.
    * A detailed description of the bug and the steps to reproduce it.
    * What you expected to happen vs. what actually happened.
    * Any relevant screenshots or error messages from the browser console (F12).

### How to submit pull requests
1.  **Fork the repository** and create a new branch from `main`: `git checkout -b my-feature-branch`.
2.  Make your changes, adhering to the project's coding style.
3.  Ensure your code is well-commented, especially in complex areas.
4.  Update the version number in the UserScript header if you are adding a new feature or making a significant fix.
5.  Submit a pull request with a clear description of the changes you've made and why.

### Coding style guidelines
* The project follows standard modern JavaScript conventions.
* Use descriptive variable and function names.
* Keep functions focused on a single responsibility.
* Comment on complex logic to clarify its purpose.

***

## License
This project is licensed under the **MIT License**.

Copyright (c) 2025 Matthew Parker

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. It shall remain free and open source software for all.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

***

## Disclosure
This userscript ("Software") is an independent project and is not affiliated with, sponsored by, endorsed by, or in any way associated with YouTube or its parent company, Google LLC. The name "YouTube" and the YouTube logo are trademarks of Google LLC. This Software is provided for personal, educational, and customization purposes only.
