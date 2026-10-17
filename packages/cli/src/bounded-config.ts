import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { killProcessTree } from "@canary/runner";

function duration(maximumMs: number): number {
  if (!Number.isFinite(maximumMs) || maximumMs < 1)
    throw new Error("Configuration requires a finite positive execution duration");
  return Math.max(1, Math.min(600_000, Math.floor(maximumMs)));
}

/** The IPC supervisor stays responsive even when executable configuration blocks its Worker thread. */
export function configurationSupervisorSource(file: string, nonce: string, maximumMs: number): string {
  const timeoutMs = duration(maximumMs);
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm/api")).href;
  const workerSource = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{try{const url=(await import('node:url')).pathToFileURL(workerData.file).href;const mod=/\\.[cm]?tsx?$/.test(workerData.file)?await(await import(workerData.tsx)).tsImport(url,{parentURL:workerData.parentURL}):await import(url);const value=mod.default;const raw=value&&typeof value==='object'&&'default'in value?value.default:value;const body=JSON.stringify(raw);if(typeof body!=='string'||Buffer.byteLength(body)>1048576)throw Error('config budget');parentPort.postMessage({body});}catch{parentPort.postMessage({failed:true});}})();`;
  const isolation = pathToFileURL(createRequire(import.meta.url).resolve("@canary/isolation")).href;
  return `import {Worker} from 'node:worker_threads';import {finished} from 'node:stream/promises';import {killProcessTree} from ${JSON.stringify(isolation)};
if(!process.connected)process.exit(125);
const nonce=${JSON.stringify(nonce)}, worker=new Worker(${JSON.stringify(workerSource)},{eval:true,execArgv:[],workerData:${JSON.stringify({ file, tsx, parentURL: import.meta.url })},stdout:true,stderr:true});
let state='loading', outputBytes=0;
const stop=()=>{if(state==='stopped')return;state='stopped';void worker.terminate();killProcessTree(process.pid);process.exit(125)};
process.once('disconnect',stop);
const deadline=setTimeout(stop,${timeoutMs});
const output=chunk=>{outputBytes+=chunk.length;if(outputBytes>262144)stop()};
worker.stdout.on('data',output);worker.stderr.on('data',output);worker.once('error',stop);
worker.once('exit',()=>{if(state==='loading')stop()});
worker.on('message',message=>{if(state!=='loading'||!message||typeof message.body!=='string'||Buffer.byteLength(message.body)>1048576){stop();return}state='finishing';Promise.all([worker.terminate(),finished(worker.stdout),finished(worker.stderr)]).then(()=>{if(state!=='finishing')return;if(!process.connected){stop();return}state='sending';process.send({nonce,body:message.body},error=>{if(error){stop();return}state='stopped';clearTimeout(deadline);process.removeListener('disconnect',stop);process.exit(0)})},stop)});
if(!process.connected)stop();
`;
}

/** No log text or executable configuration exception crosses this boundary. */
export function loadBoundedConfiguration(file: string, signal: AbortSignal, maximumMs: number): Promise<unknown> {
  if (signal.aborted) return Promise.reject(new Error("Configuration load cancelled"));
  const nonce = randomUUID();
  return new Promise((accept, reject) => {
    const timeoutMs = duration(maximumMs);
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", configurationSupervisorSource(file, nonce, timeoutMs)],
      {
        cwd: dirname(file),
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let body: string | undefined,
      failed = false,
      outputBytes = 0;
    const abort = () => {
      failed = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) killProcessTree(child.pid);
    };
    const deadline = setTimeout(abort, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    const output = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 262_144) abort();
    };
    child.stdout?.on("data", output);
    child.stderr?.on("data", output);
    child.on("message", (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        !("nonce" in message) ||
        message.nonce !== nonce ||
        !("body" in message) ||
        typeof message.body !== "string" ||
        Buffer.byteLength(message.body) > 1_048_576 ||
        body !== undefined
      ) {
        abort();
        return;
      }
      body = message.body;
    });
    child.once("error", () => {
      failed = true;
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      if (failed || signal.aborted || code !== 0 || !body) {
        reject(new Error("Configuration did not finish within its bounded execution conditions"));
        return;
      }
      try {
        accept(JSON.parse(body));
      } catch {
        reject(new Error("Configuration did not return bounded JSON"));
      }
    });
    if (signal.aborted) abort();
  });
}
