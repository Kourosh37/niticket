import { request } from './utils';

export async function uploadFile(
  file: File,
  ticketId: string,
  messageId: string | undefined,
  onProgress: (n: number) => void,
  noteId?: string,
) {
  const mime = file.type.split(';')[0] || 'application/octet-stream';
  const intent = await request<{ id: string; url: string }>('/api/v1/uploads/intents', {
    method: 'POST',
    body: JSON.stringify({
      ticketId,
      messageId,
      noteId,
      filename: file.name,
      mime,
      size: file.size,
    }),
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', intent.url);
    xhr.setRequestHeader('content-type', mime);
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
  return intent.id;
}

export async function uploadAvatar(
  file: File,
  userId: string | undefined,
  onProgress: (n: number) => void,
) {
  const mime = file.type.split(';')[0];
  const intent = await request<{ id: string; url: string }>('/api/v1/avatars/intents', {
    method: 'POST',
    body: JSON.stringify({ userId, filename: file.name, mime, size: file.size }),
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', intent.url);
    xhr.timeout = 120000;
    xhr.setRequestHeader('content-type', mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error('بارگذاری تصویر انجام نشد.'));
    xhr.onerror = () => reject(new Error('ارتباط هنگام بارگذاری تصویر قطع شد.'));
    xhr.ontimeout = () => reject(new Error('مهلت بارگذاری تصویر تمام شد.'));
    xhr.send(file);
  });
  await request(`/api/v1/uploads/${intent.id}/complete`, { method: 'POST', body: '{}' });
  return intent.id;
}
