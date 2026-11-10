import { Unzip, UnzipInflate, zipSync, type UnzipFile } from 'fflate';

const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_PART_BYTES = 8 * 1024 * 1024;
const TOO_COMPLEX = 'این فایل برای پیش‌نمایش پیچیده است؛ آن را دریافت کنید.';

function validateSheet(name: string, bytes: Uint8Array) {
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) return;
  const xml = new TextDecoder().decode(bytes);
  let cells = 0,
    rows = 0;
  for (const match of xml.matchAll(/<(?:[\w]+:)?(c|row)\b([^>]*)>/g)) {
    if (match[1] === 'c' ? ++cells > 100000 : ++rows > 5000) throw new Error(TOO_COMPLEX);
    const address = /\br\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[2]);
    if (!address) continue;
    const value = address[1] ?? address[2];
    if (match[1] === 'row') {
      if (!/^\d+$/.test(value) || Number(value) > 5000) throw new Error(TOO_COMPLEX);
    } else {
      const cell = /^([A-Z]{1,3})(\d+)$/.exec(value);
      if (!cell || Number(cell[2]) > 5000) throw new Error(TOO_COMPLEX);
      const column = [...cell[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
      if (column > 100) throw new Error(TOO_COMPLEX);
    }
  }
}

/** Bound actual decompressed bytes before any Office parser allocates document structures. */
export function boundedOfficeArchive(data: ArrayBuffer) {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const active = new Set<UnzipFile>();
  let total = 0,
    count = 0;
  const unzip = new Unzip((file) => {
    if (++count > 500 || (file.originalSize && file.originalSize > MAX_PART_BYTES))
      throw new Error(TOO_COMPLEX);
    active.add(file);
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      total += chunk.length;
      if (size > MAX_PART_BYTES || total > MAX_EXPANDED_BYTES) throw new Error(TOO_COMPLEX);
      chunks.push(chunk);
      if (final) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.length;
        }
        validateSheet(file.name, bytes);
        entries[file.name] = bytes;
        active.delete(file);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    const bytes = new Uint8Array(data);
    for (let offset = 0; offset < bytes.length; offset += 16384)
      unzip.push(bytes.subarray(offset, offset + 16384), offset + 16384 >= bytes.length);
    if (!count || active.size) throw new Error(TOO_COMPLEX);
    // Repack the validated entries so later parsers cannot follow a conflicting central directory.
    return zipSync(entries, { level: 0 });
  } finally {
    for (const file of active) file.terminate();
  }
}
