/**
 * Russian grammar for the codec: generalized templates (Templates.txt,
 * tools/data/gen_templates.py).
 *
 *   [WHO] [PREDICATE of a group] [OBJECT governed by the group] [TAIL?]
 *   «Беспомощная Трифонова сохраняет парабеллум выпускницы Шишкиной.»
 *
 * WHO — Name | Adj Name | Name Surname | Name Patronymic | Name Patronymic Surname |
 * Profession Surname | (Adj) Surname | (Adj) Family | (Adj) Profession | (Adj) Animal |
 * (Adj) Role. The predicate is a verb, "modal + infinitive" or "будет + infinitive". The
 * verb group decides what follows: any object in the accusative ("что"), a person in the
 * accusative/dative, "кем-чем", "о ком", "куда" (motion), "где" (place).
 * For 1–3 words there are nominal templates too: «Лодки.», «Иван Петров.», «Свиные крылышки.»
 */
import type { Grammar, Reading, Slot as BaseSlot, Template as BaseTemplate } from '../../core/engine';
import { wordsOf } from '../../core/text';
import raw from './dict.json';
import { agree, decline, type Declension, type Gender } from './morph';

type Case6 = 'nomn' | 'gent' | 'datv' | 'accs' | 'ablt' | 'loct';
const CASES: Case6[] = ['nomn', 'gent', 'datv', 'accs', 'ablt', 'loct'];
const CASE_RU: Record<Case6, string> = { nomn: 'И.п.', gent: 'Р.п.', datv: 'Д.п.', accs: 'В.п.', ablt: 'Т.п.', loct: 'П.п.' };
const ci = (c: Case6) => CASES.indexOf(c);

interface Dict {
  version: string;
  maxWords: number;
  adj: string[];
  name: string[];
  surname: string[];
  patr: string[];
  prof: string[];
  role: string[];
  animal: string[];
  obj: string[];
  place: string[];
  verbs: string[];
  modal: string[];
  groups: { name: string; frame: string; verbs: number[] }[];
  preps: Record<'motion' | 'motionPlace' | 'stay' | 'stayPlace' | 'for' | 'placeTail', [string, Case6][]>;
}

const dict = raw as unknown as Dict;
export const DICT_VERSION = dict.version;

// --- text --------------------------------------------------------------------------------

/** Latin letters that look like Russian ones: easy to mix up while typing. */
const HOMOGLYPHS: Record<string, string> = {
  a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', h: 'н', m: 'м', t: 'т', b: 'в',
};

/** Comparison key of a word: lowercase, ё -> е, Latin look-alikes -> Cyrillic. */
export function key(word: string): string {
  let out = '';
  for (const ch of word.normalize('NFC').toLowerCase()) {
    if (ch === 'ё') out += 'е';
    else out += HOMOGLYPHS[ch] ?? ch;
  }
  return out;
}

/** Words of a text as keys; everything but letters (and a hyphen inside a word) separates. */
export const tokenize = (text: string): string[] => wordsOf(text).map(key);

// --- dictionaries ------------------------------------------------------------------------

const GENDER: Record<string, Gender> = { m: 'masc', f: 'femn', n: 'neut' };

/** "gender:stem:ending|…" -> gender and forms. */
function unpack(s: string): { g: Gender; f: string[] } {
  const [g = '', stem = '', ends = ''] = s.split(':');
  return { g: GENDER[g] ?? 'masc', f: ends.split('|').map((e) => stem + e) };
}

const ADJ = dict.adj;
const NAME = dict.name.map(unpack); // sing. nom gen dat acc ins loc
const SUR = dict.surname.map((s) => unpack(s).f); // masc. 0–5, fem. 6–11, plur. 12–17
const PATR = dict.patr.map((s) => unpack(s).f); // masc. 0–5, fem. 6–11
const PROF = dict.prof.map(unpack); // sing. 0–5, plur. 6–11
const ROLE = dict.role.map(unpack);
const ANIMAL = dict.animal.map(unpack);
const OBJ = dict.obj.map(unpack);
const PLACE = dict.place.map(unpack);
const VERB = dict.verbs.map((s) => unpack(s).f); // inf., pres. 3 sing., 3 plur., past masc., fem., plur.
const MODAL = dict.modal.map((s) => unpack(s).f);
const GROUPS = dict.groups;
const GROUP_POS = GROUPS.map((g) => new Map(g.verbs.map((v, i) => [v, i])));

const declCache = new Map<number, Declension>();
function adjForms(i: number): Declension {
  let d = declCache.get(i);
  if (!d) {
    d = decline(ADJ[i]!) ?? undefined;
    if (!d) throw new Error(`adjective outside the rules: ${ADJ[i]}`);
    declCache.set(i, d);
  }
  return d;
}

// --- templates ---------------------------------------------------------------------------

/** Kind of word (digit). The radix is the size of the digit. */
type SlotKind =
  | 'adj' | 'name' | 'surG' | 'surMF' | 'fam' | 'patr' | 'prof' | 'profSg' | 'animal' | 'role'
  | 'obj' | 'place' | 'verb' | 'inf' | 'modal' | 'fixed' | 'prep' | 'about';
/** Which reading a word of this slot is looked up by. */
const READING: Record<SlotKind, string> = {
  adj: 'adj', name: 'name', surG: 'sur', surMF: 'sur', fam: 'sur', patr: 'patr', prof: 'prof', profSg: 'prof',
  animal: 'animal', role: 'role', obj: 'obj', place: 'place', verb: 'verb', inf: 'verb', modal: 'modal',
  fixed: 'fixed', prep: 'prep', about: 'prep',
};

interface Slot extends BaseSlot {
  kind: SlotKind;
  group?: number;
  preps?: [string, Case6][];
}

/** Noun phrase: code, digits, header for display. */
interface Alt {
  code: string;
  parts: string[];
  slots: SlotKind[];
  anim: boolean;
}

type Part =
  | { type: 'np'; alt: Alt; kase: Case6 | 'prep' }
  | { type: 'pred'; form: 'V' | 'MV' | 'BV'; group: number }
  | { type: 'prep'; preps: [string, Case6][] }
  | { type: 'about' };

interface Template extends BaseTemplate<Slot> {
  parts: Part[];
}

const RADIX: Record<Exclude<SlotKind, 'verb' | 'inf' | 'prep'>, number> = {
  adj: ADJ.length, name: NAME.length, surG: SUR.length, surMF: 2 * SUR.length, fam: SUR.length, patr: PATR.length,
  prof: 2 * PROF.length, profSg: PROF.length, animal: 2 * ANIMAL.length, role: 2 * ROLE.length,
  obj: 2 * OBJ.length, place: PLACE.length, modal: 2 * MODAL.length, fixed: 1, about: 1,
};

const alt = (code: string, parts: string[], slots: SlotKind[], anim = true): Alt => ({ code, parts, slots, anim });
/** Same order as in gen_templates.py (doesn't affect capacity but is easy to compare). */
const PERSONS: Alt[] = [
  alt('N', ['Имя'], ['name']),
  alt('AN', ['Прил', 'Имя'], ['adj', 'name']),
  alt('NF', ['Имя', 'Фамилия'], ['name', 'surG']),
  alt('NP', ['Имя', 'Отчество'], ['name', 'patr']),
  alt('ANF', ['Прил', 'Имя', 'Фамилия'], ['adj', 'name', 'surG']),
  alt('NPF', ['Имя', 'Отчество', 'Фамилия'], ['name', 'patr', 'surG']),
  alt('F', ['Фамилия'], ['surMF']),
  alt('AF', ['Прил', 'Фамилия'], ['adj', 'surMF']),
  alt('Fam', ['Семья'], ['fam']),
  alt('AFam', ['Прил', 'Семья'], ['adj', 'fam']),
  alt('RF', ['Профессия', 'Фамилия'], ['profSg', 'surG']),
  alt('R', ['Профессия'], ['prof']),
  alt('AR', ['Прил', 'Профессия'], ['adj', 'prof']),
  alt('Z', ['Животное'], ['animal']),
  alt('AZ', ['Прил', 'Животное'], ['adj', 'animal']),
  alt('L', ['Роль'], ['role']),
  alt('AL', ['Прил', 'Роль'], ['adj', 'role']),
];
const OBJECTS: Alt[] = [alt('O', ['предмет'], ['obj'], false), alt('AO', ['Прил', 'предмет'], ['adj', 'obj'], false)];
const CITY = alt('City', ['Город'], ['place'], false);

const np = (a: Alt, kase: Case6 | 'prep'): Part => ({ type: 'np', alt: a, kase });
const pp = (preps: [string, Case6][], a: Alt): Part[] => [{ type: 'prep', preps }, np(a, 'prep')];
const P = dict.preps;

/** Objects of a group and the tails allowed after them (like arguments() in gen_templates.py). */
function argumentsOf(frame: string): [Part[] | null, (Part[] | null)[]][] {
  const tailPlace = [pp(P.placeTail, CITY)];
  const tailWhose = PERSONS.map((a) => [np(a, 'gent')]);
  const tailFor = PERSONS.map((a) => pp(P.for, a));
  const any = [...PERSONS, ...OBJECTS];
  switch (frame) {
    case 'acc:all':
      return OBJECTS.map((a) => [[np(a, 'accs')], [null, ...tailWhose, ...tailFor, ...tailPlace]]);
    case 'acc:person':
      return PERSONS.map((a) => [[np(a, 'accs')], [null, ...tailFor, ...tailPlace]]);
    case 'dat:person':
      return PERSONS.map((a) => [[np(a, 'datv')], [null, ...tailPlace]]);
    case 'ins:any':
      return any.map((a) => [[np(a, 'ablt')], [null, ...tailPlace]]);
    case 'about:any':
      return any.map((a) => [[{ type: 'about' }, np(a, 'loct')], [null, ...tailPlace]]);
    case 'motion':
      return [[null, [null]], ...any.map((a): [Part[], null[]] => [pp(P.motion, a), [null]]), [pp(P.motionPlace, CITY), [null]]];
    case 'stay':
      return [[null, [null]], ...any.map((a): [Part[], null[]] => [pp(P.stay, a), [null]]), [pp(P.stayPlace, CITY), [null]]];
    default:
      throw new Error(`unknown frame ${frame}`);
  }
}

function slotsOf(part: Part): Slot[] {
  switch (part.type) {
    case 'np':
      return part.alt.slots.map((kind) => ({ kind, radix: RADIX[kind as keyof typeof RADIX] }));
    case 'pred': {
      const n = GROUPS[part.group]!.verbs.length;
      if (part.form === 'V') return [{ kind: 'verb', radix: 2 * n, group: part.group }];
      if (part.form === 'MV') return [{ kind: 'modal', radix: RADIX.modal }, { kind: 'inf', radix: n, group: part.group }];
      return [{ kind: 'fixed', radix: 1 }, { kind: 'inf', radix: n, group: part.group }];
    }
    case 'prep':
      return [{ kind: 'prep', radix: part.preps.length, preps: part.preps }];
    case 'about':
      return [{ kind: 'about', radix: 1 }];
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
  // Nominal: one noun phrase in the nominative — «Лодки.», «Иван Петров.», «Свиные крылышки.»
  for (const a of [...PERSONS, ...OBJECTS]) add(-1, [np(a, 'nomn')]);
  GROUPS.forEach((group, gi) => {
    if (!group.verbs.length) return;
    for (const [arg, tails] of argumentsOf(group.frame)) {
      for (const tail of tails) {
        for (const form of ['V', 'MV', 'BV'] as const) {
          for (const subj of PERSONS) add(gi, [np(subj, 'nomn'), { type: 'pred', form, group: gi }, ...(arg ?? []), ...(tail ?? [])]);
        }
      }
    }
  });
  return out;
}

// --- rendering ---------------------------------------------------------------------------

const VOWELS = 'аеёиоуыэюя';
/** с -> со, к -> ко before a consonant cluster; о -> об before a vowel. */
function prepForm(prep: string, next: string): string {
  const w = next.toLowerCase();
  if (prep === 'с' && w.length > 1 && 'сзшж'.includes(w[0]!) && !VOWELS.includes(w[1]!)) return 'со';
  if (prep === 'к' && ['вс', 'вт', 'мн'].includes(w.slice(0, 2))) return 'ко';
  if (prep === 'о' && 'аоуэи'.includes(w[0] ?? '')) return 'об';
  return prep;
}
const PREP_VARIANTS: Record<string, string> = { со: 'с', ко: 'к', об: 'о', обо: 'о', подо: 'под', надо: 'над', передо: 'перед' };

/** A noun with the number in its digit: value = number·n + word. */
function numbered(list: { g: Gender; f: string[] }[], v: number, c: Case6) {
  const n = list.length;
  const num = Math.floor(v / n);
  const e = list[v % n]!;
  return { word: e.f[num * 6 + ci(c)]!, g: (num ? 'plur' : e.g) as Gender };
}

/** Noun phrase in case c by digits d. Returns the words and gender/number (for agreement). */
function renderNp(a: Alt, d: number[], c: Case6): { words: string[]; g: Gender } {
  const k = ci(c);
  const hasAdj = a.slots[0] === 'adj';
  const rest = hasAdj ? d.slice(1) : d;
  let words: string[];
  let g: Gender;
  const surOf = (lex: number, gender: Gender) => SUR[lex]![(gender === 'femn' ? 6 : gender === 'plur' ? 12 : 0) + k]!;
  switch (a.code.replace(/^A(?=[A-Z])/, '')) {
    case 'N':
    case 'NF':
    case 'NP':
    case 'NPF': {
      const n = NAME[rest[0]!]!;
      g = n.g;
      words = [n.f[k]!];
      if (a.slots.includes('patr')) words.push(PATR[rest[1]!]![(g === 'femn' ? 6 : 0) + k]!);
      if (a.slots.includes('surG')) words.push(surOf(rest[rest.length - 1]!, g));
      break;
    }
    case 'F': {
      const v = rest[0]!;
      g = v >= SUR.length ? 'femn' : 'masc';
      words = [surOf(v % SUR.length, g)];
      break;
    }
    case 'Fam':
      g = 'plur';
      words = [surOf(rest[0]!, g)];
      break;
    case 'RF': {
      const p = PROF[rest[0]!]!;
      g = p.g;
      words = [p.f[k]!, surOf(rest[1]!, g)];
      break;
    }
    case 'R':
    case 'Z':
    case 'L':
    case 'O': {
      const list = { R: PROF, Z: ANIMAL, L: ROLE, O: OBJ }[a.code.slice(-1) as 'R' | 'Z' | 'L' | 'O'];
      const x = numbered(list, rest[0]!, c);
      g = x.g;
      words = [x.word];
      break;
    }
    case 'City': {
      const p = PLACE[rest[0]!]!;
      g = p.g;
      words = [p.f[k]!];
      break;
    }
    default:
      throw new Error(`kind ${a.code}`);
  }
  if (hasAdj) words.unshift(agree(adjForms(d[0]!), g, c, a.anim));
  return { words, g };
}

const finite = (f: string[], tense: number, g: Gender) =>
  tense === 0 ? f[g === 'plur' ? 2 : 1]! : f[g === 'plur' ? 5 : g === 'femn' ? 4 : 3]!;

/** Words of a template by digits (lowercase, no full stop). */
function render(t: Template, digits: number[]): string[] {
  const words: string[] = [];
  let i = 0;
  let subj: Gender = 'masc';
  let prepCase: Case6 = 'nomn';
  let prepAt = -1;
  for (const part of t.parts) {
    switch (part.type) {
      case 'np': {
        const n = part.alt.slots.length;
        const c = part.kase === 'prep' ? prepCase : part.kase;
        const r = renderNp(part.alt, digits.slice(i, i + n), c);
        if (part.kase === 'nomn' && i === 0) subj = r.g;
        if (prepAt >= 0) {
          words[prepAt] = prepForm(words[prepAt]!, r.words[0]!);
          prepAt = -1;
        }
        words.push(...r.words);
        i += n;
        break;
      }
      case 'pred': {
        const verbs = GROUPS[part.group]!.verbs;
        if (part.form === 'V') {
          const v = digits[i++]!;
          words.push(finite(VERB[verbs[v % verbs.length]!]!, Math.floor(v / verbs.length), subj));
        } else {
          if (part.form === 'MV') {
            const m = digits[i++]!;
            words.push(finite(MODAL[m % MODAL.length]!, Math.floor(m / MODAL.length), subj));
          } else {
            i += 1;
            words.push(subj === 'plur' ? 'будут' : 'будет');
          }
          words.push(VERB[verbs[digits[i++]!]!]![0]!);
        }
        break;
      }
      case 'prep': {
        const [prep, c] = part.preps[digits[i++]!]!;
        prepCase = c;
        prepAt = words.length;
        words.push(prep);
        break;
      }
      case 'about':
        i += 1;
        prepCase = 'loct';
        prepAt = words.length;
        words.push('о');
        break;
    }
  }
  return words;
}

/** Template in words: «[Прил] [Фамилия И.п.] [глагол «что» наст.|прош.] …». */
function pattern(t: Template): string {
  const out: string[] = [];
  let label = '';
  for (const part of t.parts) {
    if (part.type === 'np') {
      const c = part.kase === 'prep' ? label : CASE_RU[part.kase];
      out.push(...part.alt.parts.map((p) => (p === 'Прил' ? '[Прил]' : `[${p} ${c}]`)));
    } else if (part.type === 'pred') {
      const g = `глагол «${GROUPS[part.group]!.name}»`;
      out.push(part.form === 'V' ? `[${g}]` : part.form === 'MV' ? `[модальный] [${g} инф.]` : `[будет] [${g} инф.]`);
    } else if (part.type === 'prep') {
      label = [...new Set(part.preps.map(([, c]) => CASE_RU[c]))].join('/');
      out.push(`[${part.preps.map(([p]) => p).join('|')}]`);
    } else {
      label = CASE_RU.loct;
      out.push('[о]');
    }
  }
  return out.join(' ');
}

// --- parsing -----------------------------------------------------------------------------

const PREP_IDS = new Map<string, number>();

function forms(add: (form: string, r: Reading) => void) {
  ADJ.forEach((_, i) => new Set(Object.values(adjForms(i))).forEach((f) => add(f, { kind: 'adj', lex: i, gram: 0 })));
  NAME.forEach((e, i) => e.f.forEach((f) => add(f, { kind: 'name', lex: i, gram: 0 })));
  SUR.forEach((fs, i) => fs.forEach((f, j) => add(f, { kind: 'sur', lex: i, gram: Math.floor(j / 6) })));
  PATR.forEach((fs, i) => fs.forEach((f, j) => add(f, { kind: 'patr', lex: i, gram: Math.floor(j / 6) })));
  const nouns: [string, { f: string[] }[]][] = [['prof', PROF], ['animal', ANIMAL], ['role', ROLE], ['obj', OBJ], ['place', PLACE]];
  for (const [kind, list] of nouns) list.forEach((e, i) => e.f.forEach((f, j) => add(f, { kind, lex: i, gram: Math.floor(j / 6) })));
  const tense = (j: number) => (j === 0 ? -1 : j <= 2 ? 0 : 1);
  VERB.forEach((fs, i) => fs.forEach((f, j) => add(f, { kind: 'verb', lex: i, gram: tense(j) })));
  MODAL.forEach((fs, i) => fs.forEach((f, j) => j && add(f, { kind: 'modal', lex: i, gram: tense(j) })));
  ['будет', 'будут'].forEach((f) => add(f, { kind: 'fixed', lex: 0, gram: 0 }));
  const preps = new Set(['о', ...Object.values(P).flatMap((l) => l.map(([p]) => p))]);
  for (const p of preps) {
    PREP_IDS.set(p, PREP_IDS.size);
    add(p, { kind: 'prep', lex: PREP_IDS.get(p)!, gram: 0 });
  }
  for (const [v, p] of Object.entries(PREP_VARIANTS)) if (PREP_IDS.has(p)) add(v, { kind: 'prep', lex: PREP_IDS.get(p)!, gram: 0 });
}

/** Digit values by reading. strict — only the grammatical form the word has. */
function values(slot: Slot, r: Reading, strict: boolean): number[] {
  const both = (n: number, g: number) => (strict ? (g === 0 || g === 1 ? [g * n + r.lex] : []) : [r.lex, n + r.lex]);
  switch (slot.kind) {
    case 'adj':
    case 'name':
    case 'patr':
    case 'place':
    case 'profSg':
      return [r.lex];
    case 'surG':
      return !strict || r.gram < 2 ? [r.lex] : [];
    case 'fam':
      return !strict || r.gram === 2 ? [r.lex] : [];
    case 'surMF':
      return both(SUR.length, r.gram);
    case 'prof':
      return both(PROF.length, r.gram);
    case 'animal':
      return both(ANIMAL.length, r.gram);
    case 'role':
      return both(ROLE.length, r.gram);
    case 'obj':
      return both(OBJ.length, r.gram);
    case 'verb': {
      const pos = GROUP_POS[slot.group!]!.get(r.lex);
      if (pos === undefined) return [];
      return both(GROUPS[slot.group!]!.verbs.length, r.gram).map((v) => v - r.lex + pos);
    }
    case 'inf': {
      const pos = GROUP_POS[slot.group!]!.get(r.lex);
      return pos === undefined || (strict && r.gram !== -1) ? [] : [pos];
    }
    case 'modal':
      return both(MODAL.length, r.gram);
    case 'fixed':
      return [0];
    case 'prep': {
      const word = [...PREP_IDS].find(([, id]) => id === r.lex)?.[0];
      const i = slot.preps!.findIndex(([p]) => p === word);
      return i < 0 ? [] : [i];
    }
    case 'about':
      return r.lex === PREP_IDS.get('о') ? [0] : [];
  }
}

export const grammar: Grammar<Slot, Template> = {
  lang: 'ru',
  // Left over from the project's working title: changing it changes every phrase.
  tag: 'mem-phrase/v3',
  maxWords: dict.maxWords,
  templates: buildTemplates(),
  render,
  forms,
  reading: (slot) => READING[slot.kind],
  values,
  key,
  tokenize,
  same: (k) => PREP_VARIANTS[k] ?? k,
  pattern,
  groupName: (group) => (group < 0 ? 'назывное' : GROUPS[group]!.name),
  kindSize: {
    adj: ADJ.length, name: NAME.length, sur: SUR.length, patr: PATR.length, prof: PROF.length, animal: ANIMAL.length,
    role: ROLE.length, obj: OBJ.length, place: PLACE.length, verb: VERB.length, modal: MODAL.length, fixed: 1, prep: 30,
  },
  sizes: {
    adj: ADJ.length, name: NAME.length, surname: SUR.length, patronymic: PATR.length, profession: PROF.length,
    role: ROLE.length, animal: ANIMAL.length, object: OBJ.length, place: PLACE.length, verb: VERB.length,
  },
};
