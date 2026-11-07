"""Generates Templates.txt and data/templates/templates.tsv — generalized templates
with verb groups and a distribution proportional to the number of combinations.

A template is a sequence of groups:
  [WHO] [PREDICATE of group g] [OBJECT governed by g] [TAIL?]
WHO is one of the "persons" (Имя | Прил Имя | Имя Фамилия | Имя Отчество | Имя Отчество
Фамилия | Профессия Фамилия | Прил Животное ...). The predicate is a verb, "modal +
infinitive" or "будет + infinitive". Verbs are split into groups by government
(data/seed/verb_groups.tsv): "что" — with an object class (есть → еда, читать → текст,
водить → транспорт), "кого", "кому", "кем/чем", "о ком/чём", motion "к/от/мимо…",
location "у/под/около…". Object classes come from RuWordNet hypernyms
(data/seed/noun_classes.tsv). So "бежать воду" and "читать суп" are never generated.

Distribution. A template t has capacity cap(t) — the product of its slot sizes
(and the number of ending/preposition variants). All phrases of all templates are numbered consecutively:
number P ∈ [0, S), S = Σ cap(t); the template is the one whose segment P falls into, the remainder
gives the word numbers. So a template comes up with probability cap(t)/S: the more combinations,
the more often. Templates longer than L words are not used; L is chosen by capacity.

Run: python3 -I tools/data/gen_templates.py
"""
import bisect
import collections
import csv
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_adj_rules import decline  # noqa: E402
from common import DATA, ROOT, norm, open_out, strip_stress  # noqa: E402

csv.field_size_limit(10 ** 9)
CASES = ("nomn", "gent", "datv", "accs", "ablt", "loct")
CASE_RU = {"nomn": "И.п.", "gent": "Р.п.", "datv": "Д.п.", "accs": "В.п.", "ablt": "Т.п.", "loct": "П.п."}
VCOLS = ("infn", "pres:sing:3per", "pres:plur:3per", "past:masc", "past:femn", "past:plur")
MODALS = ("любить", "хотеть", "уметь", "мочь", "начинать", "пытаться", "бояться", "учиться", "собираться", "продолжать")
MAX_WORDS = 8
# Dictionary variants (python3 -I tools/data/gen_templates.py --help).
CFG = {
    "surname_rank": 1000,  # surnames no further than this prevalence rank
    "adj": "all",          # dict — first 2048 (as with powers of two); all — all usable
    "objects": "grammar",  # classes — semantic object classes; grammar — any inanimate object
    "verbs": "dict",       # seed — "что" verbs from verb_groups.tsv; dict — + all transitive (load_transitive_verbs)
                           #        (except data/seed/verb_stoplist.tsv)
}
DATA_BITS = 64
VOWELS = set("аеёиоуыэюя")

# Prepositions of objects and tails: (preposition, case).
MOTION_PREPS = [("к", "datv"), ("от", "gent"), ("за", "ablt"), ("мимо", "gent"), ("вокруг", "gent"), ("до", "gent")]
MOTION_PLACE = [("к", "datv"), ("до", "gent"), ("мимо", "gent"), ("через", "accs")]
STAY_PREPS = [("у", "gent"), ("около", "gent"), ("возле", "gent"), ("напротив", "gent"),
              ("под", "ablt"), ("над", "ablt"), ("за", "ablt"), ("перед", "ablt")]
STAY_PLACE = [("около", "gent"), ("возле", "gent"), ("под", "ablt"), ("за", "ablt")]
FOR_PREPS = [("для", "gent"), ("с", "ablt"), ("вместо", "gent")]
PLACE_TAIL = STAY_PLACE

HARD_NOUN = {"proper", "abbr", "obscene_or_pejorative", "archaic", "informal", "diminutive_or_aug",
             "not_plain_cyrillic", "pluralia_tantum", "common_gender", "substantivized_adj", "forms_unverified",
             "ablt_cluster"}


def read(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def cell(v):
    """Form from the reference: "?" (OpenCorpora only) is allowed, on disagreement "!a|b" — the first."""
    if not v:
        return None
    v = v.lstrip("?!").split("|")[0].split("/")[0]
    return strip_stress(v) or None


def flags(r):
    return set(x for x in r.get("auto_flags", "").split(",") if x)


class Slot:
    """Slot forms must not overlap: each form leads to a single word."""

    def __init__(self):
        self.forms = set()

    def take(self, forms):
        keys = {norm(f) for f in forms}
        if keys & self.forms:
            return False
        self.forms |= keys
        return True


# --- dictionaries ----------------------------------------------------------------------

def noun_paradigm(v, nums=("sing", "plur")):
    f = {f"{n}:{c}": cell(v.get(f"{n}:{c}", "")) for n in nums for c in CASES}
    return f if all(f.values()) else None


def load_classes():
    senses = collections.defaultdict(list)
    for r in read(os.path.join(DATA, "lexicon", "ruwordnet_senses.tsv")):
        if r["pos"] == "noun":
            chain = [r["synset_title"]] + (r["hypernym_chain"].split(" > ") if r["hypernym_chain"] else [])
            senses[r["lemma"]].append(set(chain))
    spec = read(os.path.join(DATA, "seed", "noun_classes.tsv"))

    def classes_of(lemma):
        """Word classes. Narrow class (еда, текст…) — one sense is enough: the verb itself
        picks the sense ("есть язык"). "Вещь" and "конкретное" — at least half of the word's senses
        must be such, otherwise "видит систему", "покупает историю"."""
        out = set()
        chains = senses.get(lemma, [])
        for s in spec:
            inc = set(x for x in (s["include"] or "").split(";") if x)
            exc = set(x for x in (s["exclude"] or "").split(";") if x)
            hits = sum(1 for chain in chains if chain & inc and not chain & exc)
            if hits and (s["majority"] != "1" or 2 * hits >= len(chains)):
                out.add(s["class"])
        return out

    return classes_of, {s["class"]: s["title"] for s in spec}


def load_pools():
    adjs = load_adjs()
    if CFG["adj"] == "dict":
        adjs = adjs[:2048]

    vn = read(os.path.join(DATA, "morph", "verified_noun.tsv"))
    vn_key = {(r["lemma"], r["oc_para_id"]): r for r in vn}
    vn_lemma = {}
    for r in vn:
        if "Name" not in r["oc_grammemes"] and "Surn" not in r["oc_grammemes"]:
            vn_lemma.setdefault(r["lemma"], r)
    nouns = read(os.path.join(DATA, "candidates", "noun.tsv"))

    # --- persons: a shared set of forms so that kinds don't overlap (Лев/лев, Роза/роза)
    who = Slot()
    animals = []
    rows = [r for r in nouns if r["animacy"] == "anim" and r["wn_lexnames"] == "noun.animal"
            and not flags(r) & HARD_NOUN and not r["dim_of"] and r["gender"] in ("masc", "femn")
            and float(r["rnc_ipm"]) >= 0.5 and len(r["lemma"]) <= 10]
    for r in sorted(rows, key=lambda r: -float(r["rnc_ipm"])):
        p = noun_paradigm(vn_key[(r["lemma"], r["oc_para_id"])])
        if p and who.take(p.values()):
            animals.append({"f": p, "g": r["gender"]})

    profs, roles = [], []
    rows = [r for r in read(os.path.join(DATA, "candidates", "profession.tsv"))
            if r["hard"] == "0" and not flags(r) & {"sensitive", "some_negative_sense", "has_non_person_sense"}
            and r["gender"] in ("masc", "femn") and len(r["lemma"]) <= 12 and float(r["rnc_ipm"]) >= 1]
    for r in sorted(rows, key=lambda r: -float(r["rnc_ipm"])):
        v = vn_lemma.get(r["lemma"])
        p = noun_paradigm(v) if v else None
        if p and who.take(p.values()):
            (profs if r["kind"].startswith("work") else roles).append({"f": p, "g": r["gender"]})

    vname = {(r["lemma"], r["oc_para_id"]): r for r in read(os.path.join(DATA, "morph", "verified_name.tsv"))}
    names = []
    rows = [r for r in read(os.path.join(DATA, "candidates", "name.tsv")) if not flags(r) and r["gender"] in ("masc", "femn")]
    for r in sorted(rows, key=lambda r: (-float(r["rnc_ipm"]), -int(r["subs_forms_count"]))):
        p = noun_paradigm(vname[(r["lemma"], r["oc_para_id"])], ("sing",))
        if p and who.take(p.values()):
            names.append({"f": {k: x.capitalize() for k, x in p.items()}, "g": r["gender"], "lemma": r["lemma"]})

    clean_sur = {r["lemma"] for r in read(os.path.join(DATA, "candidates", "surname.tsv")) if not flags(r)}
    surnames = []
    for r in read(os.path.join(DATA, "morph", "oc_surname.tsv")):
        if int(r["rank"]) > CFG["surname_rank"] or r["type"] not in ("ov_in", "adj") or r["rule_ok"] != "1" or r["lemma"] not in clean_sur:
            continue
        f = {f"{g}:{c}": cell(r[f"{g}:{c}"]) for g in ("masc", "femn", "plur") for c in CASES}
        if all(f.values()) and who.take(f.values()):
            surnames.append({k: x.capitalize() for k, x in f.items()})

    name_lemmas = {n["lemma"] for n in names}
    patrs = []
    for r in read(os.path.join(DATA, "candidates", "patronymic.tsv")):
        lemma, fem = r["lemma"], r["femn"].lower()
        if flags(r) or r["base_name_flags"] or norm(r["base_name"]) not in name_lemmas:
            continue
        if not lemma.endswith(("ович", "евич")) or not fem.endswith("на"):
            continue  # -ич (Ильич, Фомич) decline differently
        m = {"nomn": lemma, "gent": lemma + "а", "datv": lemma + "у", "accs": lemma + "а",
             "ablt": lemma + "ем", "loct": lemma + "е"}
        st = fem[:-1]
        fm = {"nomn": fem, "gent": st + "ы", "datv": st + "е", "accs": st + "у", "ablt": st + "ой", "loct": st + "е"}
        f = {**{f"masc:{c}": x.capitalize() for c, x in m.items()}, **{f"femn:{c}": x.capitalize() for c, x in fm.items()}}
        if who.take(f.values()):
            patrs.append(f)

    # --- objects with classes
    classes_of, class_titles = load_classes()
    objs = collections.defaultdict(list)
    slot = Slot()
    rows = [r for r in nouns if r["animacy"] == "inan" and not flags(r) & HARD_NOUN and not r["dim_of"]
            and float(r["rnc_ipm"]) >= 1 and len(r["lemma"]) <= 11 and r["gender"] in ("masc", "femn", "neut")]
    for r in sorted(rows, key=lambda r: -float(r["rnc_ipm"])):
        cls = classes_of(r["lemma"])
        if CFG["objects"] == "grammar":
            cls.add("all")
        if not cls:
            continue
        p = noun_paradigm(vn_key[(r["lemma"], r["oc_para_id"])])
        if not p or p["sing:accs"] == p["plur:accs"] or norm(p["sing:nomn"]) in who.forms:
            continue
        if slot.take(p.values()):
            item = {"f": p, "g": r["gender"]}
            for c in cls:
                objs[c].append(item)

    vp = {(r["lemma"], r["oc_para_id"]): r for r in read(os.path.join(DATA, "morph", "verified_place.tsv"))}
    places = []
    for r in read(os.path.join(DATA, "candidates", "place.tsv")):
        if flags(r) or r["gender"] not in ("masc", "femn", "neut") or float(r["rnc_ipm"]) < 0.5:
            continue
        v = vp.get((r["lemma"], r["oc_para_id"]))
        p = noun_paradigm(v, ("sing",)) if v else None
        if p and norm(p["sing:nomn"]) not in who.forms and slot.take(p.values()):
            places.append({"f": {k: x.capitalize() for k, x in p.items()}, "g": r["gender"]})

    # --- verbs by group
    vv = collections.defaultdict(list)
    for r in read(os.path.join(DATA, "morph", "verified_verb.tsv")):
        vv[r["lemma"]].append(r)

    def verb_forms(lemma):
        for r in sorted(vv.get(lemma, []), key=lambda r: "perf" in r["oc_grammemes"]):
            f = [cell(r[c]) for c in VCOLS]
            if all(f):
                return f
        return None

    groups, missing = [], []
    for g in read(os.path.join(DATA, "seed", "verb_groups.tsv")):
        verbs = []
        for lemma in g["verbs"].split(","):
            f = verb_forms(lemma)
            if f:
                verbs.append(f)
            else:
                missing.append(lemma)
        groups.append({"name": g["group"], "frame": g["frame"], "verbs": verbs, "comment": g["comment"]})
    # A verb must not repeat across "что" groups, otherwise one phrase = two templates.
    seen = collections.Counter(v[0] for g in groups if g["frame"].startswith("acc:") and g["frame"] != "acc:person"
                               for v in g["verbs"])
    dup = sorted(v for v, k in seen.items() if k > 1)
    if CFG["objects"] == "grammar":
        # Grammar only: all "что" verbs form one group, taking any inanimate object.
        merged, keys = [], set()
        stop = {r["verb"] for r in read(os.path.join(DATA, "seed", "verb_stoplist.tsv"))}
        extra = [v for v in load_transitive_verbs() if v[0] not in stop] if CFG["verbs"] == "dict" else []
        for g in groups:
            if g["frame"].startswith("acc:") and g["frame"] != "acc:person":
                extra = g["verbs"] + extra
        for v in extra:
            if v[0] not in keys and v[0] not in MODALS:
                keys.add(v[0])
                merged.append(v)
        groups = [{"name": "что", "frame": "acc:all", "verbs": merged,
                   "comment": "любой неодушевлённый предмет: грамматика верна, смысл может быть нелепым"}] + \
            [g for g in groups if not g["frame"].startswith("acc:") or g["frame"] == "acc:person"]
        dup = []
    class_titles = {**class_titles, "all": "предмет"}
    modals = [verb_forms(m) for m in MODALS]
    return {
        "adj": adjs, "animal": animals, "prof": profs, "role": roles, "name": names, "surname": surnames,
        "patr": patrs, "obj": objs, "class_titles": class_titles, "place": places, "groups": groups,
        "modal": modals, "missing": missing, "dup": dup,
        "arg_class": "all" if CFG["objects"] == "grammar" else "concrete",
    }


def load_transitive_verbs():
    """Imperfective transitive verbs for the "что" group: no auto flags, ipm ≥ 1, "physical"
    (WordNet) first, no synonyms/one-letter differences among them, up to 1024.
    Forms: infinitive, present 3sg/3pl, past masc./fem./plur. — only those confirmed by the reference."""
    def strict(v):
        return None if not v or v[0] in "?!" else strip_stress(v.split("/")[0])

    conflict = collections.defaultdict(set)
    for r in read(os.path.join(DATA, "lexicon", "conflict_pairs_verb.tsv")):
        conflict[norm(r["a"])].add(norm(r["b"]))
        conflict[norm(r["b"])].add(norm(r["a"]))
    vv = {(r["lemma"], r["oc_para_id"]): r for r in read(os.path.join(DATA, "morph", "verified_verb.tsv"))}
    rows = [r for r in read(os.path.join(DATA, "candidates", "verb.tsv"))
            if not flags(r) and float(r["rnc_ipm"]) >= 1 and len(r["lemma"]) <= 12
            and r["lemma"] not in ("любить", "хотеть", "уметь")]
    rows.sort(key=lambda r: (-(r["wn_concrete"] == "1"), -float(r["rnc_ipm"])))
    forms_taken, lemmas, out = set(), set(), []
    for r in rows:
        if len(out) >= 1024:
            break
        f = [strict(vv[(r["lemma"], r["oc_para_id"])].get(c, "")) for c in VCOLS]
        if not all(f):
            continue
        keys = {norm(x) for x in f}
        lemma = norm(r["lemma"])
        if keys & forms_taken or lemma in lemmas or conflict[lemma] & lemmas:
            continue
        forms_taken |= keys
        lemmas.add(lemma)
        out.append(f)
    return out


def load_adjs():
    """All usable adjectives (export_app_dicts.py filters, without truncation to 2048)."""
    rule_bad = {r["lemma"] for r in read(os.path.join(DATA, "exceptions", "adj_rule_mismatches.tsv"))}
    conflict = collections.defaultdict(set)
    for r in read(os.path.join(DATA, "lexicon", "conflict_pairs_adj.tsv")):
        conflict[norm(r["a"])].add(norm(r["b"]))
        conflict[norm(r["b"])].add(norm(r["a"]))
    rows = [r for r in read(os.path.join(DATA, "candidates", "adj.tsv"))
            if r["lemma"] not in rule_bad
            and not flags(r) & {"possessive", "pronominal_or_numeral", "ne_prefix", "participle_like",
                               "nonstandard_lemma", "obscene_or_pejorative", "archaic", "informal",
                               "not_plain_cyrillic", "forms_unverified", "diminutive_or_aug"}
            and 4 <= len(r["lemma"]) <= 12 and float(r["rnc_ipm"]) >= 1 and decline(r["lemma"])
            and not r["lemma"].endswith(("ший", "щий"))]
    rows.sort(key=lambda r: (-(float(r["concreteness_max"] or 0) >= 3.5), -float(r["rnc_ipm"])))
    slot, taken, out = Slot(), set(), []
    for r in rows:
        if conflict[norm(r["lemma"])] & taken:
            continue
        d = decline(r["lemma"])
        if slot.take(d.values()):
            taken.add(norm(r["lemma"]))
            out.append(d)
    return out


# --- grammar ---------------------------------------------------------------------------

def agree(adj, gender, case, anim):
    key = f"{gender}:{case}"
    if case == "accs" and gender in ("masc", "plur"):
        key += ":anim" if anim else ":inan"
    return adj[key]


def prep_form(prep, nxt):
    w = nxt.lower()
    if prep == "с" and len(w) > 1 and w[0] in "сзшж" and w[1] not in VOWELS:
        return "со"
    if prep == "к" and w[:2] in ("вс", "вт", "мн"):
        return "ко"
    if prep == "о" and w[0] in "аоуэи":
        return "об"
    return prep


class Alt:
    """Noun phrase: word pattern, capacity and rendering in any case."""

    def __init__(self, code, parts, words, cap, render):
        self.code, self.parts, self.words, self.cap, self.render = code, parts, words, cap, render

    def pattern(self, label):
        return " ".join(f"[{p} {label}]" if p != "Прил" else "[Прил]" for p in self.parts)


def person_alts(P):
    A, N, F, PT = P["adj"], P["name"], P["surname"], P["patr"]
    def kind_sg_pl(pool, title):
        def one(rnd, case, adj):
            e = rnd.choice(pool)
            num = rnd.choice(("sing", "plur"))
            g = "plur" if num == "plur" else e["g"]
            w = [e["f"][f"{num}:{case}"]]
            if adj:
                w.insert(0, agree(rnd.choice(A), g, case, True))
            return w, g
        return [Alt(title, [title], 1, 2 * len(pool), lambda rnd, case: one(rnd, case, False)),
                Alt("Прил " + title, ["Прил", title], 2, 2 * len(A) * len(pool), lambda rnd, case: one(rnd, case, True))]

    def name(rnd, case, adj=False, sur=False, patr=False):
        n = rnd.choice(N)
        g = n["g"]
        w = [n["f"][f"sing:{case}"]]
        if adj:
            w.insert(0, agree(rnd.choice(A), g, case, True))
        if patr:
            w.append(rnd.choice(PT)[f"{g}:{case}"])
        if sur:
            w.append(rnd.choice(F)[f"{g}:{case}"])
        return w, g

    def surname(rnd, case, adj=False, fam=False):
        g = "plur" if fam else rnd.choice(("masc", "femn"))
        w = [rnd.choice(F)[f"{g}:{case}"]]
        if adj:
            w.insert(0, agree(rnd.choice(A), g, case, True))
        return w, g

    def prof_sur(rnd, case):
        e = rnd.choice(P["prof"])
        return [e["f"][f"sing:{case}"], rnd.choice(F)[f"{e['g']}:{case}"]], e["g"]

    nA, nN, nF, nP, nR = len(A), len(N), len(F), len(PT), len(P["prof"])
    alts = [
        Alt("Имя", ["Имя"], 1, nN, lambda rnd, c: name(rnd, c)),
        Alt("Прил Имя", ["Прил", "Имя"], 2, nA * nN, lambda rnd, c: name(rnd, c, adj=True)),
        Alt("Имя Фамилия", ["Имя", "Фамилия"], 2, nN * nF, lambda rnd, c: name(rnd, c, sur=True)),
        Alt("Имя Отчество", ["Имя", "Отчество"], 2, nN * nP, lambda rnd, c: name(rnd, c, patr=True)),
        Alt("Прил Имя Фамилия", ["Прил", "Имя", "Фамилия"], 3, nA * nN * nF, lambda rnd, c: name(rnd, c, adj=True, sur=True)),
        Alt("Имя Отчество Фамилия", ["Имя", "Отчество", "Фамилия"], 3, nN * nP * nF,
            lambda rnd, c: name(rnd, c, sur=True, patr=True)),
        Alt("Фамилия", ["Фамилия"], 1, 2 * nF, lambda rnd, c: surname(rnd, c)),
        Alt("Прил Фамилия", ["Прил", "Фамилия"], 2, 2 * nA * nF, lambda rnd, c: surname(rnd, c, adj=True)),
        Alt("Семья", ["Семья"], 1, nF, lambda rnd, c: surname(rnd, c, fam=True)),
        Alt("Прил Семья", ["Прил", "Семья"], 2, nA * nF, lambda rnd, c: surname(rnd, c, adj=True, fam=True)),
        Alt("Профессия Фамилия", ["Профессия", "Фамилия"], 2, nR * nF, prof_sur),
    ]
    alts += kind_sg_pl(P["prof"], "Профессия") + kind_sg_pl(P["animal"], "Животное") + kind_sg_pl(P["role"], "Роль")
    return alts


def obj_alts(P, cls):
    pool, A = P["obj"][cls], P["adj"]
    title = P["class_titles"][cls]

    def one(rnd, case, adj):
        e = rnd.choice(pool)
        num = rnd.choice(("sing", "plur"))
        g = "plur" if num == "plur" else e["g"]
        w = [e["f"][f"{num}:{case}"]]
        if adj:
            w.insert(0, agree(rnd.choice(A), g, case, False))
        return w, g

    return [Alt(title, [title], 1, 2 * len(pool), lambda rnd, c: one(rnd, c, False)),
            Alt("Прил " + title, ["Прил", title], 2, 2 * len(A) * len(pool), lambda rnd, c: one(rnd, c, True))]


def place_alt(P):
    pool = P["place"]
    return Alt("Город", ["Город"], 1, len(pool), lambda rnd, c: ([rnd.choice(pool)["f"][f"sing:{c}"]], "masc"))


class Seg:
    """Template piece after "кто": pattern, words, capacity, render(rnd, subject gender)."""

    def __init__(self, pattern, words, cap, render, code):
        self.pattern, self.words, self.cap, self.render, self.code = pattern, words, cap, render, code


def pp_seg(preps, alt):
    """Preposition from a set + noun phrase in the preposition's case (capacity × number of prepositions)."""
    names = "|".join(p for p, _ in preps)
    cases = sorted(set(c for _, c in preps), key=CASES.index)
    pattern = f"[{names}] " + alt.pattern("/".join(CASE_RU[c] for c in cases))

    def render(rnd, _g):
        p, c = rnd.choice(preps)
        w, _ = alt.render(rnd, c)
        return [prep_form(p, w[0])] + w

    return Seg(pattern, 1 + alt.words, len(preps) * alt.cap, render, f"{names}+{alt.code}")


def np_seg(alt, case, prep=None):
    def render(rnd, _g):
        w, _ = alt.render(rnd, case)
        return ([prep_form(prep, w[0])] if prep else []) + w
    pattern = (f"[{prep}] " if prep else "") + alt.pattern(CASE_RU[case])
    return Seg(pattern, alt.words + (1 if prep else 0), alt.cap, render, (prep + "+" if prep else "") + alt.code)


def predicates(P, group):
    verbs, modals = group["verbs"], P["modal"]
    title = f"глагол «{group['name']}»"

    def finite(forms, tense, g):
        if tense == 0:
            return forms[2 if g == "plur" else 1]
        return forms[5 if g == "plur" else 4 if g == "femn" else 3]

    def v(rnd, g):
        return [finite(rnd.choice(verbs), rnd.randrange(2), g)]

    def mv(rnd, g):
        return [finite(rnd.choice(modals), rnd.randrange(2), g), rnd.choice(verbs)[0]]

    def bv(rnd, g):
        return ["будут" if g == "plur" else "будет", rnd.choice(verbs)[0]]

    n = len(verbs)
    return [Seg(f"[{title} наст.|прош.]", 1, 2 * n, v, "V"),
            Seg(f"[модальный наст.|прош.] [{title} инф.]", 2, 2 * len(modals) * n, mv, "MV"),
            Seg(f"[будет] [{title} инф.]", 2, n, bv, "BV")]


def arguments(P, group, persons, concrete):
    """The group's objects and the tails allowed after them."""
    frame = group["frame"]
    place = place_alt(P)
    tails_person = [np_seg(a, "gent") for a in persons]  # "whose" (genitive): книгу капитана "the captain's book"
    tails_for = [pp_seg(FOR_PREPS, a) for a in persons]  # "for / with / instead of" + person: для / с / вместо капитана
    tail_place = [pp_seg(PLACE_TAIL, place)]  # "near / by / under / beyond" + city: около / возле / под / за Москвой
    if frame.startswith("acc:") and frame != "acc:person":
        args = [np_seg(a, "accs") for a in obj_alts(P, frame[4:])]
        return [(a, [None] + tails_person + tails_for + tail_place) for a in args]
    if frame == "acc:person":
        return [(np_seg(a, "accs"), [None] + tails_for + tail_place) for a in persons]
    if frame == "dat:person":
        return [(np_seg(a, "datv"), [None] + tail_place) for a in persons]
    if frame == "ins:any":
        return [(np_seg(a, "ablt"), [None] + tail_place) for a in persons + concrete]
    if frame == "about:any":
        return [(np_seg(a, "loct", "о"), [None] + tail_place) for a in persons + concrete]
    if frame == "motion":
        return [(None, [None])] + [(pp_seg(MOTION_PREPS, a), [None]) for a in persons + concrete] + \
            [(pp_seg(MOTION_PLACE, place), [None])]
    if frame == "stay":
        return [(None, [None])] + [(pp_seg(STAY_PREPS, a), [None]) for a in persons + concrete] + \
            [(pp_seg(STAY_PLACE, place), [None])]
    raise SystemExit(f"unknown frame {frame}")


class Template:
    def __init__(self, subj, pred, arg, tail, group):
        self.subj, self.pred, self.arg, self.tail, self.group = subj, pred, arg, tail, group
        parts = [pred] + [x for x in (arg, tail) if x]
        self.words = subj.words + sum(x.words for x in parts)
        self.cap = subj.cap
        for x in parts:
            self.cap *= x.cap
        self.pattern = " ".join([subj.pattern(CASE_RU["nomn"])] + [x.pattern for x in parts])

    def render(self, rnd):
        w, g = self.subj.render(rnd, "nomn")
        for x in (self.pred, self.arg, self.tail):
            if x:
                w = w + x.render(rnd, g)
        s = " ".join(w)
        return s[0].upper() + s[1:] + "."


def build_templates(P):
    persons = person_alts(P)
    concrete = obj_alts(P, P["arg_class"])
    out = []
    for group in P["groups"]:
        if not group["verbs"]:
            continue
        for arg, tails in arguments(P, group, persons, concrete):
            for tail in tails:
                for pred in predicates(P, group):
                    for subj in persons:
                        t = Template(subj, pred, arg, tail, group)
                        if t.words <= MAX_WORDS:
                            out.append(t)
    return out


# --- report ----------------------------------------------------------------------------

def bits(n):
    return math.log2(n) if n else float("-inf")


def main():
    P = load_pools()
    rnd = random.Random(2026)
    T = build_templates(P)
    T.sort(key=lambda t: (t.words, -t.cap, t.pattern))
    by_len = collections.defaultdict(list)
    for t in T:
        by_len[t.words].append(t)
    S = {L: sum(t.cap for t in T if t.words <= L) for L in range(2, MAX_WORDS + 1)}
    examples = {id(t): t.render(rnd) for t in T}

    tsv = open_out(os.path.join(DATA, "templates", "templates.tsv"))
    tsv.write("id\twords\tlog2_cap\tshare_L6\tshare_L7\tgroup\tframe\tpattern\texample\n")
    for i, t in enumerate(T):
        s6 = t.cap / S[6] if t.words <= 6 else 0
        s7 = t.cap / S[7] if t.words <= 7 else 0
        tsv.write(f"{i}\t{t.words}\t{bits(t.cap):.2f}\t{s6:.3e}\t{s7:.3e}\t{t.group['name']}\t{t.group['frame']}\t"
                  f"{t.pattern}\t{examples[id(t)]}\n")
    tsv.close()

    L = []
    out = L.append
    out("bitphrase: обобщённые шаблоны, группы глаголов, распределение по ёмкости")
    out("=" * 86)
    out("Сгенерировано tools/data/gen_templates.py. Все шаблоны (до 8 слов) с ёмкостью, долей и")
    out("примером — в data/templates/templates.tsv. Примеры — реальные слова и проверенные формы;")
    out("словари ещё не отобраны вручную, поэтому отдельные слова неудачны.")
    out("")
    out(PRINCIPLE)

    out("2. СЛОВАРИ (размеры — без подгонки под степени двойки: при таком распределении она не нужна)")
    out("-" * 86)
    sizes = [("Прил", len(P["adj"])), ("Имя", len(P["name"])), ("Фамилия (м/ж/семья)", len(P["surname"])),
             ("Отчество (м/ж)", len(P["patr"])), ("Профессия", len(P["prof"])), ("Роль", len(P["role"])),
             ("Животное", len(P["animal"])), ("Город (топоним)", len(P["place"]))]
    for k, n in sizes:
        out(f"  {k:<22} {n:6d}   {bits(n):5.2f} бит")
    out("  Предметы по классам (слово может быть в нескольких классах: яблоко — еда и вещь):")
    for c, title in P["class_titles"].items():
        n = len(P["obj"][c])
        sample = ", ".join(e["f"]["sing:nomn"] for e in P["obj"][c][:8])
        out(f"    {title:<12} {n:6d}   {bits(n):5.2f} бит   {sample} …")
    out("")

    out("3. ГРУППЫ ГЛАГОЛОВ (data/seed/verb_groups.tsv) — управление определяет, что идёт после глагола")
    out("-" * 86)
    for g in P["groups"]:
        out(f"  {g['name']:<10} {g['frame']:<14} {len(g['verbs']):3d} гл.  {g['comment']}")
        out(f"      {', '.join(v[0] for v in g['verbs'])}")
    if P["missing"]:
        out(f"  Нет форм в эталоне (пропущены): {', '.join(P['missing'])}")
    if P["dup"]:
        out(f"  ВНИМАНИЕ: глаголы в нескольких «что»-группах: {', '.join(P['dup'])}")
    out(f"  Модальные (+ инфинитив): {', '.join(m[0] for m in P['modal'])}; будущее: «будет + инф.»")
    out("")
    out(FRAMES.rstrip("\n"))
    if CFG["objects"] == "grammar":
        out("  Режим «грамматика»: все «что»-глаголы — одна группа к любому неодушевлённому предмету")
        out("  («читает суп» — нелепо, но верно); глаголы с другим управлением исключены")
        out("  (data/seed/verb_stoplist.tsv).")
    else:
        out("  Режим «классы»: «что»-глагол берёт только свой класс («читать» — тексты).")
    out(f"  Словари: {CFG}")
    out("")

    out("5. СКОЛЬКО ШАБЛОНОВ И БИТ ПРИ РАЗНОЙ МАКСИМАЛЬНОЙ ДЛИНЕ L")
    out("-" * 86)
    out("  L   шаблонов (≤ L)   log2 S   сверх 64 бит   доля фраз ровно L слов")
    for Lm in range(2, MAX_WORDS + 1):
        n = sum(len(by_len[k]) for k in range(2, Lm + 1))
        exact = sum(t.cap for t in by_len[Lm]) / S[Lm]
        extra = bits(S[Lm]) - DATA_BITS
        out(f"  {Lm}   {n:14d}   {bits(S[Lm]):6.1f}   {extra:+12.1f}   {100 * exact:6.1f}%")
    out("  «Сверх 64 бит» — то, что остаётся на контрольную сумму и варианты фразы для 8 байт.")
    out("")

    for Lm in (6, 7):
        tot = S[Lm]
        out(f"6.{Lm - 5} РАСПРЕДЕЛЕНИЕ ПРИ L = {Lm}: S = 2^{bits(tot):.1f}")
        out("-" * 86)
        out("  По длине:")
        for k in range(2, Lm + 1):
            sh = sum(t.cap for t in by_len[k]) / tot
            out(f"    {k} сл.  {len(by_len[k]):6d} шабл.   доля {sh:.2e}")
        out("  По группам глаголов:")
        grp = collections.Counter()
        for t in T:
            if t.words <= Lm:
                grp[t.group["name"]] += t.cap
        for name, cap in grp.most_common():
            out(f"    {name:<10} {100 * cap / tot:6.2f}%")
        out("  По виду «кто»:")
        sub = collections.Counter()
        for t in T:
            if t.words <= Lm:
                sub[t.subj.code] += t.cap
        for name, cap in sub.most_common():
            out(f"    {name:<22} {100 * cap / tot:6.2f}%")
        out("  30 самых частых шаблонов:")
        top = sorted((t for t in T if t.words <= Lm), key=lambda t: -t.cap)[:30]
        for t in top:
            out(f"    {100 * t.cap / tot:6.2f}%  2^{bits(t.cap):4.1f}  ({t.words} сл.)  {t.pattern}")
            out(f"             {examples[id(t)]}")
        out(f"  Случайные 8 байт → фраза (шаблон выбран пропорционально ёмкости), 40 примеров:")
        pool = [t for t in T if t.words <= Lm]
        cum, acc = [], 0
        for t in pool:
            acc += t.cap
            cum.append(acc)
        for _ in range(40):
            t = pool[bisect.bisect_right(cum, rnd.randrange(acc))]
            out(f"    ({t.words} сл., {t.group['name']}) {t.render(rnd)}")
        out("")

    out("6.3 РАЗНООБРАЗИЕ ПРОТИВ ЁМКОСТИ: ПОТОЛОК НА ШАБЛОН")
    out("-" * 86)
    out("  Шаблон t использует min(cap(t), M) своих комбинаций (первые по номеру). Без потолка —")
    out("  максимум бит, но фразы однообразны; с потолком доли выравниваются ценой бит.")
    out("  «Эфф. шаблонов» = 2^энтропия распределения: столько равновероятных шаблонов дают ту же")
    out("  пестроту. Доли групп: видеть / вещь / узкие «что» / люди (кого, кому, кем, о ком) / движение+место.")
    narrow = {"еда", "напиток", "одежда", "транспорт", "здание", "растение", "текст"}
    people = {"кого", "кому", "кем-чем", "о ком"}
    for Lm in (6, 7, 8):
        pool = [t for t in T if t.words <= Lm]
        top = max(t.cap for t in pool)
        out(f"  L = {Lm}:")
        out("    потолок M    log2 S   сверх 64   эфф. шаблонов   видеть  вещь   узкие  люди   движ.+место")
        for m in [None] + [math.floor(bits(top)) - k for k in (2, 4, 6, 8, 10)]:
            M = top if m is None else 2 ** m
            r = [min(t.cap, M) for t in pool]
            tot = sum(r)
            ent = -sum(x / tot * math.log2(x / tot) for x in r if x)
            sh = collections.Counter()
            for t, x in zip(pool, r):
                g = t.group["name"]
                sh["видеть" if g in ("видеть", "что") else "вещь" if g == "вещь" else "узкие" if g in narrow
                   else "люди" if g in people else "движ"] += x
            label = "нет" if m is None else f"2^{m}"
            out(f"    {label:<10} {bits(tot):8.1f} {bits(tot) - DATA_BITS:+9.1f}   {2 ** ent:13.0f}   "
                + "  ".join(f"{100 * sh[k] / tot:5.1f}%" for k in ("видеть", "вещь", "узкие", "люди", "движ")))
        if Lm == 7:
            M = 2 ** (math.floor(bits(top)) - 6)
            r = [min(t.cap, M) for t in pool]
            cum, acc = [], 0
            for x in r:
                acc += x
                cum.append(acc)
            out(f"    Примеры при M = 2^{math.floor(bits(top)) - 6}:")
            for _ in range(30):
                t = pool[bisect.bisect_right(cum, rnd.randrange(acc))]
                out(f"      ({t.words} сл., {t.group['name']}) {t.render(rnd)}")
    out("")

    out("7. КОРОТКИЕ ШАБЛОНЫ: ПРИМЕРЫ (2–4 слова)")
    out("-" * 86)
    for k in (2, 3, 4):
        lst = by_len[k]
        out(f"  {k} слова — {len(lst)} шаблонов, все вместе 2^{bits(sum(t.cap for t in lst)):.1f} комбинаций:")
        for t in rnd.sample(lst, min(12, len(lst))):
            out(f"    2^{bits(t.cap):4.1f}  {t.pattern}")
            out(f"           {examples[id(t)]}")
    out("")
    out(FOOTER)
    with open(os.path.join(ROOT, "Templates.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print(f"Templates.txt + data/templates/templates.tsv: {len(T)} templates (≤ {MAX_WORDS} words); "
          + ", ".join(f"L={k}: 2^{bits(S[k]):.1f}" for k in range(4, MAX_WORDS + 1)))
    if P["missing"]:
        print("missing forms:", ", ".join(P["missing"]))
    if P["dup"]:
        print("verbs repeated in \"что\" groups:", ", ".join(P["dup"]))


PRINCIPLE = """1. ПРИНЦИП
----------
Шаблон — не фиксированная строка, а последовательность ГРУПП, у каждой — варианты:
  [КТО] [СКАЗУЕМОЕ] [ДОПОЛНЕНИЕ — по управлению глагола] [ХВОСТ?]
  КТО:         Имя | Прил Имя | Имя Фамилия | Имя Отчество | Прил Имя Фамилия |
               Имя Отчество Фамилия | Фамилия | Прил Фамилия | Семья | Прил Семья |
               Профессия Фамилия | (Прил) Профессия | (Прил) Животное | (Прил) Роль
  СКАЗУЕМОЕ:   глагол (наст./прош.) | модальный + инфинитив | будет + инфинитив
  ДОПОЛНЕНИЕ:  зависит от группы глагола (раздел 3–4): предмет нужного класса,
               человек в нужном падеже, «о ком/чём», «куда», «где» или ничего
  ХВОСТ:       чей (Р.п.) | для / с / вместо + КТО | около / возле / под / за + город
Каждое сочетание вариантов — отдельный шаблон со своей ёмкостью (числом комбинаций).

Распределение. Все фразы всех шаблонов нумеруются подряд: номер P ∈ [0, S),
S = Σ cap(t). Шаблон — тот, в чей отрезок попал P; остаток — номера слов (смешанная
система счисления, как сейчас). Поэтому шаблон выпадает с вероятностью cap(t) / S:
где комбинаций больше — чаще, где меньше — реже. Ни один шаблон не пропадает, а
размеры словарей больше не обязаны быть степенями двойки и совпадать.
Контроль и варианты: из 8 байт и номера варианта (v бит) получается X < 2^(64+v);
P = X·K + h, где K = ⌊S / 2^(64+v)⌋, h = хеш mod K. Декодер находит P по словам,
делит на K и сверяет остаток — это log2 K бит контроля у ЛЮБОГО шаблона.
"""

FRAMES = """4. ЧТО ИДЁТ ПОСЛЕ ГЛАГОЛА (рамки управления)
---------------------------------------------
  acc:<класс>   [Прил?] [предмет класса, В.п. ед./мн.]          ест жареную курицу
                + хвост: чей | для/с/вместо КТО | около/под… города
  acc:person    КТО в В.п. (одуш.)                              ждёт капитана Петрова
                + хвост: для/с/вместо КТО | около/под… города
  dat:person    КТО в Д.п.                                      помогает весёлой Маше
  ins:any       КТО или [Прил?] предмет в Т.п.                  гордится старой лодкой
  about:any     о/об + КТО или предмет в П.п.                   мечтает об Иване Петровиче
  motion        — | к/от/за/мимо/вокруг/до + КТО или предмет    бежит к старому мосту
                | к/до/мимо/через + город                       едет через Казань
  stay          — | у/около/возле/напротив/под/над/за/перед + … спит под зелёным деревом
                | около/возле/под/за + город                    живёт под Москвой
  У dat/ins/about можно добавить хвост «около/под… города».
  «бежать воду» не возникает: у глаголов движения нет В.п.
"""

FOOTER = """8. ВЫВОДЫ И ЧТО ДАЛЬШЕ
----------------------
  * Длина фразы почти всегда равна L: каждое лишнее слово умножает ёмкость в сотни раз,
    поэтому 2–4-словные шаблоны при 8 байтах практически не выпадают (их доля ~2^-30 и
    меньше). Они станут заметны только для коротких данных (2–4 байта: PIN, номер).
  * Смысловые классы предметов стоят ~6 бит на 6 словах (gen_templates.py --compare):
    нелепые сочетания допустимы, поэтому по умолчанию — только грамматика.
  * Прилагательные по смыслу не согласуются — нелепость помогает запоминанию.
  * Декодер: формы словарей разных слотов не пересекаются (проверка сборки), глагол
    входит только в одну «что»-группу — иначе одна фраза читалась бы двумя шаблонами.
"""

COMPARE = [
    ("A0 classes, adj 2048, surnames ≤4096 (old)", {"objects": "classes", "adj": "dict", "surname_rank": 4096}),
    ("A1 classes, adj 2048, surnames ≤1000", {"objects": "classes", "adj": "dict", "surname_rank": 1000}),
    ("A2 classes, all adj, surnames ≤1000", {"objects": "classes", "adj": "all", "surname_rank": 1000}),
    ("B  grammar, \"что\" verbs seed", {"objects": "grammar", "adj": "all", "surname_rank": 1000, "verbs": "seed"}),
    ("C  grammar, + all transitive", {"objects": "grammar", "adj": "all", "surname_rank": 1000, "verbs": "dict"}),
]


def compare():
    """Table: how many bits 6 and 7 words give with different dictionaries (without and with a cap)."""
    base = dict(CFG)
    print("variant                                        adj   sur.  objs.  \"что\"-v.    | L=6: none 2^-4  2^-6 | L=7: none 2^-4  2^-6")
    for title, cfg in COMPARE:
        CFG.clear()
        CFG.update(base, **cfg)
        P = load_pools()
        T = build_templates(P)
        acc = next(g for g in P["groups"] if g["frame"].startswith("acc:") and g["frame"] != "acc:person")
        nverbs = sum(len(g["verbs"]) for g in P["groups"] if g["frame"].startswith("acc:") and g["frame"] != "acc:person")
        row = f"{title:<46} {len(P['adj']):5d} {len(P['surname']):5d} {len(P['obj'][P['arg_class']]):6d} {nverbs:8d} |"
        for Lm in (6, 7):
            pool = [t.cap for t in T if t.words <= Lm]
            top = max(pool)
            cells = []
            for k in (None, 4, 6):
                M = top if k is None else top >> k
                cells.append(f"{bits(sum(min(c, M) for c in pool)):5.1f}")
            row += " " * 6 + " ".join(cells) + " |"
        print(row)
        del acc
    CFG.clear()
    CFG.update(base)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--compare", action="store_true", help="compare dictionary variants (writes nothing)")
    ap.add_argument("--objects", choices=("classes", "grammar"), default=CFG["objects"])
    ap.add_argument("--adj", choices=("dict", "all"), default=CFG["adj"])
    ap.add_argument("--verbs", choices=("seed", "dict"), default=CFG["verbs"])
    ap.add_argument("--surname-rank", type=int, default=CFG["surname_rank"])
    a = ap.parse_args()
    CFG.update(objects=a.objects, adj=a.adj, verbs=a.verbs, surname_rank=a.surname_rank)
    if a.compare:
        compare()
    else:
        main()
