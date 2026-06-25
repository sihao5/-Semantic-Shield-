# Semantic Shield / 语义盾牌

Cross-browser extension (Firefox · Chrome · Edge). See **[STORE_LISTING.md](./STORE_LISTING.md)** for full feature description and store compliance text.

---

## Features / 功能一览

| # | Feature | 功能 |
|---|---------|------|
| 1 | Unlock copy/cut/paste/contextmenu | 解除复制/剪切/粘贴/右键限制 |
| 2 | Highlight fake close buttons | 高亮假关闭/隐蔽按钮 |
| 3 | Restore page interaction | 恢复页面交互（滚动+关闭非付费弹窗） |
| 4 | Block ads & auto popups | 屏蔽自动弹窗与右下角广告 |
| 5 | Unsubscribe assistant sidebar | 取消订阅一键直达侧边栏 |
| 6 | Block list manager | 屏蔽管理清单（查阅/恢复/打开） |

**Compliance boundary:** Does NOT bypass login/VIP/paid server restrictions; does NOT force-hide login/payment modals. Details at bottom of [STORE_LISTING.md](./STORE_LISTING.md) for app store publishing.

---

## Install / 安装

- **Firefox:** `about:debugging` → Load Temporary Add-on → `manifest.json`
- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked
- **Edge:** `edge://extensions` → Developer mode → Load unpacked

---

## Project structure

```
├── content.js              Core orchestration
├── compliance.js           Login/paywall guard only
├── anti-nuisance.js        Popup/redirect/corner ad block
├── unsubscribe-assistant.js  Unsubscribe sidebar
├── popup.html/js           UI + feature toggles
├── STORE_LISTING.md        Store description + compliance (bottom)
└── COMPLIANCE.md           Full compliance reference
```

---

## License

MIT
