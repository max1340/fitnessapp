// Хранилище состояния в памяти поверх Firebase Realtime Database + локального офлайн-кэша.
// Аккаунт = пользователь Firebase Auth; все данные и локальные ключи привязаны к uid.
import {
  watchCollection, saveDoc, removeDoc, bulkSave, bulkRemove,
  setSpaceUser, getSpaceUser, watchSharedExercises, lsGetUser, lsSetUser, clearLocalUserData,
  pendingCount, waitForSync, flushOfflineQueue, deleteUserBranch, onQueueChange
} from "./db.js";
import {
  signIn, signUp, signOutUser, reauthenticate, deleteCurrentUser, sendReset, auth
} from "./auth.js";
import { t, detectDefaultLang, setLang, isEn, localizeExercise, localizeProgram, localizeSession, localizeState, tMuscle } from "./i18n.js";

const COLLECTIONS = ["exercises", "programs", "sessions", "meta"];
/** Нечувствительные настройки внешнего вида на устройстве (язык/тема) — для экрана входа до авторизации. */
const LS_DEVICE_PREFS = "fitness:device:prefs";

const toArray = v => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

function readDevicePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_DEVICE_PREFS) || "{}");
    const out = {};
    if (p.lang === "ru" || p.lang === "en") out.lang = p.lang;
    if (["dark", "light", "system"].includes(p.theme)) out.theme = p.theme;
    return out;
  } catch { return {}; }
}
function writeDevicePrefs(s) {
  try { localStorage.setItem(LS_DEVICE_PREFS, JSON.stringify({ lang: s.lang, theme: s.theme })); } catch { /* ignore */ }
}
function normalizeDoc(coll, d) {
  if (!d || typeof d !== "object") return d;
  if (coll === "exercises") {
    return localizeExercise({
      archived: false,
      note: "",
      isBodyweight: Boolean(d.isBodyweight || d.id === "seed-pullups"),
      ...d,
      startReps: toArray(d.startReps)
    });
  }
  if (coll === "programs") {
    return localizeProgram({
      archived: false,
      ...d,
      items: toArray(d.items).map(it => ({ sets: 3, targetReps: "", note: "", ...it }))
    });
  }
  if (coll === "sessions") {
    return localizeSession({
      ...d,
      entries: toArray(d.entries).map(e => ({
        note: "",
        ...e,
        sets: toArray(e.sets).map(s => ({ reps: null, weight: null, rpe: null, done: false, isWarmup: false, ...s }))
      }))
    });
  }
  return d;
}

export const DEFAULT_SETTINGS = {
  lang: detectDefaultLang(),
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
  user: null, // { uid, email, displayName } — устанавливается после входа (Firebase Auth)
  sharedExercises: [],
  exercises: [], programs: [], sessions: [],
  bodyweightLog: [],
  loaded: { exercises: false, programs: false, sessions: false, meta: false },
  settings: { ...DEFAULT_SETTINGS, ...readDevicePrefs() },
  sync: { fromCache: false, pending: false, error: null }
};
setLang(state.settings.lang);

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

function loadLocalSettings(userUid) {
  const base = { ...DEFAULT_SETTINGS, ...readDevicePrefs() };
  try {
    const raw = lsGetUser(userUid, "settings");
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch { return base; }
}

function loadLocalBodyweight(userUid) {
  try {
    const raw = lsGetUser(userUid, "bodyweight");
    return raw ? toArray(JSON.parse(raw)) : [];
  } catch { return []; }
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

let activeUnsubscribes = [];

export function stopSubscriptions() {
  for (const unsub of activeUnsubscribes) {
    try { if (typeof unsub === "function") unsub(); } catch { /* ignore */ }
  }
  activeUnsubscribes = [];
}

/** Аккаунт = пользователь Firebase Auth. Пароль нигде не хранится. */
export async function loginWithEmail(email, password) {
  const u = await signIn(email, password);
  activateUserSession(u);
  return state.user;
}

export const sendPasswordReset = sendReset;
export { pendingCount, waitForSync, flushOfflineQueue, onQueueChange };

/** Регистрация нового аккаунта (Firebase Auth) с начальными настройками и опциональной первой программой. */
export async function registerNewProfile({ email, password, displayName, settingsPatch = {}, bodyweightKg = null, firstProgramMode = "skip", customProgram = null }) {
  const u = await signUp(email, password, displayName);
  activateUserSession(u);

  // Применяем выбранные в онбординге настройки
  const mergedSettings = { ...DEFAULT_SETTINGS, ...state.settings, ...settingsPatch };
  if (bodyweightKg && bodyweightKg > 0) mergedSettings.bodyweightKg = Math.round(Number(bodyweightKg) * 10) / 10;
  state.settings = mergedSettings;
  setLang(state.settings.lang);
  lsSetUser(u.uid, "settings", JSON.stringify(state.settings));
  writeDevicePrefs(state.settings);

  // Загружаем общую базу упражнений в профиль
  seedCommonExercises();

  if (bodyweightKg && bodyweightKg > 0) {
    logBodyweight(bodyweightKg);
  }

  if (firstProgramMode === "template") {
    seedGenericFullbodyProgram();
  } else if (firstProgramMode === "custom" && customProgram && customProgram.items && customProgram.items.length) {
    saveProgram({
      id: uid(),
      name: customProgram.name || t("auth.defaultProgName"),
      archived: false,
      items: customProgram.items
    });
  }

  saveDoc("meta", { id: "init", createdAt: Date.now(), catalogVersion: 3 }).catch(console.error);
  saveDoc("meta", { id: "profile", displayName: u.displayName || "", createdAt: Date.now() }).catch(console.error);
  saveDoc("meta", { id: "settings", ...state.settings }).catch(console.error);
  emit();
  return state.user;
}

/** Активация сессии для пользователя Firebase: ветка данных и локальные ключи — только по его uid. */
export function activateUserSession(user) {
  stopSubscriptions();
  setSpaceUser(user.uid);
  if (getSpaceUser() !== user.uid) throw new Error("Invalid uid");
  state.user = { uid: user.uid, email: user.email || "", displayName: user.displayName || "" };
  state.exercises = [];
  state.programs = [];
  state.sessions = [];
  state.sharedExercises = [];
  state.loaded = { exercises: false, programs: false, sessions: false, meta: false };
  state.settings = loadLocalSettings(user.uid);
  state.bodyweightLog = loadLocalBodyweight(user.uid);
  setLang(state.settings.lang);
}

let lastEmail = "";
/** Email последнего вышедшего пользователя (только в памяти) — для подстановки в поле входа. */
export const getLastEmail = () => lastEmail;

/** Сброс локального состояния при выходе / удалении аккаунта. Идемпотентно. */
export function clearSession() {
  stopSubscriptions();
  if (state.user?.email) lastEmail = state.user.email;
  setSpaceUser(null);
  state.user = null;
  state.exercises = [];
  state.programs = [];
  state.sessions = [];
  state.sharedExercises = [];
  state.bodyweightLog = [];
  state.loaded = { exercises: false, programs: false, sessions: false, meta: false };
  state.settings = { ...DEFAULT_SETTINGS, ...readDevicePrefs() };
  setLang(state.settings.lang);
  emit();
}

export async function logoutProfile() {
  await signOutUser();
  clearSession();
}

/** Удаление аккаунта: повторный ввод пароля → удаление fitnessApp/users/{uid} → deleteUser. */
export async function deleteAccount(password) {
  const uidNow = state.user?.uid;
  if (!uidNow || auth.currentUser?.uid !== uidNow) throw Object.assign(new Error("no-user"), { code: "auth/requires-recent-login" });
  if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "auth/network-request-failed" });
  await reauthenticate(password);
  stopSubscriptions();
  try {
    await deleteUserBranch();
    await deleteCurrentUser();
  } catch (e) {
    init().catch(console.warn); // восстанавливаем подписки: аккаунт остался
    throw e;
  }
  clearLocalUserData(uidNow);
  clearSession();
}

function mergeSharedExercisesIntoState(sharedDocs) {
  if (!Array.isArray(sharedDocs) || !sharedDocs.length) return;
  let changed = false;
  for (const raw of sharedDocs) {
    if (!raw || !raw.id) continue;
    if (!getExercise(raw.id)) {
      state.exercises.push(normalizeDoc("exercises", raw));
      changed = true;
    }
  }
  if (changed) emit();
}

/** Запуск подписок для текущего авторизованного профиля. */
export function init(onProgress) {
  stopSubscriptions();
  const curUser = getSpaceUser();
  if (!curUser) return Promise.resolve();

  return new Promise(resolve => {
    const serverLoaded = { exercises: false, programs: false, sessions: false, meta: false };
    let autoSeeded = false;
    let resolved = false;

    flushOfflineQueue(); // очередь уйдёт только в ветку текущего uid и только когда auth готов

    const labels = {
      exercises: () => t("store.loadedExercises"),
      programs: () => t("store.loadedPrograms"),
      sessions: () => t("store.loadedSessions"),
      meta: () => t("store.loadedMeta")
    };

    const unsubShared = watchSharedExercises(docs => {
      state.sharedExercises = docs || [];
      if (state.loaded.exercises) mergeSharedExercisesIntoState(state.sharedExercises);
    });
    activeUnsubscribes.push(unsubShared);

    const check = lastLoaded => {
      const doneCount = Object.values(state.loaded).filter(Boolean).length;
      if (onProgress) onProgress(doneCount / COLLECTIONS.length, labels[lastLoaded] ? labels[lastLoaded]() : t("store.syncing"));
      if (!resolved && doneCount === COLLECTIONS.length) {
        resolved = true;
        resolve();
      }
      if (!autoSeeded && Object.values(serverLoaded).every(Boolean)) {
        autoSeeded = true;
        if (state.exercises.length < COMMON_LIBRARY_EXERCISES.length) {
          seedCommonExercises();
        }
        mergeSharedExercisesIntoState(state.sharedExercises);
      }
    };

    for (const name of COLLECTIONS) {
      const unsub = watchCollection(name, (docs, fromCache, pending) => {
        if (name === "meta") {
          const s = docs.find(d => d.id === "settings");
          if (s) {
            const { id, ...rest } = s;
            const prevLang = state.settings.lang;
            state.settings = { ...DEFAULT_SETTINGS, ...rest };
            lsSetUser(curUser, "settings", JSON.stringify(state.settings));
            writeDevicePrefs(state.settings);
            if (state.settings.lang && state.settings.lang !== prevLang) {
              setLang(state.settings.lang);
              localizeState(state);
            }
          }
          const bw = docs.find(d => d.id === "bodyweight");
          if (bw) {
            state.bodyweightLog = toArray(bw.items).filter(x => x && x.weight > 0).sort((a, b) => a.t - b.t);
            lsSetUser(curUser, "bodyweight", JSON.stringify(state.bodyweightLog));
          }
        } else {
          state[name] = docs.map(d => normalizeDoc(name, d));
          if (name === "exercises" && state.sharedExercises.length) {
            for (const raw of state.sharedExercises) {
              if (raw && raw.id && !state.exercises.some(x => x.id === raw.id)) {
                state.exercises.push(normalizeDoc("exercises", raw));
              }
            }
          }
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
      activeUnsubscribes.push(unsub);
    }
    // не блокируем интерфейс навсегда, если снапшот не пришёл (например, нет сети и кэш пуст)
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 2500);
  });
}

/* ---------- Настройки и собственный вес тела ---------- */
export function updateSettings(patch) {
  const langChanged = patch.lang && patch.lang !== state.settings.lang;
  state.settings = { ...state.settings, ...patch };
  if (langChanged) {
    setLang(state.settings.lang);
    localizeState(state);
  }
  const curUser = getSpaceUser();
  writeDevicePrefs(state.settings);
  if (curUser) lsSetUser(curUser, "settings", JSON.stringify(state.settings));
  if (curUser) saveDoc("meta", { id: "settings", ...state.settings }).catch(console.error);
  emit();
}

export function logBodyweight(weightKg) {
  const w = Math.round(Number(weightKg) * 10) / 10;
  if (!(w > 0)) return;
  const now = Date.now();
  const dayStr = tm => new Date(tm).toDateString();
  const today = dayStr(now);
  const log = [...state.bodyweightLog];
  const idx = log.findIndex(x => dayStr(x.t) === today);
  if (idx >= 0) log[idx] = { t: now, weight: w };
  else log.push({ t: now, weight: w });
  log.sort((a, b) => a.t - b.t);
  state.bodyweightLog = log;
  const curUser = getSpaceUser();
  if (curUser) lsSetUser(curUser, "bodyweight", JSON.stringify(log));
  if (curUser) saveDoc("meta", { id: "bodyweight", items: log }).catch(console.error);
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
  const saved = upsert("exercises", localizeExercise({ archived: false, ...ex, id: ex.id || uid() }));
  // Пользовательские упражнения живут только в ветке пользователя; общий каталог клиентам недоступен для записи
  return saved;
}
export function saveProgram(p) {
  return upsert("programs", localizeProgram({ archived: false, ...p, id: p.id || uid() }));
}
export function saveSession(s, { silent = false } = {}) {
  const obj = localizeSession({ ...s, id: s.id || uid() });
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

/* ---------- Стартовые данные и общая библиотека упражнений ---------- */
const REST_DEFAULT = 210;
const mkEx = (id, name, muscleGroup, startWeight = null, startReps = [], extra = {}) => ({
  id, name, muscleGroup, unit: "kg", defaultSets: 3, defaultRestSec: REST_DEFAULT, trackRpe: false, note: "",
  startWeight, startReps, isBodyweight: false, archived: false, ...extra
});

export const BASE_7_EXERCISES_CLEAN = [
  mkEx("seed-pullups", "Подтягивания", "Спина", null, [], { isBodyweight: true }),
  mkEx("seed-tbar", "Т-гриф широким хватом", "Спина"),
  mkEx("seed-dbpress", "Жим гантелей", "Грудь"),
  mkEx("seed-biceps", "Гантели", "Бицепс"),
  mkEx("seed-tri-long", "Cable Overhead Extension", "Трицепс (Long)"),
  mkEx("seed-tri-lat", "Cable Lateral Head (разгибания)", "Трицепс (Lateral)"),
  mkEx("seed-delts", "Кабель", "Средняя дельта", null, [], { unit: "lb" })
];

export const EXTRA_LIBRARY_EXERCISES = [
  // Спина
  mkEx("ex-lat-pulldown", "Тяга верхнего блока к груди", "Спина"),
  mkEx("ex-seated-row", "Тяга горизонтального блока", "Спина"),
  mkEx("ex-bb-row", "Тяга штанги в наклоне", "Спина"),
  mkEx("ex-db-row", "Тяга гантели одной рукой", "Спина"),
  mkEx("ex-pullover", "Пулловер в кроссовере", "Спина"),
  mkEx("ex-aust-pullups", "Австралийские подтягивания", "Спина", null, [], { isBodyweight: true, note: "Горизонтальная тяга на низкой перекладине" }),
  // Грудь
  mkEx("ex-bench-press", "Жим штанги лёжа", "Грудь"),
  mkEx("ex-incline-db", "Жим гантелей на наклонной (30°)", "Грудь"),
  mkEx("ex-chest-press", "Жим в тренажёре (Хаммер)", "Грудь"),
  mkEx("ex-cable-fly", "Сведение рук в кроссовере / Бабочка", "Грудь"),
  mkEx("ex-dips", "Отжимания на брусьях", "Грудь", null, [], { isBodyweight: true }),
  mkEx("ex-pushups", "Отжимания от пола на упорах", "Грудь", null, [], { isBodyweight: true }),
  // Бицепс
  mkEx("ex-bb-curl", "Подъём EZ-штанги на бицепс", "Бицепс"),
  mkEx("ex-hammer-curl", "Молотки с гантелями", "Бицепс"),
  mkEx("ex-preacher-curl", "Бицепс на скамье Скотта", "Бицепс"),
  mkEx("ex-cable-curl", "Сгибания на бицепс в блоке", "Бицепс"),
  mkEx("ex-chinups", "Подтягивания обратным хватом", "Бицепс", null, [], { isBodyweight: true }),
  // Трицепс
  mkEx("ex-skullcrusher", "Французский жим с EZ-штангой", "Трицепс"),
  mkEx("ex-rope-pushdown", "Разгибания с канатом в блоке", "Трицепс (Lateral)"),
  mkEx("ex-db-overhead-tri", "Французский жим гантели из-за головы", "Трицепс (Long)"),
  mkEx("ex-diamond-pushups", "Алмазные отжимания", "Трицепс", null, [], { isBodyweight: true }),
  // Дельты
  mkEx("ex-db-lat-raise", "Махи гантелями в стороны", "Средняя дельта"),
  mkEx("ex-ohp-db", "Жим гантелей сидя", "Дельты"),
  mkEx("ex-rear-delt", "Обратная бабочка / Задняя дельта", "Задняя дельта"),
  mkEx("ex-pike-pushups", "Пайк-отжимания углом", "Дельты", null, [], { isBodyweight: true }),
  // Ноги и Пресс
  mkEx("ex-squat", "Приседания со штангой", "Ноги"),
  mkEx("ex-leg-press", "Жим ногами в тренажёре", "Ноги"),
  mkEx("ex-rdl", "Румынская тяга", "Ноги"),
  mkEx("ex-leg-ext", "Разгибания ног сидя", "Ноги"),
  mkEx("ex-leg-curl", "Сгибания ног лёжа", "Ноги"),
  mkEx("ex-cable-crunch", "Скручивания на пресс в блоке", "Пресс"),
  mkEx("ex-hanging-leg-raise", "Подъём ног в висе", "Пресс", null, [], { isBodyweight: true })
];

export const COMMON_LIBRARY_EXERCISES = [...BASE_7_EXERCISES_CLEAN, ...EXTRA_LIBRARY_EXERCISES];

export function getCommonCatalogLocalized() {
  const map = new Map();
  for (const raw of COMMON_LIBRARY_EXERCISES) {
    const loc = localizeExercise(raw);
    map.set(loc.id, loc);
  }
  for (const raw of state.sharedExercises || []) {
    if (raw && raw.id && !map.has(raw.id)) {
      map.set(raw.id, localizeExercise(raw));
    }
  }
  return [...map.values()];
}

export function seedCommonExercises() {
  const items = [];
  for (const raw of getCommonCatalogLocalized()) {
    if (!getExercise(raw.id)) {
      const e = localizeExercise({ ...raw, unit: raw.unit || state.settings.defaultUnit || "kg", defaultRestSec: state.settings.restSec || REST_DEFAULT });
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

export function seedGenericFullbodyProgram() {
  seedCommonExercises();
  const rest = state.settings.restSec || REST_DEFAULT;
  const program = localizeProgram({
    id: "seed-fullbody",
    name: "FULLBODY — классические сеты",
    archived: false,
    items: BASE_7_EXERCISES_CLEAN.map(e => ({ exerciseId: e.id, sets: 3, targetReps: "8-10", restSec: rest, note: "" }))
  });
  if (!getProgram(program.id)) {
    saveProgram(program);
  }
  return program;
}

/* ---------- Экспорт / импорт ---------- */
export function exportData() {
  return JSON.stringify({
    app: "fitness-tracker", version: 1, exportedAt: new Date().toISOString(),
    profile: state.user?.displayName || null,
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
  const numStr = v => (v === null || v === undefined || v === "" ? "" : (isEn() ? String(v).replace(",", ".") : String(v).replace(".", ",")));
  const headers = t("csv.headers");
  const rows = [(Array.isArray(headers) ? headers : []).join(";")];

  const done = [...state.sessions].filter(s => s.status === "done").sort((a, b) => b.startedAt - a.startedAt);
  for (const s of done) {
    const d = new Date(s.startedAt);
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const bw = s.bodyweightKg ?? state.settings.bodyweightKg ?? "";
    (s.entries || []).forEach((e, eIdx) => {
      const ex = getExercise(e.exerciseId);
      const muscle = tMuscle(ex?.muscleGroup || e.muscleGroup || "");
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
          esc(set.isWarmup ? t("store.warmupSym") : workIdx),
          esc(set.isWarmup ? t("csv.warmup") : t("csv.working")),
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
  if (data.app !== "fitness-tracker") throw new Error(t("settings.importInvalid"));
  const items = [];
  for (const name of ["exercises", "programs", "sessions"]) {
    for (const raw of toArray(data[name])) {
      // ключи Firebase не могут содержать . $ # [ ] /
      if (!raw || typeof raw.id !== "string" || !raw.id || raw.id.length > 128 || /[.$#\[\]\/]/.test(raw.id)) continue;
      const obj = normalizeDoc(name, raw);
      items.push([name, obj]);
      const list = state[name], i = list.findIndex(x => x.id === obj.id);
      if (i >= 0) list[i] = obj; else list.push(obj);
    }
  }
  bulkSave(items).catch(console.error);
  if (data.settings && typeof data.settings === "object") {
    // принимаем только известные поля настроек (старые резервные копии могли содержать лишнее)
    const patch = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in data.settings) patch[k] = data.settings[k];
    updateSettings(patch);
  }
  if (Array.isArray(data.bodyweightLog) && data.bodyweightLog.length) {
    const log = data.bodyweightLog.filter(x => x && x.weight > 0 && x.t > 0).sort((a, b) => a.t - b.t);
    if (log.length) {
      state.bodyweightLog = log;
      const cu = getSpaceUser();
      if (cu) { lsSetUser(cu, "bodyweight", JSON.stringify(log)); saveDoc("meta", { id: "bodyweight", items: log }).catch(console.error); }
    }
  }
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

export const unitLabel = u => (u === "lb" ? "lb" : t("store.unitKg"));
export const warmupSymbol = () => t("store.warmupSym");
export function stepFor(unit) { return unit === "lb" ? Number(state.settings.stepLb) || 5 : Number(state.settings.stepKg) || 2.5; }