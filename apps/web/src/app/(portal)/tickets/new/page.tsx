import { currentActor } from '@/lib/session';
import { conversationChoices } from '@niticket/core/application/administration';
import { uuid } from '@niticket/core/validation';
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
  const params = await searchParams;
  const selected = uuid.safeParse(params.departmentId);
  const [data, target] = await Promise.all([
    conversationChoices(actor),
    selected.success ? conversationChoices(actor, { departmentId: selected.data }) : null,
  ]);
  const department = target?.items[0];
  return (
    <NewTicket
      initial={data}
      initialDepartment={
        department && (department.acceptingTickets || department.canContinue)
          ? department.id
          : undefined
      }
    />
  );
}
