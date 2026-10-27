import { h, clear, sheet, confirmDialog, toast, parseNum, fmtRest, icon, iconBtn, enableDragSort, haptic, showUndoSnackbar } from "../ui.js";
import { state, saveProgram, deleteProgram, getExercise, activeSession, uid, saveExercise, COMMON_LIBRARY_EXERCISES } from "../store.js";
import { pickExercise } from "./exercises.js";
import { startSession } from "./workout.js";
import { renderBodyMap } from "../bodyMap.js";
import { t, isEn } from "../i18n.js";

export const PROGRAM_TEMPLATES = [
  {
    id: "tpl-fullbody",
    nameRu: "Full Body (Фулбоди)",
    nameEn: "Full Body",
    descRu: "Базовая программа на всё тело. 2–3 тренировки в неделю с равномерной нагрузкой.",
    descEn: "Full-body workout for 2–3 sessions per week. Balanced volume across all major muscle groups.",
    tagRu: "Все мышцы · 5 упр. · ~55 мин",
    tagEn: "All Muscles · 5 ex · ~55 min",
    items: [
      { exerciseId: "ex-squat", name: "Приседания со штангой", nameEn: "Barbell Squat", muscleGroup: "Квадрицепс", sets: 3, targetReps: "8-10", restSec: 180 },
      { exerciseId: "ex-bench-press", name: "Жим штанги лёжа", nameEn: "Barbell Bench Press", muscleGroup: "Грудь", sets: 3, targetReps: "8-10", restSec: 180 },
      { exerciseId: "seed-pullups", name: "Подтягивания", nameEn: "Pull-ups", muscleGroup: "Спина", sets: 3, targetReps: "8-10", restSec: 180, isBodyweight: true },
      { exerciseId: "ex-ohp-db", name: "Жим гантелей сидя", nameEn: "Seated Dumbbell OHP", muscleGroup: "Плечи", sets: 3, targetReps: "10-12", restSec: 120 },
      { exerciseId: "ex-rdl", name: "Румынская тяга", nameEn: "Romanian Deadlift", muscleGroup: "Задняя поверхность бедра", sets: 3, targetReps: "10-12", restSec: 150 }
    ]
  },
  {
    id: "tpl-upper",
    nameRu: "Верх тела (Upper Body)",
    nameEn: "Upper Body",
    descRu: "Грудь, спина, дельты и руки. Верхняя половина сплита Верх / Низ.",
    descEn: "Intense upper body focus: chest, lats, shoulders, and arms. Core of an Upper/Lower split.",
    tagRu: "Грудь + Спина + Плечи · 5 упр. · ~50 мин",
    tagEn: "Chest + Back + Shoulders · 5 ex · ~50 min",
    items: [
      { exerciseId: "ex-bench-press", name: "Жим штанги лёжа", nameEn: "Barbell Bench Press", muscleGroup: "Грудь", sets: 4, targetReps: "6-8", restSec: 180 },
      { exerciseId: "ex-bb-row", name: "Тяга штанги в наклоне", nameEn: "Bent-over Barbell Row", muscleGroup: "Спина", sets: 4, targetReps: "8-10", restSec: 150 },
      { exerciseId: "ex-incline-db", name: "Жим гантелей наклонный (30°)", nameEn: "Incline DB Press (30°)", muscleGroup: "Грудь", sets: 3, targetReps: "8-10", restSec: 120 },
      { exerciseId: "seed-pullups", name: "Подтягивания", nameEn: "Pull-ups", muscleGroup: "Спина", sets: 3, targetReps: "8-12", restSec: 150, isBodyweight: true },
      { exerciseId: "ex-db-lat-raise", name: "Махи гантелями в стороны", nameEn: "DB Lateral Raises", muscleGroup: "Плечи (Средняя)", sets: 3, targetReps: "12-15", restSec: 90 }
    ]
  },
  {
    id: "tpl-lower",
    nameRu: "Низ тела (Lower Body)",
    nameEn: "Lower Body",
    descRu: "Квадрицепсы, задняя цепь, ягодицы и икры. Нижняя половина сплита Верх / Низ.",
    descEn: "Targeted quad, hamstring, glute, and calf training. The lower half of an Upper/Lower split.",
    tagRu: "Ноги + Ягодицы · 4 упр. · ~45 мин",
    tagEn: "Quads + Hamstrings + Glutes · 4 ex · ~45 min",
    items: [
      { exerciseId: "ex-squat", name: "Приседания со штангой", nameEn: "Barbell Squat", muscleGroup: "Квадрицепс", sets: 4, targetReps: "6-8", restSec: 180 },
      { exerciseId: "ex-rdl", name: "Румынская тяга", nameEn: "Romanian Deadlift", muscleGroup: "Задняя поверхность бедра", sets: 4, targetReps: "8-10", restSec: 150 },
      { exerciseId: "ex-leg-press", name: "Жим ногами в тренажёре", nameEn: "Leg Press", muscleGroup: "Квадрицепс", sets: 3, targetReps: "10-12", restSec: 120 },
      { exerciseId: "ex-leg-curl", name: "Сгибания ног лёжа", nameEn: "Lying Leg Curls", muscleGroup: "Задняя поверхность бедра", sets: 3, targetReps: "12-15", restSec: 90 }
    ]
  },
  {
    id: "tpl-push",
    nameRu: "Push (Грудь / Плечи / Трицепс)",
    nameEn: "Push (Chest, Shoulders, Triceps)",
    descRu: "Жимовой день сплита Push / Pull / Legs.",
    descEn: "All pushing motions: chest, anterior delts, and triceps. Standard Push/Pull/Legs session.",
    tagRu: "Грудь + Плечи + Трицепс · 5 упр. · ~50 мин",
    tagEn: "Chest + Delts + Triceps · 5 ex · ~50 min",
    items: [
      { exerciseId: "ex-bench-press", name: "Жим штанги лёжа", nameEn: "Barbell Bench Press", muscleGroup: "Грудь", sets: 4, targetReps: "6-8", restSec: 180 },
      { exerciseId: "ex-incline-db", name: "Жим гантелей наклонный (30°)", nameEn: "Incline DB Press (30°)", muscleGroup: "Грудь", sets: 3, targetReps: "8-10", restSec: 120 },
      { exerciseId: "ex-ohp-db", name: "Жим гантелей сидя", nameEn: "Seated Dumbbell OHP", muscleGroup: "Плечи", sets: 3, targetReps: "8-10", restSec: 120 },
      { exerciseId: "ex-dips", name: "Отжимания на брусьях", nameEn: "Parallel Bar Dips", muscleGroup: "Грудь", sets: 3, targetReps: "8-12", restSec: 120, isBodyweight: true },
      { exerciseId: "ex-rope-pushdown", name: "Разгибания на блоке с канатом", nameEn: "Cable Rope Pushdown", muscleGroup: "Трицепс", sets: 3, targetReps: "12-15", restSec: 90 }
    ]
  },
  {
    id: "tpl-pull",
    nameRu: "Pull (Спина / Бицепс / Задняя дельта)",
    nameEn: "Pull (Back, Rear Delts, Biceps)",
    descRu: "Тяговый день сплита Push / Pull / Legs.",
    descEn: "All pulling motions: lat width, back thickness, rear delts, and biceps.",
    tagRu: "Спина + Бицепс + Дельты · 5 упр. · ~50 мин",
    tagEn: "Back + Biceps + Delts · 5 ex · ~50 min",
    items: [
      { exerciseId: "seed-pullups", name: "Подтягивания", nameEn: "Pull-ups", muscleGroup: "Спина", sets: 4, targetReps: "6-10", restSec: 180, isBodyweight: true },
      { exerciseId: "ex-bb-row", name: "Тяга штанги в наклоне", nameEn: "Bent-over Barbell Row", muscleGroup: "Спина", sets: 4, targetReps: "8-10", restSec: 150 },
      { exerciseId: "ex-seated-row", name: "Тяга горизонтального блока", nameEn: "Seated Cable Row", muscleGroup: "Спина", sets: 3, targetReps: "10-12", restSec: 120 },
      { exerciseId: "ex-rear-delt", name: "Разведение гантелей в наклоне", nameEn: "Reverse Fly / Rear Delt", muscleGroup: "Плечи (Задняя)", sets: 3, targetReps: "12-15", restSec: 90 },
      { exerciseId: "ex-bb-curl", name: "Подъём EZ-штанги на бицепс", nameEn: "EZ-Bar Biceps Curl", muscleGroup: "Бицепс", sets: 3, targetReps: "10-12", restSec: 90 }
    ]
  },
  {
    id: "tpl-arms",
    nameRu: "Руки и плечи (Arms & Shoulders)",
    nameEn: "Arms & Shoulders",
    descRu: "Специализация на дельты, бицепс и трицепс.",
    descEn: "Hypertrophy-focused arm and shoulder volume for maximal pump and shape.",
    tagRu: "Плечи + Бицепс + Трицепс · 5 упр. · ~45 мин",
    tagEn: "Shoulders + Biceps + Triceps · 5 ex · ~45 min",
    items: [
      { exerciseId: "ex-ohp-db", name: "Жим гантелей сидя", nameEn: "Seated Dumbbell OHP", muscleGroup: "Плечи", sets: 4, targetReps: "8-10", restSec: 120 },
      { exerciseId: "ex-db-lat-raise", name: "Махи гантелями в стороны", nameEn: "DB Lateral Raises", muscleGroup: "Плечи (Средняя)", sets: 4, targetReps: "12-15", restSec: 75 },
      { exerciseId: "ex-bb-curl", name: "Подъём EZ-штанги на бицепс", nameEn: "EZ-Bar Biceps Curl", muscleGroup: "Бицепс", sets: 3, targetReps: "10-12", restSec: 90 },
      { exerciseId: "ex-skullcrusher", name: "Французский жим с EZ-штангой", nameEn: "EZ-Bar Skull Crusher", muscleGroup: "Трицепс", sets: 3, targetReps: "10-12", restSec: 90 },
      { exerciseId: "ex-hammer-curl", name: "Молотковые сгибания", nameEn: "Hammer Curls", muscleGroup: "Бицепс", sets: 3, targetReps: "12-15", restSec: 75 }
    ]
  }
];

function ensureExerciseInStore(exDef) {
  let ex = getExercise(exDef.exerciseId);
  if (!ex) {
    const common = COMMON_LIBRARY_EXERCISES.find(e => e.id === exDef.exerciseId);
    ex = saveExercise({
      id: exDef.exerciseId,
      name: isEn() ? (exDef.nameEn || common?.name || exDef.name) : (exDef.name || common?.name),
      muscleGroup: exDef.muscleGroup || common?.muscleGroup || "Другое",
      unit: "kg",
      defaultSets: exDef.sets || 3,
      defaultRestSec: exDef.restSec || 180,
      isBodyweight: !!(exDef.isBodyweight || common?.isBodyweight),
      note: ""
    });
  }
  return ex;
}

function getRepTip(val) {
  if (!val) return t("builder.tipHyp");
  const str = String(val).trim();
  const m = str.match(/(\d+)/g);
  if (!m || !m.length) return t("builder.tipHyp");
  const nums = m.map(Number);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;

  if (avg <= 5.5) return t("builder.tipStrength");
  if (avg <= 8) return t("builder.tipPower");
  if (avg <= 11) return t("builder.tipHyp");
  if (avg <= 14) return t("builder.tipVolume");
  return t("builder.tipPump");
}

function calcProgramStats(items) {
  let totalSets = 0;
  let totalRestSec = 0;
  const byMuscle = new Map();

  for (const it of items) {
    const ex = getExercise(it.exerciseId);
    const sets = Number(it.sets) || 3;
    totalSets += sets;
    const rest = it.restSec != null ? it.restSec : (ex ? ex.defaultRestSec : 120);
    totalRestSec += sets * (rest || 120);

    const mg = (ex?.muscleGroup || it.muscleGroup || t("common.other")).trim();
    if (mg) {
      if (!byMuscle.has(mg)) byMuscle.set(mg, { muscle: mg, sets: 0, exercises: [] });
      const rec = byMuscle.get(mg);
      rec.sets += sets;
      rec.exercises.push(ex ? ex.name : it.name);
    }
  }

  const estMinutes = Math.max(items.length > 0 ? 10 : 0, Math.round((totalSets * 45 + totalRestSec) / 60));
  return {
    totalSets,
    estMinutes,
    exerciseCount: items.length,
    muscleCount: byMuscle.size,
    byMuscle: [...byMuscle.values()]
  };
}

function getProgramAnalysis(items) {
  if (!items.length) return [];
  const findings = [];
  let totalSets = 0;
  let pushSets = 0;
  let pullSets = 0;
  let legSets = 0;

  for (const it of items) {
    const ex = getExercise(it.exerciseId);
    const sets = Number(it.sets) || 3;
    totalSets += sets;
    const mg = (ex?.muscleGroup || it.muscleGroup || "").toLowerCase();
    if (mg.includes("грудь") || mg.includes("chest") || mg.includes("трицепс") || mg.includes("triceps") || (mg.includes("плеч") && !mg.includes("задн")) || mg.includes("shoulder") || mg.includes("press")) {
      pushSets += sets;
    }
    if (mg.includes("спин") || mg.includes("back") || mg.includes("бицепс") || mg.includes("biceps") || mg.includes("задн") || mg.includes("тяг") || mg.includes("pull") || mg.includes("row")) {
      pullSets += sets;
    }
    if (mg.includes("ног") || mg.includes("leg") || mg.includes("квадр") || mg.includes("ягодиц") || mg.includes("икр") || mg.includes("бедр") || mg.includes("squat")) {
      legSets += sets;
    }
  }

  // 1. Antagonist push vs pull
  if (pushSets > 0 && pullSets > 0) {
    if (pushSets > 2 * pullSets) {
      findings.push({ type: "bad", text: t("builder.analysisImbalancePush", { push: pushSets, pull: pullSets }) });
    } else if (pullSets > 2 * pushSets) {
      findings.push({ type: "bad", text: t("builder.analysisImbalancePull", { push: pushSets, pull: pullSets }) });
    } else if (Math.abs(pushSets - pullSets) <= 2 || pushSets === pullSets) {
      findings.push({ type: "ok", text: t("builder.analysisBalancedUpper", { push: pushSets, pull: pullSets }) });
    }
  } else if (pushSets >= 4 && pullSets === 0) {
    findings.push({ type: "warn", text: t("builder.analysisNeedPull") });
  } else if (pullSets >= 4 && pushSets === 0) {
    findings.push({ type: "warn", text: t("builder.analysisNeedPush") });
  }

  // 2. Volume
  if (totalSets >= 12 && totalSets <= 22) {
    findings.push({ type: "ok", text: t("builder.analysisOptVolume", { sets: totalSets }) });
  } else if (totalSets > 22) {
    findings.push({ type: "warn", text: t("builder.analysisHigh", { sets: totalSets }) });
  } else if (items.length > 0 && items.length < 3) {
    findings.push({ type: "warn", text: t("builder.analysisFew", { n: items.length }) });
  }

  // 3. Legs
  if (legSets === 0 && (pushSets > 0 || pullSets > 0)) {
    findings.push({ type: "warn", text: t("builder.analysisNoLegs") });
  } else if (legSets > 0 && pushSets > 0 && pullSets > 0) {
    findings.push({ type: "ok", text: t("builder.analysisBalancedFull") });
  }

  if (findings.length === 0) {
    findings.push({ type: "ok", text: t("builder.analysisBalanced") });
  }

  return findings;
}

export function openProgramEditor(program) {
  const isNew = !program;
  const p = program ? JSON.parse(JSON.stringify(program)) : { name: "", items: [] };
  p.items.forEach(it => (it._key = it._key || uid()));

  let dirty = false;
  let activeTab = "exercises"; // "exercises" | "balance" | "templates"
  const expandedKeys = new Set(p.items.length > 0 ? [p.items[0]._key] : []);
  let selectedTemplateId = PROGRAM_TEMPLATES[0].id;
  let liveDebounce = null;
  let savedTimer = null;

  function setDirty(isDirty) {
    dirty = isDirty;
    if (statusDot) {
      if (dirty) {
        statusDot.className = "builder-status-dot dirty";
        statusLabel.textContent = t("builder.statusDirty");
      } else {
        statusDot.className = "builder-status-dot saved";
        statusLabel.textContent = t("builder.statusSaved");
      }
    }
  }

  // Header Elements
  const titleText = h("span", { class: "builder-title-text" }, p.name || t("builder.defaultProgName"));
  const pencilBtn = h("button", {
    type: "button",
    class: "builder-pencil-btn",
    "aria-label": t("common.rename"),
    onclick: (e) => { e.stopPropagation(); openRenameSheet(); }
  }, icon("edit", 16));

  const titleBtn = h("button", {
    type: "button",
    class: "builder-title-btn",
    onclick: openRenameSheet
  }, titleText, pencilBtn);

  const statusDot = h("span", { class: "builder-status-dot " + (dirty ? "dirty" : "saved") });
  const statusLabel = h("span", {}, dirty ? t("builder.statusDirty") : t("builder.statusSaved"));
  const statusChip = h("div", { class: "builder-status-chip", "aria-live": "polite" }, statusDot, statusLabel);

  const closeBtn = h("button", {
    type: "button",
    class: "builder-close-btn",
    "aria-label": t("common.close"),
    onpointerdown: (e) => e.stopPropagation(),
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      sh.requestClose();
    }
  }, icon("x", 16));

  // Live Meta string
  const liveMetaEl = h("div", { class: "builder-live-meta" });

  function scheduleLiveMeta() {
    if (liveDebounce) clearTimeout(liveDebounce);
    liveDebounce = setTimeout(() => {
      const stats = calcProgramStats(p.items);
      liveMetaEl.textContent = t("builder.liveMeta", {
        time: stats.estMinutes,
        ex: stats.exerciseCount,
        sets: stats.totalSets
      });
      tabBtn1.textContent = t("builder.tabExercisesCount", { n: stats.exerciseCount });
    }, 150);
  }

  // Tabs segmented control
  const thumb = h("div", { class: "builder-tab-thumb" });
  const tabBtn1 = h("button", {
    type: "button",
    class: "builder-tab-btn",
    role: "tab",
    "aria-selected": "true",
    onclick: () => switchTab("exercises")
  }, t("builder.tabExercisesCount", { n: p.items.length }));

  const tabBtn2 = h("button", {
    type: "button",
    class: "builder-tab-btn",
    role: "tab",
    "aria-selected": "false",
    onclick: () => switchTab("balance")
  }, t("builder.tabBalance"));

  const tabBtn3 = h("button", {
    type: "button",
    class: "builder-tab-btn",
    role: "tab",
    "aria-selected": "false",
    onclick: () => switchTab("templates")
  }, t("builder.tabTemplates"));

  const segmentedControl = h("div", { class: "builder-segmented-control", role: "tablist" },
    thumb,
    tabBtn1,
    tabBtn2,
    tabBtn3
  );

  const tabsStickyWrap = h("div", { class: "builder-tabs-sticky" }, segmentedControl);

  function switchTab(tab) {
    activeTab = tab;
    const tabIdx = tab === "exercises" ? 0 : (tab === "balance" ? 1 : 2);
    thumb.style.transform = `translateX(${tabIdx * 100}%)`;
    tabBtn1.setAttribute("aria-selected", tab === "exercises" ? "true" : "false");
    tabBtn2.setAttribute("aria-selected", tab === "balance" ? "true" : "false");
    tabBtn3.setAttribute("aria-selected", tab === "templates" ? "true" : "false");
    haptic("light");
    paintPane();
  }

  const paneContainer = h("div", { class: "builder-content" });

  // Tab 1: Exercises
  function renderItemsTab() {
    clear(paneContainer);

    if (p.items.length === 0) {
      const emptyState = h("div", { class: "builder-empty-state" },
        icon("drag", 48),
        h("div", { class: "builder-empty-title" }, t("builder.emptyTitle")),
        h("div", { class: "builder-empty-sub" }, t("builder.emptySub")),
        h("div", { class: "builder-empty-actions" },
          h("button", {
            type: "button",
            class: "btn primary block",
            style: "height: 44px; font-weight: 600;",
            onclick: () => {
              pickExercise(ex => {
                p.items.push({
                  _key: uid(),
                  exerciseId: ex.id,
                  name: ex.name,
                  muscleGroup: ex.muscleGroup,
                  sets: ex.defaultSets || 3,
                  restSec: ex.defaultRestSec || 120,
                  note: ""
                });
                expandedKeys.add(p.items[p.items.length - 1]._key);
                setDirty(true);
                scheduleLiveMeta();
                renderItemsTab();
              });
            }
          }, t("builder.emptyAdd")),
          h("button", {
            type: "button",
            class: "btn block",
            style: "height: 44px;",
            onclick: () => switchTab("templates")
          }, t("builder.emptyTpl"))
        )
      );
      paneContainer.append(emptyState);
      return;
    }

    const listEl = h("div", { class: "builder-ex-list" });

    p.items.forEach((it, idx) => {
      const ex = getExercise(it.exerciseId);
      const isExpanded = expandedKeys.has(it._key);

      const itemCard = h("div", {
        class: "builder-ex-item" + (isExpanded ? " is-open" : ""),
        "data-key": it._key
      });

      // Accordion Header
      const dragHandle = h("div", {
        class: "builder-drag-handle drag-handle",
        "aria-label": "Drag",
        title: "Drag to reorder"
      }, icon("drag", 16));

      const idxEl = h("span", { class: "builder-ex-idx" }, String(idx + 1));
      const nameEl = h("span", { class: "builder-ex-name" }, ex ? (isEn() ? ex.nameEn || ex.name : ex.name) : it.name);
      const muscleEl = h("span", { class: "builder-ex-muscle" }, (ex ? ex.muscleGroup : it.muscleGroup || "").toUpperCase());
      const infoEl = h("div", { class: "builder-ex-info" }, nameEl, muscleEl);

      function fmtSetsCount(n) {
        if (isEn()) return `${n} ${n === 1 ? "set" : "sets"}`;
        if (n % 10 === 1 && n % 100 !== 11) return `${n} сет`;
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} сета`;
        return `${n} сетов`;
      }
      const summaryEl = h("span", { class: "builder-ex-summary" }, fmtSetsCount(it.sets || 3));
      const chevronEl = h("span", { class: "builder-chevron" }, icon("down", 18));

      const headerRight = h("div", { class: "builder-ex-header-right" }, summaryEl, chevronEl);
      const headerLeft = h("div", { class: "builder-ex-header-left" }, dragHandle, idxEl, infoEl);

      const headerBtn = h("div", {
        class: "builder-ex-header",
        role: "button",
        "aria-expanded": isExpanded ? "true" : "false",
        onclick: (e) => {
          if (e.target.closest(".drag-handle")) return;
          if (expandedKeys.has(it._key)) {
            expandedKeys.delete(it._key);
            itemCard.classList.remove("is-open");
            headerBtn.setAttribute("aria-expanded", "false");
          } else {
            expandedKeys.add(it._key);
            itemCard.classList.add("is-open");
            headerBtn.setAttribute("aria-expanded", "true");
          }
          haptic("light");
        }
      }, headerLeft, headerRight);

      // Accordion Body: Compact & Clean Layout
      // Col 1: Sets Stepper
      const setsVal = h("span", { class: "builder-stepper-val" }, String(it.sets || 3));
      const setsMinus = h("button", {
        type: "button",
        class: "builder-stepper-btn",
        "aria-label": t("builder.setsLabel") + " -",
        onclick: () => {
          it.sets = Math.max(1, (it.sets || 3) - 1);
          setsVal.textContent = String(it.sets);
          summaryEl.textContent = fmtSetsCount(it.sets);
          setDirty(true);
          scheduleLiveMeta();
          haptic("light");
        }
      }, icon("minus", 16));

      const setsPlus = h("button", {
        type: "button",
        class: "builder-stepper-btn",
        "aria-label": t("builder.setsLabel") + " +",
        onclick: () => {
          it.sets = Math.min(20, (it.sets || 3) + 1);
          setsVal.textContent = String(it.sets);
          summaryEl.textContent = fmtSetsCount(it.sets);
          setDirty(true);
          scheduleLiveMeta();
          haptic("light");
        }
      }, icon("plus", 16));

      const setsStepper = h("div", { class: "builder-stepper" }, setsMinus, setsVal, setsPlus);

      // Col 2: Rest Stepper & Chips
      const restPresets = [
        { sec: 60, label: "1:00" },
        { sec: 90, label: "1:30" },
        { sec: 120, label: "2:00" },
        { sec: 150, label: "2:30" },
        { sec: 180, label: "3:00" }
      ];
      const curRest = it.restSec != null ? it.restSec : 120;
      const restValEl = h("span", { class: "builder-stepper-val" }, fmtRest(curRest));

      let presetButtons = [];
      function updateRestPresetStyles(val) {
        presetButtons.forEach(b => {
          b.classList.toggle("active", b._sec === val);
        });
        restValEl.textContent = fmtRest(val);
      }

      presetButtons = restPresets.map(preset => {
        const btn = h("button", {
          type: "button",
          class: "builder-rest-chip" + (curRest === preset.sec ? " active" : ""),
          onclick: () => {
            it.restSec = preset.sec;
            updateRestPresetStyles(preset.sec);
            setDirty(true);
            scheduleLiveMeta();
            haptic("light");
          }
        }, preset.label);
        btn._sec = preset.sec;
        return btn;
      });

      const restMinus = h("button", {
        type: "button",
        class: "builder-stepper-btn",
        "aria-label": t("builder.restLabel") + " -",
        onclick: () => {
          it.restSec = Math.max(15, (it.restSec || 120) - 15);
          updateRestPresetStyles(it.restSec);
          setDirty(true);
          scheduleLiveMeta();
          haptic("light");
        }
      }, icon("minus", 16));

      const restPlus = h("button", {
        type: "button",
        class: "builder-stepper-btn",
        "aria-label": t("builder.restLabel") + " +",
        onclick: () => {
          it.restSec = Math.min(600, (it.restSec || 120) + 15);
          updateRestPresetStyles(it.restSec);
          setDirty(true);
          scheduleLiveMeta();
          haptic("light");
        }
      }, icon("plus", 16));

      const restStepper = h("div", { class: "builder-stepper" }, restMinus, restValEl, restPlus);

      // Compact 2-column grid for Sets & Rest
      const compactGrid = h("div", { class: "builder-compact-grid" },
        h("div", { class: "builder-field-compact" },
          h("span", { class: "builder-field-label" }, t("builder.setsLabel")),
          setsStepper
        ),
        h("div", { class: "builder-field-compact" },
          h("span", { class: "builder-field-label" }, t("builder.restLabel")),
          restStepper
        )
      );

      const restChipsRow = h("div", { class: "builder-rest-chips-wrap" }, ...presetButtons);

      // Note Input
      const noteInput = h("input", {
        type: "text",
        class: "builder-note-input",
        value: it.note || "",
        placeholder: t("builder.notePlaceholder")
      });
      noteInput.addEventListener("input", () => {
        it.note = noteInput.value;
        setDirty(true);
      });

      // Actions
      const dupBtn = h("button", {
        type: "button",
        class: "builder-btn-subtle",
        onclick: () => {
          const clone = JSON.parse(JSON.stringify(it));
          clone._key = uid();
          p.items.splice(idx + 1, 0, clone);
          expandedKeys.add(clone._key);
          setDirty(true);
          scheduleLiveMeta();
          renderItemsTab();
          haptic("light");
        }
      }, icon("copy", 14), t("builder.duplicate"));

      const removeBtn = h("button", {
        type: "button",
        class: "builder-btn-quiet-danger",
        onclick: () => {
          const removed = p.items.splice(idx, 1)[0];
          expandedKeys.delete(it._key);
          setDirty(true);
          scheduleLiveMeta();
          renderItemsTab();
          haptic("light");
          showUndoSnackbar(t("builder.itemDeleted"), t("common.undo"), () => {
            p.items.splice(idx, 0, removed);
            expandedKeys.add(removed._key);
            setDirty(true);
            scheduleLiveMeta();
            renderItemsTab();
          }, 10000);
        }
      }, icon("trash", 14), t("builder.removeEx"));

      const actionsRow = h("div", { class: "builder-item-actions" }, dupBtn, removeBtn);

      const collapseEl = h("div", { class: "builder-ex-collapse", role: "region" },
        h("div", { class: "builder-ex-body" },
          compactGrid,
          restChipsRow,
          noteInput,
          actionsRow
        )
      );

      itemCard.append(headerBtn, collapseEl);
      listEl.append(itemCard);
    });

    enableDragSort(listEl, (newKeys) => {
      const map = new Map(p.items.map(it => [it._key, it]));
      p.items = newKeys.map(k => map.get(k)).filter(Boolean);
      setDirty(true);
      scheduleLiveMeta();
      [...listEl.children].forEach((child, i) => {
        const idEl = child.querySelector(".builder-ex-idx");
        if (idEl) idEl.textContent = String(i + 1);
      });
    });

    // Dashed Add Exercise button
    const addDashedBtn = h("button", {
      type: "button",
      class: "builder-add-dashed",
      onclick: () => {
        pickExercise(ex => {
          p.items.push({
            _key: uid(),
            exerciseId: ex.id,
            name: ex.name,
            muscleGroup: ex.muscleGroup,
            sets: ex.defaultSets || 3,
            targetReps: "8-10",
            restSec: ex.defaultRestSec || 120,
            note: ""
          });
          expandedKeys.add(p.items[p.items.length - 1]._key);
          setDirty(true);
          scheduleLiveMeta();
          renderItemsTab();
        });
      }
    }, icon("plus", 16), t("builder.addExDashed"));

    paneContainer.append(listEl, addDashedBtn);
  }

  // Tab 2: Balance
  function renderBalanceTab() {
    clear(paneContainer);
    const stats = calcProgramStats(p.items);
    const findings = getProgramAnalysis(p.items);

    // Section 1: Coverage
    const coverageTitle = h("div", { class: "builder-section-title" }, t("builder.coverageTitle"));
    const bodyMapNode = renderBodyMap(stats.byMuscle, { compact: false });

    const silhouettesBlock = h("div", { class: "builder-silhouettes-block" },
      bodyMapNode
    );

    // Muscle volume distribution bars
    const sortedMuscles = [...stats.byMuscle].sort((a, b) => b.sets - a.sets);
    const volumeRows = sortedMuscles.map(m => {
      const pct = stats.totalSets > 0 ? Math.round((m.sets / stats.totalSets) * 100) : 0;
      return h("div", { class: "builder-volume-row" },
        h("div", { class: "builder-volume-meta" },
          h("span", { class: "builder-volume-name" }, m.muscle),
          h("span", { class: "builder-volume-val" }, t("builder.volumeSetsPct", { sets: m.sets, pct }))
        ),
        h("div", { class: "builder-volume-track" },
          h("div", { class: "builder-volume-fill", style: `width: ${pct}%;` })
        )
      );
    });

    const volumeList = h("div", { class: "builder-volume-list" },
      volumeRows.length > 0 ? volumeRows : h("div", { style: "font-size: 13px; color: var(--ink-2);" }, t("builder.emptySub"))
    );

    const coverageSection = h("div", { class: "builder-section" },
      coverageTitle,
      silhouettesBlock,
      volumeList
    );

    // Section 2: Program Analysis
    const analysisTitle = h("div", { class: "builder-section-title" }, t("builder.analysisTitle"));
    const findingItems = findings.map(f => h("div", { class: "builder-finding-item" },
      h("span", { class: "builder-finding-dot " + f.type }),
      h("span", {}, f.text)
    ));

    const findingsList = h("div", { class: "builder-findings-list" }, ...findingItems);
    const analysisSection = h("div", { class: "builder-section" },
      analysisTitle,
      findingsList
    );

    paneContainer.append(coverageSection, analysisSection);
  }

  // Tab 3: Templates
  function renderTemplatesTab() {
    clear(paneContainer);

    const notice = h("div", { class: "builder-tpl-notice" }, t("builder.tplNotice"));
    const list = h("div", { class: "builder-tpl-list" });

    PROGRAM_TEMPLATES.forEach(tpl => {
      const isSelected = selectedTemplateId === tpl.id;
      const card = h("div", {
        class: "builder-tpl-card" + (isSelected ? " selected" : ""),
        onclick: () => {
          if (selectedTemplateId !== tpl.id) {
            selectedTemplateId = tpl.id;
            renderTemplatesTab();
            haptic("light");
          }
        }
      });

      const radioInner = h("div", { class: "builder-tpl-radio-inner" });
      const radio = h("div", { class: "builder-tpl-radio" }, radioInner);

      const titleEl = h("div", { class: "builder-tpl-title" }, isEn() ? tpl.nameEn : tpl.nameRu);
      const tagEl = h("div", { class: "builder-tpl-tag" }, isEn() ? tpl.tagEn : tpl.tagRu);
      const textWrap = h("div", { style: "display: flex; flex-direction: column; gap: 2px;" }, titleEl, tagEl);

      const header = h("div", { class: "builder-tpl-header" }, radio, textWrap);

      const previewItems = tpl.items.map((it, i) => {
        const name = isEn() ? it.nameEn || it.name : it.name;
        return h("div", {}, `${i + 1}. ${name} — ${it.sets} ${isEn() ? (it.sets === 1 ? 'set' : 'sets') : (it.sets >= 2 && it.sets <= 4 ? 'сета' : 'сетов')}`);
      });
      const previewList = h("div", { class: "builder-tpl-preview" }, ...previewItems);

      card.append(header, previewList);

      if (isSelected) {
        const applyBtn = h("button", {
          type: "button",
          class: "builder-tpl-apply-btn",
          onclick: (e) => {
            e.stopPropagation();
            openTemplateDiffConfirm(tpl);
          }
        }, t("builder.applyTpl"));
        card.append(applyBtn);
      }

      list.append(card);
    });

    paneContainer.append(notice, list);
  }

  function openTemplateDiffConfirm(tpl) {
    let diffSheet;
    diffSheet = sheet(
      h("div", { class: "stack", style: "gap: 16px; padding: 8px 0;" },
        h("div", { style: "display: flex; flex-direction: column; gap: 6px;" },
          h("h3", { style: "margin: 0; font-size: 18px; font-weight: 700;" }, t("builder.tplDiffTitle")),
          h("p", { style: "margin: 0; font-size: 14px; color: var(--ink-2); line-height: 1.45;" },
            t("builder.tplDiffText", { from: p.items.length, to: tpl.items.length })
          )
        ),
        h("div", { style: "display: flex; flex-direction: column; gap: 10px; margin-top: 8px;" },
          h("button", {
            type: "button",
            class: "btn primary block",
            style: "height: 48px; font-weight: 600;",
            onclick: () => {
              diffSheet.close();
              const backup = JSON.parse(JSON.stringify(p.items));
              p.items = tpl.items.map(it => {
                ensureExerciseInStore(it);
                return {
                  _key: uid(),
                  exerciseId: it.exerciseId,
                  name: it.name,
                  muscleGroup: it.muscleGroup,
                  sets: it.sets || 3,
                  targetReps: it.targetReps || "8-10",
                  restSec: it.restSec || 120,
                  note: ""
                };
              });
              setDirty(true);
              switchTab("exercises");
              scheduleLiveMeta();
              haptic("success");
              showUndoSnackbar(
                t("builder.tplAppliedToast", { name: isEn() ? tpl.nameEn : tpl.nameRu }),
                t("common.undo"),
                () => {
                  p.items = backup;
                  setDirty(true);
                  scheduleLiveMeta();
                  renderItemsTab();
                  toast(t("builder.tplUndone"));
                },
                10000
              );
            }
          }, t("builder.tplDiffOk")),
          h("button", {
            type: "button",
            class: "btn block",
            style: "height: 48px;",
            onclick: () => diffSheet.close()
          }, t("common.cancel"))
        )
      ),
      { title: "" }
    );
  }

  function paintPane() {
    if (activeTab === "exercises") renderItemsTab();
    else if (activeTab === "balance") renderBalanceTab();
    else if (activeTab === "templates") renderTemplatesTab();
  }

  // Rename bottom sheet
  function openRenameSheet() {
    let renSheet;
    const renInput = h("input", {
      type: "text",
      class: "input",
      style: "height: 44px; width: 100%; box-sizing: border-box; font-size: 15px; font-weight: 600;",
      value: p.name,
      placeholder: t("builder.renamePlaceholder"),
      autocomplete: "off"
    });

    const quickPresets = [
      { label: t("builder.chipFullbodyA"), val: isEn() ? "Full Body A" : "Фулбоди А" },
      { label: t("builder.chipFullbodyB"), val: isEn() ? "Full Body B" : "Фулбоди Б" },
      { label: t("builder.chipUpper"), val: isEn() ? "Upper Body" : "Верх тела" },
      { label: t("builder.chipLower"), val: isEn() ? "Lower Body" : "Низ тела" },
      { label: t("builder.chipPush"), val: isEn() ? "Push (Chest/Delts)" : "Push (Жим)" },
      { label: t("builder.chipPull"), val: isEn() ? "Pull (Back/Biceps)" : "Pull (Тяга)" },
      { label: t("builder.chipLegs"), val: isEn() ? "Leg Day" : "День ног" },
      { label: t("builder.chipArms"), val: isEn() ? "Arms & Shoulders" : "Руки и плечи" }
    ];

    const chipsWrap = h("div", { class: "builder-rename-chips" },
      ...quickPresets.map(preset => h("button", {
        type: "button",
        class: "builder-rename-chip",
        onclick: () => {
          renInput.value = preset.val;
          haptic("light");
          renInput.focus();
        }
      }, preset.label))
    );

    const doneBtn = h("button", {
      type: "button",
      class: "btn primary block",
      style: "height: 48px; font-weight: 600; margin-top: 14px;",
      onclick: () => {
        const val = renInput.value.trim();
        p.name = val;
        titleText.textContent = val || t("builder.defaultProgName");
        setDirty(true);
        renSheet.close();
      }
    }, t("builder.renameSave"));

    renSheet = sheet(
      h("div", { class: "stack", style: "gap: 14px; padding: 8px 0;" },
        h("div", { style: "display: flex; flex-direction: column; gap: 4px;" },
          h("h3", { style: "margin: 0; font-size: 18px; font-weight: 700;" }, t("builder.renameTitle")),
          h("p", { style: "margin: 0; font-size: 13px; color: var(--ink-2);" }, t("builder.renameSub"))
        ),
        renInput,
        chipsWrap,
        doneBtn
      ),
      { title: "" }
    );
    setTimeout(() => renInput.focus(), 150);
  }

  // Delete confirm bottom sheet (with exact name re-typing)
  function openDeleteConfirmSheet() {
    const progName = (p.name || t("builder.defaultProgName")).trim();
    let delSheet;
    const delInput = h("input", {
      type: "text",
      class: "input",
      style: "height: 44px; width: 100%; box-sizing: border-box; font-size: 14px;",
      placeholder: t("builder.deleteConfirmPlaceholder"),
      autocomplete: "off"
    });

    const confirmBtn = h("button", {
      type: "button",
      class: "btn danger block",
      style: "height: 48px; font-weight: 600;",
      disabled: true,
      onclick: () => {
        dirty = false;
        delSheet.close();
        deleteProgram(p.id);
        sh.close();
        toast(t("programs.deletedToast"));
      }
    }, t("builder.deleteConfirmBtn"));

    delInput.addEventListener("input", () => {
      confirmBtn.disabled = delInput.value.trim() !== progName;
    });

    delSheet = sheet(
      h("div", { class: "stack", style: "gap: 16px; padding: 8px 0;" },
        h("div", { style: "display: flex; flex-direction: column; gap: 6px;" },
          h("h3", { style: "margin: 0; font-size: 18px; font-weight: 700; color: #ef4444;" }, t("builder.deleteConfirmTitle")),
          h("p", { style: "margin: 0; font-size: 14px; color: var(--ink-2); line-height: 1.45;" },
            t("builder.deleteConfirmText", { name: progName })
          )
        ),
        delInput,
        confirmBtn
      ),
      { title: "" }
    );
    setTimeout(() => delInput.focus(), 150);
  }

  // Save operation
  function save(closeAfter = true) {
    const nm = (p.name || "").trim() || t("builder.defaultProgName");
    p.name = nm;
    const cleanItems = p.items.map(({ _key, ...rest }) => ({
      exerciseId: rest.exerciseId,
      sets: rest.sets || 3,
      targetReps: rest.targetReps || "8-10",
      restSec: rest.restSec ?? null,
      note: rest.note || ""
    }));

    saveProgram({ ...p, name: nm, items: cleanItems });
    setDirty(false);
    haptic("success");
    toast(t("builder.savedToast"));

    if (closeAfter) {
      sh.close();
    }
  }

  // Sticky footer
  const saveBtn = h("button", {
    type: "button",
    class: "builder-btn-save",
    onclick: () => save(true)
  }, icon("check", 18), t("builder.saveChanges"));

  const deleteBtn = !isNew ? h("button", {
    type: "button",
    class: "builder-btn-delete",
    "aria-label": t("builder.deleteProg"),
    onclick: openDeleteConfirmSheet
  }, icon("trash", 18)) : null;

  const stickyFoot = h("div", { class: "builder-sticky-footer" },
    saveBtn,
    deleteBtn
  );

  const studioContainer = h("div", { class: "builder-studio" },
    liveMetaEl,
    tabsStickyWrap,
    paneContainer,
    stickyFoot
  );

  const sh = sheet(studioContainer, {
    title: "",
    full: true, bodyClass: "no-pad builder-sheet-body",
    beforeClose: async () => {
      if (!dirty) return true;
      return new Promise((resolve) => {
        let settled = false;
        const settle = (val) => {
          if (settled) return;
          settled = true;
          resolve(val);
        };
        const confirmSheet = sheet(
          h("div", { class: "stack", style: "gap: 16px; padding: 8px 0;" },
            h("div", { style: "display: flex; flex-direction: column; gap: 6px;" },
              h("h3", { style: "margin: 0; font-size: 18px; font-weight: 700;" }, t("builder.unsavedTitle")),
              h("p", { style: "margin: 0; font-size: 14px; color: var(--ink-2); line-height: 1.45;" }, t("builder.unsavedText"))
            ),
            h("div", { style: "display: flex; flex-direction: column; gap: 10px; margin-top: 8px;" },
              h("button", {
                type: "button",
                class: "btn primary block",
                style: "height: 48px; font-weight: 600;",
                onclick: () => {
                  confirmSheet.close();
                  save(true);
                  settle(true);
                }
              }, t("builder.unsavedSave")),
              h("button", {
                type: "button",
                class: "btn block",
                style: "height: 48px; color: #ef4444; border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.08);",
                onclick: () => {
                  dirty = false;
                  confirmSheet.close();
                  settle(true);
                }
              }, t("builder.unsavedDiscard")),
              h("button", {
                type: "button",
                class: "btn block",
                style: "height: 48px;",
                onclick: () => {
                  confirmSheet.close();
                  settle(false);
                }
              }, t("builder.unsavedStay"))
            )
          ),
          {
            title: "",
            onClose: () => settle(false)
          }
        );
      });
    }
  });

  // Mount custom clean header on sheet
  const head = sh.el.querySelector(".sheet-head");
  if (head) {
    clear(head);
    head.className = "sheet-head builder-sheet-header";
    const grabber = h("div", { class: "sheet-grab", "aria-hidden": "true" });
    const headerLeft = h("div", { class: "builder-header-left" }, titleBtn, statusChip);
    head.append(grabber, headerLeft, closeBtn);
  }

  // Initial render
  const stats = calcProgramStats(p.items);
  liveMetaEl.textContent = t("builder.liveMeta", {
    time: stats.estMinutes,
    ex: stats.exerciseCount,
    sets: stats.totalSets
  });
  paintPane();
}

export function mount(root) {
  const list = h("div", { class: "list" });
  const showArchived = h("input", { type: "checkbox", class: "ios-switch" });

  function openProgramMenu(p) {
    let menuSheet;
    menuSheet = sheet(h("div", { class: "stack" },
      h("h3", { style: "margin:0" }, p.name),
      h("button", {
        class: "btn block",
        type: "button",
        onclick: () => {
          menuSheet.close();
          saveProgram({ ...p, id: uid(), name: p.name + t("programs.copySuffix"), baselineSessionId: null });
          toast(t("programs.duplicatedToast"));
          paint();
        }
      }, icon("copy", 16), t("programs.menuDuplicate")),
      h("button", {
        class: "btn block",
        type: "button",
        onclick: async () => {
          menuSheet.close();
          if (p.archived || await confirmDialog(t("programs.archiveConfirm", { name: p.name }), { ok: t("programs.archive") })) {
            saveProgram({ ...p, archived: !p.archived });
            paint();
          }
        }
      }, icon("archive", 16), p.archived ? t("programs.menuUnarchive") : t("programs.menuArchive")),
      h("button", {
        class: "btn danger block",
        type: "button",
        onclick: async () => {
          menuSheet.close();
          if (await confirmDialog(t("programs.deleteConfirm", { name: p.name }), { ok: t("common.delete"), danger: true })) {
            deleteProgram(p.id);
            toast(t("programs.deletedToast"));
            paint();
          }
        }
      }, icon("trash", 16), t("programs.menuDelete"))
    ), { title: t("programs.menuTitle") });
  }

  const paint = () => {
    clear(list);
    const act = activeSession();
    const items = state.programs.filter(p => showArchived.checked || !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) list.append(h("p", { class: "empty" }, t("programs.emptyList")));
    for (const p of items) {
      const names = p.items.map(i => getExercise(i.exerciseId)?.name).filter(Boolean);
      const isCurrentActive = act && act.programId === p.id;
      list.append(h("div", { class: "card" + (p.archived ? " archived" : "") },
        h("button", { class: "card-main", type: "button", onclick: () => openProgramEditor(p) },
          h("strong", {}, p.name + (p.archived ? t("programs.archivedSuffix") : "")),
          h("small", { class: "muted" }, t("programs.cardSub", { count: p.items.length, names: names.join(", ") || "—" }))),
        h("div", { class: "row card-actions" },
          !p.archived && (!act || isCurrentActive) ? h("button", {
            class: "btn small primary card-start-btn",
            style: "border-radius:10px !important; -webkit-border-radius:10px !important; width:auto !important; min-height:36px !important; height:36px !important; max-height:36px !important; display:inline-flex !important; flex-direction:row !important; align-items:center !important; justify-content:center !important; gap:6px !important; padding:0 16px !important; aspect-ratio:auto !important; font-size:13px !important; font-weight:700 !important; background:var(--fg) !important; color:var(--bg) !important; border:1px solid var(--fg) !important; box-shadow:none !important; flex:0 0 auto !important;",
            type: "button",
            onclick: () => {
              haptic("medium");
              if (!act) startSession(p);
              sessionStorage.setItem("fitness.openActive", "1");
              location.hash = "#/workout";
            }
          }, icon("play", 14), isCurrentActive ? t("programs.resume") : t("programs.start")) : h("span", { class: "grow" }),
          h("div", { class: "card-icons" },
            iconBtn("edit", t("common.edit"), () => openProgramEditor(p)),
            iconBtn("more", t("programs.menuTitle"), () => openProgramMenu(p))))));
    }
  };
  showArchived.addEventListener("input", paint);
  root.append(h("label", { class: "switch-row" }, showArchived, h("span", {}, t("common.showArchived"))), list,
    h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: () => openProgramEditor(null) }, t("programs.newBtn"))));
  paint();
  return { update: paint };
}
