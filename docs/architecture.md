# Architecture

canary is a local Agent evaluation console: isolated runs, traces, assertions, runtime coverage, and an improvement loop that never edits Agent source.

Package map: `core` contracts → `runner` + `adapters` + `environment` → `coverage` / `evaluators` / `trace` → `cli` + `web` → `improvement`.

Default Demo: `examples/local-agent` + root `cases/`. Additional examples: MCP, loop, recovery, HTTP, improvement-demo.

The design baseline (decision log, citations, risk table) is [`MVP-ARCHITECTURE-INITIAL-REPORT.md`](./MVP-ARCHITECTURE-INITIAL-REPORT.md). Implementation status: **v0.1 implemented in this repository**; that report’s original “尚未实现” header is historical.
