/**
 * Semantic Shield — 屏蔽管理清单 + 恢复白名单
 * 用户「恢复显示」后写入白名单，自动扫描不再屏蔽，直至用户手动「再次屏蔽」
 */
(function () {
  "use strict";

  const LOG = "[Semantic Shield]";
  const STORAGE_KEY = "semanticShieldBlocklist";
  const WHITELIST_KEY = "semanticShieldBlockWhitelist";
  const MAX_ITEMS = 200;
  const BLOCK_ID_ATTR = "data-semantic-shield-block-id";
  const WHITELIST_ATTR = "data-semantic-shield-whitelisted";

  function log(msg, ...args) {
    console.log(`${LOG} ${msg}`, ...args);
  }

  function genId() {
    return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pageOrigin(url) {
    try {
      return new URL(url || location.href).origin;
    } catch {
      return location.href;
    }
  }

  async function getList() {
    const data = await browser.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || [];
  }

  async function saveList(list) {
    const trimmed = list.slice(0, MAX_ITEMS);
    await browser.storage.local.set({ [STORAGE_KEY]: trimmed });
    return trimmed;
  }

  async function getWhitelist() {
    const data = await browser.storage.local.get(WHITELIST_KEY);
    return data[WHITELIST_KEY] || [];
  }

  async function saveWhitelist(list) {
    await browser.storage.local.set({ [WHITELIST_KEY]: list });
  }

  function getFingerprint(el, helpers) {
    if (!el) return null;
    return {
      blockId: el.getAttribute(BLOCK_ID_ATTR) || null,
      tag: el.tagName,
      elId: el.id || "",
      classSnippet: (helpers?.getClass?.(el) || "").slice(0, 80),
      textSnippet: (helpers?.getText?.(el) || "").slice(0, 40),
    };
  }

  function fingerprintMatch(a, b) {
    if (!a || !b) return false;
    if (a.blockId && b.blockId && a.blockId === b.blockId) return true;
    if (a.tag !== b.tag) return false;
    if (a.elId && b.elId && a.elId === b.elId) return true;
    if (a.classSnippet && b.classSnippet && a.classSnippet === b.classSnippet) return true;
    return false;
  }

  /** 元素是否在白名单（恢复后免屏蔽） */
  async function isElementWhitelisted(el, helpers) {
    const list = await getWhitelist();
    const origin = pageOrigin(location.href);
    const fp = getFingerprint(el, helpers);
    return list.some(
      (w) => w.active && w.pageOrigin === origin && fingerprintMatch(w.fingerprint, fp)
    );
  }

  /** URL 是否在白名单（弹窗/跳转类） */
  async function isUrlWhitelisted(url) {
    if (!url) return false;
    const list = await getWhitelist();
    return list.some((w) => w.active && w.blockedUrl === url);
  }

  async function addToWhitelist(entry) {
    const list = await getWhitelist();
    const item = {
      id: entry.id || genId(),
      active: true,
      listItemId: entry.listItemId || null,
      blockId: entry.blockId || entry.fingerprint?.blockId || null,
      fingerprint: entry.fingerprint || null,
      blockedUrl: entry.blockedUrl || null,
      pageOrigin: entry.pageOrigin || pageOrigin(location.href),
      pageUrl: entry.pageUrl || location.href,
      label: entry.label || "",
      timestamp: Date.now(),
    };
    list.unshift(item);
    await saveWhitelist(list);
    log("已加入恢复白名单", item);
    return item;
  }

  async function removeWhitelistByListItem(listItemId) {
    const list = await getWhitelist();
    let changed = false;
    list.forEach((w) => {
      if (w.listItemId === listItemId || w.id === listItemId) {
        w.active = false;
        changed = true;
      }
    });
    if (changed) await saveWhitelist(list);
  }

  async function addEntry(entry) {
    const list = await getList();
    const item = {
      id: entry.id || genId(),
      type: entry.type || "element",
      pageUrl: entry.pageUrl || location.href,
      pageOrigin: pageOrigin(entry.pageUrl || location.href),
      pageTitle: entry.pageTitle || document.title || "",
      label: entry.label || "",
      detail: entry.detail || "",
      blockedUrl: entry.blockedUrl || null,
      timestamp: Date.now(),
      restored: false,
      blockIdAttr: entry.blockIdAttr || null,
      fingerprint: entry.fingerprint || null,
    };
    list.unshift(item);
    await saveList(list);
    log("已加入屏蔽清单", item);
    return item;
  }

  /**
   * 隐藏 DOM 并写入清单（自动扫描时跳过白名单元素）
   * @param {boolean} force 手动屏蔽时 true，忽略白名单
   */
  async function hideAndRecord(el, helpers, reason, force = false) {
    if (!el) return null;
    if (el.hasAttribute("data-semantic-shield-ad-hidden")) return null;

    if (!force && (await isElementWhitelisted(el, helpers))) {
      log("跳过白名单元素", getFingerprint(el, helpers));
      return null;
    }

    el.removeAttribute(WHITELIST_ATTR);

    const id = el.getAttribute(BLOCK_ID_ATTR) || genId();
    el.setAttribute(BLOCK_ID_ATTR, id);
    el.setAttribute("data-semantic-shield-ad-hidden", "1");
    el.setAttribute("data-semantic-shield-hidden-reason", reason || "");

    el.setAttribute("data-ss-orig-display", el.style.display || "");
    el.setAttribute("data-ss-orig-visibility", el.style.visibility || "");
    el.setAttribute("data-ss-orig-pointer", el.style.pointerEvents || "");

    el.style.setProperty("display", "none", "important");
    el.style.setProperty("pointer-events", "none", "important");

    const fp = getFingerprint(el, helpers);
    const tag = el.tagName.toLowerCase();
    const cls = helpers?.getClass?.(el)?.slice(0, 60) || "";
    const text = (helpers?.getText?.(el) || "").slice(0, 40);

    const existing = (await getList()).find((x) => x.blockIdAttr === id && !x.restored);

    if (existing) {
      existing.restored = false;
      existing.timestamp = Date.now();
      await saveList(await getList());
      return existing;
    }

    return addEntry({
      id,
      type: "element",
      label: `${tag}${cls ? "." + cls.split(/\s+/)[0] : ""}`,
      detail: reason || text || "页面浮层/广告元素",
      blockIdAttr: id,
      fingerprint: fp,
    });
  }

  async function recordBlockedPopup(url) {
    if (!url || (await isUrlWhitelisted(url))) return null;
    return addEntry({
      type: "popup",
      label: "自动弹窗",
      detail: String(url).slice(0, 120),
      blockedUrl: String(url),
    });
  }

  async function recordMetaRefresh(content) {
    return addEntry({
      type: "meta-refresh",
      label: "自动跳转",
      detail: (content || "").slice(0, 120),
    });
  }

  async function recordBlockedRedirect(url, method) {
    if (!url || (await isUrlWhitelisted(url))) return null;
    return addEntry({
      type: "redirect",
      label: `跳转拦截 (${method || "navigate"})`,
      detail: String(url).slice(0, 120),
      blockedUrl: String(url),
    });
  }

  function restoreElementOnPage(blockId) {
    const el = document.querySelector(`[${BLOCK_ID_ATTR}="${blockId}"]`);
    if (!el) return { ok: false, el: null };

    el.removeAttribute("data-semantic-shield-ad-hidden");
    el.removeAttribute("data-semantic-shield-hidden-reason");
    el.setAttribute(WHITELIST_ATTR, "1");

    const origDisplay = el.getAttribute("data-ss-orig-display");
    const origVis = el.getAttribute("data-ss-orig-visibility");
    const origPointer = el.getAttribute("data-ss-orig-pointer");

    if (origDisplay) el.style.display = origDisplay;
    else el.style.removeProperty("display");

    if (origVis) el.style.visibility = origVis;
    else el.style.removeProperty("visibility");

    if (origPointer) el.style.pointerEvents = origPointer;
    else el.style.removeProperty("pointer-events");

    el.removeAttribute("data-ss-orig-display");
    el.removeAttribute("data-ss-orig-visibility");
    el.removeAttribute("data-ss-orig-pointer");

    log("已恢复页面元素", blockId);
    return { ok: true, el };
  }

  function findElementForListItem(item, helpers) {
    if (item.blockIdAttr) {
      const el = document.querySelector(`[${BLOCK_ID_ATTR}="${item.blockIdAttr}"]`);
      if (el) return el;
    }
    if (!item.fingerprint) return null;
    for (const el of document.querySelectorAll("div, aside, section, iframe, ins")) {
      if (fingerprintMatch(getFingerprint(el, helpers), item.fingerprint)) return el;
    }
    return null;
  }

  async function markRestored(id) {
    const list = await getList();
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx].restored = true;
      list[idx].restoredAt = Date.now();
      await saveList(list);
    }
  }

  async function markBlockedAgain(id) {
    const list = await getList();
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) {
      list[idx].restored = false;
      list[idx].timestamp = Date.now();
      await saveList(list);
    }
  }

  /** 用户点击「恢复显示」 */
  async function restoreEntry(id, helpers) {
    const list = await getList();
    const item = list.find((x) => x.id === id);
    if (!item) return { ok: false, reason: "not-found" };

    if (item.type === "element") {
      const blockId = item.blockIdAttr || item.id;
      const { ok, el } = restoreElementOnPage(blockId);
      const fp = item.fingerprint || (el ? getFingerprint(el, helpers) : null);

      await addToWhitelist({
        listItemId: id,
        blockId: blockId,
        fingerprint: fp,
        label: item.label,
        pageUrl: item.pageUrl,
      });

      await markRestored(id);

      try {
        await browser.storage.local.set({
          semanticShieldRestoreBlockId: { id: blockId, blockListId: id, ts: Date.now() },
        });
      } catch { /* ignore */ }

      return { ok: true, type: ok ? "element" : "element-whitelisted" };
    }

    if (item.blockedUrl) {
      await addToWhitelist({
        listItemId: id,
        blockedUrl: item.blockedUrl,
        label: item.label,
        pageUrl: item.pageUrl,
      });
      await markRestored(id);
      return { ok: true, type: "url-whitelisted" };
    }

    await markRestored(id);
    return { ok: true, type: "marked" };
  }

  /** 用户点击「再次屏蔽」— 同步隐藏页面元素 */
  async function manualBlockEntry(id, helpers) {
    const list = await getList();
    const item = list.find((x) => x.id === id);
    if (!item) return { ok: false, reason: "not-found" };

    await removeWhitelistByListItem(id);

    if (item.type === "element") {
      let el = findElementForListItem(item, helpers);
      if (!el && item.blockIdAttr) {
        el = document.querySelector(`[${BLOCK_ID_ATTR}="${item.blockIdAttr}"]`);
      }
      if (el) {
        await hideAndRecord(el, helpers, "用户手动屏蔽", true);
        await markBlockedAgain(id);
        try {
          await browser.storage.local.set({
            semanticShieldHideBlockId: { blockId: item.blockIdAttr || item.id, ts: Date.now() },
          });
        } catch { /* ignore */ }
        return { ok: true, type: "element-blocked" };
      }
      await markBlockedAgain(id);
      return { ok: false, reason: "element-not-on-page" };
    }

    await markBlockedAgain(id);
    return { ok: true, type: "marked-blocked" };
  }

  /** 手动扫描屏蔽当前页（强制，忽略白名单） */
  async function manualBlockScan(helpers, scanFn) {
    let hidden = 0;
    for (const el of document.querySelectorAll("div, aside, section, iframe, ins")) {
      if (el.hasAttribute("data-semantic-shield")) continue;
      const comp = globalThis.SemanticShieldCompliance;
      if (!comp?.mayHideAsNuisance(el, helpers)) continue;
      if (!comp.isBottomCornerFloater(el) && !comp.isLikelyAdvertisement(el, helpers.getText, helpers.getClass)) {
        continue;
      }
      const r = await hideAndRecord(el, helpers, "用户手动屏蔽", true);
      if (r) hidden += 1;
    }
    if (scanFn) hidden += await scanFn(helpers, true);
    return { hidden };
  }

  async function openBlockedUrl(id) {
    const list = await getList();
    const item = list.find((x) => x.id === id);
    if (!item?.blockedUrl) return { ok: false };
    await browser.tabs.create({ url: item.blockedUrl });
    return { ok: true };
  }

  async function clearList() {
    await saveList([]);
  }

  function bindPopupBlockListener() {
    document.addEventListener("semantic-shield-blocked-popup", (e) => {
      const url = e.detail?.url;
      if (url) recordBlockedPopup(url);
    });
    document.addEventListener("semantic-shield-blocked-redirect", (e) => {
      const { url, method } = e.detail || {};
      if (url) recordBlockedRedirect(url, method);
    });
  }

  globalThis.SemanticShieldBlocklist = {
    STORAGE_KEY,
    WHITELIST_KEY,
    BLOCK_ID_ATTR,
    getList,
    getWhitelist,
    isElementWhitelisted,
    isUrlWhitelisted,
    hideAndRecord,
    recordBlockedPopup,
    recordMetaRefresh,
    recordBlockedRedirect,
    restoreEntry,
    manualBlockEntry,
    manualBlockScan,
    openBlockedUrl,
    restoreElementOnPage,
    findElementForListItem,
    markRestored,
    clearList,
    bindPopupBlockListener,
    getFingerprint,
  };

  bindPopupBlockListener();
})();
