import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'niticket' },
  redact: ['password', 'token', 'secret', 'req.headers.cookie', 'req.headers.authorization'],
});
