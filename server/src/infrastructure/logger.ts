import pino from 'pino';
import { isProd } from './config/env.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: { service: 'sla-platform' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.password_hash',
      '*.refreshToken',
    ],
    censor: '[gizlendi]',
  },
  transport: isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
});
