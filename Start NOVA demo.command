#!/bin/bash
# Double-click this file on a Mac to start the NOVA demo and open it in your browser.
# (If the Mac says it cannot be opened: right-click it, choose Open, then Open again. Or in Terminal: bash "Start NOVA demo.command")
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo; echo "  Node.js is not installed yet. Go to https://nodejs.org, download the \"LTS\" version,"; echo "  install it, then open this file again."; echo; read -r -p "Press Enter to close"; exit 1
fi
echo "Starting NOVA... your browser will open in a few seconds."
echo "Sign in with:  demo@nova.local"
echo "Keep this window open while you use NOVA. Close it to stop NOVA."
( sleep 4; open "http://127.0.0.1:8788" ) &
node scripts/demo.js
