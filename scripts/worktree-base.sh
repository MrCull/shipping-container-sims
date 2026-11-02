#!/usr/bin/env bash
# Puts this worktree on the tip of the integration branch: the first step of the implementer brief
# (docs/agents/implementing.md). Run it inside the implementer's worktree, before anything else.
# Usage: scripts/worktree-base.sh <integration-branch>
#
# Outcomes (one line on stdout or stderr):
#   - already at the tip, or HEAD already contains the tip (a resumed ticket keeps its own commits): exit 0
#   - a fast-forward to the tip (a fresh worktree created from main): exit 0, HEAD now at the tip
#   - refused, exit 1, nothing changed: uncommitted or untracked changes; the base is neither a local nor an
#     origin branch ("cannot be reached"); or HEAD has commits the tip lacks (a reset would drop them)
set -euo pipefail
base="${1:?usage: scripts/worktree-base.sh <integration-branch>}"
refuse() { echo "worktree-base: refused: $1" >&2; exit 1; }

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  refuse "uncommitted or untracked changes in $(git rev-parse --show-toplevel); commit or remove them first"
fi

resolve() { git rev-parse --verify --quiet "$1^{commit}" 2>/dev/null || true; }
tip="$(resolve "refs/heads/$base")"
[ -n "$tip" ] || tip="$(resolve "refs/remotes/origin/$base")"
if [ -z "$tip" ]; then
  git fetch -q origin "$base" 2>/dev/null || true
  tip="$(resolve "refs/remotes/origin/$base")"
fi
[ -n "$tip" ] || refuse "base '$base' cannot be reached: no local or origin branch with that name"

short="$(git rev-parse --short "$tip")"
head="$(git rev-parse HEAD)"
if [ "$head" = "$tip" ]; then
  echo "worktree-base: already at $base ($short)"
elif git merge-base --is-ancestor "$tip" HEAD; then
  echo "worktree-base: kept HEAD $(git rev-parse --short HEAD), which already contains $base ($short)"
elif git merge-base --is-ancestor HEAD "$tip"; then
  git reset -q --hard "$tip"
  echo "worktree-base: moved from $(git rev-parse --short "$head") to $base ($short)"
else
  refuse "HEAD has commits that $base lacks, and a reset would drop them; rebase them onto $base or start a new worktree"
fi
