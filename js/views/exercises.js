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
      `${x.isWarmup ? `${wSym}: ` : ""}${fmtNum(x.weight ?? 0)} ${unitLabel(e.unit)} × ${x.reps}${x.rpe ? ` @${fmtNum(x.rpe)}` : ""}`
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
  const e = ex && ex.id ? { ...ex } : { name: "", muscleGroup: ex?.muscleGroup || "", unit: state.settings.defaultUnit, defaultSets: 3, defaultRestSec: state.settings.restSec, trackRpe: false, note: "" };
  const name = h("input", { type: "text", value: e.name, placeholder: t("exercises.namePlaceholder"), autocomplete: "off" });
  const muscle = h("input", { type: "text", value: e.muscleGroup, list: "muscle-list", placeholder: t("exercises.musclePlaceholder"), autocomplete: "off" });
  const dl = h("datalist", { id: "muscle-list" }, muscleOptions().map(m => h("option", { value: m })));
  const unit = h("select", {}, h("option", { value: "kg", selected: e.unit === "kg" }, unitLabel("kg")), h("option", { value: "lb", selected: e.unit === "lb" }, "lb"));
  const sets = h("input", { type: "text", inputmode: "numeric", value: e.defaultSets });
  const rest = h("input", { type: "text", inputmode: "numeric", value: e.defaultRestSec });
  const restHint = h("span", { class: "muted" }, "= " + fmtRest(e.defaultRestSec));
  rest.addEventListener("input", () => (restHint.textContent = "= " + fmtRest(parseNum(rest.value) || 0)));
  const rpe = h("input", { type: "checkbox", checked: e.trackRpe });
  const isBw = h("input", { type: "checkbox", checked: !!e.isBodyweight });
  const note = h("textarea", { rows: 2, placeholder: t("exercises.notePlaceholder") }, e.note || "");
  const err = h("p", { class: "error", hidden: true });

  let dirty = false;
  [name, muscle, unit, sets, rest, rpe, isBw, note].forEach(el => el.addEventListener("input", () => (dirty = true)));

  const save = () => {
    const nm = name.value.trim();
    if (!nm) { haptic("error"); err.textContent = t("common.enterName"); err.hidden = false; name.focus(); return; }
    const saved = saveExercise({
      ...e, name: nm, muscleGroup: muscle.value.trim(), unit: unit.value,
      defaultSets: Math.max(1, Math.round(parseNum(sets.value) || 3)),
      defaultRestSec: Math.max(0, Math.round(parseNum(rest.value) ?? 210)),
      trackRpe: rpe.checked, isBodyweight: isBw.checked, note: note.value.trim()
    });
    dirty = false;
    haptic("success");
    sh.close(); onSaved && onSaved(saved);
  };
  const archived = !!e.archived;
  const extra = [];
  if (!isNew) {
    extra.push(h("button", { class: "btn", type: "button", onclick: () => { dirty = false; saveExercise({ ...e, archived: !archived }); sh.close(); toast(archived ? t("exercises.unarchivedToast") : t("exercises.archivedToast")); } }, archived ? t("exercises.unarchiveBtn") : t("exercises.archiveBtn")));
    if (!isExerciseUsed(e.id)) extra.push(h("button", { class: "btn", type: "button", onclick: async () => { if (await confirmDialog(t("exercises.deleteConfirm", { name: e.name }), { ok: t("common.delete"), danger: true })) { dirty = false; deleteExercise(e.id); sh.close(); } } }, t("common.delete")));
    else extra.push(h("p", { class: "muted small" }, t("exercises.cannotDelete")));
  }
  const form = h("form", { class: "stack", onsubmit: ev => { ev.preventDefault(); save(); } },
    h("label", { class: "field" }, h("span", {}, t("exercises.nameLabel")), name),
    h("label", { class: "field" }, h("span", {}, t("exercises.muscleLabel")), muscle, dl),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, t("exercises.unitsLabel")), unit),
      h("label", { class: "field grow" }, h("span", {}, t("exercises.defaultSetsLabel")), sets)),
    h("label", { class: "field" }, h("span", {}, t("exercises.defaultRestLabel"), restHint), rest),
    h("label", { class: "check" }, isBw, h("span", {}, t("exercises.isBwLabel"))),
    h("label", { class: "check" }, rpe, h("span", {}, t("exercises.trackRpeLabel"))),
    h("label", { class: "field" }, h("span", {}, t("exercises.noteLabel")), note),
    err,
    h("div", { class: "row gap" }, extra),
    h("button", { class: "btn primary block", type: "submit" }, t("common.save")));
  const sh = sheet(form, {
    title: isNew ? t("exercises.newTitle") : t("exercises.editTitle"),
    beforeClose: () => (!dirty ? true : confirmDialog(t("common.unsavedConfirm"), { ok: t("common.close"), cancel: t("common.stay"), danger: true }))
  });
  if (isNew) name.focus();
}

/** Выбор упражнения из библиотеки. onPick(exercise). */
export function pickExercise(onPick, { exclude = [], inSessionIds = [], preferMuscle = "", title = t("exercises.pickTitle"), multi = false } = {}) {
  const list = h("div", { class: "list" });
  const search = h("input", { type: "search", placeholder: t("common.search"), "aria-label": t("common.searchAria") });
  const filter = h("select", { "aria-label": t("exercises.filterMuscleAria") },
    h("option", { value: "" }, t("exercises.allMuscles")),
    ...[...new Set(state.exercises.filter(x => !x.archived).map(e => e.muscleGroup).filter(Boolean))].sort().map(m =>
      h("option", { value: m }, m)));

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const f = filter.value;
    clear(list);
    const items = state.exercises
      .filter(x => !x.archived && !exclude.includes(x.id) && (!f || x.muscleGroup === f) && (!q || (x.name + " " + x.muscleGroup).toLowerCase().includes(q)))
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

    if (!items.length) list.append(h("p", { class: "empty" }, t("exercises.nothingFoundCreate")));
    let lastGroup = null;
    for (const x of items) {
      const grp = preferMuscle && !f && x.muscleGroup === preferMuscle
        ? t("exercises.sameMuscleGroup", { muscle: x.muscleGroup })
        : (x.muscleGroup || t("common.uncategorized"));
      if (grp !== lastGroup) {
        lastGroup = grp;
        list.append(h("h3", { class: "group" }, grp));
      }
      const inCurrent = inSessionIds.includes(x.id);
      list.append(h("button", {
        class: "list-item", type: "button",
        onclick: () => { onPick(x); if (!multi) sh.close(); else toast(t("exercises.addedToast", { name: x.name })); }
      },
        h("span", { class: "grow" },
          h("strong", {}, x.name),
          h("small", { class: "muted" }, (x.muscleGroup || "—") + (inCurrent ? t("exercises.alreadyInWorkout") : ""))),
        icon("plus", 20)));
    }
  };
  search.addEventListener("input", paint);
  filter.addEventListener("change", paint);
  const sh = sheet(h("div", { class: "stack" },
    h("div", { class: "toolbar" }, search, filter),
    h("button", { class: "btn block", type: "button", onclick: () => openExerciseForm(null, x => { onPick(x); sh.close(); }) }, t("exercises.createCustomBtn")),
    list), { title, full: true });
  paint();
}

export function mount(root) {
  const search = h("input", { type: "search", placeholder: t("common.search"), "aria-label": t("common.searchAria") });
  const filter = h("select", { "aria-label": t("exercises.filterMuscleAria") });
  const showArchived = h("input", { type: "checkbox" });
  const groupsWrap = h("div", { class: "stack ex-groups-grid" });
  const collapsedGroups = new Set();

  const paintFilter = () => {
    const cur = filter.value;
    clear(filter).append(h("option", { value: "" }, t("exercises.allMuscles")));
    for (const m of [...new Set(state.exercises.map(e => e.muscleGroup).filter(Boolean))].sort()) filter.append(h("option", { value: m, selected: m === cur }, m));
  };
  const paint = () => {
    paintFilter();
    const q = search.value.trim().toLowerCase();
    clear(groupsWrap);
    const items = state.exercises
      .filter(e => (showArchived.checked || !e.archived) && (!filter.value || e.muscleGroup === filter.value) && (!q || (e.name + " " + (e.muscleGroup || "")).toLowerCase().includes(q)))
      .sort((a, b) => (a.muscleGroup || "").localeCompare(b.muscleGroup || "") || a.name.localeCompare(b.name));

    if (!items.length) {
      groupsWrap.append(h("p", { class: "empty" }, state.exercises.length ? t("exercises.nothingFound") : t("exercises.emptyLibrary")));
      return;
    }

    const byGroup = new Map();
    for (const e of items) {
      const g = e.muscleGroup || t("common.uncategorized");
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(e);
    }

    for (const [grpName, grpItems] of byGroup) {
      const forceOpen = !!q || !!filter.value;
      const isCol = !forceOpen && collapsedGroups.has(grpName);
      const previewNames = grpItems.slice(0, 4).map(x => x.name).join(", ") + (grpItems.length > 4 ? "…" : "");

      const innerList = h("div", { class: "ex-group-items" });
      for (const e of grpItems) {
        const weightInfo = e.startWeight != null ? `${fmtNum(e.startWeight)} ${unitLabel(e.unit)} · ` : "";
        innerList.append(h("div", { class: "ex-group-item" + (e.archived ? " archived" : "") },
          h("button", { class: "card-main grow", type: "button", onclick: () => openExerciseForm(e) },
            h("div", { class: "row gap", style: "flex-wrap:wrap" },
              h("strong", {}, e.name),
              e.isBodyweight ? h("span", { class: "muscle-tag" }, t("exercises.bwBadge")) : null),
            h("small", { class: "muted" }, t("exercises.cardSub", {
              weight: weightInfo,
              sets: e.defaultSets,
              rest: fmtRest(e.defaultRestSec),
              unit: unitLabel(e.unit),
              bw: "",
              rpe: e.trackRpe ? " · RPE" : "",
              arch: e.archived ? t("exercises.cardArch") : ""
            }))),
          iconBtn("clock", t("exercises.historyBtnAria"), () => openExerciseHistory(e.id, e.name, e.unit)),
          iconBtn("edit", t("common.edit"), () => openExerciseForm(e))));
      }

      const cardEl = h("section", { class: "ex-group-card" + (isCol ? " collapsed" : "") },
        h("button", {
          type: "button",
          class: "ex-group-head",
          onclick: () => {
            const nowCollapsed = !cardEl.classList.contains("collapsed");
            cardEl.classList.toggle("collapsed", nowCollapsed);
            if (nowCollapsed) collapsedGroups.add(grpName);
            else collapsedGroups.delete(grpName);
          }
        },
          h("div", { class: "grow ex-group-title-box" },
            h("div", { class: "row gap" },
              h("strong", { class: "ex-group-title" }, grpName),
              h("span", { class: "ex-group-badge" }, t("exercises.groupCount", { n: grpItems.length }))),
            h("small", { class: "muted ex-group-preview" }, previewNames)),
          h("span", { class: "fold-chevron" }, icon("up", 18))
        ),
        h("div", { class: "fold-body" },
          h("div", { class: "fold-inner" }, innerList))
      );

      groupsWrap.append(cardEl);
    }
  };
  [search, filter, showArchived].forEach(el => el.addEventListener("input", paint));
  root.append(
    h("div", { class: "toolbar" }, search, filter),
    h("div", { class: "row gap", style: "justify-content:space-between" },
      h("label", { class: "check small" }, showArchived, h("span", {}, t("common.showArchived"))),
      h("button", { class: "btn small primary", type: "button", onclick: () => openExerciseForm(null) }, t("exercises.addShortBtn"))),
    groupsWrap,
    h("div", { class: "bottom-actions" }, h("button", { class: "btn primary block", type: "button", onclick: () => openExerciseForm(null) }, t("exercises.addNewBtn"))));
  paint();
  return { update: () => { if (!document.activeElement || document.activeElement === document.body || !root.contains(document.activeElement) || document.activeElement === filter) paint(); } };
}
