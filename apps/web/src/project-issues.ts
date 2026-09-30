import type { ProjectCheckResult, RunSnapshot, ProjectChecksConfig } from "@canary/core";
import { FileArtifactRepository, stableHash } from "@canary/trace";

export interface ProjectIssue {
  id: string;
  runId: string;
  checkId?: string;
  category: string;
  title: string;
  summary: string;
  /** Built-in fallback explanation, rather than an excerpt of original evidence. */
  summaryIsGenerated?: boolean;
  advice: string;
  target: "check" | "evidence" | "coverage" | "cases";
  status: "open" | "verified" | "waiting" | "failed" | "unverified";
  verification?: { runId: string; reason: string };
}
const advice: Record<string, string> = {
  assertion: "检查错误堆栈和断言，修复后重跑该检查。",
  configuration: "核对配置、命令参数和工作目录。",
  environment: "检查工具、服务和资源是否可用。",
  dependency: "先处理未通过的前置检查，再重跑。",
  timeout: "检查最后执行位置与阻塞步骤，再核对超时设置。",
  budget: "核对总预算和检查耗时，补跑未完成项。",
  cancelled: "确认中断原因后补跑，不将中断判定为通过。",
  platform: "在声明支持的真实平台执行并保存证据。",
  artifact: "核对 manifest、文件哈希和父子运行关系。",
  policy: "检查违规断言与工具轨迹，核对策略要求。",
};
export function issueFromCheck(runId: string, check: ProjectCheckResult): ProjectIssue {
  const lines = [
    ...(check.outputEvidence?.stderr ?? []),
    ...(check.outputEvidence?.stdout ?? []),
    check.stderr ?? "",
    check.stdout ?? "",
  ]
    .flatMap((line) => line.split("\n"))
    .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ""))
    .filter((line) => line.trim() && !/^\[.*(?:omitted|redacted|recent output)/i.test(line));
  const excerpt = (lines.find((line) => /error|fail|exception|timeout|错误|失败/i.test(line)) ?? lines[0])?.slice(
    0,
    1600,
  );
  return {
    id: `${runId}:check:${check.id}`,
    runId,
    checkId: check.id,
    category: check.category,
    title: check.id,
    summaryIsGenerated: !excerpt,
    summary:
      excerpt ??
      (check.outputTruncated
        ? "日志已截断，当前证据不足以定位根因。"
        : `检查${check.status === "blocked" ? "阻塞" : "失败"}，退出码 ${check.exitCode}。`),
    advice: advice[check.category] ?? "查看原始证据与执行上下文后定位原因。",
    target: "check",
    status: "open",
  };
}

/** A passing unrelated run or manually assigned status can never close a project issue. */
export type RetryCandidate = Pick<RunSnapshot, "runId" | "retryOf" | "startedAt"> & { checkIds: string[] };
export type ReplayCandidate = Pick<RunSnapshot, "runId" | "replayOf" | "startedAt">;

/** Agent replay verification is scoped to the same case and its original assertion/input snapshot. */
export function linkAgentVerification(
  issue: ProjectIssue,
  source: RunSnapshot,
  candidates: ReplayCandidate[],
  repository?: FileArtifactRepository,
  load?: (id: string) => RunSnapshot | undefined,
): ProjectIssue {
  if (!repository || issue.target !== "cases") return issue;
  const caseId = issue.title;
  const originals = source.results.filter((result) => result.caseId === caseId);
  if (!originals.length || originals.some((result) => !result.sourceCase)) return issue;
  const reachable = new Map<string, RunSnapshot>([[source.runId, source]]);
  for (const header of [...candidates].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (!header.replayOf || !reachable.has(header.replayOf)) continue;
    const parent = reachable.get(header.replayOf)!;
    const updated = { ...issue, verification: { runId: header.runId, reason: "" } };
    try {
      const replay = load?.(header.runId) ?? repository.readRun(header.runId);
      if (!replay) throw new Error("Missing replay");
      const parentIntegrity = repository.verify(parent.runId);
      const integrity = repository.verify(replay.runId);
      const lineage = replay.evidence?.lineage;
      if (
        parentIntegrity.status !== "verified" ||
        replay.replayOf !== parent.runId ||
        lineage?.replayOf !== parent.runId ||
        lineage.parentManifestHash !== parentIntegrity.manifestHash
      ) {
        updated.status = "unverified";
        updated.verification.reason = "重放谱系或来源证据不匹配";
      } else if (replay.status === "running" && integrity.status !== "invalid") {
        updated.status = "waiting";
        updated.verification.reason = "关联重放尚未完成";
      } else if (integrity.status !== "verified") {
        updated.status = "unverified";
        updated.verification.reason = "重放证据尚未封存或已损坏";
      } else {
        reachable.set(replay.runId, replay);
        const results = replay.results.filter((result) => result.caseId === caseId);
        const key = (result: RunSnapshot["results"][number]) =>
          result.repetition === undefined ? "single" : `repeat:${result.repetition}`;
        const originalByKey = new Map(originals.map((result) => [key(result), result]));
        const sameCase =
          results.length === originals.length &&
          originalByKey.size === originals.length &&
          new Set(results.map(key)).size === results.length &&
          results.every(
            (result) =>
              result.sourceCase &&
              originalByKey.has(key(result)) &&
              stableHash(result.sourceCase) === stableHash(originalByKey.get(key(result))!.sourceCase),
          );
        updated.status =
          sameCase && replay.status === "completed" && results.every((result) => result.passed) ? "verified" : "failed";
        updated.verification.reason = !sameCase
          ? "输入、断言或重复轮次变化；不能证明同一用例已修复"
          : updated.status === "verified"
            ? "同一 Agent 用例及断言通过，重放谱系和证据已校验；仅覆盖该用例"
            : "关联重放中同一用例仍未通过";
      }
    } catch {
      updated.status = "unverified";
      updated.verification.reason = "无法读取完整重放证据";
    }
    issue = updated;
  }
  return issue;
}
export function linkVerification(
  issue: ProjectIssue,
  source: RunSnapshot,
  candidates: RetryCandidate[],
  repository?: FileArtifactRepository,
  load?: (id: string) => RunSnapshot | undefined,
): ProjectIssue {
  if (!repository || !issue.checkId) return issue;
  const reachable = new Map<string, RunSnapshot>([[source.runId, source]]);
  const ordered = [...candidates].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const sourcePlan = repository.readJson<ProjectChecksConfig>(source.runId, "check-plan.json");
  const sourceCheck = sourcePlan?.checks.find((c) => c.id === issue.checkId);
  for (const header of ordered) {
    if (!header.retryOf || !reachable.has(header.retryOf)) continue;
    const parent = reachable.get(header.retryOf)!;
    const result = { ...issue, verification: { runId: header.runId, reason: "" } };
    try {
      const candidate = load?.(header.runId) ?? repository.readRun(header.runId);
      if (!candidate) throw new Error("Missing retry");
      const parentIntegrity = repository.verify(parent.runId);
      const integrity = repository.verify(candidate.runId);
      const parentHash = candidate.evidence?.lineage.parentManifestHash;
      const plan = repository.readJson<ProjectChecksConfig>(candidate.runId, "check-plan.json");
      const planCheck = plan?.checks.find((c) => c.id === issue.checkId);
      // A retry of another check must not change this issue's verification.
      if (plan && !planCheck) continue;
      const check = candidate.checks?.find((c) => c.id === issue.checkId);
      const samePlan = plan?.checks.every((c) => {
        const original = sourcePlan?.checks.find((s) => s.id === c.id);
        return (
          original &&
          stableHash(original) === stableHash(c) &&
          (c.dependsOn ?? []).every((dep) => plan.checks.some((p) => p.id === dep))
        );
      });
      if (
        parentIntegrity.status !== "verified" ||
        !parentHash ||
        parentHash !== parentIntegrity.manifestHash ||
        candidate.retryOf !== parent.runId ||
        candidate.evidence?.lineage.retryOf !== parent.runId ||
        !sourceCheck ||
        !planCheck ||
        !samePlan ||
        stableHash(sourceCheck) !== stableHash(planCheck)
      ) {
        result.status = "unverified";
        result.verification.reason = "谱系、配置或来源证据不匹配";
      } else if (candidate.status === "running" && integrity.status !== "invalid") {
        result.status = "waiting";
        result.verification.reason = "关联重跑尚未完成";
      } else if (integrity.status !== "verified") {
        result.status = "unverified";
        result.verification.reason = "重跑证据尚未封存或已损坏";
      } else {
        reachable.set(candidate.runId, candidate);
        const passed =
          candidate.status === "completed" &&
          check?.status === "passed" &&
          plan!.checks
            .filter((c) => c.required)
            .every((c) => candidate.checks?.some((r) => r.id === c.id && r.status === "passed")) &&
          (candidate.checks ?? []).filter((c) => c.required).every((c) => c.status === "passed");
        result.status = passed ? "verified" : "failed";
        result.verification.reason = passed ? "同一检查及必需前置检查通过，谱系和封存证据已校验" : "关联重跑仍未通过";
      }
    } catch {
      if (header.checkIds.length && !header.checkIds.includes(issue.checkId!)) continue;
      result.status = "unverified";
      result.verification.reason = "无法读取完整验证证据";
    }
    issue = result;
  }
  return issue;
}

export function gateIssues(run: RunSnapshot): ProjectIssue[] {
  return run.gate?.passed === false
    ? (run.gate.failures ?? []).map((failure, index) => ({
        id: `${run.runId}:gate:${index}`,
        runId: run.runId,
        category: "quality",
        title: failure.target || failure.code,
        summary: failure.message,
        advice: "查看实际值、门槛和测量精度，补齐验证后重新运行。",
        target: "evidence",
        status: "open",
      }))
    : [];
}
