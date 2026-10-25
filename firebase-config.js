/**
 * Конфигурация Firebase — НОВЫЙ отдельный проект этого приложения.
 *
 * Где взять значения: Firebase Console → Project settings (⚙) → General →
 * "Your apps" → Web app → SDK setup and configuration → "Config".
 * databaseURL: Build → Realtime Database → Data (адрес над деревом данных).
 *
 * Эти значения не являются секретом (они всегда видны клиенту), защита данных
 * обеспечивается Firebase Auth + database.rules.json. Дополнительно ограничьте
 * API key по HTTP-referrer (см. README).
 */
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID"
};

/** true, если плейсхолдеры заменены реальными значениями. */
export const isFirebaseConfigured = !Object.values(firebaseConfig).some(v => /YOUR_/.test(String(v)));

/** Корневой узел данных приложения в Realtime Database. */
export const ROOT_COLLECTION = "fitnessApp";

/** Версия Firebase SDK (зафиксирована; должна совпадать с URL в js/auth.js, js/db.js и sw.js). */
export const FIREBASE_VERSION = "10.12.2";
