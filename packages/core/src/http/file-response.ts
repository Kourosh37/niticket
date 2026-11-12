import type { streamAttachment } from '../application/attachments';

export function fileResponse(file: Awaited<ReturnType<typeof streamAttachment>>) {
  return new Response(file.stream, {
    status: file.status,
    headers: {
      etag: file.etag,
      'cache-control': file.status < 400 ? 'private, no-cache, no-transform' : 'no-store',
      vary: 'Cookie',
      'x-content-type-options': 'nosniff',
      ...(file.status === 304
        ? {}
        : {
            'content-type': file.mime,
            'content-length': String(file.size),
            'content-disposition': `${/^(audio|image|video)\//.test(file.mime) ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            'accept-ranges': 'bytes',
            ...(file.contentRange ? { 'content-range': file.contentRange } : {}),
          }),
    },
  });
}
