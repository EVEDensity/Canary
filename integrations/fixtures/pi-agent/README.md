# External runtime fixture

This fixture declares a pinned external runtime dependency. It does not bundle the runtime implementation.

Run the optional runtime check with `node scripts/verify-r6-pi.mjs --install`. Review the declared dependency before downloading it. Runtime installation and command validation are separate from inference validation.

Outputs belong in ignored `.canary/` directories. Keep credentials out of configuration, command arguments and committed artifacts.
