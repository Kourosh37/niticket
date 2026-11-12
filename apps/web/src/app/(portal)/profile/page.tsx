import { currentActor } from '@/lib/session';
import { currentProfile } from '@/lib/profile';
import { Profile } from '@/components/profile';
import { redirect } from 'next/navigation';

export default async function Page() {
  const a = await currentActor();
  if (!a.isAdmin) redirect('/settings');
  return <Profile profile={await currentProfile()} />;
}
