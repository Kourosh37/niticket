import { expect, it } from 'vitest';
import { needsReply, replyStatus, ticketState } from '../../apps/web/src/lib/ticket-ui';

it('uses the last public sender for card labels regardless of historical workflow status', () => {
  const pending = { status: 'CLOSED', creatorId: 'student', messages: [{ senderId: 'student' }] };
  const answered = {
    status: 'IN_PROGRESS',
    creatorId: 'student',
    messages: [{ senderId: 'officer' }],
  };
  expect(needsReply(pending, true)).toBe(true);
  expect(needsReply(pending, false)).toBe(false);
  expect(ticketState(pending, true)).toBe('پیام جدید');
  expect(ticketState(answered, true)).toBe('پاسخ داده‌شده');
  expect(needsReply(answered, true)).toBe(false);
  expect(needsReply(answered, false)).toBe(true);
  expect(needsReply({ ...answered, hasUnreadReplies: false }, false)).toBe(false);
  expect(ticketState({ ...answered, hasUnreadReplies: false })).toBe('پاسخ داده‌شده');
  expect(ticketState({ ...pending, hasUnreadReplies: true })).toBe('پاسخ جدید');
  expect(needsReply({ ...answered, messages: [{ senderId: 'officer', readAt: new Date() }] })).toBe(
    false,
  );
  expect(replyStatus(answered)).toBe('WAITING_FOR_USER');
  const empty = { creatorId: 'student', messages: [] };
  expect(needsReply(empty, true)).toBe(false);
  expect(needsReply(empty, false)).toBe(false);
  expect(replyStatus(empty)).toBeNull();
  expect(ticketState(empty)).toBe('هنوز پیامی ارسال نشده');
});
