#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "[FluxAudit] Python 3 not found. Install Python >= 3.10 and retry."
  exit 1
fi

python3 "$SCRIPT_DIR/launch_fluxaudit.py"
