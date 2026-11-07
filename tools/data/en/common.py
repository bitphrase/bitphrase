"""Shared paths and TSV helpers for the English data pipeline (data/en/)."""
import csv
import gzip
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DATA = os.path.join(ROOT, "data", "en")
RAW = os.path.join(DATA, "raw")
# Brysbaert concreteness ratings are English and shared with the Russian pipeline.
CONCRETENESS = os.path.join(ROOT, "data", "raw", "concreteness_brysbaert", "Concreteness_ratings_Brysbaert_et_al_BRM.txt")

csv.field_size_limit(10 ** 9)


def path(*parts):
    p = os.path.join(DATA, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def read(p):
    with open(p, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def write(p, rows, cols):
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", quoting=csv.QUOTE_NONE, escapechar="\\", lineterminator="\n")
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])
    print(f"{os.path.relpath(p, ROOT)}: {len(rows)} rows")


def jsonl(p):
    with gzip.open(p, "rt", encoding="utf-8") as f:
        for line in f:
            yield json.loads(line)


def subtitle_freq():
    """Word form -> count in OpenSubtitles 2018 (hermitdave/FrequencyWords), lowercase."""
    out = {}
    with open(os.path.join(RAW, "freq_opensubtitles", "en_full.txt"), encoding="utf-8") as f:
        for line in f:
            w, _, n = line.rstrip("\n").rpartition(" ")
            if w and n.isdigit():
                out[w] = out.get(w, 0) + int(n)
    return out


SUBS_TOTAL = 1e6  # counts are turned into per-million by dividing by total / 1e6


def ipm_table():
    freq = subtitle_freq()
    total = sum(freq.values()) / SUBS_TOTAL
    return {w: n / total for w, n in freq.items()}


def concreteness():
    """word -> (concreteness 1–5, dominant part of speech in SUBTLEX-US: Noun, Verb, Adjective...)."""
    out = {}
    with open(CONCRETENESS, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            try:
                out[r["Word"]] = (float(r["Conc.M"]), r["Dom_Pos"] if r["Dom_Pos"] not in ("#N/A", "0") else "")
            except ValueError:
                pass
    return out
