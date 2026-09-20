/** Isolated worker source. Loaded via node -e; not a sandbox. */
export function createChildScript(): string {
  return String.raw`
const { Session } = require("node:inspector");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const proto = 1;
const send = (message) => new Promise((resolve) => {
  if (typeof process.send !== "function" || !process.connected) return resolve();
  const envelope = Object.assign({ v: proto }, message);
  let encoded = "";
  try { encoded = JSON.stringify(envelope); } catch { return resolve(); }
  const maxBytes = Number((JSON.parse(process.env.CANARY_WORKER_DATA || "{}")).ipcMaxBytes || 8388608);
  if (Buffer.byteLength(encoded) > maxBytes) {
    try { process.send({ v: proto, type: "error", error: "IPC payload exceeds maximum size" }, undefined, undefined, () => resolve()); } catch { resolve(); }
    return;
  }
  try { process.send(envelope, undefined, undefined, () => resolve()); } catch { resolve(); }
});
(async () => {
  const payload = JSON.parse(process.env.CANARY_WORKER_DATA || "{}");
  const useIstanbul = payload.coverageProvider === "istanbul";
  const session = new Session(); let coverageStarted = false; let scripts = []; let partial = false; let sampleTimer; let lastSampleAt = 0; let lastSampleKey = ""; let tools; let seq = 0; let coverageMod; let istanbulTmp;
  const minInterval = Number(payload.sampleMinIntervalMs || 200);
  const coverageMeta = () => ({ processId: process.pid, isolateId: String(process.pid), sequence: ++seq });
  const istanbulScripts = () => coverageMod ? coverageMod.istanbulToScripts(coverageMod.readIstanbulCoverage()) : [];
  const sample = async () => {
    const now = Date.now();
    if (now - lastSampleAt < minInterval) return;
    try {
      const next = useIstanbul ? istanbulScripts() : (coverageStarted ? ((await post("Profiler.takePreciseCoverage")).result || []) : []);
      if (!useIstanbul && !coverageStarted) return;
      const key = JSON.stringify(next.map((script) => ({ url: script.url, functions: script.functions })));
      if (key === lastSampleKey) return;
      lastSampleKey = key; lastSampleAt = now;
      await send(Object.assign({ type: "coverage", scripts: next, provisional: true, phase: "task" }, coverageMeta()));
    } catch {}
  };
  const keepAlive = setInterval(() => {}, 2_147_483_647);
  const post = (method, params) => new Promise((resolve, reject) => session.post(method, params || {}, (error, result) => error ? reject(error) : resolve(result)));
  try {
    if (!useIstanbul) {
      session.connect(); await post("Profiler.enable"); await post("Debugger.enable"); await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true }); coverageStarted = true;
    } else if (payload.coverageUrl) {
      coverageMod = await import(payload.coverageUrl);
    }
    const emit = (event) => send({ type: "event", event: { ...event, timestamp: new Date().toISOString() } });
    if (payload.sampleIntervalMs > 0) sampleTimer = setInterval(sample, payload.sampleIntervalMs);
    globalThis[Symbol.for("canary.feature.emit")] = (event) => emit(event);
    const adapters = payload.adaptersUrl ? await import(payload.adaptersUrl) : undefined;
    const environment = payload.environmentUrl ? await import(payload.environmentUrl) : undefined;
    const state = environment ? new environment.MemoryStateStore(payload.initialState || {}) : undefined;
    const model = adapters ? adapters.createModelProvider((payload.model && payload.model.provider) || "deterministic", payload.model && payload.model.responses) : undefined;
    let toolConfig = payload.tools;
    if (toolConfig && toolConfig.adapter === "mock" && toolConfig.entry) {
      const toolMod = await import(toolConfig.entry);
      const exported = toolMod[toolConfig.export || "default"];
      toolConfig = Object.assign({}, toolConfig, { tools: exported && typeof exported === "object" ? exported : {} });
    }
    tools = toolConfig && adapters ? await adapters.createToolAdapter(toolConfig) : undefined;
    let entryUrl = payload.entry;
    if (useIstanbul && coverageMod) {
      const entryPath = fileURLToPath(payload.entry);
      const instrumented = coverageMod.instrumentIstanbul(fs.readFileSync(entryPath, "utf8"), entryPath);
      istanbulTmp = path.join(process.env.CANARY_TMPDIR || os.tmpdir(), "canary-istanbul-" + process.pid + path.extname(entryPath));
      fs.writeFileSync(istanbulTmp, instrumented.code);
      entryUrl = pathToFileURL(istanbulTmp).href;
    }
    const mod = await import(entryUrl); const agent = mod[payload.exportName || "default"];
    if (typeof agent !== "function") throw new Error("Agent export is not a function");
    // Module-load window: sample then let V8 reset counters before the agent task.
    if (useIstanbul) {
      await send(Object.assign({ type: "coverage", scripts: istanbulScripts(), phase: "init" }, coverageMeta()));
    } else if (coverageStarted) {
      try {
        const init = await post("Profiler.takePreciseCoverage");
        await send(Object.assign({ type: "coverage", scripts: init.result || [], phase: "init" }, coverageMeta()));
      } catch {}
    }
    let seed = payload.reproducibility && payload.reproducibility.seed;
    const random = seed === undefined ? Math.random : () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const now = () => payload.reproducibility && payload.reproducibility.clock || new Date().toISOString();
    await send({ type: "ready" }); const value = await agent(payload.input, { executionId: payload.executionId, emit, tools, state, model, random, now, experiences: Array.isArray(payload.experiences) ? payload.experiences : [] }); await send({ type: "result", value });
  } catch (error) { partial = true; await send({ type: "error", error: error && (error.stack || error.message) || String(error) }); }
  finally {
    if (tools) try { await tools.close(); } catch {}
    clearInterval(keepAlive);
    if (sampleTimer) clearInterval(sampleTimer);
    if (useIstanbul) {
      scripts = istanbulScripts();
    } else if (coverageStarted) {
      try {
        const response = await post("Profiler.takePreciseCoverage"); scripts = response.result || [];
        scripts = await Promise.all(scripts.map(async (script) => {
          try { const source = await post("Debugger.getScriptSource", { scriptId: script.scriptId }); return { ...script, source: source.scriptSource }; }
          catch { return script; }
        }));
      } catch { partial = true; }
      try { await post("Profiler.stopPreciseCoverage"); } catch { partial = true; }
      try { await post("Profiler.disable"); await post("Debugger.disable"); } catch { partial = true; }
    }
    if (istanbulTmp) try { fs.unlinkSync(istanbulTmp); } catch {}
    try { delete globalThis[Symbol.for("canary.feature.emit")]; if (!useIstanbul) session.disconnect(); } catch {}
    await send(Object.assign({ type: "coverage", scripts, partial, phase: "final" }, coverageMeta())); if (process.connected) process.disconnect();
  }
})().catch(async (error) => { await send({ type: "error", error: error && (error.stack || error.message) || String(error) }); if (process.connected) process.disconnect(); });`;
}
