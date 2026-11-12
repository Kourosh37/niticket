import { api } from '@niticket/core/http/api';
import { openRealtime } from '@niticket/core/http/realtime';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return api(request, (actor) => openRealtime(request, actor));
}

export async function HEAD() {
  return new Response(null, {
    status: 405,
    headers: { allow: 'GET', 'cache-control': 'no-store' },
  });
}
