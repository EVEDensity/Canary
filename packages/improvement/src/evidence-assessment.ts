import { createHash } from "node:crypto";
import type { EvalResult, ProjectCheckResult, RunSnapshot } from "@canary/core";
import type { RunComparison } from "./index.js";

type EvidenceLevel = "observed" | "insufficient";

export interface ComparisonAssessment {
  v: 1;
  level: EvidenceLevel;
  sample: { matched: number; baseline: number; candidate: number; minimum: number };
  changes: { improvements: number; regressions: number; unchanged: number; missing: number };
  method: "deterministic" | "judge-uncalibrated" | "mixed" | "unknown";
  uncertainty: string[];
  scope: "full" | "retry-subset" | "unknown";
  /** Descriptive paired observations; never a statistical confidence interval. */
  interpretation: string;
}

const MIN_MATCHED = 5;
const TASK_ASSERTIONS = new Set([
  "output.predicate",
  "state.equals",
  "state.contains",
]);

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function byTrial(results: EvalResult[]): Map<string, EvalResult> {
  return new Map(
    results.map((result) => [
      result.repetition === undefined ? result.caseId : `${result.caseId}#${result.repetition}`,
      result,
    ]),
  );
}

export function assessAgentComparison(
  baseline: RunSnapshot,
  candidate: RunSnapshot,
  comparison: RunComparison,
): ComparisonAssessment {
  const before = byTrial(baseline.results),
    after = byTrial(candidate.results);
  const matched = [...before.keys()].filter((id) => after.has(id));
  const missing = new Set([...before.keys(), ...after.keys()].filter((id) => !before.has(id) || !after.has(id)));
  const uncertainty: string[] = [];
  let judge = false,
    taskAssertionPairs = 0,
    identityMismatch = false,
    assertionMismatch = false,
    unrecordedPredicate = false;
  for (const id of matched) {
    const a = before.get(id)!,
      b = after.get(id)!;
    const aCase = a.sourceCase,
      bCase = b.sourceCase;
    if (!aCase || !bCase) {
      identityMismatch = true;
      continue;
    }
    if (digest(aCase) !== digest(bCase)) identityMismatch = true;
    const specs = aCase.assertions ?? [];
    if (specs.some((spec) => spec.type === "judge.score")) judge = true;
    if ([...(aCase.assertions ?? []), ...(bCase.assertions ?? [])].some((spec) => spec.type === "output.predicate"))
      unrecordedPredicate = true;
    const taskSpecs = specs.filter((spec) => TASK_ASSERTIONS.has(spec.type));
    const exercised = taskSpecs.some((spec) =>
      [a, b].every((result) =>
        result.assertions.some((actual) => actual.id === spec.id || actual.id.startsWith(`${spec.type}#`)),
      ),
    );
    if (exercised) taskAssertionPairs++;
    if (!a.assertions.length || !b.assertions.length || (taskSpecs.length > 0 && !exercised)) assertionMismatch = true;
  }
  if (!comparison.comparable || baseline.status === "running" || candidate.status === "running")
    uncertainty.push("运行不完整、样本缺失或数据集不可比");
  if (baseline.startedAt >= candidate.startedAt && baseline.runId !== candidate.runId)
    uncertainty.push("基线时间不早于候选运行；前后方向无法成立");
  if (missing.size) uncertainty.push(`${missing.size} 个用例或重复轮次未配对`);
  if (identityMismatch) uncertainty.push("用例输入、断言或数据集身份不同，不能归因于同一任务");
  if (unrecordedPredicate) uncertainty.push("输出谓词的实现和闭包未随 artifact 固化，无法确认两次使用相同判定逻辑");
  if (assertionMismatch) uncertainty.push("缺少实际断言结果");
  if (taskAssertionPairs !== matched.length)
    uncertainty.push("部分配对用例缺少实际执行的任务结果确定性断言；仅有输出存在不等于任务正确");
  if (judge) uncertainty.push("包含模型评分，尚无绑定评分器与人工标签的校准证据；模型评分不用于可信收益结论");
  if (matched.length < MIN_MATCHED) uncertainty.push(`仅 ${matched.length} 个配对样本，少于探索性门槛 ${MIN_MATCHED}`);
  const changes = {
    improvements: comparison.improvements.length,
    regressions: comparison.regressions.filter((id) => !id.startsWith("holdout:")).length,
    unchanged: matched.filter((id) => before.get(id)!.passed === after.get(id)!.passed).length,
    missing: missing.size,
  };
  return {
    v: 1,
    level: uncertainty.length ? "insufficient" : "observed",
    sample: {
      matched: matched.length,
      baseline: baseline.results.length,
      candidate: candidate.results.length,
      minimum: MIN_MATCHED,
    },
    changes,
    method: judge
      ? "judge-uncalibrated"
      : taskAssertionPairs === matched.length && matched.length > 0
        ? "deterministic"
        : "unknown",
    uncertainty,
    scope: "full",
    interpretation: uncertainty.length
      ? "证据不足；改善和回归是观察计数，不能据此宣称稳定收益。"
      : changes.regressions
        ? "确定性断言发现配对用例回归；先定位回归，停止收益判断。"
        : "确定性断言显示配对样本的观察变化；尚不能推断总体表现。",
  };
}

export function assessProjectComparison(
  baseline: RunSnapshot,
  candidate: RunSnapshot,
  options: { sealed: boolean; samePlan: boolean; linkedRetry: boolean },
): ComparisonAssessment {
  const before = new Map((baseline.checks ?? []).map((check: ProjectCheckResult) => [check.id, check]));
  const after = new Map((candidate.checks ?? []).map((check: ProjectCheckResult) => [check.id, check]));
  const matched = [...before.keys()].filter((id) => after.has(id));
  const missing = new Set([...before.keys(), ...after.keys()].filter((id) => !before.has(id) || !after.has(id)));
  const subset = options.linkedRetry && missing.size > 0;
  const uncertainty: string[] = [];
  if (!options.sealed) uncertainty.push("至少一份运行证据未校验封存");
  if (!options.samePlan && !subset) uncertainty.push("检查计划不同，不能做全量前后比较");
  if (subset) uncertainty.push("关联重跑只覆盖所选检查及前置项，不能代表全项目");
  if (missing.size && !subset) uncertainty.push(`${missing.size} 项检查未配对`);
  if (baseline.status === "running" || candidate.status === "running" || candidate.status === "cancelled")
    uncertainty.push("运行未完整结束");
  if (baseline.startedAt >= candidate.startedAt && baseline.runId !== candidate.runId)
    uncertainty.push("基线时间不早于候选运行；前后方向无法成立");
  if (!matched.length) uncertainty.push("没有同名检查可配对");
  if (matched.length < MIN_MATCHED) uncertainty.push(`仅 ${matched.length} 项配对检查，少于探索性门槛 ${MIN_MATCHED}`);
  const changes = {
    improvements: matched.filter((id) => before.get(id)!.status !== "passed" && after.get(id)!.status === "passed")
      .length,
    regressions: matched.filter((id) => before.get(id)!.status === "passed" && after.get(id)!.status !== "passed")
      .length,
    unchanged: matched.filter((id) => before.get(id)!.status === after.get(id)!.status).length,
    missing: missing.size,
  };
  return {
    v: 1,
    level: uncertainty.length ? "insufficient" : "observed",
    sample: { matched: matched.length, baseline: before.size, candidate: after.size, minimum: MIN_MATCHED },
    changes,
    method: "deterministic",
    uncertainty,
    scope: subset ? "retry-subset" : options.samePlan ? "full" : "unknown",
    interpretation: uncertainty.length
      ? "证据不足；这里只能逐项阅读检查状态变化。"
      : changes.regressions
        ? "相同检查计划发现回归；先定位失败检查，停止收益判断。"
        : "相同检查计划的配对结果显示观察变化；不同检查并非独立同分布样本。",
  };
}
