#!/usr/bin/env bash
# Merge a finished ticket branch into the current integration branch and verify it.
# Usage: scripts/merge-ticket.sh [--push] tt/<N>-<slug>
# Output goes to the terminal and to .merge-ticket.log; the last line is "EXIT <code>", so a background run
# is finished when `tail -1 .merge-ticket.log` shows it. --push pushes the integration branch after a verified merge.
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
push=""
[ "${1:-}" = "--push" ] && { push=1; shift; }
branch="${1:?usage: scripts/merge-ticket.sh <ticket-branch>}"
current="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$current"
git merge --ff-only "origin/$current" >/dev/null 2>&1 || true
if ! git merge --no-edit "$branch"; then
  echo "CONFLICT merging $branch into $current. Unmerged files:" >&2
  git diff --name-only --diff-filter=U >&2
  echo "Resolve them (keep both sides of additive changes, the higher ENGINE_VERSION), 'git add', 'git commit', then run 'scripts/check-engine-version.sh' and 'pnpm run verify'." >&2
  exit 1
fi
scripts/check-engine-version.sh
pnpm run verify
echo "OK: $branch merged into $current and verified."
if [ -n "$push" ]; then
  git push -q -u origin "$current"
  echo "Pushed $current. Update handover.md and push again."
else
  echo "Update handover.md, then git push."
fi
