import { currentActor } from '@/lib/session';
import { getProfile } from '@niticket/core/application/administration';
import { Profile } from '@/components/profile';

export default async function Page() {
  const a = await currentActor();
  return <Profile profile={await getProfile(a)} />;
}
