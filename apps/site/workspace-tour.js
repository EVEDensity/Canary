const tourCopy = {
  en: {
    label: "Explore the workspace",
    documentation: "Read the guide",
    zoomLabel: "Screenshot zoom",
    zoomHint: "Zoom to inspect. Scroll to explore.",
    zoomFit: "Fit to window",
    zoomValue: "Zoom to {value}%",
    viewport: "Workspace screenshot. Scroll horizontally or vertically when enlarged.",
    steps: [
      {
        tab: "Run overview",
        title: "The current result, at a glance.",
        body: "Progress, failures and duration show where this run stands.",
      },
      {
        tab: "Architecture",
        title: "From the result to the relevant code.",
        body: "Explore the recorded structure, then follow mapped evidence into source.",
      },
      {
        tab: "Run trends",
        title: "See what changed between runs.",
        body: "Compare pass rate and duration within a focused observation window.",
      },
      {
        tab: "Run history",
        title: "Every result keeps its own context.",
        body: "Review check times, run scope and the link between a failure and its rerun.",
      },
    ],
  },
  "zh-CN": {
    label: "探索验证工作台",
    documentation: "查看指南",
    zoomLabel: "截图缩放",
    zoomHint: "放大查看细节，滚动探索界面。",
    zoomFit: "适应窗口",
    zoomValue: "缩放至 {value}%",
    viewport: "工作台截图，放大后可横向或纵向滚动查看。",
    steps: [
      {
        tab: "运行概览",
        title: "本次结果，一目了然。",
        body: "通过进度、失败数量与耗时，快速判断当前运行状态。",
      },
      {
        tab: "项目架构",
        title: "从检测结果，进入相关代码。",
        body: "探索本次运行记录的项目结构，沿已映射的证据定位源码。",
      },
      {
        tab: "运行趋势",
        title: "看清每次运行的变化。",
        body: "在选定的观察窗口中，比较通过率与运行耗时。",
      },
      {
        tab: "运行历史",
        title: "每次结果，都有清晰的上下文。",
        body: "查看检测时间、检查范围，以及失败与后续重跑之间的关联。",
      },
    ],
  },
};

const regions = [
  { x: 15, y: 17, width: 84, height: 11, guide: "automatic-checks" },
  { x: 15, y: 31, width: 84, height: 21, guide: "architecture-map" },
  { x: 15, y: 58, width: 60, height: 42, guide: "running-and-ui" },
  { x: 0.5, y: 64, width: 13.5, height: 7, guide: "running-and-ui" },
];

function createArrow() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12h14m-6-6 6 6-6 6");
  svg.append(path);
  return svg;
}

function createButton(className, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  if (label) button.textContent = label;
  return button;
}

function mountPreviewZoom(locale) {
  const dialog = document.querySelector("#preview-dialog");
  const image = dialog?.querySelector("#dialog-image");
  if (!dialog || !image || dialog.querySelector(".preview-zoom")) return null;

  let activeLocale = locale;
  let scale = 1;
  const scales = [1, 1.25, 1.5];
  const toolbar = document.createElement("div");
  toolbar.className = "preview-zoom";
  const hint = document.createElement("span");
  hint.className = "preview-zoom-hint";
  const group = document.createElement("div");
  group.className = "preview-zoom-options";
  group.setAttribute("role", "group");
  const buttons = scales.map((value) => {
    const button = createButton("preview-zoom-button", `${value * 100}%`);
    button.addEventListener("click", () => setScale(value));
    group.append(button);
    return button;
  });
  toolbar.append(hint, group);
  const viewport = document.createElement("div");
  viewport.className = "preview-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  image.before(toolbar, viewport);
  viewport.append(image);

  function setScale(value) {
    scale = value;
    image.style.setProperty("--preview-scale", String(scale));
    buttons.forEach((button, index) => button.setAttribute("aria-pressed", String(scales[index] === scale)));
    if (scale === 1) viewport.scrollTo({ left: 0, top: 0, behavior: "instant" });
  }

  function renderLocale(next) {
    activeLocale = next;
    const copy = tourCopy[activeLocale];
    hint.textContent = copy.zoomHint;
    group.setAttribute("aria-label", copy.zoomLabel);
    viewport.setAttribute("aria-label", copy.viewport);
    buttons.forEach((button, index) => {
      const label = index === 0 ? copy.zoomFit : copy.zoomValue.replace("{value}", String(scales[index] * 100));
      button.setAttribute("aria-label", label);
      button.title = label;
    });
  }

  dialog.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest("input, textarea, [contenteditable]")) {
      return;
    }
    const current = scales.indexOf(scale);
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setScale(scales[Math.min(current + 1, scales.length - 1)]);
    } else if (event.key === "-") {
      event.preventDefault();
      setScale(scales[Math.max(0, current - 1)]);
    } else if (event.key === "0") {
      event.preventDefault();
      setScale(1);
    }
  });
  dialog.addEventListener("close", () => setScale(1));
  renderLocale(activeLocale);
  setScale(1);
  return { setLocale: renderLocale };
}

/** Mount an annotated tour of the recorded screenshot, without changing the product preview's click behavior. */
export function mountWorkspaceTour(frame, initialLocale = "en") {
  if (!frame || frame.dataset.tourMounted === "true") return { setLocale() {} };
  const screenshot = frame.querySelector("#screenshot-open");
  if (!screenshot) return { setLocale() {} };
  frame.dataset.tourMounted = "true";
  screenshot.classList.add("workspace-tour-image");
  let locale = Object.hasOwn(tourCopy, initialLocale) ? initialLocale : "en";
  let selected = 0;
  let highlighted = false;

  const outline = document.createElement("span");
  outline.className = "workspace-focus-outline";
  outline.setAttribute("aria-hidden", "true");
  screenshot.append(outline);

  const tour = document.createElement("div");
  tour.className = "workspace-tour";

  const tabs = document.createElement("div");
  tabs.className = "workspace-tour-tabs";
  tabs.setAttribute("role", "tablist");
  const panel = document.createElement("div");
  panel.className = "workspace-tour-detail";
  panel.id = "workspace-tour-detail";
  panel.setAttribute("role", "tabpanel");
  panel.tabIndex = 0;
  const tabLabels = [];
  const buttons = regions.map((_, index) => {
    const button = createButton("workspace-tour-tab");
    const label = document.createElement("span");
    tabLabels.push(label);
    button.id = `workspace-tour-tab-${index}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    button.append(label);
    button.addEventListener("click", () => select(index));
    tabs.append(button);
    return button;
  });

  const copy = document.createElement("div");
  copy.className = "workspace-tour-copy";
  copy.setAttribute("aria-live", "polite");
  copy.setAttribute("aria-atomic", "true");
  const heading = document.createElement("h3");
  const description = document.createElement("p");
  const link = document.createElement("a");
  link.className = "workspace-tour-guide";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const linkText = document.createElement("span");
  link.append(linkText, createArrow());
  copy.append(heading, description);
  panel.append(copy, link);
  tour.append(tabs, panel);
  frame.after(tour);
  const zoom = mountPreviewZoom(locale);

  function render() {
    const language = tourCopy[locale];
    const step = language.steps[selected];
    const region = regions[selected];
    tabs.setAttribute("aria-label", language.label);
    buttons.forEach((button, index) => {
      button.setAttribute("aria-selected", String(index === selected));
      button.tabIndex = index === selected ? 0 : -1;
      tabLabels[index].textContent = language.steps[index].tab;
    });
    panel.setAttribute("aria-labelledby", buttons[selected].id);
    heading.textContent = step.title;
    description.textContent = step.body;
    linkText.textContent = language.documentation;
    link.href = `https://github.com/EVEDensity/Canary/blob/main/docs/guides/${region.guide}.md`;
    outline.style.left = `${region.x}%`;
    outline.style.top = `${region.y}%`;
    outline.style.width = `${region.width}%`;
    outline.style.height = `${region.height}%`;
    outline.classList.toggle("is-active", highlighted);
    zoom?.setLocale(locale);
  }

  function select(index, focus = false) {
    selected = index;
    highlighted = true;
    render();
    if (focus) {
      buttons[selected].focus({ preventScroll: true });
      const bounds = buttons[selected].getBoundingClientRect();
      const tabBounds = tabs.getBoundingClientRect();
      if (bounds.left < tabBounds.left || bounds.right > tabBounds.right) {
        tabs.scrollTo({
          left: bounds.left - tabBounds.left + tabs.scrollLeft - (tabs.clientWidth - bounds.width) / 2,
          behavior: "auto",
        });
      }
    }
  }

  tabs.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let index;
    if (event.key === "ArrowRight") index = (selected + 1) % buttons.length;
    else if (event.key === "ArrowLeft") index = (selected + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = buttons.length - 1;
    else return;
    event.preventDefault();
    select(index, true);
  });

  render();
  return {
    setLocale(next) {
      locale = Object.hasOwn(tourCopy, next) ? next : "en";
      render();
    },
  };
}
