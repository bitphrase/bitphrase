/**
 * Word-chip input with suggestions: the phrase on the "Decode" tab and the crypto
 * phrase on the "Encode" tab. A word becomes a chip after a space or punctuation;
 * pasting several words turns them all into chips; clicking a chip edits it;
 * Backspace in an empty field goes back to the previous word; ↑ ↓ Enter Tab — suggestions.
 */
import { tr } from '../core/i18n';

export interface Suggestion {
  word: string;
  kind: string;
}

export interface TokenInputOptions {
  /** Element ids: frame, chip container, input field, suggestion list, "clear" button. */
  ids: { box: string; tokens: string; input: string; list: string; clear: string };
  /** Suggestions for a word prefix (before — the words preceding it), or null to show none. */
  suggest(fragment: string, before: string[]): Suggestion[] | null;
  known(word: string): boolean;
  /** The word committed by a space: e.g. complete an unambiguous prefix to the whole word. */
  complete?(word: string): string;
  /** A number on each chip (1, 2, 3…), as in wallets. */
  numbered?: boolean;
  /** A separator after every N words (sentences). */
  groupEvery?: number;
  placeholder: string;
  onChange(): void;
}

export interface TokenInput {
  words(): string[];
  set(text: string): void;
  /** Chip marks: word index → correct form (yellow chip). */
  setMarks(marks: Map<number, string>): void;
  replace(changes: Map<number, string>): void;
  setPlaceholder(text: string): void;
  focus(): void;
}

/** Apostrophes stay inside a word ("Anna's") but are trimmed from its ends. */
const SEPARATOR = /[^\p{L}'’-]+/u;
const EDGE_APOSTROPHES = /^['’]+|['’]+$/g;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(tr(`#${id} нет на странице`, `#${id} is not on the page`));
  return el as T;
}

export function tokenInput(o: TokenInputOptions): TokenInput {
  const box = byId(o.ids.box);
  const tokensEl = byId(o.ids.tokens);
  const input = byId<HTMLInputElement>(o.ids.input);
  const list = byId<HTMLUListElement>(o.ids.list);
  const complete = o.complete ?? ((w: string) => w);
  let tokens: string[] = [];
  let editAt = 0;
  let marks = new Map<number, string>();
  let suggestions: Suggestion[] = [];
  let highlighted = 0;
  let placeholder = o.placeholder;

  const frag = () => input.value.trim();
  const words = () => (frag() ? [...tokens.slice(0, editAt), frag(), ...tokens.slice(editAt)] : [...tokens]);

  function commit(word: string) {
    const w = word.trim().replace(EDGE_APOSTROPHES, '');
    if (w) {
      tokens.splice(editAt, 0, complete(w));
      editAt += 1;
    }
    input.value = '';
  }
  const flush = () => frag() && commit(input.value);

  function render() {
    for (const node of [...tokensEl.children]) if (node !== input) node.remove();
    const shift = frag() ? 1 : 0;
    tokens.forEach((word, i) => {
      const position = i < editAt ? i : i + shift;
      const nodes: HTMLElement[] = [];
      if (o.groupEvery && position > 0 && position % o.groupEvery === 0) {
        const gap = document.createElement('span');
        gap.className = 'sentence-gap';
        gap.textContent = `${position / o.groupEvery + 1}`;
        nodes.push(gap);
      }
      const fix = marks.get(position);
      const known = o.known(word);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip${fix ? ' fixed' : known ? '' : ' unknown'}`;
      chip.title = fix ? tr(`Верно: «${fix}»`, `Correct: "${fix}"`) : known ? tr('Изменить слово', 'Edit word') : tr('Такого слова нет в списке', 'This word is not in the list');
      if (o.numbered) {
        const no = document.createElement('span');
        no.className = 'chip-no';
        no.textContent = `${position + 1}`;
        chip.append(no);
      }
      const text = document.createElement('span');
      text.className = 'chip-word';
      text.textContent = word;
      chip.append(text);
      chip.addEventListener('click', () => edit(i));
      nodes.push(chip);
      if (i < editAt) input.before(...nodes);
      else tokensEl.append(...nodes);
    });
    input.placeholder = tokens.length ? '' : placeholder;
  }

  function edit(i: number) {
    const at = i < editAt ? i : i + (frag() ? 1 : 0);
    flush();
    const word = tokens[at]!;
    tokens.splice(at, 1);
    editAt = at;
    input.value = word;
    update();
    input.focus();
    input.select();
  }

  function showSuggestions() {
    const before = tokens.slice(0, editAt);
    const found = frag() ? o.suggest(frag(), before) : null;
    suggestions = found ?? [];
    if (suggestions.length === 1 && suggestions[0]!.word.toLowerCase() === frag().toLowerCase()) suggestions = [];
    highlighted = 0;
    list.replaceChildren();
    list.hidden = !suggestions.length;
    if (!suggestions.length) return;
    const typed = frag().length;
    suggestions.forEach((s, k) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(k === highlighted));
      const word = document.createElement('span');
      word.className = 'word';
      const b = document.createElement('b');
      b.textContent = s.word.slice(0, typed);
      word.append(b, s.word.slice(typed));
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = s.kind;
      li.append(word, kind);
      // mousedown, not click: otherwise the field loses focus before the word is picked.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        accept(s.word);
      });
      list.append(li);
    });
    list.style.left = `${Math.max(0, Math.min(input.offsetLeft, box.clientWidth - 240))}px`;
    list.style.top = `${input.offsetTop + input.offsetHeight + 2}px`;
  }

  function moveHighlight(d: number) {
    if (!suggestions.length) return;
    highlighted = (highlighted + d + suggestions.length) % suggestions.length;
    list.querySelectorAll('li').forEach((li, k) => li.setAttribute('aria-selected', String(k === highlighted)));
  }

  function accept(word: string) {
    commit(word);
    update();
    input.focus();
  }

  function update() {
    render();
    showSuggestions();
    o.onChange();
  }

  input.addEventListener('input', () => {
    // A space or punctuation completes the word. Pasting several words completes all of them, the last one too.
    const parts = input.value.split(SEPARATOR);
    if (parts.length > 1) {
      const many = parts.filter(Boolean).length > 1;
      const last = many ? '' : parts.pop()!;
      for (const p of parts) commit(p);
      input.value = last;
    }
    update();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      moveHighlight(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' || (e.key === 'Tab' && suggestions.length)) {
      e.preventDefault();
      if (suggestions.length) accept(suggestions[highlighted]!.word);
      else if (frag()) accept(input.value);
    } else if (e.key === 'Escape') {
      suggestions = [];
      list.hidden = true;
    } else if (e.key === 'Backspace' && !input.value && editAt > 0) {
      // Empty field: go back to the previous word.
      e.preventDefault();
      editAt -= 1;
      input.value = tokens[editAt]!;
      tokens.splice(editAt, 1);
      update();
    }
  });
  input.addEventListener('blur', () => window.setTimeout(() => (list.hidden = true), 100));
  input.addEventListener('focus', showSuggestions);
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target === tokensEl) input.focus();
  });
  byId<HTMLButtonElement>(o.ids.clear).addEventListener('click', () => {
    api.set('');
    update();
    input.focus();
  });

  const api: TokenInput = {
    words,
    set(text) {
      tokens = text.split(SEPARATOR).map((w) => w.replace(EDGE_APOSTROPHES, '')).filter(Boolean);
      editAt = tokens.length;
      input.value = '';
      marks = new Map();
      render();
      list.hidden = true;
    },
    setMarks(m) {
      marks = m;
      render();
    },
    replace(changes) {
      flush();
      for (const [position, word] of changes) if (position < tokens.length) tokens[position] = word;
      editAt = tokens.length;
      marks = new Map();
      update();
    },
    setPlaceholder(text) {
      placeholder = text;
      render();
    },
    focus: () => input.focus(),
  };
  render();
  return api;
}
