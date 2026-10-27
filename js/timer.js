// Таймер отдыха. Работает по абсолютному времени окончания, поэтому не «уплывает»
// при сворачивании вкладки. Поддерживает фоновую работу (silent audio keep-alive,
// Media Session API на экране блокировки, Web Worker тикер и Service Worker push-уведомления),
// а также персистентность в localStorage при выгрузке приложения из памяти.
import { h, fmtRest } from "./ui.js";
import { state } from "./store.js";
import { t } from "./i18n.js";

const LS_REST_KEY = "fitness.restTimer.v1";

let endAt = 0, pausedLeftMs = 0, total = 0, label = "", ticking = null, fired = false, bar, audioCtx;
let silentAudioEl = null, silentAudioUrl = null;
let silentOscGain = null;
let heartbeatWorker = null;
let lastMediaLeftSec = -1;
const els = {};

function createSilentWavUrl() {
  try {
    const sampleRate = 8000, numSamples = 8000;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples, true);
    new Uint8Array(buffer, 44, numSamples).fill(128);
    const blob = new Blob([buffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function ensureAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* звук недоступен */ }
}

function startSilentAudio() {
  try {
    ensureAudio();
    if (!silentAudioUrl) silentAudioUrl = createSilentWavUrl();
    if (!silentAudioEl && silentAudioUrl) {
      silentAudioEl = new Audio(silentAudioUrl);
      silentAudioEl.loop = true;
      silentAudioEl.preload = "auto";
    }
    if (silentAudioEl) {
      const p = silentAudioEl.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch { /* ignore */ }

  try {
    if (audioCtx && !silentOscGain) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.00001; // минимально ненулевое значение для поддержания аудиопотока
      osc.frequency.value = 40;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      silentOscGain = { osc, gain };
    }
  } catch { /* ignore */ }
}

function stopSilentAudio() {
  try {
    if (silentAudioEl) {
      silentAudioEl.pause();
      silentAudioEl.currentTime = 0;
    }
  } catch { /* ignore */ }

  try {
    if (silentOscGain) {
      silentOscGain.osc.stop();
      silentOscGain.osc.disconnect();
      silentOscGain = null;
    }
  } catch { /* ignore */ }
}

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

function updateMediaSession(leftSec) {
  if (!("mediaSession" in navigator)) return;
  if (leftSec === lastMediaLeftSec) return;
  lastMediaLeftSec = leftSec;
  try {
    const isPaused = pausedLeftMs > 0;
    const isOver = pausedLeftMs <= 0 && leftSec <= 0;
    navigator.mediaSession.playbackState = isPaused ? "paused" : (isOver ? "none" : "playing");
    navigator.mediaSession.metadata = new MediaMetadata({
      title: isOver ? t("timer.restOver") : `${t("timer.title") || "Отдых"}: ${fmtRest(Math.max(0, leftSec))}`,
      artist: label || t("app.name") || "Fitness App",
      album: t("timer.restTimer") || "Таймер отдыха",
      artwork: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => addRest(-15));
    navigator.mediaSession.setActionHandler("nexttrack", () => addRest(30));
    navigator.mediaSession.setActionHandler("pause", () => pauseRest());
    navigator.mediaSession.setActionHandler("play", () => resumeRest());
    navigator.mediaSession.setActionHandler("stop", () => stopRest());
  } catch { /* ignore */ }
}

function clearMediaSession() {
  lastMediaLeftSec = -1;
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
    ["previoustrack", "nexttrack", "pause", "play", "stop"].forEach(a => {
      try { navigator.mediaSession.setActionHandler(a, null); } catch {}
    });
  } catch { /* ignore */ }
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
        startSilentAudio();
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
  if (state.settings.notifications === false || !("Notification" in window) || Notification.permission !== "granted") return;
  const title = t("timer.restOver");
  const opts = {
    body: label || t("timer.nextSetBody"),
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "fitness-rest-timer",
    renotify: true,
    silent: !state.settings.sound,
    vibrate: [250, 120, 250, 120, 400]
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
  saveTimerState();
  cancelSWNotification();
  stopSilentAudio();
  stopHeartbeat();
  if (bar) {
    bar.classList.remove("timer-urgent");
    bar.classList.add("timer-shake");
    setTimeout(() => bar && bar.classList.remove("timer-shake"), 800);
  }
  beep();
  if (state.settings.vibration && navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]);
  sendNotification();
  updateMediaSession(0);
}

function render() {
  if (!bar) return;
  if (!endAt && !pausedLeftMs) {
    bar.hidden = true;
    document.body.classList.remove("timer-on");
    bar.classList.remove("timer-urgent", "timer-shake");
    clearMediaSession();
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

  if (!over || fired) {
    updateMediaSession(left);
  }
}

function loop() { if (!ticking) ticking = setInterval(render, 250); render(); }

export function startRest(sec, lbl = "") {
  if (!sec || sec <= 0) return;
  ensureAudio();
  askNotifyPermission();
  clearNotifications();
  pausedLeftMs = 0;
  endAt = Date.now() + sec * 1000; total = sec; label = lbl; fired = false;
  saveTimerState();
  startSilentAudio();
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
    stopSilentAudio();
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
  ensureAudio();
  startSilentAudio();
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
    startSilentAudio();
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
  stopSilentAudio();
  stopHeartbeat();
  cancelSWNotification();
  clearMediaSession();
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

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      render();
      if (fired) clearNotifications();
    }
  });
}
