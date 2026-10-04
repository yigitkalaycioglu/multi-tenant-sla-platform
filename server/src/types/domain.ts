export const USER_ROLES = ['admin', 'team_lead', 'developer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'on_hold', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const SLA_STATES = ['on_track', 'at_risk', 'breached', 'met'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** Bir bilet hangi durumlardan hangilerine gecebilir. */
export const STATUS_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in_progress', 'on_hold', 'resolved', 'closed'],
  in_progress: ['on_hold', 'resolved', 'closed'],
  on_hold: ['in_progress', 'open', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};

export const OPEN_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'on_hold'];

export interface AuthUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
}

export interface SlaPolicyRow {
  id: string;
  tenant_id: string;
  priority: TicketPriority;
  response_minutes: number;
  resolution_minutes: number;
}

export interface TicketRow {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  team_id: string | null;
  assignee_id: string | null;
  reporter_id: string | null;
  sla_policy_id: string | null;
  response_due_at: Date | null;
  resolution_due_at: Date | null;
  first_response_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  paused_at: Date | null;
  paused_total_seconds: number;
  response_sla_state: SlaState;
  resolution_sla_state: SlaState;
  risk_notified_at: Date | null;
  breach_notified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

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
