import { h, clear, sheet, confirmDialog, toast, parseNum, fmtRest, icon, iconBtn, enableDragSort, haptic, showUndoSnackbar } from "../ui.js";
import { state, saveProgram, deleteProgram, getExercise, activeSession, uid, saveExercise, COMMON_LIBRARY_EXERCISES } from "../store.js";
import { pickExercise } from "./exercises.js";
import { startSession } from "./workout.js";
import { renderBodyMap } from "../bodyMap.js";
import { t, isEn } from "../i18n.js";

export const PROGRAM_TEMPLATES = [
  {
    id: "tpl-fullbody",
    nameRu: "Фулбоди (Всё тело)",
    nameEn: "Full Body",
    descRu: "Комплексная проработка всего тела за одно занятие. Идеально для 2–3 тренировок в неделю с максимальным стимулом для роста силы и массы.",
    descEn: "Full-body workout for 2–3 sessions per week. Balanced volume across all major muscle groups.",
    tagRu: "Все мышцы · 5 упр. · ~55 мин",
    tagEn: "All Muscles · 5 ex · ~55 min",
    items: [
      { exerciseId: "ex-squat", name: "Приседания со штангой", nameEn: "Barbell Squat", muscleGroup: "Ноги", sets: 3, targetReps: "8-10", restSec: 180 },
      { exerciseId: "ex-bench-press", name: "Жим штанги лёжа", nameEn: "Barbell Bench Press", muscleGroup: "Грудь", sets: 3, targetReps: "8-10", restSec: 180 },
      { exerciseId: "seed-pullups", name: "Подтягивания", nameEn: "Pull-ups", muscleGroup: "Спина", sets: 3, targetReps: "8-10", restSec: 180, isBodyweight: true },
      { exerciseId: "ex-ohp-db", name: "Жим гантелей сидя", nameEn: "Seated Dumbbell OHP", muscleGroup: "Дельты", sets: 3, targetReps: "10-12", restSec: 120 },
      { exerciseId: "ex-rdl", name: "Румынская тяга", nameEn: "Romanian Deadlift", muscleGroup: "Ноги", sets: 3, targetReps: "10-12", restSec: 150 }
    ]
  },
  {
    id: "tpl-upper",
    nameRu: "Верх тела (Upper Body)",
    nameEn: "Upper Body",
    descRu: "Мощный акцент на грудь, широчайшие спины, плечевой пояс и руки. Базовый тренировочный день сплита «Верх / Низ».",
    descEn: "Intense upper body focus: chest, lats, shoulders, and arms. Core of an Upper/Lower split.",
    tagRu: "Грудь + Спина + Плечи · 5 упр. · ~50 мин",
    tagEn: "Chest + Back + Shoulders · 5 ex · ~50 min",
    items: [
      { exerciseId: "ex-bench-press", name: "Жим штанги лёжа", nameEn: "Barbell Bench Press", muscleGroup: "Грудь", sets: 4, targetReps: "6-8", restSec: 180 },
      { exerciseId: "ex-bb-row", name: "Тяга штанги в наклоне", nameEn: "Bent-over Barbell Row", muscleGroup: "Спина", sets: 4, targetReps: "8-10", restSec: 150 },
      { exerciseId: "ex-incline-db", name: "Жим гантелей на наклонной (30°)", nameEn: "Incline DB Press (30°)", muscleGroup: "Грудь", sets: 3, targetReps: "8-10", restSec: 120 },
      { exerciseId: "seed-pullups", name: "Подтягивания", nameEn: "Pull-ups", muscleGroup: "Спина", sets: 3, targetReps: "8-12", restSec: 150, isBodyweight: true },
      { exerciseId: "ex-db-lat-raise", name: "Махи гантелями в стороны", nameEn: "DB Lateral Raises", muscleGroup: "Средняя дельта", sets: 3, targetReps: "12-15", restSec: 90 }
    ]
  },
  {
    id: "tpl-lower",
    nameRu: "Низ тела (Lower Body)",
    nameEn: "Lower Body",
    descRu: "Прицельная нагрузка на квадрицепсы, бицепс бедра, ягодичные мышцы и голень. Вторая половина сплита «Верх / Низ».",
    descEn: "Targeted quad, hamstring, glute, and calf training. The lower half of an Upper/Lower split.",
    tagRu: "Квадрицепс + Бицепс бедра + Ягодицы · 4 упр. · ~45 мин",
    tagEn: "Quads + Hamstrings + Glutes · 4 ex · ~45 min",
    items: [
      { exerciseId: "ex-squat", name: "Приседания со штангой", nameEn: "Barbell Squat", muscleGroup: "Ноги", sets: 4, targetReps: "6-8", restSec: 180 },
      { exerciseId: "ex-rdl", name: "Румынская тяга", nameEn: "Romanian Deadlift", muscleGroup: "Ноги", sets: 4, targetReps: "8-10", restSec: 150 },
      { exerciseId: "ex-leg-press", name: "Жим ногами в тренажёре", nameEn: "Leg Press", muscleGroup: "Ноги", sets: 3, targetReps: "10-12", restSec: 120 },
      { exerciseId: "ex-leg-curl", name: "Сгибания ног лёжа", nameEn: "Lying Leg Curls", muscleGroup: "Ноги", sets: 3, targetReps: "12-15", restSec: 90 }
    ]
  },
  {
    id: "tpl-push",
    nameRu: "Push (Жим — Грудь, Плечи, Трицепс)",
    nameEn: "Push (Chest, Shoulders, Triceps)",
    descRu: "Все жимовые и толкающие движения. Классика эффективного 3-дневного сплита Push / Pull / Legs.",
    descEn: "All pushing motions: chest, anterior delts, and triceps. Standard Push/Pull/Legs session.",
    tagRu: "Грудь + Дельты + Трицепс · 5 упр. · ~50 мин",
    tagEn: "Chest + Delts + Triceps · 5 ex · ~50 min",
    items: [
      { exerciseId: "ex-bench-press", name: "Жим штанги лёжа", nameEn: "Barbell Bench Press", muscleGroup: "Грудь", sets: 4, targetReps: "6-8", restSec: 180 },
      { exerciseId: "ex-incline-db", name: "Жим гантелей на наклонной (30°)", nameEn: "Incline DB Press (30°)", muscleGroup: "Грудь", sets: 3, targetReps: "8-10", restSec: 120 },
      { exerciseId: "ex-ohp-db", name: "Жим гантелей сидя", nameEn: "Seated Dumbbell OHP", muscleGroup: "Дельты", sets: 3, targetReps: "8-10", restSec: 120 },
      { exerciseId: "ex-dips", name: "Отжимания на брусьях", nameEn: "Parallel Bar Dips", muscleGroup: "Грудь", sets: 3, targetReps: "8-12", restSec: 120, isBodyweight: true },
      { exerciseId: "ex-rope-pushdown", name: "Разгибания с канатом в блоке", nameEn: "Cable Rope Pushdown", muscleGroup: "Трицепс (Lateral)", sets: 3, targetReps: "12-15", restSec: 90 }
    ]
  },
  {
    id: "tpl-pull",
    nameRu: "Pull (Тяга — Спина, Дельты, Бицепс)",
    nameEn: "Pull (Back, Rear Delts, Biceps)",
    descRu: "Все тяговые движения: развитие ширины и плотности спины, задних пучков дельт и двуглавой мышцы плеча.",
    descEn: "All pulling motions: lat width, back thickness, rear delts, and biceps.",
    tagRu: "Спина + Бицепс + Дельты · 5 упр. · ~50 мин",
    tagEn: "Back + Biceps + Delts · 5 ex · ~50 min",
    items: [
      { exerciseId: "seed-pullups", name: "Подтягивания", nameEn: "Pull-ups", muscleGroup: "Спина", sets: 4, targetReps: "6-10", restSec: 180, isBodyweight: true },
      { exerciseId: "ex-bb-row", name: "Тяга штанги в наклоне", nameEn: "Bent-over Barbell Row", muscleGroup: "Спина", sets: 4, targetReps: "8-10", restSec: 150 },
      { exerciseId: "ex-seated-row", name: "Тяга горизонтального блока", nameEn: "Seated Cable Row", muscleGroup: "Спина", sets: 3, targetReps: "10-12", restSec: 120 },
      { exerciseId: "ex-rear-delt", name: "Обратная бабочка / Задняя дельта", nameEn: "Reverse Fly / Rear Delt", muscleGroup: "Задняя дельта", sets: 3, targetReps: "12-15", restSec: 90 },
      { exerciseId: "ex-bb-curl", name: "Подъём EZ-штанги на бицепс", nameEn: "EZ-Bar Biceps Curl", muscleGroup: "Бицепс", sets: 3, targetReps: "10-12", restSec: 90 }
    ]
  },
  {
    id: "tpl-arms",
    nameRu: "Руки и плечи (Arms & Shoulders)",
    nameEn: "Arms & Shoulders",
    descRu: "Изолированная проработка дельтовидных мышц, бицепса и трицепса для максимального мышечного объёма и формы.",
    descEn: "Hypertrophy-focused arm and shoulder volume for maximal pump and shape.",
    tagRu: "Плечи + Бицепс + Трицепс · 5 упр. · ~45 мин",
    tagEn: "Shoulders + Biceps + Triceps · 5 ex · ~45 min",
    items: [
      { exerciseId: "ex-ohp-db", name: "Жим гантелей сидя", nameEn: "Seated Dumbbell OHP", muscleGroup: "Дельты", sets: 4, targetReps: "8-10", restSec: 120 },
      { exerciseId: "ex-db-lat-raise", name: "Махи гантелями в стороны", nameEn: "DB Lateral Raises", muscleGroup: "Средняя дельта", sets: 4, targetReps: "12-15", restSec: 75 },
      { exerciseId: "ex-bb-curl", name: "Подъём EZ-штанги на бицепс", nameEn: "EZ-Bar Biceps Curl", muscleGroup: "Бицепс", sets: 3, targetReps: "10-12", restSec: 90 },
      { exerciseId: "ex-skullcrusher", name: "Французский жим с EZ-штангой", nameEn: "EZ-Bar Skull Crusher", muscleGroup: "Трицепс", sets: 3, targetReps: "10-12", restSec: 90 },
      { exerciseId: "ex-hammer-curl", name: "Молотки с гантелями", nameEn: "Hammer Curls", muscleGroup: "Бицепс", sets: 3, targetReps: "12-15", restSec: 75 }
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
    const rest = it.restSec != null ? it.restSec : (ex ? ex.defaultRestSec : 180);
    totalRestSec += sets * (rest || 120);

    if (ex) {
      const mg = (ex.muscleGroup || t("common.other")).trim();
      if (!byMuscle.has(mg)) byMuscle.set(mg, { muscle: mg, sets: 0, exercises: [] });
      const rec = byMuscle.get(mg);
      rec.sets += sets;
      rec.exercises.push(ex.name);
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

function getCoachAdvice(items) {
  if (!items.length) {
    return [t("builder.coachEmpty")];
  }
  const tips = [];
  let totalSets = 0;
  let pushSets = 0;
  let pullSets = 0;
  let legSets = 0;

  for (const it of items) {
    const ex = getExercise(it.exerciseId);
    const sets = Number(it.sets) || 3;
    totalSets += sets;
    const mg = (ex?.muscleGroup || "").toLowerCase();
    if (mg.includes("грудь") || mg.includes("chest") || mg.includes("трицепс") || mg.includes("triceps") || (mg.includes("дельта") && !mg.includes("задн")) || mg.includes("передн") || mg.includes("средн")) {
      pushSets += sets;
    }
    if (mg.includes("спин") || mg.includes("back") || mg.includes("бицепс") || mg.includes("biceps") || mg.includes("задн") || mg.includes("трапец")) {
      pullSets += sets;
    }
    if (mg.includes("ног") || mg.includes("leg") || mg.includes("квадр") || mg.includes("ягодиц") || mg.includes("икр")) {
      legSets += sets;
    }
  }

  if (items.length < 3) {
    tips.push(t("builder.coachFew"));
  }
  if (totalSets > 24) {
    tips.push(t("builder.coachHigh", { sets: totalSets }));
  }

  if (pushSets >= 6 && pullSets === 0) {
    tips.push(t("builder.coachNeedPull"));
  } else if (pullSets >= 6 && pushSets === 0 && legSets === 0) {
    tips.push(t("builder.coachPullDay"));
  } else if (legSets >= 6 && pushSets === 0 && pullSets === 0) {
    tips.push(t("builder.coachLegsDay"));
  } else if (pushSets > 0 && pullSets > 0 && legSets > 0) {
    tips.push(t("builder.coachFullbody"));
  } else if (pushSets > 0 && pullSets > 0 && legSets === 0) {
    tips.push(t("builder.coachUpper"));
  } else if (tips.length === 0) {
    tips.push(t("builder.coachOk"));
  }

  return tips;
}

export function openProgramEditor(program) {
  const isNew = !program;
  const p = program ? JSON.parse(JSON.stringify(program)) : { name: "", items: [] };
  p.items.forEach(it => (it._key = it._key || uid()));

  let dirty = false;
  let activeTab = "items"; // "items" | "balance" | "templates"

  // Элементы заголовка и навигации
  const nameInput = h("input", {
    type: "text",
    class: "builder-name-input",
    value: p.name,
    placeholder: t("builder.namePlaceholder"),
    autocomplete: "off"
  });
  nameInput.addEventListener("input", () => {
    p.name = nameInput.value;
    dirty = true;
    errEl.hidden = true;
  });

  const errEl = h("p", { class: "error", hidden: true });

  const clearNameBtn = iconBtn("x", t("common.close"), () => {
    nameInput.value = "";
    p.name = "";
    dirty = true;
    nameInput.focus();
  });

  const nameBox = h("div", { class: "builder-name-box" },
    icon("edit", 17),
    nameInput,
    clearNameBtn
  );

  const quickNameChips = [
    { label: t("builder.chipFullbodyA"), val: isEn() ? "Full Body A" : "Фулбоди А" },
    { label: t("builder.chipFullbodyB"), val: isEn() ? "Full Body B" : "Фулбоди Б" },
    { label: t("builder.chipUpper"), val: isEn() ? "Upper Body" : "Верх тела" },
    { label: t("builder.chipLower"), val: isEn() ? "Lower Body" : "Низ тела" },
    { label: t("builder.chipPush"), val: isEn() ? "Push (Chest/Delts)" : "Push (Жим)" },
    { label: t("builder.chipPull"), val: isEn() ? "Pull (Back/Biceps)" : "Pull (Тяга)" },
    { label: t("builder.chipLegs"), val: isEn() ? "Leg Day" : "День ног" },
    { label: t("builder.chipArms"), val: isEn() ? "Arms & Shoulders" : "Руки и плечи" }
  ];

  const quickNamesWrap = h("div", { class: "builder-quick-names" },
    ...quickNameChips.map(c => h("button", {
      type: "button",
      class: "builder-name-chip",
      onclick: () => {
        nameInput.value = c.val;
        p.name = c.val;
        dirty = true;
        errEl.hidden = true;
        haptic("light");
      }
    }, c.label))
  );

  const nameSection = h("div", { class: "builder-name-wrap" },
    h("span", { class: "stg-row-label" }, t("builder.nameLabel")),
    nameBox,
    quickNamesWrap,
    errEl
  );

  // Живая плашка сводки
  const liveBadge = h("div", { class: "builder-live-badge" });
  const liveSubhead = h("div", { class: "builder-subhead" },
    liveBadge,
    h("span", { class: "builder-live-dot" })
  );

  function updateLiveSubhead() {
    const stats = calcProgramStats(p.items);
    liveBadge.textContent = t("builder.subLive", {
      time: stats.estMinutes,
      ex: stats.exerciseCount,
      sets: stats.totalSets
    });
  }

  // Табы
  const tabBtnItems = h("button", {
    type: "button",
    class: "builder-tab active",
    onclick: () => switchTab("items")
  }, t("builder.tabExercises"), h("span", { class: "builder-tab-badge" }, String(p.items.length)));

  const tabBtnBalance = h("button", {
    type: "button",
    class: "builder-tab",
    onclick: () => switchTab("balance")
  }, t("builder.tabBalance"));

  const tabBtnTemplates = h("button", {
    type: "button",
    class: "builder-tab",
    onclick: () => switchTab("templates")
  }, t("builder.tabTemplates"));

  const tabsWrap = h("nav", { class: "builder-tabs" },
    tabBtnItems, tabBtnBalance, tabBtnTemplates
  );

  function switchTab(tabKey) {
    if (activeTab === tabKey) return;
    activeTab = tabKey;
    tabBtnItems.classList.toggle("active", activeTab === "items");
    tabBtnBalance.classList.toggle("active", activeTab === "balance");
    tabBtnTemplates.classList.toggle("active", activeTab === "templates");
    haptic("light");
    paintPane();
  }

  const paneContainer = h("div", { class: "builder-pane" });

  // Drag-and-drop сортировка
  const syncOrder = keys => {
    p.items = keys.map(k => p.items.find(i => i._key === k)).filter(Boolean);
    dirty = true;
  };

  const moveItem = (idx, d) => {
    const j = idx + d;
    if (j < 0 || j >= p.items.length) return;
    [p.items[idx], p.items[j]] = [p.items[j], p.items[idx]];
    dirty = true;
    haptic("light");
    renderItemsTab();
    updateLiveSubhead();
  };

  // 1. Отрисовка вкладки «Упражнения»
  function renderItemsTab() {
    clear(paneContainer);
    tabBtnItems.querySelector(".builder-tab-badge").textContent = String(p.items.length);

    paneContainer.append(nameSection);

    // Мини-полоска баланса (если есть упражнения)
    if (p.items.length > 0) {
      const stats = calcProgramStats(p.items);
      const miniChips = stats.byMuscle.slice(0, 5).map(m =>
        h("span", { class: "builder-mini-tag" }, `${m.muscle}: ${m.sets} с.`)
      );
      const miniBalance = h("div", {
        class: "builder-mini-balance",
        onclick: () => switchTab("balance")
      },
        h("div", { class: "builder-mini-chips" },
          h("strong", { style: "font-size:12px; margin-right:4px;" }, t("builder.balanceStrip")),
          ...miniChips
        ),
        h("span", { class: "builder-mini-more" }, t("builder.balanceDetail"))
      );
      paneContainer.append(miniBalance);
    }

    if (!p.items.length) {
      const emptyState = h("div", { class: "builder-empty" },
        h("div", { class: "builder-empty-icon" }, icon("dumbbell", 30)),
        h("h3", { class: "builder-empty-title" }, t("builder.emptyTitle")),
        h("p", { class: "builder-empty-sub" }, t("builder.emptySub")),
        h("div", { class: "builder-empty-actions" },
          h("button", {
            class: "btn primary block",
            type: "button",
            onclick: () => pickExercise(ex => {
              p.items.push({
                _key: uid(),
                exerciseId: ex.id,
                sets: ex.defaultSets || 3,
                targetReps: "8-10",
                restSec: ex.defaultRestSec ?? 180,
                note: ""
              });
              dirty = true;
              renderItemsTab();
              updateLiveSubhead();
            }, { multi: true })
          }, icon("plus", 17), t("builder.addExBtn")),
          h("button", {
            class: "btn block",
            type: "button",
            onclick: () => switchTab("templates")
          }, t("builder.chooseTplBtn"))
        )
      );
      paneContainer.append(emptyState);
      return;
    }

    const itemsBox = h("div", { class: "builder-items" });
    enableDragSort(itemsBox, keys => {
      syncOrder(keys);
      renderItemsTab();
      updateLiveSubhead();
    });

    p.items.forEach((it, idx) => {
      const ex = getExercise(it.exerciseId);

      // 1. Шапка карточки
      const cardHead = h("div", { class: "builder-card-head" },
        h("button", {
          class: "btn icon drag-handle",
          type: "button",
          "aria-label": t("programs.dragTitle"),
          title: t("programs.dragTitle")
        }, icon("drag", 18)),
        h("span", { class: "builder-card-idx" }, String(idx + 1)),
        h("div", { class: "builder-card-info" },
          h("span", { class: "builder-card-title" }, ex ? ex.name : t("programs.exDeleted")),
          h("span", { class: "builder-card-muscle" }, ex ? ex.muscleGroup : "")
        ),
        h("div", { class: "builder-card-tools" },
          iconBtn("up", t("programs.moveUp"), () => moveItem(idx, -1)),
          iconBtn("down", t("programs.moveDown"), () => moveItem(idx, 1)),
          iconBtn("x", t("programs.removeFromProg"), () => {
            const deleted = p.items[idx];
            const delIdx = idx;
            p.items.splice(idx, 1);
            dirty = true;
            haptic("medium");
            renderItemsTab();
            updateLiveSubhead();
            showUndoSnackbar(t("builder.itemDeleted"), t("common.undo"), () => {
              p.items.splice(delIdx, 0, deleted);
              dirty = true;
              renderItemsTab();
              updateLiveSubhead();
            });
          })
        )
      );

      // 2. Степпер подходов
      const setsVal = h("span", { class: "builder-stepper-val" }, String(it.sets || 3));
      const setsStepper = h("div", { class: "builder-stepper-row" },
        h("span", { class: "builder-stepper-label" }, t("builder.setsLabel")),
        h("div", { class: "builder-stepper-ctrl" },
          h("button", {
            type: "button",
            class: "builder-stepper-btn",
            onclick: () => {
              it.sets = Math.max(1, (it.sets || 3) - 1);
              setsVal.textContent = String(it.sets);
              dirty = true;
              haptic("light");
              updateLiveSubhead();
            }
          }, "−"),
          setsVal,
          h("button", {
            type: "button",
            class: "builder-stepper-btn",
            onclick: () => {
              it.sets = Math.min(15, (it.sets || 3) + 1);
              setsVal.textContent = String(it.sets);
              dirty = true;
              haptic("light");
              updateLiveSubhead();
            }
          }, "+")
        )
      );

      // 3. Целевые повторы и цели с подсказками
      const repPresets = [
        { label: t("builder.goalStrength"), val: "3-5" },
        { label: t("builder.goalPower"), val: "6-8" },
        { label: t("builder.goalHyp"), val: "8-10" },
        { label: t("builder.goalVolume"), val: "10-12" },
        { label: t("builder.goalPump"), val: "15-20" }
      ];

      const repsInput = h("input", {
        type: "text",
        class: "builder-custom-reps",
        value: it.targetReps || "8-10",
        placeholder: "8-10",
        "aria-label": t("builder.repsTargetLabel")
      });

      const repTip = h("div", { class: "builder-target-tip" }, getRepTip(it.targetReps || "8-10"));

      const presetBtns = repPresets.map(rp => {
        const btn = h("button", {
          type: "button",
          class: "builder-preset-pill" + (it.targetReps === rp.val ? " active" : ""),
          onclick: () => {
            it.targetReps = rp.val;
            repsInput.value = rp.val;
            repTip.textContent = getRepTip(rp.val);
            presetBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            dirty = true;
            haptic("light");
          }
        }, rp.label);
        return btn;
      });

      repsInput.addEventListener("input", () => {
        it.targetReps = repsInput.value.trim();
        repTip.textContent = getRepTip(it.targetReps);
        presetBtns.forEach(b => b.classList.toggle("active", b.textContent.includes(it.targetReps)));
        dirty = true;
      });

      const targetBox = h("div", { class: "builder-target-box" },
        h("div", { class: "builder-target-head" },
          h("span", {}, t("builder.repsTargetLabel")),
          repsInput
        ),
        h("div", { class: "builder-target-presets" }, ...presetBtns),
        repTip
      );

      // 4. Отдых между подходами
      const restPresets = [
        { sec: 60, label: "60с (1 мин)" },
        { sec: 90, label: "90с (1.5 мин)" },
        { sec: 120, label: "120с (2 мин)" },
        { sec: 180, label: "180с (3 мин)" },
        { sec: 210, label: "210с (3.5 мин)" }
      ];
      const curRestSec = it.restSec != null ? it.restSec : (ex ? ex.defaultRestSec : 180);

      const restPills = restPresets.map(rp => {
        const btn = h("button", {
          type: "button",
          class: "builder-rest-pill" + (curRestSec === rp.sec ? " active" : ""),
          onclick: () => {
            it.restSec = rp.sec;
            restPills.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            dirty = true;
            haptic("light");
            updateLiveSubhead();
          }
        }, rp.label);
        return btn;
      });

      const restBox = h("div", { class: "builder-rest-box" },
        h("span", { class: "builder-rest-head" }, t("builder.restLabel")),
        h("div", { class: "builder-rest-presets" }, ...restPills)
      );

      // 5. Заметка
      const noteInput = h("input", {
        type: "text",
        class: "builder-item-note",
        value: it.note || "",
        placeholder: t("builder.notePlaceholder"),
        oninput: ev => { it.note = ev.target.value; dirty = true; }
      });

      const card = h("article", { class: "builder-card", dataset: { key: it._key } },
        cardHead,
        setsStepper,
        targetBox,
        restBox,
        noteInput
      );

      itemsBox.append(card);
    });

    paneContainer.append(itemsBox);

    // Кнопка добавления
    const addBtn = h("button", {
      class: "btn primary block",
      type: "button",
      onclick: () => pickExercise(ex => {
        p.items.push({
          _key: uid(),
          exerciseId: ex.id,
          sets: ex.defaultSets || 3,
          targetReps: "8-10",
          restSec: ex.defaultRestSec ?? 180,
          note: ""
        });
        dirty = true;
        renderItemsTab();
        updateLiveSubhead();
      }, { multi: true })
    }, icon("plus", 18), t("builder.addExBtn"));

    paneContainer.append(addBtn);
  }

  // 2. Отрисовка вкладки «Баланс мышц»
  function renderBalanceTab() {
    clear(paneContainer);
    const stats = calcProgramStats(p.items);

    // Анатомическая карта тела
    const mapBox = h("div", { class: "panel" },
      h("h3", { class: "group", style: "margin-top:0" }, t("programs.muscleCoverage")),
      renderBodyMap(stats.byMuscle, { compact: false })
    );

    // Сетка ключевых метрик
    const metricGrid = h("div", { class: "builder-metric-grid" },
      h("div", { class: "builder-metric-card" },
        h("span", { class: "builder-metric-val" }, `~${stats.estMinutes} мин`),
        h("span", { class: "builder-metric-lbl" }, t("builder.metricDuration"))),
      h("div", { class: "builder-metric-card" },
        h("span", { class: "builder-metric-val" }, String(stats.totalSets)),
        h("span", { class: "builder-metric-lbl" }, t("builder.metricSets"))),
      h("div", { class: "builder-metric-card" },
        h("span", { class: "builder-metric-val" }, String(stats.exerciseCount)),
        h("span", { class: "builder-metric-lbl" }, t("builder.metricExercises"))),
      h("div", { class: "builder-metric-card" },
        h("span", { class: "builder-metric-val" }, String(stats.muscleCount)),
        h("span", { class: "builder-metric-lbl" }, t("builder.metricMuscles")))
    );

    // Советы тренера
    const tips = getCoachAdvice(p.items);
    const coachCard = h("div", { class: "builder-coach-card" },
      h("div", { class: "builder-coach-head" }, icon("help", 18), t("builder.coachTitle")),
      h("div", { class: "builder-coach-body" },
        ...tips.map(tp => h("div", { class: "builder-coach-item" }, tp))
      )
    );

    // Распределение объёма по мышцам
    const maxMuscleSets = stats.byMuscle.reduce((m, x) => Math.max(m, x.sets), 1);
    const progressRows = stats.byMuscle.sort((a, b) => b.sets - a.sets).map(m => {
      const pct = stats.totalSets > 0 ? Math.round((m.sets / stats.totalSets) * 100) : 0;
      const fillW = Math.round((m.sets / maxMuscleSets) * 100);
      return h("div", { class: "builder-progress-row" },
        h("div", { class: "builder-progress-labels" },
          h("span", {}, m.muscle),
          h("span", { class: "muted" }, `${m.sets} с. (${pct}%)`)
        ),
        h("div", { class: "builder-progress-track" },
          h("div", { class: "builder-progress-fill", style: `width: ${fillW}%` })
        )
      );
    });

    const progressCard = stats.byMuscle.length > 0 ? h("div", { class: "builder-progress-card" },
      h("span", { class: "builder-progress-head" }, t("builder.loadDistribution")),
      ...progressRows
    ) : null;

    paneContainer.append(mapBox, metricGrid, coachCard, progressCard);
  }

  // 3. Отрисовка вкладки «Шаблоны»
  function renderTemplatesTab() {
    clear(paneContainer);

    const head = h("div", { style: "display:flex; flex-direction:column; gap:4px;" },
      h("h3", { style: "margin:0; font-size:17px; font-weight:800;" }, t("builder.tplTitle")),
      h("p", { class: "muted small", style: "margin:0;" }, t("builder.tplSub"))
    );

    const tplGrid = h("div", { class: "builder-tpl-grid" },
      ...PROGRAM_TEMPLATES.map(tpl => {
        const title = isEn() ? tpl.nameEn : tpl.nameRu;
        const desc = isEn() ? tpl.descEn : tpl.descRu;
        const tag = isEn() ? tpl.tagEn : tpl.tagRu;

        const itemsPreview = h("div", { class: "builder-tpl-items" },
          ...tpl.items.map(it => h("div", { class: "builder-tpl-item-row" },
            h("span", { class: "builder-tpl-item-name" }, isEn() ? it.nameEn || it.name : it.name),
            h("span", { class: "builder-tpl-item-meta" }, `${it.sets} × ${it.targetReps}`)
          ))
        );

        const applyBtn = h("button", {
          class: "btn primary builder-tpl-btn",
          type: "button",
          onclick: async () => {
            if (p.items.length > 0) {
              const replace = await confirmDialog(t("builder.tplReplaceConfirm", { name: title }), {
                ok: t("builder.tplReplace"),
                cancel: t("builder.tplAdd"),
                danger: false
              });
              if (replace) {
                p.items = [];
              }
            }

            // Обеспечиваем наличие упражнений в библиотеке
            for (const it of tpl.items) {
              const ex = ensureExerciseInStore(it);
              p.items.push({
                _key: uid(),
                exerciseId: ex.id,
                sets: it.sets || 3,
                targetReps: it.targetReps || "8-10",
                restSec: it.restSec ?? 180,
                note: ""
              });
            }

            if (!p.name.trim()) {
              p.name = title;
              nameInput.value = title;
            }

            dirty = true;
            haptic("success");
            toast(t("builder.tplAppliedToast", { name: title }));
            switchTab("items");
            updateLiveSubhead();
          }
        }, t("builder.applyTpl"));

        return h("div", { class: "builder-tpl-card" },
          h("div", { class: "builder-tpl-head" },
            h("strong", { class: "builder-tpl-title" }, title),
            h("span", { class: "builder-tpl-tag" }, tag)
          ),
          h("p", { class: "builder-tpl-desc" }, desc),
          itemsPreview,
          applyBtn
        );
      })
    );

    paneContainer.append(head, tplGrid);
  }

  function paintPane() {
    if (activeTab === "items") renderItemsTab();
    else if (activeTab === "balance") renderBalanceTab();
    else if (activeTab === "templates") renderTemplatesTab();
  }

  // Сохранение программы
  const save = () => {
    const nm = p.name.trim();
    if (!nm) {
      haptic("error");
      errEl.textContent = t("common.enterName");
      errEl.hidden = false;
      switchTab("items");
      nameInput.focus();
      return;
    }
    const items = p.items.map(({ _key, ...rest }) => ({
      exerciseId: rest.exerciseId,
      sets: rest.sets || 3,
      targetReps: rest.targetReps || "",
      restSec: rest.restSec ?? null,
      note: rest.note || ""
    }));
    dirty = false;
    saveProgram({ ...p, name: nm, items });
    haptic("success");
    sh.close();
    toast(t("programs.savedToast"));
  };

  // Нижняя плавающая панель
  const stickyFoot = h("div", { class: "builder-sticky-foot" },
    h("button", {
      class: "btn primary block",
      type: "button",
      onclick: save
    }, icon("check", 18), t("builder.saveBtn")),
    !isNew ? h("button", {
      class: "btn danger block",
      type: "button",
      onclick: async () => {
        if (await confirmDialog(t("programs.deleteConfirm", { name: p.name }), { ok: t("common.delete"), danger: true })) {
          dirty = false;
          deleteProgram(p.id);
          sh.close();
          toast(t("programs.deletedToast"));
        }
      }
    }, icon("trash", 16), t("builder.deleteBtn")) : null
  );

  const studioContainer = h("div", { class: "builder-studio" },
    liveSubhead,
    tabsWrap,
    paneContainer,
    stickyFoot
  );

  const sh = sheet(studioContainer, {
    title: isNew ? t("builder.titleNew") : t("builder.titleEdit"),
    full: true,
    beforeClose: () => (!dirty ? true : confirmDialog(t("common.unsavedConfirm"), { ok: t("common.close"), cancel: t("common.stay"), danger: true }))
  });

  updateLiveSubhead();
  paintPane();
  if (isNew && !p.name) nameInput.focus();
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
