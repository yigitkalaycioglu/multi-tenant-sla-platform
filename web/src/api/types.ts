export type UserRole = 'admin' | 'team_lead' | 'developer';
export type TicketStatus = 'open' | 'in_progress' | 'on_hold' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type SlaState = 'on_track' | 'at_risk' | 'breached' | 'met';

export interface AuthUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
}

export interface SlaSnapshot {
  state: SlaState;
  dueAt: string | null;
  remainingMs: number | null;
  consumedRatio: number;
}

export interface Ticket {
  id: string;
  reference: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  team: { id: string; name: string } | null;
  assignee: { id: string; name: string; email: string | null } | null;
  reporter: { id: string; name: string } | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  isPaused: boolean;
  pausedTotalSeconds: number;
  sla: { response: SlaSnapshot; resolution: SlaSnapshot };
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketComment {
  id: string;
  body: string;
  isInternal: boolean;
  author: { id: string; name: string } | null;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor: { id: string; name: string } | null;
  createdAt: string;
}

export interface TicketDetail {
  ticket: Ticket;
  comments: TicketComment[];
  events: TicketEvent[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  lead: { id: string; name: string } | null;
  memberCount: number;
  openTicketCount: number;
  createdAt: string;
}

export interface TenantUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  team: { id: string; name: string } | null;
  isActive: boolean;
  lastLoginAt: string | null;
  openTicketCount: number;
  createdAt: string;
}

export interface SlaPolicy {
  id: string;
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
  ticketCount: number;
  breachedCount: number;
  updatedAt: string;
}

export interface Overview {
  totals: {
    total: number;
    open: number;
    inProgress: number;
    onHold: number;
    resolved: number;
    closed: number;
    activeTotal: number;
  };
  sla: {
    openBreached: number;
    openAtRisk: number;
    met: number;
    breached: number;
    complianceRate: number | null;
  };
  averages: { resolutionMinutes: number | null; firstResponseMinutes: number | null };
  byPriority: Array<{ priority: TicketPriority; total: number; open: number; breached: number }>;
  trend: Array<{ date: string; created: number; resolved: number }>;
  teamWorkload: Array<{ teamId: string | null; teamName: string; open: number; breached: number }>;
  topAssignees: Array<{ userId: string; name: string; open: number; breached: number }>;
  scope: 'tenant' | 'personal';
  days: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }> | unknown;
  };
}
