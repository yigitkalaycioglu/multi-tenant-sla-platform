import type { TicketPriority } from '../../domain/tickets/ticket.js';

export interface RealtimeMessage {
  /** Hedef kiraci. */
  tenantId: string;
  /** Istemcinin dinledigi olay adi, orn. "ticket:updated". */
  event: string;
  payload: unknown;
  /** Verilirse yalnizca bu kullanicilara gonderilir. */
  userIds?: string[];
  /** Verilirse ilgili bilet odasina da gonderilir. */
  ticketId?: string;
}

/**
 * Canli olay yayini. Uygulamalar hata FIRLATMAMALIDIR: gercek zamanli
 * bildirim yan etkidir, is akisini bloke etmemeli.
 */
export interface RealtimePublisher {
  publish(message: RealtimeMessage): Promise<void>;
}

/** Kuyruga giren e-posta bildirim isleri. */
export type NotificationJob =
  | {
      kind: 'sla_at_risk' | 'sla_breached';
      tenantId: string;
      ticketId: string;
      reference: string;
      title: string;
      priority: TicketPriority;
      dueAt: string;
      recipients: string[];
    }
  | {
      kind: 'ticket_assigned';
      tenantId: string;
      ticketId: string;
      reference: string;
      title: string;
      priority: TicketPriority;
      dueAt: string;
      recipients: string[];
      assignedBy: string;
    };

export interface NotificationQueue {
  /**
   * `dedupeKey` deterministik secilir: ayni bilet icin ayni tur bildirim,
   * tarayici ust uste calissa bile bir kez kuyruga girer (idempotensi).
   */
  enqueue(job: NotificationJob, dedupeKey?: string): Promise<void>;
}
