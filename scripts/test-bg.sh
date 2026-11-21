#!/usr/bin/env bash
# Tests scripts/bg.sh: exit code and log line, timeout, usage, heavy lock, clean-up of every process a job started, stop.
set -u
here=$(cd "$(dirname "$0")" && pwd); d=$(mktemp -d); fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
"$here/bg.sh" run "$d/a.log" bash -c 'echo hi; exit 3' >/dev/null
out=$("$here/bg.sh" wait "$d/a.log" 30); rc=$?
check "wait rc" "$rc" 3; check "wait line" "$out" "EXIT 3"
"$here/bg.sh" run "$d/b.log" bash -c 'exit 0' >/dev/null; "$here/bg.sh" wait "$d/b.log" 30 >/dev/null; check "ok rc" "$?" 0
"$here/bg.sh" run "$d/c.log" bash -c 'sleep 20' >/dev/null; "$here/bg.sh" wait "$d/c.log" 5 2>/dev/null; check "timeout rc" "$?" 124
"$here/bg.sh" nope 2>/dev/null; check "usage rc" "$?" 2
# clean-up: a detached grandchild (its own session, like a Playwright web server) that outlives the job is ended with it
alive() { for p in "$@"; do kill -0 "$p" 2>/dev/null && return 0; done; return 1; }
sleep 303 & other=$!   # not started by any job: must survive
"$here/bg.sh" run "$d/o.log" bash -c "setsid sleep 300 >/dev/null 2>&1 & echo \$! > $d/o.pids; exit 4" >/dev/null
"$here/bg.sh" wait "$d/o.log" 30 >/dev/null; check "orphan job rc" "$?" 4
alive $(cat "$d/o.pids"); check "orphan ended with job" "$?" 1
# stop part-way: the job, its child and its detached grandchild all end, the log gets EXIT 143
"$here/bg.sh" run "$d/s.log" bash -c "sleep 301 & echo \$! > $d/s.pids; setsid sleep 302 >/dev/null 2>&1 & echo \$! >> $d/s.pids; echo started; wait" >/dev/null
for _ in $(seq 1 20); do [ "$(wc -l 2>/dev/null < "$d/s.pids")" = 2 ] && break; sleep 0.25; done
out=$("$here/bg.sh" stop "$d/s.log"); check "stop line" "$out" "EXIT 143"
"$here/bg.sh" wait "$d/s.log" 5 >/dev/null; check "stopped rc" "$?" 143
alive $(cat "$d/s.pids"); check "stop ends every process" "$?" 1
[ -e "$d/s.log.bg" ]; check "job record removed" "$?" 1
"$here/bg.sh" stop "$d/s.log" 2>/dev/null; check "stop when done" "$?" 0
kill -0 "$other" 2>/dev/null; check "other process untouched" "$?" 0
kill "$other"; wait "$other" 2>/dev/null
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
"$here/bench-preflight.sh" >/dev/null 2>&1; check "preflight busy" "$?" 1
kill "$pid"; "$here/bg.sh" wait "$d/k2.log" 30 >/dev/null; check "killed frees lock" "$?" 0
"$here/bench-preflight.sh" >/dev/null 2>&1; check "preflight free" "$?" 0
[ -n "$wt" ] && git -C "$repo" worktree remove --force "$wt"
[ $fail = 0 ] && echo "test-bg: ok"; exit $fail
