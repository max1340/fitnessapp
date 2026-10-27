// Авторизация, вход и пошаговый мастер первичной настройки (Onboarding).
import { h, clear, parseNum, fmtNum, fmtRest, icon, toast, haptic } from "../ui.js";
import {
  state, updateSettings, loginWithEmail, registerNewProfile, sendPasswordReset,
  getLastEmail, getCommonCatalogLocalized, unitLabel
} from "../store.js";
import { authErrorMessage, MIN_PASSWORD_LEN } from "../auth.js";
import { t, getLang } from "../i18n.js";
import { applyTheme } from "./settings.js";
import { canShowInstallBanner, renderSlimInstallBanner } from "../pwa.js";

function getPasswordStrength(pwd) {
  if (!pwd || pwd.length < 8) {
    return { score: pwd && pwd.length > 0 ? 1 : 0, key: "auth.pwdStrengthWeak", cls: "weak" };
  }
  let bonus = 0;
  if (/[0-9]/.test(pwd)) bonus++;
  if (/[A-ZА-Я]/.test(pwd) && /[a-zа-я]/.test(pwd)) bonus++;
  if (/[^A-Za-z0-9А-Яа-я]/.test(pwd)) bonus++;

  if (bonus >= 2) return { score: 3, key: "auth.pwdStrengthStrong", cls: "strong" };
  if (bonus >= 1) return { score: 2, key: "auth.pwdStrengthMedium", cls: "medium" };
  return { score: 1, key: "auth.pwdStrengthWeak", cls: "weak" };
}

export function openAuthScreen(onSuccess) {
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("hide");
    setTimeout(() => { if (splash && splash.parentNode) splash.remove(); }, 150);
  }
  let el = document.getElementById("auth-screen");
  if (!el) {
    el = h("div", { id: "auth-screen", class: "auth-screen" });
    document.body.append(el);
  }
  document.body.classList.add("auth-open");

  let mode = "login"; // "login" | "register" | "reset"
  let step = 1;       // 1 | 2 | 3

  // Вход
  let loginEmail = getLastEmail() || "";
  let loginPass = "";
  let loginError = "";
  let loginLoading = false;
  let showLoginPass = false;

  // Восстановление пароля
  let resetEmail = loginEmail;
  let resetInfo = "";
  let resetError = "";
  let resetLoading = false;

  // Регистрация и мастер
  let regEmail = "";
  let regPass = "";
  let regName = "";
  let showRegPass = false;
  let regBw = state.settings.bodyweightKg ? fmtNum(state.settings.bodyweightKg) : "";
  let regUnit = state.settings.defaultUnit || "kg";
  let regRest = state.settings.restSec || 210;
  let customRestActive = ![120, 180, 210, 240].includes(Number(regRest));

  let progMode = "template"; // "template" | "custom" | "skip"
  let customProgName = "";
  const selectedExMap = new Map(); // exId -> { sets: 3, targetReps: "8-10" }

  let wizardError = "";
  let wizardSubmitting = false;

  function closeAuth() {
    document.body.classList.remove("auth-open");
    el.remove();
  }

  function renderSuccessScreen() {
    clear(el);
    const wrap = h("div", { class: "auth-success-screen" });
    wrap.innerHTML = `
      <svg class="auth-success-svg" viewBox="0 0 52 52" fill="none">
        <circle class="auth-success-circle" cx="26" cy="26" r="24"></circle>
        <path class="auth-success-check" d="M14 27l8 8 16-16"></path>
      </svg>
      <div class="auth-success-title">${t("auth.successTitle")}</div>
      <div class="auth-success-sub">${t("auth.successSub")}</div>
    `;
    el.append(wrap);
  }

  function render() {
    clear(el);
    const curLang = getLang();
    const curTheme = state.settings.theme || "dark";

    // Segmented language switch RU/EN
    const langSegmented = h("div", { class: "auth-lang-segmented" },
      h("button", {
        type: "button",
        class: "auth-lang-btn" + (curLang === "ru" ? " active" : ""),
        onclick: () => { updateSettings({ lang: "ru" }); render(); }
      }, "RU"),
      h("button", {
        type: "button",
        class: "auth-lang-btn" + (curLang === "en" ? " active" : ""),
        onclick: () => { updateSettings({ lang: "en" }); render(); }
      }, "EN")
    );

    // =========================================================================
    // MODE: RESET PASSWORD
    // =========================================================================
    if (mode === "reset") {
      const emailInp = h("input", {
        id: "reset-email",
        class: "auth-input",
        type: "email",
        value: resetEmail,
        placeholder: "you@example.com",
        autocomplete: "email",
        autocapitalize: "none",
        inputmode: "email",
        oninput: e => { resetEmail = e.target.value; }
      });

      const errEl = h("div", { class: "auth-err-slot", "aria-live": "polite" });
      if (resetError) errEl.append(icon("x", 14), resetError);

      const okEl = h("div", { class: "auth-helper-text", style: "color: #10b981;", hidden: !resetInfo }, resetInfo);

      const sendBtn = h("button", {
        class: "auth-submit-btn",
        type: "submit",
        disabled: resetLoading
      }, resetLoading ? [h("span", { class: "auth-spinner" }), t("auth.resetSendBtn")] : t("auth.resetSendBtn"));

      const form = h("form", {
        class: "auth-form",
        onsubmit: async ev => {
          ev.preventDefault();
          resetError = "";
          resetInfo = "";
          const targetEmail = (emailInp.value || "").trim();
          if (!targetEmail || !targetEmail.includes("@")) {
            resetError = t("auth.errInvalidEmail");
            render();
            return;
          }
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            resetError = t("auth.err.offline");
            render();
            return;
          }
          resetLoading = true;
          render();
          try {
            await sendPasswordReset(targetEmail);
            haptic("success");
            resetInfo = t("auth.resetSent");
            toast(t("auth.resetSentToast", { email: targetEmail }));
          } catch (err) {
            haptic("error");
            resetError = authErrorMessage(err);
          }
          resetLoading = false;
          render();
        }
      },
        h("div", { class: "auth-field" },
          h("label", { for: "reset-email", class: "auth-label" }, "Email"),
          emailInp
        ),
        okEl,
        errEl,
        sendBtn,
        h("button", {
          type: "button",
          class: "auth-forgot-link",
          onclick: () => { mode = "login"; resetInfo = ""; resetError = ""; render(); }
        }, t("auth.backToLogin"))
      );

      const resetCard = h("div", { class: "auth-card" },
        h("div", { class: "auth-hero-row" },
          h("div", { class: "auth-brand" },
            h("div", { class: "auth-logo" }, icon("dumbbell", 26)),
            h("div", { class: "auth-wordmark" }, t("app.splashTitle") || "ТРЕНИРОВКИ")
          ),
          langSegmented
        ),
        h("div", {},
          h("h2", { class: "auth-hero-title", style: "font-size: 18px;" }, t("auth.forgotPassword")),
          h("p", { class: "auth-hero-sub" }, t("auth.resetHint"))
        ),
        form
      );

      el.append(resetCard);
      setTimeout(() => emailInp.focus(), 100);
      return;
    }

    // =========================================================================
    // MODE: LOGIN
    // =========================================================================
    if (mode === "login") {
      const emailInp = h("input", {
        id: "login-email",
        class: "auth-input",
        type: "email",
        value: loginEmail,
        placeholder: "test@mail.com",
        autocomplete: "username",
        autocapitalize: "none",
        inputmode: "email",
        oninput: e => { loginEmail = e.target.value; }
      });

      const passInp = h("input", {
        id: "login-pass",
        class: "auth-input",
        type: showLoginPass ? "text" : "password",
        value: loginPass,
        placeholder: "••••••••",
        autocomplete: "current-password",
        enterkeyhint: "done",
        oninput: e => { loginPass = e.target.value; }
      });

      const eyeBtn = h("button", {
        type: "button",
        class: "auth-eye-btn",
        "aria-label": showLoginPass ? "Hide password" : "Show password",
        onclick: () => {
          showLoginPass = !showLoginPass;
          passInp.type = showLoginPass ? "text" : "password";
          render();
        }
      }, icon(showLoginPass ? "eyeOff" : "eye", 18));

      const passWrap = h("div", { class: "auth-field-with-btn" }, passInp, eyeBtn);

      const errEl = h("div", { class: "auth-err-slot", "aria-live": "polite" });
      if (loginError) errEl.append(icon("x", 14), loginError);

      const submitBtn = h("button", {
        class: "auth-submit-btn",
        type: "submit",
        disabled: loginLoading
      }, loginLoading ? [h("span", { class: "auth-spinner" }), t("auth.loggingIn")] : t("auth.loginBtn"));

      const forgotLink = h("button", {
        type: "button",
        class: "auth-forgot-link",
        onclick: () => {
          resetEmail = emailInp.value || loginEmail;
          mode = "reset";
          resetInfo = "";
          resetError = "";
          render();
        }
      }, t("auth.forgotPassword"));

      const trustRow = h("div", { class: "auth-trust-row" },
        icon("lock", 13),
        h("span", {}, t("auth.trustNotice"))
      );

      const form = h("form", {
        class: "auth-form",
        onsubmit: async ev => {
          ev.preventDefault();
          loginError = "";
          const em = emailInp.value.trim();
          const pw = passInp.value;
          if (!em || !pw) {
            haptic("error");
            loginError = t("auth.errFillAll");
            render();
            if (!em) emailInp.focus();
            else passInp.focus();
            return;
          }
          loginLoading = true;
          render();
          try {
            const u = await loginWithEmail(em, pw);
            loginPass = "";
            haptic("success");
            toast(t("auth.welcomeToast", { user: u.displayName || u.email }));
            closeAuth();
            if (onSuccess) await onSuccess(u);
          } catch (err) {
            haptic("error");
            loginError = authErrorMessage(err);
            loginLoading = false;
            render();
          }
        }
      },
        h("div", { class: "auth-field" },
          h("label", { for: "login-email", class: "auth-label" }, "Email"),
          emailInp
        ),
        h("div", { class: "auth-field" },
          h("label", { for: "login-pass", class: "auth-label" }, t("auth.passwordLabel")),
          passWrap
        ),
        errEl,
        submitBtn,
        forgotLink,
        trustRow
      );

      const tabsSegmented = h("div", { class: "auth-tabs" },
        h("button", {
          type: "button",
          class: "auth-tab active",
          onclick: () => {}
        }, t("auth.tabLogin")),
        h("button", {
          type: "button",
          class: "auth-tab",
          onclick: () => {
            regEmail = regEmail || loginEmail;
            mode = "register";
            step = 1;
            wizardError = "";
            render();
          }
        }, t("auth.tabRegister"))
      );

      const loginCard = h("div", { class: "auth-card" },
        h("div", { class: "auth-hero-row" },
          h("div", { class: "auth-brand" },
            h("div", { class: "auth-logo" }, icon("dumbbell", 26)),
            h("div", { class: "auth-wordmark" }, t("app.splashTitle") || "ТРЕНИРОВКИ")
          ),
          langSegmented
        ),
        h("div", {},
          h("h1", { class: "auth-hero-title" }, t("auth.heroOffer")),
          h("p", { class: "auth-hero-sub" }, t("auth.heroTrust"))
        ),
        tabsSegmented,
        form
      );

      const layoutWrap = h("div", { style: "display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 400px; margin: auto;" },
        loginCard
      );

      const pwaSlim = renderSlimInstallBanner();
      if (pwaSlim) {
        layoutWrap.append(pwaSlim);
      }

      el.append(layoutWrap);
      return;
    }

    // =========================================================================
    // MODE: REGISTER (3-Step Fullscreen Onboarding Wizard)
    // =========================================================================
    const stepTitles = [
      t("auth.step1Header"),
      t("auth.step2Header"),
      t("auth.step3Header")
    ];

    const wizardBackBtn = h("button", {
      type: "button",
      class: "auth-wizard-back",
      "aria-label": t("auth.backBtn"),
      onclick: () => {
        haptic("light");
        if (step === 1) {
          mode = "login";
          wizardError = "";
          render();
        } else if (step === 2) {
          step = 1;
          wizardError = "";
          render();
        } else if (step === 3) {
          step = 2;
          wizardError = "";
          render();
        }
      }
    }, icon("arrowLeft", 18));

    const wizardHeader = h("div", { class: "auth-wizard-header" },
      wizardBackBtn,
      h("span", { class: "auth-wizard-title" }, stepTitles[step - 1]),
      h("span", { class: "auth-wizard-counter" }, `${step}/3`)
    );

    const progressLine = h("div", { class: "auth-progress-track" },
      h("div", {
        class: "auth-progress-bar",
        style: `width: ${step === 1 ? "33.33%" : (step === 2 ? "66.66%" : "100%")};`
      })
    );

    const wizardBody = h("div", { class: "auth-wizard-body" });

    // STEP 1: АККАУНТ
    if (step === 1) {
      const leadText = h("p", { class: "auth-lead-text" }, t("auth.step1Sub"));

      const nameInp = h("input", {
        id: "reg-name",
        class: "auth-input",
        type: "text",
        value: regName,
        maxlength: "60",
        placeholder: t("auth.namePlaceholder"),
        autocomplete: "name",
        oninput: e => { regName = e.target.value; }
      });

      const emailInp = h("input", {
        id: "reg-email",
        class: "auth-input",
        type: "email",
        value: regEmail,
        placeholder: "you@example.com",
        autocomplete: "email",
        autocapitalize: "none",
        inputmode: "email",
        oninput: e => { regEmail = e.target.value; }
      });

      const passInp = h("input", {
        id: "reg-pass",
        class: "auth-input",
        type: showRegPass ? "text" : "password",
        value: regPass,
        placeholder: t("auth.passwordRegPlaceholder"),
        autocomplete: "new-password",
        oninput: e => {
          regPass = e.target.value;
          updateMeter();
        }
      });

      const eyeBtn = h("button", {
        type: "button",
        class: "auth-eye-btn",
        "aria-label": showRegPass ? "Hide password" : "Show password",
        onclick: () => {
          showRegPass = !showRegPass;
          passInp.type = showRegPass ? "text" : "password";
          render();
        }
      }, icon(showRegPass ? "eyeOff" : "eye", 18));

      const passWrap = h("div", { class: "auth-field-with-btn" }, passInp, eyeBtn);

      const seg1 = h("div", { class: "auth-pwd-segment" });
      const seg2 = h("div", { class: "auth-pwd-segment" });
      const seg3 = h("div", { class: "auth-pwd-segment" });
      const meterRow = h("div", { class: "auth-pwd-meter", "aria-hidden": "true" }, seg1, seg2, seg3);
      const hintText = h("div", { class: "auth-pwd-hint" }, t("auth.pwdStrengthWeak"));

      function updateMeter() {
        const str = getPasswordStrength(regPass);
        seg1.className = "auth-pwd-segment" + (str.score >= 1 ? " active-" + str.cls : "");
        seg2.className = "auth-pwd-segment" + (str.score >= 2 ? " active-" + str.cls : "");
        seg3.className = "auth-pwd-segment" + (str.score >= 3 ? " active-" + str.cls : "");
        hintText.textContent = t(str.key);
      }
      updateMeter();

      const errEl = h("div", { class: "auth-err-slot", "aria-live": "polite" });
      if (wizardError) errEl.append(icon("x", 14), wizardError);

      wizardBody.append(
        h("div", { class: "auth-field" },
          h("label", { for: "reg-name", class: "auth-label" }, t("auth.nameLabel")),
          nameInp
        ),
        h("div", { class: "auth-field" },
          h("label", { for: "reg-email", class: "auth-label" }, "Email"),
          emailInp
        ),
        h("div", { class: "auth-field" },
          h("label", { for: "reg-pass", class: "auth-label" }, t("auth.passwordLabel")),
          passWrap,
          meterRow,
          hintText
        ),
        errEl
      );
    }

    // STEP 2: ПАРАМЕТРЫ
    else if (step === 2) {
      const leadText = h("p", { class: "auth-lead-text" }, t("auth.step2Sub"));

      // Bodyweight with integrated unit segmented inside field
      const bwInp = h("input", {
        id: "reg-bw",
        class: "auth-input",
        type: "text",
        inputmode: "decimal",
        value: regBw,
        placeholder: "80,0",
        oninput: e => { regBw = e.target.value; }
      });

      const unitBtnKg = h("button", {
        type: "button",
        class: "auth-unit-btn" + (regUnit === "kg" ? " active" : ""),
        onclick: () => { regUnit = "kg"; render(); }
      }, unitLabel("kg"));

      const unitBtnLb = h("button", {
        type: "button",
        class: "auth-unit-btn" + (regUnit === "lb" ? " active" : ""),
        onclick: () => { regUnit = "lb"; render(); }
      }, "lb");

      const unitSegmented = h("div", { class: "auth-unit-segmented" }, unitBtnKg, unitBtnLb);
      const bwWrap = h("div", { class: "auth-input-unit-wrap" }, bwInp, unitSegmented);

      // Rest Presets + Custom Stepper
      const restPresets = [120, 180, 210, 240];
      const curRestSec = Number(regRest) || 210;

      const restChips = restPresets.map(sec => h("button", {
        type: "button",
        class: "auth-chip-btn" + (!customRestActive && curRestSec === sec ? " active" : ""),
        onclick: () => {
          regRest = sec;
          customRestActive = false;
          haptic("light");
          render();
        }
      }, fmtRest(sec)));

      const customChip = h("button", {
        type: "button",
        class: "auth-chip-btn" + (customRestActive ? " active" : ""),
        onclick: () => {
          customRestActive = true;
          haptic("light");
          render();
        }
      }, t("auth.restCustom"));

      restChips.push(customChip);
      const restRow = h("div", { class: "auth-chips-row" }, ...restChips);

      // Custom Rest Stepper (only visible if customRestActive)
      let customStepperEl = null;
      if (customRestActive) {
        const valEl = h("span", { class: "builder-stepper-val" }, fmtRest(regRest));
        const minusBtn = h("button", {
          type: "button",
          class: "builder-stepper-btn",
          onclick: () => {
            regRest = Math.max(30, Number(regRest) - 15);
            valEl.textContent = fmtRest(regRest);
            haptic("light");
          }
        }, icon("minus", 16));

        const plusBtn = h("button", {
          type: "button",
          class: "builder-stepper-btn",
          onclick: () => {
            regRest = Math.min(600, Number(regRest) + 15);
            valEl.textContent = fmtRest(regRest);
            haptic("light");
          }
        }, icon("plus", 16));

        customStepperEl = h("div", { style: "display: flex; align-items: center; gap: 12px; margin-top: 6px;" },
          h("span", { style: "font-size: 13px; font-weight: 500; color: var(--ink-2);" }, t("auth.restCustomTitle")),
          h("div", { class: "builder-stepper" }, minusBtn, valEl, plusBtn)
        );
      }

      // Theme Chips
      const themes = [
        ["system", t("settings.themeSystem")],
        ["light", t("settings.themeLight")],
        ["dark", t("settings.themeDark")]
      ];
      const themeChips = themes.map(([val, lbl]) => h("button", {
        type: "button",
        class: "auth-chip-btn" + (curTheme === val ? " active" : ""),
        onclick: () => {
          updateSettings({ theme: val });
          applyTheme();
          haptic("light");
          render();
        }
      }, lbl));

      const themeRow = h("div", { class: "auth-chips-row" }, ...themeChips);

      wizardBody.append(
        leadText,
        h("div", { class: "auth-field" },
          h("div", { class: "auth-label-row" },
            h("label", { for: "reg-bw", class: "auth-label" }, t("progress.bwTitle") || "Вес тела"),
            h("span", { class: "auth-label-optional" }, t("auth.bwOptional"))
          ),
          bwWrap,
          h("div", { class: "auth-helper-text" }, t("auth.bwHelper"))
        ),
        h("div", { class: "auth-field" },
          h("div", { class: "auth-label-row" },
            h("span", { class: "auth-label" }, t("settings.restSec")),
            h("span", { style: "color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums;" }, `(${fmtRest(regRest)})`)
          ),
          restRow,
          customStepperEl,
          h("div", { class: "auth-helper-text" }, t("auth.restHelper"))
        ),
        h("div", { class: "auth-field" },
          h("span", { class: "auth-label" }, t("auth.themeLabel")),
          themeRow
        )
      );

      setTimeout(() => bwInp.focus(), 100);
    }

    // STEP 3: ПЕРВАЯ ПРОГРАММА
    else if (step === 3) {
      const leadText = h("p", { class: "auth-lead-text" }, t("auth.step3Sub"));

      // Option 1: Template
      const tplRadioDot = h("div", { class: "auth-radio-dot" });
      const tplRadioCircle = h("div", { class: "auth-radio-circle" }, tplRadioDot);
      const tplCard = h("div", {
        class: "auth-radio-row" + (progMode === "template" ? " selected" : ""),
        role: "radio",
        "aria-checked": progMode === "template" ? "true" : "false",
        onclick: () => {
          progMode = "template";
          haptic("light");
          render();
        }
      },
        h("div", { class: "auth-radio-head" },
          tplRadioCircle,
          h("div", { class: "auth-radio-info" },
            h("span", { class: "auth-radio-title" }, t("auth.progModeTemplate")),
            h("span", { class: "auth-radio-meta" }, t("auth.tplMeta"))
          )
        ),
        h("div", { class: "auth-radio-sub" }, t("auth.progModeTemplateSub"))
      );

      // Option 2: Custom Program
      const customRadioDot = h("div", { class: "auth-radio-dot" });
      const customRadioCircle = h("div", { class: "auth-radio-circle" }, customRadioDot);

      let customPickerEl = null;
      if (progMode === "custom") {
        const catalog = getCommonCatalogLocalized();
        const byMuscle = new Map();
        for (const ex of catalog) {
          const m = ex.muscleGroup || t("common.other");
          if (!byMuscle.has(m)) byMuscle.set(m, []);
          byMuscle.get(m).push(ex);
        }

        const nameInp = h("input", {
          id: "custom-prog-name",
          class: "auth-input",
          type: "text",
          value: customProgName || t("auth.defaultProgName"),
          placeholder: t("auth.defaultProgName"),
          style: "height: 42px; min-height: 42px; font-size: 14px;",
          oninput: e => { customProgName = e.target.value; }
        });

        const counterBadge = h("div", { class: "auth-counter-badge" },
          t("auth.selectedCountBadge", { n: selectedExMap.size })
        );

        const checklist = h("div", { class: "auth-ex-checklist" });

        for (const [mGroup, exs] of byMuscle) {
          checklist.append(h("div", { class: "auth-check-group-header" }, mGroup));
          for (const ex of exs) {
            const isChecked = selectedExMap.has(ex.id);
            const checkRow = h("div", {
              class: "auth-check-row" + (isChecked ? " checked" : ""),
              role: "checkbox",
              "aria-checked": isChecked ? "true" : "false",
              onclick: (e) => {
                e.stopPropagation();
                if (selectedExMap.has(ex.id)) {
                  selectedExMap.delete(ex.id);
                } else {
                  selectedExMap.set(ex.id, { sets: 3, targetReps: "8-10" });
                }
                haptic("light");
                render();
              }
            },
              h("span", { class: "grow" }, ex.name),
              isChecked ? icon("check", 16) : icon("plus", 16)
            );
            checklist.append(checkRow);
          }
        }

        customPickerEl = h("div", { class: "auth-custom-picker" },
          h("div", { class: "auth-field" },
            h("label", { for: "custom-prog-name", class: "auth-label" }, t("auth.progNameLabel")),
            nameInp
          ),
          counterBadge,
          checklist
        );
      }

      const customCard = h("div", {
        class: "auth-radio-row" + (progMode === "custom" ? " selected" : ""),
        role: "radio",
        "aria-checked": progMode === "custom" ? "true" : "false",
        onclick: () => {
          progMode = "custom";
          haptic("light");
          render();
        }
      },
        h("div", { class: "auth-radio-head" },
          customRadioCircle,
          h("div", { class: "auth-radio-info" },
            h("span", { class: "auth-radio-title" }, t("auth.progModeCustom")),
            h("span", { class: "auth-radio-meta" }, t("auth.customMeta"))
          )
        ),
        customPickerEl
      );

      // Option 3: Skip
      const skipRadioDot = h("div", { class: "auth-radio-dot" });
      const skipRadioCircle = h("div", { class: "auth-radio-circle" }, skipRadioDot);
      const skipCard = h("div", {
        class: "auth-radio-row" + (progMode === "skip" ? " selected" : ""),
        role: "radio",
        "aria-checked": progMode === "skip" ? "true" : "false",
        onclick: () => {
          progMode = "skip";
          haptic("light");
          render();
        }
      },
        h("div", { class: "auth-radio-head" },
          skipRadioCircle,
          h("div", { class: "auth-radio-info" },
            h("span", { class: "auth-radio-title" }, t("auth.progModeSkip")),
            h("span", { class: "auth-radio-meta" }, t("auth.skipMeta"))
          )
        )
      );

      const errEl = h("div", { class: "auth-err-slot", "aria-live": "polite" });
      if (wizardError) errEl.append(icon("x", 14), wizardError);

      const radioList = h("div", { class: "auth-radio-list" },
        tplCard,
        customCard,
        skipCard
      );

      wizardBody.append(
        leadText,
        radioList,
        errEl
      );
    }

    // STICKY WIZARD FOOTER
    const ghostBackBtn = h("button", {
      type: "button",
      class: "auth-btn-ghost",
      onclick: () => {
        haptic("light");
        if (step === 1) {
          mode = "login";
          wizardError = "";
          render();
        } else if (step === 2) {
          step = 1;
          wizardError = "";
          render();
        } else if (step === 3) {
          step = 2;
          wizardError = "";
          render();
        }
      }
    }, t("auth.backBtn"));

    const nextPrimaryBtn = h("button", {
      type: "button",
      class: "auth-btn-primary",
      disabled: wizardSubmitting,
      onclick: async () => {
        wizardError = "";
        if (step === 1) {
          const em = regEmail.trim();
          const nm = regName.trim();
          if (!nm) {
            haptic("error");
            wizardError = t("auth.errNameRequired");
            render();
            return;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            haptic("error");
            wizardError = t("auth.errInvalidEmail");
            render();
            return;
          }
          if (regPass.length < MIN_PASSWORD_LEN) {
            haptic("error");
            wizardError = t("auth.err.weakPassword");
            render();
            return;
          }
          haptic("medium");
          step = 2;
          render();
        } else if (step === 2) {
          haptic("medium");
          step = 3;
          render();
        } else if (step === 3) {
          if (progMode === "custom" && selectedExMap.size === 0) {
            haptic("error");
            wizardError = t("auth.selectAtLeastOne");
            render();
            return;
          }

          wizardSubmitting = true;
          render();

          try {
            const bwVal = parseNum(regBw);
            const customItems = [...selectedExMap.entries()].map(([exerciseId, cfg]) => ({
              exerciseId,
              sets: cfg.sets || 3,
              targetReps: cfg.targetReps || "8-10",
              restSec: Number(regRest) || 210,
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

            // Fullscreen success drawing checkmark
            renderSuccessScreen();
            setTimeout(async () => {
              closeAuth();
              toast(t("auth.welcomeToast", { user: u.displayName || u.email }));
              if (onSuccess) await onSuccess(u);
            }, 900);
          } catch (err) {
            haptic("error");
            wizardSubmitting = false;
            const code = err && err.code;
            if (code === "auth/email-already-in-use") {
              mode = "login";
              loginEmail = regEmail;
              loginPass = "";
              loginError = t("auth.emailAlreadyRegistered");
              step = 1;
              render();
              return;
            }
            if (code === "auth/weak-password" || code === "auth/invalid-email") {
              wizardError = authErrorMessage(err);
              step = 1;
              render();
              return;
            }
            wizardError = authErrorMessage(err);
            render();
          }
        }
      }
    },
      wizardSubmitting
        ? [h("span", { class: "auth-spinner" }), t("auth.creating")]
        : (step === 3 ? t("auth.finishBtn") : t("auth.nextBtn"))
    );

    const wizardFooter = h("div", { class: "auth-wizard-footer" },
      ghostBackBtn,
      nextPrimaryBtn
    );

    const wizardCard = h("div", { class: "auth-card auth-wizard-card" },
      wizardHeader,
      progressLine,
      wizardBody,
      wizardFooter
    );

    el.append(wizardCard);
  }

  render();
}
