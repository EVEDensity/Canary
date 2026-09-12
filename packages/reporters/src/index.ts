import type { CoverageGateResult, CoverageSummary, EvalResult } from "@canary/core";

export interface RunReportInput {
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
  const time = run.results.reduce((total, result) => total + ((result.metrics?.latencyMs ?? 0) / 1000), 0);
  const caseFailures = run.results.filter((result) => !result.passed);
  const gateFailed = Boolean(run.gate && !run.gate.passed);
  const failures = caseFailures.length + (gateFailed ? 1 : 0);
  const tests = run.results.map((result) => {
    const seconds = ((result.metrics?.latencyMs ?? 0) / 1000).toFixed(3);
    if (result.passed) return `  <testcase name="${xmlEscape(result.caseId)}" classname="canary" time="${seconds}"/>`;
    const message = xmlEscape(result.assertions.filter((item) => !item.passed).map((item) => item.message ?? item.id).join("; ") || result.failureCategory || "failed");
    return `  <testcase name="${xmlEscape(result.caseId)}" classname="canary" time="${seconds}">\n    <failure message="${message}"/>\n  </testcase>`;
  });
  if (gateFailed) {
    const message = xmlEscape(run.gate?.failures.map((item) => item.message).join("; ") || run.gate?.reason || "coverage_below_threshold");
    tests.push(`  <testcase name="coverage.gate" classname="canary">\n    <failure message="${message}"/>\n  </testcase>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="canary" tests="${run.totalCases + (gateFailed ? 1 : 0)}" failures="${failures}" time="${time.toFixed(3)}">\n${tests.join("\n")}\n</testsuite>\n`;
}

export function renderReport(run: RunReportInput, format: "json" | "markdown" | "junit"): string {
  if (format === "markdown") return renderMarkdown(run);
  if (format === "junit") return renderJunit(run);
  return renderJson(run);
}
