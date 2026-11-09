import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { currentPolicy } from '@/lib/policy';
import { getProfile } from '@niticket/core/application/administration';
import { Profile } from '@/components/profile';

export default async function Page() {
  const actor = await currentActor();
  if (actor.isAdmin) redirect('/profile');
  const [profile, policy] = await Promise.all([getProfile(actor), currentPolicy()]);
  return (
    <Profile
      profile={profile}
      settings={{
        universityName: policy.universityName,
        supportDescription: policy.supportDescription,
      }}
    />
  );
}
