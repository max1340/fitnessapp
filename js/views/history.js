import { h, clear, sheet, confirmDialog, toast, fmtDate, fmtShortDate, toLocalInput, fromLocalInput, parseNum, icon, iconBtn } from "../ui.js";
import { state, saveSession, deleteSession, downloadCsv } from "../store.js";
import { sessionStats, formatNum } from "../metrics.js";
import { entryCard } from "./entryCard.js";
import { pickExercise } from "./exercises.js";
import { buildEntry } from "./workout.js";

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 12-недельная календарная сетка активности (Пн–Вс × 12 недель). */
function buildHeatmap(doneItems, onOpenSession) {
  const WEEKS = 12;
  const byDay = new Map();
  for (const s of doneItems) {
    const k = dayKey(s.startedAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayKey = dayKey(now.getTime());
  // Понедельник текущей недели (Пн = 0 ... Вс = 6)
  const dow = (now.getDay() + 6) % 7;
  const curMon = new Date(now);
  curMon.setDate(now.getDate() - dow);
  const startMon = new Date(curMon);
  startMon.setDate(curMon.getDate() - (WEEKS - 1) * 7);

  const caption = h("div", { class: "heat-caption muted small" }, "Нажмите на день в сетке");
  const grid = h("div", { class: "heat-grid" });
  const daysLabels = h("div", { class: "heat-days" },
    h("span", {}, "Пн"), h("span", {}, ""), h("span", {}, "Ср"), h("span", {}, ""), h("span", {}, "Пт"), h("span", {}, ""), h("span", {}, "Вс"));

  let count12w = 0;
  let selectedCell = null;

  for (let w = 0; w < WEEKS; w++) {
    const col = h("div", { class: "heat-col" });
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startMon);
      cellDate.setDate(startMon.getDate() + w * 7 + d);
      const ts = cellDate.getTime();
      const k = dayKey(ts);
      const isFuture = ts > now.getTime();
      const sessions = byDay.get(k) || [];
      if (!isFuture && sessions.length) count12w += sessions.length;

      const cell = h("button", {
        type: "button",
        class: "heat-cell" + (sessions.length ? " active" : "") + (k === todayKey ? " today" : "") + (isFuture ? " future" : ""),
        disabled: isFuture,
        "aria-label": `${fmtDate(ts)}: тренировок ${sessions.length}`,
        onclick: () => {
          if (selectedCell) selectedCell.classList.remove("sel");
          selectedCell = cell;
          cell.classList.add("sel");
          clear(caption);
          if (!sessions.length) {
            caption.textContent = `${fmtDate(ts)} · без тренировок`;
          } else {
            caption.append(h("span", {}, `${fmtShortDate(ts)}: `));
            sessions.forEach((s, idx) => {
              if (idx > 0) caption.append(" · ");
              caption.append(h("button", { class: "heat-link", type: "button", onclick: () => onOpenSession(s) }, `${s.programName} (${formatNum(sessionStats(s).volume, 0)} кг)`));
            });
          }
        }
      });
      col.append(cell);
    }
    grid.append(col);
  }

  return h("section", { class: "panel heat-panel" },
    h("div", { class: "panel-head" },
      h("h2", { class: "section" }, "Активность за 12 недель"),
      h("small", { class: "muted" }, `${count12w} трен.`)),
    h("div", { class: "heat-wrap" }, daysLabels, grid),
    caption);
}

function openEditor(original) {
  const s = JSON.parse(JSON.stringify(original));
  let dirty = false;
  const when = h("input", { type: "datetime-local", value: toLocalInput(s.startedAt), "aria-label": "Дата и время начала" });
  const dur = h("input", { type: "text", inputmode: "numeric", value: s.durationMin ?? "", placeholder: "мин", "aria-label": "Длительность, мин" });
  when.addEventListener("input", () => (dirty = true));
  dur.addEventListener("input", () => (dirty = true));
  const box = h("div", { class: "stack" });
  const paint = () => {
    clear(box);
    s.entries.forEach((e, i) => box.append(entryCard(e, {
      index: i, count: s.entries.length, reorder: false, collapsible: false,
      onChange: () => (dirty = true), rerender: paint,
      onRemove: () => { s.entries.splice(i, 1); dirty = true; paint(); }
    })));
  };
  paint();
  const save = () => {
    const t = fromLocalInput(when.value);
    if (isFinite(t)) s.startedAt = t;
    const d = parseNum(dur.value); s.durationMin = d !== null && d > 0 ? Math.round(d) : null;
    s.finishedAt = s.durationMin ? s.startedAt + s.durationMin * 60000 : s.finishedAt;
    s.entries.forEach((e, i) => { e.order = i; delete e._key; delete e._expanded; });
    dirty = false;
    saveSession(s); sh.close(); toast("Тренировка сохранена, метрики пересчитаны");
  };
  const sh = sheet(h("div", { class: "stack" },
    h("p", { class: "muted" }, s.programName),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, "Начало"), when),
      h("label", { class: "field" }, h("span", {}, "Минут"), dur)),
    box,
    h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => { s.entries.push({ ...buildEntry(ex, s.programId, s.entries.length), extra: true }); dirty = true; paint(); }, { multi: true }) }, "+ Добавить упражнение"),
    h("button", { class: "btn primary block", type: "button", onclick: save }, "Сохранить"),
    h("button", { class: "btn block", type: "button", onclick: async () => { if (await confirmDialog("Удалить эту тренировку из истории?", { ok: "Удалить", danger: true })) { dirty = false; deleteSession(s.id); sh.close(); } } }, "Удалить тренировку")),
    {
      title: fmtDate(s.startedAt), full: true,
      beforeClose: () => (!dirty ? true : confirmDialog("Закрыть без сохранения изменений?", { ok: "Закрыть", cancel: "Остаться", danger: true }))
    });
}

export function mount(root) {
  const wrap = h("div", { class: "stack" });
  root.append(wrap);
  const paint = () => {
    clear(wrap);
    const items = state.sessions.filter(s => s.status === "done").sort((a, b) => b.startedAt - a.startedAt);
    wrap.append(buildHeatmap(items, openEditor));
    const list = h("div", { class: "list" });
    if (!items.length) list.append(h("p", { class: "empty" }, "История пуста. Завершённые тренировки появятся здесь."));
    for (const s of items) {
      const st = sessionStats(s);
      const sets = (s.entries || []).reduce((n, e) => n + e.sets.filter(x => x.done && !x.isWarmup).length, 0);
      list.append(h("div", { class: "list-item" },
        h("button", { class: "card-main grow", type: "button", onclick: () => openEditor(s) },
          h("strong", {}, s.programName),
          h("small", { class: "muted" }, `${fmtDate(s.startedAt, true)} · ${s.durationMin ?? "?"} мин`),
          h("small", { class: "muted" }, `${sets} сетов · объём ${formatNum(st.volume, 0)} кг`)),
        iconBtn("trash", "Удалить тренировку", async () => {
          if (await confirmDialog(`Удалить тренировку «${s.programName}» (${fmtDate(s.startedAt)})?`, { ok: "Удалить", danger: true })) {
            deleteSession(s.id); toast("Тренировка удалена");
          }
        })));
    }
    wrap.append(list);
    if (items.length) {
      wrap.append(h("button", {
        class: "btn block", type: "button",
        onclick: () => { downloadCsv(); toast("История выгружена в CSV"); }
      }, icon("download", 18), "Скачать историю в CSV (Excel)"));
    }
  };
  paint();
  return { update: paint };
}
