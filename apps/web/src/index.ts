import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CoverageSummary, EvalResult } from "@canary/core";
import type { RunnerEvent } from "@canary/runner";

export interface ArtifactRepository {
  listRuns(): RunSnapshot[];
  readRun(runId: string): RunSnapshot | undefined;
  readCoverage(runId: string): CoverageSummary | undefined;
}

export class FileArtifactRepository implements ArtifactRepository {
  constructor(public readonly rootDir: string) {}
  listRuns(): RunSnapshot[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => this.readRun(e.name)).filter((r): r is RunSnapshot => Boolean(r)).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  }
  readRun(runId: string): RunSnapshot | undefined {
    const file = join(this.rootDir, runId, "run.json");
    if (!existsSync(file)) return undefined;
    try { return JSON.parse(readFileSync(file, "utf8")) as RunSnapshot; } catch { return undefined; }
  }
  readCoverage(runId: string): CoverageSummary | undefined {
    const file = join(this.rootDir, runId, "coverage.json");
    if (!existsSync(file)) return undefined;
    try { return JSON.parse(readFileSync(file, "utf8")) as CoverageSummary; } catch { return undefined; }
  }
}

export interface RunSnapshot {
  runId: string;
  status: "idle" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  totalCases: number;
  completedCases: number;
  passedCases: number;
  results: EvalResult[];
  coverage?: CoverageSummary;
  events: RunnerEvent[];
}

type Subscriber = ServerResponse<IncomingMessage>;

export class RunStore {
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly coverageFingerprints = new Map<string, string>();

  hydrate(repository: ArtifactRepository): void {
    for (const run of repository.listRuns()) {
      if (!this.runs.has(run.runId)) { const coverage = run.coverage ?? repository.readCoverage(run.runId); this.runs.set(run.runId, coverage ? { ...run, coverage } : run); }
    }
  }

  subscriberCount(runId: string): number { return this.subscribers.get(runId)?.size ?? 0; }

  create(totalCases: number, runId = `run_${randomUUID()}`): RunSnapshot {
    const snapshot: RunSnapshot = { runId, status: "running", startedAt: new Date().toISOString(), totalCases, completedCases: 0, passedCases: 0, results: [], events: [] };
    this.runs.set(runId, snapshot);
    this.publish(runId, { type: "run.started", runId, payload: snapshot });
    return snapshot;
  }

  get(runId: string): RunSnapshot | undefined { return this.runs.get(runId); }
  list(): RunSnapshot[] { return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

  update(runId: string, patch: Partial<RunSnapshot>): RunSnapshot {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const next = { ...current, ...patch };
    this.runs.set(runId, next);
    this.publish(runId, { type: "run.updated", runId, payload: next });
    return next;
  }

  appendEvent(runId: string, event: RunnerEvent): void {
    const current = this.runs.get(runId);
    if (!current) return;
    current.events.push(event);
    if (event.type === "execution.finished") {
      current.completedCases += 1;
      if (event.result.passed) current.passedCases += 1;
      current.results.push(event.result);
    }
    this.publish(runId, { type: event.type, runId, payload: event });
  }

  setCoverage(runId: string, coverage: CoverageSummary): void {
    const current = this.runs.get(runId);
    if (!current) return;
    const fingerprint = JSON.stringify(coverage);
    if (this.coverageFingerprints.get(runId) === fingerprint) return;
    this.coverageFingerprints.set(runId, fingerprint);
    current.coverage = coverage;
    this.publish(runId, { type: "coverage.updated", runId, payload: coverage });
  }

  finish(runId: string): RunSnapshot {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    current.status = current.results.every((result) => result.passed) ? "completed" : "failed";
    current.finishedAt = new Date().toISOString();
    this.publish(runId, { type: "run.finished", runId, payload: current });
    return current;
  }

  subscribe(runId: string, response: Subscriber): () => void {
    const set = this.subscribers.get(runId) ?? new Set<Subscriber>();
    set.add(response);
    this.subscribers.set(runId, set);
    const snapshot = this.get(runId);
    if (snapshot) this.writeEvent(response, { type: "run.snapshot", runId, payload: snapshot });
    let active = true;
    const unsubscribe = (): void => {
      if (!active) return;
      active = false;
      set.delete(response);
      if (set.size === 0) this.subscribers.delete(runId);
    };
    response.once("close", unsubscribe);
    return unsubscribe;
  }

  private publish(runId: string, event: { type: string; runId: string; payload: unknown }): void {
    for (const response of this.subscribers.get(runId) ?? []) this.writeEvent(response, event);
  }

  private writeEvent(response: Subscriber, event: { type: string; runId: string; payload: unknown }): void {
    if (response.writableEnded || response.destroyed) return;
    try { response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`); } catch { /* client disconnected */ }
  }
}

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>canary</title><style>body{font-family:system-ui;margin:0;background:#0b1120;color:#e2e8f0}main{max-width:1180px;margin:auto;padding:28px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:#172033;border:1px solid #2b3a55;border-radius:12px;padding:16px;margin:12px 0}.metric{font-size:28px;font-weight:700}.muted{color:#93a4bf}pre{white-space:pre-wrap;max-height:420px;overflow:auto;color:#bfdbfe}.ok{color:#86efac}.bad{color:#fca5a5}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}}</style></head><body><main><h1>canary</h1><p class="muted">Agent evaluation · runtime coverage · evidence-driven improvement</p><div class="grid"><div class="card"><div id="status" class="metric">idle</div><div class="muted">status</div></div><div class="card"><div id="progress" class="metric">0/0</div><div class="muted">cases</div></div><div class="card"><div id="passed" class="metric">0</div><div class="muted">passed</div></div><div class="card"><div id="latency" class="metric">—</div><div class="muted">latest latency</div></div></div><section class="card"><h2>Coverage</h2><div id="coverage">Waiting for coverage data…</div></section><section class="card"><h2>Feature chains</h2><div id="features">Waiting for feature coverage…</div></section><section class="card"><h2>Live events</h2><pre id="events">Connecting…</pre></section></main><script>const runId=new URLSearchParams(location.search).get('runId');const $=id=>document.getElementById(id);const log=x=>{$('events').textContent=JSON.stringify(x,null,2)+'\\n'+$('events').textContent};function render(s){$('status').textContent=s.status;$('progress').textContent=s.completedCases+'/'+s.totalCases;$('passed').textContent=s.passedCases;if(s.results?.length){$('latency').textContent=s.results.at(-1).metrics.latencyMs+'ms';$('features').insertAdjacentHTML('beforeend','<h3>Cases</h3>'+s.results.map(x=>'<div>'+x.caseId+': '+(x.passed?'passed':'failed')+' · '+x.coverage.lines.pct+'% lines</div>').join(''))}}
function coverage(c){$('coverage').innerHTML='<div>'+['lines','branches','functions','statements'].map(k=>k+': <b>'+c[k].pct+'%</b> ('+c[k].covered+'/'+c[k].total+')').join(' · ')+'</div>'+(c.files||[]).map(f=>'<div class=muted>'+f.filePath+' · '+f.status+' · '+(f.quality?.precision||'unknown')+'</div>').join('');$('features').innerHTML=(c.featureChains||[]).map(f=>'<div><b>'+f.name+'</b>: '+f.status+' · <b>'+f.coverage.pct+'%</b> ('+f.coverage.covered+'/'+f.coverage.total+')</div>').join('')||'No feature chains yet'}if(runId){const es=new EventSource('/api/runs/'+runId+'/events');es.addEventListener('run.snapshot',e=>render(JSON.parse(e.data)));es.addEventListener('run.updated',e=>render(JSON.parse(e.data)));es.addEventListener('coverage.updated',e=>coverage(JSON.parse(e.data)));es.onmessage=e=>log(JSON.parse(e.data));}else{$('events').textContent='No runId. Start with canary run.'}</script></body></html>`;

export function createWebServer(store: RunStore, host = "127.0.0.1", port = 0, artifactRoot?: string) {
  if (artifactRoot) store.hydrate(new FileArtifactRepository(resolve(artifactRoot)));
  const server = createServer((request: IncomingMessage, response: ServerResponse<IncomingMessage>) => {
    void handleRequest(store, request, response);
  });
  return { server, listen: () => new Promise<{ url: string; port: number }>((resolve) => server.listen(port, host, () => { const address = server.address(); const actualPort = typeof address === "object" && address ? address.port : port; resolve({ url: `http://${host}:${actualPort}`, port: actualPort }); })) };
}

async function handleRequest(store: RunStore, request: IncomingMessage, response: ServerResponse<IncomingMessage>): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html); return; }
  if (parts[0] === "api" && parts[1] === "runs" && parts.length === 2) { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(store.list())); return; }
  if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
    const runId = parts[2];
    const run = store.get(runId);
    if (!run) { response.writeHead(404); response.end("Not found"); return; }
    if (parts[3] === "events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const unsubscribe = store.subscribe(runId, response);
      request.on("close", unsubscribe);
      request.on("error", unsubscribe);
      return;
    }
    if (parts[3] === "coverage") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(run.coverage ?? null)); return; }
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(run)); return;
  }
  response.writeHead(404); response.end("Not found");
}





