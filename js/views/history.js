import { h, clear, sheet, confirmDialog, toast, fmtDate, fmtShortDate, toLocalInput, fromLocalInput, parseNum, icon, iconBtn, haptic } from "../ui.js";
import { state, saveSession, deleteSession, downloadCsv, unitLabel } from "../store.js";
import { sessionStats, formatNum } from "../metrics.js";
import { entryCard } from "./entryCard.js";
import { pickExercise } from "./exercises.js";
import { buildEntry, showSummary, openSessionShare } from "./workout.js";
import { t } from "../i18n.js";

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 12-недельная календарная сетка активности (Пн–Вс × 12 недель). */
function buildHeatmap(doneItems, onOpenSession) {
  const WEEKS = 12;
  const byDay = new Map();
  for (const s of doneItems) {
    const k = dayKey(s.startedAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayKey = dayKey(now.getTime());
  // Понедельник текущей недели (Пн = 0 ... Вс = 6)
  const dow = (now.getDay() + 6) % 7;
  const curMon = new Date(now);
  curMon.setDate(now.getDate() - dow);
  const startMon = new Date(curMon);
  startMon.setDate(curMon.getDate() - (WEEKS - 1) * 7);

  const caption = h("div", { class: "heat-caption muted small" }, t("history.tapDay"));
  const grid = h("div", { class: "heat-grid" });
  const daysLabels = h("div", { class: "heat-days" },
    h("span", {}, t("history.mon")), h("span", {}, ""), h("span", {}, t("history.wed")), h("span", {}, ""), h("span", {}, t("history.fri")), h("span", {}, ""), h("span", {}, t("history.sun")));

  // Месяцы над колонками
  const monthsRow = h("div", { class: "heat-months" });
  let lastMonth = -1;
  const monthNamesRu = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const monthNamesEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthNames = (typeof getLang === "function" && getLang() === "en") ? monthNamesEn : monthNamesRu;

  let count12w = 0;
  let selectedCell = null;
  const kg = unitLabel("kg");

  for (let w = 0; w < WEEKS; w++) {
    const colMon = new Date(startMon);
    colMon.setDate(startMon.getDate() + w * 7);
    const m = colMon.getMonth();
    const showMonth = (w === 0 || m !== lastMonth);
    lastMonth = m;
    monthsRow.append(h("span", { class: "heat-month" }, showMonth ? monthNames[m] : ""));

    const col = h("div", { class: "heat-col" });
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startMon);
      cellDate.setDate(startMon.getDate() + w * 7 + d);
      const ts = cellDate.getTime();
      const k = dayKey(ts);
      const isFuture = ts > now.getTime();
      const sessions = byDay.get(k) || [];
      if (!isFuture && sessions.length) count12w += sessions.length;

      let cellVol = 0;
      for (const s of sessions) cellVol += (sessionStats(s).volume || 0);
      let lvlCls = "";
      if (sessions.length) {
        if (cellVol >= 8000) lvlCls = " lvl-3";
        else if (cellVol >= 3000) lvlCls = " lvl-2";
        else lvlCls = " lvl-1";
      }

      const cell = h("button", {
        type: "button",
        class: "heat-cell" + (sessions.length ? ` active${lvlCls}` : "") + (k === todayKey ? " today" : "") + (isFuture ? " future" : ""),
        disabled: isFuture,
        title: `${fmtDate(ts)}: ${sessions.length} трен.`,
        "aria-label": t("history.cellAria", { date: fmtDate(ts), count: sessions.length }),
        onclick: () => {
          if (selectedCell) selectedCell.classList.remove("sel");
          selectedCell = cell;
          cell.classList.add("sel");
          clear(caption);
          if (!sessions.length) {
            caption.append(h("div", { class: "heat-selected-box" },
              h("strong", {}, fmtDate(ts, true)),
              h("span", { class: "muted small", style: "display:block; margin-top:2px" }, t("history.noWorkoutsOnDate", { date: "" }).replace(/^[\s·—]+/, ""))
            ));
          } else {
            const dayCards = sessions.map(s => {
              const st = sessionStats(s);
              return h("button", {
                class: "heat-session-pill",
                type: "button",
                onclick: () => onOpenSession(s)
              },
                h("span", { class: "heat-sess-name" }, s.programName),
                h("span", { class: "heat-sess-meta" }, `${formatNum(st.volume, 0)} ${kg}`),
                icon("chevron-right", 14)
              );
            });
            caption.append(h("div", { class: "heat-selected-box" },
              h("strong", {}, fmtDate(ts, true)),
              h("div", { class: "heat-sessions-list", style: "margin-top:6px" }, ...dayCards)
            ));
          }
        }
      });
      col.append(cell);
    }
    grid.append(col);
  }

  const legend = h("div", { class: "heat-legend" },
    h("small", { class: "muted" }, "Меньше"),
    h("span", { class: "heat-cell lvl-1", style: "width:10px; height:10px; display:inline-block" }),
    h("span", { class: "heat-cell lvl-2", style: "width:10px; height:10px; display:inline-block" }),
    h("span", { class: "heat-cell lvl-3", style: "width:10px; height:10px; display:inline-block" }),
    h("small", { class: "muted" }, "Больше")
  );

  return h("section", { class: "panel heat-panel" },
    h("div", { class: "panel-head" },
      h("h2", { class: "section" }, t("history.activity12w")),
      h("small", { class: "muted" }, t("history.count12w", { count: count12w }))),
    h("div", { class: "heat-outer" },
      h("div", { class: "heat-wrap-top" }, h("div", { class: "heat-days-spacer" }), monthsRow),
      h("div", { class: "heat-wrap" }, daysLabels, grid)
    ),
    h("div", { class: "row gap", style: "justify-content:space-between; align-items:center; margin-top:4px" },
      caption,
      legend
    )
  );
}

function openEditor(original) {
  const s = JSON.parse(JSON.stringify(original));
  let dirty = false;
  const when = h("input", { type: "datetime-local", value: toLocalInput(s.startedAt), "aria-label": t("history.startAria") });
  const dur = h("input", { type: "text", inputmode: "numeric", value: s.durationMin ?? "", placeholder: t("history.durPlaceholder"), "aria-label": t("history.durAria") });
  when.addEventListener("input", () => (dirty = true));
  dur.addEventListener("input", () => (dirty = true));
  const box = h("div", { class: "stack" });
  const paint = () => {
    clear(box);
    s.entries.forEach((e, i) => box.append(entryCard(e, {
      index: i, count: s.entries.length, reorder: false, collapsible: false,
      onChange: () => (dirty = true), rerender: paint,
      onRemove: () => { s.entries.splice(i, 1); dirty = true; paint(); }
    })));
  };
  paint();
  const applyHeaderFields = () => {
    const tm = fromLocalInput(when.value);
    if (isFinite(tm)) s.startedAt = tm;
    const d = parseNum(dur.value);
    s.durationMin = d !== null && d > 0 ? Math.round(d) : null;
    s.finishedAt = s.durationMin ? s.startedAt + s.durationMin * 60000 : s.finishedAt;
  };
  const save = () => {
    applyHeaderFields();
    s.entries.forEach((e, i) => { e.order = i; delete e._key; delete e._expanded; });
    dirty = false;
    saveSession(s); haptic("success"); sh.close(); toast(t("history.savedToast"));
  };
  const sh = sheet(h("div", { class: "stack" },
    h("div", { class: "stg-card hist-open-head" },
      h("div", { class: "hist-open-title-row" },
        h("strong", { class: "hist-open-prog" }, s.programName),
        h("span", { class: "ex-group-badge" }, `${formatNum(sessionStats(s).volume, 0)} ${unitLabel("kg")}`)),
      h("div", { class: "row gap hist-open-actions" },
        h("button", {
          class: "btn primary small grow",
          type: "button",
          onclick: () => { applyHeaderFields(); openSessionShare(s); }
        }, icon("share", 16), t("workout.shareBtn")),
        h("button", {
          class: "btn small grow",
          type: "button",
          onclick: () => { applyHeaderFields(); showSummary(s); }
        }, t("history.openSummaryBtn"))
      )
    ),
    h("div", { class: "row gap" },
      h("label", { class: "field grow" }, h("span", {}, t("history.startLabel")), when),
      h("label", { class: "field" }, h("span", {}, t("history.minutesLabel")), dur)),
    box,
    h("button", { class: "btn block", type: "button", onclick: () => pickExercise(ex => { s.entries.push({ ...buildEntry(ex, s.programId, s.entries.length), extra: true }); dirty = true; paint(); }, { multi: true }) }, t("workout.addExerciseBtn")),
    h("button", { class: "btn primary block", type: "button", onclick: save }, t("common.save")),
    h("button", { class: "btn block", type: "button", onclick: async () => { if (await confirmDialog(t("history.deleteConfirm"), { ok: t("common.delete"), danger: true })) { dirty = false; deleteSession(s.id); sh.close(); } } }, t("history.deleteBtn"))),
    {
      title: fmtDate(s.startedAt), full: true,
      beforeClose: () => (!dirty ? true : confirmDialog(t("common.unsavedConfirm"), { ok: t("common.close"), cancel: t("common.stay"), danger: true }))
    });
}

export function mount(root) {
  const wrap = h("div", { class: "stack" });
  root.append(wrap);
  const paint = () => {
    clear(wrap);
    const items = state.sessions.filter(s => s.status === "done").sort((a, b) => b.startedAt - a.startedAt);
    wrap.append(buildHeatmap(items, openEditor));
    const list = h("div", { class: "list" });
    if (!items.length) list.append(h("p", { class: "empty" }, t("history.empty")));
    for (const s of items) {
      const st = sessionStats(s);
      const sets = (s.entries || []).reduce((n, e) => n + e.sets.filter(x => x.done && !x.isWarmup).length, 0);
      list.append(h("div", { class: "list-item" },
        h("button", { class: "card-main grow", type: "button", onclick: () => openEditor(s) },
          h("strong", {}, s.programName),
          h("small", { class: "muted" }, `${fmtDate(s.startedAt, true)} · ${s.durationMin ?? "?"} ${t("workout.minUnit")}`),
          h("small", { class: "muted" }, t("history.cardSetsVol", { sets, vol: formatNum(st.volume, 0) }))),
        iconBtn("share", t("history.summaryBtnAria"), () => showSummary(s)),
        iconBtn("trash", t("history.deleteBtn"), async () => {
          if (await confirmDialog(t("history.deleteItemConfirm", { name: s.programName, date: fmtDate(s.startedAt) }), { ok: t("common.delete"), danger: true })) {
            deleteSession(s.id); toast(t("workout.deletedToast"));
          }
        })));
    }
    wrap.append(list);
    if (items.length) {
      wrap.append(h("button", {
        class: "btn secondary block csv-export-btn", type: "button",
        onclick: () => { downloadCsv(); toast(t("history.csvDownloadedToast")); }
      }, icon("download", 16), t("history.downloadCsvBtn")));
    }
  };
  paint();
  return { update: paint };
}
