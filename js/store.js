// Хранилище состояния в памяти поверх Firestore. Данные приходят через onSnapshot,
// записи применяются локально сразу (офлайн-кэш Firestore) и досинхронизируются позже.
import { watchCollection, saveDoc, removeDoc, bulkSave, bulkRemove } from "./db.js";

const COLLECTIONS = ["exercises", "programs", "sessions", "meta"];
const LS_SETTINGS = "fitness.settings.v1";

export const DEFAULT_SETTINGS = {
  defaultUnit: "kg",
  stepKg: 2.5,
  stepLb: 5,
  restSec: 210,
  sound: true,
  vibration: true,
  notifications: true,
  theme: "dark" // dark | light | system
};

export const state = {
  exercises: [], programs: [], sessions: [],
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

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/** Запуск подписок. Возвращает промис, выполняющийся после первой загрузки всех коллекций. */
export function init() {
  return new Promise(resolve => {
    const check = () => { if (Object.values(state.loaded).every(Boolean)) resolve(); };
    for (const name of COLLECTIONS) {
      watchCollection(name, (docs, fromCache, pending) => {
        if (name === "meta") {
          const s = docs.find(d => d.id === "settings");
          if (s) { const { id, ...rest } = s; state.settings = { ...DEFAULT_SETTINGS, ...rest }; localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }
        } else state[name] = docs;
        state.loaded[name] = true;
        state.sync = { fromCache, pending, error: null };
        check(); emit();
      }, err => {
        console.error("Firestore:", err);
        state.sync = { ...state.sync, error: err.code || String(err) };
        state.loaded[name] = true; check(); emit();
      });
    }
    // не блокируем интерфейс навсегда, если снапшот не пришёл (например, нет сети и кэш пуст)
    setTimeout(resolve, 2500);
  });
}

/* ---------- Настройки ---------- */
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
  saveDoc("meta", { id: "settings", ...state.settings }).catch(console.error);
  emit();
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

/* ---------- Стартовые данные (раздел 7) ---------- */
export function seedStarterData() {
  const REST = 210;
  const mk = (id, name, muscleGroup, startWeight, startReps, extra = {}) => ({
    id, name, muscleGroup, unit: "kg", defaultSets: 3, defaultRestSec: REST, trackRpe: false, note: "",
    startWeight, startReps, archived: false, ...extra
  });
  const exs = [
    mk("seed-pullups", "Подтягивания", "Спина", 15, [8, 7, 8], { note: "Доп. вес" }),
    mk("seed-tbar", "Т-гриф широким хватом", "Спина", 62.5, [9, 8, 9]),
    mk("seed-dbpress", "Жим гантелей", "Грудь", 32, [7, 6, 5]),
    mk("seed-biceps", "Гантели", "Бицепс", 20, [7, 7, 5]),
    mk("seed-tri-long", "Cable Overhead Extension", "Трицепс (Long)", 20, [], { note: "Рабочий вес 20–25 кг" }),
    mk("seed-tri-lat", "Cable Lateral Head (разгибания)", "Трицепс (Lateral)", 72.5, []),
    mk("seed-delts", "Кабель", "Средняя дельта", 15, [], { unit: "lb" })
  ];
  const program = {
    id: "seed-fullbody", name: "FULLBODY — классические сеты", archived: false,
    items: exs.map(e => ({ exerciseId: e.id, sets: 3, targetReps: "", restSec: REST, note: "" }))
  };
  // не перезаписываем то, что пользователь уже мог отредактировать
  const items = [];
  for (const e of exs) if (!getExercise(e.id)) { items.push(["exercises", e]); state.exercises.push(e); }
  if (!getProgram(program.id)) { items.push(["programs", program]); state.programs.push(program); }
  if (items.length) bulkSave(items).catch(console.error);
  emit();
  return items.length;
}

/* ---------- Экспорт / импорт ---------- */
export function exportData() {
  return JSON.stringify({
    app: "fitness-tracker", version: 1, exportedAt: new Date().toISOString(),
    settings: state.settings, exercises: state.exercises, programs: state.programs, sessions: state.sessions
  }, null, 2);
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
