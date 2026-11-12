import { cache } from 'react';
import { getProfile } from '@niticket/core/application/administration';
import { currentActor } from './session';

/** Request-scoped only: never retain a profile across sessions or mutations. */
export const currentProfile = cache(async () => getProfile(await currentActor()));
