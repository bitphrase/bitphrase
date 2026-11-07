"""English dictionaries for the app: data/en/candidates/*.tsv + data/en/seed -> src/lang/en/dict.json.

Picks words for every dictionary of the English grammar (src/lang/en/grammar.ts):
adjectives, first names, surnames, titles, professions, roles, animals, objects, places,
verbs by group. Every word form (and the possessive Anna's -> annas) belongs to exactly
one dictionary: a word that is already taken by a dictionary earlier in PRIORITY is
skipped. That keeps parsing unambiguous.

Also writes data/en/dicts/*.tsv — what was picked, for review.

Run: python3 -I tools/data/en/gen_dicts.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, ROOT, path, read, write  # noqa: E402

VERSION = "en-1-draft-1"
MAX_WORDS = 7
SIZES = {"adj": 4096, "name": 2048, "surname": 8192, "prof": 512, "role": 512, "animal": 512, "obj": 4096,
         "place": 512, "verb": 1536}

# Function words (fixed; not taken by any dictionary).
DET_SG = ["a", "the", "my", "your", "his", "her", "our", "their", "this", "that", "every", "each", "one", "another"]
DET_PL = ["the", "my", "your", "his", "her", "our", "their", "these", "those", "some", "many", "several", "all",
          "both", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty"]
MODALS = ["can", "could", "must", "should", "will", "would", "may", "might"]
CATENATIVES = ["like", "love", "hate", "enjoy", "start", "stop", "keep", "avoid", "finish", "begin",
               "imagine", "quit", "prefer"]
BE = ["is", "are", "was", "were"]
PREPS = {
    "motion": ["to", "toward", "past", "around", "from"],
    "motionPlace": ["to", "toward", "from", "through", "around"],
    "stay": ["near", "under", "behind", "beside", "above", "below"],
    "stayPlace": ["in", "near", "outside", "around"],
    "for": ["for", "with", "without", "against"],
    "placeTail": ["in", "near", "outside", "around"],
}
FIXED = {"to", "with", "about", "an"}

HARD = {"offensive", "archaic", "informal", "non_us", "form_of_only", "not_plain", "too_short", "not_in_wordnet",
        "no_pronunciation"}
HARD_NOUN = HARD | {"no_plural", "plural_same", "mostly_uncountable", "plural_only"}
OBJ_LEX = {"noun.artifact", "noun.food", "noun.plant", "noun.object", "noun.body"}
PROF_HYPER = {"worker", "professional", "skilled_worker", "employee", "expert", "serviceman", "military_officer",
              "official", "practitioner", "craftsman", "artist", "performer", "scientist", "health_professional",
              "creator", "musician", "entertainer", "athlete", "contestant", "leader", "administrator", "educator",
              "trained_worker", "specialist", "engineer", "manual_laborer", "agent", "intellectual", "writer"}
NEGATIVE_HYPER = {"bad_person", "wrongdoer", "criminal", "unpleasant_person", "unwelcome_person", "simpleton",
                  "deceiver", "offender", "sinner", "killer", "murderer", "prostitute", "adulterer", "lawbreaker",
                  "thief", "unfortunate", "sick_person", "disreputable_person", "religious_person", "clergyman",
                  "cleric", "spiritual_leader", "sex_offender", "drug_user", "addict", "victim", "dead_person",
                  "inferior", "oppressor", "enemy", "traitor", "fool", "misfit", "nonworker", "slave", "subordinate",
                  "worshiper", "disciple", "follower", "believer", "nonreligious_person", "homosexual", "heterosexual",
                  "bisexual", "lover", "sensualist", "debtor", "beggar", "drunkard", "patient", "invalid",
                  "spiritual_being", "deity", "god", "inhabitant", "native", "national", "relative", "head_of_state",
                  "politician", "ruler", "sovereign"}
NOT_ANIMAL = {"person", "body_part", "external_body_part", "organ", "unwelcome_person", "female", "male", "young"}


def flags(r):
    return set(x for x in r["auto_flags"].split(",") if x)


class Taken:
    """Comparison keys already given to a dictionary: a form leads to one word only."""

    def __init__(self):
        self.keys = set()

    @staticmethod
    def key(w):
        return w.lower().replace("'", "")

    def free(self, forms):
        ks = {self.key(f) for f in forms}
        return not ks & self.keys

    def take(self, forms):
        ks = {self.key(f) for f in forms}
        if ks & self.keys:
            return False
        self.keys |= ks
        return True


def an(w, cmu):
    return "^" + w if cmu.get(w.lower()) else w


def pick_verbs(taken, rows_by):
    """Verb groups from the seed; the "what" group also gets frequent transitive verbs."""
    def forms(v):
        r = rows_by.get(v)
        if not r or flags(r) & (HARD | {"forms_missing", "forms_coincide", "past_variants"}):
            return None
        return [r["lemma"], r["pres3"], r["past"], r["ing"]]

    verbs, vid, groups = [], {}, []
    stop = {r["word"] for r in read(os.path.join(DATA, "seed", "stoplist.tsv"))}

    def add(f):
        if f[0] not in vid:
            if not taken.take(f):
                return None
            vid[f[0]] = len(verbs)
            verbs.append(f)
        return vid[f[0]]

    seed = read(os.path.join(DATA, "seed", "verb_groups.tsv"))
    for g in seed:
        ids = []
        for v in dict.fromkeys(g["verbs"].split(",")):
            f = forms(v) if v not in stop else None
            i = add(f) if f else None
            if i is not None and i not in ids:
                ids.append(i)
        groups.append({"name": g["group"], "frame": g["frame"], "verbs": ids})
    # More transitive verbs for "what": the first sense takes a thing, frequent, plain forms.
    what = groups[0]
    extra = [r for r in rows_by.values()
             if r["wn_obj_thing"] == "1" and int(r["trans_senses"]) > 0 and float(r["ipm"]) >= 0.3
             and r["dom_pos"] in ("Verb", "")
             and len(r["lemma"]) <= 12 and r["lemma"] not in stop and r["lemma"] not in CATENATIVES]
    extra.sort(key=lambda r: -float(r["ipm"]))
    for r in extra:
        if len(what["verbs"]) >= SIZES["verb"]:
            break
        f = forms(r["lemma"])
        i = add(f) if f else None
        if i is not None and i not in what["verbs"]:
            what["verbs"].append(i)
    return verbs, groups


def main():
    cmu = json.load(open(path("lexicon", "an.json"), encoding="utf-8"))
    taken = Taken()
    stop = {r["word"] for r in read(os.path.join(DATA, "seed", "stoplist.tsv"))}
    for w in DET_SG + DET_PL + MODALS + BE + list(FIXED) + [p for l in PREPS.values() for p in l]:
        taken.take([w])

    # Catenatives ("likes painting"): base, -s, past.
    vrows = {r["lemma"]: r for r in read(path("candidates", "verb.tsv"))}
    cat = []
    for v in CATENATIVES:
        r = vrows[v]
        f = [v, r["pres3"], r["past"]]
        if taken.take(f):
            cat.append("|".join(f))

    # Titles: Doctor Smith; Uncle Bob (title and first name of the same gender).
    titles = read(os.path.join(DATA, "seed", "titles.tsv"))
    for t in titles:
        if not taken.take([t["title"]]):
            sys.exit(f"title {t['title']} is taken")
    tsur = [t["title"].capitalize() for t in titles if t["with"] in ("surname", "both")]
    neutral = [t["title"].capitalize() for t in titles if t["with"] in ("name", "both") and t["gender"] == "n"]
    tm = neutral + [t["title"].capitalize() for t in titles if t["with"] in ("name", "both") and t["gender"] == "m"]
    tf = neutral + [t["title"].capitalize() for t in titles if t["with"] in ("name", "both") and t["gender"] == "f"]
    n = min(len(tm), len(tf))

    verbs, groups = pick_verbs(taken, vrows)

    names = []
    for r in read(path("candidates", "name.tsv")):
        if len(names) >= SIZES["name"]:
            break
        if flags(r) & {"not_plain", "unisex", "not_in_wiktionary"} or len(r["name"]) < 3 or len(r["name"]) > 10:
            continue
        if taken.take([r["name"], r["name"] + "'s"]):
            names.append(f"{r['gender']}:{r['name']}")

    surnames = []
    for r in read(path("candidates", "surname.tsv")):
        if len(surnames) >= SIZES["surname"]:
            break
        if flags(r) & {"not_plain", "homonym_common"} or len(r["surname"]) > 10:
            continue
        if taken.take([r["surname"], r["surname"] + "'s"]):
            surnames.append(r["surname"])

    places = []
    for r in read(path("candidates", "place.tsv")):
        if len(places) >= SIZES["place"]:
            break
        # A homonym (Nice, Reading, Phoenix) only for a country: China, Turkey.
        if flags(r) & {"not_plain"} or float(r["ipm"]) < 0.3 or len(r["name"]) > 11 or \
                "homonym_common" in flags(r) and r["type"] != "country":
            continue
        if taken.take([r["name"]]):
            places.append(r["name"])

    nrows = [r for r in read(path("candidates", "noun.tsv"))
             if not flags(r) & HARD_NOUN and 3 <= len(r["lemma"]) <= 12 and float(r["ipm"]) >= 0.05
             and r["dom_pos"] in ("Noun", "")]
    animals, profs, roles, objs = [], [], [], []
    for r in nrows:
        lex = r["lex_first"]
        hyper = set(r["hypernyms"].split("/"))
        # lee, vega, liza: a person or animal noun that is really a name.
        if lex in ("noun.person", "noun.animal") and ("homonym_proper" in flags(r) or not r["concreteness"]):
            continue
        if lex == "noun.animal":
            if "animal" not in hyper or hyper & NOT_ANIMAL:
                continue
            pool, cap = animals, SIZES["animal"]
        elif lex == "noun.person":
            if hyper & NEGATIVE_HYPER:
                continue
            if hyper & PROF_HYPER:
                pool, cap = profs, SIZES["prof"]
            else:
                pool, cap = roles, SIZES["role"]
        elif lex in OBJ_LEX:
            c = float(r["concreteness"] or 0)
            if c < 3.5 and not (c == 0 and float(r["ipm"]) >= 0.3):
                continue
            pool, cap = objs, SIZES["obj"]
        else:
            continue
        if len(pool) >= cap or "noun.person" in r["lexnames"] and pool is objs or r["lemma"] in stop:
            continue
        if taken.take([r["lemma"], r["plural"]]):
            pool.append(f"{an(r['lemma'], cmu)}|{r['plural']}")

    adjs = []
    arows = [r for r in read(path("candidates", "adj.tsv"))
             if not flags(r) & (HARD | {"predicative_only", "comparative"}) and 3 <= len(r["lemma"]) <= 12
             and float(r["ipm"]) >= 0.1
             and (r["dom_pos"] == "Adjective" or r["dom_pos"] == "" and "also_noun_or_verb" not in flags(r))]
    arows.sort(key=lambda r: (-(float(r["concreteness"] or 0) >= 3.0), -float(r["ipm"])))
    for r in arows:
        if len(adjs) >= SIZES["adj"]:
            break
        if r["lemma"] in stop:
            continue
        if taken.take([r["lemma"]]):
            adjs.append(an(r["lemma"], cmu))

    data = {
        "version": VERSION,
        "maxWords": MAX_WORDS,
        "adj": adjs,
        "name": names,
        "surname": surnames,
        "title": {"surname": tsur, "masc": tm[:n], "femn": tf[:n]},
        "prof": profs,
        "role": roles,
        "animal": animals,
        "obj": objs,
        "place": places,
        "verbs": ["|".join(v) for v in verbs],
        "cat": cat,
        "modal": MODALS,
        "groups": groups,
        "det": {"sing": DET_SG, "plur": DET_PL},
        "preps": PREPS,
    }
    out = os.path.join(ROOT, "src", "lang", "en", "dict.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("dict.json:", {k: len(v) for k, v in data.items() if isinstance(v, list)},
          {g["name"]: len(g["verbs"]) for g in groups}, f"{os.path.getsize(out) // 1024} KB")
    for k in ("adj", "name", "surname", "prof", "role", "animal", "obj", "place", "verbs"):
        write(path("dicts", f"{k}.tsv"), [{"n": i, "word": w} for i, w in enumerate(data[k])], ["n", "word"])


if __name__ == "__main__":
    main()
