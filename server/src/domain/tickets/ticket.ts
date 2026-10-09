import type { SlaState } from '../sla/sla-policy.js';

export const TICKET_STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Bir bilet hangi durumlardan hangilerine gecebilir. */
export const STATUS_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in_progress', 'on_hold', 'resolved', 'closed'],
  in_progress: ['on_hold', 'resolved', 'closed'],
  on_hold: ['in_progress', 'open', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};

export const OPEN_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'on_hold'];

/** Zaman tunelinde gorunen olay tipleri. */
export type TicketEventType =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'assigned'
  | 'unassigned'
  | 'team_changed'
  | 'commented'
  | 'first_response'
  | 'sla_at_risk'
  | 'sla_breached'
  | 'reopened';

/** Bilet varligi: is kurallarinin uzerinde calistigi tam durum. */
export interface Ticket {
  id: string;
  tenantId: string;
  reference: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  teamId: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  slaPolicyId: string | null;
  createdAt: Date;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  pausedAt: Date | null;
  pausedTotalSeconds: number;
  responseSlaState: SlaState;
  resolutionSlaState: SlaState;
  riskNotifiedAt: Date | null;
  breachNotifiedAt: Date | null;
}

/** Bir guncellemede degisebilecek alanlar; kimlik ve acilis bilgisi sabittir. */
export type TicketChanges = Partial<Omit<Ticket, 'id' | 'tenantId' | 'reference' | 'reporterId' | 'createdAt'>>;

/** Kiraci bazli sira numarasindan okunur referans uretir: 42 -> "TCK-000042". */
export function formatTicketReference(sequence: number): string {
  return `TCK-${String(sequence).padStart(6, '0')}`;
}
