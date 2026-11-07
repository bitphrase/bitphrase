"""Dictionary of professions, positions and ranks (a separate dictionary): "капитан Иванов",
"повар Маша", "доктор Пищалкин".

Selected from animate nouns (data/candidates/noun.tsv) with at least
one RuWordNet sense under "РАБОТНИК", "ЧЕЛОВЕК ПО СФЕРЕ ДЕЯТЕЛЬНОСТИ",
"ВОЕННОСЛУЖАЩИЙ", "СПЕЦИАЛИСТ", "РУКОВОДИТЕЛЬ", "ДОЛЖНОСТНОЕ ЛИЦО" etc. (kind=work),
or under "ЧЕЛОВЕК ПО РОЛИ" (kind=role: пассажир, покупатель — also fine before a surname).
Forms come from the verified noun paradigms (verified_noun via candidates).

Output: data/candidates/profession.tsv
Run: python3 -I tools/data/build_professions.py
"""
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, norm, open_out  # noqa: E402

# Compare whole synset titles in the hypernym chain (not substrings:
# "ДЕЯТЕЛЬ" must not match "СУБЪЕКТ ДЕЯТЕЛЬНОСТИ").
WORK = re.compile(r"^(РАБОТНИК|СЛУЖАЩИЙ|ЧЕЛОВЕК ПО СФЕРЕ ДЕЯТЕЛЬНОСТИ|ВОЕННОСЛУЖАЩИЙ|СПЕЦИАЛИСТ|ПРОФЕССИОНАЛ|"
                  r"РУКОВОДИТЕЛЬ|ДОЛЖНОСТНОЕ ЛИЦО|МАСТЕР|УЧЕНЫЙ|ВРАЧ|ОФИЦЕР|ПРЕПОДАВАТЕЛЬ)(\b| \(|,|$)")
ROLE = re.compile(r"^ЧЕЛОВЕК ПО РОЛИ$")
MILITARY = re.compile(r"^(ВОЕННОСЛУЖАЩИЙ|ОФИЦЕР|ВОИН)(\b| \(|$)")
NEGATIVE = re.compile(r"\b(ПРЕСТУПНИК\w*|НАРУШИТЕЛЬ\w*|ВРАГ|МОШЕННИК\w*|УБИЙЦА|ВОР|БАНДИТ\w*|НЕГОДЯЙ|ПЬЯНИЦА|"
                      r"НАРКОМАН\w*|НИЧТОЖ\w*|ПРОСТИТУТ\w*|ПЛОХОЙ ЧЕЛОВЕК|ТИРАН|ПАЛАЧ)\b")


SENSITIVE = re.compile(r"ДУХОВЕНСТВО|СВЯЩЕННОСЛУЖИТЕЛ|ЦЕРКОВН|РЕЛИГИОЗН|НАЦИСТ|СПЕЦСЛУЖБ|ПОЛИТИЧЕСК|ПАРТИЙН|"
                       r"ГЛАВА ГОСУДАРСТВА|МОНАРХ")
SENSITIVE_WORDS = {"фюрер", "чекист", "президент", "премьер", "патриарх", "святитель", "партизан", "комиссар"}


def titles(chain):
    return [t.strip() for t in chain.split(" > ") if t.strip()]


HARD = {"proper", "abbr", "obscene_or_pejorative", "archaic", "informal", "diminutive_or_aug", "not_plain_cyrillic",
        "pluralia_tantum", "common_gender", "substantivized_adj", "forms_unverified"}


def read_tsv(path):
    with open(path, encoding="utf-8") as f:
        yield from csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)


def main():
    chains = {}
    for r in read_tsv(os.path.join(DATA, "lexicon", "ruwordnet_senses.tsv")):
        if r["pos"] == "noun":
            chains.setdefault(norm(r["lemma"]), []).append((r["synset_title"], r["hypernym_chain"]))
    rows, seen = [], set()
    for r in read_tsv(os.path.join(DATA, "candidates", "noun.tsv")):
        k = norm(r["lemma"])
        if r["animacy"] != "anim" or k in seen or k not in chains:
            continue
        person = [(t, titles(ch)) for t, ch in chains[k] if "ЧЕЛОВЕК" in titles(ch)]
        work = [t for t, ts in person if any(WORK.match(x) for x in ts)]
        role = [t for t, ts in person if any(ROLE.match(x) for x in ts)]
        if not work and not role:
            continue
        seen.add(k)
        flags = [f for f in r["auto_flags"].split(",") if f]
        neg = [t for t, ts in person if NEGATIVE.search(" > ".join([t] + ts))]
        if neg and len(neg) == len(person):
            flags.append("negative_sense")  # all "human" senses are criminal/enemy/nonentity
        elif neg:
            flags.append("some_negative_sense")  # one sense is negative: актёр (actor / pretender) — soft
        if any(SENSITIVE.search(" > ".join([t] + ts)) for t, ts in person) or k in SENSITIVE_WORDS:
            flags.append("sensitive")  # religion, politics, secret services — for manual review
        if len(person) < len(chains[k]):
            flags.append("has_non_person_sense")  # also a non-person sense: папа (father / pope), модель (model), кукла (doll) — soft flag
        kind = "work" if work else "role"
        if any(any(MILITARY.match(x) for x in ts) for _, ts in person):
            kind += ",military"
        rows.append({
            "lemma": r["lemma"], "display": r["lemma"], "kind": kind, "gender": r["gender"],
            "rnc_ipm": r["rnc_ipm"], "subs_forms_count": r["subs_forms_count"], "len": r["len"],
            "nomn": r["nomn"], "accs": r["accs"], "ablt": r["ablt"], "gent": r["gent"],
            "senses": " | ".join((work or role)[:3])[:150], "auto_flags": ",".join(flags),
            "hard": "1" if set(flags) & (HARD | {"negative_sense"}) else "0", "dim_of": r["dim_of"],
            "en_glosses": r["en_glosses"],
        })
    cols = list(rows[0])
    with open_out(os.path.join(DATA, "candidates", "profession.tsv")) as f:
        f.write("\t".join(cols) + "\n")
        for x in rows:
            f.write("\t".join(x[c] for c in cols) + "\n")
    ok = [x for x in rows if x["hard"] == "0"]
    print("professions:", len(rows), "clean:", len(ok), "clean ipm>=1:", sum(float(x["rnc_ipm"]) >= 1 for x in ok),
          "work:", sum(x["kind"].startswith("work") for x in ok), "role:", sum(x["kind"].startswith("role") for x in ok))


if __name__ == "__main__":
    main()
