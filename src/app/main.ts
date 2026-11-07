/**
 * The page: two tabs.
 *   "Encode" — a value in the chosen format (card, phone, licence plate, seed phrase,
 *              password, HEX, Base64) -> bytes -> sentences in the interface language;
 *              each sentence has its variants, the chosen ones make up the phrase.
 *   "Decode" — a phrase in any language -> bytes -> the value in the chosen format.
 * Logic lives in src/core/formats.ts and src/core/engine.ts with the grammars in
 * src/lang/; here are only fields, buttons and output.
 */
import type { DecodeError, Encoded, TemplateInfo, Variant } from '../core/engine';
import { MAX_BYTES } from '../core/engine';
import { detectSeedList, example, formatCard, formats, fromBytes, SEED_KINDS, seedComplete, seedKnown, seedSuggest, toBytes, type FormatId, type SeedKind } from '../core/formats';
import { count, num, setUiLang, tr, uiLang, UI_LANGS, type UiLang } from '../core/i18n';
import { codec, detectLang, type Lang } from '../lang';
import { applyStatic } from './strings';
import { tokenInput } from './tokens';
import { applyUpdate, canUpdate, checkForUpdate, justUpdated, startUpdates, updateState, type UpdateState } from './update';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el as T;
};

const toast = $<HTMLDivElement>('toast');
const themeSelect = $<HTMLSelectElement>('theme');
const langSelect = $<HTMLSelectElement>('ui-lang');

// --- remembered preferences -------------------------------------------------------------

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage (a private window) the choice just isn't remembered.
  }
}

// --- language: interface and phrases -------------------------------------------------------

const LANG_KEY = 'bitphrase:lang';
/**
 * The remembered choice; otherwise English, unless the browser's languages put Russian
 * before English (uk, ru, en -> Russian; en-US, ru -> English).
 */
function readLang(): UiLang {
  const v = load(LANG_KEY);
  if (v && (UI_LANGS as string[]).includes(v)) return v as UiLang;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  const first = prefs.map((l) => l.toLowerCase().slice(0, 2)).find((l) => l === 'ru' || l === 'en');
  return first === 'ru' ? 'ru' : 'en';
}
setUiLang(readLang());
langSelect.value = uiLang();
/** Phrases are made in the interface language. */
const phraseLang = (): Lang => uiLang();

// --- theme: system / light / dark, the choice is remembered ---------------------------------

const THEME_KEY = 'bitphrase:theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
function readTheme(): 'auto' | 'light' | 'dark' {
  const v = load(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}
function applyTheme() {
  const choice = readTheme();
  themeSelect.value = choice;
  document.documentElement.dataset.theme = choice === 'auto' ? (media.matches ? 'dark' : 'light') : choice;
}
themeSelect.addEventListener('change', () => {
  save(THEME_KEY, themeSelect.value);
  applyTheme();
});
media.addEventListener('change', applyTheme);
applyTheme();

// --- helpers ----------------------------------------------------------------------------

let toastTimer = 0;
function say(text: string) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1800);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say(tr('Не удалось скопировать — выделите текст вручную', "Couldn't copy — select the text by hand"));
  }
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const bytesWord = (n: number) => count(n, ['byte', 'bytes'], ['байт', 'байта', 'байт']);
const wordsWord = (n: number) => count(n, ['word', 'words'], ['слово', 'слова', 'слов']);
const sentencesWord = (n: number) => count(n, ['sentence', 'sentences'], ['предложение', 'предложения', 'предложений']);
const q = (s: string) => tr(`«${s}»`, `"${s}"`);

function button(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** A template's share among phrases of the same length: "12 %", "0.8 %", "1 in 40,000". */
function shareText(share: number): string {
  if (share >= 0.01) return `${num(100 * share, 1)} %`;
  if (share >= 0.0001) return `${num(100 * share, 3)} %`;
  return share > 0 ? tr(`1 из ${num(Math.round(1 / share))}`, `1 in ${num(Math.round(1 / share))}`) : tr('меньше 1 из миллиона', 'under 1 in a million');
}

function templateText(t: TemplateInfo): string {
  return [t.pattern, tr(`группа «${t.group}»`, `group "${t.group}"`), tr(`доля шаблона ${shareText(t.share)}`, `template share ${shareText(t.share)}`),
    tr(`контроль ${num(t.checkBits, 1)} бит`, `checksum ${num(t.checkBits, 1)} bits`)].join(' · ');
}

/** Kinds of words in suggestions. */
const KIND_TITLE: Record<string, [string, string]> = {
  adj: ['прил.', 'adj.'], name: ['имя', 'name'], nameP: ['чей', "whose"], sur: ['фамилия', 'surname'], surP: ['чей', 'whose'],
  patr: ['отчество', 'patronymic'], title: ['обращение', 'title'], det: ['определитель', 'determiner'],
  prof: ['профессия', 'profession'], animal: ['животное', 'animal'], role: ['роль', 'role'], obj: ['предмет', 'thing'],
  place: ['город', 'place'], verb: ['глагол', 'verb'], modal: ['глагол', 'verb'], cat: ['глагол', 'verb'], be: ['глагол', 'verb'],
  fixed: ['будет', 'will'], prep: ['предлог', 'preposition'],
};
const kindTitle = (kind: string) => KIND_TITLE[kind]?.[uiLang() === 'en' ? 1 : 0] ?? '';

// --- format choice (the same on both tabs) --------------------------------------------

interface FormatPicker {
  sub: HTMLSelectElement;
  id(): FormatId;
  subId(): string;
  title(): string;
  set(id: FormatId, sub: string): void;
  /** Option texts in the current language (the choice is kept). */
  relabel(): void;
}

function picker(prefix: string, onChange: () => void): FormatPicker {
  const format = $<HTMLSelectElement>(`${prefix}-format`);
  const sub = $<HTMLSelectElement>(`${prefix}-sub`);
  const subWrap = $(`${prefix}-sub-wrap`);
  const current = () => formats().find((x) => x.id === format.value)!;
  const fillFormats = () => format.replaceChildren(...formats().map((f) => new Option(f.title, f.id)));
  const fillSubs = () => {
    const f = current();
    sub.replaceChildren(...f.subs.map((s) => new Option(s.title, s.id)));
    subWrap.hidden = !f.subs.length;
  };
  fillFormats();
  format.addEventListener('change', () => {
    fillSubs();
    onChange();
  });
  sub.addEventListener('change', onChange);
  const p: FormatPicker = {
    sub,
    id: () => format.value as FormatId,
    subId: () => (current().subs.length ? sub.value : ''),
    title: () => current().title + (subWrap.hidden ? '' : ` — ${sub.selectedOptions[0]?.textContent ?? ''}`),
    set(id, s) {
      format.value = id;
      fillSubs();
      if (s) sub.value = s;
    },
    relabel() {
      const [id, s] = [p.id(), sub.value];
      fillFormats();
      p.set(id, s);
    },
  };
  p.set('hex', '');
  return p;
}

// --- tabs -------------------------------------------------------------------------------

const tabs = { enc: $<HTMLButtonElement>('tab-enc'), dec: $<HTMLButtonElement>('tab-dec') };
const panes = { enc: $('enc-pane'), dec: $('dec-pane') };
function showTab(which: 'enc' | 'dec') {
  for (const k of ['enc', 'dec'] as const) {
    tabs[k].setAttribute('aria-selected', String(k === which));
    tabs[k].tabIndex = k === which ? 0 : -1;
    panes[k].hidden = k !== which;
  }
}
tabs.enc.addEventListener('click', () => showTab('enc'));
tabs.dec.addEventListener('click', () => showTab('dec'));
for (const t of [tabs.enc, tabs.dec]) {
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = t === tabs.enc ? 'dec' : 'enc';
    showTab(next);
    tabs[next].focus();
  });
}

// --- encoding ---------------------------------------------------------------------------

const valueIn = $<HTMLTextAreaElement>('value-in');
const valueLabel = $('value-label');
const randomLen = $<HTMLInputElement>('random-len');
const lenWrap = $('len-wrap');
const encError = $<HTMLParagraphElement>('enc-error');
const bytesBox = $('bytes-box');
const bytesNote = $('bytes-note');
const bytesHex = $('bytes-hex');
const phraseBox = $('phrase-box');
const phraseLabel = $('phrase-label');
const phraseOut = $('phrase-out');
const sentencesBox = $('sentences');
const enc = picker('enc', () => {
  valueIn.value = '';
  seed.set('');
  seedNote = '';
  if (enc.id() === 'seed') setSeedKind(SEED_KINDS.find((k) => k.sub === enc.subId()) ?? SEED_KINDS[0]!);
  updateFormatHints();
  renderEncode();
});

// --- seed phrase entry: format, numbered word chips, suggestions from the word list -------

const valueField = $('value-field');
const seedEntry = $('seed-entry');
const seedKinds = $('seed-kinds');
const seedProgress = $('seed-progress');
let seedKind: SeedKind = SEED_KINDS[0]!;
/** Explanation when the format switched by itself (24 words pasted, Monero words…). */
let seedNote = '';
/** Suggestions — when no more words than this fit. */
const SEED_SUGGEST_MAX = 15;
/** Complete a prefix by the chosen list, but leave a whole word of either list as is (Monero "king" isn't BIP39 "kingdom"). */
const completeSeed = (sub: string, w: string) => (seedKnown('bip39', w) || seedKnown('monero', w) ? w.toLowerCase() : seedComplete(sub, w));
const seedPlaceholder = () => tr('Первое слово… (можно вставить фразу целиком)', 'First word… (or paste the whole phrase)');

const seed = tokenInput({
  ids: { box: 'seed-box', tokens: 'seed-tokens', input: 'seed-in', list: 'seed-suggest', clear: 'seed-clear' },
  suggest: (fragment) => {
    const found = seedSuggest(seedKind.sub, fragment, SEED_SUGGEST_MAX + 1);
    return found.length && found.length <= SEED_SUGGEST_MAX ? found.map((word) => ({ word, kind: '' })) : null;
  },
  known: (w) => seedKnown(seedKind.sub, w),
  complete: (w) => completeSeed(seedKind.sub, w),
  numbered: true,
  placeholder: seedPlaceholder(),
  onChange: onSeedChange,
});

function setSeedKind(kind: SeedKind) {
  seedKind = kind;
  enc.sub.value = kind.sub;
  seedKinds.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === kind.id)));
}

/** Buttons for the seed formats (re-created when the language changes). */
function fillSeedKinds() {
  seedKinds.replaceChildren();
  const bip = tr('BIP39 (Bitcoin, Ethereum и др.):', 'BIP39 (Bitcoin, Ethereum and others):');
  for (const [label, kinds] of [[bip, SEED_KINDS.filter((k) => k.sub === 'bip39')], ['', SEED_KINDS.filter((k) => k.sub !== 'bip39')]] as const) {
    const group = el('div', 'seed-group');
    if (label) group.append(el('span', 'seed-group-title', label));
    for (const kind of kinds) {
      const b = button(kind.title, () => {
        setSeedKind(kind);
        seedNote = '';
        // Words already typed — complete them by the new list and check again.
        seed.set(seed.words().map((w) => completeSeed(kind.sub, w)).join(' '));
        onSeedChange();
        seed.focus();
      }, 'seed-kind');
      b.setAttribute('role', 'radio');
      b.dataset.kind = kind.id;
      group.append(b);
    }
    seedKinds.append(group);
  }
  setSeedKind(seedKind);
}
fillSeedKinds();

/** The words changed: switch the format on an obvious mismatch, update the value and the phrase. */
function onSeedChange() {
  const words = seed.words();
  const n = words.length;
  const list = detectSeedList(words);
  const bipFor = (c: number) => SEED_KINDS.find((k) => k.sub === 'bip39' && k.count >= c) ?? SEED_KINDS.find((k) => k.id === 'bip39-24')!;
  if (list === 'monero' && seedKind.sub !== 'monero') {
    setSeedKind(SEED_KINDS.find((k) => k.sub === 'monero')!);
    seedNote = tr('Слова из списка Monero — формат переключён на Monero.', 'Words from the Monero list — switched the format to Monero.');
  } else if (list === 'bip39' && seedKind.sub === 'monero') {
    setSeedKind(bipFor(n));
    seedNote = tr('Слова из списка BIP39 — формат переключён на BIP39.', 'Words from the BIP39 list — switched the format to BIP39.');
  } else if (seedKind.sub === 'bip39' && n > seedKind.count) {
    setSeedKind(bipFor(n));
    seedNote = tr(`Слов больше ${n - 1} — формат переключён на ${seedKind.count}.`, `More than ${n - 1} words — switched the format to ${seedKind.count}.`);
  }
  valueIn.value = words.join(' ');
  renderEncode();
}

function seedProgressText(): string {
  const words = seed.words();
  const n = words.length;
  const unknown = words.filter((w) => !seedKnown(seedKind.sub, w)).length;
  const parts: string[] = [];
  if (seedNote) parts.push(seedNote);
  parts.push(seedKind.count ? tr(`Введено ${n} из ${seedKind.count}.`, `${n} of ${seedKind.count} entered.`) : tr(`Введено ${wordsWord(n)}.`, `${wordsWord(n)} entered.`));
  if (unknown) parts.push(tr(`Не из списка: ${unknown} — щёлкните по красному слову, чтобы исправить.`, `Not in the list: ${unknown} — click a red word to fix it.`));
  if (!n) {
    parts.push(tr(
      `Подсказки появляются, когда подходящих слов не больше ${SEED_SUGGEST_MAX}; пробел дописывает слово по первым буквам («aban» → «abandon»).`,
      `Suggestions show up when no more than ${SEED_SUGGEST_MAX} words fit; space completes a word from its first letters ("aban" → "abandon").`,
    ));
  }
  return parts.join(' ');
}

function updateFormatHints() {
  const f = formats().find((x) => x.id === enc.id())!;
  const isSeed = enc.id() === 'seed';
  valueField.hidden = isSeed;
  seedEntry.hidden = !isSeed;
  if (isSeed) $('enc-sub-wrap').hidden = true;
  valueIn.placeholder = f.placeholder[enc.subId()] ?? f.placeholder[''] ?? '';
  valueLabel.textContent = enc.title();
  lenWrap.hidden = enc.id() !== 'hex' && enc.id() !== 'base64';
  valueIn.rows = enc.id() === 'seed' ? 3 : enc.id() === 'text' ? 2 : 1;
  valueIn.classList.toggle('mono', enc.id() === 'hex' || enc.id() === 'base64');
}

const phraseCheck = $('phrase-check');
const copyPhraseButton = $<HTMLButtonElement>('copy-phrase');
/** Bytes the current phrase was made from. */
let encodedBytes: Uint8Array = new Uint8Array();

/**
 * Check the whole phrase (from the chosen variants): parsing must give the same bytes
 * without a single correction, and the bytes must give back the value in the chosen
 * format. Otherwise the phrase can't be copied.
 */
function verifyPhrase() {
  const back = codec(encoded!.lang as Lang).decode(phraseText());
  const same = back.ok && !back.fixes.length && toHex(back.bytes) === toHex(encodedBytes);
  const value = same ? fromBytes(enc.id(), enc.subId(), back.bytes) : null;
  const ok = same && !!value?.ok;
  phraseCheck.className = `check-line ${ok ? 'ok' : 'error'}`;
  phraseCheck.textContent = ok
    ? tr('✓ Проверено: фраза разбирается обратно в те же ', '✓ Checked: the phrase parses back into the same ') + bytesWord(encodedBytes.length) +
      (enc.id() === 'hex' ? '' : ` → ${value!.value}`)
    : tr('✗ Фраза не разбирается обратно в те же байты — не используйте её и сообщите об ошибке.', "✗ The phrase doesn't parse back into the same bytes — don't use it, and please report the bug.");
  copyPhraseButton.disabled = !ok;
}

/** The current encoding and the chosen variant of each sentence. */
let encoded: Encoded | null = null;
let chosen: number[] = [];
const phraseText = () => (encoded ? encoded.variants.map((list, i) => list[chosen[i] ?? 0]!.text).join(' ') : '');

/** Show the chosen variants: the whole phrase and every sentence. */
function showChoice() {
  phraseOut.textContent = phraseText();
  if (!encoded) return;
  verifyPhrase();
  sentencesBox.querySelectorAll<HTMLElement>('.sentence-block').forEach((block, i) => {
    const list = encoded!.variants[i]!;
    const k = chosen[i] ?? 0;
    block.querySelector('.chosen-text')!.textContent = list[k]!.text;
    block.querySelector('.chosen-template')!.textContent = templateText(list[k]!.info);
    block.querySelector('.pager-pos')!.textContent = `${k + 1} / ${list.length}`;
    block.querySelectorAll<HTMLElement>('.variant').forEach((card, j) => card.classList.toggle('chosen', j === k));
  });
}

function choose(i: number, k: number) {
  if (!encoded) return;
  const n = encoded.variants[i]!.length;
  chosen[i] = ((k % n) + n) % n;
  showChoice();
}

function variantCard(v: Variant, i: number, k: number): HTMLElement {
  const item = el('article', 'variant');
  const head = el('div', 'variant-head');
  head.append(el('span', 'variant-no', `${k + 1}`), el('div', 'sentence', v.text));
  const actions = el('div', 'variant-actions');
  actions.append(
    button(tr('Выбрать', 'Choose'), () => choose(i, k), 'choose-variant'),
    button(tr('Скопировать', 'Copy'), () => void copy(v.text, tr(`Вариант ${k + 1} скопирован`, `Variant ${k + 1} copied`)), 'copy-variant'),
  );
  item.append(head, el('div', 'template-line', templateText(v.info)), actions);
  return item;
}

/** A sentence: the chosen variant with a pager "‹ 3 / 147 ›", copying and the list of all variants. */
function sentenceBlock(list: Variant[], i: number, from: number, size: number, n: number): HTMLElement {
  const block = el('section', 'sentence-block');
  const top = el('div', 'sentence-top');
  const range = size === 1 ? tr(`байт ${from + 1}`, `byte ${from + 1}`) : tr(`байты ${from + 1}–${from + size}`, `bytes ${from + 1}–${from + size}`);
  const words = list[0]!.info.words;
  top.append(el('h3', '', `${n > 1 ? `${tr('Предложение', 'Sentence')} ${i + 1} · ${range}` : bytesWord(size)} · ${wordsWord(words)}`));
  const prev = button('‹', () => choose(i, (chosen[i] ?? 0) - 1), 'pager-prev');
  const next = button('›', () => choose(i, (chosen[i] ?? 0) + 1), 'pager-next');
  prev.setAttribute('aria-label', tr('Предыдущий вариант', 'Previous variant'));
  next.setAttribute('aria-label', tr('Следующий вариант', 'Next variant'));
  const pager = el('div', 'pager');
  pager.append(prev, el('span', 'pager-pos'), next);
  top.append(pager);
  const actions = el('div', 'row');
  actions.append(button(
    n > 1 ? tr('Скопировать предложение', 'Copy the sentence') : tr('Скопировать', 'Copy'),
    () => void copy(list[chosen[i] ?? 0]!.text, tr(`Предложение ${i + 1} скопировано`, `Sentence ${i + 1} copied`)),
    'copy-sentence',
  ));
  const details = el('details', 'all-variants');
  const cards = el('div', 'variants');
  const all = count(list.length, ['variant', 'variants'], ['вариант', 'варианта', 'вариантов']);
  details.append(el('summary', '', tr(`Все ${all} — любой разбирается в те же байты`, `All ${all} — any of them parses into the same bytes`)), cards);
  // Cards only when opened: for 100 bytes there would be over a thousand.
  details.addEventListener('toggle', () => {
    if (details.open && !cards.childElementCount) {
      list.forEach((v, k) => cards.append(variantCard(v, i, k)));
      showChoice();
    }
  });
  block.append(top, el('div', 'sentence chosen-text'), el('div', 'template-line chosen-template'), actions, details);
  return block;
}

function renderEncode() {
  sentencesBox.replaceChildren();
  encError.hidden = true;
  bytesBox.hidden = true;
  phraseBox.hidden = true;
  encoded = null;
  if (enc.id() === 'seed') {
    seedProgress.textContent = seedProgressText();
    // Fewer words than needed is not an error but "keep going".
    if (seedKind.count && seed.words().length < seedKind.count) return;
  }
  const r = toBytes(enc.id(), enc.subId(), valueIn.value);
  if (!r.ok) {
    if (r.error) {
      encError.textContent = r.error;
      encError.hidden = false;
    }
    return;
  }
  bytesNote.textContent = `${r.note ? `${r.note} ` : ''}${tr('Байты', 'Bytes')} (${bytesWord(r.bytes.length)}):`;
  bytesHex.textContent = toHex(r.bytes);
  bytesBox.hidden = false;
  encodedBytes = r.bytes;
  encoded = codec(phraseLang()).encode(r.bytes);
  chosen = encoded.variants.map(() => 0);
  const n = encoded.sentences.length;
  phraseLabel.textContent = n === 1
    ? tr('Фраза', 'Phrase')
    : tr(`Фраза целиком — ${sentencesWord(n)} (${encoded.bytes.join(' + ')} байт); у каждого свои варианты`,
      `The whole phrase — ${sentencesWord(n)} (${encoded.bytes.join(' + ')} bytes); each has its own variants`);
  phraseBox.hidden = false;
  let from = 0;
  encoded.variants.forEach((list, i) => {
    sentencesBox.append(sentenceBlock(list, i, from, encoded!.bytes[i]!, n));
    from += encoded!.bytes[i]!;
  });
  showChoice();
}

/** Card number while typing — groups of 4 digits (Amex — 4-6-5); the caret stays at the same digit. */
let lastCardValue = '';
function groupCardInput(e: Event) {
  const raw = valueIn.value;
  const caret = valueIn.selectionStart ?? raw.length;
  // Only digits, spaces and hyphens — otherwise leave it: let the check show the error.
  if (!/^[\d\s-]*$/.test(raw)) return;
  let digits = raw.replace(/\D/g, '');
  let before = raw.slice(0, caret).replace(/\D/g, '').length;
  // Backspace right after a space erased the space, not a digit — erase the digit before it.
  if ((e as InputEvent).inputType === 'deleteContentBackward' && digits === lastCardValue.replace(/\D/g, '') && before > 0) {
    digits = digits.slice(0, before - 1) + digits.slice(before);
    before -= 1;
  }
  digits = digits.slice(0, 19);
  const grouped = formatCard(digits);
  let pos = 0;
  for (let seen = 0; pos < grouped.length && seen < Math.min(before, digits.length); pos += 1) if (/\d/.test(grouped[pos]!)) seen += 1;
  valueIn.value = grouped;
  lastCardValue = grouped;
  if (document.activeElement === valueIn) valueIn.setSelectionRange(pos, pos);
}
/** Long input (every variant of every sentence is checked by parsing) — with a pause. */
let encodeTimer = 0;
valueIn.addEventListener('input', (e) => {
  if (enc.id() === 'card') groupCardInput(e);
  clearTimeout(encodeTimer);
  if (valueIn.value.length > 80) encodeTimer = window.setTimeout(renderEncode, 200);
  else renderEncode();
});
$<HTMLButtonElement>('example').addEventListener('click', () => {
  const n = Math.max(1, Math.min(MAX_BYTES, Math.round(Number(randomLen.value)) || 8));
  randomLen.value = String(n);
  valueIn.value = example(enc.id(), enc.subId(), n);
  if (enc.id() === 'seed') {
    seedNote = '';
    seed.set(valueIn.value);
    onSeedChange();
    return;
  }
  renderEncode();
});
$<HTMLButtonElement>('copy-phrase').addEventListener('click', () => void copy(phraseText(), tr('Фраза скопирована', 'Phrase copied')));
$<HTMLButtonElement>('check-phrase').addEventListener('click', () => {
  dec.set(enc.id(), enc.subId());
  setPhrase(phraseText());
  showTab('dec');
  renderDecode();
});

// --- decoding: word chips with suggestions ------------------------------------------------

const decResult = $('dec-result');
const dec = picker('dec', () => renderDecode());
/** A word is suggested from this length on (earlier — if there are very few options). */
const SUGGEST_FROM = 4;
let decodeTimer = 0;
const decPlaceholder = () => tr('Начните вводить первое слово…', 'Start typing the first word…');
/** Language of the phrase being typed: by its letters, otherwise the interface language. */
const typedLang = (text: string): Lang => detectLang(text, phraseLang());
const phrase = tokenInput({
  ids: { box: 'token-box', tokens: 'tokens', input: 'phrase-in', list: 'suggest-list', clear: 'clear-phrase' },
  suggest: (fragment, before) => {
    if (fragment.length < 2) return null;
    const c = codec(typedLang([...before, fragment].join(' ')));
    // Context — the words of this sentence typed so far (full sentences are MAX_WORDS words each).
    const list = c.suggest(fragment, before.slice(before.length - (before.length % c.MAX_WORDS)), 8);
    return fragment.length >= SUGGEST_FROM || list.length <= 3 ? list.map((s) => ({ word: s.word, kind: kindTitle(s.kind) })) : null;
  },
  known: (w) => codec(typedLang(w)).isKnown(w),
  groupEvery: 7,
  placeholder: decPlaceholder(),
  onChange: () => {
    clearTimeout(decodeTimer);
    decodeTimer = window.setTimeout(renderDecode, 150);
  },
});
const setPhrase = (text: string) => phrase.set(text);
/** Corrections of the last parse: number of the word in the phrase -> the right form. */
let corrections = new Map<number, string>();
// The suggestion index is built on first use — ahead of time, while the person reads the page.
tabs.dec.addEventListener('click', () => window.setTimeout(() => codec(phraseLang()).suggest('a', [], 1), 0));

function describe(error: DecodeError, maxWords: number, maxTotal: number): (string | Node)[] {
  switch (error.kind) {
    case 'empty':
      return [''];
    case 'length':
      return [tr(`Слов: ${error.words}. Больше ${maxTotal} слов (${MAX_BYTES} байт) не бывает.`, `${wordsWord(error.words)}. There are never more than ${maxTotal} words (${MAX_BYTES} bytes).`)];
    case 'sentence':
      return [tr(
        `Предложение ${error.sentence + 1}: ${error.words} сл. Полное предложение — ровно ${maxWords} слов; короче может быть только последнее.`,
        `Sentence ${error.sentence + 1}: ${wordsWord(error.words)}. A full sentence has exactly ${maxWords} words; only the last one may be shorter.`,
      )];
    case 'unparsed':
      return [tr(
        `Предложение ${error.sentence + 1}: все слова знакомы, но оно не складывается — вероятно, одно слово вспомнилось не то или пропущено.`,
        `Sentence ${error.sentence + 1}: every word is known but they don't add up — probably one word is misremembered or missing.`,
      )];
    case 'unknown': {
      const parts: (string | Node)[] = [tr(`Слово ${error.position + 1}: «${error.word}» нет в словарях.`, `Word ${error.position + 1}: "${error.word}" is not in the dictionaries.`)];
      if (error.suggestions.length) {
        parts.push(tr(' Возможно: ', ' Perhaps: '));
        error.suggestions.forEach((s, i) => parts.push(...(i ? [', '] : []), button(s, () => replaceWords(new Map([[error.position, s]])), 'suggest')));
      }
      return parts;
    }
  }
}

/** Replace words by their numbers in the phrase (a suggestion for an unknown word, corrections). */
const replaceWords = (changes: Map<number, string>) => phrase.replace(changes);

function renderDecode() {
  decResult.replaceChildren();
  const text = phrase.words().join(' ');
  const lang = typedLang(text);
  const c = codec(lang);
  const result = c.decode(text);
  corrections = new Map(result.ok ? result.corrections.map((x) => [x.position, x.to]) : []);
  phrase.setMarks(corrections);
  if (!result.ok) {
    for (const error of result.errors) {
      const parts = describe(error, c.MAX_WORDS, c.MAX_TOTAL_WORDS);
      if (parts.length === 1 && parts[0] === '') continue;
      const p = el('p', 'error');
      p.append(...parts);
      decResult.append(p);
    }
    return;
  }
  const n = result.bytes.length;
  const langName = lang === 'en' ? tr('английская', 'English') : tr('русская', 'Russian');
  decResult.append(el('p', 'ok', tr(
    `Фраза разобрана (${langName}): ${bytesWord(n)}${result.sentences > 1 ? `, ${sentencesWord(result.sentences)}` : ''}.`,
    `The phrase is parsed (${langName}): ${bytesWord(n)}${result.sentences > 1 ? `, ${sentencesWord(result.sentences)}` : ''}.`,
  )));
  if (result.fixes.length) {
    const list = el('ul', 'fixes');
    for (const fix of result.fixes) {
      const where = result.sentences > 1 ? tr(` (предложение ${fix.sentence + 1})`, ` (sentence ${fix.sentence + 1})`) : '';
      for (const note of fix.notes) {
        list.append(el('li', '', tr(
          `Исправлено${where}: слово ${note.position + 1}: «${note.from}» → «${note.to}»`,
          `Fixed${where}: word ${note.position + 1}: "${note.from}" → "${note.to}"`,
        )));
      }
    }
    const fixRow = el('div', 'row');
    fixRow.append(button(tr('Подставить исправленные слова', 'Use the corrected words'), () => replaceWords(new Map(corrections)), 'apply-fixes'));
    decResult.append(list, fixRow);
  }
  const value = fromBytes(dec.id(), dec.subId(), result.bytes);
  const box = el('div', 'value-box');
  box.append(el('div', 'phrase-label', dec.title()));
  if (value.ok) {
    const out = el('div', `value-out${dec.id() === 'hex' || dec.id() === 'base64' ? ' mono' : ''}`);
    out.id = 'value-out';
    if (dec.id() === 'seed') {
      // A seed phrase — as a numbered grid, easy to copy out by hand.
      const grid = el('ol', 'seed-grid');
      value.value.split(' ').forEach((w, i) => grid.append(...(i ? [' '] : []), el('li', '', w)));
      out.append(grid);
    } else {
      out.textContent = value.value;
    }
    const actions = el('div', 'row');
    actions.append(button(tr('Скопировать значение', 'Copy the value'), () => void copy(value.value, tr('Значение скопировано', 'Value copied')), 'primary'));
    box.append(out, el('div', 'muted', value.note), actions);
  } else {
    box.append(el('p', 'error', `${value.error} ${tr('Возможно, выбран не тот формат.', 'Perhaps the wrong format is chosen.')}`));
  }
  decResult.append(box);
  const hex = el('pre', 'hex', toHex(result.bytes));
  hex.id = 'hex-out';
  const hexRow = el('div', 'row');
  hexRow.append(button(tr('Скопировать байты (HEX)', 'Copy the bytes (HEX)'), () => void copy(toHex(result.bytes), tr('Байты скопированы', 'Bytes copied')), 'copy-hex'));
  decResult.append(el('div', 'muted bytes-title', `${tr('Байты', 'Bytes')} (${bytesWord(n)}):`), hex, hexRow);
}

// --- footer -------------------------------------------------------------------------------

const SIZE_TITLE: Record<string, [string, string]> = {
  adj: ['прилагательных', 'adjectives'], name: ['имён', 'first names'], surname: ['фамилий', 'surnames'],
  patronymic: ['отчеств', 'patronymics'], title: ['обращений', 'titles'], profession: ['профессий', 'professions'],
  role: ['ролей', 'roles'], animal: ['животных', 'animals'], object: ['предметов', 'things'], place: ['городов', 'places'],
  verb: ['глаголов', 'verbs'],
};

function renderFacts() {
  const info = codec(phraseLang()).summary();
  const i = uiLang() === 'en' ? 1 : 0;
  const lengths = info.schemes.map((s) => tr(`${s.bytes} б. — ${s.words} сл.`, `${s.bytes} B — ${s.words} w.`)).join(', ');
  const sizes = Object.entries(info.sizes).map(([k, n]) => `${SIZE_TITLE[k]?.[i] ?? k} ${num(n)}`).join(', ');
  $('facts').textContent = tr(
    `Шаблонов ${num(info.templates)}; шаблон выпадает тем чаще, чем больше у него комбинаций. Длина: ${lengths}; больше 8 байт — несколько независимых предложений. ` +
      `Вариантов: ${info.schemes.map((s) => s.variants.join('–')).join(' / ')}; контроль ${info.schemes.map((s) => num(s.checkBits, 1)).join(' / ')} бит. Словари: ${sizes}.`,
    `${num(info.templates)} templates; a template comes up the more often, the more combinations it has. Length: ${lengths}; over 8 bytes — several independent sentences. ` +
      `Variants: ${info.schemes.map((s) => s.variants.join('–')).join(' / ')}; checksum ${info.schemes.map((s) => num(s.checkBits, 1)).join(' / ')} bits. Dictionaries: ${sizes}.`,
  );
}

// --- switching the language ---------------------------------------------------------------

function applyLanguage() {
  applyStatic();
  enc.relabel();
  dec.relabel();
  fillSeedKinds();
  seed.setPlaceholder(seedPlaceholder());
  phrase.setPlaceholder(decPlaceholder());
  updateFormatHints();
  renderFacts();
  showUpdate(updateState());
}

langSelect.addEventListener('change', () => {
  setUiLang(langSelect.value as UiLang);
  save(LANG_KEY, uiLang());
  applyLanguage();
  // Phrases are made in the new language; the phrase being decoded keeps its own.
  renderEncode();
  renderDecode();
});

// --- updates of the installed app (PWA) ----------------------------------------------------

/** After the version in the footer: "Check for updates", then what came of it. Empty outside the PWA. */
function showUpdate(state: UpdateState) {
  const line = $('update-line');
  line.hidden = !canUpdate();
  if (line.hidden) return;
  const check = button(tr('Проверить обновления', 'Check for updates'), () => void checkForUpdate(), 'link-button');
  const parts: (Node | string)[] = ['· '];
  switch (state.kind) {
    case 'idle':
      parts.push(check);
      break;
    case 'checking':
      parts.push(tr('Проверяю обновления…', 'Checking for updates…'));
      break;
    case 'latest':
      parts.push(tr('Это последняя версия.', 'This is the latest version.'), ' ', check);
      break;
    case 'offline':
      parts.push(tr('Нет связи: проверить обновления не удалось.', 'No connection: could not check for updates.'), ' ', check);
      break;
    case 'ready':
      parts.push(
        state.version ? tr(`Версия ${state.version} готова.`, `Version ${state.version} is ready.`) : tr('Новая версия готова.', 'A new version is ready.'),
        ' ',
        button(tr('Обновить', 'Update'), applyUpdate, 'link-button'),
      );
      break;
  }
  line.replaceChildren(...parts);
}

applyLanguage();
$('version').textContent = __APP_VERSION__;
startUpdates(showUpdate);
if (justUpdated()) say(tr(`Обновлено до версии ${__APP_VERSION__}.`, `Updated to version ${__APP_VERSION__}.`));
