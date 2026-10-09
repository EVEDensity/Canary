#!/usr/bin/env bash
# Canary global installer (macOS / Linux), using a source checkout.
set -euo pipefail

REPO_URL="${CANARY_REPO_URL:-https://github.com/EVEDensity/Canary.git}"
if [[ "$REPO_URL" =~ ^https?://[^/]*@ ]]; then printf 'Use external credential injection, not credentials in the clone URL.\n' >&2; exit 2; fi
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
  CANARY_CHANNEL   stable (default) or main development builds

Existing checkouts and the active installation are preserved during preparation.
Stable tags are selected by default; publication happens only after runtime validation.
USAGE
}

clone_or_update() {
  command -v git >/dev/null 2>&1 || { printf 'git is required but was not found on PATH.\n' >&2; exit 1; }
  if [[ -d "$REPO_DIR/.git" ]]; then
    REPO_DIR="${CANARY_INSTALL_HOME:-$HOME/.canary}/sources/setup-$(date +%s)-$$"
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone --branch main "$REPO_URL" "$REPO_DIR"
  elif [[ -e "$REPO_DIR" ]]; then
    if [[ -n "$(find "$REPO_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      printf 'Refusing to overwrite non-Git directory: %s\n' "$REPO_DIR" >&2; exit 1
    fi
    git clone "$REPO_URL" "$REPO_DIR" || { printf 'Offline clone failure: no installation was registered.\n' >&2; exit 1; }
  else
    mkdir -p "$(dirname "$REPO_DIR")"
    printf '→ Cloning %s → %s\n' "$REPO_URL" "$REPO_DIR"
    git clone "$REPO_URL" "$REPO_DIR" || { printf 'Offline clone failure: no installation was registered.\n' >&2; exit 1; }
  fi
  # Ref/channel selection happens in the transactional Node installer.
}
install_canary() {
  [[ -f "$REPO_DIR/scripts/install-global.mjs" ]] || { printf 'Missing installer script at %s/scripts/install-global.mjs\n' "$REPO_DIR" >&2; exit 1; }
  command -v node >/dev/null 2>&1 || { printf 'node is required but was not found on PATH.\n' >&2; exit 1; }
  node "$REPO_DIR/scripts/install-global.mjs"
}
case "${1:-}" in
  -h|--help) usage ;;
  ""|--update) clone_or_update; install_canary ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
esac
