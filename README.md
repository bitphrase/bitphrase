# Bitphrase

**English** · [Русский](README.ru.md)

Bitphrase turns card numbers, phone numbers, passwords, crypto seed phrases and wallet
addresses into funny, grammatical sentences that are easy to remember, and turns the
sentences back into the original value.

```
+7 912 345-67-89   →  Joshua computed Vernon's bouncy blindfold.
                   →  Ковалёвы кромсали израильскую сопку Поздеевых.
А123ВС 77          →  Deaver thwarts Kolby's eyeglass.
                   →  Покровитель расценивает ельцинские промежутки.
```

It runs entirely offline. You get it either as one self-contained HTML file that opens from
disk, or as an installable PWA. The page makes no network requests: its Content Security
Policy blocks them (`connect-src 'none'`).

> **The phrase is the secret.** Bitphrase is an encoding, not encryption. Anyone who knows
> the phrase and has Bitphrase can recover the value. It helps you *remember* a secret; it
> does not *protect* one.

## Features

- **Two phrase languages: English and Russian.** Each has its own dictionaries and grammar.
  On decoding, the language is detected from the letters of the phrase.
- **Grammatical sentences.** Verbs take the right objects and prepositions. Russian words
  carry the right case, gender and number; English gets agreement, a/an and possessives.
  The meaning may be absurd, but the grammar is always correct.
- **64–200 variants per sentence.** All variants decode to the same bytes, so you can pick
  the one you find easiest to remember.
- **A checksum in every sentence** (9.5–13.6 bits). A mistyped or swapped word is almost
  always caught.
- **Tolerant decoding.** Case, `ё`/`е`, punctuation and look-alike Latin/Cyrillic letters
  are ignored. A wrong grammatical form or a typo of one or two letters is corrected, and
  the page shows what it changed.
- **Word suggestions while typing**, ranked by what can grammatically come next.
- **Compact value formats.** Each value is packed into as few bytes as possible before
  encoding, so the phrase stays short (see below).

## Supported values

| Format | How it is packed | Example size |
|---|---|---|
| Bank card | Digits without the Luhn check digit (restored on decoding) | 16 digits → 7 bytes |
| Phone number | Digits with the country code; `8…` and 10-digit Russian numbers are normalized to `+7` | +7 912 345-67-89 → 5 bytes |
| Car plate (Russia) | Letters, digits and region as one number | А123ВС 77 → 4 bytes |
| Car plate (any) | As text | — |
| BIP39 seed | Entropy only; the checksum is recomputed | 12 words → 16 bytes, 24 → 32 |
| BIP39 words without checksum (Electrum etc.) | 11 bits per word | — |
| Monero seed | 24 words + checksum word → 32-byte key | 25 words → 32 bytes |
| Wallet address | Network number + key/hash; the address checksum is recomputed | Bitcoin, Ethereum → 21 bytes |
| Password / text | The narrowest alphabet that covers the text, length included | `Tiger!1984` → 9 bytes |
| HEX, Base64 | Raw bytes | up to 100 bytes |

Wallet networks: Bitcoin (P2PKH, P2SH, SegWit, Taproot), Ethereum and EVM chains, Tron,
Solana, Litecoin, Dogecoin, XRP and TON.

## Phrase length

Bytes are cut into 8-byte chunks. Each chunk becomes one 7-word sentence, and the remaining
1–7 bytes make a shorter final sentence:

| Bytes | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Words | 2 | 3 | 4 | 4 | 5 | 6 | 6 | 7 |

A phone number fits in 5 words, a card in 6, a 12-word BIP39 seed in 14 (two sentences), and
a 24-word seed or a 32-byte key in 28 (four sentences). The maximum input is 100 bytes.

## How it works

```
value ──format──▶ bytes ──codec──▶ sentences ──parser──▶ bytes ──format──▶ value
       (formats.ts)      (engine.ts + grammar)
```

There are three layers:

- `src/core/formats.ts` and `src/core/address.ts` turn a value into the shortest byte
  string and back.
- `src/core/engine.ts` is the codec. It knows nothing about any language: it handles
  numbering, mixing, checksums, variants and parsing.
- `src/lang/<code>/grammar.ts` supplies the templates. It renders a template's digits as
  words and says which digit values a given word form can stand for.

### 1. Packing values into bytes

- **Digit strings** (card, phone) are stored as the number `10^k + digits`. The leading `1`
  keeps both the length and any leading zeros.
- **Bank card.** The last digit is a Luhn check digit, so it is dropped and recomputed.
- **Russian car plate.** The 12 allowed letters, 3 digits and a 2–3-digit region form one
  mixed-radix number below 12·1000·12·12·1000, which fits in 4 bytes.
- **BIP39.** The 11-bit word indices are concatenated and the checksum bits are dropped, so
  only the entropy is stored. On decoding, the checksum is recomputed from SHA-256. Words
  can be given by their first 4 letters.
- **Monero.** The 24 data words are decoded into the 32-byte key with the Monero 3-words-per-4-bytes
  scheme. The 25th word, a CRC32 checksum, is verified and then recomputed.
- **Addresses.** One network byte plus the payload. Each network's own checksum is verified
  on input and recomputed on output: base58check, bech32/bech32m, EIP-55 letter case or
  CRC-16 (TON).
- **Text and passwords.** The narrowest alphabet that covers the text is chosen: printable
  ASCII (95 symbols, 6.6 bits/char), ASCII + Cyrillic (7.3 bits/char), or UTF-8 bytes. The
  symbols are written in **bijective base-N numeration**, where each digit is 1…N instead of
  0…N−1. That way the length is part of the number and no padding is needed. The alphabet
  number is the value mod 3.

### 2. Templates and capacity

A sentence is a sequence of slots. In both languages the general pattern is:

```
[WHO] [PREDICATE of verb group g] [OBJECT governed by g] [TAIL?]
```

- *WHO* can take many shapes: a name, an adjective plus a name, name + surname, name +
  patronymic (Russian), title + surname (English: *Doctor Garcia*), a profession, an
  animal, a role, a family (*the Petrovs*), and so on.
- *The predicate* is a verb, a modal + infinitive (*can paint*), or in English also a
  catenative + -ing (*likes painting*) or be + -ing.
- **Verb groups** decide what follows: a thing, a person, "to someone", "with…", "about…",
  motion ("to/past/from…") or place ("near/under…"). This is why the codec never produces
  "runs the water" or "reads the soup".
- For 1–3 words there are also nominal templates: *Purple boats.*, *Doctor Garcia.*

Every word is a **digit**, and the slot's dictionary size is its **radix**. Grammatical
choices are folded into the digit: the number of a noun, the tense of a verb, the gender of
a surname, the choice of preposition. A template's **capacity** `cap(t)` is the product of
its radices. The Russian grammar has 14,966 templates and the English one has 27,486.

### 3. Numbering phrases

All phrases of one length `w` are numbered consecutively, `P ∈ [0, S_w)`, where `S_w` is the
sum of `cap(t)` over all templates of that length. Each template owns a segment of this
range. So a template comes up with probability `cap(t)/S_w`: templates with more
combinations appear more often, and every possible sentence is equally likely.

When two byte counts share a word count (3 and 4 bytes both use 4 words, 6 and 7 bytes both
use 6), the range `[0, S_w)` is split between them. The smaller size gets a range exactly
for its needs and the larger one takes the rest. That is how the decoder knows how many
bytes a sentence holds.

For `r` bytes, `n` (their value) and a variant number `v` are encoded like this:

```
X = mix((n << vbits) | v)                    # a reversible permutation of 8r+vbits bits
P = base_r + X·K + (hash(n, v) mod K)        # log2 K bits of checksum
t = the template whose segment holds P       # binary search over segment starts
digits = mixed-radix digits of (P − start(t))
```

- **Mixing.** `mix` is an unbalanced 6-round **Feistel network**. Its round function is a
  64-bit hash (FNV-1a followed by the splitmix64 finalizer) keyed with the grammar's tag.
  Because of the mixing, values that differ by one digit give unrelated sentences, the
  variants of one value look different from each other, and templates are drawn evenly.
  The hash is not cryptographic, and it doesn't need to be: secrecy is not the goal.
- **Checksum.** `K` is whatever room is left in the range after the data and variant bits.
  It gives 9.5–13.6 bits per sentence, so a random wrong sentence passes with a chance of
  about 1 in 700 to 1 in 12,000. The checksum covers only the sentence's own bytes, so
  sentences are independent of each other.
- **Variants.** There are 7 variant bits (128 candidates, 64–100 shown) or 8 (256
  candidates, 64–200 shown). Each length gets the larger plan if the checksum can keep at
  least 10 bits. The number shown depends on the bytes, through a hash.
- **Round-trip check.** Before a variant is shown, it is parsed back strictly. A candidate
  that fails (for example, because two word forms coincide) is skipped.

### 4. Parsing

1. **Tokenize** the text into comparison keys: lowercase, `ё → е`, and in Russian, Latin
   look-alikes (`a, c, e, o, p, x…`) mapped to Cyrillic. Hyphens and apostrophes inside a
   word are kept (*Anna's*).
2. **Split into sentences.** Full stops are used if they are placed correctly (every
   sentence has 7 words except the last). Otherwise the text is cut every 7 words. The
   word count therefore fully determines the split, and a phrase typed without punctuation
   still decodes.
3. **Decode each sentence.** Look up every word in an index of all word forms. Each form
   maps to *(dictionary, word number, grammatical form)*. For every template of the right
   length whose slots fit the words, enumerate the possible digit combinations (capped at
   5,000). For each one, compute `P`, find the byte count from the range, run `unmix` and
   check the checksum.
4. **Strict pass, then lenient pass.** The strict pass accepts exact forms only. The lenient
   pass also accepts a wrong grammatical form (tense, number, case) and typos up to
   Levenshtein distance 2, each with a penalty. The candidate with the lowest penalty wins.
   If two different byte strings tie, the sentence is rejected instead of guessed.
   Corrections are reported word by word.
5. If a sentence still fails, unknown words are listed with spelling suggestions.

**Language detection** counts letters that exist only in Cyrillic or only in Latin and
ignores look-alike letters.

**Suggestions while typing.** All keys are sorted for prefix search. Candidates are ranked
first by whether their dictionary can occupy the next slot (given the words typed so far
in the sentence), then by frequency.

### 5. Dictionaries

The dictionaries are part of the format. Changing a word list, the template order or the
grammar's hash tag changes every phrase, and phrases written before the change stop
parsing. At run time the app reads only the frozen lists in `src/lang/ru/dict.json` and
`src/lang/en/dict.json`. The tools in `tools/data/` build these lists from open sources.

Principles:

- **One word form, one dictionary.** Within a language a form never belongs to two
  dictionaries. This keeps parsing unambiguous. Homonyms such as *Rose*, *Bill* or Russian
  *Вера* (a name and "faith") are dropped.
- **Names and places are separate dictionaries** and are never mixed with common nouns.
- **Verified forms (Russian).** Noun and verb paradigms come from OpenCorpora and are
  cross-checked against Wiktionary. Only forms confirmed by both sources are used.
  Adjectives are declined at run time by rules (`src/lang/ru/morph.ts`), which match the
  reference for 10,400 of 10,472 adjectives; `tests/morph.mjs` checks this.
- **Semantic classes.** RuWordNet and WordNet hypernyms supply the classes: professions,
  roles, animals, concrete objects.
- **Clean vocabulary.** Words that are offensive, archaic, slang, diminutive, sensitive
  (religion, politics, violence, drugs) or too rare are dropped, using automatic flags and
  hand-made stoplists.
- **Frequent words first.** In suggestions, an earlier word in a dictionary means a more
  common word.

Current sizes:

| | adj | name | surname | patronymic / title | profession | role | animal | object | place | verb |
|---|---|---|---|---|---|---|---|---|---|---|
| English | 3,911 | 2,048 | 8,192 | 42 titles | 479 | 478 | 115 | 2,271 | 296 | 1,315 |
| Russian | 2,255 | 382 | 708 | 186 | 447 | 140 | 224 | 8,233 | 151 | 760 |

Sources include OpenCorpora, Russian and English Wiktionary (kaikki.org), RuWordNet,
Princeton WordNet, the Russian National Corpus frequency dictionary, OpenSubtitles
frequencies, US SSA names, US Census surnames, GeoNames, CMUdict, Wikidata and the
Brysbaert concreteness ratings. See [data/README.md](data/README.md) (Russian) and
[data/en/README.md](data/en/README.md) (English) for licences and the pipeline.

## Getting started

Requirements: Node.js 22 or later. The browser tests also need Google Chrome or Chromium
(set `CHROME=/path/to/chrome` if it is not found automatically).

```sh
npm install
npm run build        # build/bitphrase.html and build/pages/ (the PWA)
open build/bitphrase.html
```

| Command | What it does |
|---|---|
| `npm run build` / `./build.sh` | Builds the single file and the PWA |
| `npm run watch` | Rebuilds on every change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Morphology, codec and format tests (Node), quick: ~30 s, a random sample of templates |
| `npm run test:full` | The same with every template and large random samples: several minutes |
| `npm run test:browser` | The page and the PWA in headless Chrome |
| `npm run check` | All of the above |
| `npm run icons` | Re-renders the PWA icons from `assets/icon.svg` |

### Build output

- `build/bitphrase.html`: one file with styles, dictionaries, wallet word lists and
  compiled TypeScript inlined. It opens from `file://` with no network access. The build
  fails if any external reference is left in it.
- `build/pages/`: the same page as a PWA, with a manifest, icons and a service worker.
  Once opened, it works offline. A new deploy installs alongside the running one and takes
  over when the user presses **Update** or closes all windows of the app.

The version lives only in `package.json`. A build that is not a release gets a commit
suffix, for example `0.1.0+1a2b3c4`.

### Rebuilding the dictionaries

You only need this if you change the word lists. The generated `dict.json` files are
committed, so a normal build doesn't need it. The raw sources are about 1 GB and are not in
git.

```sh
# Russian (needs a venv with pymorphy3, see data/README.md)
tools/data/build_all.sh

# English (plain python3)
tools/data/en/fetch_raw.sh
tools/data/en/build_all.sh
```

## Project layout

```
src/core/       engine.ts (codec), formats.ts, address.ts, hash.ts (SHA-256, CRC32), i18n
src/lang/       ru/ and en/: grammar.ts + dict.json; ru/morph.ts (adjective declension)
src/app/        the page: template.html, main.ts, tokens.ts (word-chip input), update.ts, styles
src/pwa/        service worker
tests/          Node tests and headless-Chrome tests (no puppeteer, DevTools protocol)
tools/data/     dictionary pipeline (Python)
data/           sources and derived tables (in git: READMEs, seed lists, two test references)
assets/         icon and PWA icons
.github/        CI: tests, GitHub Pages deploy, releases on v* tags
```

## Releases

`npm version x.y.z` updates `package.json` and creates the tag. Pushing a `v*` tag runs the
release workflow. It checks that the tag matches `package.json`, runs all the tests (including `test:full`), and
publishes `bitphrase-vX.Y.Z.html` together with `SHA256SUMS.txt`. Every push to `main` also
deploys the PWA to GitHub Pages.

## License

[MIT](LICENSE). The dictionary data comes from third-party sources with their own licences
(CC BY-SA, CC0, public domain and others); see the data READMEs.
