// Главный модуль для отдельной десктоп-страницы desktop.html
import {
  init, subscribe, state, activateUserSession, clearSession,
  pendingCount, activeSession, flushOfflineQueue, onQueueChange, getProgram
} from "./store.js";
import { waitForInitialAuth, onAuthChange } from "./auth.js";
import { isFirebaseConfigured } from "../firebase-config.js";
import { t, getLang, isEn } from "./i18n.js";
import { h, clear, toast, sheet } from "./ui.js";
import { sharedState, getInterfaceMode, setInterfaceMode } from "./shell.js";
import { openPalette, initHotkeys } from "./palette.js";
import { applyTheme } from "./views/settings.js";
import {
  renderDesktopPrograms,
  renderDesktopExercises,
  renderDesktopProgress,
  renderDesktopHistory,
  renderDesktopSettings
} from "./views/desktopViews.js";

const VALID_ROUTES = ["programs", "exercises", "progress", "history", "settings"];

const viewContainer = document.getElementById("desktop-view-container");
const liveStripEl = document.getElementById("live-strip");
const syncPillEl = document.getElementById("rail-sync");
const userChipEl = document.getElementById("rail-user");
const modeBtn = document.getElementById("rail-mode-btn");

let currentRoute = null;
let liveStripTimer = null;

function getActiveRouteId() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash || hash === "workout") return "programs";
  return VALID_ROUTES.includes(hash) ? hash : "programs";
}

function updateNavHighlight(routeId) {
  document.querySelectorAll(".railNav .navBtn").forEach(btn => {
    const on = btn.dataset.v === routeId;
    btn.classList.toggle("on", on);
  });
}

function renderRoute(routeId, force = false) {
  if (currentRoute === routeId && !force) return;
  currentRoute = routeId;

  if (location.hash !== "#/" + routeId) {
    window.history.replaceState(null, "", "#/" + routeId);
  }

  updateNavHighlight(routeId);

  const titleMap = {
    programs: "nav.programs",
    exercises: "nav.exercises",
    progress: "nav.progress",
    history: "nav.history",
    settings: "settings.title"
  };
  document.title = (t(titleMap[routeId]) || "Программы") + " · " + (t("app.name") || "Тренировки");

  clear(viewContainer);
  let viewNode = null;
  if (routeId === "programs") viewNode = renderDesktopPrograms();
  else if (routeId === "exercises") viewNode = renderDesktopExercises();
  else if (routeId === "progress") viewNode = renderDesktopProgress();
  else if (routeId === "history") viewNode = renderDesktopHistory();
  else if (routeId === "settings") viewNode = renderDesktopSettings();

  if (viewNode) viewContainer.append(viewNode);
  viewContainer.scrollTop = 0;
}

function updateUserInfo() {
  if (!userChipEl) return;
  const u = state.user;
  const name = u ? (u.displayName || u.email || "User") : "Гость";
  const firstLetter = (name[0] || "U").toUpperCase();
  const ava = userChipEl.querySelector(".ava");
  const b = userChipEl.querySelector("#rail-user-name");
  if (ava) ava.textContent = firstLetter;
  if (b) b.textContent = name;
}

function updateSyncStatus() {
  if (!syncPillEl) return;
  const isOnline = navigator.onLine;
  const qCount = typeof pendingCount === "function" ? pendingCount() : 0;
  const s = state.sync;
  const dot = syncPillEl.querySelector("i");
  const text = syncPillEl.querySelector("span");

  if (s?.error) {
    if (dot) dot.style.background = "var(--danger)";
    if (text) text.textContent = t("app.syncError") || "Ошибка";
  } else if (!isOnline) {
    if (dot) dot.style.background = "var(--warn)";
    if (text) text.textContent = t("app.offline") || "Офлайн";
  } else if (qCount > 0) {
    if (dot) dot.style.background = "var(--warn)";
    if (text) text.textContent = `${t("app.syncStatusPending") || "Очередь"}: ${qCount}`;
  } else {
    if (dot) dot.style.background = "var(--ok)";
    if (text) text.textContent = t("app.synced") || "Синхронизировано";
  }
}

function updateLiveStrip() {
  if (!liveStripEl) return;
  const session = activeSession();
  if (!session || session.status !== "active") {
    liveStripEl.style.display = "none";
    clear(liveStripEl);
    return;
  }

  const p = getProgram(session.programId);
  const progName = p?.name || session.programName || (isEn() ? "Workout" : "Тренировка");
  const elapsedSec = Math.max(0, Math.floor((Date.now() - (session.startedAt || Date.now())) / 1000));
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const timeStr = `${mm}:${ss}`;

  let doneSets = 0;
  let totalSets = 0;
  (session.entries || []).forEach(e => {
    (e.sets || []).forEach(s => {
      totalSets++;
      if (s.done) doneSets++;
    });
  });

  const setsText = isEn() ? `${doneSets}/${totalSets} sets` : `${doneSets}/${totalSets} сетов`;
  const infoText = isEn()
    ? `Session active on mobile: ${progName} · ${timeStr} · ${setsText} — workout log is only available on mobile`
    : `Сессия идёт на телефоне: ${progName} · ${timeStr} · ${setsText} — журнал тренировки доступен только на мобильном`;

  clear(liveStripEl);
  const pulseDot = h("i", { class: "pulseDot" });
  const textEl = h("span", { class: "liveStripText" }, infoText);
  liveStripEl.append(pulseDot, textEl);
  liveStripEl.style.display = "flex";
}

function updateInterfaceModeBtn() {
  if (!modeBtn) return;
  modeBtn.textContent = isEn() ? "Interface: Desktop" : "Интерфейс: Десктоп";
}

function openSyncDetailsModal() {
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
        : (qCount > 0 ? t("app.syncPendingDesc", { n: qCount }) : t("app.syncOkDesc")));

  const syncNowBtn = h("button", {
    class: "btnP",
    style: "width:100%;justify-content:center;" + (isOnline && qCount > 0 ? "" : "display:none;"),
    type: "button",
    onclick: async () => {
      if (typeof flushOfflineQueue === "function") flushOfflineQueue();
      toast(t("app.syncTriggeredToast") || "Синхронизация запущена");
      sh.close();
    }
  }, t("app.syncNowBtn") || "Синхронизировать сейчас");

  const closeBtn = h("button", {
    class: "btnGhost",
    style: "width:100%;justify-content:center;",
    type: "button",
    onclick: () => sh.close()
  }, t("common.close") || "Закрыть");

  const content = h("div", { style: "display:flex;flex-direction:column;gap:16px;" },
    h("h3", { style: "margin:0;font-size:16px;font-weight:700;" }, statusTitle),
    h("p", { style: "margin:0;font-size:14px;color:var(--ink2);line-height:1.4;" }, statusDesc),
    h("div", { class: "card", style: "padding:12px 14px;" },
      h("div", { style: "display:flex;justify-content:space-between;align-items:center;" },
        h("span", { style: "font-size:13px;color:var(--ink2);" }, t("app.syncQueueLabel") || "Очередь изменений:"),
        h("b", { style: "font-size:14px;font-variant-numeric:tabular-nums;" }, `${qCount} ` + (t("app.recordsUnit") || "зап."))
      )
    ),
    h("div", { style: "display:flex;flex-direction:column;gap:8px;margin-top:8px;" },
      syncNowBtn,
      closeBtn
    )
  );

  const sh = sheet(content, { title: t("app.syncTitle") || "Синхронизация" });
}

async function bootDesktop() {
  applyTheme();

  // Навигация кликами по кнопкам рельсы
  document.querySelectorAll(".railNav .navBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.v;
      if (v) location.hash = "#/" + v;
    });
  });

  // Нижние кнопки рельсы
  if (syncPillEl) syncPillEl.addEventListener("click", openSyncDetailsModal);
  if (userChipEl) {
    userChipEl.addEventListener("click", () => {
      location.hash = "#/settings";
      sharedState.settingsSection = "account";
    });
  }
  if (modeBtn) {
    modeBtn.addEventListener("click", () => {
      setInterfaceMode("mobile");
      location.replace("./" + location.hash);
    });
  }

  // Горячие клавиши и командная строка
  initHotkeys();
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
    }
  });

  window.addEventListener("hashchange", () => {
    renderRoute(getActiveRouteId());
  });

  window.addEventListener("online", updateSyncStatus);
  window.addEventListener("offline", updateSyncStatus);
  if (typeof onQueueChange === "function") onQueueChange(updateSyncStatus);

  // Таймер live-полосы активной сессии
  liveStripTimer = setInterval(updateLiveStrip, 1000);

  // Слушатель состояния хранилища
  subscribe(() => {
    applyTheme();
    updateUserInfo();
    updateSyncStatus();
    updateLiveStrip();
  });

  if (!isFirebaseConfigured) {
    toast("Firebase not configured");
    return;
  }

  const user = await waitForInitialAuth();
  if (user) {
    activateUserSession(user);
    await init();
    updateUserInfo();
    updateSyncStatus();
    updateLiveStrip();
    updateInterfaceModeBtn();
    renderRoute(getActiveRouteId(), true);
  } else {
    // Если пользователь не вошёл, перенаправляем на главную страницу для входа
    location.replace("./");
  }

  onAuthChange(async u => {
    if (!u) {
      location.replace("./");
    } else {
      activateUserSession(u);
      await init();
      updateUserInfo();
      updateSyncStatus();
      updateLiveStrip();
      renderRoute(getActiveRouteId(), true);
    }
  });
}

bootDesktop().catch(console.error);
