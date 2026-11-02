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
[ $fail = 0 ] && echo "test-bg: ok"; exit $fail
