#!/usr/bin/env bash
# Remove a finished agent worktree without --force. Refuses when a live process has it as its working directory
# (or a directory below it), and when it holds uncommitted work. A locked worktree whose agent has finished (no live
# process) is unlocked and removed; if the removal fails it is locked again. Unlocked idle worktrees go as before.
# Usage: scripts/remove-worktree.sh <agent-id-or-path>   (tested by scripts/test-remove-worktree.sh)
set -euo pipefail
target="${1:?usage: scripts/remove-worktree.sh <agent-id-or-path>}"
case "$target" in
  */*) path="$target" ;;
  agent-*) path=".claude/worktrees/$target" ;;
  *) path=".claude/worktrees/agent-$target" ;;
esac
[ -d "$path" ] || { echo "remove-worktree: refused: $path is not a directory" >&2; exit 1; }
abs="$(cd "$path" && pwd -P)"

# One "pid command" line per process whose working directory is the worktree or below it (Linux /proc).
in_use() {
  local p cwd
  for p in /proc/[0-9]*; do
    cwd="$(readlink "$p/cwd" 2>/dev/null)" || continue
    case "$cwd/" in
      "$abs/"*) echo "${p#/proc/} $(tr '\0' ' ' 2>/dev/null < "$p/cmdline")" ;;
    esac
  done
}
live="$(in_use)"
if [ -n "$live" ]; then
  while read -r pid cmd; do
    echo "remove-worktree: refused: $path is in use, a live process has it as its working directory (pid $pid: $cmd)" >&2
  done <<< "$live"
  exit 1
fi

if [ -n "$(git -C "$path" status --porcelain)" ]; then
  echo "remove-worktree: refused: $path has uncommitted or untracked changes" >&2
  exit 1
fi

# The lock line of this worktree, if any: "locked" or "locked <reason>".
lock="$(git worktree list --porcelain | awk -v p="$abs" '/^worktree / {cur = substr($0, 10)} /^locked/ && cur == p {print; exit}')"
if [ -n "$lock" ]; then
  reason="${lock#locked}"; reason="${reason# }"
  git worktree unlock "$path"
  if ! git worktree remove "$path"; then
    git worktree lock ${reason:+--reason "$reason"} "$path"
    echo "remove-worktree: refused: $path could not be removed; it is locked again" >&2
    exit 1
  fi
  echo "Unlocked and removed $path (lock reason: ${reason:-none}; no live process used it)."
else
  git worktree remove "$path"
  echo "Removed $path."
fi
echo "Free disk: $(df -h . | awk 'NR==2 {print $4}')"
