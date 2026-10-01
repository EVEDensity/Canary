# Support scope

## Requirements

Node.js 22+ and Git are required. Node.js 24 is recommended. Project dependencies, language runtimes and test services must be ready before checks run.

## Project checks

Automatic discovery supports declared Node.js build, type-check, lint, formatting and test scripts, plus standard Python, Go and Rust test entry points. Explicit Canary configuration takes priority. Custom checks use [project configuration](r4-project-checks.md).

## Architecture and coverage

TypeScript and JavaScript support detailed static structure. Other languages expose the available package, directory and file structure. Static dependencies do not represent observed runtime calls.

Line, function and branch coverage require a supported collector. Remote and black-box execution does not expose internal source coverage automatically. Uncollected or mismatched evidence is displayed as unavailable or unknown.

## Platform validation

Windows and Ubuntu containers have recorded verification. Native macOS and Ubuntu validation is scheduled through the release workflow; cross-platform support should be checked against the selected runtime and project tools.

## Reports and evidence

The CLI exports JSON, JUnit and Markdown. The report workspace supports live updates, history, issue diagnosis, architecture navigation and linked reruns. Artifacts are stored under the target project's `.canary/artifacts/`; logs belong under `.canary/logs/`.

See [installation](getting-started.md), [architecture maps](architecture-map.md) and [evidence integrity](r3-artifact-evidence.md).
