import { h, clear, sheet, toast, fmtDate, fmtNum, parseNum, icon } from "../ui.js";
import { state, doneSessions, getExercise, getProgram, saveProgram, logBodyweight, unitLabel } from "../store.js";
import { lineChart } from "../chart.js";
import {
  liSeries, movingAverage, changeOverWeeks, personalRecords, pickBaseline, byStart, formatNum,
  entryTopWeight, entryE1rm, entryVolume, fromKg, LI_WEIGHTS
} from "../metrics.js";

const LS_KEY = "fitness.progress.program";
let muscleDays = 30;

function buildMuscleBalance(onChangePeriod) {
  const allDone = doneSessions();
  const now = Date.now();
  const cutoff = muscleDays > 0 ? now - muscleDays * 864e5 : 0;
  const counts = new Map();
  let totalSets = 0;

  for (const s of allDone) {
    if (s.startedAt < cutoff) continue;
    for (const e of s.entries || []) {
      const workSets = (e.sets || []).filter(x => x.done && !x.isWarmup && x.reps > 0).length;
      if (!workSets) continue;
      const ex = getExercise(e.exerciseId);
      const mg = (ex?.muscleGroup || e.muscleGroup || "Другое").trim();
      counts.set(mg, (counts.get(mg) || 0) + workSets);
      totalSets += workSets;
    }
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxVal = rows[0]?.[1] || 1;

  const periodBtn = (days, label) => h("button", {
    class: "btn small tag" + (muscleDays === days ? " on" : ""),
    type: "button",
    onclick: () => { muscleDays = days; onChangePeriod(); }
  }, label);

  const bars = rows.length
    ? h("div", { class: "muscle-bars" }, ...rows.map(([mg, cnt]) => {
        const pct = Math.round((cnt / totalSets) * 100);
        const wPct = Math.max(6, Math.round((cnt / maxVal) * 100));
        return h("div", { class: "muscle-row" },
          h("div", { class: "muscle-head" },
            h("strong", {}, mg),
            h("small", { class: "muted" }, `${cnt} сет. (${pct}%)`)),
          h("div", { class: "muscle-track" },
            h("div", { class: "muscle-fill", style: `width:${wPct}%` })));
      }))
    : h("p", { class: "muted small" }, "За выбранный период нет выполненных рабочих сетов.");

  return h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("h2", { class: "section" }, "Баланс по мышцам"),
      h("div", { class: "row gap" },
        periodBtn(7, "7 дн."),
        periodBtn(30, "30 дн."),
        periodBtn(0, "Все"))),
    bars);
}

function buildBodyweightPanel() {
  const log = state.bodyweightLog || [];
  const cur = state.settings.bodyweightKg ?? (log[log.length - 1]?.weight ?? null);
  const inp = h("input", {
    type: "text", inputmode: "decimal", class: "bw-inline-input",
    placeholder: "80,0", value: fmtNum(cur ?? ""),
    "aria-label": "Собственный вес тела, кг"
  });
  const save = () => {
    const v = parseNum(inp.value);
    if (!v || v < 20 || v > 300) { toast("Введите корректный вес в кг"); return; }
    logBodyweight(v);
    toast(`Вес тела записан: ${fmtNum(v)} кг`);
  };

  let deltaText = "";
  if (log.length >= 2) {
    const first = log[0].weight, last = log[log.length - 1].weight;
    const diff = last - first;
    deltaText = ` · изменение ${diff > 0 ? "+" : ""}${formatNum(diff, 1)} кг`;
  }

  const pts = log.map(x => ({ t: x.t, y: x.weight, label: `${formatNum(x.weight, 1)} кг` }));
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" },
      h("div", {},
        h("h2", { class: "section" }, "Собственный вес тела"),
        h("small", { class: "muted" }, (cur ? `Текущий: ${formatNum(cur, 1)} кг` : "Не указан") + deltaText)),
      h("div", { class: "row gap" },
        inp,
        h("button", { class: "btn small primary", type: "button", onclick: save }, "Записать"))),
    pts.length >= 2 ? lineChart(pts, { height: 140, fmt: v => formatNum(v, 1), label: "Вес тела, кг" }) : null);
}

export function showFormula() {
  const pct = n => Math.round(n * 100) + "%";
  sheet(h("div", { class: "stack formula" },
    h("p", {}, "Индекс нагрузки показывает, насколько тренировка «тяжелее» базовой (первой тренировки программы)."),
    h("pre", { class: "code" }, `LI = 100 × (${LI_WEIGHTS.volume.toFixed(2)}·rV + ${LI_WEIGHTS.e1rm.toFixed(2)}·rE + ${LI_WEIGHTS.density.toFixed(2)}·rD)`),
    h("ul", {},
      h("li", {}, h("strong", {}, "rV"), ` (${pct(LI_WEIGHTS.volume)}) — объём V = Σ вес×повторы, делённый на объём базовой.`),
      h("li", {}, h("strong", {}, "rE"), ` (${pct(LI_WEIGHTS.e1rm)}) — среднее отношение e1RM по упражнениям. e1RM = вес × (1 + повт./30) (Эпли); при RPE повт. = повт. + (10 − RPE); сеты > 12 повторов не считаются.`),
      h("li", {}, h("strong", {}, "rD"), ` (${pct(LI_WEIGHTS.density)}) — плотность D = V / минуты. Если время неизвестно или > 180 мин, компонент выпадает, а его вес делится между остальными.`)),
    h("p", { class: "muted" }, "Учитываются только выполненные неразминочные сеты и только упражнения, которые есть и в тренировке, и в базовой. Всё приводится к кг (1 lb = 0,4536 кг). 100 — уровень старта, 110 — на 10% тяжелее."),
    h("p", { class: "muted" }, "Сплошная линия — индекс по тренировкам, пунктирная толстая — скользящее среднее по 4 точкам.")), { title: "Как считается индекс" });
}

export function mount(root) {
  const programs = () => state.programs.filter(p => !p.archived || doneSessions(p.id).length).sort((a, b) => a.name.localeCompare(b.name));
  let programId = localStorage.getItem(LS_KEY);
  let exId = null;
  const select = h("select", { "aria-label": "Программа" });
  const content = h("div", { class: "stack" });
  select.addEventListener("change", () => { programId = select.value; localStorage.setItem(LS_KEY, programId); exId = null; paint(); });
  root.append(h("div", { class: "toolbar" }, select), content);

  function paint() {
    const progs = programs();
    if (!progs.find(p => p.id === programId)) programId = progs[0]?.id || null;
    clear(select);
    progs.forEach(p => select.append(h("option", { value: p.id, selected: p.id === programId }, p.name)));
    clear(content);
    if (!programId) {
      content.append(h("p", { class: "empty" }, "Нет программ. Создайте программу и проведите первую тренировку."), buildMuscleBalance(paint), buildBodyweightPanel());
      return;
    }
    const program = getProgram(programId);
    const done = doneSessions(programId).sort(byStart);
    if (!done.length) {
      content.append(h("p", { class: "empty" }, "У этой программы ещё нет завершённых тренировок."), buildMuscleBalance(paint), buildBodyweightPanel());
      return;
    }

    const series = liSeries(done, program.baselineSessionId);
    const base = pickBaseline(done, program.baselineSessionId);

    /* Главный график */
    const detail = h("div", { class: "muted small" });
    const pts = series.map(p => ({ t: p.session.startedAt, y: p.li, label: `LI ${formatNum(p.li, 1)}` }));
    const smooth = movingAverage(series.map(p => p.li), 4);
    const chart = lineChart(pts, {
      smooth, refY: 100, label: "Индекс нагрузки", fmt: v => formatNum(v, 0), height: 210,
      onSelect: i => {
        const p = series[i]; if (!p) return;
        const d = p.detail;
        detail.textContent = `Объём ${formatNum(p.stats.volume, 0)} кг · rV ${formatNum(d.rV, 2)}` + (d.rE != null ? ` · rE ${formatNum(d.rE, 2)}` : "") + (d.rD != null ? ` · rD ${formatNum(d.rD, 2)}` : "") + ` · сглаж. ${formatNum(smooth[i], 1)}`;
      }
    });
    content.append(h("section", { class: "panel" },
      h("div", { class: "panel-head" }, h("h2", { class: "section" }, "Индекс нагрузки"),
        h("button", { class: "btn icon", type: "button", "aria-label": "Как считается индекс", title: "Как считается индекс", onclick: showFormula }, icon("help"))),
      chart, detail,
      h("p", { class: "legend muted small" }, h("span", { class: "key solid" }), " индекс  ", h("span", { class: "key dashed" }), " среднее (4)  ", h("span", { class: "key dotted" }), " уровень 100")));

    /* Сводка */
    const d4 = changeOverWeeks(series, 4), d12 = changeOverWeeks(series, 12);
    const sign = n => (n === null ? "—" : (n > 0 ? "+" : "") + formatNum(n, 1));
    content.append(h("section", { class: "panel" },
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("small", { class: "muted" }, "За 4 недели"), h("strong", {}, sign(d4))),
        h("div", { class: "stat" }, h("small", { class: "muted" }, "За 12 недель"), h("strong", {}, sign(d12))),
        h("div", { class: "stat" }, h("small", { class: "muted" }, "Тренировок"), h("strong", {}, String(done.length)))),
      h("p", { class: "muted small" }, `База индекса: ${base ? fmtDate(base.startedAt) : "—"}`),
      h("button", { class: "btn block", type: "button", onclick: () => resetBaseline(program, done) }, "Сбросить базу индекса")));

    /* Графики по упражнению */
    const exMap = new Map();
    done.forEach(s => (s.entries || []).forEach(e => exMap.set(e.exerciseId, { name: e.exerciseName, unit: e.unit })));
    const exList = [...exMap.entries()];
    if (!exList.find(([id]) => id === exId)) exId = exList[0]?.[0] || null;
    if (exId) {
      const info = exMap.get(exId);
      const exSel = h("select", { "aria-label": "Упражнение" }, exList.map(([id, v]) => h("option", { value: id, selected: id === exId }, v.name)));
      exSel.addEventListener("change", () => { exId = exSel.value; paint(); });
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
      content.append(h("section", { class: "panel" }, h("h2", { class: "section" }, "По упражнению"), exSel,
        mk("Рабочий вес", "w", u), mk("e1RM", "e1", u), mk("Объём", "v", u)));
    }

    /* Рекорды */
    const prs = personalRecords(done);
    const prBox = h("section", { class: "panel" }, h("h2", { class: "section" }, "Личные рекорды"));
    for (const [, pr] of prs) {
      prBox.append(h("div", { class: "pr" },
        h("strong", {}, pr.name),
        h("span", { class: "muted small" }, `вес ${pr.weightKg !== null ? formatNum(fromKg(pr.weightKg, pr.unit), 1) + " " + unitLabel(pr.unit) + " (" + fmtDate(pr.weightDate) + ")" : "—"}`),
        h("span", { class: "muted small" }, `e1RM ${pr.e1rmKg !== null ? formatNum(fromKg(pr.e1rmKg, pr.unit), 1) + " " + unitLabel(pr.unit) + " (" + fmtDate(pr.e1rmDate) + ")" : "—"}`)));
    }
    content.append(prBox, buildMuscleBalance(paint), buildBodyweightPanel());
  }

  function resetBaseline(program, done) {
    const list = h("div", { class: "list" });
    const cur = pickBaseline(done, program.baselineSessionId);
    const choose = id => { saveProgram({ ...program, baselineSessionId: id }); sh.close(); toast("База индекса обновлена"); paint(); };
    list.append(h("button", { class: "list-item", type: "button", onclick: () => choose(null) }, h("span", { class: "grow" }, h("strong", {}, "Автоматически — первая тренировка"))));
    [...done].reverse().forEach(s => list.append(h("button", { class: "list-item" + (cur && cur.id === s.id ? " current" : ""), type: "button", onclick: () => choose(s.id) },
      h("span", { class: "grow" }, h("strong", {}, fmtDate(s.startedAt, true)), h("small", { class: "muted" }, `${s.durationMin ?? "?"} мин`)), cur && cur.id === s.id ? icon("check", 18) : null)));
    const sh = sheet(h("div", { class: "stack" }, h("p", { class: "muted" }, "Выберите тренировку, которая станет уровнем 100. Более ранние тренировки исчезнут с графика индекса (сами данные сохранятся)."), list), { title: "База индекса", full: true });
  }

  paint();
  return { update: paint };
}
