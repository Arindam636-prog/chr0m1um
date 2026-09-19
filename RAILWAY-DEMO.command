#!/bin/bash
set -euo pipefail
railway_repo="$(cd "$(dirname "$0")" && pwd)"
cd "$railway_repo"
echo "ContextShield railway sandbox: http://127.0.0.1:4173/railway.html"
echo "Load release/ContextShield-Chrome in Chrome, then choose Railway demo in the extension."
echo "Local rehearsal needs no Qwen server. Use START.command for the full model services."
if curl --silent --fail --max-time 2 http://127.0.0.1:4173/railway.html >/dev/null 2>&1; then
  echo "The railway demo is already available at the link above."
  exit 0
fi
if lsof -tiTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 4173 is occupied by a different or older site. Stop that server before continuing." >&2
  exit 1
fi
exec python3 -m http.server 4173 --bind 127.0.0.1 --directory "$railway_repo/demo"
