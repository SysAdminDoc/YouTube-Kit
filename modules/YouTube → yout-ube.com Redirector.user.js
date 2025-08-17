// ==UserScript==
// @name         YouTube → yout-ube.com Redirector (link rewriter + nocookie loop fix + Settings)
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  Forces YouTube links (Subscriptions, search, homepage, etc.) to open on yout-ube.com. SPA-safe, rewrites links, intercepts clicks, preserves params, and avoids nocookie ping-pong loops. Includes Settings and login helpers.
// @author       Steve+GPT
// @license      MIT
// @match        *://*.youtube.com/*
// @match        *://youtube.com/*
// @match        *://youtu.be/*
// @match        *://*.youtube-nocookie.com/*
// @match        *://youtube-nocookie.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// ==/UserScript==

(() => {
  'use strict';

  // ------------------------------
  // Persistent settings
  // ------------------------------
  const DEFAULT_SETTINGS = {
    enabled: true,
    redirectShorts: true,
    redirectEmbed: true,
    redirectNoCookie: true,  // handle youtube-nocookie.com
    rewriteLinks: true,      // NEW: proactively rewrite in-page <a> to yout-ube.com
    pauseUntil: 0
  };

  const readSettings = () => {
    try {
      const raw = GM_getValue('yt2yout-ube_settings', '');
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };
  const writeSettings = (s) => GM_setValue('yt2yout-ube_settings', JSON.stringify(s));
  let settings = readSettings();

  // ------------------------------
  // Utilities
  // ------------------------------
  const now = () => Date.now();
  const isPaused = () => now() < Number(settings.pauseUntil || 0);
  const hostIs = (h, base) => h === base || h.endsWith(`.${base}`);
  const isYouTubeHost = (host) => hostIs(host, 'youtube.com');
  const isNoCookieHost = (host) => hostIs(host, 'youtube-nocookie.com');
  const isYoutuDotBeHost = (host) => host === 'youtu.be';
  const onYoutUbeDotCom = (host) => hostIs(host, 'yout-ube.com');

  const safeOpenTab = (url) => {
    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true, insert: true, setParent: true });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };

  const getInt = (val, def = 0) => {
    const n = parseInt(val, 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };

  // ------------------------------
  // Parse IDs & build target URL
  // ------------------------------
  function extractVideoIdFromUrlObj(urlObj) {
    const { host, pathname, searchParams } = urlObj;

    // watch?v=
    if (isYouTubeHost(host) && pathname.startsWith('/watch')) {
      const v = searchParams.get('v');
      if (v && v.length >= 6) return v;
    }

    // youtu.be/<id>
    if (isYoutuDotBeHost(host)) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0] && parts[0].length >= 6) return parts[0];
    }

    // shorts/<id>
    if ((isYouTubeHost(host) || isNoCookieHost(host)) && pathname.startsWith('/shorts/')) {
      if (!settings.redirectShorts) return null;
      const parts = pathname.split('/').filter(Boolean); // ["shorts","VIDEOID",...]
      if (parts[1] && parts[1].length >= 6) return parts[1];
    }

    // embed/<id> or embed/videoseries
    if ((isYouTubeHost(host) || isNoCookieHost(host)) && pathname.startsWith('/embed/')) {
      if (!settings.redirectEmbed) return null;
      const parts = pathname.split('/').filter(Boolean); // ["embed","VIDEOID" | "videoseries", ...]
      const second = parts[1] || '';
      if (second && second !== 'videoseries' && second.length >= 6) return second;
    }

    return null;
  }

  // Allows passing a string URL too
  function extractVideoIdFromUrl(url) {
    try {
      return extractVideoIdFromUrlObj(new URL(url, location.href));
    } catch {
      return null;
    }
  }

  function buildYoutUbeUrl(videoId, srcUrlObj) {
    const p = new URLSearchParams();

    // start/t/time_continue
    const start = srcUrlObj.searchParams.get('start');
    const t = srcUrlObj.searchParams.get('t');
    const time_continue = srcUrlObj.searchParams.get('time_continue');

    if (t) p.set('t', t);
    else if (start) p.set('t', String(getInt(start)));
    else if (time_continue) p.set('t', String(getInt(time_continue)));

    // list/index/playlist
    const list = srcUrlObj.searchParams.get('list') || srcUrlObj.searchParams.get('playlist');
    if (list) p.set('list', list);
    const index = srcUrlObj.searchParams.get('index');
    if (index) p.set('index', String(getInt(index)));

    // carry loop/autoplay if present
    const loop = srcUrlObj.searchParams.get('loop');
    if (loop) p.set('loop', String(getInt(loop)));
    const autoplay = srcUrlObj.searchParams.get('autoplay');
    if (autoplay) p.set('autoplay', String(getInt(autoplay)));

    p.set('v', videoId);
    return `https://yout-ube.com/watch?${p.toString()}`;
  }

  // ------------------------------
  // Redirect logic + loop brakes
  // ------------------------------
  function shouldHandleHost(host) {
    if (onYoutUbeDotCom(host)) return false;

    // If we're in an iframe, never redirect nocookie (avoid embed thrash).
    if (window.top !== window.self && isNoCookieHost(host)) return false;

    // If nocookie and referrer is yout-ube.com, don't redirect (avoid ping-pong).
    if (isNoCookieHost(host)) {
      const ref = (document.referrer || '').toLowerCase();
      if (ref.includes('yout-ube.com')) return false;
      return !!settings.redirectNoCookie;
    }

    return isYouTubeHost(host) || isYoutuDotBeHost(host);
  }

  function attemptRedirect() {
    try {
      if (!settings.enabled || isPaused()) return;

      const current = new URL(location.href);
      if (!shouldHandleHost(current.host)) return;

      const vid = extractVideoIdFromUrlObj(current);
      if (!vid) return;

      const target = buildYoutUbeUrl(vid, current);
      if (target === location.href) return;

      location.replace(target);
    } catch {
      // no-op
    }
  }

  // ------------------------------
  // Proactive link rewriting (Subscriptions, Home, Search, etc.)
  // ------------------------------
  // We rewrite any anchor that points to a video, so the new tab / middle-click behavior goes to yout-ube.com directly.
  function toYoutUbeHref(href) {
    try {
      const u = new URL(href, location.href);
      const vid = extractVideoIdFromUrlObj(u);
      if (!vid) return null;
      return buildYoutUbeUrl(vid, u);
    } catch {
      return null;
    }
  }

  function rewriteAnchor(a) {
    if (!a || !a.href) return;
    if (a.dataset.yt2rewritten === '1') return; // already done
    const newHref = toYoutUbeHref(a.href);
    if (newHref) {
      a.href = newHref;
      a.dataset.yt2rewritten = '1';
    }
  }

  function rewriteAllLinks(root = document) {
    if (!settings.enabled || !settings.rewriteLinks || isPaused()) return;
    // Common video link shapes:
    // - a[href*="watch?v="]
    // - a[href^="https://youtu.be/"]
    // - a[href*="/shorts/"]
    // - a[href*="/embed/"]
    const sel = [
      'a[href*="watch?v="]',
      'a[href^="https://youtu.be/"]',
      'a[href^="http://youtu.be/"]',
      'a[href*="/shorts/"]',
      'a[href*="/embed/"]'
    ].join(',');

    root.querySelectorAll(sel).forEach(rewriteAnchor);
  }

  // Observe SPA mutations and rewrite late-added anchors
  let linkObserver = null;
  function startLinkObserver() {
    if (linkObserver) return;
    linkObserver = new MutationObserver((mutList) => {
      if (!settings.enabled || !settings.rewriteLinks || isPaused()) return;
      for (const m of mutList) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'A') {
              rewriteAnchor(n);
            } else {
              rewriteAllLinks(n);
            }
          });
        } else if (m.type === 'attributes' && m.target && m.attributeName === 'href' && m.target.tagName === 'A') {
          rewriteAnchor(m.target);
        }
      }
    });
    linkObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href']
    });
  }

  // Click interceptor: if a click would go to a YouTube video, force yout-ube.com immediately
  function clickInterceptor(e) {
    if (!settings.enabled || isPaused()) return;

    // Only care about main-button or middle, without aggressive modifiers that open context menus, etc.
    const isLeft = e.button === 0;
    const isMiddle = e.button === 1;
    if (!isLeft && !isMiddle) return;

    // Respect user gestures: ignore when a selection is active
    if (window.getSelection && String(window.getSelection())) return;

    // Find nearest anchor in composed path
    const path = e.composedPath ? e.composedPath() : (function chain(n){const a=[];while(n){a.push(n);n=n.parentNode||n.host;}a.push(window);return a;})(e.target);
    const anchor = path.find((el) => el && el.tagName === 'A');
    if (!anchor || !anchor.href) return;

    // Try to build yout-ube target
    const targetHref = toYoutUbeHref(anchor.href);
    if (!targetHref) return;

    // If YouTube is about to do SPA routing, stop it and open our target
    e.preventDefault();
    e.stopPropagation();

    const openNew = isMiddle || e.metaKey || e.ctrlKey; // middle/Cmd/Ctrl -> new tab
    if (openNew) {
      safeOpenTab(targetHref);
    } else {
      location.href = targetHref;
    }
  }

  // ------------------------------
  // SPA and URL-change detection
  // ------------------------------
  const dispatchUrlChange = () => window.dispatchEvent(new Event('userscript:urlchange'));

  function patchHistory() {
    const push = history.pushState;
    const repl = history.replaceState;
    history.pushState = function (...args) {
      const r = push.apply(this, args);
      dispatchUrlChange();
      return r;
    };
    history.replaceState = function (...args) {
      const r = repl.apply(this, args);
      dispatchUrlChange();
      return r;
    };
    window.addEventListener('popstate', dispatchUrlChange, true);
  }

  function observeTitleChanges() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    const mo = new MutationObserver(() => dispatchUrlChange());
    mo.observe(titleEl, { childList: true, subtree: true });
  }

  let lastHref = '';
  let timer = null;
  function scheduleAttempt() {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      attemptRedirect();
      if (settings.rewriteLinks) rewriteAllLinks();
    }, 50);
  }

  // ------------------------------
  // Settings UI
  // ------------------------------
  function openSettingsPanel() {
    if (document.getElementById('yt2youtube-settings-root')) return;

    const root = document.createElement('div');
    root.id = 'yt2youtube-settings-root';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.zIndex = '2147483647';

    const host = document.createElement('div');
    root.appendChild(host);
    document.documentElement.appendChild(root);

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); }
      .panel {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        min-width: 380px; max-width: 92vw;
        background: #111; color: #f3f3f3; border: 1px solid #333; border-radius: 10px;
        padding: 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }
      h2 { margin: 0 0 12px 0; font-size: 18px; }
      .row { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
      label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      input[type="checkbox"] { transform: scale(1.2); }
      .btnbar { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
      button {
        background: #2c2c2c; color: #fff; border: 1px solid #444; border-radius: 8px;
        padding: 8px 12px; cursor: pointer;
      }
      button:hover { background: #3a3a3a; }
      .hint { font-size: 12px; color: #c9c9c9; margin-top: 8px; line-height: 1.4; }
      .footer { display: flex; justify-content: flex-end; margin-top: 12px; }
      a { color: #7dc3ff; text-decoration: underline; }
    `;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="YouTube Redirect Settings">
        <h2>YouTube → yout-ube.com Redirect Settings</h2>

        <div class="row">
          <label><input type="checkbox" id="set-enabled"> Enable redirect</label>
        </div>
        <div class="row">
          <label><input type="checkbox" id="set-shorts"> Redirect Shorts pages</label>
        </div>
        <div class="row">
          <label><input type="checkbox" id="set-embed"> Redirect Embed pages</label>
        </div>
        <div class="row">
          <label><input type="checkbox" id="set-nocookie"> Redirect youtube-nocookie.com embeds</label>
        </div>
        <div class="row">
          <label><input type="checkbox" id="set-rewrite"> Rewrite YouTube links on pages (Subscriptions, Home, Search)</label>
        </div>

        <div class="btnbar">
          <button id="btn-pause-5">Pause for 5 minutes</button>
          <button id="btn-pause-30">Pause for 30 minutes</button>
          <button id="btn-resume">Resume now</button>
        </div>

        <div class="btnbar">
          <button id="btn-open-yt">Open YouTube login</button>
          <button id="btn-open-yout-ube">Open yout-ube.com</button>
        </div>

        <div class="hint">
          Tips:
          <ul>
            <li>We proactively rewrite video links so Subscriptions clicks go straight to yout-ube.com.</li>
            <li>Nocookie embeds are never redirected inside iframes, and we also stop redirects if a nocookie page was opened from yout-ube.com to avoid loops.</li>
          </ul>
        </div>

        <div class="footer">
          <button id="btn-close">Close</button>
        </div>
      </div>
    `;

    shadow.append(style, wrapper);

    const qs = (sel) => shadow.querySelector(sel);
    qs('#set-enabled').checked = !!settings.enabled;
    qs('#set-shorts').checked = !!settings.redirectShorts;
    qs('#set-embed').checked = !!settings.redirectEmbed;
    qs('#set-nocookie').checked = !!settings.redirectNoCookie;
    qs('#set-rewrite').checked = !!settings.rewriteLinks;

    qs('#set-enabled').addEventListener('change', (e) => { settings.enabled = !!e.target.checked; writeSettings(settings); });
    qs('#set-shorts').addEventListener('change', (e) => { settings.redirectShorts = !!e.target.checked; writeSettings(settings); });
    qs('#set-embed').addEventListener('change', (e) => { settings.redirectEmbed = !!e.target.checked; writeSettings(settings); });
    qs('#set-nocookie').addEventListener('change', (e) => { settings.redirectNoCookie = !!e.target.checked; writeSettings(settings); });
    qs('#set-rewrite').addEventListener('change', (e) => { settings.rewriteLinks = !!e.target.checked; writeSettings(settings); if (settings.rewriteLinks) rewriteAllLinks(); });

    const pauseFor = (mins) => { settings.pauseUntil = now() + mins * 60 * 1000; writeSettings(settings); };

    qs('#btn-pause-5').addEventListener('click', () => pauseFor(5));
    qs('#btn-pause-30').addEventListener('click', () => pauseFor(30));
    qs('#btn-resume').addEventListener('click', () => { settings.pauseUntil = 0; writeSettings(settings); });

    qs('#btn-open-yt').addEventListener('click', () => { pauseFor(15); safeOpenTab('https://www.youtube.com/'); });
    qs('#btn-open-yout-ube').addEventListener('click', () => safeOpenTab('https://yout-ube.com/'));

    const closeAll = () => root.remove();
    shadow.querySelector('.backdrop').addEventListener('click', closeAll);
    qs('#btn-close').addEventListener('click', closeAll);
  }

  // ------------------------------
  // Menu commands
  // ------------------------------
  try {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Settings', openSettingsPanel);
      GM_registerMenuCommand('Pause 5 minutes', () => { settings.pauseUntil = now() + 5 * 60 * 1000; writeSettings(settings); });
      GM_registerMenuCommand('Resume now', () => { settings.pauseUntil = 0; writeSettings(settings); });
      GM_registerMenuCommand('Open YouTube login', () => { settings.pauseUntil = now() + 15 * 60 * 1000; writeSettings(settings); safeOpenTab('https://www.youtube.com/'); });
      GM_registerMenuCommand('Open yout-ube.com', () => safeOpenTab('https://yout-ube.com/'));
    }
  } catch {}

  // ------------------------------
  // Boot
  // ------------------------------
  function init() {
    patchHistory();

    // Observe <title> to catch SPA navigations
    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'loading') {
          observeTitleChanges();
          if (settings.rewriteLinks) rewriteAllLinks();
        }
      }, { once: true });
    } else {
      observeTitleChanges();
      if (settings.rewriteLinks) rewriteAllLinks();
    }

    // Intercept clicks before YouTube’s router sees them
    addEventListener('click', clickInterceptor, true);
    addEventListener('auxclick', clickInterceptor, true); // middle click

    // Rewrite links as DOM mutates
    startLinkObserver();

    // Also react to YouTube SPA events if present
    window.addEventListener('userscript:urlchange', scheduleAttempt, true);
    window.addEventListener('yt-navigate-finish', scheduleAttempt, true);
    window.addEventListener('yt-page-data-updated', scheduleAttempt, true);

    // Initial pass
    scheduleAttempt();
  }

  // If the script loads very early, delay starting the link observer until DOM exists
  if (document.documentElement) init();
  else addEventListener('DOMContentLoaded', init, { once: true });
})();
