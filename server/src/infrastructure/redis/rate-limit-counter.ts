import type { Redis } from 'ioredis';

/**
 * Sabit pencere (fixed window) sayaci. INCR + EXPIRE tek turda calisir; sayac
 * ilk istekte olusturulur ve pencere sonunda kendiliginden silinir.
 * Pencere icindeki guncel istek sayisini dondurur.
 */
export function createRedisRateLimitCounter(redis: Redis) {
  return {
    async hit(key: string, windowSeconds: number): Promise<number> {
      const [countResult] = (await redis.multi().incr(key).expire(key, windowSeconds).exec()) ?? [];
      return Number(countResult?.[1] ?? 0);
    },
  };
}
