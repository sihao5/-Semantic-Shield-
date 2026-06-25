/**
 * Semantic Shield — 跨浏览器 API 兼容层
 * Firefox 提供 browser.*（Promise）；Chrome / Edge 提供 chrome.*（回调）
 * 本文件统一为 Promise 风格的 browser 对象
 */
(function () {
  "use strict";

  if (typeof globalThis.browser !== "undefined" && globalThis.browser?.storage) {
    return;
  }

  const chromeApi = globalThis.chrome;
  if (!chromeApi?.runtime) {
    console.warn("[Semantic Shield] No extension API found");
    return;
  }

  function promisify(fn, ctx) {
    return function (...args) {
      return new Promise((resolve, reject) => {
        try {
          fn.call(ctx, ...args, (result) => {
            const err = chromeApi.runtime.lastError;
            if (err) reject(err);
            else resolve(result);
          });
        } catch (e) {
          reject(e);
        }
      });
    };
  }

  globalThis.browser = {
    storage: {
      sync: {
        get: promisify(chromeApi.storage.sync.get, chromeApi.storage.sync),
        set: promisify(chromeApi.storage.sync.set, chromeApi.storage.sync),
      },
      local: {
        get: promisify(chromeApi.storage.local.get, chromeApi.storage.local),
        set: promisify(chromeApi.storage.local.set, chromeApi.storage.local),
      },
    },
    tabs: {
      query: promisify(chromeApi.tabs.query, chromeApi.tabs),
      sendMessage: promisify(chromeApi.tabs.sendMessage, chromeApi.tabs),
    },
    runtime: {
      onMessage: chromeApi.runtime.onMessage,
      getURL: chromeApi.runtime.getURL?.bind(chromeApi.runtime),
    },
    i18n: chromeApi.i18n,
  };
})();
