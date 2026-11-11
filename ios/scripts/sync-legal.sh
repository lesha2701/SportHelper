#!/bin/sh
# Copies the legal documents of the site into the app (App/Resources/Legal) so they can be read in the app, offline.
# Run it after every new edition of a document (docs/legal.md in the repository root); a test fails while the copy is out of date.
set -eu
cd "$(dirname "$0")/.."
src="../frontend/src/legal/data"
dst="App/Resources/Legal"
mkdir -p "$dst"
rm -f "$dst"/*.json
cp "$src"/*.json "$dst"/
echo "Copied $(ls "$dst" | wc -l | tr -d ' ') documents to $dst"
