"""Dictionary of brands (a separate dictionary, not mixed with others).

Candidate sources:
  - Wikidata (fetch_wikidata_brands.sh) — companies and brands with >= 15 Wikipedia articles;
    we take the ru label and ru aliases, Cyrillic spellings only;
  - data/seed/brands_seed.tsv — a manual seed list of consumer brands
    (in Wikidata they are usually written in Latin script: Samsung, Toyota).
Spelling familiarity: frequency in the full subtitle frequency list (1.4M word forms) +
RNC proper names. Declension: OpenCorpora dictionary lexeme, otherwise simple
rules (flag forms_by_rule): -а -> -у/-ой (Тойота), consonant -> masc. inanimate, -ом
(Самсунгом), -о/-е/-и/-у/-э/-иа — indeclinable (Рено, Ауди, Нокиа).

Output:
  data/morph/oc_brand.tsv       — paradigms (sing./plur. x case) for those found in OpenCorpora
  data/candidates/brand.tsv     — by descending familiarity, with auto_flags
Run: .venv/bin/python -I tools/data/build_brands.py
"""
import csv
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, NOUN_COLS, RAW, SUBS_FULL, load_rnc, load_subs, norm, open_out  # noqa: E402

import pymorphy3  # noqa: E402

CYR = re.compile(r"^[А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)?$")
MIN_SUBS = 20  # "familiar" spelling: occurs in subtitles at least this many times


def load_items():
    items = {}
    for path in glob.glob(os.path.join(RAW, "wikidata_brands", "r_*.tsv")):
        with open(path, encoding="utf-8") as f:
            next(f)
            for line in f:
                p = line.rstrip("\n").split("\t")
                if len(p) < 5:
                    continue
                qid = p[0].rsplit("/", 1)[-1].rstrip(">")
                label = p[1].split('"')[1] if '"' in p[1] else p[1]
                links = int(p[2].split('"')[1] if '"' in p[2] else p[2])
                aliases = p[3].strip('"').split("|") if p[3].strip('"') else []
                cls = p[4].split('"')[1] if '"' in p[4] else p[4]
                it = items.setdefault(qid, {"label": label, "links": links, "aliases": set(), "classes": set()})
                it["aliases"].update(aliases)
                it["classes"].add(cls)
    return items


SEED = os.path.join(DATA, "seed", "brands_seed.tsv")
SENSITIVE = {"alcohol", "tobacco"}  # and politically charged companies — see the flag below
STATE_OR_POLITICAL = {"газпром", "роснефть", "лукойл", "сбербанк", "юкос", "аэрофлот", "фейсбук", "инстаграм"}


def load_seed():
    out = {}
    with open(SEED, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or line.startswith("display\t") or not line.strip():
                continue
            disp, cat = line.rstrip("\n").split("\t")[:2]
            out[disp] = cat
    return out


def rule_cells(word):
    """Singular by simple rules for brands outside OpenCorpora; (cells, gender) or ({}, '')."""
    w = word.lower()
    if w.endswith(("о", "е", "и", "у", "ю", "э", "иа")):
        return {f"sing:{c}": [w] for c in ("nomn", "gent", "accs", "ablt")}, ""
    if w.endswith(("а", "я")):
        soft = w.endswith("я")
        st = w[:-1]
        sib = st[-1] in "жшчщц"
        return {"sing:nomn": [w], "sing:gent": [st + ("и" if soft or st[-1] in "гкхжшчщ" else "ы")],
                "sing:accs": [st + ("ю" if soft else "у")],
                "sing:ablt": [st + ("ей" if soft or sib else "ой")]}, "femn"
    if w[-1] in "ьй" or "-" in w:
        return {}, ""
    sib = w[-1] in "жшчщц"
    return {"sing:nomn": [w], "sing:gent": [w + "а"], "sing:accs": [w],
            "sing:ablt": [w + ("ем" if sib else "ом")]}, "masc"


def oc_lexeme(m, word):
    """OpenCorpora dictionary lexeme (noun) with lemma == word, ignoring case and ё."""
    for p in m.parse(word.lower()):
        if p.tag.POS != "NOUN" or norm(p.normal_form) != norm(word):
            continue
        if type(p.methods_stack[0][0]).__name__ != "DictionaryAnalyzer":
            continue
        cells = {}
        for f in p.lexeme:
            k = f"{f.tag.number}:{f.tag.case}"
            cells.setdefault(k, [])
            if f.word not in cells[k]:
                cells[k].append(f.word)
        return p, cells
    return None, {}


def read_lemmas(path, col="lemma"):
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as f:
        return {norm(r[col]) for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)}


def main():
    rnc = load_rnc()
    subs = load_subs(SUBS_FULL)
    seed = load_seed()
    common = {k for (k, pos) in rnc if pos in ("noun", "adj", "verb")}
    other = {"name": read_lemmas(os.path.join(DATA, "morph", "oc_name.tsv")),
             "place": read_lemmas(os.path.join(DATA, "morph", "oc_place.tsv")),
             "surname": read_lemmas(os.path.join(DATA, "morph", "oc_surname.tsv"))}
    m = pymorphy3.MorphAnalyzer()
    rows, seen = [], set()
    items = load_items()
    for disp, cat in seed.items():
        items["seed:" + disp] = {"label": disp, "links": 0, "aliases": set(), "classes": {"seed:" + cat}}
    # manual list first: its spelling and category take priority over Wikidata matches
    for qid, it in sorted(items.items(), key=lambda kv: not kv[0].startswith("seed:")):
        spellings = [s for s in {it["label"], *it["aliases"]} if CYR.match(s)]
        scored = sorted(((subs.get(norm(s), 0) + 100 * rnc.get((norm(s), "prop"), ("", 0))[1], s)
                         for s in spellings), reverse=True)
        flags = []
        if not scored:
            continue  # no Cyrillic spelling — don't use the brand in a phrase
        score, best = scored[0]
        familiar = [s for sc, s in scored if sc >= MIN_SUBS and norm(s) != norm(best)]
        if norm(best) in seen:
            continue
        seen.add(norm(best))
        if score < MIN_SUBS:
            flags.append("unfamiliar")
        if familiar:
            flags.append("several_spellings")  # Мицубиси / Мицубиши — risk when recalling
        if "-" in best:
            flags.append("hyphen")
        if best.isupper() and len(best) > 1:
            flags.append("abbreviation")  # БМВ, ВАЗ, АМД — no cases, gender is nominal
        p, cells = oc_lexeme(m, best)
        gr = set(p.tag.grammemes) if p else set()
        rule_gender = ""
        if not p:
            cells, rule_gender = rule_cells(best)
            flags.append("forms_by_rule" if cells else "no_paradigm")
            if cells and cells["sing:nomn"] == cells["sing:ablt"]:
                flags.append("indeclinable")
        if "Fixd" in gr:
            flags.append("indeclinable")
        k = norm(best)
        if k in common:
            flags.append("homonym_common")  # also a common noun: Магнит "magnet", Мир "world", Чайка "seagull"
        for kind, lem in other.items():
            if k in lem:
                flags.append(f"homonym_{kind}")  # also a name of another kind: Волга (place), Форд (surname)
        gender = next((g for g in ("masc", "femn", "neut") if g in gr), rule_gender)
        source = "seed" if qid.startswith("seed:") else "wikidata"
        if source == "wikidata":
            flags.append("not_curated")  # Wikidata gives a lot of junk (Геринг, Шорт, Ново) — manual review only
        nom = (cells.get("sing:nomn") or [""])[0]
        abl = (cells.get("sing:ablt") or [""])[0]
        stem = nom[:-1] if nom.endswith("й") else nom
        if p and nom and nom[-1] not in "аяоеиуюэь" and (not abl.startswith(stem) or gender == "femn"):
            flags.append("suspicious_oc_form")  # OpenCorpora: "дайсном", "опель" fem.
        cats = {c.split(":", 1)[1] for c in it["classes"] if c.startswith("seed:")}
        if cats & SENSITIVE or k in STATE_OR_POLITICAL:
            flags.append("sensitive")  # alcohol, tobacco, state companies/social networks — for manual review
        rows.append({
            "lemma": best.lower(), "display": best, "source": source,
            "wikidata": "" if source == "seed" else qid, "wikidata_label": "" if source == "seed" else it["label"],
            "sitelinks": str(it["links"]), "classes": ",".join(sorted(it["classes"])),
            "familiarity": str(int(score)), "other_spellings": ",".join(s for _, s in scored[1:])[:120],
            "gender": gender, "oc_grammemes": ",".join(sorted(gr)),
            "nomn": "/".join(cells.get("sing:nomn", [])), "accs": "/".join(cells.get("sing:accs", [])),
            "ablt": "/".join(cells.get("sing:ablt", [])), "gent": "/".join(cells.get("sing:gent", [])),
            "auto_flags": ",".join(flags), "rnc_ipm": f"{rnc.get((k, 'prop'), ('', 0))[1]:g}", "dim_of": "",
            "_cells": cells,
        })
    rows.sort(key=lambda r: -int(r["familiarity"]))
    cols = [c for c in rows[0] if not c.startswith("_")]
    with open_out(os.path.join(DATA, "candidates", "brand.tsv")) as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            f.write("\t".join(r[c] for c in cols) + "\n")
    with open_out(os.path.join(DATA, "morph", "oc_brand.tsv")) as f:
        f.write("\t".join(["lemma", "oc_grammemes"] + NOUN_COLS) + "\n")
        for r in rows:
            if r["_cells"]:
                f.write("\t".join([r["lemma"], r["oc_grammemes"]]
                                  + ["/".join(r["_cells"].get(c, [])) for c in NOUN_COLS]) + "\n")
    print("brands with Cyrillic spelling:", len(rows),
          "familiar:", sum("unfamiliar" not in r["auto_flags"] for r in rows),
          "familiar+declinable:", sum(not {"unfamiliar", "no_paradigm", "indeclinable"} & set(r["auto_flags"].split(","))
                                      for r in rows))


if __name__ == "__main__":
    main()
