// Контроллер оболочек (Desktop vs Mobile)
import { state, updateSettings, activeSession, getProgram } from "./store.js";
import { h, clear, icon, toast } from "./ui.js";
import { t, isEn } from "./i18n.js";
import { openPalette } from "./palette.js";

const MQ_DESKTOP = "(min-width: 960px)";
let mql = null;
let currentShell = null; // "mobile" | "desktop"
let resizeDebounceTimer = null;
let liveStripTimer = null;
let routerCallback = null;

/** Общее состояние между оболочками — сохраняется при ресайзе через 1024px */
export const sharedState = {
  selectedProgramId: null,
  programEditorTab: "exercises", // "exercises" | "balance" | "templates"
  expandedExerciseKeys: new Set(),
  selectedHistoryId: null,
  historyMonthFilter: "all",
  selectedMuscleGroup: null,
  selectedExerciseId: null,
  progressPeriod: "30", // "7" | "30" | "all"
  progressExerciseId: null,
  settingsSection: "appearance",
  exerciseSearchQuery: ""
};

/** Получить режим интерфейса: "auto" | "mobile" | "desktop" */
export function getInterfaceMode() {
  if (state.settings?.interface && ["auto", "mobile", "desktop"].includes(state.settings.interface)) {
    return state.settings.interface;
  }
  try {
    const s = JSON.parse(localStorage.getItem("fitness:device:prefs") || "{}");
    if (["auto", "mobile", "desktop"].includes(s.interface)) return s.interface;
  } catch {}
  return "auto";
}

/** Установить режим интерфейса */
export function setInterfaceMode(mode) {
  if (!["auto", "mobile", "desktop"].includes(mode)) mode = "auto";
  if (state.settings) state.settings.interface = mode;
  try {
    const s = JSON.parse(localStorage.getItem("fitness:device:prefs") || "{}");
    s.interface = mode;
    localStorage.setItem("fitness:device:prefs", JSON.stringify(s));
  } catch {}
  updateSettings({ interface: mode });
  checkShellSwitch(true);
}

/** Вычислить активную оболочку на основе режима и ширины экрана */
export function computeShell() {
  const mode = getInterfaceMode();
  if (mode === "mobile") return "mobile";
  if (mode === "desktop") return "desktop";
  if (!mql && typeof window !== "undefined") {
    mql = window.matchMedia(MQ_DESKTOP);
  }
  return mql && mql.matches ? "desktop" : "mobile";
}

export function isDesktop() {
  return currentShell === "desktop";
}

export function getCurrentShell() {
  return currentShell;
}

/**
 * Инициализация контроллера оболочек
 * @param {Function} onShellChange - вызывается для перерендеринга активного роута
 */
export function initShell(onShellChange) {
  routerCallback = onShellChange;
  if (typeof window === "undefined") return;

  mql = window.matchMedia(MQ_DESKTOP);
  mql.addEventListener("change", () => checkShellSwitch(false));

  window.addEventListener("resize", () => {
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      checkShellSwitch(false);
    }, 150);
  });

  currentShell = computeShell();
  applyShellToBody(currentShell);
}

function applyShellToBody(shell) {
  document.body.setAttribute("data-shell", shell);
  const appEl = document.getElementById("app");
  let desktopShellEl = document.getElementById("desktop-shell");

  if (shell === "desktop") {
    if (appEl) appEl.style.display = "none";
    if (!desktopShellEl) {
      desktopShellEl = buildDesktopShellDom();
      document.body.append(desktopShellEl);
    } else {
      desktopShellEl.style.display = "grid";
    }
    updateLiveStrip();
    startLiveStripTimer();
  } else {
    if (appEl) appEl.style.display = "";
    if (desktopShellEl) desktopShellEl.style.display = "none";
    stopLiveStripTimer();
  }
}

export function checkShellSwitch(force = false) {
  const nextShell = computeShell();
  if (force || nextShell !== currentShell) {
    const prevShell = currentShell;
    currentShell = nextShell;
    applyShellToBody(currentShell);
    if (routerCallback) {
      routerCallback({ fromShell: prevShell, toShell: currentShell, force: true });
    }
  }
}

/* ==================== DESKTOP SHELL DOM ==================== */

let liveStripEl = null;
let desktopViewContainer = null;
let railSyncPillEl = null;
let railUserChipEl = null;

function buildDesktopShellDom() {
  const shell = h("div", { id: "desktop-shell", class: "desktop-shell" });

  // 1. Rail (aside 232px)
  const rail = h("aside", { class: "rail" });

  // Logo
  const logoBox = h("span", { class: "logo" },
    icon("dumbbell", 20)
  );
  const wordmark = h("span", { class: "wordmark" }, t("app.splashTitle") || "ТРЕНИРОВКИ");
  const railLogo = h("div", { class: "railLogo" }, logoBox, wordmark);

  // Navigation 5 items
  const navItems = [
    { id: "programs", labelKey: "nav.programs", iconD: "M4 6h16M4 12h16M4 18h10" },
    { id: "exercises", labelKey: "nav.exercises", isRect: true },
    { id: "progress", labelKey: "nav.progress", iconD: "m4 17 5-6 4 4 7-8" },
    { id: "history", labelKey: "nav.history", isClock: true },
    { id: "settings", labelKey: "nav.settings", isGear: true }
  ];

  const navList = h("nav", { class: "railNav", "aria-label": t("app.navAria") });

  navItems.forEach(item => {
    let iconSvg;
    if (item.isRect) {
      iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      iconSvg.setAttribute("width", "18"); iconSvg.setAttribute("height", "18");
      iconSvg.setAttribute("viewBox", "0 0 24 24"); iconSvg.setAttribute("fill", "none");
      iconSvg.setAttribute("stroke", "currentColor"); iconSvg.setAttribute("stroke-width", "2");
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", "5"); rect.setAttribute("y", "4");
      rect.setAttribute("width", "14"); rect.setAttribute("height", "16"); rect.setAttribute("rx", "2");
      iconSvg.append(rect);
    } else if (item.isClock) {
      iconSvg = icon("clock", 18);
    } else if (item.isGear) {
      iconSvg = icon("gear", 18);
    } else {
      iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      iconSvg.setAttribute("width", "18"); iconSvg.setAttribute("height", "18");
      iconSvg.setAttribute("viewBox", "0 0 24 24"); iconSvg.setAttribute("fill", "none");
      iconSvg.setAttribute("stroke", "currentColor"); iconSvg.setAttribute("stroke-width", "2");
      iconSvg.setAttribute("stroke-linecap", "round");
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", item.iconD); iconSvg.append(p);
    }

    const btn = h("button", {
      type: "button",
      class: "navBtn",
      dataset: { v: item.id },
      onclick: () => {
        location.hash = "#/" + item.id;
      }
    }, iconSvg, t(item.labelKey));

    navList.append(btn);
  });

  // Rail Footer
  const railFoot = h("div", { class: "railFoot" });

  // Sync pill
  railSyncPillEl = h("button", {
    type: "button",
    class: "syncPill",
    onclick: () => {
      const syncEl = document.getElementById("sync");
      if (syncEl && typeof syncEl.onclick === "function") syncEl.onclick();
    }
  }, h("i"), h("span", {}, t("app.synced") || "Синхронизировано"));

  // Quick interface mode switcher
  const modeBtn = h("button", {
    type: "button",
    class: "interfaceSwitchBtn quiet",
    title: t("settings.interface") || "Интерфейс",
    onclick: () => {
      const cur = getInterfaceMode();
      const next = cur === "auto" ? "desktop" : (cur === "desktop" ? "mobile" : "auto");
      setInterfaceMode(next);
      updateInterfaceSwitchBtn();
      toast(t("settings.interface") + ": " + getInterfaceModeLabel(next));
    }
  });

  function updateInterfaceSwitchBtn() {
    const cur = getInterfaceMode();
    modeBtn.textContent = (t("settings.interface") || "Интерфейс") + ": " + getInterfaceModeLabel(cur);
  }
  updateInterfaceSwitchBtn();

  // User Chip
  const userAva = h("span", { class: "ava" }, "М");
  const userName = h("b", { style: "font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, "User");
  railUserChipEl = h("button", {
    type: "button",
    class: "userChip",
    title: t("settings.navAccount") || "Аккаунт",
    onclick: () => {
      location.hash = "#/settings";
      sharedState.settingsSection = "account";
      const accSec = document.getElementById("sec-account");
      if (accSec) accSec.scrollIntoView({ behavior: "smooth" });
    }
  }, userAva, userName);

  updateRailUserInfo();

  railFoot.append(railSyncPillEl, modeBtn, railUserChipEl);
  rail.append(railLogo, navList, railFoot);

  // 2. Main content area
  const main = h("div", { class: "main desktop-main" });

  // Live Strip
  liveStripEl = h("div", { class: "liveStrip", style: "display:none;" });
  desktopViewContainer = h("div", { id: "desktop-view-container", class: "desktop-view-container" });

  main.append(liveStripEl, desktopViewContainer);
  shell.append(rail, main);

  return shell;
}

function getInterfaceModeLabel(mode) {
  if (mode === "auto") return t("settings.interfaceAuto") || "Авто";
  if (mode === "mobile") return t("settings.interfaceMobile") || "Моб.";
  return t("settings.interfaceDesktop") || "Десктоп";
}

export function updateRailUserInfo() {
  if (!railUserChipEl) return;
  const u = state.user;
  const name = u ? (u.displayName || u.email || "User") : "Гость";
  const firstLetter = (name[0] || "U").toUpperCase();
  const ava = railUserChipEl.querySelector(".ava");
  const b = railUserChipEl.querySelector("b");
  if (ava) ava.textContent = firstLetter;
  if (b) b.textContent = name;
}

export function updateRailSyncStatus() {
  if (!railSyncPillEl) return;
  const isOnline = navigator.onLine;
  const qCount = typeof state.sync?.pendingCount === "function" ? state.sync.pendingCount() : 0;
  const s = state.sync;
  const dot = railSyncPillEl.querySelector("i");
  const text = railSyncPillEl.querySelector("span");

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

export function updateRailActiveRoute(routeId) {
  const desktopShell = document.getElementById("desktop-shell");
  if (!desktopShell) return;
  desktopShell.querySelectorAll(".navBtn").forEach(btn => {
    const on = btn.dataset.v === routeId;
    btn.classList.toggle("on", on);
  });
}

export function getDesktopViewContainer() {
  if (!desktopViewContainer) {
    desktopViewContainer = document.getElementById("desktop-view-container");
  }
  return desktopViewContainer;
}

/* ==================== LIVE STRIP ==================== */

export function updateLiveStrip() {
  if (!liveStripEl) liveStripEl = document.querySelector(".liveStrip");
  if (!liveStripEl) return;

  const session = activeSession();
  if (!session) {
    liveStripEl.style.display = "none";
    return;
  }

  const progName = session.name || (session.programId && getProgram(session.programId)?.name) || t("builder.defaultProgName") || "Fullbody";
  const elapsedMs = Math.max(0, Date.now() - (session.startedAt || Date.now()));
  const totalSec = Math.floor(elapsedMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const timeStr = `${m}:${s < 10 ? "0" : ""}${s}`;

  let totalSets = 0, doneSets = 0;
  (session.entries || []).forEach(e => {
    (e.sets || []).forEach(st => {
      totalSets++;
      if (st.done) doneSets++;
    });
  });

  const setsText = isEn() ? `${doneSets}/${totalSets} sets` : `${doneSets}/${totalSets} сетов`;
  const infoMain = `${progName} · ${timeStr} · ${setsText}`;
  const noticeText = isEn()
    ? "Session active on phone: "
    : "Сессия идёт на телефоне: ";
  const suffix = isEn()
    ? " — workout log available only on mobile"
    : " — журнал тренировки доступен только на мобильном";

  liveStripEl.innerHTML = `<i></i>${noticeText}<b>${infoMain}</b>${suffix}`;
  liveStripEl.style.display = "flex";
}

function startLiveStripTimer() {
  stopLiveStripTimer();
  liveStripTimer = setInterval(() => {
    if (currentShell === "desktop") updateLiveStrip();
  }, 1000);
}

function stopLiveStripTimer() {
  if (liveStripTimer) {
    clearInterval(liveStripTimer);
    liveStripTimer = null;
  }
}
