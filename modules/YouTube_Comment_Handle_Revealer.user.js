// ==UserScript==
// @name         YouTube Comment Handle Revealer
// @version      1.0.0
// @description  Reveals the original channel name next to the user's @handle in YouTube comments.
// @author       Matthew Parker
// @namespace    https://github.com/SysAdminDoc/YTKit
// @match        https://*.youtube.com/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/YouTube_Comment_Handle_Revealer.user.js
// @updateURL    https://raw.githubusercontent.com/SysAdminDoc/YTKit/main/modules/YouTube_Comment_Handle_Revealer.user.js
// ==/UserScript==

{
  'use strict';

  /** @type {Map<string, string | null>} */
  const nameMap = new Map();

  const pageManager = document.getElementById('page-manager');
  if (pageManager) {
    /**
     * @param {Node} node
     * @returns {node is HTMLElement}
     */
    const isHTMLElement = node => node instanceof HTMLElement;

    /**
     * @param {HTMLElement} element
     * @param {Name} name
     * @returns {element is HTMLElement & { is: Name }}
     * @template {string} Name
     */
    const is = (element, name) => 'is' in element && element.is === name;

    const decode = (() => {
      /** @type {[string, string][]} */
      const ENTITIES = [
        ['amp', '&'],
        ['apos', '\''],
        ['quot', '"'],
        ['nbsp', ' '],
        ['lt', '<'],
        ['gt', '>'],
        ['#39', '\''],
      ];
      /**
       * @param {string} s
       * @returns {string}
       */
      return s => ENTITIES.reduce((acc, [entity, sym]) => acc.replaceAll(`&${entity};`, sym), s);
    })();

    /**
     * @param {HTMLAnchorElement} anchor
     * @param {string} name
     */
    const appendName = (anchor, name) => {
      // <span style="margin-left: 4px;" data-name="$name">( $name )</span>
      const span = anchor.querySelector(`span[data-name="${name}"]`) ?? Object.assign(
        document.createElement('span'),
        { textContent: `( ${name} )`, style: 'margin-left: 4px; color: var(--yt-spec-text-secondary);' },
      );
      Object.assign(span.dataset, { name });

      // remove other names if they exist
      for (const el of anchor.querySelectorAll(`span[data-name]:not([data-name="${name}"])`)) {
        el.remove();
      }

      // append the name
      const channelNameElement = anchor.querySelector('#author-text') ?? anchor;
      if (!channelNameElement.querySelector(`span[data-name="${name}"]`)) {
          channelNameElement.append(span);
      }
    };

    const pageManagerObserver = new MutationObserver(records => {
      const addedElements = records.flatMap(r => [...r.addedNodes]).filter(isHTMLElement);

      for (const el of addedElements) {
        const commentsWrapper = el.querySelector('ytd-comments');

        if (commentsWrapper) {
          const contentsObserver = new MutationObserver(records => {
            const addedElements = records.flatMap(r => [...r.addedNodes]).filter(isHTMLElement);

            /** @type {Set<HTMLElement>} */
            const viewModels = new Set();

            for (const el of addedElements) {
              if (el.tagName === 'YTD-COMMENT-THREAD-RENDERER') {
                  const viewModel = el.querySelector('ytd-comment-view-model');
                  if (viewModel) viewModels.add(viewModel);
              } else if (el.tagName === 'YTD-COMMENT-VIEW-MODEL') {
                  viewModels.add(el);
              }
            }

            for (const el of viewModels) {
              for (const author of el.querySelectorAll('#author-text')) {
                const handle = author.textContent.trim();

                if (!handle) {
                  console.warn('Handle Revealer [handle not found]:', author);
                  continue;
                }

                // Append user name from map if it's already cached
                if (nameMap.has(handle)) {
                  const checkCacheAndAppend = () => {
                    if (!nameMap.has(handle)) return; // Check if the entry was deleted

                    const name = nameMap.get(handle);
                    if (name) {
                      appendName(author, name);
                    } else {
                      // Name is still being fetched, check again later
                      requestIdleCallback(checkCacheAndAppend);
                    }
                  };
                  checkCacheAndAppend();
                  continue;
                }

                // Reserve a key to prevent duplicate requests
                nameMap.set(handle, null);

                fetch(author.href).then(async response => {
                  const text = await response.text();
                  const [name] = text.match(/(?<=\<title\>).+?(?= - YouTube)/) ?? [];

                  if (name) {
                    const decodedName = decode(name);
                    appendName(author, decodedName);
                    nameMap.set(handle, decodedName);
                  } else {
                    // If name isn't found, remove from map to allow retries if needed
                    nameMap.delete(handle);
                  }
                }, error => {
                  console.warn('Handle Revealer [fetch error]:', error);
                  nameMap.delete(handle);
                });
              }
            }
          });
          contentsObserver.observe(commentsWrapper, { childList: true, subtree: true });
        }
      }
    });
    pageManagerObserver.observe(pageManager, { childList: true });
  }
}