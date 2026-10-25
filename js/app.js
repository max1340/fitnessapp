import { h, clear, icon, closeTopSheet } from "./ui.js";
import { init, subscribe, state } from "./store.js";
import { initTimerBar, refreshTimerI18n } from "./timer.js";
import { t, getLang } from "./i18n.js";
import { applyTheme, openSettings } from "./views/settings.js";
import * as workout from "./views/workout.js";
import * as programs from "./views/programs.js";
import * as exercises from "./views/exercises.js";
import * as progress from "./views/progress.js";
import * as history from "./views/history.js";

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
// iOS игнорирует user-scalable=no: блокируем жест щипка вручную
["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault()));
document.addEventListener("dblclick", e => e.preventDefault());

function route({ force = false } = {}) {
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
  document.querySelectorAll("#nav a").forEach(a => {
    const on = a.dataset.route === r.id;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function paintSync() {
  const s = state.sync;
  let text = "", label = "";
  if (s.error) { text = t("app.syncError"); label = t("app.syncErrorTitle", { err: s.error }); }
  else if (!navigator.onLine) { text = t("app.offline"); label = t("app.offlineTitle"); }
  // «идёт синхронизация» намеренно не показываем: при обычной работе это постоянный шум
  syncEl.textContent = text; syncEl.title = label; syncEl.hidden = !text;
}

function buildNav() {
  const nav = document.getElementById("nav");
  clear(nav);
  nav.setAttribute("aria-label", t("app.navAria"));
  ROUTES.forEach(r => nav.append(h("a", { href: "#/" + r.id, dataset: { route: r.id } }, icon(r.icon, 24), h("span", {}, t(r.titleKey)))));
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    settingsBtn.setAttribute("aria-label", t("app.settingsAria"));
    settingsBtn.setAttribute("title", t("app.settingsAria"));
  }
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
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeTopSheet(); });
  window.addEventListener("hashchange", () => route());
  window.addEventListener("online", paintSync); window.addEventListener("offline", paintSync);
  let first = true;
  subscribe(() => {
    applyTheme(); paintSync();
    const curLang = getLang();
    if (curLang !== lastLang) {
      lastLang = curLang;
      buildNav();
      refreshTimerI18n();
      if (!first) route({ force: true });
      return;
    }
    if (!first && current && current.update) {
      // не перерисовываем под руками, пока пользователь вводит текст в поле этого экрана
      current.update();
    }
  });
  const t0 = performance.now();
  await init((ratio, text) => setSplash(20 + ratio * 75, text));
  if (getLang() !== lastLang) {
    lastLang = getLang();
    buildNav();
    refreshTimerI18n();
  }
  setSplash(100, t("app.ready"));
  first = false;
  route(); paintSync();
  const waitMs = Math.max(180, 420 - (performance.now() - t0));
  setTimeout(() => {
    if (!splash) return;
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 280);
  }, waitMs);
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
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(e => console.warn("SW:", e)));
}
