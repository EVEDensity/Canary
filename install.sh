#!/usr/bin/env bash
# Canary global installer (macOS / Linux)
#
# Usage:
#   ./install.sh              Clone/update and install
#   ./install.sh --update     Pull latest changes and reinstall
#   ./install.sh --help
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/install.sh | bash
#
# Environment:
#   CANARY_REPO_URL  Override clone URL (default: official GitHub repo)
#   CANARY_DIR       Override clone destination (default: $HOME/Canary)

set -euo pipefail

REPO_URL="${CANARY_REPO_URL:-https://github.com/EVEDensity/Canary.git}"
REPO_DIR="${CANARY_DIR:-$HOME/Canary}"

usage() {
  cat <<'USAGE'
Canary installer (macOS / Linux)

Usage:
  install.sh            Clone or update, then install the global canary command
  install.sh --update   Pull latest changes and reinstall
  install.sh --help     Show this help

One-line install:
  curl -fsSL https://raw.githubusercontent.com/EVEDensity/Canary/main/install.sh | bash

Environment:
  CANARY_REPO_URL  Override clone URL
  CANARY_DIR       Override clone destination (default: $HOME/Canary)
USAGE
}

clone_or_update() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    printf '→ Updating existing checkout at %s\n' "$REPO_DIR"
    git -C "$REPO_DIR" pull --ff-only
  else
    printf '→ Cloning %s → %s\n' "$REPO_URL" "$REPO_DIR"
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone "$REPO_URL" "$REPO_DIR"
  fi
}

install_canary() {
  if [[ ! -f "$REPO_DIR/scripts/install-global.mjs" ]]; then
    printf 'Missing installer script at %s/scripts/install-global.mjs\n' "$REPO_DIR" >&2
    exit 1
  fi
  node "$REPO_DIR/scripts/install-global.mjs"
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      ;;
    --update)
      clone_or_update
      install_canary
      ;;
    "")
      clone_or_update
      install_canary
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
