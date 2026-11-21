#!/bin/bash
for pat in "src/server.ts" "src/worker.ts" "next dev" "next-server" "next-router-worker"; do pkill -f "$pat" 2>/dev/null; done; sleep 2
for pat in "src/server.ts" "src/worker.ts" "next-server"; do pkill -9 -f "$pat" 2>/dev/null; done
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.orbstack/bin:$PATH"
cd "$(dirname "$0")" && docker compose stop whisper >/dev/null 2>&1
echo "✔ CB Studio parado."; sleep 2
