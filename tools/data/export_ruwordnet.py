"""RuWordNet 2021 thesaurus -> per-sense TSV for single-word candidate lemmas.

For each sense: synset, definition, synonyms (single-word), hypernym chain
up to the root, link to Princeton WordNet (lexicographer file —
a coarse semantic class: noun.animal, noun.artifact, verb.contact, ...),
English WordNet lemmas and their concreteness per Brysbaert et al. (2014) norms.

Output: data/lexicon/ruwordnet_senses.tsv
Run: python3 -I tools/data/export_ruwordnet.py
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BRYSBAERT, DATA, RUWORDNET_DB, load_rnc, norm, open_out  # noqa: E402

POS = {"N": "noun", "Adj": "adj", "V": "verb"}

# WordNet 3.0 lexicographer files (number from the sense key: lemma%ss_type:lex_filenum:...)
LEXNAMES = (
    "adj.all adj.pert adv.all noun.Tops noun.act noun.animal noun.artifact noun.attribute noun.body "
    "noun.cognition noun.communication noun.event noun.feeling noun.food noun.group noun.location "
    "noun.motive noun.object noun.person noun.phenomenon noun.plant noun.possession noun.process "
    "noun.quantity noun.relation noun.shape noun.state noun.substance noun.time verb.body verb.change "
    "verb.cognition verb.communication verb.competition verb.consumption verb.contact verb.creation "
    "verb.emotion verb.motion verb.perception verb.possession verb.social verb.stative verb.weather adj.ppl"
).split()


def load_brysbaert():
    out = {}
    with open(BRYSBAERT, encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            out[p[0].lower()] = float(p[2])
    return out


def main():
    rnc = load_rnc()
    conc = load_brysbaert()
    db = sqlite3.connect(RUWORDNET_DB)
    c = db.cursor()
    synsets = {r[0]: (r[1], r[2], r[3]) for r in c.execute("select id, title, definition, part_of_speech from synset")}
    members = {}
    for sid, name in c.execute("select synset_id, name from sense"):
        members.setdefault(sid, []).append(name.lower())
    hyper = {}
    for hypo, hyp in c.execute("select hyponym_id, hypernym_id from hypernym_relation"):
        hyper.setdefault(hypo, []).append(hyp)
    ili = {}
    for ru, wn in c.execute("select ruwn_id, wn_id from interlingual_index_relation"):
        ili.setdefault(ru, []).append(wn)
    wn_words, wn_lex = {}, {}
    for key, name, sid in c.execute('select "key", name, synset_id from wn_sense'):
        wn_words.setdefault(sid, []).append(name)
        try:
            wn_lex[sid] = LEXNAMES[int(key.split("%")[1].split(":")[1])]
        except (IndexError, ValueError):
            pass

    def chain(sid):
        out, cur, seen = [], sid, {sid}
        while cur in hyper and len(out) < 20:
            cur = sorted(hyper[cur])[0]
            if cur in seen:
                break
            seen.add(cur)
            out.append(synsets[cur][0])
        return out

    cols = ["lemma", "pos", "synset_id", "synset_title", "definition", "synonyms", "hypernyms_direct",
            "hypernym_chain", "wn_ids", "wn_lexname", "en_words", "en_concreteness"]
    n = 0
    with open_out(os.path.join(DATA, "lexicon", "ruwordnet_senses.tsv")) as out:
        out.write("\t".join(cols) + "\n")
        for sid, name, lemma in c.execute("select synset_id, name, lemma from sense order by lemma"):
            if " " in name or "-" in name:
                continue
            title, definition, sp = synsets[sid]
            pos = POS.get(sp)
            lemma = name.lower()
            if pos is None or (norm(lemma), pos) not in rnc:
                continue
            syn = sorted({w for w in members.get(sid, []) if w != lemma and " " not in w})
            wns = ili.get(sid, [])
            en = sorted({w for wid in wns for w in wn_words.get(wid, [])})
            scores = [conc[w.lower()] for w in en if w.lower() in conc]
            lex = sorted({wn_lex[w] for w in wns if w in wn_lex})
            row = [lemma, pos, sid, title, (definition or "").replace("\t", " ").replace("\n", " "),
                   ",".join(syn), " | ".join(synsets[h][0] for h in sorted(hyper.get(sid, []))),
                   " > ".join(chain(sid)), ",".join(wns), ",".join(lex), ",".join(en),
                   f"{sum(scores) / len(scores):.2f}" if scores else ""]
            out.write("\t".join(row) + "\n")
            n += 1
    print("senses written:", n)


if __name__ == "__main__":
    main()
