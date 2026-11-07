/**
 * Adjective declension from the lemma: rules from Plan_1 §6.1 (same algorithm as
 * tools/data/check_adj_rules.py; tests/morph.mjs checks it against the whole reference
 * data/morph/verified_adj.tsv). Nouns and verbs are not declined here:
 * their forms are stored ready-made in the dictionary, taken from the verified reference.
 */

export type Gender = 'masc' | 'neut' | 'femn' | 'plur';
export type Case = 'nomn' | 'gent' | 'datv' | 'accs' | 'ablt' | 'loct';

/** Keys as in the reference: "masc:gent", "plur:accs:anim", "femn:accs". */
export type Declension = Record<string, string>;

const HARD: Record<Gender, [string, string][]> = {
  masc: [['nomn', 'ый'], ['gent', 'ого'], ['datv', 'ому'], ['accs:inan', 'ый'], ['accs:anim', 'ого'], ['ablt', 'ым'], ['loct', 'ом']],
  neut: [['nomn', 'ое'], ['gent', 'ого'], ['datv', 'ому'], ['accs', 'ое'], ['ablt', 'ым'], ['loct', 'ом']],
  femn: [['nomn', 'ая'], ['gent', 'ой'], ['datv', 'ой'], ['accs', 'ую'], ['ablt', 'ой'], ['loct', 'ой']],
  plur: [['nomn', 'ые'], ['gent', 'ых'], ['datv', 'ым'], ['accs:inan', 'ые'], ['accs:anim', 'ых'], ['ablt', 'ыми'], ['loct', 'ых']],
};
const SOFT_FIRST: Record<string, string> = { ы: 'и', о: 'е', а: 'я', у: 'ю' };
const VELAR = 'гкх';
const SIBILANT = 'жшчщ';

/** All forms of the adjective, or null if the lemma is outside the rules (not -ой/-ый/-ий). */
export function decline(lemma: string): Declension | null {
  let stressed: boolean;
  let soft: boolean;
  if (lemma.endsWith('ой')) {
    stressed = true;
    soft = false;
  } else if (lemma.endsWith('ый')) {
    stressed = false;
    soft = false;
  } else if (lemma.endsWith('ий')) {
    stressed = false;
    const before = lemma.at(-3) ?? '';
    soft = !(VELAR + SIBILANT).includes(before);
  } else {
    return null;
  }
  const stem = lemma.slice(0, -2);
  const last = stem.at(-1) ?? '';
  const out: Declension = {};
  for (const gender of Object.keys(HARD) as Gender[]) {
    for (const [cell, ending] of HARD[gender]) {
      const key = `${gender}:${cell}`;
      if (gender === 'masc' && (cell === 'nomn' || cell === 'accs:inan')) {
        out[key] = lemma;
        continue;
      }
      let first = ending[0] ?? '';
      const rest = ending.slice(1);
      if (soft) {
        first = SOFT_FIRST[first] ?? first;
      } else {
        // After г/к/х/ж/ш/ч/щ: "и", not "ы"; after unstressed ж/ш/ч/щ/ц: "е", not "о".
        if (first === 'ы' && (VELAR + SIBILANT).includes(last)) first = 'и';
        if (first === 'о' && !stressed && (SIBILANT + 'ц').includes(last)) first = 'е';
      }
      out[key] = stem + first + rest;
    }
  }
  return out;
}

/**
 * Adjective form agreeing with the noun: gender (or plural), case, and
 * animacy (for the accusative of masculine and plural).
 */
export function agree(forms: Declension, gender: Gender, kase: Case, animate: boolean): string {
  let key = `${gender}:${kase}`;
  if (kase === 'accs' && (gender === 'masc' || gender === 'plur')) key += animate ? ':anim' : ':inan';
  const form = forms[key];
  if (form === undefined) throw new Error(`no form ${key}`);
  return form;
}
