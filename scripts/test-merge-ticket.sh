#!/usr/bin/env bash
# Tests scripts/merge-ticket.sh on scratch repositories: after a green merge the ticket's row in handover.md reads
# "merged in branch (<merge sha>)" in a commit of its own, with no other line changed; a failed check or a missing row
# leaves handover.md alone. `pnpm` is a fake that succeeds unless FAKE_PNPM_FAIL names the command that must fail.
# Usage: scripts/test-merge-ticket.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

fails=0
check() { # check <description> <condition-exit-status>
  if [ "$2" -eq 0 ]; then echo "ok   - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); fi
}

bin="$scratch/bin"
mkdir -p "$bin"
cat > "$bin/pnpm" <<'EOF'
#!/usr/bin/env bash
# Fake pnpm: "pnpm run <name>" exits 1 when <name> is listed in FAKE_PNPM_FAIL, otherwise 0.
echo "fake pnpm $*"
[ "${FAKE_PNPM_FAIL:-}" = "${2:-}" ] && exit 1
exit 0
EOF
chmod +x "$bin/pnpm"

make_repo() { # make_repo <name> [norow]: an origin and a clone on integration branch "integ" with handover.md,
  # the merge scripts and a ticket branch tt/182-worktree-cleanup that integ does not yet contain
  local dir="$scratch/$1"
  git init -q --bare "$dir.git"
  git init -q -b integ "$dir"
  git -C "$dir" remote add origin "$dir.git"
  git -C "$dir" config push.negotiate false # a global push.negotiate=true warns on these local remotes
  mkdir -p "$dir/scripts" "$dir/src/sims/terminal-twin/engine"
  cp "$here/merge-ticket.sh" "$here/check-engine-version.sh" "$dir/scripts/"
  echo "export const ENGINE_VERSION = '1.0.0'" > "$dir/src/sims/terminal-twin/engine/simulation.ts"
  cat > "$dir/handover.md" <<'EOF'
# Handover: test run

| Ticket | Subject | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #181 | test:related | none | merged in branch (90d6ccc) | |
| #182 | dead worktree cleanup | #179 | in progress | implementer (wave 2) |
| #183 | yard deadlock | none | in progress | implementer (wave 1) |
EOF
  [ "${2:-}" = norow ] && sed -i '/^| #182 /d' "$dir/handover.md"
  echo base > "$dir/base.txt"
  git -C "$dir" add -A && git -C "$dir" commit -q -m "integ: base"
  git -C "$dir" push -q -u origin integ
  git -C "$dir" checkout -q -b tt/182-worktree-cleanup
  echo ticket > "$dir/ticket.txt" && git -C "$dir" add -A && git -C "$dir" commit -q -m "ticket: work"
  git -C "$dir" checkout -q integ
  # the integration branch moves on, so the merge is a real merge commit and not a fast-forward
  echo other > "$dir/other.txt" && git -C "$dir" add -A && git -C "$dir" commit -q -m "integ: other ticket"
  git -C "$dir" push -q origin integ
  git -C "$dir" show HEAD:handover.md > "$scratch/$1-before.md"
  echo "$dir"
}

run_merge() { # run_merge <repo> [flags]: merge-ticket.sh on the ticket branch, output to the log only
  local r="$1"; shift
  (cd "$r" && PATH="$bin:$PATH" scripts/merge-ticket.sh "$@" tt/182-worktree-cleanup >/dev/null 2>&1)
}

# Case 1: green merge, pushed. The row shows the merge commit, the handover change is one line in one commit.
repo="$(make_repo green)"
run_merge "$repo" --push; code=$?
check "green merge exits 0" "$code"
check "log ends with EXIT 0" "$([ "$(tail -1 "$repo/.merge-ticket.log")" = "EXIT 0" ]; echo $?)"
merge_sha="$(git -C "$repo" rev-parse --short HEAD^)"
ticket_tip="$(git -C "$repo" rev-parse --short tt/182-worktree-cleanup)"
check "HEAD^ is a merge commit whose second parent is the ticket tip, and differs from it" "$([ "$(git -C "$repo" rev-parse --short HEAD^^2 2>/dev/null)" = "$ticket_tip" ] && [ "$merge_sha" != "$ticket_tip" ]; echo $?)"
expected="| #182 | dead worktree cleanup | #179 | merged in branch ($merge_sha) | |"
check "the #182 row reads '$expected'" "$(git -C "$repo" show HEAD:handover.md | grep -qxF "$expected"; echo $?)"
check "exactly one line of handover.md changed ($(diff "$scratch/green-before.md" <(git -C "$repo" show HEAD:handover.md) | grep -c '^[<>]') diff lines)" "$([ "$(diff "$scratch/green-before.md" <(git -C "$repo" show HEAD:handover.md) | grep -c '^[<>]')" -eq 2 ]; echo $?)"
check "handover update is its own commit touching only handover.md" "$([ "$(git -C "$repo" log -1 --format=%s)" = "handover: #182 merged in branch ($merge_sha)" ] && [ "$(git -C "$repo" show --name-only --format= HEAD)" = "handover.md" ]; echo $?)"
check "--push pushed the handover commit" "$([ "$(git -C "$repo" rev-parse integ)" = "$(git -C "$repo" rev-parse HEAD)" ] && [ "$(git -C "$repo.git" rev-parse integ)" = "$(git -C "$repo" rev-parse HEAD)" ]; echo $?)"
check "tracked tree is clean after the run" "$([ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ]; echo $?)"

# Case 2: a failed check (verify) stops before the handover update: the row stays as it was.
repo="$(make_repo red)"
FAKE_PNPM_FAIL=verify run_merge "$repo"; code=$?
check "failed verify exits non-zero" "$([ "$code" -ne 0 ]; echo $?)"
check "failed verify leaves handover.md unchanged" "$(git -C "$repo" show HEAD:handover.md | cmp -s - "$scratch/red-before.md"; echo $?)"
check "failed verify logs EXIT non-zero" "$([ "$(tail -1 "$repo/.merge-ticket.log")" != "EXIT 0" ]; echo $?)"

# Case 3: no row for the ticket: the merge is still green, handover.md is left alone and the log says so.
repo="$(make_repo norow norow)"
run_merge "$repo"; code=$?
check "merge without a #182 row still exits 0" "$code"
check "missing row leaves handover.md unchanged" "$(git -C "$repo" show HEAD:handover.md | cmp -s - "$scratch/norow-before.md"; echo $?)"
check "missing row is reported in the log" "$(grep -q 'no row for #182' "$repo/.merge-ticket.log"; echo $?)"

echo "$fails failing"
[ "$fails" -eq 0 ]
