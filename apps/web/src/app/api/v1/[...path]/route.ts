import { api } from '@niticket/core/http/api';
import { dispatch } from '@niticket/core/http/router';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return api(request, (actor) => dispatch(request, path, actor));
}

export { handle as GET, handle as HEAD, handle as POST, handle as PATCH, handle as DELETE };
