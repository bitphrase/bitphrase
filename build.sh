#!/usr/bin/env bash
# Builds build/bitphrase.html and build/pages/ (the PWA); installs dependencies on the first run.
# `./build.sh --watch` rebuilds on every change.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  npm install
fi

node build.mjs "$@"
