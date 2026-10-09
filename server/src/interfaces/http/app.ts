import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Logger as PinoLogger } from 'pino';
import crypto from 'node:crypto';
import type { AuthUseCases } from '../../application/auth/auth.use-cases.js';
import type { TokenService } from '../../application/ports/security.js';
import type { ReportUseCases } from '../../application/reports/report.use-cases.js';
import type { SlaPolicyUseCases } from '../../application/sla/sla-policy.use-cases.js';
import type { TeamUseCases } from '../../application/teams/team.use-cases.js';
import type { TicketUseCases } from '../../application/tickets/ticket.use-cases.js';
import type { UserUseCases } from '../../application/users/user.use-cases.js';
import { makeErrorHandler, notFoundHandler } from './error-handler.js';
import { makeRequireAuth } from './middleware/auth.js';
import { makeRateLimit, type RateLimitCounter } from './middleware/rate-limit.js';
import { authRoutes } from './routes/auth.routes.js';
import { reportRoutes } from './routes/report.routes.js';
import { slaPolicyRoutes } from './routes/sla-policy.routes.js';
import { teamRoutes } from './routes/team.routes.js';
import { ticketRoutes } from './routes/ticket.routes.js';
import { userRoutes } from './routes/user.routes.js';

export interface UseCases {
  auth: AuthUseCases;
  tickets: TicketUseCases;
  teams: TeamUseCases;
  users: UserUseCases;
  slaPolicies: SlaPolicyUseCases;
  reports: ReportUseCases;
}

export interface AppDeps {
  useCases: UseCases;
  tokens: TokenService;
  rateLimitCounter: RateLimitCounter;
  /** Saglik ucunda raporlanan bagimliliklar, orn. { postgres, redis }. */
  healthChecks: Record<string, () => Promise<unknown>>;
  logger: PinoLogger;
  config: {
    corsOrigins: string[];
    isProd: boolean;
    rateLimit: { max: number; windowSeconds: number };
  };
}

/**
 * HTTP sunum katmani. Tum bagimliliklar disaridan verilir (bkz. main/container.ts);
 * bu dosya veritabani, Redis ya da JWT kutuphanesini dogrudan tanimaz.
 */
export function createApp({ useCases, tokens, rateLimitCounter, healthChecks, logger, config }: AppDeps): Express {
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
      origin: config.corsOrigins,
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
    const names = Object.keys(healthChecks);
    const results = await Promise.allSettled(names.map((name) => withTimeout(healthChecks[name]!())));
    const statuses = Object.fromEntries(
      names.map((name, i) => [name, results[i]?.status === 'fulfilled' ? 'up' : 'down']),
    );
    const healthy = results.every((r) => r.status === 'fulfilled');

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      ...statuses,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  const requireAuth = makeRequireAuth(tokens);

  /** Tum API icin genel sinir. */
  const generalRateLimit = makeRateLimit(rateLimitCounter, logger, {
    keyPrefix: 'api',
    max: config.rateLimit.max,
    windowSeconds: config.rateLimit.windowSeconds,
  });

  /** Kimlik dogrulama uclari icin cok daha dar sinir (brute-force korumasi). */
  const authRateLimit = makeRateLimit(rateLimitCounter, logger, {
    keyPrefix: 'auth',
    max: 10,
    windowSeconds: 300,
    keyOf: (req) => `${req.ip ?? 'anonim'}:${String((req.body as { email?: string })?.email ?? '')}`,
  });

  app.use('/api', generalRateLimit);
  app.use(
    '/api/auth',
    authRoutes({ auth: useCases.auth, requireAuth, authRateLimit, secureCookies: config.isProd }),
  );
  app.use('/api/tickets', ticketRoutes(useCases.tickets, requireAuth));
  app.use('/api/teams', teamRoutes(useCases.teams, requireAuth));
  app.use('/api/users', userRoutes(useCases.users, requireAuth));
  app.use('/api/sla-policies', slaPolicyRoutes(useCases.slaPolicies, requireAuth));
  app.use('/api/reports', reportRoutes(useCases.reports, requireAuth));

  app.use(notFoundHandler);
  app.use(makeErrorHandler(logger, !config.isProd));

  return app;
}
