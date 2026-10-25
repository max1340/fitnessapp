// Линейные графики на чистом SVG (без библиотек). Только оттенки серого через currentColor/CSS-классы.
import { h, fmtShortDate } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * points: [{ t: timestamp, y: number, label?: string }]
 * opts: { height, smooth: number[] | null, refY: number|null, fmt(y), caption: HTMLElement, onSelect(i) }
 * Возвращает DOM-элемент с графиком и подписью выбранной точки.
 */
export function lineChart(points, opts = {}) {
  const W = 360, H = opts.height || 190, pl = 38, pr = 12, pt = 14, pb = 26;
  const fmt = opts.fmt || (v => String(Math.round(v * 10) / 10).replace(".", ","));
  const wrap = h("div", { class: "chart" });
  const caption = h("div", { class: "chart-caption muted", "aria-live": "polite" }, points.length ? "Нажмите на точку" : "Недостаточно данных");
  if (!points.length) { wrap.append(h("div", { class: "chart-empty" }, "Пока нет данных"), caption); return wrap; }

  const ys = points.map(p => p.y).concat(opts.smooth || [], opts.refY != null ? [opts.refY] : []);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 3) {
    const mid = (min + max) / 2;
    min = mid - 3;
    max = mid + 3;
  } else {
    const padY = (max - min) * 0.12;
    min -= padY;
    max += padY;
  }
  const x = i => (points.length === 1 ? (pl + W - pr) / 2 : pl + (i * (W - pl - pr)) / (points.length - 1));
  const y = v => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img", "aria-label": opts.label || "График" });
  // сетка и подписи оси Y
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3, yy = y(v);
    svg.append(s("line", { x1: pl, x2: W - pr, y1: yy, y2: yy, class: "grid" }));
    const t = s("text", { x: pl - 6, y: yy + 4, class: "axis", "text-anchor": "end" }); t.textContent = fmt(v); svg.append(t);
  }
  if (opts.refY != null) svg.append(s("line", { x1: pl, x2: W - pr, y1: y(opts.refY), y2: y(opts.refY), class: "ref" }));
  // подписи оси X: первая, средняя, последняя даты
  const xl = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  xl.forEach((i, k) => {
    const t = s("text", { x: x(i), y: H - 8, class: "axis", "text-anchor": xl.length > 1 ? (k === 0 ? "start" : k === xl.length - 1 ? "end" : "middle") : "middle" });
    t.textContent = fmtShortDate(points[i].t); svg.append(t);
  });
  // линия данных
  if (points.length > 1) svg.append(s("polyline", { class: "line", fill: "none", pathLength: "1", points: points.map((p, i) => `${x(i)},${y(p.y)}` ).join(" ") }));
  // сглаживающая линия (скользящее среднее) — толще и пунктиром
  if (opts.smooth && points.length > 1) svg.append(s("polyline", { class: "smooth", fill: "none", points: opts.smooth.map((v, i) => `${x(i)},${y(v)}`).join(" ") }));
  const dots = points.map((p, i) => { const c = s("circle", { cx: x(i), cy: y(p.y), r: 4, class: "dot" }); svg.append(c); return c; });

  let sel = -1;
  const select = i => {
    if (sel >= 0) { dots[sel].setAttribute("r", 4); dots[sel].classList.remove("sel"); }
    sel = i; dots[i].setAttribute("r", 7); dots[i].classList.add("sel");
    const p = points[i];
    caption.textContent = `${fmtShortDate(p.t)} · ${p.label || fmt(p.y)}`;
    opts.onSelect && opts.onSelect(i);
  };
  svg.addEventListener("pointerdown", e => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    points.forEach((_, i) => { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } });
    select(best);
  });
  wrap.append(svg, caption);
  select(points.length - 1);
  return wrap;
}

