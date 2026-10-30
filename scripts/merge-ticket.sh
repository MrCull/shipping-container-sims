#!/usr/bin/env bash
# Merge a finished ticket branch into the current integration branch and verify it.
# Usage: scripts/merge-ticket.sh tt/<N>-<slug>
# Stops (without committing) on a conflict, conflict markers or a failed check; otherwise leaves a verified merge
# commit locally. The orchestrator then updates handover.md and pushes.
set -euo pipefail
branch="${1:?usage: scripts/merge-ticket.sh <ticket-branch>}"
current="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin "$current"
git merge --ff-only "origin/$current" >/dev/null 2>&1 || true
if ! git merge --no-edit "$branch"; then
  echo "CONFLICT merging $branch into $current. Unmerged files:" >&2
  git diff --name-only --diff-filter=U >&2
  echo "Resolve them (keep both sides of additive changes), 'git add', 'git commit', then run 'pnpm run verify'." >&2
  exit 1
fi
pnpm run verify
echo "OK: $branch merged into $current and verified. Update handover.md, then git push."
