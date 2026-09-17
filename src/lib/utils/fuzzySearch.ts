export interface FuzzySearchOptions {
  ignoreWords?: readonly string[];
  /** Allow long queries to miss some tokens when at least two match well. */
  partialCoverage?: boolean;
  /** Allow equal-length anagrams, ranked below typo matches. */
  unorderedCharacters?: boolean;
  /** Allow one edit in short words and up to two in longer words. */
  balancedTypos?: boolean;
  /** Match the full initials of the first field, ranked below literal matches. */
  titleInitials?: boolean;
}

export function fuzzySearch<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly string[],
  options: FuzzySearchOptions = {},
): T[] {
  const normalized = normalize(query);
  if (!normalized) return [...items];
  const ignored = new Set(options.ignoreWords?.map(normalize));
  const tokens = [...new Set(normalized.split(" ").filter(token => !ignored.has(token)))];
  if (!tokens.length && !options.titleInitials) return [];

  return items
    .map((item, order) => {
      const text = fields(item).map(normalize);
      let score = 0;
      let matched = 0;
      let strong = 0;
      for (const token of tokens) {
        const best = Math.max(...text.map((field, index) => match(token, field, options, ignored) - index * 2));
        if (best > 0) { matched++; score += best; }
        if (best >= 65) strong++;
      }
      const complete = tokens.length > 0 && matched === tokens.length;
      const partial = options.partialCoverage && tokens.length > 2 &&
        matched > tokens.length / 2 && strong >= 2;
      const initials = options.titleInitials && normalized.length >= 2 &&
        normalized === text[0]?.split(" ").map(word => [...word][0]).join("");
      const relevance = complete || partial ? score * matched / tokens.length : 0;
      return { item, order, score: Math.max(relevance, initials ? 68 : 0) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item }) => item);
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

function match(query: string, text: string, options: FuzzySearchOptions, ignored: ReadonlySet<string>): number {
  if (query === text) return 100;
  if (text.startsWith(query)) return 90;
  if (text.includes(` ${query}`)) return 80;
  if (text.includes(query)) return 70;
  // Avoid noisy typo matches for one- and two-character queries.
  if (query.length < 3) return 0;
  let best = 0;
  for (const word of text.split(" ")) {
    if (ignored.has(word)) continue;
    if (options.balancedTypos) {
      const cost = editCost(query, word);
      if (cost <= 12) best = Math.max(best, 60 + (12 - cost) / 2);
      else if (Math.min(query.length, word.length) >= 5 &&
        Math.max(query.length, word.length) >= 7 && cost <= 24) {
        best = Math.max(best, 48 + (24 - cost) / 2);
      }
    } else if (oneEditApart(query, word)) {
      best = Math.max(best, 60);
    }
    if (options.unorderedCharacters && word.length === query.length &&
      [...word].sort().join("") === [...query].sort().join("")) {
      best = Math.max(best, 35);
    }
    let cursor = 0;
    for (const character of word) {
      if (character === query[cursor]) cursor++;
    }
    if (!options.balancedTypos && cursor === query.length && query.length / word.length >= 0.55) {
      best = Math.max(best, 40 + 10 * query.length / word.length);
    }
  }
  return best;
}

// Nearby QWERTY keys cost slightly less to substitute.
const keyboard = new Map(["qwertyuiop", "asdfghjkl", "zxcvbnm"].flatMap((row, y) =>
  [...row].map((key, x) => [key, [x + [0, 0.25, 0.75][y], y]] as const)));

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  const first = keyboard.get(a);
  const second = keyboard.get(b);
  return first && second && Math.abs(first[0] - second[0]) <= 1 &&
    Math.abs(first[1] - second[1]) <= 1 ? 10 : 12;
}

// Edit costs start at 10, so 24 still caps a match at two mistakes.
function editCost(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return Infinity;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i * 10);
  let beforePrevious = previous;
  for (let i = 1; i <= a.length; i++) {
    const current = [i * 10];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 10, current[j - 1] + 10,
        previous[j - 1] + substitutionCost(a[i - 1], b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 10);
      }
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
