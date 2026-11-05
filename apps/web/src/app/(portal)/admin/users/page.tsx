import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { listUsers } from '@niticket/core/application/administration';
import { AdminUsers } from '@/components/admin-users';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const a = await currentActor();
  if (!a.isAdmin) notFound();
  const { q, cursor } = await searchParams;
  return <AdminUsers data={await listUsers(a, q, cursor)} q={q ?? ''} actorId={a.id} />;
}
