/**
 * Composition root.
 *
 * Somut adaptorlerin (PostgreSQL, Redis, BullMQ, JWT, bcrypt, SMTP) olusturulup
 * use case'lere baglandigi TEK yer burasidir. Diger katmanlar birbirini yalnizca
 * arayuzler uzerinden tanir; ornegin bir use case testinde Postgres yerine
 * bellek ici bir sahte (fake) vermek icin yalnizca buradaki baglama degisir.
 */
import { makeAuthUseCases } from '../application/auth/auth.use-cases.js';
import { makeDeliverNotification } from '../application/notifications/deliver-notification.js';
import { systemClock } from '../application/ports/runtime.js';
import { makeReportUseCases } from '../application/reports/report.use-cases.js';
import { makeSlaPolicyUseCases } from '../application/sla/sla-policy.use-cases.js';
import { makeRunSlaScan } from '../application/sla/sla-scan.use-case.js';
import { makeTeamUseCases } from '../application/teams/team.use-cases.js';
import { makeTicketUseCases } from '../application/tickets/ticket.use-cases.js';
import { makeUserUseCases } from '../application/users/user.use-cases.js';
import { corsOrigins, env, isProd } from '../infrastructure/config/env.js';
import { createPool } from '../infrastructure/db/pool.js';
import { createEmailLogRepository } from '../infrastructure/db/repositories/email-log.repository.js';
import { createSlaScanRepository } from '../infrastructure/db/repositories/sla-scan.repository.js';
import { createTenantDirectory, createTenantTransactions } from '../infrastructure/db/tenant-transactions.js';
import { logger } from '../infrastructure/logger.js';
import { createSmtpMailSender } from '../infrastructure/mail/smtp-mail-sender.js';
import { createNotificationQueue, createSlaScanScheduler } from '../infrastructure/queue/queues.js';
import { startQueueWorkers } from '../infrastructure/queue/workers.js';
import { createRedisRateLimitCounter } from '../infrastructure/redis/rate-limit-counter.js';
import { createRealtimeBus } from '../infrastructure/redis/realtime-bus.js';
import { createCommandRedis } from '../infrastructure/redis/redis.js';
import { createBcryptPasswordHasher } from '../infrastructure/security/bcrypt-password-hasher.js';
import { createJwtTokenService } from '../infrastructure/security/jwt-token-service.js';
import type { AppDeps } from '../interfaces/http/app.js';

/** API sureci: HTTP + Socket.io. Yalnizca RLS'e tabi uygulama baglantisini kullanir. */
export function buildApiContainer() {
  const appPool = createPool(
    { connectionString: env.DATABASE_URL, max: env.PG_POOL_MAX, applicationName: 'sla-api' },
    logger,
  );
  const redis = createCommandRedis(env.REDIS_URL, logger);
  const realtime = createRealtimeBus(env.REDIS_URL, logger);
  const notifications = createNotificationQueue(env.REDIS_URL, logger);

  const tokens = createJwtTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    accessTtl: env.ACCESS_TOKEN_TTL,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  const hasher = createBcryptPasswordHasher(env.BCRYPT_ROUNDS);
  const tx = createTenantTransactions(appPool);
  const clock = systemClock;

  const app: AppDeps = {
    useCases: {
      auth: makeAuthUseCases({ tx, tenants: createTenantDirectory(appPool), hasher, tokens, clock, log: logger }),
      tickets: makeTicketUseCases({
        tx,
        realtime,
        notifications,
        clock,
        log: logger.child({ module: 'tickets' }),
        slaRiskThreshold: env.SLA_RISK_THRESHOLD,
      }),
      teams: makeTeamUseCases({ tx }),
      users: makeUserUseCases({ tx, hasher }),
      slaPolicies: makeSlaPolicyUseCases({ tx }),
      reports: makeReportUseCases({ tx }),
    },
    tokens,
    rateLimitCounter: createRedisRateLimitCounter(redis),
    healthChecks: {
      postgres: () => appPool.query('SELECT 1'),
      redis: () => redis.ping(),
    },
    logger,
    config: {
      corsOrigins,
      isProd,
      rateLimit: { max: env.RATE_LIMIT_MAX, windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS },
    },
  };

  return {
    app,
    realtime,
    async close(): Promise<void> {
      await notifications.close();
      await realtime.close();
      await redis.quit().catch(() => undefined);
      await appPool.end().catch(() => undefined);
    },
  };
}

/** Worker sureci: SLA taramasi ve e-posta. Kiracilar arasi calistigi icin sistem baglantisini kullanir. */
export function buildWorkerContainer() {
  const adminPool = createPool(
    { connectionString: env.DATABASE_ADMIN_URL, max: 5, applicationName: 'sla-system' },
    logger,
  );
  const realtime = createRealtimeBus(env.REDIS_URL, logger);
  const notifications = createNotificationQueue(env.REDIS_URL, logger);
  const scheduler = createSlaScanScheduler(env.REDIS_URL, logger);

  const runSlaScan = makeRunSlaScan({
    scanner: createSlaScanRepository(adminPool),
    realtime,
    notifications,
    clock: systemClock,
    log: logger.child({ module: 'queue' }),
    riskThreshold: env.SLA_RISK_THRESHOLD,
  });

  const deliverNotification = makeDeliverNotification({
    mailer: createSmtpMailSender({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.MAIL_FROM,
    }),
    emailLog: createEmailLogRepository(adminPool),
    clock: systemClock,
    log: logger,
    appUrl: env.APP_PUBLIC_URL,
  });

  return {
    async start() {
      const workers = startQueueWorkers({ redisUrl: env.REDIS_URL, log: logger, runSlaScan, deliverNotification });
      await scheduler.schedule(env.SLA_SCAN_INTERVAL_MS);

      return async function stop(): Promise<void> {
        await workers.close();
        await Promise.allSettled([scheduler.close(), notifications.close(), realtime.close()]);
        await adminPool.end().catch(() => undefined);
      };
    },
  };
}
