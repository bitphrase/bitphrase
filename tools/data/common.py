"""Shared paths and utilities for the data preparation scripts (build stage only)."""
import csv
import gzip
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "data")
RAW = os.path.join(DATA, "raw")

RNC_CSV = os.path.join(RAW, "freq_rnc2011", "x", "freqrnc2011.csv")
SUBS_TXT = os.path.join(RAW, "freq_opensubtitles", "ru_50k.txt")
SUBS_FULL = os.path.join(RAW, "freq_opensubtitles", "ru_full.txt")  # 1.4M word forms
WIKT_EN = os.path.join(RAW, "wiktionary_kaikki", "kaikki.org-dictionary-Russian.jsonl.gz")
WIKT_RU = os.path.join(RAW, "ruwiktionary_kaikki", "kaikki.org-dictionary-Russian-ruwiktionary.jsonl.gz")
RUWORDNET_DB = os.path.join(RAW, "ruwordnet", "ruwordnet-2021.db")
BRYSBAERT = os.path.join(RAW, "concreteness_brysbaert", "Concreteness_ratings_Brysbaert_et_al_BRM.txt")

# Paradigm table columns (shared by OpenCorpora and Wiktionary)
CASES = ["nomn", "gent", "datv", "accs", "ablt", "loct"]
EXTRA_CASES = ["gen2", "acc2", "loc2", "voct"]

NOUN_COLS = [f"{n}:{c}" for n in ("sing", "plur") for c in CASES + EXTRA_CASES]
ADJ_COLS = (
    [f"{g}:{c}" + (f":{a}" if c == "accs" and g in ("masc", "plur") else "")
     for g in ("masc", "neut", "femn", "plur")
     for c in CASES
     for a in (("inan", "anim") if c == "accs" and g in ("masc", "plur") else ("",))]
    + [f"short:{g}" for g in ("masc", "neut", "femn", "plur")]
    + ["comp", "supr"]
)
VERB_COLS = (
    ["infn"]
    + [f"{t}:{n}:{p}" for t in ("pres", "futr") for n in ("sing", "plur") for p in ("1per", "2per", "3per")]
    + [f"past:{g}" for g in ("masc", "femn", "neut", "plur")]
    + ["impr:sing", "impr:plur", "impr:incl", "grnd:pres", "grnd:past"]
    + ["prtf:pres:actv", "prtf:past:actv", "prtf:pres:pssv", "prtf:past:pssv"]
)

# name — personal names, place — toponyms. These are SEPARATE dictionaries: never mixed with
# each other or with common nouns. The paradigm is the same as for nouns.
COLS = {"noun": NOUN_COLS, "adj": ADJ_COLS, "verb": VERB_COLS, "name": NOUN_COLS, "place": NOUN_COLS}

# Wiktionary does not separate names from toponyms (pos = name): they come as a shared "prop" sample,
# and are split into the name/place dictionaries later via OpenCorpora (Name / Geox).
WIKT_COLS = {"noun": NOUN_COLS, "adj": ADJ_COLS, "verb": VERB_COLS, "prop": NOUN_COLS}


def wikt_pos(pos):
    """Wiktionary sample part of speech corresponding to our dictionary."""
    return "prop" if pos in ("name", "place") else pos

# RNC parts of speech -> ours
RNC_POS = {"s": "noun", "a": "adj", "v": "verb", "s.PROP": "prop"}  # RNC does not distinguish names from toponyms

STRESS_MARKS = "́̀"


def norm(word):
    """Comparison key: lowercase, ё->е, no stress marks."""
    w = word.lower().replace("ё", "е")
    for ch in STRESS_MARKS:
        w = w.replace(ch, "")
    return w


def strip_stress(word):
    for ch in STRESS_MARKS:
        word = word.replace(ch, "")
    return word


def load_rnc():
    """{(norm_lemma, pos): (lemma, ipm, R, D, docs)} for s/a/v and proper names (prop)."""
    out = {}
    with open(RNC_CSV, encoding="utf-8") as f:
        r = csv.reader(f, delimiter="\t")
        next(r)
        for lemma, pos, ipm, rng, d, doc in r:
            if pos not in RNC_POS:
                continue
            key = (norm(lemma), RNC_POS[pos])
            prev = out.get(key)
            if prev is None or float(ipm) > prev[1]:
                out[key] = (lemma, float(ipm), int(rng), float(d), int(doc))
    return out


def load_subs(path=SUBS_TXT):
    """{norm_form: count} from OpenSubtitles 2018 (top 50k word forms by default; SUBS_FULL is the full list)."""
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2:
                k = norm(parts[0])
                out[k] = out.get(k, 0) + int(parts[1])
    return out


# en-Wiktionary categories: personal names and toponyms (separately)
WIKT_NAME_CAT = re.compile(r"given names")
WIKT_PLACE_CAT = re.compile(r"^Cities in|Capital cities|National capitals|^Countries|^Rivers|^Lakes|^Seas|"
                            r"^Oceans|^Mountains|^Islands|^Republics of|^Oblasts of|^Krais of|^Continents|"
                            r"^Regions of|^Peninsulas|^Deserts")
WIKT_PROP_CAT = re.compile(WIKT_NAME_CAT.pattern + "|" + WIKT_PLACE_CAT.pattern)


def prop_categories(entry):
    """en-Wiktionary entry categories related to names/toponyms."""
    cats = set()
    for s in entry.get("senses", []):
        for c in s.get("categories") or []:
            n = c if isinstance(c, str) else c.get("name", "")
            if WIKT_PROP_CAT.search(n):
                cats.add(n)
    return cats


def load_wikt_prop_index():
    """{norm_word: set(categories)} — personal names and toponyms from en-Wiktionary (raw dump)."""
    out = {}
    for d in iter_jsonl_gz(WIKT_EN):
        if d.get("pos") == "name" and d.get("lang_code") == "ru":
            cats = prop_categories(d)
            if cats:
                out.setdefault(norm(d["word"]), set()).update(cats)
    return out


def open_out(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith(".gz"):
        return gzip.open(path, "wt", encoding="utf-8")
    return open(path, "w", encoding="utf-8", newline="")


def iter_jsonl_gz(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            yield json.loads(line)
