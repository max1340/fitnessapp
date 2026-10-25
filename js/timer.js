// Таймер отдыха. Работает по абсолютному времени окончания, поэтому не «уплывает»
// при сворачивании вкладки. Не блокирует ввод: это узкая плашка над нижней навигацией.
import { h, fmtRest } from "./ui.js";
import { state } from "./store.js";
import { t } from "./i18n.js";

let endAt = 0, total = 0, label = "", ticking = null, fired = false, bar, audioCtx;
const els = {};

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* звук недоступен */ }
}

function askNotifyPermission() {
  if (state.settings.notifications === false) return;
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

async function sendNotification() {
  if (state.settings.notifications === false || !("Notification" in window) || Notification.permission !== "granted") return;
  const title = t("timer.restOver");
  const opts = {
    body: label || t("timer.nextSetBody"),
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "fitness-rest-timer",
    renotify: true,
    Silent: !state.settings.sound
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
  } catch { /* fallback ниже */ }
  try { new Notification(title, opts); } catch { /* ignore */ }
}

async function clearNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.getNotifications) {
      const list = await reg.getNotifications({ tag: "fitness-rest-timer" });
      list.forEach(n => n.close());
    }
  } catch { /* ignore */ }
}

function beep() {
  if (!state.settings.sound || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  [0, 0.28, 0.56].forEach((d, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = i === 2 ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
    o.connect(g).connect(audioCtx.destination); o.start(t0 + d); o.stop(t0 + d + 0.25);
  });
}

function finish() {
  fired = true;
  beep();
  if (state.settings.vibration && navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]);
  sendNotification();
}

function render() {
  if (!bar) return;
  const left = Math.ceil((endAt - Date.now()) / 1000);
  if (!endAt) { bar.hidden = true; document.body.classList.remove("timer-on"); return; }
  bar.hidden = false; document.body.classList.add("timer-on");
  if (left <= 0 && !fired) finish();
  const over = left <= 0;
  bar.classList.toggle("over", over);
  els.time.textContent = over ? t("timer.restOver") : fmtRest(left);
  els.label.textContent = label;
  els.fill.style.width = (over ? 100 : Math.max(0, Math.min(100, ((total - left) / total) * 100))) + "%";
  els.skip.textContent = over ? t("common.close") : t("timer.skip");
}

function loop() { if (!ticking) ticking = setInterval(render, 250); render(); }

export function startRest(sec, lbl = "") {
  if (!sec || sec <= 0) return;
  ensureAudio();
  askNotifyPermission();
  clearNotifications();
  endAt = Date.now() + sec * 1000; total = sec; label = lbl; fired = false;
  loop();
}

export function addRest(sec) {
  if (!endAt) return;
  if (fired && sec > 0) {
    endAt = Date.now() + sec * 1000; total = sec; fired = false;
    clearNotifications();
  } else {
    endAt += sec * 1000;
    total = Math.max(1, total + sec);
    if (endAt <= Date.now() && !fired) finish();
  }
  render();
}

export function stopRest() {
  endAt = 0; clearInterval(ticking); ticking = null;
  clearNotifications();
  render();
}

export const isResting = () => endAt > 0;

export function refreshTimerI18n() {
  if (!bar) return;
  if (els.minus) {
    els.minus.textContent = t("timer.minus15");
    els.minus.setAttribute("aria-label", t("timer.minus15Aria"));
  }
  if (els.plus) {
    els.plus.textContent = t("timer.plus30");
    els.plus.setAttribute("aria-label", t("timer.plus30Aria"));
  }
  if (els.skip) els.skip.textContent = t("timer.skip");
  render();
}

export function initTimerBar(container) {
  bar = container;
  els.time = h("strong", { class: "timer-time", "aria-live": "off" });
  els.label = h("small", { class: "muted timer-label" });
  els.fill = h("div", { class: "timer-fill" });
  els.minus = h("button", { class: "btn small", type: "button", "aria-label": t("timer.minus15Aria"), onclick: () => addRest(-15) }, t("timer.minus15"));
  els.plus = h("button", { class: "btn small", type: "button", "aria-label": t("timer.plus30Aria"), onclick: () => addRest(30) }, t("timer.plus30"));
  els.skip = h("button", { class: "btn small", type: "button", onclick: stopRest }, t("timer.skip"));
  bar.append(els.fill,
    h("div", { class: "timer-row" },
      h("div", { class: "grow" }, els.time, els.label),
      els.minus,
      els.plus,
      els.skip));
  bar.hidden = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { render(); if (fired) clearNotifications(); }
  });
}
