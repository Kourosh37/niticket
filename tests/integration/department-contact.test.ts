import { afterAll, expect, it } from 'vitest';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import { getTicket } from '@niticket/core/application/tickets';
import { saveDepartment, saveMember, updateUser } from '@niticket/core/application/administration';

afterAll(() => db.$disconnect());

it('preserves omitted department fields when applying a partial update', async () => {
  const f = await fixtures();
  await db.department.update({
    where: { id: f.department.id },
    data: {
      active: false,
      visible: false,
      acceptingTickets: false,
      description: 'Keep this description',
    },
  });
  const admin = await f.actor(f.admin.id);
  await saveDepartment(admin, { name: 'Renamed hidden unit' }, f.department.id);
  expect(await db.department.findUniqueOrThrow({ where: { id: f.department.id } })).toMatchObject({
    name: 'Renamed hidden unit',
    active: false,
    visible: false,
    acceptingTickets: false,
    description: 'Keep this description',
  });
  await saveDepartment(admin, { visible: true }, f.department.id);
  expect((await db.department.findUniqueOrThrow({ where: { id: f.department.id } })).visible).toBe(
    true,
  );
  await expect(saveDepartment(admin, {}, f.department.id)).rejects.toThrow();
});

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
  const admin = await f.actor(f.admin.id);
  await saveMember(admin, f.department.id, {
    userId: f.manager.id,
    role: 'MANAGER',
    active: false,
  });
  expect((await getTicket(actor, ticket.id, undefined, undefined, false)).responsible?.id).toBe(
    f.agent.id,
  );
  await updateUser(admin, f.agent.id, { active: false });
  expect((await getTicket(actor, ticket.id, undefined, undefined, false)).responsible).toBeNull();
});
