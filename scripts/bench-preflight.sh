#!/usr/bin/env bash
# Run before a Terminal Twin frame benchmark (docs: src/sims/terminal-twin/docs/optimising/frame-rate.md).
# Exits 1 when another heavy job (smoke suite, peak-day run) holds the machine-wide heavy lock, because frame
# numbers measured next to it are pessimistic. Exit 0 means no heavy job is running; it cannot see a plain
# `pnpm run verify` or another session's dev server, so also check the linked sessions are idle.
set -u
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || { echo "preflight: not in a git repo" >&2; exit 2; }
lock="$common/bg-heavy.lock"
holder="$common/bg-heavy.holder"
if ! command -v flock >/dev/null; then
  # bg.sh falls back to an mkdir lock directory holding the owner pid when flock is missing
  d="$common/bg-heavy.d"; p=$(cat "$d/pid" 2>/dev/null)
  if [ -d "$d" ] && { [ -z "$p" ] || kill -0 "$p" 2>/dev/null; }; then
    echo "preflight: BUSY, heavy lock held by $(cat "$holder" 2>/dev/null || echo unknown). Wait for it, then benchmark." >&2
    exit 1
  fi
  echo "preflight: no heavy job running"
  exit 0
fi
[ -e "$lock" ] || { echo "preflight: no heavy job has ever run here, machine looks quiet"; exit 0; }
exec 9>>"$lock"
if flock -n 9; then
  echo "preflight: no heavy job running"
  exit 0
fi
echo "preflight: BUSY, heavy lock held by $(cat "$holder" 2>/dev/null || echo unknown). Wait for it, then benchmark." >&2
exit 1
