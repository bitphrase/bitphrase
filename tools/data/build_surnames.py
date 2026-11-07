"""Dictionary of surnames (a separate dictionary, not mixed with names, toponyms and nouns).

Sources:
  - prevalence rank: greenx/hunspell-ru-surnames (surname.dic, ~100k
    surnames from a sample of 2.6M people, by descending frequency; ё is lost);
  - paradigms: OpenCorpora (label Surn; one lexeme contains masculine, feminine
    and plural forms) — dictionary lexemes only, no pymorphy predictions;
  - text frequency: RNC proper names (a "celebrity" signal).

Check: OpenCorpora forms are compared with the surname declension rules
(prototype of the future TS code):
  ov_in  — -ов/-ев/-ёв/-ин/-ын: masc. Иванов, -а, -у, -а, -ым, -е; fem. Иванова, -ой, -ой, -у, -ой, -ой;
  adj    — -ский/-цкий/-ой/-ый/-ий: like an adjective (decline() from check_adj_rules);
  cons   — ending in a consonant/-ь/-й: masculine declines like a 2nd-declension noun, feminine is indeclinable;
  other  — the rest (-о, -их/-ых, -е, -и, -у ...) — indeclinable.

Output:
  data/morph/oc_surname.tsv          — paradigms (masc|femn|plur x case)
  data/candidates/surname.tsv        — features, forms, auto_flags
Run: .venv/bin/python -I tools/data/build_surnames.py
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_adj_rules import decline as decline_adj  # noqa: E402
from common import CASES, DATA, RAW, load_rnc, norm, open_out  # noqa: E402

import pymorphy3  # noqa: E402

SURNAME_DIC = os.path.join(RAW, "surnames_hunspell", "surname.dic")
TOP_N = 20000  # how many top surnames by rank to consider
SURNAME_COLS = [f"{g}:{c}" for g in ("masc", "femn", "plur") for c in CASES]
VOWELS = set("аеёиоуыэюя")


def surname_type(lemma):
    if lemma.endswith(("ов", "ев", "ёв", "ин", "ын")):
        return "ov_in"
    if lemma.endswith(("ский", "цкий", "ой", "ый", "ий")):
        return "adj"
    if lemma[-1] not in VOWELS:
        return "cons"
    return "other"


def rule_forms(lemma):
    """Surname forms by rules; None — a type without rules (not taken)."""
    t = surname_type(lemma)
    out = {}
    if t == "ov_in":
        m = ["", "а", "у", "а", "ым", "е"]
        f = ["а", "ой", "ой", "у", "ой", "ой"]
        p = ["ы", "ых", "ым", "ых", "ыми", "ых"]
        for g, ends in (("masc", m), ("femn", f), ("plur", p)):
            for c, e in zip(CASES, ends):
                out[f"{g}:{c}"] = lemma + e
        return out
    if t == "adj":
        a = decline_adj(lemma)
        if a is None:
            return None
        for c in CASES:
            out[f"masc:{c}"] = a["masc:accs:anim" if c == "accs" else f"masc:{c}"]
            out[f"femn:{c}"] = a[f"femn:{c}"]
            out[f"plur:{c}"] = a["plur:accs:anim" if c == "accs" else f"plur:{c}"]
        return out
    if t == "cons":
        last = lemma[-1]
        if last in "ьй":
            stem, ends = lemma[:-1], ["ь" if last == "ь" else "й", "я", "ю", "я", "ем", "е"]
        else:
            # -ом/-ем: after ж/ш/ч/щ/ц unstressed is -ем (stress unknown — take the unstressed variant)
            stem, ends = lemma, ["", "а", "у", "а", "ем" if last in "жшчщц" else "ом", "е"]
        for c, e in zip(CASES, ends):
            out[f"masc:{c}"] = stem + e if c != "nomn" else lemma
            out[f"femn:{c}"] = lemma
        return out
    return None


def load_rank():
    out = []
    with open(SURNAME_DIC, encoding="utf-8") as f:
        next(f)  # first line is the number of entries
        for line in f:
            w = line.split("/")[0].strip()
            if w:
                out.append(w)
    return out


def oc_paradigm(m, word):
    """OpenCorpora dictionary lexeme labeled Surn with lemma == word (ignoring ё)."""
    for p in m.parse(word):
        if "Surn" not in p.tag or norm(p.normal_form) != norm(word):
            continue
        if type(p.methods_stack[0][0]).__name__ != "DictionaryAnalyzer":
            continue
        cells = {}
        for f in p.lexeme:
            t = f.tag
            g = "plur" if t.number == "plur" else str(t.gender) if t.gender else None
            if g is None or t.case not in CASES:
                continue
            k = f"{g}:{t.case}"
            lst = cells.setdefault(k, [])
            if f.word not in lst:
                lst.append(f.word)
        return p.normal_form, p.tag, cells
    return None


def read_lemmas(path):
    with open(path, encoding="utf-8") as f:
        return {norm(r["lemma"]) for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)}


def main():
    rnc = load_rnc()
    # homonymy — only with nouns and non-possessive adjectives
    # (иванов/петров in the RNC are possessive adjectives "Иванов день", not homonyms)
    common = {k for (k, pos) in rnc
              if pos == "noun" or (pos == "adj" and not k.endswith(("ов", "ев", "ин", "ын")))}
    names = read_lemmas(os.path.join(DATA, "morph", "oc_name.tsv"))
    places = read_lemmas(os.path.join(DATA, "morph", "oc_place.tsv"))
    m = pymorphy3.MorphAnalyzer()
    ranks = load_rank()[:TOP_N]

    par = open_out(os.path.join(DATA, "morph", "oc_surname.tsv"))
    par.write("\t".join(["lemma", "rank", "oc_grammemes", "type", "rule_ok"] + SURNAME_COLS) + "\n")
    cand_cols = ["lemma", "display", "rank", "type", "rnc_ipm", "len", "rule_ok",
                 "masc_nomn", "masc_accs", "masc_ablt", "masc_gent",
                 "femn_nomn", "femn_accs", "femn_ablt", "femn_gent", "auto_flags", "dim_of"]
    cand = open_out(os.path.join(DATA, "candidates", "surname.tsv"))
    cand.write("\t".join(cand_cols) + "\n")
    seen = set()
    stats = {"ranked": len(ranks), "in_opencorpora": 0, "rule_ok": 0}
    for rank, w in enumerate(ranks, 1):
        key = norm(w)
        if key in seen:
            continue
        seen.add(key)
        flags = []
        found = oc_paradigm(m, w)
        if found:
            lemma, tag, cells = found
            stats["in_opencorpora"] += 1
        else:
            lemma, tag, cells = w, None, {}
            flags.append("not_in_opencorpora")
        t = surname_type(lemma)
        rules = rule_forms(lemma)
        gr = set(tag.grammemes) if tag else set()
        rule_ok = ""
        if cells and rules:
            # check singular only (the template doesn't need plural); no feminine forms in OC — a dictionary gap
            sing = [c for c in SURNAME_COLS if not c.startswith("plur")]
            bad = [c for c in sing if c in cells and rules.get(c) not in cells[c]]
            if any(c not in cells for c in sing):
                flags.append("oc_incomplete")
            rule_ok = "0" if bad else "1"
            if rule_ok == "1":
                stats["rule_ok"] += 1
            else:
                flags.append("rule_mismatch")  # Синицин/Зайкин: OC declines it as foreign (-ом)
        elif rules:
            flags.append("forms_by_rule")  # not in OpenCorpora: forms by rules only
        if "Fixd" in gr or t == "other":
            flags.append("indeclinable")
        if t == "cons":
            flags.append("femn_indeclinable")  # Шевчук — the feminine form has no cases and no gender in the ending
        ipm = rnc.get((key, "prop"), ("", 0.0))[1]
        if ipm >= 5 and rank > 300:
            flags.append("famous_person")  # frequent in texts despite modest prevalence: Пушкин, Ленин
        if key in common:
            flags.append("homonym_common")  # also a common word: Толстой "fat", Орёл "eagle", Комар "mosquito"
        if key in names:
            flags.append("homonym_name")
        if key in places:
            flags.append("homonym_place")  # also a place name: Королёв, Киров
        if not lemma.isalpha():
            flags.append("not_plain_cyrillic")

        def first(c):
            v = cells.get(c) or ([rules[c]] if rules and c in rules else [])
            return "/".join(v)

        par.write("\t".join([lemma, str(rank), ",".join(sorted(gr)), t, rule_ok]
                            + ["/".join(cells.get(c, [])) for c in SURNAME_COLS]) + "\n")
        row = {"lemma": lemma, "display": lemma.capitalize(), "rank": str(rank), "type": t,
               "rnc_ipm": f"{ipm:g}", "len": str(len(lemma)), "rule_ok": rule_ok,
               "masc_nomn": first("masc:nomn"), "masc_accs": first("masc:accs"),
               "masc_ablt": first("masc:ablt"), "masc_gent": first("masc:gent"),
               "femn_nomn": first("femn:nomn"), "femn_accs": first("femn:accs"),
               "femn_ablt": first("femn:ablt"), "femn_gent": first("femn:gent"),
               "auto_flags": ",".join(flags), "dim_of": ""}
        cand.write("\t".join(row[c] for c in cand_cols) + "\n")
    par.close()
    cand.close()
    print("surnames:", stats)


if __name__ == "__main__":
    main()
