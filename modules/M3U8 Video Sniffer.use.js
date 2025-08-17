// ==UserScript==
// @name         M3U8 Video Sniffer
// @version      1.5.0
// @description  Automatically detects M3U8 video streams and MP4 files on the current page, providing an easy way to copy their URLs or download them directly.
// @description:en  Automatically detects M3U8 video streams and MP4 files on the current page, providing an easy way to copy their URLs or download them directly.
// @author       Matthew Parker
// @namespace    https://github.com/SysAdminDoc/YTKit
// @homepage     https://github.com/SysAdminDoc/YTKit
// @match        *://*.youtube.com/*
// @match        *://rumble.com/*
// @require      https://cdn.jsdelivr.net/npm/m3u8-parser@4.7.1/dist/m3u8-parser.min.js
// @connect      *
// @grant        unsafeWindow
// @grant        GM_openInTab
// @grant        GM.openInTab
// @grant        GM_getValue
// @grant        GM.getValue
// @grant        GM_setValue
// @grant        GM.setValue
// @grant        GM_download
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/M3U8_Video_Sniffer.user.js
// @updateURL    https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/M3U8_Video_Sniffer.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Helper API for GM functions and DOM manipulation ---
    const gmApi = {
        addStyle(css) {
            const style = document.createElement("style");
            style.innerHTML = css;
            document.documentElement.appendChild(style);
        },
        async getValue(name, defaultVal) {
            return await (typeof GM_getValue === "function" ? GM_getValue(name, defaultVal) : GM.getValue(name, defaultVal));
        },
        async setValue(name, value) {
            return await (typeof GM_setValue === "function" ? GM_setValue(name, value) : GM.setValue(name, value));
        },
        openInTab(url, open_in_background = false) {
            return (typeof GM_openInTab === "function" ? GM_openInTab : GM.openInTab)(url, open_in_background);
        },
        download(details) {
            if (typeof GM_download === "function") {
                this.message("Download started, check your browser's download manager.", 3000);
                return GM_download(details);
            } else {
                this.openInTab(details.url);
            }
        },
        copyText(text) {
            const copyFrom = document.createElement("textarea");
            copyFrom.textContent = text;
            document.body.appendChild(copyFrom);
            copyFrom.select();
            document.execCommand('copy');
            copyFrom.blur();
            document.body.removeChild(copyFrom);
        },
        message(text, disappearTime = 3000) {
            const id = "m3u8-sniffer-gm-message-panel";
            let p = document.querySelector(`#${id}`);
            if (!p) {
                p = document.createElement("div");
                p.id = id;
                p.style = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    z-index: 999999999999999;
                `;
                (document.body || document.documentElement).appendChild(p);
            }
            const mdiv = document.createElement("div");
            mdiv.textContent = text;
            mdiv.style = `
                padding: 5px 10px;
                border-radius: 5px;
                background: black;
                box-shadow: #000 1px 2px 5px;
                margin-top: 10px;
                font-size: 14px;
                color: #fff;
                text-align: right;
            `;
            p.appendChild(mdiv);
            setTimeout(() => {
                if(p.contains(mdiv)) {
                    p.removeChild(mdiv);
                }
            }, disappearTime);
        }
    };

    // --- Network request interception for sniffing M3U8 files ---
    function setupInterceptors() {
        // Intercept Fetch API
        const originalFetch = unsafeWindow.fetch;
        unsafeWindow.fetch = function (...args) {
            const requestUrl = typeof args[0] === 'string' ? args[0] : args[0].url;
            if (checkUrl(requestUrl)) {
                 handleM3U8({ url: requestUrl });
            }
            return originalFetch(...args);
        };

        // Intercept XMLHttpRequest
        const originalOpen = unsafeWindow.XMLHttpRequest.prototype.open;
        unsafeWindow.XMLHttpRequest.prototype.open = function (...args) {
            this.addEventListener("load", () => {
                try {
                    if (this.responseText && checkContent(this.responseText)) {
                        handleM3U8({ url: args[1], content: this.responseText });
                    }
                } catch {}
            });
            if (checkUrl(args[1])) {
                handleM3U8({ url: args[1] });
            }
            return originalOpen.apply(this, args);
        };

        function checkUrl(url) {
            if (typeof url !== 'string') return false;
            const parsedUrl = new URL(url, location.href);
            return parsedUrl.pathname.endsWith(".m3u8") || parsedUrl.pathname.endsWith(".m3u");
        }

        function checkContent(content) {
            return typeof content === 'string' && content.trim().startsWith("#EXTM3U");
        }
    }
    setupInterceptors();


    // --- UI Setup ---
    const rootDiv = document.createElement("div");
    rootDiv.style = `
        position: fixed;
        z-index: 9999999999999999;
        opacity: 0.9;
        display: none;
    `;
    document.documentElement.appendChild(rootDiv);

    const shadowDOM = rootDiv.attachShadow({ mode: 'open' });
    const wrapper = document.createElement("div");
    shadowDOM.appendChild(wrapper);

    const indicatorBar = document.createElement("div");
    indicatorBar.style = `text-align: right;`;
    indicatorBar.innerHTML = `
        <span
            class="number-indicator"
            data-number="0"
            title="M3U8 Video Sniffer (Drag me)"
            style="
                display: inline-flex;
                width: 25px;
                height: 25px;
                background: black;
                padding: 10px;
                border-radius: 50%;
                margin-bottom: 5px;
                cursor: pointer;
                border: 3px solid #83838382;
                align-items: center;
                justify-content: center;
            "
        >
            <svg style="filter: invert(1);" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 585.913 585.913" xml:space="preserve"><path d="M11.173,46.2v492.311l346.22,47.402V535.33c0.776,0.058,1.542,0.109,2.329,0.109h177.39 c20.75,0,37.627-16.883,37.627-37.627V86.597c0-20.743-16.877-37.628-37.627-37.628h-177.39c-0.781,0-1.553,0.077-2.329,0.124V0 L11.173,46.2z M110.382,345.888l-1.37-38.273c-0.416-11.998-0.822-26.514-0.822-41.023l-0.415,0.01 c-2.867,12.767-6.678,26.956-10.187,38.567l-10.961,38.211l-15.567-0.582l-9.239-37.598c-2.801-11.269-5.709-24.905-7.725-37.361 l-0.25,0.005c-0.503,12.914-0.879,27.657-1.503,39.552L50.84,343.6l-17.385-0.672l5.252-94.208l25.415-0.996l8.499,32.064 c2.724,11.224,5.467,23.364,7.428,34.819h0.389c2.503-11.291,5.535-24.221,8.454-35.168l9.643-33.042l27.436-1.071l5.237,101.377 L110.382,345.888z M172.479,349.999c-12.569-0.504-23.013-4.272-28.539-8.142l4.504-17.249c3.939,2.226,13.1,6.445,22.373,6.687 c12.009,0.32,18.174-5.497,18.174-13.218c0-10.068-9.838-14.683-19.979-14.74l-9.253-0.052v-16.777l8.801-0.066 c7.708-0.208,17.646-3.262,17.646-11.905c0-6.121-4.914-10.562-14.635-10.331c-7.95,0.189-16.245,3.914-20.213,6.446l-4.52-16.693 c5.693-4.008,17.224-8.11,29.883-8.588c21.457-0.795,33.643,10.407,33.643,24.625c0,11.029-6.197,19.691-18.738,24.161v0.314 c12.229,2.216,22.266,11.663,22.266,25.281C213.89,338.188,197.866,351.001,172.479,349.999z M331.104,302.986 c0,36.126-19.55,52.541-51.193,51.286c-29.318-1.166-46.019-17.103-46.019-52.044v-61.104l25.711-1.006v64.201 c0,19.191,7.562,29.146,21.179,29.502c14.234,0.368,22.189-8.976,22.189-29.26v-66.125l28.122-1.097v65.647H331.104z M359.723,70.476h177.39c8.893,0,16.125,7.236,16.125,16.126v411.22c0,8.888-7.232,16.127-16.125,16.127h-177.39 c-0.792,0-1.563-0.116-2.329-0.232V380.782c17.685,14.961,40.504,24.032,65.434,24.032c56.037,0,101.607-45.576,101.607-101.599 c0-56.029-45.581-101.603-101.607-101.603c-24.93,0-47.749,9.069-65.434,24.035V70.728 C358.159,70.599,358.926,70.476,359.723,70.476z M390.873,364.519V245.241c0-1.07,0.615-2.071,1.586-2.521 c0.981-0.483,2.13-0.365,2.981,0.307l93.393,59.623c0.666,0.556,1.065,1.376,1.065,2.215c0,0.841-0.399,1.67-1.065,2.215 l-93.397,59.628c-0.509,0.4-1.114,0.61-1.743,0.61l-1.233-0.289C391.488,366.588,390.873,365.585,390.873,364.519z"/></svg>
        </span>
    `;
    wrapper.appendChild(indicatorBar);

    gmApi.addStyle(`
        .number-indicator { position: relative; }
        .number-indicator::after {
            content: attr(data-number);
            position: absolute;
            bottom: 0;
            right: 0;
            color: #40a9ff;
            font-size: 14px;
            font-weight: bold;
            background: #000;
            border-radius: 10px;
            padding: 2px 5px;
        }
        .copy-link:active { color: #ccc; }
        .action-btn:hover { text-decoration: underline; }
        .action-btn:active { opacity: 0.9; }
        .media-item {
            color: white;
            margin-bottom: 5px;
            display: flex;
            flex-direction: row;
            background: black;
            padding: 5px 10px;
            border-radius: 3px;
            font-size: 14px;
            user-select: none;
            align-items: center;
        }
        [data-shown="false"] {
            opacity: 0.8;
            transform: scale(0.8);
            transform-origin: top right;
            transition: opacity 0.2s, transform 0.2s;
        }
        [data-shown="false"]:hover { opacity: 1; }
        [data-shown="false"] .media-item { display: none; }
    `);

    // --- UI Drag and Toggle Visibility Logic ---
    (async function () {
        const indicatorBtn = indicatorBar.querySelector(".number-indicator");
        let shown = await gmApi.getValue("sniffer_shown", true);
        wrapper.setAttribute("data-shown", shown);

        let x = await gmApi.getValue("sniffer_x", 10);
        let y = await gmApi.getValue("sniffer_y", 10);

        rootDiv.style.top = `${Math.max(0, Math.min(innerHeight - 50, y))}px`;
        rootDiv.style.right = `${Math.max(0, Math.min(innerWidth - 50, x))}px`;

        indicatorBtn.addEventListener("mousedown", e => {
            let startX = e.pageX;
            let startY = e.pageY;
            let moved = false;

            const onMouseMove = e => {
                let offsetX = e.pageX - startX;
                let offsetY = e.pageY - startY;
                if (!moved && (Math.abs(offsetX) + Math.abs(offsetY)) > 5) {
                    moved = true;
                }
                if (moved) {
                    rootDiv.style.top = `${y + offsetY}px`;
                    rootDiv.style.right = `${x - offsetX}px`;
                }
            };
            const onMouseUp = e => {
                if (moved) {
                    x -= (e.pageX - startX);
                    y += (e.pageY - startY);
                    gmApi.setValue("sniffer_x", x);
                    gmApi.setValue("sniffer_y", y);
                } else {
                    shown = !shown;
                    gmApi.setValue("sniffer_shown", shown);
                    wrapper.setAttribute("data-shown", shown);
                }
                removeEventListener("mousemove", onMouseMove);
                removeEventListener("mouseup", onMouseUp);
            };
            addEventListener("mousemove", onMouseMove);
            addEventListener("mouseup", onMouseUp);
        });
    })();

    // --- Core Logic ---
    let count = 0;
    const shownUrls = new Set();

    function detectVideoTags() {
        for (const v of document.querySelectorAll("video")) {
            if (v.duration && v.src && v.src.startsWith("http") && !shownUrls.has(v.src)) {
                const src = v.src;
                addMediaItem({
                    type: "MP4",
                    url: new URL(src),
                    duration: `${Math.ceil(v.duration / 6)} / 10 mins`,
                    actionText: "Download",
                    onAction() {
                        const fileName = new URL(src).pathname.split('/').pop() || `video_${Date.now()}.mp4`;
                        gmApi.download({
                            url: src,
                            name: fileName.includes('.') ? fileName : `${fileName}.mp4`,
                            headers: { origin: location.origin },
                            onerror() { gmApi.openInTab(src); }
                        });
                    }
                });
            }
        }
    }

    async function handleM3U8({ url, content }) {
        const urlObj = new URL(url, location.href);
        if (shownUrls.has(urlObj.href)) return;

        try {
            content = content || await fetch(urlObj.href).then(res => res.text());
        } catch (error) {
            console.error(`[M3U8 Sniffer] Failed to fetch M3U8 content for ${urlObj.href}:`, error);
            return;
        }


        const parser = new m3u8Parser.Parser();
        parser.push(content);
        parser.end();
        const { segments, playlists, duration: manifestDuration } = parser.manifest;

        let duration = 0;
        if (segments && segments.length > 0) {
            duration = segments.reduce((acc, seg) => acc + seg.duration, 0);
        } else if (manifestDuration) {
            duration = manifestDuration;
        }

        const durationText = duration ? `${Math.ceil(duration / 6)} / 10 mins` : (playlists ? `Playlist (${playlists.length})` : "Unknown");

        addMediaItem({
            type: "M3U8",
            url: urlObj,
            duration: durationText,
            actionText: "Copy URL",
            onAction() {
                gmApi.copyText(urlObj.href);
                gmApi.message("M3U8 URL copied to clipboard");
            }
        });
    }

    function addMediaItem({ type, url, duration, actionText, onAction }) {
        if (shownUrls.has(url.href)) return;
        shownUrls.add(url.href);
        count++;

        const div = document.createElement("div");
        div.className = "media-item";
        div.innerHTML = `
            <span style="font-weight: bold;">${type}</span>
            <span class="copy-link" title="Click to copy full URL: ${url.href}"
                  style="max-width: 200px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; margin-left: 10px; cursor: pointer;">
                ${url.pathname.split('/').pop()}
            </span>
            <span style="margin-left: 10px; flex-grow: 1; font-style: italic;">${duration}</span>
            <span class="action-btn" style="margin-left: 10px; cursor: pointer;">${actionText}</span>
        `;

        div.querySelector(".copy-link").addEventListener("click", () => {
            gmApi.copyText(url.href);
            gmApi.message("Full URL copied to clipboard");
        });

        div.querySelector(".action-btn").addEventListener("click", onAction);

        rootDiv.style.display = "block";
        indicatorBar.querySelector(".number-indicator").setAttribute("data-number", count);
        wrapper.appendChild(div);
    }

    // Periodically check for new <video> tags
    setInterval(detectVideoTags, 2000);
})();