// Полноценный десктоп-режим (≥1024px) для «офисных» сценариев
// Токены, плотности, компоненты и раскладки 1:1 по референс-концепту
import {
  state, saveProgram, deleteProgram, saveExercise, getExercise, getProgram,
  deleteSession,
  activeSession, updateSettings, logBodyweight, deleteAccount, logoutProfile, uid,
  COMMON_LIBRARY_EXERCISES
} from "../store.js";
import { h, clear, icon, toast, showUndoSnackbar, sheet, confirmDialog, fmtRest, haptic } from "../ui.js";
import { entryVolume, entryE1rm, epley, toKg, fromKg, effectiveWeightKg, sessionStats } from "../metrics.js";
import { t, getLang, isEn, MONTHS, tMuscle } from "../i18n.js";
import { sharedState } from "../shell.js";
import { PROGRAM_TEMPLATES } from "./programs.js";
import { pickExercise, openExerciseForm } from "./exercises.js";
import { applyTheme } from "./settings.js";

/* ==========================================================================
   1. ПРОГРАММЫ (КОНСТРУКТОР) — MASTER-DETAIL
   ========================================================================== */

export function renderDesktopPrograms() {
  const container = h("section", { class: "view on", id: "v-programs" });

  const activePrograms = (state.programs || []).filter(p => !p.archived);
  if (!sharedState.selectedProgramId && activePrograms.length > 0) {
    sharedState.selectedProgramId = activePrograms[0].id;
  }

  // Header
  const title = h("h1", {}, t("nav.programs") || "Программы");
  const countSub = h("span", { class: "sub" }, isEn()
    ? `${activePrograms.length} programs`
    : `${activePrograms.length} ${pluralize(activePrograms.length, "программа", "программы", "программ")}`);
  const spacer = h("span", { class: "spacer" });
  const newProgBtnTop = h("button", {
    type: "button",
    class: "btnP",
    onclick: () => startNewProgram()
  }, "+ " + (isEn() ? "Program" : "Программа"));

  const topbar = h("header", { class: "topbar" }, title, countSub, spacer, newProgBtnTop);

  // Layout: colsProg (360px master + detail editor)
  const cols = h("div", { class: "colsProg" });
  const pList = h("div", { class: "pList" });
  const editorBox = h("div", { class: "editor" });

  let editingProgram = null;
  let isDirty = false;

  function loadProgramForEdit(progId) {
    if (progId === "new") {
      editingProgram = {
        id: uid(),
        name: isEn() ? "New Program" : "Новая программа",
        archived: false,
        items: []
      };
      isDirty = true;
    } else {
      const found = state.programs.find(p => p.id === progId);
      if (found) {
        editingProgram = JSON.parse(JSON.stringify(found));
        editingProgram.items = editingProgram.items || [];
        editingProgram.items.forEach(it => { if (!it._key) it._key = uid(); });
        isDirty = false;
      } else if (activePrograms.length > 0) {
        editingProgram = JSON.parse(JSON.stringify(activePrograms[0]));
        editingProgram.items = editingProgram.items || [];
        editingProgram.items.forEach(it => { if (!it._key) it._key = uid(); });
        sharedState.selectedProgramId = editingProgram.id;
        isDirty = false;
      } else {
        editingProgram = {
          id: uid(),
          name: isEn() ? "New Program" : "Новая программа",
          archived: false,
          items: []
        };
        isDirty = true;
      }
    }
    renderEditor();
  }

  function startNewProgram() {
    sharedState.selectedProgramId = "new";
    loadProgramForEdit("new");
    renderMasterList();
  }

  function renderMasterList() {
    clear(pList);
    const progs = (state.programs || []).filter(p => !p.archived);
    countSub.textContent = isEn()
      ? `${progs.length} programs`
      : `${progs.length} ${pluralize(progs.length, "программа", "программы", "программ")}`;

    progs.forEach(p => {
      const isSel = p.id === sharedState.selectedProgramId;
      const exCount = (p.items || []).length;
      let totalSets = 0;
      (p.items || []).forEach(it => { totalSets += (it.sets || 3); });
      const estMin = Math.round(totalSets * 3.5 + exCount * 1.5) || 45;

      // Последняя выполненная тренировка
      const doneForP = (state.sessions || []).filter(s => s.status === "done" && s.programId === p.id);
      doneForP.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      let lastDoneStr = isEn() ? "not completed yet" : "ещё не выполнялась";
      if (doneForP.length > 0) {
        const daysAgo = Math.floor((Date.now() - doneForP[0].startedAt) / 86400000);
        lastDoneStr = daysAgo === 0
          ? (isEn() ? "today" : "сегодня")
          : (isEn() ? `${daysAgo} d. ago` : `последняя: ${daysAgo} дн. назад`);
      }

      const card = h("button", {
        type: "button",
        class: "pCard" + (isSel ? " sel" : ""),
        onclick: () => {
          if (p.id === sharedState.selectedProgramId) return;
          sharedState.selectedProgramId = p.id;
          renderMasterList();
          loadProgramForEdit(p.id);
        }
      },
        h("b", {}, p.name),
        h("span", {}, `${exCount} упр. · ${totalSets} сетов · ≈ ${estMin} мин`),
        h("span", {}, lastDoneStr)
      );

      pList.append(card);
    });

    const addBtn = h("button", {
      type: "button",
      class: "addBtn",
      onclick: () => startNewProgram()
    }, "+ " + (isEn() ? "New program" : "Новая программа"));

    pList.append(addBtn);
  }

  function renderEditor() {
    clear(editorBox);
    if (!editingProgram) return;

    const p = editingProgram;
    const items = p.items || [];
    const exCount = items.length;
    let totalSets = 0;
    items.forEach(it => { totalSets += (it.sets || 3); });
    const estMin = Math.round(totalSets * 3.5 + exCount * 1.5) || 0;

    // Header: h2 + pencil + status chip + danger delete
    const titleH2 = h("h2", {}, p.name);
    const pencilBtn = h("button", {
      type: "button",
      class: "icBtn",
      title: isEn() ? "Rename" : "Переименовать",
      onclick: () => {
        const curName = p.name;
        const newName = prompt(isEn() ? "Program name:" : "Название программы:", curName);
        if (newName && newName.trim() && newName.trim() !== curName) {
          p.name = newName.trim();
          titleH2.textContent = p.name;
          isDirty = true;
          updateStatus();
          renderMasterList();
        }
      }
    }, icon("pencil", 15));

    const statusDot = h("i");
    const statusText = h("span", {}, isDirty ? (isEn() ? "unsaved" : "не сохранено") : (isEn() ? "saved" : "сохранено"));
    const statusChip = h("span", { class: "status" }, statusDot, statusText);

    function updateStatus() {
      statusDot.style.background = isDirty ? "var(--warn)" : "var(--ok)";
      statusText.textContent = isDirty ? (isEn() ? "unsaved" : "не сохранено") : (isEn() ? "saved" : "сохранено");
    }
    updateStatus();

    const deleteBtn = h("button", {
      type: "button",
      class: "icBtn danger",
      title: isEn() ? "Delete program" : "Удалить программу",
      onclick: () => {
        confirmDialog(
          isEn() ? `Delete program "${p.name}"?` : `Удалить программу «${p.name}»?`,
          () => {
            deleteProgram(p.id);
            toast(t("programs.deletedToast") || "Программа удалена");
            sharedState.selectedProgramId = null;
            renderMasterList();
            loadProgramForEdit(null);
          }
        );
      }
    }, icon("trash", 17));

    const edHead = h("div", { class: "edHead" },
      titleH2,
      pencilBtn,
      statusChip,
      h("span", { class: "spacer" }),
      deleteBtn
    );

    // Live meta string
    const edMeta = h("div", { class: "edMeta" },
      `≈ ${estMin} мин · ${exCount} упр. · ${totalSets} сетов · пересчитывается автоматически`
    );

    // Segmented tabs: Упражнения N | Баланс | Шаблоны
    const tabExercises = h("button", {
      type: "button",
      class: sharedState.programEditorTab === "exercises" ? "on" : "",
      dataset: { t: "ex" },
      onclick: () => switchTab("exercises")
    }, isEn() ? `Exercises ${exCount}` : `Упражнения ${exCount}`);

    const tabBalance = h("button", {
      type: "button",
      class: sharedState.programEditorTab === "balance" ? "on" : "",
      dataset: { t: "bal" },
      onclick: () => switchTab("balance")
    }, isEn() ? "Balance" : "Баланс");

    const tabTemplates = h("button", {
      type: "button",
      class: sharedState.programEditorTab === "templates" ? "on" : "",
      dataset: { t: "tpl" },
      onclick: () => switchTab("templates")
    }, isEn() ? "Templates" : "Шаблоны");

    const edTabs = h("div", { class: "seg edTabs" }, tabExercises, tabBalance, tabTemplates);

    // Panels container
    const panelContainer = h("div", {});

    function switchTab(tId) {
      sharedState.programEditorTab = tId;
      tabExercises.classList.toggle("on", tId === "exercises");
      tabBalance.classList.toggle("on", tId === "balance");
      tabTemplates.classList.toggle("on", tId === "templates");
      renderPanel();
    }

    function renderPanel() {
      clear(panelContainer);
      if (sharedState.programEditorTab === "exercises") {
        panelContainer.append(buildExercisesPanel(p, () => {
          isDirty = true;
          updateStatus();
          edMeta.textContent = `≈ ${estMin} мин · ${p.items.length} упр. · ${p.items.reduce((acc, it) => acc + (it.sets || 3), 0)} сетов · пересчитывается автоматически`;
          tabExercises.textContent = isEn() ? `Exercises ${p.items.length}` : `Упражнения ${p.items.length}`;
        }));
      } else if (sharedState.programEditorTab === "balance") {
        panelContainer.append(buildBalancePanel(p));
      } else if (sharedState.programEditorTab === "templates") {
        panelContainer.append(buildTemplatesPanel(p, (newItems) => {
          p.items = newItems;
          isDirty = true;
          updateStatus();
          switchTab("exercises");
          renderMasterList();
        }));
      }
    }

    renderPanel();

    // Footer: Save primary + danger delete
    const savePrimaryBtn = h("button", {
      type: "button",
      class: "btnP",
      style: "flex:1;justify-content:center",
      onclick: () => {
        saveProgram(p);
        isDirty = false;
        updateStatus();
        haptic("success");
        toast(t("builder.savedToast") || "Изменения сохранены");
        renderMasterList();
      }
    }, isEn() ? "Save changes" : "Сохранить изменения");

    const edFoot = h("div", { class: "edFoot" }, savePrimaryBtn);

    editorBox.append(edHead, edMeta, edTabs, panelContainer, edFoot);
  }

  // Initial load
  loadProgramForEdit(sharedState.selectedProgramId);
  renderMasterList();

  cols.append(pList, editorBox);
  container.append(topbar, cols);

  // Слушатель кастомного события палитры
  const onNewProg = () => startNewProgram();
  window.addEventListener("desktop-create-program", onNewProg);

  return container;
}

function buildExercisesPanel(program, onDirty) {
  const panel = h("div", { class: "edPanel on" });
  const items = program.items || [];

  items.forEach((it, idx) => {
    it._key = it._key || uid();
    const ex = getExercise(it.exerciseId) || { name: it.name || "Упражнение", muscleGroup: it.muscleGroup || "Общее" };
    const isOpen = sharedState.expandedExerciseKeys.has(it._key);

    const row = h("div", { class: "exRow" + (isOpen ? " open" : "") });

    // Drag handle
    const dragSpan = h("span", { class: "drag" },
      createDotsSvg()
    );

    // Index
    const idxBadge = h("span", { class: "idx" }, String(idx + 1));

    // Name + muscle
    const exNameBox = h("span", { class: "exName" },
      h("b", {}, ex.name),
      h("span", {}, ex.muscleGroup)
    );

    // Summary: "3 × 8-10"
    const sumSpan = h("span", { class: "exSum" }, `${it.sets || 3} × ${it.targetReps || "8-10"}`);

    // Chevron
    const chevSvg = icon("chevronDown", 17);
    chevSvg.classList.add("chev");

    const headBtn = h("button", {
      type: "button",
      class: "exHead",
      onclick: () => {
        if (sharedState.expandedExerciseKeys.has(it._key)) {
          sharedState.expandedExerciseKeys.delete(it._key);
          row.classList.remove("open");
        } else {
          sharedState.expandedExerciseKeys.add(it._key);
          row.classList.add("open");
        }
      }
    }, dragSpan, idxBadge, exNameBox, sumSpan, chevSvg);

    // Body (2-column grid)
    const bodyBox = h("div", { class: "exBody" });

    // 1. Подходы (степпер)
    const setsVal = h("b", {}, String(it.sets || 3));
    const minusBtn = h("button", {
      type: "button",
      onclick: () => {
        const cur = it.sets || 3;
        if (cur > 1) {
          it.sets = cur - 1;
          setsVal.textContent = String(it.sets);
          sumSpan.textContent = `${it.sets} × ${it.targetReps || "8-10"}`;
          onDirty();
        }
      }
    }, "−");
    const plusBtn = h("button", {
      type: "button",
      onclick: () => {
        it.sets = (it.sets || 3) + 1;
        setsVal.textContent = String(it.sets);
        sumSpan.textContent = `${it.sets} × ${it.targetReps || "8-10"}`;
        onDirty();
      }
    }, "+");
    const stepperBox = h("span", { class: "stepD" }, minusBtn, setsVal, plusBtn);
    const setsField = h("div", {},
      h("span", { class: "fLab" }, t("builder.sets") || "Подходы"),
      stepperBox
    );

    // 2. Целевые повторы (segS 5 диапазонов + подсказка)
    const repRanges = ["3-5", "6-8", "8-10", "10-12", "15-20"];
    const repHints = {
      "3-5": isEn() ? "Strength: maximal motor unit recruitment." : "Сила: максимальное рекрутирование волокон.",
      "6-8": isEn() ? "Strength & mass: heavy working sets." : "Сила и объём: тяжёлые рабочие подходы.",
      "8-10": isEn() ? "Mass: golden standard for hypertrophy." : "Масса: золотой стандарт гипертрофии.",
      "10-12": isEn() ? "Hypertrophy: pump and metabolic stress." : "Гипертрофия: пампинг и метаболический отклик.",
      "15-20": isEn() ? "Endurance & pump: capillarization." : "Выносливость и памп: капилляризация."
    };

    const hintEl = h("span", { class: "hint" }, repHints[it.targetReps] || repHints["8-10"]);
    const segS = h("span", { class: "segS" });
    repRanges.forEach(r => {
      const b = h("button", {
        type: "button",
        class: (it.targetReps || "8-10") === r ? "on" : "",
        onclick: () => {
          it.targetReps = r;
          segS.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
          hintEl.textContent = repHints[r] || "";
          sumSpan.textContent = `${it.sets || 3} × ${r}`;
          onDirty();
        }
      }, r);
      segS.append(b);
    });

    const repsField = h("div", {},
      h("span", { class: "fLab" }, t("builder.targetReps") || "Целевые повторы"),
      segS,
      hintEl
    );

    // 3. Отдых (чипы mm:ss)
    const restRanges = [60, 90, 120, 150, 180];
    const chipsBox = h("span", { class: "chips" });
    const curRest = it.restSec ?? 90;

    restRanges.forEach(sec => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const str = `${m}:${s < 10 ? "0" : ""}${s}`;
      const chip = h("button", {
        type: "button",
        class: "chip" + (curRest === sec ? " on" : ""),
        onclick: () => {
          it.restSec = sec;
          chipsBox.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === chip));
          onDirty();
        }
      }, str);
      chipsBox.append(chip);
    });

    const restField = h("div", { style: "grid-column: 1 / -1" },
      h("span", { class: "fLab" }, t("builder.restBetweenSets") || "Отдых между подходами"),
      chipsBox
    );

    // 4. Заметка полной шириной
    const noteInput = h("input", {
      type: "text",
      class: "noteIn",
      placeholder: isEn() ? "Note: dropset, tempo, pause at bottom…" : "Заметка: дропсет, темп, пауза внизу…",
      value: it.note || "",
      oninput: () => {
        it.note = noteInput.value;
        onDirty();
      }
    });

    // 5. Кнопки Дублировать / Убрать
    const duplicateBtn = h("button", {
      type: "button",
      class: "act",
      onclick: () => {
        const copy = JSON.parse(JSON.stringify(it));
        copy._key = uid();
        items.splice(idx + 1, 0, copy);
        sharedState.expandedExerciseKeys.add(copy._key);
        onDirty();
        panel.replaceWith(buildExercisesPanel(program, onDirty));
      }
    }, icon("copy", 14), t("builder.duplicate") || "Дублировать");

    const removeBtn = h("button", {
      type: "button",
      class: "act danger",
      onclick: () => {
        items.splice(idx, 1);
        onDirty();
        panel.replaceWith(buildExercisesPanel(program, onDirty));
      }
    }, icon("trash", 14), t("builder.remove") || "Убрать");

    const actsBox = h("div", { class: "exActs" }, duplicateBtn, removeBtn);

    bodyBox.append(setsField, repsField, restField, noteInput, actsBox);
    row.append(headBtn, bodyBox);
    panel.append(row);
  });

  // Кнопка "+ Добавить упражнение"
  const addExBtn = h("button", {
    type: "button",
    class: "addBtn",
    style: "margin-top: 10px;",
    onclick: () => {
      pickExercise(selectedEx => {
        if (!selectedEx) return;
        const newIt = {
          exerciseId: selectedEx.id,
          name: selectedEx.name,
          muscleGroup: selectedEx.muscleGroup,
          sets: 3,
          targetReps: "8-10",
          restSec: 90,
          note: "",
          _key: uid()
        };
        items.push(newIt);
        sharedState.expandedExerciseKeys.add(newIt._key);
        onDirty();
        panel.replaceWith(buildExercisesPanel(program, onDirty));
      });
    }
  }, "+ " + (isEn() ? "Add exercise" : "Добавить упражнение"));

  panel.append(addExBtn);
  return panel;
}

function buildBalancePanel(program) {
  const panel = h("div", { class: "edPanel on" });
  const items = program.items || [];

  // Подсчёт сетов по группам мышц
  const muscleSets = {};
  let totalSets = 0;
  items.forEach(it => {
    const ex = getExercise(it.exerciseId) || {};
    const mg = ex.muscleGroup || it.muscleGroup || "Другое";
    const s = it.sets || 3;
    muscleSets[mg] = (muscleSets[mg] || 0) + s;
    totalSets += s;
  });

  const sortedMuscles = Object.entries(muscleSets).sort((a, b) => b[1] - a[1]);
  const maxSets = sortedMuscles[0]?.[1] || 1;

  // Силуэты человечков
  const silhouetteWrap = h("div", { style: "display:grid;grid-template-columns:250px 1fr;gap:28px;align-items:center" });

  const figuresBox = h("div", {},
    h("div", { style: "display:flex;justify-content:space-around" },
      createBodySvgFront(muscleSets),
      createBodySvgBack(muscleSets)
    ),
    h("div", { style: "display:flex;justify-content:space-around;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);font-weight:600;margin-top:4px" },
      h("span", {}, isEn() ? "front" : "спереди"),
      h("span", {}, isEn() ? "back" : "сзади")
    )
  );

  // Бары процентов
  const barsBox = h("div", { class: "bars" });
  if (sortedMuscles.length === 0) {
    barsBox.append(h("div", { class: "sub" }, isEn() ? "No exercises added yet" : "Упражнения ещё не добавлены"));
  } else {
    sortedMuscles.forEach(([mg, cnt], i) => {
      const pct = totalSets > 0 ? Math.round((cnt / totalSets) * 100) : 0;
      const barTop = h("div", { class: "barTop" },
        h("span", {}, mg),
        h("b", {}, `${cnt} сет. · ${pct}%`)
      );
      const fillBar = h("div", {
        class: "fill" + (i === 0 ? " top" : ""),
        style: `width: ${Math.round((cnt / maxSets) * 100)}%`
      });
      const track = h("div", { class: "track" }, fillBar);
      barsBox.append(h("div", {}, barTop, track));
    });
  }

  silhouetteWrap.append(figuresBox, barsBox);

  // Находки анализа (ok / warn)
  const findingsBox = h("div", { style: "margin-top:18px" });

  const pullSets = (muscleSets["Спина"] || 0) + (muscleSets["Бицепс"] || 0);
  const pushSets = (muscleSets["Грудь"] || 0) + (muscleSets["Трицепс"] || 0) + (muscleSets["Плечи"] || 0);
  const legSets = (muscleSets["Квадрицепс"] || 0) + (muscleSets["Задняя поверхность бедра"] || 0) + (muscleSets["Ноги"] || 0) + (muscleSets["Икры"] || 0);

  if (pullSets > 0 && pushSets > 0) {
    const okItem = h("div", { class: "find ok" },
      h("i"),
      isEn()
        ? `Balanced upper body: pulling and pushing volume (${pullSets} : ${pushSets} sets).`
        : `Сбалансированный день верха: тянущие и толкающие объёмы (${pullSets} : ${pushSets} сетов).`
    );
    findingsBox.append(okItem);
  }

  if (legSets === 0) {
    const warnItem = h("div", { class: "find warn" },
      h("i"),
      isEn()
        ? "No leg work. For 2-3 sessions per week, add lower body exercises (squats/deadlifts)."
        : "Нет работы ног. При 2-3 тренировках в неделю добавьте день низа или включите присед и тягу."
    );
    findingsBox.append(warnItem);
  }

  panel.append(silhouetteWrap, findingsBox);
  return panel;
}

function buildTemplatesPanel(program, onApplyTemplate) {
  const panel = h("div", { class: "edPanel on" });

  const descP = h("p", { class: "hint", style: "margin:0 0 12px" },
    isEn()
      ? "Template will replace the current exercises, sets, and rest times. Completed history is not affected."
      : "Шаблон заменит текущий состав упражнений, сетов и отдыха. История тренировок не затрагивается."
  );
  panel.append(descP);

  let selectedTplId = PROGRAM_TEMPLATES[0]?.id || "tpl-fullbody";
  const optButtons = [];

  PROGRAM_TEMPLATES.forEach(tpl => {
    const isSel = tpl.id === selectedTplId;
    const name = isEn() ? tpl.nameEn : tpl.nameRu;
    const desc = isEn() ? tpl.tagEn : tpl.tagRu;

    const optBtn = h("button", {
      type: "button",
      class: "opt" + (isSel ? " sel" : ""),
      onclick: () => {
        selectedTplId = tpl.id;
        optButtons.forEach(b => b.classList.toggle("sel", b === optBtn));
      }
    },
      h("span", { class: "radio" }),
      h("span", {},
        h("b", {}, name),
        h("span", {}, desc)
      )
    );

    optButtons.push(optBtn);
    panel.append(optBtn);
  });

  const applyBtn = h("button", {
    type: "button",
    class: "btnP",
    style: "margin-top: 10px;",
    onclick: () => {
      const chosen = PROGRAM_TEMPLATES.find(t => t.id === selectedTplId);
      if (!chosen) return;
      const tplName = isEn() ? chosen.nameEn : chosen.nameRu;

      confirmDialog(
        isEn()
          ? `Apply template "${tplName}"? Current exercises will be replaced.`
          : `Применить шаблон «${tplName}»? Состав упражнений будет заменён.`,
        () => {
          const prevItems = JSON.parse(JSON.stringify(program.items || []));
          const newItems = chosen.items.map(it => ({
            exerciseId: it.exerciseId,
            name: isEn() ? it.nameEn : it.name,
            muscleGroup: it.muscleGroup,
            sets: it.sets || 3,
            targetReps: it.targetReps || "8-10",
            restSec: it.restSec || 90,
            note: "",
            _key: uid()
          }));

          onApplyTemplate(newItems);

          // Undo тост на 10 секунд
          showUndoSnackbar(
            isEn() ? "Template applied" : "Шаблон применён",
            isEn() ? "Undo" : "Отменить",
            () => {
              onApplyTemplate(prevItems);
              toast(isEn() ? "Template reverted" : "Шаблон отменён");
            },
            10000
          );
        }
      );
    }
  }, isEn() ? "Apply template" : "Применить шаблон");

  panel.append(applyBtn);
  return panel;
}

/* ==========================================================================
   2. ПРОГРЕСС — 12-КОЛОНОЧНЫЙ ГРИД
   ========================================================================== */

export function renderDesktopProgress() {
  const container = h("section", { class: "view on", id: "v-progress" });

  const doneSessions = (state.sessions || []).filter(s => s.status === "done");
  doneSessions.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  // Период (7 / 30 / Все)
  const period = sharedState.progressPeriod || "30";

  // Topbar
  const title = h("h1", {}, t("nav.progress") || "Прогресс");
  const subDate = h("span", { class: "sub" }, getPeriodDateString(period));
  const spacer = h("span", { class: "spacer" });

  const seg7 = h("button", { type: "button", class: period === "7" ? "on" : "", onclick: () => setPeriod("7") }, t("progress.period7") || "7 дн.");
  const seg30 = h("button", { type: "button", class: period === "30" ? "on" : "", onclick: () => setPeriod("30") }, t("progress.period30") || "30 дн.");
  const segAll = h("button", { type: "button", class: period === "all" ? "on" : "", onclick: () => setPeriod("all") }, t("progress.periodAll") || "Все");
  const segPeriod = h("span", { class: "seg" }, seg7, seg30, segAll);

  const topbar = h("header", { class: "topbar" }, title, subDate, spacer, segPeriod);

  function setPeriod(p) {
    sharedState.progressPeriod = p;
    container.replaceWith(renderDesktopProgress());
  }

  // Фильтрация сессий по выбранному периоду
  const now = Date.now();
  const filteredSessions = doneSessions.filter(s => {
    if (period === "7") return now - s.startedAt <= 7 * 86400000;
    if (period === "30") return now - s.startedAt <= 30 * 86400000;
    return true;
  });

  // KPI метрики
  const workoutsCount = filteredSessions.length;
  let totalTonnage = 0;
  let totalWorkingSets = 0;
  let totalReps = 0;
  let totalDurationMin = 0;

  filteredSessions.forEach(s => {
    totalDurationMin += (s.durationMin || Math.round((s.finishedAt - s.startedAt) / 60000) || 45);
    (s.entries || []).forEach(e => {
      (e.sets || []).forEach(st => {
        if (st.done) {
          totalWorkingSets++;
          totalReps += (st.reps || 0);
          totalTonnage += (toKg(st.weight || 0, e.unit) * (st.reps || 0));
        }
      });
    });
  });

  const avgTonnage = workoutsCount > 0 ? Math.round(totalTonnage / workoutsCount) : 0;
  const avgTimeMin = workoutsCount > 0 ? Math.round(totalDurationMin / workoutsCount) : 0;

  // PRs (Личные рекорды)
  const prList = calcPersonalRecords(doneSessions);

  // Расчёт реальных недельных трендов для sparklines (последние 6 недель)
  const nowTs = Date.now();
  const weekMs = 7 * 86400000;
  const weeklyWorkouts = [0, 0, 0, 0, 0, 0];
  const weeklyTonnage = [0, 0, 0, 0, 0, 0];
  const weeklySets = [0, 0, 0, 0, 0, 0];
  doneSessions.forEach(s => {
    const t = s.endedAt || s.startedAt || 0;
    const diffWeeks = Math.floor((nowTs - t) / weekMs);
    if (diffWeeks >= 0 && diffWeeks < 6) {
      const idx = 5 - diffWeeks;
      weeklyWorkouts[idx]++;
      (s.entries || []).forEach(e => {
        (e.sets || []).forEach(st => {
          if (st.done) {
            weeklySets[idx]++;
            weeklyTonnage[idx] += (st.weight || 0) * (st.reps || 0);
          }
        });
      });
    }
  });

  // Сетка 12 колонок
  const dash = h("div", { class: "dash" });

  // KPI 1: Тренировок (span 3)
  const kpi1 = h("div", { class: "card sp3 kpi" },
    h("div", { class: "lab" }, t("progress.kpiWorkouts") || "Тренировок"),
    h("div", { class: "val" }, String(workoutsCount)),
    h("div", { class: "foot" },
      h("span", {}, isEn() ? `in ${period} d.: ${workoutsCount}` : `за ${period} дн.: ${workoutsCount}`),
      createSparklineSvg(weeklyWorkouts.some(v => v > 0) ? weeklyWorkouts : [0, 0, 0, 0, 0, workoutsCount])
    )
  );

  // KPI 2: Общий тоннаж (span 3)
  const kpi2 = h("div", { class: "card sp3 kpi" },
    h("div", { class: "lab" }, t("progress.kpiVolume") || "Общий тоннаж"),
    h("div", { class: "val" }, `${formatNumber(Math.round(totalTonnage))}`, h("i", {}, isEn() ? "kg" : "кг")),
    h("div", { class: "foot" },
      h("span", {}, isEn() ? `avg: ${formatNumber(avgTonnage)} / wkt` : `средний: ${formatNumber(avgTonnage)} / трен.`),
      createSparklineSvg(weeklyTonnage.some(v => v > 0) ? weeklyTonnage : [0, 0, 0, 0, 0, Math.round(totalTonnage)])
    )
  );

  // KPI 3: Рабочих сетов (span 3)
  const kpi3 = h("div", { class: "card sp3 kpi" },
    h("div", { class: "lab" }, t("progress.kpiSets") || "Рабочих сетов"),
    h("div", { class: "val" }, String(totalWorkingSets)),
    h("div", { class: "foot" },
      h("span", {}, isEn() ? `reps: ${totalReps}` : `повторов: ${totalReps}`),
      createSparklineSvg(weeklySets.some(v => v > 0) ? weeklySets : [0, 0, 0, 0, 0, totalWorkingSets])
    )
  );

  // KPI 4: Рекордов PR (span 3)
  const kpi4 = h("div", { class: "card sp3 kpi" },
    h("div", { class: "lab" }, t("progress.kpiPrs") || "Рекордов (PR)"),
    h("div", { class: "val" }, String(prList.length)),
    h("div", { class: "foot" },
      h("span", {}, isEn() ? `avg time: ${avgTimeMin} min` : `ср. время: ${avgTimeMin} мин`),
      createSparklineSvg([0, 0, Math.min(1, prList.length), Math.min(2, prList.length), Math.min(4, prList.length), prList.length])
    )
  );

  // Load Index Card (span 8)
  const cardLoad = h("div", { class: "card sp8" },
    h("h4", {}, t("progress.loadIndex") || "Индекс нагрузки · база = 100"),
    createLoadIndexSvg(doneSessions)
  );

  // Muscle Balance Card (span 4)
  const muscleBalanceMap = calcMuscleVolumeMap(filteredSessions);
  const totalMVol = Object.values(muscleBalanceMap).reduce((a, b) => a + b, 0) || 1;
  const sortedMuscles = Object.entries(muscleBalanceMap).sort((a, b) => b[1] - a[1]);
  const maxMVol = sortedMuscles[0]?.[1] || 1;

  const mBars = h("div", { class: "bars" });
  sortedMuscles.slice(0, 5).forEach(([mName, vol], i) => {
    const pct = Math.round((vol / totalMVol) * 100);
    const row = h("div", {},
      h("div", { class: "barTop" },
        h("span", {}, mName),
        h("b", {}, `${pct}%`)
      ),
      h("div", { class: "track" },
        h("div", { class: "fill" + (i === 0 ? " top" : ""), style: `width:${Math.round((vol / maxMVol) * 100)}%` })
      )
    );
    mBars.append(row);
  });

  const detailBreakdownBtn = h("button", {
    type: "button",
    class: "quiet",
    style: "margin-top:12px",
    onclick: () => openMuscleBreakdownDrawer(muscleBalanceMap)
  }, t("progress.detailedBreakdown") || "Подробная разбивка →");

  const cardBalance = h("div", { class: "card sp4" },
    h("h4", {}, t("progress.muscleBalance") || "Баланс по мышцам"),
    mBars,
    detailBreakdownBtn
  );

  // PRs Table Card (span 6)
  const cardPr = h("div", { class: "card sp6" },
    h("h4", {}, t("progress.personalRecords") || "Личные рекорды")
  );
  if (prList.length === 0) {
    cardPr.append(h("div", { class: "sub" }, isEn() ? "No personal records yet" : "Рекорды пока отсутствуют"));
  } else {
    prList.slice(0, 6).forEach(pr => {
      const row = h("div", { class: "tblRow" },
        h("span", {}, pr.name),
        h("b", {}, `${pr.weight} кг × ${pr.reps}`),
        h("span", {}, `e1RM ${Math.round(pr.e1rm)} кг`)
      );
      cardPr.append(row);
    });
  }

  // Exercise Progress Chart Card (span 6)
  const topExercises = getTopExercises(doneSessions);
  let activeExId = sharedState.progressExerciseId || topExercises[0]?.id;

  const exChips = h("div", { class: "chips", style: "margin-bottom:10px" });
  topExercises.slice(0, 4).forEach(ex => {
    const isSel = ex.id === activeExId;
    const b = h("button", {
      type: "button",
      class: "chip" + (isSel ? " on" : ""),
      onclick: () => {
        activeExId = ex.id;
        sharedState.progressExerciseId = ex.id;
        exChips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        renderExerciseChart();
      }
    }, ex.name.split(" ")[0]);
    exChips.append(b);
  });

  const exChartBox = h("div", {});
  function renderExerciseChart() {
    clear(exChartBox);
    exChartBox.append(createExerciseProgressSvg(doneSessions, activeExId));
  }
  renderExerciseChart();

  const cardExProgress = h("div", { class: "card sp6" },
    h("h4", {}, t("progress.exerciseProgress") || "Прогресс упражнения"),
    exChips,
    exChartBox,
    h("div", { style: "display:flex;gap:16px;font-size:12px;color:var(--ink3);margin-top:6px" },
      h("span", {}, "— e1RM"),
      h("span", {}, "--- объём")
    )
  );

  // Activity 12 Weeks Card (span 12)
  const cardHeatmap = h("div", { class: "card sp12" },
    h("h4", {}, t("progress.activity12Weeks") || "Активность · 12 недель"),
    createHeatmapGrid(doneSessions),
    h("div", { class: "heatLeg" },
      h("span", {}, t("progress.less") || "меньше"),
      h("i", { style: "background:var(--base)" }),
      h("i", { class: "l1", style: "background:#C9C9CE" }),
      h("i", { class: "l2", style: "background:#8A8A90" }),
      h("i", { class: "l3", style: "background:var(--ink)" }),
      h("span", {}, t("progress.more") || "больше")
    )
  );

  dash.append(kpi1, kpi2, kpi3, kpi4, cardLoad, cardBalance, cardPr, cardExProgress, cardHeatmap);
  container.append(topbar, dash);
  return container;
}

function getMonthName(idx) {
  const list = MONTHS[getLang()] || MONTHS.ru;
  return list[idx] || "";
}

function getPeriodDateString(period) {
  const d = new Date();
  const nowStr = isEn() ? "present" : "наст. время";
  if (period === "7") {
    const past = new Date(d.getTime() - 7 * 86400000);
    return `${past.getDate()} ${getMonthName(past.getMonth())} — ${nowStr}`;
  }
  if (period === "30") {
    const past = new Date(d.getTime() - 30 * 86400000);
    return `${past.getDate()} ${getMonthName(past.getMonth())} — ${nowStr}`;
  }
  return isEn() ? "All time" : "Всё время";
}

function openMuscleBreakdownDrawer(muscleMap) {
  const content = h("div", { class: "stack", style: "gap:16px" });
  content.append(h("h3", {}, t("progress.muscleBalance") || "Баланс по мышцам"));

  const sorted = Object.entries(muscleMap).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((acc, it) => acc + it[1], 0) || 1;

  sorted.forEach(([m, v]) => {
    const pct = Math.round((v / total) * 100);
    content.append(h("div", { class: "tblRow" },
      h("span", {}, m),
      h("b", {}, `${pct}%`),
      h("span", {}, `${Math.round(v)} кг`)
    ));
  });

  sheet(content, { title: isEn() ? "Muscle breakdown" : "Разбивка по мышцам" });
}

/* ==========================================================================
   3. ИСТОРИЯ — MASTER-DETAIL
   ========================================================================== */

export function renderDesktopHistory() {
  const container = h("section", { class: "view on", id: "v-history" });

  const doneSessions = (state.sessions || []).filter(s => s.status === "done");
  doneSessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  if (!sharedState.selectedHistoryId && doneSessions.length > 0) {
    sharedState.selectedHistoryId = doneSessions[0].id;
  }

  // Суммарный объём
  let totalTonnage = 0;
  doneSessions.forEach(s => {
    (s.entries || []).forEach(e => {
      (e.sets || []).forEach(st => {
        if (st.done) totalTonnage += toKg(st.weight || 0, e.unit) * (st.reps || 0);
      });
    });
  });

  // Topbar
  const title = h("h1", {}, t("nav.history") || "История");
  const countSub = h("span", { class: "sub" }, isEn()
    ? `${doneSessions.length} workouts · ${formatNumber(Math.round(totalTonnage))} kg total`
    : `${doneSessions.length} тренировок · ${formatNumber(Math.round(totalTonnage))} кг суммарно`);
  const spacer = h("span", { class: "spacer" });
  const exportCsvBtn = h("button", {
    type: "button",
    class: "quiet",
    onclick: () => exportHistoryCsv(doneSessions)
  }, t("history.exportCsv") || "Экспорт CSV");

  const topbar = h("header", { class: "topbar" }, title, countSub, spacer, exportCsvBtn);

  // Layout: colsHist
  const cols = h("div", { class: "colsHist" });
  const leftCol = h("div", {});
  const rightCard = h("div", { class: "card" });

  // Фильтр месяцев
  const monthsSet = new Set();
  doneSessions.forEach(s => {
    if (s.startedAt) {
      const dt = new Date(s.startedAt);
      const m = getMonthName(dt.getMonth());
      if (m) monthsSet.add(m);
    }
  });

  const monthChips = h("div", { class: "chips", style: "margin-bottom:12px;flex-wrap:wrap" });
  const monthsArr = Array.from(monthsSet);

  const curMonthFilter = sharedState.historyMonthFilter || "all";

  const allChip = h("button", {
    type: "button",
    class: "chip" + (curMonthFilter === "all" ? " on" : ""),
    onclick: () => {
      sharedState.historyMonthFilter = "all";
      container.replaceWith(renderDesktopHistory());
    }
  }, t("common.all") || "Все");
  monthChips.append(allChip);

  monthsArr.forEach(mName => {
    const chip = h("button", {
      type: "button",
      class: "chip" + (curMonthFilter === mName ? " on" : ""),
      onclick: () => {
        sharedState.historyMonthFilter = mName;
        container.replaceWith(renderDesktopHistory());
      }
    }, mName);
    monthChips.append(chip);
  });

  leftCol.append(monthChips);

  // Список тренировок слева
  const filteredSessions = doneSessions.filter(s => {
    if (curMonthFilter === "all") return true;
    const dt = new Date(s.startedAt || 0);
    return getMonthName(dt.getMonth()) === curMonthFilter;
  });

  const hList = h("div", {});
  if (filteredSessions.length === 0) {
    hList.append(h("div", { class: "sub" }, isEn() ? "No workouts found" : "Тренировки не найдены"));
  } else {
    filteredSessions.forEach(s => {
      const isSel = s.id === sharedState.selectedHistoryId;
      const prog = getProgram(s.programId);
      const progName = s.name || prog?.name || (isEn() ? "Workout" : "Тренировка");
      const dt = new Date(s.startedAt || 0);
      const dateStr = `${dt.getDate()} ${getMonthName(dt.getMonth())}, ${fmtTime(dt)}`;
      const exCount = (s.entries || []).length;
      const exCountStr = isEn()
        ? `${exCount} ${exCount === 1 ? "exercise" : "exercises"}`
        : `${exCount} ${pluralize(exCount, "упражнение", "упражнения", "упражнений")}`;

      let sessionVol = 0;
      (s.entries || []).forEach(e => {
        (e.sets || []).forEach(st => {
          if (st.done) sessionVol += toKg(st.weight || 0, e.unit) * (st.reps || 0);
        });
      });
      const durMin = s.durationMin || Math.round((s.finishedAt - s.startedAt) / 60000) || 45;

      const row = h("button", {
        type: "button",
        class: "hRow" + (isSel ? " sel" : ""),
        onclick: () => {
          sharedState.selectedHistoryId = s.id;
          cols.querySelectorAll(".hRow").forEach(r => r.classList.toggle("sel", r === row));
          renderDetail(s);
        }
      },
        h("span", { class: "d" },
          h("b", {}, dateStr),
          h("span", {}, `${progName} · ${exCountStr}`)
        ),
        h("span", { class: "m" },
          `${formatNumber(Math.round(sessionVol))} кг`,
          h("span", {}, `${durMin} мин`)
        )
      );

      hList.append(row);
    });
  }

  leftCol.append(hList);

  // Правая колонка: Деталь тренировки
  function renderDetail(session) {
    clear(rightCard);
    if (!session) {
      rightCard.append(h("div", { class: "sub" }, isEn() ? "Select a workout to view details" : "Выберите тренировку для просмотра деталей"));
      return;
    }

    const prog = getProgram(session.programId);
    const progName = session.name || prog?.name || (isEn() ? "Workout" : "Тренировка");
    const dt = new Date(session.startedAt || 0);
    const dateFull = `${dt.getDate()} ${getMonthName(dt.getMonth())} ${dt.getFullYear()}, ${fmtTime(dt)}`;

    // Top row
    const headRow = h("div", { style: "display:flex;gap:10px;align-items:center" },
      h("b", { style: "font-size:17px" }, dateFull),
      h("span", { class: "tag" }, progName),
      h("span", { class: "spacer" }),
      h("button", {
        type: "button",
        class: "btnGhost",
        onclick: () => {
          if (navigator.share) {
            navigator.share({ title: progName, text: `${progName} — ${dateFull}` }).catch(() => {});
          } else {
            navigator.clipboard.writeText(`${progName} — ${dateFull}`);
            toast(isEn() ? "Copied to clipboard" : "Скопировано в буфер");
          }
        }
      }, isEn() ? "Share" : "Поделиться"),
      h("button", {
        type: "button",
        class: "icBtn",
        title: isEn() ? "Edit workout" : "Редактировать тренировку",
        onclick: () => openEditWorkoutDrawer(session, () => {
          container.replaceWith(renderDesktopHistory());
        })
      }, icon("pencil", 16)),
      h("button", {
        type: "button",
        class: "icBtn danger",
        title: isEn() ? "Delete workout" : "Удалить тренировку",
        onclick: () => {
          confirmDialog(
            isEn() ? "Delete this workout log?" : "Удалить эту запись тренировки?",
            () => {
              deleteSession(session.id);
              toast(isEn() ? "Workout deleted" : "Тренировка удалена");
              sharedState.selectedHistoryId = null;
              container.replaceWith(renderDesktopHistory());
            }
          );
        }
      }, icon("trash", 16))
    );

    // miniKpi 4 tiles
    let sVol = 0, sSets = 0;
    (session.entries || []).forEach(e => {
      (e.sets || []).forEach(st => {
        if (st.done) {
          sSets++;
          sVol += toKg(st.weight || 0, e.unit) * (st.reps || 0);
        }
      });
    });
    const durMin = session.durationMin || Math.round((session.finishedAt - session.startedAt) / 60000) || 45;
    const durStr = durMin >= 60 ? `${Math.floor(durMin / 60)} ч ${durMin % 60} мин` : `${durMin} мин`;

    const miniKpi = h("div", { class: "miniKpi" },
      h("div", {}, h("span", {}, isEn() ? "Volume" : "Объём"), h("b", {}, `${formatNumber(Math.round(sVol))} кг`)),
      h("div", {}, h("span", {}, isEn() ? "Time" : "Время"), h("b", {}, durStr)),
      h("div", {}, h("span", {}, isEn() ? "Sets" : "Сетов"), h("b", {}, String(sSets))),
      h("div", {}, h("span", {}, isEn() ? "Index" : "Индекс"), h("b", {}, "100"))
    );

    rightCard.append(headRow, miniKpi);

    // Таблица сетов по упражнениям
    (session.entries || []).forEach(entry => {
      const ex = getExercise(entry.exerciseId) || { name: entry.name || "Упражнение", muscleGroup: entry.muscleGroup || "" };
      let bestW = 0, bestR = 0;
      (entry.sets || []).forEach(st => {
        if (st.done && (st.weight || 0) > bestW) {
          bestW = st.weight || 0;
          bestR = st.reps || 0;
        }
      });

      const setNameRow = h("div", { class: "setName" },
        h("b", {}, ex.name),
        h("span", {}, ex.muscleGroup),
        bestW > 0 ? h("b", { class: "best" }, isEn() ? `best ${bestW} kg × ${bestR}` : `лучш. ${bestW} кг × ${bestR}`) : null
      );
      rightCard.append(setNameRow);

      (entry.sets || []).forEach((st, sIdx) => {
        if (!st.done) return;
        const setTxt = h("div", { class: "setTxt" },
          h("span", {}, String(sIdx + 1)),
          h("span", {}, `${st.weight || 0} кг`),
          h("span", {}, String(st.reps || 0)),
          h("span", { class: "ok" }, "✓")
        );
        rightCard.append(setTxt);
      });
    });

    // Заметки
    if (session.note) {
      rightCard.append(h("div", { style: "margin-top:14px;font-size:13.5px;color:var(--ink2)" },
        h("b", {}, (isEn() ? "Note: " : "Заметка: ")),
        session.note
      ));
    }

    // Danger-зона удаления
    const delWorkoutBtn = h("button", {
      type: "button",
      class: "btn danger",
      style: "margin-top:20px;font-size:13px;padding:8px 14px",
      onclick: () => {
        confirmDialog(
          t("history.deleteWorkoutConfirm") || "Удалить эту тренировку из истории?",
          () => {
            const idx = (state.sessions || []).findIndex(x => x.id === session.id);
            if (idx >= 0) {
              state.sessions.splice(idx, 1);
              sharedState.selectedHistoryId = null;
              toast(isEn() ? "Workout deleted" : "Тренировка удалена");
              container.replaceWith(renderDesktopHistory());
            }
          }
        );
      }
    }, isEn() ? "Delete workout" : "Удалить тренировку");

    rightCard.append(delWorkoutBtn);
  }

  const selectedSession = filteredSessions.find(s => s.id === sharedState.selectedHistoryId) || filteredSessions[0];
  renderDetail(selectedSession);

  cols.append(leftCol, rightCard);
  container.append(topbar, cols);
  return container;
}

function openEditWorkoutDrawer(session, onSaved) {
  const content = h("div", { class: "stack", style: "gap:14px" });
  content.append(h("h3", {}, isEn() ? "Edit workout" : "Редактировать тренировку"));

  const noteInput = h("textarea", {
    class: "input",
    style: "min-height:80px;resize:vertical",
    placeholder: isEn() ? "Workout note…" : "Заметка о тренировке…"
  }, session.note || "");

  const durInput = h("input", {
    type: "number",
    class: "input",
    value: session.durationMin || Math.round((session.finishedAt - session.startedAt) / 60000) || 45
  });

  content.append(
    h("label", { class: "fLab" }, isEn() ? "Duration (min)" : "Длительность (мин)"),
    durInput,
    h("label", { class: "fLab" }, isEn() ? "Note" : "Заметка"),
    noteInput,
    h("button", {
      type: "button",
      class: "btnP",
      style: "justify-content:center",
      onclick: () => {
        session.note = noteInput.value.trim();
        session.durationMin = Number(durInput.value) || session.durationMin;
        toast(isEn() ? "Workout updated" : "Тренировка обновлена");
        sh.close();
        if (onSaved) onSaved();
      }
    }, t("common.save") || "Сохранить")
  );

  const sh = sheet(content, { title: isEn() ? "Edit workout" : "Редактирование тренировки" });
}

function exportHistoryCsv(sessions) {
  let csv = "Date,Program,Exercise,Set,Weight,Reps\n";
  sessions.forEach(s => {
    const dt = new Date(s.startedAt || 0).toISOString().split("T")[0];
    const pName = (s.name || "Workout").replace(/"/g, '""');
    (s.entries || []).forEach(e => {
      const exName = (e.name || "Exercise").replace(/"/g, '""');
      (e.sets || []).forEach((st, sIdx) => {
        if (st.done) {
          csv += `"${dt}","${pName}","${exName}",${sIdx + 1},${st.weight || 0},${st.reps || 0}\n`;
        }
      });
    });
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fitness-history-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(isEn() ? "CSV exported" : "CSV файл экспортирован");
}

/* ==========================================================================
   4. УПРАЖНЕНИЯ — MASTER-DETAIL
   ========================================================================== */

export function renderDesktopExercises() {
  const container = h("section", { class: "view on", id: "v-exercises" });

  const exercises = (state.exercises || []).filter(e => !e.archived);

  // Muscle groups
  const groups = [
    { id: "all", nameRu: "Все", nameEn: "All", match: () => true },
    { id: "Грудь", nameRu: "Грудь", nameEn: "Chest", match: m => (m || "").includes("Грудь") },
    { id: "Спина", nameRu: "Спина", nameEn: "Back", match: m => (m || "").includes("Спина") },
    { id: "Ноги", nameRu: "Ноги", nameEn: "Legs", match: m => (m || "").includes("Ноги") || (m || "").includes("бедра") || (m || "").includes("Икры") || (m || "").includes("Ягодицы") },
    { id: "Дельты", nameRu: "Плечи", nameEn: "Shoulders", match: m => (m || "").includes("дельт") || (m || "").includes("Дельт") || (m || "").includes("Плеч") },
    { id: "Бицепс", nameRu: "Бицепс", nameEn: "Biceps", match: m => (m || "").includes("Бицепс") },
    { id: "Трицепс", nameRu: "Трицепс", nameEn: "Triceps", match: m => (m || "").includes("Трицепс") },
    { id: "Пресс", nameRu: "Пресс", nameEn: "Abs", match: m => (m || "").includes("Пресс") }
  ];

  if (!sharedState.selectedMuscleGroup) {
    sharedState.selectedMuscleGroup = "Грудь";
  }

  // Topbar
  const title = h("h1", {}, t("nav.exercises") || "Упражнения");
  const countSub = h("span", { class: "sub" }, isEn()
    ? `${exercises.length} in base`
    : `${exercises.length} ${pluralize(exercises.length, "упражнение", "упражнения", "упражнений")}`);
  const spacer = h("span", { class: "spacer" });

  const searchInput = h("input", {
    type: "search",
    class: "searchIn",
    placeholder: isEn() ? "Search by title…" : "Поиск по названию…",
    value: sharedState.exerciseSearchQuery || "",
    oninput: () => {
      sharedState.exerciseSearchQuery = searchInput.value.trim().toLowerCase();
      renderLeftCol();
    }
  });

  const newExBtn = h("button", {
    type: "button",
    class: "btnP",
    onclick: () => {
      openExerciseForm(null, (saved) => {
        if (saved) sharedState.selectedExerciseId = saved.id;
        container.replaceWith(renderDesktopExercises());
      });
    }
  }, "+ " + (isEn() ? "Exercise" : "Упражнение"));

  const topbar = h("header", { class: "topbar" }, title, countSub, spacer, searchInput, newExBtn);

  // Layout: colsEx
  const cols = h("div", { class: "colsEx" });
  const leftCol = h("div", {});
  const rightCard = h("div", { class: "card" });

  function renderLeftCol() {
    clear(leftCol);
    const query = sharedState.exerciseSearchQuery;

    if (query) {
      // Показ списка найденных упражнений по поиску
      const matched = exercises.filter(e => e.name.toLowerCase().includes(query));
      const resHeader = h("div", { class: "secLabel", style: "margin-bottom:10px" },
        isEn() ? `SEARCH RESULTS · ${matched.length}` : `РЕЗУЛЬТАТЫ ПОИСКА · ${matched.length}`);
      const resList = h("div", { class: "pList" });
      if (!matched.length) {
        resList.append(h("div", { class: "sub" }, isEn() ? "No exercises found" : "Ничего не найдено"));
      } else {
        matched.forEach(ex => {
          const isSel = ex.id === sharedState.selectedExerciseId;
          const c = h("button", {
            type: "button",
            class: "pCard" + (isSel ? " sel" : ""),
            onclick: () => {
              sharedState.selectedExerciseId = ex.id;
              leftCol.querySelectorAll(".pCard").forEach(el => el.classList.toggle("sel", el === c));
              renderDetail(ex);
            }
          },
            h("b", {}, ex.name),
            h("span", {}, ex.muscleGroup || "")
          );
          resList.append(c);
        });
      }
      leftCol.append(resHeader, resList);
      return;
    }

    // Сетка групп мышц 2xN
    const gGrid = h("div", { class: "gGrid" });

    groups.forEach(g => {
      const count = exercises.filter(e => g.match(e.muscleGroup)).length;
      const isSel = g.id === sharedState.selectedMuscleGroup;
      const gName = isEn() ? g.nameEn : g.nameRu;
      const countLabel = isEn()
        ? `${count} ${count === 1 ? "exercise" : "exercises"}`
        : `${count} ${pluralize(count, "упражнение", "упражнения", "упражнений")}`;

      const card = h("button", {
        type: "button",
        class: "gCard" + (isSel ? " sel" : ""),
        onclick: () => {
          sharedState.selectedMuscleGroup = g.id;
          leftCol.querySelectorAll(".gCard").forEach(c => c.classList.toggle("sel", c === card));

          const curGroupExercises = exercises.filter(e => g.match(e.muscleGroup));
          if (curGroupExercises.length > 0) {
            sharedState.selectedExerciseId = curGroupExercises[0].id;
            renderDetail(curGroupExercises[0]);
          }
          renderLeftCol();
        }
      },
        h("b", {}, gName),
        h("span", {}, countLabel)
      );

      gGrid.append(card);
    });

    // Список упражнений выбранной группы
    const curGroupObj = groups.find(g => g.id === sharedState.selectedMuscleGroup) || groups[1];
    const curGroupExercises = exercises.filter(e => curGroupObj.match(e.muscleGroup));
    const gTitle = isEn() ? curGroupObj.nameEn : curGroupObj.nameRu;

    const listHead = h("div", { class: "secLabel", style: "margin: 14px 0 8px;" },
      `${gTitle.toUpperCase()} · ${curGroupExercises.length}`);

    const exList = h("div", { class: "pList", style: "max-height: calc(100vh - 360px); overflow-y: auto; padding-right: 4px;" });

    if (curGroupExercises.length === 0) {
      exList.append(h("div", { class: "sub" }, isEn() ? "No exercises in this group" : "В этой группе пока нет упражнений"));
    } else {
      curGroupExercises.forEach(ex => {
        const isSel = ex.id === sharedState.selectedExerciseId;
        const c = h("button", {
          type: "button",
          class: "pCard" + (isSel ? " sel" : ""),
          onclick: () => {
            sharedState.selectedExerciseId = ex.id;
            exList.querySelectorAll(".pCard").forEach(el => el.classList.toggle("sel", el === c));
            renderDetail(ex);
          }
        },
          h("b", {}, ex.name),
          h("span", {}, `${ex.muscleGroup || ""}${ex.equipment ? " · " + ex.equipment : ""}`)
        );
        exList.append(c);
      });
    }

    leftCol.append(gGrid, listHead, exList);
  }

  function renderDetail(exercise) {
    clear(rightCard);
    if (!exercise) {
      rightCard.append(h("div", { class: "sub" }, isEn() ? "Select an exercise" : "Выберите упражнение"));
      return;
    }

    // Рекорды и история по этому упражнению
    const historyEntries = [];
    (state.sessions || []).filter(s => s.status === "done").forEach(s => {
      (s.entries || []).forEach(e => {
        if (e.exerciseId === exercise.id) {
          historyEntries.push({ session: s, entry: e });
        }
      });
    });
    historyEntries.sort((a, b) => (b.session.startedAt || 0) - (a.session.startedAt || 0));

    let prWeight = 0, prReps = 0;
    historyEntries.forEach(({ entry }) => {
      (entry.sets || []).forEach(st => {
        if (st.done && (st.weight || 0) > prWeight) {
          prWeight = st.weight || 0;
          prReps = st.reps || 0;
        }
      });
    });

    // Header
    const headRow = h("div", { style: "display:flex;gap:10px;align-items:center" },
      h("b", { style: "font-size:19px" }, exercise.name),
      h("span", { class: "tag" }, exercise.muscleGroup),
      h("span", { class: "spacer" }),
      prWeight > 0 ? h("span", { class: "tag", style: "background:var(--ink);color:#fff" }, `PR ${prWeight} кг × ${prReps}`) : null
    );

    // SVG Chart e1RM
    const chartSvg = createExerciseDetailSvg(historyEntries);

    // Последние выполнения
    const recentTitle = h("h4", { style: "margin-top:14px" }, t("exercises.recentPerformances") || "Последние выполнения");
    const recentsBox = h("div", {});

    if (historyEntries.length === 0) {
      recentsBox.append(h("div", { class: "sub" }, isEn() ? "No workout history yet" : "История выполнений отсутствует"));
    } else {
      historyEntries.slice(0, 4).forEach(({ session, entry }) => {
        const dt = new Date(session.startedAt || 0);
        const dateStr = `${dt.getDate()} ${getMonthName(dt.getMonth())}`;
        let bestW = 0, bestR = 0, vol = 0;
        (entry.sets || []).forEach(st => {
          if (st.done) {
            vol += (st.weight || 0) * (st.reps || 0);
            if ((st.weight || 0) > bestW) {
              bestW = st.weight || 0;
              bestR = st.reps || 0;
            }
          }
        });

        const row = h("div", { class: "tblRow" },
          h("span", {}, dateStr),
          h("b", {}, `${bestW} кг × ${bestR}`),
          h("span", {}, `объём ${Math.round(vol)} кг`)
        );
        recentsBox.append(row);
      });
    }

    // Параметры
    const paramsTitle = h("h4", { style: "margin-top:14px" }, t("exercises.parameters") || "Параметры");
    const equipRow = h("div", { class: "tblRow" },
      h("span", {}, t("exercises.equipment") || "Оборудование"),
      h("b", {}, exercise.equipment || (isEn() ? "dumbbells" : "гантели")),
      h("span", {})
    );
    const restRow = h("div", { class: "tblRow" },
      h("span", {}, t("exercises.defaultRest") || "Отдых по умолчанию"),
      h("b", {}, fmtRest(exercise.restSec || 90)),
      h("span", {})
    );

    // Кнопки действий: Добавить в программу + Редактировать + В архив
    const addProgBtn = h("button", {
      type: "button",
      class: "btnP",
      onclick: () => openAddToProgramModal(exercise)
    }, t("exercises.addToProgram") || "Добавить в программу");

    const editBtn = h("button", {
      type: "button",
      class: "btnGhost",
      onclick: () => {
        openExerciseForm(exercise, () => {
          container.replaceWith(renderDesktopExercises());
        });
      }
    }, isEn() ? "Edit" : "Редактировать");

    const archiveBtn = h("button", {
      type: "button",
      class: "quiet",
      onclick: () => {
        exercise.archived = !exercise.archived;
        saveExercise(exercise);
        toast(exercise.archived
          ? (isEn() ? "Archived" : "В архиве")
          : (isEn() ? "Restored" : "Восстановлено"));
        container.replaceWith(renderDesktopExercises());
      }
    }, exercise.archived ? (isEn() ? "Unarchive" : "Из архива") : (isEn() ? "Archive" : "В архив"));

    const actsRow = h("div", { style: "display:flex;gap:10px;margin-top:16px;flex-wrap:wrap" }, addProgBtn, editBtn, archiveBtn);

    rightCard.append(headRow, chartSvg, recentTitle, recentsBox, paramsTitle, equipRow, restRow, actsRow);
  }

  renderLeftCol();

  // Исходный выбор упражнения
  let initEx = null;
  if (sharedState.selectedExerciseId) {
    initEx = exercises.find(e => e.id === sharedState.selectedExerciseId);
  }
  if (!initEx) {
    const curGroupObj = groups.find(g => g.id === sharedState.selectedMuscleGroup) || groups[1];
    initEx = exercises.find(e => curGroupObj.match(e.muscleGroup)) || exercises[0];
  }
  if (initEx) sharedState.selectedExerciseId = initEx.id;

  renderDetail(initEx);

  cols.append(leftCol, rightCard);
  container.append(topbar, cols);
  return container;
}

function openAddToProgramModal(exercise) {
  const content = h("div", { class: "stack", style: "gap:12px" });
  content.append(h("h3", {}, t("exercises.selectProgram") || "Выберите программу"));

  const progs = (state.programs || []).filter(p => !p.archived);
  if (!progs.length) {
    content.append(h("div", { class: "sub" }, isEn() ? "No programs created yet" : "Программы ещё не созданы"));
  } else {
    progs.forEach(p => {
      const btn = h("button", {
        type: "button",
        class: "btn block",
        onclick: () => {
          p.items = p.items || [];
          p.items.push({
            exerciseId: exercise.id,
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            sets: 3,
            targetReps: "8-10",
            restSec: exercise.restSec || 90,
            note: "",
            _key: uid()
          });
          saveProgram(p);
          sh.close();
          toast(t("exercises.addedToProgramToast") || "Упражнение добавлено в программу");
        }
      }, p.name);
      content.append(btn);
    });
  }

  const sh = sheet(content, { title: isEn() ? "Add to program" : "Добавить в программу" });
}

/* ==========================================================================
   5. НАСТРОЙКИ — ANCHOR NAV + FORMS MAX-WIDTH 720
   ========================================================================== */

export function renderDesktopSettings() {
  const container = h("section", { class: "view on", id: "v-settings" });

  // Topbar
  const title = h("h1", {}, t("nav.settings") || "Настройки");
  const subTitle = h("span", { class: "sub" }, t("settings.appliedInstantly") || "применяются мгновенно");
  const topbar = h("header", { class: "topbar" }, title, subTitle);

  // Layout: colsSet (240px anchorNav + forms max-width 720px)
  const cols = h("div", { class: "colsSet" });

  const sections = [
    { id: "appearance", nameRu: "Внешний вид", nameEn: "Appearance" },
    { id: "workout", nameRu: "Тренировка", nameEn: "Workout" },
    { id: "body", nameRu: "Показатели тела", nameEn: "Body metrics" },
    { id: "data", nameRu: "Данные", nameEn: "Data" },
    { id: "app", nameRu: "Приложение", nameEn: "App" },
    { id: "account", nameRu: "Аккаунт", nameEn: "Account" }
  ];

  const activeSecId = sharedState.settingsSection || "appearance";

  const navBox = h("nav", { class: "anchorNav" });
  sections.forEach(sec => {
    const isSel = sec.id === activeSecId;
    const btn = h("button", {
      type: "button",
      class: isSel ? "on" : "",
      onclick: () => {
        sharedState.settingsSection = sec.id;
        navBox.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));
        const targetEl = document.getElementById(`sec-${sec.id}`);
        if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, isEn() ? sec.nameEn : sec.nameRu);
    navBox.append(btn);
  });

  const formsCol = h("div", {});

  // Group 1: Внешний вид (Appearance)
  const secAppearance = h("div", { class: "grp", id: "sec-appearance" });

  // Тема
  const curTheme = state.settings.theme || "system";
  const themeSeg = h("span", { class: "seg" });
  const themeOpts = [
    { id: "system", labelRu: "Сист.", labelEn: "Sys." },
    { id: "light", labelRu: "Светлая", labelEn: "Light" },
    { id: "dark", labelRu: "Тёмная", labelEn: "Dark" }
  ];
  themeOpts.forEach(opt => {
    const b = h("button", {
      type: "button",
      class: curTheme === opt.id ? "on" : "",
      onclick: () => {
        const prevTheme = state.settings.theme;
        updateSettings({ theme: opt.id });
        applyTheme();
        themeSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        showUndoSnackbar(
          t("settings.themeChanged") || "Тема изменена",
          isEn() ? "Undo" : "Отменить",
          () => {
            updateSettings({ theme: prevTheme });
            applyTheme();
          }
        );
      }
    }, isEn() ? opt.labelEn : opt.labelRu);
    themeSeg.append(b);
  });

  const rowTheme = h("div", { class: "row" },
    h("span", { class: "lab" }, h("b", {}, isEn() ? "Theme" : "Тема")),
    themeSeg
  );

  // Язык интерфейса
  const curLang = state.settings.lang || "ru";
  const langSeg = h("span", { class: "seg" });
  ["RU", "EN"].forEach(lng => {
    const isSel = (lng === "RU" && curLang === "ru") || (lng === "EN" && curLang === "en");
    const b = h("button", {
      type: "button",
      class: isSel ? "on" : "",
      onclick: () => {
        updateSettings({ lang: lng.toLowerCase() });
        location.reload();
      }
    }, lng);
    langSeg.append(b);
  });

  const rowLang = h("div", { class: "row" },
    h("span", { class: "lab" }, h("b", {}, isEn() ? "Language" : "Язык интерфейса")),
    langSeg
  );

  secAppearance.append(rowTheme, rowLang);

  // Group 2: Тренировка (Workout)
  const secWorkout = h("div", { class: "grp", id: "sec-workout" });

  // Единицы веса (кг / lb)
  const curUnit = state.settings.defaultUnit || "kg";
  const unitSeg = h("span", { class: "seg" });
  ["kg", "lb"].forEach(u => {
    const isSel = curUnit === u;
    const b = h("button", {
      type: "button",
      class: isSel ? "on" : "",
      onclick: () => {
        const prevUnit = state.settings.defaultUnit;
        updateSettings({ defaultUnit: u });
        unitSeg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        showUndoSnackbar(
          t("settings.unitChanged") || "Единицы изменены",
          isEn() ? "Undo" : "Отменить",
          () => {
            updateSettings({ defaultUnit: prevUnit });
          }
        );
      }
    }, u === "kg" ? (isEn() ? "kg" : "кг") : "lb");
    unitSeg.append(b);
  });

  const rowUnits = h("div", { class: "row" },
    h("span", { class: "lab" },
      h("b", {}, isEn() ? "Weight units" : "Единицы веса"),
      h("span", {}, isEn() ? "Recalculates across all screens" : "Пересчитает отображение во всех экранах")
    ),
    unitSeg
  );

  // Базовый отдых
  const restVal = h("b", {}, fmtRest(state.settings.restSec || 210));
  const minusRest = h("button", {
    type: "button",
    onclick: () => {
      const cur = state.settings.restSec || 210;
      if (cur > 30) {
        updateSettings({ restSec: cur - 15 });
        restVal.textContent = fmtRest(cur - 15);
      }
    }
  }, "−");
  const plusRest = h("button", {
    type: "button",
    onclick: () => {
      const cur = state.settings.restSec || 210;
      updateSettings({ restSec: cur + 15 });
      restVal.textContent = fmtRest(cur + 15);
    }
  }, "+");

  const rowRest = h("div", { class: "row" },
    h("span", { class: "lab" }, h("b", {}, isEn() ? "Default rest" : "Базовый отдых")),
    h("span", { class: "stepD" }, minusRest, restVal, plusRest)
  );

  // Автозапуск отдыха (Switch)
  const autoRestSw = h("button", {
    type: "button",
    class: "sw" + (state.settings.autoStartRest !== false ? " on" : ""),
    onclick: () => {
      const next = !autoRestSw.classList.contains("on");
      autoRestSw.classList.toggle("on", next);
      updateSettings({ autoStartRest: next });
    }
  });

  const rowAutoRest = h("div", { class: "row" },
    h("span", { class: "lab" },
      h("b", {}, isEn() ? "Auto-start rest timer" : "Автозапуск отдыха"),
      h("span", {}, isEn() ? "Timer starts when closing a set" : "Таймер стартует при закрытии сета")
    ),
    autoRestSw
  );

  // Тактильный отклик (Switch)
  const vibSw = h("button", {
    type: "button",
    class: "sw" + (state.settings.vibration !== false ? " on" : ""),
    onclick: () => {
      const next = !vibSw.classList.contains("on");
      vibSw.classList.toggle("on", next);
      updateSettings({ vibration: next });
      if (next) haptic("light");
    }
  });

  const rowVib = h("div", { class: "row" },
    h("span", { class: "lab" }, h("b", {}, isEn() ? "Haptic feedback" : "Тактильный отклик")),
    vibSw
  );

  secWorkout.append(rowUnits, rowRest, rowAutoRest, rowVib);

  // Group 3: Показатели тела (Body metrics)
  const secBody = h("div", { class: "grp", id: "sec-body" });
  const bwVal = state.settings.bodyweightKg || "";
  const bwInput = h("input", {
    type: "number",
    step: "0.1",
    class: "input",
    style: "width:110px;text-align:right",
    placeholder: "75.0",
    value: bwVal ? String(bwVal) : "",
    onchange: () => {
      const n = Number(bwInput.value);
      if (n > 0) {
        logBodyweight(n);
        toast(isEn() ? "Weight logged" : "Вес записан");
      }
    }
  });

  const rowBw = h("div", { class: "row" },
    h("span", { class: "lab" },
      h("b", {}, isEn() ? "Current body weight (kg)" : "Текущий вес тела (кг)"),
      h("span", {}, isEn() ? "Used for bodyweight exercises" : "Используется для расчёта подтягиваний и отжиманий")
    ),
    bwInput
  );
  secBody.append(rowBw);

  // Group 4: Данные (Data)
  const secData = h("div", { class: "grp", id: "sec-data" });
  const exportJsonBtn = h("button", {
    type: "button",
    class: "btnGhost",
    onclick: () => {
      const data = {
        programs: state.programs,
        exercises: state.exercises,
        sessions: state.sessions,
        settings: state.settings,
        bodyweightLog: state.bodyweightLog,
        exportedAt: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fitness-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(isEn() ? "JSON backup downloaded" : "Резервная копия скачана");
    }
  }, isEn() ? "Export JSON" : "Экспорт JSON");

  const rowData = h("div", { class: "row" },
    h("span", { class: "lab" },
      h("b", {}, isEn() ? "Backup and export" : "Резервная копия"),
      h("span", {}, isEn() ? "Download full data in JSON format" : "Скачать все данные приложения в формате JSON")
    ),
    exportJsonBtn
  );
  secData.append(rowData);

  // Group 5: Приложение (App)
  const secApp = h("div", { class: "grp", id: "sec-app" });
  const clearCacheBtn = h("button", {
    type: "button",
    class: "quiet",
    onclick: () => {
      if ("caches" in window) {
        caches.keys().then(keys => {
          keys.forEach(k => caches.delete(k));
          toast(isEn() ? "Cache cleared" : "Кэш очищен");
        });
      }
    }
  }, isEn() ? "Clear cache" : "Очистить кэш");

  const rowApp = h("div", { class: "row" },
    h("span", { class: "lab" },
      h("b", {}, isEn() ? "Fitness App Desktop v62" : "Приложение «Тренировки» Desktop v62"),
      h("span", {}, isEn() ? "Progressive Web App" : "PWA Офлайн + Облачная синхронизация")
    ),
    clearCacheBtn
  );
  secApp.append(rowApp);

  // Group 6: Аккаунт (Account)
  const secAccount = h("div", { class: "grp", id: "sec-account" });
  const u = state.user;
  const emailStr = u ? (u.email || u.displayName || "User") : "Гость";

  const logoutBtn = h("button", {
    type: "button",
    class: "btnGhost",
    onclick: () => {
      confirmDialog(
        isEn() ? "Log out from account?" : "Выйти из аккаунта?",
        () => logoutProfile()
      );
    }
  }, isEn() ? "Log out" : "Выйти");

  const rowUser = h("div", { class: "row" },
    h("span", { class: "lab" },
      h("b", {}, emailStr),
      h("span", {}, isEn() ? "Connected with Firebase Auth" : "Авторизован через Firebase Auth")
    ),
    logoutBtn
  );

  const delAccBtn = h("button", {
    type: "button",
    class: "row",
    style: "color:var(--danger)",
    onclick: () => {
      const pwd = prompt(isEn() ? "Enter your password to confirm account deletion:" : "Введите пароль для подтверждения удаления аккаунта:");
      if (pwd) {
        deleteAccount(pwd).catch(err => {
          alert((isEn() ? "Error: " : "Ошибка: ") + (err.message || String(err)));
        });
      }
    }
  },
    h("span", { class: "lab" },
      h("b", {}, isEn() ? "Delete account" : "Удалить аккаунт"),
      h("span", {}, isEn() ? "Permanently removes profile, programs, and history" : "Безвозвратно: профиль, программы, история")
    )
  );

  secAccount.append(rowUser, delAccBtn);

  formsCol.append(secAppearance, secWorkout, secBody, secData, secApp, secAccount);
  cols.append(navBox, formsCol);
  container.append(topbar, cols);
  return container;
}

/* ==========================================================================
   SVG ХЕЛПЕРЫ И ГРАФИКИ ПО КОНЦЕПТУ
   ========================================================================== */

function createDotsSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "currentColor");
  [6, 12, 18].forEach(y => {
    [9, 15].forEach(x => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(x)); c.setAttribute("cy", String(y)); c.setAttribute("r", "1.6");
      svg.append(c);
    });
  });
  return svg;
}

function createSparklineSvg(values) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "56"); svg.setAttribute("height", "18");
  if (!values || values.length < 2) return svg;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = Math.round((i / (values.length - 1)) * 54) + 1;
    const y = Math.round(15 - ((v - min) / range) * 12) + 1;
    return `${x},${y}`;
  }).join(" ");

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", pts);
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", "currentColor");
  poly.setAttribute("stroke-width", "2");
  svg.append(poly);
  return svg;
}

const NS_SVG = "http://www.w3.org/2000/svg";
function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS_SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function createLoadIndexSvg(sessions) {
  const wrap = h("div", { class: "load-index-chart-wrap", style: "display:flex;flex-direction:column;gap:6px;width:100%;position:relative;" });
  const W = 640, H = 180, pl = 36, pr = 16, pt = 16, pb = 26;

  // 1. Расчёт объёмов по 8 последним неделям
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const currMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);

  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const wStart = new Date(currMon);
    wStart.setDate(currMon.getDate() - w * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 7);
    weeks.push({
      wStart,
      wEnd,
      label: `${wStart.getDate()} ${getMonthName(wStart.getMonth())}`,
      volume: 0,
      count: 0
    });
  }

  (sessions || []).forEach(s => {
    const t = s.endedAt || s.startedAt;
    if (!t) return;
    const st = sessionStats(s);
    for (const w of weeks) {
      if (t >= w.wStart.getTime() && t < w.wEnd.getTime()) {
        w.volume += (st.volume || 0);
        w.count++;
        break;
      }
    }
  });

  const activeWeeks = weeks.filter(w => w.volume > 0);
  const avgWeeklyVol = activeWeeks.length > 0
    ? activeWeeks.reduce((acc, w) => acc + w.volume, 0) / activeWeeks.length
    : 1000;

  const points = weeks.map((w, idx) => {
    let li = 100;
    if (w.volume > 0 && avgWeeklyVol > 0) {
      li = Math.round((w.volume / avgWeeklyVol) * 100);
    } else if (w.volume === 0) {
      li = activeWeeks.length > 0 ? 40 : 100;
    }
    li = Math.max(30, Math.min(200, li));
    return {
      idx,
      label: w.label,
      fullLabel: `${w.label} – ${w.wEnd.getDate()} ${getMonthName(w.wEnd.getMonth())}`,
      volume: Math.round(w.volume),
      count: w.count,
      li
    };
  });

  const minLi = 20;
  const maxLi = 200;
  const getX = i => pl + (i * (W - pl - pr)) / (points.length - 1);
  const getY = val => pt + (1 - (val - minLi) / (maxLi - minLi)) * (H - pt - pb);

  const svg = createSvgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    style: "width:100%;height:180px;overflow:visible;cursor:crosshair;"
  });

  // Пунктирная линия 100 (база)
  const y100 = getY(100);
  const baselineLine = createSvgEl("line", {
    x1: pl, y1: y100, x2: W - pr, y2: y100,
    stroke: "var(--line)", "stroke-dasharray": "4 4", "stroke-width": "1"
  });
  const baselineText = createSvgEl("text", {
    x: pl - 6, y: y100 + 4, "text-anchor": "end", fill: "var(--ink3)",
    "font-size": "10", "font-weight": "700"
  });
  baselineText.textContent = "100";
  svg.append(baselineLine, baselineText);

  // Градиентная область под кривой
  const gradId = "load-grad-" + Math.random().toString(36).slice(2, 7);
  const defs = createSvgEl("defs");
  const grad = createSvgEl("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
  const stop1 = createSvgEl("stop", { offset: "0%", "stop-color": "currentColor", "stop-opacity": "0.15" });
  const stop2 = createSvgEl("stop", { offset: "100%", "stop-color": "currentColor", "stop-opacity": "0.01" });
  grad.append(stop1, stop2);
  defs.append(grad);
  svg.append(defs);

  const ptsStr = points.map(p => `${getX(p.idx)},${getY(p.li)}`).join(" ");
  const areaD = `M ${getX(0)},${H - pb} L ` + points.map(p => `${getX(p.idx)},${getY(p.li)}`).join(" L ") + ` L ${getX(points.length - 1)},${H - pb} Z`;
  const areaPath = createSvgEl("path", { d: areaD, fill: `url(#${gradId})` });
  const polyline = createSvgEl("polyline", {
    points: ptsStr, fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linejoin": "round", "stroke-linecap": "round"
  });
  svg.append(areaPath, polyline);

  // Интерактивное перекрестие и точка
  const lastPt = points[points.length - 1];
  const crosshair = createSvgEl("line", {
    x1: getX(lastPt.idx), y1: pt, x2: getX(lastPt.idx), y2: H - pb,
    stroke: "var(--ink3)", "stroke-dasharray": "3 4", "stroke-width": "1.5"
  });
  const activeDot = createSvgEl("circle", {
    cx: getX(lastPt.idx), cy: getY(lastPt.li), r: "5.5", fill: "var(--ink)", stroke: "var(--sheet)", "stroke-width": "2"
  });
  svg.append(crosshair, activeDot);

  // Точки на линии
  points.forEach(p => {
    const c = createSvgEl("circle", {
      cx: getX(p.idx), cy: getY(p.li), r: "3", fill: "currentColor", opacity: "0.4"
    });
    svg.append(c);
  });

  // Строка статуса под графиком
  const statusBar = h("div", {
    style: "display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink3);margin-top:6px;font-variant-numeric:tabular-nums;transition:color .12s;"
  });
  const leftLabel = h("span", {}, points[0].label);
  const midLabel = h("span", { style: "font-weight:600;color:var(--ink);" }, "");
  const rightLabel = h("span", { style: "color:var(--ink);font-weight:700;" }, "");
  statusBar.append(leftLabel, midLabel, rightLabel);

  const updateSelection = (p) => {
    crosshair.setAttribute("x1", String(getX(p.idx)));
    crosshair.setAttribute("x2", String(getX(p.idx)));
    activeDot.setAttribute("cx", String(getX(p.idx)));
    activeDot.setAttribute("cy", String(getY(p.li)));

    const statusNote = p.li >= 130
      ? (isEn() ? "High Load" : "Высокая нагрузка")
      : p.li >= 80
      ? (isEn() ? "Optimal" : "Оптимально")
      : (isEn() ? "Recovery" : "Восстановление");

    midLabel.textContent = `${p.fullLabel} · ${p.volume.toLocaleString(isEn() ? "en-US" : "ru-RU")} кг (${p.count} ${isEn() ? "wkts" : "трен."})`;
    rightLabel.textContent = `${isEn() ? "Index" : "Индекс"}: ${p.li} · ${statusNote}`;
  };

  updateSelection(lastPt);

  const onPointer = ev => {
    const r = svg.getBoundingClientRect();
    const relX = ((ev.clientX - r.left) / r.width) * W;
    let closest = points[0];
    let bestDist = Infinity;
    points.forEach(p => {
      const d = Math.abs(getX(p.idx) - relX);
      if (d < bestDist) {
        bestDist = d;
        closest = p;
      }
    });
    updateSelection(closest);
  };

  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  svg.addEventListener("mouseleave", () => updateSelection(lastPt));

  wrap.append(svg, statusBar);
  return wrap;
}

function createExerciseProgressSvg(sessions, exerciseId) {
  const wrap = h("div", { class: "ex-progress-chart-wrap", style: "display:flex;flex-direction:column;gap:6px;width:100%;position:relative;" });
  const W = 480, H = 140, pl = 36, pr = 16, pt = 14, pb = 24;

  const points = [];
  (sessions || []).forEach(s => {
    (s.entries || []).forEach(e => {
      if (e.exerciseId === exerciseId) {
        const bw = s.bodyweightKg || 0;
        const e1 = entryE1rm(e, bw);
        const vol = entryVolume(e, bw);
        let bestW = 0, bestR = 0;
        (e.sets || []).forEach(st => {
          if (st.done && (st.weight || 0) > bestW) {
            bestW = st.weight || 0;
            bestR = st.reps || 0;
          }
        });
        if (e1 && e1 > 0) {
          const t = s.endedAt || s.startedAt || 0;
          points.push({
            t,
            e1rm: Math.round(e1 * 10) / 10,
            volume: Math.round(vol),
            bestW,
            bestR,
            unit: e.unit || "kg"
          });
        }
      }
    });
  });

  points.sort((a, b) => a.t - b.t);

  const caption = h("div", {
    style: "display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink3);font-variant-numeric:tabular-nums;min-height:20px;"
  });

  if (points.length === 0) {
    wrap.append(
      h("div", {
        style: "height:120px;display:flex;align-items:center;justify-content:center;color:var(--ink3);font-size:13px;border:1px dashed var(--line);border-radius:10px;"
      }, isEn() ? "No workout history for this exercise" : "Нет данных по этому упражнению"),
      caption
    );
    return wrap;
  }

  const minE1 = Math.min(...points.map(p => p.e1rm)) * 0.9;
  const maxE1 = Math.max(...points.map(p => p.e1rm)) * 1.08 || 10;
  const minVol = Math.min(...points.map(p => p.volume)) * 0.9;
  const maxVol = Math.max(...points.map(p => p.volume)) * 1.08 || 100;

  const getX = i => points.length === 1 ? W / 2 : pl + (i * (W - pl - pr)) / (points.length - 1);
  const getYE1 = v => pt + (1 - (v - minE1) / (maxE1 - minE1 || 1)) * (H - pt - pb);
  const getYVol = v => pt + (1 - (v - minVol) / (maxVol - minVol || 1)) * (H - pt - pb);

  const svg = createSvgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    style: "width:100%;height:140px;overflow:visible;cursor:crosshair;"
  });

  // e1RM линия (сплошная)
  const ptsE1 = points.map((p, i) => `${getX(i)},${getYE1(p.e1rm)}`).join(" ");
  const lineE1 = createSvgEl("polyline", {
    points: ptsE1, fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linejoin": "round", "stroke-linecap": "round"
  });

  // Volume линия (пунктир)
  const ptsVol = points.map((p, i) => `${getX(i)},${getYVol(p.volume)}`).join(" ");
  const lineVol = createSvgEl("polyline", {
    points: ptsVol, fill: "none", stroke: "var(--ink3)", "stroke-width": "1.8", "stroke-dasharray": "4 4", "stroke-linejoin": "round", "stroke-linecap": "round"
  });

  svg.append(lineVol, lineE1);

  // Перекрестие и точки
  const lastP = points[points.length - 1];
  const crosshair = createSvgEl("line", {
    x1: getX(points.length - 1), y1: pt, x2: getX(points.length - 1), y2: H - pb,
    stroke: "var(--ink3)", "stroke-dasharray": "3 4", "stroke-width": "1.5"
  });
  const dotE1 = createSvgEl("circle", {
    cx: getX(points.length - 1), cy: getYE1(lastP.e1rm), r: "5", fill: "var(--ink)", stroke: "var(--sheet)", "stroke-width": "2"
  });
  const dotVol = createSvgEl("circle", {
    cx: getX(points.length - 1), cy: getYVol(lastP.volume), r: "4", fill: "var(--ink3)", stroke: "var(--sheet)", "stroke-width": "1.5"
  });
  svg.append(crosshair, dotVol, dotE1);

  const updateSelection = (p, idx) => {
    const cx = getX(idx);
    crosshair.setAttribute("x1", String(cx));
    crosshair.setAttribute("x2", String(cx));
    dotE1.setAttribute("cx", String(cx));
    dotE1.setAttribute("cy", String(getYE1(p.e1rm)));
    dotVol.setAttribute("cx", String(cx));
    dotVol.setAttribute("cy", String(getYVol(p.volume)));

    const d = new Date(p.t);
    const dateStr = `${d.getDate()} ${getMonthName(d.getMonth())}`;
    const bestSet = p.bestW > 0 ? `лучший: ${p.bestW} кг × ${p.bestR}` : "";
    caption.innerHTML = `<span style="font-weight:600;color:var(--ink);">${dateStr} · e1RM: ${p.e1rm} кг ${bestSet ? "· " + bestSet : ""}</span><span>объём: ${p.volume.toLocaleString(isEn() ? "en-US" : "ru-RU")} кг</span>`;
  };

  updateSelection(lastP, points.length - 1);

  const onPointer = ev => {
    const r = svg.getBoundingClientRect();
    const relX = ((ev.clientX - r.left) / r.width) * W;
    let closestIdx = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(getX(i) - relX);
      if (d < bestDist) {
        bestDist = d;
        closestIdx = i;
      }
    });
    updateSelection(points[closestIdx], closestIdx);
  };

  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  svg.addEventListener("mouseleave", () => updateSelection(lastP, points.length - 1));

  wrap.append(svg, caption);
  return wrap;
}

function createExerciseDetailSvg(historyEntries) {
  const wrap = h("div", { class: "ex-detail-chart-wrap", style: "display:flex;flex-direction:column;gap:6px;width:100%;margin-top:12px;position:relative;" });
  const W = 560, H = 150, pl = 36, pr = 16, pt = 14, pb = 24;

  const points = [];
  (historyEntries || []).forEach(({ session, entry }) => {
    const bw = session.bodyweightKg || 0;
    const e1 = entryE1rm(entry, bw);
    const vol = entryVolume(entry, bw);
    let bestW = 0, bestR = 0;
    (entry.sets || []).forEach(st => {
      if (st.done && (st.weight || 0) > bestW) {
        bestW = st.weight || 0;
        bestR = st.reps || 0;
      }
    });
    if (e1 && e1 > 0) {
      const t = session.endedAt || session.startedAt || 0;
      points.push({
        t,
        e1rm: Math.round(e1 * 10) / 10,
        volume: Math.round(vol),
        bestW,
        bestR,
        unit: entry.unit || "kg"
      });
    }
  });

  points.sort((a, b) => a.t - b.t);

  const caption = h("div", {
    style: "display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink3);font-variant-numeric:tabular-nums;min-height:20px;"
  });

  if (points.length === 0) {
    wrap.append(
      h("div", {
        style: "height:120px;display:flex;align-items:center;justify-content:center;color:var(--ink3);font-size:13px;border:1px dashed var(--line);border-radius:10px;"
      }, isEn() ? "No performance history yet" : "История выполнений отсутствует"),
      caption
    );
    return wrap;
  }

  const minE1 = Math.min(...points.map(p => p.e1rm)) * 0.9;
  const maxE1 = Math.max(...points.map(p => p.e1rm)) * 1.08 || 10;

  const getX = i => points.length === 1 ? W / 2 : pl + (i * (W - pl - pr)) / (points.length - 1);
  const getY = v => pt + (1 - (v - minE1) / (maxE1 - minE1 || 1)) * (H - pt - pb);

  const svg = createSvgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    style: "width:100%;height:150px;overflow:visible;cursor:crosshair;"
  });

  // Градиентная подложка
  const gradId = "ex-det-grad-" + Math.random().toString(36).slice(2, 7);
  const defs = createSvgEl("defs");
  const grad = createSvgEl("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
  const stop1 = createSvgEl("stop", { offset: "0%", "stop-color": "currentColor", "stop-opacity": "0.15" });
  const stop2 = createSvgEl("stop", { offset: "100%", "stop-color": "currentColor", "stop-opacity": "0.01" });
  grad.append(stop1, stop2);
  defs.append(grad);
  svg.append(defs);

  const ptsStr = points.map((p, i) => `${getX(i)},${getY(p.e1rm)}`).join(" ");
  const areaD = `M ${getX(0)},${H - pb} L ` + points.map((p, i) => `${getX(i)},${getY(p.e1rm)}`).join(" L ") + ` L ${getX(points.length - 1)},${H - pb} Z`;
  const areaPath = createSvgEl("path", { d: areaD, fill: `url(#${gradId})` });
  const polyline = createSvgEl("polyline", {
    points: ptsStr, fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linejoin": "round", "stroke-linecap": "round"
  });
  svg.append(areaPath, polyline);

  // Перекрестие и точка
  const lastP = points[points.length - 1];
  const crosshair = createSvgEl("line", {
    x1: getX(points.length - 1), y1: pt, x2: getX(points.length - 1), y2: H - pb,
    stroke: "var(--ink3)", "stroke-dasharray": "3 4", "stroke-width": "1.5"
  });
  const dot = createSvgEl("circle", {
    cx: getX(points.length - 1), cy: getY(lastP.e1rm), r: "5.5", fill: "var(--ink)", stroke: "var(--sheet)", "stroke-width": "2"
  });
  svg.append(crosshair, dot);

  // Статичные точки
  points.forEach((p, i) => {
    const c = createSvgEl("circle", {
      cx: getX(i), cy: getY(p.e1rm), r: "3", fill: "currentColor", opacity: "0.4"
    });
    svg.append(c);
  });

  const updateSelection = (p, idx) => {
    const cx = getX(idx);
    crosshair.setAttribute("x1", String(cx));
    crosshair.setAttribute("x2", String(cx));
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(getY(p.e1rm)));

    const d = new Date(p.t);
    const dateStr = `${d.getDate()} ${getMonthName(d.getMonth())}`;
    const bestSet = p.bestW > 0 ? `подход: ${p.bestW} кг × ${p.bestR}` : "";
    caption.innerHTML = `<span style="font-weight:600;color:var(--ink);">${dateStr} · e1RM: ${p.e1rm} кг ${bestSet ? "· " + bestSet : ""}</span><span>объём: ${p.volume.toLocaleString(isEn() ? "en-US" : "ru-RU")} кг</span>`;
  };

  updateSelection(lastP, points.length - 1);

  const onPointer = ev => {
    const r = svg.getBoundingClientRect();
    const relX = ((ev.clientX - r.left) / r.width) * W;
    let closestIdx = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(getX(i) - relX);
      if (d < bestDist) {
        bestDist = d;
        closestIdx = i;
      }
    });
    updateSelection(points[closestIdx], closestIdx);
  };

  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  svg.addEventListener("mouseleave", () => updateSelection(lastP, points.length - 1));

  wrap.append(svg, caption);
  return wrap;
}

function createHeatmapGrid(sessions) {
  const wrap = h("div", { class: "heat-wrap-block", style: "display:flex;flex-direction:column;gap:4px;" });
  const heat = h("div", { class: "heat" });
  const tip = h("div", {
    class: "heat-tip muted",
    style: "font-size:12.5px;min-height:22px;display:flex;align-items:center;color:var(--ink3);margin-top:6px;font-variant-numeric:tabular-nums;transition:color .12s;"
  });

  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0=Пн, 6=Вс
  const currMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const startMon = new Date(currMon);
  startMon.setDate(currMon.getDate() - 11 * 7);

  const dayKey = ts => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const todayKey = dayKey(now.getTime());

  const byDay = new Map();
  let total12wWorkouts = 0;
  let total12wTonnage = 0;

  (sessions || []).forEach(s => {
    const t = s.endedAt || s.startedAt;
    if (!t) return;
    const k = dayKey(t);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  });

  const defaultTip = () => {
    tip.textContent = isEn()
      ? `${total12wWorkouts} workouts in 12 weeks · Hover over a day for details`
      : `${total12wWorkouts} ${pluralize(total12wWorkouts, "тренировка", "тренировки", "тренировок")} за 12 недель · Наведите на день для деталей`;
  };

  // 12 недель = 84 дня (7 x 12), grid-auto-flow: column
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(startMon);
      cellDate.setDate(startMon.getDate() + col * 7 + row);
      const ts = cellDate.getTime();
      const k = dayKey(ts);
      const isFuture = cellDate.getTime() > now.getTime() && k !== todayKey;
      const isToday = k === todayKey;
      const daySessions = byDay.get(k) || [];

      let cellVol = 0;
      daySessions.forEach(s => {
        const st = sessionStats(s);
        cellVol += (st.volume || 0);
      });

      if (!isFuture && daySessions.length > 0) {
        total12wWorkouts += daySessions.length;
        total12wTonnage += cellVol;
      }

      const i = document.createElement("i");
      if (daySessions.length > 0) {
        if (cellVol >= 8000) i.className = "l3";
        else if (cellVol >= 3000) i.className = "l2";
        else i.className = "l1";
      }
      if (isToday) i.classList.add("today");
      if (isFuture) i.classList.add("future");

      const dateStr = `${cellDate.getDate()} ${getMonthName(cellDate.getMonth())}`;
      const dayName = [
        isEn() ? "Mon" : "Пн",
        isEn() ? "Tue" : "Вт",
        isEn() ? "Wed" : "Ср",
        isEn() ? "Thu" : "Чт",
        isEn() ? "Fri" : "Пт",
        isEn() ? "Sat" : "Сб",
        isEn() ? "Sun" : "Вс"
      ][row];

      const fullLabel = `${dayName}, ${dateStr}`;

      const onEnter = () => {
        haptic("light");
        if (isFuture) {
          tip.textContent = `${fullLabel} · ${isEn() ? "Future" : "Будущее"}`;
        } else if (daySessions.length === 0) {
          tip.textContent = `${fullLabel} · ${isEn() ? "Rest day" : "День отдыха"}`;
        } else {
          const names = daySessions.map(s => s.programName || (isEn() ? "Workout" : "Тренировка")).join(", ");
          const vStr = Math.round(cellVol).toLocaleString(isEn() ? "en-US" : "ru-RU");
          tip.textContent = `${fullLabel} · ${daySessions.length} ${pluralize(daySessions.length, "трен.", "трен.", "трен.")} · ${vStr} кг (${names})`;
        }
        tip.style.color = "var(--ink)";
      };

      const onLeave = () => {
        tip.style.color = "var(--ink3)";
        defaultTip();
      };

      i.addEventListener("mouseenter", onEnter);
      i.addEventListener("mouseleave", onLeave);
      i.addEventListener("click", onEnter);

      heat.append(i);
    }
  }

  defaultTip();
  wrap.append(heat, tip);
  return wrap;
}

function createBodySvgFront(muscleSets) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "110"); svg.setAttribute("viewBox", "0 0 90 140");

  const hasChest = (muscleSets["Грудь"] || 0) > 0;
  const hasBiceps = (muscleSets["Бицепс"] || 0) > 0;
  const chestColor = hasChest ? "#0A0A0B" : "#E4E4E9";
  const armColor = hasBiceps ? "#55555C" : "#E4E4E9";

  svg.innerHTML = `
    <circle cx="45" cy="13" r="11" fill="#E4E4E9"/>
    <rect x="28" y="26" width="34" height="48" rx="10" fill="#E4E4E9"/>
    <rect x="30" y="30" width="14" height="11" rx="5" fill="${chestColor}"/>
    <rect x="46" y="30" width="14" height="11" rx="5" fill="${chestColor}"/>
    <rect x="14" y="28" width="11" height="40" rx="5.5" fill="#E4E4E9"/>
    <rect x="65" y="28" width="11" height="40" rx="5.5" fill="#E4E4E9"/>
    <ellipse cx="19.5" cy="40" rx="5" ry="8.5" fill="${armColor}"/>
    <ellipse cx="70.5" cy="40" rx="5" ry="8.5" fill="${armColor}"/>
    <rect x="30" y="76" width="13" height="54" rx="6.5" fill="#E4E4E9"/>
    <rect x="47" y="76" width="13" height="54" rx="6.5" fill="#E4E4E9"/>
  `;
  return svg;
}

function createBodySvgBack(muscleSets) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "110"); svg.setAttribute("viewBox", "0 0 90 140");

  const hasBack = (muscleSets["Спина"] || 0) > 0;
  const backColor = hasBack ? "#0A0A0B" : "#E4E4E9";

  svg.innerHTML = `
    <circle cx="45" cy="13" r="11" fill="#E4E4E9"/>
    <rect x="28" y="26" width="34" height="48" rx="10" fill="#E4E4E9"/>
    <path d="M30 28h30v25c0 9.5-6.5 15-15 18-8.5-3-15-8.5-15-18z" fill="${backColor}"/>
    <rect x="14" y="28" width="11" height="40" rx="5.5" fill="#E4E4E9"/>
    <rect x="65" y="28" width="11" height="40" rx="5.5" fill="#E4E4E9"/>
    <ellipse cx="19.5" cy="42" rx="5" ry="8.5" fill="#55555C"/>
    <ellipse cx="70.5" cy="42" rx="5" ry="8.5" fill="#55555C"/>
    <rect x="30" y="76" width="13" height="54" rx="6.5" fill="#E4E4E9"/>
    <rect x="47" y="76" width="13" height="54" rx="6.5" fill="#E4E4E9"/>
  `;
  return svg;
}

/* ==========================================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
   ========================================================================== */

function formatNumber(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtTime(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  return `${h}:${m < 10 ? "0" : ""}${m}`;
}

function pluralize(n, one, two, five) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return five;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return two;
  return five;
}

function calcPersonalRecords(doneSessions) {
  const map = {};
  doneSessions.forEach(s => {
    (s.entries || []).forEach(e => {
      const ex = getExercise(e.exerciseId);
      const name = ex?.name || e.name || "Упражнение";
      (e.sets || []).forEach(st => {
        if (st.done && st.weight && st.reps) {
          const e1 = epley(st.weight, st.reps);
          if (!map[name] || e1 > map[name].e1rm) {
            map[name] = { name, weight: st.weight, reps: st.reps, e1rm: e1 };
          }
        }
      });
    });
  });
  return Object.values(map).sort((a, b) => b.e1rm - a.e1rm);
}

function calcMuscleVolumeMap(sessions) {
  const map = {};
  sessions.forEach(s => {
    (s.entries || []).forEach(e => {
      const ex = getExercise(e.exerciseId);
      const mg = ex?.muscleGroup || e.muscleGroup || "Другое";
      let v = 0;
      (e.sets || []).forEach(st => {
        if (st.done) v += toKg(st.weight || 0, e.unit) * (st.reps || 0);
      });
      map[mg] = (map[mg] || 0) + v;
    });
  });
  return map;
}

function getTopExercises(sessions) {
  const counts = {};
  sessions.forEach(s => {
    (s.entries || []).forEach(e => {
      if (e.exerciseId) counts[e.exerciseId] = (counts[e.exerciseId] || 0) + 1;
    });
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.map(([id]) => getExercise(id)).filter(Boolean);
}
