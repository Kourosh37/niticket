import { currentActor } from '@/lib/session';
import { getProfile } from '@niticket/core/application/administration';
import { Shell } from '@/components/shell';
import { currentPolicy } from '@/lib/policy';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const [profile, policy] = await Promise.all([getProfile(actor), currentPolicy()]);
  return (
    <Shell
      universityName={policy.universityName}
      supportDescription={policy.supportDescription}
      user={{
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
