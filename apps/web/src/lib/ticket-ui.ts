export function ticketState(status: string, staff = false) {
  return needsReply(status, true)
    ? staff
      ? 'پیام جدید'
      : 'منتظر پاسخ واحد'
    : staff
      ? 'پاسخ داده‌شده'
      : 'پیام از واحد';
}

export function needsReply(status: string, staff = false) {
  const pending = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_DEPARTMENT', 'REOPENED'].includes(status);
  return staff ? pending : !pending;
}
