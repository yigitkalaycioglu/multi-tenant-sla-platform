import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '../api/client';
import { invalidateTicketViews, keys } from '../api/hooks';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import type { Ticket, TicketPriority } from '../api/types';
import { PRIORITY_LABELS } from '../lib/format';

interface SocketState {
  connected: boolean;
  socket: Socket | null;
}

const SocketContext = createContext<SocketState>({ connected: false, socket: null });

interface SlaEventPayload {
  ticketId: string;
  reference: string;
  title: string;
  priority: TicketPriority;
  window: 'response' | 'resolution';
  dueAt: string;
}

interface TicketUpdatedPayload {
  ticket: Ticket;
  changes: string[];
  actor: { id: string; name: string };
}

interface CommentPayload {
  ticketId: string;
  comment: { author: { name: string } | null };
  ticket: Ticket;
}

/**
 * Socket.io baglantisi.
 *
 * El sikismada JWT gonderilir; sunucu kullaniciyi kiraci ve kullanici odalarina
 * ekler. Gelen olaylar hem bildirim (toast) uretir hem de React Query
 * onbellegini gecersiz kilar — boylece acik olan liste/detay ekranlari
 * yenilenir, kullanicinin sayfayi yenilemesi gerekmez.
 */
export function SocketProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { user } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      setConnected(false);
      return;
    }

    const instance = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelay: 800,
      reconnectionDelayMax: 6_000,
    });

    instance.on('connect', () => setConnected(true));
    instance.on('disconnect', () => setConnected(false));
    instance.on('connect_error', () => setConnected(false));

    instance.on('ticket:created', (ticket: Ticket) => {
      invalidateTicketViews(queryClient);
      if (ticket.assignee?.id === user.id) {
        push({
          tone: 'info',
          title: 'Size yeni bir bilet atandi',
          text: `${ticket.reference} · ${ticket.title}`,
        });
      }
    });

    instance.on('ticket:updated', (payload: TicketUpdatedPayload) => {
      invalidateTicketViews(queryClient);
      void queryClient.invalidateQueries({ queryKey: keys.ticket(payload.ticket.id) });

      const becameMine = payload.changes.includes('assignee') && payload.ticket.assignee?.id === user.id;
      if (becameMine && payload.actor.id !== user.id) {
        push({
          tone: 'info',
          title: 'Bilet size atandi',
          text: `${payload.ticket.reference} · ${payload.ticket.title}`,
        });
      }
    });

    instance.on('ticket:comment', (payload: CommentPayload) => {
      void queryClient.invalidateQueries({ queryKey: keys.ticket(payload.ticketId) });
      invalidateTicketViews(queryClient);
    });

    instance.on('ticket:deleted', () => invalidateTicketViews(queryClient));

    instance.on('sla:at_risk', (payload: SlaEventPayload) => {
      invalidateTicketViews(queryClient);
      push({
        tone: 'warning',
        title: 'SLA suresi dolmak uzere',
        text: `${payload.reference} · ${PRIORITY_LABELS[payload.priority]} · ${payload.title}`,
      });
    });

    instance.on('sla:breached', (payload: SlaEventPayload) => {
      invalidateTicketViews(queryClient);
      push({
        tone: 'critical',
        title: 'SLA suresi asildi',
        text: `${payload.reference} · ${PRIORITY_LABELS[payload.priority]} · ${payload.title}`,
      });
    });

    setSocket(instance);

    return () => {
      instance.removeAllListeners();
      instance.close();
      setSocket(null);
      setConnected(false);
    };
  }, [user, push, queryClient]);

  const value = useMemo(() => ({ connected, socket }), [connected, socket]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketState {
  return useContext(SocketContext);
}

/** Bilet detay ekrani acildiginda o biletin odasina abone olur. */
export function useTicketRoom(ticketId: string | undefined): void {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !ticketId) return;
    socket.emit('ticket:subscribe', ticketId);
    return () => {
      socket.emit('ticket:unsubscribe', ticketId);
    };
  }, [socket, ticketId]);
}
