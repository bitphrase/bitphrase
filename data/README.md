# data/ — source data for the bitphrase dictionaries

**English** · [Русский](README.ru.md)

This folder holds the source data for the **Russian** dictionaries. The data and
documentation for the English dictionaries are in `data/en/` (see
[data/en/README.md](en/README.md)).

Everything here is needed only at dictionary **build** time. Only the final frozen word
lists with their forms make it into the runtime — the app dictionary `src/lang/ru/dict.json`,
which is read by the codec (`src/core/engine.ts` + `src/lang/ru/grammar.ts`).

Rebuild everything derived (except `raw/`): `tools/data/build_all.sh`.

## raw/ — downloaded sources (do not edit)

| Folder | What it is | Size | License |
|---|---|---|---|
| `freq_rnc2011/` | Lyashevskaya, Sharoff. Frequency dictionary of modern Russian (Russian National Corpus, 92M tokens), 52,138 lemmas with part of speech, ipm, range, D. Source: http://dict.ruslang.ru/freq.php | 2 MB | © the authors; cite the publication when using it (see `x/freqrnc_readme.txt`) |
| `freq_opensubtitles/` | Frequencies of 50k word forms from OpenSubtitles 2018 (hermitdave/FrequencyWords) — "spoken" frequency | 1 MB | CC BY-SA 4.0 |
| `opencorpora_pymorphy3/` | OpenCorpora morphological dictionary rev. 417150 (391,778 lexemes, 5.1M forms) as shipped in `pymorphy3-dicts-ru`, plus `pymorphy3` wheels to read it. The opencorpora.org site no longer serves the XML dump | 8 MB | CC BY-SA 3.0 (OpenCorpora data), MIT (pymorphy3) |
| `ruwiktionary_kaikki/` | Russian Wiktionary, Russian words (wiktextract, kaikki.org): stressed forms, Zaliznyak inflection class, synonyms, hypernyms, diminutives, metagrams | 170 MB gz | CC BY-SA 4.0 / GFDL |
| `wiktionary_kaikki/` | English Wiktionary, Russian words (kaikki.org): stressed forms, English translations, labels (vulgar, archaic, diminutive...) | 87 MB gz | CC BY-SA 4.0 / GFDL |
| `surnames_hunspell/` | greenx/hunspell-ru-surnames: ~100k surnames sorted by prevalence (sample of 2.6M people; no counts, rank only; ё is lost) | 2 MB | LGPL-3.0 |
| `wikidata_brands/` | Wikidata SPARQL (`tools/data/fetch_wikidata_brands.sh`): companies and brands of 16 classes with ≥15 Wikipedia articles, Russian labels and aliases | 2 MB | CC0 |
| `freq_opensubtitles/ru_full.txt` | full subtitle frequency list (1.4M word forms) — familiarity of rare words (Тойота, Айфон) | 29 MB | CC BY-SA 4.0 |
| `ruwordnet/` | RuWordNet 2021 thesaurus (SQLite from the `ruwordnet` package): synsets, hypernyms, links to Princeton WordNet | 96 MB | CC BY-SA 4.0 (per ruwordnet.ru) |
| `concreteness_brysbaert/` | Brysbaert, Warriner, Kuperman (2014) — concreteness of 40k English words (1–5). Used via English translations | 2 MB | free for research |

## Derived tables

All TSVs are UTF-8, TAB-separated, unquoted. Form variants are separated by `/`
(the first is the primary one). Stress is marked with U+0301 (strip it before comparing).

### morph/ — full paradigms and their cross-check
- `oc_{noun,adj,verb}.tsv` — all OpenCorpora lexemes whose lemma is in the RNC frequency list
  (21,528 nouns, 10,590 adjectives, 12,513 verbs). Homonyms get separate rows
  (лев the animal / Лев the name / лев the currency). Cell columns: `sing:nomn … plur:loct`,
  `gen2/loc2/voct`; for adjectives `masc|neut|femn|plur × case`, accusative
  `:anim/:inan`, short forms, comparative; for verbs the infinitive, present/future
  tense by person, past, imperative, adverbial participles (gerunds), participles.
  OpenCorpora tags (`oc_grammemes`): anim/inan, gender, Fixd (indeclinable),
  Pltm/Sgtm, ms-f (common gender), Name/Surn/Geox (proper names), Infr/Slng/Arch/Obsc, perf/impf, tran/intr…
- `oc_name.tsv` (given names, tag Name, 1,556 lexemes) and `oc_place.tsv` (place names,
  Geox, 1,282) — **two separate dictionaries, never mixed** with each other or with `oc_noun`.
  Surnames, patronymics and organizations are not taken. Criterion: the lemma is among the RNC
  proper nouns, or is in an English Wiktionary category of its kind (names / cities, countries,
  rivers...), or its nominative occurs in subtitles ≥ 30 times (here `subs_forms_count` is the
  frequency of the nominative only).
- `oc_missing_from_rnc.tsv` — RNC lemmas with no OpenCorpora lexeme (mostly superlatives and substantivized adjectives).
- `wikt_{noun,adj,verb,prop}.tsv` — the same columns from Wiktionary (`source` = ru|en), with
  stress and Zaliznyak class (`wikt_class`). `prop` holds given names and place names in one
  file, as in the source: Wiktionary doesn't separate them; they are split into name/place
  during the cross-check.
- `verified_{noun,adj,verb}.tsv` — **the reference**: the OpenCorpora paradigm cross-checked
  against Wiktionary. A cell like `слоно́м` is confirmed (stressed); `?form` — OpenCorpora only;
  `!oc|wikt` — mismatch. `core_ok=1` — every cell the template needs is confirmed
  (nouns: nom/gen/acc/ins singular, nom/gen plural; adjectives: all cases; verbs: infinitive,
  3rd person singular/plural).
  Confirmed: nouns 21,152 / 21,528, adjectives 9,710 / 10,590, verbs 12,389 / 12,513,
  given names 614 / 1,556, place names 934 / 1,282 (the rest mostly have no Wiktionary
  entry — foreign names from subtitles and minor places).
- `crosscheck_conflicts_{pos}.tsv` — all mismatches for manual review
  (most often animacy in the accusative, variants like «стелит/стелет», ё/е).

### Surnames — a separate dictionary (`tools/data/build_surnames.py`)
- `morph/oc_surname.tsv` — top 20,000 surnames by prevalence; 5,857 have an OpenCorpora
  lexeme: forms `masc|femn|plur × case` (ё restored: Семёнов, Фёдоров). `type`:
  `ov_in` (-ов/-ев/-ин/-ын), `adj` (-ский/-ой/-ый), `cons` (ending in a consonant), `other` (indeclinable).
  `rule_ok` — agreement with the surname declension rules (a prototype of the TS code): ov_in 5,043 / 5,078,
  adj 337 / 339, cons 418 / 423. Mismatches are surnames that OpenCorpora declines as
  foreign (Синицин, Зайкин: instrumental "-ом", indeclinable feminine) — these are excluded.
- `candidates/surname.tsv` — `display`, `rank`, `type`, masculine/feminine forms nom/gen/acc/ins, `auto_flags`:

| flag | meaning |
|---|---|
| rule_mismatch | OpenCorpora disagrees with the rules (hard) |
| indeclinable, femn_indeclinable | Белых, Шевченко; Шевчук/Ким (feminine form doesn't decline) — hard |
| famous_person | frequent in RNC texts despite modest prevalence: Пушкин, Брежнев — hard |
| homonym_common | coincides with a common noun/adjective: Мороз (frost), Жук (beetle), Калашников, Белый (white) — hard |
| homonym_name, homonym_place | Королёв, Михайлов — soft (different slots, so no confusion for the decoder) |
| not_in_opencorpora / forms_by_rule | not in OpenCorpora; forms from the verified rules (ov_in, adj) |
| oc_incomplete | OpenCorpora lacks feminine forms (Кротов) — taken from the rules |

  Clean (no hard flags): 913 in the top 1000, 1,836 in the top 2048, 3,591 in the top 4096, 6,975 in the top 8192.

### Professions, brands, patronymics — separate dictionaries
- `candidates/profession.tsv` (`build_professions.py`) — animate nouns with a sense that
  sits in RuWordNet under РАБОТНИК (worker) / ЧЕЛОВЕК ПО СФЕРЕ ДЕЯТЕЛЬНОСТИ (person by field of
  activity) / ВОЕННОСЛУЖАЩИЙ (serviceman) / СПЕЦИАЛИСТ (specialist) / РУКОВОДИТЕЛЬ (manager) …
  (`kind=work`) or ЧЕЛОВЕК ПО РОЛИ (person by role) (`role`: пассажир "passenger", гость "guest").
  Forms come from the verified noun paradigms. Flags: `negative_sense` (every sense is
  criminal/nonentity; hard), `some_negative_sense`, `has_non_person_sense`
  (папа "dad/pope", модель "model"), `sensitive` (religion, politics, monarchs: президент, патриарх, фюрер).
  Usable (ipm ≥ 1, not sensitive): 705 (608 masculine, 97 feminine).
- `candidates/brand.tsv` (`build_brands.py`) — `source=seed`: the hand-made list
  `data/seed/brands_seed.tsv` (147 brands in Cyrillic: Тойота, Самсунг, Айфон, Сникерс…;
  Wikidata usually has them in Latin script); `source=wikidata` — 690+ candidates flagged
  `not_curated` (lots of junk: Геринг, Шорт, Ново — manual review only). Declension:
  OpenCorpora or rules (`forms_by_rule`); `suspicious_oc_form` — OpenCorpora errors
  (Дайсном, Опель as feminine). `homonym_*` flags on brands are soft (мерседес, ксерокс have
  themselves become common nouns), but such words must not also end up in the noun dictionary;
  `sensitive` — alcohol, tobacco, state-owned companies, social networks. Of the seed list,
  141 are usable by form, 102 declinable.
- `candidates/patronymic.tsv` (`build_patronymics.py`) — OpenCorpora lexemes tagged Patr; the
  familiar variant is taken (Михайлович, not the bookish «Михаилович»), the feminine form by rule
  (Ивановна), `base_name` — the underlying given name. Cases are checked against the rules; -ич
  (Ильич → Ильинична, Фомич, Кузьмич) are exceptions. Popular and clean: 60; derived from
  "clean" given names: 193.

### lexicon/ — semantics and thesaurus
- `wikt_ru_subset.jsonl.gz`, `wikt_en_subset.jsonl.gz` — compact extracts of the Wiktionaries for the candidate lemmas.
- `ruwordnet_senses.tsv` — senses of single-word lemmas: synset, definition, synonyms,
  hypernym chain, WordNet class (`noun.animal`, `noun.artifact`, `verb.contact`…),
  English lemmas and their concreteness (Brysbaert).
- `conflict_pairs_{pos}.tsv` — pairs that must not share a dictionary:
  `synonym:*` (RuWordNet / Russian / English Wiktionary), `hypernym:ruwikt`,
  `edit1` (differ by one letter), `dim` (diminutive),
  and for given names `hypocorism` (Мария — Маша — Маня); there is also `conflict_pairs_surname.tsv`.

### candidates/ — summary tables for selection (by descending frequency)
`{noun,adj,verb}.tsv`: frequencies (RNC ipm, range, subtitles), stressed forms,
morphological features, semantic class, concreteness, synonyms, metagrams,
translations, definition and `auto_flags` — reasons for automatic exclusion:

| flag | meaning |
|---|---|
| proper, abbr | proper noun / abbreviation |
| obscene_or_pejorative | obscene/abusive/vulgar (ru), vulgar/derogatory (en), Obsc (OC) — in at least one sense |
| archaic, informal | every sense is archaic/historical, or colloquial/slang/vernacular/regional |
| diminutive_or_aug | diminutive/augmentative of another word (`dim_of`) |
| pluralia_tantum, common_gender, substantivized_adj | ножницы (scissors); сирота (orphan); столовая (canteen) |
| ablt_cluster | instrumental starts with a consonant cluster (льдом, львом) — check «подо/надо» |
| possessive, pronominal_or_numeral, ne_prefix, participle_like, nonstandard_lemma | for adjectives |
| not_imperfective, intransitive, reflexive, impersonal | for verbs |
| forms_unverified | core forms not confirmed by a second source |
| not_plain_cyrillic | hyphen, space, etc. |

`name.tsv` (given names) and `place.tsv` (place names) are two separate dictionaries.
Shared columns: `display` (capitalized), gender, forms, frequencies. Only in `name.tsv`: `name_form`
(full/short), `name_origin`, `hypocorisms`; only in `place.tsv`: `place_type` (city,
capital, country, river, lake, sea, mountain, island, region...), `where` (the city's country). Flags:

| flag | meaning |
|---|---|
| unisex_name | Саша, Женя — gender is ambiguous |
| not_russian_given_name | not in "Russian given names" (Том, Джейн from subtitles) |
| homonym_common | coincides with a common noun (Роза "rose", Вера "faith", Лев "lion", Орёл "eagle") |
| homonym_name_place | the word is in both dictionaries: Лена (name and river), Юра |
| indeclinable, pluralia_tantum | Сочи, Осло; Афины, Альпы |
| toponym_ov_in | Пушкин, Александров (instrumental in -ом, homonymous with surnames) |
| place_type_unknown | no place category in Wiktionary |
| country_or_region | soft: country/region — check for political connotations |

After hard flags: ~400 given names (~270 frequent) and ~680 place names (~290 frequent).

Pool size after hard flags (length 3–10, ipm ≥ 1): ~5,800 concrete
nouns (~1,550 of them animate), ~3,500 adjectives,
~1,400 transitive imperfective verbs (~680 "physical" per WordNet). Before manual cleanup.

### exceptions/ — where the rules fail
- `adj_rule_mismatches.tsv` — a run of the adjective declension rules (now in
  `src/lang/ru/morph.ts`) over all adjectives: 10,400 of 10,472 matched exactly; every mismatch
  is a possessive (божий, лисий…) or one of 1–2 junk lemmas.

## How to rebuild
```sh
python3 -m venv .venv
.venv/bin/pip install --no-index --find-links data/raw/opencorpora_pymorphy3 pymorphy3 pymorphy3-dicts-ru
tools/data/build_all.sh            # ~3 minutes
```
