import { currentActor } from '@/lib/session';
import { currentProfile } from '@/lib/profile';
import { Shell } from '@/components/shell';
import { currentPolicy } from '@/lib/policy';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const [profile, policy] = await Promise.all([currentProfile(), currentPolicy()]);
  return (
    <Shell
      universityName={policy.universityName}
      supportDescription={policy.supportDescription}
      user={{
        id: actor.id,
        name: profile.name,
        isAdmin: actor.isAdmin,
        staff: !actor.isAdmin && profile.role === 'STAFF',
        image: profile.image,
      }}
    >
      {children}
    </Shell>
  );
}
