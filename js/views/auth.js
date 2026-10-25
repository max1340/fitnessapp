// Экран входа, регистрации и начальной пошаговой настройки профиля (Onboarding).
import { h, clear, parseNum, fmtNum, fmtRest, icon, toast, haptic } from "../ui.js";
import {
  state, updateSettings, loginWithEmail, registerNewProfile, sendPasswordReset,
  getLastEmail, getCommonCatalogLocalized, unitLabel
} from "../store.js";
import { authErrorMessage, MIN_PASSWORD_LEN } from "../auth.js";
import { t, getLang } from "../i18n.js";
import { applyTheme } from "./settings.js";

export function openAuthScreen(onSuccess) {
  let el = document.getElementById("auth-screen");
  if (!el) {
    el = h("div", { id: "auth-screen", class: "auth-screen" });
    document.body.append(el);
  }
  document.body.classList.add("auth-open");

  let mode = "login"; // "login" | "register" | "reset"
  let step = 1;       // 1 | 2 | 3

  // Поля входа
  let loginEmail = getLastEmail(); // подставляется только email, пароль нигде не хранится
  let loginPass = "";
  let resetInfo = "";
  let step1Error = "";

  // Поля регистрации и настройки
  let regEmail = "";
  let regPass = "";
  let regName = "";
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
        class: "auth-tab" + (mode !== "register" ? " active" : ""),
        onclick: () => { mode = "login"; render(); }
      }, t("auth.tabLogin")),
      h("button", {
        type: "button",
        class: "auth-tab" + (mode === "register" ? " active" : ""),
        onclick: () => { mode = "register"; render(); }
      }, t("auth.tabRegister"))
    );

    const body = h("div", { class: "auth-body stack" });

    if (mode === "reset") {
      const emailInp = h("input", {
        type: "email", value: loginEmail, placeholder: t("auth.emailPlaceholder"),
        autocomplete: "email", autocapitalize: "none", inputmode: "email",
        oninput: e => { loginEmail = e.target.value; }
      });
      const errEl = h("p", { class: "error", hidden: true });
      const okEl = h("p", { class: "muted small", hidden: !resetInfo }, resetInfo);
      const sendBtn = h("button", { class: "btn primary block", type: "submit" }, t("auth.resetSendBtn"));
      body.append(h("form", {
        class: "stack",
        onsubmit: async ev => {
          ev.preventDefault();
          errEl.hidden = true; okEl.hidden = true;
          sendBtn.disabled = true;
          try {
            await sendPasswordReset(emailInp.value);
            haptic("success");
            // не раскрываем, существует ли такой email
            resetInfo = t("auth.resetSent");
            okEl.textContent = resetInfo; okEl.hidden = false;
          } catch (err) {
            haptic("error");
            // user-not-found не показываем (защита от перебора email)
            if (err && err.code === "auth/user-not-found") { resetInfo = t("auth.resetSent"); okEl.textContent = resetInfo; okEl.hidden = false; }
            else { errEl.textContent = authErrorMessage(err); errEl.hidden = false; }
          }
          sendBtn.disabled = false;
        }
      },
        h("p", { class: "muted small" }, t("auth.resetHint")),
        h("label", { class: "field" }, h("span", {}, t("auth.emailLabel")), emailInp),
        okEl, errEl, sendBtn,
        h("button", { class: "btn block", type: "button", onclick: () => { mode = "login"; resetInfo = ""; render(); } }, t("auth.backToLogin"))
      ));
    } else if (mode === "login") {
      const emailInp = h("input", {
        type: "email",
        value: loginEmail,
        placeholder: t("auth.emailPlaceholder"),
        autocomplete: "username",
        autocapitalize: "none",
        inputmode: "email",
        oninput: e => { loginEmail = e.target.value; }
      });
      const passInp = h("input", {
        type: "password",
        value: loginPass,
        placeholder: t("auth.passwordPlaceholder"),
        autocomplete: "current-password",
        enterkeyhint: "done",
        oninput: e => { loginPass = e.target.value; }
      });
      const errEl = h("p", { class: "error", hidden: true });
      const submitBtn = h("button", { class: "btn primary block", type: "submit" }, t("auth.loginBtn"));

      const form = h("form", {
        class: "stack",
        onsubmit: async ev => {
          ev.preventDefault();
          errEl.hidden = true;
          if (!emailInp.value.trim() || !passInp.value) {
            haptic("error");
            errEl.textContent = t("auth.errFillAll");
            errEl.hidden = false;
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = t("auth.loggingIn");
          try {
            const u = await loginWithEmail(emailInp.value, passInp.value);
            loginPass = "";
            haptic("success");
            toast(t("auth.welcomeToast", { user: u.displayName || u.email }));
            closeAuth();
            if (onSuccess) await onSuccess(u);
          } catch (err) {
            haptic("error");
            errEl.textContent = authErrorMessage(err);
            errEl.hidden = false;
            submitBtn.disabled = false;
            submitBtn.textContent = t("auth.loginBtn");
          }
        }
      },
        h("label", { class: "field" }, h("span", {}, t("auth.emailLabel")), emailInp),
        h("label", { class: "field" }, h("span", {}, t("auth.passwordLabel")), passInp),
        errEl,
        submitBtn,
        h("button", { class: "btn block", type: "button", onclick: () => { loginEmail = emailInp.value; mode = "reset"; resetInfo = ""; render(); } }, t("auth.forgotPassword")),
        h("button", { class: "btn block", type: "button", onclick: () => { loginEmail = emailInp.value; regEmail = regEmail || emailInp.value; mode = "register"; step = 1; render(); } }, t("auth.createAccount"))
      );

      body.append(form);    } else {
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
        const emailInp = h("input", {
          type: "email",
          value: regEmail,
          placeholder: t("auth.emailPlaceholder"),
          autocomplete: "email",
          autocapitalize: "none",
          inputmode: "email",
          oninput: e => { regEmail = e.target.value; }
        });
        const passInp = h("input", {
          type: "password",
          value: regPass,
          placeholder: t("auth.passwordPlaceholder"),
          autocomplete: "new-password",
          oninput: e => { regPass = e.target.value; }
        });
        const nameInp = h("input", {
          type: "text",
          value: regName,
          maxlength: "60",
          placeholder: t("auth.namePlaceholder"),
          autocomplete: "name",
          oninput: e => { regName = e.target.value; }
        });
        const errEl = h("p", { class: "error", hidden: !step1Error }, step1Error);
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
          onsubmit: ev => {
            ev.preventDefault();
            errEl.hidden = true;
            step1Error = "";
            const fail = msg => { haptic("error"); step1Error = msg; errEl.textContent = msg; errEl.hidden = false; };
            const email = emailInp.value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail(t("auth.errInvalidEmail")); emailInp.focus(); return; }
            if (passInp.value.length < MIN_PASSWORD_LEN) { fail(t("auth.err.weakPassword")); passInp.focus(); return; }
            if (!nameInp.value.trim()) { fail(t("auth.errNameRequired")); nameInp.focus(); return; }
            // аккаунт создаётся на последнем шаге; здесь только проверка полей на клиенте
            haptic("medium");
            regEmail = email;
            regPass = passInp.value;
            regName = nameInp.value.trim();
            step = 2;
            render();
          }
        },
          h("label", { class: "field" }, h("span", {}, t("settings.theme")), themeRow),
          h("label", { class: "field" }, h("span", {}, t("auth.emailLabel")), emailInp),
          h("label", { class: "field" },
            h("span", {}, t("auth.regPasswordLabel")),
            passInp,
            h("small", { class: "muted" }, t("auth.regPasswordHint"))),
          h("label", { class: "field" }, h("span", {}, t("auth.nameLabel")), nameInp),
          errEl,
          nextBtn
        );
        body.append(form);      } else if (step === 2) {
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
            haptic("medium");
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
            haptic("error");
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
              email: regEmail,
              password: regPass,
              displayName: regName,
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
            regPass = "";
            haptic("success");
            toast(t("auth.welcomeToast", { user: u.displayName || u.email }));
            closeAuth();
            if (onSuccess) await onSuccess(u);
          } catch (err) {
            haptic("error");
            const code = err && err.code;
            // ошибки полей шага 1 возвращают пользователя на первый шаг
            if (code === "auth/email-already-in-use" || code === "auth/weak-password" || code === "auth/invalid-email") {
              step1Error = authErrorMessage(err);
              step = 1;
              render();
              return;
            }
            errEl.textContent = authErrorMessage(err);
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
