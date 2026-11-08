import { z } from 'zod';
import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { listUsers } from '@niticket/core/application/administration';
import { AdminUsers } from '@/components/admin-users';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; direction?: string }>;
}) {
  const a = await currentActor();
  if (!a.isAdmin) notFound();
  const { q, cursor, direction } = await searchParams;
  const order = z.enum(['next', 'previous']).catch('next').parse(direction);
  return <AdminUsers data={await listUsers(a, q, cursor, order)} q={q ?? ''} actorId={a.id} />;
}
