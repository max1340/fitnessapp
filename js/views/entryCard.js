// Карточка упражнения с сетами. Используется и в активной тренировке, и в редактировании истории.
import { h, icon, iconBtn, fmtNum, parseNum } from "../ui.js";
import { stepFor, unitLabel } from "../store.js";

const round = n => Math.round(n * 100) / 100;

/**
 * entry — объект записи (мутируется напрямую).
 * ctx: { index, count, reorder:bool, onChange(), rerender(), onSetDone(entry,set), onMove(d), onSkip(), onRemove() }
 */
export function entryCard(entry, ctx) {
  if (entry.skipped) {
    return h("article", { class: "entry skipped" },
      h("div", { class: "entry-head" },
        h("div", { class: "grow" }, h("strong", {}, entry.exerciseName), h("small", { class: "muted" }, "Пропущено")),
        h("button", { class: "btn small", type: "button", onclick: () => { entry.skipped = false; ctx.onChange(); ctx.rerender(); } }, "Вернуть")));
  }
  const unit = entry.unit, step = stepFor(unit);
  const setsBox = h("div", { class: "sets" });

  const weightInputs = new Map();
  // Новый вес автоматически переносится на следующие невыполненные сеты, которые его ещё не меняли
  function propagateWeight(fromIdx, oldVal) {
    const nv = entry.sets[fromIdx].weight;
    for (let j = fromIdx + 1; j < entry.sets.length; j++) {
      const s = entry.sets[j];
      if (s.done || s.isWarmup || entry.sets[fromIdx].isWarmup) continue;
      if (s.weight === oldVal || s.weight == null) {
        s.weight = nv;
        const inp = weightInputs.get(s); if (inp) inp.value = fmtNum(nv);
      }
    }
  }

  function stepper(set, key, stepSize, placeholder, label, min = 0) {
    const inp = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", value: fmtNum(set[key]), placeholder, "aria-label": label });
    if (key === "weight") weightInputs.set(set, inp);
    inp.addEventListener("input", () => {
      const old = set[key]; set[key] = parseNum(inp.value);
      if (key === "weight") propagateWeight(entry.sets.indexOf(set), old);
      ctx.onChange();
    });
    inp.addEventListener("focus", () => setTimeout(() => inp.select(), 0));
    const bump = d => {
      const cur = set[key] ?? 0, old = set[key];
      set[key] = Math.max(min, round(cur + d));
      inp.value = fmtNum(set[key]);
      if (key === "weight") propagateWeight(entry.sets.indexOf(set), old);
      ctx.onChange();
    };
    return h("div", { class: "stepper" },
      h("button", { class: "btn step", type: "button", "aria-label": label + " минус", onclick: () => bump(-stepSize) }, icon("minus", 18)),
      inp,
      h("button", { class: "btn step", type: "button", "aria-label": label + " плюс", onclick: () => bump(stepSize) }, icon("plus", 18)));
  }

  function paintSets() {
    setsBox.replaceChildren();
    let n = 0;
    entry.sets.forEach((set, i) => {
      if (!set.isWarmup) n++;
      const repsInput = { el: null };
      const rowA = h("div", { class: "set-main" },
        h("span", { class: "set-idx" }, set.isWarmup ? "Р" : String(n)),
        h("div", { class: "set-field" }, stepper(set, "weight", step, unitLabel(unit), "Вес"), h("small", { class: "unit" }, unitLabel(unit))),
        h("div", { class: "set-field" }, stepper(set, "reps", 1, "повт.", "Повторы"), h("small", { class: "unit" }, "повт.")));
      const rpeEl = entry.trackRpe ? (() => {
        const inp = h("input", { type: "text", inputmode: "decimal", value: fmtNum(set.rpe), placeholder: "RPE", "aria-label": "RPE", class: "rpe" });
        inp.addEventListener("input", () => { const v = parseNum(inp.value); set.rpe = v !== null && v >= 1 && v <= 10 ? v : null; ctx.onChange(); });
        return inp;
      })() : null;
      const doneBtn = h("button", { class: "btn done-btn", type: "button", "aria-pressed": String(!!set.done), "aria-label": "Сет выполнен", onclick: () => toggleDone(set, row, doneBtn, rowA) },
        icon("check", 22), h("span", {}, "Готово"));
      const rowB = h("div", { class: "set-actions" },
        h("small", { class: "hint grow" }, set.hint || ""),
        rpeEl,
        h("button", { class: "btn small tag" + (set.isWarmup ? " on" : ""), type: "button", "aria-pressed": String(!!set.isWarmup), title: "Разминочный сет", onclick: () => { set.isWarmup = !set.isWarmup; ctx.onChange(); paintSets(); } }, "Разм."),
        iconBtn("x", "Удалить сет", () => { entry.sets.splice(i, 1); ctx.onChange(); paintSets(); }, "small"),
        doneBtn);
      const row = h("div", { class: "set" + (set.done ? " done" : "") + (set.isWarmup ? " warm" : "") }, rowA, rowB);
      setsBox.append(row);
    });
  }

  function toggleDone(set, row, btn, rowA) {
    if (!set.done && !(set.reps > 0)) { // нельзя отметить пустой сет — подсказываем куда ввести
      const inputs = rowA.querySelectorAll("input"); inputs[1] && inputs[1].focus(); return;
    }
    set.done = !set.done;
    set.completedAt = set.done ? Date.now() : null;
    row.classList.toggle("done", set.done);
    btn.setAttribute("aria-pressed", String(set.done));
    ctx.onChange();
    if (set.done && ctx.onSetDone) ctx.onSetDone(entry, set);
  }

  paintSets();
  const note = h("input", { type: "text", class: "entry-note", value: entry.note || "", placeholder: "Заметка к упражнению", "aria-label": "Заметка к упражнению" });
  note.addEventListener("input", () => { entry.note = note.value; ctx.onChange(); });

  return h("article", { class: "entry" },
    h("div", { class: "entry-head" },
      h("div", { class: "grow" },
        h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`),
        h("small", { class: "muted" }, [entry.targetReps ? "цель: " + entry.targetReps : "", entry.programNote || ""].filter(Boolean).join(" · "))),
      ctx.reorder ? [iconBtn("up", "Выше", () => ctx.onMove(-1)), iconBtn("down", "Ниже", () => ctx.onMove(1))] : null,
      ctx.onSkip ? iconBtn("skip", "Пропустить упражнение", ctx.onSkip) : null,
      ctx.onRemove ? iconBtn("trash", "Убрать упражнение", ctx.onRemove) : null),
    setsBox,
    h("div", { class: "row gap" },
      h("button", { class: "btn small", type: "button", onclick: () => {
        const prev = entry.sets[entry.sets.length - 1];
        entry.sets.push({ reps: prev ? prev.reps : null, weight: prev ? prev.weight : null, rpe: null, done: false, isWarmup: false, completedAt: null, hint: "" });
        ctx.onChange(); paintSets();
      } }, "+ Сет")),
    note);
}
