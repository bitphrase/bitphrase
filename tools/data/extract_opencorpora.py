"""Export of full paradigms from the OpenCorpora dictionary (via pymorphy3-dicts-ru).

We take all NOUN / ADJF / INFN lexemes whose lemma is in the RNC frequency dictionary
(Lyashevskaya–Sharov 2011) with the same part of speech. Each lexeme is a separate row
(homonyms like "лев" / "Лев" go in separate rows with their own labels).

name — personal names (Name), place — toponyms (Geox); surnames, patronymics, organizations
are not taken. These are two separate files (a lexeme with both labels goes into both).
Taken if the lemma is among RNC proper names, or in en-Wiktionary in
the categories of its kind (names / cities, countries, rivers ...), or its nominative occurs
in subtitles at least PROP_MIN_SUBS times (for name/place subs_forms_count = nominative frequency).

Output: data/morph/oc_{noun,adj,verb,name,place}.tsv
Run: <venv>/bin/python -I tools/data/extract_opencorpora.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COLS, DATA, WIKT_NAME_CAT, WIKT_PLACE_CAT, load_rnc, load_subs, load_wikt_prop_index, norm, open_out  # noqa: E402

import pymorphy3  # noqa: E402

POS_MAP = {"NOUN": "noun", "ADJF": "adj", "INFN": "verb"}
PROP_KIND = {"Name": ("name", WIKT_NAME_CAT), "Geox": ("place", WIKT_PLACE_CAT)}
PROP_SKIP = {"Surn", "Patr", "Orgn", "Trad", "Abbr"}
PROP_MIN_SUBS = 30


def cell_key(pos, t):
    """Paradigm cell key from the word form's tag (None — the form is not stored)."""
    # pymorphy3 tag attributes compare strictly; cast to str
    if pos in ("noun", "name", "place"):
        return f"{t.number}:{t.case}" if t.POS == "NOUN" else None
    if pos == "adj":
        if t.POS == "ADJF" and "Supr" not in t:
            g = "plur" if t.number == "plur" else str(t.gender)
            k = f"{g}:{t.case}"
            if t.case == "accs" and g in ("masc", "plur"):
                k += ":" + (t.animacy or "inan")
            return k
        if t.POS == "ADJF" and "Supr" in t:
            return "supr" if (t.gender == "masc" and t.case == "nomn") else None
        if t.POS == "ADJS":
            return "short:" + ("plur" if t.number == "plur" else t.gender)
        if t.POS == "COMP":
            return "comp"
        return None
    # verb
    if t.POS == "INFN":
        return "infn"
    if t.POS == "VERB":
        if t.mood == "impr":
            return "impr:incl" if "incl" in t else f"impr:{t.number}"
        if t.tense == "past":
            return "past:" + ("plur" if t.number == "plur" else t.gender)
        return f"{t.tense}:{t.number}:{t.person}"
    if t.POS == "GRND":
        return f"grnd:{t.tense}"
    if t.POS == "PRTF" and t.case == "nomn" and t.gender == "masc" and t.number == "sing":
        return f"prtf:{t.tense}:{t.voice}"
    return None


# Grammemes that vary within a paradigm are not written to the "lexeme labels".
VARIABLE = {"nomn", "gent", "datv", "accs", "ablt", "loct", "voct", "gen1", "gen2", "acc2", "loc1", "loc2",
            "sing", "plur", "NOUN", "ADJF", "INFN"}


def main():
    rnc = load_rnc()
    subs = load_subs()
    wanted = set(rnc)  # (norm_lemma, pos)
    wikt_prop = load_wikt_prop_index()
    m = pymorphy3.MorphAnalyzer()
    d = m.dictionary
    para_cache = {}
    outs = {}
    counts = {}
    for pos, cols in COLS.items():
        f = open_out(os.path.join(DATA, "morph", f"oc_{pos}.tsv"))
        f.write("\t".join(["lemma", "oc_para_id", "oc_grammemes", "rnc_ipm", "rnc_R", "rnc_D", "subs_forms_count"]
                          + cols) + "\n")
        outs[pos] = f
        counts[pos] = 0
    seen = set()
    found = set()

    def paradigm(word, para_id, pos):
        info = para_cache.get(para_id)
        if info is None:
            info = para_cache[para_id] = d.build_paradigm_info(para_id)
        p0, _, s0 = info[0]
        stem = word[len(p0): len(word) - len(s0)] if s0 else word[len(p0):]
        cells = {}
        subs_count = 0
        forms_seen = set()
        for pref, t, suf in info:
            form = pref + stem + suf
            if form not in forms_seen:
                forms_seen.add(form)
                subs_count += subs.get(norm(form), 0)
            k = cell_key(pos, t)
            if k is None:
                continue
            lst = cells.setdefault(k, [])
            if form not in lst:
                lst.append(form)
        return cells, subs_count

    def write(word, tag, para_id, pos, key, cells, subs_count):
        seen.add((word, para_id, pos))
        found.add(key)
        gram = sorted(g for g in tag.grammemes if g not in VARIABLE)
        _, ipm, rng, dd, _ = rnc.get(key, ("", 0.0, 0, 0.0, 0))
        row = [word, str(para_id), ",".join(gram), f"{ipm:g}", str(rng), f"{dd:g}", str(subs_count)]
        row += ["/".join(cells.get(c, [])) for c in COLS[pos]]
        outs[pos].write("\t".join(row) + "\n")
        counts[pos] += 1

    for word, tag, normal_form, para_id, idx in d.iter_known_words(""):
        if idx != 0 or tag.POS not in POS_MAP:
            continue
        pos = POS_MAP[tag.POS]
        nf = norm(normal_form)
        # regular part of speech: lemma from the RNC (Name/Geox homonyms too — with a label, proper flag)
        key = (nf, pos)
        if key in wanted and (word, para_id, pos) not in seen:
            cells, sc = paradigm(word, para_id, pos)
            write(word, tag, para_id, pos, key, cells, sc)
        # personal names and toponyms — each kind into its own file
        if pos != "noun" or PROP_SKIP & tag.grammemes:
            continue
        for gram, (kind, cat_re) in PROP_KIND.items():
            if gram not in tag.grammemes or (word, para_id, kind) in seen:
                continue
            key = (nf, "prop")  # RNC frequency: proper names are a single shared list there
            cells, _ = paradigm(word, para_id, kind)
            sc = subs.get(nf, 0)  # nominative only: oblique forms of names are often homonymous (Костя — кости)
            in_wikt = any(cat_re.search(c) for c in wikt_prop.get(nf, ()))
            if key in wanted or in_wikt or sc >= PROP_MIN_SUBS:
                write(word, tag, para_id, kind, key, cells, sc)
    for f in outs.values():
        f.close()
    print("lexemes written:", counts)
    missing = sorted(wanted - found)
    with open_out(os.path.join(DATA, "morph", "oc_missing_from_rnc.tsv")) as f:
        f.write("lemma\tpos\trnc_ipm\n")
        for k in missing:
            f.write(f"{rnc[k][0]}\t{k[1]}\t{rnc[k][1]:g}\n")
    print("RNC lemmas without OpenCorpora lexeme:", len(missing))


if __name__ == "__main__":
    main()
