#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_root="$repo_dir/release"
chrome_release="$release_root/ContextShield-Chrome"
firefox_release="$release_root/ContextShield-Firefox"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/contextshield-release.XXXXXX")"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

cd "$repo_dir"
release_version="$(node -p 'require("./extension/package.json").version')"
CONTEXTSHIELD_MODEL_MANIFEST="$repo_dir/models/rampart-browser.json" ./scripts/download-models.sh
npm run build
npm run build:firefox

mkdir -p "$stage_dir/ContextShield-Chrome" "$stage_dir/ContextShield-Firefox" "$release_root"
cp -R extension/.output/chrome-mv3/. "$stage_dir/ContextShield-Chrome/"
cp -R extension/.output/firefox-mv3/. "$stage_dir/ContextShield-Firefox/"
node "$repo_dir/scripts/compact-chrome-release.mjs" "$stage_dir/ContextShield-Chrome"

node -e 'const m=require(process.argv[1]); if(m.version!==process.argv[2] || !m.host_permissions?.includes("<all_urls>")) process.exit(1)' \
  "$stage_dir/ContextShield-Chrome/manifest.json" "$release_version"
test -f "$stage_dir/ContextShield-Chrome/models/yolox-face.onnx"
test -f "$stage_dir/ContextShield-Chrome/models/ppocrv6-tiny-det.onnx"
test -f "$stage_dir/ContextShield-Chrome/models/ppocrv6-tiny-rec.onnx"
test -f "$stage_dir/ContextShield-Chrome/models/rampart/onnx/model_q4.onnx"

rm -rf "$chrome_release" "$firefox_release"
mv "$stage_dir/ContextShield-Chrome" "$chrome_release"
mv "$stage_dir/ContextShield-Firefox" "$firefox_release"
chrome_zip="$release_root/ContextShield-Chrome-$release_version.zip"
rm -f "$chrome_zip"
(cd "$chrome_release" && zip -qry "$chrome_zip" .)

echo "Stable Chrome release: $chrome_release"
echo "Stable Firefox release: $firefox_release"
echo "Chrome ZIP: $release_root/ContextShield-Chrome-$release_version.zip"
