import { currentActor } from '@/lib/session';
import { notifications } from '@niticket/core/application/administration';
import { Notifications } from '@/components/notifications';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const a = await currentActor();
  const { cursor } = await searchParams;
  return <Notifications data={await notifications(a, cursor)} replyRequired={a.role === 'STAFF'} />;
}
