import { h, clear, sheet, confirmDialog, toast, parseNum, fmtRest, icon, iconBtn, enableDragSort, haptic } from "../ui.js";
import { state, saveProgram, deleteProgram, getExercise, activeSession, uid } from "../store.js";
import { pickExercise } from "./exercises.js";
import { startSession } from "./workout.js";
import { renderBodyMap } from "../bodyMap.js";
import { t } from "../i18n.js";

export function openProgramEditor(program) {
  const isNew = !program;
  const p = program ? JSON.parse(JSON.stringify(program)) : { name: "", items: [] };
  // у каждой позиции есть стабильный ключ для drag & drop
  p.items.forEach(it => (it._key = it._key || uid()));

  const name = h("input", { type: "text", value: p.name, placeholder: t("programs.namePlaceholder"), autocomplete: "off" });
  const list = h("div", { class: "pitems" });
  const mapBox = h("div", { class: "panel" });
  const err = h("p", { class: "error", hidden: true });
  let dirty = false;
  name.addEventListener("input", () => (dirty = true));

  const syncOrder = keys => { p.items = keys.map(k => p.items.find(i => i._key === k)); dirty = true; };
  enableDragSort(list, keys => { syncOrder(keys); paint(); });

  const move = (idx, d) => {
    const j = idx + d; if (j < 0 || j >= p.items.length) return;
    [p.items[idx], p.items[j]] = [p.items[j], p.items[idx]];
    dirty = true;
    paint();
  };

  function paintMap() {
    clear(mapBox);
    const byMuscle = new Map();
    for (const it of p.items) {
      const ex = getExercise(it.exerciseId);
      if (!ex) continue;
      const mg = (ex.muscleGroup || t("common.other")).trim();
      if (!byMuscle.has(mg)) byMuscle.set(mg, { muscle: mg, sets: 0, exercises: [] });
      const rec = byMuscle.get(mg);
      rec.sets += Number(it.sets) || 3;
      rec.exercises.push(ex.name);
    }
    mapBox.append(
      h("h3", { class: "group" }, t("programs.muscleCoverage")),
      renderBodyMap([...byMuscle.values()], { compact: true }));
  }

  function paint() {
    paintMap();
    clear(list);
    if (!p.items.length) list.append(h("p", { class: "empty" }, t("programs.emptyItems")));
    p.items.forEach((it, idx) => {
      const ex = getExercise(it.exerciseId);
      const field = (label, value, set, placeholder = "", mode = "numeric") => {
        const inp = h("input", { type: "text", inputmode: mode, value: value ?? "", placeholder, "aria-label": label });
        inp.addEventListener("input", () => { set(inp.value); dirty = true; paintMap(); });
        return h("label", { class: "field mini" }, h("span", {}, label), inp);
      };
      const restHint = h("span", { class: "muted" });
      const showRest = () => {
        const sec = it.restSec || (ex ? ex.defaultRestSec : null);
        restHint.textContent = sec ? ` (${fmtRest(sec)})` : "";
      };
      showRest();
      list.append(h("div", { class: "pitem", dataset: { key: it._key } },
        h("div", { class: "pitem-head" },
          h("button", { class: "btn icon drag-handle", type: "button", "aria-label": t("entry.dragAria"), title: t("programs.dragTitle") }, icon("drag")),
          h("span", { class: "grow" }, h("strong", {}, `${idx + 1}. ${ex ? ex.name : t("programs.exDeleted")}`), h("small", { class: "muted" }, ex ? ex.muscleGroup : "")),
          iconBtn("up", t("programs.moveUp"), () => move(idx, -1)), iconBtn("down", t("programs.moveDown"), () => move(idx, 1)),
          iconBtn("x", t("programs.removeFromProg"), () => { p.items.splice(idx, 1); dirty = true; paint(); })),
        h("div", { class: "row gap pitem-fields" },
          field(t("programs.sets"), it.sets, v => (it.sets = Math.max(1, Math.round(parseNum(v) || 1)))),
          field(t("programs.reps"), it.targetReps, v => (it.targetReps = v.trim()), "8-10", "text"),
          h("label", { class: "field mini" }, h("span", {}, t("programs.restSecShort"), restHint),
            (() => { const i = h("input", { type: "text", inputmode: "numeric", value: it.restSec ?? "", placeholder: ex ? String(ex.defaultRestSec) : "", "aria-label": t("programs.restSecAria") }); i.addEventListener("input", () => { it.restSec = parseNum(i.value); dirty = true; showRest(); }); return i; })())),
        h("input", { class: "pitem-note", type: "text", value: it.note || "", placeholder: t("programs.itemNotePlaceholder"), "aria-label": t("programs.itemNoteAria"), oninput: ev => { it.note = ev.target.value; dirty = true; } })));
    });
  }

  const save = () => {
    const nm = name.value.trim();
    if (!nm) { haptic("error"); err.textContent = t("common.enterName"); err.hidden = false; name.focus(); return; }
    const items = p.items.map(({ _key, ...rest }) => ({
      exerciseId: rest.exerciseId, sets: rest.sets || 3, targetReps: rest.targetReps || "",
      restSec: rest.restSec ?? null, note: rest.note || ""
    }));
    dirty = false;
    saveProgram({ ...p, name: nm, items: items });
    haptic("success");
    sh.close(); toast(t("programs.savedToast"));
  };

  const body = h("div", { class: "stack" },
    h("label", { class: "field" }, h("span", {}, t("programs.nameLabel")), name), err,
    mapBox,
    list,
    h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => {
      p.items.push({ _key: uid(), exerciseId: ex.id, sets: ex.defaultSets || 3, targetReps: "", restSec: null, note: "" });
      dirty = true; paint();
    }, { multi: true }) }, t("workout.addExerciseBtn")),
    !isNew ? h("button", { class: "btn block", type: "button", onclick: async () => {
      if (await confirmDialog(t("programs.deleteConfirm", { name: p.name }), { ok: t("common.delete"), danger: true })) {
        dirty = false; deleteProgram(p.id); sh.close(); toast(t("programs.deletedToast"));
      }
    } }, t("programs.deleteBtn")) : null,
    h("div", { class: "sheet-sticky-foot" },
      h("button", { class: "btn primary block", type: "button", onclick: save }, t("programs.saveBtn"))));
  const sh = sheet(body, {
    title: isNew ? t("programs.newTitle") : t("programs.editTitle"), full: true,
    beforeClose: () => (!dirty ? true : confirmDialog(t("common.unsavedConfirm"), { ok: t("common.close"), cancel: t("common.stay"), danger: true }))
  });
  paint();
  if (isNew) name.focus();
}

export function mount(root) {
  const list = h("div", { class: "list" });
  const showArchived = h("input", { type: "checkbox", class: "ios-switch" });

  function openProgramMenu(p) {
    const closeMenu = sheet(h("div", { class: "stack" },
      h("h3", { style: "margin:0" }, p.name),
      h("button", {
        class: "btn block",
        type: "button",
        onclick: () => {
          closeMenu();
          saveProgram({ ...p, id: uid(), name: p.name + t("programs.copySuffix"), baselineSessionId: null });
          toast(t("programs.duplicatedToast"));
          paint();
        }
      }, icon("copy", 16), t("programs.menuDuplicate")),
      h("button", {
        class: "btn block",
        type: "button",
        onclick: async () => {
          closeMenu();
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
          closeMenu();
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
            class: "btn small primary start-btn", type: "button",
            onclick: () => {
              haptic("medium");
              if (!act) startSession(p);
              sessionStorage.setItem("fitness.openActive", "1");
              location.hash = "#/workout";
            }
          }, icon("play", 15), isCurrentActive ? t("programs.resume") : t("programs.start")) : h("span", { class: "grow" }),
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
