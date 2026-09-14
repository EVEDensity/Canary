import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface PathGuardOptions {
  workspace: string;
  protect: string[];
  allow?: string[];
  realpath?: (file: string) => string;
  lstat?: (file: string) => { isSymbolicLink(): boolean; isDirectory(): boolean; nlink: number; ino: number; dev: number };
  protectedInodes?: Set<string>;
}

export class PolicyDenied extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyDenied";
    this.code = code;
  }
}

export function inodeKey(stat: { dev: number; ino: number }): string {
  return `${stat.dev}:${stat.ino}`;
}

export function normalizeRoot(root: string): string {
  return resolve(root).replace(/[/\\]+$/, "");
}

function underRoot(root: string, candidate: string): boolean {
  const base = normalizeRoot(root).toLowerCase();
  const value = normalizeRoot(candidate).toLowerCase();
  return value === base || value.startsWith(base + sep.toLowerCase()) || value.startsWith(base + "/");
}

export function collectInodes(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    let stat;
    try { stat = lstatSync(dir); } catch { return; }
    seen.add(inodeKey(stat));
    if (stat.isSymbolicLink()) {
      try { seen.add(inodeKey(statSync(dir))); } catch { /* dangling */ }
      return;
    }
    if (!stat.isDirectory()) return;
    for (const name of readdirSync(dir)) {
      walk(resolve(dir, name));
    }
  };
  for (const root of roots) walk(root);
  return seen;
}

function existingAncestor(file: string): string {
  let current = file;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

export function resolveExistingPath(file: string, realpath: (target: string) => string = (target) => realpathSync(target)): string {
  const absolute = isAbsolute(file) ? resolve(file) : resolve(file);
  const ancestor = existingAncestor(absolute);
  const realAncestor = existsSync(ancestor) ? realpath(ancestor) : ancestor;
  const tail = relative(ancestor, absolute);
  return tail ? resolve(realAncestor, tail) : realAncestor;
}

export class PathGuard {
  readonly workspace: string;
  readonly protect: string[];
  readonly allow: string[];
  readonly protectedInodes: Set<string>;
  private readonly realpath: (file: string) => string;
  private readonly lstat: (file: string) => { isSymbolicLink(): boolean; isDirectory(): boolean; nlink: number; ino: number; dev: number };

  constructor(options: PathGuardOptions) {
    this.workspace = normalizeRoot(options.workspace);
    this.protect = options.protect.map((item) => resolve(this.workspace, item));
    this.allow = (options.allow ?? ["**"]).map((item) => item);
    this.realpath = options.realpath ?? ((file) => realpathSync(file));
    this.lstat = options.lstat ?? ((file) => lstatSync(file));
    this.protectedInodes = options.protectedInodes ?? collectInodes(this.protect);
  }

  inspect(file: string): { real: string; symlink: boolean; inode?: string } {
    const absolute = resolve(this.workspace, file);
    if (existsSync(absolute)) {
      const st = this.lstat(absolute);
      const real = st.isSymbolicLink() ? this.realpath(absolute) : resolveExistingPath(absolute, this.realpath);
      return { real, symlink: st.isSymbolicLink(), inode: inodeKey(st) };
    }
    return { real: resolveExistingPath(absolute, this.realpath), symlink: false };
  }

  assertAllowed(file: string, action: "read" | "write" = "read"): string {
    if (file.includes("\0")) throw new PolicyDenied("POL-02", `nul byte in path: ${file}`);
    const absolute = resolve(this.workspace, file);
    const inspected = this.inspect(file);
    if (!underRoot(this.workspace, inspected.real) || !underRoot(this.workspace, absolute)) {
      throw new PolicyDenied("POL-02", `path escapes workspace: ${file}`);
    }
    for (const protectedRoot of this.protect) {
      if (underRoot(protectedRoot, inspected.real) || underRoot(protectedRoot, absolute)) {
        throw new PolicyDenied("POL-02", `protected path denied (${action}): ${file}`);
      }
    }
    if (inspected.inode && this.protectedInodes.has(inspected.inode)) {
      throw new PolicyDenied("POL-02", `hard link or alias to a protected inode: ${file}`);
    }
    if (existsSync(absolute)) {
      const st = this.lstat(absolute);
      if (st.isSymbolicLink() && !underRoot(this.workspace, this.realpath(absolute))) {
        throw new PolicyDenied("POL-02", `symlink escapes workspace: ${file}`);
      }
    }
    return inspected.real;
  }
}

export function contentHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function assertHostAllowed(url: string, allowHosts: string[]): string {
  const host = hostFromUrl(url);
  if (!allowHosts.some((allowed) => allowed.toLowerCase() === host || allowed === "*")) {
    throw new PolicyDenied("POL-03", `unauthorized host: ${host}`);
  }
  return host;
}

export function assertToolAllowed(name: string, allow: string[]): void {
  if (!allow.includes(name) && !allow.includes("*")) {
    throw new PolicyDenied("POL-03", `unauthorized tool: ${name}`);
  }
}
