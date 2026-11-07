"""Cross-check of OpenCorpora paradigms against Wiktionary (ru and en).

For each OpenCorpora lexeme we take the Wiktionary entry with the same lemma
(for homonyms — the best-matching one) and compare paradigm cells
ignoring stress. The result is a "verified" paradigm with stress marks:

  data/morph/verified_{noun,adj,verb}.tsv
     lemma, oc_para_id, oc_grammemes, wikt_tags, wikt_class, wikt_sources,
     core_ok (all "core" cells confirmed), n_agree, n_conflict, n_unverified,
     then the cells: the stressed form, if confirmed;
                   "?form" — present only in OpenCorpora;
                   "!oc|wikt" — the sources disagree.
  data/morph/crosscheck_conflicts.tsv — all disagreements (for manual review)

Comparison: case-insensitive, stress marks removed; ё/е are distinguished, but
a difference "only in ё" is marked separately (yo) and not counted as a conflict.
Run: python3 -I tools/data/crosscheck_paradigms.py
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COLS, DATA, norm, open_out, strip_stress, wikt_pos  # noqa: E402

# Cells needed by the phrase template (and extensions from the plan) — core_ok is based on them.
CORE = {
    "noun": ["sing:nomn", "sing:gent", "sing:accs", "sing:ablt", "plur:nomn", "plur:gent"],
    "adj": [c for c in COLS["adj"] if not c.startswith(("short", "comp", "supr"))],
    "verb": ["infn", "pres:sing:3per", "pres:plur:3per"],
    "name": ["sing:nomn", "sing:gent", "sing:accs", "sing:ablt"],
    "place": ["sing:nomn", "sing:gent", "sing:accs", "sing:ablt"],
}
SKIP_CHECK = {"comp", "supr"}  # Wiktionary lists comparative forms inconsistently


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        r = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        yield from r


def split(v):
    return [x for x in v.split("/") if x] if v else []


def low(x):
    return strip_stress(x).lower()


def compare(oc_forms, wk_forms):
    if not oc_forms:
        return "no_oc" if wk_forms else "empty"
    if not wk_forms:
        return "no_wikt"
    a, b = {low(x) for x in oc_forms}, {low(x) for x in wk_forms}
    if a == b:
        return "agree"
    if low(oc_forms[0]) in b:
        return "variant"      # the main OC form is confirmed, the set of variants differs
    if {norm(x) for x in a} & {norm(x) for x in b}:
        return "yo"
    return "conflict"


def main():
    for pos, cols in COLS.items():
        wk = {}
        for r in read_tsv(os.path.join(DATA, "morph", f"wikt_{wikt_pos(pos)}.tsv")):
            wk.setdefault(norm(r["lemma"]), []).append(r)
        out = open_out(os.path.join(DATA, "morph", f"verified_{pos}.tsv"))
        out.write("\t".join(["lemma", "oc_para_id", "oc_grammemes", "wikt_tags", "wikt_class", "wikt_sources",
                             "core_ok", "n_agree", "n_conflict", "n_unverified"] + cols) + "\n")
        conf = open_out(os.path.join(DATA, "morph", f"crosscheck_conflicts_{pos}.tsv"))
        conf.write("lemma\toc_para_id\toc_grammemes\tcell\tstatus\topencorpora\twiktionary\twikt_source\n")
        stats = {"lexemes": 0, "core_ok": 0, "no_wikt": 0}
        for r in read_tsv(os.path.join(DATA, "morph", f"oc_{pos}.tsv")):
            stats["lexemes"] += 1
            cands = wk.get(norm(r["lemma"]), [])
            # best entry from each source
            best = {}
            for w in cands:
                score = sum(compare(split(r[c]), split(w[c])) in ("agree", "variant", "yo") for c in cols)
                if score > best.get(w["source"], (-1, None))[0]:
                    best[w["source"]] = (score, w)
            wsrc = [b[1] for _, b in sorted(best.items()) if b[0] > 0]
            if not wsrc:
                stats["no_wikt"] += 1
            cells, n_ag, n_cf, n_un, core_ok = [], 0, 0, 0, bool(wsrc)
            for c in cols:
                oc = split(r[c])
                if not oc:
                    cells.append("")
                    continue
                verdicts = [(compare(oc, split(w[c])), w) for w in wsrc]
                verdicts = [(v, w) for v, w in verdicts if v not in ("no_wikt", "empty")]
                ok = [w for v, w in verdicts if v in ("agree", "variant", "yo")]
                if c in SKIP_CHECK:
                    cells.append("/".join(oc))
                    continue
                if ok:
                    n_ag += 1
                    stressed = {low(x): x for x in split(ok[0][c])}
                    cells.append("/".join(stressed.get(low(x), x) for x in oc))
                    for v, w in verdicts:
                        if v in ("conflict", "yo"):
                            conf.write("\t".join([r["lemma"], r["oc_para_id"], r["oc_grammemes"], c, v + "_partial",
                                                  r[c], w[c], w["source"]]) + "\n")
                elif verdicts:
                    n_cf += 1
                    cells.append("!" + "/".join(oc) + "|" + verdicts[0][1][c])
                    for v, w in verdicts:
                        conf.write("\t".join([r["lemma"], r["oc_para_id"], r["oc_grammemes"], c, v,
                                              r[c], w[c], w["source"]]) + "\n")
                    if c in CORE[pos]:
                        core_ok = False
                else:
                    n_un += 1
                    cells.append("?" + "/".join(oc))
                    if c in CORE[pos]:
                        core_ok = False
            stats["core_ok"] += core_ok
            wt = wsrc[0] if wsrc else {"wikt_tags": "", "wikt_class": ""}
            out.write("\t".join([r["lemma"], r["oc_para_id"], r["oc_grammemes"], wt["wikt_tags"], wt["wikt_class"],
                                 ",".join(w["source"] for w in wsrc), "1" if core_ok else "0",
                                 str(n_ag), str(n_cf), str(n_un)] + cells) + "\n")
        out.close()
        conf.close()
        print(pos, stats)


if __name__ == "__main__":
    main()
