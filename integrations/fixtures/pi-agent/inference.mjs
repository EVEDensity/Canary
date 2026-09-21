import assert from "node:assert/strict";
import { join } from "node:path";

// Opt-in fixture. The driver supplies an isolated pinned SDK and environment.
export default async function inference(input, ctx) {
  assert.ok(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY was not supplied");
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(
    process.env.CANARY_PI_MODULE
  );
  const modelId = process.env.CANARY_PI_MODEL;
  assert.ok(modelId, "An explicit model is required");
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const originalFetch = globalThis.fetch;
  let calls = 0,
    httpStatus,
    responseModel,
    requestId,
    responseRead;
  const deadline = AbortSignal.timeout(60_000);
  globalThis.fetch = async (resource, init) => {
    const request = new Request(resource, init),
      url = new URL(request.url);
    assert.equal(url.origin, "https://api.deepseek.com", "Unexpected outbound origin");
    assert.ok(["/chat/completions", "/v1/chat/completions"].includes(url.pathname));
    assert.equal(request.method, "POST");
    assert.equal(calls, 0, "One-request inference budget exhausted; retry not sent");
    const payload = JSON.parse(await request.text());
    assert.equal(payload.model, modelId);
    assert.ok(!payload.tools?.length, "Tools must be disabled");
    assert.ok(JSON.stringify(payload.messages).length < 8000, "Prompt exceeds smoke-test budget");
    payload.max_tokens = 128;
    delete payload.max_completion_tokens;
    payload.thinking = { type: "disabled" };
    payload.temperature = 0;
    calls++;
    ctx.emit({ type: "pi.request", provider: "deepseek", model: modelId, maxOutputTokens: 128 });
    const response = await originalFetch(url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.any([deadline, request.signal]),
    });
    httpStatus = response.status;
    requestId = response.headers.get("x-request-id") ?? undefined;
    responseRead = response
      .clone()
      .text()
      .then((body) => {
        for (const line of body.split("\n")) {
          try {
            const row = JSON.parse(line.replace(/^data:\s*/, ""));
            if (row.model) responseModel = row.model;
          } catch {
            /* SSE framing */
          }
        }
      });
    return response;
  };
  let session;
  try {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
      signal: deadline,
    });
    modelRuntime.registerProvider("canary-deepseek", {
      baseUrl: "https://api.deepseek.com",
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"],
          contextWindow: 8192,
          maxTokens: 128,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    await modelRuntime.setRuntimeApiKey("canary-deepseek", process.env.DEEPSEEK_API_KEY, { signal: deadline });
    const model = modelRuntime.getModel("canary-deepseek", modelId);
    assert.ok(model, "Selected model could not be registered");
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 },
    });
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => "Follow the user instruction exactly. This is a minimal integration smoke test.",
    });
    await loader.reload();
    ({ session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir,
      model,
      modelRuntime,
      thinkingLevel: "off",
      noTools: "all",
      tools: [],
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    }));
    await session.prompt(String(input));
    await responseRead;
    const assistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    assert.ok(
      assistant && assistant.stopReason !== "error" && assistant.stopReason !== "aborted",
      `Pi inference did not complete (HTTP ${httpStatus ?? "not sent"})`,
    );
    assert.equal(calls, 1);
    assert.equal(httpStatus, 200);
    const { cost: _estimatedCost, ...usage } = assistant.usage;
    // Custom model prices are placeholders, so no monetary estimate is reported.
    ctx.emit({
      type: "pi.inference",
      provider: "deepseek",
      requestedModel: modelId,
      responseModel,
      requestId,
      modelCalls: calls,
      httpStatus,
      usage,
      cost: null,
      stopReason: assistant.stopReason,
    });
    return session.getLastAssistantText()?.trim();
  } catch (error) {
    ctx.emit({ type: "pi.failure", modelCalls: calls, httpStatus, model: modelId });
    throw error;
  } finally {
    session?.dispose();
    globalThis.fetch = originalFetch;
  }
}
