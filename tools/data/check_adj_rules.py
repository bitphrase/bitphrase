"""Check of the adjective declension rules from Plan_1 (section 6.1) against the full reference.

We generate all 4 x 6 (+ animate/inanimate accusative) forms from the lemma alone and compare them
with the verified paradigms (OpenCorpora, confirmed by Wiktionary).
This is a prototype of the future TS function decline(); here it only serves to find out,
before writing the code, where the rules break.

Output: data/exceptions/adj_rule_mismatches.tsv
Run: python3 -I tools/data/check_adj_rules.py
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COLS, DATA, open_out, strip_stress  # noqa: E402

# Hard type (like "новый"); the first letter of the ending is then fixed by spelling rules.
HARD = {
    "masc": {"nomn": "ый", "gent": "ого", "datv": "ому", "accs:inan": "ый", "accs:anim": "ого", "ablt": "ым", "loct": "ом"},
    "neut": {"nomn": "ое", "gent": "ого", "datv": "ому", "accs": "ое", "ablt": "ым", "loct": "ом"},
    "femn": {"nomn": "ая", "gent": "ой", "datv": "ой", "accs": "ую", "ablt": "ой", "loct": "ой"},
    "plur": {"nomn": "ые", "gent": "ых", "datv": "ым", "accs:inan": "ые", "accs:anim": "ых", "ablt": "ыми", "loct": "ых"},
}
SOFT_FIRST = {"ы": "и", "о": "е", "а": "я", "у": "ю"}
VELAR = set("гкх")
SIBILANT = set("жшчщ")


def decline(lemma):
    """{column: form} per the Plan_1 6.1 rules. None — the lemma is outside the rules."""
    if lemma.endswith("ой"):
        stressed, soft = True, False
    elif lemma.endswith("ый"):
        stressed, soft = False, False
    elif lemma.endswith("ий"):
        stressed = False
        soft = lemma[-3] not in VELAR | SIBILANT
    else:
        return None
    stem = lemma[:-2]
    last = stem[-1]
    out = {}
    for g, cells in HARD.items():
        for c, end in cells.items():
            if g == "masc" and c in ("nomn", "accs:inan"):
                out[f"{g}:{c}"] = lemma
                continue
            first, rest = end[0], end[1:]
            if soft:
                first = SOFT_FIRST.get(first, first)
            else:
                if first == "ы" and last in VELAR | SIBILANT:
                    first = "и"
                if first == "о" and not stressed and last in SIBILANT | {"ц"}:
                    first = "е"
            out[f"{g}:{c}"] = stem + first + rest
    return out


def main():
    path = os.path.join(DATA, "morph", "verified_adj.tsv")
    with open(path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    cand = {}
    with open(os.path.join(DATA, "candidates", "adj.tsv"), encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            cand[(r["lemma"], r["oc_para_id"])] = r
    cols = [c for c in COLS["adj"] if not c.startswith(("short", "comp", "supr"))]
    n = ok = skipped = 0
    with open_out(os.path.join(DATA, "exceptions", "adj_rule_mismatches.tsv")) as out:
        out.write("lemma\toc_para_id\tauto_flags\tcell\trule_form\treference\n")
        for r in rows:
            gen = decline(r["lemma"])
            if gen is None:
                skipped += 1
                continue
            n += 1
            bad = []
            for c in cols:
                ref = r[c]
                if not ref or ref.startswith(("?", "!")):
                    continue
                variants = {strip_stress(x) for x in ref.split("/")}
                if gen[c] not in variants:
                    bad.append((c, gen[c], ref))
            if not bad:
                ok += 1
            for c, g, ref in bad:
                flags = cand.get((r["lemma"], r["oc_para_id"]), {}).get("auto_flags", "")
                out.write(f"{r['lemma']}\t{r['oc_para_id']}\t{flags}\t{c}\t{g}\t{ref}\n")
    print(f"adjectives checked: {n}, all forms match: {ok}, with mismatches: {n - ok}, outside rules: {skipped}")


if __name__ == "__main__":
    main()
