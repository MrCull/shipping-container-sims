#!/usr/bin/env bash
# Runs only the unit tests that import a file changed since <base> (committed,
# staged, unstaged and untracked), via `vitest related`. Seconds, not minutes:
# the per-ticket test step in fast mode (docs/agents/implementing.md).
#
# Usage: scripts/test-related.sh [--allow-empty] [base]   (pnpm run test:related [--allow-empty] [base])
#   base           branch or commit to diff against. Default: on a merge commit, its first
#                  parent (so the files the merge brought in are tested); otherwise the
#                  merge-base with origin/main. Implementers pass their integration branch.
#   --allow-empty  exit 0 when no changed source file is found. Without it an empty run exits 1,
#                  so a comparison against the wrong base cannot pass as green.
# The first line of output always names the base used.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

allow_empty=0
base=""
for arg in "$@"; do
  case "$arg" in
    --allow-empty) allow_empty=1 ;;
    --) ;; # pnpm hands a literal `--` through (`pnpm run test:related -- --allow-empty`)
    -*) echo "test-related: unknown option $arg (usage: scripts/test-related.sh [--allow-empty] [base])" >&2; exit 2 ;;
    *)
      if [[ -n "$base" ]]; then echo "test-related: more than one base given" >&2; exit 2; fi
      base="$arg"
      ;;
  esac
done

if [[ -n "$base" ]]; then
  how="given"
elif git rev-parse --verify --quiet 'HEAD^2' >/dev/null; then
  base="HEAD^1"
  how="first parent of merge commit $(git rev-parse --short HEAD)"
else
  base="$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)"
  how="merge-base with origin/main"
fi
base="$(git rev-parse --verify --quiet "$base^{commit}")" || { echo "test-related: base '$base' is not a commit" >&2; exit 2; }
echo "test-related: base $(git rev-parse --short "$base") ($how)"

mapfile -t files < <(
  {
    git diff --name-only "$base"...HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | grep -E '\.(ts|vue|mjs|js)$' | grep -vE '\.smoke\.ts$' | sort -u |
    while read -r f; do [[ -f "$f" ]] && echo "$f"; done
)

# Shell scripts have no vitest import graph: a changed scripts/<name>.sh runs scripts/test-<name>.sh (a changed
# scripts/test-<name>.sh runs itself), so a ticket that only changes shell scripts still tests something (#192).
shell_tests=()
while read -r f; do
  [[ -n "$f" ]] || continue
  name="$(basename "$f" .sh)"
  name="${name#test-}"
  t="scripts/test-$name.sh"
  # this runner is scripts/test-related.sh: never run it from itself
  [[ "$t" == "scripts/test-related.sh" ]] && continue
  [[ -f "$t" ]] && shell_tests+=("$t")
done < <(
  {
    git diff --name-only "$base"...HEAD
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | grep -E '^scripts/[^/]+\.sh$' | sort -u
)
if [[ ${#shell_tests[@]} -gt 0 ]]; then
  mapfile -t shell_tests < <(printf '%s\n' "${shell_tests[@]}" | sort -u)
fi

run_shell_tests() {
  local t rc=0
  for t in "${shell_tests[@]}"; do
    echo "test-related: running $t"
    bash "$t" || rc=1
  done
  return $rc
}

if [[ ${#files[@]} -eq 0 && ${#shell_tests[@]} -gt 0 ]]; then
  echo "test-related: no changed source files, ${#shell_tests[@]} shell test(s) for changed scripts"
  run_shell_tests
  exit $?
fi

if [[ ${#files[@]} -eq 0 ]]; then
  if [[ $allow_empty -eq 1 ]]; then
    echo "test-related: no changed source files since $(git rev-parse --short "$base") (allowed by --allow-empty)"
    exit 0
  fi
  echo "test-related: no changed source files since $(git rev-parse --short "$base"); nothing was tested" >&2
  echo "test-related: exit 1 (pass --allow-empty when an empty run is expected)" >&2
  exit 1
fi

echo "test-related: ${#files[@]} changed source files since $(git rev-parse --short "$base")"
rc=0
pnpm exec vitest related --run "${files[@]}" || rc=$?
if [[ ${#shell_tests[@]} -gt 0 ]]; then run_shell_tests || rc=1; fi
exit $rc
