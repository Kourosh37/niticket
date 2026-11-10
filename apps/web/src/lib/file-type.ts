const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};
const aliases: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
};

export function uploadMime(file: Pick<File, 'name' | 'type'>) {
  const mime = file.type.split(';')[0].trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream') return aliases[mime] ?? mime;
  const inferred = mimeByExtension[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!inferred) throw new Error('نوع این فایل پشتیبانی نمی‌شود.');
  // This is only an upload declaration; the server still verifies the actual file signature.
  return inferred;
}
