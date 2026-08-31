#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"
./START.sh
echo
echo "ContextShield is ready. You may close this window."
read -r -p "Press Return to close..." _
