#!/usr/bin/env bash
# Tests scripts/timebox.sh: start, left, over, status silence, usage, and the minutes line from bg.sh wait.
set -u
here=$(cd "$(dirname "$0")" && pwd); d=$(mktemp -d); fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
export TIMEBOX_FILE="$d/tb"
out=$("$here/timebox.sh" status); check "status silent when unset" "$out" ""
out=$("$here/timebox.sh" left); rc=$?; check "left when unset rc" "$rc" 0
echo "$out" | grep -q 'not started'; check "left when unset says so" "$?" 0
"$here/timebox.sh" start 15 >/dev/null; check "start rc" "$?" 0
out=$("$here/timebox.sh" left); rc=$?; check "left rc" "$rc" 0; check "left text" "$out" "timebox: 15 min left"
echo $(( $(date +%s) - 125 )) > "$TIMEBOX_FILE"
out=$("$here/timebox.sh" left); rc=$?; check "over rc" "$rc" 1
echo "$out" | grep -q 'over by 3 min: commit what is green and report now'; check "over text" "$?" 0
"$here/timebox.sh" start 0 2>/dev/null; check "start 0 rc" "$?" 2
"$here/timebox.sh" start abc 2>/dev/null; check "start abc rc" "$?" 2
"$here/timebox.sh" nope 2>/dev/null; check "usage rc" "$?" 2
# bg.sh wait: stdout stays the EXIT line, the minutes line goes to stderr, nothing extra when no budget is started
rm -f "$TIMEBOX_FILE"
"$here/bg.sh" run "$d/a.log" bash -c 'exit 0' >/dev/null
err=$("$here/bg.sh" wait "$d/a.log" 30 2>&1 >/dev/null); check "wait silent without budget" "$err" ""
"$here/timebox.sh" start 10 >/dev/null
"$here/bg.sh" run "$d/b.log" bash -c 'exit 0' >/dev/null
out=$("$here/bg.sh" wait "$d/b.log" 30 2>/dev/null); check "wait stdout is the EXIT line" "$out" "EXIT 0"
err=$("$here/bg.sh" wait "$d/b.log" 30 2>&1 >/dev/null); check "wait prints the minutes left" "$err" "timebox: 10 min left"
"$here/bg.sh" run "$d/c.log" bash -c 'sleep 20' >/dev/null
err=$("$here/bg.sh" wait "$d/c.log" 5 2>&1 >/dev/null); echo "$err" | grep -q 'timebox: 10 min left'; check "timeout also prints it" "$?" 0
[ $fail = 0 ] && echo "test-timebox: ok"; exit $fail
