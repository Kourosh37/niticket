import { currentActor } from '@/lib/session';
import { getProfile } from '@niticket/core/application/administration';
import { Profile } from '@/components/profile';
import { redirect } from 'next/navigation';

export default async function Page() {
  const a = await currentActor();
  if (!a.isAdmin) redirect('/settings');
  return <Profile profile={await getProfile(a)} />;
}
