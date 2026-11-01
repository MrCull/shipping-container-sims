#!/usr/bin/env bash
# Tests scripts/worktree-base.sh on scratch repositories: a fresh worktree from main ends on the integration tip,
# the helper refuses (one line, non-zero, nothing changed) on a dirty tree and on an unreachable base, and it never
# drops commits. Usage: scripts/test-worktree-base.sh
set -uo pipefail
helper="$(cd "$(dirname "$0")" && pwd)/worktree-base.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

fails=0
check() { # check <description> <condition-exit-status>
  if [ "$2" -eq 0 ]; then echo "ok   - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); fi
}

repo="$scratch/repo"
git init -q -b main "$repo"
git -C "$repo" commit -q --allow-empty -m "main: base"
git -C "$repo" checkout -q -b integ
git -C "$repo" commit -q --allow-empty -m "integ: tip"
git -C "$repo" checkout -q main
tip="$(git -C "$repo" rev-parse integ)"
base_main="$(git -C "$repo" rev-parse main)"

# Each case gets its own worktree, created from the given commit-ish.
new_wt() { # new_wt <name> <start>
  git -C "$repo" worktree add -q -b "wt-$1" "$scratch/$1" "$2"
  echo "$scratch/$1"
}

# Case 1: fresh worktree from main ends on the integration tip.
wt="$(new_wt fresh main)"
out="$(cd "$wt" && "$helper" integ 2>&1)"; code=$?
check "fresh worktree from main exits 0 ($out)" "$code"
check "fresh worktree from main is at the integration tip" "$([ "$(git -C "$wt" rev-parse HEAD)" = "$tip" ]; echo $?)"
check "success prints one line" "$([ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ]; echo $?)"

# Case 2: dirty tree (tracked change, then untracked file) refuses and changes nothing.
for kind in staged untracked; do
  wt="$(new_wt "dirty-$kind" main)"
  if [ "$kind" = staged ]; then echo change > "$wt/staged.txt"; git -C "$wt" add staged.txt; else echo change > "$wt/loose.txt"; fi
  before="$(git -C "$wt" rev-parse HEAD)"
  out="$(cd "$wt" && "$helper" integ 2>&1)"; code=$?
  check "dirty ($kind) tree refuses with non-zero exit" "$([ "$code" -ne 0 ]; echo $?)"
  check "dirty ($kind) tree refusal is one line naming the cause ($out)" "$([ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ] && printf '%s' "$out" | grep -q uncommitted; echo $?)"
  check "dirty ($kind) tree is left at its HEAD" "$([ "$(git -C "$wt" rev-parse HEAD)" = "$before" ]; echo $?)"
done

# Case 3: unreachable base refuses with a one-line reason and changes nothing.
wt="$(new_wt nobase main)"
before="$(git -C "$wt" rev-parse HEAD)"
out="$(cd "$wt" && "$helper" no-such-integ 2>&1)"; code=$?
check "unreachable base refuses with non-zero exit ($out)" "$([ "$code" -ne 0 ]; echo $?)"
check "unreachable base refusal is one line naming the cause" "$([ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ] && printf '%s' "$out" | grep -q 'cannot be reached'; echo $?)"
check "unreachable base leaves HEAD alone" "$([ "$(git -C "$wt" rev-parse HEAD)" = "$before" ]; echo $?)"

# Case 4: a resumed worktree that already has the tip plus its own commits keeps them.
wt="$(new_wt resume integ)"
git -C "$wt" commit -q --allow-empty -m "ticket: work in progress"
mine="$(git -C "$wt" rev-parse HEAD)"
out="$(cd "$wt" && "$helper" integ 2>&1)"; code=$?
check "resumed worktree (tip plus own commits) exits 0 ($out)" "$code"
check "resumed worktree keeps its own commits" "$([ "$(git -C "$wt" rev-parse HEAD)" = "$mine" ]; echo $?)"

# Case 5: HEAD diverged from the tip (own commit, tip not in history) is refused, not reset over.
wt="$(new_wt diverged main)"
git -C "$wt" commit -q --allow-empty -m "ticket: diverged work"
mine="$(git -C "$wt" rev-parse HEAD)"
out="$(cd "$wt" && "$helper" integ 2>&1)"; code=$?
check "diverged worktree refuses with non-zero exit ($out)" "$([ "$code" -ne 0 ]; echo $?)"
check "diverged worktree refusal is one line" "$([ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ]; echo $?)"
check "diverged worktree keeps its commit" "$([ "$(git -C "$wt" rev-parse HEAD)" = "$mine" ]; echo $?)"

# Case 6: a worktree already at the tip is a no-op success.
wt="$(new_wt at-tip integ)"
out="$(cd "$wt" && "$helper" integ 2>&1)"; code=$?
check "worktree already at the tip exits 0 ($out)" "$code"

echo "$((fails)) failing"
[ "$fails" -eq 0 ]
