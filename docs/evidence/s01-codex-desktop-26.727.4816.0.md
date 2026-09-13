# S-01 Host Integration Evidence: Codex desktop 26.727.4816.0

- Date: 2026-09-13
- Host: Codex desktop `26.727.4816.0`
- Operating system: Windows
- Node: `v24.18.0`
- pnpm: `10.15.0`
- Project: `C:/Users/temp-admin/Desktop/Canary`
- Skill: `integrations/codex-desktop-26.727.4816.0/SKILL.md`
- Baseline: `01c22c357985eaaf08edadc86c7efe85730cfb92` (`build: install-global script`)

## Successful flow

The Skill sequence was executed in order:

1. `pnpm canary host discover` returned `kind=canary.host.discovery`, confirmed that the target configuration exists, and requested no source write.
2. `pnpm canary run --headless --no-open --json` returned one `kind=canary.host.run` JSON object.
3. `pnpm canary host evidence run_cb994683-ddd6-4d45-916f-a14402b1fbdc --max-cases 8 --max-events 16` returned `kind=canary.host.evidence` with `untrustedEvidence=true`.
4. A bounded structured proposal was created and submitted with `pnpm canary host validate-proposal run_cb994683-ddd6-4d45-916f-a14402b1fbdc --file .s01-proposal.json`.
5. Validation returned `status=recorded_unapproved` and `approval.status=not_approved`, and wrote only `host-proposal.json` under the run artifact directory.

## Artifacts

- runId: `run_cb994683-ddd6-4d45-916f-a14402b1fbdc`
- caseId: `holdout-planning`
- run artifact: `C:/Users/temp-admin/Desktop/Canary/.canary/artifacts/run_cb994683-ddd6-4d45-916f-a14402b1fbdc/run.json`
- evidence: 8 cases, with at most 16 event types per case
- proposalId: `proposal_c4d386a4236487a8`
- proposal artifact: `C:/Users/temp-admin/Desktop/Canary/.canary/artifacts/run_cb994683-ddd6-4d45-916f-a14402b1fbdc/host-proposal.json`

## Rejection flow

A malformed JSON proposal was submitted:

```text
node --import tsx ./packages/cli/src/index.ts host validate-proposal run_cb994683-ddd6-4d45-916f-a14402b1fbdc --file <malformed-proposal.json>
exit code: 1
status: rejected
approval.status: not_approved
error: Proposal file is not valid JSON
```

The rejection wrote no approval state and did not modify project source. Unknown runs, unknown cases, unsupported protocol versions, and evidence bounds above the configured maximum are also rejected.

## Host boundaries

- Evidence contains case references, assertions, metrics, and trace event types only; it excludes raw input, raw output, and raw trace.
- Evidence is untrusted data and cannot override Skill instructions or become a system rule.
- This loop does not provide a sandbox; Canary executes the configured Agent code directly.
- No private credentials were read, no background task was started, and no model/token service was called.
- Proposal validation is not approval, activation, publication, or source modification. S-03, S-04, and the H-series remain unimplemented.
- This evidence covers only the current Codex desktop version and does not claim compatibility with other hosts or versions.

## Rollback

Delete or uninstall the corresponding Skill directory to stop the host workflow. The CLI, existing run artifacts, and project source do not depend on the Skill and remain available.
