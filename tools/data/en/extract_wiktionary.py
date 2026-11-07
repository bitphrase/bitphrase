"""English Wiktionary (kaikki.org) -> data/en/lexicon/wikt.jsonl.gz: a compact subset.

Keeps single-word nouns, verbs, adjectives and proper names with their inflected forms,
per-sense tags (countable, transitive, vulgar, archaic...) and the name/place categories.
Everything downstream reads this subset instead of the 3 GB dump.

Run: python3 -I tools/data/en/extract_wiktionary.py
"""
import gzip
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, jsonl, path  # noqa: E402

SRC = os.path.join(RAW, "wiktionary_kaikki", "kaikki.org-dictionary-English.jsonl.gz")
WORD = re.compile(r"^[A-Za-z]+$")
POS = {"noun", "verb", "adj", "name"}
# Form tags worth keeping, by part of speech.
FORM_TAGS = {
    "noun": [("plural", {"plural"})],
    "name": [("plural", {"plural"})],
    "verb": [("pres3", {"present", "singular", "third-person"}), ("ing", {"participle", "present"}),
             ("past", {"past"}), ("pp", {"participle", "past"})],
    "adj": [("comp", {"comparative"}), ("sup", {"superlative"})],
}
BAD_FORM = {"archaic", "obsolete", "dialectal", "nonstandard", "rare", "humorous", "childish", "misspelling",
            "alternative", "uncommon", "informal", "dated", "colloquial", "proscribed", "Scotland", "error"}
CATEGORY = re.compile(r"given names|surnames|^(Cities|Capital cities|Countries|Places|Towns|Rivers|Islands|Mountains)\b")


def forms_of(e):
    out = {}
    for name, need in FORM_TAGS[e["pos"]]:
        for f in e.get("forms", []):
            tags = set(f.get("tags", []))
            if f.get("source") or not need <= tags or tags & BAD_FORM:
                continue
            if name == "past" and "participle" in tags:
                continue
            w = f["form"]
            if WORD.match(w) and w not in out.setdefault(name, []):
                out[name].append(w)
    return out


def main():
    out = path("lexicon", "wikt.jsonl.gz")
    n = kept = 0
    with gzip.open(out, "wt", encoding="utf-8") as dst:
        for e in jsonl(SRC):
            n += 1
            w, pos = e.get("word", ""), e.get("pos")
            if pos not in POS or not WORD.match(w) or len(w) > 16:
                continue
            senses = []
            for s in e.get("senses", []):
                tags = sorted(set(s.get("tags") or []))
                cats = sorted({c["name"] for c in s.get("categories") or [] if CATEGORY.search(c.get("name", ""))})
                gloss = (s.get("glosses") or [""])[-1][:160]
                if "form-of" in tags or "alt-of" in tags:
                    tags = tags + ["@form-of"]
                senses.append({"t": tags, "c": cats, "g": gloss, "topics": s.get("topics", [])[:4]})
            if not senses:
                continue
            head = (e.get("head_templates") or [{}])[0].get("expansion", "")
            rec = {"w": w, "pos": pos, "f": forms_of(e), "s": senses, "head": head[:200]}
            dst.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
            kept += 1
            if kept % 100000 == 0:
                print(f"  {kept} / {n}")
    print(f"{out}: {kept} entries of {n}")


if __name__ == "__main__":
    main()
