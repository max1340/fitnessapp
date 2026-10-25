// Карточка упражнения с сетами. Используется и в активной тренировке, и в редактировании истории.
import { h, icon, iconBtn, fmtNum, parseNum, toast } from "../ui.js";
import { state, getExercise, stepFor, unitLabel } from "../store.js";
import { toKg, epley, MAX_E1RM_REPS } from "../metrics.js";
import { openExerciseHistory } from "./exercises.js";

const round = n => Math.round(n * 100) / 100;

/** Проверяет, побил ли выполненный рабочий сет исторический рекорд упражнения. */
export function checkSetPR(set, unit, basePr) {
  if (!basePr || !set || !set.done || set.isWarmup || !(set.reps > 0) || !(set.weight > 0)) return null;
  if (basePr.weightKg === null && basePr.e1rmKg === null) return null;
  const wKg = toKg(set.weight, unit);
  const beatW = basePr.weightKg !== null && wKg > basePr.weightKg + 1e-6;
  const e1 = set.reps <= MAX_E1RM_REPS ? epley(wKg, set.reps, set.rpe) : null;
  const beatE1 = e1 !== null && basePr.e1rmKg !== null && e1 > basePr.e1rmKg + 1e-6;
  if (!beatW && !beatE1) return null;
  return { beatW, beatE1, wKg, e1 };
}

/**
 * entry — объект записи (мутируется напрямую).
 * ctx: { index, count, key, reorder:bool, collapsible:bool, prBaseline, onChange(), rerender(), onSetDone(entry,set,pr), onMove(d), onSkip(), onRemove() }
 */
export function entryCard(entry, ctx) {
  const cardKey = ctx.key || String(ctx.index);
  if (entry.skipped) {
    return h("article", { class: "entry skipped", dataset: { key: cardKey } },
      h("div", { class: "entry-head" },
        ctx.reorder ? h("button", { class: "btn icon drag-handle", type: "button", "aria-label": "Перетащить" }, icon("drag", 18)) : null,
        h("div", { class: "grow" }, h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`), h("small", { class: "muted" }, "Пропущено")),
        h("button", { class: "btn small", type: "button", onclick: () => { entry.skipped = false; ctx.onChange(); ctx.rerender(); } }, "Вернуть")));
  }

  const unit = entry.unit, step = stepFor(unit);
  const allDone = ctx.collapsible !== false && entry.sets.length > 0 && entry.sets.every(s => s.done);
  const hasEntryPR = entry.sets.some(s => checkSetPR(s, unit, ctx.prBaseline));

  // Автосвёрнутый вид, когда все сеты упражнения выполнены
  if (allDone && !entry._expanded) {
    const workSets = entry.sets.filter(s => !s.isWarmup && s.done);
    const weights = [...new Set(workSets.map(s => fmtNum(s.weight ?? 0)))].join("/");
    const reps = workSets.map(s => s.reps ?? 0).join("/");
    const summary = workSets.length ? `${workSets.length} сет. · ${weights} ${unitLabel(unit)} × ${reps}` : `${entry.sets.length} сет.`;
    return h("article", { class: "entry collapsed", dataset: { key: cardKey } },
      h("div", { class: "entry-head" },
        ctx.reorder ? h("button", { class: "btn icon drag-handle", type: "button", "aria-label": "Перетащить" }, icon("drag", 18)) : null,
        h("button", { class: "entry-summary grow", type: "button", onclick: () => { entry._expanded = true; ctx.rerender(); } },
          h("span", { class: "entry-summary-title" },
            icon("check", 16),
            h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`),
            hasEntryPR ? h("span", { class: "pr-badge" }, "PR") : null),
          h("small", { class: "muted" }, summary)),
        iconBtn("down", "Развернуть", () => { entry._expanded = true; ctx.rerender(); })));
  }

  const setsBox = h("div", { class: "sets" });
  const weightInputs = new Map();
  const repsInputs = new Map();

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

  // Повторы переносятся в следующие пустые (не заполненные) рабочие сеты
  function propagateReps(fromIdx) {
    const nv = entry.sets[fromIdx].reps;
    if (nv == null || entry.sets[fromIdx].isWarmup) return;
    for (let j = fromIdx + 1; j < entry.sets.length; j++) {
      const s = entry.sets[j];
      if (s.done || s.isWarmup) continue;
      if (s.reps == null) {
        s.reps = nv;
        const inp = repsInputs.get(s); if (inp) inp.value = fmtNum(nv);
      }
    }
  }

  function stepper(set, key, stepSize, placeholder, label, min = 0) {
    const inp = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", value: fmtNum(set[key]), placeholder, "aria-label": label });
    if (key === "weight") weightInputs.set(set, inp);
    if (key === "reps") repsInputs.set(set, inp);
    inp.addEventListener("input", () => {
      const old = set[key]; set[key] = parseNum(inp.value);
      const idx = entry.sets.indexOf(set);
      if (key === "weight") propagateWeight(idx, old);
      if (key === "reps") propagateReps(idx);
      ctx.onChange();
    });
    inp.addEventListener("focus", () => setTimeout(() => inp.select(), 0));
    const bump = d => {
      const cur = set[key] ?? 0, old = set[key];
      set[key] = Math.max(min, round(cur + d));
      inp.value = fmtNum(set[key]);
      const idx = entry.sets.indexOf(set);
      if (key === "weight") propagateWeight(idx, old);
      if (key === "reps") propagateReps(idx);
      ctx.onChange();
    };
    return h("div", { class: "stepper" },
      h("button", { class: "btn step", type: "button", "aria-label": label + " минус", onclick: () => bump(-stepSize) }, icon("minus", 14)),
      inp,
      h("button", { class: "btn step", type: "button", "aria-label": label + " плюс", onclick: () => bump(stepSize) }, icon("plus", 14)));
  }

  function attachSwipeDelete(row, onDelete) {
    let startX = 0, startY = 0, dx = 0, swiping = false;
    row.addEventListener("pointerdown", e => {
      if (e.target.closest("input, button")) return;
      startX = e.clientX; startY = e.clientY; dx = 0; swiping = false;
      const move = ev => {
        const curX = ev.clientX - startX, curY = ev.clientY - startY;
        if (!swiping) {
          if (Math.abs(curY) > 10 && Math.abs(curY) > Math.abs(curX)) { cleanup(); return; }
          if (curX < -14 && Math.abs(curX) > Math.abs(curY) * 1.3) {
            swiping = true;
            row.style.transition = "none";
          }
        }
        if (swiping) {
          dx = Math.max(-120, Math.min(0, curX));
          row.style.transform = `translateX(${dx}px)`;
          row.style.opacity = String(Math.max(0.35, 1 + dx / 180));
        }
      };
      const end = () => {
        cleanup();
        if (!swiping) return;
        row.style.transition = "transform .18s ease, opacity .18s ease";
        if (dx < -70) {
          row.style.transform = "translateX(-100%)";
          row.style.opacity = "0";
          setTimeout(onDelete, 160);
        } else {
          row.style.transform = "";
          row.style.opacity = "";
        }
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
  }

  function paintSets() {
    setsBox.replaceChildren();
    weightInputs.clear(); repsInputs.clear();
    let n = 0;
    entry.sets.forEach((set, i) => {
      if (!set.isWarmup) n++;
      const toggleWarm = () => { set.isWarmup = !set.isWarmup; ctx.onChange(); paintSets(); };
      const idxBtn = h("button", {
        class: "set-idx" + (set.isWarmup ? " warm" : ""), type: "button",
        title: "Тап: разминочный (Р) / рабочий сет", "aria-label": set.isWarmup ? "Разминочный сет" : `Сет ${n}`,
        onclick: toggleWarm
      }, set.isWarmup ? "Р" : String(n));
      const doneBtn = h("button", {
        class: "btn done-btn", type: "button", "aria-pressed": String(!!set.done), "aria-label": "Сет выполнен",
        onclick: () => toggleDone(set, row, doneBtn, rowA, prSlot)
      }, icon("check", 19));
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

      // Кнопка-чип подсказки показывается, если значения отличаются от подсказки (или повторы ещё пустые)
      const hintDiffers = set.hint && !set.done && (
        (set.hintWeight != null && set.weight !== set.hintWeight) ||
        (set.hintReps != null && set.reps !== set.hintReps)
      );
      const hintEl = hintDiffers
        ? h("button", {
            class: "hint-chip", type: "button", title: "Подставить вес и повторы",
            onclick: () => {
              const oldW = set.weight;
              if (set.hintWeight != null) { set.weight = set.hintWeight; const wi = weightInputs.get(set); if (wi) wi.value = fmtNum(set.weight); propagateWeight(i, oldW); }
              if (set.hintReps != null) { set.reps = set.hintReps; const ri = repsInputs.get(set); if (ri) ri.value = fmtNum(set.reps); propagateReps(i); }
              ctx.onChange();
              paintSets();
              toast("Подставлено: " + set.hint);
            }
          }, "↺ " + set.hint)
        : null;

      const hasPr = !!checkSetPR(set, unit, ctx.prBaseline);
      const prSlot = h("span", { class: "pr-slot" }, hasPr ? h("span", { class: "pr-badge", title: "Личный рекорд!" }, "PR") : null);

      const showSub = !!(hintEl || hasPr || rpeEl);
      const rowB = h("div", { class: "set-sub", hidden: !showSub }, hintEl, prSlot, rpeEl);
      const delSet = () => { entry.sets.splice(i, 1); ctx.onChange(); paintSets(); };
      const row = h("div", { class: "set" + (set.done ? " done" : "") + (set.isWarmup ? " warm" : "") }, rowA, rowB);
      attachSwipeDelete(row, delSet);
      setsBox.append(row);
    });
  }

  function toggleDone(set, row, btn, rowA, prSlot) {
    if (!set.done && !(set.reps > 0)) { // нельзя отметить пустой сет — подсказываем куда ввести
      const inputs = rowA.querySelectorAll("input"); inputs[1] && inputs[1].focus(); return;
    }
    set.done = !set.done;
    set.completedAt = set.done ? Date.now() : null;
    row.classList.toggle("done", set.done);
    btn.setAttribute("aria-pressed", String(set.done));
    const pr = checkSetPR(set, unit, ctx.prBaseline);
    prSlot.replaceChildren(pr ? h("span", { class: "pr-badge", title: "Личный рекорд!" }, "PR") : "");
    const sub = row.querySelector(".set-sub");
    if (sub) sub.hidden = !pr && !entry.trackRpe;
    if (!set.done) entry._expanded = true; // если сняли галочку — оставляем карточку открытой
    else if (entry.sets.every(s => s.done)) entry._expanded = false; // все сеты готовы — свернётся
    ctx.onChange();
    if (set.done && ctx.onSetDone) ctx.onSetDone(entry, set, pr);
    if (ctx.collapsible !== false && entry.sets.every(s => s.done)) {
      setTimeout(() => ctx.rerender(), 260);
    }
  }

  paintSets();
  const note = h("input", { type: "text", class: "entry-note", value: entry.note || "", placeholder: "Заметка…", "aria-label": "Заметка к упражнению" });
  note.addEventListener("input", () => { entry.note = note.value; ctx.onChange(); });

  const exObj = getExercise(entry.exerciseId);
  const muscle = exObj?.muscleGroup || "";
  const isBw = !!(entry.isBodyweight || exObj?.isBodyweight);
  const firstHint = (entry.sets.find(s => s.hint) || {}).hint || "";
  const subParts = [];
  if (isBw && state.settings.bodyweightKg) subParts.push(`свой вес ${fmtNum(state.settings.bodyweightKg)} кг`);
  if (entry.targetReps) subParts.push("цель: " + entry.targetReps);
  if (entry.programNote) subParts.push(entry.programNote);
  else if (firstHint) subParts.push(firstHint);

  const progBanner = entry.progression && !entry.sets.some(s => s.done)
    ? h("button", {
        class: "prog-banner", type: "button",
        onclick: () => {
          const { nextWeight, resetReps, step: st } = entry.progression;
          entry.sets.forEach(s => {
            if (!s.isWarmup && !s.done) {
              s.weight = nextWeight;
              if (resetReps) s.reps = resetReps;
            }
          });
          entry.progression = null;
          ctx.onChange();
          ctx.rerender();
          toast(`Вес увеличен на +${fmtNum(st)} ${unitLabel(unit)}`);
        }
      }, `↑ Все сеты закрыты (${entry.progression.maxTarget}+) — добавить +${fmtNum(entry.progression.step)} ${unitLabel(unit)} → ${fmtNum(entry.progression.nextWeight)} ${unitLabel(unit)}`)
    : null;

  return h("article", { class: "entry", dataset: { key: cardKey } },
    h("div", { class: "entry-head" },
      ctx.reorder ? h("button", { class: "btn icon drag-handle", type: "button", "aria-label": "Перетащить упражнение", title: "Перетащите для смены порядка" }, icon("drag", 18)) : null,
      h("button", {
        class: "entry-title-btn grow", type: "button", title: "Нажмите: история и рекорды упражнения",
        onclick: () => openExerciseHistory(entry.exerciseId, entry.exerciseName, entry.unit)
      },
        h("span", { class: "entry-title-row" },
          h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`),
          muscle ? h("span", { class: "muscle-tag" }, muscle) : null,
          icon("clock", 13)),
        subParts.length ? h("small", { class: "muted" }, subParts.join(" · ")) : null),
      allDone ? iconBtn("up", "Свернуть", () => { entry._expanded = false; ctx.rerender(); }) : null,
      ctx.onSwap ? iconBtn("swap", "Заменить упражнение", ctx.onSwap) : null,
      ctx.reorder ? [iconBtn("up", "Выше", () => ctx.onMove(-1)), iconBtn("down", "Ниже", () => ctx.onMove(1))] : null,
      ctx.onSkip ? iconBtn("skip", "Пропустить упражнение", ctx.onSkip) : null,
      ctx.onRemove ? iconBtn("trash", "Убрать упражнение", ctx.onRemove) : null),
    progBanner,
    h("div", { class: "set-cols" },
      h("span", { title: "Нажмите на номер подхода для разминки (Р)" }, "#/Р"),
      h("span", {}, (isBw ? "Доп. вес, " : "Вес, ") + unitLabel(unit)),
      h("span", {}, "Повторы"),
      h("span", {}, "Готово")),
    setsBox,
    h("div", { class: "entry-foot" },
      h("button", { class: "btn small add-set-btn", type: "button", onclick: () => {
        const prev = entry.sets[entry.sets.length - 1];
        entry.sets.push({ reps: prev ? prev.reps : null, weight: prev ? prev.weight : null, rpe: null, done: false, isWarmup: false, completedAt: null, hint: "", hintWeight: prev ? prev.weight : null, hintReps: prev ? prev.reps : null });
        entry._expanded = true;
        ctx.onChange(); paintSets();
      } }, "+ Сет"),
      h("button", { class: "btn small add-set-btn", type: "button", title: "Удалить последний сет", onclick: () => {
        if (entry.sets.length <= 1) return;
        entry.sets.pop();
        ctx.onChange(); paintSets();
      } }, "− Сет"),
      note));
}
