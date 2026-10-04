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
import { createRedis } from '../lib/redis.js';
import { realtimeLogger } from '../lib/logger.js';

export const REALTIME_CHANNEL = 'realtime:events';

export interface RealtimeMessage {
  /** Hedef kiraci. */
  tenantId: string;
  /** Istemcinin dinledigi olay adi, orn. "ticket:updated". */
  event: string;
  payload: unknown;
  /** Verilirse yalnizca bu kullanicilarin odalarina gonderilir. */
  userIds?: string[];
  /** Verilirse ilgili bilet odasina da gonderilir. */
  ticketId?: string;
}

const publisher = createRedis('publisher');

export async function publishRealtime(message: RealtimeMessage): Promise<void> {
  try {
    await publisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
  } catch (err) {
    // Gercek zamanli bildirim, is akisini bloke etmemeli.
    realtimeLogger.error({ err, event: message.event }, 'Olay yayinlanamadi');
  }
}

/** Kanali dinler; her mesaj icin handler cagrilir. */
export function subscribeRealtime(handler: (message: RealtimeMessage) => void): () => Promise<void> {
  const subscriber = createRedis('subscriber');

  void subscriber.subscribe(REALTIME_CHANNEL, (err) => {
    if (err) realtimeLogger.error({ err }, 'Kanala abone olunamadi');
    else realtimeLogger.info({ channel: REALTIME_CHANNEL }, 'Gercek zamanli kanal dinleniyor');
  });

  subscriber.on('message', (channel, raw) => {
    if (channel !== REALTIME_CHANNEL) return;
    try {
      handler(JSON.parse(raw) as RealtimeMessage);
    } catch (err) {
      realtimeLogger.warn({ err }, 'Olay mesaji cozumlenemedi');
    }
  });

  return async () => {
    await subscriber.quit();
  };
}

export const rooms = {
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  user: (userId: string) => `user:${userId}`,
  ticket: (ticketId: string) => `ticket:${ticketId}`,
};
