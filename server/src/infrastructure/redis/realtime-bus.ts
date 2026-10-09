/**
 * Gercek zamanli olay veri yolu (event bus).
 *
 * API sureci ile worker sureci ayri konteynerlerde calisir; worker'in dogrudan
 * Socket.io baglantisi yoktur. Bu yuzden tum olaylar Redis Pub/Sub uzerinden
 * yayinlanir. Her API ornegi kanali dinler ve mesaji YALNIZCA kendi bagli
 * soketlerine iletir — bu sayede yatay olceklemede (N adet API ornegi) mesaj
 * cogullanmasi olmaz.
 *
 *   worker/API  --PUBLISH-->  redis: realtime:events  --SUBSCRIBE-->  API x N
 *                                                                      |
 *                                                             io.to(rooms).emit
 */
import type { RealtimeMessage, RealtimePublisher } from '../../application/ports/events.js';
import type { Logger } from '../../application/ports/runtime.js';
import { createRedis } from './redis.js';

export const REALTIME_CHANNEL = 'realtime:events';

export interface RealtimeBus extends RealtimePublisher {
  /** Kanali dinler; her mesaj icin handler cagrilir. Aboneligi kapatan fonksiyon doner. */
  subscribe(handler: (message: RealtimeMessage) => void): () => Promise<void>;
  close(): Promise<void>;
}

export function createRealtimeBus(redisUrl: string, log: Logger): RealtimeBus {
  const busLog = log.child({ module: 'realtime' });
  const publisher = createRedis(redisUrl, 'publisher', log);

  return {
    async publish(message) {
      try {
        await publisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
      } catch (err) {
        // Gercek zamanli bildirim, is akisini bloke etmemeli.
        busLog.error({ err, event: message.event }, 'Olay yayinlanamadi');
      }
    },

    subscribe(handler) {
      const subscriber = createRedis(redisUrl, 'subscriber', log);

      void subscriber.subscribe(REALTIME_CHANNEL, (err) => {
        if (err) busLog.error({ err }, 'Kanala abone olunamadi');
        else busLog.info({ channel: REALTIME_CHANNEL }, 'Gercek zamanli kanal dinleniyor');
      });

      subscriber.on('message', (channel, raw) => {
        if (channel !== REALTIME_CHANNEL) return;
        try {
          handler(JSON.parse(raw) as RealtimeMessage);
        } catch (err) {
          busLog.warn({ err }, 'Olay mesaji cozumlenemedi');
        }
      });

      return async () => {
        await subscriber.quit().catch(() => undefined);
      };
    },

    async close() {
      await publisher.quit().catch(() => undefined);
    },
  };
}
