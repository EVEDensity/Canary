#!/usr/bin/env bash
# Canary global installer (macOS / Linux), using a source checkout.
set -euo pipefail

REPO_URL="${CANARY_REPO_URL:-https://github.com/EVEDensity/Canary.git}"
REPO_DIR="${CANARY_DIR:-$HOME/Canary}"
CANARY_REF="${CANARY_REF:-}"

usage() {
  cat <<'USAGE'
Canary installer (macOS / Linux, source checkout)

Usage:
  install.sh          Clone or update, then install the global canary command
  install.sh --update Pull the pinned/default ref and reinstall
  install.sh --help  Show this help

Environment:
  CANARY_REPO_URL  Override clone URL
  CANARY_DIR       Override clone destination (default: $HOME/Canary)
  CANARY_REF       Optional tag, branch, or commit to pin after cloning/updating

The installer refuses to overwrite a non-Git directory or update a dirty checkout.
Offline failures leave the existing installation untouched and print the Git/pnpm error.
USAGE
}

clone_or_update() {
  command -v git >/dev/null 2>&1 || { printf 'git is required but was not found on PATH.\n' >&2; exit 1; }
  if [[ -d "$REPO_DIR/.git" ]]; then
    if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
      printf 'Refusing to update dirty checkout: %s\n' "$REPO_DIR" >&2; exit 1
    fi
    printf '→ Updating existing checkout at %s\n' "$REPO_DIR"
    git -C "$REPO_DIR" pull --ff-only || { printf 'Offline/update failure: existing checkout was not rebuilt.\n' >&2; exit 1; }
  elif [[ -e "$REPO_DIR" ]]; then
    if [[ -n "$(find "$REPO_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      printf 'Refusing to overwrite non-Git directory: %s\n' "$REPO_DIR" >&2; exit 1
    fi
    git clone "$REPO_URL" "$REPO_DIR" || { printf 'Offline clone failure: no installation was registered.\n' >&2; exit 1; }
  else
    mkdir -p "$(dirname "$REPO_DIR")"
    printf '→ Cloning %s →