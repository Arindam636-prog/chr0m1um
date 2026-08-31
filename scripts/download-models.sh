#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest_path="${CONTEXTSHIELD_MODEL_MANIFEST:-}"

if [[ -z "$manifest_path" || ! -f "$manifest_path" ]]; then
  echo "Set CONTEXTSHIELD_MODEL_MANIFEST to a reviewed model manifest." >&2
  echo "See models/README.md. Unverified model downloads are refused." >&2
  exit 1
fi

python3 "$repo_dir/scripts/download_models.py" "$manifest_path" "$repo_dir"

