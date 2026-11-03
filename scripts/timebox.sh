#!/usr/bin/env bash
# A wall-clock budget an agent can read (an agent cannot see the clock, so "about 10 minutes" in a brief is never checked).
#   scripts/timebox.sh start [minutes]   set this worktree's deadline (default 15) and say so
#   scripts/timebox.sh left              minutes left; once over, says so and exits 1 (commit what is green and report)
#   scripts/timebox.sh status            like left, but silent when no budget was started (scripts/bg.sh wait calls it)
# The deadline lives in the worktree's git dir (TIMEBOX_FILE overrides it, for tests). Test: scripts/test-timebox.sh.
set -u
f=${TIMEBOX_FILE:-$(git rev-parse --git-dir 2>/dev/null)/timebox}
now=$(date +%s)
report() {
  [ -f "$f" ] || return 0
  local left=$(( $(cat "$f") - now ))
  if [ "$left" -le 0 ]; then echo "timebox: over by $(( (-left + 59) / 60 )) min: commit what is green and report now"; return 1; fi
  echo "timebox: $(( (left + 59) / 60 )) min left"
}
case "${1:-}" in
  start)
    m=${2:-15}
    case "$m" in ''|*[!0-9]*|0) echo "timebox: minutes must be a positive integer" >&2; exit 2 ;; esac
    echo $(( now + m * 60 )) > "$f"; echo "timebox: $m min from now" ;;
  left)
    [ -f "$f" ] || { echo "timebox: not started (scripts/timebox.sh start <minutes>)"; exit 0; }
    report ;;
  status) report ;;
  *) echo "usage: scripts/timebox.sh start [minutes] | left | status" >&2; exit 2 ;;
esac
