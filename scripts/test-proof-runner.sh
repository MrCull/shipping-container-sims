#!/usr/bin/env bash
# Tests scripts/proof-runner.sh with a stub in place of tt:run: concurrency cap, table, per-variant logs,
# exit code when one variant fails, and a second runner waiting on the heavy lock.
set -u
here=$(cd "$(dirname "$0")" && pwd); d=$(mktemp -d); fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
cat > "$d/stub.sh" <<'STUB'
#!/usr/bin/env bash
# usage: stub.sh <name> [fail]; tracks live count in $STUB_DIR
touch "$STUB_DIR/live.$$"; live=$(ls "$STUB_DIR" | grep -c '^live\.')
echo "$live" >> "$STUB_DIR/counts"
sleep "${STUB_SLEEP:-1}"
echo "Moves completed:  ${#1}"
echo "Invariants:       5 checks, $([ "${2:-}" = fail ] && echo 2 || echo 0) violations"
rm -f "$STUB_DIR/live.$$"
[ "${2:-}" = fail ] && exit 1; exit 0
STUB
chmod +x "$d/stub.sh"; mkdir "$d/s"
export STUB_DIR="$d/s" PROOF_RUN_CMD="$d/stub.sh"
out=$("$here/proof-runner.sh" --jobs 2 --out "$d/o" aa bbb "cccc fail" dd 2>&1); rc=$?
check "exit nonzero when one fails" "$rc" 1
check "cap" "$(sort -n "$d/s/counts" | tail -1)" 2
check "four logs" "$(ls "$d"/o/*.log | wc -l)" 4
grep -q 'Moves completed:  4' "$d/o/03.log"; check "log 3 holds its output" "$?" 0
echo "$out" | grep -Eq '^03 +cccc fail +1 +[0-9]+ +4 +2$'; check "table row for failing variant" "$?" 0
echo "$out" | grep -Eq '^01 +aa +0 +[0-9]+ +2 +0$'; check "table row for ok variant" "$?" 0
"$here/proof-runner.sh" --out "$d/o2" aa bb >/dev/null 2>&1; check "exit 0 when all pass" "$?" 0
"$here/proof-runner.sh" >/dev/null 2>&1; check "usage rc" "$?" 2
# second runner waits on the heavy lock
rm -f "$d/s/counts"
STUB_SLEEP=3 "$here/proof-runner.sh" --out "$d/r1" aa >"$d/r1.txt" 2>&1 &
p1=$!; sleep 1
STUB_SLEEP=1 "$here/proof-runner.sh" --out "$d/r2" bb >"$d/r2.txt" 2>&1 &
p2=$!; sleep 1
grep -q 'waiting for heavy lock' "$d/r2.txt"; check "second runner waits" "$?" 0
[ -e "$d/r2/01.log" ]; check "second runner has not started" "$?" 1
wait "$p1"; wait "$p2"
check "no overlap across runners" "$(sort -n "$d/s/counts" | tail -1)" 1
grep -q '^01 ' "$d/r2.txt"; check "second runner then ran" "$?" 0
[ $fail = 0 ] && echo "test-proof-runner: ok"; exit $fail
