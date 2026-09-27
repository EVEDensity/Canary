import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

export type StructureKind = "workspace" | "app" | "package" | "directory" | "file" | "function" | "class";
export type RelationKind = "contains" | "imports" | "package-dependency" | "calls";
export interface StructureNode {
  id: string;
  kind: StructureKind;
  name: string;
  path: string;
  parentId?: string;
  symbol?: string;
  line?: number;
  endLine?: number;
  sourceHash?: string;
  layerId?: string;
}
export interface StructureEdge {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  provenance: "static" | "runtime" | "inferred";
  certainty: "resolved" | "inferred";
  at?: { path: string; line: number };
}
export interface ArchitectureLayer { id: string; name: string; paths: string[] }
export interface ArchitectureRules { forbiddenDependencies: Array<{ from: string; to: string; reason?: string }> }
export interface ArchitectureConfig { v: 1; layers: ArchitectureLayer[]; rules?: ArchitectureRules }
export interface StructureSnapshot {
  v: 1;
  kind: "canary.structure";
  capturedAt: string;
  source: { projectRoot: string; inventoryHash: string; gitCommit?: string; dirty?: boolean; runId?: string; state: "worktree" | "non-git" };
  configHash?: string;
  layers: ArchitectureLayer[];
  rules?: ArchitectureRules;
  nodes: StructureNode[];
  edges: StructureEdge[];
  unknown: Array<{ from: string; kind: "symbols" | "imports" | "package-dependency" | "calls"; target: string; reason: string }>;
  limits: { files: number; bytes: number; truncated: false };
}
export interface ChangeEntry {
  status: "added" | "modified" | "deleted" | "renamed";
  path: string;
  previousPath?: string;
  beforeId?: string;
  afterId?: string;
}
export interface StructureChange {
  v: 1;
  kind: "canary.structure-change";
  baseline: { ref: string; commit: string };
  current: StructureSnapshot["source"];
  entries: ChangeEntry[];
  scope: "tracked-and-untracked-worktree";
}

const EXCLUDED = new Set([".git", ".canary", "node_modules", "dist", "build", "coverage", ".next", ".venv", "venv", "__pycache__", "target", ".turbo"]);
const RECOGNIZED = /\.(?:[cm]?[jt]sx?|py|go|rs|json|toml|ya?ml)$/i;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/i;
const MAX_FILES = 10_000, MAX_BYTES = 256 * 1024 * 1024, MAX_FILE = 16 * 1024 * 1024;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const inventoryHash = (files: Array<{ path: string; bytes: Buffer }>) => hash(JSON.stringify(files.map((file) => [file.path, hash(file.bytes)])));
const id = (kind: StructureKind, path: string, symbol = "") => `${kind}:${hash(`${path}\0${symbol}`).slice(0, 20)}`;
const slash = (value: string) => value.split(sep).join("/");
const localPath = (root: string, file: string) => slash(relative(root, file));
const git = (root: string, args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
const gitCommit = (root: string): string | undefined => {
  try { const value = git(root, ["rev-parse", "--verify", "HEAD"]).trim(); return /^[a-f0-9]{40,64}$/.test(value) ? value : undefined; }
  catch { return undefined; }
};

function glob(pattern: string): RegExp {
  if (!pattern || pattern.startsWith("/") || pattern.includes("..") || pattern.includes("\\")) throw new Error(`Invalid architecture path pattern: ${pattern}`);
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*" && pattern[index + 1] === "*") { source += ".*"; index++; }
    else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function readArchitectureConfig(root: string): ArchitectureConfig | undefined {
  const file = join(root, "canary.architecture.json");
  if (!existsSync(file)) return undefined;
  if (lstatSync(file).isSymbolicLink() || statSync(file).size > 65_536) throw new Error("Architecture config must be a regular file under 64 KiB");
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || (value as ArchitectureConfig).v !== 1 || !Array.isArray((value as ArchitectureConfig).layers)) throw new Error("Invalid architecture config");
  const layers = (value as ArchitectureConfig).layers;
  if (layers.length > 32 || new Set(layers.map((item) => item.id)).size !== layers.length) throw new Error("Invalid architecture layers");
  for (const layer of layers) {
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(layer.id) || typeof layer.name !== "string" || !layer.name.trim() || !Array.isArray(layer.paths) || layer.paths.length > 32 || layer.paths.some((path) => typeof path !== "string")) throw new Error("Invalid architecture layer");
    layer.paths.forEach(glob);
  }
  const rules = (value as ArchitectureConfig).rules;
  if (rules !== undefined) {
    if (!rules || !Array.isArray(rules.forbiddenDependencies) || rules.forbiddenDependencies.length > 128) throw new Error("Invalid architecture rules");
    const ids = new Set(layers.map((layer) => layer.id));
    for (const rule of rules.forbiddenDependencies)
      if (!rule || !ids.has(rule.from) || !ids.has(rule.to) || (rule.reason !== undefined && (typeof rule.reason !== "string" || rule.reason.length > 512))) throw new Error("Invalid architecture rule layer or reason");
  }
  return { v: 1, layers, ...(rules ? { rules } : {}) };
}

function collect(root: string): Array<{ path: string; full: string; bytes: Buffer }> {
  const files: Array<{ path: string; full: string; bytes: Buffer }> = [];
  let size = 0;
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (!EXCLUDED.has(entry.name)) visit(full); continue; }
      if (!entry.isFile() || !(RECOGNIZED.test(entry.name) || entry.name === "go.mod") || entry.name.endsWith(".d.ts")) continue;
      const bytes = statSync(full).size;
      if (files.length >= MAX_FILES || bytes > MAX_FILE || size + bytes > MAX_BYTES) throw new Error("Structure inventory exceeds supported bounds");
      size += bytes;
      files.push({ path: localPath(root, full), full, bytes: readFileSync(full) });
    }
  };
  visit(root);
  return files;
}

interface PythonScan {
  declarations: Array<{ path: string; kind: "class" | "function"; name: string; symbol: string; parent: string; line: number; endLine: number }>;
  imports: Array<{ path: string; module: string; level: number; line: number }>;
  failures: Array<{ path: string; reason: string }>;
}

function scanPython(files: Array<{ path: string; bytes: Buffer }>): PythonScan | undefined {
  if (!files.length) return { declarations: [], imports: [], failures: [] };
  // Python's stdlib AST parses source without importing or executing project code.
  const script = `import ast,json,sys
data={"declarations":[],"imports":[],"failures":[]}
for item in json.load(sys.stdin):
 try:
  tree=ast.parse(item["source"],filename=item["path"])
  def visit(node,parent=""):
   current=parent
   if isinstance(node,(ast.ClassDef,ast.FunctionDef,ast.AsyncFunctionDef)):
    current=(parent+"." if parent else "")+node.name
    data["declarations"].append({"path":item["path"],"kind":"class" if isinstance(node,ast.ClassDef) else "function","name":node.name,"symbol":current,"parent":parent,"line":node.lineno,"endLine":getattr(node,"end_lineno",node.lineno)})
   elif isinstance(node,ast.ImportFrom):
    for alias in node.names: data["imports"].append({"path":item["path"],"module":node.module or alias.name,"level":node.level,"line":node.lineno})
   elif isinstance(node,ast.Import):
    for alias in node.names: data["imports"].append({"path":item["path"],"module":alias.name,"level":0,"line":node.lineno})
   for child in ast.iter_child_nodes(node): visit(child,current)
  visit(tree)
 except (SyntaxError,UnicodeError,OSError,ValueError) as error: data["failures"].append({"path":item["path"],"reason":type(error).__name__})
print(json.dumps(data,separators=(",",":")))`;
  for (const command of process.platform === "win32" ? ["python", "python3"] : ["python3", "python"]) {
    try {
      return JSON.parse(execFileSync(command, ["-I", "-c", script], { input: JSON.stringify(files.map((file) => ({ path: file.path, source: file.bytes.toString("utf8") }))), encoding: "utf8", timeout: 15000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] })) as PythonScan;
    } catch { /* Python is optional; the file hierarchy remains available. */ }
  }
  return undefined;
}

export function buildStructure(rootInput: string): StructureSnapshot {
  const root = resolve(rootInput);
  const files = collect(root);
  const config = readArchitectureConfig(root);
  const layerRules = (config?.layers ?? []).map((layer) => ({ layer, patterns: layer.paths.map(glob) }));
  const nodes: StructureNode[] = [{ id: id("workspace", "."), kind: "workspace", name: basename(root), path: "." }];
  const edges: StructureEdge[] = [];
  const unknown: StructureSnapshot["unknown"] = [];
  const byPath = new Map<string, StructureNode>([[".", nodes[0]!]]);
  const add = (node: StructureNode) => { nodes.push(node); byPath.set(node.path, node); if (node.parentId) edges.push({ id: `contains:${node.parentId}:${node.id}`, from: node.parentId, to: node.id, kind: "contains", provenance: "static", certainty: "resolved" }); };
  const ensureDirectory = (path: string): StructureNode => {
    if (byPath.has(path)) return byPath.get(path)!;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    const parentNode = ensureDirectory(parent);
    const name = path.split("/").at(-1)!;
    const marker = files.find((file) => ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"].some((name) => file.path === `${path}/${name}`));
    const kind: StructureKind = marker ? path.startsWith("apps/") || path.startsWith("services/") ? "app" : "package" : "directory";
    const node: StructureNode = { id: id(kind, path), kind, name, path, parentId: parentNode.id };
    add(node);
    return node;
  };
  for (const file of files) {
    const parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
    const layer = layerRules.find((rule) => rule.patterns.some((pattern) => pattern.test(file.path)))?.layer.id;
    add({ id: id("file", file.path), kind: "file", name: basename(file.path), path: file.path, parentId: ensureDirectory(parent).id, sourceHash: hash(file.bytes), ...(layer ? { layerId: layer } : {}) });
  }
  const programFiles = files.filter((file) => SCRIPT.test(file.path));
  const content = new Map(programFiles.map((file) => [resolve(file.full).toLowerCase(), file.bytes.toString("utf8")]));
  let compilerOptions: ts.CompilerOptions = {};
  const tsconfig = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (tsconfig && localPath(root, tsconfig) === "tsconfig.json") {
    const parsed = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (parsed.error) throw new Error("Cannot parse project TypeScript configuration");
    const options = ts.parseJsonConfigFileContent(parsed.config, ts.sys, root);
    // Missing input files is unrelated to resolving the supported inventory.
    if (options.errors.some((error) => error.code !== 18003)) throw new Error("Cannot resolve project TypeScript configuration");
    compilerOptions = options.options;
  }
  // This inventory resolves project declarations, not a full ambient typecheck.
  // Avoid loading the invoking repository's @types tree for each independent fixture.
  compilerOptions = { ...compilerOptions, types: [], allowJs: true, noLib: true, noEmit: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(compilerOptions);
  host.getCurrentDirectory = () => root;
  const read = host.readFile.bind(host);
  host.readFile = (file) => content.get(resolve(file).toLowerCase()) ?? read(file);
  const program = ts.createProgram(programFiles.map((file) => file.full), compilerOptions, host);
  const checker = program.getTypeChecker();
  const declarations = new Map<string, StructureNode>();
  const key = (source: ts.SourceFile, node: ts.Node) => `${resolve(source.fileName).toLowerCase()}:${node.getStart(source)}`;
  for (const file of programFiles) {
    const source = program.getSourceFile(file.full);
    if (!source) continue;
    const parentFile = byPath.get(file.path)!;
    const walk = (node: ts.Node, parent: StructureNode) => {
      let current = parent;
      let name: string | undefined, kind: "function" | "class" | undefined;
      if (ts.isClassDeclaration(node) && node.name) { name = node.name.text; kind = "class"; }
      else if (ts.isFunctionDeclaration(node) && node.name && node.body) { name = node.name.text; kind = "function"; }
      else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.body) { name = node.name.text; kind = "function"; }
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) { name = node.name.text; kind = "function"; }
      if (kind && name) {
        const symbol = parent.kind === "file" ? name : `${parent.symbol ?? parent.name}.${name}`;
        const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const end = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        current = { id: id(kind, file.path, symbol), kind, name, symbol, path: file.path, parentId: parent.id, line: start, endLine: end, ...(parentFile.layerId ? { layerId: parentFile.layerId } : {}) };
        nodes.push(current);
        edges.push({ id: `contains:${parent.id}:${current.id}`, from: parent.id, to: current.id, kind: "contains", provenance: "static", certainty: "resolved" });
        declarations.set(key(source, node), current);
      }
      ts.forEachChild(node, (child) => walk(child, current));
    };
    walk(source, parentFile);
  }
  const pythonFiles = files.filter((file) => file.path.endsWith(".py"));
  const python = scanPython(pythonFiles);
  if (!python && pythonFiles.length) for (const file of pythonFiles) unknown.push({ from: byPath.get(file.path)!.id, kind: "calls", target: file.path, reason: "python-ast-unavailable" });
  if (python) for (const file of pythonFiles) unknown.push({ from: byPath.get(file.path)!.id, kind: "calls", target: file.path, reason: "python-call-analysis-unavailable" });
  for (const file of files.filter((item) => /\.(go|rs)$/.test(item.path))) unknown.push({ from: byPath.get(file.path)!.id, kind: "symbols", target: file.path, reason: "symbol-parser-unavailable" });
  for (const failure of python?.failures ?? []) unknown.push({ from: byPath.get(failure.path)!.id, kind: "calls", target: failure.path, reason: `python-parse-${failure.reason}` });
  for (const declaration of python?.declarations ?? []) {
    const parent = declaration.parent ? nodes.find((node) => node.path === declaration.path && node.symbol === declaration.parent) : byPath.get(declaration.path);
    if (!parent) continue;
    const node: StructureNode = { id: id(declaration.kind, declaration.path, declaration.symbol), kind: declaration.kind, name: declaration.name, symbol: declaration.symbol, path: declaration.path, parentId: parent.id, line: declaration.line, endLine: declaration.endLine, ...(parent.layerId ? { layerId: parent.layerId } : {}) };
    nodes.push(node);
    edges.push({ id: `contains:${parent.id}:${node.id}`, from: parent.id, to: node.id, kind: "contains", provenance: "static", certainty: "resolved" });
  }
  const edgeKeys = new Set(edges.map((edge) => edge.id));
  const link = (from: StructureNode, to: StructureNode, kind: RelationKind, at?: { path: string; line: number }) => {
    const key = `${kind}:${from.id}:${to.id}:${at?.line ?? ""}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: key, from: from.id, to: to.id, kind, provenance: "static", certainty: "resolved", ...(at ? { at } : {}) });
  };
  const fileExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
  const resolveImport = (from: string, specifier: string) => {
    const resolvedModule = ts.resolveModuleName(specifier, join(root, from), compilerOptions, host).resolvedModule;
    if (resolvedModule) { const target = byPath.get(localPath(root, resolvedModule.resolvedFileName)); if (target?.kind === "file") return target; }
    if (!specifier.startsWith(".")) return undefined;
    const stem = slash(join(dirname(from), specifier));
    const mapped = stem.replace(/\.js$/, ".ts").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts");
    return [...fileExtensions.map((suffix) => `${stem}${suffix}`), mapped, mapped.replace(/\.ts$/, ".tsx")].map((path) => byPath.get(path)).find((value) => value?.kind === "file");
  };
  const externalNames = new Set<string>();
  const internalNames = new Set<string>();
  for (const file of files.filter((file) => basename(file.path) === "package.json")) {
    try {
      const manifest = JSON.parse(file.bytes.toString("utf8"));
      if (typeof manifest.name === "string") internalNames.add(manifest.name);
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) for (const name of Object.keys(manifest[field] ?? {})) externalNames.add(name);
    } catch { /* Package diagnostics below retain malformed manifests. */ }
  }
  const isExternal = (specifier: string) => {
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
    return specifier.startsWith("node:") || builtinModules.includes(specifier) || (!internalNames.has(name) && externalNames.has(name));
  };
  for (const file of programFiles) {
    const source = program.getSourceFile(file.full);
    if (!source) continue;
    if (program.getSyntacticDiagnostics(source).length) unknown.push({ from: byPath.get(file.path)!.id, kind: "symbols", target: file.path, reason: "syntax-analysis-failed" });
    const from = byPath.get(file.path)!;
    let unresolvedCalls = 0;
    const walk = (node: ts.Node, owner: StructureNode) => {
      let current = owner;
      const declared = declarations.get(key(source, node));
      if (declared) current = declared;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveImport(file.path, node.moduleSpecifier.text);
        if (target) link(from, target, "imports", { path: file.path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        else if (!isExternal(node.moduleSpecifier.text)) unknown.push({ from: from.id, kind: "imports", target: node.moduleSpecifier.text, reason: "local-module-unresolved" });
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        const shadowed = ts.isIdentifier(node.expression) && checker.getSymbolAtLocation(node.expression)?.declarations?.some((declaration) => content.has(resolve(declaration.getSourceFile().fileName).toLowerCase()));
        if (shadowed) unknown.push({ from: from.id, kind: "imports", target: "require binding", reason: "shadowed-module-loader" });
        else if (argument && ts.isStringLiteral(argument)) {
          const target = resolveImport(file.path, argument.text);
          if (target) link(from, target, "imports", { path: file.path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
          else if (!isExternal(argument.text)) unknown.push({ from: from.id, kind: "imports", target: argument.text, reason: "local-module-unresolved" });
        } else unknown.push({ from: from.id, kind: "imports", target: "dynamic module expression", reason: "dynamic-module-target" });
      }
      if (ts.isCallExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        const resolved = symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
        const target = resolved?.declarations?.map((declaration) => declarations.get(key(declaration.getSourceFile(), declaration))).find(Boolean);
        if (target) link(current, target, "calls", { path: file.path, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        else unresolvedCalls++;
      }
      ts.forEachChild(node, (child) => walk(child, current));
    };
    walk(source, from);
    if (unresolvedCalls) unknown.push({ from: from.id, kind: "calls", target: `${unresolvedCalls} call(s)`, reason: "outside-or-dynamic-target" });
  }
  for (const imported of python?.imports ?? []) {
    const from = byPath.get(imported.path)!;
    const base = imported.level ? dirname(imported.path).split("/").slice(0, Math.max(0, dirname(imported.path).split("/").length - imported.level + 1)).join("/") : "";
    const modulePath = slash(join(base || ".", imported.module.replaceAll(".", "/")));
    const target = byPath.get(`${modulePath}.py`) ?? byPath.get(`${modulePath}/__init__.py`);
    if (target?.kind === "file") link(from, target, "imports", { path: imported.path, line: imported.line });
    else if (imported.level) unknown.push({ from: from.id, kind: "imports", target: ".".repeat(imported.level) + imported.module, reason: "local-module-unresolved" });
  }
  const packageNodes = nodes.filter((node) => node.kind === "package" || node.kind === "app");
  for (const node of packageNodes) {
    const manifestLayer = byPath.get(`${node.path}/package.json`)?.layerId;
    const memberLayers = new Set(nodes.filter((member) => member.kind === "file" && member.path.startsWith(`${node.path}/`)).map((member) => member.layerId).filter((layer): layer is string => Boolean(layer)));
    if (manifestLayer) node.layerId = manifestLayer;
    else if (memberLayers.size === 1) node.layerId = [...memberLayers][0];
  }
  for (const node of packageNodes)
    for (const manifest of ["pyproject.toml", "Cargo.toml", "go.mod"])
      if (files.some((entry) => entry.path === `${node.path}/${manifest}`))
        unknown.push({ from: node.id, kind: "package-dependency", target: manifest, reason: "package-dependency-analysis-unavailable" });
  const packageNames = new Map<string, StructureNode>();
  for (const node of packageNodes) {
    const file = files.find((entry) => entry.path === `${node.path}/package.json`);
    if (!file) continue;
    try { const name: unknown = JSON.parse(file.bytes.toString("utf8")).name; if (typeof name === "string") packageNames.set(name, node); }
    catch { unknown.push({ from: node.id, kind: "package-dependency", target: "package.json", reason: "invalid-package-manifest" }); }
  }
  for (const node of packageNodes) {
    const file = files.find((entry) => entry.path === `${node.path}/package.json`);
    if (!file) continue;
    try {
      const packageJson = JSON.parse(file.bytes.toString("utf8")) as Record<string, Record<string, string>>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"])
        for (const name of Object.keys(packageJson[field] ?? {})) {
          const target = packageNames.get(name);
          if (target) link(node, target, "package-dependency");
        }
    } catch { /* reported by the package manifest pass */ }
  }
  const commit = gitCommit(root);
  let dirty: boolean | undefined;
  if (commit) try { dirty = Boolean(git(root, ["status", "--porcelain", "--untracked-files=normal", "--", "."]).trim()); } catch { dirty = undefined; }
  return {
    v: 1, kind: "canary.structure", capturedAt: new Date().toISOString(),
    source: { projectRoot: root, inventoryHash: inventoryHash(files), ...(commit ? { gitCommit: commit, dirty } : {}), state: commit ? "worktree" : "non-git" },
    ...(config ? { configHash: hash(readFileSync(join(root, "canary.architecture.json"))) } : {}),
    layers: config?.layers ?? [], ...(config?.rules ? { rules: config.rules } : {}), nodes, edges, unknown, limits: { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes.length, 0), truncated: false },
  };
}

function safeRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_./~^{}-]{0,127}$/.test(ref) || ref.startsWith("-") || ref.includes("..") || ref.includes("@{")) throw new Error("Invalid Git baseline ref");
  return ref;
}

export function compareStructure(rootInput: string, snapshot: StructureSnapshot, baselineRef: string): StructureChange {
  const root = resolve(rootInput), ref = safeRef(baselineRef);
  if (resolve(snapshot.source.projectRoot).toLowerCase() !== root.toLowerCase()) throw new Error("Structure snapshot belongs to another project");
  const commit = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Git baseline did not resolve to a commit");
  const raw = git(root, ["diff", "--name-status", "-z", "-M", commit, "--", "."]).split("\0");
  const entries: ChangeEntry[] = [];
  for (let index = 0; index < raw.length - 1;) {
    const code = raw[index++]!;
    if (!code) break;
    const status = code.startsWith("R") ? "renamed" : code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    const previousPath = status === "renamed" ? raw[index++] : undefined;
    const path = raw[index++]!;
    if (!path || path.startsWith(".canary/") || path.startsWith(".git/")) continue;
    entries.push({ status, path: slash(path), ...(previousPath ? { previousPath: slash(previousPath) } : {}), ...(status === "deleted" || !snapshot.nodes.some((node) => node.kind === "file" && node.path === slash(path)) ? {} : { afterId: id("file", slash(path)) }), ...(status === "renamed" || status === "deleted" || status === "modified" ? { beforeId: id("file", slash(previousPath ?? path)) } : {}) });
  }
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]).split("\0").filter(Boolean);
  const known = new Set(entries.map((entry) => entry.path));
  for (const path of untracked) if (!path.startsWith(".canary/") && !known.has(path)) entries.push({ status: "added", path: slash(path), ...(snapshot.nodes.some((node) => node.kind === "file" && node.path === slash(path)) ? { afterId: id("file", slash(path)) } : {}) });
  // Git does not pair an unstaged deletion with an untracked destination. Pair only
  // exact, unambiguous content matches; ambiguous or edited moves stay add/delete.
  const normalize = (value: string) => value.replace(/\r\n/g, "\n");
  const fingerprints = (status: ChangeEntry["status"]) => entries.filter((entry) => entry.status === status).map((entry) => {
    try { return { entry, value: hash(normalize(status === "deleted" ? git(root, ["show", `${commit}:${entry.path}`]) : readFileSync(join(root, entry.path), "utf8"))) }; }
    catch { return undefined; }
  }).filter((item): item is { entry: ChangeEntry; value: string } => Boolean(item));
  const deleted = fingerprints("deleted"), added = fingerprints("added");
  for (const before of deleted) {
    const matches = added.filter((after) => after.value === before.value);
    if (matches.length !== 1 || deleted.filter((item) => item.value === before.value).length !== 1) continue;
    const after = matches[0]!;
    before.entry.status = "renamed";
    before.entry.previousPath = before.entry.path;
    before.entry.path = after.entry.path;
    before.entry.afterId = after.entry.afterId;
    entries.splice(entries.indexOf(after.entry), 1);
  }
  if (gitCommit(root) !== snapshot.source.gitCommit || inventoryHash(collect(root)) !== snapshot.source.inventoryHash) throw new Error("Project source changed during structure comparison; retry the run");
  return { v: 1, kind: "canary.structure-change", baseline: { ref, commit }, current: snapshot.source, entries: entries.sort((a, b) => a.path.localeCompare(b.path)), scope: "tracked-and-untracked-worktree" };
}

export function linkCoverage(snapshot: StructureSnapshot, coverage: { files?: Array<{ filePath: string; sourceHash: string; status: string; lines: unknown; branches: unknown; uncoveredLocations?: unknown[] }> }, root: string) {
  const byPath = new Map(snapshot.nodes.filter((node) => node.kind === "file").map((node) => [node.path, node]));
  return (coverage.files ?? []).map((file) => {
    const path = localPath(resolve(root), resolve(file.filePath));
    const node = byPath.get(path);
    // Coverage stores a 16-character SHA-256 prefix; structure stores the full digest.
    const matches = Boolean(node?.sourceHash && /^[a-f0-9]{16}(?:[a-f0-9]{48})?$/.test(file.sourceHash) && node.sourceHash.startsWith(file.sourceHash));
    return { path, nodeId: node?.id, provenance: matches ? "runtime" : "unknown", status: !node ? "unmapped" : !matches ? "source-mismatch" : file.status, lines: file.lines, branches: file.branches, uncoveredLocations: matches ? file.uncoveredLocations ?? [] : [] };
  });
}

export * from "./analysis.js";
