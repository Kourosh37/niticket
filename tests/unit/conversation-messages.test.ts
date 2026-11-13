import { expect, it } from 'vitest';
import {
  mergeConversationMessages,
  type ConversationMessage,
} from '../../apps/web/src/lib/conversation-messages';

const message = (id: string, at = 0): ConversationMessage => ({
  id,
  body: id,
  visibility: 'PUBLIC',
  createdAt: new Date(at),
  readAt: null,
  sender: { id: 'author', name: 'Author', image: null },
  attachments: [],
});

it('preserves the window reference for unchanged sync data and merges changed receipts without mutating cached pages', () => {
  const previous = [message('old'), message('new', 100)];
  expect(mergeConversationMessages(previous, [structuredClone(previous[1])])).toBe(previous);
  const read = { ...previous[1], readAt: new Date(200) };
  const next = mergeConversationMessages(previous, [read, message('between', 50)]);
  expect(next.map((item) => item.id)).toEqual(['old', 'between', 'new']);
  expect(next[2].readAt).toEqual(new Date(200));
  expect(previous[1].readAt).toBeNull();
});
