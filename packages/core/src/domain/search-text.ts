/** Keep in sync with niticket_search_text() in the search migration. */
export function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) % 16))
    .replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
    .replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .trim();
}

export function searchTerms(value: string, mode: 'all' | 'any' | 'phrase') {
  const tokens = mode === 'phrase' ? [value] : (value.match(/-?"[^"]+"|-?[^\s"]+/gu) ?? []);
  const include: string[] = [],
    exclude: string[] = [];
  for (const token of tokens) {
    const negative = mode !== 'phrase' && token.startsWith('-');
    const term = normalizeSearchText((negative ? token.slice(1) : token).replace(/^"|"$/g, ''));
    if (term) (negative ? exclude : include).push(term);
  }
  return { include: [...new Set(include)], exclude: [...new Set(exclude)] };
}

/** Return offsets into the original string; never generate HTML from message content. */
export function searchHighlights(value: string, terms: string[]) {
  let normalized = '';
  const starts: number[] = [],
    ends: number[] = [];
  let offset = 0;
  for (const char of value) {
    // Preserve a space for individual whitespace characters (normalization normally trims).
    const folded = /^[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069]$/u.test(char)
      ? ' '
      : normalizeSearchText(char);
    for (const unit of folded) {
      if (unit === ' ' && normalized.endsWith(' ')) {
        ends[ends.length - 1] = offset + char.length;
        continue;
      }
      normalized += unit;
      for (let i = 0; i < unit.length; i++) {
        starts.push(offset);
        ends.push(offset + char.length);
      }
    }
    offset += char.length;
  }
  const ranges: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0,
      index: number;
    while ((index = normalized.indexOf(term, from)) !== -1 && ranges.length < 100) {
      ranges.push([starts[index], ends[index + term.length - 1]]);
      from = index + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export function searchExcerpt(value: string, terms: string[], max = 360) {
  const first = searchHighlights(value, terms)[0]?.[0] ?? 0;
  const start = Math.max(0, first - 90),
    end = Math.min(value.length, start + max);
  return `${start ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}
