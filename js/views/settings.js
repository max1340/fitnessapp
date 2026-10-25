import { h, clear, sheet, toast, confirmDialog, parseNum, fmtNum } from "../ui.js";
import { state, updateSettings, exportData, importData, downloadCsv, seedStarterData, unitLabel } from "../store.js";
import { persistence } from "../db.js";
import { t, getLang } from "../i18n.js";

export function applyTheme() {
  const tMode = state.settings.theme;
  const dark = tMode === "dark" || (tMode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0b0b0c" : "#f6f6f7";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

export function openSettings() {
  const wrap = h("div", { class: "stack" });
  let sh = null;

  function renderContent() {
    clear(wrap);
    const st = state.settings;
    if (sh) {
      const h2 = sh.el.querySelector(".sheet-head h2");
      if (h2) h2.textContent = t("settings.title");
      const closeBtn = sh.el.querySelector(".sheet-head .btn.icon");
      if (closeBtn) {
        closeBtn.setAttribute("aria-label", t("common.close"));
        closeBtn.setAttribute("title", t("common.close"));
      }
      sh.el.querySelector(".sheet")?.setAttribute("aria-label", t("settings.title"));
    }

    const sel = (key, options, onAfterChange) => {
      const curVal = key === "lang" ? getLang() : st[key];
      const el = h("select", {}, options.map(([v, l]) => h("option", { value: v, selected: String(curVal) === String(v) }, l)));
      el.addEventListener("change", () => {
        updateSettings({ [key]: el.value });
        applyTheme();
        if (onAfterChange) onAfterChange();
      });
      return el;
    };
    const numInput = key => {
      const el = h("input", { type: "text", inputmode: "decimal", value: fmtNum(st[key]) });
      el.addEventListener("change", () => {
        const v = parseNum(el.value);
        if (v && v > 0) updateSettings({ [key]: v });
        else el.value = fmtNum(state.settings[key]);
      });
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
        if (!(await confirmDialog(t("settings.importConfirm"), { ok: t("settings.importOk") }))) return;
        const n = importData(text);
        toast(t("settings.importedToast", { n }));
        renderContent();
      } catch (e) { toast(t("settings.importError", { msg: e.message })); }
      file.value = "";
    });

    wrap.append(
      h("label", { class: "field" }, h("span", {}, t("settings.lang")), sel("lang", [["ru", "Русский"], ["en", "English"]], renderContent)),
      h("div", { class: "row gap" },
        h("label", { class: "field grow" }, h("span", {}, t("settings.defaultUnits")), sel("defaultUnit", [["kg", unitLabel("kg")], ["lb", "lb"]])),
        h("label", { class: "field grow" }, h("span", {}, t("settings.theme")), sel("theme", [["dark", t("settings.themeDark")], ["light", t("settings.themeLight")], ["system", t("settings.themeSystem")]]))),
      h("div", { class: "row gap" },
        h("label", { class: "field grow" }, h("span", {}, t("settings.stepKg")), numInput("stepKg")),
        h("label", { class: "field grow" }, h("span", {}, t("settings.stepLb")), numInput("stepLb")),
        h("label", { class: "field grow" }, h("span", {}, t("settings.restSec")), numInput("restSec"))),
      check("sound", t("settings.sound")), check("vibration", t("settings.vibration")),
      (() => {
        const el = h("input", { type: "checkbox", checked: st.notifications !== false });
        el.addEventListener("change", async () => {
          if (el.checked && "Notification" in window && Notification.permission === "default") {
            await Notification.requestPermission().catch(() => {});
          }
          updateSettings({ notifications: el.checked });
        });
        return h("label", { class: "check" }, el, h("span", {}, t("settings.notifications")));
      })(),
      h("h3", { class: "group" }, t("settings.dataGroup")),
      h("button", { class: "btn block", type: "button", onclick: () => { downloadCsv(); toast(t("settings.csvExportedToast")); } }, t("settings.exportCsvBtn")),
      h("button", { class: "btn block", type: "button", onclick: () => {
        const blob = new Blob([exportData()], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: `fitness-backup-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }, t("settings.exportJsonBtn")),
      h("button", { class: "btn block", type: "button", onclick: () => file.click() }, t("settings.importJsonBtn")), file,
      h("button", { class: "btn block", type: "button", onclick: () => { const n = seedStarterData(); toast(n ? t("settings.seededToast") : t("settings.alreadySeededToast")); } }, t("settings.seedBtn")),
      h("p", { class: "muted small" }, t("settings.cloudInfo", { cache: persistence === "persistent" ? t("settings.cacheOn") : t("settings.cacheOff") })),
      h("a", { class: "muted small", href: "tests.html" }, t("settings.runTests"))
    );
  }

  renderContent();
  sh = sheet(wrap, { title: t("settings.title") });
}
