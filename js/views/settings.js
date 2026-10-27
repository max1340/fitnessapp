import { h, clear, sheet, toast, confirmDialog, parseNum, fmtNum, fmtRest, icon, haptic } from "../ui.js";
import { state, updateSettings, exportData, importData, downloadCsv, unitLabel, logoutProfile, doneSessions, pendingCount, waitForSync, flushOfflineQueue, logBodyweight, deleteAccount, saveDoc } from "../store.js";
import { authErrorMessage, sendReset } from "../auth.js";
import { t, getLang } from "../i18n.js";
import { isStandalone, promptPwaInstall } from "../pwa.js";

const LS_COLLAPSED_KEY = "fitness:stg:collapsed";

function readCollapsedState() {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedState(set) {
  try {
    localStorage.setItem(LS_COLLAPSED_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

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

/** Смена пароля: подтверждение отправки ссылки на email */
async function changePassword() {
  const email = state.user?.email;
  if (!email) {
    toast(t("auth.errFillAll"));
    return;
  }
  const ok = await confirmDialog(t("settings.changePasswordConfirm", { email }), { ok: t("settings.changePassword") });
  if (!ok) return;
  try {
    await sendReset(email);
    haptic("success");
    toast(t("settings.changePasswordSent", { email }));
  } catch (err) {
    haptic("error");
    toast(authErrorMessage(err));
  }
}

/** Модальное окно профиля: просмотр статистики и редактирование имени */
function openProfileSheet(onUpdate) {
  const curName = state.user?.displayName || "";
  const curEmail = state.user?.email || "—";
  const nameInp = h("input", {
    type: "text",
    class: "auth-input",
    value: curName,
    placeholder: t("auth.namePlaceholder")
  });
  let prSheet = null;
  const saveBtn = h("button", {
    class: "btn primary",
    type: "button",
    onclick: async () => {
      const nextName = nameInp.value.trim();
      if (nextName) {
        if (state.user) {
          state.user.displayName = nextName;
          saveDoc("meta", { id: "profile", displayName: nextName }).catch(console.error);
        }
        haptic("success");
        toast(t("settings.nameSaved"));
        if (onUpdate) onUpdate();
        if (prSheet) prSheet.close();
      }
    }
  }, t("common.save"));

  const doneCnt = doneSessions().length;
  const progCnt = state.programs.filter(p => !p.archived).length;
  const exCnt = state.exercises.filter(e => !e.archived).length;

  const initials = (curName || curEmail).replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 2).toUpperCase() || "U";

  const content = h("div", { class: "stack", style: "gap:16px" },
    h("div", { class: "stg-profile-card", style: "cursor:default" },
      h("div", { class: "stg-profile-left" },
        h("div", { class: "stg-avatar" }, initials),
        h("div", { class: "stg-profile-info" },
          h("strong", { class: "stg-profile-name" }, curName || curEmail),
          h("small", { class: "stg-profile-email" }, curEmail)
        )
      )
    ),
    h("div", { class: "field" },
      h("span", {}, t("settings.editProfile")),
      nameInp
    ),
    saveBtn,
    h("div", { class: "stg-profile-stats-grid" },
      h("div", { class: "stg-stat-tile" },
        h("span", { class: "stg-stat-num" }, String(doneCnt)),
        h("span", { class: "stg-stat-lbl" }, t("progress.ovWorkouts"))
      ),
      h("div", { class: "stg-stat-tile" },
        h("span", { class: "stg-stat-num" }, String(progCnt)),
        h("span", { class: "stg-stat-lbl" }, t("nav.programs"))
      ),
      h("div", { class: "stg-stat-tile" },
        h("span", { class: "stg-stat-num" }, String(exCnt)),
        h("span", { class: "stg-stat-lbl" }, t("nav.exercises"))
      )
    )
  );

  prSheet = sheet(content, { title: t("settings.profileTitle") });
}

/** Модальное окно логирования веса тела */
function openBodyweightSheet(onSave) {
  const currentKg = state.settings.bodyweightKg ?? (state.bodyweightLog[state.bodyweightLog.length - 1]?.weight ?? null);
  const u = state.settings.defaultUnit || "kg";
  const displayVal = currentKg ? (u === "lb" ? Math.round(currentKg * 2.20462 * 10) / 10 : currentKg) : "";

  const inp = h("input", {
    type: "number",
    step: "0.1",
    min: "20",
    max: "500",
    class: "auth-input",
    value: displayVal ? String(displayVal) : "",
    placeholder: u === "lb" ? "160" : "75.0"
  });

  let bwSheet = null;
  const saveBtn = h("button", {
    class: "btn primary",
    type: "button",
    onclick: () => {
      const v = parseFloat(inp.value.replace(",", "."));
      if (v > 0) {
        const kg = u === "lb" ? Math.round(v / 2.20462 * 10) / 10 : v;
        logBodyweight(kg);
        haptic("success");
        toast(t("settings.bodyweightSaved", { w: fmtNum(v), u }));
        if (onSave) onSave();
        if (bwSheet) bwSheet.close();
      }
    }
  }, t("settings.bodyweightSave"));

  const log = (state.bodyweightLog || []).slice(-8).reverse();
  const historyList = h("div", { class: "bw-history-list" },
    ...log.map(item => {
      const dt = new Date(item.t);
      const dateStr = dt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      const valStr = u === "lb" ? `${fmtNum(Math.round(item.weight * 2.20462 * 10) / 10)} lb` : `${fmtNum(item.weight)} кг`;
      return h("div", { class: "bw-history-row" },
        h("span", { class: "bw-history-date" }, dateStr),
        h("strong", { class: "bw-history-val" }, valStr)
      );
    })
  );

  const content = h("div", { class: "stack", style: "gap:16px" },
    h("p", { class: "muted", style: "margin:0;font-size:13px;" }, t("settings.bodyweightSub")),
    h("div", { class: "field" },
      h("span", {}, t("settings.bodyweightEnter") + ` (${u})`),
      inp
    ),
    saveBtn,
    log.length > 0 ? h("div", { class: "stack", style: "gap:8px;margin-top:8px;" },
      h("span", { class: "stg-category-title" }, t("settings.bodyweightHistory")),
      historyList
    ) : null
  );

  bwSheet = sheet(content, { title: t("settings.bodyweightSheetTitle") });
}

export function openSettings() {
  const wrap = h("div", { class: "stack stg-wrap" });
  let sh = null;
  const collapsedSet = readCollapsedState();

  function renderContent() {
    clear(wrap);
    const st = state.settings;

    if (sh) {
      const h2 = sh.el.querySelector(".sheet-head h2");
      if (h2) h2.textContent = t("settings.title");
      const backBtn = sh.el.querySelector(".sheet-head .sheet-back-btn");
      if (backBtn) {
        backBtn.setAttribute("aria-label", t("common.back"));
        backBtn.setAttribute("title", t("common.back"));
      }
      sh.el.querySelector(".sheet")?.setAttribute("aria-label", t("settings.title"));
    }

    /* 1. Profile Card */
    const curUsername = state.user?.displayName || state.user?.email || "—";
    const initials = curUsername.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 2).toUpperCase() || "U";
    const userEmail = state.user?.email || "test@mail.com";

    const profileCard = h("div", {
      class: "stg-profile-card",
      onclick: () => openProfileSheet(() => renderContent())
    },
      h("div", { class: "stg-profile-left" },
        h("div", { class: "stg-avatar" }, initials),
        h("div", { class: "stg-profile-info" },
          h("strong", { class: "stg-profile-name" }, curUsername),
          h("small", { class: "stg-profile-email" }, userEmail)
        )
      ),
      h("span", { class: "stg-chevron" }, icon("chevronRight", 18))
    );

    /* Helper: Accordion Category */
    function buildCategory(catId, title, cardContent) {
      const isCollapsed = collapsedSet.has(catId);
      const catEl = h("div", {
        class: "stg-category" + (isCollapsed ? " collapsed" : ""),
        dataset: { category: catId }
      });

      const chevron = h("span", { class: "stg-category-chevron" }, icon("chevronDown", 16));
      const headBtn = h("button", {
        type: "button",
        class: "stg-category-head",
        "aria-expanded": !isCollapsed ? "true" : "false",
        onclick: () => {
          if (collapsedSet.has(catId)) {
            collapsedSet.delete(catId);
          } else {
            collapsedSet.add(catId);
          }
          writeCollapsedState(collapsedSet);
          const nowCollapsed = collapsedSet.has(catId);
          catEl.classList.toggle("collapsed", nowCollapsed);
          headBtn.setAttribute("aria-expanded", !nowCollapsed ? "true" : "false");
          haptic("light");
        }
      },
        h("span", { class: "stg-category-title" }, title),
        chevron
      );

      const inner = h("div", { class: "stg-category-inner" }, cardContent);
      const body = h("div", { class: "stg-category-body" }, inner);

      catEl.append(headBtn, body);
      return catEl;
    }

    /* Helper: Row components */
    const row = (title, sub, rightEl, onclick = null, isDanger = false) => {
      const content = [
        h("div", { class: "stg-row-left" },
          h("span", { class: "stg-row-title" + (isDanger ? " danger" : "") }, title),
          sub ? h("small", { class: "stg-row-sub" }, sub) : null
        ),
        h("div", { class: "stg-row-right" }, rightEl)
      ];
      if (onclick) {
        return h("button", {
          type: "button",
          class: "stg-row tappable",
          onclick
        }, ...content);
      }
      return h("div", { class: "stg-row" }, ...content);
    };

    const segControl = (options, curVal, onChange) => {
      const seg = h("div", { class: "stg-seg-control" });
      options.forEach(([val, label]) => {
        const active = String(curVal) === String(val);
        const btn = h("button", {
          type: "button",
          class: "stg-seg-btn" + (active ? " active" : ""),
          onclick: () => {
            if (active) return;
            onChange(val);
          }
        }, label);
        seg.append(btn);
      });
      return seg;
    };

    const iosSwitch = (checked, onChange) => {
      const inp = h("input", { type: "checkbox", class: "ios-switch", checked: !!checked });
      inp.addEventListener("change", () => onChange(inp.checked));
      return inp;
    };

    const stepper = (valSec, onChange) => {
      const valEl = h("span", { class: "stg-step-val" }, fmtRest(valSec));
      const minusBtn = h("button", {
        type: "button",
        class: "stg-step-btn",
        onclick: () => {
          const next = Math.max(15, (Number(state.settings.restSec) || 210) - 15);
          onChange(next);
        }
      }, icon("minus", 14));
      const plusBtn = h("button", {
        type: "button",
        class: "stg-step-btn",
        onclick: () => {
          const next = Math.min(600, (Number(state.settings.restSec) || 210) + 15);
          onChange(next);
        }
      }, icon("plus", 14));

      return h("div", { class: "stg-stepper" }, minusBtn, valEl, plusBtn);
    };

    /* Category 1: ВНЕШНИЙ ВИД */
    const appearanceCard = h("div", { class: "stg-card" },
      row(
        t("settings.theme"),
        null,
        segControl([
          ["system", t("settings.themeSystem")],
          ["light", t("settings.themeLight")],
          ["dark", t("settings.themeDark")]
        ], st.theme, v => {
          updateSettings({ theme: v });
          applyTheme();
          renderContent();
        })
      ),
      row(
        t("settings.lang"),
        null,
        segControl([
          ["ru", "RU"],
          ["en", "EN"]
        ], getLang(), v => {
          updateSettings({ lang: v });
          renderContent();
        })
      )
    );

    /* Category 2: ТРЕНИРОВКА */
    const isKg = (st.defaultUnit || "kg") === "kg";
    const progressionSteps = isKg
      ? [[1.25, "1,25"], [2.5, "2,5"], [5, "5"]]
      : [[2.5, "2,5"], [5, "5"], [10, "10"]];
    const curStep = isKg ? Number(st.stepKg || 2.5) : Number(st.stepLb || 5);

    const workoutCard = h("div", { class: "stg-card" },
      row(
        t("settings.defaultUnits"),
        t("settings.defaultUnitsSub"),
        segControl([
          ["kg", "кг"],
          ["lb", "lb"]
        ], st.defaultUnit || "kg", v => {
          updateSettings({ defaultUnit: v });
          renderContent();
        })
      ),
      row(
        t("settings.restSec"),
        null,
        stepper(st.restSec || 210, sec => {
          updateSettings({ restSec: sec });
          renderContent();
        })
      ),
      row(
        t("settings.progressionStep"),
        null,
        segControl(progressionSteps, curStep, val => {
          if (isKg) updateSettings({ stepKg: val });
          else updateSettings({ stepLb: val });
          renderContent();
        })
      ),
      row(
        t("settings.autoStartRest"),
        t("settings.autoStartRestSub"),
        iosSwitch(st.autoStartRest !== false, checked => {
          updateSettings({ autoStartRest: checked });
        })
      ),
      row(
        t("settings.suggestWarmup"),
        t("settings.suggestWarmupSub"),
        iosSwitch(!!st.suggestWarmup, checked => {
          updateSettings({ suggestWarmup: checked });
        })
      ),
      row(
        t("settings.vibration"),
        null,
        iosSwitch(st.vibration !== false, checked => {
          updateSettings({ vibration: checked });
          if (checked) haptic("medium");
        })
      ),
      row(
        t("settings.sound"),
        null,
        iosSwitch(st.sound !== false, checked => {
          updateSettings({ sound: checked });
        })
      )
    );

    /* Category 3: ПОКАЗАТЕЛИ ТЕЛА */
    const currentKg = state.settings.bodyweightKg ?? (state.bodyweightLog[state.bodyweightLog.length - 1]?.weight ?? null);
    const u = state.settings.defaultUnit || "kg";
    const displayWeight = currentKg
      ? (u === "lb" ? `${fmtNum(Math.round(currentKg * 2.20462 * 10) / 10)} lb` : `${fmtNum(currentKg)} кг`)
      : "—";

    const bodyCard = h("div", { class: "stg-card" },
      row(
        t("settings.bodyweight"),
        t("settings.bodyweightSub"),
        h("div", { class: "row gap" },
          h("strong", { class: "stg-row-val" }, displayWeight),
          h("span", { class: "stg-chevron" }, icon("chevronRight", 18))
        ),
        () => openBodyweightSheet(() => renderContent())
      )
    );

    /* Category 4: ДАННЫЕ */
    const pCount = pendingCount();
    const isPending = pCount > 0;
    const syncDot = h("span", { class: "stg-status-dot " + (isPending ? "pending" : "synced") });
    const syncRowLeft = h("div", { class: "stg-row-left" },
      h("div", { class: "row gap", style: "gap:6px; min-width: 0;" },
        syncDot,
        h("span", { class: "stg-row-title" },
          isPending ? t("settings.queuePending", { n: pCount, w: "" }) : t("settings.queueSynced")
        )
      ),
      h("small", { class: "stg-row-sub" },
        isPending ? t("settings.queuePendingSub") : t("settings.queueSyncedSub")
      )
    );

    const syncIcon = icon("refresh", 18);
    const syncBtn = h("button", {
      type: "button",
      class: "stg-sync-btn",
      "aria-label": t("settings.syncBtn"),
      title: t("settings.syncBtn"),
      onclick: async e => {
        e.stopPropagation();
        if (syncBtn.disabled) return;
        syncBtn.disabled = true;
        syncIcon.classList.add("spinning");
        try {
          flushOfflineQueue();
          await waitForSync(5000);
          haptic("success");
          toast(t("settings.syncDone"));
        } catch { /* ignore */ }
        renderContent();
      }
    }, syncIcon);

    const fileInp = h("input", { type: "file", accept: "application/json,.json", hidden: true });
    fileInp.addEventListener("change", async () => {
      const f = fileInp.files[0]; if (!f) return;
      try {
        const text = await f.text();
        if (!(await confirmDialog(t("settings.importConfirm"), { ok: t("settings.importOk") }))) return;
        const n = importData(text);
        haptic("success");
        toast(t("settings.importedToast", { n }));
        renderContent();
      } catch (e) { haptic("error"); toast(t("settings.importError", { msg: e.message })); }
      fileInp.value = "";
    });

    const dataCard = h("div", { class: "stg-card" },
      h("div", { class: "stg-row" },
        syncRowLeft,
        h("div", { class: "stg-row-right" }, syncBtn)
      ),
      row(
        t("settings.exportCsvBtn"),
        t("settings.exportCsvSub"),
        h("span", { class: "stg-chevron" }, icon("chevronRight", 18)),
        () => { downloadCsv(); toast(t("settings.csvExportedToast")); }
      ),
      row(
        t("settings.exportJsonBtn"),
        t("settings.exportJsonSub"),
        h("span", { class: "stg-chevron" }, icon("chevronRight", 18)),
        () => {
          const blob = new Blob([exportData()], { type: "application/json" });
          const a = h("a", {
            href: URL.createObjectURL(blob),
            download: `fitness-backup-${curUsername.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.json`
          });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
      ),
      row(
        t("settings.importJsonBtn"),
        t("settings.importJsonSub"),
        h("span", { class: "stg-chevron" }, icon("chevronRight", 18)),
        () => fileInp.click()
      ),
      fileInp
    );

    /* Category 5: ПРИЛОЖЕНИЕ */
    const installed = isStandalone();
    const appCard = h("div", { class: "stg-card" },
      row(
        t("settings.installTitle"),
        t("settings.installSub"),
        installed
          ? h("span", { class: "stg-installed-badge" }, icon("check", 14), t("settings.installedBadge"))
          : h("button", {
            type: "button",
            class: "btn-pill-solid",
            onclick: e => { e.stopPropagation(); promptPwaInstall(); }
          }, t("settings.installBtn")),
        installed ? null : () => promptPwaInstall()
      ),
      row(
        t("settings.version"),
        null,
        h("span", { class: "stg-version-badge" }, "1.4.2 · " + t("settings.versionCurrent"))
      )
    );

    /* Category 6: АККАУНТ */
    const accountCard = h("div", { class: "stg-card" },
      row(
        t("settings.changePassword"),
        t("settings.changePasswordSub"),
        h("span", { class: "stg-chevron" }, icon("chevronRight", 18)),
        () => changePassword()
      ),
      row(
        t("settings.logout"),
        null,
        h("span", { class: "stg-chevron" }, icon("chevronRight", 18)),
        async () => {
          if (!(await confirmDialog(t("settings.logoutConfirm", { user: curUsername }), { ok: t("settings.logoutOk") }))) return;
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
      ),
      row(
        t("settings.deleteAccount"),
        t("settings.deleteAccountSub"),
        h("span", { class: "stg-chevron danger" }, icon("chevronRight", 18)),
        () => openDeleteAccount(),
        true
      )
    );

    /* Сборка экрана */
    wrap.append(
      profileCard,
      buildCategory("appearance", t("settings.appearanceGroup"), appearanceCard),
      buildCategory("workout", t("settings.workoutGroup"), workoutCard),
      buildCategory("body", t("settings.bodyMetricsGroup"), bodyCard),
      buildCategory("data", t("settings.dataGroup"), dataCard),
      buildCategory("app", t("settings.appGroup"), appCard),
      buildCategory("account", t("settings.accountGroup"), accountCard)
    );
  }

  renderContent();
  sh = sheet(wrap, { title: t("settings.title"), full: true, backBtn: true });
}
