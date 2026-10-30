#!/usr/bin/env bash
# Remove a finished agent worktree without --force (refuses if it holds uncommitted work).
# Usage: scripts/remove-worktree.sh <agent-id-or-path>
set -euo pipefail
target="${1:?usage: scripts/remove-worktree.sh <agent-id-or-path>}"
case "$target" in
  */*) path="$target" ;;
  agent-*) path=".claude/worktrees/$target" ;;
  *) path=".claude/worktrees/agent-$target" ;;
esac
git worktree remove "$path"
echo "Removed $path. Free disk: $(df -h . | awk 'NR==2 {print $4}')"
