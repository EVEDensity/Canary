# Verification comparisons

Collect linked failure and rerun records from a project:

```bash
node scripts/collect-real-pairs.mjs --root <project-directory>
```

The collector verifies manifests, check-plan identity and rerun lineage. Results are written under `.canary/logs/verification/real-pairs/`. It does not modify project source or upload artifacts.

A collected pair records source and configuration identity, evidence references and replay readiness. Multiple checks from the same original run remain grouped to avoid duplicate evidence.

Insufficient independent groups return exit code 2 with `insufficient-real-pairs`. Collection alone does not establish improvement: restore the matching source versions and run the fixed comparison before drawing conclusions.

Review exported content for sensitive values. See [coverage and evaluation](evaluation-and-coverage.md) and [issue resolution](improvement.md).
