/**
 * Semantic Shield — 取消订阅流程助手
 * 检测冗长退订流程，在侧边栏生成「一键直达取消页面」快捷按钮（启发式智能检测，无外部 AI API）
 */
(function () {
  "use strict";

  const LOG = "[Semantic Shield]";
  const SIDEBAR_ID = "semantic-shield-unsub-sidebar";

  const UNSUB_KEYWORDS = [
    "unsubscribe", "cancel subscription", "opt out", "opt-out", "manage email preferences",
    "取消订阅", "退订", "停止订阅", "邮件偏好", "取消接收",
  ];

  function log(msg, ...args) {
    console.log(`${LOG} ${msg}`, ...args);
  }

  function getText(el) {
    return (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "").trim();
  }

  /** 查找最可能的退订链接/按钮 */
  function findUnsubscribeTarget() {
    let best = null;
    let bestScore = 0;

    document.querySelectorAll("a[href], button, [role='button']").forEach((el) => {
      if (el.closest(`#${SIDEBAR_ID}`)) return;
      let score = 0;
      const text = getText(el).toLowerCase();
      const href = (el.href || "").toLowerCase();

      UNSUB_KEYWORDS.forEach((kw) => {
        const k = kw.toLowerCase();
        if (text.includes(k)) score += 3;
        if (href.includes(k.replace(/\s/g, "")) || href.includes("unsubscribe") || href.includes("opt-out")) {
          score += 4;
        }
      });

      if (score > bestScore) {
        bestScore = score;
        best = { el, href: el.href || null, text: getText(el).slice(0, 60) };
      }
    });

    return bestScore > 0 ? best : null;
  }

  /** 评估退订流程复杂度（步骤多、表单多 → 冗长） */
  function measureUnsubscribeComplexity() {
    const bodyText = (document.body?.innerText || "").slice(0, 8000);
    let score = 0;

    if (/step\s*\d|步骤\s*\d|第\s*[一二三四1234]\s*步/i.test(bodyText)) score += 3;
    if ((bodyText.match(/confirm|确认/gi) || []).length >= 2) score += 2;
    if (document.querySelectorAll("form").length >= 2) score += 2;
    if (document.querySelectorAll("input[type='email'], input[type='text']").length >= 2) score += 1;
    if (/reason|原因|why are you/i.test(bodyText)) score += 2;
    if (/unsubscribe|取消订阅|退订/i.test(bodyText)) score += 1;

    return score;
  }

  function injectSidebarStyles() {
    if (document.getElementById("semantic-shield-unsub-style")) return;
    const style = document.createElement("style");
    style.id = "semantic-shield-unsub-style";
    style.setAttribute("data-semantic-shield", "unsub-style");
    style.textContent = `
      #${SIDEBAR_ID} {
        position: fixed !important;
        top: 50% !important;
        right: 0 !important;
        transform: translateY(-50%) !important;
        z-index: 2147483645 !important;
        width: 200px !important;
        padding: 12px !important;
        background: linear-gradient(135deg, #1e40af, #2563eb) !important;
        color: #fff !important;
        border-radius: 12px 0 0 12px !important;
        box-shadow: -4px 0 16px rgba(0,0,0,0.2) !important;
        font-family: system-ui, sans-serif !important;
        font-size: 12px !important;
      }
      #${SIDEBAR_ID} .ss-unsub-title {
        font-weight: 700 !important;
        margin-bottom: 6px !important;
        font-size: 11px !important;
        opacity: 0.9 !important;
      }
      #${SIDEBAR_ID} .ss-unsub-btn {
        width: 100% !important;
        padding: 10px 8px !important;
        border: none !important;
        border-radius: 8px !important;
        background: #fff !important;
        color: #1d4ed8 !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        font-size: 12px !important;
        line-height: 1.3 !important;
      }
      #${SIDEBAR_ID} .ss-unsub-btn:hover { background: #eff6ff !important; }
      #${SIDEBAR_ID} .ss-unsub-close {
        position: absolute !important;
        top: 4px !important;
        right: 8px !important;
        background: none !important;
        border: none !important;
        color: #fff !important;
        cursor: pointer !important;
        font-size: 16px !important;
        opacity: 0.8 !important;
      }
      #${SIDEBAR_ID} .ss-unsub-hint {
        margin-top: 8px !important;
        font-size: 10px !important;
        opacity: 0.85 !important;
        line-height: 1.4 !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function renderSidebar(target, lang) {
    document.getElementById(SIDEBAR_ID)?.remove();
    if (!target) return;

    injectSidebarStyles();
    const msg = globalThis.SemanticShieldI18n?.getMessages(lang || "zh") || {};
    const sidebar = document.createElement("div");
    sidebar.id = SIDEBAR_ID;
    sidebar.setAttribute("data-semantic-shield", "unsub-sidebar");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ss-unsub-close";
    closeBtn.setAttribute("aria-label", msg.unsubSidebarClose || "Close");
    closeBtn.textContent = "×";

    const title = document.createElement("div");
    title.className = "ss-unsub-title";
    title.textContent = msg.unsubSidebarTitle || "Semantic Shield";

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "ss-unsub-btn";
    goBtn.id = "ss-unsub-go";
    goBtn.textContent = msg.unsubSidebarBtn || "Go to unsubscribe";

    const hint = document.createElement("p");
    hint.className = "ss-unsub-hint";
    hint.textContent = msg.unsubSidebarHint || "";

    sidebar.append(closeBtn, title, goBtn, hint);
    document.documentElement.appendChild(sidebar);

    closeBtn.addEventListener("click", () => sidebar.remove());
    goBtn.addEventListener("click", () => {
      if (target.href) {
        window.location.href = target.href;
      } else if (target.el) {
        target.el.scrollIntoView({ behavior: "smooth", block: "center" });
        target.el.click();
      }
      log("用户点击一键退订快捷按钮", target);
    });

    log("已显示退订助手侧边栏", target);
  }

  function scan(settings) {
    if (!settings.unsubscribeAssist) {
      document.getElementById(SIDEBAR_ID)?.remove();
      return null;
    }

    const complexity = measureUnsubscribeComplexity();
    const target = findUnsubscribeTarget();

    if (complexity >= 3 && target) {
      renderSidebar(target, settings.lang || "zh");
      return { complexity, target };
    }

    document.getElementById(SIDEBAR_ID)?.remove();
    return null;
  }

  globalThis.SemanticShieldUnsubscribe = { scan, findUnsubscribeTarget, measureUnsubscribeComplexity };
})();
