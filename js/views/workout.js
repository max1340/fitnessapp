import { h, clear, sheet, confirmDialog, toast, fmtDate, fmtNum, fmtRest, icon, debounce } from "../ui.js";
import { state, getExercise, getProgram, saveSession, deleteSession, activeSession, doneSessions, lastValues, uid, unitLabel } from "../store.js";
import { sessionStats, loadIndex, pickBaseline, compareWithPrevious, formatNum, fromKg, byStart } from "../metrics.js";
import { entryCard } from "./entryCard.js";
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

/** Создаёт запись упражнения с предзаполнением из прошлых тренировок. */
export function buildEntry(ex, programId, order, item = {}) {
  const lv = lastValues(programId, ex);
  const n = Math.max(1, item.sets || ex.defaultSets || 3);
  const sets = Array.from({ length: n }, (_, k) => {
    const src = lv.sets[k] || lv.sets[lv.sets.length - 1];
    let hint = "", weight = null, reps = null;
    if (src) {
      weight = src.weight ?? null;
      const txt = fmtSet(src, ex.unit);
      if (lv.source === "program") { reps = src.reps ?? null; hint = `прошлый раз: ${txt}`; }
      else if (lv.source === "other") { hint = `из «${lv.fromProgram}»: ${txt}`; } // только вес — повторы вводим сами
      else { reps = src.reps ?? null; hint = `стартовое: ${txt}`; }
    }
    return { reps, weight, rpe: null, done: false, isWarmup: false, completedAt: null, hint };
  });
  return {
    exerciseId: ex.id, exerciseName: ex.name, unit: ex.unit, order, note: "", trackRpe: !!ex.trackRpe,
    restSec: item.restSec ?? ex.defaultRestSec ?? state.settings.restSec,
    targetReps: item.targetReps || "", programNote: item.note || "", skipped: false, sets
  };
}

function startSession(program) {
  const entries = [];
  (program ? program.items : []).forEach(it => {
    const ex = getExercise(it.exerciseId);
    if (ex) entries.push(buildEntry(ex, program.id, entries.length, it));
  });
  return saveSession({
    id: uid(), programId: program ? program.id : null, programName: program ? program.name : "Свободная тренировка",
    startedAt: Date.now(), finishedAt: null, durationMin: null, status: "active", entries
  });
}

/* ---------- Итоговая сводка ---------- */
export function showSummary(session) {
  const stats = sessionStats(session);
  const done = doneSessions(session.programId).sort(byStart);
  const base = pickBaseline(done, getProgram(session.programId)?.baselineSessionId);
  const li = base ? loadIndex(session, base) : null;
  const prev = done.filter(s => s.id !== session.id && s.startedAt < session.startedAt).pop();
  const cmp = compareWithPrevious(session, prev);
  const cell = (label, val, sub = "") => h("div", { class: "stat" }, h("small", { class: "muted" }, label), h("strong", {}, val), sub ? h("small", { class: "muted" }, sub) : null);
  const sign = n => (n > 0 ? "+" : "") + formatNum(n, 1);
  const sh = sheet(h("div", { class: "stack" },
    h("div", { class: "stats" },
      cell("Объём", formatNum(stats.volume, 0) + " кг"),
      cell("Лучший e1RM", stats.bestE1rm ? formatNum(stats.bestE1rm, 1) + " кг" : "—"),
      cell("Индекс нагрузки", li ? formatNum(li.li, 1) : "—", base && base.id === session.id ? "это базовая тренировка" : ""),
      cell("К прошлой", cmp === null ? "—" : sign(cmp) + "%", "объём по общим упражнениям"),
      cell("Время", (session.durationMin ?? "—") + " мин")),
    h("button", { class: "btn primary block", type: "button", onclick: () => sh.close() }, "Готово")), { title: "Тренировка завершена" });
}

/* ---------- Вид ---------- */
export function mount(root) {
  let mode = "home";
  let session = null;
  let clockTimer = null, entriesBox, clockEl;
  const view = h("div", { class: "stack" });
  root.append(view);

  const persist = debounce(() => { if (session) saveSession(session, { silent: true }); }, 350);
  const persistNow = () => { persist.flush(); if (session) saveSession(session, { silent: true }); };
  const onHide = () => { if (mode === "active") persistNow(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);

  function home() {
    mode = "home"; session = null; releaseLock(); clearInterval(clockTimer);
    clear(view);
    const act = activeSession();
    if (act) {
      view.append(h("button", { class: "btn primary big block", type: "button", onclick: () => open(act) },
        h("span", {}, "Продолжить тренировку"), h("small", {}, `${act.programName} · начата ${fmtDate(act.startedAt, true)}`)));
    }
    view.append(h("h2", { class: "section" }, "Программы"));
    const programs = state.programs.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (!programs.length) view.append(h("p", { class: "empty" }, "Программ пока нет. Откройте настройки (⚙) и загрузите стартовую программу или создайте свою во вкладке «Программы»."));
    for (const p of programs) {
      const last = doneSessions(p.id).sort(byStart).pop();
      view.append(h("div", { class: "card" },
        h("div", { class: "grow" }, h("strong", {}, p.name), h("small", { class: "muted" }, `${p.items.length} упр.` + (last ? ` · последняя ${fmtDate(last.startedAt)}` : " · ещё не выполнялась"))),
        act ? null : h("button", { class: "btn primary", type: "button", onclick: () => open(startSession(p)) }, icon("play", 18), "Начать")));
    }
    if (act) view.append(h("p", { class: "muted small" }, "Чтобы начать другую тренировку, завершите или отмените текущую."));
    else view.append(h("button", { class: "btn block", type: "button", onclick: () => open(startSession(null)) }, "Свободная тренировка (без программы)"));
  }

  function open(s) {
    mode = "active"; session = s; acquireLock();
    clear(view);
    clockEl = h("small", { class: "muted" });
    const tick = () => (clockEl.textContent = "Идёт " + fmtRest((Date.now() - session.startedAt) / 1000).replace(/^(\d+):(\d\d)$/, (_, m, sec) => `${m} мин ${sec} с`));
    tick(); clockTimer = setInterval(tick, 1000);
    entriesBox = h("div", { class: "stack" });
    view.append(
      h("div", { class: "active-head" },
        h("div", { class: "grow" }, h("h2", { class: "section" }, session.programName), clockEl),
        h("button", { class: "btn small", type: "button", onclick: cancel }, "Отменить")),
      entriesBox,
      h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => {
        session.entries.push({ ...buildEntry(ex, session.programId, session.entries.length), extra: true }); persistNow(); paintEntries();
      }, { multi: true }) }, "+ Добавить упражнение"),
      h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: finish }, "Завершить тренировку")));
    paintEntries();
  }

  const reindex = () => session.entries.forEach((e, i) => (e.order = i));

  function paintEntries() {
    clear(entriesBox);
    session.entries.forEach((entry, i) => {
      entriesBox.append(entryCard(entry, {
        index: i, count: session.entries.length, reorder: session.entries.length > 1,
        onChange: persist, rerender: paintEntries,
        onSetDone: (e, set) => { if (!set.isWarmup) startRest(e.restSec ?? state.settings.restSec, e.exerciseName); },
        onMove: d => { const j = i + d; if (j < 0 || j >= session.entries.length) return;[session.entries[i], session.entries[j]] = [session.entries[j], session.entries[i]]; reindex(); persistNow(); paintEntries(); },
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
    session.entries = session.entries.filter(e => !e.skipped || e.sets.some(s => s.done));
    session.finishedAt = now; session.status = "done";
    session.durationMin = Math.max(1, Math.round((now - session.startedAt) / 60000));
    const saved = saveSession(session);
    stopRest(); home(); showSummary(saved);
  }

  home();
  return {
    update() { if (mode === "home") home(); }, // во время тренировки не перерисовываем (не сбиваем ввод)
    destroy() {
      clearInterval(clockTimer); releaseLock();
      if (mode === "active") persistNow();
      document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide);
    }
  };
}
