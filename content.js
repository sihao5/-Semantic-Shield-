/**
 * Semantic Shield — 内容脚本 (content.js)
 *
 * 合规设计原则：
 * 1. 仅解除浏览器端 copy/contextmenu/user-select 限制（不触及服务端内容授权）
 * 2. 仅标注真正隐藏的关闭/取消按钮（暗黑套路），不修改页面布局
 * 3. 「恢复页面交互」仅：恢复滚动 + 模拟点击非访问控制类弹窗的关闭按钮
 * 4. 禁止强制隐藏登录/VIP/付费弹窗；禁止站点专项绕过（见 compliance.js）
 */

(function () {
  "use strict";

  const LOG_PREFIX = "[Semantic Shield]";

  const MESSAGE = {
    SETTINGS_UPDATED: "SETTINGS_UPDATED",
    RESCAN_PAGE: "RESCAN_PAGE",
    DISMISS_OVERLAYS: "DISMISS_OVERLAYS",
    MANUAL_BLOCK: "MANUAL_BLOCK",
    MANUAL_BLOCK_ITEM: "MANUAL_BLOCK_ITEM",
    RESTORE_BLOCK: "RESTORE_BLOCK",
  };

  const STORAGE_KEY = "semanticShieldSettings";

  const DEFAULT_SETTINGS = {
    unlockEnabled: true,
    highlightEnabled: true,
    blockNuisance: true,
    unsubscribeAssist: true,
    lang: "zh",
  };

  /** 标注层容器 id，所有高亮框挂在此节点下，便于统一清理 */
  const MARKER_ROOT_ID = "semantic-shield-marker-root";
  const MARKER_CLASS = "semantic-shield-marker";

  /** 暗黑套路：假关闭 / 诱导点击相关文案 */
  const TEXT_KEYWORDS = [
    "关闭", "取消", "拒绝", "跳过", "稍后", "不再", "我知道了",
    "close", "cancel", "dismiss", "skip", "later", "no thanks",
  ];
  const CLASS_KEYWORDS = ["close", "cancel", "dismiss", "btn-close", "modal-close", "icon-close"];

  const SIZE_THRESHOLD_PX = 10;
  const OPACITY_THRESHOLD = 0.15;

  let settings = { ...DEFAULT_SETTINGS };
  let pageScriptInjected = false;
  let domObserver = null;
  let unlockStyleEl = null;
  let markerStyleEl = null;
  /** 扫描中标志，防止 observer 递归触发 */
  let isScanning = false;
  /** 上次扫描时间戳，节流 */
  let lastScanAt = 0;
  const SCAN_COOLDOWN_MS = 2000;

  // ---------------------------------------------------------------------------
  // 日志
  // ---------------------------------------------------------------------------

  function log(msg, ...args) {
    console.log(`${LOG_PREFIX} ${msg}`, ...args);
  }

  function logWarn(msg, ...args) {
    console.warn(`${LOG_PREFIX} ${msg}`, ...args);
  }

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------

  function isOurNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = /** @type {Element} */ (node);
    return (
      el.id === MARKER_ROOT_ID ||
      el.closest(`#${MARKER_ROOT_ID}`) !== null ||
      el.hasAttribute("data-semantic-shield")
    );
  }

  function getElementText(el) {
    const raw =
      el.innerText ||
      el.textContent ||
      el.value ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      "";
    return raw.replace(/\s+/g, " ").trim();
  }

  function getClassString(el) {
    if (!el.className) return "";
    if (typeof el.className === "string") return el.className;
    if (el.className.baseVal) return el.className.baseVal;
    return "";
  }

  /** 是否为可点击的关闭/取消类控件（含 icon 型假关闭按钮） */
  function isButtonLike(el) {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "A") return true;
    if (tag === "INPUT" && /^(button|submit|reset)$/i.test(el.type || "")) return true;
    if (el.getAttribute("role") === "button") return true;
    if (el.hasAttribute("onclick")) return true;
    // icon / span 型关闭按钮（常见于假关闭、诱导点击场景）
    const cls = getClassString(el).toLowerCase();
    if (/close|cancel|dismiss|icon-x|icon-close/.test(cls)) return true;
    if (el.getAttribute("aria-label") && /close|关闭|取消/i.test(el.getAttribute("aria-label"))) return true;
    return false;
  }

  function complianceLogSkip(el, action) {
    logWarn(`合规跳过 ${action}（访问控制/付费界面）`, {
      tag: el?.tagName,
      class: getClassString(el).slice(0, 50),
    });
  }

  function isBlockedAccessControl(el) {
    if (!globalThis.SemanticShieldCompliance) return false;
    return SemanticShieldCompliance.isAccessControlSurface(el, getElementText, getClassString);
  }

  function isDismissCandidate(el) {
    const text = getElementText(el);
    const textLower = text.toLowerCase();
    const classStr = getClassString(el).toLowerCase();

    const textMatch = TEXT_KEYWORDS.some((kw) => textLower.includes(kw.toLowerCase()));
    const classMatch = CLASS_KEYWORDS.some((kw) => classStr.includes(kw));
    const symbolMatch = /^(×|✕|✖|x)$/i.test(text);

    if (isButtonLike(el)) {
      return textMatch || classMatch || symbolMatch;
    }

    // span / i / div / svg：仅限 class 含 close 或极短关闭文案（假关闭按钮）
    if (["SPAN", "I", "DIV", "SVG"].includes(el.tagName)) {
      return classMatch || symbolMatch || /^(关闭|取消|close|cancel)$/i.test(text);
    }

    return false;
  }

  /**
   * 元素是否在视口内可见且尺寸正常 — 可见按钮不应被高亮或修改
   */
  function isVisuallyAccessible(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const opacity = parseFloat(style.opacity);

    if (style.display === "none" || style.visibility === "hidden") return false;
    if (!Number.isNaN(opacity) && opacity < OPACITY_THRESHOLD) return false;
    if (rect.width >= SIZE_THRESHOLD_PX && rect.height >= SIZE_THRESHOLD_PX) return true;
    return false;
  }

  function detectHiddenState(el) {
    const reasons = [];
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const opacity = parseFloat(style.opacity);

    if (style.display === "none") reasons.push("display:none");
    if (style.visibility === "hidden" || style.visibility === "collapse") reasons.push("visibility:hidden");
    if (!Number.isNaN(opacity) && opacity < OPACITY_THRESHOLD) reasons.push(`opacity:${opacity.toFixed(2)}`);
    if ((rect.width > 0 && rect.width < SIZE_THRESHOLD_PX) || (rect.height > 0 && rect.height < SIZE_THRESHOLD_PX)) {
      reasons.push(`size:${Math.round(rect.width)}×${Math.round(rect.height)}`);
    }
    if (parseFloat(style.width) < SIZE_THRESHOLD_PX || parseFloat(style.height) < SIZE_THRESHOLD_PX) {
      reasons.push("css-size<10px");
    }
    if (parseFloat(style.fontSize) < 1) reasons.push("font-size:0");
    if (style.color === "transparent") reasons.push("transparent-text");
    if (parseInt(style.zIndex, 10) < 0) reasons.push("negative-z");
    // 文字与背景同色（诱导点击常见手法）
    const color = style.color.replace(/\s/g, "");
    const bg = style.backgroundColor.replace(/\s/g, "");
    if (color && bg && color === bg) reasons.push("text=background");

    return { hidden: reasons.length > 0, reasons };
  }

  // ---------------------------------------------------------------------------
  // 功能一：解除复制限制
  // ---------------------------------------------------------------------------

  function bindCopyUnlockListeners() {
    ["copy", "cut", "contextmenu", "paste", "selectstart"].forEach((type) => {
      document.addEventListener(
        type,
        (event) => {
          if (!settings.unlockEnabled) return;
          event.stopImmediatePropagation();
          log(`已放行 ${type} 事件，阻止站点拦截`, { type });
        },
        true
      );
    });
    log("复制/剪切/右键/粘贴监听器已绑定");
  }

  function injectUnlockStyles() {
    if (unlockStyleEl) return;
    unlockStyleEl = document.createElement("style");
    unlockStyleEl.setAttribute("data-semantic-shield", "unlock");
    unlockStyleEl.textContent = `
      html, body, *:not(input):not(textarea) {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        user-select: text !important;
      }
      input, textarea {
        -webkit-user-select: auto !important;
        -moz-user-select: auto !important;
        user-select: auto !important;
      }
    `;
    (document.documentElement || document.head).appendChild(unlockStyleEl);
    log("已注入 user-select 解除样式");
  }

  function removeUnlockStyles() {
    unlockStyleEl?.remove();
    unlockStyleEl = null;
  }

  function injectPageUnlockScript() {
    if (pageScriptInjected) return;
    pageScriptInjected = true;

    const script = document.createElement("script");
    script.setAttribute("data-semantic-shield", "page-unlock");
    script.textContent = `
      (function () {
        if (window.__semanticShieldUnlockInstalled) return;
        window.__semanticShieldUnlockInstalled = true;
        var blocked = ["copy","cut","paste","contextmenu","selectstart"];
        blocked.forEach(function (t) {
          try {
            Object.defineProperty(document, "on" + t, {
              configurable: true, get: function () { return null; }, set: function () {},
            });
          } catch (e) {}
        });
        var orig = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, fn, opt) {
          if (blocked.indexOf(type) === -1) return orig.call(this, type, fn, opt);
          var wrapped = function (e) {
            if (window.__semanticShieldUnlockPaused) return fn.call(this, e);
            var op = Event.prototype.preventDefault;
            Event.prototype.preventDefault = function () {
              if (blocked.indexOf(this.type) !== -1) return;
              return op.call(this);
            };
            try { fn.call(this, e); } finally { Event.prototype.preventDefault = op; }
          };
          return orig.call(this, type, wrapped, opt);
        };
        console.log("[Semantic Shield] page unlock script ready");
      })();
    `;
    (document.documentElement || document.head).appendChild(script);
    script.remove();
    log("页面主世界解锁脚本已注入");
  }

  function applyUnlock(enabled) {
    window.__semanticShieldUnlockPaused = !enabled;
    if (enabled) {
      injectPageUnlockScript();
      injectUnlockStyles();
      log("解除复制限制：已启用（copy/cut/paste/contextmenu/selectstart）");
    } else {
      removeUnlockStyles();
      log("解除复制限制：已禁用");
    }
  }

  // ---------------------------------------------------------------------------
  // 功能二：非侵入式高亮（浮动标注，pointer-events:none）
  // ---------------------------------------------------------------------------

  function ensureMarkerRoot() {
    let root = document.getElementById(MARKER_ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = MARKER_ROOT_ID;
      root.setAttribute("data-semantic-shield", "marker-root");
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function injectMarkerStyles() {
    if (markerStyleEl) return;
    markerStyleEl = document.createElement("style");
    markerStyleEl.setAttribute("data-semantic-shield", "marker-style");
    markerStyleEl.textContent = `
      #${MARKER_ROOT_ID} {
        position: fixed !important;
        inset: 0 !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        overflow: visible !important;
      }
      .${MARKER_CLASS} {
        position: fixed !important;
        box-sizing: border-box !important;
        border: 3px solid #ef4444 !important;
        border-radius: 4px !important;
        box-shadow: 0 0 0 2px rgba(239,68,68,0.4), 0 0 12px rgba(239,68,68,0.5) !important;
        pointer-events: none !important;
        background: rgba(239,68,68,0.08) !important;
      }
      .${MARKER_CLASS}__label {
        position: absolute !important;
        top: -22px !important;
        left: 0 !important;
        padding: 2px 6px !important;
        font: 11px/1.3 system-ui, sans-serif !important;
        color: #fff !important;
        background: #dc2626 !important;
        border-radius: 4px !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
    `;
    (document.documentElement || document.head).appendChild(markerStyleEl);
  }

  function removeMarkerStyles() {
    markerStyleEl?.remove();
    markerStyleEl = null;
  }

  function clearMarkers() {
    const root = document.getElementById(MARKER_ROOT_ID);
    if (root) root.replaceChildren();
  }

  function createMarkerForElement(el, reasons) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const marker = document.createElement("div");
    marker.className = MARKER_CLASS;
    marker.setAttribute("data-semantic-shield", "marker");
    marker.style.left = `${Math.max(0, rect.left)}px`;
    marker.style.top = `${Math.max(0, rect.top)}px`;
    marker.style.width = `${Math.max(rect.width, 8)}px`;
    marker.style.height = `${Math.max(rect.height, 8)}px`;

    const label = document.createElement("span");
    label.className = `${MARKER_CLASS}__label`;
    const lang = settings.lang || "zh";
    const i18n = globalThis.SemanticShieldI18n?.getMessages(lang);
    const prefix = i18n?.highlightMarkerPrefix || "Fake close/hidden";
    const reasonMap = i18n?.highlightReasons || {};
    const localizedReasons = reasons.map((r) => {
      if (reasonMap[r]) return reasonMap[r];
      if (r.startsWith("opacity:")) {
        return lang === "zh" ? `透明度过低 (${r.slice(8)})` : `low opacity (${r.slice(8)})`;
      }
      if (r.startsWith("size:")) {
        return lang === "zh" ? `尺寸过小 (${r.slice(5)})` : `too small (${r.slice(5)})`;
      }
      return r;
    });
    label.textContent = `${prefix}: ${localizedReasons.join(", ")}`;
    marker.appendChild(label);

    ensureMarkerRoot().appendChild(marker);

    log("已添加非侵入式标注", { text: getElementText(el).slice(0, 24), reasons });
  }

  function scanAndHighlightButtons() {
    if (!settings.highlightEnabled) {
      clearMarkers();
      return 0;
    }

    const now = Date.now();
    if (now - lastScanAt < SCAN_COOLDOWN_MS && lastScanAt > 0) {
      log("扫描节流中，跳过本次");
      return document.querySelectorAll(`.${MARKER_CLASS}`).length;
    }
    lastScanAt = now;

    isScanning = true;
    pauseDomObserver();

    injectMarkerStyles();
    clearMarkers();

    log("开始扫描假关闭/隐蔽按钮…");

    const candidates = document.querySelectorAll(
      "button, a, input[type='button'], input[type='submit'], input[type='reset'], [role='button'], span, i, div, svg"
    );

    let highlighted = 0;

    candidates.forEach((el) => {
      if (isOurNode(el)) return;
      if (!isDismissCandidate(el)) return;
      // 已可见的正常按钮不高亮，避免干扰弹窗交互
      if (isVisuallyAccessible(el)) return;

      const { hidden, reasons } = detectHiddenState(el);
      if (hidden) {
        createMarkerForElement(el, reasons);
        highlighted += 1;
      }
    });

    log(`扫描完成，标注 ${highlighted} 个假关闭/隐蔽按钮`);
    isScanning = false;
    resumeDomObserver();
    return highlighted;
  }

  // ---------------------------------------------------------------------------
  // 功能三：关闭遮挡弹窗 / 遮罩层
  // ---------------------------------------------------------------------------

  /**
   * 判断元素是否为大面积 fixed/sticky 遮罩
   */
  function isBlockingOverlay(el) {
    if (!(el instanceof Element) || isOurNode(el)) return false;

    const style = window.getComputedStyle(el);
    if (style.position !== "fixed" && style.position !== "absolute") return false;

    const rect = el.getBoundingClientRect();
    const coversWidth = rect.width >= window.innerWidth * 0.3;
    const coversHeight = rect.height >= window.innerHeight * 0.3;
    if (!coversWidth || !coversHeight) return false;

    const z = parseInt(style.zIndex, 10);
    const bg = style.backgroundColor;
    const hasDimBg =
      bg.includes("rgba") ||
      parseFloat(style.opacity) < 1 ||
      style.pointerEvents === "auto";

    return hasDimBg || z > 100 || el.className.toString().match(/modal|mask|overlay|dialog|popup|layer/i);
  }

  /**
   * 在遮罩层或其附近查找可点击的关闭/取消按钮
   */
  function findCloseControl(root) {
    const scope = root.parentElement || document.body;
    const buttons = scope.querySelectorAll(
      "button, a, [role='button'], input[type='button'], .close, [class*='close']"
    );

    for (const btn of buttons) {
      if (!isButtonLike(btn) && btn.tagName !== "A") continue;
      if (isOurNode(btn)) continue;
      const text = getElementText(btn).toLowerCase();
      const cls = getClassString(btn).toLowerCase();
      if (
        /^(×|✕|✖|x)$/i.test(text) ||
        TEXT_KEYWORDS.some((k) => text.includes(k.toLowerCase())) ||
        /close|cancel|dismiss/.test(cls)
      ) {
        return btn;
      }
    }
    return null;
  }

  /**
   * 安全触发元素点击（不修改 DOM 结构）
   */
  function safeClick(el) {
    if (!el || isOurNode(el)) return false;
    try {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      if (typeof el.click === "function") el.click();
      log("已触发关闭按钮点击", { tag: el.tagName, text: getElementText(el).slice(0, 20) });
      return true;
    } catch (err) {
      logWarn("点击关闭按钮失败", err);
      return false;
    }
  }

  /**
   * 恢复页面滚动（ benign，不涉及绕过访问控制）
   */
  function restorePageScroll() {
    document.documentElement.style.setProperty("overflow", "auto", "important");
    document.body.style.setProperty("overflow", "auto", "important");
    document.body.classList.remove("modal-open", "no-scroll", "overflow-hidden");
    log("已尝试恢复页面滚动");
  }

  /**
   * 合规版「恢复页面交互」：
   * - 恢复滚动
   * - 仅对非访问控制类遮罩，模拟点击其自带的关闭/取消按钮
   * - 禁止 force-hide、禁止 CSS 注入隐藏、禁止站点专项绕过
   * @returns {{ clicked: number, skipped: number }}
   */
  function dismissOverlays() {
    pauseDomObserver();
    isScanning = true;

    let clicked = 0;
    let skipped = 0;

    log("合规模式：恢复页面交互 / Compliant restore interaction", location.hostname);

    restorePageScroll();

    const overlays = Array.from(
      document.querySelectorAll("div, section, aside, dialog, [role='dialog']")
    )
      .filter(isBlockingOverlay)
      .sort((a, b) => {
        const za = parseInt(getComputedStyle(a).zIndex, 10) || 0;
        const zb = parseInt(getComputedStyle(b).zIndex, 10) || 0;
        return zb - za;
      });

    overlays.forEach((overlay) => {
      if (isBlockedAccessControl(overlay)) {
        complianceLogSkip(overlay, "overlay-dismiss");
        skipped += 1;
        return;
      }

      const check = SemanticShieldCompliance?.mayInteractWithOverlay(overlay, {
        getText: getElementText,
        getClass: getClassString,
      });
      if (check && !check.allowed) {
        complianceLogSkip(overlay, check.reason);
        skipped += 1;
        return;
      }

      const closeBtn = findCloseControl(overlay);
      if (closeBtn && !isBlockedAccessControl(closeBtn) && safeClick(closeBtn)) {
        clicked += 1;
        return;
      }

      skipped += 1;
      log("未找到可点击的关闭按钮，跳过（不强制隐藏）", {
        class: getClassString(overlay).slice(0, 40),
      });
    });

    clearMarkers();

    log(`合规处理完成：点击关闭 ${clicked}，跳过 ${skipped}（含访问控制界面）`);
    isScanning = false;
    resumeDomObserver();

    return { clicked, skipped };
  }

  // ---------------------------------------------------------------------------
  // DOM 监听（防死循环）
  // ---------------------------------------------------------------------------

  function pauseDomObserver() {
    domObserver?.disconnect();
  }

  function resumeDomObserver() {
    if (!needsDomObserver()) return;
    if (!domObserver) {
      startDomObserver();
      return;
    }
    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function startDomObserver() {
    if (domObserver) return;

    let timer = null;
    domObserver = new MutationObserver((mutations) => {
      if (isScanning) return;

      const relevant = mutations.some((m) => {
        if (isOurNode(m.target)) return false;
        if (m.addedNodes) {
          for (const n of m.addedNodes) {
            if (isOurNode(n)) return false;
          }
        }
        return true;
      });

      if (!relevant) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isScanning) return;
        log("检测到页面 DOM 变化，延迟扫描");
        if (settings.highlightEnabled) scanAndHighlightButtons();
        applyAntiNuisance();
        applyUnsubscribeAssist();
      }, 1500);
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    log("MutationObserver 已启动");
  }

  function stopDomObserver() {
    domObserver?.disconnect();
    domObserver = null;
  }

  function getComplianceHelpers() {
    return { getText: getElementText, getClass: getClassString };
  }

  async function applyAntiNuisance(force = false) {
    if (!globalThis.SemanticShieldAntiNuisance) return { hidden: 0 };
    if (settings.blockNuisance) {
      const r = await SemanticShieldAntiNuisance.apply(settings, getComplianceHelpers(), force);
      log("广告/弹窗拦截", r, force ? "(手动)" : "");
      return r;
    }
    SemanticShieldAntiNuisance.remove();
    return { hidden: 0 };
  }

  /** 完整重新扫描（高亮 + 广告扫描，不强制隐藏登录/付费弹窗） */
  async function runFullRescan() {
    log("执行完整重新扫描");
    lastScanAt = 0;
    isScanning = true;
    pauseDomObserver();

    applyUnlock(settings.unlockEnabled);
    const anti = await applyAntiNuisance(false);
    const highlighted = settings.highlightEnabled ? scanAndHighlightButtons() : 0;
    applyUnsubscribeAssist();

    isScanning = false;
    resumeDomObserver();

    return { ok: true, highlighted, hidden: anti?.hidden || 0 };
  }

  /** 恢复页面交互 */
  async function runRestoreInteraction() {
    log("执行恢复页面交互");
    restorePageScroll();
    const dismiss = dismissOverlays();
    applyUnlock(settings.unlockEnabled);
    return { ok: true, ...dismiss };
  }

  /** 用户手动屏蔽当前页（忽略白名单） */
  async function runManualBlock() {
    log("执行手动屏蔽");
    isScanning = true;
    pauseDomObserver();
    const anti = await applyAntiNuisance(true);
    isScanning = false;
    resumeDomObserver();
    return { ok: true, hidden: anti?.hidden || 0 };
  }

  function applyUnsubscribeAssist() {
    if (!globalThis.SemanticShieldUnsubscribe) return;
    SemanticShieldUnsubscribe.scan(settings);
  }

  function needsDomObserver() {
    return settings.highlightEnabled || settings.blockNuisance || settings.unsubscribeAssist;
  }

  function applyAllFeatures() {
    log("applyAllFeatures", settings);
    applyUnlock(settings.unlockEnabled);
    applyAntiNuisance();

    if (settings.highlightEnabled) {
      scanAndHighlightButtons();
    } else {
      clearMarkers();
      removeMarkerStyles();
    }

    applyUnsubscribeAssist();

    if (needsDomObserver()) startDomObserver();
    else stopDomObserver();
  }

  async function loadAndApplySettings() {
    try {
      const stored = await browser.storage.sync.get(STORAGE_KEY);
      const raw = stored[STORAGE_KEY] || {};
      delete raw.complianceAccepted;
      settings = { ...DEFAULT_SETTINGS, ...raw };
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
    applyAllFeatures();
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    log("收到消息", message);

    const handle = async () => {
      if (message.type === MESSAGE.SETTINGS_UPDATED && message.settings) {
        const next = { ...message.settings };
        delete next.complianceAccepted;
        settings = { ...DEFAULT_SETTINGS, ...next };
        await applyAllFeatures();
        return { ok: true };
      }

      if (message.type === MESSAGE.RESCAN_PAGE) {
        return runFullRescan();
      }

      if (message.type === MESSAGE.DISMISS_OVERLAYS) {
        return runRestoreInteraction();
      }

      if (message.type === MESSAGE.MANUAL_BLOCK) {
        return runManualBlock();
      }

      if (message.type === MESSAGE.RESTORE_BLOCK && message.id) {
        if (SemanticShieldBlocklist) {
          return SemanticShieldBlocklist.restoreEntry(message.id, getComplianceHelpers());
        }
        return { ok: false };
      }

      if (message.type === MESSAGE.MANUAL_BLOCK_ITEM && message.id) {
        if (SemanticShieldBlocklist) {
          return SemanticShieldBlocklist.manualBlockEntry(message.id, getComplianceHelpers());
        }
        return { ok: false };
      }

      return undefined;
    };

    handle()
      .then((result) => {
        if (result !== undefined) sendResponse(result);
      })
      .catch((err) => {
        logWarn("消息处理失败", err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true;
  });

  /** 通过 storage 广播，确保所有 iframe 与主框架同步响应 */
  if (browser.storage?.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.semanticShieldDismissSignal?.newValue) {
          log("收到恢复页面交互广播");
          runRestoreInteraction();
        }
        if (changes.semanticShieldRescanSignal?.newValue) {
          log("收到重新扫描广播");
          runFullRescan();
        }
        if (changes.semanticShieldManualBlockSignal?.newValue) {
          log("收到手动屏蔽广播");
          runManualBlock();
        }
        if (changes.semanticShieldRestoreBlockItemId?.newValue) {
          const { id } = changes.semanticShieldRestoreBlockItemId.newValue;
          if (id && SemanticShieldBlocklist) {
            SemanticShieldBlocklist.restoreEntry(id, getComplianceHelpers());
          }
        }
        if (changes.semanticShieldManualBlockItemId?.newValue) {
          const { id } = changes.semanticShieldManualBlockItemId.newValue;
          if (id && SemanticShieldBlocklist) {
            SemanticShieldBlocklist.manualBlockEntry(id, getComplianceHelpers());
          }
        }
        if (changes.semanticShieldHideBlockId?.newValue) {
          const { blockId } = changes.semanticShieldHideBlockId.newValue;
          if (blockId && SemanticShieldBlocklist) {
            const el = document.querySelector(
              `[${SemanticShieldBlocklist.BLOCK_ID_ATTR}="${blockId}"]`
            );
            if (el) {
              SemanticShieldBlocklist.hideAndRecord(el, getComplianceHelpers(), "用户手动屏蔽", true);
            }
          }
        }
        if (changes.semanticShieldRestoreBlockId?.newValue) {
          const { id, blockListId } = changes.semanticShieldRestoreBlockId.newValue;
          const result = SemanticShieldBlocklist?.restoreElementOnPage(id);
          if (result?.ok) {
            SemanticShieldBlocklist.markRestored(blockListId);
            log("跨帧恢复屏蔽元素", id);
          }
        }
      }
      if (area === "sync" && changes[STORAGE_KEY]?.newValue) {
        settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEY].newValue };
        applyAllFeatures();
      }
    });
  }

  log("content.js 已加载", location.href, "compliance", SemanticShieldCompliance?.COMPLIANCE_VERSION);
  bindCopyUnlockListeners();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAndApplySettings, { once: true });
  } else {
    loadAndApplySettings();
  }

  window.addEventListener("load", () => {
    setTimeout(applyAllFeatures, 1000);
  });
})();
