import type { CoverageGateResult, CoverageSummary, EvalResult } from "@canary/core";

export interface RunReportInput {
  checks?: import("@canary/core").ProjectCheckResult[];
  checkSelection?: import("@canary/core").ProjectCheckSelection;
  runId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  totalCases: number;
  passedCases: number;
  results: EvalResult[];
  coverage?: CoverageSummary;
  gate?: CoverageGateResult;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function toJson(result: EvalResult): string {
  return JSON.stringify(result, null, 2);
}

export function toMarkdown(result: EvalResult): string {
  return `# canary result\n\n- Case: ${result.caseId}\n- Passed: ${result.passed}\n`;
}

export function renderJson(run: RunReportInput): string {
  if (run.checks) return JSON.stringify({ v: 1, kind: "canary.project-report", runId: run.runId, status: run.status, checks: run.checks, ...(run.checkSelection ? { selection: run.checkSelection } : {}) }, null, 2);
  return JSON.stringify({
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    cases: { total: run.totalCases, passed: run.passedCases, failed: run.totalCases - run.passedCases },
    coverage: run.coverage,
    results: run.results.map((result) => ({
      caseId: result.caseId,
      passed: result.passed,
      failureCategory: result.failureCategory,
      assertions: result.assertions,
      metrics: result.metrics,
    })),
  }, null, 2);
}

export function renderMarkdown(run: RunReportInput): string {
  if (run.checks) return `# Canary project run ${run.runId}\n\nStatus: ${run.status}\n\n${projectScope(run)}\n\n${run.checks.map((check) => `- ${check.id}: ${check.status} (${check.category}, ${check.required ? "required" : "optional"}, ${check.durationMs}ms)`).join("\n")}${(run.checkSelection?.omittedChecks ?? []).map((check) => `\n- ${check.id}: omitted (${check.reason}; not passed)`).join("")}\n`;
  const failed = run.results.filter((result) => !result.passed);
  const coverage = run.coverage
    ? `lines ${run.coverage.lines.covered}/${run.coverage.lines.total} (${run.coverage.lines.pct}%)`
    : "unavailable";
  const cases = run.results.map((result) => `- ${result.passed ? "PASS" : "FAIL"} ${result.caseId}${result.failureCategory ? ` (${result.failureCategory})` : ""}`).join("\n");
  return `# canary run ${run.runId}\n\n- status: ${run.status}\n- cases: ${run.passedCases}/${run.totalCases} passed\n- coverage: ${coverage}\n\n## Cases\n\n${cases || "- none"}\n${failed.length ? `\n## Failures\n\n${failed.map((result) => `- ${result.caseId}: ${result.assertions.filter((item) => !item.passed).map((item) => item.message ?? item.id).join("; ")}`).join("\n")}\n` : ""}`;
}

export function countJunitFailures(xml: string): number {
  const match = xml.match(/\bfailures="(\d+)"/);
  return match ? Number(match[1]) : Number.NaN;
}

export function renderJunit(run: RunReportInput): string {
  if (run.checks) return renderProjectJunit(run, run.checks);
  const time = run.results.reduce((total, result) => total + ((result.metrics?.latencyMs ?? 0) / 1000), 0);
  const caseFailures = run.results.filter((result) => !result.passed);
  const gateFailed = Boolean(run.gate && !run.gate.passed);
  const failures = caseFailures.length + (gateFailed ? 1 : 0);
  const tests = run.results.map((result) => {
    const seconds = ((result.metrics?.latencyMs ?? 0) / 1000).toFixed(3);
    const name = xmlEscape(caseLabel(result));
    if (result.passed) return `  <testcase name="${name}" classname="canary" time="${seconds}"/>`;
    const message = xmlEscape(result.assertions.filter((item) => !item.passed).map((item) => item.message ?? item.id).join("; ") || result.failureCategory || "failed");
    return `  <testcase name="${name}" classname="canary" time="${seconds}">\n    <failure message="${message}"/>\n  </testcase>`;
  });
  if (gateFailed) {
    const message = xmlEscape(run.gate?.failures.map((item) => item.message).join("; ") || run.gate?.reason || "coverage_below_threshold");
    tests.push(`  <testcase name="coverage.gate" classname="canary">\n    <failure message="${message}"/>\n  </testcase>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="canary" tests="${run.totalCases + (gateFailed ? 1 : 0)}" failures="${failures}" time="${time.toFixed(3)}">\n${tests.join("\n")}\n</testsuite>\n`;
}

function caseLabel(result: EvalResult): string {
  if (result.repetition && result.repetitionTotal && result.repetitionTotal > 1) return `${result.caseId}#${result.repetition}`;
  return result.caseId;
}

export function renderConsole(run: RunReportInput): string {
  if (run.checks) return `canary ${run.runId}: ${run.status}\n${projectScope(run)}\n${run.checks.map((check) => `${check.status.toUpperCase()} ${check.id} (${check.category}, ${check.durationMs}ms)`).join("\n")}`;
  const failed = run.totalCases - run.passedCases;
  const coverage = run.coverage
    ? `${run.coverage.status} lines ${run.coverage.lines.covered}/${run.coverage.lines.total} (${run.coverage.lines.pct}%)`
    : "unavailable";
  const rows = run.results.map((result) => {
    const latency = result.metrics?.latencyMs ?? 0;
    const reason = result.passed ? "" : ` · ${result.assertions.filter((item) => !item.passed).map((item) => item.message ?? item.id).join("; ") || result.failureCategory || "failed"}`;
    return `${result.passed ? "PASS" : "FAIL"} ${caseLabel(result)} (${latency}ms)${reason}`;
  });
  return [
    `canary ${run.runId}`,
    `status ${run.status}`,
    `cases ${run.passedCases} passed / ${failed} failed / ${run.totalCases} total`,
    `coverage ${coverage}`,
    ...rows,
  ].join("\n");
}

function projectScope(run: RunReportInput): string {
  const plan = run.checkSelection;
  return plan ? `Scope: ${plan.mode}; selected ${plan.selected}/${plan.planned}, omitted ${plan.omitted} (not passed)` : "Scope: configured checks";
}

function renderProjectJunit(run: RunReportInput, checks: NonNullable<RunReportInput["checks"]>): string {
  let failures = 0, errors = 0, skipped = 0;
  const rows = checks.map((check) => {
    let detail = "";
    if (check.status === "excluded" || (!check.required && check.exitCode === 1)) { skipped++; detail = `<skipped message="${xmlEscape(check.category)}"/>`; }
    else if (check.exitCode > 1) { errors++; detail = `<error type="${check.category}" message="${check.status}"/>`; }
    else if (check.exitCode === 1) { failures++; detail = `<failure message="${check.category}"/>`; }
    return `  <testcase name="${xmlEscape(check.id)}" classname="canary.${check.type}" time="${(check.durationMs / 1000).toFixed(3)}">${detail}</testcase>`;
  });
  for (const omitted of run.checkSelection?.omittedChecks ?? []) { skipped++; rows.push(`  <testcase name="${xmlEscape(omitted.id)}" classname="canary.omitted" time="0"><skipped message="${xmlEscape(omitted.reason)}; not executed"/></testcase>`); }
  if (run.status !== "completed" && !errors && !failures) { errors++; rows.push('  <testcase name="project.gate"><error message="Project gate did not complete successfully"/></testcase>'); }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="canary.project" tests="${rows.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">\n${rows.join("\n")}\n</testsuite>\n`;
}

export function renderReport(run: RunReportInput, format: "json" | "markdown" | "junit" | "console"): string {
  if (format === "markdown") return renderMarkdown(run);
  if (format === "junit") return renderJunit(run);
  if (format === "console") return renderConsole(run);
  return renderJson(run);
}
