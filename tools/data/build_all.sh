#!/bin/sh
# Rebuild all derived tables in data/ from data/raw/.
# Needs a venv with pymorphy3 (see data/README.md); the path can be overridden with VENV=...
set -e
cd "$(dirname "$0")/../.."
VENV="${VENV:-.venv}"
"$VENV/bin/python" -I tools/data/extract_opencorpora.py
python3 -I tools/data/extract_wiktionary.py
python3 -I tools/data/export_ruwordnet.py
python3 -I tools/data/build_wikt_paradigms.py
python3 -I tools/data/crosscheck_paradigms.py
python3 -I tools/data/build_candidates.py
"$VENV/bin/python" -I tools/data/build_surnames.py
"$VENV/bin/python" -I tools/data/build_brands.py   # Wikidata: tools/data/fetch_wikidata_brands.sh (once)
python3 -I tools/data/build_professions.py
"$VENV/bin/python" -I tools/data/build_patronymics.py
python3 -I tools/data/build_relations.py
python3 -I tools/data/check_adj_rules.py
"$VENV/bin/python" -I tools/data/gen_templates.py
"$VENV/bin/python" -I tools/data/export_app_dicts.py
