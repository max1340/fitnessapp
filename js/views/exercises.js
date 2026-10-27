import { h, clear, sheet, confirmDialog, toast, parseNum, fmtNum, fmtRest, fmtDate, icon, iconBtn, haptic } from "../ui.js";
import { state, saveExercise, deleteExercise, isExerciseUsed, getExercise, doneSessions, unitLabel, warmupSymbol } from "../store.js";
import { personalRecords, fromKg, formatNum } from "../metrics.js";
import { t, getMuscleHints } from "../i18n.js";

export const muscleOptions = () => [...new Set([...getMuscleHints(), ...state.exercises.map(e => e.muscleGroup).filter(Boolean)])];

/** Модальный лист с рекордами и последними выполнениями конкретного упражнения. */
export function openExerciseHistory(exerciseId, fallbackName = t("exercises.defaultName"), fallbackUnit = "kg") {
  const ex = getExercise(exerciseId);
  const name = ex ? ex.name : fallbackName;
  const unit = ex ? ex.unit : fallbackUnit;
  const u = unitLabel(unit);
  const done = doneSessions().sort((a, b) => b.startedAt - a.startedAt);
  const pr = personalRecords(done).get(exerciseId);
  const wSym = warmupSymbol();

  const historyRows = [];
  for (const s of done) {
    const entries = (s.entries || []).filter(e => e.exerciseId === exerciseId && (e.sets || []).some(x => x.done));
    if (!entries.length) continue;
    const setsText = entries.flatMap(e => (e.sets || []).filter(x => x.done).map(x =>
      `${x.isWarmup ? `${wSym}: ` : ""}${fmtNum(x.weight ?? 0)} ${unitLabel(e.unit)} × ${x.reps}`
    )).join("  ·  ");
    const notes = entries.map(e => e.note).filter(Boolean).join("; ");
    historyRows.push({ date: s.startedAt, programName: s.programName, setsText, notes });
    if (historyRows.length >= 8) break;
  }

  const prBlock = pr && (pr.weightKg !== null || pr.e1rmKg !== null)
    ? h("div", { class: "stats" },
        h("div", { class: "stat" },
          h("small", { class: "muted" }, t("exercises.weightPR")),
          h("strong", {}, pr.weightKg !== null ? `${formatNum(fromKg(pr.weightKg, unit), 1)} ${u}` : "—"),
          pr.weightDate ? h("small", { class: "muted" }, fmtDate(pr.weightDate)) : null),
        h("div", { class: "stat" },
          h("small", { class: "muted" }, t("exercises.bestE1rm")),
          h("strong", {}, pr.e1rmKg !== null ? `${formatNum(fromKg(pr.e1rmKg, unit), 1)} ${u}` : "—"),
          pr.e1rmDate ? h("small", { class: "muted" }, fmtDate(pr.e1rmDate)) : null))
    : h("p", { class: "muted small" }, t("exercises.noPRs"));

  const list = h("div", { class: "list" });
  if (!historyRows.length) {
    list.append(h("p", { class: "empty" }, t("exercises.noHistory")));
  } else {
    for (const r of historyRows) {
      list.append(h("div", { class: "card" },
        h("div", { class: "grow" },
          h("strong", {}, `${fmtDate(r.date)} · ${r.programName}`),
          h("span", { class: "small" }, r.setsText),
          r.notes ? h("small", { class: "muted" }, r.notes) : null)));
    }
  }

  sheet(h("div", { class: "stack" },
    ex?.note ? h("p", { class: "muted small" }, t("exercises.notePrefix", { note: ex.note })) : null,
    prBlock,
    h("h3", { class: "group" }, t("exercises.recentWorkouts")),
    list), { title: name });
}

export function openExerciseForm(ex, onSaved) {
  const isNew = !ex || !ex.id;
  const e = ex && ex.id ? { ...ex } : {
    name: "",
    muscleGroup: ex?.muscleGroup || "",
    unit: state.settings.defaultUnit || "kg",
    defaultSets: 3,
    defaultRestSec: state.settings.restSec || 210,
    isBodyweight: false,
    note: ""
  };

  let curUnit = e.unit === "lb" ? "lb" : "kg";
  const name = h("input", { type: "text", class: "ex-form-input", value: e.name, placeholder: t("exercises.namePlaceholder"), autocomplete: "off" });
  const muscle = h("input", { type: "text", class: "ex-form-input", value: e.muscleGroup, placeholder: t("exercises.musclePlaceholder"), autocomplete: "off" });
  const sets = h("input", { type: "text", inputmode: "numeric", value: String(e.defaultSets || 3) });
  const rest = h("input", { type: "text", inputmode: "numeric", value: String(e.defaultRestSec ?? 210) });
  const restBadge = h("strong", { class: "ex-form-val-badge" }, fmtRest(e.defaultRestSec ?? 210));
  const isBw = h("input", { type: "checkbox", class: "ios-switch", checked: !!e.isBodyweight });
  const note = h("textarea", { class: "ex-form-textarea", placeholder: t("exercises.notePlaceholder") }, e.note || "");
  const err = h("p", { class: "error", hidden: true });

  let dirty = false;
  [name, muscle, sets, rest, isBw, note].forEach(el => el.addEventListener("input", () => (dirty = true)));
  isBw.addEventListener("change", () => (dirty = true));

  // 1. Quick muscle chips
  const chipBtns = new Map();
  const chipsWrap = h("div", { class: "ex-form-chips" });
  const syncMuscleChips = () => {
    const val = muscle.value.trim().toLowerCase();
    for (const [m, b] of chipBtns) {
      b.classList.toggle("on", m.toLowerCase() === val);
    }
  };
  for (const m of muscleOptions().slice(0, 12)) {
    const b = h("button", {
      type: "button",
      class: "ex-form-chip",
      onclick: () => {
        muscle.value = m;
        dirty = true;
        syncMuscleChips();
      }
    }, m);
    chipBtns.set(m, b);
    chipsWrap.append(b);
  }
  muscle.addEventListener("input", syncMuscleChips);
  syncMuscleChips();

  // 2. Сегментированный контрол единиц веса (кг / lb)
  const unitKgBtn = h("button", {
    type: "button",
    class: "seg-btn" + (curUnit === "kg" ? " on" : ""),
    onclick: () => { curUnit = "kg"; dirty = true; unitKgBtn.classList.add("on"); unitLbBtn.classList.remove("on"); }
  }, unitLabel("kg"));
  const unitLbBtn = h("button", {
    type: "button",
    class: "seg-btn" + (curUnit === "lb" ? " on" : ""),
    onclick: () => { curUnit = "lb"; dirty = true; unitLbBtn.classList.add("on"); unitKgBtn.classList.remove("on"); }
  }, "lb");
  const unitSeg = h("div", { class: "seg-control ex-form-seg" }, unitKgBtn, unitLbBtn);

  // 3. Default sets stepper
  const bumpSets = d => {
    const cur = Math.round(parseNum(sets.value) || 3);
    const next = Math.max(1, Math.min(15, cur + d));
    sets.value = String(next);
    dirty = true;
  };
  const setsStepper = h("div", { class: "stepper ex-form-stepper" },
    h("button", { class: "step", type: "button", onclick: () => bumpSets(-1) }, icon("minus", 14)),
    sets,
    h("button", { class: "step", type: "button", onclick: () => bumpSets(1) }, icon("plus", 14))
  );

  // 4. Rest: presets + stepper
  const restPresetBtns = new Map();
  const syncRestUI = () => {
    const v = Math.max(0, Math.round(parseNum(rest.value) ?? 210));
    restBadge.textContent = fmtRest(v);
    for (const [sec, b] of restPresetBtns) {
      b.classList.toggle("on", sec === v);
    }
  };
  rest.addEventListener("input", syncRestUI);
  const restPresetsWrap = h("div", { class: "ex-form-rest-presets" });
  for (const sec of [60, 90, 120, 180, 210]) {
    const b = h("button", {
      type: "button",
      class: "ex-form-rest-preset",
      onclick: () => { rest.value = String(sec); dirty = true; syncRestUI(); }
    }, fmtRest(sec));
    restPresetBtns.set(sec, b);
    restPresetsWrap.append(b);
  }
  const bumpRest = d => {
    const cur = Math.max(0, Math.round(parseNum(rest.value) ?? 210));
    rest.value = String(Math.max(0, cur + d));
    dirty = true;
    syncRestUI();
  };
  const restStepper = h("div", { class: "stepper ex-form-stepper" },
    h("button", { class: "step", type: "button", onclick: () => bumpRest(-15) }, icon("minus", 14)),
    rest,
    h("button", { class: "step", type: "button", onclick: () => bumpRest(15) }, icon("plus", 14))
  );

  const save = () => {
    const nm = name.value.trim();
    if (!nm) { haptic("error"); err.textContent = t("common.enterName"); err.hidden = false; name.focus(); return; }
    const saved = saveExercise({
      ...e,
      name: nm,
      muscleGroup: muscle.value.trim(),
      unit: curUnit,
      defaultSets: Math.max(1, Math.round(parseNum(sets.value) || 3)),
      defaultRestSec: Math.max(0, Math.round(parseNum(rest.value) ?? 210)),
      isBodyweight: isBw.checked,
      note: note.value.trim()
    });
    dirty = false;
    haptic("success");
    sh.close();
    if (onSaved) onSaved(saved);
  };

  const archived = !!e.archived;
  const extra = [];
  if (!isNew) {
    extra.push(h("button", {
      class: "btn grow", type: "button",
      onclick: () => {
        dirty = false;
        saveExercise({ ...e, archived: !archived });
        sh.close();
        toast(archived ? t("exercises.unarchivedToast") : t("exercises.archivedToast"));
      }
    }, archived ? t("exercises.unarchiveBtn") : t("exercises.archiveBtn")));
    if (!isExerciseUsed(e.id)) {
      extra.push(h("button", {
        class: "btn grow", type: "button",
        onclick: async () => {
          if (await confirmDialog(t("exercises.deleteConfirm", { name: e.name }), { ok: t("common.delete"), danger: true })) {
            dirty = false;
            deleteExercise(e.id);
            sh.close();
          }
        }
      }, icon("trash", 16), t("common.delete")));
    }
  }

  const form = h("form", { class: "stack ex-form-wrap", onsubmit: ev => { ev.preventDefault(); save(); } },
    h("div", { class: "ex-form-section" },
      h("span", { class: "ex-form-sec-title" }, t("exercises.basicGroup")),
      h("div", { class: "ex-form-card" },
        h("label", { class: "ex-form-field" },
          h("span", { class: "ex-form-label" }, t("exercises.nameLabel")),
          name
        ),
        h("div", { class: "ex-form-field" },
          h("span", { class: "ex-form-label" }, t("exercises.muscleLabel")),
          chipsWrap,
          muscle
        )
      )
    ),

    h("div", { class: "ex-form-section" },
      h("span", { class: "ex-form-sec-title" }, t("exercises.defaultsGroup")),
      h("div", { class: "ex-form-card" },
        h("div", { class: "ex-form-grid-2" },
          h("div", { class: "ex-form-field" },
            h("span", { class: "ex-form-label" }, t("exercises.unitsLabel")),
            unitSeg
          ),
          h("div", { class: "ex-form-field" },
            h("span", { class: "ex-form-label" }, t("exercises.defaultSetsLabel")),
            setsStepper
          )
        ),
        h("div", { class: "ex-form-field", style: "margin-top: 4px;" },
          h("div", { class: "ex-form-row-header" },
            h("span", { class: "ex-form-label" }, t("exercises.defaultRestShort")),
            restBadge
          ),
          restPresetsWrap,
          restStepper
        )
      )
    ),

    h("div", { class: "ex-form-section" },
      h("span", { class: "ex-form-sec-title" }, t("exercises.optionsGroup")),
      h("div", { class: "ex-form-card" },
        h("label", { class: "ex-form-toggle-row" },
          h("div", { class: "ex-form-toggle-text" },
            h("span", { class: "ex-form-toggle-title" }, t("exercises.isBwLabel")),
            h("small", { class: "ex-form-toggle-sub" }, t("exercises.isBwSub"))
          ),
          isBw
        )
      )
    ),

    h("div", { class: "ex-form-section" },
      h("span", { class: "ex-form-sec-title" }, t("exercises.noteLabel")),
      h("div", { class: "ex-form-card" }, note)
    ),

    err,
    !isNew && isExerciseUsed(e.id) ? h("p", { class: "muted small", style: "margin:0 4px" }, t("exercises.cannotDelete")) : null,
    extra.length ? h("div", { class: "row gap" }, extra) : null,
    h("button", { class: "btn primary block", type: "submit", style: "height: 48px; font-weight: 600; margin-top: 4px;" }, t("common.save"))
  );

  const sh = sheet(form, {
    title: isNew ? t("exercises.newTitle") : t("exercises.editTitle"),
    full: true,
    beforeClose: () => (!dirty ? true : confirmDialog(t("common.unsavedConfirm"), { ok: t("common.close"), cancel: t("common.stay"), danger: true }))
  });
  if (isNew) name.focus();
}

/** Выбор упражнения из библиотеки. onPick(exercise). */
export function pickExercise(onPick, { exclude = [], inSessionIds = [], preferMuscle = "", title = t("exercises.pickTitle"), multi = false } = {}) {
  const list = h("div", { class: "stack ex-pick-groups" });
  const search = h("input", { type: "search", placeholder: t("common.search"), "aria-label": t("common.searchAria") });
  let curMuscle = "";

  const allMuscles = [...new Set(state.exercises.filter(x => !x.archived).map(e => e.muscleGroup).filter(Boolean))].sort((a, b) => {
    if (preferMuscle) {
      if (a === preferMuscle) return -1;
      if (b === preferMuscle) return 1;
    }
    return a.localeCompare(b);
  });

  const filterBar = h("div", { class: "ex-filter-pills" });
  const filterBtns = new Map();
  const addFilterPill = (val, label) => {
    const b = h("button", {
      type: "button",
      class: "btn small tag ex-filter-pill" + (curMuscle === val ? " on" : ""),
      onclick: () => {
        curMuscle = val;
        for (const [k, btn] of filterBtns) btn.classList.toggle("on", k === curMuscle);
        paint();
      }
    }, label);
    filterBtns.set(val, b);
    filterBar.append(b);
  };
  addFilterPill("", t("exercises.allMuscles"));
  for (const m of allMuscles) addFilterPill(m, m);

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const f = curMuscle;
    clear(list);
    const items = state.exercises
      .filter(x => !x.archived && !exclude.includes(x.id) && (!f || x.muscleGroup === f) && (!q || (x.name + " " + (x.muscleGroup || "")).toLowerCase().includes(q)))
      .sort((a, b) => {
        if (preferMuscle && !f) {
          const aPref = a.muscleGroup === preferMuscle ? 0 : 1;
          const bPref = b.muscleGroup === preferMuscle ? 0 : 1;
          if (aPref !== bPref) return aPref - bPref;
        }
        const aIn = inSessionIds.includes(a.id) ? 1 : 0;
        const bIn = inSessionIds.includes(b.id) ? 1 : 0;
        if (aIn !== bIn) return aIn - bIn;
        return (a.muscleGroup || "").localeCompare(b.muscleGroup || "") || a.name.localeCompare(b.name);
      });

    if (!items.length) {
      list.append(h("p", { class: "empty" }, t("exercises.nothingFoundCreate")));
      return;
    }

    const byGrp = new Map();
    for (const x of items) {
      const grp = preferMuscle && !f && x.muscleGroup === preferMuscle
        ? t("exercises.sameMuscleGroup", { muscle: x.muscleGroup })
        : (x.muscleGroup || t("common.uncategorized"));
      if (!byGrp.has(grp)) byGrp.set(grp, []);
      byGrp.get(grp).push(x);
    }

    for (const [grp, grpItems] of byGrp) {
      const grpBox = h("div", { class: "ex-pick-group" },
        h("div", { class: "ex-pick-group-head" },
          h("span", { class: "stg-sec-title" }, grp),
          h("span", { class: "ex-group-badge" }, String(grpItems.length)))
      );
      const grpList = h("div", { class: "ex-pick-list" });
      for (const x of grpItems) {
        const inCurrent = inSessionIds.includes(x.id);
        grpList.append(h("button", {
          class: "ex-pick-item" + (inCurrent ? " in-workout" : ""),
          type: "button",
          onclick: () => {
            onPick(x);
            if (!multi) sh.close();
            else toast(t("exercises.addedToast", { name: x.name }));
          }
        },
          h("span", { class: "ex-item-main" },
            h("span", { class: "ex-item-head" },
              h("strong", { class: "ex-item-name" }, x.name),
              x.isBodyweight ? h("span", { class: "muscle-tag" }, t("exercises.bwBadge")) : null),
            h("small", { class: "muted ex-item-sub" },
              `${x.defaultSets || 3} × · ${fmtRest(x.defaultRestSec ?? 210)} · ${unitLabel(x.unit)}` +
              (inCurrent ? t("exercises.alreadyInWorkout") : ""))),
          h("span", { class: "ex-pick-plus" }, icon("plus", 18))
        ));
      }
      grpBox.append(grpList);
      list.append(grpBox);
    }
  };

  search.addEventListener("input", paint);
  const sh = sheet(h("div", { class: "stack" },
    search,
    filterBar,
    h("button", {
      class: "btn block ex-create-custom-btn",
      type: "button",
      onclick: () => openExerciseForm(preferMuscle ? { muscleGroup: preferMuscle } : null, x => { onPick(x); sh.close(); })
    }, icon("plus", 18), t("exercises.createCustomBtn").replace(/^\+\s*/, "")),
    list), { title, full: true });
  paint();
}

export function mount(root) {
  const search = h("input", { type: "search", placeholder: t("common.search"), "aria-label": t("common.searchAria") });
  const filter = h("select", { "aria-label": t("exercises.filterMuscleAria") });
  const showArchived = h("input", { type: "checkbox", class: "ios-switch" });
  const groupsWrap = h("div", { class: "stack ex-groups-wrap" });
  // По дефолту все папки упражнений свёрнуты (открываются по клику или при поиске/фильтре)
  const expandedGroups = new Set();

  const paintFilter = () => {
    const cur = filter.value;
    clear(filter).append(h("option", { value: "" }, t("exercises.allMuscles")));
    for (const m of [...new Set(state.exercises.map(e => e.muscleGroup).filter(Boolean))].sort()) filter.append(h("option", { value: m, selected: m === cur }, m));
  };
  function openMuscleGroupSheet(grpName) {
    let sh;
    const itemsList = h("div", { class: "ex-group-items", style: "display: flex; flex-direction: column; gap: 8px;" });

    function renderGroupItems() {
      clear(itemsList);
      const grpItems = state.exercises
        .filter(e => (showArchived.checked || !e.archived) && (e.muscleGroup || t("common.uncategorized")) === grpName)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!grpItems.length) {
        itemsList.append(h("p", { class: "empty" }, t("exercises.nothingFound")));
        return;
      }

      for (const e of grpItems) {
        const weightInfo = e.startWeight != null ? `${fmtNum(e.startWeight)} ${unitLabel(e.unit)} · ` : "";
        itemsList.append(h("div", { class: "ex-group-item" + (e.archived ? " archived" : "") },
          h("button", { class: "ex-item-main", type: "button", onclick: () => { sh && sh.close(); openExerciseForm(e); } },
            h("span", { class: "ex-item-head" },
              h("strong", { class: "ex-item-name" }, e.name),
              e.isBodyweight ? h("span", { class: "muscle-tag" }, t("exercises.bwBadge")) : null),
            h("small", { class: "muted ex-item-sub" }, t("exercises.cardSub", {
              weight: weightInfo,
              sets: e.defaultSets,
              rest: fmtRest(e.defaultRestSec),
              unit: unitLabel(e.unit),
              bw: "",
              arch: e.archived ? t("exercises.cardArch") : ""
            }))),
          h("div", { class: "ex-item-actions" },
            iconBtn("clock", t("exercises.historyBtnAria"), () => openExerciseHistory(e.id, e.name, e.unit)),
            iconBtn("edit", t("common.edit"), () => { sh && sh.close(); openExerciseForm(e); }))
        ));
      }
    }

    renderGroupItems();

    const addExBtn = h("button", {
      class: "btn primary block",
      type: "button",
      style: "margin-top: 14px;",
      onclick: () => {
        sh && sh.close();
        openExerciseForm({ muscleGroup: grpName });
      }
    }, t("exercises.addNewBtn"));

    const contentBox = h("div", { class: "stack", style: "gap: 12px; padding: 4px 0 16px;" }, itemsList, addExBtn);
    sh = sheet(contentBox, { title: grpName, full: true });
  }

  const paint = () => {
    paintFilter();
    const q = search.value.trim().toLowerCase();
    clear(groupsWrap);
    const items = state.exercises
      .filter(e => (showArchived.checked || !e.archived) && (!filter.value || e.muscleGroup === filter.value) && (!q || (e.name + " " + (e.muscleGroup || "")).toLowerCase().includes(q)))
      .sort((a, b) => (a.muscleGroup || "").localeCompare(b.muscleGroup || "") || a.name.localeCompare(b.name));

    if (!items.length) {
      groupsWrap.className = "stack ex-groups-wrap";
      groupsWrap.append(h("p", { class: "empty" }, state.exercises.length ? t("exercises.nothingFound") : t("exercises.emptyLibrary")));
      return;
    }

    // When searching, show direct list of matching exercises
    if (q) {
      groupsWrap.className = "stack ex-group-items";
      for (const e of items) {
        const weightInfo = e.startWeight != null ? `${fmtNum(e.startWeight)} ${unitLabel(e.unit)} · ` : "";
        groupsWrap.append(h("div", { class: "ex-group-item" + (e.archived ? " archived" : "") },
          h("button", { class: "ex-item-main", type: "button", onclick: () => openExerciseForm(e) },
            h("span", { class: "ex-item-head" },
              h("strong", { class: "ex-item-name" }, e.name),
              h("span", { class: "muscle-tag" }, e.muscleGroup || ""),
              e.isBodyweight ? h("span", { class: "muscle-tag" }, t("exercises.bwBadge")) : null),
            h("small", { class: "muted ex-item-sub" }, t("exercises.cardSub", {
              weight: weightInfo,
              sets: e.defaultSets,
              rest: fmtRest(e.defaultRestSec),
              unit: unitLabel(e.unit),
              bw: "",
              arch: e.archived ? t("exercises.cardArch") : ""
            }))),
          h("div", { class: "ex-item-actions" },
            iconBtn("clock", t("exercises.historyBtnAria"), () => openExerciseHistory(e.id, e.name, e.unit)),
            iconBtn("edit", t("common.edit"), () => openExerciseForm(e)))
        ));
      }
      return;
    }

    // Default library view: 2-column square card grid
    groupsWrap.className = "ex-muscle-grid";

    const byGroup = new Map();
    for (const e of items) {
      const g = e.muscleGroup || t("common.uncategorized");
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(e);
    }

    for (const [grpName, grpItems] of byGroup) {
      const titleEl = h("strong", { class: "ex-muscle-title" }, grpName);
      const countEl = h("span", { class: "ex-muscle-count" }, t("exercises.groupCount", { n: grpItems.length }));
      const cardEl = h("button", {
        type: "button",
        class: "ex-muscle-card",
        "aria-label": `${grpName}, ${t("exercises.groupCount", { n: grpItems.length })}`,
        onclick: () => openMuscleGroupSheet(grpName)
      }, titleEl, countEl);

      groupsWrap.append(cardEl);
    }
  };
  [search, filter, showArchived].forEach(el => el.addEventListener("input", paint));
  root.append(
    h("div", { class: "toolbar" }, search, filter),
    h("div", { class: "row gap", style: "justify-content:space-between" },
      h("label", { class: "switch-row" }, showArchived, h("span", {}, t("common.showArchived"))),
      h("button", { class: "btn small primary", type: "button", onclick: () => openExerciseForm(null) }, t("exercises.addShortBtn"))),
    groupsWrap,
    h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: () => openExerciseForm(null) }, t("exercises.addNewBtn"))));
  paint();
  return { update: () => { if (!document.activeElement || document.activeElement === document.body || !root.contains(document.activeElement) || document.activeElement === filter) paint(); } };
}
