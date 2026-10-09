import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { RealtimeMessage } from '../../application/ports/events.js';
import type { Logger } from '../../application/ports/runtime.js';
import type { TokenService } from '../../application/ports/security.js';
import type { AuthUser } from '../../domain/identity.js';

interface SocketData {
  user: AuthUser;
}

export const rooms = {
  tenant: (tenantId: string) => `tenant:${tenantId}`,
  user: (userId: string) => `user:${userId}`,
  ticket: (ticketId: string) => `ticket:${ticketId}`,
};

export interface RealtimeDeps {
  tokens: TokenService;
  /** Olay kanalina abone olur; aboneligi kapatan fonksiyonu dondurur. */
  subscribe(handler: (message: RealtimeMessage) => void): () => Promise<void>;
  corsOrigins: string[];
  log: Logger;
}

export function initRealtime(httpServer: HttpServer, { tokens, subscribe, corsOrigins, log }: RealtimeDeps) {
  const realtimeLog = log.child({ module: 'realtime' });

  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: corsOrigins, credentials: true },
    serveClient: false,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  // --- El sikismada JWT dogrulamasi -----------------------------------------
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (typeof socket.handshake.headers.authorization === 'string'
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined);

    if (!token) {
      next(new Error('Yetkilendirme belirteci yok'));
      return;
    }

    try {
      (socket.data as SocketData).user = tokens.verifyAccessToken(token);
      next();
    } catch {
      next(new Error('Gecersiz belirtec'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as SocketData).user;

    // Kiraci ve kullanici odalarina otomatik katilim.
    void socket.join(rooms.tenant(user.tenantId));
    void socket.join(rooms.user(user.id));

    realtimeLog.debug({ userId: user.id, tenantId: user.tenantId }, 'Soket baglandi');
    socket.emit('connected', { userId: user.id, tenantId: user.tenantId });

    // Bilet detay ekrani acildiginda o biletin odasina katilir.
    socket.on('ticket:subscribe', (ticketId: unknown) => {
      if (typeof ticketId === 'string' && ticketId.length <= 64) {
        void socket.join(rooms.ticket(ticketId));
      }
    });

    socket.on('ticket:unsubscribe', (ticketId: unknown) => {
      if (typeof ticketId === 'string') void socket.leave(rooms.ticket(ticketId));
    });

    socket.on('disconnect', (reason) => {
      realtimeLog.debug({ userId: user.id, reason }, 'Soket ayrildi');
    });
  });

  // --- Olay kanalindan gelenleri bagli soketlere dagit ----------------------
  const unsubscribe = subscribe((message) => {
    // BroadcastOperator degismezdir: .to() yeni bir operator dondurur.
    let target = message.userIds?.length
      ? io.to(message.userIds.map((id) => rooms.user(id)))
      : io.to(rooms.tenant(message.tenantId));

    if (message.ticketId) target = target.to(rooms.ticket(message.ticketId));

    target.emit(message.event, message.payload);
  });

  return {
    io,
    /** Olay kanali aboneligini birakir. HTTP sunucusunu kapatmak cagiranin isidir. */
    stopListening: unsubscribe,
  };
}
