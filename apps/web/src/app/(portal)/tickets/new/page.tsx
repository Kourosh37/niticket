import { currentActor } from '@/lib/session';
import { listDepartments } from '@niticket/core/application/administration';
import { NewTicket } from '@/components/new-ticket';
import { redirect } from 'next/navigation';
import { userRole } from '@niticket/core/domain/authorization';
import { db } from '@niticket/database';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const actor = await currentActor();
  if (userRole(actor) !== 'STUDENT') redirect('/');
  const [departments, params, existing] = await Promise.all([
    listDepartments(actor),
    searchParams,
    db.ticket.groupBy({ by: ['departmentId'], where: { creatorId: actor.id } }),
  ]);
  const previous = new Set(existing.map((chat) => chat.departmentId));
  return (
    <NewTicket
      departments={departments.map((department) => ({
        ...department,
        canContinue: previous.has(department.id),
      }))}
      initialDepartment={params.departmentId}
    />
  );
}
