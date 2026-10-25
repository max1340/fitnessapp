// Мелкие UI-хелперы без зависимостей.

/** Создание элемента: h("div", {class:"x", onclick}, child1, "text") */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export function clear(el) {
  const isLayout = el && el.isConnected && el.tagName !== "SELECT" && el.id !== "view";
  const sheetScroller = isLayout ? el.closest(".sheet-body") : null;
  const winY = isLayout ? window.scrollY : 0;
  const winX = isLayout ? window.scrollX : 0;
  const sheetY = sheetScroller ? sheetScroller.scrollTop : 0;
  if (isLayout) {
    const h = el.offsetHeight;
    if (h > 0) el.style.minHeight = h + "px";
  }
  while (el.firstChild) el.firstChild.remove();
  if (isLayout) {
    const restore = () => {
      el.style.minHeight = "";
      if (sheetScroller) {
        if (Math.abs(sheetScroller.scrollTop - sheetY) > 2) sheetScroller.scrollTop = sheetY;
      } else if (Math.abs(window.scrollY - winY) > 2) {
        window.scrollTo(winX, winY);
      }
    };
    queueMicrotask(restore);
    requestAnimationFrame(restore);
  }
  return el;
}

/** Иконки (монохромные, currentColor). */
const ICONS = {
  up: "M6 15l6-6 6 6", down: "M6 9l6 6 6-6", plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  x: "M6 6l12 12M18 6L6 18", check: "M5 12.5l4.5 4.5L19 7.5", drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  play: "M7 5l12 7-12 7z", dumbbell: "M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12", list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  chart: "M4 20V4M4 20h16M8 16l4-5 3 3 5-7", clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2", book: "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 21V5",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01", copy: "M9 9h11v11H9zM5 15V5h10",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4", edit: "M4 20h4L19 9l-4-4L4 16z", trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", skip: "M5 5l9 7-9 7zM18 5v14",
  swap: "M7 16l-4-4 4-4M3 12h18M17 8l4 4-4 4", download: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5"
};
export function icon(name, size = 22) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICONS[name] || ""); svg.append(p);
  return svg;
}

/** Кнопка-иконка с aria-label. */
export const iconBtn = (name, label, onclick, cls = "") =>
  h("button", { class: "btn icon " + cls, type: "button", "aria-label": label, title: label, onclick }, icon(name));

/* ---------- Тост ---------- */
let toastTimer;
export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------- Модальные листы ---------- */
const openSheets = [];
/**
 * Нижний лист. content — Node. opts: {title, full, onClose, beforeClose, actions}
 * Возвращает { close, requestClose, el, body }.
 */
export function sheet(content, { title = "", full = false, onClose, beforeClose, actions } = {}) {
  const root = document.getElementById("sheets");
  const body = h("div", { class: "sheet-body" }, content);
  const closeBtn = iconBtn("x", "Закрыть", () => api.requestClose());
  const head = h("header", { class: "sheet-head" },
    h("div", { class: "sheet-grab", "aria-hidden": "true" }),
    h("h2", {}, title), actions || null, closeBtn);
  const box = h("section", { class: "sheet" + (full ? " full" : ""), role: "dialog", "aria-modal": "true", "aria-label": title }, head, body);
  const el = h("div", { class: "sheet-wrap" },
    h("div", { class: "sheet-backdrop", onclick: () => api.requestClose() }),
    box);

  // Свайп вниз по шапке модального листа для закрытия
  head.addEventListener("pointerdown", e => {
    if (e.target.closest("button, a, input")) return;
    const startY = e.clientY;
    let dy = 0;
    head.setPointerCapture(e.pointerId);
    box.style.transition = "none";
    const move = ev => {
      dy = Math.max(0, ev.clientY - startY);
      box.style.transform = `translateY(${dy}px)`;
    };
    const end = async () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", end);
      head.removeEventListener("pointercancel", end);
      box.style.transition = "transform .2s ease";
      if (dy > 75) {
        const ok = await api.requestClose();
        if (!ok) box.style.transform = "";
      } else {
        box.style.transform = "";
      }
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  });

  const api = {
    el, body,
    async requestClose(result) {
      if (api.closed || api.checking) return false;
      if (beforeClose) {
        api.checking = true;
        const allow = await beforeClose();
        api.checking = false;
        if (!allow) return false;
      }
      api.close(result);
      return true;
    },
    close(result) {
      if (api.closed) return; api.closed = true;
      el.classList.add("closing"); setTimeout(() => el.remove(), 180);
      const idx = openSheets.indexOf(api);
      if (idx >= 0) openSheets.splice(idx, 1);
      document.body.classList.toggle("sheet-open", openSheets.length > 0);
      onClose && onClose(result);
    }
  };
  root.append(el); openSheets.push(api);
  document.body.classList.add("sheet-open");
  return api;
}
export const closeTopSheet = () => { const s = openSheets[openSheets.length - 1]; if (s) { s.requestClose(); return true; } return false; };

export function confirmDialog(message, { ok = "Да", cancel = "Отмена", danger = false } = {}) {
  return new Promise(resolve => {
    let res = false;
    const sh = sheet(h("div", { class: "stack" },
      h("p", { class: "confirm-text" }, message),
      h("div", { class: "row gap" },
        h("button", { class: "btn", type: "button", onclick: () => sh.close() }, cancel),
        h("button", { class: "btn primary" + (danger ? " danger" : ""), type: "button", onclick: () => { res = true; sh.close(); } }, ok))),
      { title: "Подтверждение", onClose: () => resolve(res) });
  });
}

/* ---------- Форматирование ---------- */
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export function fmtDate(ts, withTime = false) {
  const d = new Date(ts);
  let s = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (withTime) s += `, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return s;
}
export const fmtShortDate = ts => { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export function fmtRest(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
export const fmtNum = v => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));
export function parseNum(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
/** Локальная дата-время для input[type=datetime-local]. */
export function toLocalInput(ts) {
  const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
export const fromLocalInput = str => new Date(str).getTime();

export function debounce(fn, ms) {
  let t; const w = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; w.flush = () => { clearTimeout(t); }; return w;
}

/** Drag-and-drop сортировка pointer events (touch + мышь). Элементы — прямые дети list с data-key. */
export function enableDragSort(list, onReorder) {
  list.addEventListener("pointerdown", e => {
    const handle = e.target.closest(".drag-handle");
    if (!handle || !list.contains(handle)) return;
    const item = handle.closest("[data-key]");
    if (!item || item.parentNode !== list) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const grabOffset = e.clientY - item.getBoundingClientRect().top;
    item.classList.add("dragging");
    const scroller = list.closest(".sheet-body") || document.scrollingElement;

    const place = clientY => {
      item.style.transform = "none";
      const natural = item.getBoundingClientRect().top;
      item.style.transform = `translateY(${clientY - grabOffset - natural}px)`;
    };
    const move = ev => {
      place(ev.clientY);
      // автопрокрутка у краёв
      const sr = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      if (ev.clientY < sr.top + 60) scroller.scrollTop -= 12; else if (ev.clientY > sr.bottom - 60) scroller.scrollTop += 12;
      for (let guard = 0; guard < 3; guard++) {
        const r = item.getBoundingClientRect(), cy = r.top + r.height / 2;
        const prev = item.previousElementSibling, next = item.nextElementSibling;
        if (prev) { const pr = prev.getBoundingClientRect(); if (cy < pr.top + pr.height / 2) { list.insertBefore(item, prev); place(ev.clientY); continue; } }
        if (next) { const nr = next.getBoundingClientRect(); if (cy > nr.top + nr.height / 2) { list.insertBefore(next, item); place(ev.clientY); continue; } }
        break;
      }
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      item.classList.remove("dragging"); item.style.transform = "";
      onReorder([...list.children].map(c => c.dataset.key));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}
