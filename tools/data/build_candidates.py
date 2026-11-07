"""Summary candidate tables: one row = one OpenCorpora lexeme + all features
from Wiktionaries, RuWordNet and concreteness norms. Nothing is discarded — only
flagged (auto_flags), so that selection is transparent and reproducible.

Output: data/candidates/{noun,adj,verb,name,place}.tsv (by descending RNC frequency)
name (personal names) and place (toponyms) are separate dictionaries, never mixed.
Run: python3 -I tools/data/build_candidates.py
"""
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BRYSBAERT, DATA, RNC_CSV, iter_jsonl_gz, norm, open_out, strip_stress, wikt_pos  # noqa: E402

PROPER = {"Name", "Surn", "Patr", "Geox", "Orgn", "Trad"}
RU_OBSCENE = {"бран.", "обсц.", "груб.", "вульг.", "неценз.", "презр.", "пренебр.", "уничиж."}
RU_ARCHAIC = {"устар.", "истор.", "стар.", "архаич.", "церк.", "старин."}
RU_SLANG = {"жарг.", "крим.", "прост.", "сленг.", "мол.", "рег.", "диал.", "обл."}
EN_OBSCENE = {"vulgar", "offensive", "derogatory", "pejorative", "slur"}
EN_ARCHAIC = {"archaic", "obsolete", "dated", "historical"}
EN_SLANG = {"slang", "dialectal", "regional", "colloquial"}
CONCRETE_WN = {"noun.animal", "noun.artifact", "noun.body", "noun.food", "noun.object", "noun.person",
               "noun.plant", "noun.substance"}
PHYSICAL_VERB_WN = {"verb.contact", "verb.motion", "verb.consumption", "verb.creation", "verb.body",
                    "verb.change", "verb.perception"}
DIM_RE = re.compile(r"(уменьш[^ ]*|увелич[^ ]*|уничиж[^ ]*|ласк[^ ]*)\s+(?:к|от)\s+([а-яё]+)", re.I)
EN_DIM_RE = re.compile(r"(diminutive|augmentative|endearing form|pejorative form) of ([а-яё́]+)", re.I)
LABEL_RE = re.compile(r"^((?:[а-яё\-]+\.\s*)+)")
NAME_IN_GLOSS = re.compile(r"[А-ЯЁ][а-яё\u0301]+")
PLACE_TYPES = [("capital", r"Capital cities|National capitals"), ("city", r"^Cities in"),
               ("country", r"^Countries"), ("river", r"^Rivers"), ("lake", r"^Lakes"), ("sea", r"^Seas|^Oceans"),
               ("mountain", r"^Mountains"), ("island", r"^Islands"), ("peninsula", r"^Peninsulas"),
               ("desert", r"^Deserts"), ("continent", r"^Continents"),
               ("region", r"^Republics of|^Oblasts of|^Krais of|^Regions of")]
GOVERN = {"что", "кого", "кого-что", "чем", "кем", "чего", "кому", "чему", "на кого-что", "кого., что.",
          "без доп.", "с доп."}


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        yield from csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)


def load_brysbaert():
    out = {}
    with open(BRYSBAERT, encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            out[p[0].lower()] = float(p[2])
    return out


def gloss_head(g):
    g = re.sub(r"\([^)]*\)", "", g).strip().lower()
    g = re.split(r"[,;:]", g)[0].strip()
    g = re.sub(r"^(a|an|the|to|some)\s+", "", g)
    return g


def ru_wikt():
    out = {}
    dim_of = {}
    for d in iter_jsonl_gz(os.path.join(DATA, "lexicon", "wikt_ru_subset.jsonl.gz")):
        key = (norm(d["word"]), d["pos"])
        e = out.setdefault(key, {"labels_first": None, "labels_all": None, "syn": set(), "ant": set(),
                                 "hyper": set(), "meta": set(), "gov": set(), "gloss": "", "dim_of": set(),
                                 "n_senses": 0})
        for s in d["senses"]:
            gl = " ".join(s.get("glosses") or [])
            if not gl:
                continue
            labs = set()
            m = LABEL_RE.match(gl)
            if m:
                labs = {x.strip() + ("" if x.strip().endswith(".") else ".")
                        for x in re.findall(r"[а-яё]+\.(?:-[а-яё]+\.)?", m.group(1))}
            for raw in s.get("raw_tags") or []:
                if raw.strip(" .,") in {g.strip(".") for g in GOVERN}:
                    e["gov"].add(raw.strip(" .,"))
            for mm in DIM_RE.finditer(gl):
                e["dim_of"].add(mm.group(2).lower())
            if e["labels_first"] is None:
                e["labels_first"] = labs
                e["gloss"] = gl[:160]
            e["labels_all"] = labs if e["labels_all"] is None else (e["labels_all"] & labs)
            e["n_senses"] += 1
        e["syn"] |= {x["word"] for x in d["synonyms"]}
        e["ant"] |= {x["word"] for x in d["antonyms"]}
        e["hyper"] |= {x["word"] for x in d["hypernyms"]}
        e["meta"] |= set(d["metagrams"])
        for r in d["related"]:
            raw = " ".join(r.get("raw_tags") or [])
            if "уменьш" in raw or "увелич" in raw or "уничиж" in raw:
                dim_of.setdefault((norm(r["word"]), d["pos"]), set()).add(d["word"])
    for k, v in dim_of.items():
        if k in out:
            out[k]["dim_of"] |= v
    return out


def en_wikt(conc):
    out = {}
    for d in iter_jsonl_gz(os.path.join(DATA, "lexicon", "wikt_en_subset.jsonl.gz")):
        key = (norm(d["word"]), d["pos"])
        e = out.setdefault(key, {"tags": set(), "tags_all": None, "glosses": [], "conc": [], "dim_of": set(),
                                 "topics": set(), "prop_cats": set(), "gender_arg": set(), "hypocor": set()})
        e["prop_cats"] |= set(d.get("prop_categories") or [])
        for ht in d.get("head_templates") or []:
            a = ht.get("args", {})
            e["gender_arg"].add(a.get("g") or a.get("2") or "")
            for k in ("hypocor", "dim"):
                e["hypocor"] |= {strip_stress(x) for x in (a.get(k) or "").split(",") if x}
        for s in d["senses"]:
            gl = " ".join(s.get("glosses") or [])
            tags = set(s.get("tags") or [])
            if "form-of" in tags or "alt-of" in tags or not gl:
                continue
            e["tags"] |= tags
            e["tags_all"] = tags if e["tags_all"] is None else (e["tags_all"] & tags)
            e["topics"] |= set(s.get("topics") or [])
            if len(e["glosses"]) < 3:
                e["glosses"].append(gl[:80])
                h = gloss_head(gl)
                c = conc.get(h)
                if c is None and h:
                    c = conc.get(h.split()[-1])
                if c is not None:
                    e["conc"].append(c)
            for mm in EN_DIM_RE.finditer(gl):
                e["dim_of"].add(strip_stress(mm.group(2)).lower())
            if d["pos"] == "prop" and "diminutive" in gl and "given name" in gl:
                e["dim_of"] |= {strip_stress(x) for x in NAME_IN_GLOSS.findall(gl)}
    return out


def rnc_common_lemmas():
    """RNC lemmas of any part of speech except proper names (for the homonym_common flag)."""
    out = set()
    with open(RNC_CSV, encoding="utf-8") as f:
        next(f)
        for line in f:
            lemma, pos = line.split("\t", 2)[:2]
            if pos != "s.PROP":
                out.add(norm(lemma))
    return out


def prop_features(r, gr, ew, common, other_kind, kind):
    """Features and flags of a personal name (kind = name) or a toponym (kind = place).
    other_kind — lemmas of the other kind's dictionary (for the homonym_name_place flag)."""
    flags = []
    cats = ew.get("prop_cats") or set()
    nom = r["sing:nomn"].lstrip("?!").split("|")[0].split("/")[0]
    display = strip_stress(nom) if nom and nom[0].isupper() else r["lemma"].capitalize()
    feat = {"display": display, "gender": next((g for g in ("masc", "femn", "neut") if g in gr), ""),
            "animacy": "anim" if "anim" in gr else "inan"}
    if kind == "name":
        male = any("male given names" in c and "female" not in c for c in cats)
        female = any("female given names" in c for c in cats)
        unisex = bool(gr & {"Ms-f", "ms-f", "GNdr"}) or (male and female) or \
            any("mfbysense" in g or g.startswith("mf") for g in ew.get("gender_arg") or set())
        russian = any(re.match(r"Russian (?:diminutives of )?(?:male|female) given names", c) for c in cats)
        feat["name_form"] = "short" if any("diminutives of" in c for c in cats) else "full" if cats else ""
        feat["name_origin"] = "russian" if russian else "foreign_or_unknown"
        feat["hypocorisms"] = ",".join(sorted(ew.get("hypocor") or set()))[:120]
        if unisex:
            flags.append("unisex_name")
        if not russian:
            flags.append("not_russian_given_name")
    else:
        types = [t for t, rx in PLACE_TYPES if any(re.search(rx, c) for c in cats)]
        feat["place_type"] = ",".join(types)
        feat["where"] = ",".join(sorted({c.split(" in ", 1)[1] for c in cats if c.startswith("Cities in ")}))[:80]
        if types and set(types) <= {"country", "region"} or (set(types) & {"country", "region"} and "capital" not in types):
            flags.append("country_or_region")  # for manual review: political connotations
        if "masc" in gr and re.search(r"(ов|ев|ёв|ин|ын)$", r["lemma"]):
            flags.append("toponym_ov_in")  # instrumental -ом, homonymy with surnames (Пушкин, Александров)
        if not types:
            flags.append("place_type_unknown")
    if norm(r["lemma"]) in common:
        flags.append("homonym_common")  # a name that is also a common noun: Роза/роза "rose", Орёл/орёл "eagle", Пара/пара "pair"
    if norm(r["lemma"]) in other_kind:
        flags.append("homonym_name_place")  # in both dictionaries: Лена (name and river), Юра (name and mountains)
    if "Fixd" in gr:
        flags.append("indeclinable")
    if "Pltm" in gr:
        flags.append("pluralia_tantum")
    return feat, flags


def ruwordnet():
    out = {}
    for r in read_tsv(os.path.join(DATA, "lexicon", "ruwordnet_senses.tsv")):
        key = (norm(r["lemma"]), r["pos"])
        e = out.setdefault(key, {"lex": set(), "conc": [], "syn": set(), "roots": set(), "n": 0})
        e["n"] += 1
        e["lex"] |= set(x for x in r["wn_lexname"].split(",") if x)
        if r["en_concreteness"]:
            e["conc"].append(float(r["en_concreteness"]))
        e["syn"] |= set(x for x in r["synonyms"].split(",") if x)
        ch = r["hypernym_chain"].split(" > ")
        if len(ch) >= 2:
            e["roots"].add(ch[-2] if len(ch) >= 2 else ch[-1])
    return out


VOWELS = set("аеёиоуыэюя")


def noun_morph(r):
    """Morphological "traps" (plan section 6.2) — for test stratification."""
    nom, gen, acc, abl = (r.get(c, "").split("/")[0].lstrip("?!") for c in
                          ("sing:nomn", "sing:gent", "sing:accs", "sing:ablt"))
    nom, gen, acc, abl = (strip_stress(x).split("|")[0] for x in (nom, gen, acc, abl))
    f = []
    if not nom:
        return "no_sing", ""
    if nom == gen == abl:
        return "indecl", ""
    stem_n = nom[:-1] if nom[-1] in "аяоеьйы" else nom
    stem_g = gen[:-1] if gen and gen[-1] in "аяиыу" else gen
    if stem_n != stem_g and not (nom.endswith("мя") or nom in ("путь", "мать", "дочь")):
        f.append("stem_alt")
    if nom.endswith("мя"):
        f.append("heteroclitic_mya")
    if acc == gen and acc != nom:
        f.append("acc=gen")
    elif acc == nom:
        f.append("acc=nom")
    else:
        f.append("acc_own")
    if len(abl) >= 2 and abl[0] not in VOWELS and abl[1] not in VOWELS and nom[1:2] in VOWELS:
        f.append("ablt_cluster")  # "подо льдом" etc.
    end = next((e for e in ("ью", "ём", "ем", "ом", "ёй", "ей", "ой", "ою", "ею") if abl.endswith(e)), "?")
    return ",".join(f), end


def adj_type(lemma):
    if lemma.endswith("ой"):
        return "stressed_oj"
    if lemma.endswith("ый"):
        return "hard_yj"
    if lemma.endswith("ий"):
        return "mixed_ij" if len(lemma) > 2 and lemma[-3] in "гкхжшчщ" else "soft_ij"
    return "other"


def main():
    conc = load_brysbaert()
    ru = ru_wikt()
    en = en_wikt(conc)
    wn = ruwordnet()
    common = rnc_common_lemmas()
    prop_lemmas = {k: {norm(r["lemma"]) for r in read_tsv(os.path.join(DATA, "morph", f"oc_{k}.tsv"))}
                   for k in ("name", "place")}
    for pos in ("noun", "adj", "verb", "name", "place"):
        rows = list(read_tsv(os.path.join(DATA, "morph", f"verified_{pos}.tsv")))
        oc = {(r["lemma"], r["oc_para_id"]): r for r in read_tsv(os.path.join(DATA, "morph", f"oc_{pos}.tsv"))}
        out_rows = []
        for r in rows:
            o = oc[(r["lemma"], r["oc_para_id"])]
            key = (norm(r["lemma"]), pos)
            wkey = (norm(r["lemma"]), wikt_pos(pos))
            gr = set(r["oc_grammemes"].split(","))
            rw, ew, ww = ru.get(wkey, {}), en.get(wkey, {}), wn.get(key, {})
            flags = []
            if gr & PROPER and pos not in ("name", "place"):
                flags.append("proper")
            if "Abbr" in gr:
                flags.append("abbr")
            lf = rw.get("labels_first") or set()
            la = rw.get("labels_all") or set()
            et = ew.get("tags") or set()
            eta = ew.get("tags_all") or set()
            if "Obsc" in gr or (lf & RU_OBSCENE) or (et & EN_OBSCENE):
                flags.append("obscene_or_pejorative")
            if "Arch" in gr or (la & RU_ARCHAIC) or (eta & EN_ARCHAIC):
                flags.append("archaic")
            if gr & {"Slng", "Infr", "Erro", "Dist"} or (la & RU_SLANG) or (eta & EN_SLANG):
                flags.append("informal")
            dim = (rw.get("dim_of") or set()) | (ew.get("dim_of") or set())
            dim.discard(norm(r["lemma"]))
            if dim:
                flags.append("diminutive_or_aug")
            if dim and pos in ("name", "place"):
                flags.remove("diminutive_or_aug")  # a diminutive name (Маша) is not a defect; see name_form
            if not re.fullmatch(r"[а-яё]+", r["lemma"]):
                flags.append("not_plain_cyrillic")
            if r["core_ok"] != "1":
                flags.append("forms_unverified")
            wn_lex = ww.get("lex") or set()
            conc_vals = (ww.get("conc") or []) + (ew.get("conc") or [])
            row = {
                "lemma": r["lemma"], "oc_para_id": r["oc_para_id"], "oc_grammemes": r["oc_grammemes"],
                "rnc_ipm": o["rnc_ipm"], "rnc_R": o["rnc_R"], "subs_forms_count": o["subs_forms_count"],
                "len": str(len(r["lemma"])),
            }
            if pos == "noun":
                gender = next((g for g in ("masc", "femn", "neut") if g in gr), "")
                anim = "anim" if "anim" in gr else "inan" if "inan" in gr else ""
                if "Pltm" in gr:
                    flags.append("pluralia_tantum")
                if gr & {"Ms-f", "ms-f", "GNdr"}:
                    flags.append("common_gender")
                nom = strip_stress(r["sing:nomn"].lstrip("?!").split("/")[0])
                gen = strip_stress(r["sing:gent"].lstrip("?!").split("/")[0])
                if re.search(r"(ый|ий|ой|ая|яя|ое|ее)$", nom) and re.search(r"(ого|его|ой|ей)$", gen):
                    flags.append("substantivized_adj")
                morph, abl_end = noun_morph(r)
                if "ablt_cluster" in morph:
                    flags.append("ablt_cluster")
                row.update({"gender": gender, "animacy": anim, "morph": morph, "ablt_ending": abl_end,
                            "wikt_class": r["wikt_class"],
                            "nomn": r["sing:nomn"], "accs": r["sing:accs"], "ablt": r["sing:ablt"],
                            "gent": r["sing:gent"], "plur_nomn": r["plur:nomn"], "plur_gent": r["plur:gent"]})
            elif pos in ("name", "place"):
                other = prop_lemmas["place" if pos == "name" else "name"]
                feat, pflags = prop_features(r, gr, ew, common, other, pos)
                flags += pflags
                row.update(feat)
                row.update({"wikt_class": r["wikt_class"], "nomn": r["sing:nomn"], "accs": r["sing:accs"],
                            "ablt": r["sing:ablt"], "gent": r["sing:gent"]})
            elif pos == "adj":
                if gr & {"Poss"}:
                    flags.append("possessive")
                if gr & {"Apro", "Anum"}:
                    flags.append("pronominal_or_numeral")
                if r["lemma"].startswith("не") and len(r["lemma"]) > 5:
                    flags.append("ne_prefix")
                if re.search(r"(нный|тый|щий|вший|мый)$", r["lemma"]):
                    flags.append("participle_like")
                if not r["lemma"].endswith(("ый", "ий", "ой")):
                    flags.append("nonstandard_lemma")
                row.update({"qual": "Qual" if "Qual" in gr else "", "has_short": "1" if r["short:masc"] else "0",
                            "has_comp": "1" if r["comp"] else "0", "adj_type": adj_type(r["lemma"]),
                            "wikt_class": r["wikt_class"],
                            "femn_accs": r["femn:accs"], "masc_ablt": r["masc:ablt"], "femn_ablt": r["femn:ablt"]})
            else:
                aspect = "perf" if "perf" in gr else "impf" if "impf" in gr else ""
                trans = "tran" if "tran" in gr else "intr" if "intr" in gr else ""
                if r["lemma"].endswith(("ся", "сь")):
                    flags.append("reflexive")
                if aspect != "impf":
                    flags.append("not_imperfective")
                if trans != "tran":
                    flags.append("intransitive")
                if "Impe" in gr or "Impx" in gr:
                    flags.append("impersonal")
                row.update({"aspect": aspect, "transitivity": trans,
                            "government": ",".join(sorted(rw.get("gov") or [])),
                            "wikt_class": r["wikt_class"],
                            "pres_3sg": r["pres:sing:3per"], "pres_3pl": r["pres:plur:3per"]})
            row.update({
                "auto_flags": ",".join(flags),
                "wn_lexnames": ",".join(sorted(wn_lex)),
                "wn_concrete": "1" if (wn_lex & (CONCRETE_WN if pos == "noun" else PHYSICAL_VERB_WN)) else "0",
                "concreteness_max": f"{max(conc_vals):.2f}" if conc_vals else "",
                "ruwn_roots": " | ".join(sorted(ww.get("roots") or []))[:120],
                "dim_of": ",".join(sorted(dim)),
                "labels_first_sense": " ".join(sorted(lf)),
                "synonyms": ",".join(sorted((rw.get("syn") or set()) | (ww.get("syn") or set())))[:300],
                "antonyms": ",".join(sorted(rw.get("ant") or set()))[:120],
                "hypernyms_wikt": ",".join(sorted(rw.get("hyper") or set()))[:160],
                "metagrams": ",".join(sorted(rw.get("meta") or set()))[:200],
                "en_glosses": " ; ".join(ew.get("glosses") or [])[:200],
                "ru_gloss": (rw.get("gloss") or "").replace("\t", " "),
            })
            out_rows.append(row)
        out_rows.sort(key=lambda x: (-float(x["rnc_ipm"]), -int(x["subs_forms_count"])))
        cols = list(out_rows[0].keys())
        with open_out(os.path.join(DATA, "candidates", f"{pos}.tsv")) as f:
            f.write("\t".join(cols) + "\n")
            for x in out_rows:
                f.write("\t".join(re.sub(r"[\t\r\n]+", " ", x[c]) for c in cols) + "\n")
        print(pos, len(out_rows))


if __name__ == "__main__":
    main()
