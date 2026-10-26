// Слой доступа к Firebase Realtime Database с локальным офлайн-кэшем и очередью досинхронизации.
// Все данные пользователя лежат строго в fitnessApp/users/{uid}/..., доступ ограничен правилами БД (database.rules.json).
// Локальные ключи имеют префикс fitness:{uid}: — данные одного аккаунта никогда не попадают другому на том же устройстве.
import { getDatabase, ref, set, remove, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, ROOT_COLLECTION } from "../firebase-config.js";
import { app, auth } from "./auth.js";

const db = getDatabase(app, firebaseConfig.databaseURL);

let currentUserId = null;

/** Допустимый uid Firebase Auth: только латиница/цифры/_/- (защита от подстановки в путь). */
const isValidUid = v => typeof v === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(v);

export function setSpaceUser(uid) {
  currentUserId = isValidUid(uid) ? uid : null;
  notifyQueueChange();
}

export function getSpaceUser() {
  return currentUserId;
}

const getBasePath = () => {
  if (!currentUserId) throw new Error("No authenticated user");
  return `${ROOT_COLLECTION}/users/${currentUserId}`;
};

/** Префикс всех локальных ключей пользователя: fitness:{uid}: */
export const lsPrefix = (uid = currentUserId) => `fitness:${uid}:`;
const cacheKey = name => `${lsPrefix()}cache:${name}`;
const queueKey = () => `${lsPrefix()}queue`;

export let persistence = "persistent";
try {
  const testKey = "__fitness_test__";
  localStorage.setItem(testKey, "1");
  localStorage.removeItem(testKey);
} catch {
  persistence = "memory";
}

/** Обычное хранилище на пользователя (настройки, вес тела): fitness:{uid}:{name}. */
export function lsGetUser(uid, name) {
  if (persistence !== "persistent" || !isValidUid(uid)) return null;
  try { return localStorage.getItem(`${lsPrefix(uid)}${name}`); } catch { return null; }
}
export function lsSetUser(uid, name, value) {
  if (persistence !== "persistent" || !isValidUid(uid)) return;
  try { localStorage.setItem(`${lsPrefix(uid)}${name}`, value); } catch { /* ignore */ }
}

/** Удаление всех локальных данных пользователя (при удалении аккаунта). */
export function clearLocalUserData(uid) {
  if (persistence !== "persistent" || !isValidUid(uid)) return;
  try {
    const p = lsPrefix(uid);
    for (const k of Object.keys(localStorage)) if (k.startsWith(p)) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

/** Данные старой версии (учётные данные, общий кэш) без привязки к uid удаляются при старте. */
(function purgeLegacyStorage() {
  if (persistence !== "persistent") return;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("fitness.rtdb.") || k.startsWith("fitness.settings.v1") || k.startsWith("fitness.bodyweight.v1") ||
          k === "fitness.auth.v1" || k === "fitness.savedProfiles.v1") localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
})();

function readCache(name) {
  if (persistence !== "persistent" || !currentUserId) return null;
  try {
    const raw = localStorage.getItem(cacheKey(name));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(name, map) {
  if (persistence !== "persistent" || !currentUserId) return;
  try { localStorage.setItem(cacheKey(name), JSON.stringify(map || {})); }
  catch (e) { console.warn("Ошибка записи локального кэша:", e); }
}

function readQueue() {
  if (persistence !== "persistent" || !currentUserId) return {};
  try { return JSON.parse(localStorage.getItem(queueKey()) || "{}"); }
  catch { return {}; }
}

const queueListeners = new Set();
export function onQueueChange(cb) {
  if (typeof cb === "function") queueListeners.add(cb);
  return () => queueListeners.delete(cb);
}

function notifyQueueChange() {
  const count = pendingCount();
  for (const cb of queueListeners) {
    try { cb(count); } catch (e) { console.error("queueListener error:", e); }
  }
}

function writeQueue(q) {
  if (persistence !== "persistent" || !currentUserId) return;
  try {
    localStorage.setItem(queueKey(), JSON.stringify(q || {}));
    notifyQueueChange();
  }
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

/** Количество неотправленных локальных записей текущего пользователя. */
export function pendingCount() {
  return Object.keys(readQueue()).length;
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

const colPath = name => `${getBasePath()}/${name}`;
const docPath = (name, id) => `${getBasePath()}/${name}/${id}`;

/** Общая база упражнений (только чтение): fitnessApp/sharedExercises */
export function watchSharedExercises(cb) {
  if (!currentUserId) return () => {};
  const key = `${lsPrefix()}cache:shared`;
  if (persistence === "persistent") {
    try {
      const raw = localStorage.getItem(key);
      if (raw) cb(Object.values(JSON.parse(raw)));
    } catch { /* ignore */ }
  }
  const r = ref(db, `${ROOT_COLLECTION}/sharedExercises`);
  return onValue(r, snap => {
    const map = snap.val() || {};
    if (persistence === "persistent") {
      try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
    }
    cb(Object.entries(map).map(([id, val]) => ({ ...val, id: val.id || id })));
  }, () => {});
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

/**
 * Досинхронизация накопленных офлайн-изменений. Выполняется только когда auth готов
 * и текущий пользователь Firebase совпадает с владельцем очереди; пишет только в ветку этого uid.
 */
let flushing = null;
export function flushOfflineQueue() {
  const uid = currentUserId;
  if (!uid || auth.currentUser?.uid !== uid) return Promise.resolve(false);
  const q = readQueue();
  const entries = Object.values(q);
  if (!entries.length) return Promise.resolve(true);
  if (flushing) return flushing;
  const updates = {};
  for (const item of entries) {
    updates[`${item.name}/${item.id}`] = item.op === "set" ? item.data : null;
  }
  flushing = update(ref(db, `${ROOT_COLLECTION}/users/${uid}`), updates).then(() => {
    if (currentUserId === uid) for (const item of entries) dequeueOp(item.name, item.id, item.opId);
    return true;
  }).catch(e => {
    console.warn("Офлайн-очередь будет отправлена позже:", e);
    return false;
  }).finally(() => { flushing = null; });
  return flushing;
}

/** Ожидание синхронизации очереди до timeoutMs. Возвращает true, если очередь пуста. */
export async function waitForSync(timeoutMs = 8000) {
  const t0 = Date.now();
  while (pendingCount() > 0 && Date.now() - t0 < timeoutMs) {
    await Promise.race([flushOfflineQueue(), new Promise(r => setTimeout(r, timeoutMs))]);
    if (pendingCount() > 0) await new Promise(r => setTimeout(r, 500));
  }
  return pendingCount() === 0;
}

/** Удаление всей ветки пользователя fitnessApp/users/{uid} (нужна сеть: иначе ошибка сети). */
export function deleteUserBranch() {
  const uid = currentUserId;
  if (!uid || auth.currentUser?.uid !== uid) return Promise.reject(new Error("No authenticated user"));
  const op = remove(ref(db, `${ROOT_COLLECTION}/users/${uid}`));
  const timeout = new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "auth/network-request-failed" })), 12000));
  return Promise.race([op, timeout]);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    flushOfflineQueue();
    notifyQueueChange();
  });
  window.addEventListener("offline", () => notifyQueueChange());
  window.addEventListener("storage", e => {
    if (e.key && e.key.includes("offlineQueue")) notifyQueueChange();
  });
}
