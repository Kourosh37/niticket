export const searchFilterFields = [
  'q',
  'ticketId',
  'departmentId',
  'senderId',
  'from',
  'to',
  'kind',
  'mode',
  'sort',
  'visibility',
] as const;

export function searchParameters(filters: Record<string, string | undefined>) {
  return new URLSearchParams(
    Object.entries(filters).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
}

/** Only allow returning from a search result to a known, local portal screen. */
export function searchReturnPath(value?: string) {
  if (
    !value ||
    value.length > 2200 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return undefined;
  try {
    const url = new URL(value, 'https://niticket.invalid');
    if (url.origin !== 'https://niticket.invalid') return undefined;
    return /^(?:\/(?:search|tickets|workspace|profile|settings|notifications|saved-replies)?|\/admin\/(?:users|departments(?:\/[a-f0-9-]{36}\/history)?))$/.test(
      url.pathname,
    )
      ? `${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
}
