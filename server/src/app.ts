import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import { corsOrigins } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './db/pool.js';
import { redis } from './lib/redis.js';
import { generalRateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { ticketRouter } from './modules/tickets/ticket.routes.js';
import { teamRouter } from './modules/teams/team.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { slaRouter } from './modules/sla/sla.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';

export function createApp(): Express {
  const app = express();

  // Docker/nginx arkasinda dogru istemci IP'si (hiz siniri icin onemli).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // API JSON dondurur; CSP'yi statik dosyalari sunan katman yonetir.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // --- Saglik kontrolu (Docker healthcheck buraya bakar) -------------------
  //
  // Her kontrol zaman asimina baglanir: ioredis baglanti yokken komutlari
  // cevrimdisi kuyruga alir ve `ping()` hic cozulmez — bu durumda saglik ucu
  // asili kalmak yerine "degraded" dondurmelidir.
  const withTimeout = <T,>(promise: Promise<T>, ms = 2_000): Promise<T> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('saglik kontrolu zaman asimi')), ms);
        timer.unref?.();
      }),
    ]);

  app.get('/api/health', async (_req, res) => {
    const checks = await Promise.allSettled([
      withTimeout(pool.query('SELECT 1')),
      withTimeout(redis.ping()),
    ]);
    const [db, cache] = checks;
    const healthy = db?.status === 'fulfilled' && cache?.status === 'fulfilled';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      postgres: db?.status === 'fulfilled' ? 'up' : 'down',
      redis: cache?.status === 'fulfilled' ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use('/api', generalRateLimit);
  app.use('/api/auth', authRouter);
  app.use('/api/tickets', ticketRouter);
  app.use('/api/teams', teamRouter);
  app.use('/api/users', userRouter);
  app.use('/api/sla-policies', slaRouter);
  app.use('/api/reports', reportRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
