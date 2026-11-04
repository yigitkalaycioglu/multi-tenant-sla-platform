import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../../application/ports/runtime.js';
import { rateLimited } from '../../../domain/errors.js';

/** Pencere icindeki istek sayisini artirip donduren sayac (orn. Redis INCR). */
export interface RateLimitCounter {
  hit(key: string, windowSeconds: number): Promise<number>;
}

export interface RateLimitOptions {
  /** Anahtar oneki — farkli limitleri birbirinden ayirir. */
  keyPrefix: string;
  max: number;
  windowSeconds: number;
  /** Varsayilan: oturum acmissa kullanici, degilse IP. */
  keyOf?: (req: Request) => string;
}

/**
 * Giris/kayit denemelerinin anahtari: IP + kiraci + e-posta.
 *
 * Deger, dogrulama semalarinin yaptigi gibi normalize edilir (trim + kucuk
 * harf). Aksi halde ayni hesap icin "Mert@Kuzey.io", " mert@kuzey.io" gibi
 * varyasyonlar her biri ayri kova alip siniri anlamsiz kilardi.
 */
export function authAttemptKey(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const norm = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');
  return `${req.ip ?? 'anonim'}:${norm(body.tenantSlug ?? body.slug)}:${norm(body.email ?? body.adminEmail)}`;
}

/**
 * Sabit pencere (fixed window) hiz siniri.
 *
 * Sayac erisilemezse istek engellenmez (fail-open) — bildirim altyapisi
 * yuzunden API dusmemeli.
 */
export function makeRateLimit(counter: RateLimitCounter, log: Logger, options: RateLimitOptions) {
  const { keyPrefix, max, windowSeconds, keyOf } = options;
  const limitLog = log.child({ module: 'rate-limit' });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identity = keyOf?.(req) ?? req.auth?.id ?? req.ip ?? 'anonim';
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `ratelimit:${keyPrefix}:${identity}:${bucket}`;

    try {
      const count = await counter.hit(key, windowSeconds);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        res.setHeader('Retry-After', windowSeconds);
        next(rateLimited());
        return;
      }
      next();
    } catch (err) {
      limitLog.warn({ err }, 'Hiz siniri kontrol edilemedi, istek gecirildi');
      next();
    }
  };
}
