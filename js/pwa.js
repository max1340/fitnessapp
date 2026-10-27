import { h, sheet, toast, icon, haptic } from "./ui.js";
import { t } from "./i18n.js";

let deferredPrompt = null;
const pwaListeners = new Set();

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    !!navigator.standalone ||
    (document.referrer && document.referrer.startsWith("android-app://"))
  );
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function canDirectPrompt() {
  return !isStandalone() && !!deferredPrompt;
}

export function canShowInstallBanner() {
  if (typeof window === "undefined") return false;
  if (isStandalone()) return false;
  if (typeof localStorage !== "undefined" && localStorage.getItem("pwa_banner_dismissed") === "1") return false;
  return canDirectPrompt() || isIos();
}

export function dismissInstallBanner() {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("pwa_banner_dismissed", "1");
  }
}

export function renderSlimInstallBanner(onDismiss) {
  if (!canShowInstallBanner()) return null;
  const bar = h("div", { class: "pwa-slim-bar", role: "region", "aria-label": t("pwa.settingsTitle") },
    h("div", { class: "pwa-slim-ico", "aria-hidden": "true" }, icon("download", 16)),
    h("span", { class: "pwa-slim-text" }, t("pwa.slimText")),
    h("button", {
      type: "button",
      class: "pwa-slim-btn",
      onclick: () => promptPwaInstall()
    }, t("pwa.installAction")),
    h("button", {
      type: "button",
      class: "pwa-slim-close",
      "aria-label": t("common.close"),
      onclick: () => {
        dismissInstallBanner();
        bar.remove();
        if (typeof onDismiss === "function") onDismiss();
      }
    }, icon("x", 14))
  );
  return bar;
}

export function onPwaChange(fn) {
  pwaListeners.add(fn);
  return () => pwaListeners.delete(fn);
}

function notifyPwaChange() {
  for (const fn of pwaListeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

export function initPwa() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
    notifyPwaChange();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyPwaChange();
    toast(t("pwa.installedSuccess"));
  });
}

export function showIosInstallGuide() {
  const body = h("div", { class: "stack pwa-guide-stack" },
    h("div", { class: "pwa-step" },
      h("div", { class: "pwa-step-num" }, "1"),
      h("div", { class: "pwa-step-content" },
        h("strong", {}, t("pwa.iosStep1")),
        h("small", { class: "muted" }, t("pwa.iosStep1Sub")))),
    h("div", { class: "pwa-step" },
      h("div", { class: "pwa-step-num" }, "2"),
      h("div", { class: "pwa-step-content" },
        h("strong", {}, t("pwa.iosStep2")),
        h("small", { class: "muted" }, t("pwa.iosStep2Sub")))),
    h("div", { class: "pwa-step" },
      h("div", { class: "pwa-step-num" }, "3"),
      h("div", { class: "pwa-step-content" },
        h("strong", {}, t("pwa.iosStep3")),
        h("small", { class: "muted" }, t("pwa.iosStep3Sub"))))
  );

  sheet(body, { title: t("pwa.iosSheetTitle") });
}

export async function promptPwaInstall() {
  haptic("medium");
  if (isStandalone()) {
    toast(t("pwa.alreadyInstalled"));
    return;
  }

  if (deferredPrompt) {
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === "accepted") {
        deferredPrompt = null;
        notifyPwaChange();
      }
    } catch (e) {
      console.warn("PWA prompt error:", e);
    }
    return;
  }

  if (isIos()) {
    showIosInstallGuide();
    return;
  }

  // Общая инструкция для Chromium / Desktop, если диалог уже не активен
  const body = h("div", { class: "stack pwa-guide-stack" },
    h("div", { class: "pwa-step" },
      h("div", { class: "pwa-step-num" }, "1"),
      h("div", { class: "pwa-step-content" },
        h("strong", {}, t("pwa.androidStepTitle")),
        h("small", { class: "muted" }, t("pwa.androidStepSub"))))
  );
  sheet(body, { title: t("pwa.androidSheetTitle") });
}
