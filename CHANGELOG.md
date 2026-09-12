# Changelog

## 0.1.0

Local Agent evaluation runtime: Function / HTTP / MCP adapters, V8 coverage, feature chains, CLI, local UI, improvement loop, and CI.

- `canary run` / `replay` / `improve` / `suggest` / `candidate` / `compare`
- Deterministic evaluators, optional LLM-as-Judge (`judge.score` never passes on error/timeout/low confidence)
- Hard gates: unexpected policy violations, unexpected loops, failed state assertions, unavailable core features
- Docs under `docs/`, GitHub Actions for lint, Node 22/24, coverage fixtures, three demos, Bun smoke, and pack/bin verification
- Release path: changeset → tag `v0.1.0` → provenance publish (requires `NPM_TOKEN`)
