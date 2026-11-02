#!/usr/bin/env bash
# Long commands without hand-rolled sleep loops.
#   scripts/bg.sh run <log> <command...>   start detached, print the pid; <log> ends with "EXIT <code>"
#   scripts/bg.sh wait <log> [seconds]     block until <log> has its EXIT line (default 600 s; exit 124 means still running, wait again), print it, exit with that code (124 on timeout)
#   scripts/bg.sh tail <log>               last 5 lines of <log>
set -u
cmd=${1:-}
case "$cmd" in
  run)
    log=${2:?log path}; shift 2
    [ $# -gt 0 ] || { echo "bg: no command" >&2; exit 2; }
    : > "$log"
    nohup bash -c '"$@" >> "$0" 2>&1; echo "EXIT $?" >> "$0"' "$log" "$@" >/dev/null 2>&1 &
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
    echo "usage: scripts/bg.sh run <log> <command...> | wait <log> [seconds] | tail <log>" >&2; exit 2
    ;;
esac
