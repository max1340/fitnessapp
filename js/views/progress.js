import { h, clear, sheet, toast, fmtDate, fmtNum, parseNum, icon, haptic } from "../ui.js";
import { state, doneSessions, getExercise, getProgram, saveProgram, logBodyweight, unitLabel } from "../store.js";
import { lineChart } from "../chart.js";
import { renderBodyMap } from "../bodyMap.js";
import { openExerciseHistory } from "./exercises.js";
import { t, tMuscle } from "../i18n.js";
import {
  liSeries, movingAverage, changeOverWeeks, personalRecords, pickBaseline, byStart, formatNum,
  entryTopWeight, entryE1rm, entryVolume, sessionStats, fromKg, LI_WEIGHTS
} from "../metrics.js";

const LS_KEY = "fitness.progress.program";
let muscleDays = 30;
let muscleBarsOpen = false;
const openFolds = new Set();

function makeFoldCard(id, title, badgeText, subText, bodyContent, defaultOpen = false) {
  if (defaultOpen && !openFolds.has(id + ":init")) {
    openFolds.add(id + ":init");
    openFolds.add(id);
  }
  const isCol = !openFolds.has(id);
  const card = h("section", { class: "ex-group-card fold-card" + (isCol ? " collapsed" : "") },
    h("button", {
      type: "button",
      class: "ex-group-head",
      onclick: () => {
        const nowCollapsed = !card.classList.contains("collapsed");
        card.classList.toggle("collapsed", nowCollapsed);
        if (nowCollapsed) openFolds.delete(id);
        else openFolds.add(id);
      }
    },
      h("div", { class: "grow ex-group-title-box" },
        h("div", { class: "row gap" },
          h("strong", { class: "ex-group-title" }, title),
          badgeText ? h("span", { class: "ex-group-badge" }, badgeText) : null),
        subText ? h("small", { class: "muted ex-group-preview" }, subText) : null),
      h("span", { class: "fold-chevron" }, icon("up", 18))
    ),
    h("div", { class: "fold-body" },
      h("div", { class: "fold-inner stack", style: "padding:12px 14px 14px" }, bodyContent))
  );
  return card;
}

function buildOverviewDashboard() {
  const allDone = doneSessions();
  const now = Date.now();
  const cutoff30 = now - 30 * 864e5;
  let count30 = 0, totalVolKg = 0, totalSets = 0, totalReps = 0, totalMin = 0, durCount = 0;

  for (const s of allDone) {
    if (s.startedAt >= cutoff30) count30++;
    const st = sessionStats(s);
    totalVolKg += st.volume || 0;
    if (s.durationMin && s.durationMin > 0) { totalMin += s.durationMin; durCount++; }
    for (const e of s.entries || []) {
      for (const set of e.sets || []) {
        if (set.done && !set.isWarmup && (set.reps ?? 0) > 0) {
          totalSets++;
          totalReps += Number(set.reps) || 0;
        }
      }
    }
  }

  const u = unitLabel(state.settings.defaultUnit || "kg");
  const totalVolConv = fromKg(totalVolKg, state.settings.defaultUnit || "kg");
  const avgVolConv = allDone.length ? totalVolConv / allDone.length : 0;
  const avgMin = durCount ? Math.round(totalMin / durCount) : 0;
  const allPrs = personalRecords(allDone);

  const volStr = totalVolConv >= 10000
    ? `${formatNum(totalVolConv / 1000, 1)} ${t("progress.tonUnit")}`
    : `${formatNum(totalVolConv, 0)} ${u}`;

  const kpi = (label, val, sub) => h("div", { class: "stat prog-kpi" },
    h("small", { class: "muted" }, label),
    h("strong", {}, val),
    sub ? h("small", { class: "muted" }, sub) : null
  );

  return h("section", { class: "panel prog-overview-card" },
    h("div", { class: "panel-head" },
      h("h2", { class: "section" }, t("progress.overviewTitle")),
      h("span", { class: "ex-group-badge" }, t("progress.periodAll"))),
    h("div", { class: "stats prog-kpi-grid" },
      kpi(t("progress.ovWorkouts"), String(allDone.length), t("progress.ovLast30d", { n: count30 })),
      kpi(t("progress.ovTotalVol"), volStr, allDone.length ? t("progress.ovAvgVol", { v: formatNum(avgVolConv, 0), u }) : "—"),
      kpi(t("progress.ovWorkSets"), String(totalSets), t("progress.ovTotalReps", { n: totalReps })),
      kpi(t("progress.ovRecords"), String(allPrs.size), avgMin ? t("progress.ovAvgDur", { m: avgMin }) : "—")
    )
  );
}

function buildMuscleBalance() {
  const bodyBox = h("div", { class: "stack" });
  const btns = new Map();

  const periodBtn = (days, label) => {
    const b = h("button", {
      class: "btn small tag" + (muscleDays === days ? " on" : ""),
      type: "button",
      onclick: () => {
        muscleDays = days;
        for (const [d, el] of btns) el.classList.toggle("on", d === muscleDays);
        renderBody();
      }
    }, label);
    btns.set(days, b);
    return b;
  };

  function renderBody() {
    clear(bodyBox);
    const allDone = doneSessions();
    const now = Date.now();
    const cutoff = muscleDays > 0 ? now - muscleDays * 864e5 : 0;
    const counts = new Map();
    const exByMuscle = new Map();
    let totalSets = 0;

    for (const s of allDone) {
      if (s.startedAt < cutoff) continue;
      for (const e of s.entries || []) {
        const workSets = (e.sets || []).filter(x => x.done && !x.isWarmup && x.reps > 0).length;
        if (!workSets) continue;
        const ex = getExercise(e.exerciseId);
        const mg = tMuscle((ex?.muscleGroup || e.muscleGroup || t("common.other")).trim());
        counts.set(mg, (counts.get(mg) || 0) + workSets);
        if (!exByMuscle.has(mg)) exByMuscle.set(mg, new Set());
        exByMuscle.get(mg).add(e.exerciseName || ex?.name || "");
        totalSets += workSets;
      }
    }

    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const maxVal = rows[0]?.[1] || 1;
    const mapData = rows.map(([mg, cnt]) => ({
      muscle: mg,
      sets: cnt,
      exercises: [...(exByMuscle.get(mg) || [])]
    }));

    const barsContent = rows.length
      ? h("div", { class: "muscle-bars" }, ...rows.map(([mg, cnt]) => {
          const pct = Math.round((cnt / totalSets) * 100);
          const wPct = Math.max(6, Math.round((cnt / maxVal) * 100));
          return h("div", { class: "muscle-row" },
            h("div", { class: "muscle-head" },
              h("strong", {}, mg),
              h("small", { class: "muted" }, t("progress.muscleRowSets", { cnt, pct }))),
            h("div", { class: "muscle-track" },
              h("div", { class: "muscle-fill", style: `width:${wPct}%` })));
        }))
      : null;

    const barsFold = barsContent ? (() => {
      const wrap = h("div", { class: "prog-subfold" + (muscleBarsOpen ? "" : " collapsed") });
      const toggleBtn = h("button", {
        type: "button",
        class: "prog-subfold-btn",
        onclick: () => {
          muscleBarsOpen = !muscleBarsOpen;
          wrap.classList.toggle("collapsed", !muscleBarsOpen);
        }
      },
        h("span", {}, t("progress.muscleBreakdownBtn", { n: rows.length, sets: totalSets })),
        h("span", { class: "fold-chevron" }, icon("up", 16))
      );
      wrap.append(toggleBtn, h("div", { class: "fold-body" }, h("div", { class: "fold-inner", style: "padding-top:10px" }, barsContent)));
      return wrap;
    })() : h("p", { class: "muted small" }, t("progress.noSetsInPeriod"));

    bodyBox.append(renderBodyMap(mapData), barsFold);
  }

  renderBody();

  return h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("h2", { class: "section" }, t("progress.muscleBalance")),
      h("div", { class: "row gap" },
        periodBtn(7, t("progress.period7d")),
        periodBtn(30, t("progress.period30d")),
        periodBtn(0, t("progress.periodAll")))),
    bodyBox);
}

function buildBodyweightFold() {
  const log = state.bodyweightLog || [];
  const cur = state.settings.bodyweightKg ?? (log[log.length - 1]?.weight ?? null);
  const inp = h("input", {
    type: "text", inputmode: "decimal", class: "bw-inline-input grow",
    placeholder: t("progress.bwPlaceholder"), value: fmtNum(cur ?? ""),
    "aria-label": t("progress.bwAria")
  });
  const save = () => {
    const v = parseNum(inp.value);
    if (!v || v < 20 || v > 300) { haptic("error"); toast(t("progress.bwInvalidToast")); return; }
    logBodyweight(v);
    haptic("success");
    toast(t("progress.bwSavedToast", { w: fmtNum(v) }));
  };

  let deltaText = "";
  if (log.length >= 2) {
    const first = log[0].weight, last = log[log.length - 1].weight;
    const diff = last - first;
    deltaText = t("progress.bwChange", { diff: (diff > 0 ? "+" : "") + formatNum(diff, 1) });
  }

  const pts = log.map(x => ({ t: x.t, y: x.weight, label: t("progress.bwLabel", { w: formatNum(x.weight, 1) }) }));
  const badgeTxt = cur ? `${formatNum(cur, 1)} ${unitLabel("kg")}` : t("progress.bwNotSet");
  const subTxt = (cur ? t("progress.bwCurrent", { w: formatNum(cur, 1) }) : t("progress.bwNotSet")) + deltaText;

  const inner = h("div", { class: "stack" },
    h("div", { class: "row gap" },
      inp,
      h("button", { class: "btn small primary", type: "button", onclick: save }, t("progress.bwSaveBtn"))),
    pts.length >= 2 ? lineChart(pts, { height: 140, fmt: v => formatNum(v, 1), label: t("progress.bwChartLabel") }) : null
  );

  return makeFoldCard("bw", t("progress.bwTitle"), badgeTxt, subTxt, inner, false);
}

export function showFormula() {
  const pct = n => Math.round(n * 100) + "%";
  sheet(h("div", { class: "stack formula" },
    h("p", {}, t("progress.formulaP1")),
    h("ul", {},
      h("li", {}, h("strong", {}, t("progress.formulaRvTitle", { pct: pct(LI_WEIGHTS.volume) })), t("progress.formulaRv")),
      h("li", {}, h("strong", {}, t("progress.formulaReTitle", { pct: pct(LI_WEIGHTS.e1rm) })), t("progress.formulaRe")),
      h("li", {}, h("strong", {}, t("progress.formulaRdTitle", { pct: pct(LI_WEIGHTS.density) })), t("progress.formulaRd"))),
    h("p", { class: "muted" }, t("progress.formulaP2")),
    h("p", { class: "muted" }, t("progress.formulaP3"))), { title: t("progress.formulaTitle") });
}

export function mount(root) {
  const programs = () => state.programs.filter(p => !p.archived || doneSessions(p.id).length).sort((a, b) => a.name.localeCompare(b.name));
  let programId = localStorage.getItem(LS_KEY);
  let exId = null;
  const select = h("select", { "aria-label": t("progress.programAria") });
  const content = h("div", { class: "stack" });
  select.addEventListener("change", () => { programId = select.value; localStorage.setItem(LS_KEY, programId); exId = null; paint(); });
  root.append(content);

  function paint() {
    const progs = programs();
    if (!progs.find(p => p.id === programId)) programId = progs[0]?.id || null;
    clear(select);
    progs.forEach(p => select.append(h("option", { value: p.id, selected: p.id === programId }, p.name)));
    clear(content);

    // 1. Красивая общая сводка (Overview Dashboard) и баланс по мышцам
    content.append(buildOverviewDashboard(), buildMuscleBalance());

    if (!programId) {
      content.append(h("p", { class: "empty" }, t("progress.noPrograms")), buildBodyweightFold());
      return;
    }
    const program = getProgram(programId);
    const done = doneSessions(programId).sort(byStart);
    if (!done.length) {
      content.append(
        h("section", { class: "panel" },
          h("h2", { class: "section" }, t("progress.loadIndex")),
          select,
          h("p", { class: "empty" }, t("progress.noDoneSessions"))),
        buildBodyweightFold()
      );
      return;
    }

    const series = liSeries(done, program.baselineSessionId);
    const base = pickBaseline(done, program.baselineSessionId);

    /* 2. Главный график Индекса нагрузки + сводка по программе */
    const detail = h("div", { class: "muted small" });
    const pts = series.map(p => ({ t: p.session.startedAt, y: p.li, label: `LI ${formatNum(p.li, 1)}` }));
    const smooth = movingAverage(series.map(p => p.li), 4);
    const chart = lineChart(pts, {
      smooth, refY: 100, label: t("progress.loadIndex"), fmt: v => formatNum(v, 0), height: 210,
      onSelect: i => {
        const p = series[i]; if (!p) return;
        detail.textContent = t("progress.liDetail", {
          vol: formatNum(p.stats.volume, 0),
          sm: formatNum(smooth[i], 1)
        });
      }
    });
    const d4 = changeOverWeeks(series, 4), d12 = changeOverWeeks(series, 12);
    const sign = n => (n === null ? "—" : (n > 0 ? "+" : "") + formatNum(n, 1));

    content.append(h("section", { class: "panel" },
      h("div", { class: "panel-head" },
        h("h2", { class: "section" }, t("progress.loadIndex")),
        h("button", { class: "btn icon", type: "button", "aria-label": t("progress.formulaTitle"), title: t("progress.formulaTitle"), onclick: showFormula }, icon("help"))),
      select,
      chart, detail,
      h("p", { class: "legend muted small" }, h("span", { class: "key solid" }), t("progress.legendIndex"), h("span", { class: "key dashed" }), t("progress.legendSmooth"), h("span", { class: "key dotted" }), t("progress.legendRef")),
      h("div", { class: "stats stats-3" },
        h("div", { class: "stat" }, h("small", { class: "muted" }, t("progress.stat4w")), h("strong", {}, sign(d4))),
        h("div", { class: "stat" }, h("small", { class: "muted" }, t("progress.stat12w")), h("strong", {}, sign(d12))),
        h("div", { class: "stat" }, h("small", { class: "muted" }, t("progress.statWorkouts")), h("strong", {}, String(done.length)))),
      h("div", { class: "row gap", style: "justify-content:space-between;padding-top:4px;border-top:1px solid var(--line)" },
        h("small", { class: "muted" }, t("progress.baselineDate", { date: base ? fmtDate(base.startedAt) : "—" })),
        h("button", { class: "btn small", type: "button", onclick: () => resetBaseline(program, done) }, t("progress.changeBaselineShort")))
    ));

    /* 3. Раздел «Подробная статистика» (сворачиваемые карточки) */
    content.append(h("h3", { class: "group" }, t("progress.detailedGroup")));

    /* 3а. Личные рекорды (сворачиваемая карточка) */
    const allPrs = personalRecords(doneSessions().sort(byStart));
    const prEntries = [...allPrs.entries()];
    const prPreview = prEntries.slice(0, 3).map(([, p]) => p.name).join(", ") + (prEntries.length > 3 ? "…" : "");
    const prListEl = h("div", { class: "pr-grid" });
    if (!prEntries.length) {
      prListEl.append(h("p", { class: "muted small" }, t("exercises.noPRs")));
    } else {
      for (const [exerciseId, pr] of prEntries) {
        const u = unitLabel(pr.unit);
        const wVal = pr.weightKg !== null ? `${formatNum(fromKg(pr.weightKg, pr.unit), 1)} ${u}` : "—";
        const e1Val = pr.e1rmKg !== null ? `${formatNum(fromKg(pr.e1rmKg, pr.unit), 1)} ${u}` : "—";
        prListEl.append(h("button", {
          type: "button",
          class: "pr-card",
          onclick: () => openExerciseHistory(exerciseId, pr.name, pr.unit)
        },
          h("div", { class: "pr-card-top" },
            h("strong", { class: "pr-card-title" }, pr.name),
            h("span", { class: "pr-badge" }, "PR")),
          h("div", { class: "pr-card-metrics" },
            h("div", { class: "pr-metric-box" },
              h("small", { class: "muted" }, t("exercises.weightPR")),
              h("strong", {}, wVal),
              pr.weightDate ? h("small", { class: "muted" }, fmtDate(pr.weightDate)) : null),
            h("div", { class: "pr-metric-box" },
              h("small", { class: "muted" }, t("exercises.bestE1rm")),
              h("strong", {}, e1Val),
              pr.e1rmDate ? h("small", { class: "muted" }, fmtDate(pr.e1rmDate)) : null))
        ));
      }
    }
    content.append(makeFoldCard(
      "prs",
      t("progress.personalRecords"),
      String(prEntries.length),
      prPreview || t("exercises.noPRs"),
      prListEl,
      false
    ));

    /* 3б. Графики по упражнению (сворачиваемая карточка) */
    const exMap = new Map();
    done.forEach(s => (s.entries || []).forEach(e => exMap.set(e.exerciseId, { name: getExercise(e.exerciseId)?.name || e.exerciseName, unit: e.unit })));
    const exList = [...exMap.entries()];
    const exPreview = exList.slice(0, 3).map(([, v]) => v.name).join(", ") + (exList.length > 3 ? "…" : "");
    if (!exList.find(([id]) => id === exId)) exId = exList[0]?.[0] || null;
    if (exId) {
      const exSel = h("select", { "aria-label": t("progress.exerciseAria") }, exList.map(([id, v]) => h("option", { value: id, selected: id === exId }, v.name)));
      const exChartsBox = h("div", { class: "stack" });
      const renderExCharts = () => {
        clear(exChartsBox);
        const info = exMap.get(exId);
        if (!info) return;
        const rows = [];
        done.forEach(s => {
          const entries = (s.entries || []).filter(e => e.exerciseId === exId);
          if (!entries.length) return;
          const w = Math.max(...entries.map(e => entryTopWeight(e) ?? -1)), e1 = Math.max(...entries.map(e => entryE1rm(e) ?? -1));
          const v = entries.reduce((a, e) => a + entryVolume(e), 0);
          if (w < 0 && v <= 0) return;
          rows.push({ t: s.startedAt, w: w >= 0 ? fromKg(w, info.unit) : null, e1: e1 >= 0 ? fromKg(e1, info.unit) : null, v: fromKg(v, info.unit) });
        });
        const u = unitLabel(info.unit);
        const mk = (title, key, unitText) => {
          const p = rows.filter(r => r[key] !== null).map(r => ({ t: r.t, y: r[key], label: `${formatNum(r[key], 1)} ${unitText}` }));
          return h("div", {}, h("h3", { class: "group" }, title), lineChart(p, { height: 150, fmt: v => formatNum(v, key === "v" ? 0 : 1), label: title }));
        };
        exChartsBox.append(mk(t("progress.workingWeight"), "w", u), mk("e1RM", "e1", u), mk(t("progress.volume"), "v", u));
      };
      exSel.addEventListener("change", () => { exId = exSel.value; renderExCharts(); });
      renderExCharts();
      content.append(makeFoldCard(
        "byEx",
        t("progress.byExercise"),
        String(exList.length),
        exPreview || t("progress.byExerciseSub", { n: exList.length }),
        h("div", { class: "stack" }, exSel, exChartsBox),
        false
      ));
    }

    /* 3в. Собственный вес тела (сворачиваемая карточка) */
    content.append(buildBodyweightFold());
  }

  function resetBaseline(program, done) {
    const list = h("div", { class: "list" });
    const cur = pickBaseline(done, program.baselineSessionId);
    const choose = id => { haptic("success"); saveProgram({ ...program, baselineSessionId: id }); sh.close(); toast(t("progress.baselineUpdatedToast")); paint(); };
    list.append(h("button", { class: "list-item", type: "button", onclick: () => choose(null) }, h("span", { class: "grow" }, h("strong", {}, t("progress.baselineAuto")))));
    [...done].reverse().forEach(s => list.append(h("button", { class: "list-item" + (cur && cur.id === s.id ? " current" : ""), type: "button", onclick: () => choose(s.id) },
      h("span", { class: "grow" }, h("strong", {}, fmtDate(s.startedAt, true)), h("small", { class: "muted" }, `${s.durationMin ?? "?"} ${t("workout.minUnit")}`)), cur && cur.id === s.id ? icon("check", 18) : null)));
    const sh = sheet(h("div", { class: "stack" }, h("p", { class: "muted" }, t("progress.baselineDesc")), list), { title: t("progress.baselineTitle"), full: true });
  }

  paint();
  return { update: paint };
}
