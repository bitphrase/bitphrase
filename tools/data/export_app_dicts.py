"""App dictionaries (generalized templates, capacity distribution) -> src/lang/ru/dict.json.

Takes the same dictionaries as tools/data/gen_templates.py (its loader and CFG settings)
and exports them for src/lang/ru/grammar.ts.

Word format: "gender:stem:ending|ending|…" — the common stem of all forms is factored out to keep
the file smaller. Cases are И Р Д В Т П; for nouns singular comes first, then plural.

Run: .venv/bin/python -I tools/data/export_app_dicts.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_templates as G  # noqa: E402
from common import ROOT  # noqa: E402

VERSION = "3-draft-2"
MAX_WORDS = 7
CASES = G.CASES  # nomn gent datv accs ablt loct


def pack(gender, forms):
    """Gender and forms in one string: common stem once, then the endings."""
    stem = os.path.commonprefix(forms)
    return f"{gender}:{stem}:" + "|".join(f[len(stem):] for f in forms)


def noun(e, nums=("sing", "plur")):
    return pack(e["g"][0], [e["f"][f"{n}:{c}"] for n in nums for c in CASES])


def main():
    P = G.load_pools()
    verbs, verb_id = [], {}

    def vid(forms):
        if forms[0] not in verb_id:
            verb_id[forms[0]] = len(verbs)
            verbs.append(pack("v", forms))
        return verb_id[forms[0]]

    groups = [{"name": g["name"], "frame": g["frame"], "verbs": [vid(v) for v in g["verbs"]]} for g in P["groups"]]
    data = {
        "version": VERSION,
        "maxWords": MAX_WORDS,
        "adj": [d["masc:nomn"] for d in P["adj"]],
        "name": [noun(e, ("sing",)) for e in P["name"]],
        "surname": [pack("s", [e[f"{g}:{c}"] for g in ("masc", "femn", "plur") for c in CASES]) for e in P["surname"]],
        "patr": [pack("p", [e[f"{g}:{c}"] for g in ("masc", "femn") for c in CASES]) for e in P["patr"]],
        "prof": [noun(e) for e in P["prof"]],
        "role": [noun(e) for e in P["role"]],
        "animal": [noun(e) for e in P["animal"]],
        "obj": [noun(e) for e in P["obj"][P["arg_class"]]],
        "place": [noun(e, ("sing",)) for e in P["place"]],
        "verbs": verbs,
        "modal": [pack("v", m) for m in P["modal"]],
        "groups": groups,
        "preps": {
            "motion": G.MOTION_PREPS, "motionPlace": G.MOTION_PLACE, "stay": G.STAY_PREPS,
            "stayPlace": G.STAY_PLACE, "for": G.FOR_PREPS, "placeTail": G.PLACE_TAIL,
        },
        "config": G.CFG,
    }
    out = os.path.join(ROOT, "src", "lang", "ru", "dict.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("dict.json:", {k: len(v) for k, v in data.items() if isinstance(v, list)},
          f"{os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
