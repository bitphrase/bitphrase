/**
 * The codec (src/core/engine.ts with the grammars in src/lang/): 1 to 100 bytes <-> sentences
 * from generalized templates; every 8 bytes — 7 words, the remainder — a shorter sentence.
 * Every check runs for each phrase language.
 *
 * Templates (each is rendered and strictly parsed back); every scheme for 1–8 bytes
 * (length, variants, every variant gives the same bytes); random lengths 1–100 with and
 * without full stops; independent sentences; tolerance (case, letter variants, punctuation,
 * a typo); false acceptance when a word is swapped; errors; telling the language apart.
 *
 * By default a quick run: a random sample of templates and fewer random values. `--full`
 * (npm run test:full) checks every template three times and many more values; it takes minutes.
 * Encoding is the slow part (every variant is parsed back), parsing is cheap — so the typo
 * and swapped-word checks take all variants of a few encoded values.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { checker, load } from '../tools/load.mjs';

const FULL = process.argv.includes('--full');
/** Sample size: quick run or --full. */
const N = (quick, full) => (FULL ? full : quick);

const L = await load('lang/index');
const versions = { ru: (await load('lang/ru/grammar')).DICT_VERSION, en: (await load('lang/en/grammar')).DICT_VERSION };
const { check, done } = checker();
const hex = (b) => Buffer.from(b).toString('hex');
const same = (r, bytes) => r.ok && hex(r.bytes) === hex(bytes);
const words = (s) => s.replace(/\.$/, '').split(' ');

/** What differs between the languages in these tests. */
const LANGS = {
  ru: {
    version: '3-draft-2',
    // Case, ё -> е, line breaks instead of full stops; Latin look-alikes instead of Cyrillic.
    loosen: (p) => p.toUpperCase().replaceAll('Ё', 'Е').replace(/\./g, '\n'),
    lookalikes: (p) => p.replace(/о/g, 'o').replace(/а/g, 'a'),
    typo: (w) => w.slice(0, 2) + (w[2] === 'ж' ? 'з' : 'ж') + w.slice(3),
    unknown: 'абырвалг',
    filler: 'лодка',
  },
  en: {
    version: 'en-1-draft-1',
    loosen: (p) => p.toUpperCase().replace(/\./g, '\n'),
    lookalikes: (p) => p.replace(/o/g, 'о').replace(/a/g, 'а'),
    typo: (w) => w.slice(0, 2) + (w[2] === 'x' ? 'z' : 'x') + w.slice(3),
    unknown: 'abyrvalg',
    filler: 'boat',
  },
};

for (const [lang, T] of Object.entries(LANGS)) {
  const C = L.codec(lang);
  const info = C.summary();
  console.log(`  [${lang}] ${info.templates} templates; schemes:`);
  for (const s of info.schemes) console.log(`    ${s.bytes} B -> ${s.words} w., variants ${s.variants}, checksum ${s.checkBits.toFixed(1)} bits`);
  check(`${lang}: words for 1…8 bytes`, info.schemes.map((s) => s.words), [2, 3, 4, 4, 5, 6, 6, 7]);
  check(`${lang}: checksum of 9+ bits for every size`, info.schemes.every((s) => s.checkBits >= 9), true);
  check(`${lang}: 128 or 256 variants for every size`, info.schemes.every((s) => s.variants === 128 || s.variants === 256), true);

  // --- templates: random digits -> words -> strict parsing finds the same digits
  const templates = FULL ? C.TEMPLATES : Array.from({ length: 500 }, () => C.TEMPLATES[randomInt(C.TEMPLATES.length)]);
  const perTemplate = N(1, 3);
  let badWords = 0;
  let badRecover = 0;
  const sample = [];
  for (const t of templates) {
    for (let k = 0; k < perTemplate; k += 1) {
      const digits = t.slots.map((s) => randomInt(s.radix));
      if (C._internal.renderWords(t, digits).length !== t.words) badWords += 1;
      if (!C._internal.recoverable(t, digits)) {
        badRecover += 1;
        if (sample.length < 5) sample.push(`${C.describeTemplate(t, C.SCHEMES[1]).pattern}: ${C._internal.renderWords(t, digits).join(' ')}`);
      }
    }
  }
  if (sample.length) console.log(`  not recoverable, e.g.:\n    ${sample.join('\n    ')}`);
  const which = FULL ? `${perTemplate} x all templates` : `${templates.length} random templates`;
  check(`${lang}: every template has as many words as digits (${which})`, badWords, 0);
  check(`${lang}: the digits of every template are recovered from its words (${which})`, badRecover, 0);

  // --- every scheme: length, variants, all variants give the same bytes
  for (let r = 1; r <= 8; r += 1) {
    const s = info.schemes[r - 1];
    let okAll = 0;
    let distinct = 0;
    let lengthOk = 0;
    const counts = [];
    const runs = r <= 2 ? N(10, 40) : N(4, 15);
    for (let i = 0; i < runs; i += 1) {
      const bytes = randomBytes(r);
      const { variants } = C.encode(bytes);
      const list = variants[0];
      counts.push(list.length);
      if (new Set(list.map((v) => v.text)).size === list.length) distinct += 1;
      if (list.every((v) => words(v.text).length === s.words)) lengthOk += 1;
      if (list.every((v) => same(C.decode(v.text), bytes))) okAll += 1;
    }
    check(`${lang} ${r} B: ${s.words} w. in every variant`, lengthOk, runs);
    // All variant numbers are shown; only a rare one that fails the round-trip check is dropped.
    check(`${lang} ${r} B: ${s.variants} variants (a few may be dropped)`, counts.every((n) => n <= s.variants && n >= s.variants * 0.9), true);
    check(`${lang} ${r} B: variants don't repeat`, distinct, runs);
    check(`${lang} ${r} B: every variant parses into the same bytes`, okAll, runs);
  }
  check(`${lang}: edge values`, [new Uint8Array(1), new Uint8Array(8).fill(255), new Uint8Array(13).fill(7)].map((b) => same(C.decode(C.encode(b).sentences.join(' ')), b)), [true, true, true]);
  check(`${lang}: 1 byte — all 256 values parse`, Array.from({ length: 256 }, (_, i) => same(C.decode(C.encode(Uint8Array.of(i)).sentences[0]), Uint8Array.of(i))).every(Boolean), true);

  // --- random lengths 1–100, with and without full stops
  const lengths = N(10, 150);
  let ok = 0;
  let okNoDots = 0;
  for (let i = 0; i < lengths; i += 1) {
    const bytes = randomBytes(1 + randomInt(100));
    const { sentences, bytes: sizes } = C.encode(bytes);
    if (sentences.length !== Math.ceil(bytes.length / 8) || sizes.slice(0, -1).some((n) => n !== 8)) continue;
    ok += same(C.decode(sentences.join(' ')), bytes);
    okNoDots += same(C.decode(sentences.join(' ').replace(/\./g, '')), bytes);
  }
  check(`${lang}: 1–100 bytes with full stops (${lengths} random)`, ok, lengths);
  check(`${lang}: 1–100 bytes without full stops — split by 7 words`, okNoDots, lengths);
  const mixed = C.encode(randomBytes(19));
  check(`${lang}: different variants in different sentences`, same(C.decode(mixed.variants.map((l, i) => l[Math.min(l.length - 1, 5 * i + 3)].text).join(' ')), C.decode(mixed.sentences.join(' ')).bytes), true);

  // Sentences are independent: two full sentences in reverse order — the same chunks reversed.
  const a = randomBytes(8);
  const b = randomBytes(8);
  const swapped = C.decode(`${C.encode(b).sentences[0]} ${C.encode(a).sentences[0]}`);
  check(`${lang}: sentences are independent: chunks can be put together from separate phrases`, same(swapped, Buffer.concat([b, a])), true);
  check(`${lang}: a short sentence only comes last`, C.decode(`${C.encode(randomBytes(3)).sentences[0]} ${C.encode(a).sentences[0]}`).ok, false);

  // --- tolerance
  const sample19 = randomBytes(19);
  const phrase = C.encode(sample19).sentences.join(' ');
  check(`${lang}: case, letter variants, line breaks`, same(C.decode(T.loosen(phrase)), sample19), true);
  check(`${lang}: extra punctuation`, same(C.decode(phrase.replace(/ /g, ', ')), sample19), true);
  check(`${lang}: look-alike letters of the other alphabet`, same(C.decode(T.lookalikes(phrase)), sample19), true);
  if (lang === 'en') check('en: a possessive without the apostrophe', same(C.decode(phrase.replace(/'/g, '')), sample19), true);

  /** [bytes, words] for the first perValue variants of `values` random r-byte values. */
  const variantSentences = (r, values, perValue = Infinity) =>
    Array.from({ length: values }, () => {
      const bytes = randomBytes(r);
      return C.encode(bytes).variants[0].slice(0, perValue).map((v) => [bytes, words(v.text)]);
    }).flat();

  let typoFixed = 0;
  let typoTried = 0;
  for (const [bytes, w] of variantSentences(8, N(4, 20), 15)) {
    const j = w.findLastIndex((x, k) => k > 0 && x.length > 4 && !x.includes("'"));
    if (j < 0) continue;
    w[j] = T.typo(w[j]);
    typoTried += 1;
    if (same(C.decode(w.join(' ')), bytes)) typoFixed += 1;
  }
  console.log(`  [${lang}] a typo in a word (8 bytes): recovered ${typoFixed} of ${typoTried}`);
  check(`${lang}: a one-letter typo is mostly recovered (≥ 85%)`, typoFixed / typoTried >= 0.85, true);

  // A word swapped for another real word: falsely accepted — by size.
  const pool = C.encode(randomBytes(100)).sentences.flatMap(words).map((x) => x.toLowerCase());
  for (const r of [1, 2, 3, 8]) {
    let wrong = 0;
    let tried = 0;
    // ~1500 tries even in the quick run: at a rate of ~0.5% fewer would make the < 1% check flaky.
    for (const [bytes, w] of variantSentences(r, N(12, 40))) {
      const j = randomInt(w.length);
      const other = pool[randomInt(pool.length)];
      if (other === w[j].toLowerCase()) continue;
      w[j] = other;
      tried += 1;
      const d = C.decode(w.join(' '));
      if (d.ok && hex(d.bytes) !== hex(bytes)) wrong += 1;
    }
    console.log(`  [${lang}] swapped word, ${r} B: falsely accepted ${wrong} of ${tried} (${((100 * wrong) / tried).toFixed(2)}%)`);
    check(`${lang} ${r} B: a swapped word is almost never accepted (< 1%)`, wrong / tried < 0.01, true);
  }

  // --- errors
  check(`${lang}: empty`, C.decode('  ...  ').errors?.[0]?.kind, 'empty');
  const unknown = C.decode(phrase.replace(/^\S+/, T.unknown)).errors?.[0];
  check(`${lang}: an unknown word is named`, [unknown?.kind, unknown?.position, unknown?.word], ['unknown', 0, T.unknown]);
  check(`${lang}: too long`, C.decode(Array(C.MAX_TOTAL_WORDS + 1).fill(T.filler).join(' ')).errors?.[0]?.kind, 'length');
  for (const n of [0, 101]) {
    let threw = false;
    try {
      C.encode(new Uint8Array(n));
    } catch {
      threw = true;
    }
    check(`${lang}: ${n} bytes — an error`, threw, true);
  }
  check(`${lang}: dictionary version`, versions[lang], T.version);
  console.log(`  [${lang}] variants rejected by the round-trip check: ${C._internal.rejected()}`);
}

// --- telling the languages apart
const ru = L.codec('ru').encode(randomBytes(16)).sentences.join(' ');
const en = L.codec('en').encode(randomBytes(16)).sentences.join(' ');
check('a Russian phrase is detected as Russian', L.detectLang(ru, 'en'), 'ru');
check('an English phrase is detected as English', L.detectLang(en, 'ru'), 'en');
check('no telling letters — the fallback', [L.detectLang('', 'en'), L.detectLang('...', 'ru')], ['en', 'ru']);
check('a Russian phrase does not parse as English', L.codec('en').decode(ru).ok, false);
check('an English phrase does not parse as Russian', L.codec('ru').decode(en).ok, false);

done('codec');
