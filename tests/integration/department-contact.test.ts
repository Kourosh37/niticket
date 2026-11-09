import { afterAll, expect, it } from 'vitest';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { getTicket } from '@niticket/core/application/tickets';

afterAll(() => db.$disconnect());

it('shows the active unit manager contact to participants and excludes inactive contacts and unrelated users', async () => {
  const f = await fixtures();
  const ticket = await db.ticket.create({
    data: { creatorId: f.student.id, departmentId: f.department.id, subject: 'Unit contact' },
  });
  await db.user.update({
    where: { id: f.manager.id },
    data: { image: `/api/v1/avatars/${f.manager.id}` },
  });
  const actor = await f.actor(f.student.id);
  const detail = await getTicket(actor, ticket.id, undefined, undefined, false);
  expect(detail.responsible).toEqual({
    id: f.manager.id,
    name: f.manager.name,
    image: `/api/v1/avatars/${f.manager.id}`,
  });
  await expect(getTicket(await f.actor(f.outsider.id), ticket.id)).rejects.toMatchObject({
    status: 404,
  });
  await db.departmentMembership.updateMany({
    where: { userId: f.manager.id },
    data: { active: false },
  });
  expect((await getTicket(actor, ticket.id, undefined, undefined, false)).responsible?.id).toBe(
    f.agent.id,
  );
  await db.user.update({ where: { id: f.agent.id }, data: { active: false } });
  expect((await getTicket(actor, ticket.id, undefined, undefined, false)).responsible).toBeNull();
});
