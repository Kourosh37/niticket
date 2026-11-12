import { redirect } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { currentPolicy } from '@/lib/policy';
import { currentProfile } from '@/lib/profile';
import { Profile } from '@/components/profile';

export default async function Page() {
  const actor = await currentActor();
  if (actor.isAdmin) redirect('/profile');
  const [profile, policy] = await Promise.all([currentProfile(), currentPolicy()]);
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
