import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { getTicket } from '@niticket/core/application/tickets';
import { AppError } from '@niticket/core/domain/errors';
import { currentPolicy } from '@/lib/policy';
import { Conversation } from '@/components/conversation';
import { searchReturnPath } from '@/lib/search';
import { uuid } from '@niticket/core/validation';
import { searchTerms } from '@niticket/core/domain/search-text';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; q?: string; returnTo?: string }>;
}) {
  const a = await currentActor();
  const { id } = await params;
  const query = await searchParams;
  if (query.message && !uuid.safeParse(query.message).success) notFound();
  let detail, policy;
  try {
    [detail, policy] = await Promise.all([
      getTicket(a, id, undefined, undefined, false, query.message),
      currentPolicy(),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <Conversation
      key={`${id}:${detail.messageFocus?.focusId ?? 'latest'}`}
      detail={detail}
      actorId={a.id}
      maxSeconds={policy.maxVoiceSeconds}
      maxBytes={policy.maxUploadBytes}
      initialContext={detail.messageFocus ?? undefined}
      initialTerms={searchTerms((query.q ?? '').slice(0, 200), 'all').include.slice(0, 8)}
      returnTo={searchReturnPath(query.returnTo)}
    />
  );
}
