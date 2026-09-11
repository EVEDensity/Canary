import type { EvalResult } from "@canary/core";
export function toJson(result: EvalResult): string { return JSON.stringify(result, null, 2); }
export function toMarkdown(result: EvalResult): string { return `# canary result\n\n- Case: ${result.caseId}\n- Passed: ${result.passed}\n`; }
