/** Bound the structured-clone payload as well as the number of visible spreadsheet cells. */
export function formatOfficeRows(values: unknown[][]) {
  let remaining = 300000;
  const dates = new Intl.DateTimeFormat('fa-IR');
  return values.slice(0, 500).map((row) =>
    row.slice(0, 30).map((value) => {
      if (!remaining) return '';
      const text = (value instanceof Date ? dates.format(value) : String(value ?? '')).slice(
        0,
        Math.min(10000, remaining),
      );
      remaining -= text.length;
      return text;
    }),
  );
}
