export function ticketState(status: string, staff = false) {
  const labels: Record<string, string> = {
    OPEN: staff ? 'درخواست جدید' : 'منتظر پاسخ واحد',
    IN_PROGRESS: 'در حال رسیدگی',
    WAITING_FOR_USER: staff ? 'منتظر پاسخ فرستنده' : 'نوبت پاسخ شماست',
    WAITING_FOR_DEPARTMENT: 'در حال پیگیری',
    RESOLVED: 'رسیدگی انجام شد',
    CLOSED: 'گفتگو بسته شده',
    REOPENED: 'دوباره در حال پیگیری',
  };
  return labels[status] ?? status;
}

export function needsReply(status: string, staff = false) {
  return staff
    ? ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_DEPARTMENT', 'REOPENED'].includes(status)
    : status === 'WAITING_FOR_USER';
}
