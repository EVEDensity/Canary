import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseRunSnapshot,
  parseQualityAssessment,
  parseQualityRecord,
  qualityContentHash,
  qualityDecisionInputSchema,
  projectMemoryProjectId,
  isRepairTaskPath,
  QUALITY_MAX_DECISIONS,
  QUALITY_MAX_RECORD_BYTES,
  QUALITY_MAX_REPORT_BYTES,
  QUALITY_MAX_REPORTS,
  type QualityAssessment,
  type QualityAssessmentView,
  type QualityDecisionInput,
  type QualityRecord,
  type RunSnapshot,
} from "@canary/core";
import { atomicWrite, readArtifactManifest, safeArtifactPath, sha256 } from "./artifacts.js";
import { FileArtifactRepository } from "./store.js";
import { containsSensitiveValue, redactText, redactValue } from "./privacy.js";

export class QualityAssessmentError extends Error {
  constructor(
    readonly code: "QUALITY_STALE" | "QUALITY_BUSY" | "QUALITY_STORAGE" | "QUALITY_EVIDENCE" | "QUALITY_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "QualityAssessmentError";
  }
}
function fail(code: QualityAssessmentError["code"], message: string): never {
  throw new QualityAssessmentError(code, message);
}
function ordinaryParents(path: string): void {
  let current = resolve(path);
  while (true) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      fail("QUALITY_STORAGE", "Quality storage parents must be ordinary directories");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function bytes(file: string, maximum: number): Buffer {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum)
    fail("QUALITY_STORAGE", "Quality evidence must be a bounded, ordinary unshared file");
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (stat.dev !== before.dev || stat.ino !== before.ino || !stat.isFile() || stat.nlink !== 1 || stat.size > maximum)
      fail("QUALITY_STORAGE", "Quality evidence identity changed while reading");
    const result = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let length = 0;
    while (length < result.length) {
      const amount = readSync(fd, result, length, result.length - length, null);
      if (!amount) break;
      length += amount;
    }
    if (length !== stat.size || length > maximum || fstatSync(fd).mtimeMs !== stat.mtimeMs)
      fail("QUALITY_STORAGE", "Quality evidence changed or exceeded its byte budget");
    return result.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
function sealed(repository: FileArtifactRepository, runId: string) {
  const rootStat = lstatSync(repository.rootDir, { throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink())
    fail("QUALITY_EVIDENCE", "Artifact storage must be an existing ordinary directory");
  ordinaryParents(realpathSync.native(resolve(repository.rootDir)));
  const integrity = repository.verify(runId);
  if (integrity.status !== "verified" || !integrity.manifestHash)
    fail("QUALITY_EVIDENCE", "A sealed, verified run is required for a quality assessment");
  const dir = safeArtifactPath(repository.rootDir, runId),
    manifest = readArtifactManifest(dir),
    entry = manifest?.files.find((file) => file.path === "run.json");
  if (!entry || entry.bytes > 16_777_216)
    fail("QUALITY_EVIDENCE", "Run evidence is missing or exceeds the assessment read budget");
  const raw = bytes(safeArtifactPath(dir, "run.json"), 16_777_216);
  if (raw.length !== entry.bytes || sha256(raw) !== entry.sha256)
    fail("QUALITY_EVIDENCE", "Run evidence changed during assessment");
  let run: RunSnapshot;
  try {
    run = parseRunSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))) as RunSnapshot;
  } catch {
    return fail("QUALITY_EVIDENCE", "Run evidence is corrupt or incomplete");
  }
  if (run.runId !== runId || !["completed", "failed", "cancelled"].includes(run.status))
    fail("QUALITY_EVIDENCE", "Assessment requires a finished run with matching identity");
  if (
    ![run.totalCases, run.completedCases, run.passedCases].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    run.passedCases > run.completedCases ||
    run.completedCases > run.totalCases ||
    run.results.length > run.completedCases ||
    new Set(run.results.map((result) => result.executionId)).size !== run.results.length ||
    run.results.some(
      (result) => result.runId !== runId || (result.passed && result.assertions.some((assertion) => !assertion.passed)),
    )
  )
    fail("QUALITY_EVIDENCE", "Run counts or execution identities are inconsistent");
  const final = repository.verify(runId);
  if (final.status !== "verified" || final.manifestHash !== integrity.manifestHash)
    fail("QUALITY_STALE", "Run evidence changed; refresh the quality assessment");
  return {
    run: redactValue(run, { maxStringLength: Infinity }) as RunSnapshot,
    runHash: entry.sha256,
    manifestHash: integrity.manifestHash,
  };
}
const cleanText = (text: unknown, maximum = 580): string =>
  redactText(String(text ?? ""))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
    .slice(0, maximum) || "No additional retained message";
function optionsFor(issue: QualityAssessment["issues"][number]): QualityAssessment["options"] {
  const scope = {
    caseIds: [...new Set(issue.evidence.flatMap((ref) => (ref.caseId ? [ref.caseId] : [])))],
    checkIds: [...new Set(issue.evidence.flatMap((ref) => (ref.checkId ? [ref.checkId] : [])))],
    files: [...new Set(issue.evidence.flatMap((ref) => (ref.filePath ? [ref.filePath] : [])))],
  };
  const prerequisite = ["Confirm the intended behavior and required execution conditions before changing source."];
  const validation = [
    "Keep the original failing assertions and compare the selected candidate against the retained baseline.",
    "Retain previously passing cases and independent regression/holdout checks; report missing or incomparable results.",
  ];
  const make = (
    action: QualityAssessment["options"][number]["action"],
    title: string,
    rationale: string,
    expectedBenefit: string,
  ): QualityAssessment["options"][number] => ({
    id: `${issue.id}:${action}`,
    issueId: issue.id,
    action,
    title,
    rationale,
    prerequisites: prerequisite,
    scope,
    expectedBenefit,
    benefitStatus: "hypothesis",
    validation,
    modelCalls: "depends-on-configuration",
    executionGranted: false,
  });
  const inspect = make(
    "inspect-evidence",
    "Inspect the matching evidence",
    "Confirm the recorded failure and execution conditions before selecting a source change.",
    "Reduce uncertainty about the observed problem.",
  );
  const contract = make(
    "review-contract",
    "Review the behavior contract",
    "Use this when the required behavior, tool availability or assertion intent is ambiguous.",
    "Agree on the required behavior without weakening the original evidence.",
  );
  if (issue.origin === "coverage")
    return [
      make(
        "add-validation",
        "Add focused validation",
        "Uncovered code is a verification gap; add a behavior assertion for the relevant path.",
        "Exercise the missing path and verify its intended outcome.",
      ),
      inspect,
      contract,
    ];
  if (["environment", "configuration", "dependency", "platform"].includes(issue.category))
    return [
      make(
        "restore-prerequisite",
        "Restore the declared prerequisite",
        "The retained check reports an unavailable execution prerequisite; confirm and restore it before retrying.",
        "Make the original verification runnable under its declared conditions.",
      ),
      inspect,
      contract,
    ];
  const repair = make(
    "repair-behavior",
    "Prepare a scoped repair candidate",
    "After confirming the contract, change only the implementation needed for this failure.",
    "Resolve the recorded failure while preserving previously passing behavior.",
  );
  if (/tool|timeout|budget|cancel|internal|artifact|unknown/.test(issue.category)) return [inspect, repair, contract];
  return [repair, inspect, contract];
}

/** Rule-derived guidance over sealed bytes. Never reads current source or calls a model. */
function generateQualityAssessment(repository: FileArtifactRepository, runId: string): QualityAssessment {
  const { run, runHash, manifestHash } = sealed(repository, runId),
    recorded = run.evidence?.reproduction;
  const projectId = projectMemoryProjectId(realpathSync.native(resolve(repository.rootDir)));
  const issues: QualityAssessment["issues"] = [],
    options: QualityAssessment["options"] = [];
  let issueCount = 0;
  const add = (
    origin: QualityAssessment["issues"][number]["origin"],
    category: string,
    title: string,
    observation: unknown,
    evidence: QualityAssessment["issues"][number]["evidence"],
    priority: "high" | "medium" | "low" = "high",
  ) => {
    issueCount++;
    if (issues.length >= 16) return;
    const id = `issue_${qualityContentHash({ origin, category, evidence }).slice(0, 16)}`;
    const issue: QualityAssessment["issues"][number] = {
      id,
      category: cleanText(category, 80),
      priority,
      origin,
      title,
      observation: cleanText(observation),
      evidence,
      uncertainty: ["The retained result establishes a symptom, not a confirmed root cause."],
      recommendedOptionId: "pending",
    };
    const candidates = optionsFor(issue);
    issue.recommendedOptionId = candidates[0]!.id;
    issues.push(issue);
    options.push(...candidates);
  };
  for (const check of run.checks ?? [])
    if (["failed", "blocked"].includes(check.status))
      add(
        "project",
        check.category,
        check.status === "blocked" ? "A project check is blocked" : "A project check failed",
        `${check.id}: ${check.category} (exit ${check.exitCode})`,
        [{ runId, kind: "check", checkId: check.id }],
      );
  for (const result of run.results)
    if (!result.passed) {
      const failed = result.assertions.filter((assertion) => !assertion.passed);
      add(
        "agent",
        result.failureCategory ?? "assertion",
        "An Agent case failed",
        failed.map((assertion) => `${assertion.id}: ${assertion.message ?? "Assertion failed"}`).join("; ") ||
          "Agent execution did not pass",
        (failed.length ? failed : [{ id: "agent.completed" }])
          .slice(0, 8)
          .map((assertion) => ({
            runId,
            kind: "assertion",
            caseId: result.caseId,
            executionId: result.executionId,
            assertionId: assertion.id,
          })),
      );
    }
  for (const [index, gate] of (run.gate?.passed === false ? run.gate.failures : []).entries())
    add("gate", "quality", "A quality gate failed", gate.message, [
      { runId, kind: "gate", assertionId: `gate.${index}` },
    ]);
  const coverage: QualityAssessment["coverage"] = [];
  if (run.coverage) {
    const precise =
      run.coverage.status === "final" &&
      (run.coverage.files ?? []).every((file) => file.status === "final" && file.quality?.precision === "exact");
    for (const metric of ["lines", "statements", "functions", "branches"] as const) {
      const value = run.coverage[metric];
      if (
        ![value.covered, value.total].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        value.covered > value.total
      )
        fail("QUALITY_EVIDENCE", "Coverage denominators are inconsistent");
      coverage.push({
        metric,
        covered: value.covered,
        total: value.total,
        pct: precise && value.total > 0 ? Number(((value.covered / value.total) * 100).toFixed(2)) : null,
      });
    }
    for (const file of run.coverage.files ?? []) {
      const gaps = file.uncoveredLocations ?? [];
      if (
        file.status !== "unavailable" &&
        (gaps.length || file.lines.total > file.lines.covered || file.branches.total > file.branches.covered)
      )
        add(
          "coverage",
          "coverage-gap",
          "Coverage leaves a verification gap",
          `${file.filePath}: lines ${file.lines.covered}/${file.lines.total}, branches ${file.branches.covered}/${file.branches.total}`,
          [
            {
              runId,
              kind: "coverage",
              ...(isRepairTaskPath(file.filePath)
                ? {
                    filePath: cleanText(file.filePath, 400),
                    ...(gaps[0] &&
                    file.status === "final" &&
                    file.quality?.precision === "exact" &&
                    typeof file.sourceHash === "string" &&
                    file.sourceHash.length > 0 &&
                    file.sourceHash.length <= 160
                      ? { line: gaps[0].start.line }
                      : {}),
                  }
                : {}),
            },
          ],
          "medium",
        );
    }
  }
  if (
    run.completedCases < run.totalCases ||
    (!run.checks?.length &&
      (run.results.length < run.totalCases ||
        run.passedCases !== run.results.filter((result) => result.passed).length)) ||
    (!run.results.length && !run.checks?.length) ||
    (run.status !== "completed" && !issueCount)
  )
    add(
      "gate",
      "unknown",
      "Verification evidence is incomplete",
      "No complete passing scope can be established from this run.",
      [{ runId, kind: "gate" }],
    );
  const history: QualityAssessment["history"] = [],
    refs: Array<{ relation: QualityAssessment["history"][number]["relation"]; runId: string; manifestHash?: string }> =
      [];
  for (const relation of ["replayOf", "candidateOf", "retryOf", "recoveryOf"] as const) {
    const parent = run[relation] ?? run.evidence?.lineage[relation];
    if (parent) refs.push({ relation, runId: parent, manifestHash: run.evidence?.lineage.parentManifestHash });
  }
  for (const check of run.checks ?? [])
    if (check.childRun)
      refs.push({ relation: "childRun", runId: check.childRun.runId, manifestHash: check.childRun.manifestHash });
  for (const ref of refs.slice(0, 6)) {
    try {
      const child = sealed(repository, ref.runId);
      if (!ref.manifestHash || child.manifestHash !== ref.manifestHash) throw new Error("Unbound history");
      history.push({
        relation: ref.relation,
        runId: ref.runId,
        integrity: "verified",
        ...(child.run.evidence?.reproduction.gitCommit ? { gitCommit: child.run.evidence.reproduction.gitCommit } : {}),
        passed: child.run.passedCases,
        total: child.run.totalCases,
      });
    } catch {
      history.push({ relation: ref.relation, runId: ref.runId, integrity: "unavailable" });
    }
  }
  const sumMetric = (metric: "latencyMs" | "steps" | "toolCalls") =>
    run.results.length && run.results.every((result) => typeof result.metrics?.[metric] === "number")
      ? run.results.reduce((sum, result) => sum + result.metrics![metric], 0)
      : null;
  const body = {
    v: 1 as const,
    kind: "canary.quality-assessment" as const,
    projectId,
    binding: {
      runId,
      runHash,
      manifestHash,
      ...(recorded
        ? {
            configHash: recorded.configHash,
            casesHash: recorded.casesHash,
            sourceHash: recorded.sourceHash,
            gitCommit: recorded.gitCommit,
            gitDirty: recorded.gitDirty,
          }
        : {}),
    },
    scope: (run.checks?.length ? (run.results.length ? "mixed" : "project") : "agent") as QualityAssessment["scope"],
    run: {
      status: run.status as QualityAssessment["run"]["status"],
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    counts: {
      agent: {
        total: run.checks?.length ? run.results.length : run.totalCases,
        completed: run.results.length,
        passed: run.results.filter((result) => result.passed).length,
        failed: run.results.filter((result) => !result.passed).length,
      },
      checks: {
        total: run.checks?.length ?? 0,
        passed: run.checks?.filter((check) => check.status === "passed").length ?? 0,
        failed: run.checks?.filter((check) => check.status === "failed").length ?? 0,
        blocked: run.checks?.filter((check) => check.status === "blocked").length ?? 0,
        skipped: run.checks?.filter((check) => check.status === "excluded").length ?? 0,
      },
      issues: issueCount,
    },
    coverage,
    telemetry: {
      latencyMs: sumMetric("latencyMs"),
      steps: sumMetric("steps"),
      toolCalls: sumMetric("toolCalls"),
      modelTokens: null,
      monetaryCost: null,
    },
    issues,
    options,
    history,
    omittedIssues: issueCount - issues.length,
    omittedHistory: Math.max(0, refs.length - history.length),
    limitations: [
      "Recommendations are deterministic guidance, not model root-cause findings or verified improvements.",
      "Coverage is execution evidence; zero denominators and missing model costs remain unknown.",
      "Non-final or approximate coverage stays uncertain; reported locations require retained mapping precision.",
      "Source identity is retained context, not proof that the execution matches a clean commit.",
      "Linked runs remain separate scopes; unavailable history is not treated as a passing result.",
      ...(!run.coverage
        ? ["No aggregate coverage was retained; separate check/child measurements are not merged."]
        : []),
      ...(!recorded ? ["Runtime, configuration and source identity were not retained for this run."] : []),
    ],
    advisoryOnly: true as const,
    executionGranted: false as const,
  };
  const document = () => {
    const report = { ...body, id: `assessment_${qualityContentHash(body).slice(0, 24)}`, contentHash: "" };
    report.contentHash = qualityContentHash(report);
    return report;
  };
  while (Buffer.byteLength(JSON.stringify(document())) > QUALITY_MAX_REPORT_BYTES && body.issues.length > 1) {
    const removed = body.issues.pop()!;
    body.options = body.options.filter((option) => option.issueId !== removed.id);
    body.omittedIssues++;
  }
  const report = parseQualityAssessment(document());
  if (Buffer.byteLength(JSON.stringify(report)) > QUALITY_MAX_REPORT_BYTES || containsSensitiveValue(report))
    fail("QUALITY_EVIDENCE", "Quality report exceeded its privacy or byte budget");
  const finalIntegrity = repository.verify(runId);
  if (finalIntegrity.status !== "verified" || finalIntegrity.manifestHash !== manifestHash)
    fail("QUALITY_STALE", "Run evidence changed; refresh the quality assessment");
  return report;
}

export function buildQualityAssessment(repository: FileArtifactRepository, runId: string): QualityAssessment {
  try {
    return generateQualityAssessment(repository, runId);
  } catch (error) {
    if (error instanceof QualityAssessmentError) throw error;
    return fail("QUALITY_EVIDENCE", "Retained quality evidence has an unsupported or inconsistent shape");
  }
}

function storage(repository: FileArtifactRepository, report: QualityAssessment) {
  const root = join(realpathSync.native(resolve(repository.rootDir)), ".quality"),
    file = join(
      root,
      `quality_${qualityContentHash({ projectId: report.projectId, runId: report.binding.runId }).slice(0, 24)}.json`,
    );
  ordinaryParents(root);
  let size = 0;
  if (existsSync(root)) {
    const names = readdirSync(root);
    if (names.length > 192) fail("QUALITY_STORAGE", "Quality storage entry budget exceeded");
    for (const name of names) {
      const stat = lstatSync(join(root, name), { throwIfNoEntry: false });
      if (!stat) continue;
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        !/^quality_[a-f0-9]{24}\.json(?:\.lock|\.[a-f0-9-]{36}\.tmp)?$/.test(name)
      )
        fail("QUALITY_STORAGE", "Quality storage contains an unsupported entry");
      size += stat.size;
      if (stat.size > QUALITY_MAX_RECORD_BYTES || size > 16_777_216)
        fail("QUALITY_STORAGE", "Quality storage byte budget exceeded");
    }
  }
  return { root, file, size };
}
function readRecord(file: string, report: QualityAssessment): QualityRecord | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes(file, QUALITY_MAX_RECORD_BYTES)),
      record = parseQualityRecord(JSON.parse(raw));
    if (
      record.projectId !== report.projectId ||
      record.runId !== report.binding.runId ||
      containsSensitiveValue(record)
    )
      fail("QUALITY_STORAGE", "Quality record scope or privacy is invalid");
    return record;
  } catch (error) {
    if (error instanceof QualityAssessmentError) throw error;
    return fail("QUALITY_STORAGE", "Quality decisions are corrupt or incomplete; restore the record before continuing");
  }
}
function view(report: QualityAssessment, record?: QualityRecord): QualityAssessmentView {
  const decisions = (record?.decisions ?? [])
    .slice(-16)
    .map((decision) => ({ ...decision, stale: decision.reportHash !== report.contentHash }));
  const selections = new Map<string, { issueId: string; optionId: string; revision: number }>();
  for (const decision of record?.decisions ?? []) {
    if (decision.reportHash !== report.contentHash) continue;
    const option = report.options.find((option) => option.id === decision.optionId)!;
    if (decision.action === "select")
      selections.set(option.issueId, { issueId: option.issueId, optionId: option.id, revision: decision.revision });
    else if (selections.get(option.issueId)?.optionId === option.id) selections.delete(option.issueId);
  }
  const result: QualityAssessmentView = {
    v: 1,
    kind: "canary.quality-assessment-view",
    untrustedEvidence: true,
    report,
    revision: record?.revision ?? 0,
    decisions,
    omittedDecisions: (record?.decisions.length ?? 0) - decisions.length,
    selections: [...selections.values()],
    limits: {
      decisions: QUALITY_MAX_DECISIONS,
      reports: QUALITY_MAX_REPORTS,
      reached:
        (record?.decisions.length ?? 0) >= QUALITY_MAX_DECISIONS ||
        ((record?.reports.length ?? 0) >= QUALITY_MAX_REPORTS &&
          !record?.reports.some((item) => item.contentHash === report.contentHash)),
    },
    executionGranted: false,
  };
  while (Buffer.byteLength(JSON.stringify(result)) > 65_536 && result.decisions.length > 1) {
    result.decisions.shift();
    result.omittedDecisions++;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 65_536)
    fail("QUALITY_STORAGE", "Quality view exceeds its response budget");
  return result;
}
export function readQualityAssessment(repository: FileArtifactRepository, runId: string): QualityAssessmentView {
  const report = buildQualityAssessment(repository, runId),
    { file } = storage(repository, report);
  return view(report, readRecord(file, report));
}
/** One atomic document retains immutable briefs and append-only choices, outside run manifests. */
export function recordQualityDecision(
  repository: FileArtifactRepository,
  runId: string,
  value: unknown,
): QualityAssessmentView {
  const parsed = qualityDecisionInputSchema.safeParse(value);
  if (!parsed.success || containsSensitiveValue(parsed.data))
    fail(
      "QUALITY_INPUT",
      "A valid report hash, revision, option, action, actor and reason are required without credentials",
    );
  const input: QualityDecisionInput = parsed.data,
    initial = readQualityAssessment(repository, runId);
  if (initial.report.contentHash !== input.reportHash || initial.revision !== input.expectedRevision)
    fail("QUALITY_STALE", "Quality report or decision revision changed; refresh before choosing");
  if (!initial.report.options.some((option) => option.id === input.optionId))
    fail("QUALITY_INPUT", "The option does not belong to this quality report");
  const { root, file } = storage(repository, initial.report);
  mkdirSync(root, { recursive: true });
  ordinaryParents(root);
  let fd: number;
  try {
    fd = openSync(`${file}.lock`, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      return fail(
        "QUALITY_BUSY",
        "A quality decision writer is active or interrupted; inspect the lock before retrying",
      );
    throw error;
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token: randomUUID() }));
    fsyncSync(fd);
    const current = readQualityAssessment(repository, runId),
      prior = readRecord(file, current.report);
    if (current.report.contentHash !== input.reportHash || current.revision !== input.expectedRevision)
      fail("QUALITY_STALE", "Quality report or decision revision changed; refresh before choosing");
    const reports = prior?.reports ?? [],
      decisions = prior?.decisions ?? [];
    if (
      decisions.length >= QUALITY_MAX_DECISIONS ||
      (reports.length >= QUALITY_MAX_REPORTS &&
        !reports.some((report) => report.contentHash === current.report.contentHash))
    )
      fail(
        "QUALITY_STORAGE",
        "Quality decision history reached its retention limit; archive it before adding a choice",
      );
    const revision = current.revision + 1;
    const record: QualityRecord = {
      v: 1,
      kind: "canary.quality-decisions",
      projectId: current.report.projectId,
      runId,
      revision,
      reports: reports.some((report) => report.contentHash === current.report.contentHash)
        ? reports
        : [...reports, current.report],
      decisions: [
        ...decisions,
        {
          reportHash: input.reportHash,
          optionId: input.optionId,
          action: input.action,
          actor: input.actor,
          reason: input.reason,
          revision,
          at: new Date().toISOString(),
          executionGranted: false,
          verificationStatus: "not-executed",
        },
      ],
      contentHash: "",
    };
    record.contentHash = qualityContentHash(record);
    parseQualityRecord(record);
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body) > QUALITY_MAX_RECORD_BYTES || containsSensitiveValue(record))
      fail("QUALITY_STORAGE", "Quality decision exceeds its privacy or byte budget");
    if (buildQualityAssessment(repository, runId).contentHash !== input.reportHash)
      fail("QUALITY_STALE", "Run evidence changed before the choice could be recorded");
    const layout = storage(repository, current.report);
    if (layout.size + Buffer.byteLength(body) > 16_777_216)
      fail("QUALITY_STORAGE", "Quality storage needs transaction headroom before recording a choice");
    atomicWrite(file, body);
    return view(current.report, record);
  } finally {
    closeSync(fd);
    unlinkSync(`${file}.lock`);
  }
}
