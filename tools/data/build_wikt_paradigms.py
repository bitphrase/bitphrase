"""Paradigms from Wiktionaries (ru + en) in the same column format as oc_*.tsv,
with stress marks (U+0301). This is a second source of forms, independent of OpenCorpora.

Output: data/morph/wikt_{noun,adj,verb,prop}.tsv (prop — names and toponyms together, as in the source)
  source       — ru | en (Russian or English Wiktionary)
  wikt_tags    — entry labels (gender, animacy, aspect, transitivity ...)
  wikt_class   — Zaliznyak declension/conjugation type, if given
Run: python3 -I tools/data/build_wikt_paradigms.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, WIKT_COLS, iter_jsonl_gz, open_out  # noqa: E402

CASE = {"nominative": "nomn", "genitive": "gent", "dative": "datv", "accusative": "accs",
        "instrumental": "ablt", "prepositional": "loct", "locative": "loc2", "partitive": "gen2",
        "vocative": "voct"}
GENDERS = [("masculine", "masc"), ("neuter", "neut"), ("feminine", "femn")]
PERSON = {"first-person": "1per", "second-person": "2per", "third-person": "3per"}
SKIP_TAGS = {"romanization", "class", "table-tags", "inflection-template", "diminutive", "augmentative",
             "relational", "feminine-equivalent", "masculine-equivalent", "alternative", "obsolete"}


def keys_for(pos, tags, form, word):
    t = set(tags)
    if t & SKIP_TAGS:
        return []
    cases = [CASE[x] for x in t if x in CASE]
    if pos in ("noun", "prop"):
        if len(cases) != 1:
            return []
        num = "plur" if "plural" in t else "sing" if "singular" in t else None
        return [f"{num}:{cases[0]}"] if num else []
    if pos == "adj":
        if "comparative" in t:
            return ["comp"] if not form.endswith(("ий", "ый", "ой", "ая", "ое", "ее", "ие", "ые")) else []
        if "superlative" in t:
            return []
        gs = ["plur"] if "plural" in t else [g for name, g in GENDERS if name in t]
        if "short-form" in t:
            return [f"short:{g}" for g in gs]
        if len(cases) != 1:
            return []
        c = cases[0]
        out = []
        for g in gs:
            if c == "accs" and g in ("masc", "plur"):
                if "animate" in t:
                    out.append(f"{g}:accs:anim")
                if "inanimate" in t:
                    out.append(f"{g}:accs:inan")
            else:
                out.append(f"{g}:{c}")
        return out
    # verb
    if "participle" in t:
        tense = "pres" if "present" in t else "past" if "past" in t else None
        if tense is None:
            return []
        if "adverbial" in t:
            return [f"grnd:{tense}"]
        voice = "pssv" if "passive" in t else "actv"
        return [f"prtf:{tense}:{voice}"]
    if "imperative" in t:
        if "first-person" in t:
            return ["impr:incl"]
        return ["impr:plur" if form.endswith("те") else "impr:sing"]
    if "past" in t:
        gs = [g for name, g in GENDERS if name in t]
        if "plural" in t or len(gs) == 3:
            return ["past:plur"]
        return [f"past:{g}" for g in gs]
    if ("present" in t or "future" in t) and any(p in t for p in PERSON):
        if " " in form or "…" in form:
            return []
        tense = "futr" if "future" in t else "pres"
        num = "plur" if "plural" in t else "sing"
        return [f"{tense}:{num}:{PERSON[p]}" for p in PERSON if p in t]
    return []


# Wiktionary service marks (*nonstandard, △ variant etc.) and secondary stress
MARKS = str.maketrans({"*": None, "^": None, "△": None, "⟐": None, "†": None,
                       "ѐ": "е\u0300", "ѝ": "и\u0300"})
NON_RU = re.compile(r"[^а-яёА-ЯЁ\u0301\u0300-]")


def clean_form(form):
    form = form.strip().translate(MARKS)
    return "" if NON_RU.search(form) else form


# pre-reform spelling (en-Wiktionary lists it as variants) and parenthesized marks
PREREFORM = re.compile(r"ъ$|[іѣѳѵ()]")
CLASS_RE = re.compile(r"(?:склонение|спряжение) (\S+)$")


def build(src, source_name, rows):
    for d in iter_jsonl_gz(src):
        pos, word = d["pos"], d["word"]
        cells = {}
        for f in d.get("forms", []):
            form = clean_form(f.get("form") or "")
            if not form or form == "-" or " " in form or PREREFORM.search(form):
                continue
            for k in keys_for(pos, f.get("tags") or [], form, word):
                lst = cells.setdefault(k, [])
                if form not in lst:
                    lst.append(form)
        if not cells:
            continue
        # The headword lemma is not repeated in the forms table — fill it in.
        if pos in ("noun", "prop") and "sing:nomn" not in cells and any(k.startswith("sing:") for k in cells):
            cells["sing:nomn"] = [word]
        if pos == "adj" and "masc:nomn" not in cells:
            cells["masc:nomn"] = [word]
        if pos == "verb":
            cells.setdefault("infn", [word])
        cls = ""
        tags = list(d.get("tags") or [])
        for c in d.get("categories", []):
            m = CLASS_RE.search(c or "")
            if m:
                cls = m.group(1)
        if source_name == "en":
            for ht in d.get("head_templates") or []:
                a = ht.get("args", {})
                if ht.get("name", "").startswith(("ru-noun", "ru-proper noun")):
                    g = a.get("2") or a.get("g") or ""
                    tags += [x for x in re.split(r"[-,]", g) if x]
                    cls = a.get("1", cls)
            for s in d.get("senses", []):
                tags += [x for x in (s.get("tags") or []) if x in ("animate", "inanimate", "masculine", "feminine",
                                                                   "neuter", "perfective", "imperfective",
                                                                   "transitive", "intransitive", "indeclinable")]
        if re.search(r"[а-яё]", cls, re.I):
            cls = ""  # in the en template this slot sometimes holds a stressed lemma, not a declension type
        rows[pos].append([word, source_name, ",".join(sorted(set(tags))), cls]
                         + ["/".join(cells.get(c, [])) for c in WIKT_COLS[pos]])


def main():
    rows = {p: [] for p in WIKT_COLS}
    build(os.path.join(DATA, "lexicon", "wikt_ru_subset.jsonl.gz"), "ru", rows)
    build(os.path.join(DATA, "lexicon", "wikt_en_subset.jsonl.gz"), "en", rows)
    for pos, lst in rows.items():
        with open_out(os.path.join(DATA, "morph", f"wikt_{pos}.tsv")) as f:
            f.write("\t".join(["lemma", "source", "wikt_tags", "wikt_class"] + WIKT_COLS[pos]) + "\n")
            for r in sorted(lst, key=lambda r: (r[0], r[1])):
                f.write("\t".join(r) + "\n")
        print(pos, "entries with forms:", len(lst))


if __name__ == "__main__":
    main()
