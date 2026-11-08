import { currentActor } from '@/lib/session';
import { RoleDashboard } from '@/components/role-dashboard';
import { Inbox } from '@/components/inbox';

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await currentActor();
  if (actor.isAdmin) return <RoleDashboard actor={actor} />;
  return <Inbox actor={actor} query={await searchParams} />;
}
