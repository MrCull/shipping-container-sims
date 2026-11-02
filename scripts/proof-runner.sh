#!/usr/bin/env bash
# Parallel proof runner: several tt:run variants in about the time of the slowest.
#   scripts/proof-runner.sh [--jobs N] [--out DIR] <variant>...
#   A variant is one quoted string of tt:run arguments, e.g.
#     scripts/proof-runner.sh "--fixture tracer-1sts-10-boxes" "--fixture tracer-1sts-10-boxes --seed 7"
#   (split on spaces, no quoting inside a variant, so use names without spaces such as a --fixture).
# Takes the heavy lock once (the same flock file as scripts/bg.sh run --heavy, so it waits behind any heavy job
# and a second runner waits behind this one), runs up to --jobs (default nproc) variants at a time, writes one log
# per variant under DIR (default a new temp dir), then prints one table: variant, exit code, wall seconds, moves
# completed and invariant violations (from tt:run's "Moves completed:" and "Invariants:" lines; "-" if absent).
# Exit 0 only when every variant exits 0. PROOF_RUN_CMD replaces the command (default "pnpm run tt:run"; tests).
set -u
jobs_max=$(nproc 2>/dev/null || echo 2); out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jobs) jobs_max=${2:?--jobs N}; shift 2 ;;
    --out) out=${2:?--out DIR}; shift 2 ;;
    -h|--help) sed -n 2,11p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: scripts/proof-runner.sh [--jobs N] [--out DIR] <variant>..." >&2; exit 2; }
case "$jobs_max" in ''|*[!0-9]*|0) echo "proof-runner: --jobs must be a positive integer" >&2; exit 2 ;; esac
cmd=${PROOF_RUN_CMD:-pnpm run tt:run}
[ -n "$out" ] || out=$(mktemp -d)
mkdir -p "$out"

# heavy lock, same file and holder format as scripts/bg.sh run --heavy
lock=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/bg-heavy
# Run under scripts/bg.sh run --heavy (BG_HEAVY_HELD=1) the lock is already held by this very job: taking it again would wait forever.
if [ "${BG_HEAVY_HELD:-}" != 1 ]; then
  exec 9>>"$lock.lock"
  if ! flock -n 9; then
    echo "proof-runner: waiting for heavy lock held by $(cat "$lock.holder" 2>/dev/null || echo unknown)" >&2
    flock 9
  fi
  echo "proof-runner $out" > "$lock.holder"
fi

n=0
for v in "$@"; do
  n=$((n + 1)); id=$(printf '%02d' "$n")
  while [ "$(jobs -rp | wc -l)" -ge "$jobs_max" ]; do wait -n; done
  (
    start=$(date +%s)
    # shellcheck disable=SC2086
    $cmd $v > "$out/$id.log" 2>&1 9>&-
    rc=$?
    echo "$rc $(( $(date +%s) - start ))" > "$out/$id.rc"
  ) &
done
wait

printf '%-3s %-48s %4s %6s %6s %10s\n' "#" "variant" "exit" "wall_s" "moves" "violations"
fail=0; n=0
for v in "$@"; do
  n=$((n + 1)); id=$(printf '%02d' "$n")
  read -r rc wall < "$out/$id.rc" 2>/dev/null || { rc=1; wall=-; }
  moves=$(sed -n 's/^Moves completed: *\([0-9]*\).*/\1/p' "$out/$id.log" | tail -1)
  viol=$(sed -n 's/^Invariants:.*, \([0-9]*\) violations.*/\1/p' "$out/$id.log" | tail -1)
  [ "$rc" = 0 ] || fail=1
  printf '%-3s %-48s %4s %6s %6s %10s\n' "$id" "${v:0:48}" "$rc" "$wall" "${moves:--}" "${viol:--}"
done
echo "logs: $out/NN.log"
exit $fail
