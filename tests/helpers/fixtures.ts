import { randomUUID, randomBytes, randomInt } from 'node:crypto';
import { db } from '@niticket/database';
import { hashPassword } from '@niticket/core/infrastructure/auth';
import { loadActor } from '@niticket/core/application/context';

export async function fixtures() {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('Refusing test fixture writes outside test database');
  const suffix = randomUUID().slice(0, 8);
  const password = randomBytes(24).toString('base64url');
  const hashed = await hashPassword(password);

  async function user(name: string, isAdmin = false) {
    const id = randomUUID();
    const role = isAdmin
      ? 'ADMIN'
      : name.includes('کارشناس') || name.includes('مدیر واحد')
        ? 'STAFF'
        : 'STUDENT';
    const studentNumber = role === 'STUDENT' ? String(randomInt(100000000, 999999999)) : null;
    const username = studentNumber ?? `unit-${randomUUID().slice(0, 12)}`;
    return db.user.create({
      data: {
        id,
        name,
        email: `${name === 'دانشجوی آزمون' ? 'student' : name === 'کارشناس آزمون' ? 'agent' : name === 'مدیر واحد آزمون' ? 'manager' : isAdmin ? 'admin' : 'other'}-${suffix}@example.test`,
        isAdmin,
        role,
        studentNumber,
        username,
        displayUsername: username,
        emailVerified: true,
        accountType: role === 'STUDENT' ? 'STUDENT' : 'STAFF',
        phone: role === 'STAFF' ? '09123456789' : null,
        accounts: { create: { providerId: 'credential', accountId: id, password: hashed } },
      },
    });
  }

  const [student, agent, manager, admin, outsider] = await Promise.all([
    user('دانشجوی آزمون'),
    user('کارشناس آزمون'),
    user('مدیر واحد آزمون'),
    user('مدیر سامانه آزمون', true),
    user('کاربر دیگر آزمون'),
  ]);
  const department = await db.department.create({
    data: { name: `واحد آزمون ${suffix}`, slug: `test-${suffix}` },
  });
  const destination = await db.department.create({
    data: { name: `مقصد آزمون ${suffix}`, slug: `target-${suffix}` },
  });
  const category = await db.category.create({
    data: { departmentId: department.id, name: 'بررسی آزمون' },
  });
  await db.departmentMembership.createMany({
    data: [
      { departmentId: department.id, userId: agent.id, role: 'AGENT', assignedBy: admin.id },
      { departmentId: department.id, userId: manager.id, role: 'MANAGER', assignedBy: admin.id },
    ],
  });
  const actor = async (userId: string) => loadActor(db, userId, randomUUID(), new Date());
  return {
    student,
    agent,
    manager,
    admin,
    outsider,
    department,
    destination,
    category,
    password,
    actor,
  };
}
