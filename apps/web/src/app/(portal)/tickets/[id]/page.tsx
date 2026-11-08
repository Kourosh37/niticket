import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { getTicket } from '@niticket/core/application/tickets';
import { AppError } from '@niticket/core/domain/errors';
import { settings } from '@niticket/core/application/settings';
import { Conversation } from '@/components/conversation';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ messageCursor?: string; activityCursor?: string }>;
}) {
  const a = await currentActor();
  const { id } = await params;
  const query = await searchParams;
  let detail;
  try {
    detail = await getTicket(a, id, query.messageCursor, query.activityCursor);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  const policy = await settings();
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
