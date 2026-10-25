// Слой доступа к Firestore. Все данные — строго в fitnessApp/{SPACE_ID}/...
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, SPACE_ID, ROOT_COLLECTION } from "../firebase-config.js";

const APP_NAME = "fitness";
const app = getApps().some(a => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME);

export let persistence = "persistent";
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  // Например, приватный режим браузера без IndexedDB — работаем без офлайн-кэша.
  console.warn("Персистентный кэш недоступен, работаем онлайн:", e);
  persistence = "memory";
  try { db = getFirestore(app); } catch (e2) { db = initializeFirestore(app, {}); }
}

/** Ссылка на коллекцию внутри нашей ветки: fitnessApp/{space}/{name} */
const col = name => collection(db, ROOT_COLLECTION, SPACE_ID, name);

/** Подписка на коллекцию. cb(массив документов, fromCache). */
export function watchCollection(name, cb, onError) {
  return onSnapshot(col(name), { includeMetadataChanges: true }, snap => {
    cb(snap.docs.map(d => ({ ...d.data(), id: d.id })), snap.metadata.fromCache, snap.metadata.hasPendingWrites);
  }, err => onError && onError(err));
}

/** Запись документа. Промис НЕ ждём: офлайн он завершится только после синхронизации. */
export function saveDoc(name, obj) {
  const { id } = obj;
  return setDoc(doc(col(name), id), JSON.parse(JSON.stringify(obj)));
}

export function removeDoc(name, id) {
  return deleteDoc(doc(col(name), id));
}

/** Массовая запись пачками (для импорта и стартовых данных). items: [[collection, obj], ...] */
export function bulkSave(items) {
  const commits = [];
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    for (const [name, obj] of items.slice(i, i + 400)) {
      batch.set(doc(col(name), obj.id), JSON.parse(JSON.stringify(obj)));
    }
    commits.push(batch.commit());
  }
  return Promise.all(commits);
}

export function bulkRemove(items) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db);
    for (const [name, id] of items.slice(i, i + 400)) batch.delete(doc(col(name), id));
    batch.commit();
  }
}
