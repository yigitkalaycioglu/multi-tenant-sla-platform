import { evaluateSlaWindow } from '../../domain/sla/sla-engine.js';
import type { SlaState } from '../../domain/sla/sla-policy.js';
import type { TicketEventType, TicketPriority, TicketStatus } from '../../domain/tickets/ticket.js';
import type { TicketCommentRecord, TicketEventRecord, TicketRecord } from './ticket.ports.js';

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

export interface TicketEventDto {
  id: string;
  type: TicketEventType | string;
  payload: Record<string, unknown>;
  actor: { id: string; name: string } | null;
  createdAt: string;
}

export interface TicketCommentDto {
  id: string;
  body: string;
  isInternal: boolean;
  author: { id: string; name: string } | null;
  createdAt: string;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function snapshot(
  dueAt: Date | null,
  result: { state: SlaState; remainingMs: number; consumedRatio: number },
): SlaSnapshot {
  return {
    state: result.state,
    dueAt: iso(dueAt),
    remainingMs: Number.isFinite(result.remainingMs) ? result.remainingMs : null,
    consumedRatio: Number(result.consumedRatio.toFixed(4)),
  };
}

/**
 * Kaydi API sozlesmesine cevirir ve SLA anlik durumunu hesaplar.
 *
 * Kalici `*SlaState` alani worker tarafindan guncellenir (bildirimlerin
 * kaynagi odur). Burada ayrica anlik bir hesap yapariz ki, iki tarama arasinda
 * bile arayuz dogru geri sayimi gostersin.
 */
export function toTicketDto(record: TicketRecord, now: Date, riskThreshold: number): TicketDto {
  const common = {
    createdAt: record.createdAt,
    pausedAt: record.pausedAt,
    pausedTotalSeconds: record.pausedTotalSeconds,
    now,
    riskThreshold,
  };
  const response = evaluateSlaWindow({ ...common, dueAt: record.responseDueAt, completedAt: record.firstResponseAt });
  const resolution = evaluateSlaWindow({ ...common, dueAt: record.resolutionDueAt, completedAt: record.resolvedAt });

  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    description: record.description,
    status: record.status,
    priority: record.priority,
    team: record.teamId ? { id: record.teamId, name: record.teamName ?? 'Bilinmiyor' } : null,
    assignee: record.assigneeId
      ? { id: record.assigneeId, name: record.assigneeName ?? 'Bilinmiyor', email: record.assigneeEmail }
      : null,
    reporter: record.reporterId ? { id: record.reporterId, name: record.reporterName ?? 'Bilinmiyor' } : null,
    firstResponseAt: iso(record.firstResponseAt),
    resolvedAt: iso(record.resolvedAt),
    closedAt: iso(record.closedAt),
    isPaused: record.pausedAt !== null,
    pausedTotalSeconds: record.pausedTotalSeconds,
    sla: {
      response: snapshot(record.responseDueAt, response),
      resolution: snapshot(record.resolutionDueAt, resolution),
    },
    commentCount: record.commentCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toEventDto(e: TicketEventRecord): TicketEventDto {
  return {
    id: e.id,
    type: e.type,
    payload: e.payload ?? {},
    actor: e.actorId ? { id: e.actorId, name: e.actorName ?? 'Silinmis kullanici' } : null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toCommentDto(c: TicketCommentRecord): TicketCommentDto {
  return {
    id: c.id,
    body: c.body,
    isInternal: c.isInternal,
    author: c.authorId ? { id: c.authorId, name: c.authorName ?? 'Silinmis kullanici' } : null,
    createdAt: c.createdAt.toISOString(),
  };
}
