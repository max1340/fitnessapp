import { h, clear, sheet, confirmDialog, toast, fmtDate, toLocalInput, fromLocalInput, parseNum } from "../ui.js";
import { state, saveSession, deleteSession, getProgram } from "../store.js";
import { sessionStats, formatNum } from "../metrics.js";
import { entryCard } from "./entryCard.js";
import { pickExercise } from "./exercises.js";
import { buildEntry } from "./workout.js";

function openEditor(original) {
  const s = JSON.parse(JSON.stringify(original));
  const when = h("input", { type: "datetime-local", value: toLocalInput(s.startedAt), "aria-label": "Дата и время начала" });
  const dur = h("input", { type: "text", inputmode: "numeric", value: s.durationMin ?? "", placeholder: "мин", "aria-label": "Длительность, мин" });
  const box = h("div", { class: "stack" });
  const paint = () => {
    clear(box);
    s.entries.forEach((e, i) => box.append(entryCard(e, {
      index: i, count: s.entries.length, reorder: false, onChange: () => {}, rerender: paint,
      onRemove: () => { s.entries.splice(i, 1); paint(); }
    })));
  };
  paint();
  const save = () => {
    const t = fromLocalInput(when.value);
    if (isFinite(t)) s.startedAt = t;
    const d = parseNum(dur.value); s.durationMin = d !== null && d > 0 ? Math.round(d) : null;
    s.finishedAt = s.durationMin ? s.startedAt + s.durationMin * 60000 : s.finishedAt;
    s.entries.forEach((e, i) => (e.order = i));
    saveSession(s); sh.close(); toast("Тренировка сохранена, метрики пересчитаны");
  };
  const sh = sheet(h("div", { class: "stack" },
    h("p", { class: "muted" }, s.programName),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, "Начало"), when),
      h("label", { class: "field" }, h("span", {}, "Минут"), dur)),
    box,
    h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => { s.entries.push({ ...buildEntry(ex, s.programId, s.entries.length), extra: true }); paint(); }, { multi: true }) }, "+ Добавить упражнение"),
    h("button", { class: "btn primary block", type: "button", onclick: save }, "Сохранить"),
    h("button", { class: "btn block", type: "button", onclick: async () => { if (await confirmDialog("Удалить эту тренировку из истории?", { ok: "Удалить", danger: true })) { deleteSession(s.id); sh.close(); } } }, "Удалить тренировку")),
    { title: fmtDate(s.startedAt), full: true });
}

export function mount(root) {
  const list = h("div", { class: "list" });
  root.append(list);
  const paint = () => {
    clear(list);
    const items = state.sessions.filter(s => s.status === "done").sort((a, b) => b.startedAt - a.startedAt);
    if (!items.length) list.append(h("p", { class: "empty" }, "История пуста. Завершённые тренировки появятся здесь."));
    for (const s of items) {
      const st = sessionStats(s);
      const sets = (s.entries || []).reduce((n, e) => n + e.sets.filter(x => x.done && !x.isWarmup).length, 0);
      list.append(h("button", { class: "list-item", type: "button", onclick: () => openEditor(s) },
        h("span", { class: "grow" }, h("strong", {}, s.programName), h("small", { class: "muted" }, `${fmtDate(s.startedAt, true)} · ${s.durationMin ?? "?"} мин`),
          h("small", { class: "muted" }, `${sets} сетов · объём ${formatNum(st.volume, 0)} кг`))));
    }
  };
  paint();
  return { update: paint };
}
