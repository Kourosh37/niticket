import { request, RequestError } from './utils';

type ApprovalStatus = { id: string; filename: string; scanStatus: string };

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);

    function cancel() {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason);
    }

    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

export async function waitForAttachmentApproval(
  attachmentIds: string[],
  {
    signal,
    onProgress,
    timeoutMs = 180000,
  }: {
    signal: AbortSignal;
    onProgress?: (approved: number, total: number) => void;
    timeoutMs?: number;
  },
) {
  signal.throwIfAborted();
  const ids = [...new Set(attachmentIds)];
  if (!ids.length) return;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    onProgress?.(0, ids.length);
    let interval = 1000;
    for (;;) {
      controller.signal.throwIfAborted();
      try {
        const files = await request<ApprovalStatus[]>(
          `/api/v1/uploads/statuses?ids=${ids.join(',')}`,
          {
            signal: controller.signal,
          },
        );
        controller.signal.throwIfAborted();
        const byId = new Map(files.map((file) => [file.id, file]));
        let approved = 0;
        for (const id of ids) {
          const file = byId.get(id);
          if (file?.scanStatus === 'REJECTED')
            throw new Error(
              `فایل «${file.filename}» تأیید نشد. آن را حذف کنید یا فایل دیگری انتخاب کنید.`,
            );
          if (file?.scanStatus === 'CLEAN') approved++;
        }
        onProgress?.(approved, ids.length);
        if (approved === ids.length) return;
        interval = 1000;
      } catch (error) {
        // A temporary network/worker delay must not turn a pending file into a
        // successful save. Permission errors and rejected files remain visible.
        if (
          !(error instanceof TypeError) &&
          !(error instanceof RequestError && ((error.status ?? 0) >= 500 || error.status === 429))
        )
          throw error;
        interval = Math.min(interval * 2, 5000);
      }
      await delay(interval, controller.signal);
    }
  } catch (error) {
    if (timedOut && !signal.aborted)
      throw new Error(
        'بررسی پیوست‌ها هنوز کامل نشده است. کمی بعد دوباره ذخیره کنید؛ نیازی به بارگذاری دوباره فایل‌ها نیست.',
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}
