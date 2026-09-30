const messages = {
  en: {
    skip: "Skip to content",
    navHow: "How it works",
    navWorkspace: "The workspace",
    navWhy: "Why Canary",
    navStart: "Get started",
    release: "Open source. Built for the early signal.",
    heroLine1: "See the signal.",
    heroLine2: "Before the noise.",
    heroDescription: "Your checks, architecture, and failure evidence. Finally connected.",
    getStarted: "Get started",
    viewGithub: "View on GitHub",
    heroMeta: "Your project. Your evidence.",
    signalMap: "THE SIGNAL MAP",
    sample: "Interactive example",
    layerTests: "TESTS & EVIDENCE",
    layerLogic: "APPLICATION LOGIC",
    layerInterface: "PROJECT INTERFACE",
    detect: "Detect",
    locate: "Locate",
    verify: "Verify",
    demoHint: "Follow a signal. Click the layers or step through above.",
    stripLabel: "One entry point for your project checks",
    workflowEyebrow: "01 / A SHORTER PATH TO CLARITY",
    workflowTitle: "Less searching.\nMore understanding.",
    workflowDescription: "The result is only the beginning. Get the context you need to decide what happens next.",
    feature1Title: "Your checks. One command.",
    feature1Body:
      "Discover existing builds, type checks, lint and tests. Run them together, without creating a Canary configuration.",
    feature2Title: "Find the place. Not just the log.",
    feature2Body:
      "Explore your project in 2D or layered 3D. Follow mapped failures and collected coverage into the relevant source.",
    feature3Title: "Keep the thread of every fix.",
    feature3Body:
      "Rerun a check, compare results, and keep the original evidence. Content hashes and run lineage connect the story.",
    failed: "Failed",
    rerun: "Rerun",
    passed: "Passed",
    workspaceEyebrow: "02 / THE VERIFICATION WORKSPACE",
    workspaceTitle: "The whole picture.\nThe exact detail.",
    workspaceDescription: "A clear overview when you need perspective. Source and evidence when you need answers.",
    viewCloser: "Take a closer look",
    note1: "Actual product interface",
    note2: "Reports: JSON · JUnit · Markdown",
    note3: "Coverage follows your collected scope",
    whyEyebrow: "03 / SMALL SIGNALS MATTER",
    whyTitle: "A little bird.\nA better heads-up.",
    whyBody: "Canaries once gave miners an early warning of danger. We believe software deserves an early signal, too.",
    whyBody2: "Check sooner. Make problems visible. Keep the evidence that helps you move forward.",
    whySignoff: "Catch problems early. Fix with evidence.",
    startEyebrow: "04 / YOUR NEXT RUN STARTS HERE",
    startTitle: "Bring clarity\nto your next check.",
    startDescription: "Install Canary. Open your project. Follow the signal.",
    exploreGithub: "Explore the project on GitHub",
    installLabel: "Install once",
    runLabel: "New terminal. Enter your project. Run checks.",
    reportLabel: "Or run with the interactive report",
    prerequisites: "Node.js 22+ & Git. Project dependencies ready.",
    installGuide: "Installation guide",
    faqEyebrow: "A FEW GOOD QUESTIONS",
    faq1Question: "Do I need to change my existing CI?",
    faq1Answer:
      "Keep your existing workflows. Canary runs project checks through a CLI with stable exit codes and standard reports. Use it before a commit or invoke it in your current CI pipeline.",
    faq2Question: "Does running checks require an AI model?",
    faq2Answer:
      "No model is required for automatic project checks. Agent evaluations and model-based evaluators use the adapters and credentials you explicitly configure.",
    faq3Question: "What does automatic discovery actually run?",
    faq3Answer:
      "Canary reads existing Node scripts and standard Python, Go and Rust test entry points. Node/Python automatic execution has recorded verification. It runs your existing checks; it does not create tests or automatically collect coverage for every project. Existing Canary configuration takes priority.",
    faq4Question: "Where do my reports live?",
    faq4Answer:
      "Run artifacts are stored in your project's .canary directory. Manifests, content hashes and lineage help connect results to the run that produced them. Review and redact evidence before sharing it.",
    footerTagline: "Early signals. Clearer software.",
    docs: "Documentation",
    contribute: "Contribute",
    footerCredit: "Open source. Made for developers.",
    previewTitle: "Inside the Canary workspace",
    previewCaption: "A recorded product screenshot. Run Canary to explore your own project.",
    copied: "Command copied",
    copyFallback: "Copy this command with Ctrl+C or ⌘C",
    menuOpen: "Open navigation",
    menuClose: "Close navigation",
    imageAlt: "Canary's real verification workspace showing check results, project structure, and run history",
    imageOpen: "Enlarge the Canary workspace screenshot",
    imageClose: "Close preview",
    inspect: "Inspect checkout.ts failure",
    mapLabel: "Interactive example: project layers",
    workflowLabel: "Example workflow",
    evidenceLabel: "Example evidence",
    installAria: "Copy installation command",
    ciAria: "Copy CI command",
    reportAria: "Copy report command",
    documentTitle: "Canary — Catch problems early. Fix with evidence.",
    description:
      "Catch problems early. Run project checks, explore architecture, and connect failures to source code and traceable evidence with Canary.",
    stages: {
      detect: {
        title: "One check needs attention",
        detail: "cart.test.ts → checkout.ts",
        status: "ASSERTION FAILED",
        file: "cart.test.ts:18",
        message: "Expected 100. Received 110. The discount was never applied.",
        line: "24",
        code: "return subtotal + shipping;",
      },
      locate: {
        title: "Follow the signal to its source",
        detail: "checkout.ts:24 · cart.test.ts",
        status: "SOURCE LOCATION",
        file: "checkout.ts:24",
        message: "The failing assertion points here. The return value omits the discount.",
        line: "24",
        code: "return subtotal + shipping;",
      },
      verify: {
        title: "Back to green. Evidence kept.",
        detail: "failed run → linked rerun",
        status: "REGRESSION PASSED",
        file: "cart.test.ts:18",
        message: "Same check, new run. Expected 100, received 100. Original failure retained.",
        line: "24",
        code: "return subtotal + shipping - discount;",
      },
    },
  },
  "zh-CN": {
    skip: "跳转至正文",
    navHow: "工作流程",
    navWorkspace: "验证工作台",
    navWhy: "为什么叫 Canary",
    navStart: "开始使用",
    release: "开源，让问题更早被看见。",
    heroLine1: "先看见信号。",
    heroLine2: "再屏蔽噪声。",
    heroDescription: "项目检查、架构与失败证据，终于连成一条清晰的线。",
    getStarted: "开始使用",
    viewGithub: "查看 GitHub",
    heroMeta: "你的项目，你的证据。",
    signalMap: "项目的信号地图",
    sample: "交互示例",
    layerTests: "测试与证据层",
    layerLogic: "应用逻辑层",
    layerInterface: "项目界面层",
    detect: "发现问题",
    locate: "定位源码",
    verify: "验证重跑",
    demoHint: "点击架构层，或切换上方步骤，跟随一条问题线索。",
    stripLabel: "一个入口，运行项目已有检查",
    workflowEyebrow: "01 / 更短的问题定位路径",
    workflowTitle: "少一点寻找。\n多一点理解。",
    workflowDescription: "结果只是起点。把上下文连接起来，让下一步行动更明确。",
    feature1Title: "已有检查，一行运行。",
    feature1Body: "自动识别构建、类型检查、lint 和测试，把已有命令一起运行，无需创建 Canary 配置。",
    feature2Title: "找到现场，读懂错误。",
    feature2Body: "用二维或三维分层视图探索项目，从已映射的失败与已采集的覆盖数据进入相关源码。",
    feature3Title: "每次修复，都有来路。",
    feature3Body: "关联重跑、比较结果、保留原始证据。用内容哈希和运行谱系，连起问题处理的全过程。",
    failed: "失败",
    rerun: "重跑",
    passed: "通过",
    workspaceEyebrow: "02 / 项目验证工作台",
    workspaceTitle: "看清全貌。\n也看清细节。",
    workspaceDescription: "需要全局时，查看清晰概览。需要答案时，深入源码和错误证据。",
    viewCloser: "放大查看",
    note1: "真实产品界面",
    note2: "报告：JSON · JUnit · Markdown",
    note3: "覆盖指标来自实际采集范围",
    whyEyebrow: "03 / 小信号，也很重要",
    whyTitle: "一只小鸟。\n更早的提醒。",
    whyBody: "矿井中的金丝雀，曾为矿工发出危险的早期预警。我们相信，软件也值得拥有自己的早期信号。",
    whyBody2: "更早运行检查，让问题清晰可见，保留帮助你继续前进的验证证据。",
    whySignoff: "早发现，早检测，让修复有据可查。",
    startEyebrow: "04 / 从下一次检查开始",
    startTitle: "让下一次检查，\n更加清晰。",
    startDescription: "安装 Canary，进入项目，跟随问题线索。",
    exploreGithub: "在 GitHub 探索项目",
    installLabel: "安装一次",
    runLabel: "新开终端，进入项目，运行检查",
    reportLabel: "或运行检查并打开交互式报告",
    prerequisites: "需要 Node.js 22+、Git 及项目依赖。",
    installGuide: "安装指南",
    faqEyebrow: "几个你可能关心的问题",
    faq1Question: "需要修改现有的 CI 吗？",
    faq1Answer:
      "继续使用现有工作流即可。Canary 通过 CLI 执行项目检查，输出稳定的退出码和标准报告。可以在提交前运行，也可以接入当前的 CI 流水线。",
    faq2Question: "运行检查需要调用 AI 模型吗？",
    faq2Answer: "自动项目检查不需要模型。Agent 评估和模型评分器使用你明确配置的适配器和凭据。",
    faq3Question: "自动检测具体会执行什么？",
    faq3Answer:
      "Canary 读取已有 Node 脚本以及 Python、Go、Rust 的标准测试入口。Node/Python 自动执行已有真实验收记录。自动检查执行项目已有验证步骤，不生成测试，也不会自动为所有项目采集覆盖率。已有 Canary 配置优先。",
    faq4Question: "生成的报告保存在什么地方？",
    faq4Answer:
      "运行产物保存在项目的 .canary 目录中。Manifest、内容哈希和运行谱系将结果关联到对应运行。分享证据前，应检查内容并完成脱敏。",
    footerTagline: "更早的信号，更清晰的软件。",
    docs: "使用文档",
    contribute: "参与贡献",
    footerCredit: "开源，为开发者而作。",
    previewTitle: "走进 Canary 验证工作台",
    previewCaption: "已记录的产品界面截图。运行 Canary，探索你自己的项目。",
    copied: "命令已复制",
    copyFallback: "使用 Ctrl+C 或 ⌘C 复制此命令",
    menuOpen: "打开导航",
    menuClose: "关闭导航",
    imageAlt: "Canary 真实验证工作台，展示检查结果、项目结构和运行历史",
    imageOpen: "放大 Canary 工作台截图",
    imageClose: "关闭预览",
    inspect: "查看 checkout.ts 的失败证据",
    mapLabel: "交互示例：项目架构层级",
    workflowLabel: "示例工作流程",
    evidenceLabel: "示例错误证据",
    installAria: "复制安装命令",
    ciAria: "复制 CI 命令",
    reportAria: "复制报告命令",
    documentTitle: "Canary — 早发现，早检测，让修复有据可查。",
    description: "运行项目检查，探索交互式架构地图，将失败关联到源码和可追溯证据。Canary 让项目验证更加清晰。",
    stages: {
      detect: {
        title: "一项检查需要关注",
        detail: "cart.test.ts → checkout.ts",
        status: "断言失败",
        file: "cart.test.ts:18",
        message: "预期 100，实际 110。折扣没有计入最终金额。",
        line: "24",
        code: "return subtotal + shipping;",
      },
      locate: {
        title: "沿着线索，进入源码",
        detail: "checkout.ts:24 · cart.test.ts",
        status: "源码定位",
        file: "checkout.ts:24",
        message: "失败断言指向这一行，返回值遗漏了折扣。",
        line: "24",
        code: "return subtotal + shipping;",
      },
      verify: {
        title: "重跑通过，原始证据保留",
        detail: "原失败运行 → 关联重跑",
        status: "回归检查通过",
        file: "cart.test.ts:18",
        message: "同一检查，新一次运行。预期与实际均为 100，原始失败继续保留。",
        line: "24",
        code: "return subtotal + shipping - discount;",
      },
    },
  },
};

const get = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const languageButton = get("#language-toggle");
const demo = get("#signal-demo");
let stage = "detect";
const requested = new URLSearchParams(location.search).get("lang");
let saved;
try {
  saved = localStorage.getItem("canary.site.locale");
} catch {
  /* Explicit language selection still works when storage is restricted. */
}
let locale = Object.hasOwn(messages, requested ?? saved ?? "en") ? (requested ?? saved ?? "en") : "en";
let os = /Windows/i.test(navigator.userAgent) ? "windows" : "unix";
const installCommands = {
  unix: "curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/scripts/install/install.sh | bash",
  windows: "iwr -useb https://raw.githubusercontent.com/EVEDensity/Canary/main/scripts/install/install.ps1 | iex",
};
let toastTimeout;

function setStage(next) {
  if (!Object.hasOwn(messages.en.stages, next)) return;
  stage = next;
  demo.dataset.stage = stage;
  const data = messages[locale].stages[stage];
  for (const [id, field] of [
    ["signal-title", "title"],
    ["signal-detail", "detail"],
    ["evidence-status", "status"],
    ["evidence-file", "file"],
    ["evidence-message", "message"],
    ["source-number", "line"],
    ["source-code", "code"],
  ])
    get(`#${id}`).textContent = data[field];
  get("#callout-icon").textContent = stage === "verify" ? "✓" : stage === "locate" ? "↗" : "!";
  all(".demo-controls button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.stage === stage));
    button.tabIndex = button.dataset.stage === stage ? 0 : -1;
    button.setAttribute("aria-controls", "demo-evidence");
  });
}

function setLocale(next, persist = false) {
  if (!Object.hasOwn(messages, next)) return;
  locale = next;
  const text = messages[locale];
  document.documentElement.lang = locale;
  document.title = text.documentTitle;
  get('meta[name="description"]').content = text.description;
  get('meta[property="og:title"]').content = text.documentTitle;
  get('meta[property="og:description"]').content = text.description;
  for (const element of all("[data-i18n]")) {
    const value = text[element.dataset.i18n];
    if (typeof value !== "string") continue;
    const lines = value.split("\n");
    element.replaceChildren(
      ...lines.flatMap((line, i) =>
        i ? [document.createElement("br"), document.createTextNode(line)] : [document.createTextNode(line)],
      ),
    );
  }
  languageButton.textContent = locale === "en" ? "中文" : "EN";
  languageButton.setAttribute("aria-label", locale === "en" ? "切换为简体中文" : "Switch to English");
  get("#menu-toggle").setAttribute(
    "aria-label",
    get("#menu-toggle").getAttribute("aria-expanded") === "true" ? text.menuClose : text.menuOpen,
  );
  get("#issue-node").setAttribute("aria-label", text.inspect);
  get(".map-scene").setAttribute("aria-label", text.mapLabel);
  get(".demo-controls").setAttribute("aria-label", text.workflowLabel);
  get(".demo-evidence").setAttribute("aria-label", text.evidenceLabel);
  get("#screenshot-open").setAttribute("aria-label", text.imageOpen);
  get("#close-preview").setAttribute("aria-label", text.imageClose);
  get(".install-tabs").setAttribute("aria-label", locale === "en" ? "Operating system" : "操作系统");
  get(".install-body").setAttribute("aria-label", locale === "en" ? "Installation commands" : "安装命令");
  get(".desktop-nav").setAttribute("aria-label", locale === "en" ? "Main navigation" : "主导航");
  get("#mobile-nav").setAttribute("aria-label", locale === "en" ? "Mobile navigation" : "移动端导航");
  get(".site-footer nav").setAttribute("aria-label", locale === "en" ? "Footer navigation" : "页脚导航");
  get(".install-foot a").href =
    locale === "en"
      ? "https://github.com/EVEDensity/Canary/blob/main/README.md#quick-start"
      : "https://github.com/EVEDensity/Canary/blob/main/docs/guides/automatic-checks.md";
  all(".brand").forEach((element) =>
    element.setAttribute("aria-label", locale === "en" ? "Canary home" : "Canary 首页"),
  );
  const image = `assets/dashboard-${locale === "en" ? "en" : "zh-CN"}.jpg`;
  for (const element of [get("#workspace-image"), get("#dialog-image")]) {
    if (!element.getAttribute("src").endsWith(image)) element.src = image;
    element.alt = text.imageAlt;
  }
  get(".art-caption").textContent = locale === "en" ? "a small bird. an early signal." : "一只小鸟，一条早期信号。";
  for (const button of all("[data-copy]")) button.setAttribute("aria-label", text[`${button.dataset.copy}Aria`]);
  setStage(stage);
  if (persist) {
    try {
      localStorage.setItem("canary.site.locale", locale);
    } catch {
      /* Switching still works without persistence. */
    }
    const url = new URL(location.href);
    url.searchParams.set("lang", locale);
    history.replaceState(null, "", url);
  }
}

function setOs(next) {
  os = next === "windows" ? "windows" : "unix";
  get("#install-command").textContent = installCommands[os];
  for (const button of all("[data-os]")) {
    button.setAttribute("aria-selected", String(button.dataset.os === os));
    button.tabIndex = button.dataset.os === os ? 0 : -1;
    button.setAttribute("aria-controls", "install-panel");
  }
}

function keyboardTabs(container, select, property) {
  container.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...container.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    select(buttons[next].dataset[property]);
    buttons[next].focus();
  });
}

function showToast(message) {
  clearTimeout(toastTimeout);
  get("#toast").textContent = message;
  get("#toast").classList.add("visible");
  toastTimeout = setTimeout(() => get("#toast").classList.remove("visible"), 2800);
}

languageButton.addEventListener("click", () => setLocale(locale === "en" ? "zh-CN" : "en", true));
get(".demo-evidence").id = "demo-evidence";
get(".install-body").id = "install-panel";
all(".demo-controls button").forEach((button) =>
  button.addEventListener("click", () => setStage(button.dataset.stage)),
);
keyboardTabs(get(".demo-controls"), setStage, "stage");
all("[data-os]").forEach((button) => button.addEventListener("click", () => setOs(button.dataset.os)));
keyboardTabs(get(".install-tabs"), setOs, "os");
get("#issue-node").addEventListener("click", (event) => {
  event.stopPropagation();
  setStage("locate");
});
for (const [selector, selection] of [
  [".plane-top", "detect"],
  [".plane-middle", "locate"],
  [".plane-base", "verify"],
]) {
  const plane = get(selector);
  const label = plane.querySelector(".plane-label");
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${label.className} plane-select`;
  button.replaceChildren(...label.childNodes);
  label.replaceWith(button);
  plane.addEventListener("click", () => setStage(selection));
}

all("[data-copy]").forEach((button) =>
  button.addEventListener("click", async () => {
    const command =
      button.dataset.copy === "install"
        ? installCommands[os]
        : button.dataset.copy === "ci"
          ? "canary run --ci"
          : "canary run --port 4318";
    try {
      await navigator.clipboard.writeText(command);
      button.querySelector("use").setAttribute("href", "#icon-check");
      showToast(messages[locale].copied);
      setTimeout(() => button.querySelector("use").setAttribute("href", "#icon-copy"), 1800);
    } catch {
      const code = button.closest(".command-row").querySelector("code");
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      showToast(messages[locale].copyFallback);
    }
  }),
);

const menu = get("#menu-toggle");
function closeMenu() {
  const focusInMenu = get("#mobile-nav").contains(document.activeElement);
  menu.setAttribute("aria-expanded", "false");
  get("#mobile-nav").hidden = true;
  menu.setAttribute("aria-label", messages[locale].menuOpen);
  if (focusInMenu) menu.focus();
}
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  get("#mobile-nav").hidden = !open;
  menu.setAttribute("aria-label", messages[locale][open ? "menuClose" : "menuOpen"]);
});
all("#mobile-nav a").forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".site-header")) closeMenu();
});

const dialog = get("#preview-dialog");
const openPreview = () => {
  dialog.showModal();
  document.body.style.overflow = "hidden";
};
get("#expand-preview").addEventListener("click", openPreview);
get("#screenshot-open").addEventListener("click", openPreview);
get("#close-preview").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  document.body.style.overflow = "";
});
dialog.addEventListener("click", (event) => {
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
all(".faq details").forEach((detail) =>
  detail.addEventListener("toggle", () => {
    if (detail.open)
      all(".faq details")
        .filter((other) => other !== detail)
        .forEach((other) => {
          other.open = false;
        });
  }),
);

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  document.documentElement.classList.add("js-motion");
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }),
    { rootMargin: "0px 0px -25px 0px", threshold: 0.07 },
  );
  all(".reveal").forEach((section) => observer.observe(section));
}
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.find((item) => item.isIntersecting);
      if (entry)
        all(".desktop-nav a").forEach((link) => link.classList.toggle("active", link.hash === `#${entry.target.id}`));
    },
    { rootMargin: "-20% 0px -55% 0px", threshold: 0 },
  );
  all("#how-it-works, #workspace, #why-canary").forEach((section) => observer.observe(section));
}
const scene = get(".map-scene");
let animationFrame;
scene.addEventListener("pointermove", (event) => {
  if (reducedMotion.matches || event.pointerType !== "mouse") return;
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(() => {
    const bounds = scene.getBoundingClientRect();
    scene.style.setProperty(
      "--lean-x",
      `${((event.clientY - bounds.top - bounds.height / 2) / bounds.height) * -5}deg`,
    );
    scene.style.setProperty("--lean-y", `${((event.clientX - bounds.left - bounds.width / 2) / bounds.width) * 5}deg`);
  });
});
scene.addEventListener("pointerleave", () => {
  cancelAnimationFrame(animationFrame);
  scene.style.setProperty("--lean-x", "0deg");
  scene.style.setProperty("--lean-y", "0deg");
});
setOs(os);
setLocale(locale);
