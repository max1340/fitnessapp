import { h, clear, sheet, confirmDialog, toast, fmtDate, fmtNum, fmtRest, icon, debounce, enableDragSort } from "../ui.js";
import { state, getExercise, getProgram, saveProgram, saveSession, deleteSession, activeSession, doneSessions, lastValues, stepFor, uid, unitLabel, warmupSymbol } from "../store.js";
import { sessionStats, loadIndex, pickBaseline, compareWithPrevious, personalRecords, formatNum, fromKg, byStart } from "../metrics.js";
import { entryCard, checkSetPR } from "./entryCard.js";
import { pickExercise } from "./exercises.js";
import { startRest, stopRest } from "../timer.js";
import { renderBodyMap } from "../bodyMap.js";
import { t } from "../i18n.js";

/* ---------- Screen Wake Lock ---------- */
let wakeLock = null, wantLock = false;
async function acquireLock() {
  wantLock = true;
  if (!("wakeLock" in navigator) || wakeLock || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) { console.info("Wake Lock:", e.name); wakeLock = null; } // отказ — не критично
}
function releaseLock() { wantLock = false; if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wantLock) acquireLock(); });

/* ---------- Сборка тренировки ---------- */
const fmtSet = (s, unit) => `${fmtNum(s.weight ?? 0)} ${unitLabel(unit)} × ${s.reps ?? "?"}`;

function parseTargetRange(targetReps) {
  const s = String(targetReps || "").trim();
  const mRange = s.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (mRange) return { min: Number(mRange[1]), max: Number(mRange[2]) };
  const mSingle = s.match(/(\d+)/);
  if (mSingle) {
    const max = Number(mSingle[1]);
    return { min: Math.max(1, max - 2), max };
  }
  return { min: 8, max: 10 };
}

/** Создаёт запись упражнения с предзаполнением из прошлых тренировок и подсказкой прогрессии. */
export function buildEntry(ex, programId, order, item = {}) {
  const lv = lastValues(programId, ex);
  const n = Math.max(1, item.sets || ex.defaultSets || 3);
  const sets = Array.from({ length: n }, (_, k) => {
    const src = lv.sets[k] || lv.sets[lv.sets.length - 1];
    let hint = "", weight = null, reps = null, hintWeight = null, hintReps = null;
    if (src) {
      weight = src.weight ?? null;
      hintWeight = src.weight ?? null;
      hintReps = src.reps ?? null;
      const txt = fmtSet(src, ex.unit);
      if (lv.source === "program") { reps = src.reps ?? null; hint = t("workout.hintPrev", { txt }); }
      else if (lv.source === "other") { hint = t("workout.hintOther", { prog: lv.fromProgram, txt }); } // только вес — повторы по тапу на подсказку или вручную
      else { reps = src.reps ?? null; hint = t("workout.hintStart", { txt }); }
    }
    return { reps, weight, rpe: null, done: false, isWarmup: false, completedAt: null, hint, hintWeight, hintReps };
  });

  // Двойная прогрессия: если в прошлой тренировке этой программы все рабочие сеты закрыты по верхней границе
  let progression = null;
  const { min: minTarget, max: maxTarget } = parseTargetRange(item.targetReps);
  if (lv.source === "program" && lv.sets.length >= n && lv.sets.every(s => (s.weight ?? 0) > 0 && (s.reps ?? 0) >= maxTarget)) {
    const step = stepFor(ex.unit);
    const baseW = lv.sets[0].weight;
    progression = {
      nextWeight: Math.round((baseW + step) * 100) / 100,
      step,
      resetReps: minTarget,
      maxTarget
    };
  }

  return {
    _key: uid(),
    exerciseId: ex.id, exerciseName: ex.name, unit: ex.unit, isBodyweight: !!ex.isBodyweight,
    order, note: "", trackRpe: !!ex.trackRpe,
    restSec: item.restSec ?? ex.defaultRestSec ?? state.settings.restSec,
    targetReps: item.targetReps || "", programNote: item.note || "",
    progression, skipped: false, sets
  };
}

export function startSession(program) {
  const entries = [];
  (program ? program.items : []).forEach(it => {
    const ex = getExercise(it.exerciseId);
    if (ex) entries.push(buildEntry(ex, program.id, entries.length, it));
  });
  return saveSession({
    id: uid(), programId: program ? program.id : null, programName: program ? program.name : t("workout.freeWorkout"),
    bodyweightKg: state.settings.bodyweightKg || null,
    startedAt: Date.now(), finishedAt: null, durationMin: null, status: "active", entries
  });
}

function hasProgramChanged(session, program) {
  if (!program || !session) return false;
  const activeEntries = (session.entries || []).filter(e => !e.skipped);
  if (activeEntries.length !== (program.items || []).length) return true;
  for (let i = 0; i < activeEntries.length; i++) {
    const e = activeEntries[i], it = program.items[i];
    if (e.exerciseId !== it.exerciseId) return true;
    const workSets = (e.sets || []).filter(s => !s.isWarmup).length || 1;
    if (workSets !== (it.sets || 3)) return true;
  }
  return false;
}

/* ---------- Итоговая сводка ---------- */
export function showSummary(session) {
  const stats = sessionStats(session);
  const done = doneSessions(session.programId).sort(byStart);
  const base = pickBaseline(done, getProgram(session.programId)?.baselineSessionId);
  const li = base ? loadIndex(session, base) : null;
  const prev = done.filter(s => s.id !== session.id && s.startedAt < session.startedAt).pop();
  const cmp = compareWithPrevious(session, prev);

  // Проверяем рекорды относительно всех тренировок до этой
  const priorDone = doneSessions().filter(s => s.id !== session.id && s.startedAt < session.startedAt);
  const priorPrs = personalRecords(priorDone);
  const prItems = [];
  for (const e of session.entries || []) {
    const basePr = priorPrs.get(e.exerciseId);
    if (!basePr) continue;
    let bestW = null, bestE1 = null;
    for (const s of e.sets || []) {
      const pr = checkSetPR(s, e.unit, basePr);
      if (pr) {
        if (pr.beatW && (bestW === null || pr.wKg > bestW)) bestW = pr.wKg;
        if (pr.beatE1 && (bestE1 === null || pr.e1 > bestE1)) bestE1 = pr.e1;
      }
    }
    if (bestW !== null || bestE1 !== null) {
      const u = unitLabel(e.unit);
      const parts = [];
      if (bestW !== null) parts.push(t("workout.prWeight", { val: formatNum(fromKg(bestW, e.unit), 1), u }));
      if (bestE1 !== null) parts.push(`e1RM ${formatNum(fromKg(bestE1, e.unit), 1)} ${u}`);
      prItems.push({ name: e.exerciseName, text: parts.join(" · ") });
    }
  }

  const program = getProgram(session.programId);
  const canSyncProgram = hasProgramChanged(session, program);
  const syncProgramBlock = canSyncProgram ? (() => {
    const btn = h("button", {
      class: "btn block", type: "button",
      onclick: () => {
        const newItems = (session.entries || []).filter(e => !e.skipped).map(e => {
          const prevIt = (program.items || []).find(x => x.exerciseId === e.exerciseId) || {};
          const workSets = Math.max(1, (e.sets || []).filter(s => !s.isWarmup).length);
          return {
            exerciseId: e.exerciseId,
            sets: workSets,
            targetReps: e.targetReps || prevIt.targetReps || "8-10",
            restSec: e.restSec ?? prevIt.restSec ?? null,
            note: e.programNote || prevIt.note || ""
          };
        });
        saveProgram({ ...program, items: newItems });
        btn.disabled = true;
        btn.textContent = t("workout.templateUpdatedBtn");
        toast(t("workout.templateUpdatedToast"));
      }
    }, t("workout.updateTemplateBtn"));
    return h("div", { class: "panel" },
      h("small", { class: "muted" }, t("workout.templateDiffNote", { name: program.name })),
      btn);
  })() : null;

  const sMuscles = new Map();
  for (const e of session.entries || []) {
    const workSets = (e.sets || []).filter(s => s.done && !s.isWarmup && s.reps > 0).length;
    if (!workSets) continue;
    const ex = getExercise(e.exerciseId);
    const mg = (ex?.muscleGroup || t("common.other")).trim();
    if (!sMuscles.has(mg)) sMuscles.set(mg, { muscle: mg, sets: 0, exercises: new Set() });
    const rec = sMuscles.get(mg);
    rec.sets += workSets;
    rec.exercises.add(e.exerciseName || ex?.name || "");
  }
  const mapItems = [...sMuscles.values()].map(x => ({ ...x, exercises: [...x.exercises] }));

  const kg = unitLabel("kg");
  const cell = (label, val, sub = "") => h("div", { class: "stat" }, h("small", { class: "muted" }, label), h("strong", {}, val), sub ? h("small", { class: "muted" }, sub) : null);
  const sign = n => (n > 0 ? "+" : "") + formatNum(n, 1);
  const sh = sheet(h("div", { class: "stack" },
    h("div", { class: "stats" },
      cell(t("workout.sumVolume"), `${formatNum(stats.volume, 0)} ${kg}`),
      cell(t("workout.sumBestE1rm"), stats.bestE1rm ? `${formatNum(stats.bestE1rm, 1)} ${kg}` : "—"),
      cell(t("workout.sumLoadIndex"), li ? formatNum(li.li, 1) : "—", base && base.id === session.id ? t("workout.sumBaselineSub") : ""),
      cell(t("workout.sumVsPrev"), cmp === null ? "—" : sign(cmp) + "%", t("workout.sumVsPrevSub")),
      cell(t("workout.sumTime"), `${session.durationMin ?? "—"} ${t("workout.minUnit")}`)),
    mapItems.length ? h("div", { class: "panel" },
      h("h3", { class: "group" }, t("workout.musclesWorked")),
      renderBodyMap(mapItems, { compact: true })) : null,
    prItems.length ? h("div", { class: "panel" },
      h("h3", { class: "group" }, t("workout.newPRs")),
      ...prItems.map(p => h("div", { class: "row gap" }, h("span", { class: "pr-badge" }, "PR"), h("strong", { class: "grow" }, p.name), h("small", { class: "muted" }, p.text)))
    ) : null,
    syncProgramBlock,
    h("button", { class: "btn primary block", type: "button", onclick: () => sh.close() }, t("common.done"))), { title: t("workout.finishedTitle") });
}

/* ---------- Подсказка следующего подхода для таймера ---------- */
function buildNextLabel(session, curEntry) {
  let workIdx = 0;
  const wSym = warmupSymbol();
  for (const s of curEntry.sets || []) {
    if (!s.isWarmup) workIdx++;
    if (!s.done) {
      const w = s.weight != null ? `${fmtNum(s.weight)} ${unitLabel(curEntry.unit)}` : "";
      const r = s.reps != null ? `× ${s.reps}` : "";
      const detail = [w, r].filter(Boolean).join(" ");
      return t("workout.nextSet", { idx: s.isWarmup ? wSym : workIdx, detail: detail ? ` · ${detail}` : "" });
    }
  }
  const idx = session.entries.indexOf(curEntry);
  for (let j = idx + 1; j < session.entries.length; j++) {
    const next = session.entries[j];
    if (!next.skipped && next.sets.some(s => !s.done)) {
      return t("workout.nextEx", { name: next.exerciseName });
    }
  }
  return t("workout.allSetsDone");
}

/* ---------- Вид ---------- */
export function mount(root) {
  let mode = "home";
  let session = null;
  let clockTimer = null, entriesBox, clockEl, progFillEl, progTextEl, priorPrs = new Map();
  const view = h("div", { class: "stack" });
  root.append(view);

  const updateProgress = () => {
    if (!session || !progFillEl || !progTextEl) return;
    let total = 0, done = 0;
    for (const e of session.entries || []) {
      if (e.skipped) continue;
      for (const s of e.sets || []) {
        total++;
        if (s.done) done++;
      }
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progFillEl.style.width = pct + "%";
    progTextEl.textContent = t("workout.progressSets", { done, total, pct });
  };

  const persist = debounce(() => { if (session) { saveSession(session, { silent: true }); updateProgress(); } }, 350);
  const persistNow = () => { persist.flush(); if (session) { saveSession(session, { silent: true }); updateProgress(); } };
  const onHide = () => { if (mode === "active") persistNow(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);

  const LS_HOME_PROG = "fitness.home.programId";
  const FREE_ID = "__free__";

  function shortProgTitle(name = "") {
    const clean = String(name).split(/[—–]/)[0].trim();
    return clean.length > 26 ? clean.slice(0, 25) + "…" : (clean || name);
  }

  function home() {
    mode = "home"; session = null; releaseLock(); clearInterval(clockTimer);
    clear(view);
    const act = activeSession();
    const programs = state.programs.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name));

    let selectedId = localStorage.getItem(LS_HOME_PROG);
    if (selectedId !== FREE_ID && !programs.some(p => p.id === selectedId)) {
      selectedId = programs[0]?.id || FREE_ID;
    }

    const getSelectedProg = () => (selectedId === FREE_ID ? null : programs.find(p => p.id === selectedId) || null);

    // 1. Пилюли выбора программы (создаются один раз, не пересоздаются при клике)
    const pillBtns = new Map();
    const pillsWrap = h("div", { class: "home-pills" });
    for (const p of programs) {
      const b = h("button", {
        type: "button",
        class: "btn tag home-pill" + (selectedId === p.id ? " on" : ""),
        onclick: () => selectProg(p.id)
      }, shortProgTitle(p.name));
      pillBtns.set(p.id, b);
      pillsWrap.append(b);
    }
    const freeBtn = h("button", {
      type: "button",
      class: "btn tag home-pill" + (selectedId === FREE_ID ? " on" : ""),
      onclick: () => selectProg(FREE_ID)
    }, t("workout.freeWorkout"));
    pillBtns.set(FREE_ID, freeBtn);
    pillsWrap.append(freeBtn);

    // 2. Блок мета-информации фиксированной высоты (никогда не меняет высоту карточки)
    const selTitleEl = h("strong", { class: "home-sel-title" });
    const selSubEl = h("small", { class: "muted home-sel-sub" });
    const selMetaBox = h("div", { class: "home-sel-meta" }, selTitleEl, selSubEl);

    // 3. Центральная круглая кнопка-шайба (создаётся один раз — координаты и высота 100% стабильны)
    const orbSubEl = h("small", { class: "home-orb-sub" });
    let orbBtnEl, orbRingEl;
    const heroBox = h("div", { class: "home-hero" });

    if (act) {
      let actTotal = 0, actDone = 0;
      for (const e of act.entries || []) {
        if (e.skipped) continue;
        for (const s of e.sets || []) { actTotal++; if (s.done) actDone++; }
      }
      orbSubEl.textContent = t("workout.activeOrbSub", { done: actDone, total: actTotal, date: fmtDate(act.startedAt) });
      orbBtnEl = h("button", { class: "home-orb", type: "button", onclick: () => open(act) },
        icon("play", 28),
        h("span", { class: "home-orb-label" }, t("workout.resumeCaps")),
        h("small", { class: "home-orb-sub" }, shortProgTitle(act.programName)),
        orbSubEl);
      orbRingEl = h("div", { class: "home-orb-ring active-ring" }, orbBtnEl);
      heroBox.append(
        orbRingEl,
        h("button", {
          class: "btn small", type: "button",
          onclick: async () => {
            if (await confirmDialog(t("workout.deleteActiveConfirm"), { ok: t("common.delete"), danger: true })) {
              stopRest(); deleteSession(act.id); toast(t("workout.deletedToast")); home();
            }
          }
        }, icon("trash", 15), t("workout.deleteActiveBtn"))
      );
    } else {
      orbBtnEl = h("button", {
        class: "home-orb", type: "button",
        onclick: () => open(startSession(getSelectedProg()))
      },
        icon("play", 30),
        h("span", { class: "home-orb-label" }, t("workout.startCaps")),
        orbSubEl);
      orbRingEl = h("div", { class: "home-orb-ring" }, orbBtnEl);
      heroBox.append(orbRingEl);
    }

    // 4. Нижняя карточка превью мышц и упражнений
    const previewTitleEl = h("h3", { class: "group", style: "margin:0" });
    const previewCountEl = h("small", { class: "muted" });
    const previewBody = h("div", { class: "home-preview-body" });
    const previewBox = h("section", { class: "panel home-preview" },
      h("div", { class: "panel-head" }, previewTitleEl, previewCountEl),
      previewBody);

    function updateHomeContent(animateSwitch = false) {
      for (const [id, b] of pillBtns) b.classList.toggle("on", id === selectedId);

      const prog = getSelectedProg();
      const totalSets = prog ? (prog.items || []).reduce((n, it) => n + (Number(it.sets) || 3), 0) : 0;
      const last = prog ? doneSessions(prog.id).sort(byStart).pop() : null;

      if (prog) {
        selTitleEl.textContent = prog.name;
        const baseMeta = t("workout.progMeta", { exCount: prog.items.length, setsCount: totalSets });
        selSubEl.textContent = baseMeta + (last ? t("workout.progMetaLast", { date: fmtDate(last.startedAt) }) : t("workout.progMetaNever"));
      } else {
        selTitleEl.textContent = t("workout.freeWorkout");
        selSubEl.textContent = t("workout.freeMetaSub");
      }

      if (!act) {
        orbSubEl.textContent = prog ? t("workout.progMeta", { exCount: prog.items.length, setsCount: totalSets }) : t("workout.noTemplate");
      }

      if (animateSwitch) {
        selMetaBox.classList.remove("swap-anim");
        orbBtnEl.classList.remove("orb-switch");
        previewBody.classList.remove("swap-anim");
        void orbBtnEl.offsetWidth;
        selMetaBox.classList.add("swap-anim");
        orbBtnEl.classList.add("orb-switch");
        previewBody.classList.add("swap-anim");
      }

      clear(previewBody);
      const byMuscle = new Map();
      const exChips = [];
      if (prog) {
        (prog.items || []).forEach((it, idx) => {
          const ex = getExercise(it.exerciseId);
          if (!ex) return;
          const setsCnt = Number(it.sets) || 3;
          const mg = (ex.muscleGroup || t("common.other")).trim();
          if (!byMuscle.has(mg)) byMuscle.set(mg, { muscle: mg, sets: 0, exercises: [] });
          const rec = byMuscle.get(mg);
          rec.sets += setsCnt;
          rec.exercises.push(ex.name);
          exChips.push(h("div", { class: "home-ex-chip", style: `--i:${idx}` },
            h("span", { class: "home-ex-num" }, String(idx + 1)),
            h("span", { class: "grow home-ex-name" }, ex.name),
            h("small", { class: "muted home-ex-sets" }, `${setsCnt}×${it.targetReps || "8-10"}`)));
        });
      }

      previewTitleEl.textContent = prog ? t("workout.previewTitleProg") : t("workout.previewTitleFree");
      previewCountEl.textContent = t("workout.previewMuscleCount", { n: prog ? byMuscle.size : 0 });

      previewBody.append(
        renderBodyMap([...byMuscle.values()], { compact: true }),
        prog && exChips.length
          ? h("div", { class: "home-ex-list" }, ...exChips)
          : h("p", { class: "muted small home-free-note" }, t("workout.freePreviewNote"))
      );
    }

    const selectProg = id => {
      if (id === selectedId) return;
      selectedId = id;
      localStorage.setItem(LS_HOME_PROG, id);
      updateHomeContent(true);
    };

    updateHomeContent(false);

    view.append(
      h("section", { class: "panel home-selector-card" },
        h("span", { class: "group", style: "margin:0" }, t("workout.selectWorkout")),
        pillsWrap,
        selMetaBox),
      heroBox,
      previewBox
    );
  }

  function open(s) {
    mode = "active"; session = s; acquireLock();
    session.entries.forEach(e => (e._key = e._key || uid()));
    priorPrs = personalRecords(doneSessions().filter(x => x.id !== session.id && x.startedAt < session.startedAt));
    clear(view);
    clockEl = h("span", { class: "active-clock" });
    progTextEl = h("span", { class: "muted" });
    progFillEl = h("div", { class: "workout-prog-fill" });
    const tick = () => (clockEl.textContent = fmtRest((Date.now() - session.startedAt) / 1000));
    tick(); clockTimer = setInterval(tick, 1000);
    entriesBox = h("div", { class: "stack" });
    enableDragSort(entriesBox, keys => {
      session.entries = keys.map(k => session.entries.find(e => e._key === k)).filter(Boolean);
      reindex(); persistNow(); paintEntries();
    });
    view.append(
      h("div", { class: "active-top" },
        h("div", { class: "active-row1" },
          h("h2", { class: "section grow" }, session.programName),
          h("button", { class: "btn icon", type: "button", title: t("workout.deleteWorkoutTitle"), "aria-label": t("workout.deleteWorkoutTitle"), onclick: cancel }, icon("trash", 18))),
        h("div", { class: "active-row2" },
          h("div", { class: "active-meta" }, clockEl, h("span", { class: "muted" }, "·"), progTextEl),
          h("button", { class: "btn small primary", type: "button", onclick: finish }, t("workout.finishShort"))),
        h("div", { class: "workout-prog" }, progFillEl)),
      entriesBox,
      h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => {
        session.entries.push({ ...buildEntry(ex, session.programId, session.entries.length), extra: true }); persistNow(); paintEntries();
      }, { multi: true }) }, t("workout.addExerciseBtn")),
      h("button", { class: "btn primary block", type: "button", onclick: finish }, t("workout.finishFull")));
    paintEntries();
    updateProgress();
  }

  const reindex = () => session.entries.forEach((e, i) => (e.order = i));

  function paintEntries() {
    clear(entriesBox);
    session.entries.forEach((entry, i) => {
      entry._key = entry._key || uid();
      entriesBox.append(entryCard(entry, {
        index: i, count: session.entries.length, key: entry._key, reorder: session.entries.length > 1,
        prBaseline: priorPrs.get(entry.exerciseId) || null,
        onChange: () => { persist(); updateProgress(); },
        rerender: () => { paintEntries(); updateProgress(); },
        onSetDone: (e, set, pr) => {
          updateProgress();
          if (pr) toast(t("workout.newPrToast", { name: e.exerciseName }));
          if (!set.isWarmup) startRest(e.restSec ?? state.settings.restSec, buildNextLabel(session, e));
        },
        onMove: d => { const j = i + d; if (j < 0 || j >= session.entries.length) return; [session.entries[i], session.entries[j]] = [session.entries[j], session.entries[i]]; reindex(); persistNow(); paintEntries(); },
        onSwap: () => pickExercise(ex => {
          const workCount = Math.max(1, (entry.sets || []).filter(s => !s.isWarmup).length);
          const replaced = buildEntry(ex, session.programId, i, { sets: workCount, targetReps: entry.targetReps });
          session.entries[i] = replaced;
          reindex(); persistNow(); paintEntries();
          toast(t("workout.swappedToast", { name: ex.name }));
        }, {
          exclude: [entry.exerciseId],
          inSessionIds: session.entries.map(x => x.exerciseId),
          preferMuscle: getExercise(entry.exerciseId)?.muscleGroup || "",
          title: t("workout.swapTitle")
        }),
        onSkip: () => { entry.skipped = true; persistNow(); paintEntries(); },
        onRemove: entry.extra ? () => { session.entries.splice(i, 1); reindex(); persistNow(); paintEntries(); } : null
      }));
    });
  }

  async function cancel() {
    if (!(await confirmDialog(t("workout.cancelConfirm"), { ok: t("workout.deleteWorkoutTitle"), cancel: t("common.back"), danger: true }))) return;
    const id = session.id; stopRest(); persist.flush();
    session = null; deleteSession(id); home();
  }

  async function finish() {
    const doneCount = session.entries.reduce((n, e) => n + (e.skipped ? 0 : e.sets.filter(s => s.done).length), 0);
    if (!doneCount && !(await confirmDialog(t("workout.finishEmptyConfirm"), { ok: t("workout.finishShort") }))) return;
    persist.flush();
    const now = Date.now();
    session.entries = session.entries.filter(e => !e.skipped || e.sets.some(s => s.done)).map(({ _key, _expanded, progression, ...rest }) => rest);
    session.bodyweightKg = session.bodyweightKg ?? state.settings.bodyweightKg ?? null;
    session.finishedAt = now; session.status = "done";
    session.durationMin = Math.max(1, Math.round((now - session.startedAt) / 60000));
    const saved = saveSession(session);
    stopRest(); home(); showSummary(saved);
  }

  // Если перешли с вкладки «Программы» по кнопке «Начать» (или переключили язык во время активной тренировки)
  const actOnMount = activeSession();
  if (actOnMount && sessionStorage.getItem("fitness.openActive") === "1") {
    sessionStorage.removeItem("fitness.openActive");
    open(actOnMount);
  } else {
    home();
  }

  return {
    update() { if (mode === "home") home(); }, // во время тренировки не перерисовываем (не сбиваем ввод)
    destroy(opts = {}) {
      clearInterval(clockTimer); releaseLock();
      if (mode === "active") {
        persistNow();
        if (opts && opts.preserveMode) sessionStorage.setItem("fitness.openActive", "1");
      }
      document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide);
    }
  };
}
