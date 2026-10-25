import { h, clear, sheet, toast, confirmDialog, parseNum, fmtNum, fmtRest, icon, haptic } from "../ui.js";
import { state, updateSettings, exportData, importData, downloadCsv, unitLabel, logoutProfile, doneSessions } from "../store.js";
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
  const wrap = h("div", { class: "stack stg-wrap" });
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

    const segmented = (key, options, onAfterChange) => {
      const curVal = key === "lang" ? getLang() : st[key];
      const seg = h("div", { class: "seg-control" });
      options.forEach(([v, l]) => {
        const active = String(curVal) === String(v);
        const btn = h("button", {
          type: "button",
          class: "seg-btn" + (active ? " on" : ""),
          onclick: () => {
            if (active) return;
            updateSettings({ [key]: v });
            applyTheme();
            renderContent();
            if (onAfterChange) onAfterChange();
          }
        }, l);
        seg.append(btn);
      });
      return seg;
    };

    const stepField = (key, stepDelta, minVal, badgeFormatter) => {
      const badgeEl = badgeFormatter ? h("strong", { class: "stg-val-badge" }, badgeFormatter(st[key])) : null;
      const inp = h("input", { type: "text", inputmode: "decimal", value: fmtNum(st[key]) });
      const applyVal = raw => {
        const v = parseNum(raw);
        if (v && v >= minVal) {
          const clean = Math.round(v * 100) / 100;
          updateSettings({ [key]: clean });
          inp.value = fmtNum(clean);
          if (badgeEl && badgeFormatter) badgeEl.textContent = badgeFormatter(clean);
        } else {
          inp.value = fmtNum(state.settings[key]);
        }
      };
      inp.addEventListener("change", () => applyVal(inp.value));
      const bump = d => {
        const cur = Number(state.settings[key]) || 0;
        applyVal(Math.max(minVal, cur + d));
      };
      const stepperEl = h("div", { class: "stepper stg-stepper" },
        h("button", { class: "btn step", type: "button", onclick: () => bump(-stepDelta) }, icon("minus", 14)),
        inp,
        h("button", { class: "btn step", type: "button", onclick: () => bump(stepDelta) }, icon("plus", 14))
      );
      return { stepperEl, badgeEl, applyVal };
    };

    const toggleRow = (title, sub, checked, onChange) => {
      const inp = h("input", { type: "checkbox", class: "ios-switch", checked: !!checked });
      inp.addEventListener("change", () => onChange(inp.checked, inp));
      return h("label", { class: "stg-toggle-row" },
        h("div", { class: "grow" },
          h("strong", { class: "stg-row-title" }, title),
          sub ? h("small", { class: "muted stg-row-sub" }, sub) : null),
        inp
      );
    };

    const file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const text = await f.text();
        if (!(await confirmDialog(t("settings.importConfirm"), { ok: t("settings.importOk") }))) return;
        const n = importData(text);
        haptic("success");
        toast(t("settings.importedToast", { n }));
        renderContent();
      } catch (e) { haptic("error"); toast(t("settings.importError", { msg: e.message })); }
      file.value = "";
    });

    const curUsername = state.user?.username || "—";
    const initials = curUsername.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 2).toUpperCase() || "U";
    const doneCnt = doneSessions().length;
    const progCnt = state.programs.filter(p => !p.archived).length;

    const profileBox = h("div", { class: "stg-card stg-profile-card" },
      h("div", { class: "stg-avatar" }, initials),
      h("div", { class: "grow" },
        h("strong", { class: "stg-profile-name" }, `@${curUsername}`),
        h("small", { class: "muted" }, t("settings.profileStats", { s: doneCnt, p: progCnt }))),
      h("button", {
        class: "btn small",
        type: "button",
        onclick: async () => {
          if (!(await confirmDialog(t("settings.logoutConfirm", { user: curUsername }), { ok: t("settings.logoutOk") }))) return;
          if (sh) sh.close();
          logoutProfile();
        }
      }, t("settings.logoutShort"))
    );

    const restCtrl = stepField("restSec", 15, 15, v => fmtRest(v));
    const restPresets = h("div", { class: "stg-presets" },
      ...[90, 120, 180, 210, 240].map(sec =>
        h("button", {
          type: "button",
          class: "btn small tag" + (Number(st.restSec) === sec ? " on" : ""),
          onclick: () => {
            updateSettings({ restSec: sec });
            renderContent();
          }
        }, fmtRest(sec)))
    );

    const kgCtrl = stepField("stepKg", 0.5, 0.25);
    const lbCtrl = stepField("stepLb", 1, 0.5);

    const actionRow = (ico, title, sub, onclick) => h("button", {
      type: "button",
      class: "stg-action-row",
      onclick
    },
      h("span", { class: "stg-action-ico" }, icon(ico, 18)),
      h("span", { class: "grow stg-action-text" },
        h("strong", {}, title),
        h("small", { class: "muted" }, sub)),
      h("span", { class: "stg-action-arr" }, "→")
    );

    wrap.append(
      profileBox,

      h("div", { class: "stg-section" },
        h("span", { class: "group" }, t("settings.appearanceGroup")),
        h("div", { class: "stg-card stack" },
          h("div", { class: "stg-seg-row" },
            h("span", { class: "stg-label" }, t("settings.lang")),
            segmented("lang", [["ru", "Русский"], ["en", "English"]])),
          h("div", { class: "stg-seg-row" },
            h("span", { class: "stg-label" }, t("settings.theme")),
            segmented("theme", [["dark", t("settings.themeDark")], ["light", t("settings.themeLight")], ["system", t("settings.themeSystem")]])),
          h("div", { class: "stg-seg-row" },
            h("span", { class: "stg-label" }, t("settings.defaultUnits")),
            segmented("defaultUnit", [["kg", unitLabel("kg")], ["lb", "lb"]]))
        )
      ),

      h("div", { class: "stg-section" },
        h("span", { class: "group" }, t("settings.workoutGroup")),
        h("div", { class: "stg-card stack" },
          h("div", { class: "stack", style: "gap:6px" },
            h("div", { class: "row gap", style: "justify-content:space-between" },
              h("span", { class: "stg-label" }, t("settings.restSec")),
              restCtrl.badgeEl),
            restPresets,
            restCtrl.stepperEl),
          h("div", { class: "row gap" },
            h("div", { class: "field grow" }, h("span", {}, t("settings.stepKg")), kgCtrl.stepperEl),
            h("div", { class: "field grow" }, h("span", {}, t("settings.stepLb")), lbCtrl.stepperEl))
        )
      ),

      h("div", { class: "stg-section" },
        h("span", { class: "group" }, t("settings.feedbackGroup")),
        h("div", { class: "stg-card stg-list-card" },
          toggleRow(t("settings.sound"), t("settings.soundSub"), st.sound, val => updateSettings({ sound: val })),
          toggleRow(t("settings.vibration"), t("settings.vibrationSub"), st.vibration, val => {
            updateSettings({ vibration: val });
            if (val) haptic("medium");
          }),
          toggleRow(t("settings.notifications"), t("settings.notificationsSub"), st.notifications !== false, async val => {
            if (val && "Notification" in window && Notification.permission === "default") {
              await Notification.requestPermission().catch(() => {});
            }
            updateSettings({ notifications: val });
          })
        )
      ),

      h("div", { class: "stg-section" },
        h("span", { class: "group" }, t("settings.dataGroup")),
        h("div", { class: "stg-card stg-list-card" },
          actionRow("download", t("settings.exportCsvBtn"), t("settings.exportCsvSub"), () => {
            downloadCsv(); toast(t("settings.csvExportedToast"));
          }),
          actionRow("copy", t("settings.exportJsonBtn"), t("settings.exportJsonSub"), () => {
            const blob = new Blob([exportData()], { type: "application/json" });
            const a = h("a", { href: URL.createObjectURL(blob), download: `fitness-backup-${curUsername}-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }),
          actionRow("plus", t("settings.importJsonBtn"), t("settings.importJsonSub"), () => file.click()),
          file
        )
      )
    );
  }

  renderContent();
  sh = sheet(wrap, { title: t("settings.title"), full: true });
}
