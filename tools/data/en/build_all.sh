#!/bin/sh
# Rebuild the English dictionaries from data/en/raw/ (see data/en/README.md for the downloads).
set -e
cd "$(dirname "$0")/../../.."
python3 -I tools/data/en/extract_wiktionary.py   # ~3 minutes: reads the 0.5 GB Wiktionary dump
python3 -I tools/data/en/extract_wordnet.py
python3 -I tools/data/en/build_candidates.py
python3 -I tools/data/en/gen_dicts.py
