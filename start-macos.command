#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/start-macos-linux.sh"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo
  read -r -p "FluxAudit failed to start. Press Return to close..."
fi

exit "$STATUS"
