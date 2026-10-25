/**
 * Конфигурация Firebase.
 *
 * Где взять значения: Firebase Console → Project settings (⚙) → General →
 * "Your apps" → Web app → SDK setup and configuration → "Config".
 *
 * ВАЖНО: проект общий с другими вашими приложениями. Это приложение пишет
 * ТОЛЬКО в ветку  fitnessApp/...  внутри Realtime Database и больше никуда
 * (соседние ветки finance, foodTracker, huji_study_app, kadr_website,
 * outfitbuilder, users и др. НЕ затрагиваются). Firebase-приложение
 * инициализируется под отдельным именем "fitness", чтобы не конфликтовать
 * с другими проектами на том же домене.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyC5aYba4eGsnSRDvmK5pIApjIrbJOrUXNQ",
  authDomain: "pc-building-b3d74.firebaseapp.com",
  databaseURL: "https://pc-building-b3d74-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pc-building-b3d74",
  storageBucket: "pc-building-b3d74.firebasestorage.app",
  messagingSenderId: "1000168163599",
  appId: "1:1000168163599:web:6c64d4b7782100a27a167a",
  measurementId: "G-SM5V2K63JX"
};

/**
 * Идентификатор «пространства» ваших данных внутри ветки fitnessApp.
 * Авторизации нет, поэтому это единственная «защита»: замените на длинную
 * случайную строку (например "k7f3-9xq2-lm40-ab71") и не публикуйте её.
 * Данные лежат в: fitnessApp/{SPACE_ID}/exercises | programs | sessions | meta
 */
export const SPACE_ID = "main";

/** Корневая коллекция ветки этого приложения. */
export const ROOT_COLLECTION = "fitnessApp";

/** Версия Firebase SDK (зафиксирована; должна совпадать с URL в js/db.js и sw.js). */
export const FIREBASE_VERSION = "10.12.2";
