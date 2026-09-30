import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const directory = resolve("apps/web/locales"),
  source = JSON.parse(readFileSync(resolve(directory, "zh-CN.json"), "utf8"));
const [command = "check", locale] = process.argv.slice(2);
if (command === "add") {
  if (!locale || !/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(locale))
    throw Error("Usage: pnpm i18n:add <locale>, for example fr or ja");
  if (readdirSync(directory).includes(locale + ".json")) throw Error("Locale already exists");
  writeFileSync(
    resolve(directory, locale + ".json"),
    JSON.stringify(Object.fromEntries(Object.keys(source).map((key) => [key, ""])), null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(`Created ${locale}.json draft. Fill every value and run pnpm i18n:check before shipping.`);
} else if (command === "check") {
  const errors = [],
    placeholders = (value) =>
      [...value.matchAll(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g)]
        .map((item) => item[0])
        .sort()
        .join(",");
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
    const messages = JSON.parse(readFileSync(resolve(directory, filename), "utf8"));
    for (const key of Object.keys(source)) {
      if (typeof messages[key] !== "string" || !messages[key].length)
        errors.push(`${filename}: missing ${JSON.stringify(key)}`);
      else if (placeholders(messages[key]) !== placeholders(source[key]))
        errors.push(`${filename}: placeholder mismatch ${JSON.stringify(key)}`);
      else if (filename === "en.json" && /[\u3400-\u9fff]/.test(messages[key]))
        errors.push(`${filename}: untranslated Chinese value ${JSON.stringify(key)}`);
    }
    for (const key of Object.keys(messages))
      if (!(key in source)) errors.push(`${filename}: unexpected key ${JSON.stringify(key)}`);
  }
  const names = ["workspace-ui", "dashboard-ui", "architecture-map", "architecture-r12", "architecture-analysis"];
  for (const name of names) {
    const content = readFileSync(resolve(`apps/web/src/${name}.ts`), "utf8"),
      file = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const segments = ts.isTemplateExpression(node)
          ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
          : [node.text];
        const markup = segments.join("").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
        if (
          markup.includes("<!doctype") ||
          (ts.isVariableDeclaration(node.parent) && node.parent.name.getText(file).endsWith("Markup"))
        ) {
          for (const match of markup.matchAll(/>([^<>]*(?:[\u3400-\u9fff]|[A-Za-z]{3})[^<>]*)</g)) {
            const key = match[1].trim();
            if (key && !["canary", "Agent"].includes(key) && !(key in source))
              errors.push(`${name}: unregistered static message ${JSON.stringify(key)}`);
          }
          for (const match of markup.matchAll(/(?:title|aria-label|placeholder)="([^"]*[\u3400-\u9fff][^"]*)"/g))
            if (!(match[1] in source))
              errors.push(`${name}: unregistered accessible message ${JSON.stringify(match[1])}`);
        }
      }
      if (
        ts.isTaggedTemplateExpression(node) &&
        node.tag.getText(file) === "String.raw" &&
        ts.isNoSubstitutionTemplateLiteral(node.template)
      ) {
        const client = ts.createSourceFile(
          "client.js",
          node.template.getText(file).slice(1, -1),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.JS,
        );
        function scan(child) {
          if (ts.isStringLiteral(child) && /[\u3400-\u9fff]/.test(child.text)) {
            const parent = child.parent;
            const translated = ts.isCallExpression(parent) && ["t", "tfmt"].includes(parent.expression.getText(client));
            const semantic =
              (ts.isPropertyAssignment(parent) && parent.name === child) ||
              (ts.isCallExpression(parent) &&
                ts.isPropertyAccessExpression(parent.expression) &&
                ["includes", "startsWith", "endsWith", "indexOf", "match", "replace", "replaceAll", "test"].includes(
                  parent.expression.name.text,
                ));
            if (!translated && !semantic) errors.push(`${name}: untranslated UI literal ${JSON.stringify(child.text)}`);
          }
          if (
            ts.isCallExpression(child) &&
            ["t", "tfmt"].includes(child.expression.getText(client)) &&
            ts.isStringLiteral(child.arguments[0]) &&
            !(child.arguments[0].text in source)
          )
            errors.push(`${name}: unregistered UI message ${JSON.stringify(child.arguments[0].text)}`);
          ts.forEachChild(child, scan);
        }
        scan(client);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  // UI explanations also originate in server-side issue and comparison builders.
  for (const path of [
    "apps/web/src/project-issues.ts",
    "apps/web/src/workspace.ts",
    "apps/web/src/structure-diagnostics.ts",
    "packages/improvement/src/evidence-assessment.ts",
  ]) {
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    function scanServer(node) {
      if (ts.isStringLiteral(node) && /[\u3400-\u9fff]/.test(node.text) && !(node.text in source))
        errors.push(`${path}: unregistered server explanation ${JSON.stringify(node.text)}`);
      if (ts.isTemplateExpression(node) && /[\u3400-\u9fff]/.test(node.getText(file))) {
        let key = node.head.text;
        for (const span of node.templateSpans) {
          const expression = span.expression.getText(file);
          const name = ["missing.size", "matched.length"].includes(expression)
            ? "count"
            : expression === "MIN_MATCHED"
              ? "minimum"
              : expression === "check.exitCode"
                ? "code"
                : ts.isConditionalExpression(span.expression)
                  ? "status"
                  : undefined;
          key += `{${name ?? expression}}` + span.literal.text;
        }
        if (!(key in source)) errors.push(`${path}: unregistered server template ${JSON.stringify(key)}`);
      }
      ts.forEachChild(node, scanServer);
    }
    scanServer(file);
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Translation contracts verified: ${Object.keys(source).length} messages, ${readdirSync(directory).filter((name) => name.endsWith(".json")).length} locales.`,
    );
} else throw Error("Usage: pnpm i18n:check or pnpm i18n:add <locale>");
