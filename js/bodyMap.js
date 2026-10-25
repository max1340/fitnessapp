// Векторная анатомическая карта мышц человека (Спереди + Сзади) на чистом SVG.
// Строго монохромная палитра: интенсивность нагрузки передаётся плотностью заливки и контуром.
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
 * Описания анатомических зон и их зеркальных контуров вокруг оси X = 0 (масштаб Y: 0..245).
 * Каждая фигура рендерится со смещением translate(cx, 18).
 */
export const ZONES = [
  {
    id: "chest",
    label: "Грудь",
    side: "front",
    paths: [
      // Левая и правая грудные мышцы
      "M -3,50 L -26,48 C -31,54 -31,66 -25,72 C -17,75 -6,73 -2,68 Z",
      "M 3,50 L 26,48 C 31,54 31,66 25,72 C 17,75 6,73 2,68 Z"
    ]
  },
  {
    id: "delts",
    label: "Дельты (передняя / средняя)",
    side: "front",
    paths: [
      // Плечевые шапки спереди/сбоку
      "M -26,45 C -36,46 -42,54 -41,65 C -37,67 -31,64 -27,56 Z",
      "M 26,45 C 36,46 42,54 41,65 C 37,67 31,64 27,56 Z"
    ]
  },
  {
    id: "biceps",
    label: "Бицепс",
    side: "front",
    paths: [
      "M -40,67 C -44,75 -45,87 -41,94 C -36,95 -32,89 -31,79 C -31,72 -35,68 -40,67 Z",
      "M 40,67 C 44,75 45,87 41,94 C 36,95 32,89 31,79 C 31,72 35,68 40,67 Z"
    ]
  },
  {
    id: "forearms_f",
    label: "Предплечья",
    side: "front",
    paths: [
      "M -42,96 C -47,104 -49,117 -46,125 L -40,125 C -36,116 -34,105 -33,96 Z",
      "M 42,96 C 47,104 49,117 46,125 L 40,125 C 36,116 34,105 33,96 Z"
    ]
  },
  {
    id: "abs",
    label: "Пресс и кор",
    side: "front",
    paths: [
      // Верхние, средние и нижние кубики пресса + косые
      "M -15,74 L -2,74 L -2,86 L -15,86 Z",
      "M 2,74 L 15,74 L 15,86 L 2,86 Z",
      "M -15,89 L -2,89 L -2,101 L -14,101 Z",
      "M 2,89 L 15,89 L 14,101 L 2,101 Z",
      "M -14,104 L -2,104 L -2,118 L -11,117 Z",
      "M 2,104 L 14,104 L 11,117 L 2,118 Z"
    ]
  },
  {
    id: "quads",
    label: "Квадрицепс (Ноги)",
    side: "front",
    paths: [
      "M -24,122 L -6,124 C -4,142 -6,162 -10,174 L -24,173 C -29,158 -29,138 -24,122 Z",
      "M 24,122 L 6,124 C 4,142 6,162 10,174 L 24,173 C 29,158 29,138 24,122 Z"
    ]
  },
  {
    id: "calves_f",
    label: "Икры",
    side: "front",
    paths: [
      "M -23,182 L -11,182 C -9,196 -11,213 -14,224 L -20,224 C -24,212 -25,196 -23,182 Z",
      "M 23,182 L 11,182 C 9,196 11,213 14,224 L 20,224 C 24,212 25,196 23,182 Z"
    ]
  },

  // --- ВИД СЗАДИ ---
  {
    id: "traps",
    label: "Трапеции",
    side: "back",
    paths: [
      "M 0,36 L -22,44 L -12,66 L 0,72 L 12,66 L 22,44 Z"
    ]
  },
  {
    id: "back",
    label: "Спина (широчайшие и верх)",
    side: "back",
    paths: [
      // Левая и правая широчайшие + разгибатели спины
      "M -25,50 L -13,68 L -3,74 L -3,112 L -17,108 C -24,92 -29,72 -25,50 Z",
      "M 25,50 L 13,68 L 3,74 L 3,112 L 17,108 C 24,92 29,72 25,50 Z"
    ]
  },
  {
    id: "rear_delts",
    label: "Дельты (задняя / средняя)",
    side: "back",
    paths: [
      "M -24,45 C -35,46 -41,54 -40,64 C -35,66 -29,62 -25,53 Z",
      "M 24,45 C 35,46 41,54 40,64 C 35,66 29,62 25,53 Z"
    ]
  },
  {
    id: "triceps",
    label: "Трицепс",
    side: "back",
    paths: [
      "M -40,66 C -45,75 -45,88 -41,95 L -32,93 C -30,84 -31,72 -40,66 Z",
      "M 40,66 C 45,75 45,88 41,95 L 32,93 C 30,84 31,72 40,66 Z"
    ]
  },
  {
    id: "forearms_b",
    label: "Предплечья",
    side: "back",
    paths: [
      "M -42,97 C -47,105 -49,117 -46,125 L -40,125 C -36,116 -34,105 -33,97 Z",
      "M 42,97 C 47,105 49,117 46,125 L 40,125 C 36,116 34,105 33,97 Z"
    ]
  },
  {
    id: "glutes",
    label: "Ягодицы",
    side: "back",
    paths: [
      "M -18,112 L -2,114 L -2,136 C -12,139 -23,135 -25,125 C -25,118 -22,114 -18,112 Z",
      "M 18,112 L 2,114 L 2,136 C 12,139 23,135 25,125 C 25,118 22,114 18,112 Z"
    ]
  },
  {
    id: "hamstrings",
    label: "Бицепс бедра (Ноги)",
    side: "back",
    paths: [
      "M -24,138 L -5,139 C -5,154 -7,166 -10,175 L -23,174 C -27,162 -27,148 -24,138 Z",
      "M 24,138 L 5,139 C 5,154 7,166 10,175 L 23,174 C 27,162 27,148 24,138 Z"
    ]
  },
  {
    id: "calves_b",
    label: "Икры",
    side: "back",
    paths: [
      "M -23,181 L -10,181 C -8,195 -10,213 -14,224 L -20,224 C -24,212 -25,195 -23,181 Z",
      "M 23,181 L 10,181 C 8,195 10,213 14,224 L 20,224 C 24,212 25,195 23,181 Z"
    ]
  }
];

/** Сопоставление пользовательского названия мышцы с анатомическими зонами на силуэте. */
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
  if (m.includes("средняя дельт") || m.includes("дельт") || m.includes("плеч") || m.includes("delt")) return ["delts", "rear_delts"];
  if (m.includes("предплеч")) return ["forearms_f", "forearms_b"];
  if (m.includes("пресс") || m.includes("кор") || m.includes("abs")) return ["abs"];
  if (m.includes("ягодиц") || m.includes("glute")) return ["glutes"];
  if (m.includes("икр") || m.includes("голен") || m.includes("calf")) return ["calves_f", "calves_b"];
  if (m.includes("квадр")) return ["quads"];
  if (m.includes("ног") || m.includes("бедр") || m.includes("leg")) return ["quads", "hamstrings", "glutes"];
  return [];
}

/** Базовый контур тела (голова, шея, силуэт торса, кистей и стоп). */
function buildBodyOutline() {
  return svgEl("g", { class: "bm-outline" }, [
    // Голова и шея
    svgEl("circle", { cx: 0, cy: 18, r: 12 }),
    svgEl("path", { d: "M -6,29 L -7,39 M 6,29 L 7,39" }),
    // Внешний контур торса, рук и ног для читаемости фигуры
    svgEl("path", {
      d: [
        "M -7,39 L -28,44 C -39,46 -44,56 -42,67",
        "C -46,77 -46,89 -43,96 C -48,106 -50,118 -47,128 L -39,128",
        "C -35,116 -33,102 -30,82 L -25,72 L -19,116",
        "C -28,132 -29,156 -24,176 C -25,194 -25,212 -20,228 L -12,228",
        "C -9,210 -8,192 -10,176 C -6,158 -4,140 -3,125",
        "L 3,125 C 4,140 6,158 10,176 C 8,192 9,210 12,228 L 20,228",
        "C 25,212 25,194 24,176 C 29,156 28,132 19,116",
        "L 25,72 L 30,82 C 33,102 35,116 39,128 L 47,128",
        "C 50,118 48,106 43,96 C 46,89 46,77 42,67",
        "C 44,56 39,46 28,44 L 7,39"
      ].join(" ")
    })
  ]);
}

/**
 * Рендерит SVG-карту мышц человека (Спереди + Сзади).
 * muscleItems: массив [{ muscle: "Спина", sets: 6, exercises: ["Подтягивания", "Т-гриф"] }, ...]
 * opts: { compact: false }
 */
export function renderBodyMap(muscleItems = [], opts = {}) {
  const zoneStats = new Map();
  let maxSets = 0;

  for (const item of muscleItems) {
    const sets = Number(item.sets) || 0;
    if (sets <= 0) continue;
    const zIds = mapMuscleToZones(item.muscle);
    for (const zid of zIds) {
      const prev = zoneStats.get(zid) || { sets: 0, muscles: new Set(), exercises: new Set() };
      prev.sets += sets;
      prev.muscles.add(item.muscle);
      for (const ex of item.exercises || []) if (ex) prev.exercises.add(ex);
      zoneStats.set(zid, prev);
      if (prev.sets > maxSets) maxSets = prev.sets;
    }
  }

  const svg = svgEl("svg", {
    viewBox: "0 0 340 268",
    class: "bm-svg" + (opts.compact ? " compact" : ""),
    role: "img",
    "aria-label": "Анатомическая карта мышц: вид спереди и вид сзади"
  });

  const caption = h("div", { class: "bm-caption muted small" },
    maxSets > 0 ? "Нажмите на мышцу на силуэте для деталей" : "Нет активных мышечных групп");

  const zoneEls = new Map();
  let selectedZoneId = null;

  function buildFigure(side, cx, title) {
    const g = svgEl("g", { transform: `translate(${cx}, 14)` });
    g.append(buildBodyOutline());

    for (const z of ZONES.filter(x => x.side === side)) {
      const st = zoneStats.get(z.id);
      const sets = st ? st.sets : 0;
      const ratio = maxSets > 0 && sets > 0 ? sets / maxSets : 0;
      // 4 ступени интенсивности для чёткого монохромного контраста
      const tier = sets === 0 ? 0 : ratio >= 0.75 ? 4 : ratio >= 0.45 ? 3 : ratio >= 0.2 ? 2 : 1;

      const zg = svgEl("g", {
        class: `bm-zone tier-${tier}`,
        "data-zone": z.id,
        tabindex: "0",
        role: "button",
        "aria-label": `${z.label}: ${sets} сетов`
      });
      for (const d of z.paths) {
        zg.append(svgEl("path", { d }));
      }
      const selectZone = () => {
        if (selectedZoneId && zoneEls.get(selectedZoneId)) {
          zoneEls.get(selectedZoneId).classList.remove("sel");
        }
        selectedZoneId = z.id;
        zg.classList.add("sel");
        if (sets > 0) {
          const exList = [...st.exercises].slice(0, 4).join(", ");
          caption.textContent = `${z.label}: ${sets} раб. сет.${exList ? " · " + exList : ""}`;
        } else {
          caption.textContent = `${z.label}: 0 рабочих сетов`;
        }
      };
      zg.addEventListener("click", selectZone);
      zg.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectZone(); }
      });
      zoneEls.set(z.id, zg);
      g.append(zg);
    }

    const lbl = svgEl("text", { x: cx, y: 260, class: "bm-side-label", "text-anchor": "middle" });
    lbl.textContent = title;
    svg.append(g, lbl);
  }

  buildFigure("front", 85, "СПЕРЕДИ");
  buildFigure("back", 255, "СЗАДИ");

  return h("div", { class: "bm-wrap" }, svg, opts.hideCaption ? null : caption);
}
