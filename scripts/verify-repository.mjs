#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const secretPatterns = [
  ["provider-key", /\bsk-(?:proj-|svcacct-|ant-(?:api\d+-)?)?[A-Za-z0-9_-]{32,}\b/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*[\r\n]+[A-Za-z0-9+/=]{20,}/g],
];
const textExtensions = /\.(?:[cm]?[jt]sx?|json|jsonl|ya?ml|md|txt|html|css|sh|ps1|py|toml|xml|svg)$/i;
export function inspectFile(path, content) {
  const issues = [];
  if (/(?:^|\/)\.env(?:\..*)?$/.test(path) && !/\.env\.(?:example|sample)$/.test(path))
    issues.push({ path, rule: "environment-file" });
  if (/\.(?:log|pem|key|p12|pfx)$/.test(path) || /(?:^|\/)(?:node_modules|dist|\.canary)\//.test(path))
    issues.push({ path, rule: "private-or-generated-file" });
  for (const [rule, expression] of secretPatterns) {
    for (const match of content.matchAll(new RegExp(expression)))
      issues.push({ path, rule, line: content.slice(0, match.index).split("\n").length });
  }
  if (/^(?:docs\/|README|CONTRIBUTING|SECURITY|\.github\/)/.test(path)) {
    for (const match of content.matchAll(/(?:[A-Z]:[\\/]+Users[\\/]+[^\s<>"'`/\\]+[\\/]|\/Users\/[^\s<>"'`/]+\/)/g))
      issues.push({ path, rule: "personal-path", line: content.slice(0, match.index).split("\n").length });
  }
  return issues;
}
export function inspectDocumentationLinks(root, path, content) {
  const issues = [];
  // Inspect rendered Markdown links and HTML assets; fenced examples are not repository references.
  const rendered = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const targets = [
    ...rendered.matchAll(/!?\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g),
    ...rendered.matchAll(/(?:href|src)="([^"\n]+)"/g),
  ].map((match) => match[1] ?? match[2]);
  for (const target of new Set(targets)) {
    if (!target || /^(?:#|\/\/|[a-z][a-z\d+.-]*:)/i.test(target)) continue;
    try {
      const name = decodeURIComponent(target.split(/[?#]/)[0]);
      if (!name) continue;
      const absolute = resolve(dirname(resolve(root, path)), name);
      const rel = relative(resolve(root), absolute);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || !existsSync(absolute))
        issues.push({
          path,
          rule: "broken-document-link",
          line: content.slice(0, content.indexOf(target)).split("\n").length,
        });
    } catch {
      issues.push({ path, rule: "invalid-document-link" });
    }
  }
  return issues;
}
export function auditRepository(root) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const issues = [];
  for (const path of files) {
    const absolute = resolve(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) {
      issues.push({ path, rule: "unsupported-tracked-file" });
      continue;
    }
    const content =
      textExtensions.test(path) || !path.split("/").at(-1).includes(".") ? readFileSync(absolute, "utf8") : "";
    issues.push(...inspectFile(path, content));
    if (path.endsWith(".md")) issues.push(...inspectDocumentationLinks(root, path, content));
  }
  return {
    kind: "canary.repository-audit",
    v: 1,
    scannedFiles: files.length,
    scope: "tracked working tree; recognized credential patterns and local documentation paths",
    issues,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditRepository(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    console.log(JSON.stringify(report));
    process.exitCode = report.issues.length ? 1 : 0;
  } catch {
    console.error("Repository inspection could not complete; inspect tracked files before publication.");
    process.exitCode = 1;
  }
}
