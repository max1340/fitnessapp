// Слой доступа к Firebase Realtime Database с локальным офлайн-кэшем и очередью досинхронизации.
// Все данные хранятся СТРОГО в ветке fitnessApp/... — соседние ветки БД никогда не затрагиваются.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, remove, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, SPACE_ID, ROOT_COLLECTION } from "../firebase-config.js";

const APP_NAME = "fitness";
const app = getApps().some(a => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME);
const db = getDatabase(app, firebaseConfig.databaseURL);

const BASE_PATH = SPACE_ID && SPACE_ID !== "main"
  ? `${ROOT_COLLECTION}/${SPACE_ID}`
  : ROOT_COLLECTION;

const LS_CACHE_PREFIX = `fitness.rtdb.cache.v1.${BASE_PATH}.`;
const LS_QUEUE_KEY = `fitness.rtdb.queue.v1.${BASE_PATH}`;

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
    const raw = localStorage.getItem(LS_CACHE_PREFIX + name);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(name, map) {
  if (persistence !== "persistent") return;
  try { localStorage.setItem(LS_CACHE_PREFIX + name, JSON.stringify(map || {})); }
  catch (e) { console.warn("Ошибка записи локального кэша:", e); }
}

function readQueue() {
  if (persistence !== "persistent") return {};
  try { return JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "{}"); }
  catch { return {}; }
}

function writeQueue(q) {
  if (persistence !== "persistent") return;
  try { localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(q || {})); }
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

/** Ссылка на коллекцию внутри ветки fitnessApp */
const colPath = name => `${BASE_PATH}/${name}`;
const docPath = (name, id) => `${BASE_PATH}/${name}/${id}`;

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

/** Запись документа в ветку fitnessApp/{name}/{id}. */
export function saveDoc(name, obj) {
  const clean = JSON.parse(JSON.stringify(obj));
  const { id } = clean;
  const opId = enqueueOp(name, id, "set", clean);
  return set(ref(db, docPath(name, id)), clean).then(() => {
    dequeueOp(name, id, opId);
  });
}

/** Удаление документа из ветки fitnessApp/{name}/{id}. */
export function removeDoc(name, id) {
  const opId = enqueueOp(name, id, "remove", null);
  return remove(ref(db, docPath(name, id))).then(() => {
    dequeueOp(name, id, opId);
  });
}

/** Массовая запись одним атомарным update внутри ветки fitnessApp. items: [[collection, obj], ...] */
export function bulkSave(items) {
  if (!items.length) return Promise.resolve();
  const updates = {};
  const ops = [];
  for (const [name, obj] of items) {
    const clean = JSON.parse(JSON.stringify(obj));
    const opId = enqueueOp(name, clean.id, "set", clean);
    updates[`${name}/${clean.id}`] = clean;
    ops.push([name, clean.id, opId]);
  }
  return update(ref(db, BASE_PATH), updates).then(() => {
    for (const [name, id, opId] of ops) dequeueOp(name, id, opId);
  });
}

/** Массовое удаление одним атомарным update внутри ветки fitnessApp. items: [[collection, id], ...] */
export function bulkRemove(items) {
  if (!items.length) return Promise.resolve();
  const updates = {};
  const ops = [];
  for (const [name, id] of items) {
    const opId = enqueueOp(name, id, "remove", null);
    updates[`${name}/${id}`] = null;
    ops.push([name, id, opId]);
  }
  return update(ref(db, BASE_PATH), updates).then(() => {
    for (const [name, id, opId] of ops) dequeueOp(name, id, opId);
  });
}

/** Досинхронизация накопленных офлайн-изменений при появлении сети. */
export function flushOfflineQueue() {
  const q = readQueue();
  const entries = Object.values(q);
  if (!entries.length) return Promise.resolve();
  const updates = {};
  for (const item of entries) {
    updates[`${item.name}/${item.id}`] = item.op === "set" ? item.data : null;
  }
  return update(ref(db, BASE_PATH), updates).then(() => {
    for (const item of entries) dequeueOp(item.name, item.id, item.opId);
  }).catch(e => console.warn("Офлайн-очередь будет отправлена позже:", e));
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flushOfflineQueue());
  setTimeout(() => flushOfflineQueue(), 1500);
}
