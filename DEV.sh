#!/bin/sh
# switchboard-launcher: start working on this project. Pulls the latest code, signs you in the first
# time, starts the Switchboard board and dashboard, then opens Claude Code here.  Run: sh DEV.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 18 or newer is needed first: https://nodejs.org"; exit 1; }
exec node .switchboard/switchboard.mjs dev "$@"
