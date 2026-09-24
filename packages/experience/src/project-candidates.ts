import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { ExperienceProvenance, ProjectCheckResult, RunSnapshot } from "@canary/core";
import type { ExperienceInput } from "./index.js";

type Candidate = Pick<ExperienceInput, "key" | "projectRoot" | "source" | "summary" | "content" | "scope" | "provenance" | "limitations" | "validationRequirements">;

const ADVICE: Record<string, { code: string; summary: string; content: string }> = {
  build: { code: "inspect-build", summary: "定位构建失败", content: "定位构建器报告的首个错误文件和步骤，修复后重跑构建与依赖检查。" },
  test: { code: "inspect-test", summary: "定位失败测试", content: "定位失败用例与断言，复核修复所覆盖的边界后重跑测试。" },
  lint: { code: "inspect-lint", summary: "定位静态检查问题", content: "按检查器报告的规则和位置修正代码，重跑相同静态检查。" },
  format: { code: "inspect-format", summary: "定位格式检查问题", content: "定位格式检查报告的文件，按项目格式规则处理后重跑。" },
  coverage: { code: "inspect-coverage", summary: "定位覆盖率缺口", content: "核对声明的覆盖范围和测量精度，为未覆盖的位置补充可重复测试。" },
  assertion: { code: "inspect-assertion", summary: "检查失败断言和对应代码", content: "定位失败断言对应的文件与行号，修复后重跑相同检查及其必需前置检查。" },
  configuration: { code: "inspect-config", summary: "核对项目检查配置", content: "核对检查命令、参数、工作目录和配置路径，再重跑相同检查。" },
  environment: { code: "inspect-environment", summary: "核对运行环境", content: "核对所需工具、服务和资源是否可用，确认环境后重跑相同检查。" },
  dependency: { code: "inspect-dependency", summary: "先处理前置检查", content: "先修复未通过的前置检查，再重跑受阻的检查。" },
  timeout: { code: "inspect-timeout", summary: "定位超时步骤", content: "定位最后执行位置与阻塞步骤，排除原因后重跑相同检查。" },
  budget: { code: "inspect-budget", summary: "核对运行预算", content: "核对检查耗时和总预算，为未完成的检查保留明确结果。" },
  cancelled: { code: "inspect-cancellation", summary: "核对中断原因", content: "确认中断原因后重跑相同检查，不将中断视为通过。" },
  platform: { code: "verify-platform", summary: "补齐平台证据", content: "在声明支持的真实平台重跑相同检查并保存证据。" },
  artifact: { code: "verify-artifact", summary: "核对证据完整性", content: "校验 manifest、文件哈希和运行谱系，重新生成损坏的证据。" },
  policy: { code: "inspect-policy", summary: "核对策略门禁", content: "检查违规断言与工具轨迹，确认策略要求后重跑。" },
  internal: { code: "inspect-internal", summary: "定位内部错误", content: "查看受限错误证据，定位内部异常后重跑相同检查。" },
  quality: { code: "inspect-quality", summary: "核对覆盖率或质量门禁", content: "核对测量范围、精度与门槛，为未覆盖位置补充可重复测试。" },
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toolFor(check: ProjectCheckResult): string | undefined {
  const name = basename((check.command ?? "").replaceAll("\\", "/")).replace(/\.(?:exe|cmd|bat)$/i, "").toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(name) ? name : undefined;
}

function languageFor(tool?: string): string | undefined {
  if (["node", "npm", "pnpm", "yarn", "npx", "tsc", "vitest", "eslint"].includes(tool ?? "")) return "javascript";
  if (["python", "python3", "pytest", "pip"].includes(tool ?? "")) return "python";
  if (tool === "go") return "go";
  if (["cargo", "rustc"].includes(tool ?? "")) return "rust";
  return undefined;
}

function recipeFor(check: ProjectCheckResult) {
  if (check.category === "assertion") {
    const id = check.id.toLowerCase();
    for (const topic of ["coverage", "format", "lint", "build", "test"])
      if (id.includes(topic)) return ADVICE[topic]!;
  }
  return ADVICE[check.category] ?? ADVICE.internal!;
}

/** Derived from a verified run; raw output is hashed, never promoted into instructions. */
export function candidateFromProjectCheck(projectRoot: string, run: RunSnapshot, check: ProjectCheckResult, manifestHash: string, failingCaseIds: string[] = []): Candidate {
  if (!run.checks?.some((item) => item.id === check.id && JSON.stringify(item) === JSON.stringify(check)) || !["failed", "blocked"].includes(check.status)) throw new Error("Project candidate requires a failed check in the source run");
  if (!/^[a-f0-9]{64}$/.test(manifestHash)) throw new Error("Verified manifest hash required");
  const recipe = recipeFor(check);
  // The command recorded for an agent check is Canary's child launcher, not the tested agent's tool.
  const tool = check.type === "agent" ? undefined : toolFor(check), language = languageFor(tool);
  const evidenceHash = hash({ runId: run.runId, checkId: check.id, status: check.status, category: check.category, exitCode: check.exitCode, outputEvidence: check.outputEvidence, stdout: check.stdout, stderr: check.stderr });
  const provenance: ExperienceProvenance = { runId: run.runId, checkId: check.id, manifestHash, evidenceHash, category: check.category, adviceCode: recipe.code };
  return {
    key: `project:${check.id}:${recipe.code}`,
    projectRoot,
    source: { kind: "run", ref: run.runId },
    summary: `${check.id}: ${recipe.summary}`,
    content: recipe.content,
    scope: { projectRoot, checkIds: [check.id], checkTypes: [check.type], ...(tool ? { tools: [tool] } : {}), ...(language ? { languages: [language] } : {}), ...(failingCaseIds.length ? { caseIds: [...new Set(failingCaseIds)].sort() } : {}) },
    provenance,
    limitations: ["分类建议只指出调查方向，不是已验证的具体修复。", "只适用于记录的项目和检查。"],
    validationRequirements: ["相同检查计划", "独立 regression 和 holdout", "人工批准"],
  };
}

export function candidateFromQualityGate(projectRoot: string, run: RunSnapshot, manifestHash: string, index: number): Candidate {
  const failure = run.gate?.failures?.[index];
  if (!failure || !/^[a-f0-9]{64}$/.test(manifestHash)) throw new Error("Verified quality gate evidence required");
  const recipe = ADVICE.quality!;
  const evidenceHash = hash({ runId: run.runId, code: failure.code, target: failure.target, message: failure.message });
  const checkId = "quality-gate";
  return {
    key: `project:${checkId}:${failure.code.replace(/[^A-Za-z0-9._-]/g, "-")}`,
    projectRoot,
    source: { kind: "run", ref: run.runId },
    summary: recipe.summary,
    content: recipe.content,
    scope: { projectRoot, checkIds: [checkId], checkTypes: ["gate"] },
    provenance: { runId: run.runId, checkId, manifestHash, evidenceHash, category: "quality", adviceCode: recipe.code },
    limitations: ["覆盖率仅适用于有最终测量值的声明范围。", "只适用于记录的项目。"],
    validationRequirements: ["相同检查计划", "最终覆盖率测量", "独立 regression 和 holdout", "人工批准"],
  };
}
