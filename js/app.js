import { h, clear, icon, closeTopSheet, showUndoSnackbar, sheet, toast } from "./ui.js";
import { init, subscribe, state, activateUserSession, clearSession, pendingCount, activeSession, flushOfflineQueue, onQueueChange } from "./store.js";
import { startRest } from "./timer.js";
import { waitForInitialAuth, onAuthChange } from "./auth.js";
import { isFirebaseConfigured } from "../firebase-config.js";
import { initTimerBar, refreshTimerI18n, stopRest } from "./timer.js";
import { t, getLang } from "./i18n.js";
import { applyTheme, openSettings } from "./views/settings.js?v=55";
import { openAuthScreen } from "./views/auth.js?v=55";
import { initPwa } from "./pwa.js?v=55";
import * as workout from "./views/workout.js?v=55";
import * as programs from "./views/programs.js?v=55";
import * as exercises from "./views/exercises.js?v=55";
import * as progress from "./views/progress.js?v=55";
import * as history from "./views/history.js?v=55";

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
  const id = (location.hash.replace(/^#\/?/, "") || "workout");
  const r = ROUTES.find(x => x.id === id) || ROUTES[0];
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

let prevQueueCount = 0;
let syncedFlashTimer = null;
let pendingDebounceTimer = null;
let isPendingVisible = false;
let wasOffline = !navigator.onLine;

function openSyncDetailsModal() {
  paintSync();
  const getInfo = () => {
    const isOnline = navigator.onLine;
    const qCount = typeof pendingCount === "function" ? pendingCount() : 0;
    const s = state.sync;

    const statusTitle = s.error
      ? t("app.syncStatusError")
      : (!isOnline ? t("app.syncStatusOffline") : (qCount > 0 ? t("app.syncStatusPending") : t("app.syncStatusOk")));

    const statusDesc = s.error
      ? t("app.syncErrorTitle", { err: s.error })
      : (!isOnline
          ? t("app.syncOfflineDesc")
          : (qCount > 0
              ? t("app.syncPendingDesc", { n: qCount })
              : t("app.syncOkDesc")));
    return { isOnline, qCount, s, statusTitle, statusDesc };
  };

  let info = getInfo();
  const statusIndicator = h("span", { class: "sync-status-indicator " + (info.s.error ? "err" : (info.qCount > 0 ? "warn" : (info.isOnline ? "ok" : "warn"))) });
  const statusH3 = h("h3", { style: "margin:0" }, info.statusTitle);
  const statusNetSmall = h("small", { class: "muted" }, info.isOnline ? t("app.networkOnline") : t("app.networkOffline"));
  const statusDescP = h("p", { class: "small", style: "margin:0 0 10px; line-height:1.4" }, info.statusDesc);
  const queueCountStrong = h("strong", { style: "font-variant-numeric:tabular-nums" }, `${info.qCount} ` + t("app.recordsUnit"));

  let sh;
  const syncNowBtn = h("button", {
    class: "btn primary block",
    type: "button",
    style: info.isOnline && info.qCount > 0 ? "" : "display:none",
    onclick: async () => {
      if (typeof flushOfflineQueue === "function") flushOfflineQueue();
      toast(t("app.syncTriggeredToast"));
      updateModal();
    }
  }, t("app.syncNowBtn"));

  function updateModal() {
    info = getInfo();
    statusIndicator.className = "sync-status-indicator " + (info.s.error ? "err" : (info.qCount > 0 ? "warn" : (info.isOnline ? "ok" : "warn")));
    statusH3.textContent = info.statusTitle;
    statusNetSmall.textContent = info.isOnline ? t("app.networkOnline") : t("app.networkOffline");
    statusDescP.textContent = info.statusDesc;
    queueCountStrong.textContent = `${info.qCount} ` + t("app.recordsUnit");
    syncNowBtn.style.display = (info.isOnline && info.qCount > 0) ? "" : "none";
    paintSync();
  }

  const unsub = typeof onQueueChange === "function" ? onQueueChange(updateModal) : null;

  const sheetContent = h("div", { class: "stack", style: "gap:16px" },
    h("div", { class: "row gap", style: "align-items:center" },
      statusIndicator,
      h("div", { class: "grow" },
        statusH3,
        statusNetSmall
      )
    ),
    h("div", { class: "panel", style: "padding:14px; margin:0; background:var(--card); border:1px solid var(--line); border-radius:var(--r-card)" },
      statusDescP,
      h("div", { class: "row gap", style: "justify-content:space-between; align-items:center" },
        h("small", { class: "muted" }, t("app.syncQueueLabel")),
        queueCountStrong
      )
    ),
    h("div", { class: "stack", style: "gap:8px" },
      syncNowBtn,
      h("button", { class: "btn block", type: "button", onclick: () => sh.close() }, t("common.close"))
    )
  );

  sh = sheet(sheetContent, {
    title: t("app.syncTitle"),
    onClose: () => {
      if (unsub) unsub();
    }
  });
}

function paintSync() {
  const s = state.sync;
  const qCount = typeof pendingCount === "function" ? pendingCount() : 0;
  const isOnline = navigator.onLine;
  let text = "", label = "", cls = "sync-pill";

  syncEl.setAttribute("role", "status");
  syncEl.onclick = openSyncDetailsModal;

  if (s.error) {
    if (pendingDebounceTimer) { clearTimeout(pendingDebounceTimer); pendingDebounceTimer = null; }
    if (syncedFlashTimer) { clearTimeout(syncedFlashTimer); syncedFlashTimer = null; }
    isPendingVisible = false;
    text = t("app.syncError");
    label = t("app.syncErrorTitle", { err: s.error });
    cls += " sync-error";
  } else if (!isOnline) {
    if (pendingDebounceTimer) { clearTimeout(pendingDebounceTimer); pendingDebounceTimer = null; }
    if (syncedFlashTimer) { clearTimeout(syncedFlashTimer); syncedFlashTimer = null; }
    wasOffline = true;
    isPendingVisible = false;
    text = qCount > 0 ? t("app.offlineQueued", { n: qCount }) : t("app.offline");
    label = t("app.offlineTitle");
    cls += " sync-offline";
  } else if (qCount > 0) {
    if (syncedFlashTimer) { clearTimeout(syncedFlashTimer); syncedFlashTimer = null; }
    if (!isPendingVisible) {
      if (!pendingDebounceTimer) {
        pendingDebounceTimer = setTimeout(() => {
          pendingDebounceTimer = null;
          isPendingVisible = true;
          paintSync();
        }, 350);
      }
      text = "";
    } else {
      text = t("app.syncQueueBadge", { n: qCount });
      label = t("app.syncPendingDesc", { n: qCount });
      cls += " sync-pending";
    }
  } else {
    // qCount === 0 and online and no error
    if (pendingDebounceTimer) { clearTimeout(pendingDebounceTimer); pendingDebounceTimer = null; }
    if (isPendingVisible || wasOffline) {
      isPendingVisible = false;
      wasOffline = false;
      text = t("app.synced");
      label = t("app.syncedTitle");
      cls += " sync-synced";
      clearTimeout(syncedFlashTimer);
      syncedFlashTimer = setTimeout(() => {
        syncedFlashTimer = null;
        paintSync();
      }, 2500);
    } else if (syncedFlashTimer) {
      text = t("app.synced");
      label = t("app.syncedTitle");
      cls += " sync-synced";
    }
  }

  prevQueueCount = qCount;
  syncEl.className = cls;
  syncEl.textContent = text;
  syncEl.title = label;
  syncEl.hidden = !text;
}

function buildNav() {
  const nav = document.getElementById("nav");
  clear(nav);
  nav.setAttribute("aria-label", t("app.navAria"));
  const curRouteId = currentId || (location.hash.replace(/^#\/?/, "") || "workout");
  const activeIdx = Math.max(0, ROUTES.findIndex(x => x.id === curRouteId));
  nav.style.setProperty("--active-idx", String(activeIdx));

  const navPill = h("span", { class: "nav-pill", "aria-hidden": "true" });
  nav.append(navPill);

  ROUTES.forEach((r, i) => {
    const on = i === activeIdx;
    const a = h("a", { href: "#/" + r.id, class: on ? "active" : "", dataset: { route: r.id } }, icon(r.icon, 24), h("span", {}, t(r.titleKey)));
    if (on) a.setAttribute("aria-current", "page");
    nav.append(a);
  });
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    settingsBtn.setAttribute("aria-label", t("app.settingsAria"));
    settingsBtn.setAttribute("title", t("app.settingsAria"));
  }
}

export function openCommandPalette() {
  const existing = document.querySelector(".cmd-palette-backdrop");
  if (existing) { existing.remove(); return; }

  const backdrop = h("div", { class: "cmd-palette-backdrop", role: "dialog", "aria-modal": "true" });
  const input = h("input", {
    type: "search",
    class: "cmd-input",
    placeholder: t("cmd.placeholder"),
    autocomplete: "off",
    enterkeyhint: "go"
  });
  const resultsBox = h("div", { class: "cmd-results" });
  const modal = h("div", { class: "cmd-modal" }, input, resultsBox);
  backdrop.append(modal);
  document.body.append(backdrop);

  let activeIdx = 0;
  let items = [];

  const close = () => {
    backdrop.classList.add("closing");
    setTimeout(() => backdrop.remove(), 140);
  };

  backdrop.addEventListener("pointerdown", e => {
    if (e.target === backdrop) close();
  });

  const getActions = (q = "") => {
    const list = [];
    list.push({
      category: t("cmd.actions"),
      title: t("cmd.openSettings"),
      action: () => { close(); openSettings(); }
    });
    list.push({
      category: t("cmd.actions"),
      title: t("cmd.toggleTheme"),
      action: () => {
        close();
        const cur = state.settings.theme;
        state.settings.theme = cur === "light" ? "dark" : "light";
        applyTheme();
      }
    });

    (state.programs || []).filter(p => !p.archived).forEach(p => {
      list.push({
        category: t("cmd.programs"),
        title: t("cmd.startWorkout", { name: p.name }),
        action: () => {
          close();
          localStorage.setItem("fitness.home.programId", p.id);
          location.hash = "#/workout";
        }
      });
    });

    (state.exercises || []).filter(e => !e.archived).forEach(e => {
      list.push({
        category: t("cmd.exercises"),
        title: e.name + (e.muscleGroup ? ` (${e.muscleGroup})` : ""),
        action: () => {
          close();
          location.hash = "#/exercises";
        }
      });
    });

    if (!q) return list;
    const lower = q.toLowerCase();
    return list.filter(it => it.title.toLowerCase().includes(lower));
  };

  const renderList = () => {
    resultsBox.replaceChildren();
    items = getActions(input.value.trim());
    if (!items.length) {
      resultsBox.append(h("div", { class: "cmd-empty" }, t("cmd.noResults")));
      return;
    }
    activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx));
    items.forEach((it, idx) => {
      const isSel = idx === activeIdx;
      const el = h("button", {
        type: "button",
        class: "cmd-item" + (isSel ? " on" : ""),
        onclick: () => it.action()
      },
        h("span", { class: "cmd-item-title grow" }, it.title),
        h("small", { class: "cmd-item-cat muted" }, it.category)
      );
      resultsBox.append(el);
    });
  };

  input.addEventListener("input", () => {
    activeIdx = 0;
    renderList();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % (items.length || 1);
      renderList();
      const onEl = resultsBox.querySelector(".cmd-item.on");
      if (onEl) onEl.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + items.length) % (items.length || 1);
      renderList();
      const onEl = resultsBox.querySelector(".cmd-item.on");
      if (onEl) onEl.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[activeIdx]) items[activeIdx].action();
    }
  });

  renderList();
  setTimeout(() => input.focus(), 30);
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
