#!/usr/bin/env bash
# Runs only the unit tests that import a file changed since <base> (committed,
# staged, unstaged and untracked), via `vitest related`. Seconds, not minutes:
# the per-ticket test step in fast mode (docs/agents/implementing.md).
#
# Usage: scripts/test-related.sh [base]     (pnpm run test:related [base])
#   base  branch or commit to diff against; default: the merge-base with
#         origin/main. Implementers pass their integration branch.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

base="${1:-}"
if [[ -z "$base" ]]; then
  base="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)"
fi

mapfile -t files < <(
  {
    git diff --name-only "$base"...HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | grep -E '\.(ts|vue|mjs|js)$' | grep -vE '\.smoke\.ts$' | sort -u |
    while read -r f; do [[ -f "$f" ]] && echo "$f"; done
)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "test-related: no changed source files since $base"
  exit 0
fi

echo "test-related: ${#files[@]} changed files since $base"
exec pnpm exec vitest related --run "${files[@]}"
