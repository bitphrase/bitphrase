# data/en/ — source data for the English dictionaries

**English** · [Русский](README.ru.md)

Everything here is needed only to **build** the English dictionaries. At run time the app
uses just the frozen word lists in `src/lang/en/dict.json`; the grammar that turns them into
sentences is `src/lang/en/grammar.ts`. The Russian data lives one level up, in [data/](../README.md).

Only `seed/` and this description are in git; the rest is downloaded or generated:

```sh
tools/data/en/fetch_raw.sh     # once: ~0.6 GB into data/en/raw/
tools/data/en/build_all.sh     # ~4 minutes: lexicon/, candidates/, dicts/, src/lang/en/dict.json
```

Plain `python3` is enough (no packages needed).

## raw/ — downloaded sources (don't edit)

| Folder | What it is | Size | Licence |
|---|---|---|---|
| `wiktionary_kaikki/` | English Wiktionary, English words (wiktextract, kaikki.org): parts of speech, inflected forms, per-sense tags (countable, transitive, vulgar, archaic, UK...), name and place categories | 0.5 GB gz | CC BY-SA 4.0 / GFDL |
| `wordnet/` | Princeton WordNet 3.1: senses in frequency order, lexicographer files (noun.animal, noun.artifact...), verb frames, hypernyms, irregular forms | 16 MB | WordNet licence (permissive) |
| `freq_opensubtitles/en_full.txt` | Word-form frequencies from OpenSubtitles 2018 (hermitdave/FrequencyWords) | 20 MB | CC BY-SA 4.0 |
| `names_ssa/` | US Social Security first names, top 1000 per year 1880–2008, by sex (hadley/data-baby-names; ssa.gov blocks scripted downloads) | 6 MB | public domain |
| `surnames_census/` | US Census 2010 surnames with rank and count | 13 MB | public domain |
| `geonames/` | GeoNames: cities over 15,000 people, countries | 3 MB | CC BY 4.0 |
| `cmudict/` | CMU Pronouncing Dictionary — decides "a" or "an" by the first sound (an hour, a unicorn) | 4 MB | BSD-style |

Concreteness ratings and dominant part of speech come from Brysbaert et al. (2014) in
`data/raw/concreteness_brysbaert/`, shared with the Russian pipeline.

## Derived tables

All TSV — UTF-8, TAB-separated, no quoting.

### lexicon/
- `wikt.jsonl.gz` (`extract_wiktionary.py`) — a compact Wiktionary subset: single-word nouns,
  verbs, adjectives and proper names; forms (plural; -s, -ing, past, past participle;
  comparative) without archaic/dialectal variants; per-sense tags, the name/place
  categories, the first gloss.
- `wordnet.tsv`, `wordnet_exc.tsv` (`extract_wordnet.py`) — per (lemma, pos): number of senses,
  tagged-corpus count, lexicographer file of every sense, verb frames of the first sense and
  of all senses (8 = "Somebody ----s something", 9 = "... somebody"), hypernym chains;
  irregular forms.
- `an.json` — word -> starts with a vowel sound (CMUdict).

### candidates/ (`build_candidates.py`) — everything, sorted by frequency, with `auto_flags`

`noun.tsv`, `verb.tsv`, `adj.tsv`: forms, frequency (OpenSubtitles, per million), concreteness,
dominant part of speech (`dom_pos`), WordNet class, "a/an", the first gloss.

| flag | meaning |
|---|---|
| offensive | vulgar / offensive / derogatory / slur / ethnic / pejorative / euphemistic in at least one sense |
| archaic, informal | every sense is obsolete/archaic/dated/rare/historical or slang/informal/dialectal |
| non_us | every sense is British/Commonwealth/Australian... only (spelling variants like "colour") |
| form_of_only | only "form of" / abbreviation senses |
| not_plain, too_short | not plain lowercase letters; shorter than 3 letters |
| not_in_wordnet, no_pronunciation | unknown to WordNet; no CMUdict entry ("a" or "an" can't be chosen) |
| no_plural, plural_same, mostly_uncountable, plural_only | nouns: no plural, sheep/sheep, mass nouns, scissors |
| homonym_proper | the noun is also a proper name (lee, vega) — dropped for people and animals |
| forms_missing, forms_coincide, past_variants, irregular_s | verbs: a form is missing; two forms coincide (put/put — tense can't be read off the word); dreamed/dreamt |
| predicative_only, comparative, participle_like, also_noun_or_verb | adjectives |

`name.tsv` — SSA first names since 1940 with gender, share and flags `unisex` (10–90 %),
`homonym_common` (Rose, Bill), `not_in_wiktionary`. `surname.tsv` — Census surnames
(top 30,000) with `homonym_common` (Brown, Young) and `homonym_name` (Thomas).
`place.tsv` — countries and cities over 300,000 people with a single-word ASCII name.

### dicts/ — what `gen_dicts.py` picked (for review)

One word per row, in dictionary order (earlier = more frequent).

## How the dictionaries are picked (`tools/data/en/gen_dicts.py`)

- **Every word form belongs to one dictionary only** — including possessives (Anna's -> annas).
  Taken first: function words (determiners, prepositions, modals, is/are/was/were), titles,
  catenatives (likes painting), verbs, then names, surnames, places, people and animals,
  things, adjectives. A form already taken is skipped. That keeps parsing unambiguous.
- **Verbs** — groups by what follows (`seed/verb_groups.tsv`): a thing, a person, "to someone",
  "with...", "about...", motion, place. The "what" group also gets frequent verbs whose first
  WordNet sense takes "something" and whose dominant part of speech is a verb. All four forms
  must differ.
- **Things** — first sense in noun.artifact/food/plant/object/body, concreteness ≥ 3.5, countable,
  with a plural. **People** — noun.person: professions by hypernym (worker, professional,
  artist...), the rest are roles (guest, passenger); negative, religious, national and
  political senses are left out. **Animals** — noun.animal with "animal" among the hypernyms.
- **Adjectives** — dominant part of speech "Adjective", concrete ones first.
- **Names** — the most popular since 1940, not unisex. **Surnames** — top Census ranks that are
  not common words. **Places** — countries and well-known cities; a homonym (Nice, Reading)
  only if it's a country (China, Turkey).
- `seed/stoplist.tsv` — words left out by hand (sexual anatomy, weapons, drugs, religion,
  violence).

Sizes now: adjectives 3911, first names 2048, surnames 8192, titles 42, professions 479,
roles 478, animals 115, things 2271, places 296, verbs 1315. That gives 27,486 templates
and enough capacity for 8 bytes in 7 words (83 bits; at least 80 are needed).
