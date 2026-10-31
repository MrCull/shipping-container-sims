#!/usr/bin/env bash
# Print the smoke specs (one name per line) that a diff needs, from scripts/smoke-map.txt.
# Usage: scripts/smoke-specs-for.sh [<base> <head>]   (default HEAD^1 HEAD, i.e. the last merge)
# Always includes the boot spec; a changed tests/browser/*.smoke.ts includes itself.
set -euo pipefail
cd "$(dirname "$0")/.."
files="$(git diff --name-only "${1:-HEAD^1}" "${2:-HEAD}")"
{
  echo 'terminal-twin\.smoke'
  echo "$files" | sed -nE 's#.*/tests/browser/([a-z0-9.-]+)\.smoke\.ts$#\1#p' | sed -E 's/\.prod$//'
  grep -vE '^[[:space:]]*(#|$)' scripts/smoke-map.txt | while IFS= read -r line; do
    pat="${line%% => *}"
    specs="${line#* => }"
    if echo "$files" | grep -qE "$pat"; then tr ' ' '\n' <<<"$specs"; fi
  done
} | sort -u
