#!/usr/bin/env bash
# Fail if ENGINE_VERSION on HEAD is lower than on a base ref (default: the first parent, i.e. the tip before a merge).
# Usage: scripts/check-engine-version.sh [base-ref]
set -euo pipefail
file=src/sims/terminal-twin/engine/simulation.ts
base="${1:-HEAD^1}"
version() { sed -n "s/^export const ENGINE_VERSION = '\(.*\)'.*/\1/p"; }
before="$(git show "$base:$file" | version)"
after="$(version < "$file")"
if [ "$(printf '%s\n%s\n' "$before" "$after" | sort -V | tail -1)" != "$after" ]; then
  echo "ENGINE_VERSION went backwards: $before ($base) -> $after. Keep the higher number in $file." >&2
  exit 1
fi
echo "ENGINE_VERSION $before -> $after"
