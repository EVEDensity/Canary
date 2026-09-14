/** CommonJS isolation preload installed via node --require. Not an OS sandbox. */
export function createIsolationPreload(): string {
  return String.raw`
const fs = require("node:fs");
const path = require("node:path");
const origExists = fs.existsSync;
const origLstat = fs.lstatSync;
const origStat = fs.statSync;
const origRealpath = fs.realpathSync;
const origAppend = fs.appendFileSync;
const policy = JSON.parse(process.env.CANARY_ISOLATION || "{}");
const workspace = origRealpath(path.resolve(policy.workspace || process.cwd()));
const protect = (policy.protect || []).map((item) => path.resolve(workspace, item));
const protectInodes = new Set(policy.protectInodes || []);
const allowHosts = (policy.allowHosts || []).map((item) => String(item).toLowerCase());
function note(code, message) {
  if (policy.denialLog) {
    try { origAppend(policy.denialLog, JSON.stringify({ code, message, at: Date.now() }) + "\n"); } catch {}
  }
  const err = new Error(message);
  err.code = code;
  throw err;
}
function inodeKey(st) { return st.dev + ":" + st.ino; }
function under(root, candidate) {
  const a = path.resolve(root).replace(/[/\\]+$/, "").toLowerCase();
  const b = path.resolve(candidate).replace(/[/\\]+$/, "").toLowerCase();
  const sep = path.sep.toLowerCase();
  return b === a || b.startsWith(a + sep) || b.startsWith(a + "/");
}
function existingAncestor(file) {
  let current = file;
  while (!origExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}
function realTarget(file) {
  const absolute = path.resolve(workspace, String(file));
  if (origExists(absolute)) {
    try {
      const st = origLstat(absolute);
      if (st.isSymbolicLink()) return origRealpath(absolute);
    } catch {}
    try { return origRealpath(absolute); } catch { return absolute; }
  }
  const ancestor = existingAncestor(absolute);
  try {
    const realAncestor = origExists(ancestor) ? origRealpath(ancestor) : ancestor;
    const tail = path.relative(ancestor, absolute);
    return tail ? path.resolve(realAncestor, tail) : realAncestor;
  } catch { return absolute; }
}
function assertPath(file) {
  if (file == null) return;
  const raw = typeof file === "string" ? file : (typeof URL !== "undefined" && file instanceof URL ? file.pathname : String(file));
  if (raw.includes("\0")) note("POL-02", "nul byte in path");
  const absolute = path.resolve(workspace, raw);
  const real = realTarget(raw);
  if (!under(workspace, real) || !under(workspace, absolute)) note("POL-02", "path escapes workspace: " + raw);
  for (const item of protect) {
    if (under(item, real) || under(item, absolute)) note("POL-02", "protected path denied: " + raw);
  }
  try {
    if (origExists(absolute)) {
      const st = origLstat(absolute);
      if (protectInodes.has(inodeKey(st))) note("POL-02", "hard link or alias to a protected inode: " + raw);
      if (st.isSymbolicLink() && !under(workspace, origRealpath(absolute))) note("POL-02", "symlink escapes workspace: " + raw);
    }
  } catch (error) {
    if (error && error.code && String(error.code).startsWith("POL-")) throw error;
  }
}
function wrap(obj, name) {
  const orig = obj[name];
  if (typeof orig !== "function") return;
  obj[name] = function(first) {
    if (typeof first === "string" || Buffer.isBuffer(first) || (typeof URL !== "undefined" && first instanceof URL)) {
      assertPath(first);
    }
    return orig.apply(this, arguments);
  };
}
const skip = new Set(["existsSync","exists","lstat","lstatSync","stat","statSync","fstat","fstatSync","realpath","realpathSync","close","closeSync","read","readSync","write","writeSync","fchmod","fchmodSync","futimes","futimesSync"]);
const fsNames = ["access","accessSync","appendFile","appendFileSync","chmod","chmodSync","copyFile","copyFileSync","createReadStream","createWriteStream","mkdir","mkdirSync","open","openSync","opendir","opendirSync","readdir","readdirSync","readFile","readFileSync","rename","renameSync","rm","rmSync","rmdir","rmdirSync","truncate","truncateSync","unlink","unlinkSync","writeFile","writeFileSync","link","linkSync","symlink","symlinkSync","cp","cpSync"];
for (const name of fsNames) if (!skip.has(name)) wrap(fs, name);
if (fs.promises) {
  for (const name of Object.keys(fs.promises)) {
    if (!skip.has(name) && typeof fs.promises[name] === "function") wrap(fs.promises, name);
  }
}
const cp = require("node:child_process");
function denySpawn() { note("POL-03", "background child processes are not permitted inside isolation"); }
for (const name of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"]) {
  cp[name] = denySpawn;
}
function hostOf(input) {
  try { return new URL(String(input)).hostname.toLowerCase(); } catch { return String(input || "").toLowerCase(); }
}
function assertHost(input) {
  const host = hostOf(input);
  if (!host) return;
  if (!allowHosts.includes(host) && !allowHosts.includes("*")) note("POL-03", "unauthorized host: " + host);
}
const http = require("node:http");
const https = require("node:https");
function wrapRequest(mod) {
  const orig = mod.request;
  const origGet = mod.get;
  mod.request = function(url) {
    const target = typeof url === "string" ? url : (url && (url.href || url.hostname || url.host));
    if (target) assertHost(String(target).includes("://") ? target : ("http://" + target));
    return orig.apply(this, arguments);
  };
  mod.get = function(url) {
    const target = typeof url === "string" ? url : (url && (url.href || url.hostname || url.host));
    if (target) assertHost(String(target).includes("://") ? target : ("http://" + target));
    return origGet.apply(this, arguments);
  };
}
wrapRequest(http);
wrapRequest(https);
if (typeof globalThis.fetch === "function") {
  const origFetch = globalThis.fetch;
  globalThis.fetch = function(input) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    assertHost(url);
    return origFetch.apply(this, arguments);
  };
}
try {
  const net = require("node:net");
  const origConnect = net.connect;
  const origCreate = net.createConnection;
  function netHost(args) {
    if (typeof args[0] === "object" && args[0]) return args[0].host || args[0].hostname || "";
    if (typeof args[1] === "string") return args[1];
    return "";
  }
  net.connect = function() { const host = netHost(arguments); if (host) assertHost("http://" + host); return origConnect.apply(this, arguments); };
  net.createConnection = function() { const host = netHost(arguments); if (host) assertHost("http://" + host); return origCreate.apply(this, arguments); };
} catch {}
`;
}
