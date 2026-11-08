import { searchHighlights } from '@niticket/core/domain/search-text';

export function SearchHighlight({ text, terms }: { text: string; terms: string[] }) {
  const ranges = searchHighlights(text, terms);
  if (!ranges.length) return <>{text}</>;
  const pieces: React.ReactNode[] = [];
  let offset = 0;
  for (const [start, end] of ranges) {
    if (start > offset) pieces.push(text.slice(offset, start));
    pieces.push(<mark key={`${start}:${end}`}>{text.slice(start, end)}</mark>);
    offset = end;
  }
  if (offset < text.length) pieces.push(text.slice(offset));
  return <>{pieces}</>;
}
