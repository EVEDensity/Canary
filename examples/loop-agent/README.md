# loop-agent example

Shows expected loop detection versus a clean path that must not loop. Unexpected loops still fail the hard gate; `loop-stop` requires `loop_detected`.

```bash
pnpm canary -- run --headless --no-open --config examples/loop-agent/canary.config.ts
```
