#!/usr/bin/env bash
# Merge a finished ticket branch into the current integration branch and verify it.
# Usage: scripts/merge-ticket.sh [--push] [--smoke | --smoke-all] tt/<N>-<slug>
# Output goes to the terminal and to .merge-ticket.log; the last line is "EXIT <code>", so a background run
# is finished when `tail -1 .merge-ticket.log` shows it. --push pushes the integration branch after a verified merge.
# Smoke specs do not run per merge: the spec's final ticket runs the whole suite once, after every other ticket is merged.
# --smoke runs only the specs for the paths this merge changed (scripts/smoke-specs-for.sh, map in scripts/smoke-map.txt);
# --smoke-all runs every dev spec except @load (about 40 minutes).
# An ENGINE_VERSION-only conflict in the engine simulation module is resolved by the script (higher version, minor +1).
# Stops (without committing) on any other conflict, conflict markers or a failed check. A verified merge then sets the
# ticket's row in handover.md to "merged in branch (<merge sha>)" and commits that alone (tested by
# scripts/test-merge-ticket.sh). The GitHub merged-in-branch label stays a manual step (docs/agents/implementing.md).
set -euo pipefail
if [ -z "${MERGE_TICKET_LOGGING:-}" ]; then
  export MERGE_TICKET_LOGGING=1
  set +e
  "$0" "$@" 2>&1 | tee .merge-ticket.log
  code=${PIPESTATUS[0]}
  echo "EXIT $code" | tee -a .merge-ticket.log
  exit "$code"
fi
push="" smoke=""
while [ "${1:-}" = "--push" ] || [ "${1:-}" = "--smoke" ] || [ "${1:-}" = "--smoke-all" ]; do
  case "$1" in --push) push=1 ;; --smoke) smoke=${smoke:-sel} ;; --smoke-all) smoke=all ;; esac
  shift
done
branch="${1:?usage: scripts/merge-ticket.sh <ticket-branch>}"

# The ticket's row in handover.md (its "| #<N> |" line) gets "merged in branch (<sha>)" as its Status and an empty
# Claimed by cell; every other byte of the file is kept. The change is committed on its own. A missing row or file
# is a warning, not a failure: the merge itself is green.
mark_handover() { # mark_handover <ticket-branch> <merge-sha>
  local n file=handover.md
  if [[ "$1" =~ ^tt/([0-9]+)- ]]; then n="${BASH_REMATCH[1]}"; else
    echo "handover: $1 is not tt/<N>-<slug>; handover.md not updated" >&2; return 0
  fi
  if [ ! -f "$file" ] || ! awk -F'|' -v n="#$n" '$2 ~ "^ *" n " *$" {found = 1} END {exit !found}' "$file"; then
    echo "handover: no row for #$n in $file; handover.md not updated, set the row by hand" >&2
    return 0
  fi
  awk -F'|' -v OFS='|' -v n="#$n" -v sha="$2" '
    !done && $2 ~ "^ *" n " *$" {$5 = " merged in branch (" sha ") "; $6 = " "; done = 1}
    {print}' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  if ! git diff --quiet -- "$file"; then
    git commit -q -m "handover: #$n merged in branch ($2)" -- "$file"
  fi
  echo "handover: #$n row reads merged in branch ($2)."
}

# When the only conflict is the ENGINE_VERSION line in the engine simulation module, write the higher of the two
# versions with its minor +1 (patch 0), stage it and commit the merge. Returns 1 (touching nothing) for any other conflict.
resolve_engine_version() {
  local file=src/sims/terminal-twin/engine/simulation.ts
  [ "$(git diff --name-only --diff-filter=U)" = "$file" ] || return 1
  # exactly one hunk: <<<<<<< ours (one ENGINE_VERSION line) ======= theirs (one ENGINE_VERSION line) >>>>>>> theirs
  [ "$(grep -c '^<<<<<<< ' "$file")" = 1 ] && [ "$(grep -c '^>>>>>>> ' "$file")" = 1 ] || return 1
  local hunk; hunk="$(awk '/^<<<<<<< /{f=1;next} /^>>>>>>> /{f=0} f' "$file")"
  [ "$(printf '%s\n' "$hunk" | wc -l)" = 3 ] || return 1
  [ "$(printf '%s\n' "$hunk" | sed -n 2p)" = "=======" ] || return 1
  local re="^export const ENGINE_VERSION = '([0-9]+\.[0-9]+\.[0-9]+)'"
  local l1 l3 a b top
  l1="$(printf '%s\n' "$hunk" | sed -n 1p)"
  l3="$(printf '%s\n' "$hunk" | sed -n 3p)"
  [[ "$l1" =~ $re ]] || return 1
  a="${BASH_REMATCH[1]}"
  [[ "$l3" =~ $re ]] || return 1
  b="${BASH_REMATCH[1]}"
  top="$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -1)"
  local major="${top%%.*}" rest="${top#*.}"
  local next="$major.$(( ${rest%%.*} + 1 )).0"
  awk -v v="export const ENGINE_VERSION = '$next'" '
    /^<<<<<<< /{skip=1; print v; next} /^>>>>>>> /{skip=0; next} !skip{print}' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  git add "$file"
  git commit -q --no-edit
  echo "ENGINE_VERSION-only conflict resolved: $a and $b -> $next."
}

current="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$current"
git merge --ff-only "origin/$current" >/dev/null 2>&1 || true
if ! git merge --no-edit "$branch" && ! resolve_engine_version; then
  echo "CONFLICT merging $branch into $current. Unmerged files:" >&2
  git diff --name-only --diff-filter=U >&2
  echo "Resolve them (keep both sides of additive changes, the higher ENGINE_VERSION), 'git add', 'git commit', then run 'scripts/check-engine-version.sh' and 'pnpm run verify'." >&2
  if git diff --name-only --diff-filter=U | grep -q '\.golden\.json$'; then
    echo "Goldens never merge by hand: 'git checkout --theirs' the *.golden.json files, resolve the rest, then 'UPDATE_GOLDEN=1 pnpm test' on the merged tree and check the KPI change in 'git diff' is what both tickets intended before committing." >&2
  fi
  exit 1
fi
merged="$(git rev-parse --short HEAD)"
scripts/check-engine-version.sh
pnpm run verify
if [ "$smoke" = "all" ]; then
  pnpm run test:smoke --project dev --grep-invert @load
elif [ -n "$smoke" ]; then
  mapfile -t specs < <(scripts/smoke-specs-for.sh HEAD^1 HEAD)
  echo "Smoke specs: ${specs[*]}"
  pnpm run test:smoke --project dev --grep-invert @load "${specs[@]}"
fi
echo "OK: $branch merged into $current and verified."
mark_handover "$branch" "$merged"
if [ -n "$push" ]; then
  git push -q -u origin "$current"
  echo "Pushed $current."
else
  echo "Not pushed. Run git push when ready."
fi
