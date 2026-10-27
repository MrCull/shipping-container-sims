#!/bin/bash
# SessionStart hook: installs npm dependencies so lint, build and test work
# immediately in Claude Code cloud sessions. Local sessions are left alone.
# Blender/bpy (phase-2 asset pipeline) is intentionally NOT installed here.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (not npm ci) so the cached container keeps node_modules between sessions.
npm install --no-audit --no-fund
