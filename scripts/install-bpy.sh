#!/usr/bin/env bash
# Opt-in: create a Python 3.13 venv with the pinned Blender module (bpy), for `pnpm run tt:assets`.
# Not run by the session-start hook (bpy is about 1 GB). Safe to run twice: a venv that already imports bpy is left alone.
#   scripts/install-bpy.sh            prints the venv's python path on the last line
#   pnpm run tt:assets --python "$(scripts/install-bpy.sh | tail -n 1)" --check
# Env: TT_BPY_VENV (venv dir, default $HOME/.cache/tt-bpy-venv, outside the repo so later sessions reuse it),
#      TT_BPY_PYTHON313 (interpreter to build the venv, default python3.13),
#      TT_BPY_REQUIREMENTS (default: the generators' requirements.txt), TT_BPY_MODULE (module to import, default bpy).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
venv=${TT_BPY_VENV:-$HOME/.cache/tt-bpy-venv}
base=${TT_BPY_PYTHON313:-python3.13}
req=${TT_BPY_REQUIREMENTS:-$here/../src/sims/terminal-twin/assets/generators/requirements.txt}
mod=${TT_BPY_MODULE:-bpy}
py=$venv/bin/python
if [ -x "$py" ] && "$py" -c "import $mod" >/dev/null 2>&1; then
  echo "install-bpy: $mod already importable in $venv" >&2
  echo "$py"; exit 0
fi
command -v "$base" >/dev/null 2>&1 || { echo "install-bpy: $base not found (bpy 5.2 needs Python 3.13)" >&2; exit 1; }
[ -f "$req" ] || { echo "install-bpy: requirements file missing: $req" >&2; exit 1; }
[ -x "$py" ] || "$base" -m venv "$venv" >&2
"$py" -m pip install --quiet -r "$req" >&2
"$py" -c "import $mod" >/dev/null 2>&1 || { echo "install-bpy: $mod still not importable after install" >&2; exit 1; }
echo "install-bpy: installed into $venv" >&2
echo "$py"
