import { h, clear, icon, closeTopSheet } from "./ui.js";
import { init, subscribe, state } from "./store.js";
import { initTimerBar } from "./timer.js";
import { applyTheme, openSettings } from "./views/settings.js";
import * as workout from "./views/workout.js";
import * as programs from "./views/programs.js";
import * as exercises from "./views/exercises.js";
import * as progress from "./views/progress.js";
import * as history from "./views/history.js";

const ROUTES = [
  { id: "workout", title: "Тренировка", icon: "dumbbell", view: workout },
  { id: "programs", title: "Программы", icon: "list", view: programs },
  { id: "exercises", title: "Упражнения", icon: "book", view: exercises },
  { id: "progress", title: "Прогресс", icon: "chart", view: progress },
  { id: "history", title: "История", icon: "clock", view: history }
];

const main = document.getElementById("view");
const titleEl = document.getElementById("title");
const syncEl = document.getElementById("sync");
let current = null, currentId = null, enterTimer;
// iOS игнорирует user-scalable=no: блокируем жест щипка вручную
["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault()));
document.addEventListener("dblclick", e => e.preventDefault());

function route() {
  const id = (location.hash.replace(/^#\/?/, "") || "workout");
  const r = ROUTES.find(x => x.id === id) || ROUTES[0];
  if (r.id === currentId) return;
  if (current && current.destroy) current.destroy();
  currentId = r.id;
  titleEl.textContent = r.title;
  document.title = r.title + " · Тренировки";
  clear(main);
  main.classList.remove("enter"); void main.offsetWidth; main.classList.add("enter");
  clearTimeout(enterTimer); enterTimer = setTimeout(() => main.classList.remove("enter"), 700);
  current = r.view.mount(main) || {};
  main.scrollTop = 0; window.scrollTo(0, 0);
  document.querySelectorAll("#nav a").forEach(a => {
    const on = a.dataset.route === r.id;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function paintSync() {
  const s = state.sync;
  let text = "", label = "";
  if (s.error) { text = "Ошибка"; label = "Ошибка Firestore: " + s.error; }
  else if (!navigator.onLine) { text = "Офлайн"; label = "Нет сети. Данные сохраняются на устройстве и отправятся позже."; }
  // «идёт синхронизация» намеренно не показываем: при обычной работе это постоянный шум
  syncEl.textContent = text; syncEl.title = label; syncEl.hidden = !text;
}

function buildNav() {
  const nav = document.getElementById("nav");
  ROUTES.forEach(r => nav.append(h("a", { href: "#/" + r.id, dataset: { route: r.id } }, icon(r.icon, 24), h("span", {}, r.title))));
}

async function boot() {
  applyTheme();
  buildNav();
  initTimerBar(document.getElementById("timer-bar"));
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeTopSheet(); });
  window.addEventListener("hashchange", route);
  window.addEventListener("online", paintSync); window.addEventListener("offline", paintSync);
  let first = true;
  subscribe(() => {
    applyTheme(); paintSync();
    if (!first && current && current.update) {
      // не перерисовываем под руками, пока пользователь вводит текст в поле этого экрана
      current.update();
    }
  });
  await init();
  first = false;
  route(); paintSync();
  document.getElementById("splash")?.remove();
}

boot().catch(e => {
  console.error(e);
  const s = document.getElementById("splash");
  if (s) s.textContent = "Ошибка запуска: " + e.message;
});

if ("serviceWorker" in navigator) {
  let refreshing = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !refreshing) { refreshing = true; location.reload(); }
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(e => console.warn("SW:", e)));
}
