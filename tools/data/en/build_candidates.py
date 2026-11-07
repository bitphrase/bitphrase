"""Candidate tables for the English dictionaries -> data/en/candidates/*.tsv.

Sources: the Wiktionary subset (forms, sense tags), WordNet (semantic class, verb frames,
hypernyms), OpenSubtitles frequencies, Brysbaert concreteness, CMUdict ("a" or "an"),
SSA first names, US Census surnames, GeoNames cities.

Every table is sorted by frequency and carries auto_flags — reasons to leave a word out
(see data/en/README.md). Nothing is chosen here: gen_dicts.py picks from these tables.

Run: python3 -I tools/data/en/build_candidates.py
"""
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, concreteness, ipm_table, jsonl, path, read, write  # noqa: E402

LOWER = re.compile(r"^[a-z]+$")
OFFENSIVE = {"vulgar", "offensive", "derogatory", "slur", "ethnic", "pejorative", "euphemistic"}
OLD = {"obsolete", "archaic", "dated", "historical", "rare", "poetic", "literary", "nonce-word"}
INFORMAL = {"slang", "informal", "colloquial", "dialectal", "regional", "Internet", "childish", "nonstandard", "humorous"}
NON_US = {"UK", "British", "Commonwealth", "Australia", "New-Zealand", "Ireland", "Scotland", "Canada", "India",
          "South-Africa", "Singapore", "Philippines", "Northern-England", "England", "Malaysia", "Nigeria"}
SKIP_SENSE = {"@form-of", "abbreviation", "initialism", "acronym", "misspelling", "clipping", "alt-of"}
VOWEL_PHONES = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}


def load_wikt():
    """(word, pos) -> merged entry (all etymologies together)."""
    out = {}
    for e in jsonl(path("lexicon", "wikt.jsonl.gz")):
        k = (e["w"], e["pos"])
        if k not in out:
            out[k] = {"f": {}, "s": [], "head": e["head"]}
        m = out[k]
        for name, forms in e["f"].items():
            lst = m["f"].setdefault(name, [])
            lst.extend(f for f in forms if f not in lst)
        m["s"].extend(e["s"])
    return out


def load_cmu():
    """word -> True if it starts with a vowel sound ("an apple", "an hour"), first pronunciation."""
    out = {}
    with open(os.path.join(RAW, "cmudict", "cmudict.dict"), encoding="utf-8") as f:
        for line in f:
            w, *ph = line.split("#")[0].split()
            if "(" in w or not ph:
                continue
            out[w] = re.sub(r"\d", "", ph[0]) in VOWEL_PHONES
    return out


def load_wordnet():
    return {(r["lemma"], r["pos"]): r for r in read(path("lexicon", "wordnet.tsv"))}


def sense_flags(senses):
    """Flags from the word's senses (form-of senses and abbreviations don't count)."""
    real = [s for s in senses if not set(s["t"]) & SKIP_SENSE and "form-of" not in s["t"]]
    flags = set()
    if not real:
        flags.add("form_of_only")
        return flags, real
    if any(set(s["t"]) & OFFENSIVE for s in senses):
        flags.add("offensive")
    if all(set(s["t"]) & OLD for s in real):
        flags.add("archaic")
    if all(set(s["t"]) & INFORMAL for s in real):
        flags.add("informal")
    if all(set(s["t"]) & NON_US and "US" not in s["t"] for s in real):
        flags.add("non_us")
    return flags, real


def an_flag(cmu, w):
    v = cmu.get(w.lower())
    return "" if v is None else ("1" if v else "0")


def common_flags(w, flags, ipm):
    if not LOWER.match(w):
        flags.add("not_plain")
    if len(w) < 3:
        flags.add("too_short")
    return flags


# --- nouns -------------------------------------------------------------------------------

def nouns(W, WN, cmu, ipm, conc):
    rows = []
    for (w, pos), e in W.items():
        if pos != "noun" or not LOWER.match(w):
            continue
        flags, real = sense_flags(e["s"])
        plurals = e["f"].get("plural", [])
        countable = sum(1 for s in real if "uncountable" not in s["t"] or "countable" in s["t"])
        if not plurals:
            flags.add("no_plural")
        pl = plurals[0] if plurals else ""
        if pl == w:
            flags.add("plural_same")
        if real and countable * 2 < len(real):
            flags.add("mostly_uncountable")
        if any("plural-only" in s["t"] for s in real) and len([s for s in real if "plural-only" in s["t"]]) * 2 >= len(real):
            flags.add("plural_only")
        wn = WN.get((w, "noun"))
        lex = wn["lexnames"].split(",") if wn else []
        if not wn:
            flags.add("not_in_wordnet")
        if (w.capitalize(), "name") in W:
            flags.add("homonym_proper")  # lee, vega, morgan: a noun made from a name
        if an_flag(cmu, w) == "":
            flags.add("no_pronunciation")
        common_flags(w, flags, ipm)
        # The plural adds to the frequency only if it looks like this word's plural (not "i" for "wheelstanding").
        stem = w[:max(1, len(w) - 2)]
        pl_ipm = ipm.get(pl, 0) if pl.startswith(stem) else 0
        rows.append({
            "lemma": w, "plural": pl, "plural_variants": "/".join(plurals[1:]),
            "ipm": f"{ipm.get(w, 0) + pl_ipm:.3f}", "ipm_sg": f"{ipm.get(w, 0):.3f}",
            "concreteness": conc.get(w, ("", ""))[0], "dom_pos": conc.get(w, ("", ""))[1], "an": an_flag(cmu, w),
            "lexnames": ",".join(lex), "lex_first": lex[0] if lex else "",
            "hypernyms": (wn["hypernyms"].split(";")[0] if wn else ""),
            "hypernyms_all": (wn["hypernyms"] if wn else ""),
            "auto_flags": ",".join(sorted(flags)), "gloss": (real[0]["g"] if real else "").replace("\t", " "),
        })
    rows.sort(key=lambda r: -float(r["ipm"]))
    return rows


# --- verbs -------------------------------------------------------------------------------

def regular_forms(v):
    """Regular forms by spelling rules — a cross-check of Wiktionary's forms."""
    if re.search(r"(s|x|z|ch|sh|o)$", v):
        s3 = v + "es"
    elif re.search(r"[^aeiou]y$", v):
        s3 = v[:-1] + "ies"
    else:
        s3 = v + "s"
    return s3


def verbs(W, WN, ipm, conc):
    rows = []
    for (w, pos), e in W.items():
        if pos != "verb" or not LOWER.match(w):
            continue
        flags, real = sense_flags(e["s"])
        f = e["f"]
        s3, ing, past = (f.get(k, [""])[0] for k in ("pres3", "ing", "past"))
        if not (s3 and ing and past):
            flags.add("forms_missing")
        if len({w, s3, ing, past}) < 4:
            flags.add("forms_coincide")  # put/put, read/read: tense can't be told from the word
        if s3 and s3 != regular_forms(w) and w not in ("have", "be", "do", "go"):
            flags.add("irregular_s")
        if len(f.get("past", [])) > 1:
            flags.add("past_variants")
        trans = sum(1 for s in real if "transitive" in s["t"] or "ambitransitive" in s["t"] or "ditransitive" in s["t"])
        intr = sum(1 for s in real if "intransitive" in s["t"] or "ambitransitive" in s["t"])
        wn = WN.get((w, "verb"))
        frames_first = set(wn["frames_first"].split(",")) if wn and wn["frames_first"] else set()
        frames_all = set(wn["frames_all"].split(",")) if wn and wn["frames_all"] else set()
        if not wn:
            flags.add("not_in_wordnet")
        common_flags(w, flags, ipm)
        rows.append({
            "lemma": w, "dom_pos": conc.get(w, ("", ""))[1], "pres3": s3, "past": past, "ing": ing, "past_variants": "/".join(f.get("past", [])[1:]),
            "ipm": f"{sum(ipm.get(x, 0) for x in {w, s3, ing, past}):.3f}",
            "trans_senses": trans, "intrans_senses": intr, "senses": len(real),
            "wn_obj_thing": "1" if frames_first & {"8", "11"} else ("0.5" if frames_all & {"8", "11"} else "0"),
            "wn_obj_person": "1" if frames_first & {"9", "10"} else ("0.5" if frames_all & {"9", "10"} else "0"),
            "wn_intrans": "1" if frames_first & {"1", "2"} else ("0.5" if frames_all & {"1", "2"} else "0"),
            "lex_first": wn["lexnames"].split(",")[0] if wn else "",
            "auto_flags": ",".join(sorted(flags)), "gloss": (real[0]["g"] if real else "").replace("\t", " "),
        })
    rows.sort(key=lambda r: -float(r["ipm"]))
    return rows


# --- adjectives --------------------------------------------------------------------------

def adjectives(W, WN, cmu, ipm, conc):
    rows = []
    for (w, pos), e in W.items():
        if pos != "adj" or not LOWER.match(w):
            continue
        flags, real = sense_flags(e["s"])
        if real and all("predicative" in s["t"] for s in real):
            flags.add("predicative_only")
        if (w, "adj") not in WN:
            flags.add("not_in_wordnet")
        if (w, "noun") in W or (w, "verb") in W:
            flags.add("also_noun_or_verb")
        if an_flag(cmu, w) == "":
            flags.add("no_pronunciation")
        if re.search(r"(est|er)$", w) and any(set(s["t"]) & {"comparative", "superlative"} for s in e["s"]):
            flags.add("comparative")
        if w.endswith(("ing", "ed")):
            flags.add("participle_like")
        common_flags(w, flags, ipm)
        rows.append({
            "lemma": w, "ipm": f"{ipm.get(w, 0):.3f}", "concreteness": conc.get(w, ("", ""))[0],
            "dom_pos": conc.get(w, ("", ""))[1], "an": an_flag(cmu, w),
            "auto_flags": ",".join(sorted(flags)), "gloss": (real[0]["g"] if real else "").replace("\t", " "),
        })
    rows.sort(key=lambda r: -float(r["ipm"]))
    return rows


# --- names, surnames, places -------------------------------------------------------------

def names(W, ipm):
    share = collections.defaultdict(collections.Counter)
    with open(os.path.join(RAW, "names_ssa", "baby-names.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if int(r["year"]) >= 1940:
                share[r["name"]][r["sex"]] += float(r["percent"])
    wikt_given = {w for (w, pos), e in W.items() if pos == "name" and any("given names" in c for s in e["s"] for c in s["c"])}
    rows = []
    for n, by in share.items():
        total = sum(by.values())
        boy, girl = by["boy"] / total, by["girl"] / total
        flags = set()
        if 0.1 < boy < 0.9:
            flags.add("unisex")
        if (n.lower(), "noun") in W or (n.lower(), "adj") in W or (n.lower(), "verb") in W:
            flags.add("homonym_common")
        if n not in wikt_given:
            flags.add("not_in_wiktionary")
        if not re.match(r"^[A-Z][a-z]+$", n):
            flags.add("not_plain")
        rows.append({"name": n, "gender": "m" if boy >= 0.5 else "f", "share": f"{total:.4f}",
                     "ipm": f"{ipm.get(n.lower(), 0):.3f}", "auto_flags": ",".join(sorted(flags))})
    rows.sort(key=lambda r: -float(r["share"]))
    return rows


def surnames(W, ipm):
    rows = []
    given = {w for (w, pos), e in W.items() if pos == "name" and any("given names" in c for s in e["s"] for c in s["c"])}
    with open(os.path.join(RAW, "surnames_census", "Names_2010Census.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["name"] == "ALL OTHER NAMES":
                continue
            n = r["name"].capitalize()
            flags = set()
            low = n.lower()
            if (low, "noun") in W or (low, "adj") in W or (low, "verb") in W:
                flags.add("homonym_common")
            if n in given:
                flags.add("homonym_name")
            if not re.match(r"^[A-Z][a-z]+$", n) or len(n) < 3:
                flags.add("not_plain")
            if r["pctwhite"] in ("(S)", "") or r["pcthispanic"] in ("(S)", ""):
                pass
            rows.append({"surname": n, "rank": r["rank"], "count": r["count"], "ipm": f"{ipm.get(low, 0):.3f}",
                         "auto_flags": ",".join(sorted(flags))})
            if int(r["rank"]) >= 30000:
                break
    return rows


def places(W, ipm):
    countries = {}
    with open(os.path.join(RAW, "geonames", "countryInfo.txt"), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            p = line.rstrip("\n").split("\t")
            countries[p[0]] = {"name": p[4], "capital": p[5], "population": int(p[7] or 0)}
    rows = {}
    for c in countries.values():
        rows[c["name"]] = {"name": c["name"], "type": "country", "where": "", "population": c["population"]}
    with open(os.path.join(RAW, "geonames", "cities15000.txt"), encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            name, ascii_name, cc, pop, fcode = p[1], p[2], p[8], int(p[14] or 0), p[7]
            if name != ascii_name or pop < 300000:
                continue
            capital = fcode == "PPLC"
            if name not in rows or rows[name]["population"] < pop and rows[name]["type"] != "country":
                rows[name] = {"name": name, "type": "capital" if capital else "city",
                              "where": countries.get(cc, {}).get("name", cc), "population": pop}
    out = []
    for r in rows.values():
        n = r["name"]
        flags = set()
        if not re.match(r"^[A-Z][a-z]+$", n):
            flags.add("not_plain")
        low = n.lower()
        if (low, "noun") in W or (low, "adj") in W or (low, "verb") in W:
            flags.add("homonym_common")
        r["ipm"] = f"{ipm.get(low, 0):.3f}"
        r["auto_flags"] = ",".join(sorted(flags))
        out.append(r)
    out.sort(key=lambda r: -float(r["ipm"]))
    return out


def main():
    W = load_wikt()
    WN = load_wordnet()
    cmu = load_cmu()
    ipm = ipm_table()
    conc = concreteness()
    write(path("candidates", "noun.tsv"), nouns(W, WN, cmu, ipm, conc),
          ["lemma", "plural", "plural_variants", "ipm", "ipm_sg", "concreteness", "dom_pos", "an", "lex_first", "lexnames",
           "hypernyms", "auto_flags", "gloss", "hypernyms_all"])
    write(path("candidates", "verb.tsv"), verbs(W, WN, ipm, conc),
          ["lemma", "dom_pos", "pres3", "past", "ing", "past_variants", "ipm", "trans_senses", "intrans_senses", "senses",
           "wn_obj_thing", "wn_obj_person", "wn_intrans", "lex_first", "auto_flags", "gloss"])
    write(path("candidates", "adj.tsv"), adjectives(W, WN, cmu, ipm, conc),
          ["lemma", "ipm", "concreteness", "dom_pos", "an", "auto_flags", "gloss"])
    write(path("candidates", "name.tsv"), names(W, ipm), ["name", "gender", "share", "ipm", "auto_flags"])
    write(path("candidates", "surname.tsv"), surnames(W, ipm), ["surname", "rank", "count", "ipm", "auto_flags"])
    write(path("candidates", "place.tsv"), places(W, ipm), ["name", "type", "where", "population", "ipm", "auto_flags"])
    # Pronunciation for every word the dictionaries might use after "a".
    with open(path("lexicon", "an.json"), "w", encoding="utf-8") as f:
        json.dump({w: v for w, v in cmu.items() if LOWER.match(w)}, f)


if __name__ == "__main__":
    main()
