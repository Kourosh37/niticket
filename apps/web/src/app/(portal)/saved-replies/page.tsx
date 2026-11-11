import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { currentPolicy } from '@/lib/policy';
import { userRole } from '@niticket/core/domain/authorization';
import { departmentChoices } from '@niticket/core/application/administration';
import { listSavedReplies } from '@niticket/core/application/saved-replies';
import { SavedReplyManager } from '@/components/saved-replies';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ departmentId?: string }>;
}) {
  const actor = await currentActor();
  if (userRole(actor) !== 'STAFF') notFound();
  const [departments, policy, query] = await Promise.all([
    departmentChoices(actor, true),
    currentPolicy(),
    searchParams,
  ]);
  const departmentId = departments.some((unit) => unit.id === query.departmentId)
    ? query.departmentId!
    : (departments[0]?.id ?? '');
  const initial = departmentId
    ? await listSavedReplies(actor, { departmentId })
    : { items: [], nextCursor: null };
  return (
    <SavedReplyManager
      departments={departments}
      initial={initial}
      initialDepartmentId={departmentId}
      maxBytes={policy.maxUploadBytes}
      maxSeconds={policy.maxVoiceSeconds}
    />
  );
}
