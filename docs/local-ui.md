# Local UI

`canary run` serves Overview, Run Timeline, Feature Coverage, Case Detail, Improvement Queue, and Compare.

Live updates use SSE (`/api/runs/:id/events`) with `Last-Event-ID` resume. After repeated disconnects the page polls `/api/runs/:id` and shows a banner. Without JavaScript the server inlines a snapshot (`Snapshot (no JavaScript)`).

Status colors are shared for run, case, coverage, and feature:

`idle` · `running` · `completed` / `covered` / `final` · `failed` / `uncovered` · `cancelled` · `partial` / `provisional` · `unavailable` · `preparing`

`--headless` still binds a port then closes it. `--no-open` skips the browser.
