import { h, clear, sheet, confirmDialog, toast, fmtDate, fmtNum, fmtRest, icon, debounce, enableDragSort, haptic } from "../ui.js";
import { state, getExercise, getProgram, saveProgram, saveSession, deleteSession, activeSession, doneSessions, lastValues, stepFor, uid, unitLabel, warmupSymbol } from "../store.js";
import { sessionStats, loadIndex, pickBaseline, compareWithPrevious, personalRecords, formatNum, fromKg, byStart } from "../metrics.js";
import { entryCard, checkSetPR } from "./entryCard.js";
import { pickExercise } from "./exercises.js";
import { startRest, stopRest, pauseRest, resumeRest } from "../timer.js";
import { renderBodyMap, ZONES, mapMuscleToZones } from "../bodyMap.js";
import { t, tMuscle } from "../i18n.js";

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

/* ---------- Генератор карточки «Итог тренировки» (Share Card на Canvas) ---------- */
const BODY_OUTLINE_PATH = [
  "M -7,38 L -28,43 C -38,45 -43,55 -41,66",
  "C -45,76 -45,88 -42,95 C -47,105 -49,117 -46,127 L -38,127",
  "C -34,115 -32,101 -29,81 L -24,71 L -18,115",
  "C -27,131 -28,155 -23,175 C -24,193 -24,211 -19,227 L -11,227",
  "C -8,209 -7,191 -9,175 C -5,157 -3,139 -2,124",
  "L 2,124 C 3,139 5,157 9,175 C 7,191 8,209 11,227 L 19,227",
  "C 24,211 24,193 23,175 C 28,155 27,131 18,115",
  "L 24,71 L 29,81 C 32,101 34,115 38,127 L 46,127",
  "C 49,117 47,105 42,95 C 45,88 45,76 41,66",
  "C 43,55 38,45 28,43 L 7,38"
].join(" ");

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function fitText(ctx, text, maxW) {
  let s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function renderShareCanvas(canvas, session, meta, theme = "dark") {
  const { stats, li, cmp, prItems = [], mapItems = [] } = meta;
  const pal = theme === "light"
    ? { bg: "#f6f6f7", s1: "#ffffff", s2: "#ececee", line: "#d6d6da", fg: "#0b0b0c", mut: "#6b6b72" }
    : { bg: "#0b0b0c", s1: "#151517", s2: "#1f1f22", line: "#2a2a2e", fg: "#f2f2f3", mut: "#8b8b92" };

  const prNames = new Set(prItems.map(p => p.name));
  const exRows = [];
  let totalWorkSets = 0;
  for (const e of session.entries || []) {
    if (e.skipped) continue;
    const work = (e.sets || []).filter(s => s.done && !s.isWarmup && s.reps > 0);
    if (!work.length) continue;
    totalWorkSets += work.length;
    let bestSet = work[0];
    for (const s of work) {
      if ((s.weight ?? 0) > (bestSet.weight ?? 0) || ((s.weight ?? 0) === (bestSet.weight ?? 0) && (s.reps ?? 0) > (bestSet.reps ?? 0))) {
        bestSet = s;
      }
    }
    const u = unitLabel(e.unit);
    const bestTxt = (bestSet.weight ?? 0) > 0
      ? `${t("workout.shareSetsOnly", { n: work.length })} · ${t("workout.shareBestSet", { w: fmtNum(bestSet.weight), u, r: bestSet.reps })}`
      : `${t("workout.shareSetsOnly", { n: work.length })} × ${bestSet.reps}`;
    exRows.push({
      name: getExercise(e.exerciseId)?.name || e.exerciseName,
      detail: bestTxt,
      hasPr: prNames.has(e.exerciseName) || prNames.has(getExercise(e.exerciseId)?.name)
    });
  }
  const shownEx = exRows.slice(0, 7);

  const W = 720;
  const pad = 28;
  const innerW = W - pad * 2;
  const exBoxH = shownEx.length ? (52 + shownEx.length * 44 + 12) : 0;
  const H = 132 + 104 + 16 + 266 + (exBoxH ? 16 + exBoxH : 0) + 52;
  const scale = 2;

  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const font = (weight, size) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  // 1. Фон и внешняя рамка
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 2;
  rrect(ctx, 10, 10, W - 20, H - 20, 22);
  ctx.stroke();

  // 2. Шапка: эмблема, дата, заголовок программы
  ctx.fillStyle = pal.fg;
  rrect(ctx, pad, 28, 42, 42, 11);
  ctx.fill();
  ctx.strokeStyle = pal.bg;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.save();
  ctx.translate(pad + 9, 37);
  ctx.stroke(new Path2D("M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"));
  ctx.restore();

  ctx.fillStyle = pal.mut;
  ctx.font = font(700, 12);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(t("app.splashTitle") + (state.user?.displayName ? ` · ${state.user.displayName}` : ""), pad + 54, 45);
  ctx.font = font(500, 13);
  ctx.fillText(fmtDate(session.startedAt, true), pad + 54, 64);

  ctx.fillStyle = pal.fg;
  ctx.font = font(800, 26);
  ctx.fillText(fitText(ctx, session.programName || t("workout.freeWorkout"), innerW), pad, 108);

  // 3. Сетка из 4 карточек ключевых метрик
  const statY = 128;
  const statGap = 10;
  const statW = (innerW - statGap * 3) / 4;
  const statH = 92;
  const kg = unitLabel("kg");
  const sign = n => (n > 0 ? "+" : "") + formatNum(n, 1);
  const fourthLabel = li ? t("workout.sumLoadIndex") : t("workout.sumBestE1rm");
  const fourthVal = li ? formatNum(li.li, 1) : (stats.bestE1rm ? `${formatNum(stats.bestE1rm, 1)} ${kg}` : "—");
  const fourthSub = cmp !== null ? `${sign(cmp)}%` : "";

  const statCards = [
    { label: t("workout.sumVolume"), val: `${formatNum(stats.volume, 0)} ${kg}`, sub: "" },
    { label: t("workout.sumTime"), val: `${session.durationMin ?? "—"} ${t("workout.minUnit")}`, sub: "" },
    { label: t("workout.shareWorkSets"), val: String(totalWorkSets), sub: prItems.length ? `${prItems.length} PR` : "" },
    { label: fourthLabel, val: fourthVal, sub: fourthSub }
  ];

  statCards.forEach((sc, i) => {
    const x = pad + i * (statW + statGap);
    ctx.fillStyle = pal.s1;
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1.5;
    rrect(ctx, x, statY, statW, statH, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pal.mut;
    ctx.font = font(600, 12);
    ctx.fillText(fitText(ctx, sc.label, statW - 24), x + 14, statY + 26);

    ctx.fillStyle = pal.fg;
    ctx.font = font(800, 22);
    ctx.fillText(fitText(ctx, sc.val, statW - 24), x + 14, statY + 58);

    if (sc.sub) {
      ctx.fillStyle = pal.mut;
      ctx.font = font(700, 12);
      ctx.fillText(sc.sub, x + 14, statY + 78);
    }
  });

  // 4. Панель: Анатомический силуэт (Спереди + Сзади) и распределение по мышцам
  const mapY = statY + statH + 16;
  const mapH = 266;
  ctx.fillStyle = pal.s1;
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1.5;
  rrect(ctx, pad, mapY, innerW, mapH, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = pal.mut;
  ctx.font = font(700, 12);
  ctx.fillText(t("workout.musclesWorked").toUpperCase(), pad + 18, mapY + 26);

  const zoneStats = new Map();
  let maxZoneSets = 0;
  for (const item of mapItems) {
    const sets = Number(item.sets) || 0;
    if (sets <= 0) continue;
    for (const zid of mapMuscleToZones(item.muscle)) {
      const prev = zoneStats.get(zid) || 0;
      const next = prev + sets;
      zoneStats.set(zid, next);
      if (next > maxZoneSets) maxZoneSets = next;
    }
  }

  const drawFigure = (side, cx, cy, sc, labelText) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);

    // Голова и контур тела
    ctx.fillStyle = pal.s2;
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 18, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.stroke(new Path2D("M -6,28 L -7,38 M 6,28 L 7,38"));
    const bodyP = new Path2D(BODY_OUTLINE_PATH);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fill(bodyP);
    ctx.restore();
    ctx.stroke(bodyP);

    for (const z of ZONES.filter(x => x.side === side)) {
      const sets = zoneStats.get(z.id) || 0;
      const ratio = maxZoneSets > 0 && sets > 0 ? sets / maxZoneSets : 0;
      ctx.save();
      if (sets === 0) {
        ctx.fillStyle = pal.s1;
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = pal.fg;
        ctx.globalAlpha = Math.max(0.35, Math.min(1.0, 0.35 + ratio * 0.65));
        ctx.strokeStyle = pal.fg;
        ctx.lineWidth = 1.2;
      }
      for (const d of z.paths) {
        const p = new Path2D(d);
        ctx.fill(p);
        ctx.globalAlpha = 1;
        ctx.stroke(p);
        if (sets > 0) ctx.globalAlpha = Math.max(0.35, Math.min(1.0, 0.35 + ratio * 0.65));
      }
      ctx.restore();
    }
    ctx.restore();

    ctx.fillStyle = pal.mut;
    ctx.font = font(700, 10);
    ctx.textAlign = "center";
    ctx.fillText(labelText, cx, cy + 242 * sc);
    ctx.textAlign = "left";
  };

  drawFigure("front", pad + 92, mapY + 36, 0.86, t("bodyMap.front"));
  drawFigure("back", pad + 228, mapY + 36, 0.86, t("bodyMap.back"));

  // Правая колонка внутри панели мышц — полоски мышечных групп
  const sortedMuscles = [...mapItems].sort((a, b) => b.sets - a.sets).slice(0, 6);
  const maxMuscleSets = sortedMuscles[0]?.sets || 1;
  const barX = pad + 324;
  const barW = innerW - 344;
  sortedMuscles.forEach((m, idx) => {
    const ry = mapY + 48 + idx * 34;
    const mName = tMuscle(m.muscle);
    ctx.fillStyle = pal.fg;
    ctx.font = font(700, 13);
    ctx.fillText(fitText(ctx, mName, barW - 60), barX, ry);

    const cntTxt = t("workout.shareSetsOnly", { n: m.sets });
    ctx.fillStyle = pal.mut;
    ctx.font = font(600, 12);
    ctx.textAlign = "right";
    ctx.fillText(cntTxt, barX + barW, ry);
    ctx.textAlign = "left";

    // Полоска
    ctx.fillStyle = pal.s2;
    rrect(ctx, barX, ry + 6, barW, 7, 4);
    ctx.fill();
    ctx.fillStyle = pal.fg;
    rrect(ctx, barX, ry + 6, Math.max(10, (m.sets / maxMuscleSets) * barW), 7, 4);
    ctx.fill();
  });

  // 5. Список упражнений
  if (shownEx.length) {
    const exY = mapY + mapH + 16;
    ctx.fillStyle = pal.s1;
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1.5;
    rrect(ctx, pad, exY, innerW, exBoxH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pal.mut;
    ctx.font = font(700, 12);
    ctx.fillText(t("workout.shareExercises").toUpperCase(), pad + 18, exY + 28);

    shownEx.forEach((row, idx) => {
      const ry = exY + 46 + idx * 44;
      ctx.fillStyle = pal.s2;
      rrect(ctx, pad + 14, ry, innerW - 28, 36, 9);
      ctx.fill();

      // Номер
      ctx.fillStyle = pal.mut;
      ctx.font = font(700, 12);
      ctx.fillText(String(idx + 1) + ".", pad + 26, ry + 23);

      // Значения справа
      ctx.fillStyle = pal.mut;
      ctx.font = font(600, 13);
      ctx.textAlign = "right";
      ctx.fillText(row.detail, pad + innerW - 26, ry + 23);
      const detailW = ctx.measureText(row.detail).width;
      ctx.textAlign = "left";

      let prOffset = 0;
      if (row.hasPr) {
        prOffset = 34;
        const bx = pad + innerW - 26 - detailW - 36;
        ctx.fillStyle = pal.fg;
        rrect(ctx, bx, ry + 9, 28, 18, 5);
        ctx.fill();
        ctx.fillStyle = pal.bg;
        ctx.font = font(800, 10);
        ctx.textAlign = "center";
        ctx.fillText("PR", bx + 14, ry + 22);
        ctx.textAlign = "left";
      }

      ctx.fillStyle = pal.fg;
      ctx.font = font(700, 14);
      ctx.fillText(fitText(ctx, row.name, innerW - 95 - detailW - prOffset), pad + 48, ry + 23);
    });
  }

  // 6. Подвал
  ctx.fillStyle = pal.mut;
  ctx.font = font(600, 12);
  ctx.textAlign = "center";
  ctx.fillText(t("app.name").toUpperCase(), W / 2, H - 22);
  ctx.textAlign = "left";
}

export function openShareCard(session, meta) {
  let cardTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const canvas = h("canvas", { class: "share-canvas" });

  const darkBtn = h("button", {
    type: "button",
    class: "btn small tag" + (cardTheme === "dark" ? " on" : ""),
    onclick: () => { cardTheme = "dark"; syncThemeBtns(); renderShareCanvas(canvas, session, meta, cardTheme); }
  }, t("workout.shareThemeDark"));
  const lightBtn = h("button", {
    type: "button",
    class: "btn small tag" + (cardTheme === "light" ? " on" : ""),
    onclick: () => { cardTheme = "light"; syncThemeBtns(); renderShareCanvas(canvas, session, meta, cardTheme); }
  }, t("workout.shareThemeLight"));

  const syncThemeBtns = () => {
    darkBtn.classList.toggle("on", cardTheme === "dark");
    lightBtn.classList.toggle("on", cardTheme === "light");
  };

  renderShareCanvas(canvas, session, meta, cardTheme);

  const toBlob = () => new Promise(res => canvas.toBlob(res, "image/png"));
  const fileName = () => `workout-${new Date(session.startedAt).toISOString().slice(0, 10)}.png`;

  const downloadPng = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: fileName() });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    haptic("success");
    toast(t("workout.shareDownloaded"));
  };

  const sharePng = async () => {
    const blob = await toBlob();
    if (!blob) return;
    const file = new File([blob], fileName(), { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: session.programName || t("app.name") });
        haptic("success");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        haptic("success");
        toast(t("workout.shareCopied"));
        return;
      } catch { /* fallback to download */ }
    }
    await downloadPng();
  };

  sheet(h("div", { class: "stack" },
    h("div", { class: "row gap", style: "justify-content:center" }, darkBtn, lightBtn),
    h("div", { class: "share-canvas-wrap" }, canvas),
    h("div", { class: "row gap" },
      h("button", { class: "btn grow", type: "button", onclick: downloadPng }, icon("download", 18), t("workout.shareDownload")),
      h("button", { class: "btn primary grow", type: "button", onclick: sharePng }, icon("share", 18), t("workout.shareAction"))
    )
  ), { title: t("workout.shareTitle"), full: true });
}

/* ---------- Итоговая сводка и прямой шаринг ---------- */
export function computeSummaryMeta(session) {
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

  return { stats, base, li, cmp, prItems, mapItems };
}

export function openSessionShare(session) {
  const meta = computeSummaryMeta(session);
  openShareCard(session, meta);
}

export function showSummary(session) {
  const { stats, base, li, cmp, prItems, mapItems } = computeSummaryMeta(session);

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
        haptic("success");
        btn.disabled = true;
        btn.textContent = t("workout.templateUpdatedBtn");
        toast(t("workout.templateUpdatedToast"));
      }
    }, t("workout.updateTemplateBtn"));
    return h("div", { class: "panel" },
      h("small", { class: "muted" }, t("workout.templateDiffNote", { name: program.name })),
      btn);
  })() : null;

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
    h("div", { class: "row gap" },
      h("button", {
        class: "btn grow", type: "button",
        onclick: () => openShareCard(session, { stats, li, cmp, prItems, mapItems })
      }, icon("share", 18), t("workout.shareBtn")),
      h("button", { class: "btn primary grow", type: "button", onclick: () => sh.close() }, t("common.done"))
    )), { title: t("workout.finishedTitle") });
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

    // 1. Современное выпадающее меню (Dropdown) выбора тренировки
    const selTitleEl = h("strong", { class: "home-sel-title" });
    const selSubEl = h("small", { class: "muted home-sel-sub" });
    const ddWrap = h("div", { class: "home-dd collapsed" });

    const toggleDd = forceState => {
      const nextCollapsed = typeof forceState === "boolean" ? !forceState : !ddWrap.classList.contains("collapsed");
      ddWrap.classList.toggle("collapsed", nextCollapsed);
      ddTrigger.setAttribute("aria-expanded", String(!nextCollapsed));
    };

    const ddTrigger = h("button", {
      type: "button",
      class: "home-dd-trigger",
      "aria-expanded": "false",
      onclick: () => toggleDd()
    },
      h("span", { class: "home-dd-ico" }, icon("dumbbell", 20)),
      h("span", { class: "home-dd-text" }, selTitleEl, selSubEl),
      h("span", { class: "fold-chevron home-dd-chev" }, icon("up", 18))
    );

    const ddItemsMap = new Map();
    const ddList = h("div", { class: "home-dd-list" });

    for (const p of programs) {
      const pSets = (p.items || []).reduce((n, it) => n + (Number(it.sets) || 3), 0);
      const pLast = doneSessions(p.id).sort(byStart).pop();
      const pSub = t("workout.progMeta", { exCount: (p.items || []).length, setsCount: pSets }) +
        (pLast ? t("workout.progMetaLast", { date: fmtDate(pLast.startedAt) }) : t("workout.progMetaNever"));
      const itemBtn = h("button", {
        type: "button",
        class: "home-dd-item" + (selectedId === p.id ? " on" : ""),
        onclick: () => { toggleDd(false); selectProg(p.id); }
      },
        h("span", { class: "home-dd-item-main" },
          h("strong", { class: "home-dd-item-title" }, p.name),
          h("small", { class: "muted home-dd-item-sub" }, pSub)),
        h("span", { class: "home-dd-check" }, icon("check", 16))
      );
      ddItemsMap.set(p.id, itemBtn);
      ddList.append(itemBtn);
    }

    if (programs.length) ddList.append(h("div", { class: "home-dd-divider" }));

    const freeItemBtn = h("button", {
      type: "button",
      class: "home-dd-item" + (selectedId === FREE_ID ? " on" : ""),
      onclick: () => { toggleDd(false); selectProg(FREE_ID); }
    },
      h("span", { class: "home-dd-item-main" },
        h("strong", { class: "home-dd-item-title" }, t("workout.freeWorkout")),
        h("small", { class: "muted home-dd-item-sub" }, t("workout.freeMetaSub"))),
      h("span", { class: "home-dd-check" }, icon("check", 16))
    );
    ddItemsMap.set(FREE_ID, freeItemBtn);
    ddList.append(freeItemBtn);

    ddWrap.append(
      ddTrigger,
      h("div", { class: "fold-body home-dd-body" },
        h("div", { class: "fold-inner" }, ddList))
    );

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
      orbBtnEl = h("button", {
        class: "home-orb", type: "button",
        onclick: () => { haptic("medium"); open(act); }
      },
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
        onclick: () => { haptic("medium"); open(startSession(getSelectedProg())); }
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
      for (const [id, b] of ddItemsMap) b.classList.toggle("on", id === selectedId);

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
        ddTrigger.classList.remove("swap-anim");
        orbBtnEl.classList.remove("orb-switch");
        previewBody.classList.remove("swap-anim");
        void orbBtnEl.offsetWidth;
        ddTrigger.classList.add("swap-anim");
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
        h("div", { class: "row gap", style: "justify-content:space-between" },
          h("span", { class: "stg-sec-title", style: "padding:0" }, t("workout.selectWorkout")),
          h("span", { class: "ex-group-badge" }, t("workout.programsCountBadge", { n: programs.length }))),
        ddWrap),
      heroBox,
      previewBox
    );
  }

  function elapsedSec(s, now = Date.now()) {
    if (!s) return 0;
    const pausedMs = (Number(s.pausedTotalMs) || 0) + (s.pausedAt ? Math.max(0, now - s.pausedAt) : 0);
    return Math.max(0, (now - s.startedAt - pausedMs) / 1000);
  }

  function open(s) {
    mode = "active"; session = s;
    if (!session.pausedAt) acquireLock();
    session.entries.forEach(e => (e._key = e._key || uid()));
    priorPrs = personalRecords(doneSessions().filter(x => x.id !== session.id && x.startedAt < session.startedAt));
    clear(view);
    clockEl = h("span", { class: "active-clock" });
    const pausedBadge = h("span", { class: "paused-badge", hidden: !session.pausedAt }, t("workout.pausedBadge"));
    progTextEl = h("span", { class: "muted" });
    progFillEl = h("div", { class: "workout-prog-fill" });
    const tick = () => (clockEl.textContent = fmtRest(elapsedSec(session)));
    tick(); clockTimer = setInterval(tick, 1000);
    entriesBox = h("div", { class: "stack" });
    enableDragSort(entriesBox, keys => {
      session.entries = keys.map(k => session.entries.find(e => e._key === k)).filter(Boolean);
      reindex(); persistNow(); paintEntries();
    });

    const pauseBtn = h("button", { class: "btn small pause-btn", type: "button", onclick: togglePause });
    function syncPauseUI() {
      const isP = !!session.pausedAt;
      pausedBadge.hidden = !isP;
      clockEl.classList.toggle("is-paused", isP);
      pauseBtn.classList.toggle("is-paused", isP);
      pauseBtn.replaceChildren(icon(isP ? "play" : "pause", 14), isP ? t("workout.resumeBtn") : t("workout.pauseBtn"));
    }
    function togglePause() {
      haptic("medium");
      if (session.pausedAt) {
        session.pausedTotalMs = (Number(session.pausedTotalMs) || 0) + Math.max(0, Date.now() - session.pausedAt);
        session.pausedAt = null;
        resumeRest();
        acquireLock();
      } else {
        session.pausedAt = Date.now();
        pauseRest();
        releaseLock();
      }
      tick(); syncPauseUI(); persistNow();
    }
    syncPauseUI();

    view.append(
      h("div", { class: "active-top" },
        h("div", { class: "active-row1" },
          h("h2", { class: "section grow" }, session.programName),
          h("button", { class: "btn icon", type: "button", title: t("workout.deleteWorkoutTitle"), "aria-label": t("workout.deleteWorkoutTitle"), onclick: cancel }, icon("trash", 18))),
        h("div", { class: "active-row2" },
          h("div", { class: "active-meta" }, clockEl, pausedBadge, h("span", { class: "muted" }, "·"), progTextEl),
          h("div", { class: "row gap" },
            pauseBtn,
            h("button", { class: "btn small primary", type: "button", onclick: finish }, t("workout.finishShort")))),
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
          if (session.pausedAt) {
            session.pausedTotalMs = (Number(session.pausedTotalMs) || 0) + Math.max(0, Date.now() - session.pausedAt);
            session.pausedAt = null;
            acquireLock();
            const pBadge = view.querySelector(".paused-badge");
            if (pBadge) pBadge.hidden = true;
            const pBtn = view.querySelector(".pause-btn");
            if (pBtn) {
              pBtn.classList.remove("is-paused");
              pBtn.replaceChildren(icon("pause", 14), t("workout.pauseBtn"));
            }
            if (clockEl) clockEl.classList.remove("is-paused");
          }
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
    const totalSec = elapsedSec(session, now);
    delete session.pausedAt;
    delete session.pausedTotalMs;
    session.entries = session.entries.filter(e => !e.skipped || e.sets.some(s => s.done)).map(({ _key, _expanded, progression, ...rest }) => rest);
    session.bodyweightKg = session.bodyweightKg ?? state.settings.bodyweightKg ?? null;
    session.finishedAt = now; session.status = "done";
    session.durationMin = Math.max(1, Math.round(totalSec / 60));
    const saved = saveSession(session);
    haptic("success");
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
