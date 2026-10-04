import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'redis' });

/**
 * Yeni bir Redis baglantisi acar.
 * BullMQ blocking komutlar kullandigi icin `maxRetriesPerRequest: null` sart.
 * Pub/Sub aboneligi de ayri bir baglantiya ihtiyac duyar.
 */
export function createRedis(name: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `sla-${name}`,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    ...overrides,
  });

  client.on('error', (err) => log.error({ err, name }, 'Redis baglanti hatasi'));
  client.on('ready', () => log.debug({ name }, 'Redis hazir'));
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
export const redis = createRedis('commands', { enableOfflineQueue: false });
