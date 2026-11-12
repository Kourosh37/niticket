import { afterAll, expect, it } from 'vitest';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { openConversation, addMessage, transferTicket } from '@niticket/core/application/tickets';
import { markMessagesSeen } from '@niticket/core/application/message-receipts';
import {
  authorizedUpdate,
  mayReceiveChange,
  refreshStreamActor,
} from '@niticket/core/application/realtime-access';
import { realtimeChangeSchema } from '@niticket/core/domain/realtime';
import { revokeSessions } from '@niticket/core/application/sessions';
import { randomUUID } from 'node:crypto';
import {
  createSavedReply,
  updateSavedReply,
  deleteSavedReply,
} from '@niticket/core/application/saved-replies';
import { attachmentChanged } from '@niticket/core/application/realtime-events';
import { transaction } from '@niticket/core/infrastructure/transaction';
import { drainRealtime } from '@niticket/core/infrastructure/realtime';

afterAll(async () => {
  await drainRealtime();
  await db.$disconnect();
});

it('routes saved-reply mutations and private attachment changes only to their authorized audiences', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  const reply = await createSavedReply(staff, {
    departmentId: f.department.id,
    clientId: randomUUID(),
    title: 'Private template',
    body: 'Private body',
  });
  await updateSavedReply(staff, reply.id, {
    title: 'Updated template',
    body: 'Private body',
    version: 1,
  });
  await deleteSavedReply(staff, reply.id, { version: 2 });
  const events = await db.outboxEvent.findMany({
    where: {
      type: 'REALTIME_INVALIDATION',
      payload: { path: ['departmentId'], equals: f.department.id },
    },
  });
  const changes = events.map((event) => realtimeChangeSchema.parse(event.payload));
  expect(changes).toHaveLength(3);
  expect((await authorizedUpdate(staff, changes)).topics).toEqual(['saved-replies']);
  expect((await authorizedUpdate(student, changes)).topics).toEqual([]);
  expect((await authorizedUpdate(await f.actor(f.outsider.id), changes)).topics).toEqual([]);
  const ticket = await openConversation(student, { departmentId: f.department.id });
  const message = await addMessage(staff, ticket.id, {
    version: 1,
    body: 'Private file',
    visibility: 'INTERNAL',
  });
  await transaction((tx) =>
    attachmentChanged(tx, {
      uploaderId: staff.id,
      ticketId: ticket.id,
      messageId: message.id,
      noteId: null,
      savedReplyId: null,
      avatarOwnerId: null,
    }),
  );
  const attachments = (
    await db.outboxEvent.findMany({
      where: { type: 'REALTIME_INVALIDATION', payload: { path: ['ticketId'], equals: ticket.id } },
    })
  )
    .map((event) => realtimeChangeSchema.parse(event.payload))
    .filter((change) => change.topics.includes('attachments'));
  expect(attachments).toHaveLength(1);
  expect((await authorizedUpdate(student, attachments)).topics).toEqual([]);
  expect((await authorizedUpdate(staff, attachments)).topics).toEqual([
    'conversation',
    'attachments',
  ]);
});

it('commits public and private invalidations with the correct audiences and never includes message content', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id);
  const ticket = await openConversation(student, { departmentId: f.department.id });
  await addMessage(student, ticket.id, { version: 1, body: 'public-secret-marker' });
  await addMessage(staff, ticket.id, {
    version: 2,
    body: 'private-secret-marker',
    visibility: 'INTERNAL',
  });
  const events = await db.outboxEvent.findMany({
    where: { type: 'REALTIME_INVALIDATION', payload: { path: ['ticketId'], equals: ticket.id } },
  });
  const changes = events.map((event) => realtimeChangeSchema.parse(event.payload));
  expect(changes.some((change) => change.scope === 'ticket' && change.internal)).toBe(true);
  const privateChanges = changes.filter((change) => change.scope === 'ticket' && change.internal);
  expect((await authorizedUpdate(student, privateChanges)).topics).toEqual([]);
  expect((await authorizedUpdate(staff, privateChanges)).ticketIds).toEqual([ticket.id]);
  expect((await authorizedUpdate(await f.actor(f.outsider.id), changes)).topics).toEqual([]);
  expect(JSON.stringify(events.map((event) => event.payload))).not.toMatch(/secret-marker/);
});

it('keeps private read receipts private and invalidates public receipt state without changing chat activity', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    staff = await f.actor(f.agent.id),
    manager = await f.actor(f.manager.id);
  const ticket = await openConversation(student, { departmentId: f.department.id });
  const message = await addMessage(staff, ticket.id, {
    version: 1,
    body: 'private',
    visibility: 'INTERNAL',
  });
  await markMessagesSeen(manager, ticket.id, { messageIds: [message.id] });
  const events = await db.outboxEvent.findMany({
    where: { type: 'REALTIME_INVALIDATION', payload: { path: ['ticketId'], equals: ticket.id } },
  });
  const receipt = events
    .map((event) => realtimeChangeSchema.parse(event.payload))
    .filter((change) => change.topics.includes('receipts'));
  expect(receipt).toHaveLength(1);
  expect(mayReceiveChange(student, receipt[0])).toBe(false);
  expect((await authorizedUpdate(manager, receipt)).topics).toEqual(['receipts']);
});

it('rechecks the current unit after transfer and wakes the former unit without exposing the destination conversation', async () => {
  const f = await fixtures(),
    student = await f.actor(f.student.id),
    manager = await f.actor(f.manager.id);
  const ticket = await openConversation(student, { departmentId: f.department.id });
  await transferTicket(manager, ticket.id, {
    version: 1,
    departmentId: f.destination.id,
    reason: 'transfer',
  });
  const events = await db.outboxEvent.findMany({
    where: { type: 'REALTIME_INVALIDATION', payload: { path: ['ticketId'], equals: ticket.id } },
  });
  const changes = events.map((event) => realtimeChangeSchema.parse(event.payload));
  expect((await authorizedUpdate(manager, changes)).ticketIds).toEqual([]);
  expect((await authorizedUpdate(student, changes)).ticketIds).toEqual([ticket.id]);
  expect(
    await db.outboxEvent.count({
      where: {
        type: 'REALTIME_INVALIDATION',
        payload: { path: ['departmentId'], equals: f.department.id },
      },
    }),
  ).toBeGreaterThan(0);
});

it('rejects deleted and expired stream sessions instead of trusting the actor captured when a connection opened', async () => {
  const f = await fixtures(),
    id = randomUUID();
  await db.session.create({
    data: {
      id,
      token: randomUUID(),
      userId: f.student.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const actor = { ...(await f.actor(f.student.id)), sessionId: id };
  expect((await refreshStreamActor(actor)).actor.id).toBe(actor.id);
  await db.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await expect(refreshStreamActor(actor)).rejects.toMatchObject({ status: 401 });
  await db.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 60000) } });
  const other = randomUUID();
  await db.session.create({
    data: {
      id: other,
      token: randomUUID(),
      userId: f.student.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await revokeSessions({ ...actor, sessionId: other }, id);
  await expect(refreshStreamActor(actor)).rejects.toMatchObject({ status: 401 });
});
