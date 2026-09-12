import type { CanaryJudgeConfig } from "@canary/core";

export type JudgeVerdict = "pass" | "fail" | "error" | "timeout" | "low_confidence";

export interface JudgeScore {
  verdict: JudgeVerdict;
  score?: number;
  confidence?: number;
  rationale?: string;
  provider: string;
  error?: string;
  stub?: boolean;
}

export interface JudgeRequest {
  input: unknown;
  output: unknown;
  rubric?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JudgeProvider {
  readonly id: string;
  readonly stub?: boolean;
  score(request: JudgeRequest): Promise<JudgeScore>;
}

export interface JudgePolicy {
  required?: boolean;
  providerKind?: string;
}

const SECRET = /api[_-]?key|token|password|secret|authorization|cookie/i;

export function redactJudgePayload(value: unknown, key?: string): unknown {
  if (key && SECRET.test(key)) return "[redacted]";
  if (typeof value === "string") return SECRET.test(value) ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map((item) => redactJudgePayload(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redactJudgePayload(item, name)]));
  }
  return value;
}

export class DeterministicJudgeProvider implements JudgeProvider {
  readonly id = "deterministic";
  readonly stub = true;
  constructor(private readonly options: { verdict?: JudgeVerdict; score?: number; confidence?: number; delayMs?: number; error?: string } = {}) {}
  async score(request: JudgeRequest): Promise<JudgeScore> {
    if (this.options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(Object.assign(new Error("judge timed out"), { name: "AbortError" }));
        };
        if (request.signal?.aborted) { onAbort(); return; }
        request.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (this.options.verdict === "error") return { verdict: "error", provider: this.id, stub: true, error: this.options.error ?? "judge provider error" };
    if (this.options.verdict === "timeout") return { verdict: "timeout", provider: this.id, stub: true, error: this.options.error ?? "judge timed out" };
    if (this.options.verdict === "low_confidence") {
      return { verdict: "low_confidence", provider: this.id, stub: true, score: this.options.score ?? 0.9, confidence: this.options.confidence ?? 0.2, rationale: "insufficient evidence" };
    }
    if (this.options.verdict === "fail") {
      return { verdict: "fail", provider: this.id, stub: true, score: this.options.score ?? 0.1, confidence: this.options.confidence ?? 0.9, rationale: "does not meet rubric" };
    }
    if (this.options.verdict === "pass" || this.options.score !== undefined) {
      return {
        verdict: "pass",
        provider: this.id,
        stub: true,
        score: this.options.score ?? 1,
        confidence: this.options.confidence ?? 1,
        rationale: "explicit deterministic stub",
      };
    }
    return {
      verdict: "error",
      provider: this.id,
      stub: true,
      error: "DeterministicJudgeProvider is a test stub, not a semantic judge. Pass an explicit verdict or inject a real JudgeProvider.",
    };
  }
}

export class HttpJudgeProvider implements JudgeProvider {
  readonly id = "http";
  constructor(private readonly url: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async score(request: JudgeRequest): Promise<JudgeScore> {
    const timeoutMs = request.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combined = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: redactJudgePayload(request.input),
          output: redactJudgePayload(request.output),
          rubric: request.rubric,
        }),
        signal: combined,
      });
      if (!response.ok) return { verdict: "error", provider: this.id, error: `HTTP ${response.status}` };
      const body = await response.json() as { score?: unknown; confidence?: unknown; rationale?: unknown; verdict?: unknown };
      if (body.verdict === "error" || body.verdict === "timeout" || body.verdict === "low_confidence") {
        return {
          verdict: body.verdict,
          provider: this.id,
          score: typeof body.score === "number" ? body.score : undefined,
          confidence: typeof body.confidence === "number" ? body.confidence : undefined,
          rationale: typeof body.rationale === "string" ? body.rationale : undefined,
          error: typeof body.rationale === "string" ? body.rationale : `judge ${body.verdict}`,
        };
      }
      if (typeof body.score !== "number") return { verdict: "error", provider: this.id, error: "Judge response missing numeric score" };
      const confidence = typeof body.confidence === "number" ? body.confidence : undefined;
      const rationale = typeof body.rationale === "string" ? body.rationale : undefined;
      if (body.verdict === "fail") return { verdict: "fail", provider: this.id, score: body.score, confidence, rationale };
      return { verdict: "pass", provider: this.id, score: body.score, confidence, rationale };
    } catch (error) {
      if (combined.aborted) return { verdict: "timeout", provider: this.id, error: `judge timed out after ${timeoutMs}ms` };
      return { verdict: "error", provider: this.id, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createJudgeProvider(config: CanaryJudgeConfig, options: { fetchImpl?: typeof fetch } = {}): JudgeProvider {
  if (config.provider === "deterministic") return new DeterministicJudgeProvider({ verdict: "pass", score: 1 });
  if (config.provider !== "http") throw new Error(`Unsupported judge provider: ${String(config.provider)}`);
  if (!config.allowOutbound) throw new Error("HTTP Judge requires judge.allowOutbound: true");
  if (!config.url) throw new Error("HTTP Judge requires judge.url");
  return new HttpJudgeProvider(config.url, options.fetchImpl);
}

export async function scoreWithTimeout(judge: JudgeProvider, request: JudgeRequest, timeoutMs: number): Promise<JudgeScore> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
  try {
    return await judge.score({ ...request, timeoutMs, signal: combined });
  } catch (error) {
    if (combined.aborted) return { verdict: "timeout", provider: judge.id, error: `judge timed out after ${timeoutMs}ms` };
    return { verdict: "error", provider: judge.id, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
