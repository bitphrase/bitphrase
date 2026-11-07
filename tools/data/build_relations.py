"""Word pairs that cannot (or should not) be kept in the same dictionary.

  synonym   — synonyms per RuWordNet (shared synset), ru- or en-Wiktionary
  hypernym  — hypernym/hyponym per ru-Wiktionary (собака — животное)
  edit1     — differ by one letter (insertion/deletion/substitution) after ё->е
  dim       — diminutive/augmentative of another word
  hypocorism — for names: short form of a full name (Маша — Мария)

Only "clean" candidates (without hard auto_flags) are taken, to keep the report manageable.
Output: data/lexicon/conflict_pairs_{noun,adj,verb,name,place,surname,profession,brand,patronymic}.tsv
Run: python3 -I tools/data/build_relations.py
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, iter_jsonl_gz, norm, open_out  # noqa: E402

HARD = {"proper", "abbr", "obscene_or_pejorative", "archaic", "informal", "not_plain_cyrillic",
        "pluralia_tantum", "common_gender", "substantivized_adj", "possessive", "pronominal_or_numeral",
        "nonstandard_lemma", "reflexive", "not_imperfective", "intransitive", "impersonal"}


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        yield from csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)


# Proper names have their own "hard" flags (a diminutive name is not a defect)
HARD_PROP = {"forms_unverified", "unisex_name", "not_russian_given_name", "homonym_common", "homonym_name_place",
             "indeclinable", "pluralia_tantum", "not_plain_cyrillic", "toponym_ov_in", "place_type_unknown",
             "obscene_or_pejorative", "archaic", "informal"}


# Surnames: hard flags (see build_surnames.py)
HARD_SURNAME = {"rule_mismatch", "indeclinable", "femn_indeclinable", "famous_person", "homonym_common",
                "not_plain_cyrillic"}


HARD_BY_POS = {
    "surname": HARD_SURNAME,
    "profession": HARD | {"negative_sense"},
    "brand": {"no_paradigm", "hyphen", "abbreviation", "several_spellings", "suspicious_oc_form", "not_curated"},
    "patronymic": {"informal", "rule_mismatch", "no_femn", "no_base_name"},
}


def pool(pos):
    out = {}
    hard = HARD_PROP if pos in ("name", "place") else HARD_BY_POS.get(pos, HARD)
    for r in read_tsv(os.path.join(DATA, "candidates", f"{pos}.tsv")):
        if set(r["auto_flags"].split(",")) & hard:
            continue
        out.setdefault(norm(r["lemma"]), r)
    return out


def edit1_pairs(words):
    """Pairs at Levenshtein distance 1 via a deletion dictionary."""
    dels = {}
    for w in words:
        dels.setdefault(w, []).append((w, -1))
        for i in range(len(w)):
            dels.setdefault(w[:i] + w[i + 1:], []).append((w, i))
    pairs = set()
    for key, lst in dels.items():
        for a, ia in lst:
            for b, ib in lst:
                if a < b and (ia == ib or ia == -1 or ib == -1):
                    pairs.add((a, b))
    return pairs


def main():
    syn = {}

    def add(a, b, kind, src):
        a, b = norm(a), norm(b)
        if a == b:
            return
        k = (min(a, b), max(a, b))
        syn.setdefault(k, set()).add(f"{kind}:{src}")

    for r in read_tsv(os.path.join(DATA, "lexicon", "ruwordnet_senses.tsv")):
        for s in r["synonyms"].split(","):
            if s:
                add(r["lemma"], s, "synonym", "ruwordnet")
    for d in iter_jsonl_gz(os.path.join(DATA, "lexicon", "wikt_ru_subset.jsonl.gz")):
        for x in d["synonyms"]:
            add(d["word"], x["word"], "synonym", "ruwikt")
        for x in d["hypernyms"]:
            add(d["word"], x["word"], "hypernym", "ruwikt")
    for d in iter_jsonl_gz(os.path.join(DATA, "lexicon", "wikt_en_subset.jsonl.gz")):
        for x in d["synonyms"]:
            add(d["word"], x["word"], "synonym", "enwikt")
        for s in d["senses"]:
            for x in s.get("synonyms") or []:
                add(d["word"], x["word"], "synonym", "enwikt")

    for pos in ("noun", "adj", "verb", "name", "place", "surname", "profession", "brand", "patronymic"):
        p = pool(pos)
        rel = {}
        for (a, b), kinds in syn.items():
            if a in p and b in p:
                rel.setdefault((a, b), set()).update(kinds)
        for a, b in edit1_pairs(list(p)):
            rel.setdefault((a, b), set()).add("edit1")
        for w, r in p.items():
            for base in r["dim_of"].split(","):
                if base and norm(base) in p:
                    k = (min(w, norm(base)), max(w, norm(base)))
                    rel.setdefault(k, set()).add("hypocorism" if pos == "name" else "dim")
        with open_out(os.path.join(DATA, "lexicon", f"conflict_pairs_{pos}.tsv")) as f:
            f.write("a\tb\tkinds\ta_ipm\tb_ipm\n")
            for (a, b), kinds in sorted(rel.items()):
                f.write(f"{p[a]['lemma']}\t{p[b]['lemma']}\t{','.join(sorted(kinds))}\t{p[a]['rnc_ipm']}\t{p[b]['rnc_ipm']}\n")
        print(pos, "pool:", len(p), "conflict pairs:", len(rel))


if __name__ == "__main__":
    main()
