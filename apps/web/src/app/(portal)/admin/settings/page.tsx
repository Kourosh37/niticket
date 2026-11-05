import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { settings } from '@niticket/core/application/settings';
import { AdminSettings } from '@/components/admin-settings';

export default async function Page() {
  const actor = await currentActor();
  if (!actor.isAdmin) notFound();
  const policy = await settings();
  return <AdminSettings policy={policy} />;
}
