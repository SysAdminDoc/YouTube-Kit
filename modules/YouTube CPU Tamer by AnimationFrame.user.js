// ==UserScript==
// @name         YouTube CPU Tamer
// @version      3.0.0
// @description  Reduces the browser's energy impact when playing YouTube videos by throttling background tasks.
// @author       Matthew Parker (Original work by AnimationFrame)
// @namespace    https://github.com/SysAdminDoc/YTKit
// @license      MIT
// @match        https://*.youtube.com/*
// @match        https://*.youtube-nocookie.com/*
// @icon         https://raw.githubusercontent.com/cyfung1031/userscript-supports/main/icons/youtube-cpu-tamper-by-animationframe.webp
// @supportURL   https://github.com/SysAdminDoc/YTKit/issues
// @downloadURL  https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/YouTube_CPU_Tamer_by_AnimationFrame.user.js
// @updateURL    https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/YouTube_CPU_Tamer_by_AnimationFrame.user.js
// @run-at       document-start
// @grant        none
// @unwrap
// @allFrames    true
// @inject-into  page
// ==/UserScript==

((__CONTEXT__) => {
  'use strict';

  const win = this instanceof Window ? this : window;

  // Create a unique key for the script and check if it is already running
  const hkey_script = 'yt_cpu_tamer_by_animationframe';
  if (win[hkey_script]) {
      // console.log("YouTube CPU Tamer is already running.");
      return;
  }
  win[hkey_script] = true;

  /** @type {globalThis.PromiseConstructor} */
  const Promise = (async () => {})().constructor;
  const PromiseExternal = ((resolve_, reject_) => {
    const h = (resolve, reject) => { resolve_ = resolve; reject_ = reject };
    return class PromiseExternal extends Promise {
      constructor(cb = h) {
        super(cb);
        if (cb === h) {
          /** @type {(value: any) => void} */
          this.resolve = resolve_;
          /** @type {(reason?: any) => void} */
          this.reject = reject_;
        }
      }
    };
  })();

  const isGPUAccelerationAvailable = (() => {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
      return false;
    }
  })();

  if (!isGPUAccelerationAvailable) {
    console.warn('YouTube CPU Tamer: GPU Acceleration is not available. The script will not run.');
    return;
  }

  const timeupdateDT = (() => {
    const timeupdateKey = '__yt_cpu_tamer_timeupdate__';
    window[timeupdateKey] = 1;

    document.addEventListener('timeupdate', () => {
      window[timeupdateKey] = Date.now();
    }, true);

    let topTimeupdateValue = -1;
    try {
      topTimeupdateValue = top[timeupdateKey];
    } catch (e) {
      // Cross-origin frame error
    }

    return topTimeupdateValue >= 1 ? () => top[timeupdateKey] : () => window[timeupdateKey];
  })();

  const cleanContext = async (win) => {
    const waitFn = requestAnimationFrame;
    try {
      let maxTrials = 16;
      const frameId = 'yt-cpu-tamer-iframe-v1';
      let frame = document.getElementById(frameId);
      let removeIframeFn = null;

      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = frameId;
        frame.style.display = 'none';
        frame.sandbox = 'allow-same-origin';

        let container = document.createElement('noscript');
        container.appendChild(frame);

        while (!document.documentElement && maxTrials-- > 0) await new Promise(resolve => waitFn(resolve));
        if (!document.documentElement) throw new Error("YouTube CPU Tamer: Document element not found.");

        document.documentElement.appendChild(container);

        removeIframeFn = (timeoutFn) => {
          const removeNow = () => {
            if (container && container.parentNode) {
              container.remove();
            }
            container = win = removeIframeFn = null;
          };
          if (document.readyState !== 'loading') {
            timeoutFn ? timeoutFn(removeNow, 200) : removeNow();
          } else {
            win.addEventListener("DOMContentLoaded", removeNow, { once: true });
          }
        };
      }

      maxTrials = 16;
      while (!frame.contentWindow && maxTrials-- > 0) await new Promise(resolve => waitFn(resolve));
      const fc = frame.contentWindow;
      if (!fc) throw "YouTube CPU Tamer: Iframe content window not found.";

      try {
        const { requestAnimationFrame, setInterval, setTimeout, clearInterval, clearTimeout } = fc;
        const res = { requestAnimationFrame, setInterval, setTimeout, clearInterval, clearTimeout };
        for (let k in res) res[k] = res[k].bind(win);
        if (removeIframeFn) Promise.resolve(res.setTimeout).then(removeIframeFn);
        return res;
      } catch (e) {
        if (removeIframeFn) removeIframeFn();
        throw e;
      }
    } catch (e) {
      console.warn("YouTube CPU Tamer: Failed to create a clean execution context.", e);
      return null;
    }
  };

  cleanContext(win).then(cleanCtx => {
    if (!cleanCtx) return;

    const { requestAnimationFrame, setTimeout, setInterval, clearTimeout, clearInterval } = cleanCtx;
    let afInterruptHandler = null;

    const getRAFHelper = () => {
      const afElement = document.createElement('yt-cpu-tamer-af');
      if (!('onanimationiteration' in afElement)) {
        return (resolve) => requestAnimationFrame(afInterruptHandler = resolve);
      }

      afElement.id = 'yt-cpu-tamer-af-elm';
      let queuedResolver = null;
      afElement.onanimationiteration = () => {
        if (queuedResolver) {
          queuedResolver();
          queuedResolver = null;
        }
      };

      if (!document.getElementById('yt-cpu-tamer-af-style')) {
        const style = document.createElement('style');
        style.id = 'yt-cpu-tamer-af-style';
        style.textContent = `
          @keyframes ytCpuTamerAnimation { 0% { opacity: 0; } 100% { opacity: 1; } }
          #yt-cpu-tamer-af-elm {
            position: fixed; top: -100px; left: -100px; width: 0; height: 0;
            pointer-events: none; visibility: hidden;
            animation: 1ms steps(2, jump-none) 0ms infinite alternate forwards running ytCpuTamerAnimation;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }
      document.documentElement.append(afElement);
      return (resolve) => (queuedResolver = afInterruptHandler = resolve);
    };

    const requestAnimationFramePromise = getRAFHelper();

    (() => {
      let p1 = { resolved: true }, p2 = { resolved: true };
      let executionCounter = 0;

      const resolveAnimationFrame = async (promiseWrapper) => {
        await new Promise(requestAnimationFramePromise);
        promiseWrapper.resolved = true;
        const ticket = ++executionCounter;
        promiseWrapper.resolve(ticket);
        return ticket;
      };

      const executeThrottled = async () => {
        const promise1Pending = !p1.resolved ? p1 : null;
        const promise2Pending = !p2.resolved ? p2 : null;

        if (promise1Pending && promise2Pending) {
          await Promise.all([promise1Pending, promise2Pending]);
        } else if (promise1Pending) {
          await promise1Pending;
        } else if (promise2Pending) {
          await promise2Pending;
        }

        if (!p1.resolved) p1 = new PromiseExternal();
        if (!p2.resolved) p2 = new PromiseExternal();

        const ticket1 = resolveAnimationFrame(p1);
        const ticket2 = resolveAnimationFrame(p2);
        return await Promise.race([ticket1, ticket2]);
      };

      const inExecution = new Set();

      const throttledWrapper = async (handler, store) => {
        try {
          const now = Date.now();
          if (now - timeupdateDT() < 800 && now - store.lastCall < 800) {
            const cid = store.cid;
            inExecution.add(cid);
            const ticket = await executeThrottled();
            const wasInExecution = inExecution.delete(cid);
            if (!wasInExecution || ticket === store.lastExecutionTicket) return;
            store.lastExecutionTicket = ticket;
          }
          store.lastCall = now;
          handler();
        } catch (e) {
          console.error("YouTube CPU Tamer:", e);
        }
      };

      const scheduleFunction = (originalFn) => {
        return (func, ms = 0, ...args) => {
          if (typeof func === 'function') {
            const store = { lastCall: Date.now() };
            const handler = args.length > 0 ? func.bind(null, ...args) : func;
            store.cid = originalFn(() => throttledWrapper(handler, store), ms);
            return store.cid;
          }
          return originalFn(func, ms, ...args);
        };
      };

      win.setTimeout = scheduleFunction(setTimeout);
      win.setInterval = scheduleFunction(setInterval);

      const clearFunction = (originalClearFn) => {
        return (cid) => {
          if (cid) {
            inExecution.delete(cid);
            originalClearFn(cid);
          }
        };
      };

      win.clearTimeout = clearFunction(clearTimeout);
      win.clearInterval = clearFunction(clearInterval);

      try {
        win.setTimeout.toString = setTimeout.toString.bind(setTimeout);
        win.setInterval.toString = setInterval.toString.bind(setInterval);
        win.clearTimeout.toString = clearTimeout.toString.bind(clearTimeout);
        win.clearInterval.toString = clearInterval.toString.bind(clearInterval);
      } catch (e) {
        // This might fail in some environments, but it's not critical.
      }
    })();

    let lastInterruptHandler = null;
    setInterval(() => {
      if (lastInterruptHandler === afInterruptHandler) {
        if (lastInterruptHandler) {
          afInterruptHandler();
          lastInterruptHandler = afInterruptHandler = null;
        }
      } else {
        lastInterruptHandler = afInterruptHandler;
      }
    }, 125);

  }).catch(e => {
    console.error("YouTube CPU Tamer failed to initialize.", e);
  });

})();
