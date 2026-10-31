#!/usr/bin/env bash
# Merge a finished ticket branch into the current integration branch and verify it.
# Usage: scripts/merge-ticket.sh [--push] [--smoke | --smoke-all] tt/<N>-<slug>
# Output goes to the terminal and to .merge-ticket.log; the last line is "EXIT <code>", so a background run
# is finished when `tail -1 .merge-ticket.log` shows it. --push pushes the integration branch after a verified merge.
# Smoke specs do not run per merge: the spec's final ticket runs the whole suite once, after every other ticket is merged.
# --smoke runs only the specs for the paths this merge changed (scripts/smoke-specs-for.sh, map in scripts/smoke-map.txt);
# --smoke-all runs every dev spec except @load (about 40 minutes).
# Stops (without committing) on a conflict, conflict markers or a failed check; otherwise leaves a verified merge
# commit locally. The orchestrator then updates handover.md and pushes.
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
current="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$current"
git merge --ff-only "origin/$current" >/dev/null 2>&1 || true
if ! git merge --no-edit "$branch"; then
  echo "CONFLICT merging $branch into $current. Unmerged files:" >&2
  git diff --name-only --diff-filter=U >&2
  echo "Resolve them (keep both sides of additive changes, the higher ENGINE_VERSION), 'git add', 'git commit', then run 'scripts/check-engine-version.sh' and 'pnpm run verify'." >&2
  if git diff --name-only --diff-filter=U | grep -q '\.golden\.json$'; then
    echo "Goldens never merge by hand: 'git checkout --theirs' the *.golden.json files, resolve the rest, then 'UPDATE_GOLDEN=1 pnpm test' on the merged tree and check the KPI change in 'git diff' is what both tickets intended before committing." >&2
  fi
  exit 1
fi
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
if [ -n "$push" ]; then
  git push -q -u origin "$current"
  echo "Pushed $current. Update handover.md and push again."
else
  echo "Update handover.md, then git push."
fi
