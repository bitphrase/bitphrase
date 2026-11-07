/**
 * Static texts of the page (elements with data-i18n, data-i18n-aria, data-i18n-title in
 * template.html) in both interface languages. Texts built at run time live next to their
 * code as tr('…', '…').
 */
import { uiLang } from '../core/i18n';

const STATIC: Record<string, [ru: string, en: string]> = {
  subtitle: [
    'Карта, телефон, номер автомобиля, крипто-фраза, пароль или любые байты → запоминаемые предложения и обратно. Всё считается на этой странице, в сеть ничего не уходит.',
    'A card, phone or licence plate number, a crypto seed phrase, a password or any bytes → memorable sentences and back. Everything is computed on this page; nothing goes to the network.',
  ],
  language: ['Язык', 'Language'],
  theme: ['Тема', 'Theme'],
  themeAuto: ['как в системе', 'system'],
  themeLight: ['светлая', 'light'],
  themeDark: ['тёмная', 'dark'],
  mode: ['Режим', 'Mode'],
  tabEncode: ['Кодировать', 'Encode'],
  tabDecode: ['Декодировать', 'Decode'],
  encFormat: ['Что кодируем', 'What to encode'],
  decFormat: ['Что было закодировано', 'What was encoded'],
  subFormat: ['Вид', 'Kind'],
  seedKindTitle: ['Сколько слов во фразе и чья она', 'How many words and which wallet'],
  seedKindAria: ['Формат крипто-фразы', 'Seed phrase format'],
  seedWords: ['Слова фразы — по порядку', 'Words of the phrase, in order'],
  clearPhrase: ['Очистить фразу', 'Clear the phrase'],
  clear: ['Очистить', 'Clear'],
  example: ['Пример', 'Example'],
  bytesUnit: ['байт', 'bytes'],
  copyPhrase: ['Скопировать фразу', 'Copy the phrase'],
  checkPhrase: ['Проверить на вкладке «Декодировать»', 'Check it on the "Decode" tab'],
  phraseIn: [
    'Фраза — слово за словом (регистр, ё, знаки препинания не важны)',
    'The phrase, word by word (case and punctuation don\'t matter)',
  ],
  phraseHint: [
    'Подсказки — после 4 букв: ↑ ↓ — выбрать, Enter или Tab — подставить, пробел — следующее слово, Backspace в пустом поле — вернуться к предыдущему. Щелчок по слову — исправить. Можно вставить фразу целиком. Язык фразы определяется сам.',
    'Suggestions after 4 letters: ↑ ↓ to pick, Enter or Tab to insert, space for the next word, Backspace in an empty field to go back. Click a word to fix it. You can paste the whole phrase. The phrase\'s language is detected automatically.',
  ],
  disclaimer: [
    'Нелепые сочетания — нарочно: так лучше запоминается. Словари — черновик: после ручного отбора слов фразы изменятся и старые перестанут разбираться. Не храните так настоящие ключи и карты.',
    'Absurd combinations are on purpose: they stick better. The dictionaries are a draft: once the words are hand-picked, phrases will change and old ones will stop parsing. Don\'t keep real keys and cards this way.',
  ],
  version: ['Версия', 'Version'],
};

/** Fill in the static texts of the page in the current language. */
export function applyStatic(root: ParentNode = document) {
  const i = uiLang() === 'en' ? 1 : 0;
  const text = (key: string | undefined) => (key && STATIC[key] ? STATIC[key][i] : '');
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = text(el.dataset.i18n)));
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', text(el.dataset.i18nAria)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = text(el.dataset.i18nTitle)));
  document.documentElement.lang = uiLang();
}
