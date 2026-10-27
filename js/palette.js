// Command Palette (Палитра команд Ctrl+K) и Хоткеи
import { state, activeSession } from "./store.js";
import { h, clear, icon, toast } from "./ui.js";
import { t, isEn } from "./i18n.js";
import { sharedState, isDesktop } from "./shell.js";
import { applyTheme } from "./views/settings.js";

let paletteBackdrop = null;
let recentActionIds = ["action-programs", "action-exercises", "action-progress", "action-theme"];

export function openPalette(initialQuery = "") {
  closePalette();

  const backdrop = h("div", {
    class: "cmd-palette-backdrop",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": t("cmd.placeholder") || "Палитра команд"
  });

  const input = h("input", {
    type: "search",
    class: "cmd-input",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-controls": "cmd-results-list",
    placeholder: t("cmd.placeholder") || "Поиск действий, программ, упражнений… (Esc для выхода)",
    autocomplete: "off",
    value: initialQuery
  });

  const resultsBox = h("div", {
    class: "cmd-results",
    id: "cmd-results-list",
    role: "listbox"
  });

  const footerHelp = h("div", { class: "cmd-footer" },
    h("span", {}, h("kbd", {}, "↑↓"), " " + (isEn() ? "navigate" : "навигация")),
    h("span", {}, h("kbd", {}, "Enter"), " " + (isEn() ? "select" : "выбрать")),
    h("span", {}, h("kbd", {}, "Esc"), " " + (isEn() ? "close" : "закрыть"))
  );

  const modal = h("div", { class: "cmd-modal" }, input, resultsBox, footerHelp);
  backdrop.append(modal);
  document.body.append(backdrop);
  paletteBackdrop = backdrop;

  let activeIdx = 0;
  let flatItems = [];

  const close = () => {
    backdrop.classList.add("closing");
    setTimeout(() => {
      if (backdrop.parentNode) backdrop.remove();
      if (paletteBackdrop === backdrop) paletteBackdrop = null;
    }, 120);
  };

  backdrop.addEventListener("pointerdown", e => {
    if (e.target === backdrop) close();
  });

  function getItems(query = "") {
    const q = query.trim().toLowerCase();
    const groups = [];

    // Группа 1: Действия
    const actionItems = [
      {
        id: "action-programs",
        title: t("nav.programs") || "Программы",
        sub: isEn() ? "Go to workout programs builder" : "Перейти в конструктор программ",
        cat: t("cmd.actions") || "Действия",
        action: () => { location.hash = "#/programs"; }
      },
      {
        id: "action-new-prog",
        title: t("programs.newBtn") || "+ Новая программа",
        sub: isEn() ? "Create a new program" : "Создать новую программу",
        cat: t("cmd.actions") || "Действия",
        action: () => {
          location.hash = "#/programs";
          sharedState.selectedProgramId = "new";
          window.dispatchEvent(new CustomEvent("desktop-create-program"));
        }
      },
      {
        id: "action-exercises",
        title: t("nav.exercises") || "Упражнения",
        sub: isEn() ? "Browse exercises library" : "Открыть базу упражнений",
        cat: t("cmd.actions") || "Действия",
        action: () => { location.hash = "#/exercises"; }
      },
      {
        id: "action-progress",
        title: t("nav.progress") || "Прогресс",
        sub: isEn() ? "View analytics and load index" : "Посмотреть статистику и индекс нагрузки",
        cat: t("cmd.actions") || "Действия",
        action: () => { location.hash = "#/progress"; }
      },
      {
        id: "action-history",
        title: t("nav.history") || "История",
        sub: isEn() ? "Completed workouts history" : "История завершённых тренировок",
        cat: t("cmd.actions") || "Действия",
        action: () => { location.hash = "#/history"; }
      },
      {
        id: "action-settings",
        title: t("nav.settings") || "Настройки",
        sub: isEn() ? "App preferences and settings" : "Параметры и настройки приложения",
        cat: t("cmd.actions") || "Действия",
        action: () => { location.hash = "#/settings"; }
      },
      {
        id: "action-theme",
        title: t("cmd.toggleTheme") || "Переключить тему",
        sub: isEn() ? "Switch between light and dark theme" : "Переключение темы (светлая / тёмная)",
        cat: t("cmd.actions") || "Действия",
        action: () => {
          const cur = state.settings.theme;
          state.settings.theme = cur === "light" ? "dark" : "light";
          applyTheme();
          toast(t("settings.themeChanged") || "Тема изменена");
        }
      },
      {
        id: "action-hotkeys",
        title: t("cmd.hotkeysTitle") || "Горячие клавиши",
        sub: isEn() ? "Show list of keyboard shortcuts" : "Справка по быстрым клавишам",
        cat: t("cmd.actions") || "Действия",
        action: () => { openHotkeysModal(); }
      }
    ];

    // Группа 2: Программы
    const progItems = (state.programs || []).filter(p => !p.archived).map(p => ({
      id: "prog-" + p.id,
      title: p.name,
      sub: isEn() ? `${(p.items || []).length} exercises` : `${(p.items || []).length} упр.`,
      cat: t("cmd.programs") || "Программы",
      action: () => {
        sharedState.selectedProgramId = p.id;
        location.hash = "#/programs";
      },
      secondaryAction: () => {
        toast(isEn()
          ? "Active workout is only available on mobile"
          : "Сессия тренировки доступна только на мобильном телефоне");
      }
    }));

    // Группа 3: Упражнения
    const exItems = (state.exercises || []).filter(e => !e.archived).map(e => ({
      id: "ex-" + e.id,
      title: e.name,
      sub: e.muscleGroup || "",
      cat: t("cmd.exercises") || "Упражнения",
      action: () => {
        sharedState.selectedMuscleGroup = e.muscleGroup;
        sharedState.selectedExerciseId = e.id;
        location.hash = "#/exercises";
      }
    }));

    if (!q) {
      // Недавние и быстрые действия
      const recents = actionItems.filter(it => recentActionIds.includes(it.id));
      const sampleProgs = progItems.slice(0, 3);
      const sampleExs = exItems.slice(0, 3);
      groups.push({ title: isEn() ? "Recent & Quick Actions" : "Быстрые действия", items: recents });
      if (sampleProgs.length) groups.push({ title: t("cmd.programs") || "Программы", items: sampleProgs });
      if (sampleExs.length) groups.push({ title: t("cmd.exercises") || "Упражнения", items: sampleExs });
    } else {
      const filterFn = it => it.title.toLowerCase().includes(q) || (it.sub && it.sub.toLowerCase().includes(q));
      const matchedActions = actionItems.filter(filterFn);
      const matchedProgs = progItems.filter(filterFn);
      const matchedExs = exItems.filter(filterFn);

      if (matchedActions.length) groups.push({ title: t("cmd.actions") || "Действия", items: matchedActions });
      if (matchedProgs.length) groups.push({ title: t("cmd.programs") || "Программы", items: matchedProgs });
      if (matchedExs.length) groups.push({ title: t("cmd.exercises") || "Упражнения", items: matchedExs });
    }

    return groups;
  }

  function renderResults() {
    clear(resultsBox);
    const groups = getItems(input.value);
    flatItems = [];

    if (!groups.length) {
      resultsBox.append(h("div", { class: "cmd-empty" }, t("cmd.noResults") || "Ничего не найдено"));
      return;
    }

    groups.forEach(grp => {
      const grpHeader = h("div", { class: "cmd-group-title" }, grp.title);
      resultsBox.append(grpHeader);

      grp.items.forEach(it => {
        const itemIdx = flatItems.length;
        flatItems.push(it);

        const isSel = itemIdx === activeIdx;
        const itemBtn = h("button", {
          type: "button",
          class: "cmd-item" + (isSel ? " on" : ""),
          role: "option",
          "aria-selected": isSel ? "true" : "false",
          id: "cmd-opt-" + itemIdx,
          onclick: () => {
            if (!recentActionIds.includes(it.id)) {
              recentActionIds.unshift(it.id);
              recentActionIds = recentActionIds.slice(0, 6);
            }
            close();
            it.action();
          }
        },
          h("div", { class: "cmd-item-main" },
            h("span", { class: "cmd-item-title" }, it.title),
            it.sub ? h("span", { class: "cmd-item-sub" }, it.sub) : null
          ),
          h("span", { class: "cmd-item-cat" }, it.cat)
        );

        resultsBox.append(itemBtn);
      });
    });

    input.setAttribute("aria-activedescendant", flatItems[activeIdx] ? `cmd-opt-${activeIdx}` : "");
  }

  input.addEventListener("input", () => {
    activeIdx = 0;
    renderResults();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatItems.length > 0) {
        activeIdx = (activeIdx + 1) % flatItems.length;
        renderResults();
        const onEl = resultsBox.querySelector(".cmd-item.on");
        if (onEl) onEl.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatItems.length > 0) {
        activeIdx = (activeIdx - 1 + flatItems.length) % flatItems.length;
        renderResults();
        const onEl = resultsBox.querySelector(".cmd-item.on");
        if (onEl) onEl.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatItems[activeIdx]) {
        const it = flatItems[activeIdx];
        if (!recentActionIds.includes(it.id)) {
          recentActionIds.unshift(it.id);
          recentActionIds = recentActionIds.slice(0, 6);
        }
        close();
        it.action();
      }
    }
  });

  renderResults();
  setTimeout(() => input.focus(), 30);
}

export function closePalette() {
  if (paletteBackdrop) {
    paletteBackdrop.remove();
    paletteBackdrop = null;
  }
}

/** Модальное окно горячих клавиш (?) */
export function openHotkeysModal() {
  const existing = document.querySelector(".hotkeys-modal-backdrop");
  if (existing) existing.remove();

  const backdrop = h("div", {
    class: "hotkeys-modal-backdrop center-modal-backdrop",
    role: "dialog",
    "aria-modal": "true"
  });

  const shortcuts = [
    { key: "Ctrl + K / ⌘K", descRu: "Открыть палитру команд", descEn: "Open command palette" },
    { key: "Alt + 1", descRu: "Вкладка «Программы»", descEn: "Programs tab" },
    { key: "Alt + 2", descRu: "Вкладка «Упражнения»", descEn: "Exercises tab" },
    { key: "Alt + 3", descRu: "Вкладка «Прогресс»", descEn: "Progress tab" },
    { key: "Alt + 4", descRu: "Вкладка «История»", descEn: "History tab" },
    { key: "Alt + 5", descRu: "Вкладка «Настройки»", descEn: "Settings tab" },
    { key: "?", descRu: "Справка по горячим клавишам", descEn: "Keyboard shortcuts help" },
    { key: "Esc", descRu: "Закрыть модальное окно / drawer", descEn: "Close modal / drawer" }
  ];

  const rows = shortcuts.map(s => h("div", { class: "hotkey-row" },
    h("kbd", { class: "hotkey-kbd" }, s.key),
    h("span", { class: "hotkey-desc" }, isEn() ? s.descEn : s.descRu)
  ));

  const closeBtn = h("button", {
    type: "button",
    class: "btnP",
    style: "margin-top:16px;width:100%;justify-content:center",
    onclick: () => backdrop.remove()
  }, t("common.close") || "Закрыть");

  const modal = h("div", { class: "hotkeys-modal center-modal" },
    h("div", { class: "hotkeys-head" },
      h("h3", {}, t("cmd.hotkeysTitle") || "Горячие клавиши"),
      h("button", {
        type: "button",
        class: "icBtn",
        onclick: () => backdrop.remove()
      }, icon("x", 16))
    ),
    h("div", { class: "hotkeys-body" }, ...rows),
    closeBtn
  );

  backdrop.append(modal);
  backdrop.addEventListener("pointerdown", e => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
}

/** Глобальный слушатель горячих клавиш (десктоп) */
export function initHotkeys() {
  window.addEventListener("keydown", e => {
    // Guard: не стрелять при наборе текста в input/textarea/contenteditable
    const active = document.activeElement;
    const isTyping = active && (
      active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable
    );

    // Ctrl+K / Cmd+K — открывает палитру даже если фокус в инпуте (стандартная комбинация)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
      return;
    }

    if (e.key === "Escape") {
      closePalette();
      const hm = document.querySelector(".hotkeys-modal-backdrop");
      if (hm) hm.remove();
      return;
    }

    if (isTyping) return;

    // Alt + 1..5: переключение вкладок
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "1") { e.preventDefault(); location.hash = "#/programs"; }
      else if (e.key === "2") { e.preventDefault(); location.hash = "#/exercises"; }
      else if (e.key === "3") { e.preventDefault(); location.hash = "#/progress"; }
      else if (e.key === "4") { e.preventDefault(); location.hash = "#/history"; }
      else if (e.key === "5") { e.preventDefault(); location.hash = "#/settings"; }
      return;
    }

    // ? — справка по клавишам
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openHotkeysModal();
    }
  });
}
