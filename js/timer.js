// Таймер отдыха. Работает по абсолютному времени окончания, поэтому не «уплывает»
// при сворачивании вкладки. Не блокирует ввод: это узкая плашка над нижней навигацией.
import { h, icon, fmtRest } from "./ui.js";
import { state } from "./store.js";

let endAt = 0, total = 0, label = "", ticking = null, fired = false, bar, audioCtx;
const els = {};

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* звук недоступен */ }
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
}

function render() {
  if (!bar) return;
  const left = Math.ceil((endAt - Date.now()) / 1000);
  if (!endAt) { bar.hidden = true; document.body.classList.remove("timer-on"); return; }
  bar.hidden = false; document.body.classList.add("timer-on");
  if (left <= 0 && !fired) finish();
  const over = left <= 0;
  bar.classList.toggle("over", over);
  els.time.textContent = over ? "Отдых окончен" : fmtRest(left);
  els.label.textContent = label;
  els.fill.style.width = (over ? 100 : Math.min(100, ((total - left) / total) * 100)) + "%";
  els.skip.textContent = over ? "Закрыть" : "Пропустить";
}

function loop() { if (!ticking) ticking = setInterval(render, 250); render(); }

export function startRest(sec, lbl = "") {
  if (!sec || sec <= 0) return;
  ensureAudio();
  endAt = Date.now() + sec * 1000; total = sec; label = lbl; fired = false;
  loop();
}
export function addRest(sec) { if (!endAt) return; if (fired) { endAt = Date.now() + sec * 1000; total = sec; fired = false; } else { endAt += sec * 1000; total += sec; } render(); }
export function stopRest() { endAt = 0; clearInterval(ticking); ticking = null; render(); }
export const isResting = () => endAt > 0;

export function initTimerBar(container) {
  bar = container;
  els.time = h("strong", { class: "timer-time", "aria-live": "off" });
  els.label = h("small", { class: "muted timer-label" });
  els.fill = h("div", { class: "timer-fill" });
  els.skip = h("button", { class: "btn small", type: "button", onclick: stopRest }, "Пропустить");
  bar.append(els.fill,
    h("div", { class: "timer-row" },
      h("div", { class: "grow" }, els.time, els.label),
      h("button", { class: "btn small", type: "button", onclick: () => addRest(30) }, "+30 с"),
      els.skip));
  bar.hidden = true;
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
}
