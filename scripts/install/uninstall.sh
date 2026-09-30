#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Canary uninstaller (macOS / Linux)

Usage:
  uninstall.sh                 Remove launcher and registration; preserve project/evidence
  uninstall.sh --remove-root  Also remove the registered installation checkout
  uninstall.sh --help          Show this help
USAGE
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  ""|--remove-root) ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/../uninstall-global.mjs" "$@"
