// Применяем тему и язык до первой отрисовки, чтобы не было вспышки.
// Читаются только нечувствительные настройки внешнего вида устройства (не привязаны к аккаунту).
try {
  var st = JSON.parse(localStorage.getItem("fitness:device:prefs") || "{}");
  var t = st.theme || "dark";
  var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0b0b0c" : "#f6f6f7";
  var lang = st.lang || (/^(ru|uk|be|kk)\b/i.test(navigator.language || "ru") ? "ru" : "en");
  document.documentElement.lang = lang;
  if (lang === "en") {
    document.title = "Workouts";
    window.__initEn = true;
  }
} catch (e) {}