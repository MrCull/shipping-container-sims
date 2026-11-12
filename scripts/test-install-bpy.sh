#!/usr/bin/env bash
# Tests scripts/install-bpy.sh with a stand-in module (no 1 GB download): create, idempotent re-run, missing interpreter, missing requirements.
set -u
here=$(cd "$(dirname "$0")" && pwd); d=$(mktemp -d); fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
: > "$d/req.txt"
export TT_BPY_VENV="$d/venv" TT_BPY_REQUIREMENTS="$d/req.txt" TT_BPY_MODULE=json
out=$("$here/install-bpy.sh" 2>"$d/err1"); rc=$?; check "first rc" "$rc" 0; check "first prints python" "$out" "$d/venv/bin/python"
grep -q 'installed into' "$d/err1"; check "first says installed" "$?" 0
out=$("$here/install-bpy.sh" 2>"$d/err2"); rc=$?; check "second rc" "$rc" 0; check "second prints python" "$out" "$d/venv/bin/python"
grep -q 'already importable' "$d/err2"; check "second is a no-op" "$?" 0
TT_BPY_VENV="$d/v2" TT_BPY_PYTHON313=no-such-python "$here/install-bpy.sh" >/dev/null 2>&1; check "missing interpreter rc" "$?" 1
TT_BPY_VENV="$d/v3" TT_BPY_REQUIREMENTS="$d/nope.txt" "$here/install-bpy.sh" >/dev/null 2>&1; check "missing requirements rc" "$?" 1
rm -rf "$d"
[ $fail = 0 ] && echo "test-install-bpy: ok"; exit $fail
