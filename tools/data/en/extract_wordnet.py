"""Princeton WordNet 3.1 -> data/en/lexicon/wordnet.tsv: one row per (lemma, pos).

Columns: senses in WordNet order (most frequent first) with their lexicographer files
(noun.animal, noun.artifact, verb.motion...), verb frames ("Somebody ----s something" = 8),
hypernyms of every sense up to the root and the tagged-corpus count.

Run: python3 -I tools/data/en/extract_wordnet.py
"""
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, path, write  # noqa: E402

DICT = os.path.join(RAW, "wordnet", "dict")
POS = {"n": "noun", "v": "verb", "a": "adj", "s": "adj"}
FILES = {"noun": "data.noun", "verb": "data.verb", "adj": "data.adj"}


def lexnames():
    """Lexicographer file numbers (the 3.1 tarball has no lexnames file; the list is fixed)."""
    names = """adj.all adj.pert adv.all noun.Tops noun.act noun.animal noun.artifact noun.attribute
        noun.body noun.cognition noun.communication noun.event noun.feeling noun.food noun.group
        noun.location noun.motive noun.object noun.person noun.phenomenon noun.plant noun.possession
        noun.process noun.quantity noun.relation noun.shape noun.state noun.substance noun.time
        verb.body verb.change verb.cognition verb.communication verb.competition verb.consumption
        verb.contact verb.creation verb.emotion verb.motion verb.perception verb.possession
        verb.social verb.stative verb.weather adj.ppl""".split()
    return dict(enumerate(names))


def read_synsets(pos, names):
    """offset -> {lex, words, hyper (offsets), frames {word index or 0: set}}."""
    out = {}
    with open(os.path.join(DICT, FILES[pos]), encoding="latin-1") as f:
        for line in f:
            if line.startswith("  "):
                continue
            body = line.split(" | ")[0].split()
            off, lexnum, _, wcnt = body[0], int(body[1]), body[2], int(body[3], 16)
            words = [body[4 + 2 * i].lower() for i in range(wcnt)]
            i = 4 + 2 * wcnt
            pcnt = int(body[i])
            i += 1
            hyper = []
            for _ in range(pcnt):
                sym, target, _tpos = body[i], body[i + 1], body[i + 2]
                if sym in ("@", "@i"):
                    hyper.append(target)
                i += 4
            frames = collections.defaultdict(set)
            if pos == "verb" and i < len(body):
                fcnt = int(body[i])
                i += 1
                for _ in range(fcnt):
                    frames[int(body[i + 2], 16)].add(int(body[i + 1]))
                    i += 3
            out[off] = {"lex": names[lexnum], "words": words, "hyper": hyper, "frames": frames}
    return out


def chain(syn, off, depth=0, seen=None):
    """All hypernym ancestors' first lemmas (breadth over multiple inheritance)."""
    seen = seen if seen is not None else set()
    for h in syn[off]["hyper"]:
        if h not in seen and depth < 20:
            seen.add(h)
            chain(syn, h, depth + 1, seen)
    return seen


def main():
    names = lexnames()
    rows = []
    for pos in ("noun", "verb", "adj"):
        syn = read_synsets(pos, names)
        with open(os.path.join(DICT, f"index.{pos}"), encoding="latin-1") as f:
            for line in f:
                if line.startswith("  "):
                    continue
                p = line.split()
                lemma = p[0]
                if "_" in lemma or "-" in lemma or not lemma.isalpha():
                    continue
                scnt, pcnt = int(p[2]), int(p[3])
                tag = int(p[5 + pcnt])
                offs = p[6 + pcnt:6 + pcnt + scnt]
                lex, frames_first, frames_all, hyper = [], set(), set(), []
                for k, off in enumerate(offs):
                    s = syn[off]
                    lex.append(s["lex"])
                    idx = s["words"].index(lemma) + 1 if lemma in s["words"] else 0
                    fr = s["frames"].get(0, set()) | s["frames"].get(idx, set())
                    frames_all |= fr
                    if k == 0:
                        frames_first = fr
                    hyper.append("/".join(sorted({syn[h]["words"][0] for h in chain(syn, off)} | {s["words"][0]})))
                rows.append({
                    "lemma": lemma, "pos": pos, "senses": scnt, "tag_count": tag,
                    "lexnames": ",".join(lex),
                    "frames_first": ",".join(map(str, sorted(frames_first))),
                    "frames_all": ",".join(map(str, sorted(frames_all))),
                    "hypernyms": ";".join(hyper),
                })
    # Irregular forms (noun.exc, verb.exc): inflected -> base.
    exc = []
    for pos in ("noun", "verb", "adj"):
        with open(os.path.join(DICT, f"{pos}.exc"), encoding="latin-1") as f:
            for line in f:
                form, *bases = line.split()
                for b in bases:
                    exc.append({"pos": pos, "form": form, "base": b})
    write(path("lexicon", "wordnet.tsv"), rows,
          ["lemma", "pos", "senses", "tag_count", "lexnames", "frames_first", "frames_all", "hypernyms"])
    write(path("lexicon", "wordnet_exc.tsv"), exc, ["pos", "form", "base"])


if __name__ == "__main__":
    main()
