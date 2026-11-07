/** Splitting input into words and the Levenshtein distance — for parsing a phrase and suggestions. */

/** Words of a text: letters with an inner hyphen or apostrophe (Anna's); everything else separates. */
export function wordsOf(text: string): string[] {
  return text.normalize('NFC').match(/\p{L}+(?:[-'’]\p{L}+)*/gu) ?? [];
}

/** Levenshtein distance, with an early exit once it surely exceeds limit. */
export function levenshtein(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length] ?? 0;
}
