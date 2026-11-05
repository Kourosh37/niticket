import { notFound } from 'next/navigation';
import { currentActor } from '@/lib/session';
import { listDepartments } from '@niticket/core/application/administration';
import { UnitManagement } from '@/components/unit-management';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const a = await currentActor();
  if (!a.isAdmin) notFound();
  const query = await searchParams;
  const rows = await listDepartments(a, true, { ...query, limit: 31 });
  return (
    <>
      <UnitManagement departments={rows.slice(0, 30)} q={query.q ?? ''} />
      {(query.cursor || rows.length > 30) && (
        <div className="pagination">
          <Button asChild variant="outline">
            <Link href="/admin/departments">بازگشت به همه واحدها</Link>
          </Button>
          {rows.length > 30 && (
            <Button asChild variant="outline">
              <Link
                href={`/admin/departments?${new URLSearchParams({ q: query.q ?? '', cursor: rows[29].id })}`}
              >
                واحدهای بعدی
              </Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
