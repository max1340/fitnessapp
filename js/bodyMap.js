// Векторная анатомическая карта мышц человека (Спереди + Сзади) на чистом SVG.
// Все стили и цвета заданы напрямую через inline-стили с переменными CSS (var(--fg), var(--s2), var(--line)),
// поэтому силуэт ВСЕГДА рендерится корректно в тёмной и светлой теме и никогда не заливается сплошным чёрным.
import { h } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, children = []) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
};

/**
 * Анатомические мышечные группы: координаты вокруг оси X=0.
 * Фигуры спереди и сзади имеют высоту ~240px.
 */
export const ZONES = [
  // === СПЕРЕДИ ===
  {
    id: "chest",
    label: "Грудь",
    side: "front",
    paths: [
      "M -3,50 L -25,48 C -31,54 -31,66 -25,72 C -17,75 -6,73 -2,68 Z",
      "M 3,50 L 25,48 C 31,54 31,66 25,72 C 17,75 6,73 2,68 Z"
    ]
  },
  {
    id: "delts_front",
    label: "Дельты (передняя / средняя)",
    side: "front",
    paths: [
      "M -26,45 C -36,46 -42,54 -41,65 C -37,67 -31,64 -27,56 Z",
      "M 26,45 C 36,46 42,54 41,65 C 37,67 31,64 27,56 Z"
    ]
  },
  {
    id: "biceps",
    label: "Бицепс",
    side: "front",
    paths: [
      "M -40,67 C -44,75 -45,86 -41,93 C -36,94 -32,88 -31,79 C -31,72 -35,68 -40,67 Z",
      "M 40,67 C 44,75 45,86 41,93 C 36,94 32,88 31,79 C 31,72 35,68 40,67 Z"
    ]
  },
  {
    id: "forearms_f",
    label: "Предплечья",
    side: "front",
    paths: [
      "M -41,96 C -46,104 -48,116 -45,124 L -39,124 C -35,115 -33,105 -32,96 Z",
      "M 41,96 C 46,104 48,116 45,124 L 39,124 C 35,115 33,105 32,96 Z"
    ]
  },
  {
    id: "abs",
    label: "Пресс и кор",
    side: "front",
    paths: [
      "M -14,74 L -2,74 L -2,85 L -14,85 Z",
      "M 2,74 L 14,74 L 14,85 L 2,85 Z",
      "M -14,88 L -2,88 L -2,99 L -13,99 Z",
      "M 2,88 L 14,88 L 13,99 L 2,99 Z",
      "M -13,102 L -2,102 L -2,116 L -10,115 Z",
      "M 2,102 L 13,102 L 10,115 L 2,116 Z"
    ]
  },
  {
    id: "quads",
    label: "Квадрицепс (Ноги)",
    side: "front",
    paths: [
      "M -23,122 L -5,124 C -3,142 -5,162 -9,173 L -23,172 C -28,157 -28,138 -23,122 Z",
      "M 23,122 L 5,124 C 3,142 5,162 9,173 L 23,172 C 28,157 28,138 23,122 Z"
    ]
  },
  {
    id: "calves_f",
    label: "Икры",
    side: "front",
    paths: [
      "M -22,182 L -10,182 C -8,196 -10,212 -13,223 L -19,223 C -23,211 -24,196 -22,182 Z",
      "M 22,182 L 10,182 C 8,196 10,212 13,223 L 19,223 C 23,211 24,196 22,182 Z"
    ]
  },

  // === СЗАДИ ===
  {
    id: "traps",
    label: "Трапеции",
    side: "back",
    paths: [
      "M 0,36 L -20,44 L -11,64 L 0,70 L 11,64 L 20,44 Z"
    ]
  },
  {
    id: "back",
    label: "Спина (широчайшие)",
    side: "back",
    paths: [
      "M -24,49 L -12,66 L -3,72 L -3,110 L -16,106 C -23,90 -28,70 -24,49 Z",
      "M 24,49 L 12,66 L 3,72 L 3,110 L 16,106 C 23,90 28,70 24,49 Z"
    ]
  },
  {
    id: "rear_delts",
    label: "Дельты (задняя / средняя)",
    side: "back",
    paths: [
      "M -23,45 C -34,46 -40,54 -39,64 C -34,66 -28,62 -24,53 Z",
      "M 23,45 C 34,46 40,54 39,64 C 34,66 28,62 24,53 Z"
    ]
  },
  {
    id: "triceps",
    label: "Трицепс",
    side: "back",
    paths: [
      "M -39,66 C -44,75 -44,87 -40,94 L -31,92 C -29,83 -30,72 -39,66 Z",
      "M 39,66 C 44,75 44,87 40,94 L 31,92 C 29,83 30,72 39,66 Z"
    ]
  },
  {
    id: "forearms_b",
    label: "Предплечья",
    side: "back",
    paths: [
      "M -41,96 C -46,104 -48,116 -45,124 L -39,124 C -35,115 -33,105 -32,96 Z",
      "M 41,96 C 46,104 48,116 45,124 L 39,124 C 35,115 33,105 32,96 Z"
    ]
  },
  {
    id: "glutes",
    label: "Ягодицы",
    side: "back",
    paths: [
      "M -17,111 L -2,113 L -2,134 C -11,137 -22,133 -24,123 C -24,117 -21,113 -17,111 Z",
      "M 17,111 L 2,113 L 2,134 C 11,137 22,133 24,123 C 24,117 21,113 17,111 Z"
    ]
  },
  {
    id: "hamstrings",
    label: "Бицепс бедра",
    side: "back",
    paths: [
      "M -23,136 L -5,137 C -5,152 -7,164 -10,173 L -22,172 C -26,160 -26,146 -23,136 Z",
      "M 23,136 L 5,137 C 5,152 7,164 10,173 L 22,172 C 26,160 26,146 23,136 Z"
    ]
  },
  {
    id: "calves_b",
    label: "Икры",
    side: "back",
    paths: [
      "M -22,180 L -9,180 C -7,194 -9,212 -13,223 L -19,223 C -23,211 -24,194 -22,180 Z",
      "M 22,180 L 9,180 C 7,194 9,212 13,223 L 19,223 C 23,211 24,194 22,180 Z"
    ]
  }
];

export function mapMuscleToZones(muscleGroup) {
  const m = String(muscleGroup || "").toLowerCase().trim();
  if (!m) return [];
  if (m.includes("спин") || m.includes("широч") || m.includes("back") || m.includes("lat")) return ["back", "traps"];
  if (m.includes("трапец")) return ["traps"];
  if (m.includes("груд") || m.includes("chest") || m.includes("pec")) return ["chest"];
  if (m.includes("бицепс бедр") || m.includes("задняя поверхн")) return ["hamstrings"];
  if (m.includes("бицепс") || m.includes("bicep")) return ["biceps"];
  if (m.includes("трицепс") || m.includes("tricep")) return ["triceps"];
  if (m.includes("задняя дельт") || m.includes("задние дельт") || m.includes("rear")) return ["rear_delts"];
  if (m.includes("средняя дельт") || m.includes("дельт") || m.includes("плеч") || m.includes("delt")) return ["delts_front", "rear_delts"];
  if (m.includes("предплеч")) return ["forearms_f", "forearms_b"];
  if (m.includes("пресс") || m.includes("кор") || m.includes("abs")) return ["abs"];
  if (m.includes("ягодиц") || m.includes("glute")) return ["glutes"];
  if (m.includes("икр") || m.includes("голен") || m.includes("calf")) return ["calves_f", "calves_b"];
  if (m.includes("квадр")) return ["quads"];
  if (m.includes("ног") || m.includes("бедр") || m.includes("leg")) return ["quads", "hamstrings", "glutes"];
  return [];
}

/** Нейтральный контур силуэта (голова, шея, кисти, стопы, внешняя граница). */
function buildBodyOutline() {
  const g = svgEl("g", { class: "bm-outline" });
  // Голова
  g.append(svgEl("circle", {
    cx: "0", cy: "18", r: "11",
    fill: "var(--s2, #ececee)", stroke: "var(--line, #d6d6da)", "stroke-width": "1.3"
  }));
  // Шея
  g.append(svgEl("path", {
    d: "M -6,28 L -7,38 M 6,28 L 7,38",
    fill: "none", stroke: "var(--line, #d6d6da)", "stroke-width": "1.3"
  }));
  // Внешний контур тела (fill: none гарантирует, что тело никогда не зальётся чёрным!)
  g.append(svgEl("path", {
    d: [
      "M -7,38 L -28,43 C -38,45 -43,55 -41,66",
      "C -45,76 -45,88 -42,95 C -47,105 -49,117 -46,127 L -38,127",
      "C -34,115 -32,101 -29,81 L -24,71 L -18,115",
      "C -27,131 -28,155 -23,175 C -24,193 -24,211 -19,227 L -11,227",
      "C -8,209 -7,191 -9,175 C -5,157 -3,139 -2,124",
      "L 2,124 C 3,139 5,157 9,175 C 7,191 8,209 11,227 L 19,227",
      "C 24,211 24,193 23,175 C 28,155 27,131 18,115",
      "L 24,71 L 29,81 C 32,101 34,115 38,127 L 46,127",
      "C 49,117 47,105 42,95 C 45,88 45,76 41,66",
      "C 43,55 38,45 28,43 L 7,38"
    ].join(" "),
    fill: "var(--s2, #ececee)",
    "fill-opacity": "0.4",
    stroke: "var(--line, #d6d6da)",
    "stroke-width": "1.3"
  }));
  return g;
}

/**
 * Рендерит SVG-карту мышц человека.
 * muscleItems: [{ muscle: "Спина", sets: 6, exercises: ["Подтягивания", ...] }, ...]
 */
export function renderBodyMap(muscleItems = [], opts = {}) {
  const zoneStats = new Map();
  let maxSets = 0;

  for (const item of muscleItems) {
    const sets = Number(item.sets) || 0;
    if (sets <= 0) continue;
    const zIds = mapMuscleToZones(item.muscle);
    for (const zid of zIds) {
      const prev = zoneStats.get(zid) || { sets: 0, exercises: new Set() };
      prev.sets += sets;
      for (const ex of item.exercises || []) if (ex) prev.exercises.add(ex);
      zoneStats.set(zid, prev);
      if (prev.sets > maxSets) maxSets = prev.sets;
    }
  }

  const svg = svgEl("svg", {
    viewBox: "0 0 340 264",
    class: "bm-svg" + (opts.compact ? " compact" : ""),
    role: "img",
    "aria-label": "Карта мышц: вид спереди и вид сзади"
  });

  const caption = h("div", { class: "bm-caption muted small" },
    maxSets > 0 ? "Нажмите на мышцу на силуэте для деталей" : "Мышцы пока не нагружены");

  const zoneGroups = new Map();
  let selectedZoneId = null;

  function buildFigure(side, cx, title) {
    const g = svgEl("g", { transform: `translate(${cx}, 14)` });
    g.append(buildBodyOutline());

    for (const z of ZONES.filter(x => x.side === side)) {
      const st = zoneStats.get(z.id);
      const sets = st ? st.sets : 0;
      const ratio = maxSets > 0 && sets > 0 ? sets / maxSets : 0;

      // Точные инлайн-стили: не зависят от внешнего CSS!
      let fill, fillOpacity, stroke, strokeWidth;
      if (sets === 0) {
        fill = "var(--s1, #ffffff)";
        fillOpacity = "0.7";
        stroke = "var(--line, #d6d6da)";
        strokeWidth = "1";
      } else {
        fill = "var(--fg, #0b0b0c)";
        stroke = "var(--fg, #0b0b0c)";
        strokeWidth = "1.2";
        // Градации плотности от 0.35 до 1.0
        fillOpacity = String(Math.max(0.35, Math.min(1.0, 0.35 + ratio * 0.65)));
      }

      const zg = svgEl("g", {
        class: "bm-zone" + (sets > 0 ? " active" : ""),
        "data-zone": z.id,
        cursor: "pointer",
        tabindex: "0",
        role: "button",
        "aria-label": `${z.label}: ${sets} сетов`
      });

      for (const d of z.paths) {
        zg.append(svgEl("path", {
          d,
          fill,
          "fill-opacity": fillOpacity,
          stroke,
          "stroke-width": strokeWidth,
          "stroke-linejoin": "round"
        }));
      }

      const selectZone = () => {
        if (selectedZoneId && zoneGroups.has(selectedZoneId)) {
          const prev = zoneGroups.get(selectedZoneId);
          prev.querySelectorAll("path").forEach(p => {
            p.removeAttribute("stroke-dasharray");
            p.setAttribute("stroke-width", prev.classList.contains("active") ? "1.2" : "1");
          });
        }
        selectedZoneId = z.id;
        zg.querySelectorAll("path").forEach(p => {
          p.setAttribute("stroke-dasharray", "3 2");
          p.setAttribute("stroke-width", "2.2");
          p.setAttribute("stroke", "var(--fg, #0b0b0c)");
        });

        if (sets > 0) {
          const exList = [...st.exercises].slice(0, 4).join(", ");
          caption.textContent = `${z.label}: ${sets} раб. сет.${exList ? " (" + exList + ")" : ""}`;
        } else {
          caption.textContent = `${z.label}: 0 рабочих сетов`;
        }
      };

      zg.addEventListener("click", selectZone);
      zg.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectZone(); }
      });

      zoneGroups.set(z.id, zg);
      g.append(zg);
    }

    const lbl = svgEl("text", {
      x: String(cx), y: "256",
      fill: "var(--mut, #8b8b92)",
      "font-size": "10",
      "font-weight": "700",
      "letter-spacing": "0.1em",
      "text-anchor": "middle"
    });
    lbl.textContent = title;
    svg.append(g, lbl);
  }

  buildFigure("front", 85, "СПЕРЕДИ");
  buildFigure("back", 255, "СЗАДИ");

  return h("div", { class: "bm-wrap" }, svg, opts.hideCaption ? null : caption);
}
