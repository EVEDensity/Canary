# L-02 threat model

## Trust boundaries

The local project and configuration are trusted as in F/H. A remote web page, Agent text, candidate report, request payload and browser reader are not write authorities. The OS user controlling the project files remains trusted; this is not an OS sandbox or multi-tenant identity provider.

## Controls

- Bind dedicated HTTP server to 127.0.0.1; reject unexpected Host/Origin, disallow CORS, require JSON and bounded bodies, no credential in URL/page/storage, no-store and restrictive CSP.
- Read APIs return metadata and measured summaries, not raw prompts, holdout content, source diffs, authorization evidence or experience contents. Text is DOM textContent, never untrusted HTML.
- Write token is supplied explicitly through CANARY_CONTROL_TOKEN (minimum 32 characters); browser holds it in memory only. Read-only server cannot be upgraded from a request. CLI is an explicitly invoked local operator, not an unauthenticated HTTP bypass.
- Validate safe IDs, reject traversal and symlink/reparse path escapes. Compare expected hash against current evidence before action. Hard authorization is loaded from trusted local store, not accepted as a browser object.
- Serialize writes with exclusive lock; journal intent before side effect; persist atomic rename. A stale/pending journal requires explicit operator reconciliation and is never blindly retried. Duplicate request IDs with different bodies are rejected.
- Hard rollback preflights paths and file hashes so user edits are not overwritten. Soft rollback checks current activation ownership. Revoke/stop do not imply external side-effect rollback.
- Anchors pin evidence hashes. Changed or incomplete evidence produces unavailable/incomparable, not a false healthy score. Holdout leakage audit lists observable overlap and declared exposure; unknown provenance remains unknown.

## Residual boundaries

Other legacy CLI/process writers do not share the control-plane transaction lock. Re-read version-bound resources immediately before synchronous effects; do not claim cross-process serializability outside this service. OS compromise and direct edits by a trusted local owner are out of scope. No approval can authorize production deployment or remote push through this UI.
