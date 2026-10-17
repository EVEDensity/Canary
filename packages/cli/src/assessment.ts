import { resolve } from "node:path";
import type { QualityAssessmentView } from "@canary/core";
import {
  FileArtifactRepository,
  QualityAssessmentError,
  readQualityAssessment,
  recordQualityDecision,
} from "@canary/trace";
import { resolveProjectContext } from "./home.js";

function human(view: QualityAssessmentView): string {
  const report = view.report;
  return [
    `Quality assessment: ${report.binding.runId} (${report.scope})`,
    `Agent executions: ${report.counts.agent.passed}/${report.counts.agent.total}; project checks: ${report.counts.checks.passed}/${report.counts.checks.total}`,
    `Report: ${report.contentHash}; decision revision: ${view.revision}`,
    ...report.issues.flatMap((issue) => {
      const recommendation = report.options.find((option) => option.id === issue.recommendedOptionId)!;
      return [
        `\n${issue.title} [${issue.category}]`,
        issue.observation,
        `Recommended: ${recommendation.title}`,
        recommendation.rationale,
        ...report.options
          .filter((option) => option.issueId === issue.id)
          .map((option) => `  ${option.id}: ${option.title}`),
      ];
    }),
    ...(report.omittedIssues ? [`${report.omittedIssues} additional issues omitted by the response budget.`] : []),
    ...view.decisions
      .slice(-3)
      .map(
        (decision) =>
          `Decision ${decision.revision}: ${decision.action} ${decision.optionId}${decision.stale ? " (stale report)" : ""}; not executed`,
      ),
    "Selections record a direction; they do not execute a repair or approve experience.",
  ].join("\n");
}

/** Assessment is read-only; only the explicit decide subcommand writes a choice. */
export function assessmentCommand(args: string[]): number {
  const json = args.includes("--json");
  try {
    const deciding = args[0] === "decide",
      runId = args[deciding ? 1 : 0],
      start = deciding ? 2 : 1;
    if (!runId || runId.startsWith("--"))
      throw new QualityAssessmentError(
        "QUALITY_INPUT",
        "Use canary assess <runId>, or canary assess decide <runId> with an explicit report, option, revision, actor and reason",
      );
    const flags = new Map<string, string>();
    const allowed = deciding
      ? ["--config", "--project", "--report-hash", "--expected-revision", "--option", "--action", "--actor", "--reason"]
      : ["--config", "--project"];
    let seenJson = false;
    for (let index = start; index < args.length; index++) {
      const name = args[index]!;
      if (name === "--json" && !seenJson) {
        seenJson = true;
        continue;
      }
      const value = args[++index];
      if (!allowed.includes(name) || flags.has(name) || !value || value.startsWith("--"))
        throw new QualityAssessmentError("QUALITY_INPUT", "Unknown, duplicate or incomplete assessment option");
      flags.set(name, value);
    }
    const context = resolveProjectContext({
      cwd: flags.has("--project") ? resolve(flags.get("--project")!) : undefined,
      configPath: flags.get("--config"),
    });
    const repository = new FileArtifactRepository(context.artifactRoot);
    const result = deciding
      ? recordQualityDecision(repository, runId, {
          reportHash: flags.get("--report-hash"),
          expectedRevision: /^(0|[1-9][0-9]*)$/.test(flags.get("--expected-revision") ?? "")
            ? Number(flags.get("--expected-revision"))
            : undefined,
          optionId: flags.get("--option"),
          action: flags.get("--action"),
          actor: flags.get("--actor"),
          reason: flags.get("--reason"),
        })
      : readQualityAssessment(repository, runId);
    console.log(json ? JSON.stringify(result) : human(result));
    return 0;
  } catch (error) {
    const code = error instanceof QualityAssessmentError ? error.code : "QUALITY_EVIDENCE",
      message =
        error instanceof QualityAssessmentError
          ? error.message
          : "Assessment evidence is unavailable or cannot be safely read";
    const output = { v: 1, kind: "canary.quality-error", code, message, executionGranted: false };
    if (json) console.log(JSON.stringify(output));
    else console.error(`${code}: ${message}`);
    return code === "QUALITY_INPUT" ? 2 : 1;
  }
}
