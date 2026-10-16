import ts from "typescript";

export interface TestAuditFinding {
  path: string;
  line?: number;
  type: string;
  certainty: "observed" | "advisory";
}

/** Only literal module bindings are recognized; project helpers and dynamic requires remain unknown. */
function importedRoot(module: string, member: string): string | undefined {
  if (/^(?:node:)?assert(?:\/strict)?$/.test(module))
    return ["default", "*", "strict", "assert"].includes(member) ? "assert" : `assert.${member}`;
  if (module === "node:test")
    return member === "default" ? "test" : member === "*" ? "nodeTest" : /^(?:test|it|describe|suite)$/.test(member) ? member : undefined;
  if (module === "vitest" || module === "@jest/globals")
    return ["default", "*"].includes(member) ? "testFramework" : /^(?:test|it|describe|suite|expect|assert)$/.test(member) ? member : undefined;
  return undefined;
}

function bindingContains(name: ts.BindingName, local: string): boolean {
  return ts.isIdentifier(name) ? name.text === local : name.elements.some(item => ts.isBindingElement(item) && bindingContains(item.name, local));
}

function testBindings(source: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  const add = (local: string, module: string, member: string) => {
    const root = importedRoot(module, member);
    if (root) bindings.set(local, root);
  };
  // A locally supplied require is not evidence of a Node module binding.
  const declaresRequire = source.statements.some(statement =>
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => bindingContains(item.name, "require"))) ||
    ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === "require") ||
    (ts.isImportDeclaration(statement) && (statement.importClause?.name?.text === "require" || (statement.importClause?.namedBindings && (ts.isNamespaceImport(statement.importClause.namedBindings) ? statement.importClause.namedBindings.name.text === "require" : statement.importClause.namedBindings.elements.some(item => item.name.text === "require"))))));
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const module = statement.moduleSpecifier.text;
      if (statement.importClause?.name) add(statement.importClause.name.text, module, "default");
      const names = statement.importClause?.namedBindings;
      if (names && ts.isNamedImports(names)) for (const item of names.elements) add(item.name.text, module, item.propertyName?.text ?? item.name.text);
      if (names && ts.isNamespaceImport(names)) add(names.name.text, module, "*");
      continue;
    }
    if (declaresRequire || !ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "require" || call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0]!)) continue;
      const module = call.arguments[0]!.text;
      if (ts.isIdentifier(declaration.name)) add(declaration.name.text, module, "default");
      else if (ts.isObjectBindingPattern(declaration.name)) for (const item of declaration.name.elements) {
        if (item.dotDotDotToken || item.initializer || !ts.isIdentifier(item.name)) continue;
        const member = item.propertyName;
        if (member && !ts.isIdentifier(member) && !ts.isStringLiteral(member)) continue;
        add(item.name.text, module, member?.text ?? item.name.text);
      }
    }
  }
  return bindings;
}

function canonicalCall(expression: string, bindings: Map<string, string>): string | undefined {
  const local = expression.match(/^[A-Za-z_$][\w$]*/)?.[0];
  const root = local && bindings.get(local);
  if (!local || !root) return undefined;
  let name = root + expression.slice(local.length);
  if (/^(?:nodeTest|testFramework)\./.test(name)) name = name.replace(/^(?:nodeTest|testFramework)\.(test|it|describe|suite|expect|assert)\b/, "$1");
  // node:test is both a callable default export and a namespace with named methods.
  name = name.replace(/^test\.(test|it|describe|suite)\b/, "$1");
  return /^(?:assert|expect|test|it|describe|suite)(?:\b|$)/.test(name) ? name : undefined;
}

function shadowedCall(node: ts.Node, local: string): boolean {
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isFunctionLike(parent) && parent.parameters.some(parameter => bindingContains(parameter.name, local))) return true;
    if (ts.isCatchClause(parent) && parent.variableDeclaration && bindingContains(parent.variableDeclaration.name, local)) return true;
    if (ts.isBlock(parent) && parent.statements.some(statement =>
      (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => bindingContains(item.name, local))) ||
      ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === local))) return true;
  }
  return false;
}

export function auditTestChanges(files: Array<{ path: string; before?: string; after?: string }>): TestAuditFinding[] {
  const findings: TestAuditFinding[] = [];
  const scan = (path: string, body: string) => {
    const source = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true);
    const calls: Array<{ name: string; text: string; line: number; skipped: boolean; unconditional: boolean }> = [];
    const bindings = testBindings(source);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source), local = expression.match(/^[A-Za-z_$][\w$]*/)?.[0];
        const expr = local && !shadowedCall(node, local) ? canonicalCall(expression, bindings) : undefined;
        if (expr)
          calls.push({
            name: expr,
            text: node.getText(source).replace(/\s+/g, " "),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            unconditional:
              /^assert(?:\.ok)?$/.test(expr) && node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword,
            skipped:
              /^(?:test|it|describe|suite)\b/.test(expr) && (/\.(?:skip|todo|only)\b/.test(expr) ||
              node.arguments.some(
                (arg) =>
                  ts.isObjectLiteralExpression(arg) &&
                  arg.properties.some(
                    (property) =>
                      ts.isPropertyAssignment(property) &&
                      property.name.getText(source).replace(/["']/g, "") === "skip" &&
                      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
                  ),
              )),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return calls;
  };
  for (const file of files) {
    if (!/(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path)) continue;
    if (file.before !== undefined && file.after === undefined) {
      findings.push({ path: file.path, type: "test-file-deleted", certainty: "observed" });
      continue;
    }
    const before = scan(file.path, file.before ?? ""),
      after = scan(file.path, file.after ?? "");
    for (const call of after.filter((call) => call.skipped))
      if (!before.some((old) => old.skipped && old.text === call.text))
        findings.push({ path: file.path, line: call.line, type: "skip-todo-or-only-added", certainty: "observed" });
    for (const call of after.filter((call) => call.unconditional))
      if (!before.some((old) => old.unconditional && old.text === call.text))
        findings.push({
          path: file.path,
          line: call.line,
          type: "unconditional-assertion-added",
          certainty: "observed",
        });
    const assertions = (calls: typeof before) => calls.filter((call) => /^(?:assert|expect)\b/.test(call.name));
    if (assertions(before).length > assertions(after).length)
      findings.push({ path: file.path, type: "assertion-count-reduced", certainty: "advisory" });
    else if (file.before && assertions(before).some((old) => !assertions(after).some((next) => old.text === next.text)))
      findings.push({ path: file.path, type: "assertion-semantics-changed", certainty: "advisory" });
  }
  return findings;
}
