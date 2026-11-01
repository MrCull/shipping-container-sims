#!/usr/bin/env bash
# Tests scripts/remove-worktree.sh on scratch repositories: a locked worktree whose agent has finished (no process
# has it as its working directory) is unlocked and removed; one a live process is using is refused with a reason; a
# dirty worktree is refused and stays locked; an idle unlocked worktree is removed as before.
# Usage: scripts/test-remove-worktree.sh
set -uo pipefail
helper="$(cd "$(dirname "$0")" && pwd)/remove-worktree.sh"
scratch="$(mktemp -d)"
pids=()
cleanup() {
  for p in "${pids[@]+"${pids[@]}"}"; do kill "$p" 2>/dev/null; done
  rm -rf "$scratch"
}
trap cleanup EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

fails=0
check() { # check <description> <condition-exit-status>
  if [ "$2" -eq 0 ]; then echo "ok   - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); fi
}

repo="$scratch/repo"
git init -q -b main "$repo"
git -C "$repo" commit -q --allow-empty -m "main: base"

new_wt() { # new_wt <name>: a worktree on its own branch, returned as its absolute path
  git -C "$repo" worktree add -q -b "wt-$1" "$scratch/$1" main
  echo "$scratch/$1"
}
is_listed() { git -C "$repo" worktree list --porcelain | grep -qx "worktree $1"; }
is_locked() { # is_locked <path>: true when that worktree (only it) carries a lock line
  git -C "$repo" worktree list --porcelain | awk -v p="$1" '/^worktree /{cur=substr($0,10)} /^locked/ && cur==p {f=1} END{exit !f}'
}
start_in() { # start_in <dir>: a sleep whose working directory is <dir>; its pid is left in $started (not via $(...):
  # a background child holding the capture pipe would block the test)
  (cd "$1" && exec sleep 600) >/dev/null 2>&1 &
  started=$!
  pids+=("$started")
  local i=0
  while [ "$(readlink "/proc/$started/cwd" 2>/dev/null)" != "$1" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i + 1)); done
}

# Case 1: locked, clean, no live process (the agent has finished): unlocked and removed.
wt="$(new_wt dead)"
git -C "$repo" worktree lock --reason "agent finished" "$wt"
out="$(cd "$repo" && "$helper" "$wt" 2>&1)"; code=$?
check "dead locked worktree is removed ($out)" "$code"
check "dead locked worktree is gone from disk" "$([ ! -e "$wt" ]; echo $?)"
check "dead locked worktree is gone from the worktree list" "$(! is_listed "$wt"; echo $?)"

# Case 2: locked with a live process whose working directory is inside it: refused, with a reason, nothing changed.
wt="$(new_wt live)"
git -C "$repo" worktree lock --reason "agent running" "$wt"
start_in "$wt"; pid=$started
out="$(cd "$repo" && "$helper" "$wt" 2>&1)"; code=$?
check "live locked worktree is refused with non-zero exit ($out)" "$([ "$code" -ne 0 ]; echo $?)"
check "live refusal names the reason and the pid ($out)" "$(printf '%s' "$out" | grep -q "in use" && printf '%s' "$out" | grep -q "$pid"; echo $?)"
check "live locked worktree is still on disk" "$([ -d "$wt" ]; echo $?)"
check "live locked worktree is still locked" "$(is_locked "$wt"; echo $?)"
kill "$pid" 2>/dev/null

# Case 3: unlocked, idle worktree: removed as before.
wt="$(new_wt idle)"
out="$(cd "$repo" && "$helper" "$wt" 2>&1)"; code=$?
check "idle unlocked worktree is removed ($out)" "$code"
check "idle unlocked worktree is gone from disk" "$([ ! -e "$wt" ]; echo $?)"

# Case 4: locked, dead, but dirty (untracked file): refused and left locked, so no work is lost.
wt="$(new_wt dirty)"
echo change > "$wt/loose.txt"
git -C "$repo" worktree lock --reason "agent finished" "$wt"
out="$(cd "$repo" && "$helper" "$wt" 2>&1)"; code=$?
check "dirty locked worktree is refused with non-zero exit ($out)" "$([ "$code" -ne 0 ]; echo $?)"
check "dirty locked worktree is still on disk with its file" "$([ -f "$wt/loose.txt" ]; echo $?)"
check "dirty locked worktree is still locked" "$(is_locked "$wt"; echo $?)"

# Case 5: unlocked, but a live process is using it: refused.
wt="$(new_wt busy)"
start_in "$wt"; pid=$started
out="$(cd "$repo" && "$helper" "$wt" 2>&1)"; code=$?
check "unlocked worktree in use is refused with non-zero exit ($out)" "$([ "$code" -ne 0 ]; echo $?)"
check "unlocked worktree in use is still on disk" "$([ -d "$wt" ]; echo $?)"
kill "$pid" 2>/dev/null

echo "$fails failing"
[ "$fails" -eq 0 ]
