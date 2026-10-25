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
      h("button", { class: "btn step", type: "button", "aria-label": label + " минус", onclick: () => bump(-stepSize) }, icon("minus", 14)),
      inp,
      h("button", { class: "btn step", type: "button", "aria-label": label + " плюс", onclick: () => bump(stepSize) }, icon("plus", 14)));
  }

  function paintSets() {
    setsBox.replaceChildren();
    let n = 0;
    entry.sets.forEach((set, i) => {
      if (!set.isWarmup) n++;
      const toggleWarm = () => { set.isWarmup = !set.isWarmup; ctx.onChange(); paintSets(); };
      const idxBtn = h("button", {
        class: "set-idx" + (set.isWarmup ? " warm" : ""), type: "button",
        title: "Нажмите: разминочный / рабочий сет", "aria-label": set.isWarmup ? "Разминочный сет" : `Сет ${n}`,
        onclick: toggleWarm
      }, set.isWarmup ? "Р" : String(n));
      const doneBtn = h("button", {
        class: "btn done-btn", type: "button", "aria-pressed": String(!!set.done), "aria-label": "Сет выполнен",
        onclick: () => toggleDone(set, row, doneBtn, rowA)
      }, icon("check", 20));
      const rowA = h("div", { class: "set-main" },
        idxBtn,
        stepper(set, "weight", step, "0", "Вес"),
        stepper(set, "reps", 1, "0", "Повторы"),
        doneBtn);
      const rpeEl = entry.trackRpe ? (() => {
        const inp = h("input", { type: "text", inputmode: "decimal", value: fmtNum(set.rpe), placeholder: "RPE", "aria-label": "RPE", class: "rpe" });
        inp.addEventListener("input", () => { const v = parseNum(inp.value); set.rpe = v !== null && v >= 1 && v <= 10 ? v : null; ctx.onChange(); });
        return inp;
      })() : null;
      const rowB = h("div", { class: "set-sub" },
        h("small", { class: "hint grow" }, set.hint || ""),
        rpeEl,
        h("button", { class: "sub-act" + (set.isWarmup ? " on" : ""), type: "button", "aria-pressed": String(!!set.isWarmup), onclick: toggleWarm }, "Разм."),
        h("button", { class: "sub-act del", type: "button", "aria-label": "Удалить сет", title: "Удалить сет", onclick: () => { entry.sets.splice(i, 1); ctx.onChange(); paintSets(); } }, "✕"));
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
  const note = h("input", { type: "text", class: "entry-note", value: entry.note || "", placeholder: "Заметка к упражнению…", "aria-label": "Заметка к упражнению" });
  note.addEventListener("input", () => { entry.note = note.value; ctx.onChange(); });

  return h("article", { class: "entry" },
    h("div", { class: "entry-head" },
      h("div", { class: "grow" },
        h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`),
        (entry.targetReps || entry.programNote) ? h("small", { class: "muted" }, [entry.targetReps ? "цель: " + entry.targetReps : "", entry.programNote || ""].filter(Boolean).join(" · ")) : null),
      ctx.reorder ? [iconBtn("up", "Выше", () => ctx.onMove(-1)), iconBtn("down", "Ниже", () => ctx.onMove(1))] : null,
      ctx.onSkip ? iconBtn("skip", "Пропустить упражнение", ctx.onSkip) : null,
      ctx.onRemove ? iconBtn("trash", "Убрать упражнение", ctx.onRemove) : null),
    h("div", { class: "set-cols" }, h("span", {}, "#"), h("span", {}, "Вес, " + unitLabel(unit)), h("span", {}, "Повторы"), h("span", {}, "✓")),
    setsBox,
    h("div", { class: "entry-foot" },
      h("button", { class: "btn small add-set-btn", type: "button", onclick: () => {
        const prev = entry.sets[entry.sets.length - 1];
        entry.sets.push({ reps: prev ? prev.reps : null, weight: prev ? prev.weight : null, rpe: null, done: false, isWarmup: false, completedAt: null, hint: "" });
        ctx.onChange(); paintSets();
      } }, "+ Сет"),
      note));
}
