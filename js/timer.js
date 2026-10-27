// Таймер отдыха. Работает по абсолютному времени окончания, поэтому не «уплывает»
// при сворачивании вкладки или экрана блокировки.
// Не воспроизводит фоновое аудио во время отсчёта, поэтому НЕ приглушает и НЕ останавливает музыку пользователя (Spotify, Apple Music и др.).
// Сохраняет состояние в localStorage, использует Web Worker для тиканья и Service Worker для уведомлений.
import { h, fmtRest } from "./ui.js";
import { state } from "./store.js";
import { t } from "./i18n.js";

const LS_REST_KEY = "fitness.restTimer.v1";

let endAt = 0, pausedLeftMs = 0, total = 0, label = "", ticking = null, fired = false, bar;
let heartbeatWorker = null;
const els = {};

function startHeartbeat() {
  if (heartbeatWorker) return;
  try {
    const code = `
      let timer = null;
      self.onmessage = e => {
        if (e.data === 'start') {
          if (!timer) timer = setInterval(() => self.postMessage('tick'), 250);
        } else if (e.data === 'stop') {
          clearInterval(timer); timer = null;
        }
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    heartbeatWorker = new Worker(url);
    heartbeatWorker.onmessage = () => render();
    heartbeatWorker.postMessage("start");
  } catch { /* Web Worker недоступен */ }
}

function stopHeartbeat() {
  if (!heartbeatWorker) return;
  try {
    heartbeatWorker.postMessage("stop");
    heartbeatWorker.terminate();
  } catch { /* ignore */ }
  heartbeatWorker = null;
}

function scheduleSWNotification() {
  if (state.settings.notifications === false) return;
  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker.controller;
  if (!sw) return;
  if (!endAt || pausedLeftMs > 0 || fired) return;

  try {
    sw.postMessage({
      type: "SCHEDULE_REST_NOTIFICATION",
      endAt,
      title: t("timer.restOver"),
      body: label || t("timer.nextSetBody"),
      sound: !!state.settings.sound,
      vibration: !!state.settings.vibration
    });
  } catch { /* ignore */ }
}

function cancelSWNotification() {
  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker.controller;
  if (!sw) return;
  try {
    sw.postMessage({ type: "CANCEL_REST_NOTIFICATION" });
  } catch { /* ignore */ }
}

function saveTimerState() {
  if (!endAt && !pausedLeftMs) {
    try { localStorage.removeItem(LS_REST_KEY); } catch {}
    return;
  }
  try {
    localStorage.setItem(LS_REST_KEY, JSON.stringify({
      endAt,
      total,
      label,
      pausedLeftMs,
      fired
    }));
  } catch { /* ignore */ }
}

function restoreTimerState() {
  try {
    const raw = localStorage.getItem(LS_REST_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || (!data.endAt && !data.pausedLeftMs)) return false;

    total = Number(data.total) || 0;
    label = data.label || "";
    pausedLeftMs = Number(data.pausedLeftMs) || 0;
    fired = !!data.fired;
    endAt = Number(data.endAt) || 0;

    if (pausedLeftMs > 0) {
      render();
      return true;
    }

    if (endAt > 0) {
      const rem = endAt - Date.now();
      if (rem > 0) {
        loop();
        startHeartbeat();
        scheduleSWNotification();
        return true;
      } else if (rem > -300000) {
        // Завершился не более 5 минут назад при закрытом приложении
        fired = true;
        render();
        saveTimerState();
        return true;
      } else {
        stopRest();
        return false;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function askNotifyPermission() {
  if (state.settings.notifications === false) return;
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

async function sendNotification() {
  if (state.settings.notifications === false) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const title = t("timer.restOver");
  const options = {
    body: label || t("timer.nextSetBody"),
    icon: "icons/icon-192.png",
    badge: "icons/icon.svg",
    tag: "fitness-rest-timer",
    renotify: true,
    vibrate: [250, 120, 250, 120, 400],
    data: { url: location.href }
  };
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    }
    new Notification(title, options);
  } catch { /* ignore */ }
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
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ctx.currentTime;
    [0, 0.28, 0.56].forEach((d, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.25);
    });
    setTimeout(() => {
      try { ctx.close(); } catch {}
    }, 1000);
  } catch { /* ignore */ }
}

function finish() {
  fired = true;
  saveTimerState();
  cancelSWNotification();
  stopHeartbeat();
  if (bar) {
    bar.classList.remove("timer-urgent");
    bar.classList.add("timer-shake");
    setTimeout(() => bar && bar.classList.remove("timer-shake"), 800);
  }
  beep();
  if (state.settings.vibration && navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]);
  sendNotification();
}

function render() {
  if (!bar) return;
  if (!endAt && !pausedLeftMs) {
    bar.hidden = true;
    document.body.classList.remove("timer-on");
    bar.classList.remove("timer-urgent", "timer-shake");
    return;
  }
  bar.hidden = false;
  document.body.classList.add("timer-on");
  const remMs = pausedLeftMs > 0 ? pausedLeftMs : (endAt - Date.now());
  const left = Math.ceil(remMs / 1000);
  if (pausedLeftMs <= 0 && left <= 0 && !fired) finish();
  const over = pausedLeftMs <= 0 && left <= 0;
  bar.classList.toggle("over", over);

  // Последние 10 сек — цифры краснеют и пульсируют
  const urgent = !over && pausedLeftMs <= 0 && left > 0 && left <= 10;
  bar.classList.toggle("timer-urgent", urgent);
  els.time.classList.toggle("urgent", urgent);

  els.time.textContent = over ? t("timer.restOver") : fmtRest(left);
  els.label.textContent = label;
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  els.fill.style.width = (over ? 0 : pct) + "%";
  els.skip.textContent = over ? t("common.close") : t("timer.skip");
}

function loop() { if (!ticking) ticking = setInterval(render, 250); render(); }

export function startRest(sec, lbl = "") {
  if (!sec || sec <= 0) return;
  askNotifyPermission();
  clearNotifications();
  pausedLeftMs = 0;
  endAt = Date.now() + sec * 1000; total = sec; label = lbl; fired = false;
  saveTimerState();
  startHeartbeat();
  scheduleSWNotification();
  loop();
}

export function pauseRest() {
  if (!endAt || pausedLeftMs > 0 || fired) return;
  const rem = endAt - Date.now();
  if (rem > 0) {
    pausedLeftMs = rem;
    clearInterval(ticking); ticking = null;
    stopHeartbeat();
    cancelSWNotification();
    saveTimerState();
    render();
  }
}

export function resumeRest() {
  if (pausedLeftMs <= 0) return;
  endAt = Date.now() + pausedLeftMs;
  pausedLeftMs = 0;
  saveTimerState();
  startHeartbeat();
  scheduleSWNotification();
  loop();
}

export function addRest(sec) {
  if (!endAt && !pausedLeftMs) return;
  if (pausedLeftMs > 0) {
    pausedLeftMs = Math.max(1000, pausedLeftMs + sec * 1000);
    total = Math.max(1, total + sec);
    saveTimerState();
    render();
    return;
  }
  if (fired && sec > 0) {
    endAt = Date.now() + sec * 1000; total = sec; fired = false;
    clearNotifications();
    startHeartbeat();
  } else {
    endAt += sec * 1000;
    total = Math.max(1, total + sec);
    if (endAt <= Date.now() && !fired) finish();
  }
  saveTimerState();
  scheduleSWNotification();
  render();
}

export function stopRest() {
  endAt = 0; pausedLeftMs = 0; fired = false;
  clearInterval(ticking); ticking = null;
  stopHeartbeat();
  cancelSWNotification();
  saveTimerState();
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
  if (els.skip) els.skip.textContent = (pausedLeftMs <= 0 && endAt - Date.now() <= 0) ? t("common.close") : t("timer.skip");
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

  restoreTimerState();

  const onResume = () => {
    render();
    if (fired) clearNotifications();
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) onResume();
  });
  window.addEventListener("pageshow", onResume);
  window.addEventListener("focus", onResume);
}
