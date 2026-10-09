import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from '../../application/ports/runtime.js';

/**
 * Yeni bir Redis baglantisi acar.
 * BullMQ blocking komutlar kullandigi icin `maxRetriesPerRequest: null` sart.
 * Pub/Sub aboneligi de ayri bir baglantiya ihtiyac duyar.
 */
export function createRedis(url: string, name: string, log: Logger, overrides: RedisOptions = {}): Redis {
  const redisLog = log.child({ module: 'redis' });
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `sla-${name}`,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    ...overrides,
  });

  client.on('error', (err) => redisLog.error({ err, name }, 'Redis baglanti hatasi'));
  client.on('ready', () => redisLog.debug({ name }, 'Redis hazir'));
  return client;
}

/**
 * Genel amacli (komut) baglantisi — hiz siniri sayaci ve saglik kontrolu.
 *
 * `enableOfflineQueue: false` bilincli bir tercihtir: Redis erisilemezken
 * komutlar sessizce kuyruga alinip SONSUZA KADAR beklemek yerine ANINDA
 * hata verir. Boylece hiz siniri middleware'i gercekten "fail-open"
 * calisabilir ve Redis kesintisi tum HTTP isteklerini askida birakmaz.
 *
 * Kuyruk (BullMQ) ve pub/sub baglantilari varsayilan davranisi korur:
 * kisa kesintilerde islerin kaybolmamasi icin cevrimdisi kuyruk gereklidir.
 */
export function createCommandRedis(url: string, log: Logger): Redis {
  return createRedis(url, 'commands', log, { enableOfflineQueue: false });
}
