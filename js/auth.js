// Firebase Authentication (modular SDK, gstatic CDN, версия совпадает с database SDK).
// Сессия хранится SDK в IndexedDB (персистентность по умолчанию); пароль нигде не сохраняется.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile, EmailAuthProvider,
  reauthenticateWithCredential, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "../firebase-config.js";
import { t } from "./i18n.js";

const APP_NAME = "fitness";
export const app = getApps().some(a => a.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME);
export const auth = getAuth(app);

export const MIN_PASSWORD_LEN = 8;

/** Простое представление пользователя для остального приложения. */
export const toUser = u => (u ? { uid: u.uid, email: u.email || "", displayName: u.displayName || "" } : null);

export const currentUid = () => auth.currentUser?.uid || null;

/** Подписка на изменения состояния входа (срабатывает офлайн из IndexedDB). */
export function onAuthChange(cb) {
  return onAuthStateChanged(auth, u => cb(toUser(u)));
}

/**
 * Первое состояние авторизации. Не зависит от сети: SDK берёт закэшированного пользователя из IndexedDB.
 * Если за timeoutMs ответа нет — считаем, что сессии нет (показываем экран входа), а не висим на сплэше.
 */
export function waitForInitialAuth(timeoutMs = 3500) {
  return new Promise(resolve => {
    let done = false;
    let timer = null;
    let unsub = null;
    const finish = u => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (typeof unsub === "function") {
        try { unsub(); } catch { /* ignore */ }
      }
      resolve(u);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    try {
      unsub = onAuthStateChanged(
        auth,
        u => finish(toUser(u)),
        err => {
          console.warn("onAuthStateChanged error:", err);
          finish(null);
        }
      );
    } catch (e) {
      console.warn("onAuthStateChanged failed:", e);
      finish(null);
    }
  });
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, String(email || "").trim(), String(password || ""));
  return toUser(cred.user);
}

export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, String(email || "").trim(), String(password || ""));
  const name = String(displayName || "").trim().slice(0, 60);
  if (name) await updateProfile(cred.user, { displayName: name }).catch(() => {});
  return { uid: cred.user.uid, email: cred.user.email || "", displayName: name };
}

export const sendReset = email => sendPasswordResetEmail(auth, String(email || "").trim());

export const signOutUser = () => signOut(auth);

/** Повторная аутентификация паролем текущего пользователя. */
export async function reauthenticate(password) {
  const u = auth.currentUser;
  if (!u || !u.email) throw Object.assign(new Error("no-user"), { code: "auth/requires-recent-login" });
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, String(password || "")));
}

export const deleteCurrentUser = () => {
  const u = auth.currentUser;
  if (!u) return Promise.resolve();
  return deleteUser(u);
};

/** Локализованное сообщение по коду ошибки Firebase Auth. Сырые коды в интерфейс не попадают. */
export function authErrorMessage(err) {
  const code = err && err.code ? String(err.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/invalid-login-credentials":
      return t("auth.err.invalidCredential");
    case "auth/user-not-found":
      return t("auth.err.userNotFound");
    case "auth/email-already-in-use": return t("auth.err.emailInUse");
    case "auth/weak-password": return t("auth.err.weakPassword");
    case "auth/too-many-requests": return t("auth.err.tooMany");
    case "auth/network-request-failed": return t("auth.err.network");
    case "auth/requires-recent-login": return t("auth.err.recentLogin");
    case "auth/invalid-email":
    case "auth/missing-email": return t("auth.errInvalidEmail");
    default: return t("auth.err.generic");
  }
}
