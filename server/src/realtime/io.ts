import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { corsOrigins } from '../config/env.js';
import { realtimeLogger } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { rooms, subscribeRealtime, type RealtimeMessage } from './bus.js';
import type { AuthUser } from '../types/domain.js';

interface SocketData {
  user: AuthUser;
}

let io: Server | null = null;

export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
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
      const claims = verifyAccessToken(token);
      (socket.data as SocketData).user = {
        id: claims.sub,
        tenantId: claims.tid,
        tenantSlug: claims.slug,
        role: claims.role,
        teamId: claims.team,
        email: claims.email,
        fullName: claims.name,
      };
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

    realtimeLogger.debug({ userId: user.id, tenantId: user.tenantId }, 'Soket baglandi');
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
      realtimeLogger.debug({ userId: user.id, reason }, 'Soket ayrildi');
    });
  });

  // --- Redis kanalindan gelen olaylari bagli soketlere dagit ----------------
  subscribeRealtime((message: RealtimeMessage) => {
    if (!io) return;

    // BroadcastOperator degismezdir: .to() yeni bir operator dondurur.
    let target = message.userIds?.length
      ? io.to(message.userIds.map((id) => rooms.user(id)))
      : io.to(rooms.tenant(message.tenantId));

    if (message.ticketId) target = target.to(rooms.ticket(message.ticketId));

    target.emit(message.event, message.payload);
  });

  return io;
}

export function getIo(): Server {
  if (!io) throw new Error('Socket.io henuz baslatilmadi');
  return io;
}

/** Kiraci odasindaki bagli kullanici sayisi (saglik/teshis icin). */
export async function connectedCount(tenantId: string): Promise<number> {
  if (!io) return 0;
  const sockets = await io.in(rooms.tenant(tenantId)).fetchSockets();
  return sockets.length;
}
