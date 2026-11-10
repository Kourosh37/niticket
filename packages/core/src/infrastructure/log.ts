import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'niticket' },
  serializers: { err: pino.stdSerializers.errWithCause },
  redact: [
    'password',
    'token',
    'secret',
    'req.headers.cookie',
    'req.headers.authorization',
    'err.password',
    'err.token',
    'err.secret',
    'err.cause.password',
    'err.cause.token',
    'err.cause.secret',
  ],
});
