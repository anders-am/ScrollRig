#!/usr/bin/env bash
# Packages the extension for the Chrome Web Store.
# Only ships what the extension actually loads — docs and design files stay out.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json | sed 's/.*"\([^"]*\)"$/\1/')
OUT="dist/scrollrig-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  panel.html \
  panel.css \
  panel.js \
  icons \
  -x '*.DS_Store' > /dev/null

echo "Built $OUT"
unzip -l "$OUT" | awk 'NR>3 && !/^ *-+/ && !/files?$/ { print "  " $NF }'
