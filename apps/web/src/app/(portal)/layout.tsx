import { currentActor } from '@/lib/session';
import { getProfile } from '@niticket/core/application/administration';
import { Shell } from '@/components/shell';
import { settings } from '@niticket/core/application/settings';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const profile = await getProfile(actor);
  const policy = await settings();
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
