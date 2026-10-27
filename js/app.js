import { h, clear, icon, closeTopSheet, showUndoSnackbar, sheet, toast } from "./ui.js";
import { init, subscribe, state, activateUserSession, clearSession, pendingCount, activeSession, flushOfflineQueue, onQueueChange } from "./store.js";
import { startRest } from "./timer.js";
import { waitForInitialAuth, onAuthChange } from "./auth.js";
import { isFirebaseConfigured } from "../firebase-config.js";
import { initTimerBar, refreshTimerI18n, stopRest } from "./timer.js";
import { t, getLang } from "./i18n.js";
import { applyTheme, openSettings } from "./views/settings.js";
import { openAuthScreen } from "./views/auth.js";
import { initPwa } from "./pwa.js";
import * as workout from "./views/workout.js";
import * as programs from "./views/programs.js";
import * as exercises from "./views/exercises.js";
import * as progress from "./views/progress.js";
import * as history from "./views/history.js";
import { initShell, isDesktop, checkShellSwitch, getDesktopViewContainer, updateRailActiveRoute, updateLiveStrip, updateRailUserInfo, updateRailSyncStatus, sharedState } from "./shell.js";
import { openPalette, initHotkeys } from "./palette.js";
import {
  renderDesktopPrograms,
  renderDesktopExercises,
  renderDesktopProgress,
  renderDesktopHistory,
  renderDesktopSettings
} from "./views/desktopViews.js";

initPwa();

const ROUTES = [
  { id: "workout", titleKey: "nav.workout", icon: "dumbbell", view: workout },
  { id: "programs", titleKey: "nav.programs", icon: "list", view: programs },
  { id: "exercises", titleKey: "nav.exercises", icon: "book", view: exercises },
  { id: "progress", titleKey: "nav.progress", icon: "chart", view: progress },
  { id: "history", titleKey: "nav.history", icon: "clock", view: history }
];

const main = document.getElementById("view");
const titleEl = document.getElementById("title");
const syncEl = document.getElementById("sync");
let current = null, currentId = null, enterTimer, lastLang = getLang();
let authOpen = false;
// Запрет любого масштабирования приложения (iOS Safari pinch, multi-touch, dblclick, wheel zoom, hotkeys)
["gesturestart", "gesturechange", "gestureend"].forEach(ev => {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
});
document.addEventListener("touchmove", e => {
  if (e.touches && e.touches.length > 1) e.preventDefault();
}, { passive: false });
document.addEventListener("touchstart", e => {
  if (e.touches && e.touches.length > 1) e.preventDefault();
}, { passive: false });
document.addEventListener("dblclick", e => e.preventDefault());
window.addEventListener("wheel", e => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });
window.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
    e.preventDefault();
  }
});

function route({ force = false } = {}) {
  if (!state.user) return;
  const rawId = (location.hash.replace(/^#\/?/, "") || "workout");

  if (isDesktop()) {
    if (rawId === "workout") {
      location.hash = "#/programs";
      return;
    }
    const desktopId = ["programs", "exercises", "progress", "history", "settings"].includes(rawId) ? rawId : "programs";
    if (!force && desktopId === currentId) {
      updateLiveStrip();
      return;
    }
    currentId = desktopId;
    const desktopContainer = getDesktopViewContainer();
    if (desktopContainer) {
      clear(desktopContainer);
      let viewNode = null;
      if (desktopId === "programs") viewNode = renderDesktopPrograms();
      else if (desktopId === "exercises") viewNode = renderDesktopExercises();
      else if (desktopId === "progress") viewNode = renderDesktopProgress();
      else if (desktopId === "history") viewNode = renderDesktopHistory();
      else if (desktopId === "settings") viewNode = renderDesktopSettings();
      if (viewNode) desktopContainer.append(viewNode);
    }
    updateRailActiveRoute(desktopId);
    updateLiveStrip();
    updateRailUserInfo();
    updateRailSyncStatus();
    return;
  }

  // Mobile mode
  if (rawId === "settings") {
    openSettings();
    location.hash = "#/programs";
    return;
  }
  const r = ROUTES.find(x => x.id === rawId) || ROUTES[0];
  if (!force && r.id === currentId) return;
  const preserveScroll = force && r.id === currentId;
  const prevWinY = preserveScroll ? window.scrollY : 0;
  if (current && current.destroy) current.destroy({ preserveMode: preserveScroll });
  currentId = r.id;
  const rTitle = t(r.titleKey);
  titleEl.textContent = rTitle;
  document.title = rTitle + " · " + t("app.name");
  clear(main);
  if (!preserveScroll) {
    main.classList.remove("enter"); void main.offsetWidth; main.classList.add("enter");
    clearTimeout(enterTimer); enterTimer = setTimeout(() => main.classList.remove("enter"), 700);
  }
  current = r.view.mount(main) || {};
  if (preserveScroll) {
    window.scrollTo(0, prevWinY);
  } else {
    main.scrollTop = 0; window.scrollTo(0, 0);
  }
  const activeIdx = Math.max(0, ROUTES.findIndex(x => x.id === r.id));
  const navEl = document.getElementById("nav");
  if (navEl) navEl.style.setProperty("--active-idx", String(activeIdx));
  document.querySelectorAll("#nav a").forEach(a => {
    const on = a.dataset.route === r.id;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

export function openCommandPalette() {
  openPalette();
}

function showAuthFlow() {
  if (authOpen) return;
  authOpen = true;
  stopRest();
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("hide");
    setTimeout(() => { if (splash && splash.parentNode) splash.remove(); }, 150);
  }
  if (current && current.destroy) current.destroy();
  current = null;
  currentId = null;
  clear(main);
  openAuthScreen(async () => {
    authOpen = false;
    lastLang = getLang();
    buildNav();
    refreshTimerI18n();
    await init();
    route({ force: true });
    paintSync();
  });
}

async function boot() {
  const splash = document.getElementById("splash");
  const splashBar = document.getElementById("splash-bar");
  const splashText = document.getElementById("splash-text");
  const splashTitle = splash && splash.querySelector(".splash-title");
  if (splashTitle) splashTitle.textContent = t("app.splashTitle");
  const setSplash = (pct, text) => {
    if (splashBar) splashBar.style.width = `${Math.max(12, Math.min(100, Math.round(pct)))}%`;
    if (splashText && text) splashText.textContent = text;
  };
  setSplash(18, t("app.connectingCloud"));

  applyTheme();
  buildNav();
  initTimerBar(document.getElementById("timer-bar"));
  initShell(() => {
    route({ force: true });
  });
  initHotkeys();
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeTopSheet();
      const cp = document.querySelector(".cmd-palette-backdrop");
      if (cp) cp.remove();
      return;
    }

    // Ctrl+K / Cmd+K -> Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    // Горячие клавиши активной тренировки (J/K навигация, Enter закрыть сет, R таймер)
    const isTyping = document.activeElement && (
      document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA" ||
      document.activeElement.isContentEditable
    );
    if (!isTyping && currentId === "workout") {
      const activeWork = activeSession();
      if (activeWork) {
        if (e.key.toLowerCase() === "j") {
          e.preventDefault();
          const undone = main.querySelectorAll(".set:not(.done)");
          if (undone.length > 0) undone[0].scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          const doneSets = main.querySelectorAll(".set.done");
          if (doneSets.length > 0) doneSets[doneSets.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (e.key === "Enter") {
          e.preventDefault();
          const nextBtn = main.querySelector(".set:not(.done) .done-btn");
          if (nextBtn) nextBtn.click();
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          startRest(state.settings.restSec || 90);
        }
      }
    }
  });
  window.addEventListener("hashchange", () => route());
  window.addEventListener("online", paintSync); window.addEventListener("offline", paintSync);
  if (typeof onQueueChange === "function") onQueueChange(() => paintSync());

  let first = true;
  subscribe(() => {
    applyTheme(); paintSync();
    if (!first && !state.user && !authOpen) {
      showAuthFlow();
      return;
    }
    const curLang = getLang();
    if (curLang !== lastLang) {
      lastLang = curLang;
      buildNav();
      refreshTimerI18n();
      if (!first && state.user) route({ force: true });
      return;
    }
    if (!first && state.user && current && current.update) {
      // не перерисовываем под руками, пока пользователь вводит текст в поле этого экрана
      current.update();
    }
  });

  const t0 = performance.now();
  if (!isFirebaseConfigured) throw new Error(t("auth.errNoConfig"));

  // Состояние входа берётся из IndexedDB без сети; без сессии (или по таймауту) показываем экран входа.
  const user = await waitForInitialAuth();
  if (user) {
    activateUserSession(user);
    await init((ratio, text) => setSplash(20 + ratio * 75, text));
    if (getLang() !== lastLang) {
      lastLang = getLang();
      buildNav();
      refreshTimerI18n();
    }
    setSplash(100, t("app.ready"));
    first = false;
    route(); paintSync();
  } else {
    setSplash(100, t("app.ready"));
    first = false;
    showAuthFlow();
  }

  // Дальнейшие изменения сессии: выход (в т.ч. из другой вкладки), удаление аккаунта, вход вне экрана входа.
  onAuthChange(async u => {
    if (authOpen) return; // экран входа/регистрации сам завершает активацию
    if (!u && state.user) { clearSession(); return; }
    if (u && !state.user) {
      activateUserSession(u);
      lastLang = getLang();
      buildNav(); refreshTimerI18n();
      await init();
      route({ force: true }); paintSync();
    }
  });
  const waitMs = Math.max(180, 420 - (performance.now() - t0));
  setTimeout(() => {
    if (!splash) return;
    splash.classList.add("hide");
    setTimeout(() => { if (splash && splash.parentNode) splash.remove(); }, 280);
  }, waitMs);

  // Safety watchdog: гарантирует, что сплеш никогда не зависнет на экране
  setTimeout(() => {
    const sp = document.getElementById("splash");
    if (sp) {
      console.warn("Splash watchdog: removing stuck splash screen");
      sp.classList.add("hide");
      setTimeout(() => { if (sp && sp.parentNode) sp.remove(); }, 200);
      if (!state.user && !authOpen) showAuthFlow();
    }
  }, 4500);
}

boot().catch(e => {
  console.error(e);
  const s = document.getElementById("splash-text") || document.getElementById("splash");
  if (s) s.textContent = t("app.bootError", { msg: e.message });
});

if ("serviceWorker" in navigator) {
  let refreshing = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !refreshing) { refreshing = true; location.reload(); }
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(reg => {
      const notifyUpdate = () => {
        showUndoSnackbar(
          t("app.updateAvailable"),
          t("app.updateBtn"),
          () => {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          },
          0
        );
      };

      if (reg.waiting) {
        notifyUpdate();
        return;
      }
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              notifyUpdate();
            }
          });
        }
      });
    }).catch(e => console.warn("SW:", e));
  });
}
