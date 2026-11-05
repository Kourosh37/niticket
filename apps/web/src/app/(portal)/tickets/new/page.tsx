import { currentActor } from '@/lib/session';
import { listDepartments } from '@niticket/core/application/administration';
import { NewTicket } from '@/components/new-ticket';
import { redirect } from 'next/navigation';
import { userRole } from '@niticket/core/domain/authorization';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const actor = await currentActor();
  if (userRole(actor) !== 'STUDENT') redirect('/');
  const [departments, params] = await Promise.all([listDepartments(actor), searchParams]);
  return <NewTicket departments={departments} initialDepartment={params.departmentId} />;
}
