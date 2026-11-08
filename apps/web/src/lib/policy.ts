import { cache } from 'react';
import { settings } from '@niticket/core/application/settings';

// Reuse only within one server render; administrator changes remain visible on the next request.
export const currentPolicy = cache(settings);
