import { h, clear, sheet, confirmDialog, toast, parseNum, fmtNum, fmtRest, fmtDate, icon, iconBtn } from "../ui.js";
import { state, saveExercise, deleteExercise, isExerciseUsed, getExercise, doneSessions, unitLabel } from "../store.js";
import { personalRecords, fromKg, formatNum } from "../metrics.js";

const MUSCLE_HINTS = ["Спина", "Грудь", "Ноги", "Бицепс", "Трицепс", "Дельты", "Средняя дельта", "Задняя дельта", "Пресс", "Предплечья", "Икры", "Ягодицы", "Трапеции"];

export const muscleOptions = () => [...new Set([...MUSCLE_HINTS, ...state.exercises.map(e => e.muscleGroup).filter(Boolean)])];

/** Модальный лист с рекордами и последними выполнениями конкретного упражнения. */
export function openExerciseHistory(exerciseId, fallbackName = "Упражнение", fallbackUnit = "kg") {
  const ex = getExercise(exerciseId);
  const name = ex ? ex.name : fallbackName;
  const unit = ex ? ex.unit : fallbackUnit;
  const u = unitLabel(unit);
  const done = doneSessions().sort((a, b) => b.startedAt - a.startedAt);
  const pr = personalRecords(done).get(exerciseId);

  const historyRows = [];
  for (const s of done) {
    const entries = (s.entries || []).filter(e => e.exerciseId === exerciseId && (e.sets || []).some(x => x.done));
    if (!entries.length) continue;
    const setsText = entries.flatMap(e => (e.sets || []).filter(x => x.done).map(x =>
      `${x.isWarmup ? "Р: " : ""}${fmtNum(x.weight ?? 0)} ${unitLabel(e.unit)} × ${x.reps}${x.rpe ? ` @${fmtNum(x.rpe)}` : ""}`
    )).join("  ·  ");
    const notes = entries.map(e => e.note).filter(Boolean).join("; ");
    historyRows.push({ date: s.startedAt, programName: s.programName, setsText, notes });
    if (historyRows.length >= 8) break;
  }

  const prBlock = pr && (pr.weightKg !== null || pr.e1rmKg !== null)
    ? h("div", { class: "stats" },
        h("div", { class: "stat" },
          h("small", { class: "muted" }, "Рекорд веса"),
          h("strong", {}, pr.weightKg !== null ? `${formatNum(fromKg(pr.weightKg, unit), 1)} ${u}` : "—"),
          pr.weightDate ? h("small", { class: "muted" }, fmtDate(pr.weightDate)) : null),
        h("div", { class: "stat" },
          h("small", { class: "muted" }, "Лучший e1RM"),
          h("strong", {}, pr.e1rmKg !== null ? `${formatNum(fromKg(pr.e1rmKg, unit), 1)} ${u}` : "—"),
          pr.e1rmDate ? h("small", { class: "muted" }, fmtDate(pr.e1rmDate)) : null))
    : h("p", { class: "muted small" }, "Рекордов по этому упражнению пока нет.");

  const list = h("div", { class: "list" });
  if (!historyRows.length) {
    list.append(h("p", { class: "empty" }, "Это упражнение ещё не выполнялось в завершённых тренировках."));
  } else {
    for (const r of historyRows) {
      list.append(h("div", { class: "card" },
        h("div", { class: "grow" },
          h("strong", {}, `${fmtDate(r.date)} · ${r.programName}`),
          h("span", { class: "small" }, r.setsText),
          r.notes ? h("small", { class: "muted" }, r.notes) : null)));
    }
  }

  sheet(h("div", { class: "stack" },
    ex?.note ? h("p", { class: "muted small" }, "Заметка: " + ex.note) : null,
    prBlock,
    h("h3", { class: "group" }, "Последние тренировки"),
    list), { title: name });
}

export function openExerciseForm(ex, onSaved) {
  const isNew = !ex;
  const e = ex ? { ...ex } : { name: "", muscleGroup: "", unit: state.settings.defaultUnit, defaultSets: 3, defaultRestSec: state.settings.restSec, trackRpe: false, note: "" };
  const name = h("input", { type: "text", value: e.name, placeholder: "Например, Жим лёжа", autocomplete: "off" });
  const muscle = h("input", { type: "text", value: e.muscleGroup, list: "muscle-list", placeholder: "Спина, грудь, ноги…", autocomplete: "off" });
  const dl = h("datalist", { id: "muscle-list" }, muscleOptions().map(m => h("option", { value: m })));
  const unit = h("select", {}, h("option", { value: "kg", selected: e.unit === "kg" }, "кг"), h("option", { value: "lb", selected: e.unit === "lb" }, "lb"));
  const sets = h("input", { type: "text", inputmode: "numeric", value: e.defaultSets });
  const rest = h("input", { type: "text", inputmode: "numeric", value: e.defaultRestSec });
  const restHint = h("span", { class: "muted" }, "= " + fmtRest(e.defaultRestSec));
  rest.addEventListener("input", () => (restHint.textContent = "= " + fmtRest(parseNum(rest.value) || 0)));
  const rpe = h("input", { type: "checkbox", checked: e.trackRpe });
  const isBw = h("input", { type: "checkbox", checked: !!e.isBodyweight });
  const note = h("textarea", { rows: 2, placeholder: "Заметка (настройка тренажёра, хват…)" }, e.note || "");
  const err = h("p", { class: "error", hidden: true });

  let dirty = false;
  [name, muscle, unit, sets, rest, rpe, isBw, note].forEach(el => el.addEventListener("input", () => (dirty = true)));

  const save = () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = "Введите название"; err.hidden = false; name.focus(); return; }
    const saved = saveExercise({
      ...e, name: nm, muscleGroup: muscle.value.trim(), unit: unit.value,
      defaultSets: Math.max(1, Math.round(parseNum(sets.value) || 3)),
      defaultRestSec: Math.max(0, Math.round(parseNum(rest.value) ?? 210)),
      trackRpe: rpe.checked, isBodyweight: isBw.checked, note: note.value.trim()
    });
    dirty = false;
    sh.close(); onSaved && onSaved(saved);
  };
  const archived = !!e.archived;
  const extra = [];
  if (!isNew) {
    extra.push(h("button", { class: "btn", type: "button", onclick: () => { dirty = false; saveExercise({ ...e, archived: !archived }); sh.close(); toast(archived ? "Возвращено из архива" : "Перенесено в архив"); } }, archived ? "Возвратить из архива" : "В архив"));
    if (!isExerciseUsed(e.id)) extra.push(h("button", { class: "btn", type: "button", onclick: async () => { if (await confirmDialog(`Удалить «${e.name}»?`, { ok: "Удалить", danger: true })) { dirty = false; deleteExercise(e.id); sh.close(); } } }, "Удалить"));
    else extra.push(h("p", { class: "muted small" }, "Упражнение есть в истории — удалить нельзя, только архивировать."));
  }
  const form = h("form", { class: "stack", onsubmit: ev => { ev.preventDefault(); save(); } },
    h("label", { class: "field" }, h("span", {}, "Название"), name),
    h("label", { class: "field" }, h("span", {}, "Мышца"), muscle, dl),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, "Единицы"), unit),
      h("label", { class: "field grow" }, h("span", {}, "Сетов по умолч."), sets)),
    h("label", { class: "field" }, h("span", {}, "Отдых по умолчанию, сек ", restHint), rest),
    h("label", { class: "check" }, isBw, h("span", {}, "Упражнение со своим весом (+ доп. вес)")),
    h("label", { class: "check" }, rpe, h("span", {}, "Вести RPE")),
    h("label", { class: "field" }, h("span", {}, "Заметка"), note),
    err,
    h("div", { class: "row gap" }, extra),
    h("button", { class: "btn primary block", type: "submit" }, "Сохранить"));
  const sh = sheet(form, {
    title: isNew ? "Новое упражнение" : "Упражнение",
    beforeClose: () => (!dirty ? true : confirmDialog("Закрыть без сохранения изменений?", { ok: "Закрыть", cancel: "Остаться", danger: true }))
  });
  if (isNew) name.focus();
}

/** Выбор упражнения из библиотеки. onPick(exercise). */
export function pickExercise(onPick, { exclude = [], multi = false } = {}) {
  const list = h("div", { class: "list" });
  const search = h("input", { type: "search", placeholder: "Поиск", "aria-label": "Поиск" });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    clear(list);
    const items = state.exercises.filter(x => !x.archived && !exclude.includes(x.id) && (!q || (x.name + " " + x.muscleGroup).toLowerCase().includes(q)))
      .sort((a, b) => (a.muscleGroup || "").localeCompare(b.muscleGroup || "") || a.name.localeCompare(b.name));
    if (!items.length) list.append(h("p", { class: "empty" }, "Ничего не найдено. Создайте упражнение в разделе «Упражнения»."));
    for (const x of items) list.append(h("button", { class: "list-item", type: "button", onclick: () => { onPick(x); if (!multi) sh.close(); else toast("Добавлено: " + x.name); } },
      h("span", { class: "grow" }, h("strong", {}, x.name), h("small", { class: "muted" }, x.muscleGroup || "—")), icon("plus", 20)));
  };
  search.addEventListener("input", paint);
  const sh = sheet(h("div", { class: "stack" }, search, list,
    h("button", { class: "btn block", type: "button", onclick: () => openExerciseForm(null, x => { onPick(x); sh.close(); }) }, "+ Новое упражнение")), { title: "Выберите упражнение", full: true });
  paint();
}

export function mount(root) {
  const search = h("input", { type: "search", placeholder: "Поиск…", "aria-label": "Поиск" });
  const filter = h("select", { "aria-label": "Фильтр по мышце" });
  const showArchived = h("input", { type: "checkbox" });
  const list = h("div", { class: "list" });

  const paintFilter = () => {
    const cur = filter.value;
    clear(filter).append(h("option", { value: "" }, "Все мышцы"));
    for (const m of [...new Set(state.exercises.map(e => e.muscleGroup).filter(Boolean))].sort()) filter.append(h("option", { value: m, selected: m === cur }, m));
  };
  const paint = () => {
    paintFilter();
    const q = search.value.trim().toLowerCase();
    clear(list);
    const items = state.exercises
      .filter(e => (showArchived.checked || !e.archived) && (!filter.value || e.muscleGroup === filter.value) && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.muscleGroup || "").localeCompare(b.muscleGroup || "") || a.name.localeCompare(b.name));
    if (!items.length) list.append(h("p", { class: "empty" }, state.exercises.length ? "Ничего не найдено" : "Библиотека пуста. Добавьте упражнение или загрузите стартовые данные в настройках."));
    let lastGroup = null;
    for (const e of items) {
      if (e.muscleGroup !== lastGroup) { lastGroup = e.muscleGroup; list.append(h("h3", { class: "group" }, lastGroup || "Без группы")); }
      const weightInfo = e.startWeight != null ? `${fmtNum(e.startWeight)} ${unitLabel(e.unit)} · ` : "";
      list.append(h("div", { class: "list-item" + (e.archived ? " archived" : "") },
        h("button", { class: "card-main grow", type: "button", onclick: () => openExerciseForm(e) },
          h("strong", {}, e.name),
          h("small", { class: "muted" }, `${weightInfo}${e.defaultSets} сет. · отдых ${fmtRest(e.defaultRestSec)} · ${unitLabel(e.unit)}${e.isBodyweight ? " · свой вес" : ""}${e.trackRpe ? " · RPE" : ""}${e.archived ? " · архив" : ""}`)),
        iconBtn("clock", "История упражнения", () => openExerciseHistory(e.id, e.name, e.unit)),
        iconBtn("edit", "Редактировать", () => openExerciseForm(e))));
    }
  };
  [search, filter, showArchived].forEach(el => el.addEventListener("input", paint));
  root.append(
    h("div", { class: "toolbar" }, search, filter),
    h("div", { class: "row gap", style: "justify-content:space-between" },
      h("label", { class: "check small" }, showArchived, h("span", {}, "Показывать архивные")),
      h("button", { class: "btn small primary", type: "button", onclick: () => openExerciseForm(null) }, "+ Упражнение")),
    list,
    h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: () => openExerciseForm(null) }, "+ Новое упражнение")));
  paint();
  return { update: () => { if (!document.activeElement || document.activeElement === document.body || !root.contains(document.activeElement) || document.activeElement === filter) paint(); } };
}
