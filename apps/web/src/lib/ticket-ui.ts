type ReplySummary = {
  creatorId: string;
  messages: { senderId: string; readAt?: Date | string | null }[];
  hasUnreadReplies?: boolean;
};

export function replyStatus(ticket: ReplySummary) {
  const latest = ticket.messages[0];
  return latest ? (latest.senderId === ticket.creatorId ? 'OPEN' : 'WAITING_FOR_USER') : null;
}

export function ticketState(ticket: ReplySummary, staff = false) {
  if (!ticket.messages.length) return 'هنوز پیامی ارسال نشده';
  if (!staff && needsReply(ticket)) return 'پاسخ جدید';
  return needsReply(ticket, true)
    ? staff
      ? 'پیام جدید'
      : 'منتظر پاسخ واحد'
    : staff
      ? 'پاسخ داده‌شده'
      : 'پاسخ داده‌شده';
}

export function needsReply(ticket: ReplySummary, staff = false) {
  const status = replyStatus(ticket);
  if (!status) return false;
  const pending = status === 'OPEN';
  return staff
    ? pending
    : (ticket.hasUnreadReplies ?? (!pending && ticket.messages[0].readAt == null));
}
