"""Compact Wiktionary subsets (kaikki.org / wiktextract) for candidate lemmas.

We keep only Russian nouns/adjectives/verbs whose lemma is in the RNC, and proper
names (pos = prop: Wiktionary does not separate names from toponyms — that is done
via OpenCorpora) exported from OpenCorpora, and only the fields
needed for selection and checking: stressed forms, declension/conjugation class,
labels, synonyms/antonyms/hypernyms, related words (diminutives etc.),
metagrams (words differing by one letter), categories, definitions.

Output:
  data/lexicon/wikt_ru_subset.jsonl.gz   — from Russian Wiktionary
  data/lexicon/wikt_en_subset.jsonl.gz   — from English Wiktionary
Run: python3 -I tools/data/extract_wiktionary.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, WIKT_EN, WIKT_RU, iter_jsonl_gz, load_rnc, norm, open_out, prop_categories  # noqa: E402

POS_KEEP = {"noun": "noun", "adj": "adj", "verb": "verb", "name": "prop"}  # name -> prop (proper names)


def cat_names(cats):
    out = []
    for c in cats or []:
        out.append(c if isinstance(c, str) else c.get("name"))
    return out


def words(lst, keep=("word", "sense_index", "tags", "raw_tags", "sense")):
    return [{k: v for k, v in x.items() if k in keep} for x in (lst or []) if x.get("word")]


def ru_entry(d):
    senses = []
    for s in d.get("senses", []):
        senses.append({
            "glosses": s.get("glosses"),
            "tags": s.get("tags"),
            "raw_tags": s.get("raw_tags"),
            "categories": cat_names(s.get("categories")),
        })
    return {
        "word": d["word"], "pos": d["pos"], "tags": d.get("tags"), "raw_tags": d.get("raw_tags"),
        "forms": [{k: f.get(k) for k in ("form", "tags", "raw_tags") if f.get(k)} for f in d.get("forms", [])],
        "synonyms": words(d.get("synonyms")), "antonyms": words(d.get("antonyms")),
        "hypernyms": words(d.get("hypernyms")), "hyponyms": words(d.get("hyponyms")),
        "related": words(d.get("related")), "metagrams": [x["word"] for x in d.get("metagrams", []) if x.get("word")],
        "categories": cat_names(d.get("categories")), "senses": senses,
    }


def en_entry(d):
    senses = []
    for s in d.get("senses", []):
        senses.append({
            "glosses": s.get("glosses"),
            "tags": s.get("tags"),
            "topics": s.get("topics"),
            "categories": cat_names(s.get("categories")),
            "synonyms": words(s.get("synonyms")),
            "antonyms": words(s.get("antonyms")),
            "hypernyms": words(s.get("hypernyms")),
        })
    return {
        "word": d["word"], "pos": d["pos"],
        "head_templates": d.get("head_templates"),
        "forms": [{k: f.get(k) for k in ("form", "tags") if f.get(k)} for f in d.get("forms", [])
                  if "romanization" not in (f.get("tags") or [])],
        "synonyms": words(d.get("synonyms")), "antonyms": words(d.get("antonyms")),
        "derived": words(d.get("derived")), "related": words(d.get("related")),
        "categories": cat_names(d.get("categories")), "senses": senses,
        "prop_categories": sorted(prop_categories(d)),
    }


def load_oc_prop():
    """Lemmas of names and toponyms exported from OpenCorpora (extract_opencorpora.py)."""
    out = set()
    for kind in ("name", "place"):
        with open(os.path.join(DATA, "morph", f"oc_{kind}.tsv"), encoding="utf-8") as f:
            next(f)
            for line in f:
                out.add((norm(line.split("\t", 1)[0]), "prop"))
    return out


def run(src, dst, conv, lang_code="ru"):
    rnc = set(load_rnc()) | load_oc_prop()
    n_in = n_out = 0
    with open_out(dst) as out:
        for d in iter_jsonl_gz(src):
            n_in += 1
            if d.get("lang_code") != lang_code:
                continue
            pos = POS_KEEP.get(d.get("pos"))
            if pos is None or (norm(d.get("word", "")), pos) not in rnc:
                continue
            e = conv(d)
            e["pos"] = pos
            out.write(json.dumps(e, ensure_ascii=False) + "\n")
            n_out += 1
    print(os.path.basename(dst), "entries in:", n_in, "kept:", n_out)


def main():
    run(WIKT_RU, os.path.join(DATA, "lexicon", "wikt_ru_subset.jsonl.gz"), ru_entry)
    run(WIKT_EN, os.path.join(DATA, "lexicon", "wikt_en_subset.jsonl.gz"), en_entry)


if __name__ == "__main__":
    main()
