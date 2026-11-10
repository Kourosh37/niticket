import { request, RequestError } from './utils';

const uploadKeys = new WeakMap<File, Map<string, string>>();

async function upload(
  file: File,
  path: string,
  data: Record<string, unknown>,
  onProgress: (n: number) => void,
): Promise<string> {
  const context = JSON.stringify({ path, ...data });
  const keys = uploadKeys.get(file) ?? new Map<string, string>();
  uploadKeys.set(file, keys);
  for (let attempt = 0; attempt < 2; attempt++) {
    const clientId = keys.get(context) ?? crypto.randomUUID();
    keys.set(context, clientId);
    let intent: { id: string; url: string | null; scanStatus: string };
    try {
      intent = await request(path, { method: 'POST', body: JSON.stringify({ ...data, clientId }) });
    } catch (error) {
      if (error instanceof RequestError && error.code === 'UPLOAD_EXPIRED' && attempt === 0) {
        keys.delete(context);
        continue;
      }
      throw error;
    }
    if (intent.scanStatus === 'REJECTED')
      throw new Error('فایل پذیرفته نشد. فایل دیگری انتخاب کنید.');
    if (intent.url) {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', intent.url!);
        xhr.setRequestHeader('content-type', String(data.mime));
        xhr.timeout = 120000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error('بارگذاری فایل انجام نشد.'));
        xhr.onerror = () => reject(new Error('ارتباط هنگام بارگذاری قطع شد.'));
        xhr.ontimeout = () => reject(new Error('مهلت بارگذاری تمام شد.'));
        xhr.send(file);
      });
      await request(`/api/v1/uploads/${intent.id}/complete`, { method: 'POST', body: '{}' });
    }
    onProgress(100);
    return intent.id;
  }
  throw new Error('مهلت بارگذاری تمام شده است.');
}

export async function uploadFile(
  file: File,
  ticketId: string,
  messageId: string | undefined,
  onProgress: (n: number) => void,
  noteId?: string,
) {
  return upload(
    file,
    '/api/v1/uploads/intents',
    {
      ticketId,
      messageId,
      noteId,
      filename: file.name,
      mime: file.type.split(';')[0] || 'application/octet-stream',
      size: file.size,
    },
    onProgress,
  );
}

export async function uploadAvatar(
  file: File,
  userId: string | undefined,
  onProgress: (n: number) => void,
) {
  return upload(
    file,
    '/api/v1/avatars/intents',
    {
      userId,
      filename: file.name,
      mime: file.type.split(';')[0],
      size: file.size,
    },
    onProgress,
  );
}
