import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomInt } from 'node:crypto';
import sharp from 'sharp';
import { db } from '@niticket/database';
import { fixtures } from '../helpers/fixtures';
import {
  provisionDepartment,
  updateUser,
  listDepartments,
} from '@niticket/core/application/administration';
import { registerStudent } from '@niticket/core/application/registration';
import { getAuth } from '@niticket/core/infrastructure/auth';
import {
  createTicket,
  addMessage,
  changeStatus,
  getTicket,
  addActivityNote,
} from '@niticket/core/application/tickets';
import {
  createUpload,
  createAvatarUpload,
  completeUpload,
  downloadAttachment,
  downloadAvatar,
} from '@niticket/core/application/attachments';
import { processScan, processNotification } from '@niticket/core/application/jobs';

let f: Awaited<ReturnType<typeof fixtures>>;
let ticketId: string;
beforeAll(async () => {
  f = await fixtures();
  ticketId = (
    await createTicket(
      await f.actor(f.student.id),
      {
        departmentId: f.department.id,
        subject: 'آزمون نقش‌های سامانه',
        body: 'بررسی دسترسی و تاریخچه درخواست دانشجو',
      },
      randomUUID(),
    )
  ).id;
});
afterAll(async () => {
  await db.$disconnect();
});
it('keeps every unit reachable through scoped search and deterministic pagination', async () => {
  const name = `صفحه‌بندی ${randomUUID().slice(0, 8)}`;
  await db.department.createMany({
    data: Array.from({ length: 35 }, (_, i) => ({
      name: `${name} ${String(i).padStart(2, '0')}`,
      slug: `page-${randomUUID()}`,
    })),
  });
  const admin = await f.actor(f.admin.id);
  const page = await listDepartments(admin, true, { q: name, limit: 31 });
  expect(page).toHaveLength(31);
  const remaining = await listDepartments(admin, true, { q: name, cursor: page[29].id, limit: 31 });
  expect(remaining).toHaveLength(5);
  expect(new Set([...page.slice(0, 30), ...remaining].map((d) => d.id)).size).toBe(35);
  expect(await listDepartments(await f.actor(f.agent.id), true, { q: name })).toEqual([]);
});

it('atomically provisions a verified unit officer and generates all identifiers', async () => {
  const username = `officer-${randomUUID().slice(0, 8)}`;
  const input = {
    name: 'واحد تازه آزمایشی',
    responsible: {
      name: 'مسئول واحد تازه',
      username,
      email: `${username}@stu.nit.ac.ir`,
      password: f.password,
      phone: '۰۹۱۲۳۴۵۶۷۸۹',
    },
  };
  const created = await provisionDepartment(await f.actor(f.admin.id), input);
  const department = await db.department.findUniqueOrThrow({
    where: { id: created.id },
    include: { memberships: true },
  });
  const person = await db.user.findUniqueOrThrow({
    where: { id: created.responsibleUserId },
    include: { accounts: true },
  });
  expect(department.slug).toMatch(/^unit-[a-f0-9-]+$/);
  expect(department.memberships[0].userId).toBe(person.id);
  expect(person).toMatchObject({
    role: 'STAFF',
    isAdmin: false,
    emailVerified: true,
    username,
    phone: '09123456789',
  });
  expect(person.accounts[0].password).not.toBe(f.password);
  const before = await db.department.count();
  await expect(provisionDepartment(await f.actor(f.admin.id), input)).rejects.toThrow();
  expect(await db.department.count()).toBe(before);
  await expect(
    provisionDepartment(await f.actor(f.agent.id), { ...input, name: 'واحد غیرمجاز' }),
  ).rejects.toThrow();
});

it('allows only students to submit and makes administrator ticket access read-only', async () => {
  const admin = await f.actor(f.admin.id),
    staff = await f.actor(f.agent.id);
  const input = {
    departmentId: f.department.id,
    subject: 'درخواست غیرمجاز آزمایشی',
    body: 'این درخواست نباید توسط مدیر یا مسئول ایجاد شود.',
  };
  for (const actor of [admin, staff])
    await expect(createTicket(actor, input, randomUUID())).rejects.toThrow();
  const detail = await getTicket(admin, ticketId);
  expect(detail.permissions).toMatchObject({ readOnly: true, reply: false, staff: false });
  await expect(
    addMessage(admin, ticketId, { version: 1, body: 'پاسخ مدیر', visibility: 'PUBLIC' }),
  ).rejects.toThrow();
  await expect(
    changeStatus(admin, ticketId, { version: 1, status: 'IN_PROGRESS' }),
  ).rejects.toThrow();
  await expect(
    createUpload(admin, { ticketId, filename: 'admin.txt', mime: 'text/plain', size: 4 }),
  ).rejects.toThrow();
  const otherUnit = await db.departmentMembership.create({
    data: {
      departmentId: f.destination.id,
      userId: f.outsider.id,
      role: 'MANAGER',
      assignedBy: f.admin.id,
    },
  });
  await db.user.update({ where: { id: f.outsider.id }, data: { role: 'STAFF' } });
  await expect(getTicket(await f.actor(f.outsider.id), ticketId)).rejects.toThrow();
  await db.departmentMembership.delete({ where: { id: otherUnit.id } });
});

it('keeps optional per-event notes and their attachments private to the unit and administrator', async () => {
  const staff = await f.actor(f.agent.id),
    student = await f.actor(f.student.id);
  const activity = await db.activity.findFirstOrThrow({ where: { ticketId } });
  const note = await addActivityNote(staff, ticketId, activity.id, { body: 'PRIVATE_EVENT_NOTE' });
  await expect(
    addActivityNote(student, ticketId, activity.id, { body: 'FORGED_NOTE' }),
  ).rejects.toThrow();
  await expect(
    addActivityNote(await f.actor(f.admin.id), ticketId, activity.id, { body: 'FORGED_ADMIN' }),
  ).rejects.toThrow();
  expect(JSON.stringify(await getTicket(student, ticketId))).not.toContain('PRIVATE_EVENT_NOTE');
  expect(JSON.stringify(await getTicket(staff, ticketId))).toContain('PRIVATE_EVENT_NOTE');
  const bytes = Buffer.from('PRIVATE_NOTE_ATTACHMENT');
  const intent = await createUpload(staff, {
    ticketId,
    noteId: note.id,
    filename: 'note.txt',
    mime: 'text/plain',
    size: bytes.length,
  });
  await fetch(intent.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: bytes,
  });
  await completeUpload(staff, intent.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
  });
  await processScan(event.id, event.payload);
  expect((await downloadAttachment(staff, intent.id)).bytes.equals(bytes)).toBe(true);
  await expect(downloadAttachment(student, intent.id)).rejects.toThrow();
  const adminView = await getTicket(await f.actor(f.admin.id), ticketId);
  expect(JSON.stringify(adminView)).toContain('PRIVATE_EVENT_NOTE');
  expect(
    adminView.activities.flatMap((a) => a.notes).find((n) => n.id === note.id)?.attachments,
  ).toHaveLength(1);
});

it('scans and normalizes profile photos and restricts changes to the administrator or owner', async () => {
  const bytes = await sharp({
    create: { width: 40, height: 60, channels: 3, background: '#21634e' },
  })
    .png()
    .toBuffer();
  const input = {
    userId: f.agent.id,
    filename: 'photo.png',
    mime: 'image/png',
    size: bytes.length,
  };
  await expect(createAvatarUpload(await f.actor(f.student.id), input)).rejects.toThrow();
  await expect(createAvatarUpload(await f.actor(f.manager.id), input)).rejects.toThrow();
  for (const actor of [await f.actor(f.admin.id), await f.actor(f.agent.id)]) {
    const intent = await createAvatarUpload(actor, input);
    await fetch(intent.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    await completeUpload(actor, intent.id);
    const event = await db.outboxEvent.findFirstOrThrow({
      where: { type: 'SCAN_ATTACHMENT', payload: { path: ['attachmentId'], equals: intent.id } },
    });
    await processScan(event.id, event.payload);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.agent.id } });
    expect(user.avatarAttachmentId).toBe(intent.id);
    expect(user.image).toContain('/api/v1/avatars/');
    const result = await downloadAvatar(await f.actor(f.student.id), f.agent.id);
    expect(result.mime).toBe('image/webp');
    expect((await sharp(result.bytes).metadata()).width).toBe(40);
  }
});

it('accepts only the approved student email domain and blocks both login methods before verification', async () => {
  const studentNumber = String(randomInt(100000000, 999999999));
  const email = `registration-${randomUUID().slice(0, 8)}@stu.nit.ac.ir`;
  const data = { name: 'دانشجوی ثبت‌نام آزمایشی', studentNumber, email, password: f.password };
  for (const wrong of ['@gmail.com', '@stu.nit.ac.ir.example.com', '@nit.ac.ir'])
    await expect(registerStudent({ ...data, email: 'student' + wrong })).rejects.toThrow(
      'ثبت‌نام فقط',
    );
  await registerStudent(data);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user).toMatchObject({
    role: 'STUDENT',
    isAdmin: false,
    username: studentNumber,
    emailVerified: false,
  });
  await expect(
    getAuth().api.signInEmail({ body: { email, password: f.password } }),
  ).rejects.toThrow();
  await expect(
    getAuth().api.signInUsername({ body: { username: studentNumber, password: f.password } }),
  ).rejects.toThrow();
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  const newNumber = String(randomInt(100000000, 999999999));
  await updateUser(await f.actor(f.admin.id), user.id, { studentNumber: newNumber });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).username).toBe(newNumber);
});

it('notifies the unit about submissions and students about answers without notifying administrators', async () => {
  const creation = await db.outboxEvent.findFirstOrThrow({
    where: { type: 'TICKET_NOTIFICATION', payload: { path: ['ticketId'], equals: ticketId } },
  });
  await processNotification(creation.id, creation.payload);
  expect(await db.notification.count({ where: { eventId: creation.id, userId: f.agent.id } })).toBe(
    1,
  );
  await addMessage(await f.actor(f.agent.id), ticketId, {
    version: 1,
    body: 'پاسخ برای اعلان دانشجو',
    visibility: 'PUBLIC',
  });
  const reply = await db.outboxEvent.findFirstOrThrow({
    where: {
      type: 'TICKET_NOTIFICATION',
      AND: [
        { payload: { path: ['ticketId'], equals: ticketId } },
        { payload: { path: ['type'], equals: 'PUBLIC_REPLY' } },
      ],
    },
  });
  await processNotification(reply.id, reply.payload);
  expect(await db.notification.count({ where: { eventId: reply.id, userId: f.student.id } })).toBe(
    1,
  );
  expect(
    await db.notification.count({
      where: { eventId: { in: [creation.id, reply.id] }, userId: f.admin.id },
    }),
  ).toBe(0);
});
