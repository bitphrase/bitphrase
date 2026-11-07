/** Phrase languages: one codec per grammar, and the language a phrase is written in. */
import { createCodec, type Codec, type Grammar } from '../core/engine';
import { grammar as en } from './en/grammar';
import { grammar as ru } from './ru/grammar';

export type Lang = 'ru' | 'en';
export const LANGS: Lang[] = ['ru', 'en'];
const GRAMMARS: Record<Lang, Grammar<any, any>> = { ru, en };

const codecs = new Map<Lang, Codec>();
/** Codec of a language; built on first use (templates and schemes take a moment). */
export function codec(lang: Lang): Codec {
  let c = codecs.get(lang);
  if (!c) codecs.set(lang, (c = createCodec(GRAMMARS[lang])));
  return c;
}

/**
 * Language of a phrase by its letters: Cyrillic — Russian, Latin — English. Look-alike
 * letters (a, c, e, o…) don't count; with no telling letters — fallback.
 */
export function detectLang(text: string, fallback: Lang): Lang {
  let cyr = 0;
  let lat = 0;
  for (const ch of text.toLowerCase()) {
    if (/[а-яё]/.test(ch) && !'асеорхукнмтв'.includes(ch)) cyr += 1;
    else if (/[a-z]/.test(ch) && !'aceopxykhmtb'.includes(ch)) lat += 1;
  }
  if (cyr === lat) return fallback;
  return cyr > lat ? 'ru' : 'en';
}
