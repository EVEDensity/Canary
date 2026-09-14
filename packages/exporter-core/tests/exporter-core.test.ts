import { describe, expect, it, vi } from "vitest";
import {
  BoundedExporter,
  OtlpHttpTransport,
  eventFromResult,
  profileEndpoint,
  sanitizeAttributes,
  type ExportBatch,
  type ExportEvent,
  type ExportTransport,
} from "../src/index.js";

function makeEvent(overrides: Partial<ExportEvent> = {}): ExportEvent {
  return {
    v: 1,
    kind: "canary.run",
    profile: "otlp",
    runId: "run-1",
    caseId: "case-1",
    executionId: "execution-1",
    evaluator: { ids: ["assertion-1"], passed: 1, total: 1 },
    result: { passed: true, latencyMs: 12, steps: 2, toolCalls: 1 },
    coverage: { status: "available", lines: 90 },
    attributes: { "canary.result.passed": true },
    ...overrides,
  };
}

function makeTransport(send: ExportTransport["send"] = vi.fn(async () => undefined)) {
  return { send } satisfies ExportTransport;
}

async function eventually(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

describe("sanitizeAttributes", () => {
  it("removes secret names, secret-like values, content, URLs, paths, and overlong strings", () => {
    const result = sanitizeAttributes({
      apiKey: "sk-test",
      token: "token-value",
      password: "password-value",
      authorization: "Bearer secret",
      cookie: "session=secret",
      prompt: "private prompt",
      completion: "private completion",
      input: "private input",
      output: "private output",
      trajectory: "private trajectory",
      holdout: "private holdout",
      source: "source text",
      diff: "diff text",
      path: "C:\\workspace\\secret.ts",
      safeSecretWord: "contains token inside a value",
      httpUrl: "https://example.test/run",
      fileUrl: "file:///tmp/run.json",
      long: "x".repeat(257),
      safeString: "stable",
      safeNumber: 42,
      safeBoolean: false,
      empty: "",
      nil: null,
      absent: undefined,
    });

    expect(result).toEqual({ safeString: "stable", safeNumber: 42, safeBoolean: false, empty: "" });
  });

  it("keeps only the supported primitive scalar types", () => {
    expect(sanitizeAttributes({ object: {}, array: [], bigint: BigInt(1), number: 1, bool: true, text: "ok" })).toEqual({
      number: 1,
      bool: true,
      text: "ok",
    });
  });
});

describe("eventFromResult", () => {
  it("creates an aggregate event without raw input/output or trajectory data", () => {
    const event = eventFromResult("phoenix", "run-42", {
      caseId: "case-42",
      executionId: "execution-42",
      passed: false,
      assertions: [
        { id: "a-pass", passed: true },
        { id: "a-fail", passed: false },
        { passed: true },
      ],
      metrics: { latencyMs: 88, steps: 4, toolCalls: 3 },
      coverage: { status: "available", lines: 71, branches: 62 },
      failureCategory: "assertion",
    });

    expect(event).toEqual({
      v: 1,
      kind: "canary.run",
      profile: "phoenix",
      runId: "run-42",
      caseId: "case-42",
      executionId: "execution-42",
      evaluator: { ids: ["a-pass", "a-fail", "unknown"], passed: 2, total: 3 },
      result: { passed: false, latencyMs: 88, steps: 4, toolCalls: 3, failureCategory: "assertion" },
      coverage: { status: "available", lines: 71, branches: 62, functions: undefined, statements: undefined },
      attributes: {
        "canary.run.id": "run-42",
        "canary.case.id": "case-42",
        "canary.execution.id": "execution-42",
        "canary.result.passed": false,
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("output");
    expect(serialized).not.toContain("trajectory");
    expect(serialized).not.toContain("holdout");
  });

  it("uses safe defaults when optional result sections are absent", () => {
    const event = eventFromResult("langfuse", "run-1", {
      caseId: "case-1",
      executionId: "execution-1",
      passed: true,
    });

    expect(event.evaluator).toEqual({ ids: [], passed: 0, total: 0 });
    expect(event.coverage).toEqual({ status: "unavailable", lines: undefined, branches: undefined, functions: undefined, statements: undefined });
  });
});

describe("BoundedExporter", () => {
  it("enforces the pending queue limit while a batch is in flight", async () => {
    const sent: ExportBatch[] = [];
    let release!: () => void;
    const transport = makeTransport(async (batch) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      sent.push(batch);
    });
    const exporter = new BoundedExporter(transport, { profile: "otlp", maxQueue: 1, maxBatch: 1, ratePerSecond: 1000 });

    expect(exporter.enqueue(makeEvent({ executionId: "e-1" }))).toBe(true);
    await eventually(() => expect(release).toBeTypeOf("function"));
    expect(exporter.enqueue(makeEvent({ executionId: "e-2" }))).toBe(true);
    expect(exporter.enqueue(makeEvent({ executionId: "e-3" }))).toBe(false);

    release();
    await eventually(() => expect(sent).toHaveLength(1));
    release();
    await eventually(() => expect(sent).toHaveLength(2));
    const health = exporter.health();
    expect(health.sent).toBe(2);
    expect(health.dropped).toBe(1);
    expect(sent.every((batch) => batch.events.length <= 1)).toBe(true);
  });

  it("honors maxBytes by splitting batches", async () => {
    const sent: ExportBatch[] = [];
    const transport = makeTransport(async (batch) => sent.push(batch));
    const exporter = new BoundedExporter(transport, { profile: "otlp", maxBatch: 10, maxBytes: 1024, ratePerSecond: 1000 });

    exporter.enqueue(makeEvent({ executionId: "e-1" }));
    exporter.enqueue(makeEvent({ executionId: "e-2" }));
    await exporter.flush();

    expect(sent.length).toBeGreaterThan(1);
    expect(sent.flatMap((batch) => batch.events)).toHaveLength(2);
  });

  it("retries with exponential backoff and then succeeds", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("temporary-1"))
      .mockRejectedValueOnce(new Error("temporary-2"))
      .mockResolvedValueOnce(undefined);
    const exporter = new BoundedExporter(makeTransport(send), {
      profile: "otlp",
      retries: 2,
      backoffMs: 1,
      ratePerSecond: 1000,
    });

    exporter.enqueue(makeEvent());
    await eventually(() => expect(send).toHaveBeenCalledTimes(3));
    const health = await exporter.flush();

    expect(send).toHaveBeenCalledTimes(3);
    expect(health.sent).toBe(1);
    expect(health.failed).toBe(0);
    expect(health.state).toBe("idle");
  });

  it("isolates permanent transport failure and records degraded health", async () => {
    const exporter = new BoundedExporter(makeTransport(vi.fn().mockRejectedValue(new Error("service down"))), {
      profile: "otlp",
      retries: 1,
      backoffMs: 1,
      ratePerSecond: 1000,
    });

    expect(() => exporter.enqueue(makeEvent())).not.toThrow();
    await eventually(() => expect(exporter.health().failed).toBe(1));
    const health = await exporter.flush();

    expect(health.sent).toBe(0);
    expect(health.failed).toBe(1);
    expect(health.state).toBe("degraded");
    expect(health.lastError).toBe("service down");
    expect(health.queued).toBe(0);
  });

  it("aborts a timed-out send and keeps local caller non-throwing", async () => {
    let receivedSignal: AbortSignal | undefined;
    const send = vi.fn((_batch: ExportBatch, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    const exporter = new BoundedExporter(makeTransport(send), {
      profile: "otlp",
      timeoutMs: 10,
      retries: 0,
      ratePerSecond: 1000,
    });

    exporter.enqueue(makeEvent());
    await eventually(() => expect(receivedSignal).toBeDefined());
    await eventually(() => expect(receivedSignal?.aborted).toBe(true));
    const health = await exporter.flush(100);

    expect(receivedSignal?.aborted).toBe(true);
    expect(health.failed).toBe(1);
    expect(health.state).toBe("degraded");
  });

  it("stops accepting events after close and does not throw", async () => {
    const send = vi.fn(async () => undefined);
    const exporter = new BoundedExporter(makeTransport(send), { profile: "otlp", ratePerSecond: 1000 });

    exporter.enqueue(makeEvent());
    await eventually(() => expect(send).toHaveBeenCalledTimes(1));
    const health = await exporter.close();
    expect(health.sent).toBe(1);
    expect(exporter.enqueue(makeEvent())).toBe(false);
    expect(exporter.health().dropped).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("closes cleanly after an active drain completes", async () => {
    let release!: () => void;
    const send = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const exporter = new BoundedExporter(makeTransport(send), {
      profile: "otlp",
      timeoutMs: 1000,
      retries: 0,
      ratePerSecond: 1000,
    });

    exporter.enqueue(makeEvent());
    await eventually(() => expect(send).toHaveBeenCalledTimes(1));
    release();
    await eventually(() => expect(exporter.health().sent).toBe(1));
    const health = await exporter.close();
    expect(health).toMatchObject({ state: "idle", sent: 1, queued: 0 });
  });
});

describe("OtlpHttpTransport", () => {
  it("rejects non-HTTPS endpoints", () => {
    expect(() => new OtlpHttpTransport("http://collector.test")).toThrow("HTTPS");
  });

  it("posts JSON with headers and forwards the abort signal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const signal = new AbortController().signal;
    const batch = {
      v: 1,
      resource: { serviceName: "canary", schema: "canary.export.v1" },
      events: [makeEvent()],
    } satisfies ExportBatch;

    await new OtlpHttpTransport("https://collector.test/v1/traces", { authorization: "Bearer test" }).send(batch, signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://collector.test/v1/traces",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test" },
        body: JSON.stringify(batch),
        signal,
      }),
    );
    fetchMock.mockRestore();
  });

  it("throws on non-success responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    await expect(new OtlpHttpTransport("https://collector.test").send({
      v: 1,
      resource: { serviceName: "canary", schema: "canary.export.v1" },
      events: [],
    }, new AbortController().signal)).rejects.toThrow("503");
    fetchMock.mockRestore();
  });
});

describe("profileEndpoint", () => {
  it("maps supported profiles and enforces HTTPS", () => {
    expect(profileEndpoint("otlp", "https://collector.test")).toBe("https://collector.test");
    expect(profileEndpoint("phoenix", "https://phoenix.test/")).toBe("https://phoenix.test/v1/traces");
    expect(profileEndpoint("langfuse", "https://langfuse.test")).toBe("https://langfuse.test/api/public/ingestion");
    expect(() => profileEndpoint("otlp", "http://collector.test")).toThrow("HTTPS");
  });
});
