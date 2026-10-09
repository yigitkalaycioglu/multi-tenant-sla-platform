import type { SlaPolicy, SlaTargets } from '../../domain/sla/sla-policy.js';
import type { TicketPriority } from '../../domain/tickets/ticket.js';

/** Politika + o oncelikteki bilet istatistikleri (yonetim ekrani). */
export interface SlaPolicyRecord extends SlaPolicy {
  updatedAt: Date;
  ticketCount: number;
  breachedCount: number;
}

export interface SlaPolicyRepository {
  findByPriority(priority: TicketPriority): Promise<SlaPolicy | null>;
  /** Ciddiyet sirasina gore: urgent, high, medium, low. */
  listWithStats(): Promise<SlaPolicyRecord[]>;
  /** Politikayi gunceller, yoksa olusturur. */
  upsert(priority: TicketPriority, targets: SlaTargets): Promise<SlaPolicyRecord>;
  insertMany(policies: ReadonlyArray<SlaTargets & { priority: TicketPriority }>): Promise<void>;
}
