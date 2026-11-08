import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { getTicket } from '@niticket/core/application/tickets';
import { AppError } from '@niticket/core/domain/errors';
import { currentPolicy } from '@/lib/policy';
import { Conversation } from '@/components/conversation';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const a = await currentActor();
  const { id } = await params;
  let detail, policy;
  try {
    [detail, policy] = await Promise.all([
      getTicket(a, id, undefined, undefined, false),
      currentPolicy(),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return (
    <Conversation
      key={id}
      detail={detail}
      actorId={a.id}
      maxSeconds={policy.maxVoiceSeconds}
      maxBytes={policy.maxUploadBytes}
    />
  );
}
