# Replay

```powershell
pnpm canary -- replay <runId> --headless --no-open
```

Replay re-executes the same case ids. The new snapshot stores `replayOf`. UI Replay posts `/api/runs/:id/replay` and navigates to the new run when the CLI hook executes it.

Replay is not a byte-for-byte trace player. Timing and coverage can differ; assertions still apply.
