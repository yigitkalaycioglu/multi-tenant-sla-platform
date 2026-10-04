import { evaluateSlaWindow } from '../sla/sla.engine.js';
import { env } from '../../config/env.js';
import type { SlaState, TicketPriority, TicketStatus } from '../../types/domain.js';

/** tickets tablosu + join edilen isimler. */
export interface TicketJoinedRow {
  id: string;
  reference: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  team_id: string | null;
  team_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  response_due_at: Date | null;
  resolution_due_at: Date | null;
  first_response_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  paused_at: Date | null;
  paused_total_seconds: number;
  response_sla_state: SlaState;
  resolution_sla_state: SlaState;
  created_at: Date;
  updated_at: Date;
  comment_count?: number;
}

export interface SlaSnapshot {
  state: SlaState;
  dueAt: string | null;
  remainingMs: number | null;
  consumedRatio: number;
}

export interface TicketDto {
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

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Satiri API sozlesmesine cevirir ve SLA anlik durumunu hesaplar.
 *
 * Kalici `*_sla_state` kolonu worker tarafindan guncellenir (bildirimlerin
 * kaynagi odur). Burada ayrica anlik bir hesap yapariz ki, iki tarama arasinda
 * bile arayuz dogru geri sayimi gostersin.
 */
export function toTicketDto(row: TicketJoinedRow, now = new Date()): TicketDto {
  const response = evaluateSlaWindow({
    createdAt: row.created_at,
    dueAt: row.response_due_at,
    completedAt: row.first_response_at,
    pausedAt: row.paused_at,
    pausedTotalSeconds: row.paused_total_seconds,
    now,
    riskThreshold: env.SLA_RISK_THRESHOLD,
  });

  const resolution = evaluateSlaWindow({
    createdAt: row.created_at,
    dueAt: row.resolution_due_at,
    completedAt: row.resolved_at,
    pausedAt: row.paused_at,
    pausedTotalSeconds: row.paused_total_seconds,
    now,
    riskThreshold: env.SLA_RISK_THRESHOLD,
  });

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    team: row.team_id ? { id: row.team_id, name: row.team_name ?? 'Bilinmiyor' } : null,
    assignee: row.assignee_id
      ? { id: row.assignee_id, name: row.assignee_name ?? 'Bilinmiyor', email: row.assignee_email }
      : null,
    reporter: row.reporter_id ? { id: row.reporter_id, name: row.reporter_name ?? 'Bilinmiyor' } : null,
    firstResponseAt: iso(row.first_response_at),
    resolvedAt: iso(row.resolved_at),
    closedAt: iso(row.closed_at),
    isPaused: row.paused_at !== null,
    pausedTotalSeconds: row.paused_total_seconds,
    sla: {
      response: {
        state: response.state,
        dueAt: iso(row.response_due_at),
        remainingMs: Number.isFinite(response.remainingMs) ? response.remainingMs : null,
        consumedRatio: Number(response.consumedRatio.toFixed(4)),
      },
      resolution: {
        state: resolution.state,
        dueAt: iso(row.resolution_due_at),
        remainingMs: Number.isFinite(resolution.remainingMs) ? resolution.remainingMs : null,
        consumedRatio: Number(resolution.consumedRatio.toFixed(4)),
      },
    },
    commentCount: row.comment_count ?? 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const TICKET_SELECT = `
  t.id, t.reference, t.title, t.description, t.status, t.priority,
  t.team_id, tm.name AS team_name,
  t.assignee_id, ua.full_name AS assignee_name, ua.email::text AS assignee_email,
  t.reporter_id, ur.full_name AS reporter_name,
  t.response_due_at, t.resolution_due_at, t.first_response_at,
  t.resolved_at, t.closed_at, t.paused_at, t.paused_total_seconds,
  t.response_sla_state, t.resolution_sla_state,
  t.created_at, t.updated_at
`;

export const TICKET_JOINS = `
  FROM tickets t
  LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN users ua ON ua.id = t.assignee_id
  LEFT JOIN users ur ON ur.id = t.reporter_id
`;
