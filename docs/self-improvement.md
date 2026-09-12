# Self-improvement

canary’s loop is auditable. It does **not** write Agent source.

```text
run → attribution → suggestion (proposed)
    → accept / reject → verify (writes cases/regression draft)
    → human --entry candidate → compare vs baseline + holdout
```

CLI: `improve`, `suggest --accept|--reject|--verify`, `candidate --entry <fixed>`, `compare`.

Holdout cases (`tags: ["holdout"]`) must not regress. Unexpected policy, loops, and failed `state.*` remain hard gates on both baseline and candidate.
