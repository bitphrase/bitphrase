/**
 * Interface language. Messages are written in place as tr('по-русски', 'in English'),
 * so both versions stay next to each other; the page switches the language with setUiLang.
 */
export type UiLang = 'ru' | 'en';
export const UI_LANGS: UiLang[] = ['ru', 'en'];

let current: UiLang = 'ru';

export const uiLang = (): UiLang => current;
export function setUiLang(lang: UiLang) {
  current = lang;
}

/** The message in the current interface language. */
export const tr = (ru: string, en: string): string => (current === 'en' ? en : ru);

/** Russian plural: 1 слово, 2 слова, 5 слов. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

/** "5 words" / «5 слов» in the current language. */
export const count = (n: number, en: [string, string], ru: [string, string, string]) =>
  current === 'en' ? `${n} ${n === 1 ? en[0] : en[1]}` : `${n} ${pluralRu(n, ...ru)}`;

/** Number in the interface's locale: 1 234 / 1,234. */
export const num = (n: number, digits = 0) => n.toLocaleString(current, { maximumFractionDigits: digits });
