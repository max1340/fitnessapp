import { h, clear, sheet, confirmDialog, toast, parseNum, fmtNum, fmtRest, icon } from "../ui.js";
import { state, saveExercise, deleteExercise, isExerciseUsed, unitLabel } from "../store.js";

const MUSCLE_HINTS = ["Спина", "Грудь", "Ноги", "Бицепс", "Трицепс", "Дельты", "Средняя дельта", "Задняя дельта", "Пресс", "Предплечья", "Икры", "Ягодицы", "Трапеции"];

export const muscleOptions = () => [...new Set([...MUSCLE_HINTS, ...state.exercises.map(e => e.muscleGroup).filter(Boolean)])];

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
  const note = h("textarea", { rows: 2, placeholder: "Заметка (настройка тренажёра, хват…)" }, e.note || "");
  const err = h("p", { class: "error", hidden: true });

  const save = () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = "Введите название"; err.hidden = false; name.focus(); return; }
    const saved = saveExercise({
      ...e, name: nm, muscleGroup: muscle.value.trim(), unit: unit.value,
      defaultSets: Math.max(1, Math.round(parseNum(sets.value) || 3)),
      defaultRestSec: Math.max(0, Math.round(parseNum(rest.value) ?? 210)),
      trackRpe: rpe.checked, note: note.value.trim()
    });
    sh.close(); onSaved && onSaved(saved);
  };
  const archived = !!e.archived;
  const extra = [];
  if (!isNew) {
    extra.push(h("button", { class: "btn", type: "button", onclick: () => { saveExercise({ ...e, archived: !archived }); sh.close(); toast(archived ? "Возвращено из архива" : "Перенесено в архив"); } }, archived ? "Вернуть из архива" : "В архив"));
    if (!isExerciseUsed(e.id)) extra.push(h("button", { class: "btn", type: "button", onclick: async () => { if (await confirmDialog(`Удалить «${e.name}»?`, { ok: "Удалить", danger: true })) { deleteExercise(e.id); sh.close(); } } }, "Удалить"));
    else extra.push(h("p", { class: "muted small" }, "Упражнение есть в истории — удалить нельзя, только архивировать."));
  }
  const form = h("form", { class: "stack", onsubmit: ev => { ev.preventDefault(); save(); } },
    h("label", { class: "field" }, h("span", {}, "Название"), name),
    h("label", { class: "field" }, h("span", {}, "Мышца"), muscle, dl),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, "Единицы"), unit),
      h("label", { class: "field grow" }, h("span", {}, "Сетов по умолч."), sets)),
    h("label", { class: "field" }, h("span", {}, "Отдых по умолчанию, сек ", restHint), rest),
    h("label", { class: "check" }, rpe, h("span", {}, "Вести RPE")),
    h("label", { class: "field" }, h("span", {}, "Заметка"), note),
    err,
    h("div", { class: "row gap" }, extra),
    h("button", { class: "btn primary block", type: "submit" }, "Сохранить"));
  const sh = sheet(form, { title: isNew ? "Новое упражнение" : "Упражнение" });
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
  const search = h("input", { type: "search", placeholder: "Поиск упражнения", "aria-label": "Поиск" });
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
      list.append(h("button", { class: "list-item" + (e.archived ? " archived" : ""), type: "button", onclick: () => openExerciseForm(e) },
        h("span", { class: "grow" }, h("strong", {}, e.name), h("small", { class: "muted" }, `${e.defaultSets} × · отдых ${fmtRest(e.defaultRestSec)} · ${unitLabel(e.unit)}${e.trackRpe ? " · RPE" : ""}${e.archived ? " · архив" : ""}`)),
        icon("edit", 18)));
    }
  };
  [search, filter, showArchived].forEach(el => el.addEventListener("input", paint));
  root.append(
    h("div", { class: "toolbar" }, search, filter),
    h("label", { class: "check small" }, showArchived, h("span", {}, "Показывать архивные")),
    list,
    h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: () => openExerciseForm(null) }, "+ Новое упражнение")));
  paint();
  return { update: () => { if (!document.activeElement || document.activeElement === document.body || !root.contains(document.activeElement) || document.activeElement === filter) paint(); } };
}
