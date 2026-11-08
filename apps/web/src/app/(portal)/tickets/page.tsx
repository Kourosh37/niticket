import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { userRole } from '@niticket/core/domain/authorization';
import { Inbox } from '@/components/inbox';

export async function TicketPage({
  searchParams,
  workspace = false,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
  workspace?: boolean;
}) {
  const actor = await currentActor();
  if (actor.isAdmin) redirect('/admin/departments');
  if (!workspace && userRole(actor) === 'STAFF') redirect('/workspace');
  return (
    <Inbox actor={actor} query={await searchParams} base={workspace ? '/workspace' : '/tickets'} />
  );
}

export default TicketPage;
