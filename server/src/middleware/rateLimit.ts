import type { NextFunction, Request, Response } from 'express';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { tooManyRequests } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'rate-limit' });

export interface RateLimitOptions {
  /** Redis anahtar oneki — farkli limitleri birbirinden ayirir. */
  keyPrefix: string;
  max: number;
  windowSeconds: number;
  /** Varsayilan: oturum acmissa kullanici, degilse IP. */
  keyOf?: (req: Request) => string;
}

/**
 * Redis tabanli sabit pencere (fixed window) hiz siniri.
 *
 * INCR + EXPIRE tek turda calisir; sayac ilk istekte olusturulur ve
 * pencere sonunda kendiliginden silinir. Redis erisilemezse istek
 * engellenmez (fail-open) — bildirim altyapisi yuzunden API dusmemeli.
 */
export function rateLimit(options: RateLimitOptions) {
  const { keyPrefix, max, windowSeconds, keyOf } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identity = keyOf?.(req) ?? req.auth?.id ?? req.ip ?? 'anonim';
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:${keyPrefix}:${identity}:${bucket}`;

    try {
      const [countResult] = await redis.multi().incr(key).expire(key, windowSeconds).exec() ?? [];
      const count = Number(countResult?.[1] ?? 0);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        res.setHeader('Retry-After', windowSeconds);
        next(tooManyRequests());
        return;
      }
      next();
    } catch (err) {
      log.warn({ err }, 'Hiz siniri kontrol edilemedi, istek gecirildi');
      next();
    }
  };
}

/** Tum API icin genel sinir. */
export const generalRateLimit = rateLimit({
  keyPrefix: 'api',
  max: env.RATE_LIMIT_MAX,
  windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
});

/** Kimlik dogrulama uclari icin cok daha dar sinir (brute-force korumasi). */
export const authRateLimit = rateLimit({
  keyPrefix: 'auth',
  max: 10,
  windowSeconds: 300,
  keyOf: (req) => `${req.ip ?? 'anonim'}:${String((req.body as { email?: string })?.email ?? '')}`,
});
