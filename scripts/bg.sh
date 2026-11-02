#!/usr/bin/env bash
# Long commands without hand-rolled sleep loops.
#   scripts/bg.sh run [--heavy] <log> <command...>   start detached, print the pid; <log> ends with "EXIT <code>"
#       --heavy: one heavy job at a time on the machine across all worktrees (flock on a file in the git common
#       dir, so the kernel frees it when the job dies). A waiting job logs one "bg: waiting for heavy lock held by ..."
#       line. Start peak-day runs and the smoke suite with it; light jobs never wait.
#   scripts/bg.sh wait <log> [seconds]     block until <log> has its EXIT line (default 600 s; exit 124 means still running, wait again), print it, exit with that code (124 on timeout)
#   scripts/bg.sh tail <log>               last 5 lines of <log>
set -u
cmd=${1:-}
case "$cmd" in
  run)
    shift; heavy=""
    if [ "${1:-}" = "--heavy" ]; then heavy=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/bg-heavy; shift; fi
    log=${1:?log path}; shift
    [ $# -gt 0 ] || { echo "bg: no command" >&2; exit 2; }
    : > "$log"
    if [ -n "$heavy" ]; then
      nohup bash -c '
        log=$1; lock=$2; shift 2
        exec 9>>"$lock.lock"
        if ! flock -n 9; then
          echo "bg: waiting for heavy lock held by $(cat "$lock.holder" 2>/dev/null || echo unknown)" >> "$log"
          flock 9
        fi
        echo "log $log" > "$lock.holder"
        BG_HEAVY_HELD=1 "$@" >> "$log" 2>&1 9>&-; echo "EXIT $?" >> "$log"' bg "$log" "$heavy" "$@" >/dev/null 2>&1 &
    else
      nohup bash -c '"$@" >> "$0" 2>&1; echo "EXIT $?" >> "$0"' "$log" "$@" >/dev/null 2>&1 &
    fi
    echo "$!"
    ;;
  wait)
    log=${2:?log path}; max=${3:-600}; waited=0
    while ! grep -q '^EXIT [0-9]*$' "$log" 2>/dev/null; do
      [ "$waited" -ge "$max" ] && { echo "bg: still running after ${max}s: $log" >&2; exit 124; }
      sleep 5; waited=$((waited + 5))
    done
    last=$(grep '^EXIT [0-9]*$' "$log" | tail -1); echo "$last"; exit "${last#EXIT }"
    ;;
  tail)
    tail -n 5 "${2:?log path}"
    ;;
  *)
    echo "usage: scripts/bg.sh run [--heavy] <log> <command...> | wait <log> [seconds] | tail <log>" >&2; exit 2
    ;;
esac
