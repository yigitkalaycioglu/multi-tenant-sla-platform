import type {
  TicketCommentRecord,
  TicketEventRecord,
  TicketRecord,
  TicketRepository,
  TicketSort,
} from '../../../application/tickets/ticket.ports.js';
import type { SlaState } from '../../../domain/sla/sla-policy.js';
import type { Ticket, TicketChanges, TicketPriority, TicketStatus } from '../../../domain/tickets/ticket.js';
import type { Queryable } from '../pool.js';
import { PRIORITY_RANK_SQL, visibilitySql } from './ticket-visibility.sql.js';

interface TicketRow {
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
  created_at: Date;
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
}

interface TicketRecordRow extends TicketRow {
  team_name: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  reporter_name: string | null;
  comment_count: number;
  updated_at: Date;
}

const TICKET_COLUMNS = `
  t.id, t.tenant_id, t.reference, t.title, t.description, t.status, t.priority,
  t.team_id, t.assignee_id, t.reporter_id, t.sla_policy_id, t.created_at,
  t.response_due_at, t.resolution_due_at, t.first_response_at,
  t.resolved_at, t.closed_at, t.paused_at, t.paused_total_seconds,
  t.response_sla_state, t.resolution_sla_state, t.risk_notified_at, t.breach_notified_at
`;

const RECORD_SELECT = `
  SELECT ${TICKET_COLUMNS},
         tm.name AS team_name,
         ua.full_name AS assignee_name, ua.email::text AS assignee_email,
         ur.full_name AS reporter_name,
         t.updated_at,
         (SELECT COUNT(*)::bigint FROM ticket_comments c WHERE c.ticket_id = t.id) AS comment_count
`;

const RECORD_JOINS = `
  FROM tickets t
  LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN users ua ON ua.id = t.assignee_id
  LEFT JOIN users ur ON ur.id = t.reporter_id
`;

const SORT_SQL: Record<TicketSort, string> = {
  created_desc: 't.created_at DESC',
  created_asc: 't.created_at ASC',
  due_asc: 't.resolution_due_at ASC NULLS LAST',
  priority_desc: `${PRIORITY_RANK_SQL('t.priority')}, t.created_at DESC`,
};

/**
 * Domain alani -> kolon eslemesi. UPDATE'teki kolon adlari yalnizca bu
 * beyaz listeden gelir; `Record<keyof TicketChanges, ...>` sayesinde domain'e
 * yeni bir alan eklenip burasi unutulursa derleme hata verir.
 */
const CHANGE_COLUMNS: Record<keyof TicketChanges, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  teamId: 'team_id',
  assigneeId: 'assignee_id',
  slaPolicyId: 'sla_policy_id',
  responseDueAt: 'response_due_at',
  resolutionDueAt: 'resolution_due_at',
  firstResponseAt: 'first_response_at',
  resolvedAt: 'resolved_at',
  closedAt: 'closed_at',
  pausedAt: 'paused_at',
  pausedTotalSeconds: 'paused_total_seconds',
  responseSlaState: 'response_sla_state',
  resolutionSlaState: 'resolution_sla_state',
  riskNotifiedAt: 'risk_notified_at',
  breachNotifiedAt: 'breach_notified_at',
};

function toTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    reference: r.reference,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    teamId: r.team_id,
    assigneeId: r.assignee_id,
    reporterId: r.reporter_id,
    slaPolicyId: r.sla_policy_id,
    createdAt: r.created_at,
    responseDueAt: r.response_due_at,
    resolutionDueAt: r.resolution_due_at,
    firstResponseAt: r.first_response_at,
    resolvedAt: r.resolved_at,
    closedAt: r.closed_at,
    pausedAt: r.paused_at,
    pausedTotalSeconds: r.paused_total_seconds,
    responseSlaState: r.response_sla_state,
    resolutionSlaState: r.resolution_sla_state,
    riskNotifiedAt: r.risk_notified_at,
    breachNotifiedAt: r.breach_notified_at,
  };
}

function toRecord(r: TicketRecordRow): TicketRecord {
  return {
    ...toTicket(r),
    teamName: r.team_name,
    assigneeName: r.assignee_name,
    assigneeEmail: r.assignee_email,
    reporterName: r.reporter_name,
    commentCount: r.comment_count ?? 0,
    updatedAt: r.updated_at,
  };
}

export function createTicketRepository(db: Queryable, tenantId: string): TicketRepository {
  return {
    async nextSequence() {
      // INSERT ... ON CONFLICT DO UPDATE satiri kilitler; transaction bitene
      // kadar baska bir istek ayni numarayi alamaz.
      const { rows } = await db.query<{ last_number: number }>(
        `INSERT INTO ticket_counters (tenant_id, last_number) VALUES ($1, 1)
         ON CONFLICT (tenant_id) DO UPDATE SET last_number = ticket_counters.last_number + 1
         RETURNING last_number`,
        [tenantId],
      );
      return rows[0]!.last_number;
    },

    async insert(t) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO tickets (tenant_id, reference, title, description, priority, status,
                              team_id, assignee_id, reporter_id, sla_policy_id,
                              created_at, response_due_at, resolution_due_at)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          tenantId,
          t.reference,
          t.title,
          t.description,
          t.priority,
          t.teamId,
          t.assigneeId,
          t.reporterId,
          t.slaPolicyId,
          t.createdAt,
          t.responseDueAt,
          t.resolutionDueAt,
        ],
      );
      return rows[0]!.id;
    },

    async findRecord(id, visibility) {
      const params: unknown[] = [id];
      const scope = visibilitySql(visibility, params);
      const { rows } = await db.query<TicketRecordRow>(
        `${RECORD_SELECT} ${RECORD_JOINS} WHERE t.id = $1 AND ${scope}`,
        params,
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async lockForUpdate(id, visibility) {
      const params: unknown[] = [id];
      const scope = visibilitySql(visibility, params);
      const { rows } = await db.query<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM tickets t WHERE t.id = $1 AND ${scope} FOR UPDATE`,
        params,
      );
      return rows[0] ? toTicket(rows[0]) : null;
    },

    async list(query, visibility) {
      const params: unknown[] = [];
      const where: string[] = [visibilitySql(visibility, params)];

      if (query.status?.length) {
        params.push(query.status);
        where.push(`t.status = ANY($${params.length}::ticket_status[])`);
      }
      if (query.priority?.length) {
        params.push(query.priority);
        where.push(`t.priority = ANY($${params.length}::ticket_priority[])`);
      }
      if (query.slaState?.length) {
        params.push(query.slaState);
        where.push(`t.resolution_sla_state = ANY($${params.length}::sla_state[])`);
      }
      if (query.teamId) {
        params.push(query.teamId);
        where.push(`t.team_id = $${params.length}`);
      }
      if (query.assigneeId === 'unassigned') {
        where.push('t.assignee_id IS NULL');
      } else if (query.assigneeId) {
        params.push(query.assigneeId);
        where.push(`t.assignee_id = $${params.length}`);
      }
      if (query.search) {
        params.push(`%${query.search}%`);
        where.push(`(t.title ILIKE $${params.length} OR t.reference ILIKE $${params.length})`);
      }

      const whereSql = where.join(' AND ');

      const total = await db.query<{ count: number }>(
        `SELECT COUNT(*)::bigint AS count ${RECORD_JOINS} WHERE ${whereSql}`,
        params,
      );

      params.push(query.pageSize, (query.page - 1) * query.pageSize);
      const { rows } = await db.query<TicketRecordRow>(
        `${RECORD_SELECT} ${RECORD_JOINS}
          WHERE ${whereSql}
          ORDER BY ${SORT_SQL[query.sort]}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );

      return { items: rows.map(toRecord), total: total.rows[0]?.count ?? 0 };
    },

    async update(id, changes) {
      const keys = Object.keys(changes) as Array<keyof TicketChanges>;
      if (keys.length === 0) return;

      const values: unknown[] = keys.map((k) => changes[k]);
      const setSql = keys.map((k, i) => `${CHANGE_COLUMNS[k]} = $${i + 1}`).join(', ');
      values.push(id);
      await db.query(`UPDATE tickets SET ${setSql} WHERE id = $${values.length}`, values);
    },

    async delete(id) {
      const result = await db.query('DELETE FROM tickets WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async recordEvent(ticketId, actorId, type, payload = {}) {
      await db.query(
        `INSERT INTO ticket_events (tenant_id, ticket_id, actor_id, type, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [tenantId, ticketId, actorId, type, JSON.stringify(payload)],
      );
    },

    async listEvents(ticketId) {
      const { rows } = await db.query<{
        id: string;
        type: string;
        payload: Record<string, unknown>;
        actor_id: string | null;
        actor_name: string | null;
        created_at: Date;
      }>(
        `SELECT e.id::text AS id, e.type, e.payload, e.actor_id, u.full_name AS actor_name, e.created_at
           FROM ticket_events e
           LEFT JOIN users u ON u.id = e.actor_id
          WHERE e.ticket_id = $1
          ORDER BY e.created_at ASC, e.id ASC`,
        [ticketId],
      );
      return rows.map(
        (e): TicketEventRecord => ({
          id: e.id,
          type: e.type,
          payload: e.payload,
          actorId: e.actor_id,
          actorName: e.actor_name,
          createdAt: e.created_at,
        }),
      );
    },

    async addComment(c) {
      const { rows } = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO ticket_comments (tenant_id, ticket_id, author_id, body, is_internal)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [tenantId, c.ticketId, c.authorId, c.body, c.isInternal],
      );
      return { id: rows[0]!.id, createdAt: rows[0]!.created_at };
    },

    async listComments(ticketId) {
      const { rows } = await db.query<{
        id: string;
        body: string;
        is_internal: boolean;
        author_id: string | null;
        author_name: string | null;
        created_at: Date;
      }>(
        `SELECT c.id, c.body, c.is_internal, c.author_id, u.full_name AS author_name, c.created_at
           FROM ticket_comments c
           LEFT JOIN users u ON u.id = c.author_id
          WHERE c.ticket_id = $1
          ORDER BY c.created_at ASC`,
        [ticketId],
      );
      return rows.map(
        (c): TicketCommentRecord => ({
          id: c.id,
          body: c.body,
          isInternal: c.is_internal,
          authorId: c.author_id,
          authorName: c.author_name,
          createdAt: c.created_at,
        }),
      );
    },
  };
}
