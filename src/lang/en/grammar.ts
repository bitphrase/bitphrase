/**
 * English grammar for the codec (dictionaries: tools/data/en/gen_dicts.py).
 *
 *   [WHO] [PREDICATE of a group] [OBJECT the group takes] [TAIL?]
 *   "Brave Doctor Garcia paints Anna's purple boats near Lisbon."
 *
 * WHO — Name | Adj Name | Name Surname | Adj Name Surname | Title Surname (Doctor Garcia,
 * Mrs Moore) | Adj Title Surname | Title Name (Uncle Kevin) | Surname | and for professions,
 * roles and animals: bare plural (doctors), Adj + plural, Det + noun (a doctor, the doctors,
 * seven doctors), Det Adj noun, Name's noun, Name's Adj noun, Title Surname's noun.
 * Objects take the same shapes. The determiner carries the number: "a/this/every" —
 * singular, "these/some/seven" — plural; after a possessive the noun's own number is a
 * digit. The predicate is a verb (present or past; the present agrees with the subject),
 * "modal + infinitive" (can paint), "catenative + -ing" (likes painting) or "be + -ing"
 * (is painting). The verb group decides what follows: a thing, a person, "to someone",
 * "with someone or something", "about...", motion "to/past/from..." or place "near/under...".
 * For 1–3 words there are nominal templates too: "Purple boats.", "Doctor Garcia."
 */
import type { Grammar, Reading, Slot as BaseSlot, Template as BaseTemplate } from '../../core/engine';
import { wordsOf } from '../../core/text';
import raw from './dict.json';

type Num = 'sing' | 'plur';
type FrameId = 'acc:all' | 'acc:person' | 'to:person' | 'with:any' | 'about:any' | 'motion' | 'stay';
type PrepSet = 'motion' | 'motionPlace' | 'stay' | 'stayPlace' | 'for' | 'placeTail';

interface Dict {
  version: string;
  maxWords: number;
  adj: string[];
  name: string[];
  surname: string[];
  title: { surname: string[]; masc: string[]; femn: string[] };
  prof: string[];
  role: string[];
  animal: string[];
  obj: string[];
  place: string[];
  verbs: string[];
  cat: string[];
  modal: string[];
  groups: { name: string; frame: FrameId; verbs: number[] }[];
  det: { sing: string[]; plur: string[] };
  preps: Record<PrepSet, string[]>;
}

const dict = raw as unknown as Dict;
export const DICT_VERSION = dict.version;

// --- text --------------------------------------------------------------------------------

/** Cyrillic letters that look like Latin ones: easy to mix up on a Russian keyboard layout. */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', у: 'y', к: 'k', н: 'h', м: 'm', т: 't', в: 'b', і: 'i',
};

/** Comparison key of a word: lowercase, no apostrophe (Anna's = annas), look-alikes -> Latin. */
export function key(word: string): string {
  let out = '';
  for (const ch of word.normalize('NFC').toLowerCase()) {
    if (ch === "'" || ch === '’') continue;
    out += HOMOGLYPHS[ch] ?? ch;
  }
  return out;
}

export const tokenize = (text: string): string[] => wordsOf(text).map(key);

// --- dictionaries ------------------------------------------------------------------------

/** "^" in front of a word: it takes "an" (an apple, an hour). */
const AN = new Set<string>();
const plain = (w: string) => {
  if (w.startsWith('^')) {
    AN.add(w.slice(1));
    return w.slice(1);
  }
  return w;
};

const ADJ = dict.adj.map(plain);
const NAME = dict.name.map((s) => s.slice(2));
const NAME_FEM = dict.name.map((s) => s[0] === 'f');
const SUR = dict.surname;
/** Nouns: [singular, plural]. */
const nouns = (list: string[]) => list.map((s) => s.split('|').map(plain) as [string, string]);
const PROF = nouns(dict.prof);
const ROLE = nouns(dict.role);
const ANIMAL = nouns(dict.animal);
const OBJ = nouns(dict.obj);
const PLACE = dict.place;
/** Verbs: base, -s, past, -ing. */
const VERB = dict.verbs.map((s) => s.split('|'));
/** Catenatives (likes painting): base, -s, past. */
const CAT = dict.cat.map((s) => s.split('|'));
const MODAL = dict.modal;
const GROUPS = dict.groups;
const GROUP_POS = GROUPS.map((g) => new Map(g.verbs.map((v, i) => [v, i])));
const T_SUR = dict.title.surname;
const T_NAME = { masc: dict.title.masc, femn: dict.title.femn };
/** All determiners: singular first, then plural ("the" is in both halves). */
const DET = [...dict.det.sing, ...dict.det.plur];
const DET_SING = dict.det.sing.length;
const BE = [['is', 'are'], ['was', 'were']];
const P = dict.preps;

const possessive = (w: string) => `${w}'s`;

// --- templates ---------------------------------------------------------------------------

type NounKind = 'prof' | 'role' | 'animal' | 'obj';
const NOUNS: Record<NounKind, [string, string][]> = { prof: PROF, role: ROLE, animal: ANIMAL, obj: OBJ };

/** Kind of word (digit). */
type SlotKind =
  | 'adj' | 'name' | 'nameP' | 'sur' | 'surP' | 'titleS' | 'titleN' | 'det' | 'place'
  | `${NounKind}Pl` | `${NounKind}Det` | `${NounKind}Num`
  | 'verb' | 'inf' | 'ing' | 'modal' | 'cat' | 'be' | 'prep' | 'fixed';

interface Slot extends BaseSlot {
  kind: SlotKind;
  group?: number;
  preps?: string[];
  word?: string;
}

/** Noun phrase: code, labels for the pattern, digits. */
interface Alt {
  code: string;
  parts: string[];
  slots: SlotKind[];
}

type Part =
  | { type: 'np'; alt: Alt }
  | { type: 'pred'; form: 'V' | 'MV' | 'CV' | 'BV'; group: number }
  | { type: 'prep'; preps: string[] }
  | { type: 'fixed'; word: string };

interface Template extends BaseTemplate<Slot> {
  parts: Part[];
}

const alt = (code: string, parts: string[], slots: SlotKind[]): Alt => ({ code, parts, slots });

/** Shapes of a common-noun phrase: doctors, brave doctors, a doctor, a brave doctor, Anna's doctor... */
function nounAlts(k: NounKind, title: string): Alt[] {
  return [
    alt(`${k}Pl`, [`${title}s`], [`${k}Pl`]),
    alt(`A${k}Pl`, ['Adj', `${title}s`], ['adj', `${k}Pl`]),
    alt(`D${k}`, ['Det', title], ['det', `${k}Det`]),
    alt(`DA${k}`, ['Det', 'Adj', title], ['det', 'adj', `${k}Det`]),
    alt(`P${k}`, ["Name's", title], ['nameP', `${k}Num`]),
    alt(`PA${k}`, ["Name's", 'Adj', title], ['nameP', 'adj', `${k}Num`]),
    alt(`TP${k}`, ['Title', "Surname's", title], ['titleS', 'surP', `${k}Num`]),
  ];
}

const PERSONS: Alt[] = [
  alt('N', ['Name'], ['name']),
  alt('AN', ['Adj', 'Name'], ['adj', 'name']),
  alt('NS', ['Name', 'Surname'], ['name', 'sur']),
  alt('ANS', ['Adj', 'Name', 'Surname'], ['adj', 'name', 'sur']),
  alt('TS', ['Title', 'Surname'], ['titleS', 'sur']),
  alt('ATS', ['Adj', 'Title', 'Surname'], ['adj', 'titleS', 'sur']),
  alt('TN', ['Title', 'Name'], ['titleN', 'name']),
  alt('S', ['Surname'], ['sur']),
  ...nounAlts('prof', 'profession'),
  ...nounAlts('role', 'person'),
  ...nounAlts('animal', 'animal'),
];
const OBJECTS: Alt[] = nounAlts('obj', 'thing');
const CITY = alt('City', ['City'], ['place']);

const np = (a: Alt): Part => ({ type: 'np', alt: a });
const pp = (preps: string[], a: Alt): Part[] => [{ type: 'prep', preps }, np(a)];
const fixed = (word: string, a: Alt): Part[] => [{ type: 'fixed', word }, np(a)];

/** Objects of a group and the tails allowed after them. */
function argumentsOf(frame: FrameId): [Part[] | null, (Part[] | null)[]][] {
  const tailPlace = [pp(P.placeTail, CITY)];
  const tailFor = PERSONS.map((a) => pp(P.for, a));
  const any = [...PERSONS, ...OBJECTS];
  switch (frame) {
    case 'acc:all':
      return OBJECTS.map((a) => [[np(a)], [null, ...tailFor, ...tailPlace]]);
    case 'acc:person':
      return PERSONS.map((a) => [[np(a)], [null, ...tailFor, ...tailPlace]]);
    case 'to:person':
      return PERSONS.map((a) => [fixed('to', a), [null, ...tailPlace]]);
    case 'with:any':
      return any.map((a) => [fixed('with', a), [null, ...tailPlace]]);
    case 'about:any':
      return any.map((a) => [fixed('about', a), [null, ...tailPlace]]);
    case 'motion':
      return [[null, [null]], ...any.map((a): [Part[], null[]] => [pp(P.motion, a), [null]]), [pp(P.motionPlace, CITY), [null]]];
    case 'stay':
      return [[null, [null]], ...any.map((a): [Part[], null[]] => [pp(P.stay, a), [null]]), [pp(P.stayPlace, CITY), [null]]];
    default:
      throw new Error(`unknown frame ${frame}`);
  }
}

const RADIX: Record<Exclude<SlotKind, 'verb' | 'inf' | 'ing' | 'prep'>, number> = {
  adj: ADJ.length, name: NAME.length, nameP: NAME.length, sur: SUR.length, surP: SUR.length,
  titleS: T_SUR.length, titleN: T_NAME.masc.length, det: DET.length, place: PLACE.length,
  profPl: PROF.length, profDet: PROF.length, profNum: 2 * PROF.length,
  rolePl: ROLE.length, roleDet: ROLE.length, roleNum: 2 * ROLE.length,
  animalPl: ANIMAL.length, animalDet: ANIMAL.length, animalNum: 2 * ANIMAL.length,
  objPl: OBJ.length, objDet: OBJ.length, objNum: 2 * OBJ.length,
  modal: MODAL.length, cat: 2 * CAT.length, be: 2, fixed: 1,
};

function slotsOf(part: Part): Slot[] {
  switch (part.type) {
    case 'np':
      return part.alt.slots.map((kind) => ({ kind, radix: RADIX[kind as keyof typeof RADIX] }));
    case 'pred': {
      const n = GROUPS[part.group]!.verbs.length;
      const group = part.group;
      if (part.form === 'V') return [{ kind: 'verb', radix: 2 * n, group }];
      if (part.form === 'MV') return [{ kind: 'modal', radix: RADIX.modal }, { kind: 'inf', radix: n, group }];
      if (part.form === 'CV') return [{ kind: 'cat', radix: RADIX.cat }, { kind: 'ing', radix: n, group }];
      return [{ kind: 'be', radix: RADIX.be }, { kind: 'ing', radix: n, group }];
    }
    case 'prep':
      return [{ kind: 'prep', radix: part.preps.length, preps: part.preps }];
    case 'fixed':
      return [{ kind: 'fixed', radix: 1, word: part.word }];
  }
}

function buildTemplates(): Template[] {
  const out: Template[] = [];
  const add = (group: number, parts: Part[]) => {
    const slots = parts.flatMap(slotsOf);
    if (slots.length > dict.maxWords) return;
    const cap = slots.reduce((p, s) => p * BigInt(s.radix), 1n);
    out.push({ id: out.length, group, parts, slots, words: slots.length, cap, start: 0n });
  };
  // Nominal: one noun phrase — "Purple boats.", "Doctor Garcia.", "Anna's cows."
  for (const a of [...PERSONS, ...OBJECTS]) add(-1, [np(a)]);
  GROUPS.forEach((group, gi) => {
    if (!group.verbs.length) return;
    for (const [arg, tails] of argumentsOf(group.frame)) {
      for (const tail of tails) {
        for (const form of ['V', 'MV', 'CV', 'BV'] as const) {
          for (const subj of PERSONS) add(gi, [np(subj), { type: 'pred', form, group: gi }, ...(arg ?? []), ...(tail ?? [])]);
        }
      }
    }
  });
  return out;
}

// --- rendering ---------------------------------------------------------------------------

/** Noun phrase by digits: its words and grammatical number (for agreement). */
function renderNp(a: Alt, d: number[]): { words: string[]; num: Num } {
  const words: string[] = [];
  let num: Num = 'sing';
  a.slots.forEach((kind, i) => {
    const v = d[i]!;
    switch (kind) {
      case 'adj':
        words.push(ADJ[v]!);
        break;
      case 'name':
        words.push(NAME[v]!);
        break;
      case 'nameP':
        words.push(possessive(NAME[v]!));
        break;
      case 'sur':
        words.push(SUR[v]!);
        break;
      case 'surP':
        words.push(possessive(SUR[v]!));
        break;
      case 'titleS':
        words.push(T_SUR[v]!);
        break;
      case 'titleN': {
        // The title agrees with the name that follows: Uncle Kevin, Aunt Mary.
        const fem = NAME_FEM[d[i + 1]!];
        words.push((fem ? T_NAME.femn : T_NAME.masc)[v]!);
        break;
      }
      case 'det':
        num = v < DET_SING ? 'sing' : 'plur';
        words.push(DET[v]!);
        break;
      case 'place':
        words.push(PLACE[v]!);
        break;
      default: {
        const k = kind.replace(/(Pl|Det|Num)$/, '') as NounKind;
        const list = NOUNS[k];
        if (kind.endsWith('Pl')) {
          num = 'plur';
          words.push(list[v]![1]);
        } else if (kind.endsWith('Det')) {
          words.push(list[v]![num === 'sing' ? 0 : 1]);
        } else {
          num = v >= list.length ? 'plur' : 'sing';
          words.push(list[v % list.length]![num === 'sing' ? 0 : 1]);
        }
      }
    }
  });
  // Plural only from the noun or determiner; a name, a title with a surname — singular.
  return { words, num };
}

/** "a" -> "an" before a vowel sound (an apple, an hour, but a unicorn). */
function articles(words: string[]): string[] {
  return words.map((w, i) => (w === 'a' && AN.has(words[i + 1] ?? '') ? 'an' : w));
}

/** Words of a template by digits (lowercase except proper names, no full stop). */
function render(t: Template, digits: number[]): string[] {
  const words: string[] = [];
  let i = 0;
  let subj: Num = 'sing';
  for (const part of t.parts) {
    switch (part.type) {
      case 'np': {
        const n = part.alt.slots.length;
        const r = renderNp(part.alt, digits.slice(i, i + n));
        if (i === 0) subj = r.num;
        words.push(...r.words);
        i += n;
        break;
      }
      case 'pred': {
        const verbs = GROUPS[part.group]!.verbs;
        const pl = subj === 'plur';
        const v = digits[i++]!;
        if (part.form === 'V') {
          const f = VERB[verbs[v % verbs.length]!]!;
          words.push(v >= verbs.length ? f[2]! : pl ? f[0]! : f[1]!);
        } else if (part.form === 'MV') {
          words.push(MODAL[v]!, VERB[verbs[digits[i++]!]!]![0]!);
        } else if (part.form === 'CV') {
          const f = CAT[v % CAT.length]!;
          words.push(v >= CAT.length ? f[2]! : pl ? f[0]! : f[1]!, VERB[verbs[digits[i++]!]!]![3]!);
        } else {
          words.push(BE[v]![pl ? 1 : 0]!, VERB[verbs[digits[i++]!]!]![3]!);
        }
        break;
      }
      case 'prep':
        words.push(part.preps[digits[i++]!]!);
        break;
      case 'fixed':
        i += 1;
        words.push(part.word);
        break;
    }
  }
  return articles(words);
}

/** Template in words: "[Adj] [Name] [verb 'what'] [Det] [thing] [for|with...] [Name]". */
function pattern(t: Template): string {
  const out: string[] = [];
  for (const part of t.parts) {
    if (part.type === 'np') out.push(...part.alt.parts.map((p) => `[${p}]`));
    else if (part.type === 'pred') {
      const g = `verb "${GROUPS[part.group]!.name}"`;
      out.push(
        part.form === 'V' ? `[${g} present|past]`
          : part.form === 'MV' ? `[modal] [${g}]`
            : part.form === 'CV' ? `[likes|starts…] [${g} -ing]`
              : `[is|was] [${g} -ing]`,
      );
    } else if (part.type === 'prep') out.push(`[${part.preps.join('|')}]`);
    else out.push(`[${part.word}]`);
  }
  return out.join(' ');
}

// --- parsing -----------------------------------------------------------------------------

const PREP_IDS = new Map<string, number>();
const TITLE_IDS = new Map<string, number>();
const TITLES: string[] = [];

function forms(add: (form: string, r: Reading) => void) {
  ADJ.forEach((f, i) => add(f, { kind: 'adj', lex: i, gram: 0 }));
  NAME.forEach((f, i) => {
    add(f, { kind: 'name', lex: i, gram: 0 });
    add(possessive(f), { kind: 'nameP', lex: i, gram: 0 });
  });
  SUR.forEach((f, i) => {
    add(f, { kind: 'sur', lex: i, gram: 0 });
    add(possessive(f), { kind: 'surP', lex: i, gram: 0 });
  });
  for (const t of [...T_SUR, ...T_NAME.masc, ...T_NAME.femn]) {
    if (TITLE_IDS.has(t)) continue;
    TITLE_IDS.set(t, TITLES.length);
    TITLES.push(t);
    add(t, { kind: 'title', lex: TITLE_IDS.get(t)!, gram: 0 });
  }
  DET.forEach((f, i) => add(f, { kind: 'det', lex: i, gram: 0 }));
  add('an', { kind: 'det', lex: 0, gram: 0 });
  PLACE.forEach((f, i) => add(f, { kind: 'place', lex: i, gram: 0 }));
  for (const k of Object.keys(NOUNS) as NounKind[]) NOUNS[k].forEach((fs, i) => fs.forEach((f, j) => add(f, { kind: k, lex: i, gram: j })));
  VERB.forEach((fs, i) => fs.forEach((f, j) => add(f, { kind: 'verb', lex: i, gram: j })));
  CAT.forEach((fs, i) => fs.forEach((f, j) => add(f, { kind: 'cat', lex: i, gram: j })));
  MODAL.forEach((f, i) => add(f, { kind: 'modal', lex: i, gram: 0 }));
  BE.forEach((fs, tense) => fs.forEach((f, j) => add(f, { kind: 'be', lex: tense, gram: j })));
  for (const p of new Set(['to', 'with', 'about', ...Object.values(P).flat()])) {
    PREP_IDS.set(p, PREP_IDS.size);
    add(p, { kind: 'prep', lex: PREP_IDS.get(p)!, gram: 0 });
  }
}

const READING: Record<SlotKind, string> = {
  adj: 'adj', name: 'name', nameP: 'nameP', sur: 'sur', surP: 'surP', titleS: 'title', titleN: 'title', det: 'det',
  place: 'place', profPl: 'prof', profDet: 'prof', profNum: 'prof', rolePl: 'role', roleDet: 'role', roleNum: 'role',
  animalPl: 'animal', animalDet: 'animal', animalNum: 'animal', objPl: 'obj', objDet: 'obj', objNum: 'obj',
  verb: 'verb', inf: 'verb', ing: 'verb', modal: 'modal', cat: 'cat', be: 'be', prep: 'prep', fixed: 'prep',
};

/** Digit values by reading. strict — only the grammatical form the word has. */
function values(slot: Slot, r: Reading, strict: boolean): number[] {
  switch (slot.kind) {
    case 'adj':
    case 'name':
    case 'nameP':
    case 'sur':
    case 'surP':
    case 'det':
    case 'place':
    case 'modal':
      return [r.lex];
    case 'titleS': {
      const i = T_SUR.indexOf(TITLES[r.lex]!);
      return i < 0 ? [] : [i];
    }
    case 'titleN': {
      const t = TITLES[r.lex]!;
      return [...new Set([T_NAME.masc.indexOf(t), T_NAME.femn.indexOf(t)])].filter((i) => i >= 0);
    }
    case 'verb': {
      const pos = GROUP_POS[slot.group!]!.get(r.lex);
      if (pos === undefined) return [];
      const n = GROUPS[slot.group!]!.verbs.length;
      if (!strict) return [pos, n + pos];
      return r.gram <= 1 ? [pos] : r.gram === 2 ? [n + pos] : [];
    }
    case 'inf':
    case 'ing': {
      const pos = GROUP_POS[slot.group!]!.get(r.lex);
      if (pos === undefined) return [];
      return !strict || r.gram === (slot.kind === 'inf' ? 0 : 3) ? [pos] : [];
    }
    case 'cat':
      if (!strict) return [r.lex, CAT.length + r.lex];
      return r.gram <= 1 ? [r.lex] : [CAT.length + r.lex];
    case 'be':
      return [r.lex];
    case 'prep': {
      const word = [...PREP_IDS].find(([, id]) => id === r.lex)?.[0];
      const i = slot.preps!.indexOf(word ?? '');
      return i < 0 ? [] : [i];
    }
    case 'fixed':
      return r.lex === PREP_IDS.get(slot.word!) ? [0] : [];
    default: {
      const n = NOUNS[READING[slot.kind] as NounKind].length;
      if (slot.kind.endsWith('Pl')) return !strict || r.gram === 1 ? [r.lex] : [];
      if (slot.kind.endsWith('Det')) return [r.lex];
      return strict ? [r.gram * n + r.lex] : [r.lex, n + r.lex];
    }
  }
}

export const grammar: Grammar<Slot, Template> = {
  lang: 'en',
  tag: 'bitphrase/en/v1',
  maxWords: dict.maxWords,
  templates: buildTemplates(),
  render,
  forms,
  reading: (slot) => READING[slot.kind],
  values,
  key,
  tokenize,
  same: (k) => (k === 'an' ? 'a' : k),
  pattern,
  groupName: (group) => (group < 0 ? 'nominal' : GROUPS[group]!.name),
  kindSize: {
    adj: ADJ.length, name: NAME.length, nameP: NAME.length, sur: SUR.length, surP: SUR.length, title: 64,
    det: DET.length, place: PLACE.length, prof: PROF.length, role: ROLE.length, animal: ANIMAL.length, obj: OBJ.length,
    verb: VERB.length, cat: CAT.length, modal: MODAL.length, be: 2, prep: 32,
  },
  sizes: {
    adj: ADJ.length, name: NAME.length, surname: SUR.length, title: T_SUR.length, profession: PROF.length,
    role: ROLE.length, animal: ANIMAL.length, object: OBJ.length, place: PLACE.length, verb: VERB.length,
  },
};
