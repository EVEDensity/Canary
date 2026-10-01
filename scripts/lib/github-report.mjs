import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel);
};
const inline = (value) => String(value ?? "unknown").replace(/[\r\n]/g, " ").replace(/[`<>\[\]()]/g, "").replace(/@/g, "＠").slice(0, 250);
const commandEscape = (value) => String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const propertyEscape = (value) => commandEscape(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
const sha = (value) => /^[a-f0-9]{40,64}$/.test(value ?? "");

/** Read-only reporting: never modifies PR comments or remote check runs. */
export function githubReport({ ci, diagnostics, verified, expectedSha, actualSha, projectRoot, workspace, sourceUnchanged, tracked, repository, serverUrl = "https://github.com", workflowRunId, coverageStatus = "unavailable", checkCounts }) {
  const versionMatched = sha(expectedSha) && actualSha === expectedSha;
  const evidenceBound = verified && diagnostics?.runId === ci.runId && diagnostics?.reproduction?.gitCommit === actualSha;
  const trustworthy = versionMatched && evidenceBound && sourceUnchanged;
  let outcome = ci.exitCode === 0 ? "passed" : ci.exitCode === 1 ? "failed" : "blocked";
  if (outcome === "failed" && trustworthy && checkCounts?.blocked > 0 && checkCounts.failed === 0) outcome = "blocked";
  if (!versionMatched || !sourceUnchanged) outcome = "stale";
  else if (outcome === "passed" && (!evidenceBound || ci.summary.total < 1)) outcome = "evidence-insufficient";
  const baseUrl = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(serverUrl) ? serverUrl : "https://github.com";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ? repository : undefined;
  const runUrl = repo && /^\d+$/.test(String(workflowRunId)) ? `${baseUrl}/${repo}/actions/runs/${workflowRunId}` : undefined;
  const annotations = [];
  const locations = [];
  if (trustworthy && existsSync(projectRoot) && existsSync(workspace)) {
    const root = realpathSync(projectRoot), work = realpathSync(workspace);
    const seen = new Set();
    for (const failure of diagnostics.failures ?? []) for (const location of failure.locations ?? []) {
      if (annotations.length >= 10 || location.mapping !== "path-line" || !Number.isSafeInteger(location.line) || location.line < 1) continue;
      if (typeof location.path !== "string" || location.path.includes("\\") || isAbsolute(location.path) || location.path.split("/").includes("..")) continue;
      const source = resolve(root, location.path);
      try {
        const resolved = realpathSync(source);
        if (!inside(root, resolved) || !inside(work, resolved)) continue;
        const path = relative(work, resolved).replaceAll("\\", "/");
        if (!tracked.has(path) || location.line > readFileSync(resolved, "utf8").split(/\r?\n/).length) continue;
        const key = `${path}:${location.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Only diagnostic identifiers and categories enter annotations, never raw logs.
        const message = `Canary ${inline(failure.category)} in ${inline(failure.checkId ?? failure.caseId ?? failure.id)}. Reported stack position; inspect original evidence to confirm the cause.`;
        annotations.push(`::error file=${propertyEscape(path)},line=${location.line},title=Canary failure::${commandEscape(message)}`);
        locations.push({ path, line: location.line, url: repo ? `${baseUrl}/${repo}/blob/${actualSha}/${path.split("/").map(encodeURIComponent).join("/")}#L${location.line}` : undefined });
      } catch { /* Missing, external and invalid locations stay unknown. */ }
    }
  }
  const limitations = [];
  if (!versionMatched) limitations.push("Executed commit does not match the requested PR head; this result cannot validate the current version.");
  if (!sourceUnchanged) limitations.push("Tracked source changed during verification; source annotations are withheld.");
  if (!evidenceBound) limitations.push("Sealed evidence or its commit binding is unavailable: evidence insufficient.");
  if (coverageStatus === "unavailable" || coverageStatus === "unknown") limitations.push("Coverage was not collected. Passing checks do not establish behavior coverage.");
  if (diagnostics?.failures?.length && !locations.length) limitations.push("No verified repository source position is available; inspect the diagnostic bundle.");
  const summary = [
    "## Canary verification", "", `**${outcome.toUpperCase()}** · ${Number(ci.summary.passed) || 0}/${Number(ci.summary.total) || 0} checks passed · ${Number(ci.summary.failed) || 0} failed or blocked`, "",
    ...(trustworthy && checkCounts ? [`- Failed: ${checkCounts.failed} · Blocked: ${checkCounts.blocked}`] : []),
    `- Requested commit: \`${inline(expectedSha)}\``, `- Executed commit: \`${inline(actualSha)}\``, `- Canary run: \`${inline(ci.runId)}\``, `- Evidence: ${evidenceBound ? "verified and version-bound" : "insufficient"}`,
    ...(runUrl ? [`- [Workflow and reports](${runUrl}) · [Download evidence](${runUrl}#artifacts)`] : []),
    ...locations.map((location) => location.url ? `- [${inline(location.path)}:${location.line}](${location.url})` : `- ${inline(location.path)}:${location.line}`),
    "", ...limitations.map((message) => `- ${message}`), "",
  ].join("\n");
  return { v: 1, kind: "canary.github-report", outcome, expectedSha, actualSha, runId: ci.runId, evidenceVerified: Boolean(evidenceBound), sourceUnchanged, coverageStatus, locations, limitations, summary, annotations, exitCode: ci.exitCode || (trustworthy && ci.summary.total > 0 ? 0 : 5) };
}
