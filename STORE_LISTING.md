# Store Listing / 应用商城上架说明

**Semantic Shield / 语义盾牌** — for Chrome Web Store, Edge Add-ons, and Firefox Add-ons.

---

## Short Description / 简短描述

**EN:** Restore copy & right-click, highlight hidden close buttons, block auto popups and corner ads, unsubscribe shortcut.

**ZH:** 解除复制/右键限制，高亮假关闭按钮，屏蔽自动弹窗与右下角广告，取消订阅快捷助手。

---

## Full Description / 完整功能说明

### English

**Semantic Shield** helps you interact freely with web pages you already have access to.

#### Core features
1. **Unlock actions** — Listens to `copy`, `cut`, `paste`, `contextmenu`, and `selectstart`. Removes client-side JavaScript/CSS blocks so you can copy, paste, select text, and use the right-click menu.
2. **Highlight fake close buttons** — Detects dark-pattern close/cancel/reject controls that are nearly invisible (low opacity, tiny size, or hidden) and marks them with red overlays.
3. **Restore page interaction** — Unlocks page scroll and clicks the page’s own close button on non-login/non-payment dialogs.

#### New features
4. **Block ads & auto popups** — Blocks script-triggered `window.open` without user clicks, removes `meta refresh` junk redirects, and hides bottom-right floating ad widgets.
5. **Unsubscribe assistant** — When a lengthy email unsubscribe flow is detected, shows a sidebar button **“Go to unsubscribe”** to jump directly to the cancel page.
6. **Block list manager** — Review everything auto-blocked (elements, popups, redirects). Restore hidden elements or open blocked URLs if something was blocked by mistake (e.g. a paid dialog).

#### Supported browsers
Firefox · Google Chrome · Microsoft Edge

#### How to use
Install the extension → pin the toolbar icon → features are **on by default**. Open the popup to toggle individual features or rescan the page.

---

### 中文

**Semantic Shield（语义盾牌）** 帮助您在已打开的网页上更自由地操作。

#### 基础功能
1. **解除操作限制** — 监听 `copy`、`cut`、`paste`、`contextmenu`、`selectstart`，解除浏览器端 JS/CSS 拦截，恢复复制、粘贴、选择与右键菜单。
2. **高亮假关闭按钮** — 识别透明度极低、尺寸过小或被隐藏的关闭/取消/拒绝按钮（暗黑套路），红色标注。
3. **恢复页面交互** — 解除页面滚动锁定；对非登录/非付费弹窗点击其自带的关闭按钮。

#### 新增功能
4. **屏蔽广告与自动弹窗** — 拦截无用户点击的 `window.open`、移除 meta 自动跳转、屏蔽右下角小窗广告。
5. **取消订阅助手** — 检测到冗长「取消订阅」流程时，在页面右侧显示 **「一键直达取消页面」** 快捷按钮。
6. **屏蔽管理清单** — 查看所有被自动屏蔽的元素/弹窗/跳转，可手动恢复显示或打开被拦截链接，防止误屏蔽付费弹窗。

#### 支持浏览器
Firefox · Google Chrome · Microsoft Edge

#### 使用方法
安装扩展 → 固定工具栏图标 → 功能**默认开启**。点击图标可在弹窗中开关各项功能或重新扫描页面。

---

## Compliance Notice / 合规说明

*(Place this section at the **bottom** of the store listing.)*

### English

- This extension removes **client-side** copy/right-click blocks only. It does **not** bypass server-side login, registration, VIP, or paid subscriptions.
- It does **not** force-hide login or payment modals.
- It does **not** extract content rendered as images or Canvas.
- Ad blocking targets nuisance ads and auto popups, not legitimate access-control or payment screens.
- Copy only content you may legally use. Respect each website’s Terms of Service and applicable copyright law.

### 中文

- 本扩展仅解除**浏览器端**复制/右键限制，**不绕过**服务端登录、注册、VIP、付费订阅。
- **不强制隐藏**登录/付费弹窗。
- **不提取**图片/Canvas 渲染的受保护内容。
- 广告拦截针对滋扰型广告与自动弹窗，不作用于合法访问控制或付费界面。
- 请仅复制您依法有权使用的内容，并遵守各网站服务条款及适用版权法。

---

*Version 1.4.0*
