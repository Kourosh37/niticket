type ReplySummary = { creatorId: string; messages: { senderId: string }[] };

export function replyStatus(ticket: ReplySummary) {
  const latest = ticket.messages[0];
  return latest ? (latest.senderId === ticket.creatorId ? 'OPEN' : 'WAITING_FOR_USER') : null;
}

export function ticketState(ticket: ReplySummary, staff = false) {
  if (!ticket.messages.length) return 'هنوز پیامی ارسال نشده';
  return needsReply(ticket, true)
    ? staff
      ? 'پیام جدید'
      : 'منتظر پاسخ واحد'
    : staff
      ? 'پاسخ داده‌شده'
      : 'پیام از واحد';
}

export function needsReply(ticket: ReplySummary, staff = false) {
  const status = replyStatus(ticket);
  if (!status) return false;
  const pending = status === 'OPEN';
  return staff ? pending : !pending;
}
