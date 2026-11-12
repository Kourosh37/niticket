import { cache } from 'react';
import { displayPolicy } from '@niticket/core/application/settings';

// Share a display snapshot in the render; write validation bypasses this cache.
export const currentPolicy = cache(displayPolicy);
