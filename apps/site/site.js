import { mountChapters } from "./chapters.js";
import { arrive, move, signalBetween } from "./motion.js";
import { mountPlayground } from "./playground.js";
import { mountWorkspaceTour } from "./workspace-tour.js";

const messages = {
  en: {
    skip: "Skip to content",
    navHow: "How it works",
    navDemo: "Try a fix",
    navWorkspace: "The workspace",
    navWhy: "Why Canary",
    navStart: "Get started",
    release: "Open source · An earlier signal",
    heroLine1: "See the issue",
    heroLine2: "Verify the fix",
    heroDescription: "Run checks. Locate failures. Verify repairs.",
    heroTry: "Try the example",
    getStarted: "Get started",
    viewGithub: "View on GitHub",
    heroMeta: "Your project · Your evidence",
    signalMap: "FOLLOW ONE FAILURE",
    sample: "Interactive example",
    mapCaption: "Connected by context",
    viewSettings: "View settings",
    layerTests: "Evidence",
    layerLogic: "Application",
    layerInterface: "Interface",
    detect: "Detect",
    locate: "Locate",
    verify: "Verify",
    demoHint: "Select a file to follow its connections.",
    tryExample: "Try the fix yourself",
    mapView: "Map perspective",
    followSignal: "Follow the signal",
    pauseSignal: "Pause walkthrough",
    nodeSelected: "Selected node",
    sourcePreview: "SOURCE PREVIEW",
    nodeDescriptions: {
      cart: "The interface submits a cart to the API. Follow its dependency into the checkout logic.",
      api: "The request handler delegates the cart total to checkout.ts. It connects the interface and application layers.",
      checkout: "The total omits the discount. cart.test.ts records the failing assertion at line 18.",
      pricing: "The pricing helper supplies the discount. The value exists, but checkout.ts does not subtract it.",
      test: "The fixed example asserts a total of 100 and receives 110. Follow the failing call into checkout.ts.",
      manifest: "The manifest ties the original check, source snapshot and content hash to the same recorded run.",
    },
    stripLabel: "One entry point for your project checks",
    workflowEyebrow: "THE CONNECTED WORKFLOW",
    workflowTitle: "From first signal to verified fix",
    feature1Title: "Existing checks",
    feature1Body: "Build, types, lint and tests",
    feature2Title: "Code in context",
    feature2Body: "Architecture, source and coverage",
    feature3Title: "Traceable evidence",
    feature3Body: "Original errors, hashes and history",
    feature4Title: "Verified reruns",
    feature4Body: "Before, after and what changed",
    failed: "Failed",
    rerun: "Rerun",
    passed: "Passed",
    workspaceEyebrow: "01 / YOUR PROJECT, IN FOCUS",
    workspaceTitle: "Your project, in focus",
    workspaceDescription: "Checks, architecture and evidence in one workspace",
    viewCloser: "Take a closer look",
    note1: "Actual product interface",
    note2: "Reports: JSON · JUnit · Markdown",
    note3: "Coverage follows your collected scope",
    whyBody:
      "Named after the little bird that warned miners early. Built to help software teams catch problems sooner.",
    startEyebrow: "03 / MAKE YOUR NEXT CHECK COUNT",
    startTitle: "Your next signal",
    startDescription: "Install once. Run your checks.",
    exploreGithub: "Explore the project on GitHub",
    installLabel: "Install once",
    runLabel: "New terminal. Enter your project. Run checks.",
    reportLabel: "Or run with the interactive report",
    prerequisites: "Node.js 24 & Git. Project dependencies ready.",
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
    footerTagline: "Early signals · Clearer software",
    docs: "Documentation",
    contribute: "Contribute",
    footerCredit: "Open source · Made for developers",
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
        title: "Back to green, evidence kept",
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
    navDemo: "修复演示",
    navWorkspace: "验证工作台",
    navWhy: "为什么叫 Canary",
    navStart: "开始使用",
    release: "开源，让问题更早被看见",
    heroLine1: "看清问题",
    heroLine2: "验证修复",
    heroDescription: "运行检查，定位错误，验证修复",
    heroTry: "体验修复示例",
    getStarted: "开始使用",
    viewGithub: "查看 GitHub",
    heroMeta: "你的项目 · 你的证据",
    signalMap: "跟随一个失败，理解整个过程",
    sample: "交互示例",
    mapCaption: "用上下文串起问题",
    viewSettings: "视图设置",
    layerTests: "测试证据",
    layerLogic: "应用逻辑",
    layerInterface: "项目界面",
    detect: "发现问题",
    locate: "定位源码",
    verify: "验证重跑",
    demoHint: "选择文件，查看它的关联。",
    tryExample: "亲手试一次修复",
    mapView: "地图视角",
    followSignal: "跟随问题线索",
    pauseSignal: "暂停导览",
    nodeSelected: "已选择节点",
    sourcePreview: "源码预览",
    nodeDescriptions: {
      cart: "界面将购物车提交到 API，可以沿依赖关系进入结算逻辑。",
      api: "请求处理器把金额计算交给 checkout.ts，连接界面与应用逻辑。",
      checkout: "金额计算遗漏了折扣，cart.test.ts 的第 18 行保留了失败断言。",
      pricing: "价格辅助函数提供折扣值，但 checkout.ts 没有将它从金额中减去。",
      test: "固定示例断言预期金额为 100，实际得到 110。沿失败调用进入 checkout.ts。",
      manifest: "Manifest 将原始检查、源码快照和内容哈希关联到同一次运行。",
    },
    stripLabel: "一个入口，运行项目已有检查",
    workflowEyebrow: "连贯的验证流程",
    workflowTitle: "从问题信号到修复验证",
    feature1Title: "已有项目检查",
    feature1Body: "构建、类型、lint 与测试",
    feature2Title: "源码与上下文",
    feature2Body: "架构、代码位置与覆盖数据",
    feature3Title: "可追溯的证据",
    feature3Body: "原始错误、哈希与运行历史",
    feature4Title: "关联重跑验证",
    feature4Body: "修复前后，变化一目了然",
    failed: "失败",
    rerun: "重跑",
    passed: "通过",
    workspaceEyebrow: "01 / 聚焦你的项目",
    workspaceTitle: "看清项目中的每个问题",
    workspaceDescription: "检查、架构与证据，一处掌握",
    viewCloser: "放大查看",
    note1: "真实产品界面",
    note2: "报告：JSON · JUnit · Markdown",
    note3: "覆盖指标来自实际采集范围",
    whyBody: "名字来自提前预警的金丝雀。我们希望帮助开发者更早发现问题，让修复有据可查。",
    startEyebrow: "03 / 从下一次检查开始",
    startTitle: "从下一次检查开始",
    startDescription: "安装一次，即可运行项目检查",
    exploreGithub: "在 GitHub 探索项目",
    installLabel: "安装一次",
    runLabel: "新开终端，进入项目，运行检查",
    reportLabel: "或运行检查并打开交互式报告",
    prerequisites: "需要 Node.js 24、Git 及项目依赖。",
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
    footerTagline: "更早的信号，更清晰的软件",
    docs: "使用文档",
    contribute: "参与贡献",
    footerCredit: "开源，为开发者而作",
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
let inspectedNode = null;
let walkthroughTimer;
let walkthroughRunning = false;
const nodeMetadata = {
  cart: { file: "cart.tsx:32", line: "32", code: "submitCart(cart);", neighbors: ["api"] },
  api: { file: "api.ts:16", line: "16", code: "return checkout(cart);", neighbors: ["cart", "checkout"] },
  checkout: {
    file: "checkout.ts:24",
    line: "24",
    code: "return subtotal + shipping;",
    neighbors: ["api", "pricing", "test"],
  },
  pricing: { file: "pricing.ts:8", line: "8", code: "return cart.discount;", neighbors: ["checkout"] },
  test: {
    file: "cart.test.ts:18",
    line: "18",
    code: "expect(checkout(cart)).toBe(100);",
    neighbors: ["checkout", "manifest"],
  },
  manifest: { file: "manifest.json", line: "—", code: '"parentRunId": "example-failed-run"', neighbors: ["test"] },
};

function updateWalkthrough() {
  get("#walkthrough-label").textContent = messages[locale][walkthroughRunning ? "pauseSignal" : "followSignal"];
  get("#play-walkthrough").setAttribute("aria-pressed", String(walkthroughRunning));
  get(".walkthrough-icon use").setAttribute("href", walkthroughRunning ? "#icon-pause" : "#icon-play");
}

function stopWalkthrough() {
  clearTimeout(walkthroughTimer);
  walkthroughRunning = false;
  updateWalkthrough();
}

function renderDemo(animate = false) {
  const selected = inspectedNode ?? { detect: "test", locate: "checkout", verify: "manifest" }[stage];
  const node = nodeMetadata[selected];
  const data = inspectedNode
    ? {
        title: `${messages[locale].nodeSelected} · ${node.file.split(":")[0]}`,
        detail: node.neighbors.map((id) => nodeMetadata[id].file.split(":")[0]).join(" ↔ "),
        status: messages[locale].sourcePreview,
        file: node.file,
        message: messages[locale].nodeDescriptions[selected],
        line: node.line,
        code: node.code,
      }
    : messages[locale].stages[stage];
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
  get("#callout-icon").textContent = inspectedNode ? "↗" : stage === "verify" ? "✓" : stage === "locate" ? "↗" : "!";
  all("[data-map-node]").forEach((button) => {
    const id = button.dataset.mapNode;
    button.setAttribute("aria-pressed", String(id === selected));
    button.classList.toggle("is-related", node.neighbors.includes(id));
    button.classList.toggle("is-muted", id !== selected && !node.neighbors.includes(id));
  });
  demo.style.setProperty("--stage-index", String(["detect", "locate", "verify"].indexOf(stage)));
  if (animate) {
    arrive(get(".signal-callout"), { duration: 180 });
    arrive(get(".demo-evidence"), { duration: 220, delay: 100 });
    signalBetween(get(".map-scene"), [
      get(`[data-map-node="${selected}"]`),
      ...node.neighbors.map((id) => get(`[data-map-node="${id}"]`)),
    ]);
  }
}

function setStage(next, manual = true) {
  if (!Object.hasOwn(messages.en.stages, next)) return;
  if (manual) stopWalkthrough();
  inspectedNode = null;
  stage = next;
  demo.dataset.stage = stage;
  renderDemo(manual || walkthroughRunning);
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
  get("#how-it-works").setAttribute(
    "aria-label",
    locale === "en" ? "Connected verification workflow" : "连贯的验证流程",
  );
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
  for (const button of all("[data-copy]")) button.setAttribute("aria-label", text[`${button.dataset.copy}Aria`]);
  renderDemo();
  updateWalkthrough();
  get(".map-view-controls").setAttribute("aria-label", text.mapView);
  playground.setLocale(locale);
  workspaceTour.setLocale(locale);
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
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
function selectNode(id) {
  stopWalkthrough();
  setStage(id === "test" || id === "manifest" ? "detect" : "locate", false);
  inspectedNode = id;
  renderDemo(true);
}
all("[data-map-node]").forEach((button) =>
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(button.dataset.mapNode);
  }),
);
for (const [selector, selection] of [
  [".plane-top", "cart"],
  [".plane-middle", "checkout"],
  [".plane-base", "test"],
]) {
  const plane = get(selector);
  const label = plane.querySelector(".plane-label");
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${label.className} plane-select`;
  button.replaceChildren(...label.childNodes);
  label.replaceWith(button);
  plane.addEventListener("click", () => selectNode(selection));
}
all("[data-map-view]").forEach((button) =>
  button.addEventListener("click", () => {
    demo.dataset.view = button.dataset.mapView;
    all("[data-map-view]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  }),
);
get("#play-walkthrough").addEventListener("click", () => {
  if (walkthroughRunning) return stopWalkthrough();
  walkthroughRunning = true;
  setStage("detect", false);
  updateWalkthrough();
  const steps = ["locate", "verify"];
  const advance = () => {
    const next = steps.shift();
    if (!next) return stopWalkthrough();
    setStage(next, false);
    walkthroughTimer = setTimeout(advance, 2800);
  };
  walkthroughTimer = setTimeout(advance, 2800);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopWalkthrough();
});

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
      button.classList.add("is-copied");
      setTimeout(() => {
        button.querySelector("use").setAttribute("href", "#icon-copy");
        button.classList.remove("is-copied");
      }, 1800);
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
  if (event.key === "Escape") {
    closeMenu();
    const options = get(".map-options");
    if (options.open) {
      const focusInOptions = options.contains(document.activeElement);
      options.open = false;
      if (focusInOptions) options.querySelector("summary").focus();
    }
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".site-header")) closeMenu();
  if (!event.target.closest(".map-options")) get(".map-options").open = false;
});

matchMedia("(min-width: 761px)").addEventListener("change", (event) => {
  if (event.matches) closeMenu();
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
  all("#playground, #workspace, #get-started").forEach((section) => observer.observe(section));
}
const scene = get(".map-scene");
let animationFrame;
scene.addEventListener("pointermove", (event) => {
  if (
    reducedMotion.matches ||
    innerWidth < 760 ||
    event.pointerType !== "mouse" ||
    !matchMedia("(hover: hover) and (pointer: fine)").matches
  )
    return;
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(() => {
    const bounds = scene.getBoundingClientRect();
    scene.style.setProperty(
      "--lean-x",
      `${((event.clientY - bounds.top - bounds.height / 2) / bounds.height) * -6}deg`,
    );
    scene.style.setProperty("--lean-y", `${((event.clientX - bounds.left - bounds.width / 2) / bounds.width) * 6}deg`);
  });
});
scene.addEventListener("pointerleave", () => {
  cancelAnimationFrame(animationFrame);
  scene.style.setProperty("--lean-x", "0deg");
  scene.style.setProperty("--lean-y", "0deg");
});
const playground = mountPlayground(get("#playground"), locale);
const workspaceTour = mountWorkspaceTour(get(".workspace-frame"), locale);
setOs(os);
setStage("detect", false);
setLocale(locale);

// First arrival is finite and does not replay on language changes.
all(".hero-copy > *").forEach((element, index) => arrive(element, { duration: 440, delay: index * 80 }));
all(".map-scene .plane").forEach((element, index) =>
  move(
    element,
    [
      { opacity: 0, translate: "0 16px" },
      { opacity: 1, translate: "0 0" },
    ],
    { duration: 500, delay: 200 + index * 90 },
  ),
);
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    document.documentElement.classList.remove("js-motion");
    scene.style.setProperty("--lean-x", "0deg");
    scene.style.setProperty("--lean-y", "0deg");
    stopWalkthrough();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopWalkthrough();
});

mountChapters();
