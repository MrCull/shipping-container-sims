#!/usr/bin/env bash
# Tests scripts/bg.sh: exit code and log line, timeout, usage.
set -u
here=$(cd "$(dirname "$0")" && pwd); d=$(mktemp -d); fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
"$here/bg.sh" run "$d/a.log" bash -c 'echo hi; exit 3' >/dev/null
out=$("$here/bg.sh" wait "$d/a.log" 30); rc=$?
check "wait rc" "$rc" 3; check "wait line" "$out" "EXIT 3"
"$here/bg.sh" run "$d/b.log" bash -c 'exit 0' >/dev/null; "$here/bg.sh" wait "$d/b.log" 30 >/dev/null; check "ok rc" "$?" 0
"$here/bg.sh" run "$d/c.log" bash -c 'sleep 20' >/dev/null; "$here/bg.sh" wait "$d/c.log" 5 2>/dev/null; check "timeout rc" "$?" 124
"$here/bg.sh" nope 2>/dev/null; check "usage rc" "$?" 2
# heavy lock: two heavy jobs from two different worktrees never overlap; light starts at once
repo=$(git rev-parse --show-toplevel); wt="$d/wt"
git -C "$repo" worktree add -q --detach "$wt" HEAD 2>/dev/null || wt=""
[ -n "$wt" ] && cp "$here/bg.sh" "$wt/scripts/bg.sh"
stamp="$d/stamps"; : > "$stamp"
mk() { printf 'echo start >> %s; sleep 2; echo end >> %s' "$stamp" "$stamp"; }
"$here/bg.sh" run --heavy "$d/h1.log" bash -c "$(mk)" >/dev/null
sleep 0.5
if [ -n "$wt" ]; then "$wt/scripts/bg.sh" run --heavy "$d/h2.log" bash -c "$(mk)" >/dev/null
else "$here/bg.sh" run --heavy "$d/h2.log" bash -c "$(mk)" >/dev/null; fi
sleep 0.5
"$here/bg.sh" run "$d/l.log" bash -c 'echo light' >/dev/null
sleep 1; grep -q '^EXIT 0$' "$d/l.log"; check "light starts at once" "$?" 0
grep -q 'waiting for heavy lock' "$d/h2.log"; check "waiting line" "$?" 0
"$here/bg.sh" wait "$d/h1.log" 30 >/dev/null; "$here/bg.sh" wait "$d/h2.log" 30 >/dev/null
check "no overlap" "$(tr '\n' ' ' < "$stamp")" "start end start end "
# killed heavy job frees the lock
pid=$("$here/bg.sh" run --heavy "$d/k1.log" bash -c 'sleep 60')
sleep 1; "$here/bg.sh" run --heavy "$d/k2.log" bash -c 'echo ran' >/dev/null
sleep 1; grep -q 'waiting for heavy lock' "$d/k2.log"; check "k2 waits" "$?" 0
kill "$pid"; "$here/bg.sh" wait "$d/k2.log" 30 >/dev/null; check "killed frees lock" "$?" 0
[ -n "$wt" ] && git -C "$repo" worktree remove --force "$wt"
[ $fail = 0 ] && echo "test-bg: ok"; exit $fail
