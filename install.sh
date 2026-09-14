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

clone_