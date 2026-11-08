import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { currentActor } from '@/lib/session';
import { MessageSearch } from '@/components/message-search';
import { messageSearchSchema } from '@niticket/core/application/message-search';
import { userRole } from '@niticket/core/domain/authorization';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor(),
    query = await searchParams;
  const fields = [
    'q',
    'ticketId',
    'departmentId',
    'senderId',
    'from',
    'to',
    'kind',
    'mode',
    'sort',
    'visibility',
  ];
  const parsed = messageSearchSchema.safeParse(
    Object.fromEntries(
      fields
        .filter((key) => typeof query[key] === 'string' && query[key] !== '')
        .map((key) => [key, query[key]]),
    ),
  );
  return (
    <div className="search-page">
      <Link href="/" className="easy-back">
        <ArrowRight size={20} /> گفتگوها
      </Link>
      <div className="page-heading">
        <div>
          <h1>جستجو در پیام‌ها</h1>
          <p>پیام، فایل یا صدای موردنظرتان را در گفتگوها پیدا کنید.</p>
        </div>
      </div>
      {!parsed.success && (
        <p role="alert" className="error-message">
          فیلترهای آدرس معتبر نبودند؛ جستجو را دوباره انجام دهید.
        </p>
      )}
      <section className="surface" aria-label="جستجو در همه گفتگوها">
        <MessageSearch
          key={JSON.stringify(parsed.success ? parsed.data : {})}
          actorId={actor.id}
          privateAllowed={userRole(actor) !== 'STUDENT'}
          initial={parsed.success ? parsed.data : {}}
        />
      </section>
    </div>
  );
}
