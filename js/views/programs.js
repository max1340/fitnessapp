import { h, clear, sheet, confirmDialog, toast, parseNum, fmtRest, icon, iconBtn, enableDragSort } from "../ui.js";
import { state, saveProgram, getExercise, uid } from "../store.js";
import { pickExercise } from "./exercises.js";

export function openProgramEditor(program) {
  const isNew = !program;
  const p = program ? JSON.parse(JSON.stringify(program)) : { name: "", items: [] };
  // у каждой позиции есть стабильный ключ для drag & drop
  p.items.forEach(it => (it._key = it._key || uid()));

  const name = h("input", { type: "text", value: p.name, placeholder: "Название программы", autocomplete: "off" });
  const list = h("div", { class: "pitems" });
  const err = h("p", { class: "error", hidden: true });

  const syncOrder = keys => { p.items = keys.map(k => p.items.find(i => i._key === k)); };
  enableDragSort(list, keys => { syncOrder(keys); paint(); });

  const move = (idx, d) => {
    const j = idx + d; if (j < 0 || j >= p.items.length) return;
    [p.items[idx], p.items[j]] = [p.items[j], p.items[idx]]; paint();
  };

  function paint() {
    clear(list);
    if (!p.items.length) list.append(h("p", { class: "empty" }, "Добавьте упражнения из библиотеки"));
    p.items.forEach((it, idx) => {
      const ex = getExercise(it.exerciseId);
      const field = (label, value, set, placeholder = "", mode = "numeric") => {
        const inp = h("input", { type: "text", inputmode: mode, value: value ?? "", placeholder, "aria-label": label });
        inp.addEventListener("input", () => set(inp.value));
        return h("label", { class: "field mini" }, h("span", {}, label), inp);
      };
      const restHint = h("span", { class: "muted small" });
      const showRest = () => (restHint.textContent = it.restSec ? fmtRest(it.restSec) : ex ? "по умолч. " + fmtRest(ex.defaultRestSec) : "");
      showRest();
      list.append(h("div", { class: "pitem", dataset: { key: it._key } },
        h("div", { class: "pitem-head" },
          h("button", { class: "btn icon drag-handle", type: "button", "aria-label": "Перетащить", title: "Перетащите, чтобы изменить порядок" }, icon("drag")),
          h("span", { class: "grow" }, h("strong", {}, `${idx + 1}. ${ex ? ex.name : "(упражнение удалено)"}`), h("small", { class: "muted" }, ex ? ex.muscleGroup : "")),
          iconBtn("up", "Вверх", () => move(idx, -1)), iconBtn("down", "Вниз", () => move(idx, 1)),
          iconBtn("x", "Убрать из программы", () => { p.items.splice(idx, 1); paint(); })),
        h("div", { class: "row gap pitem-fields" },
          field("Сеты", it.sets, v => (it.sets = Math.max(1, Math.round(parseNum(v) || 1)))),
          field("Повторы", it.targetReps, v => (it.targetReps = v.trim()), "8-10", "text"),
          h("div", { class: "field mini" }, h("span", {}, "Отдых, сек"),
            (() => { const i = h("input", { type: "text", inputmode: "numeric", value: it.restSec ?? "", placeholder: ex ? String(ex.defaultRestSec) : "", "aria-label": "Отдых, сек" }); i.addEventListener("input", () => { it.restSec = parseNum(i.value); showRest(); }); return i; })(),
            restHint)),
        h("input", { class: "pitem-note", type: "text", value: it.note || "", placeholder: "Заметка к позиции", "aria-label": "Заметка", oninput: ev => (it.note = ev.target.value) })));
    });
  }

  const save = () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = "Введите название"; err.hidden = false; name.focus(); return; }
    const items = p.items.map(({ _key, ...rest }) => ({
      exerciseId: rest.exerciseId, sets: rest.sets || 3, targetReps: rest.targetReps || "",
      restSec: rest.restSec ?? null, note: rest.note || ""
    }));
    saveProgram({ ...p, name: nm, items: items });
    sh.close(); toast("Программа сохранена");
  };

  const body = h("div", { class: "stack" },
    h("label", { class: "field" }, h("span", {}, "Название"), name), err, list,
    h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => {
      p.items.push({ _key: uid(), exerciseId: ex.id, sets: ex.defaultSets || 3, targetReps: "", restSec: null, note: "" }); paint();
    }, { multi: true }) }, "+ Добавить упражнение"),
    h("button", { class: "btn primary block", type: "button", onclick: save }, "Сохранить программу"));
  const sh = sheet(body, { title: isNew ? "Новая программа" : "Программа", full: true });
  paint();
  if (isNew) name.focus();
}

export function mount(root) {
  const list = h("div", { class: "list" });
  const showArchived = h("input", { type: "checkbox" });
  const paint = () => {
    clear(list);
    const items = state.programs.filter(p => showArchived.checked || !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) list.append(h("p", { class: "empty" }, "Программ пока нет. Создайте свою или загрузите стартовую в настройках (⚙)."));
    for (const p of items) {
      const names = p.items.map(i => getExercise(i.exerciseId)?.name).filter(Boolean);
      list.append(h("div", { class: "card" + (p.archived ? " archived" : "") },
        h("button", { class: "card-main", type: "button", onclick: () => openProgramEditor(p) },
          h("strong", {}, p.name + (p.archived ? " (архив)" : "")),
          h("small", { class: "muted" }, `${p.items.length} упр.: ${names.join(", ") || "—"}`)),
        h("div", { class: "row gap end" },
          iconBtn("copy", "Дублировать", () => { saveProgram({ ...p, id: uid(), name: p.name + " (копия)", baselineSessionId: null }); toast("Программа продублирована"); }),
          iconBtn("archive", p.archived ? "Вернуть из архива" : "В архив", async () => {
            if (p.archived || await confirmDialog(`Архивировать «${p.name}»? История останется.`, { ok: "В архив" })) saveProgram({ ...p, archived: !p.archived });
          }),
          iconBtn("edit", "Редактировать", () => openProgramEditor(p)))));
    }
  };
  showArchived.addEventListener("input", paint);
  root.append(h("label", { class: "check small" }, showArchived, h("span", {}, "Показывать архивные")), list,
    h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: () => openProgramEditor(null) }, "+ Новая программа")));
  paint();
  return { update: paint };
}
