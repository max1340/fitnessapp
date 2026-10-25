// Слой доступа к Firebase Realtime Database с локальным офлайн-кэшем, очередью досинхронизации и мультиаккаунтностью.
// Все данные хранятся СТРОГО в ветке fitnessApp/... — соседние ветки БД никогда не затрагиваются.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, remove, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, ROOT_COLLECTION } from "../firebase-config.js";

const APP_NAME = "fitness";
const app = getApps().some(a => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME);
const db = getDatabase(app, firebaseConfig.databaseURL);

let currentUserId = null;

export function normalizeUserId(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function setSpaceUser(userId) {
  currentUserId = normalizeUserId(userId) || null;
}

export function getSpaceUser() {
  return currentUserId;
}

function getBasePath() {
  return currentUserId
    ? `${ROOT_COLLECTION}/users/${currentUserId}`
    : ROOT_COLLECTION;
}

const getCachePrefix = () => `fitness.rtdb.cache.v1.${getBasePath()}.`;
const getQueueKey = () => `fitness.rtdb.queue.v1.${getBasePath()}`;

export let persistence = "persistent";
try {
  const testKey = "__fitness_test__";
  localStorage.setItem(testKey, "1");
  localStorage.removeItem(testKey);
} catch {
  persistence = "memory";
}

function readCache(name) {
  if (persistence !== "persistent") return null;
  try {
    const raw = localStorage.getItem(getCachePrefix() + name);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(name, map) {
  if (persistence !== "persistent") return;
  try { localStorage.setItem(getCachePrefix() + name, JSON.stringify(map || {})); }
  catch (e) { console.warn("Ошибка записи локального кэша:", e); }
}

function readQueue() {
  if (persistence !== "persistent") return {};
  try { return JSON.parse(localStorage.getItem(getQueueKey()) || "{}"); }
  catch { return {}; }
}

function writeQueue(q) {
  if (persistence !== "persistent") return;
  try { localStorage.setItem(getQueueKey(), JSON.stringify(q || {})); }
  catch (e) { console.warn("Ошибка записи очереди синхронизации:", e); }
}

function applyQueueToMap(name, baseMap) {
  const out = { ...(baseMap || {}) };
  const q = readQueue();
  for (const item of Object.values(q)) {
    if (item.name !== name) continue;
    if (item.op === "set" && item.data) out[item.id] = item.data;
    else if (item.op === "remove") delete out[item.id];
  }
  return out;
}

function hasPendingFor(name) {
  const q = readQueue();
  return Object.values(q).some(item => !name || item.name === name);
}

let opSeq = 0;
function enqueueOp(name, id, op, data = null) {
  const opId = `${Date.now()}_${++opSeq}`;
  const q = readQueue();
  q[`${name}/${id}`] = { opId, name, id, op, data };
  writeQueue(q);

  const cached = readCache(name) || {};
  if (op === "set" && data) cached[id] = data;
  else if (op === "remove") delete cached[id];
  writeCache(name, cached);
  return opId;
}

function dequeueOp(name, id, opId) {
  const q = readQueue();
  const key = `${name}/${id}`;
  if (q[key] && (!opId || q[key].opId === opId)) {
    delete q[key];
    writeQueue(q);
  }
}

/** Ссылка на коллекцию внутри ветки текущего пользователя */
const colPath = name => `${getBasePath()}/${name}`;
const docPath = (name, id) => `${getBasePath()}/${name}/${id}`;

/** Однократное чтение пути из RTDB с таймаутом. */
function readOnce(path, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("timeout"));
    }, timeoutMs);
    onValue(ref(db, path), snap => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(snap.val());
    }, err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    }, { onlyOnce: true });
  });
}

/** Профиль пользователя: fitnessApp/users/{userId}/profile */
export async function fetchUserProfile(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return null;
  return await readOnce(`${ROOT_COLLECTION}/users/${uid}/profile`, 5000);
}

export async function saveUserProfile(userId, profile) {
  const uid = normalizeUserId(userId);
  if (!uid) throw new Error("Invalid userId");
  const clean = JSON.parse(JSON.stringify({ ...profile, username: uid }));
  await set(ref(db, `${ROOT_COLLECTION}/users/${uid}/profile`), clean);
  return clean;
}

/**
 * Автоматическая инициализация и миграция профиля max_134 (код 1328).
 * Если в корне fitnessApp/{exercises,programs,sessions,meta} уже были данные до введения мультиаккаунтности,
 * они бережно копируются в fitnessApp/users/max_134/ без потерь.
 */
export async function ensureMaxProfile() {
  const uid = "max_134";
  const pin = "1328";
  try {
    const existing = await fetchUserProfile(uid);
    if (existing && existing.migratedFromRoot) return existing;

    const updates = {};
    const cols = ["exercises", "programs", "sessions", "meta"];
    const userEx = await readOnce(`${ROOT_COLLECTION}/users/${uid}/exercises`, 3500).catch(() => null);
    const userSess = await readOnce(`${ROOT_COLLECTION}/users/${uid}/sessions`, 3500).catch(() => null);

    if (!userEx && !userSess) {
      for (const c of cols) {
        const rootData = await readOnce(`${ROOT_COLLECTION}/${c}`, 3500).catch(() => null);
        if (rootData && typeof rootData === "object") {
          updates[c] = rootData;
        }
      }
    }

    const profile = {
      username: uid,
      pin,
      createdAt: existing?.createdAt || Date.now(),
      onboarded: true,
      migratedFromRoot: true
    };
    updates.profile = profile;
    await update(ref(db, `${ROOT_COLLECTION}/users/${uid}`), updates);

    // Переносим также локальный кэш из старых ключей, если он есть
    if (persistence === "persistent") {
      for (const c of cols) {
        const oldCache = localStorage.getItem(`fitness.rtdb.cache.v1.${ROOT_COLLECTION}.${c}`);
        const newCacheKey = `fitness.rtdb.cache.v1.${ROOT_COLLECTION}/users/${uid}.${c}`;
        if (oldCache && !localStorage.getItem(newCacheKey)) {
          localStorage.setItem(newCacheKey, oldCache);
        }
      }
    }
    return profile;
  } catch (e) {
    console.warn("ensureMaxProfile offline/deferred:", e);
    return { username: uid, pin, onboarded: true };
  }
}

/** Общая база упражнений: fitnessApp/sharedExercises */
export function watchSharedExercises(cb) {
  const cacheKey = `fitness.rtdb.cache.v1.${ROOT_COLLECTION}.sharedExercises`;
  if (persistence === "persistent") {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cb(Object.values(JSON.parse(raw)));
    } catch { /* ignore */ }
  }
  const r = ref(db, `${ROOT_COLLECTION}/sharedExercises`);
  return onValue(r, snap => {
    const map = snap.val() || {};
    if (persistence === "persistent") {
      try { localStorage.setItem(cacheKey, JSON.stringify(map)); } catch { /* ignore */ }
    }
    const docs = Object.entries(map).map(([id, val]) => ({ ...val, id: val.id || id }));
    cb(docs);
  }, () => {});
}

export function saveSharedExercise(ex) {
  if (!ex || !ex.id) return Promise.resolve();
  const shared = {
    id: ex.id,
    name: ex.name,
    muscleGroup: ex.muscleGroup || "",
    unit: ex.unit || "kg",
    defaultSets: ex.defaultSets || 3,
    defaultRestSec: ex.defaultRestSec ?? 210,
    isBodyweight: !!ex.isBodyweight,
    trackRpe: !!ex.trackRpe,
    note: "",
    startWeight: null,
    startReps: [],
    archived: false
  };
  return set(ref(db, `${ROOT_COLLECTION}/sharedExercises/${ex.id}`), JSON.parse(JSON.stringify(shared))).catch(() => {});
}

/** Подписка на коллекцию в Realtime Database с мгновенной отдачей локального кэша. */
export function watchCollection(name, cb, onError) {
  const cached = readCache(name);
  if (cached) {
    const merged = applyQueueToMap(name, cached);
    cb(Object.values(merged).map(d => ({ ...d })), true, hasPendingFor(name));
  }
  const r = ref(db, colPath(name));
  return onValue(r, snap => {
    const serverMap = snap.val() || {};
    const merged = applyQueueToMap(name, serverMap);
    writeCache(name, merged);
    const docs = Object.entries(merged).map(([id, val]) => ({ ...val, id: val.id || id }));
    cb(docs, false, hasPendingFor(name));
  }, err => onError && onError(err));
}

/** Запись документа в ветку текущего пользователя. */
export function saveDoc(name, obj) {
  const clean = JSON.parse(JSON.stringify(obj));
  const { id } = clean;
  const opId = enqueueOp(name, id, "set", clean);
  return set(ref(db, docPath(name, id)), clean).then(() => {
    dequeueOp(name, id, opId);
  });
}

/** Удаление документа из ветки текущего пользователя. */
export function removeDoc(name, id) {
  const opId = enqueueOp(name, id, "remove", null);
  return remove(ref(db, docPath(name, id))).then(() => {
    dequeueOp(name, id, opId);
  });
}

/** Массовая запись одним атомарным update внутри ветки пользователя. items: [[collection, obj], ...] */
export function bulkSave(items) {
  if (!items.length) return Promise.resolve();
  const basePath = getBasePath();
  const updates = {};
  const ops = [];
  for (const [name, obj] of items) {
    const clean = JSON.parse(JSON.stringify(obj));
    const opId = enqueueOp(name, clean.id, "set", clean);
    updates[`${name}/${clean.id}`] = clean;
    ops.push([name, clean.id, opId]);
  }
  return update(ref(db, basePath), updates).then(() => {
    for (const [name, id, opId] of ops) dequeueOp(name, id, opId);
  });
}

/** Массовое удаление одним атомарным update внутри ветки пользователя. items: [[collection, id], ...] */
export function bulkRemove(items) {
  if (!items.length) return Promise.resolve();
  const basePath = getBasePath();
  const updates = {};
  const ops = [];
  for (const [name, id] of items) {
    const opId = enqueueOp(name, id, "remove", null);
    updates[`${name}/${id}`] = null;
    ops.push([name, id, opId]);
  }
  return update(ref(db, basePath), updates).then(() => {
    for (const [name, id, opId] of ops) dequeueOp(name, id, opId);
  });
}

/** Досинхронизация накопленных офлайн-изменений при появлении сети. */
export function flushOfflineQueue() {
  if (!currentUserId) return Promise.resolve();
  const q = readQueue();
  const entries = Object.values(q);
  if (!entries.length) return Promise.resolve();
  const updates = {};
  for (const item of entries) {
    updates[`${item.name}/${item.id}`] = item.op === "set" ? item.data : null;
  }
  return update(ref(db, getBasePath()), updates).then(() => {
    for (const item of entries) dequeueOp(item.name, item.id, item.opId);
  }).catch(e => console.warn("Офлайн-очередь будет отправлена позже:", e));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flushOfflineQueue());
  setTimeout(() => flushOfflineQueue(), 1500);
}
