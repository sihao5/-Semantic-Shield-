/**
 * Semantic Shield — 广告/垃圾弹窗拦截（含屏蔽清单记录）
 */
(function () {
  "use strict";

  const LOG = "[Semantic Shield]";
  const HIDDEN_ATTR = "data-semantic-shield-ad-hidden";
  let antiNuisanceStyleEl = null;

  function log(msg, ...args) {
    console.log(`${LOG} ${msg}`, ...args);
  }

  function dispatchBlockEvent(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  function injectPageGuard(enabled) {
    const script = document.createElement("script");
    script.setAttribute("data-semantic-shield", "anti-nuisance");
    script.textContent = `
      (function () {
        if (window.__semanticShieldAntiNuisance) {
          window.__semanticShieldAntiNuisance.enabled = ${enabled};
          return;
        }
        window.__semanticShieldAntiNuisance = { enabled: ${enabled}, lastGesture: Date.now() };
        var g = window.__semanticShieldAntiNuisance;
        function notify(name, detail) {
          document.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }));
        }
        ["click","keydown","touchstart","mousedown","pointerdown"].forEach(function (t) {
          document.addEventListener(t, function () { g.lastGesture = Date.now(); }, true);
        });
        var adUrl = /doubleclick|googlesyndication|taboola|outbrain|popads|click\\.[^/]+\\/(track|redirect)|affiliate|ad\\./i;
        var origOpen = window.open;
        window.open = function (url) {
          if (!g.enabled) return origOpen.apply(window, arguments);
          var noGesture = Date.now() - g.lastGesture > 1200;
          var urlStr = url ? String(url) : "";
          if (noGesture) {
            console.log("${LOG} 已拦截自动弹窗", urlStr);
            notify("semantic-shield-blocked-popup", { url: urlStr });
            return null;
          }
          if (urlStr && adUrl.test(urlStr)) {
            console.log("${LOG} 已拦截广告 URL 弹窗", urlStr);
            notify("semantic-shield-blocked-popup", { url: urlStr });
            return null;
          }
          return origOpen.apply(window, arguments);
        };
        var origAssign = Location.prototype.assign;
        Location.prototype.assign = function (url) {
          if (g.enabled && adUrl.test(String(url)) && Date.now() - g.lastGesture > 1200) {
            notify("semantic-shield-blocked-redirect", { url: String(url), method: "assign" });
            return;
          }
          return origAssign.call(this, url);
        };
        var origReplace = Location.prototype.replace;
        Location.prototype.replace = function (url) {
          if (g.enabled && adUrl.test(String(url)) && Date.now() - g.lastGesture > 1200) {
            notify("semantic-shield-blocked-redirect", { url: String(url), method: "replace" });
            return;
          }
          return origReplace.call(this, url);
        };
        console.log("${LOG} anti-nuisance page guard ready");
      })();
    `;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
  }

  async function removeMetaRefresh() {
    const bl = globalThis.SemanticShieldBlocklist;
    document.querySelectorAll('meta[http-equiv="refresh" i]').forEach(async (meta) => {
      if (meta.hasAttribute(HIDDEN_ATTR)) return;
      const content = meta.getAttribute("content") || "";
      meta.setAttribute(HIDDEN_ATTR, "1");
      meta.remove();
      log("已移除 meta refresh 自动跳转");
      if (bl) await bl.recordMetaRefresh(content);
    });
  }

  function injectAntiNuisanceCss() {
    if (antiNuisanceStyleEl) return;
    antiNuisanceStyleEl = document.createElement("style");
    antiNuisanceStyleEl.setAttribute("data-semantic-shield", "anti-nuisance-css");
    antiNuisanceStyleEl.textContent = `
      [${HIDDEN_ATTR}] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.documentElement || document.head).appendChild(antiNuisanceStyleEl);
  }

  async function scanCornerAds(helpers, force = false) {
    const bl = globalThis.SemanticShieldBlocklist;
    let hidden = 0;

    for (const el of document.querySelectorAll("div, aside, section, iframe, ins")) {
      if (el.hasAttribute(HIDDEN_ATTR) || el.hasAttribute("data-semantic-shield")) continue;
      const comp = globalThis.SemanticShieldCompliance;
      if (!comp?.mayHideAsNuisance(el, helpers)) continue;
      if (!comp.isBottomCornerFloater(el) && !comp.isLikelyAdvertisement(el, helpers.getText, helpers.getClass)) {
        continue;
      }

      const reason = comp.isBottomCornerFloater(el) ? "右下角浮窗广告" : "页面广告浮层";
      if (bl) {
        const r = await bl.hideAndRecord(el, helpers, reason, force);
        if (r) hidden += 1;
      } else {
        el.setAttribute(HIDDEN_ATTR, "1");
        el.style.setProperty("display", "none", "important");
        hidden += 1;
      }
      if (hidden) log("已屏蔽并记录", { tag: el.tagName, reason, force });
    }
    return hidden;
  }

  async function apply(settings, helpers, force = false) {
    if (!settings.blockNuisance) {
      if (window.__semanticShieldAntiNuisance) window.__semanticShieldAntiNuisance.enabled = false;
      return { hidden: 0 };
    }

    injectPageGuard(true);
    injectAntiNuisanceCss();
    await removeMetaRefresh();
    const hidden = await scanCornerAds(helpers, force);
    return { hidden };
  }

  function remove() {
    if (window.__semanticShieldAntiNuisance) window.__semanticShieldAntiNuisance.enabled = false;
  }

  globalThis.SemanticShieldAntiNuisance = { apply, remove, scanCornerAds, removeMetaRefresh };
})();
