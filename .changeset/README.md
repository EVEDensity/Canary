# Changesets

1. `pnpm changeset` after a user-facing change.
2. `pnpm changeset version` updates CHANGELOG.md and package versions.
3. Commit, then `git tag vX.Y.Z` and push the tag.
4. `.github/workflows/release.yml` publishes with npm provenance and attaches the CLI tarball to the GitHub Release.

v0.1.0 is the current package version in this repository. Do not run `changeset version` until there is a post-0.1.0 change.
