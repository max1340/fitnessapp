// Экран входа, регистрации и начальной пошаговой настройки профиля (Onboarding).
import { h, clear, parseNum, fmtNum, fmtRest, icon, toast } from "../ui.js";
import {
  state, updateSettings, loginWithPin, registerNewProfile,
  getRememberedProfiles, getCommonCatalogLocalized, unitLabel
} from "../store.js";
import { normalizeUserId, fetchUserProfile } from "../db.js";
import { t, getLang } from "../i18n.js";
import { applyTheme } from "./settings.js";

export function openAuthScreen(onSuccess) {
  let el = document.getElementById("auth-screen");
  if (!el) {
    el = h("div", { id: "auth-screen", class: "auth-screen" });
    document.body.append(el);
  }
  document.body.classList.add("auth-open");

  let mode = "login"; // "login" | "register"
  let step = 1;       // 1 | 2 | 3

  // Поля входа
  let loginUser = "";
  let loginPin = "";
  let loginRemember = true;

  // Поля регистрации и настройки
  let regUser = "";
  let regPin = "";
  let regRemember = true;
  let regBw = state.settings.bodyweightKg ? fmtNum(state.settings.bodyweightKg) : "";
  let regUnit = state.settings.defaultUnit || "kg";
  let regRest = state.settings.restSec || 210;
  let progMode = "template"; // "custom" | "template" | "skip"
  let customProgName = "";
  const selectedExMap = new Map(); // exId -> { sets: 3, targetReps: "8-10" }

  function closeAuth() {
    document.body.classList.remove("auth-open");
    el.remove();
  }

  function render() {
    clear(el);
    const curLang = getLang();
    const curTheme = state.settings.theme || "dark";

    const langToggle = h("div", { class: "auth-lang-switch" },
      h("button", {
        type: "button",
        class: "btn small tag" + (curLang === "ru" ? " on" : ""),
        onclick: () => { updateSettings({ lang: "ru" }); render(); }
      }, "RU"),
      h("button", {
        type: "button",
        class: "btn small tag" + (curLang === "en" ? " on" : ""),
        onclick: () => { updateSettings({ lang: "en" }); render(); }
      }, "EN")
    );

    const header = h("header", { class: "auth-head" },
      h("div", { class: "auth-brand" },
        h("div", { class: "auth-logo" }, icon("dumbbell", 26)),
        h("div", {},
          h("h1", { class: "auth-title" }, t("app.splashTitle")),
          h("small", { class: "muted" }, t("auth.welcomeSub")))),
      langToggle
    );

    const tabs = h("div", { class: "auth-tabs" },
      h("button", {
        type: "button",
        class: "auth-tab" + (mode === "login" ? " active" : ""),
        onclick: () => { mode = "login"; render(); }
      }, t("auth.tabLogin")),
      h("button", {
        type: "button",
        class: "auth-tab" + (mode === "register" ? " active" : ""),
        onclick: () => { mode = "register"; render(); }
      }, t("auth.tabRegister"))
    );

    const body = h("div", { class: "auth-body stack" });

    if (mode === "login") {
      const recent = getRememberedProfiles();
      const userInp = h("input", {
        type: "text",
        value: loginUser,
        placeholder: t("auth.usernamePlaceholder"),
        autocomplete: "username",
        autocapitalize: "none",
        oninput: e => { loginUser = e.target.value; }
      });
      const pinInp = h("input", {
        type: "password",
        inputmode: "text",
        value: loginPin,
        placeholder: t("auth.pinPlaceholder"),
        autocomplete: "current-password",
        enterkeyhint: "done",
        oninput: e => { loginPin = e.target.value; }
      });
      const remChk = h("input", {
        type: "checkbox",
        checked: loginRemember,
        onchange: e => { loginRemember = e.target.checked; }
      });
      const errEl = h("p", { class: "error", hidden: true });
      const submitBtn = h("button", { class: "btn primary block", type: "submit" }, t("auth.loginBtn"));

      const recentBlock = recent.length
        ? h("div", { class: "stack" },
            h("small", { class: "muted" }, t("auth.recentProfiles")),
            h("div", { class: "row gap", style: "flex-wrap:wrap" },
              ...recent.map(r => h("button", {
                type: "button",
                class: "btn small tag" + (normalizeUserId(loginUser) === r.username ? " on" : ""),
                onclick: () => {
                  loginUser = r.username;
                  userInp.value = r.username;
                  pinInp.focus();
                }
              }, r.username))))
        : null;

      const form = h("form", {
        class: "stack",
        onsubmit: async ev => {
          ev.preventDefault();
          errEl.hidden = true;
          submitBtn.disabled = true;
          submitBtn.textContent = t("auth.loggingIn");
          try {
            const u = await loginWithPin(userInp.value, pinInp.value, remChk.checked);
            toast(t("auth.welcomeToast", { user: u.username }));
            closeAuth();
            if (onSuccess) await onSuccess(u);
          } catch (err) {
            errEl.textContent = err.message || String(err);
            errEl.hidden = false;
            submitBtn.disabled = false;
            submitBtn.textContent = t("auth.loginBtn");
          }
        }
      },
        recentBlock,
        h("label", { class: "field" }, h("span", {}, t("auth.usernameLabel")), userInp),
        h("label", { class: "field" }, h("span", {}, t("auth.pinLabel")), pinInp),
        h("label", { class: "check small" }, remChk, h("span", {}, t("auth.rememberMe"))),
        errEl,
        submitBtn
      );

      body.append(form);
    } else {
      // Режим регистрации и пошаговой настройки (Steps 1..3)
      const stepTitleKey = step === 1 ? "auth.step1Title" : step === 2 ? "auth.step2Title" : "auth.step3Title";
      const stepHeader = h("div", { class: "auth-steps" },
        h("div", { class: "auth-step-bars" },
          h("span", { class: "auth-step-bar" + (step >= 1 ? " on" : "") }),
          h("span", { class: "auth-step-bar" + (step >= 2 ? " on" : "") }),
          h("span", { class: "auth-step-bar" + (step >= 3 ? " on" : "") })),
        h("strong", { class: "small" }, t(stepTitleKey))
      );
      body.append(stepHeader);

      if (step === 1) {
        const userInp = h("input", {
          type: "text",
          value: regUser,
          placeholder: t("auth.regUsernamePlaceholder"),
          autocomplete: "off",
          autocapitalize: "none",
          oninput: e => { regUser = e.target.value; }
        });
        const pinInp = h("input", {
          type: "password",
          inputmode: "text",
          value: regPin,
          placeholder: t("auth.pinPlaceholder"),
          autocomplete: "new-password",
          oninput: e => { regPin = e.target.value; }
        });
        const remChk = h("input", {
          type: "checkbox",
          checked: regRemember,
          onchange: e => { regRemember = e.target.checked; }
        });
        const errEl = h("p", { class: "error", hidden: true });
        const nextBtn = h("button", { class: "btn primary block", type: "submit" }, t("auth.nextBtn"));

        const themeRow = h("div", { class: "row gap" },
          ...[["dark", t("settings.themeDark")], ["light", t("settings.themeLight")], ["system", t("settings.themeSystem")]].map(([val, lbl]) =>
            h("button", {
              type: "button",
              class: "btn small tag grow" + (curTheme === val ? " on" : ""),
              onclick: () => { updateSettings({ theme: val }); applyTheme(); render(); }
            }, lbl))
        );

        const form = h("form", {
          class: "stack",
          onsubmit: async ev => {
            ev.preventDefault();
            errEl.hidden = true;
            const cleanU = normalizeUserId(regUser);
            const cleanP = String(regPin || "").trim();
            if (!cleanU || cleanU.length < 3) {
              errEl.textContent = t("auth.errInvalidUser");
              errEl.hidden = false;
              userInp.focus();
              return;
            }
            if (cleanP.length < 4) {
              errEl.textContent = t("auth.errShortPin");
              errEl.hidden = false;
              pinInp.focus();
              return;
            }
            if (cleanU === "max_134") {
              errEl.textContent = t("auth.errUserTaken");
              errEl.hidden = false;
              return;
            }
            nextBtn.disabled = true;
            nextBtn.textContent = t("auth.checkingUser");
            try {
              const existing = await fetchUserProfile(cleanU).catch(() => null);
              if (existing) {
                errEl.textContent = t("auth.errUserTaken");
                errEl.hidden = false;
                nextBtn.disabled = false;
                nextBtn.textContent = t("auth.nextBtn");
                return;
              }
              regUser = cleanU;
              regPin = cleanP;
              step = 2;
              render();
            } catch (err) {
              errEl.textContent = err.message || String(err);
              errEl.hidden = false;
              nextBtn.disabled = false;
              nextBtn.textContent = t("auth.nextBtn");
            }
          }
        },
          h("label", { class: "field" }, h("span", {}, t("settings.theme")), themeRow),
          h("label", { class: "field" }, h("span", {}, t("auth.regUsernameLabel")), userInp),
          h("label", { class: "field" },
            h("span", {}, t("auth.regPinLabel")),
            pinInp,
            h("small", { class: "muted" }, t("auth.regPinHint"))),
          h("label", { class: "check small" }, remChk, h("span", {}, t("auth.rememberMe"))),
          errEl,
          nextBtn
        );
        body.append(form);
      } else if (step === 2) {
        const bwInp = h("input", {
          type: "text",
          inputmode: "decimal",
          value: regBw,
          placeholder: t("progress.bwPlaceholder"),
          oninput: e => { regBw = e.target.value; }
        });
        const unitRow = h("div", { class: "row gap" },
          ...[["kg", unitLabel("kg")], ["lb", "lb"]].map(([uVal, uLbl]) =>
            h("button", {
              type: "button",
              class: "btn small tag grow" + (regUnit === uVal ? " on" : ""),
              onclick: () => { regUnit = uVal; render(); }
            }, uLbl))
        );
        const restHint = h("span", { class: "muted" }, `(${fmtRest(regRest)})`);
        const restInp = h("input", {
          type: "text",
          inputmode: "numeric",
          value: String(regRest),
          oninput: e => {
            const v = parseNum(e.target.value);
            if (v && v > 0) {
              regRest = Math.round(v);
              restHint.textContent = `(${fmtRest(regRest)})`;
            }
          }
        });
        const restPresets = h("div", { class: "row gap" },
          ...[120, 180, 210, 240].map(sec =>
            h("button", {
              type: "button",
              class: "btn small tag grow" + (Number(regRest) === sec ? " on" : ""),
              onclick: () => { regRest = sec; render(); }
            }, fmtRest(sec)))
        );

        const form = h("form", {
          class: "stack",
          onsubmit: ev => {
            ev.preventDefault();
            step = 3;
            render();
          }
        },
          h("label", { class: "field" },
            h("span", {}, t("auth.bwLabel")),
            bwInp,
            h("small", { class: "muted" }, t("auth.bwHint"))),
          h("label", { class: "field" }, h("span", {}, t("auth.unitsLabel")), unitRow),
          h("div", { class: "field" },
            h("span", {}, t("auth.restLabel"), " ", restHint),
            restPresets,
            restInp),
          h("div", { class: "row gap" },
            h("button", { class: "btn grow", type: "button", onclick: () => { step = 1; render(); } }, t("auth.backBtn")),
            h("button", { class: "btn primary grow", type: "submit" }, t("auth.nextBtn")))
        );
        body.append(form);
      } else if (step === 3) {
        const errEl = h("p", { class: "error", hidden: true });
        const finishBtn = h("button", { class: "btn primary grow", type: "button" }, t("auth.finishBtn"));

        const modeCard = (mKey, title, sub) => h("button", {
          type: "button",
          class: "auth-mode-card" + (progMode === mKey ? " on" : ""),
          onclick: () => { progMode = mKey; render(); }
        },
          h("div", { class: "row gap", style: "justify-content:space-between" },
            h("strong", {}, title),
            progMode === mKey ? icon("check", 18) : null),
          h("small", { class: "muted" }, sub)
        );

        const customBuilder = progMode === "custom" ? (() => {
          const catalog = getCommonCatalogLocalized();
          const byMuscle = new Map();
          for (const ex of catalog) {
            const m = ex.muscleGroup || t("common.uncategorized");
            if (!byMuscle.has(m)) byMuscle.set(m, []);
            byMuscle.get(m).push(ex);
          }

          const countEl = h("small", { class: "muted" }, t("auth.selectedExCount", { n: selectedExMap.size }));
          const listWrap = h("div", { class: "auth-ex-picker" });

          for (const [mGroup, exs] of byMuscle) {
            listWrap.append(h("div", { class: "auth-ex-group" }, mGroup));
            for (const ex of exs) {
              const isSel = selectedExMap.has(ex.id);
              const itemBtn = h("button", {
                type: "button",
                class: "auth-ex-item" + (isSel ? " on" : ""),
                onclick: () => {
                  if (selectedExMap.has(ex.id)) selectedExMap.delete(ex.id);
                  else selectedExMap.set(ex.id, { sets: 3, targetReps: "8-10" });
                  render();
                }
              },
                h("span", { class: "grow" }, ex.name),
                isSel ? icon("check", 16) : icon("plus", 16)
              );
              listWrap.append(itemBtn);
            }
          }

          return h("div", { class: "stack auth-custom-box" },
            h("label", { class: "field" },
              h("span", {}, t("auth.progNameLabel")),
              h("input", {
                type: "text",
                value: customProgName || t("auth.defaultProgName"),
                placeholder: t("auth.defaultProgName"),
                oninput: e => { customProgName = e.target.value; }
              })),
            countEl,
            listWrap
          );
        })() : null;

        finishBtn.addEventListener("click", async () => {
          errEl.hidden = true;
          if (progMode === "custom" && selectedExMap.size === 0) {
            errEl.textContent = t("auth.selectAtLeastOne");
            errEl.hidden = false;
            return;
          }
          finishBtn.disabled = true;
          finishBtn.textContent = t("auth.creating");
          try {
            const bwVal = parseNum(regBw);
            const customItems = [...selectedExMap.entries()].map(([exerciseId, cfg]) => ({
              exerciseId,
              sets: cfg.sets || 3,
              targetReps: cfg.targetReps || "8-10",
              restSec: regRest || 210,
              note: ""
            }));
            const u = await registerNewProfile({
              username: regUser,
              pin: regPin,
              remember: regRemember,
              settingsPatch: {
                defaultUnit: regUnit,
                restSec: Number(regRest) || 210
              },
              bodyweightKg: bwVal && bwVal >= 20 && bwVal <= 300 ? bwVal : null,
              firstProgramMode: progMode,
              customProgram: {
                name: (customProgName || t("auth.defaultProgName")).trim(),
                items: customItems
              }
            });
            toast(t("auth.welcomeToast", { user: u.username }));
            closeAuth();
            if (onSuccess) await onSuccess(u);
          } catch (err) {
            errEl.textContent = err.message || String(err);
            errEl.hidden = false;
            finishBtn.disabled = false;
            finishBtn.textContent = t("auth.finishBtn");
          }
        });

        body.append(
          h("p", { class: "muted small" }, t("auth.sharedBaseInfo")),
          modeCard("template", t("auth.progModeTemplate"), t("auth.progModeTemplateSub")),
          modeCard("custom", t("auth.progModeCustom"), t("auth.progModeCustomSub")),
          customBuilder,
          modeCard("skip", t("auth.progModeSkip"), t("auth.progModeSkipSub")),
          errEl,
          h("div", { class: "row gap" },
            h("button", { class: "btn", type: "button", onclick: () => { step = 2; render(); } }, t("auth.backBtn")),
            finishBtn)
        );
      }
    }

    el.append(h("div", { class: "auth-card" }, header, tabs, body));
  }

  render();
}
