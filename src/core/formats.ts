/**
 * Value formats ↔ "bare" bytes: bank card, phone, car plate, crypto phrase (BIP39,
 * unchecked BIP39 words, Monero), password/text, HEX, Base64.
 *
 * The bytes are as short as possible (fewer bytes — shorter phrase):
 *   card     — digits without the check digit (Luhn restores it): 16 digits → 7 bytes;
 *   phone    — digits with the country code: +7 912 345-67-89 → 5 bytes;
 *   RU plate — letters, digits and region as one number: А123ВС 77 → 4 bytes;
 *   BIP39    — entropy without the checksum: 12 words → 16 bytes, 24 → 32;
 *   address  — network number and key/hash without the checksum: Bitcoin, Ethereum → 21 bytes;
 *   password — the narrowest alphabet covering the text (Latin and symbols, + Cyrillic,
 *              otherwise UTF-8), length encoded in the number (bijective numeration).
 * Digit strings (card, phone) — the number 10^k + digits: keeps leading zeros and length.
 */
import bip39Raw from './wordlists/bip39-en.json';
import moneroRaw from './wordlists/monero-en.json';
import { addressExample, addressFromBytes, addressToBytes } from './address';
import { crc32, sha256 } from './hash';
import { count, tr } from './i18n';

export type FormatId = 'card' | 'phone' | 'plate' | 'seed' | 'address' | 'text' | 'hex' | 'base64';

export interface Format {
  id: FormatId;
  title: string;
  /** Subtypes (for crypto phrases and car plates). */
  subs: { id: string; title: string }[];
  placeholder: Record<string, string>;
}

export const MAX_FORMAT_BYTES = 100;

/** The formats with titles and placeholders in the current interface language. */
export function formats(): Format[] {
  return [
    { id: 'card', title: tr('Банковская карта', 'Bank card'), subs: [], placeholder: { '': '2200 1234 5678 9010' } },
    { id: 'phone', title: tr('Номер телефона', 'Phone number'), subs: [], placeholder: { '': '+7 912 345-67-89' } },
    {
      id: 'plate',
      title: tr('Номер автомобиля', 'Car plate'),
      subs: [
        { id: 'ru', title: tr('Россия: А123ВС 77', 'Russia: А123ВС 77') },
        { id: 'any', title: tr('Другой формат (как текст)', 'Other format (as text)') },
      ],
      placeholder: { ru: 'А123ВС 777', any: 'AB 1234 CD' },
    },
    {
      id: 'seed',
      title: tr('Крипто-фраза кошелька', 'Wallet seed phrase'),
      subs: [
        { id: 'bip39', title: tr('BIP39: 12, 15, 18, 21 или 24 слова (Bitcoin, Ethereum и большинство кошельков)', 'BIP39: 12, 15, 18, 21 or 24 words (Bitcoin, Ethereum and most wallets)') },
        { id: 'bip39-raw', title: tr('Слова BIP39 без проверки суммы (Electrum и др.), любое число слов', 'BIP39 words without checksum (Electrum etc.), any number of words') },
        { id: 'monero', title: tr('Monero: 25 слов', 'Monero: 25 words') },
      ],
      placeholder: {
        bip39: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
        'bip39-raw': tr('слова из списка BIP39 через пробел', 'words from the BIP39 list, separated by spaces'),
        monero: tr('25 слов Monero через пробел', '25 Monero words, separated by spaces'),
      },
    },
    { id: 'address', title: tr('Адрес криптокошелька', 'Crypto wallet address'), subs: [], placeholder: { '': tr('bc1q… · 0x… · T… · адрес Bitcoin, Ethereum, Tron, Solana, TON…', 'bc1q… · 0x… · T… · Bitcoin, Ethereum, Tron, Solana, TON… address') } },
    { id: 'text', title: tr('Пароль или текст', 'Password or text'), subs: [], placeholder: { '': tr('Любые символы: Мурзик_2024! или Tr0ub4dor&3', 'Any characters: Tr0ub4dor&3 or Мурзик_2024!') } },
    { id: 'hex', title: tr('Байты в HEX', 'Bytes in HEX'), subs: [], placeholder: { '': '0123456789abcdef' } },
    { id: 'base64', title: tr('Байты в Base64', 'Bytes in Base64'), subs: [], placeholder: { '': 'ASNFZ4mrze8=' } },
  ];
}

export type ToBytes = { ok: true; bytes: Uint8Array; note: string } | { ok: false; error: string };
export type FromBytes = { ok: true; value: string; note: string } | { ok: false; error: string };

// --- numbers and bytes --------------------------------------------------------------

function bigToBytes(n: bigint, size = 0): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const len = Math.max(size, hex.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < hex.length / 2; i += 1) out[len - hex.length / 2 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}
const tooLong = (b: Uint8Array): ToBytes | null =>
  b.length > MAX_FORMAT_BYTES ? { ok: false, error: tr(`Получилось ${b.length} байт — больше ${MAX_FORMAT_BYTES}.`, `That is ${b.length} bytes — more than ${MAX_FORMAT_BYTES}.`) } : null;
const ok = (bytes: Uint8Array, note: string): ToBytes => tooLong(bytes) ?? { ok: true, bytes, note };

/** Digit string → number 10^k + digits → bytes (leading zeros and length are kept). */
function digitsToBytes(d: string): Uint8Array {
  return bigToBytes(10n ** BigInt(d.length) + BigInt(d || '0'));
}
function bytesToDigits(b: Uint8Array): string | null {
  const s = bytesToBig(b).toString();
  return s[0] === '1' ? s.slice(1) : null;
}

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const randomInt = (n: number) => Math.floor((crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32) * n);
const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('');

// --- bank card ----------------------------------------------------------------------

/** Luhn check digit for a number without it. */
export function luhnDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i += 1) {
    let d = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function cardBrand(n: string): string {
  const p4 = Number(n.slice(0, 4));
  if (p4 >= 2200 && p4 <= 2204) return tr('Мир', 'Mir');
  if (n.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(n) || (p4 >= 2221 && p4 <= 2720)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'American Express';
  if (/^62/.test(n)) return 'UnionPay';
  if (/^35(2[89]|[3-8])/.test(n)) return 'JCB';
  if (/^(5[06-9]|6)/.test(n)) return 'Maestro';
  return '';
}

/**
 * Card digits grouped as on the card itself: by 4, American Express (34…, 37…) — 4-6-5.
 * Also works for a partially typed number (during input).
 */
export function formatCard(n: string): string {
  if (/^3[47]/.test(n) && n.length <= 15) return [n.slice(0, 4), n.slice(4, 10), n.slice(10)].filter(Boolean).join(' ');
  return n.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function cardToBytes(input: string): ToBytes {
  if (!/^[\d\s-]+$/.test(input.trim())) return { ok: false, error: tr('В номере карты — только цифры (пробелы и дефисы можно).', 'A card number contains only digits (spaces and hyphens are fine).') };
  const n = input.replace(/\D/g, '');
  if (n.length < 12 || n.length > 19) return { ok: false, error: tr(`Цифр ${n.length}, а в номере карты их 12–19 (обычно 16).`, `A card number has 12–19 digits (usually 16), not ${n.length}.`) };
  if (luhnDigit(n.slice(0, -1)) !== Number(n.at(-1))) {
    return { ok: false, error: tr('Номер не проходит проверку целостности (алгоритм Луна): вероятно, ошибка в цифре.', 'The number fails the integrity check (Luhn algorithm): probably a wrong digit.') };
  }
  const brand = cardBrand(n);
  return ok(digitsToBytes(n.slice(0, -1)), `${brand ? `${brand}, ` : ''}${tr(`${n.length} цифр, контрольная цифра верна (в байты не входит — восстанавливается).`, `${n.length} digits, check digit is valid (not stored in the bytes — it is restored).`)}`);
}

function cardFromBytes(b: Uint8Array): FromBytes {
  const payload = bytesToDigits(b);
  if (payload === null || payload.length < 11 || payload.length > 18) return { ok: false, error: tr('Эти байты — не номер карты.', 'These bytes are not a card number.') };
  const n = payload + luhnDigit(payload);
  const brand = cardBrand(n);
  return { ok: true, value: formatCard(n), note: `${brand ? `${brand}, ` : ''}${tr(`${n.length} цифр; контрольная цифра восстановлена.`, `${n.length} digits; check digit restored.`)}` };
}

function cardExample(): string {
  const prefix = ['4', '51', '53', '55', '2200', '2202'][randomInt(6)]!;
  const payload = prefix + randomDigits(15 - prefix.length);
  return formatCard(payload + luhnDigit(payload));
}

// --- phone --------------------------------------------------------------------------

function formatPhone(d: string): string {
  if (d.length === 11 && d[0] === '7') return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return `+${d}`;
}

function phoneToBytes(input: string): ToBytes {
  const t = input.trim();
  if (!/^\+?[\d\s()\-.]+$/.test(t)) return { ok: false, error: tr('В номере телефона — цифры, «+» в начале, пробелы, скобки и дефисы.', 'A phone number contains digits, a leading "+", spaces, parentheses and hyphens.') };
  let d = t.replace(/\D/g, '');
  let note = '';
  if (!t.startsWith('+') && d.length === 11 && d[0] === '8') {
    d = `7${d.slice(1)}`;
    note = tr('«8» в начале заменена на «+7». ', 'Leading "8" replaced with "+7". ');
  } else if (!t.startsWith('+') && d.length === 10 && d[0] === '9') {
    d = `7${d}`;
    note = tr('Добавлен код страны +7. ', 'Country code +7 added. ');
  }
  if (d.length < 7 || d.length > 15) return { ok: false, error: tr(`Цифр ${d.length}, а в номере с кодом страны их 7–15.`, `A number with the country code has 7–15 digits, not ${d.length}.`) };
  return ok(digitsToBytes(d), `${note}${tr('Номер', 'Number')}: ${formatPhone(d)}.`);
}

function phoneFromBytes(b: Uint8Array): FromBytes {
  const d = bytesToDigits(b);
  if (d === null || d.length < 7 || d.length > 15) return { ok: false, error: tr('Эти байты — не номер телефона.', 'These bytes are not a phone number.') };
  return { ok: true, value: formatPhone(d), note: tr(`${d.length} цифр с кодом страны.`, `${d.length} digits with the country code.`) };
}

// --- car plate (Russia) ---------------------------------------------------------------

const PLATE_LETTERS = 'АВЕКМНОРСТУХ';
const PLATE_LATIN: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const PLATE_SPACE = 12 * 1000 * 12 * 12 * 1000;

function plateToBytes(input: string): ToBytes {
  const t = input.toUpperCase().replace(/[\s-]/g, '').replace(/[ABEKMHOPCTYX]/g, (c) => PLATE_LATIN[c]!);
  const m = /^([АВЕКМНОРСТУХ])(\d{3})([АВЕКМНОРСТУХ])([АВЕКМНОРСТУХ])(\d{2}|[1-9]\d{2})$/.exec(t);
  if (!m) return { ok: false, error: tr(`Ожидается номер вида А123ВС 77 или А123ВС 777 (буквы ${PLATE_LETTERS}).`, `Expected a plate like А123ВС 77 or А123ВС 777 (letters ${PLATE_LETTERS}).`) };
  const [, l1, num, l2, l3, region] = m;
  const v = ((((PLATE_LETTERS.indexOf(l1!) * 1000 + Number(num)) * 12 + PLATE_LETTERS.indexOf(l2!)) * 12 + PLATE_LETTERS.indexOf(l3!)) * 1000) + Number(region);
  return ok(bigToBytes(BigInt(v), 4), tr(`Номер ${l1}${num}${l2}${l3} ${region}: буквы, цифры и регион — одним числом в 4 байтах.`, `Plate ${l1}${num}${l2}${l3} ${region}: letters, digits and region as one number in 4 bytes.`));
}

function plateFromBytes(b: Uint8Array): FromBytes {
  let v = Number(bytesToBig(b));
  if (b.length !== 4 || v >= PLATE_SPACE) return { ok: false, error: tr('Эти байты — не российский номер автомобиля.', 'These bytes are not a Russian car plate.') };
  const region = v % 1000;
  v = Math.floor(v / 1000);
  const l3 = v % 12;
  v = Math.floor(v / 12);
  const l2 = v % 12;
  v = Math.floor(v / 12);
  const num = v % 1000;
  const l1 = Math.floor(v / 1000);
  const r = region < 100 ? String(region).padStart(2, '0') : String(region);
  return { ok: true, value: `${PLATE_LETTERS[l1]}${String(num).padStart(3, '0')}${PLATE_LETTERS[l2]}${PLATE_LETTERS[l3]} ${r}`, note: tr('Российский номер.', 'Russian plate.') };
}

function plateExample(): string {
  const L = () => PLATE_LETTERS[randomInt(12)];
  const regions = ['77', '177', '777', '97', '50', '750', '78', '178', '16', '116', '66', '54', '23', '123', '61', '02', '102'];
  return `${L()}${String(1 + randomInt(999)).padStart(3, '0')}${L()}${L()} ${regions[randomInt(regions.length)]}`;
}

// --- crypto phrases -------------------------------------------------------------------

const BIP39 = (bip39Raw as { words: string }).words.split(' ');
const BIP39_IX = new Map(BIP39.map((w, i) => [w, i]));
/** BIP39 words are unique by their first 4 letters — they are often written down that way. */
const BIP39_P4 = new Map(BIP39.map((w, i) => [w.slice(0, 4), i]));
const MONERO = (moneroRaw as { words: string }).words.split(' ');
const MONERO_P3 = new Map(MONERO.map((w, i) => [w.slice(0, 3), i]));

const seedWords = (input: string) => input.toLowerCase().normalize('NFKD').split(/[\s,]+/).filter(Boolean);

function bipIndexes(words: string[]): number[] | string {
  const out: number[] = [];
  for (const [i, w] of words.entries()) {
    const ix = BIP39_IX.get(w) ?? (w.length >= 4 ? BIP39_P4.get(w.slice(0, 4)) : undefined);
    if (ix === undefined) return tr(`Слово ${i + 1} «${w}» нет в списке BIP39 (английский).`, `Word ${i + 1} "${w}" is not in the BIP39 list (English).`);
    out.push(ix);
  }
  return out;
}

const BIP39_LENGTHS = [12, 15, 18, 21, 24];

/** BIP39 checksum bits: the first ENT/32 bits of the entropy's SHA-256. */
const bipChecksum = (entropy: Uint8Array) => sha256(entropy)[0]! >> (8 - (entropy.length * 8) / 32);

function bip39ToBytes(input: string): ToBytes {
  const words = seedWords(input);
  if (!BIP39_LENGTHS.includes(words.length)) return { ok: false, error: tr(`Слов ${words.length}, а во фразе BIP39 их 12, 15, 18, 21 или 24.`, `A BIP39 phrase has 12, 15, 18, 21 or 24 words, not ${words.length}.`) };
  const ix = bipIndexes(words);
  if (typeof ix === 'string') return { ok: false, error: ix };
  const v = ix.reduce((acc, i) => (acc << 11n) | BigInt(i), 0n);
  const cs = words.length / 3;
  const entropy = bigToBytes(v >> BigInt(cs), (words.length * 4) / 3);
  if (Number(v & ((1n << BigInt(cs)) - 1n)) !== bipChecksum(entropy)) {
    return {
      ok: false,
      error: tr(
        'Контрольная сумма BIP39 не сходится — вероятно, ошибка в слове или порядке слов. Если фраза из Electrum, выберите «Слова BIP39 без проверки суммы».',
        'The BIP39 checksum does not match — probably a wrong word or word order. If the phrase is from Electrum, choose "BIP39 words without checksum".',
      ),
    };
  }
  return ok(entropy, tr(`${words.length} слов BIP39, контрольная сумма верна. В байты входит только энтропия (${entropy.length * 8} бит) — сумма восстанавливается.`, `${words.length} BIP39 words, checksum is valid. Only the entropy (${entropy.length * 8} bits) is stored in the bytes — the checksum is restored.`));
}

function bip39FromBytes(b: Uint8Array): FromBytes {
  if (![16, 20, 24, 28, 32].includes(b.length)) return { ok: false, error: tr(`Байт ${b.length}, а у фразы BIP39 их 16, 20, 24, 28 или 32.`, `A BIP39 phrase has 16, 20, 24, 28 or 32 bytes, not ${b.length}.`) };
  const cs = (b.length * 8) / 32;
  let v = (bytesToBig(b) << BigInt(cs)) | BigInt(bipChecksum(b));
  const n = (b.length * 8 + cs) / 11;
  const words: string[] = [];
  for (let i = 0; i < n; i += 1) {
    words.unshift(BIP39[Number(v & 2047n)]!);
    v >>= 11n;
  }
  return { ok: true, value: words.join(' '), note: tr(`${n} слов BIP39, контрольная сумма восстановлена.`, `${n} BIP39 words, checksum restored.`) };
}

function bipRawToBytes(input: string): ToBytes {
  const words = seedWords(input);
  if (!words.length) return { ok: false, error: tr('Нет ни одного слова.', 'No words.') };
  const ix = bipIndexes(words);
  if (typeof ix === 'string') return { ok: false, error: ix };
  const v = ix.reduce((acc, i) => (acc * 2048n) + BigInt(i), 0n);
  return ok(bigToBytes(v, Math.ceil((11 * words.length) / 8)), tr(`${words.length} слов из списка BIP39, по 11 бит; сумма не проверяется.`, `${count(words.length, ['word', 'words'], ['слово', 'слова', 'слов'])} from the BIP39 list, 11 bits each; no checksum is verified.`));
}

function bipRawFromBytes(b: Uint8Array): FromBytes {
  const n = Math.floor((8 * b.length) / 11);
  let v = bytesToBig(b);
  if (n < 1 || v >= 2048n ** BigInt(n)) return { ok: false, error: tr('Эти байты — не слова BIP39.', 'These bytes are not BIP39 words.') };
  const words: string[] = [];
  for (let i = 0; i < n; i += 1) {
    words.unshift(BIP39[Number(v % 2048n)]!);
    v /= 2048n;
  }
  return { ok: true, value: words.join(' '), note: tr(`${n} слов из списка BIP39.`, `${count(n, ['word', 'words'], ['слово', 'слова', 'слов'])} from the BIP39 list.`) };
}

const moneroChecksum = (words: string[]) => words[crc32(new TextEncoder().encode(words.map((w) => w.slice(0, 3)).join(''))) % words.length]!;

function moneroToBytes(input: string): ToBytes {
  const words = seedWords(input);
  if (words.length !== 24 && words.length !== 25) return { ok: false, error: tr(`Слов ${words.length}, а во фразе Monero их 25 (или 24 без контрольного).`, `A Monero phrase has 25 words (or 24 without the checksum word), not ${words.length}.`) };
  const ix: number[] = [];
  for (const [i, w] of words.entries()) {
    const k = MONERO_P3.get(w.slice(0, 3));
    if (k === undefined || (w.length > 3 && !MONERO[k]!.startsWith(w) && w !== MONERO[k])) return { ok: false, error: tr(`Слово ${i + 1} «${w}» нет в списке Monero (английский).`, `Word ${i + 1} "${w}" is not in the Monero list (English).`) };
    ix.push(k);
  }
  const full = ix.slice(0, 24).map((k) => MONERO[k]!);
  if (words.length === 25 && moneroChecksum(full).slice(0, 3) !== words[24]!.slice(0, 3)) {
    return { ok: false, error: tr('Контрольное (25-е) слово Monero не сходится — вероятно, ошибка в слове.', 'The Monero checksum (25th) word does not match — probably a wrong word.') };
  }
  const n = MONERO.length;
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) {
    const [w1, w2, w3] = [ix[3 * i]!, ix[3 * i + 1]!, ix[3 * i + 2]!];
    const val = w1 + n * ((n - w1 + w2) % n) + n * n * ((n - w2 + w3) % n);
    if (val % n !== w1 || val >= 2 ** 32) return { ok: false, error: tr(`Слова ${3 * i + 1}–${3 * i + 3} не складываются в ключ Monero.`, `Words ${3 * i + 1}–${3 * i + 3} do not form a Monero key.`) };
    view.setUint32(i * 4, val, true);
  }
  return ok(
    out,
    tr(
      `${words.length} слов Monero${words.length === 25 ? ', контрольное слово верно' : ''}. В байтах — 32-байтный ключ, контрольное слово восстанавливается.`,
      `${words.length} Monero words${words.length === 25 ? ', checksum word is valid' : ''}. The bytes hold the 32-byte key; the checksum word is restored.`,
    ),
  );
}

function moneroFromBytes(b: Uint8Array): FromBytes {
  if (b.length !== 32) return { ok: false, error: tr(`Байт ${b.length}, а у ключа Monero их 32.`, `A Monero key has 32 bytes, not ${b.length}.`) };
  const n = MONERO.length;
  const view = new DataView(b.buffer, b.byteOffset, 32);
  const words: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const val = view.getUint32(i * 4, true);
    const w1 = val % n;
    const w2 = (Math.floor(val / n) + w1) % n;
    const w3 = (Math.floor(Math.floor(val / n) / n) + w2) % n;
    words.push(MONERO[w1]!, MONERO[w2]!, MONERO[w3]!);
  }
  words.push(moneroChecksum(words));
  return { ok: true, value: words.join(' '), note: tr('25 слов Monero, контрольное слово восстановлено.', '25 Monero words, checksum word restored.') };
}

// --- password / text ------------------------------------------------------------------

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const RUS = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const ALPHABETS = [ASCII, ASCII + RUS];
const modeNote = (mode: number) =>
  [
    tr('латиница, цифры и знаки — 6,6 бита на символ', 'Latin letters, digits and symbols — 6.6 bits per character'),
    tr('латиница, кириллица, цифры и знаки — 7,3 бита на символ', 'Latin and Cyrillic letters, digits and symbols — 7.3 bits per character'),
    tr('любые символы (UTF-8)', 'any characters (UTF-8)'),
  ][mode]!;

function textToBytes(input: string): ToBytes {
  const text = input.normalize('NFC');
  if (!text) return { ok: false, error: tr('Пустой текст.', 'Empty text.') };
  const chars = [...text];
  let mode = ALPHABETS.findIndex((a) => chars.every((c) => a.includes(c)));
  let symbols: number[];
  let base: bigint;
  if (mode >= 0) {
    symbols = chars.map((c) => ALPHABETS[mode]!.indexOf(c));
    base = BigInt(ALPHABETS[mode]!.length);
  } else {
    mode = 2;
    symbols = [...new TextEncoder().encode(text)];
    base = 256n;
  }
  // Bijective numeration: the length is encoded in the number itself, leading symbols are not lost.
  const v = symbols.reduce((acc, s) => acc * base + BigInt(s + 1), 0n);
  return ok(bigToBytes(v * 3n + BigInt(mode)), `${tr(`${chars.length} символов`, count(chars.length, ['character', 'characters'], ['символ', 'символа', 'символов']))}: ${modeNote(mode)}.`);
}

function textFromBytes(b: Uint8Array): FromBytes {
  const n = bytesToBig(b);
  const mode = Number(n % 3n);
  let v = n / 3n;
  if (!v) return { ok: false, error: tr('Эти байты — не текст.', 'These bytes are not text.') };
  const base = mode === 2 ? 256n : BigInt(ALPHABETS[mode]!.length);
  const symbols: number[] = [];
  while (v > 0n) {
    let r = v % base;
    if (r === 0n) r = base;
    symbols.unshift(Number(r) - 1);
    v = (v - r) / base;
  }
  if (mode < 2) return { ok: true, value: symbols.map((s) => ALPHABETS[mode]![s]).join(''), note: modeNote(mode) };
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(symbols)), note: modeNote(2) };
  } catch {
    return { ok: false, error: tr('Эти байты — не текст.', 'These bytes are not text.') };
  }
}

function textExample(): string {
  const words = ['Мурзик', 'Tiger', 'Луна', 'Sunny', 'Ёжик', 'Rocket', 'Пельмень', 'Dragon'];
  const signs = '!@#$%&*_-+?';
  return `${words[randomInt(words.length)]}${signs[randomInt(signs.length)]}${1950 + randomInt(80)}`;
}

// --- HEX and Base64 -------------------------------------------------------------------

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function hexToBytes(input: string): ToBytes {
  const clean = input.replace(/0x/gi, '').replace(/[\s:,-]/g, '');
  if (!clean) return { ok: false, error: '' };
  if (!/^[0-9a-f]*$/i.test(clean)) return { ok: false, error: tr('Допустимы только символы 0–9 и a–f (пробелы и двоеточия можно).', 'Only characters 0–9 and a–f are allowed (spaces and colons are fine).') };
  if (clean.length % 2) return { ok: false, error: tr('Нечётное число шестнадцатеричных цифр — не хватает половины байта.', 'Odd number of hex digits — half a byte is missing.') };
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return ok(bytes, '');
}

function base64ToBytes(input: string): ToBytes {
  let t = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t) || t.replace(/=+$/, '').length % 4 === 1) return { ok: false, error: tr('Это не Base64: допустимы A–Z, a–z, 0–9, «+», «/» (или «-», «_») и «=» в конце.', 'This is not Base64: allowed are A–Z, a–z, 0–9, "+", "/" (or "-", "_") and "=" at the end.') };
  t = t.replace(/=+$/, '');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  return ok(Uint8Array.from(bin, (c) => c.charCodeAt(0)), '');
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// --- common entry point ---------------------------------------------------------------

export function toBytes(id: FormatId, sub: string, input: string): ToBytes {
  if (!input.trim() && id !== 'text') return { ok: false, error: '' };
  switch (id) {
    case 'card':
      return cardToBytes(input);
    case 'phone':
      return phoneToBytes(input);
    case 'plate':
      return sub === 'any' ? textToBytes(input.trim()) : plateToBytes(input);
    case 'seed':
      return sub === 'monero' ? moneroToBytes(input) : sub === 'bip39-raw' ? bipRawToBytes(input) : bip39ToBytes(input);
    case 'address': {
      const r = addressToBytes(input);
      return r.ok ? ok(r.bytes, r.note) : r;
    }
    case 'text':
      return input ? textToBytes(input) : { ok: false, error: '' };
    case 'hex':
      return hexToBytes(input);
    case 'base64':
      return base64ToBytes(input);
  }
}

export function fromBytes(id: FormatId, sub: string, bytes: Uint8Array): FromBytes {
  switch (id) {
    case 'card':
      return cardFromBytes(bytes);
    case 'phone':
      return phoneFromBytes(bytes);
    case 'plate':
      return sub === 'any' ? textFromBytes(bytes) : plateFromBytes(bytes);
    case 'seed':
      return sub === 'monero' ? moneroFromBytes(bytes) : sub === 'bip39-raw' ? bipRawFromBytes(bytes) : bip39FromBytes(bytes);
    case 'address':
      return addressFromBytes(bytes);
    case 'text':
      return textFromBytes(bytes);
    case 'hex':
      return { ok: true, value: toHex(bytes), note: tr(`${bytes.length} байт.`, `${count(bytes.length, ['byte', 'bytes'], ['байт', 'байта', 'байт'])}.`) };
    case 'base64':
      return { ok: true, value: toBase64(bytes), note: tr(`${bytes.length} байт.`, `${count(bytes.length, ['byte', 'bytes'], ['байт', 'байта', 'байт'])}.`) };
  }
}

/** A random example value (for the "Example" button); n — number of bytes for HEX/Base64. */
export function example(id: FormatId, sub: string, n = 8): string {
  switch (id) {
    case 'card':
      return cardExample();
    case 'phone':
      return formatPhone(`79${randomDigits(9)}`);
    case 'plate':
      return sub === 'any' ? `${String.fromCharCode(65 + randomInt(26))}${String.fromCharCode(65 + randomInt(26))} ${randomDigits(4)} ${String.fromCharCode(65 + randomInt(26))}${String.fromCharCode(65 + randomInt(26))}` : plateExample();
    case 'seed': {
      // 12 words without checksum — 132 bits: the top 4 bits of 17 bytes are zero.
      const raw = randomBytes(17);
      raw[0] = raw[0]! & 0x0f;
      const r = sub === 'monero' ? moneroFromBytes(randomBytes(32)) : sub === 'bip39-raw' ? bipRawFromBytes(raw) : bip39FromBytes(randomBytes(16));
      return r.ok ? r.value : '';
    }
    case 'address':
      return addressExample();
    case 'text':
      return textExample();
    case 'hex':
      return toHex(randomBytes(n));
    case 'base64':
      return toBase64(randomBytes(n));
  }
}

// --- crypto phrase input: formats, suggestions, word completion -----------------------

/** Crypto phrase kinds to pick before input: subtype and how many words to expect (0 — any number). */
export const SEED_KINDS = [
  {
    id: 'bip39-12',
    sub: 'bip39',
    count: 12,
    get title() {
      return tr('12 слов', '12 words');
    },
  },
  { id: 'bip39-15', sub: 'bip39', count: 15, title: '15' },
  { id: 'bip39-18', sub: 'bip39', count: 18, title: '18' },
  { id: 'bip39-21', sub: 'bip39', count: 21, title: '21' },
  { id: 'bip39-24', sub: 'bip39', count: 24, title: '24' },
  { id: 'electrum', sub: 'bip39-raw', count: 0, title: 'Electrum' },
  { id: 'monero', sub: 'monero', count: 25, title: 'Monero · 25' },
];
export type SeedKind = (typeof SEED_KINDS)[number];

const seedList = (sub: string) => (sub === 'monero' ? MONERO : BIP39);
const lower = (w: string) => w.toLowerCase().normalize('NFKD');

/** List words starting with prefix (at most limit). */
export function seedSuggest(sub: string, prefix: string, limit = 16): string[] {
  const p = lower(prefix);
  const out: string[] = [];
  for (const w of seedList(sub)) {
    if (w.startsWith(p)) out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

/** Unambiguous word prefix → the whole word ("aban" → "abandon"); otherwise as is. */
export function seedComplete(sub: string, word: string): string {
  const w = lower(word);
  const list = seedList(sub);
  if (list.includes(w)) return w;
  const found = seedSuggest(sub, w, 2);
  return found.length === 1 ? found[0]! : w;
}

export const seedKnown = (sub: string, word: string) => seedList(sub).includes(lower(word));

/** Which list all words come from: only BIP39, only Monero, or undecidable. */
export function detectSeedList(words: string[]): 'bip39' | 'monero' | null {
  if (!words.length) return null;
  const bip = words.every((w) => BIP39_IX.has(lower(w)));
  const xmr = words.every((w) => MONERO.includes(lower(w)));
  return bip && !xmr ? 'bip39' : xmr && !bip ? 'monero' : null;
}

export const _internal = { BIP39, MONERO, digitsToBytes, bytesToDigits };
