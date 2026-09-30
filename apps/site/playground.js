let instanceCount = 0;

const fixture = Object.freeze({ subtotal: 100, shipping: 10, discount: 10, expected: 100 });
const originalResult = Object.freeze({ id: "EXAMPLE-001", actual: 110, passed: false, variant: "original" });

const copy = {
  en: {
    eyebrow: "TRY THE VERIFICATION LOOP",
    title: "A failure is a starting point.",
    intro: "Choose a patch. Run the same assertion. See what changed, with the original evidence still in view.",
    example: "Interactive example",
    boundary: "A fixed checkout example runs in your browser. No project files or AI calls.",
    file: "checkout.ts",
    source: "Source",
    evidence: "Evidence",
    comparison: "Compare",
    tabs: "Example source and evidence",
    original: "Original code",
    patch: "Repair patch",
    choose: "Code version to verify",
    fixture: "Same input. Same assertion.",
    subtotal: "Subtotal",
    shipping: "Shipping",
    discount: "Discount",
    expected: "Expected total",
    missing: "The discount is missing from the return value.",
    patched: "The patch subtracts the discount. The assertion stays unchanged.",
    codeLabel: "Example source code",
    assertion: "The original assertion",
    stack: "Failure location",
    unchanged: "This assertion is identical before and after the patch.",
    run: "Run example check",
    running: "Running assertion…",
    reset: "Reset example",
    results: "Verification trail",
    before: "Original failure",
    after: "Your new run",
    failed: "Failed",
    passed: "Passed",
    pending: "Ready to verify",
    pendingBody: "Select a code version and run the example check.",
    actual: "Received",
    expectedShort: "Expected",
    ready: "Try the original. Then verify the repair.",
    checking: "Calculating the checkout total and checking the assertion.",
    success: "The repair passes the original assertion.",
    unchangedFail: "The same failure remains. Try the repair patch.",
    originalEvidence: "Original evidence retained",
    linked: "Rerun linked to EXAMPLE-001",
    viewCompare: "Inspect the comparison",
    runFirst: "Run a check to compare results.",
    compareHeading: "Before → after",
    codeChange: "Code change",
    checks: "Assertion",
    preserved: "Preserved",
    added: "Discount applied",
    same: "No code change",
    result: "Result",
    fixed: "110 → 100",
    notFixed: "110 → 110",
    conclusionPassed:
      "This example verifies the missing discount. One assertion does not prove every checkout behavior.",
    conclusionFailed: "The original code still returns 110. The evidence points to checkout.ts:24.",
    initialConclusion: "A comparison appears after you run the original code or the repair patch.",
    changeHint: "Choose “Repair patch” to reveal the change.",
    selectedOriginal: "Original code selected",
    selectedPatch: "Repair patch selected",
    resetAnnouncement: "Example reset. Original failure retained.",
    tabSourceAnnouncement: "Showing source code",
    tabEvidenceAnnouncement: "Showing original error evidence",
    tabComparisonAnnouncement: "Showing before and after comparison",
    runFinished: "Example check complete",
  },
  "zh-CN": {
    eyebrow: "亲手走完一次验证",
    title: "失败，是定位问题的起点。",
    intro: "选择补丁，运行同一条断言。保留原始证据，清楚查看修复前后的变化。",
    example: "交互示例",
    boundary: "在浏览器中运行固定结算示例，不读取项目文件，不调用 AI。",
    file: "checkout.ts",
    source: "源码",
    evidence: "错误证据",
    comparison: "前后比较",
    tabs: "示例源码与证据",
    original: "原始代码",
    patch: "修复补丁",
    choose: "选择要验证的代码版本",
    fixture: "相同输入，相同断言。",
    subtotal: "商品小计",
    shipping: "运费",
    discount: "优惠金额",
    expected: "预期总额",
    missing: "返回值遗漏了优惠金额。",
    patched: "补丁扣除了优惠金额，断言保持不变。",
    codeLabel: "示例源码",
    assertion: "原始断言",
    stack: "失败位置",
    unchanged: "这条断言在修复前后完全一致。",
    run: "运行示例检查",
    running: "正在运行断言…",
    reset: "重置示例",
    results: "验证轨迹",
    before: "原始失败",
    after: "本次重跑",
    failed: "失败",
    passed: "通过",
    pending: "等待验证",
    pendingBody: "选择代码版本，运行示例检查。",
    actual: "实际结果",
    expectedShort: "预期结果",
    ready: "先尝试原始代码，再验证修复补丁。",
    checking: "正在计算结算总额，并执行断言。",
    success: "修复补丁通过了原始断言。",
    unchangedFail: "同一问题仍然存在，试试修复补丁。",
    originalEvidence: "原始证据已保留",
    linked: "重跑关联 EXAMPLE-001",
    viewCompare: "查看前后比较",
    runFirst: "运行检查后即可比较结果。",
    compareHeading: "修复前 → 修复后",
    codeChange: "代码变化",
    checks: "验证断言",
    preserved: "保持不变",
    added: "已扣除优惠金额",
    same: "代码未修改",
    result: "检查结果",
    fixed: "110 → 100",
    notFixed: "110 → 110",
    conclusionPassed: "此示例验证了遗漏优惠金额的问题，一条断言并不能证明所有结算行为都正确。",
    conclusionFailed: "原始代码仍返回 110，错误证据指向 checkout.ts:24。",
    initialConclusion: "运行原始代码或修复补丁后，即可查看对照结果。",
    changeHint: "选择「修复补丁」查看代码变化。",
    selectedOriginal: "已选择原始代码",
    selectedPatch: "已选择修复补丁",
    resetAnnouncement: "示例已重置，原始失败证据仍然保留。",
    tabSourceAnnouncement: "正在展示源码",
    tabEvidenceAnnouncement: "正在展示原始错误证据",
    tabComparisonAnnouncement: "正在展示前后比较",
    runFinished: "示例检查已完成",
  },
};

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

function icon(name) {
  const paths = {
    play: '<path d="m9 5 11 7-11 7V5Z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    reset: '<path d="M3 11a9 9 0 1 1 3 7M3 4v7h7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    cross: '<path d="m7 7 10 10M17 7 7 17"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
}

/** Mount a browser-only deterministic example. Locale changes preserve the experiment. */
export function mountPlayground(container, initialLocale = "en") {
  if (!container) return { setLocale() {} };
  const prefix = `canary-playground-${++instanceCount}`;
  let locale = copy[initialLocale] ? initialLocale : "en";
  const state = { variant: "original", tab: "source", running: false, result: null, sequence: 1, announcement: "" };
  container.classList.add("pg-host");

  function sourcePanel(t) {
    const patch = state.variant === "patch";
    return `<div class="pg-source-panel">
      <div class="pg-version-choice" role="group" aria-label="${escape(t.choose)}">
        ${["original", "patch"].map((variant) => `<button type="button" data-pg-action="version" data-pg-value="${variant}" aria-pressed="${state.variant === variant}" ${state.running ? "disabled" : ""}>${escape(t[variant])}${state.variant === variant ? icon("check") : ""}</button>`).join("")}
      </div>
      <div class="pg-code" aria-label="${escape(t.codeLabel)}">
        <div class="pg-code-line"><span class="pg-line-number" aria-hidden="true">21</span><code><span class="pg-keyword">export function</span> checkout(cart) {</code></div>
        <div class="pg-code-line"><span class="pg-line-number" aria-hidden="true">22</span><code>  <span class="pg-keyword">const</span> { subtotal, shipping, discount } = cart;</code></div>
        <div class="pg-code-line"><span class="pg-line-number" aria-hidden="true">23</span><code> </code></div>
        <div class="pg-code-line pg-code-removed"><span class="pg-line-number" aria-hidden="true">24</span><code><span class="pg-diff-marker" aria-hidden="true">${patch ? "−" : "!"}</span>  <span class="pg-keyword">return</span> subtotal + shipping;</code></div>
        ${patch ? '<div class="pg-code-line pg-code-added"><span class="pg-line-number" aria-hidden="true">24</span><code><span class="pg-diff-marker" aria-hidden="true">+</span>  <span class="pg-keyword">return</span> subtotal + shipping - discount;</code></div>' : ""}
        <div class="pg-code-line"><span class="pg-line-number" aria-hidden="true">25</span><code>}</code></div>
      </div>
      <p class="pg-code-hint ${patch ? "pg-hint-patch" : ""}">${icon(patch ? "check" : "arrow")}<span>${escape(patch ? t.patched : t.missing)}</span></p>
      <div class="pg-fixture">
        <h4>${escape(t.fixture)}</h4>
        <dl>${["subtotal", "shipping", "discount", "expected"].map((key) => `<div${key === "expected" ? ' class="pg-fixture-expected"' : ""}><dt>${escape(t[key])}</dt><dd>${fixture[key]}</dd></div>`).join("")}</dl>
      </div>
    </div>`;
  }

  function evidencePanel(t) {
    return `<div class="pg-evidence-panel">
      <div class="pg-evidence-label">${icon("file")}<span>cart.test.ts:18</span><span class="pg-status pg-status-fail">${escape(t.failed)}</span></div>
      <h4>${escape(t.assertion)}</h4>
      <pre class="pg-assertion"><code>expect(checkout({
  subtotal: 100,
  shipping: 10,
  discount: 10
})).toBe(100);</code></pre>
      <p class="pg-evidence-note">${escape(t.unchanged)}</p>
      <div class="pg-error-evidence"><h4>${escape(t.stack)}</h4><pre><code>AssertionError: expected 110 to be 100
  at cart.test.ts:18
  at checkout.ts:24

Expected: 100
Received: 110</code></pre></div>
    </div>`;
  }

  function comparisonPanel(t) {
    const result = state.result;
    return `<div class="pg-comparison-panel">
      <h4>${escape(t.compareHeading)}</h4>
      <div class="pg-comparison-totals"><div><span>${escape(t.before)}</span><strong>110</strong><span class="pg-status pg-status-fail">${escape(t.failed)}</span></div><span class="pg-compare-arrow">${icon("arrow")}</span><div><span>${escape(t.after)}</span><strong>${result ? result.actual : "—"}</strong><span class="pg-status ${result ? (result.passed ? "pg-status-pass" : "pg-status-fail") : "pg-status-neutral"}">${escape(result ? (result.passed ? t.passed : t.failed) : t.pending)}</span></div></div>
      <dl class="pg-comparison-facts"><div><dt>${escape(t.codeChange)}</dt><dd>${escape(result ? (result.variant === "patch" ? t.added : t.same) : "—")}</dd></div><div><dt>${escape(t.checks)}</dt><dd>${escape(t.preserved)}</dd></div><div><dt>${escape(t.result)}</dt><dd>${escape(result ? (result.passed ? t.fixed : t.notFixed) : "—")}</dd></div></dl>
      <p class="pg-comparison-conclusion">${escape(result ? (result.passed ? t.conclusionPassed : t.conclusionFailed) : t.initialConclusion)}</p>
    </div>`;
  }

  function render() {
    const t = copy[locale];
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusAction = focused?.dataset.pgAction;
    const focusValue = focused?.dataset.pgValue;
    const result = state.result;
    const statusText = state.running ? t.checking : result ? (result.passed ? t.success : t.unchangedFail) : t.ready;
    container.innerHTML = `<div class="pg-section-heading"><div><p class="pg-eyebrow">${escape(t.eyebrow)}</p><h2>${escape(t.title)}</h2></div><p class="pg-intro">${escape(t.intro)}</p></div>
      <div class="pg-window">
        <div class="pg-window-bar"><div class="pg-window-dots" aria-hidden="true"><i></i><i></i><i></i></div><span>canary / checkout</span><span class="pg-example-label">${escape(t.example)}</span></div>
        <div class="pg-workspace">
          <div class="pg-editor">
            <div class="pg-editor-heading"><div>${icon("file")}<span>checkout.ts</span></div><span class="pg-path">src / checkout</span></div>
            <div class="pg-tabs" role="tablist" aria-label="${escape(t.tabs)}">${["source", "evidence", "comparison"].map((tab) => `<button type="button" role="tab" id="${prefix}-${tab}" aria-selected="${state.tab === tab}" aria-controls="${prefix}-panel" tabindex="${state.tab === tab ? "0" : "-1"}" data-pg-action="tab" data-pg-value="${tab}">${escape(t[tab])}</button>`).join("")}</div>
            <div class="pg-tab-panel" id="${prefix}-panel" role="tabpanel" aria-labelledby="${prefix}-${state.tab}" tabindex="0">${state.tab === "source" ? sourcePanel(t) : state.tab === "evidence" ? evidencePanel(t) : comparisonPanel(t)}</div>
          </div>
          <aside class="pg-results" aria-label="${escape(t.results)}">
            <h3>${escape(t.results)}</h3>
            <div class="pg-run-card pg-run-original"><div class="pg-run-card-top"><span>${escape(t.before)}</span><span class="pg-status pg-status-fail">${icon("cross")}${escape(t.failed)}</span></div><div class="pg-run-values"><div><span>${escape(t.expectedShort)}</span><strong>100</strong></div><div><span>${escape(t.actual)}</span><strong class="pg-value-fail">110</strong></div></div><div class="pg-run-id">${originalResult.id}<span>cart.test.ts:18</span></div></div>
            <div class="pg-lineage-link">${icon("link")}<span>${escape(result ? t.linked : t.originalEvidence)}</span></div>
            <div class="pg-run-card pg-run-latest ${state.running ? "pg-is-running" : result ? (result.passed ? "pg-is-passed" : "pg-is-failed") : "pg-is-empty"}" aria-busy="${state.running}">
              <div class="pg-run-card-top"><span>${escape(t.after)}</span><span class="pg-status ${state.running ? "pg-status-neutral" : result ? (result.passed ? "pg-status-pass" : "pg-status-fail") : "pg-status-neutral"}">${state.running ? '<span class="pg-spinner" aria-hidden="true"></span>' : result ? icon(result.passed ? "check" : "cross") : ""}${escape(state.running ? t.running : result ? (result.passed ? t.passed : t.failed) : t.pending)}</span></div>
              ${result && !state.running ? `<div class="pg-run-values"><div><span>${escape(t.expectedShort)}</span><strong>100</strong></div><div><span>${escape(t.actual)}</span><strong class="${result.passed ? "pg-value-pass" : "pg-value-fail"}">${result.actual}</strong></div></div><div class="pg-run-id">${result.id}<span>${escape(t[result.variant])}</span></div>` : `<p class="pg-pending-copy">${escape(state.running ? t.checking : t.pendingBody)}</p>`}
            </div>
            <p class="pg-result-summary ${result?.passed && !state.running ? "pg-summary-pass" : ""}">${escape(statusText)}</p>
            <button type="button" class="pg-compare-button" data-pg-action="compare" ${!result || state.running ? "disabled" : ""}>${escape(t.viewCompare)}${icon("arrow")}</button>
          </aside>
        </div>
        <div class="pg-action-bar"><button class="pg-run-button" type="button" data-pg-action="run" ${state.running ? "disabled" : ""}>${state.running ? '<span class="pg-spinner" aria-hidden="true"></span>' : icon("play")}<span>${escape(state.running ? t.running : t.run)}</span></button><button class="pg-reset-button" type="button" data-pg-action="reset" ${state.running ? "disabled" : ""}>${icon("reset")}<span>${escape(t.reset)}</span></button><span class="pg-action-version">${escape(t[state.variant])}</span></div>
      </div>
      <p class="pg-boundary">${escape(t.boundary)}</p>
      <span class="pg-sr-only" role="status" aria-live="polite" aria-atomic="true">${escape(state.announcement)}</span>`;
    if (focusAction) {
      const target = [...container.querySelectorAll("[data-pg-action]")].find(
        (element) =>
          element.dataset.pgAction === focusAction && (!focusValue || element.dataset.pgValue === focusValue),
      );
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  function setTab(tab, focus = false) {
    if (!["source", "evidence", "comparison"].includes(tab)) return;
    state.tab = tab;
    state.announcement = copy[locale][`tab${tab[0].toUpperCase()}${tab.slice(1)}Announcement`];
    render();
    if (focus)
      container.querySelector(`[data-pg-action="tab"][data-pg-value="${tab}"]`)?.focus({ preventScroll: true });
  }

  container.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pg-action]");
    if (!button || !container.contains(button) || button.disabled) return;
    const action = button.dataset.pgAction;
    if (action === "tab") setTab(button.dataset.pgValue);
    if (action === "compare") setTab("comparison", true);
    if (action === "version" && !state.running) {
      state.variant = button.dataset.pgValue;
      state.announcement = copy[locale][state.variant === "patch" ? "selectedPatch" : "selectedOriginal"];
      render();
    }
    if (action === "reset" && !state.running) {
      Object.assign(state, { variant: "original", tab: "source", result: null, sequence: 1 });
      state.announcement = copy[locale].resetAnnouncement;
      render();
    }
    if (action === "run" && !state.running) {
      const variant = state.variant;
      state.running = true;
      state.announcement = copy[locale].checking;
      render();
      // The pause communicates a user-triggered state transition; the result is deterministic arithmetic.
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : 550));
      const actual = fixture.subtotal + fixture.shipping - (variant === "patch" ? fixture.discount : 0);
      state.result = {
        id: `EXAMPLE-${String(++state.sequence).padStart(3, "0")}`,
        parentId: originalResult.id,
        actual,
        passed: actual === fixture.expected,
        variant,
      };
      state.running = false;
      state.announcement = `${copy[locale].runFinished}. ${state.result.passed ? copy[locale].success : copy[locale].unchangedFail}`;
      const returnFocusToRun =
        document.activeElement === document.body || document.activeElement?.matches('[data-pg-action="run"]');
      render();
      if (returnFocusToRun) container.querySelector('[data-pg-action="run"]')?.focus({ preventScroll: true });
    }
  });

  container.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target.closest('[data-pg-action="tab"]');
    if (!target) return;
    const tabs = ["source", "evidence", "comparison"];
    const index = tabs.indexOf(target.dataset.pgValue);
    let next;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === "Home") next = tabs[0];
    if (event.key === "End") next = tabs[tabs.length - 1];
    if (next) {
      event.preventDefault();
      setTab(next, true);
    }
  });

  render();
  return {
    setLocale(nextLocale) {
      locale = copy[nextLocale] ? nextLocale : "en";
      state.announcement = "";
      render();
    },
  };
}
