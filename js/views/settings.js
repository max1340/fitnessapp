import { h, clear, sheet, toast, confirmDialog, parseNum, fmtNum, fmtRest, icon, haptic } from "../ui.js";
import { state, updateSettings, exportData, importData, downloadCsv, unitLabel, logoutProfile, doneSessions, pendingCount, waitForSync, deleteAccount } from "../store.js";
import { authErrorMessage } from "../auth.js";
import { t, getLang } from "../i18n.js";
import { isStandalone, promptPwaInstall } from "../pwa.js";

export function applyTheme() {
  const tMode = state.settings.theme;
  const dark = tMode === "dark" || (tMode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0b0b0c" : "#f6f6f7";
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

/** Удаление аккаунта: повторный ввод пароля (reauthenticate) → удаление данных → deleteUser. */
function openDeleteAccount() {
  const passInp = h("input", { type: "password", autocomplete: "current-password", placeholder: t("auth.passwordPlaceholder") });
  const errEl = h("p", { class: "error", hidden: true });
  const delBtn = h("button", { class: "btn primary danger", type: "submit" }, t("settings.deleteAccountOk"));
  let dsh = null;
  const form = h("form", {
    class: "stack",
    onsubmit: async ev => {
      ev.preventDefault();
      errEl.hidden = true;
      if (!passInp.value) { errEl.textContent = t("auth.errFillAll"); errEl.hidden = false; return; }
      delBtn.disabled = true;
      try {
        await deleteAccount(passInp.value);
        passInp.value = "";
        haptic("warning");
        toast(t("settings.deleteAccountDone"));
        if (dsh) dsh.close();
        document.querySelectorAll("#sheets .sheet-wrap").forEach(n => n.remove());
        document.body.classList.remove("sheet-open");
      } catch (err) {
        haptic("error");
        errEl.textContent = authErrorMessage(err);
        errEl.hidden = false;
        delBtn.disabled = false;
      }
    }
  },
    h("p", { class: "confirm-text" }, t("settings.deleteAccountWarn")),
    h("label", { class: "field" }, h("span", {}, t("settings.passwordLabel")), passInp),
    errEl,
    h("div", { class: "row gap" },
      h("button", { class: "btn", type: "button", onclick: () => dsh && dsh.close() }, t("common.cancel")),
      delBtn));
  dsh = sheet(form, { title: t("settings.deleteAccount") });
}

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

    const toggleRow = (title, sub, checked, onChange, isLast = false) => {
      const inp = h("input", { type: "checkbox", class: "ios-switch", checked: !!checked });
      inp.addEventListener("change", () => onChange(inp.checked, inp));
      return h("label", { class: "stg-toggle-row" + (isLast ? " last" : "") },
        h("span", { class: "stg-toggle-text" },
          h("span", { class: "stg-toggle-title" }, title),
          sub ? h("small", { class: "muted stg-toggle-sub" }, sub) : null),
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

    const curUsername = state.user?.displayName || state.user?.email || "—";
    const initials = curUsername.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 2).toUpperCase() || "U";
    const doneCnt = doneSessions().length;
    const progCnt = state.programs.filter(p => !p.archived).length;
    const exCnt = state.exercises.filter(e => !e.archived).length;

    const profileBox = h("div", { class: "stg-card stg-profile-card" },
      h("div", { class: "stg-profile-left" },
        h("div", { class: "stg-avatar" }, initials),
        h("div", { class: "stg-profile-meta" },
          h("strong", { class: "stg-profile-name" }, curUsername),
          state.user?.email && state.user.email !== curUsername ? h("small", { class: "muted" }, state.user.email) : null,
          h("small", { class: "muted" }, t("settings.profileStats", { workouts: doneCnt, programs: progCnt, exercises: exCnt })))),
      h("button", {
        class: "btn small stg-logout-btn",
        type: "button",
        onclick: async () => {
          if (!(await confirmDialog(t("settings.logoutConfirm", { user: curUsername }), { ok: t("settings.logoutOk") }))) return;
          // неотправленные локальные записи: предупреждаем и предлагаем дождаться синхронизации
          if (pendingCount() > 0) {
            if (await confirmDialog(t("settings.logoutPendingWarn", { n: pendingCount() }), { ok: t("settings.logoutWait") })) {
              toast(t("settings.logoutWaiting"));
              await waitForSync(10000);
            }
            if (pendingCount() > 0 && !(await confirmDialog(t("settings.logoutStillPending", { n: pendingCount() }), { ok: t("settings.logoutAnyway"), danger: true }))) return;
          }
          if (sh) sh.close();
          try { await logoutProfile(); } catch (e) { toast(authErrorMessage(e)); }
        }
      }, t("settings.logoutShort"))
    );

    const restCtrl = stepField("restSec", 15, 15, v => fmtRest(v));
    const restPresets = h("div", { class: "stg-presets" },
      ...[60, 90, 120, 180, 210].map(sec =>
        h("button", {
          type: "button",
          class: "btn small tag stg-preset" + (Number(st.restSec) === sec ? " on" : ""),
          onclick: () => {
            updateSettings({ restSec: sec });
            renderContent();
          }
        }, fmtRest(sec)))
    );

    const kgCtrl = stepField("stepKg", 0.5, 0.25);
    const lbCtrl = stepField("stepLb", 1, 0.5);

    const actionRow = (ico, title, sub, onclick, isLast = false) => h("button", {
      type: "button",
      class: "stg-action-row" + (isLast ? " last" : ""),
      onclick
    },
      h("span", { class: "stg-action-ico" }, icon(ico, 18)),
      h("span", { class: "stg-action-text" },
        h("span", { class: "stg-action-title" }, title),
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
          h("div", { class: "stack", style: "gap:8px" },
            h("span", { class: "stg-label" }, t("settings.restSec")),
            restPresets,
            restCtrl.stepperEl),
          h("div", { class: "row gap" },
            h("div", { class: "field grow" }, h("span", {}, t("settings.stepKg")), kgCtrl.stepperEl),
            h("div", { class: "field grow" }, h("span", {}, t("settings.stepLb")), lbCtrl.stepperEl))
        )
      ),

      h("div", { class: "stg-section" },
        h("span", { class: "stg-sec-title" }, t("settings.feedbackGroup")),
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
          }, true)
        )
      ),

      h("div", { class: "stg-section" },
        h("span", { class: "stg-sec-title" }, t("settings.dataGroup")),
        h("div", { class: "stg-card stg-list-card" },
          actionRow("download", t("settings.exportCsvBtn"), t("settings.exportCsvSub"), () => {
            downloadCsv(); toast(t("settings.csvExportedToast"));
          }),
          actionRow("copy", t("settings.exportJsonBtn"), t("settings.exportJsonSub"), () => {
            const blob = new Blob([exportData()], { type: "application/json" });
            const a = h("a", { href: URL.createObjectURL(blob), download: `fitness-backup-${curUsername.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }),
          actionRow("plus", t("settings.importJsonBtn"), t("settings.importJsonSub"), () => file.click()),
          file,
          actionRow("trash", t("settings.deleteAccount"), t("settings.deleteAccountSub"), () => openDeleteAccount(), true)
        )
      ),

      h("div", { class: "stg-section" },
        h("span", { class: "stg-sec-title" }, t("pwa.settingsGroup")),
        h("div", { class: "stg-card stg-list-card" },
          !isStandalone()
            ? actionRow("download", t("pwa.settingsTitle"), t("pwa.settingsSub"), () => promptPwaInstall(), true)
            : h("div", { class: "stg-action-row last", style: "cursor:default" },
                h("span", { class: "stg-action-ico", style: "color:var(--ok, #4caf50)" }, icon("check", 18)),
                h("span", { class: "stg-action-text" },
                  h("span", { class: "stg-action-title" }, t("pwa.installedBadge")),
                  h("small", { class: "muted" }, t("pwa.installedSub"))))
        )
      )
    );
  }

  renderContent();
  sh = sheet(wrap, { title: t("settings.title"), full: true });
}
