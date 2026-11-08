import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { actorFromHeaders } from '@niticket/core/application/context';
import { AppError } from '@niticket/core/domain/errors';
import { cache } from 'react';

export const currentActor = cache(async () => {
  try {
    return await actorFromHeaders(await headers());
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    throw error;
  }
});
