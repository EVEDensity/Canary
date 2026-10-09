import ts from "typescript";

export interface TestAuditFinding {
  path: string;
  line?: number;
  type: string;
  certainty: "observed" | "advisory";
}
export function auditTestChanges(files: Array<{ path: string; before?: string; after?: string }>): TestAuditFinding[] {
  const findings: TestAuditFinding[] = [];
  const scan = (path: string, body: string) => {
    const source = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true);
    const calls: Array<{ name: string; text: string; line: number; skipped: boolean; unconditional: boolean }> = [];
    const imported = new Set<string>();
    for (const statement of source.statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /^(?:node:)?assert(?:\/strict)?$|^node:test$|^vitest$|^@jest\/globals$/.test(statement.moduleSpecifier.text)
      ) {
        if (statement.importClause?.name) imported.add(statement.importClause.name.text);
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) imported.add(item.name.text);
        if (bindings && ts.isNamespaceImport(bindings)) imported.add(bindings.name.text);
      }
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression.getText(source),
          root = expr.match(/^[A-Za-z_$][\w$]*/)?.[0];
        if (root && imported.has(root))
          calls.push({
            name: expr,
            text: node.getText(source).replace(/\s+/g, " "),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            unconditional:
              /^(?:assert|strict)(?:\.ok)?$/.test(expr) && node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword,
            skipped:
              /\.(?:skip|todo|only)\b/.test(expr) ||
              node.arguments.some(
                (arg) =>
                  ts.isObjectLiteralExpression(arg) &&
                  arg.properties.some(
                    (property) =>
                      ts.isPropertyAssignment(property) &&
                      property.name.getText(source).replace(/["']/g, "") === "skip" &&
                      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
                  ),
              ),
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
    const assertions = (calls: typeof before) => calls.filter((call) => /assert|expect/.test(call.name));
    if (assertions(before).length > assertions(after).length)
      findings.push({ path: file.path, type: "assertion-count-reduced", certainty: "advisory" });
    else if (file.before && assertions(before).some((old) => !assertions(after).some((next) => old.text === next.text)))
      findings.push({ path: file.path, type: "assertion-semantics-changed", certainty: "advisory" });
  }
  return findings;
}
