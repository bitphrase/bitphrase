/**
 * The page (build/bitphrase.html) in headless Chrome: two tabs; bytes and
 * formats (card, phone, license plate, BIP39, password, Base64) → phrase → back;
 * the pager and variant choice for each sentence, copying the phrase and a single
 * sentence; a typo, an unknown word, the wrong format; network blocked, no JS errors.
 *
 * Requires `npm run build` and Chrome (or CHROME=/path/to/chrome). `--shots DIR` saves screenshots.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checker, root } from '../tools/load.mjs';
import { CHROME, openPage } from './browser.mjs';

const APP = join(root, 'build', 'bitphrase.html');
if (!CHROME) {
  console.log('Chrome not found: set CHROME=/path/to/chrome. Browser test skipped.');
  process.exit(0);
}
if (!existsSync(APP)) {
  console.error('No build/bitphrase.html: run npm run build first');
  process.exit(1);
}
const { check, done } = checker();
const { send, page, evaluate, until, shot, close, fill, requests, problems } = await openPage(APP);
const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const visible = (id) => evaluate(`!document.getElementById(${JSON.stringify(id)}).hidden`);
const setFormat = async (prefix, id, sub = '') => {
  await fill(`${prefix}-format`, id, 'change');
  if (sub) await fill(`${prefix}-sub`, sub, 'change');
};
/** Paste a whole phrase into the decode field (as if from the clipboard). */
const typePhrase = async (value) => {
  await click('#clear-phrase');
  await fill('phrase-in', value);
};
const key = (k) => evaluate(`document.getElementById('phrase-in').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
const chips = () => evaluate("[...document.querySelectorAll('#tokens .chip')].map((c) => c.textContent)");

/** Encode a value and decode the phrase on the "Decode" tab (via the "Check" button). */
const roundTrip = async (format, sub, value) => {
  await click('#tab-enc');
  await setFormat('enc', format, sub);
  if (format === 'seed') {
    await click('#seed-clear');
    await fill('seed-in', value);
  } else {
    await fill('value-in', value);
  }
  if (!(await until("!document.getElementById('phrase-box').hidden"))) return `not encoded: ${await text('#enc-error')}`;
  const verified = await text('#phrase-check');
  if (!verified.startsWith('✓ Проверено')) return `not checked: ${verified}`;
  await click('#check-phrase');
  await until("document.getElementById('value-out') || document.querySelector('#dec-result .error')");
  return (await text('#value-out')) ?? `error: ${await text('#dec-result .error')}`;
};

/** The same round trip in the English interface. */
const roundTripEn = async (format, sub, value) => {
  await click('#tab-enc');
  await setFormat('enc', format, sub);
  await fill('value-in', value);
  if (!(await until("!document.getElementById('phrase-box').hidden"))) return `not encoded: ${await text('#enc-error')}`;
  const verified = await text('#phrase-check');
  if (!verified.startsWith('✓ Checked')) return `not checked: ${verified}`;
  await click('#check-phrase');
  await until("document.getElementById('value-out') || document.querySelector('#dec-result .error')");
  return (await text('#value-out')) ?? `error: ${await text('#dec-result .error')}`;
};

try {
  check('page loaded', await until("document.readyState === 'complete' && !!document.getElementById('version')?.textContent"), true);
  check('title', await evaluate('document.title'), 'Bitphrase');
  // Nothing remembered: English, unless the browser lists Russian before English.
  const expected = await evaluate("navigator.languages.map((l) => l.toLowerCase().slice(0, 2)).find((l) => l === 'ru' || l === 'en') === 'ru' ? 'ru' : 'en'");
  check('default language follows the browser, English otherwise', [await evaluate('document.documentElement.lang'), await evaluate("document.getElementById('ui-lang').value")], [expected, expected]);
  // Most of the test runs in Russian.
  await fill('ui-lang', 'ru', 'change');
  check('Russian interface', [await evaluate('document.documentElement.lang'), await text('#tab-enc')], ['ru', 'Кодировать']);
  check('two tabs, "Encode" open', [await visible('enc-pane'), await visible('dec-pane'), await evaluate("document.getElementById('tab-enc').getAttribute('aria-selected')")], [true, false, 'true']);
  check('eight formats', await evaluate("document.getElementById('enc-format').options.length"), 8);

  // --- bytes (HEX): example → one sentence, variant pager
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await page('Emulation.setFocusEmulationEnabled', { enabled: true });
  await click('#example');
  check('example: phrase and bytes', await until("!document.getElementById('phrase-box').hidden && !document.getElementById('bytes-box').hidden"), true);
  check('phrase verified by decoding back', (await text('#phrase-check')).startsWith('✓ Проверено: фраза разбирается обратно в те же 8 байт'), true);
  const hex8 = (await text('#bytes-hex')).trim();
  check('8 bytes', hex8.length, 16);
  const pos = await text('.sentence-block .pager-pos');
  const total = Number(pos.split(' / ')[1]);
  check('pager: "1 / N", at least 100 variants', pos.startsWith('1 / ') && total >= 100, true);
  const first = await text('#phrase-out');
  await click('.sentence-block .pager-next');
  check('"›" goes to the second variant', await text('.sentence-block .pager-pos'), `2 / ${total}`);
  check('phrase = chosen variant', [await text('#phrase-out') !== first, await text('#phrase-out') === (await text('.sentence-block .chosen-text'))], [true, true]);
  await click('.sentence-block .pager-prev');
  await click('.sentence-block .pager-prev');
  check('"‹" from the first goes to the last', await text('.sentence-block .pager-pos'), `${total} / ${total}`);
  await evaluate("document.querySelector('.sentence-block details').open = true");
  check('all variants as cards', await until(`document.querySelectorAll('.sentence-block .variant').length === ${total}`), true);
  await evaluate("document.querySelectorAll('.sentence-block .choose-variant')[4].click()");
  check('"Choose" the 5th variant', [await text('.sentence-block .pager-pos'), await text('#phrase-out') === (await evaluate("document.querySelectorAll('.sentence-block .variant .sentence')[4].textContent"))], [`5 / ${total}`, true]);
  await click('#copy-phrase');
  check('phrase copied', await until("document.getElementById('toast').textContent === 'Фраза скопирована'"), true);
  check('clipboard holds the phrase', await evaluate('navigator.clipboard.readText()'), await text('#phrase-out'));
  await shot('encode', 1280, 1000);

  // --- 19 bytes: three sentences, each with its own choice and copy
  await fill('random-len', '19');
  await click('#example');
  check('19 bytes: three sentences', await until("document.querySelectorAll('.sentence-block').length === 3"), true);
  const hex19 = (await text('#bytes-hex')).trim();
  await evaluate("document.querySelectorAll('.sentence-block .pager-next')[1].click()");
  await evaluate("document.querySelectorAll('.sentence-block .pager-next')[1].click()");
  const second = await evaluate("document.querySelectorAll('.sentence-block .chosen-text')[1].textContent");
  check('second sentence has its own choice (3rd variant)', await evaluate("document.querySelectorAll('.sentence-block .pager-pos')[1].textContent.startsWith('3 / ')"), true);
  check('whole phrase made of the three chosen', (await text('#phrase-out')).split('. ').length === 3 && (await text('#phrase-out')).includes(second), true);
  check('phrase of chosen variants is verified too', (await text('#phrase-check')).startsWith('✓ Проверено: фраза разбирается обратно в те же 19 байт'), true);
  await evaluate("document.querySelectorAll('.sentence-block .copy-sentence')[1].click()");
  check('second sentence copied', await until("document.getElementById('toast').textContent === 'Предложение 2 скопировано'"), true);
  check('clipboard holds the second sentence', await evaluate('navigator.clipboard.readText()'), second);
  await shot('encode-19', 1280, 1400);
  await click('#check-phrase');
  check('"Check" opens the "Decode" tab', [await visible('dec-pane'), await visible('enc-pane')], [true, false]);
  check('19 bytes decoded back', await until(`document.getElementById('hex-out')?.textContent === '${hex19}'`), true);
  check('value in HEX', await text('#value-out'), hex19);

  // --- formats round trip through the page
  check('card', await roundTrip('card', '', '4111 1111 1111 1111'), '4111 1111 1111 1111');
  check('phone: 8 → +7', await roundTrip('phone', '', '8 912 345 67 89'), '+7 (912) 345-67-89');
  check('license plate', await roundTrip('plate', 'ru', 'а123вс777'), 'А123ВС 777');
  const bip = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
  check('BIP39, 12 words', await roundTrip('seed', 'bip39', bip), bip);
  check('password', await roundTrip('text', '', 'Мурзик_2024!'), 'Мурзик_2024!');
  check('Base64', await roundTrip('base64', '', 'ASNFZ4mrze8='), 'ASNFZ4mrze8=');
  check('Ethereum address', await roundTrip('address', '', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'), '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
  check('Ethereum address: network named', (await text('.value-box .muted')).startsWith('Ethereum'), true);
  check('Bitcoin (SegWit) address', await roundTrip('address', '', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  await click('#tab-enc');
  await setFormat('enc', 'address');
  await fill('value-in', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb');
  check('address with a typo in a character: message', await until("!document.getElementById('enc-error').hidden && document.getElementById('enc-error').textContent.includes('контрольной суммы')"), true);
  await shot('decode-base64', 1280, 900);

  // Card: 16 digits → 7 bytes, Visa; a bad check digit is an error.
  await click('#tab-enc');
  await setFormat('enc', 'card');
  await fill('value-in', '4111 1111 1111 1111');
  check('"N bytes" field only for HEX and Base64', await evaluate("getComputedStyle(document.getElementById('len-wrap')).display"), 'none');
  check('card: Visa, 7 bytes', [(await text('#bytes-note')).includes('Visa'), (await text('#bytes-hex')).trim().length], [true, 14]);
  await fill('value-in', '4111111111111111');
  check('card is grouped by 4 digits while typing', await evaluate("document.getElementById('value-in').value"), '4111 1111 1111 1111');
  await fill('value-in', '411111');
  check('incomplete number is grouped too', await evaluate("document.getElementById('value-in').value"), '4111 11');
  await fill('value-in', '378282246310005');
  check('American Express: 4-6-5', await evaluate("document.getElementById('value-in').value"), '3782 822463 10005');
  await fill('value-in', '4111 1111 1111 1111');
  await fill('value-in', '4111 1111 1111 1112');
  check('card: Luhn check', [await visible('enc-error'), (await text('#enc-error')).includes('Луна'), await visible('phrase-box')], [true, true, false]);
  // --- crypto phrase: format, numbered chips, suggestions, word completion
  await setFormat('enc', 'seed');
  const seedChips = () => evaluate("[...document.querySelectorAll('#seed-tokens .chip-word')].map((c) => c.textContent)");
  const checked = () => evaluate("document.querySelector('#seed-kinds [aria-checked=true]')?.dataset.kind");
  check('crypto phrase: format picker instead of the field, 12 words by default', [await visible('seed-entry'), await visible('value-field'), await checked()], [true, false, 'bip39-12']);
  check('crypto phrase: progress', (await text('#seed-progress')).startsWith('Введено 0 из 12'), true);
  await click('#seed-clear');
  await fill('seed-in', 'aban ');
  check('space completes the word from its first letters', await seedChips(), ['abandon']);
  check('chip has a number', await text('#seed-tokens .chip-no'), '1');
  await fill('seed-in', 'a');
  check('no suggestions while more than 15 words match', await evaluate("document.getElementById('seed-suggest').hidden"), true);
  await fill('seed-in', 'zo');
  check('suggestions when at most 15 words match', await until("!document.getElementById('seed-suggest').hidden"), true);
  check('suggestions from the BIP39 list', await evaluate("[...document.querySelectorAll('#seed-suggest li .word')].map((e) => e.textContent)"), ['zone', 'zoo']);
  for (const k of ['ArrowDown', 'Enter']) await evaluate(`document.getElementById('seed-in').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true }))`);
  check('Enter inserts the suggestion', (await seedChips())[1], 'zoo');
  check('fewer than 12 words: progress, not an error', [await visible('enc-error'), (await text('#seed-progress')).includes('Введено 2 из 12')], [false, true]);
  await fill('seed-in', 'qwerty ');
  check('unknown word is a red chip', await evaluate("document.querySelector('#seed-tokens .chip.unknown .chip-word')?.textContent"), 'qwerty');
  await click('#seed-clear');
  await fill('seed-in', 'lega winn than year wave saus wort usef lega winn than yell');
  check('12 words by first 4 letters → full words and phrase', [(await seedChips()).join(' '), await until("(document.getElementById('phrase-check')?.textContent ?? '').startsWith('✓')")], ['legal winner thank year wave sausage worth useful legal winner thank yellow', true]);
  await click('#seed-clear');
  await fill('seed-in', `${'abandon '.repeat(23)}art`);
  check('24 words: format switches automatically', [await checked(), (await text('#seed-progress')).includes('переключён')], ['bip39-24', true]);
  await click('#seed-clear');
  await evaluate("document.querySelector('#seed-kinds [data-kind=monero]').click()");
  await click('#example');
  check('Monero: example has 25 chips, 32 bytes', [(await seedChips()).length, (await text('#bytes-hex')).trim().length], [25, 64]);
  const xmr = (await seedChips()).join(' ');
  await evaluate("document.querySelector('#seed-kinds [data-kind=bip39-12]').click()");
  await click('#seed-clear');
  await fill('seed-in', xmr);
  check('Monero words with BIP39 selected switch to Monero', await checked(), 'monero');
  await shot('seed', 1280, 1000);
  await click('#check-phrase');
  check('crypto phrase is decoded as a numbered grid', await until("document.querySelectorAll('#value-out .seed-grid li').length === 25"), true);
  check('grid has the same words', await text('#value-out'), xmr);
  await click('#tab-enc');

  // --- direct decoding: typo, unknown word, wrong format
  await setFormat('enc', 'card');
  await fill('value-in', '4111 1111 1111 1111');
  const cardPhrase = await text('#phrase-out');
  const cardPattern = await text('.sentence-block .chosen-template');
  await click('#tab-dec');
  await setFormat('dec', 'card');
  const typo = cardPhrase.replace(/\.$/, '').split(' ').map((w, i, a) => (i === a.length - 1 ? w.slice(0, 2) + (w[2] === 'ж' ? 'з' : 'ж') + w.slice(3) : w)).join(' ');
  await typePhrase(typo);
  check('typo fixed', await until("document.getElementById('value-out')?.textContent === '4111 1111 1111 1111' && !!document.querySelector('.fixes li')"), true);
  check('fixed word is a yellow chip', await until("document.querySelectorAll('#tokens .chip.fixed').length === 1"), true);
  await click('.apply-fixes');
  check('"Apply fixed words"', await until("!document.querySelector('#tokens .chip.fixed') && !document.querySelector('.fixes') && document.getElementById('value-out')?.textContent === '4111 1111 1111 1111'"), true);
  check('after applying: the original phrase', (await chips()).join(' '), cardPhrase.replace(/\.$/, ''));

  // Chips and suggestions: word by word.
  const words = cardPhrase.replace(/\.$/, '').split(' ');
  await typePhrase(`${words[0]} ${words[1]} `);
  check('space turns a word into a chip', await chips(), [words[0], words[1]]);
  const verb = words[2];
  await fill('phrase-in', verb.slice(0, 2));
  check('2 letters: no suggestions yet (too many)', await evaluate("document.getElementById('suggest-list').hidden"), true);
  await fill('phrase-in', verb.slice(0, 4));
  check('4 letters: suggestions', await until("!document.getElementById('suggest-list').hidden && document.querySelectorAll('#suggest-list li').length > 0"), true);
  const offered = await evaluate("[...document.querySelectorAll('#suggest-list li .word')].map((e) => e.textContent)");
  check('suggestions start with the typed text', offered.every((w) => w.toLowerCase().startsWith(verb.slice(0, 4).toLowerCase())), true);
  // Is the third word of this phrase's template the predicate? Then verbs must come first.
  if (/^\[(Прил|Фамилия|Семья|Профессия|Животное|Роль|Имя)[^\]]*\] \[(Прил|Фамилия|Семья|Профессия|Животное|Роль|Имя)[^\]]*\] \[глагол/.test(cardPattern)) {
    check('verbs first (third word is the predicate)', await text('#suggest-list li .kind'), 'глагол');
  }
  const at = offered.findIndex((w) => w.toLowerCase() === verb.toLowerCase());
  if (at >= 0) {
    for (let i = 0; i < at; i += 1) await key('ArrowDown');
    await key('Enter');
    check('Enter inserts the selected suggestion', (await chips())[2], verb);
  } else {
    await fill('phrase-in', `${verb} `);
    check('word entered', (await chips())[2], verb);
  }
  check('field is empty after inserting', await evaluate("document.getElementById('phrase-in').value"), '');
  await key('Backspace');
  check('Backspace in an empty field goes back to the previous word', [await evaluate("document.getElementById('phrase-in').value"), (await chips()).length], [verb, 2]);
  await typePhrase(`${cardPhrase} ${cardPhrase}`);
  check('separator between sentences', await evaluate("document.querySelectorAll('#tokens .sentence-gap').length"), 1);
  await typePhrase(cardPhrase);
  await fill('phrase-in', 'чита');
  await shot('decode-chips', 1280, 900);
  await typePhrase(cardPhrase);
  await setFormat('dec', 'plate', 'ru');
  check('wrong format: message', await until("document.querySelector('.value-box .error')?.textContent.includes('не тот формат')"), true);
  await typePhrase(`абырвалг ${cardPhrase.split(' ').slice(1).join(' ')}`);
  check('unknown word is named', await until("document.querySelector('#dec-result .error')?.textContent.includes('«абырвалг»')"), true);
  check('unknown word is a red chip', await evaluate("document.querySelector('#tokens .chip.unknown')?.textContent"), 'абырвалг');

  // More than 100 bytes: message.
  await click('#tab-enc');
  await setFormat('enc', 'hex');
  await fill('value-in', 'ab'.repeat(101));
  check('more than 100 bytes: message', await until("!document.getElementById('enc-error').hidden && document.getElementById('phrase-box').hidden"), true);

  // --- English: interface, phrases, decoding a phrase in another language
  await click('#tab-enc');
  await setFormat('enc', 'card');
  await fill('value-in', '4111 1111 1111 1111');
  const ruCard = await text('#phrase-out');
  await fill('ui-lang', 'en', 'change');
  check('English interface', [await evaluate('document.documentElement.lang'), await text('#tab-enc'), await text('#tab-dec')], ['en', 'Encode', 'Decode']);
  check('English phrase for the same card', await until("/^[A-Za-z' .]+$/.test(document.getElementById('phrase-out').textContent) && document.getElementById('phrase-check').textContent.startsWith('✓ Checked')"), true);
  const enCard = await text('#phrase-out');
  check('English: card round trip', await roundTripEn('card', '', '4111 1111 1111 1111'), '4111 1111 1111 1111');
  check('English: password round trip', await roundTripEn('text', '', 'Tr0ub4dor&3'), 'Tr0ub4dor&3');
  await click('#tab-dec');
  await setFormat('dec', 'card');
  await typePhrase(ruCard);
  check('a Russian phrase is parsed in the English interface', await until("document.getElementById('value-out')?.textContent === '4111 1111 1111 1111'"), true);
  const enTypo = enCard.replace(/\.$/, '').split(' ').map((w, i, a) => (i === a.length - 1 ? w.slice(0, 2) + (w[2] === 'x' ? 'z' : 'x') + w.slice(3) : w)).join(' ');
  await typePhrase(enTypo);
  check('English: a typo is fixed', await until("document.getElementById('value-out')?.textContent === '4111 1111 1111 1111' && !!document.querySelector('.fixes li')"), true);
  await typePhrase(enCard.split(' ')[0]);
  await fill('phrase-in', enCard.split(' ')[1].slice(0, 4).replace(/'.*/, ''));
  check('English suggestions', await until("document.querySelectorAll('#suggest-list li').length > 0"), true);
  await shot('english', 1280, 1000);
  await fill('ui-lang', 'ru', 'change');
  await click('#tab-enc');

  check('fetch blocked by CSP', await evaluate("fetch('https://example.com').then(() => 'ушёл', () => 'запрещён')"), 'запрещён');
  await fill('theme', 'dark', 'change');
  check('dark theme', await evaluate('document.documentElement.dataset.theme'), 'dark');
  await setFormat('enc', 'phone');
  await click('#example');
  await shot('phone-dark', 390, 844);

  const external = requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'));
  check('no network requests', external, []);
  check('no JS errors', problems.filter((p) => !/example\.com|Content Security Policy/i.test(p)), []);
} finally {
  await close();
}

done('app');
