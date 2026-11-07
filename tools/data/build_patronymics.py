"""Dictionary of patronymics (a separate dictionary): "Мария Ивановна", "Олег Петрович".

Source: OpenCorpora lexemes labeled Patr (one lexeme = masculine and feminine
form: Иванович / Ивановна). Popularity: RNC proper names (Иванович,
Ивановна are there) + the full subtitle frequency list. The link to the base name
(Петрович -> Пётр) is looked up in the name dictionary (oc_name.tsv), accounting for fleeting vowels.

Check: OpenCorpora case forms are compared with the rules (prototype of the TS code):
  masc. -ович/-евич/-ич: -а, -у, -а, -ем, -е;  fem. -овна/-евна/-ична: -ы, -е, -у, -ой, -е.
Feminine form from the masculine by rule: -ович -> -овна, -евич -> -евна, -ич -> -ична
(Ильич -> Ильинична, Кузьмич -> Кузьминична are exceptions, flag femn_irregular).

Output: data/candidates/patronymic.tsv
Run: .venv/bin/python -I tools/data/build_patronymics.py
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CASES, DATA, SUBS_FULL, load_rnc, load_subs, norm, open_out  # noqa: E402

import pymorphy3  # noqa: E402

M_ENDS = ["", "а", "у", "а", "ем", "е"]
F_ENDS = ["а", "ы", "е", "у", "ой", "е"]  # from a stem in "-н": Ивановн-а, -ы, -е, -у, -ой, -е


def femn_by_rule(masc):
    if masc.endswith(("ович", "евич")):
        return masc[:-2] + "на"
    if masc.endswith("ич"):
        return masc + "на"
    return None


def base_names(masc, names):
    """Base name from a patronymic: Петрович -> пётр, Сергеевич -> сергей, Ильич -> илья, Павлович -> павел."""
    for suf in ("ович", "евич", "ич"):
        if masc.endswith(suf):
            st = masc[: -len(suf)]
            cands = [st, st + "й", st + "ь", st + "а", st + "я"]
            if st.endswith("ь"):
                cands.append(st[:-1] + "ий")  # Васильевич -> Василий, Юрьевич -> Юрий
            if st.endswith("айл"):
                cands.append(st[:-3] + "аил")  # Михайлович -> Михаил
            if len(st) >= 2:
                cands += [st[:-1] + v + st[-1] for v in "еоё"]  # fleeting vowel: павл -> павел, льв -> лев
            if st.startswith("ль"):
                cands.append("лев")
            for c in cands:
                if norm(c) in names:
                    return c
            return ""
    return ""


def main():
    rnc = load_rnc()
    subs = load_subs(SUBS_FULL)
    names = {}
    with open(os.path.join(DATA, "candidates", "name.tsv"), encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            if r["gender"] == "masc":
                names.setdefault(norm(r["lemma"]), r)
    m = pymorphy3.MorphAnalyzer()
    rows, seen = [], set()
    for word, tag, nf, para_id, idx in m.dictionary.iter_known_words(""):
        if idx != 0 or tag.POS != "NOUN" or "Patr" not in tag or "masc" not in tag or word in seen:
            continue
        seen.add(word)
        p = next(x for x in m.parse(word) if "Patr" in x.tag and x.normal_form == nf)
        cells = {}
        for fm in p.lexeme:
            t = fm.tag
            if t.number != "sing" or t.case not in CASES or "Infr" in t:
                continue
            k = f"{t.gender}:{t.case}"
            cells.setdefault(k, [])
            if fm.word not in cells[k]:
                cells[k].append(fm.word)
        # OpenCorpora stores the bookish variant as the main one (михаилович), the usual one as a form
        # variant (михайлович): take the most frequent variant and the forms with the same stem.
        def freq(w):
            return 100 * rnc.get((norm(w), "prop"), ("", 0))[1] + subs.get(norm(w), 0)

        masc = max(cells.get("masc:nomn") or [word], key=freq)
        fv = cells.get("femn:nomn") or [""]
        femn = femn_by_rule(masc) if femn_by_rule(masc) in fv else max(fv, key=freq)  # feminine by the rule if OpenCorpora has it: Геннадьевич -> Геннадьевна
        mst, fst = masc[:-2], femn[:-3]  # stems without the endings: "иванов|ич", "иванов|на"
        for k in list(cells):
            st = mst if k.startswith("masc") else fst
            keep = [x for x in cells[k] if x.startswith(st)]
            cells[k] = keep or cells[k]
        flags = []
        if "Infr" in tag:
            flags.append("informal")
        rf = femn_by_rule(masc)
        if femn and rf != femn:
            flags.append("femn_irregular")  # the feminine form breaks the rule: Ильич -> Ильинична
        if not femn:
            flags.append("no_femn")
        # declension by rules
        bad = [c for c, e in zip(CASES, M_ENDS) if cells.get(f"masc:{c}") and masc + e not in cells[f"masc:{c}"]]
        if femn:
            st = femn[:-1]
            bad += [c for c, e in zip(CASES, F_ENDS) if cells.get(f"femn:{c}") and st + e not in cells[f"femn:{c}"]]
        if bad:
            flags.append("rule_mismatch")
        base = base_names(masc, names)
        if not base:
            flags.append("no_base_name")
        base_flags = names[norm(base)]["auto_flags"] if base else ""
        ipm = rnc.get((norm(masc), "prop"), ("", 0))[1] + rnc.get((norm(femn), "prop"), ("", 0))[1]
        fam = subs.get(norm(masc), 0) + subs.get(norm(femn), 0)
        rows.append({
            "lemma": masc, "display": masc.capitalize(), "femn": femn.capitalize(),
            "base_name": names[norm(base)]["display"] if base else "",
            "rnc_ipm": f"{ipm:g}", "subs_count": str(fam),
            "masc_accs": "/".join(cells.get("masc:accs", [])), "masc_ablt": "/".join(cells.get("masc:ablt", [])),
            "femn_accs": "/".join(cells.get("femn:accs", [])), "femn_ablt": "/".join(cells.get("femn:ablt", [])),
            "auto_flags": ",".join(flags), "base_name_flags": base_flags, "dim_of": "",
        })
    rows.sort(key=lambda r: (-float(r["rnc_ipm"]), -int(r["subs_count"])))
    cols = list(rows[0])
    with open_out(os.path.join(DATA, "candidates", "patronymic.tsv")) as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            f.write("\t".join(r[c] for c in cols) + "\n")
    hard = {"informal", "rule_mismatch", "no_femn", "no_base_name"}
    ok = [r for r in rows if not set(r["auto_flags"].split(",")) & hard]
    pop = [r for r in ok if float(r["rnc_ipm"]) > 0 or int(r["subs_count"]) >= 10]
    print("patronymics:", len(rows), "clean:", len(ok), "clean & popular:", len(pop))


if __name__ == "__main__":
    main()
