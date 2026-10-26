// Карточка упражнения с сетами. Используется и в активной тренировке, и в редактировании истории.
import { h, icon, iconBtn, fmtNum, parseNum, toast, haptic, showUndoSnackbar } from "../ui.js";
import { state, getExercise, stepFor, unitLabel, warmupSymbol } from "../store.js";
import { toKg, epley, MAX_E1RM_REPS } from "../metrics.js";
import { openExerciseHistory } from "./exercises.js";
import { t } from "../i18n.js";

const round = n => Math.round(n * 100) / 100;
const COACH_WARMUP_KEY = "fitness.coachmark.warmup";

/** Рассчитывает блины на одну сторону для штанговых упражнений */
export function calcPlates(totalWeight, unit = "kg") {
  const isLb = unit === "lb";
  const bar = isLb ? 45 : 20;
  if (!totalWeight || totalWeight <= bar) return null;
  let side = Math.round(((totalWeight - bar) / 2) * 100) / 100;
  if (side <= 0) return null;
  const available = isLb ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
  const used = [];
  for (const p of available) {
    while (side >= p - 1e-6) {
      used.push(p);
      side = Math.round((side - p) * 100) / 100;
    }
  }
  if (used.length === 0) return null;
  return used.join("+");
}

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
        ctx.reorder ? h("button", { class: "btn icon drag-handle", type: "button", "aria-label": t("entry.dragAria") }, icon("drag", 18)) : null,
        h("div", { class: "grow" }, h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`), h("small", { class: "muted" }, t("entry.skipped"))),
        h("button", { class: "btn small", type: "button", onclick: () => { entry.skipped = false; ctx.onChange(); ctx.rerender(); } }, t("entry.restore"))));
  }

  const unit = entry.unit, step = stepFor(unit);
  const initialAllDone = ctx.collapsible !== false && entry.sets.length > 0 && entry.sets.every(s => s.done);
  const isBarbell = /штан|гриф|barbell|bench\s*press|жим\s*лежа|жим\s*лёжа|присед|squat|deadlift|становая|overhead\s*press|military|тяга\s*в\s*наклоне/i.test(entry.exerciseName || "");

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
      if (isBarbell && key === "weight") paintSets();
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
      if (isBarbell && key === "weight") paintSets();
    };

    // Long-press auto-increment with acceleration
    const setupAutoIncrement = (btn, delta) => {
      let timer = null;
      let interval = null;
      let delay = 120;
      let count = 0;

      const stop = () => {
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        timer = null;
        interval = null;
      };

      const start = (e) => {
        haptic("light");
        bump(delta);
        count = 0;
        delay = 120;
        stop();
        timer = setTimeout(() => {
          interval = setInterval(() => {
            bump(delta);
            count++;
            if (count > 5 && delay > 45) {
              clearInterval(interval);
              delay = Math.max(40, delay - 25);
              interval = setInterval(() => bump(delta), delay);
            }
          }, delay);
        }, 340);
      };

      btn.addEventListener("pointerdown", start);
      btn.addEventListener("pointerup", stop);
      btn.addEventListener("pointercancel", stop);
      btn.addEventListener("pointerleave", stop);
    };

    const minusBtn = h("button", { class: "btn step", type: "button", "aria-label": t("entry.minusAria", { label }) }, icon("minus", 14));
    const plusBtn = h("button", { class: "btn step", type: "button", "aria-label": t("entry.plusAria", { label }) }, icon("plus", 14));

    setupAutoIncrement(minusBtn, -stepSize);
    setupAutoIncrement(plusBtn, stepSize);

    return h("div", { class: "stepper" }, minusBtn, inp, plusBtn);
  }

  function attachSwipeDelete(row, bg, iconWrap, onDelete) {
    let startX = 0, startY = 0, dx = 0, swiping = false, crossed = false;
    row.addEventListener("pointerdown", e => {
      if (e.target.closest("input, button")) return;
      startX = e.clientX; startY = e.clientY; dx = 0; swiping = false; crossed = false;
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
          const ratio = Math.min(1, Math.abs(dx) / 70);
          bg.style.opacity = String(Math.min(1, Math.abs(dx) / 36));
          iconWrap.style.transform = `scale(${(0.75 + ratio * 0.35).toFixed(2)})`;
          if (dx < -70 && !crossed) {
            crossed = true;
            bg.classList.add("armed");
            haptic("medium");
          } else if (dx >= -70 && crossed) {
            crossed = false;
            bg.classList.remove("armed");
            haptic("light");
          }
        }
      };
      const end = () => {
        cleanup();
        if (!swiping) return;
        row.style.transition = "transform .18s cubic-bezier(.2, .8, .2, 1), opacity .18s ease";
        if (dx < -70) {
          haptic("warning");
          row.style.transform = "translateX(-105%)";
          row.style.opacity = "0";
          setTimeout(onDelete, 160);
        } else {
          row.style.transform = "";
          bg.style.opacity = "0";
          bg.classList.remove("armed");
          iconWrap.style.transform = "";
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

  // Кружок статуса упражнения: пустой контур -> точка в процессе -> залитый черный с галочкой
  const doneCheckEl = h("span", { class: "entry-status-circle status-empty", role: "img" });
  function updateEntryStatus() {
    const total = entry.sets.length;
    const doneCount = entry.sets.filter(s => s.done).length;
    doneCheckEl.className = "entry-status-circle";
    if (doneCount === 0 || total === 0) {
      doneCheckEl.classList.add("status-empty");
      doneCheckEl.setAttribute("aria-label", t("entry.statusNotStarted"));
      doneCheckEl.setAttribute("title", t("entry.statusNotStarted"));
      doneCheckEl.replaceChildren();
    } else if (doneCount === total) {
      doneCheckEl.classList.add("status-done");
      doneCheckEl.setAttribute("aria-label", t("entry.statusDone"));
      doneCheckEl.setAttribute("title", t("entry.statusDone"));
      doneCheckEl.replaceChildren(icon("check", 14));
    } else {
      doneCheckEl.classList.add("status-in-progress");
      doneCheckEl.setAttribute("aria-label", t("entry.statusInProgress", { done: doneCount, total }));
      doneCheckEl.setAttribute("title", t("entry.statusInProgress", { done: doneCount, total }));
      doneCheckEl.replaceChildren(h("span", { class: "status-dot" }));
    }
  }

  let showWarmupCoach = !localStorage.getItem(COACH_WARMUP_KEY);

  function paintSets() {
    setsBox.replaceChildren();
    weightInputs.clear(); repsInputs.clear();
    let n = 0;
    const wSym = warmupSymbol();
    entry.sets.forEach((set, i) => {
      if (!set.isWarmup) n++;
      const toggleWarm = () => {
        set.isWarmup = !set.isWarmup;
        localStorage.setItem(COACH_WARMUP_KEY, "1");
        showWarmupCoach = false;
        ctx.onChange();
        paintSets();
      };
      const idxBtn = h("button", {
        class: "set-idx" + (set.isWarmup ? " warm" : ""), type: "button",
        title: t("entry.warmupTapTitle"), "aria-label": set.isWarmup ? t("entry.warmupAria") : t("entry.setAria", { n }),
        onclick: toggleWarm
      }, set.isWarmup ? wSym : String(n));

      const doneBtn = h("button", {
        class: "btn done-btn", type: "button", "aria-pressed": String(!!set.done), "aria-label": t("entry.setDoneAria"),
        onclick: () => toggleDone(set, row, doneBtn, rowA, prSlot)
      }, icon("check", 19));

      const rowA = h("div", { class: "set-main" },
        idxBtn,
        stepper(set, "weight", step, "0", t("entry.weightLabel")),
        stepper(set, "reps", 1, "0", t("entry.repsLabel")),
        doneBtn);

      // Coach-mark при первом запуске о том, что тап по номеру сета переключает в разминку
      if (showWarmupCoach && i === 0 && !set.done) {
        const coachBadge = h("span", {
          class: "coachmark-hint",
          title: t("entry.coachmarkWarmup"),
          onclick: (e) => {
            e.stopPropagation();
            localStorage.setItem(COACH_WARMUP_KEY, "1");
            showWarmupCoach = false;
            coachBadge.remove();
          }
        }, "W?");
        rowA.append(coachBadge);
      }

      const rpeEl = entry.trackRpe ? (() => {
        const inp = h("input", { type: "text", inputmode: "decimal", value: fmtNum(set.rpe), placeholder: "RPE", "aria-label": "RPE", class: "rpe" });
        inp.addEventListener("input", () => { const v = parseNum(inp.value); set.rpe = v !== null && v >= 1 && v <= 10 ? v : null; ctx.onChange(); });
        return inp;
      })() : null;

      // Кнопка-чип подсказки
      const hintDiffers = set.hint && !set.done && (
        (set.hintWeight != null && set.weight !== set.hintWeight) ||
        (set.hintReps != null && set.reps !== set.hintReps)
      );
      const hintEl = hintDiffers
        ? h("button", {
            class: "hint-chip", type: "button", title: t("entry.applyHintTitle"),
            onclick: () => {
              const oldW = set.weight;
              if (set.hintWeight != null) { set.weight = set.hintWeight; const wi = weightInputs.get(set); if (wi) wi.value = fmtNum(set.weight); propagateWeight(i, oldW); }
              if (set.hintReps != null) { set.reps = set.hintReps; const ri = repsInputs.get(set); if (ri) ri.value = fmtNum(set.reps); propagateReps(i); }
              ctx.onChange();
              paintSets();
              toast(t("entry.appliedToast", { hint: set.hint }));
            }
          }, "↺ " + set.hint)
        : null;

      const hasPr = !!checkSetPR(set, unit, ctx.prBaseline);
      const prSlot = h("span", { class: "pr-slot" }, hasPr ? h("span", { class: "pr-badge", title: t("entry.prTitle") }, "PR") : null);

      // Plate math для штанговых упражнений
      let plateEl = null;
      if (isBarbell && set.weight && set.weight > (unit === "lb" ? 45 : 20)) {
        const pStr = calcPlates(set.weight, unit);
        if (pStr) {
          plateEl = h("span", { class: "plate-math", title: t("entry.plateSide", { plates: pStr }) }, t("entry.plateSide", { plates: pStr }));
        }
      }

      const showSub = !!(hintEl || hasPr || rpeEl || plateEl);
      const rowB = h("div", { class: "set-sub", hidden: !showSub }, hintEl, plateEl, prSlot, rpeEl);

      const delSet = () => {
        const deletedSet = entry.sets[i];
        const deletedIdx = i;
        entry.sets.splice(i, 1);
        ctx.onChange();
        paintSets();
        setCollapsed(!entry._expanded);
        updateEntryStatus();
        showUndoSnackbar(
          t("entry.setDeletedToast"),
          t("common.undo"),
          () => {
            entry.sets.splice(deletedIdx, 0, deletedSet);
            ctx.onChange();
            paintSets();
            setCollapsed(!entry._expanded);
            updateEntryStatus();
          },
          6000
        );
      };

      const row = h("div", { class: "set" + (set.done ? " done" : "") + (set.isWarmup ? " warm" : "") }, rowA, rowB);
      const bgIcon = h("span", { class: "set-swipe-icon" }, icon("trash", 18));
      const bg = h("div", { class: "set-swipe-bg", "aria-hidden": "true" }, bgIcon);
      const wrap = h("div", { class: "set-swipe-wrap" }, bg, row);
      attachSwipeDelete(row, bg, bgIcon, delSet);
      setsBox.append(wrap);
    });
  }

  let collapseTimer = null;
  function toggleDone(set, row, btn, rowA, prSlot) {
    if (!set.done && !(set.reps > 0)) {
      haptic("error");
      const inputs = rowA.querySelectorAll("input"); inputs[1] && inputs[1].focus(); return;
    }
    clearTimeout(collapseTimer);
    set.done = !set.done;
    set.completedAt = set.done ? Date.now() : null;
    row.classList.toggle("done", set.done);
    btn.setAttribute("aria-pressed", String(set.done));
    const pr = checkSetPR(set, unit, ctx.prBaseline);
    prSlot.replaceChildren(pr ? h("span", { class: "pr-badge", title: t("entry.prTitle") }, "PR") : "");
    const sub = row.querySelector(".set-sub");
    if (sub) sub.hidden = !pr && !entry.trackRpe && !row.querySelector(".plate-math");
    const allCompleted = entry.sets.length > 0 && entry.sets.every(s => s.done);
    updateEntryStatus();
    if (!set.done) {
      haptic("light");
      setCollapsed(false);
    } else {
      haptic(pr ? "pr" : allCompleted ? "success" : "medium");
      if (ctx.collapsible !== false && allCompleted) {
        collapseTimer = setTimeout(() => setCollapsed(true), 220);
      } else {
        setCollapsed(false);
      }
    }
    ctx.onChange();
    if (set.done && ctx.onSetDone) ctx.onSetDone(entry, set, pr);
  }

  paintSets();
  updateEntryStatus();

  const note = h("input", { type: "text", class: "entry-note", value: entry.note || "", placeholder: t("entry.notePlaceholder"), "aria-label": t("entry.noteAria") });
  note.addEventListener("input", () => { entry.note = note.value; ctx.onChange(); });
  const noteWrap = h("div", { class: "entry-note-wrap" },
    h("span", { class: "entry-note-icon", "aria-hidden": "true" }, icon("pencil", 14)),
    note
  );

  const exObj = getExercise(entry.exerciseId);
  const muscle = exObj?.muscleGroup || "";
  const isBw = !!(entry.isBodyweight || exObj?.isBodyweight);
  const firstHint = (entry.sets.find(s => s.hint) || {}).hint || "";
  const subParts = [];
  if (isBw && state.settings.bodyweightKg) subParts.push(t("entry.bwSub", { bw: fmtNum(state.settings.bodyweightKg) }));
  if (entry.targetReps) subParts.push(t("entry.targetSub", { target: entry.targetReps }));
  if (entry.programNote) subParts.push(entry.programNote);
  else if (firstHint) subParts.push(firstHint);

  function buildSummaryText() {
    const workSets = entry.sets.filter(s => !s.isWarmup && s.done);
    const weights = [...new Set(workSets.map(s => fmtNum(s.weight ?? 0)))].join("/");
    const reps = workSets.map(s => s.reps ?? 0).join("/");
    return workSets.length
      ? t("entry.summaryWork", { count: workSets.length, weights, u: unitLabel(unit), reps })
      : t("entry.summarySets", { count: entry.sets.length });
  }

  const progBanner = entry.progression && !entry.sets.some(s => s.done)
    ? h("button", {
        class: "prog-banner", type: "button",
        onclick: () => {
          haptic("success");
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
          toast(t("entry.progIncreasedToast", { step: fmtNum(st), u: unitLabel(unit) }));
        }
      }, t("entry.progBanner", {
        max: entry.progression.maxTarget,
        step: fmtNum(entry.progression.step),
        u: unitLabel(unit),
        next: fmtNum(entry.progression.nextWeight)
      }))
    : null;

  const headPrBadge = h("span", { class: "pr-badge", hidden: true }, "PR");
  const muscleTagEl = muscle ? h("span", { class: "muscle-tag" }, muscle) : null;
  const clockIconEl = h("span", { class: "entry-clock-ico", title: t("entry.restHint") }, icon("clock", 13));
  const subEl = h("small", { class: "muted" });

  const foldBtn = h("button", {
    class: "btn icon entry-fold-btn",
    type: "button",
    hidden: !initialAllDone,
    onclick: () => setCollapsed(!article.classList.contains("collapsed"))
  }, icon("up", 20));

  const extraActions = h("div", { class: "entry-extra-actions" },
    ctx.onSwap ? iconBtn("swap", t("entry.swapHint"), ctx.onSwap) : null,
    ctx.onSkip ? iconBtn("skip", t("entry.skipHint"), ctx.onSkip) : null,
    ctx.onRemove ? iconBtn("trash", t("entry.removeEx"), ctx.onRemove) : null
  );

  const addWarmupBtn = h("button", {
    class: "btn small add-warmup-btn",
    type: "button",
    title: t("entry.addWarmupBtn"),
    onclick: () => {
      const firstWork = entry.sets.find(s => !s.isWarmup && (s.weight > 0 || s.hintWeight > 0));
      const workWeight = firstWork ? (firstWork.weight || firstWork.hintWeight || 0) : 0;
      const bar = unit === "lb" ? 45 : 20;
      const targetW = workWeight > bar ? workWeight : (bar * 2);
      const percentages = [0.45, 0.60, 0.75, 0.85];
      const repsList = [10, 6, 4, 2];
      const newWarmups = percentages.map((pct, idx) => {
        let w = Math.round((targetW * pct) / 2.5) * 2.5;
        if (w < bar) w = bar;
        return {
          reps: repsList[idx],
          weight: w,
          rpe: null,
          done: false,
          isWarmup: true,
          completedAt: null,
          hint: "",
          hintWeight: w,
          hintReps: repsList[idx]
        };
      });
      entry.sets.unshift(...newWarmups);
      ctx.onChange();
      paintSets();
      updateEntryStatus();
      toast(t("entry.warmupAddedToast", { n: newWarmups.length }));
      haptic("success");
    }
  }, t("entry.addWarmupBtn"));

  const bodyCollapse = h("div", { class: "entry-body-collapse" },
    h("div", { class: "entry-body-inner" },
      progBanner,
      h("div", { class: "set-cols" },
        h("span", { title: t("entry.colNumTitle") }, t("entry.colNum")),
        h("span", {}, t(isBw ? "entry.colWeightAdded" : "entry.colWeight", { u: unitLabel(unit) })),
        h("span", {}, t("entry.colReps")),
        h("span", {}, t("entry.colDone"))),
      setsBox,
      h("div", { class: "entry-foot" },
        h("button", { class: "btn small add-set-btn", type: "button", onclick: () => {
          const prev = entry.sets[entry.sets.length - 1];
          entry.sets.push({ reps: prev ? prev.reps : null, weight: prev ? prev.weight : null, rpe: null, done: false, isWarmup: false, completedAt: null, hint: "", hintWeight: prev ? prev.weight : null, hintReps: prev ? prev.reps : null });
          setCollapsed(false);
          ctx.onChange(); paintSets(); updateEntryStatus();
        } }, t("entry.addSet")),
        addWarmupBtn,
        h("button", { class: "btn small add-set-btn", type: "button", title: t("entry.removeSetTitle"), onclick: () => {
          if (entry.sets.length <= 1) return;
          entry.sets.pop();
          ctx.onChange(); paintSets(); updateEntryStatus();
          setCollapsed(!entry._expanded);
        } }, t("entry.removeSet")),
        noteWrap)
    )
  );

  const article = h("article", { class: "entry", dataset: { key: cardKey } },
    h("div", { class: "entry-head" },
      ctx.reorder ? h("button", { class: "btn icon drag-handle", type: "button", "aria-label": t("entry.dragExAria"), title: t("entry.dragExTitle") }, icon("drag", 18)) : null,
      h("button", {
        class: "entry-title-btn grow", type: "button", title: t("entry.historyTitle"),
        onclick: () => {
          if (article.classList.contains("collapsed")) {
            setCollapsed(false);
          } else {
            openExerciseHistory(entry.exerciseId, entry.exerciseName, entry.unit);
          }
        }
      },
        h("span", { class: "entry-title-row" },
          doneCheckEl,
          h("strong", {}, `${ctx.index + 1}. ${entry.exerciseName}`),
          headPrBadge,
          muscleTagEl,
          clockIconEl),
        subEl),
      foldBtn,
      extraActions),
    bodyCollapse
  );

  function setCollapsed(collapsed) {
    const canCollapse = ctx.collapsible !== false && entry.sets.length > 0 && entry.sets.every(s => s.done);
    const isCol = canCollapse && !!collapsed;
    entry._expanded = !isCol;
    article.classList.toggle("collapsed", isCol);
    foldBtn.hidden = !canCollapse;
    const lbl = isCol ? t("entry.expand") : t("entry.collapse");
    foldBtn.setAttribute("aria-label", lbl);
    foldBtn.setAttribute("title", lbl);
    const hasEntryPR = entry.sets.some(s => checkSetPR(s, unit, ctx.prBaseline));
    headPrBadge.hidden = !(isCol && hasEntryPR);
    subEl.textContent = isCol ? buildSummaryText() : subParts.join(" · ");
    subEl.hidden = !subEl.textContent;
  }

  setCollapsed(initialAllDone && !entry._expanded);
  return article;
}
