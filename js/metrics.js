// Метрики и индекс нагрузки (Load Index). Чистые функции, без DOM и Firebase.
import { isEn } from "./i18n.js";

/** Веса компонентов LI — единственное место, где они задаются. Сумма = 1. */
export const LI_WEIGHTS = { volume: 0.50, e1rm: 0.35, density: 0.15 };
/** Тренировки длиннее этого числа минут не участвуют в компоненте плотности. */
export const MAX_DURATION_MIN = 180;
/** Сеты с числом повторов больше этого не участвуют в e1RM. */
export const MAX_E1RM_REPS = 12;
export const LB_TO_KG = 0.45359237;

export const toKg = (w, unit) => (unit === "lb" ? w * LB_TO_KG : w);
export const fromKg = (kg, unit) => (unit === "lb" ? kg / LB_TO_KG : kg);

const num = v => (typeof v === "number" && isFinite(v) ? v : null);

/** Сет учитывается: выполнен, не разминочный, есть повторы. */
export const isCounted = s => !!s && s.done === true && !s.isWarmup && num(s.reps) > 0;

/** Формула Эпли с поправкой на RPE (запас повторов = 10 − RPE). */
export function epley(weightKg, reps, rpe) {
  const rpeN = num(rpe);
  const eff = rpeN !== null ? reps + (10 - rpeN) : reps;
  return weightKg * (1 + eff / 30);
}

/** Эффективный рабочий вес подхода в кг (для упражнений со своим весом прибавляется вес тела, если он задан). */
export function effectiveWeightKg(set, entry, bodyweightKg = 0) {
  const added = toKg(num(set && set.weight) ?? 0, entry && entry.unit);
  const bw = entry && entry.isBodyweight ? (num(entry.bodyweightKg) ?? num(bodyweightKg) ?? 0) : 0;
  return Math.max(0, bw + added);
}

/** Объём одного упражнения (кг·повт). */
export function entryVolume(entry, bodyweightKg = 0) {
  let v = 0;
  for (const s of entry.sets || []) {
    if (!isCounted(s)) continue;
    v += effectiveWeightKg(s, entry, bodyweightKg) * s.reps;
  }
  return v;
}

/** Лучший e1RM упражнения в кг или null. */
export function entryE1rm(entry, bodyweightKg = 0) {
  let best = null;
  for (const s of entry.sets || []) {
    if (!isCounted(s) || s.reps > MAX_E1RM_REPS) continue;
    const w = effectiveWeightKg(s, entry, bodyweightKg);
    if (w <= 0) continue;
    const e = epley(w, s.reps, s.rpe);
    if (best === null || e > best) best = e;
  }
  return best;
}

/** Максимальный рабочий вес (кг) или null. */
export function entryTopWeight(entry, bodyweightKg = 0) {
  let best = null;
  for (const s of entry.sets || []) {
    if (!isCounted(s)) continue;
    const w = toKg(num(s.weight) ?? 0, entry.unit);
    const eff = w > 0 ? w : effectiveWeightKg(s, entry, bodyweightKg);
    if (best === null || eff > best) best = eff;
  }
  return best;
}

/** Длительность в минутах, если она известна и разумна; иначе null. */
export function usableDuration(session) {
  const d = num(session && session.durationMin);
  return d !== null && d > 0 && d <= MAX_DURATION_MIN ? d : null;
}

/** Общие метрики тренировки (по всем упражнениям). */
export function sessionStats(session) {
  let volume = 0, bestE1rm = null;
  const bw = num(session && session.bodyweightKg) ?? 0;
  for (const e of session.entries || []) {
    volume += entryVolume(e, bw);
    const e1 = entryE1rm(e, bw);
    if (e1 !== null && (bestE1rm === null || e1 > bestE1rm)) bestE1rm = e1;
  }
  const dur = usableDuration(session);
  return { volume, bestE1rm, durationMin: dur, density: dur ? volume / dur : null };
}

/** Пофасетные метрики по exerciseId. */
export function perExercise(session) {
  const map = new Map();
  const bw = num(session && session.bodyweightKg) ?? 0;
  for (const e of session.entries || []) {
    const prev = map.get(e.exerciseId);
    const v = entryVolume(e, bw), e1 = entryE1rm(e, bw);
    if (!prev) map.set(e.exerciseId, { volume: v, e1rm: e1 });
    else { // одно упражнение дважды в тренировке — суммируем объём, берём лучший e1RM
      prev.volume += v;
      if (e1 !== null && (prev.e1rm === null || e1 > prev.e1rm)) prev.e1rm = e1;
    }
  }
  return map;
}

/**
 * Load Index тренировки относительно baseline.
 * Считается по пересечению упражнений (есть и там, и там, объём > 0 в baseline).
 * Возвращает { li, rV, rE, rD, used, weights } или null, если сравнивать не с чем.
 * Недоступные компоненты исключаются, а их вес перераспределяется на остальные.
 */
export function loadIndex(session, baseline, weights = LI_WEIGHTS) {
  if (!session || !baseline) return null;
  const cur = perExercise(session), base = perExercise(baseline);
  let V = 0, Vb = 0;
  const ratios = [];
  for (const [id, c] of cur) {
    const b = base.get(id);
    if (!b) continue;
    V += c.volume; Vb += b.volume;
    if (c.e1rm !== null && b.e1rm !== null && b.e1rm > 0) ratios.push(c.e1rm / b.e1rm);
  }
  if (Vb <= 0) return null;
  const parts = [{ key: "volume", w: weights.volume, r: V / Vb }];
  if (ratios.length) parts.push({ key: "e1rm", w: weights.e1rm, r: ratios.reduce((a, b) => a + b, 0) / ratios.length });
  const dc = usableDuration(session), db = usableDuration(baseline);
  if (dc && db) {
    const Db = Vb / db;
    if (Db > 0) parts.push({ key: "density", w: weights.density, r: (V / dc) / Db });
  }
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  const li = 100 * parts.reduce((a, p) => a + (p.w / wSum) * p.r, 0);
  const get = k => { const p = parts.find(x => x.key === k); return p ? p.r : null; };
  return { li, rV: get("volume"), rE: get("e1rm"), rD: get("density"), used: parts.map(p => p.key) };
}

/** Сортировка тренировок по дате начала. */
export const byStart = (a, b) => a.startedAt - b.startedAt;

/** Выбор baseline: явно заданный (если есть и завершён) или первая завершённая. */
export function pickBaseline(doneSessions, baselineSessionId) {
  const sorted = [...doneSessions].sort(byStart);
  return sorted.find(s => s.id === baselineSessionId) || sorted[0] || null;
}

/** Серия LI по тренировкам программы: [{session, li, stats}], в хронологическом порядке. */
export function liSeries(doneSessions, baselineSessionId) {
  const sorted = [...doneSessions].sort(byStart);
  const base = pickBaseline(sorted, baselineSessionId);
  if (!base) return [];
  const out = [];
  for (const s of sorted) {
    // до baseline (если он сброшен на более позднюю) не показываем
    if (s.startedAt < base.startedAt) continue;
    const r = loadIndex(s, base);
    if (r) out.push({ session: s, li: r.li, detail: r, stats: sessionStats(s) });
  }
  return out;
}

/** Скользящее среднее по n точкам (по доступным предыдущим в начале ряда). */
export function movingAverage(values, n = 4) {
  return values.map((_, i) => {
    const from = Math.max(0, i - n + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Изменение индекса за N недель относительно последней точки. Возвращает разницу или null. */
export function changeOverWeeks(series, weeks) {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const limit = last.session.startedAt - weeks * 7 * 864e5;
  let ref = null;
  for (const p of series) if (p.session.startedAt <= limit) ref = p;
  if (!ref) ref = series[0];
  if (ref === last) return null;
  return last.li - ref.li;
}

/** Личные рекорды по упражнениям: { exerciseId: {name, unit, weightKg, e1rmKg, weightDate, e1rmDate} } */
export function personalRecords(doneSessions) {
  const prs = new Map();
  for (const s of [...doneSessions].sort(byStart)) {
    const bw = num(s && s.bodyweightKg) ?? 0;
    for (const e of s.entries || []) {
      const w = entryTopWeight(e, bw), e1 = entryE1rm(e, bw);
      if (w === null && e1 === null) continue;
      let pr = prs.get(e.exerciseId);
      if (!pr) { pr = { name: e.exerciseName, unit: e.unit, weightKg: null, e1rmKg: null }; prs.set(e.exerciseId, pr); }
      pr.name = e.exerciseName; pr.unit = e.unit;
      if (w !== null && (pr.weightKg === null || w > pr.weightKg)) { pr.weightKg = w; pr.weightDate = s.startedAt; }
      if (e1 !== null && (pr.e1rmKg === null || e1 > pr.e1rmKg)) { pr.e1rmKg = e1; pr.e1rmDate = s.startedAt; }
    }
  }
  return prs;
}

/** Сравнение с предыдущей тренировкой той же программы: изменение объёма по общим упражнениям, %. */
export function compareWithPrevious(session, previous) {
  if (!previous) return null;
  const cur = perExercise(session), prev = perExercise(previous);
  let V = 0, Vp = 0;
  for (const [id, c] of cur) { const p = prev.get(id); if (p) { V += c.volume; Vp += p.volume; } }
  if (Vp <= 0) return null;
  return (V / Vp - 1) * 100;
}

export function formatNum(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const s = String(Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits));
  return isEn() ? s : s.replace(".", ",");
}
