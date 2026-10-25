import { h, sheet, toast, confirmDialog, parseNum } from "../ui.js";
import { state, updateSettings, exportData, importData, seedStarterData, getProgram } from "../store.js";
import { persistence } from "../db.js";

export function applyTheme() {
  const t = state.settings.theme;
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0b0b0c" : "#f6f6f7";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

export function openSettings() {
  const st = state.settings;
  const sel = (key, options) => {
    const el = h("select", {}, options.map(([v, l]) => h("option", { value: v, selected: String(st[key]) === String(v) }, l)));
    el.addEventListener("change", () => { updateSettings({ [key]: el.value }); applyTheme(); });
    return el;
  };
  const numInput = (key, fallback) => {
    const el = h("input", { type: "text", inputmode: "decimal", value: String(st[key]).replace(".", ",") });
    el.addEventListener("change", () => { const v = parseNum(el.value); if (v && v > 0) updateSettings({ [key]: v }); else el.value = String(state.settings[key]).replace(".", ","); });
    return el;
  };
  const check = (key, label) => {
    const el = h("input", { type: "checkbox", checked: !!st[key] });
    el.addEventListener("change", () => updateSettings({ [key]: el.checked }));
    return h("label", { class: "check" }, el, h("span", {}, label));
  };
  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const text = await f.text();
      if (!(await confirmDialog("Импортировать данные из файла? Записи с совпадающими id будут перезаписаны, остальные сохранятся.", { ok: "Импорт" }))) return;
      const n = importData(text); toast(`Импортировано записей: ${n}`);
    } catch (e) { toast("Ошибка импорта: " + e.message); }
    file.value = "";
  });

  sheet(h("div", { class: "stack" },
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, "Единицы по умолч."), sel("defaultUnit", [["kg", "кг"], ["lb", "lb"]])),
      h("label", { class: "field grow" }, h("span", {}, "Тема"), sel("theme", [["dark", "Тёмная"], ["light", "Светлая"], ["system", "Системная"]]))),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, "Шаг, кг"), numInput("stepKg")),
      h("label", { class: "field grow" }, h("span", {}, "Шаг, lb"), numInput("stepLb")),
      h("label", { class: "field grow" }, h("span", {}, "Отдых, сек"), numInput("restSec"))),
    check("sound", "Звук таймера"), check("vibration", "Вибрация таймера"),
    h("h3", { class: "group" }, "Данные"),
    h("button", { class: "btn block", type: "button", onclick: () => {
      const blob = new Blob([exportData()], { type: "application/json" });
      const a = h("a", { href: URL.createObjectURL(blob), download: `fitness-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }, "Экспорт JSON"),
    h("button", { class: "btn block", type: "button", onclick: () => file.click() }, "Импорт JSON"), file,
    h("button", { class: "btn block", type: "button", onclick: () => { const n = seedStarterData(); toast(n ? "Стартовая программа загружена" : "Стартовые данные уже загружены"); } }, "Загрузить мою текущую программу"),
    h("p", { class: "muted small" }, `Облако: Firestore, офлайн-кэш: ${persistence === "persistent" ? "включён" : "недоступен"}. Авторизации нет — выходить не из чего. Настройки синхронизируются через Firestore.`),
    h("a", { class: "muted small", href: "tests.html" }, "Запустить юнит-тесты метрик")), { title: "Настройки" });
}
