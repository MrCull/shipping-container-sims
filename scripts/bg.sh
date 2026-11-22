#!/usr/bin/env bash
# Long commands without hand-rolled sleep loops.
#   scripts/bg.sh run [--heavy] <log> <command...>   start detached, print the pid; <log> ends with "EXIT <code>"
#       --heavy: one heavy job at a time on the machine across all worktrees (flock on a file in the git common
#       dir, so the kernel frees it when the job dies). A waiting job logs one "bg: waiting for heavy lock held by ..."
#       line. Start peak-day runs and the smoke suite with it; light jobs never wait.
#   scripts/bg.sh wait <log> [seconds]     block until <log> has its EXIT line (default 600 s; exit 124 means still running, wait again), print it, exit with that code (124 on timeout)
#       With a budget started (scripts/timebox.sh start), wait also prints the minutes left (stderr, before the EXIT line).
#   scripts/bg.sh tail <log>               last 5 lines of <log>
#   scripts/bg.sh stop <log>               stop a running job and every process it started; its log ends with "EXIT 143"
#   Clean-up: when a job ends, fails or is stopped, every process it started is ended too (TERM, KILL after 5 s), found by the
#   BG_JOB marker each one inherits in its environment (Linux /proc), so servers a job orphaned or detached never outlive it.
#   <log>.bg holds the wrapper pid and the job id while it runs. Processes the job did not start are never touched.
set -u
here=$(cd "$(dirname "$0")" && pwd)
# job_pids <id>: every process (but this shell) whose environment carries BG_JOB=<id>, i.e. one the job started.
job_pids() {
  local f p
  [ -d /proc/self ] || return 0
  for f in /proc/[0-9]*/environ; do
    p=${f#/proc/}; p=${p%/environ}
    [ "$p" = "$$" ] || [ "$p" = "$BASHPID" ] && continue
    grep -qszxF "BG_JOB=$1" "$f" 2>/dev/null && echo "$p"
  done
}
# reap <id> <child pid>: TERM every process of the job, KILL what is left after 5 s.
reap() {
  local id=$1 pids i
  export -n BG_JOB 2>/dev/null
  pids="$(job_pids "$id") $2"
  [ -n "${pids// /}" ] || return 0
  kill -TERM $pids 2>/dev/null
  for i in $(seq 1 25); do
    pids=$(for p in $pids; do kill -0 "$p" 2>/dev/null && echo "$p"; done; job_pids "$id")
    [ -z "$pids" ] && return 0
    sleep 0.2
  done
  kill -KILL $pids 2>/dev/null
}
cmd=${1:-}
case "$cmd" in
  run)
    shift; heavy=""
    if [ "${1:-}" = "--heavy" ]; then heavy=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/bg-heavy; shift; fi
    log=${1:?log path}; shift
    [ $# -gt 0 ] || { echo "bg: no command" >&2; exit 2; }
    : > "$log"
    id="$(cd "$(dirname "$log")" && pwd)/$(basename "$log"):$$:$RANDOM$RANDOM"
    BG_JOB=$id nohup bash "$here/bg.sh" _job "$log" "$heavy" "$@" >/dev/null 2>&1 &
    printf '%s %s\n' "$!" "$id" > "$log.bg"
    echo "$!"
    ;;
  _job)
    # The detached job wrapper. Every process the job starts inherits BG_JOB, so reap finds them all,
    # even ones that left the process group (Playwright starts its web servers with setsid) or were orphaned.
    shift; log=$1; lock=$2; shift 2
    if [ -n "$lock" ]; then
      exec 9>>"$lock.lock"
      if command -v flock >/dev/null; then
        if ! flock -n 9; then
          echo "bg: waiting for heavy lock held by $(cat "$lock.holder" 2>/dev/null || echo unknown)" >> "$log"
          flock 9
        fi
      else
        # No flock (Git Bash on Windows): an atomic mkdir lock holding the owner pid; a dead owner is stale.
        d="$lock.d"; said=""
        until mkdir "$d" 2>/dev/null; do
          p=$(cat "$d/pid" 2>/dev/null)
          if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$d"; continue; fi
          [ -n "$said" ] || echo "bg: waiting for heavy lock held by $(cat "$lock.holder" 2>/dev/null || echo unknown)" >> "$log"
          said=1; sleep 1
        done
        echo $$ > "$d/pid"
      fi
      echo "log $log" > "$lock.holder"
      export BG_HEAVY_HELD=1
    fi
    stopped=""; trap 'stopped=1' TERM INT HUP
    "$@" >> "$log" 2>&1 9>&- &
    child=$!
    wait "$child"; rc=$?
    [ -n "$stopped" ] && rc=143
    reap "$BG_JOB" "$child"
    [ -z "${d:-}" ] || rm -rf "$d"
    rm -f "$log.bg"
    echo "EXIT $rc" >> "$log"
    ;;
  stop)
    log=${2:?log path}
    grep -q '^EXIT [0-9]*$' "$log" 2>/dev/null && { echo "bg: not running: $log" >&2; exit 0; }
    read -r pid id < "$log.bg" 2>/dev/null || { echo "bg: no job record ($log.bg)" >&2; exit 1; }
    kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 30); do grep -q '^EXIT [0-9]*$' "$log" 2>/dev/null && break; sleep 0.5; done
    if ! grep -q '^EXIT [0-9]*$' "$log" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null; reap "$id" ""; rm -f "$log.bg"; echo "EXIT 143" >> "$log"
    fi
    grep '^EXIT [0-9]*$' "$log" | tail -1
    ;;
  wait)
    log=${2:?log path}; max=${3:-600}; waited=0
    while ! grep -q '^EXIT [0-9]*$' "$log" 2>/dev/null; do
      [ "$waited" -ge "$max" ] && { "$here/timebox.sh" status >&2; echo "bg: still running after ${max}s: $log" >&2; exit 124; }
      sleep 5; waited=$((waited + 5))
    done
    "$here/timebox.sh" status >&2
    last=$(grep '^EXIT [0-9]*$' "$log" | tail -1); echo "$last"; exit "${last#EXIT }"
    ;;
  tail)
    tail -n 5 "${2:?log path}"
    ;;
  *)
    echo "usage: scripts/bg.sh run [--heavy] <log> <command...> | wait <log> [seconds] | tail <log> | stop <log>" >&2; exit 2
    ;;
esac
