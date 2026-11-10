import { boundedOfficeArchive } from '../lib/office-archive';
import { formatOfficeRows } from '../lib/office-content';

export type OfficePreview = { text?: string; rows?: string[][] };

self.onmessage = async (event: MessageEvent<{ data: ArrayBuffer; mime: string }>) => {
  try {
    const bytes = boundedOfficeArchive(event.data.data);
    let result: OfficePreview;
    if (event.data.mime.includes('wordprocessingml')) {
      const mammoth = await import('mammoth');
      const document = await mammoth.extractRawText({ arrayBuffer: bytes.buffer as ArrayBuffer });
      result = { text: document.value.slice(0, 300000) };
    } else {
      // The universal entry runs inside this worker without spawning untracked child workers.
      const { readSheet } = await import('read-excel-file/universal');
      const values = await readSheet(bytes.buffer as ArrayBuffer);
      result = { rows: formatOfficeRows(values) };
    }
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'پیش‌نمایش فایل انجام نشد.',
    });
  }
};
