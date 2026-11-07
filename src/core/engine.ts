/**
 * Language-independent codec: bytes (1 to 100) <-> sentences built from a grammar's templates.
 * A grammar (src/lang/<code>/grammar.ts) supplies the templates, renders a template's
 * digits as words and tells which digit values a word form can stand for; everything
 * else — schemes, mixing, checksums, variants, parsing and suggestions — lives here.
 *
 * Bytes are cut into chunks of 8: every full chunk is a sentence of maxWords words; the
 * remainder (1–7 bytes) is the last, shorter sentence (WORDS_FOR_BYTES). Sentences are
 * independent: each has its own checksum. The number of words (and the share of numbers
 * when two sizes share a length) tells how many bytes a sentence holds, so a phrase
 * without full stops still splits unambiguously into maxWords-word sentences.
 *
 * Capacity-proportional distribution. Every word of a template is a digit (tense, number,
 * gender or choice of preposition are folded into the word's digit); the template's
 * capacity cap(t) is the product of its radices. Phrases of one length are numbered
 * consecutively: P ∈ [0, S_w), each template owns a segment, so a template comes up with
 * probability cap(t)/S_w. For r bytes, the bytes and a variant number (v bits) go through
 * a reversible mix (a Feistel network) giving X < 2^(8r+v), and P = base + X·K + h with
 * h = hash mod K — log2 K bits of checksum. 128 variants or, where the words have room,
 * 256; every one that passes the round-trip check is shown. Parsing accepts any of them.
 */
import { levenshtein } from './text';

export interface Slot {
  kind: string;
  radix: number;
}

export interface Template<S extends Slot = Slot> {
  id: number;
  /** Verb group; −1 — a nominal sentence (no predicate). */
  group: number;
  slots: S[];
  words: number;
  cap: bigint;
  /** Start of the template's segment among phrases of the same length. */
  start: bigint;
}

/** A reading of a word form: dictionary kind, word number and grammatical choice (tense, number, gender). */
export interface Reading {
  kind: string;
  lex: number;
  gram: number;
}

export interface Grammar<S extends Slot = Slot, T extends Template<S> = Template<S>> {
  /** Language code: 'ru', 'en'. */
  lang: string;
  /** Hash label. Changing it changes every phrase: those already written stop parsing. */
  tag: string;
  maxWords: number;
  templates: T[];
  /** Words of a template for the given digits (lowercase except proper names, no full stop). */
  render(t: T, digits: number[]): string[];
  /** Every word form with its reading. Called once, when the index is first needed. */
  forms(add: (form: string, r: Reading) => void): void;
  /** Reading kind that fills a slot. */
  reading(slot: S): string;
  /** Digit values a reading can stand for in a slot. strict — only the grammatical form the word has. */
  values(slot: S, r: Reading, strict: boolean): number[];
  /** Comparison key of a word: case, letter variants, look-alike letters. */
  key(word: string): string;
  /** Words of a text as keys. */
  tokenize(text: string): string[];
  /** Key forms that count as the same word (с/со, a/an). */
  same(key: string): string;
  /** Template as a pattern, for display. */
  pattern(t: T): string;
  /** Verb group name; a nominal sentence when group < 0. */
  groupName(group: number): string;
  /** Dictionary sizes by reading kind (ranks suggestions: earlier words are more frequent). */
  kindSize: Record<string, number>;
  /** Dictionary sizes for the summary, by dictionary id. */
  sizes: Record<string, number>;
}

export const MAX_BYTES = 100;
/**
 * Words per sentence for 1…8 bytes — enough for 128+ variants. 3 and 4 bytes share
 * 4-word templates, 6 and 7 bytes share 6-word ones: each size has its own range of numbers.
 */
export const WORDS_FOR_BYTES = [0, 2, 3, 4, 4, 5, 6, 6, 7];
/**
 * Bits for variants and checksum: 8 bits (256 variants) if the checksum keeps at least
 * 10 bits; otherwise 7 bits (128 variants) with at least 9.
 */
const VARIANT_PLANS = [
  { bits: 8, check: 10 },
  { bits: 7, check: 9 },
];
/** No size has a weaker checksum. */
export const MIN_CHECK = 9;

export interface Scheme {
  bytes: number;
  words: number;
  variantBits: number;
  K: bigint;
  /** Range of numbers among phrases of this length: [base, base + size). */
  base: bigint;
  size: bigint;
  /** Halves of the Feistel network, bits. */
  A: bigint;
  B: bigint;
  checkBits: number;
}

export interface TemplateInfo {
  pattern: string;
  group: string;
  words: number;
  bytes: number;
  /** Share of phrases of this length that fall on the template. */
  share: number;
  capBits: number;
  checkBits: number;
}

export interface Variant {
  text: string;
  info: TemplateInfo;
  variant: number;
}

export interface Encoded {
  lang: string;
  /** The first variant of every sentence by default. */
  sentences: string[];
  templates: TemplateInfo[];
  variants: Variant[][];
  /** Bytes in each sentence. */
  bytes: number[];
}

export type DecodeError =
  | { kind: 'empty' }
  | { kind: 'length'; words: number }
  | { kind: 'unknown'; word: string; position: number; suggestions: string[] }
  | { kind: 'sentence'; sentence: number; words: number }
  | { kind: 'unparsed'; sentence: number };

/** A corrected word: its number in the whole phrase, as typed and as it should be. */
export interface Correction {
  position: number;
  from: string;
  to: string;
}

export type Decoded =
  | {
      ok: true;
      lang: string;
      bytes: Uint8Array;
      sentences: number;
      /** Corrections by sentence (position — number of the word within the sentence). */
      fixes: { sentence: number; notes: Correction[] }[];
      corrections: Correction[];
    }
  | { ok: false; lang: string; errors: DecodeError[] };

/** A decoded sentence. */
interface Found {
  chunk: bigint;
  bytes: number;
  penalty: number;
  /** Corrected words: number in the sentence, as typed, the right form. */
  changes: Correction[];
}

// --- hashing (shared by all languages; the tag tells them apart) --------------------------

const MASK64 = (1n << 64n) - 1n;
function hash64(bytes: number[]): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & MASK64;
  }
  h ^= h >> 30n;
  h = (h * 0xbf58476d1ce4e5b9n) & MASK64;
  h ^= h >> 27n;
  h = (h * 0x94d049bb133111ebn) & MASK64;
  h ^= h >> 31n;
  return h;
}
const mask = (bits: bigint) => (1n << bits) - 1n;
const ROUNDS = 6;

/** Bytes of a sentence (r of them, most significant first). */
function chunkBytes(n: bigint, r: number): number[] {
  const out: number[] = [];
  for (let i = r - 1; i >= 0; i -= 1) out.push(Number((n >> BigInt(i * 8)) & 0xffn));
  return out;
}

const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

export type Codec = ReturnType<typeof createCodec>;

export function createCodec<S extends Slot, T extends Template<S>>(g: Grammar<S, T>) {
  const MAX_WORDS = g.maxWords;
  const TEMPLATES = g.templates;
  /** The most words a phrase can have: 12 full sentences + a 4-byte remainder. */
  const MAX_TOTAL_WORDS = Math.floor(MAX_BYTES / 8) * MAX_WORDS + WORDS_FOR_BYTES[MAX_BYTES % 8]!;
  const TAG = [...g.tag].map((c) => c.charCodeAt(0));

  // Templates by word count; start — the beginning of a template's segment among phrases of that length.
  const BY_WORDS = new Map<number, T[]>();
  const TOTAL_W = new Map<number, bigint>();
  for (const t of TEMPLATES) {
    let list = BY_WORDS.get(t.words);
    if (!list) BY_WORDS.set(t.words, (list = []));
    t.start = TOTAL_W.get(t.words) ?? 0n;
    TOTAL_W.set(t.words, t.start + t.cap);
    list.push(t);
  }

  // --- schemes: how many bytes -> how many words ------------------------------------------

  function buildSchemes(): Scheme[] {
    const out: Scheme[] = [];
    for (let w = 1; w <= MAX_WORDS; w += 1) {
      const sizes = WORDS_FOR_BYTES.flatMap((n, r) => (r && n === w ? [r] : []));
      let base = 0n;
      let rest = TOTAL_W.get(w) ?? 0n;
      sizes.forEach((r, j) => {
        const last = j === sizes.length - 1;
        // The smaller of two sizes of one length gets a range exactly for its plan; the larger takes the rest.
        const plan = VARIANT_PLANS.find((p) => {
          if (!last) return (1n << BigInt(8 * r + p.bits + p.check)) * 4n <= rest;
          return Number(rest >> BigInt(8 * r + p.bits)) >= 2 ** p.check;
        });
        if (!plan) throw new Error(`${g.lang}: dictionaries are too small for ${r} bytes in ${w} words`);
        const v = plan.bits;
        const K = last ? rest >> BigInt(8 * r + v) : 1n << BigInt(plan.check);
        const width = 8 * r + v;
        const size = K << BigInt(width);
        out[r] = {
          bytes: r, words: w, variantBits: v, K, base, size,
          A: BigInt(Math.ceil(width / 2)), B: BigInt(Math.floor(width / 2)), checkBits: Math.log2(Number(K)),
        };
        base += size;
        rest -= size;
      });
    }
    return out;
  }
  /** Scheme for r bytes — SCHEMES[r], r = 1…8. */
  const SCHEMES = buildSchemes();
  const scheme = (r: number): Scheme => SCHEMES[r]!;

  // --- checksum and mixing --------------------------------------------------------------

  // An unbalanced Feistel network on 8r+v bits: halves of A and B bits (A ≥ B) swap places
  // every round; the number of rounds is even, so the output is A and B again.
  const leftBits = (s: Scheme, i: number) => (i % 2 ? s.B : s.A);
  function feistelRound(s: Scheme, half: bigint, round: number): bigint {
    const bytes = [...TAG, 0xfe, s.bytes, round];
    for (let i = 4; i >= 0; i -= 1) bytes.push(Number((half >> BigInt(i * 8)) & 0xffn));
    return hash64(bytes) & mask(leftBits(s, round));
  }
  function mix(s: Scheme, x: bigint): bigint {
    let l = x >> s.B;
    let r = x & mask(s.B);
    for (let i = 0; i < ROUNDS; i += 1) [l, r] = [r, l ^ feistelRound(s, r, i)];
    return (l << s.B) | r;
  }
  function unmix(s: Scheme, y: bigint): bigint {
    let l = y >> s.B;
    let r = y & mask(s.B);
    for (let i = ROUNDS - 1; i >= 0; i -= 1) [l, r] = [r ^ feistelRound(s, l, i), l];
    return (l << s.B) | r;
  }
  /** The checksum covers only the sentence's own bytes: sentences are independent. */
  function checksum(s: Scheme, n: bigint, variant: number): bigint {
    return hash64([...TAG, 0xcc, s.bytes, variant, ...chunkBytes(n, s.bytes)]) % s.K;
  }

  // --- templates --------------------------------------------------------------------------

  const sentence = (words: string[]) => `${capitalize(words.join(' '))}.`;

  function describeTemplate(t: T, s: Scheme): TemplateInfo {
    return {
      pattern: g.pattern(t),
      group: g.groupName(t.group),
      words: t.words,
      bytes: s.bytes,
      share: Number((t.cap * 1000000n) / TOTAL_W.get(t.words)!) / 1000000,
      capBits: Math.log2(Number(t.cap)),
      checkBits: s.checkBits,
    };
  }

  function digitsOf(t: T, local: bigint): number[] {
    const out: number[] = [];
    let rest = local;
    for (const s of t.slots) {
      const r = BigInt(s.radix);
      out.push(Number(rest % r));
      rest /= r;
    }
    return out;
  }

  function localOf(t: T, digits: number[]): bigint {
    let m = 0n;
    for (let i = t.slots.length - 1; i >= 0; i -= 1) m = m * BigInt(t.slots[i]!.radix) + BigInt(digits[i]!);
    return m;
  }

  /** Template of length w whose segment holds number P (binary search). */
  function templateAt(w: number, p: bigint): T {
    const list = BY_WORDS.get(w)!;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid]!.start <= p) lo = mid;
      else hi = mid - 1;
    }
    return list[lo]!;
  }

  // --- index of word forms ----------------------------------------------------------------

  let index: Map<string, Reading[]> | null = null;
  /** Word form for display (capitalized names, ё): the first one seen for a key. */
  const DISPLAY = new Map<string, string>();

  function buildIndex(): Map<string, Reading[]> {
    const ix = new Map<string, Reading[]>();
    g.forms((form, r) => {
      const k = g.key(form);
      if (!DISPLAY.has(k)) DISPLAY.set(k, form);
      const list = ix.get(k);
      if (!list) ix.set(k, [r]);
      else if (!list.some((x) => x.kind === r.kind && x.lex === r.lex && x.gram === r.gram)) list.push(r);
    });
    index = ix;
    return ix;
  }
  const ixOf = () => index ?? buildIndex();

  // --- encoding ---------------------------------------------------------------------------

  /** Candidates rejected by the round-trip check (for tests and debugging). */
  let rejected = 0;

  /** Whether a sentence parses strictly into exactly these r bytes. */
  function roundTrips(text: string, n: bigint, r: number): boolean {
    const f = decodeSentence(g.tokenize(text), true);
    return !!f && f.chunk === n && f.bytes === r;
  }

  /**
   * Variants of a sentence for r bytes (n — their value): every variant number. Each one is
   * parsed back before it is shown; one that fails the check is skipped.
   */
  function variantsOf(n: bigint, r: number): Variant[] {
    const s = scheme(r);
    const out: Variant[] = [];
    for (let v = 0; v < 1 << s.variantBits; v += 1) {
      const x = mix(s, (n << BigInt(s.variantBits)) | BigInt(v));
      const p = s.base + x * s.K + checksum(s, n, v);
      const t = templateAt(s.words, p);
      const text = sentence(g.render(t, digitsOf(t, p - t.start)));
      if (!roundTrips(text, n, r)) {
        rejected += 1;
        continue;
      }
      out.push({ text, info: describeTemplate(t, s), variant: v });
    }
    if (!out.length) throw new Error('no variant passed the round-trip check');
    return out;
  }

  /** Bytes (1…100) -> sentences: 8 bytes each, the remainder last and shorter. */
  function encode(bytes: Uint8Array): Encoded {
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error(`need 1 to ${MAX_BYTES} bytes, not ${bytes.length}`);
    const out: Encoded = { lang: g.lang, sentences: [], templates: [], variants: [], bytes: [] };
    for (let at = 0; at < bytes.length; at += 8) {
      const r = Math.min(8, bytes.length - at);
      let n = 0n;
      for (let j = 0; j < r; j += 1) n = (n << 8n) | BigInt(bytes[at + j]!);
      const variants = variantsOf(n, r);
      out.variants.push(variants);
      out.sentences.push(variants[0]!.text);
      out.templates.push(variants[0]!.info);
      out.bytes.push(r);
    }
    return out;
  }

  // --- parsing ----------------------------------------------------------------------------

  /** The nearest word forms by spelling (a typo of 1–2 letters). */
  function near(word: string): [number, string][] {
    const out: [number, string][] = [];
    for (const k of ixOf().keys()) {
      const d = levenshtein(word, k, 2);
      if (d <= 2) out.push([d, k]);
    }
    return out.sort((a, b) => a[0] - b[0]).slice(0, 8);
  }

  /** Scheme whose range holds number P among phrases of length w. */
  function schemeAt(w: number, p: bigint): Scheme | null {
    for (const s of SCHEMES) if (s && s.words === w && p >= s.base && p < s.base + s.size) return s;
    return null;
  }

  /**
   * One sentence -> its bytes. The strict pass accepts exact forms only. Otherwise wrong
   * forms (tense, number, case) and typos are corrected; the corrections come back in changes.
   */
  function decodeSentence(words: string[], strict: boolean): Found | null {
    const ix = ixOf();
    const templates = BY_WORDS.get(words.length);
    if (!templates) return null;
    // Readings of each word; for a typo — the nearest forms with a penalty.
    const readings = words.map((w) => {
      const exact = (ix.get(w) ?? []).map((r) => ({ r, typo: 0 }));
      if (exact.length || strict) return exact;
      return near(w).flatMap(([d, k]) => (ix.get(k) ?? []).map((r) => ({ r, typo: d })));
    });
    if (readings.some((l) => !l.length)) return null;
    const kinds = readings.map((l) => new Set(l.map((x) => x.r.kind)));
    const found: Found[] = [];
    for (const t of templates) {
      if (t.slots.some((s, i) => !kinds[i]!.has(g.reading(s)))) continue;
      const options = t.slots.map((s, i) => {
        const seen = new Map<number, number>();
        const want = g.reading(s);
        for (const x of readings[i]!) {
          if (x.r.kind !== want) continue;
          for (const v of g.values(s, x.r, strict)) if (!seen.has(v) || seen.get(v)! > x.typo) seen.set(v, x.typo);
        }
        return [...seen];
      });
      if (options.some((o) => !o.length)) continue;
      let tried = 0;
      const digits: number[] = [];
      const walk = (i: number, typo: number) => {
        if (tried > 5000) return;
        if (i === options.length) {
          tried += 1;
          const p = t.start + localOf(t, digits);
          const s = schemeAt(t.words, p);
          if (!s) return;
          const q = p - s.base;
          const y = unmix(s, q / s.K);
          const chunk = y >> BigInt(s.variantBits);
          const variant = Number(y & mask(BigInt(s.variantBits)));
          if (q % s.K !== checksum(s, chunk, variant)) return;
          const rendered = g.render(t, digits);
          const changes: Correction[] = [];
          rendered.forEach((w, j) => {
            if (g.same(g.key(w)) !== g.same(words[j]!)) changes.push({ position: j, from: words[j]!, to: w });
          });
          if (strict && changes.length) return;
          found.push({ chunk, bytes: s.bytes, penalty: typo + changes.length, changes });
          return;
        }
        for (const [v, ty] of options[i]!) {
          digits[i] = v;
          walk(i + 1, typo + ty);
        }
      };
      walk(0, 0);
    }
    if (!found.length) return null;
    found.sort((a, b) => a.penalty - b.penalty);
    const best = found[0]!;
    if (found.some((f) => f.penalty === best.penalty && (f.chunk !== best.chunk || f.bytes !== best.bytes))) return null;
    return best;
  }

  /** Unknown words of a sentence (position — number of the word in the whole phrase). */
  function unknownWords(words: string[], offset: number): DecodeError[] {
    const ix = ixOf();
    const errors: DecodeError[] = [];
    words.forEach((w, i) => {
      if (ix.has(w)) return;
      errors.push({ kind: 'unknown', word: w, position: offset + i, suggestions: [...new Set(near(w).map(([, k]) => k))].slice(0, 4) });
    });
    return errors;
  }

  /** Sentences of the right length: a full one is exactly MAX_WORDS words, only the last may be shorter. */
  const validSplit = (parts: string[][]) => parts.every((p, i) => p.length === MAX_WORDS || (i === parts.length - 1 && p.length >= 1 && p.length < MAX_WORDS));

  /** Phrase -> bytes. Tolerates case, letter variants, punctuation; then a wrong word form and a typo. */
  function decode(text: string): Decoded {
    const lang = g.lang;
    const words = g.tokenize(text);
    if (!words.length) return { ok: false, lang, errors: [{ kind: 'empty' }] };
    if (words.length > MAX_TOTAL_WORDS) return { ok: false, lang, errors: [{ kind: 'length', words: words.length }] };
    // Full stops, if placed right, split the sentences; otherwise MAX_WORDS words each.
    const marked = text.split(/[.!?;\n]+/).map(g.tokenize).filter((w) => w.length);
    let parts = marked;
    if (marked.length < 2 || !validSplit(marked)) {
      parts = [];
      for (let i = 0; i < words.length; i += MAX_WORDS) parts.push(words.slice(i, i + MAX_WORDS));
    }
    const found: Found[] = [];
    const errors: DecodeError[] = [];
    let offset = 0;
    parts.forEach((p, i) => {
      const s = decodeSentence(p, true) ?? decodeSentence(p, false);
      if (s) found.push(s);
      else {
        const unknown = unknownWords(p, offset);
        errors.push(...(unknown.length ? unknown : [{ kind: 'unparsed' as const, sentence: i }]));
      }
      offset += p.length;
    });
    if (errors.length) {
      const bad = marked.length > 1 && !validSplit(marked)
        ? marked.flatMap((p, i) => (p.length === MAX_WORDS || (i === marked.length - 1 && p.length < MAX_WORDS) ? [] : [{ kind: 'sentence' as const, sentence: i, words: p.length }]))
        : [];
      return { ok: false, lang, errors: [...bad, ...errors] };
    }
    const bytes = new Uint8Array(found.reduce((n, f) => n + f.bytes, 0));
    let at = 0;
    for (const f of found) {
      bytes.set(chunkBytes(f.chunk, f.bytes), at);
      at += f.bytes;
    }
    return {
      ok: true,
      lang,
      bytes,
      sentences: found.length,
      fixes: found.flatMap((f, i) => (f.changes.length ? [{ sentence: i, notes: f.changes }] : [])),
      corrections: found.flatMap((f, i) => {
        const start = parts.slice(0, i).reduce((n, p) => n + p.length, 0);
        return f.changes.map((c) => ({ position: start + c.position, from: c.from, to: c.to }));
      }),
    };
  }

  // --- suggestions while typing -----------------------------------------------------------

  let sortedKeys: string[] | null = null;
  /** Kinds of words that occur at position p of a sentence (in templates of any length). */
  let kindsAt: Set<string>[] | null = null;

  function suggestData() {
    if (!sortedKeys) {
      sortedKeys = [...ixOf().keys()].sort();
      kindsAt = Array.from({ length: MAX_WORDS }, () => new Set<string>());
      for (const t of TEMPLATES) t.slots.forEach((sl, i) => kindsAt![i]!.add(g.reading(sl)));
    }
    return { keys: sortedKeys, kinds: kindsAt! };
  }

  /** Whether the dictionaries know a word (up to case and letter variants). */
  function isKnown(word: string): boolean {
    return ixOf().has(g.key(word));
  }

  /**
   * Kinds of words possible after the words before (the start of the current sentence):
   * from templates whose first slots fit those words. If none fits — whatever occurs at
   * this position.
   */
  function nextKinds(before: string[]): Set<string> {
    const { kinds } = suggestData();
    const p = before.length;
    if (p >= MAX_WORDS) return new Set();
    const ix = ixOf();
    const seen = before.map((w) => new Set((ix.get(g.key(w)) ?? []).map((r) => r.kind)));
    const out = new Set<string>();
    for (const t of TEMPLATES) {
      if (t.words <= p) continue;
      if (seen.every((set, i) => set.has(g.reading(t.slots[i]!)))) out.add(g.reading(t.slots[p]!));
    }
    return out.size ? out : kinds[p]!;
  }

  /**
   * Suggestions for the beginning of a word: word forms starting with prefix. First the
   * kinds of words possible after before (the words of this sentence typed so far),
   * then more frequent words. kind — the reading kind (the page names it).
   */
  function suggest(prefix: string, before: string[] = [], limit = 8): { word: string; kind: string }[] {
    const k = g.key(prefix);
    if (!k) return [];
    const { keys } = suggestData();
    const ix = ixOf();
    const allowed = nextKinds(before);
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! < k) lo = mid + 1;
      else hi = mid;
    }
    const found: { word: string; kind: string; score: number }[] = [];
    for (let i = lo; i < keys.length && keys[i]!.startsWith(k) && found.length < 4000; i += 1) {
      const readings = ix.get(keys[i]!)!;
      let best = Infinity;
      let kind = '';
      for (const r of readings) {
        const score = (allowed.has(r.kind) ? 0 : 10) + r.lex / (g.kindSize[r.kind] ?? 1);
        if (score < best) {
          best = score;
          kind = r.kind;
        }
      }
      // An exact match comes first, but only within its tier (fits the position or not).
      found.push({ word: DISPLAY.get(keys[i]!) ?? keys[i]!, kind, score: best - (keys[i] === k ? 1 : 0) });
    }
    return found.sort((a, b) => a.score - b.score || a.word.length - b.word.length).slice(0, limit).map(({ word, kind }) => ({ word, kind }));
  }

  /** Summary for the page. */
  function summary() {
    return {
      lang: g.lang,
      templates: TEMPLATES.length,
      maxWords: MAX_WORDS,
      maxBytes: MAX_BYTES,
      schemes: SCHEMES.filter(Boolean).map((s) => ({
        bytes: s.bytes,
        words: s.words,
        variants: 1 << s.variantBits,
        checkBits: s.checkBits,
      })),
      sizes: g.sizes,
    };
  }

  return {
    lang: g.lang,
    MAX_WORDS,
    MAX_TOTAL_WORDS,
    TEMPLATES,
    SCHEMES,
    encode,
    decode,
    variantsOf,
    describeTemplate,
    suggest,
    isKnown,
    tokenize: g.tokenize,
    summary,
    /** For tests: digits of every template and strict parsing without the checksum. */
    _internal: {
      rejected: () => rejected,
      digitsOf,
      localOf,
      renderWords: g.render,
      /** Whether strict parsing can recover the digits of template t from its own words. */
      recoverable(t: T, digits: number[]): boolean {
        const ix = ixOf();
        const words = g.render(t, digits).map(g.key);
        return t.slots.every((s, i) => (ix.get(words[i]!) ?? []).some((r) => r.kind === g.reading(s) && g.values(s, r, true).includes(digits[i]!)));
      },
    },
  };
}
