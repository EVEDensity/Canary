# Feature Coverage

Feature coverage is **source-range hit rate**, not “the model understood the feature”.

1. Declare `features` in `canary.config.ts` with `id` and `files`.
2. Wrap Agent code in `feature(id, () => …)` from `@canary/coverage`.
3. Cases may set `expectedFeatures` and either `expect.coverage.atLeast(id, n)` or `expect.coverage().feature(id).atLeast(n)` / `.expected()`.

**Frozen v0.1 feature-chain gate semantics:** `mode: "source_pct"`, `partialDoesNotFail: true`. `partial` means the chain was reached but not every unit was hit. That does not fail the coverage gate unless `pct` is below `coverage.featureChains[id]`. A configured core feature with status `unavailable` fails the hard gate.

Unexecuted files in `coverage.include` stay in the denominator. Missing source maps become `partial` or fail closed, never 100%.

**Frozen v0.1 source-map precision:** `SOURCE_MAP_PRECISION = "approximate"` (token/segment granularity). Percentages are not Istanbul-exact.
