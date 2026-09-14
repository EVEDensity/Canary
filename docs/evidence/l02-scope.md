# L-02 scope

- Date: 2026-09-14. Baseline: see execution record (captured before implementation).
- Goal: a local, durable control plane exposing lineage, measured quality versus agent claims, loaded experience, loop/budget/authorization, protected version-bound actions, fixed anchors, drift, holdout rotation and leakage audit; equivalent JSON CLI.
- Paths: packages/control-plane/** (new); packages/cli/**; apps/web/**; packages/policy/src/store.ts (protect control-plane evidence); workspace package/TypeScript references and lockfile; docs/evidence/l02-*; docs/guides/l02-control-plane.md; docs/roadmap/README.md; docs/roadmap/05-continuous-loop-and-ecosystem.md; docs/evidence/code-audit.md.
- Non-goals: L-03, external exporters, production deployment, automatic model calls, automatic loop start, replacing existing run UI, statistical significance or monotonic improvement promises.
- Compatibility: existing run artifacts remain unchanged/readable. Dedicated `canary control serve` is read-only unless explicitly granted a write token via environment. CLI uses the same service and version checks. UI never receives a startup credential.
- Writes: explicit actor/reason, expected resource revision and unique request ID; durable pending/completed/failed audit; pending operations after crash never replay automatically. Hard operations delegate to H-03 and recheck authorization/policy. No direct source application endpoint.
- Observation: fixed baseline fingerprint; compareRuns completeness/admission; measured metric series only when comparable; unavailable remains null. Holdout epochs record opaque dataset identities and audit exposure declarations plus observable overlap (not a proof of absence of leakage).
- Validation: package unit/integration tests, real browser interaction, pnpm build/test/typecheck/lint/demo:headless/format:check; demo remains 15/15; relevant POL refusal tests.
- Stop conditions: do not overwrite concurrent user changes, do not weaken security gates, do not claim unavailable browser/platform evidence. A blocked verification is recorded, not relabelled as passed.
- Rollback: disable the dedicated control server; revert this task's code only; retain .canary/control-plane and old artifacts. Never delete history as rollback.

## L-02 integration clarification

Acceptance review requires two narrow existing-path integrations: `packages/cli/src/index.ts` rechecks control-plane-bound soft approvals before activation; `packages/loop/src/controller.ts` observes a durable operator stop at async boundaries so an already-running controller cannot overwrite a stop from the control plane. These are L-02 control enforcement, not a new loop executor or automatic start. Add the associated loop tests to this task's write scope.
