/**
 * Semantic Shield — 弹窗脚本（含屏蔽管理清单）
 */

const DEFAULT_SETTINGS = {
  unlockEnabled: true,
  highlightEnabled: true,
  blockNuisance: true,
  unsubscribeAssist: true,
  lang: "zh",
};

const STORAGE_KEY = "semanticShieldSettings";
const BLOCKLIST_KEY = "semanticShieldBlocklist";

const MESSAGE = {
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  RESCAN_PAGE: "RESCAN_PAGE",
  DISMISS_OVERLAYS: "DISMISS_OVERLAYS",
  MANUAL_BLOCK: "MANUAL_BLOCK",
  MANUAL_BLOCK_ITEM: "MANUAL_BLOCK_ITEM",
  RESTORE_BLOCK: "RESTORE_BLOCK",
};

const SIGNAL = {
  DISMISS: "semanticShieldDismissSignal",
  RESCAN: "semanticShieldRescanSignal",
  MANUAL_BLOCK: "semanticShieldManualBlockSignal",
  RESTORE_ITEM: "semanticShieldRestoreBlockItemId",
  MANUAL_BLOCK_ITEM: "semanticShieldManualBlockItemId",
};

async function loadSettings() {
  const stored = await browser.storage.sync.get(STORAGE_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] || {}) };
  if (!merged.lang) {
    merged.lang = SemanticShieldI18n.resolveLang(
      browser.i18n?.getUILanguage?.() || navigator.language
    );
  }
  delete merged.complianceAccepted;
  return merged;
}

async function saveSettings(settings) {
  await browser.storage.sync.set({ [STORAGE_KEY]: settings });
}

async function getBlocklist() {
  const data = await browser.storage.local.get(BLOCKLIST_KEY);
  return data[BLOCKLIST_KEY] || [];
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** 广播 + 消息双通道，确保 content script 能收到 */
async function notifyPage(message, signalKey, signalPayload) {
  if (signalKey) {
    const payload = signalPayload || Date.now();
    await browser.storage.local.set({ [signalKey]: payload });
  }

  try {
    const tab = await getActiveTab();
    if (!tab?.id) return { ok: !!signalKey, tab: null, res: null };
    const res = await browser.tabs.sendMessage(tab.id, message);
    return { ok: true, tab, res };
  } catch {
    return { ok: !!signalKey, tab: null, res: null };
  }
}

/** 清单项操作：优先 sendMessage，失败时用 storage 兜底 */
async function notifyBlockItem(messageType, itemId) {
  const message = { type: messageType, id: itemId };
  const signalKey =
    messageType === MESSAGE.RESTORE_BLOCK ? SIGNAL.RESTORE_ITEM : SIGNAL.MANUAL_BLOCK_ITEM;

  try {
    const tab = await getActiveTab();
    if (tab?.id) {
      const res = await browser.tabs.sendMessage(tab.id, message);
      return { ok: true, res };
    }
  } catch { /* fall through */ }

  await browser.storage.local.set({ [signalKey]: { id: itemId, ts: Date.now() } });
  return { ok: true, res: null };
}

function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

function formatTime(ts, lang) {
  try {
    return new Date(ts).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function typeLabel(type, msg) {
  const map = {
    element: msg.blocklistTypeElement,
    popup: msg.blocklistTypePopup,
    redirect: msg.blocklistTypeRedirect,
    "meta-refresh": msg.blocklistTypeMeta,
  };
  return map[type] || type;
}

function applyI18n(lang) {
  const msg = SemanticShieldI18n.getMessages(lang);
  const textMap = {
    extensionTitle: msg.extensionTitle,
    subtitle: msg.extensionSubtitle,
    langLabel: msg.langLabel,
    unlockTitle: msg.unlockTitle,
    unlockDesc: msg.unlockDesc,
    highlightTitle: msg.highlightTitle,
    highlightDesc: msg.highlightDesc,
    blockNuisanceTitle: msg.blockNuisanceTitle,
    blockNuisanceDesc: msg.blockNuisanceDesc,
    unsubscribeTitle: msg.unsubscribeTitle,
    unsubscribeDesc: msg.unsubscribeDesc,
    btnRescan: msg.btnRescan,
    btnRestore: msg.btnRestore,
    btnManualBlock: msg.btnManualBlock,
    helpTitle: msg.helpTitle,
    blocklistTitle: msg.blocklistTitle,
    blocklistEmpty: msg.blocklistEmpty,
  };
  Object.entries(textMap).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  document.getElementById("btnBlocklistRefresh").textContent = msg.blocklistRefresh;
  document.getElementById("btnBlocklistClear").textContent = msg.blocklistClear;

  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    const [zhOpt, enOpt] = langSelect.options;
    if (zhOpt) zhOpt.textContent = msg.langOptionZh;
    if (enOpt) enOpt.textContent = msg.langOptionEn;
  }

  const helpStepsEl = document.getElementById("helpSteps");
  helpStepsEl.replaceChildren();
  msg.helpSteps.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step.replace(/^\d+\.\s*/, "");
    helpStepsEl.appendChild(li);
  });

  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = msg.extensionTitle;
  return msg;
}

function translateBlockText(text, msg, lang) {
  if (!text) return text;
  const labels = msg.blockReasonLabels || {};
  if (labels[text]) return labels[text];
  const redirectMatch = text.match(/^跳转拦截 \((.+)\)$/);
  if (redirectMatch && lang === "en") {
    return `Redirect block (${redirectMatch[1]})`;
  }
  return text;
}

function formatScanStatus(msg, res) {
  if (!res || (res.highlighted == null && res.hidden == null)) return msg.statusScanDone;
  return msg.statusScanDoneDetail
    .replace("{highlighted}", res.highlighted || 0)
    .replace("{hidden}", res.hidden || 0);
}

async function renderBlocklist(msg, lang) {
  const container = document.getElementById("blocklistContainer");
  const emptyEl = document.getElementById("blocklistEmpty");
  const list = await getBlocklist();

  container.querySelectorAll(".block-item").forEach((n) => n.remove());

  if (!list.length) {
    emptyEl.style.display = "block";
    emptyEl.textContent = msg.blocklistEmpty;
    return;
  }

  emptyEl.style.display = "none";

  list.forEach((item) => {
    const div = document.createElement("div");
    div.className = `block-item${item.restored ? " restored" : ""}`;

    const typeSpan = document.createElement("span");
    typeSpan.className = "block-item-type";
    typeSpan.textContent = typeLabel(item.type, msg);
    div.appendChild(typeSpan);

    if (item.restored) {
      const restoredSpan = document.createElement("span");
      restoredSpan.className = "block-item-type";
      restoredSpan.style.cssText = "background:#dcfce7;color:#166534;margin-left:4px";
      restoredSpan.textContent = msg.blocklistRestored;
      div.appendChild(restoredSpan);
    }

    const label = document.createElement("div");
    label.className = "block-item-label";
    label.textContent = translateBlockText(item.label || item.type, msg, lang);
    div.appendChild(label);

    const detail = document.createElement("div");
    detail.className = "block-item-detail";
    detail.textContent = translateBlockText(item.detail || item.blockedUrl || item.pageUrl || "", msg, lang);
    div.appendChild(detail);

    const time = document.createElement("div");
    time.className = "block-item-time";
    time.textContent = formatTime(item.timestamp, lang);
    div.appendChild(time);

    const btns = document.createElement("div");
    btns.className = "block-item-btns";

    if (!item.restored) {
      const restoreBtn = document.createElement("button");
      restoreBtn.className = "btn btn-sm";
      restoreBtn.textContent = item.type === "element" ? msg.blocklistRestore : msg.blocklistOpen;
      restoreBtn.addEventListener("click", async () => {
        setStatus(msg.statusScanning);
        const { ok, res } = await notifyBlockItem(MESSAGE.RESTORE_BLOCK, item.id);
        if (ok && res?.ok !== false) {
          await renderBlocklist(msg, lang);
          setStatus(msg.statusBlockRestored);
        } else if (item.blockedUrl) {
          await browser.tabs.create({ url: item.blockedUrl });
          const all = await getBlocklist();
          const idx = all.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            all[idx].restored = true;
            await browser.storage.local.set({ [BLOCKLIST_KEY]: all });
          }
          await renderBlocklist(msg, lang);
          setStatus(msg.statusBlockRestored);
        } else {
          setStatus(msg.statusBlockRestoreFail);
        }
      });
      btns.appendChild(restoreBtn);
    }

    if (item.restored && item.type === "element") {
      const blockAgainBtn = document.createElement("button");
      blockAgainBtn.className = "btn btn-sm btn-primary";
      blockAgainBtn.textContent = msg.blocklistBlockAgain;
      blockAgainBtn.addEventListener("click", async () => {
        setStatus(msg.statusScanning);
        const { ok, res } = await notifyBlockItem(MESSAGE.MANUAL_BLOCK_ITEM, item.id);
        if (ok && res?.ok !== false) {
          await renderBlocklist(msg, lang);
          setStatus(msg.statusBlockBlockedAgain);
        } else {
          setStatus(msg.statusBlockRestoreFail);
        }
      });
      btns.appendChild(blockAgainBtn);
    }

    if (item.blockedUrl) {
      const openBtn = document.createElement("button");
      openBtn.className = "btn btn-sm";
      openBtn.textContent = msg.blocklistOpen;
      openBtn.addEventListener("click", async () => {
        await browser.tabs.create({ url: item.blockedUrl });
        setStatus(msg.statusBlockRestored);
      });
      btns.appendChild(openBtn);
    }

    div.appendChild(btns);
    container.appendChild(div);
  });
}

async function init() {
  const toggleUnlock = document.getElementById("toggleUnlock");
  const toggleHighlight = document.getElementById("toggleHighlight");
  const toggleBlockNuisance = document.getElementById("toggleBlockNuisance");
  const toggleUnsubscribe = document.getElementById("toggleUnsubscribe");
  const btnRestore = document.getElementById("btnRestore");
  const btnRescan = document.getElementById("btnRescan");
  const btnManualBlock = document.getElementById("btnManualBlock");
  const btnBlocklistRefresh = document.getElementById("btnBlocklistRefresh");
  const btnBlocklistClear = document.getElementById("btnBlocklistClear");
  const langSelect = document.getElementById("langSelect");

  let settings = await loadSettings();
  toggleUnlock.checked = settings.unlockEnabled;
  toggleHighlight.checked = settings.highlightEnabled;
  toggleBlockNuisance.checked = settings.blockNuisance;
  toggleUnsubscribe.checked = settings.unsubscribeAssist;
  langSelect.value = settings.lang;

  let msg = applyI18n(settings.lang);
  await renderBlocklist(msg, settings.lang);
  setStatus(msg.statusSynced);

  async function pushSettings(statusKey) {
    settings = {
      unlockEnabled: toggleUnlock.checked,
      highlightEnabled: toggleHighlight.checked,
      blockNuisance: toggleBlockNuisance.checked,
      unsubscribeAssist: toggleUnsubscribe.checked,
      lang: langSelect.value,
    };
    await saveSettings(settings);
    msg = applyI18n(settings.lang);
    const { ok } = await notifyPage({ type: MESSAGE.SETTINGS_UPDATED, settings });
    setStatus(ok ? msg[statusKey] || msg.statusApplied : msg.statusSavedOnly);
  }

  toggleUnlock.addEventListener("change", () => pushSettings("statusApplied"));
  toggleHighlight.addEventListener("change", () => pushSettings("statusApplied"));
  toggleBlockNuisance.addEventListener("change", () => pushSettings("statusApplied"));
  toggleUnsubscribe.addEventListener("change", () => pushSettings("statusApplied"));

  langSelect.addEventListener("change", async () => {
    settings.lang = langSelect.value;
    await saveSettings(settings);
    msg = applyI18n(settings.lang);
    await renderBlocklist(msg, settings.lang);
    await notifyPage({ type: MESSAGE.SETTINGS_UPDATED, settings });
    setStatus(msg.statusSynced);
  });

  btnRescan.addEventListener("click", async () => {
    setStatus(msg.statusScanning);
    const result = await notifyPage({ type: MESSAGE.RESCAN_PAGE }, SIGNAL.RESCAN);
    setStatus(result.ok ? formatScanStatus(msg, result.res) : msg.statusRestoreFail);
  });

  btnRestore.addEventListener("click", async () => {
    setStatus(msg.statusScanning);
    const result = await notifyPage({ type: MESSAGE.DISMISS_OVERLAYS }, SIGNAL.DISMISS);
    if (!result.ok) {
      setStatus(msg.statusRestoreFail);
      return;
    }
    const dismiss = result.res;
    if (dismiss?.clicked != null) {
      setStatus(
        msg.statusRestoreDoneDetail
          .replace("{clicked}", dismiss.clicked)
          .replace("{skipped}", dismiss.skipped)
      );
    } else {
      setStatus(msg.statusRestoreDone);
    }
  });

  btnManualBlock.addEventListener("click", async () => {
    setStatus(msg.statusScanning);
    const result = await notifyPage({ type: MESSAGE.MANUAL_BLOCK }, SIGNAL.MANUAL_BLOCK);
    if (!result.ok) {
      setStatus(msg.statusRestoreFail);
      return;
    }
    const hidden = result.res?.hidden ?? 0;
    setStatus(msg.statusManualBlockDone.replace("{count}", hidden));
  });

  btnBlocklistRefresh.addEventListener("click", async () => {
    await renderBlocklist(msg, settings.lang);
    setStatus(msg.statusBlocklistLoaded);
  });

  btnBlocklistClear.addEventListener("click", async () => {
    await browser.storage.local.set({ [BLOCKLIST_KEY]: [] });
    await renderBlocklist(msg, settings.lang);
    setStatus(msg.statusBlocklistLoaded);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[BLOCKLIST_KEY]) {
      renderBlocklist(msg, settings.lang);
    }
  });

  await notifyPage({ type: MESSAGE.SETTINGS_UPDATED, settings });
}

document.addEventListener("DOMContentLoaded", init);
