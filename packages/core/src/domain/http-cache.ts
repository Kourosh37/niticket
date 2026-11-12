/** GET/HEAD validators use weak comparison; If-Range requires the exact strong tag. */
export function matchesETag(header: string | undefined | null, etag: string) {
  if (!header || header.length > 8192) return false;
  return header
    .split(',')
    .some((part) => part.trim() === '*' || part.trim().replace(/^W\//, '') === etag);
}

export function acceptsRange(ifRange: string | undefined | null, etag: string) {
  return !ifRange || ifRange.trim() === etag;
}
