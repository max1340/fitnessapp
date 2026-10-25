// Хранилище состояния в памяти поверх Firebase Realtime Database + локального офлайн-кэша.
import { watchCollection, saveDoc, removeDoc, bulkSave, bulkRemove } from "./db.js";

const COLLECTIONS = ["exercises", "programs", "sessions", "meta"];
const LS_SETTINGS = "fitness.settings.v1";
const LS_BW = "fitness.bodyweight.v1";

const toArray = v => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

function normalizeDoc(coll, d) {
  if (!d || typeof d !== "object") return d;
  if (coll === "exercises") {
    return {
      archived: false,
      note: "",
      isBodyweight: Boolean(d.isBodyweight || d.id === "seed-pullups"),
      ...d,
      startReps: toArray(d.startReps)
    };
  }
  if (coll === "programs") {
    return {
      archived: false,
      ...d,
      items: toArray(d.items).map(it => ({ sets: 3, targetReps: "", note: "", ...it }))
    };
  }
  if (coll === "sessions") {
    return {
      ...d,
      entries: toArray(d.entries).map(e => ({
        note: "",
        ...e,
        sets: toArray(e.sets).map(s => ({ reps: null, weight: null, rpe: null, done: false, isWarmup: false, ...s }))
      }))
    };
  }
  return d;
}

export const DEFAULT_SETTINGS = {
  defaultUnit: "kg",
  stepKg: 2.5,
  stepLb: 5,
  restSec: 210,
  bodyweightKg: null,
  sound: true,
  vibration: true,
  notifications: true,
  theme: "dark" // dark | light | system
};

export const state = {
  exercises: [], programs: [], sessions: [],
  bodyweightLog: loadLocalBodyweight(),
  loaded: { exercises: false, programs: false, sessions: false, meta: false },
  settings: loadLocalSettings(),
  sync: { fromCache: false, pending: false, error: null }
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

function loadLocalSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

function loadLocalBodyweight() {
  try { return toArray(JSON.parse(localStorage.getItem(LS_BW) || "[]")); }
  catch { return []; }
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/** Запуск подписок. Возвращает промис, выполняющийся после первой загрузки всех коллекций. */
export function init(onProgress) {
  return new Promise(resolve => {
    const serverLoaded = { exercises: false, programs: false, sessions: false, meta: false };
    let metaHasInit = false;
    let autoSeeded = false;
    let resolved = false;
    const labels = {
      exercises: "Упражнения загружены…",
      programs: "Программы загружены…",
      sessions: "История синхронизирована…",
      meta: "Настройки применены…"
    };

    const check = lastLoaded => {
      const doneCount = Object.values(state.loaded).filter(Boolean).length;
      if (onProgress) onProgress(doneCount / COLLECTIONS.length, labels[lastLoaded] || "Синхронизация…");
      if (!resolved && doneCount === COLLECTIONS.length) {
        resolved = true;
        resolve();
      }
      if (!autoSeeded && Object.values(serverLoaded).every(Boolean)) {
        autoSeeded = true;
        if (!metaHasInit && !state.exercises.length && !state.programs.length && !state.sessions.length) {
          seedStarterData();
          saveDoc("meta", { id: "init", createdAt: Date.now(), catalogVersion: 2 }).catch(console.error);
          saveDoc("meta", { id: "settings", ...state.settings }).catch(console.error);
        } else if (state.exercises.length <= 8) {
          seedExtraExercises();
        }
      }
    };

    for (const name of COLLECTIONS) {
      watchCollection(name, (docs, fromCache, pending) => {
        if (name === "meta") {
          metaHasInit = docs.some(d => d.id === "init" || d.id === "settings");
          const s = docs.find(d => d.id === "settings");
          if (s) {
            const { id, ...rest } = s;
            state.settings = { ...DEFAULT_SETTINGS, ...rest };
            localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
          }
          const bw = docs.find(d => d.id === "bodyweight");
          if (bw) {
            state.bodyweightLog = toArray(bw.items).filter(x => x && x.weight > 0).sort((a, b) => a.t - b.t);
            localStorage.setItem(LS_BW, JSON.stringify(state.bodyweightLog));
          }
        } else {
          state[name] = docs.map(d => normalizeDoc(name, d));
        }
        state.loaded[name] = true;
        if (!fromCache) serverLoaded[name] = true;
        state.sync = { fromCache, pending, error: null };
        check(name); emit();
      }, err => {
        console.error("Firebase RTDB:", err);
        state.sync = { ...state.sync, error: err.code || String(err) };
        state.loaded[name] = true; check(name); emit();
      });
    }
    // не блокируем интерфейс навсегда, если снапшот не пришёл (например, нет сети и кэш пуст)
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 2500);
  });
}

/* ---------- Настройки и собственный вес тела ---------- */
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
  saveDoc("meta", { id: "settings", ...state.settings }).catch(console.error);
  emit();
}

export function logBodyweight(weightKg) {
  const w = Math.round(Number(weightKg) * 10) / 10;
  if (!(w > 0)) return;
  const now = Date.now();
  const dayStr = t => new Date(t).toDateString();
  const today = dayStr(now);
  const log = [...state.bodyweightLog];
  const idx = log.findIndex(x => dayStr(x.t) === today);
  if (idx >= 0) log[idx] = { t: now, weight: w };
  else log.push({ t: now, weight: w });
  log.sort((a, b) => a.t - b.t);
  state.bodyweightLog = log;
  localStorage.setItem(LS_BW, JSON.stringify(log));
  saveDoc("meta", { id: "bodyweight", items: log }).catch(console.error);
  updateSettings({ bodyweightKg: w });
}

/* ---------- Универсальные операции ---------- */
function upsert(coll, obj) {
  const list = state[coll];
  const i = list.findIndex(x => x.id === obj.id);
  if (i >= 0) list[i] = obj; else list.push(obj);
  saveDoc(coll, obj).catch(e => console.error("save", coll, e));
  emit();
  return obj;
}
function remove(coll, id) {
  state[coll] = state[coll].filter(x => x.id !== id);
  removeDoc(coll, id).catch(e => console.error("remove", coll, e));
  emit();
}

export const getExercise = id => state.exercises.find(e => e.id === id);
export const getProgram = id => state.programs.find(p => p.id === id);
export const getSession = id => state.sessions.find(s => s.id === id);

export function saveExercise(ex) {
  return upsert("exercises", { archived: false, ...ex, id: ex.id || uid() });
}
export function saveProgram(p) {
  return upsert("programs", { archived: false, ...p, id: p.id || uid() });
}
export function saveSession(s, { silent = false } = {}) {
  const obj = { ...s, id: s.id || uid() };
  if (silent) { // без emit: чтобы активная тренировка не перерисовывалась при вводе
    const i = state.sessions.findIndex(x => x.id === obj.id);
    if (i >= 0) state.sessions[i] = obj; else state.sessions.push(obj);
    saveDoc("sessions", obj).catch(e => console.error("save session", e));
    return obj;
  }
  return upsert("sessions", obj);
}
export const deleteSession = id => remove("sessions", id);
export const deleteProgram = id => remove("programs", id);
export const deleteExercise = id => remove("exercises", id);

export const isExerciseUsed = id =>
  state.sessions.some(s => (s.entries || []).some(e => e.exerciseId === id));

export const activeSession = () =>
  state.sessions.filter(s => s.status === "active").sort((a, b) => b.startedAt - a.startedAt)[0] || null;

export const doneSessions = programId =>
  state.sessions.filter(s => s.status === "done" && (!programId || s.programId === programId));

/* ---------- Перенос веса ---------- */
const workingDone = s => s.done && !s.isWarmup && s.reps > 0;

/** Последнее выполненное упражнение в программе (или в любой другой при programId=null/exclude). */
function lastEntry(exerciseId, predicate) {
  const list = state.sessions.filter(s => s.status === "done" && predicate(s)).sort((a, b) => b.startedAt - a.startedAt);
  for (const s of list) {
    const e = (s.entries || []).find(x => x.exerciseId === exerciseId && (x.sets || []).some(workingDone));
    if (e) return { session: s, sets: e.sets.filter(workingDone) };
  }
  return null;
}

/**
 * Предзаполнение для упражнения в программе.
 * Возвращает { sets: [{weight, reps}], source: 'program'|'other'|'start'|null, fromProgram }
 */
export function lastValues(programId, ex) {
  const same = lastEntry(ex.id, s => s.programId === programId);
  if (same) return { sets: same.sets, source: "program" };
  const other = lastEntry(ex.id, s => s.programId !== programId);
  if (other) return { sets: other.sets, source: "other", fromProgram: other.session.programName };
  if (ex.startWeight != null || (ex.startReps && ex.startReps.length)) {
    const n = Math.max((ex.startReps || []).length, 1);
    return { sets: Array.from({ length: n }, (_, i) => ({ weight: ex.startWeight ?? null, reps: (ex.startReps || [])[i] ?? null })), source: "start" };
  }
  return { sets: [], source: null };
}

/* ---------- Стартовые данные и библиотека упражнений ---------- */
const REST_DEFAULT = 210;
const mkEx = (id, name, muscleGroup, startWeight = null, startReps = [], extra = {}) => ({
  id, name, muscleGroup, unit: "kg", defaultSets: 3, defaultRestSec: REST_DEFAULT, trackRpe: false, note: "",
  startWeight, startReps, isBodyweight: false, archived: false, ...extra
});

export const EXTRA_LIBRARY_EXERCISES = [
  // Спина
  mkEx("ex-lat-pulldown", "Тяга верхнего блока к груди", "Спина"),
  mkEx("ex-seated-row", "Тяга горизонтального блока", "Спина"),
  mkEx("ex-bb-row", "Тяга штанги в наклоне", "Спина"),
  mkEx("ex-db-row", "Тяга гантели одной рукой", "Спина"),
  mkEx("ex-pullover", "Пулловер в кроссовере", "Спина"),
  // Грудь
  mkEx("ex-bench-press", "Жим штанги лёжа", "Грудь"),
  mkEx("ex-incline-db", "Жим гантелей на наклонной (30°)", "Грудь"),
  mkEx("ex-chest-press", "Жим в тренажёре (Хаммер)", "Грудь"),
  mkEx("ex-cable-fly", "Сведение рук в кроссовере / Бабочка", "Грудь"),
  mkEx("ex-dips", "Отжимания на брусьях", "Грудь", null, [], { isBodyweight: true }),
  // Бицепс
  mkEx("ex-bb-curl", "Подъём EZ-штанги на бицепс", "Бицепс"),
  mkEx("ex-hammer-curl", "Молотки с гантелями", "Бицепс"),
  mkEx("ex-preacher-curl", "Бицепс на скамье Скотта", "Бицепс"),
  mkEx("ex-cable-curl", "Сгибания на бицепс в блоке", "Бицепс"),
  // Трицепс
  mkEx("ex-skullcrusher", "Французский жим с EZ-штангой", "Трицепс"),
  mkEx("ex-rope-pushdown", "Разгибания с канатом в блоке", "Трицепс (Lateral)"),
  mkEx("ex-db-overhead-tri", "Французский жим гантели из-за головы", "Трицепс (Long)"),
  // Дельты
  mkEx("ex-db-lat-raise", "Махи гантелями в стороны", "Средняя дельта"),
  mkEx("ex-ohp-db", "Жим гантелей сидя", "Дельты"),
  mkEx("ex-rear-delt", "Обратная бабочка / Задняя дельта", "Задняя дельта"),
  // Ноги и Пресс
  mkEx("ex-squat", "Приседания со штангой", "Ноги"),
  mkEx("ex-leg-press", "Жим ногами в тренажёре", "Ноги"),
  mkEx("ex-rdl", "Румынская тяга", "Ноги"),
  mkEx("ex-leg-ext", "Разгибания ног сидя", "Ноги"),
  mkEx("ex-leg-curl", "Сгибания ног лёжа", "Ноги"),
  mkEx("ex-cable-crunch", "Скручивания на пресс в блоке", "Пресс")
];

export function seedExtraExercises() {
  const items = [];
  for (const e of EXTRA_LIBRARY_EXERCISES) {
    if (!getExercise(e.id)) {
      items.push(["exercises", e]);
      state.exercises.push(e);
    }
  }
  if (items.length) {
    bulkSave(items).catch(console.error);
    emit();
  }
  return items.length;
}

export function seedStarterData() {
  const REST = REST_DEFAULT;
  const exs = [
    mkEx("seed-pullups", "Подтягивания", "Спина", 15, [8, 7, 8], { note: "Доп. вес", isBodyweight: true }),
    mkEx("seed-tbar", "Т-гриф широким хватом", "Спина", 62.5, [9, 8, 9]),
    mkEx("seed-dbpress", "Жим гантелей", "Грудь", 32, [7, 6, 5]),
    mkEx("seed-biceps", "Гантели", "Бицепс", 20, [7, 7, 5]),
    mkEx("seed-tri-long", "Cable Overhead Extension", "Трицепс (Long)", 20, [], { note: "Рабочий вес 20–25 кг" }),
    mkEx("seed-tri-lat", "Cable Lateral Head (разгибания)", "Трицепс (Lateral)", 72.5, []),
    mkEx("seed-delts", "Кабель", "Средняя дельта", 15, [], { unit: "lb" })
  ];
  const program = {
    id: "seed-fullbody", name: "FULLBODY — классические сеты", archived: false,
    items: exs.map(e => ({ exerciseId: e.id, sets: 3, targetReps: "8-10", restSec: REST, note: "" }))
  };
  // не перезаписываем то, что пользователь уже мог отредактировать
  const items = [];
  for (const e of [...exs, ...EXTRA_LIBRARY_EXERCISES]) {
    if (!getExercise(e.id)) { items.push(["exercises", e]); state.exercises.push(e); }
  }
  if (!getProgram(program.id)) { items.push(["programs", program]); state.programs.push(program); }
  if (items.length) bulkSave(items).catch(console.error);
  emit();
  return items.length;
}

/* ---------- Экспорт / импорт ---------- */
export function exportData() {
  return JSON.stringify({
    app: "fitness-tracker", version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, bodyweightLog: state.bodyweightLog,
    exercises: state.exercises, programs: state.programs, sessions: state.sessions
  }, null, 2);
}

/** Экспорт всех завершённых тренировок в CSV (с BOM и разделителем `;` для Excel / Google Sheets). */
export function exportCsv() {
  const esc = v => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const numStr = v => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));
  const rows = [[
    "Дата", "Время", "Программа", "Длительность (мин)", "Свой вес (кг)",
    "№", "Мышца", "Упражнение", "Сет №", "Тип сета", "Вес", "Ед.", "Повторы", "RPE", "Заметка"
  ].join(";")];

  const done = [...state.sessions].filter(s => s.status === "done").sort((a, b) => b.startedAt - a.startedAt);
  for (const s of done) {
    const d = new Date(s.startedAt);
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const bw = s.bodyweightKg ?? state.settings.bodyweightKg ?? "";
    (s.entries || []).forEach((e, eIdx) => {
      const ex = getExercise(e.exerciseId);
      const muscle = ex?.muscleGroup || e.muscleGroup || "";
      let workIdx = 0;
      (e.sets || []).forEach(set => {
        if (!set.done) return;
        if (!set.isWarmup) workIdx++;
        rows.push([
          esc(dateStr),
          esc(timeStr),
          esc(s.programName || ""),
          esc(s.durationMin ?? ""),
          esc(numStr(bw)),
          esc(eIdx + 1),
          esc(muscle),
          esc(e.exerciseName || ""),
          esc(set.isWarmup ? "Р" : workIdx),
          esc(set.isWarmup ? "Разминочный" : "Рабочий"),
          esc(numStr(set.weight ?? 0)),
          esc(unitLabel(e.unit)),
          esc(set.reps ?? ""),
          esc(numStr(set.rpe ?? "")),
          esc(e.note || "")
        ].join(";"));
      });
    });
  }
  return "\uFEFF" + rows.join("\r\n");
}

export function downloadCsv() {
  const blob = new Blob([exportCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fitness-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importData(json) {
  const data = JSON.parse(json);
  if (data.app !== "fitness-tracker") throw new Error("Это не файл резервной копии приложения");
  const items = [];
  for (const name of ["exercises", "programs", "sessions"]) {
    for (const obj of data[name] || []) {
      if (!obj.id) continue;
      items.push([name, obj]);
      const list = state[name], i = list.findIndex(x => x.id === obj.id);
      if (i >= 0) list[i] = obj; else list.push(obj);
    }
  }
  bulkSave(items).catch(console.error);
  if (data.settings) updateSettings(data.settings);
  emit();
  return items.length;
}

/** Удаление всех данных приложения (только своей ветки). */
export function wipeAll() {
  const items = [];
  for (const name of ["exercises", "programs", "sessions"]) { for (const o of state[name]) items.push([name, o.id]); state[name] = []; }
  bulkRemove(items);
  emit();
}

export const unitLabel = u => (u === "lb" ? "lb" : "кг");
export function stepFor(unit) { return unit === "lb" ? Number(state.settings.stepLb) || 5 : Number(state.settings.stepKg) || 2.5; }
