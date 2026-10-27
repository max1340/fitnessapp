// Применяем тему и язык до первой отрисовки, чтобы не было вспышки.
// Читаются только нечувствительные настройки внешнего вида устройства (не привязаны к аккаунту).
try {
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchstart", function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
} catch (e) {}

try {
  var st = JSON.parse(localStorage.getItem("fitness:device:prefs") || "{}");
  var iface = st.interface || "auto";
  var isDesk = iface === "desktop" || (iface === "auto" && window.matchMedia && window.matchMedia("(min-width: 960px)").matches);
  if (isDesk && document.documentElement) {
    document.documentElement.setAttribute("data-shell", "desktop");
  }
  document.addEventListener("DOMContentLoaded", function() {
    document.body.setAttribute("data-shell", isDesk ? "desktop" : "mobile");
  });
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
