import { TicketPage } from '../tickets/page';
import { currentActor } from '@/lib/session';
import { notFound } from 'next/navigation';

export default async function Workspace({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const a = await currentActor();
  if (a.isAdmin || !a.memberships.length) notFound();
  return <TicketPage searchParams={searchParams} workspace />;
}
