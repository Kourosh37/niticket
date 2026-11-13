import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { dispatch } from '@niticket/core/http/router';
import { notifications, unreadNotificationCount } from '@niticket/core/application/administration';
import { transaction } from '@niticket/core/infrastructure/transaction';
import { drainRealtime, enqueueRealtime } from '@niticket/core/infrastructure/realtime';
import { closeReadCache } from '@niticket/core/infrastructure/read-cache';
import { redis } from '@niticket/core/infrastructure/redis';

afterAll(async () => {
  await drainRealtime();
  closeReadCache();
  redis().disconnect();
  await db.$disconnect();
});

for (const role of ['student', 'agent', 'admin'] as const) {
  it(`counts unread conversations once for ${role}, retains partially read conversations and isolates users`, async () => {
    const f = await fixtures();
    const actor = await f.actor(f[role].id);
    const [first, second] = await Promise.all(
      [0, 1].map((index) =>
        db.ticket.create({
          data: {
            creatorId: f.student.id,
            departmentId: f.department.id,
            subject: `Unread conversations ${index}`,
          },
        }),
      ),
    );
    const count = () => unreadNotificationCount(actor.id);
    expect(await count()).toBe(0);
    await db.notification.createMany({
      data: [
        ...Array.from({ length: 7 }, () => ({
          userId: actor.id,
          ticketId: first.id,
          eventId: randomUUID(),
          title: 'Seven messages in one conversation',
        })),
        {
          userId: f.outsider.id,
          ticketId: second.id,
          eventId: randomUUID(),
          title: 'Another user',
        },
        {
          userId: actor.id,
          ticketId: second.id,
          eventId: randomUUID(),
          title: 'Already read',
          readAt: new Date(),
        },
      ],
    });
    const request = new Request('http://localhost/api/v1/notifications/count');
    const endpoint = () => dispatch(request, ['notifications', 'count'], actor);
    expect(await count()).toBe(1);
    expect(await endpoint()).toEqual({ unreadCount: 1 });
    expect(await notifications(actor)).toMatchObject({ unreadCount: 1 });
    const mutate = async (work: Parameters<typeof transaction>[0]) => {
      await transaction(async (tx) => {
        await work(tx);
        await enqueueRealtime(tx, { scope: 'user', userId: actor.id, topics: ['notifications'] });
      });
      await drainRealtime();
    };
    await mutate(async (tx) => {
      await tx.notification.create({
        data: {
          userId: actor.id,
          ticketId: second.id,
          eventId: randomUUID(),
          title: 'Another unread conversation',
        },
      });
    });
    expect(await endpoint()).toEqual({ unreadCount: 2 });
    const unread = await db.notification.findFirstOrThrow({
      where: { userId: actor.id, ticketId: first.id, readAt: null },
    });
    await mutate(async (tx) => {
      await tx.notification.update({ where: { id: unread.id }, data: { readAt: new Date() } });
    });
    expect(await endpoint()).toEqual({ unreadCount: 2 });
    await mutate(async (tx) => {
      await tx.notification.updateMany({
        where: { userId: actor.id, ticketId: first.id },
        data: { readAt: new Date() },
      });
    });
    expect(await endpoint()).toEqual({ unreadCount: 1 });
    await mutate(async (tx) => {
      await tx.notification.updateMany({
        where: { userId: actor.id },
        data: { readAt: new Date() },
      });
    });
    expect(await endpoint()).toEqual({ unreadCount: 0 });
    expect(await unreadNotificationCount(f.outsider.id)).toBe(1);
  });
}

it('preserves unrelated account notifications while grouping conversation notifications', async () => {
  const f = await fixtures();
  await db.notification.createMany({
    data: Array.from({ length: 2 }, () => ({
      userId: f.student.id,
      eventId: randomUUID(),
      title: 'Account notification without a conversation',
    })),
  });
  expect(await unreadNotificationCount(f.student.id)).toBe(2);
});
