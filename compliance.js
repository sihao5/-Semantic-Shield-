/**
 * Semantic Shield — 合规守卫（精简边界）
 *
 * 唯一硬性限制：
 * - 不绕过登录/注册/VIP/付费订阅等服务端限制
 * - 不强制隐藏登录/付费弹窗
 *
 * 允许：解除浏览器端复制限制、标注假关闭按钮、屏蔽广告/垃圾弹窗（非访问控制界面）
 */
(function () {
  "use strict";

  const ACCESS_CONTROL_PATTERN =
    /login|log-in|signin|sign-in|signup|sign-up|register|registration|passport|authenticate|auth-dialog|vip|paywall|pay-wall|payment|purchase|member|membership|premium|checkout|billing|coupon|tang-pass|付费|登录|注册|会员|开通|充值|支付|购买|授权/i;

  /** 付费「订阅内容」与「取消邮件订阅」区分：后者允许辅助 */
  const PAID_SUBSCRIPTION_PATTERN =
    /subscribe now|subscription plan|vip|会员|开通|充值|paywall|付费订阅|升级会员/i;

  const AD_PATTERN =
    /advert|advertisement|adsby|ad-slot|ad-container|adunit|sponsor|promo|banner-ad|gg-ad|google_ads|taboola|outbrain|popunder|popup-ad|floating-ad|浮窗|广告|推广/i;

  function isAccessControlSurface(el, getText, getClass) {
    if (!el || !(el instanceof Element)) return false;
    const text = (getText ? getText(el) : el.innerText || "").slice(0, 600);
    const cls = getClass ? getClass(el) : String(el.className || "");
    const id = el.id || "";
    const aria = el.getAttribute("aria-label") || "";
    const combined = `${text} ${cls} ${id} ${aria}`;
    if (!ACCESS_CONTROL_PATTERN.test(combined)) return false;
    return PAID_SUBSCRIPTION_PATTERN.test(combined) || /login|register|passport|vip|付费|登录|注册|会员/i.test(combined);
  }

  function isLikelyAdvertisement(el, getText, getClass) {
    if (!el || isAccessControlSurface(el, getText, getClass)) return false;
    const text = (getText ? getText(el) : el.innerText || "").slice(0, 300);
    const cls = getClass ? getClass(el) : String(el.className || "");
    const id = el.id || "";
    return AD_PATTERN.test(`${text} ${cls} ${id}`);
  }

  function isBottomCornerFloater(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.position !== "fixed" && style.position !== "sticky") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;
    if (rect.width > window.innerWidth * 0.5 || rect.height > window.innerHeight * 0.5) return false;
    const inRightBottom =
      rect.right >= window.innerWidth * 0.55 && rect.bottom >= window.innerHeight * 0.55;
    return inRightBottom;
  }

  function mayHideAsNuisance(el, helpers) {
    if (isAccessControlSurface(el, helpers?.getText, helpers?.getClass)) return false;
    return (
      isLikelyAdvertisement(el, helpers?.getText, helpers?.getClass) ||
      isBottomCornerFloater(el)
    );
  }

  function mayInteractWithOverlay(el, helpers) {
    if (isAccessControlSurface(el, helpers?.getText, helpers?.getClass)) {
      return { allowed: false, reason: "access-control-surface" };
    }
    return { allowed: true, reason: "permitted" };
  }

  const COMPLIANCE_VERSION = "1.4.0";

  globalThis.SemanticShieldCompliance = {
    ACCESS_CONTROL_PATTERN,
    AD_PATTERN,
    isAccessControlSurface,
    isLikelyAdvertisement,
    isBottomCornerFloater,
    mayHideAsNuisance,
    mayInteractWithOverlay,
    COMPLIANCE_VERSION,
  };
})();
