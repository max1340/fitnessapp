import { h, clear, sheet, confirmDialog, toast, fmtDate, fmtNum, fmtRest, parseNum, icon, debounce, enableDragSort } from "../ui.js";
import { state, getExercise, getProgram, saveProgram, saveSession, deleteSession, activeSession, doneSessions, lastValues, stepFor, logBodyweight, uid, unitLabel } from "../store.js";
import { sessionStats, loadIndex, pickBaseline, compareWithPrevious, personalRecords, formatNum, fromKg, byStart } from "../metrics.js";
import { entryCard, checkSetPR } from "./entryCard.js";
import { pickExercise } from "./exercises.js";
import { startRest, stopRest } from "../timer.js";

/* ---------- Screen Wake Lock ---------- */
let wakeLock = null, wantLock = false;
async function acquireLock() {
  wantLock = true;
  if (!("wakeLock" in navigator) || wakeLock || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) { console.info("Wake Lock отклонён:", e.name); wakeLock = null; } // отказ — не критично
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
      if (lv.source === "program") { reps = src.reps ?? null; hint = `прошлый раз: ${txt}`; }
      else if (lv.source === "other") { hint = `из «${lv.fromProgram}»: ${txt}`; } // только вес — повторы по тапу на подсказку или вручную
      else { reps = src.reps ?? null; hint = `стартовое: ${txt}`; }
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
    id: uid(), programId: program ? program.id : null, programName: program ? program.name : "Свободная тренировка",
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
      if (bestW !== null) parts.push(`вес ${formatNum(fromKg(bestW, e.unit), 1)} ${u}`);
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
        btn.textContent = "✓ Шаблон программы обновлён";
        toast("Шаблон программы обновлён");
      }
    }, "Обновить шаблон программы");
    return h("div", { class: "panel" },
      h("small", { class: "muted" }, `Состав упражнений или количество сетов отличаются от шаблона «${program.name}».`),
      btn);
  })() : null;

  const cell = (label, val, sub = "") => h("div", { class: "stat" }, h("small", { class: "muted" }, label), h("strong", {}, val), sub ? h("small", { class: "muted" }, sub) : null);
  const sign = n => (n > 0 ? "+" : "") + formatNum(n, 1);
  const sh = sheet(h("div", { class: "stack" },
    h("div", { class: "stats" },
      cell("Объём", formatNum(stats.volume, 0) + " кг"),
      cell("Лучший e1RM", stats.bestE1rm ? formatNum(stats.bestE1rm, 1) + " кг" : "—"),
      cell("Индекс нагрузки", li ? formatNum(li.li, 1) : "—", base && base.id === session.id ? "это базовая тренировка" : ""),
      cell("К прошлой", cmp === null ? "—" : sign(cmp) + "%", "объём по общим упражнениям"),
      cell("Время", (session.durationMin ?? "—") + " мин")),
    prItems.length ? h("div", { class: "panel" },
      h("h3", { class: "group" }, "Новые рекорды (PR)"),
      ...prItems.map(p => h("div", { class: "row gap" }, h("span", { class: "pr-badge" }, "PR"), h("strong", { class: "grow" }, p.name), h("small", { class: "muted" }, p.text)))
    ) : null,
    syncProgramBlock,
    h("button", { class: "btn primary block", type: "button", onclick: () => sh.close() }, "Готово")), { title: "Тренировка завершена" });
}

/* ---------- Подсказка следующего подхода для таймера ---------- */
function buildNextLabel(session, curEntry) {
  let workIdx = 0;
  for (const s of curEntry.sets || []) {
    if (!s.isWarmup) workIdx++;
    if (!s.done) {
      const w = s.weight != null ? `${fmtNum(s.weight)} ${unitLabel(curEntry.unit)}` : "";
      const r = s.reps != null ? `× ${s.reps}` : "";
      const detail = [w, r].filter(Boolean).join(" ");
      return `Далее: сет ${s.isWarmup ? "Р" : workIdx}${detail ? ` · ${detail}` : ""}`;
    }
  }
  const idx = session.entries.indexOf(curEntry);
  for (let j = idx + 1; j < session.entries.length; j++) {
    const next = session.entries[j];
    if (!next.skipped && next.sets.some(s => !s.done)) {
      return `Далее: ${next.exerciseName}`;
    }
  }
  return `Все сеты выполнены`;
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
    progTextEl.textContent = `${done}/${total} сет. (${pct}%)`;
  };

  const persist = debounce(() => { if (session) { saveSession(session, { silent: true }); updateProgress(); } }, 350);
  const persistNow = () => { persist.flush(); if (session) { saveSession(session, { silent: true }); updateProgress(); } };
  const onHide = () => { if (mode === "active") persistNow(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);

  function home() {
    mode = "home"; session = null; releaseLock(); clearInterval(clockTimer);
    clear(view);
    const act = activeSession();
    if (act) {
      view.append(
        h("button", { class: "btn primary big block", type: "button", onclick: () => open(act) },
          h("span", {}, "Продолжить тренировку"), h("small", {}, `${act.programName} · начата ${fmtDate(act.startedAt, true)}`)),
        h("button", {
          class: "btn small block", type: "button",
          onclick: async () => {
            if (await confirmDialog("Удалить незавершённую тренировку? Все введённые данные будут удалены.", { ok: "Удалить", danger: true })) {
              stopRest(); deleteSession(act.id); toast("Тренировка удалена"); home();
            }
          }
        }, icon("trash", 16), "Удалить незавершённую тренировку"));
    }
    view.append(h("h2", { class: "section" }, "Программы"));
    const programs = state.programs.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (!programs.length) view.append(h("p", { class: "empty" }, "Программ пока нет. Откройте настройки (⚙) и загрузите стартовую программу или создайте свою во вкладке «Программы»."));
    for (const p of programs) {
      const last = doneSessions(p.id).sort(byStart).pop();
      view.append(h("div", { class: "card home-prog-card" },
        h("div", { class: "grow" },
          h("strong", {}, p.name),
          h("small", { class: "muted" }, `${p.items.length} упр.` + (last ? ` · последняя ${fmtDate(last.startedAt)}` : " · ещё не выполнялась"))),
        act ? null : h("button", { class: "btn primary small", type: "button", onclick: () => open(startSession(p)) }, icon("play", 16), "Начать")));
    }
    if (act) view.append(h("p", { class: "muted small" }, "Чтобы начать другую тренировку, завершите или отмените текущую."));
    else view.append(h("button", { class: "btn block", type: "button", onclick: () => open(startSession(null)) }, "Свободная тренировка"));
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
          h("button", { class: "btn icon", type: "button", title: "Удалить тренировку", "aria-label": "Удалить тренировку", onclick: cancel }, icon("trash", 18))),
        h("div", { class: "active-row2" },
          h("div", { class: "active-meta" }, clockEl, h("span", { class: "muted" }, "·"), progTextEl),
          h("button", { class: "btn small primary", type: "button", onclick: finish }, "Завершить")),
        h("div", { class: "workout-prog" }, progFillEl)),
      entriesBox,
      h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => {
        session.entries.push({ ...buildEntry(ex, session.programId, session.entries.length), extra: true }); persistNow(); paintEntries();
      }, { multi: true }) }, "+ Добавить упражнение"),
      h("button", { class: "btn primary block", type: "button", onclick: finish }, "Завершить тренировку"));
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
          if (pr) toast(`Новый рекорд (PR): ${e.exerciseName}!`);
          if (!set.isWarmup) startRest(e.restSec ?? state.settings.restSec, buildNextLabel(session, e));
        },
        onMove: d => { const j = i + d; if (j < 0 || j >= session.entries.length) return; [session.entries[i], session.entries[j]] = [session.entries[j], session.entries[i]]; reindex(); persistNow(); paintEntries(); },
        onSwap: () => pickExercise(ex => {
          const workCount = Math.max(1, (entry.sets || []).filter(s => !s.isWarmup).length);
          const replaced = buildEntry(ex, session.programId, i, { sets: workCount, targetReps: entry.targetReps });
          session.entries[i] = replaced;
          reindex(); persistNow(); paintEntries();
          toast("Заменено на: " + ex.name);
        }, {
          exclude: [entry.exerciseId],
          inSessionIds: session.entries.map(x => x.exerciseId),
          preferMuscle: getExercise(entry.exerciseId)?.muscleGroup || "",
          title: "Замена упражнения"
        }),
        onSkip: () => { entry.skipped = true; persistNow(); paintEntries(); },
        onRemove: entry.extra ? () => { session.entries.splice(i, 1); reindex(); persistNow(); paintEntries(); } : null
      }));
    });
  }

  async function cancel() {
    if (!(await confirmDialog("Отменить тренировку? Все введённые данные будут удалены.", { ok: "Удалить тренировку", cancel: "Назад", danger: true }))) return;
    const id = session.id; stopRest(); persist.flush();
    session = null; deleteSession(id); home();
  }

  async function finish() {
    const doneCount = session.entries.reduce((n, e) => n + (e.skipped ? 0 : e.sets.filter(s => s.done).length), 0);
    if (!doneCount && !(await confirmDialog("Нет ни одного выполненного сета. Завершить всё равно?", { ok: "Завершить" }))) return;
    persist.flush();
    const now = Date.now();
    session.entries = session.entries.filter(e => !e.skipped || e.sets.some(s => s.done)).map(({ _key, _expanded, progression, ...rest }) => rest);
    session.bodyweightKg = session.bodyweightKg ?? state.settings.bodyweightKg ?? null;
    session.finishedAt = now; session.status = "done";
    session.durationMin = Math.max(1, Math.round((now - session.startedAt) / 60000));
    const saved = saveSession(session);
    stopRest(); home(); showSummary(saved);
  }

  // Если перешли с вкладки «Программы» по кнопке «Начать» — сразу открываем активную тренировку
  const actOnMount = activeSession();
  if (actOnMount && sessionStorage.getItem("fitness.openActive") === "1") {
    sessionStorage.removeItem("fitness.openActive");
    open(actOnMount);
  } else {
    home();
  }

  return {
    update() { if (mode === "home") home(); }, // во время тренировки не перерисовываем (не сбиваем ввод)
    destroy() {
      clearInterval(clockTimer); releaseLock();
      if (mode === "active") persistNow();
      document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide);
    }
  };
}
