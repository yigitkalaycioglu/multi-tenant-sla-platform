import type { SlaPolicyRecord, SlaPolicyRepository } from '../../../application/sla/sla-policy.ports.js';
import type { SlaPolicy } from '../../../domain/sla/sla-policy.js';
import type { TicketPriority } from '../../../domain/tickets/ticket.js';
import type { Queryable } from '../pool.js';
import { PRIORITY_RANK_SQL } from './ticket-visibility.sql.js';

interface PolicyRow {
  id: string;
  priority: TicketPriority;
  response_minutes: number;
  resolution_minutes: number;
}

interface PolicyStatsRow extends PolicyRow {
  updated_at: Date;
  ticket_count: number;
  breached_count: number;
}

const toPolicy = (r: PolicyRow): SlaPolicy => ({
  id: r.id,
  priority: r.priority,
  responseMinutes: r.response_minutes,
  resolutionMinutes: r.resolution_minutes,
});

const toRecord = (r: PolicyStatsRow): SlaPolicyRecord => ({
  ...toPolicy(r),
  updatedAt: r.updated_at,
  ticketCount: r.ticket_count,
  breachedCount: r.breached_count,
});

export function createSlaPolicyRepository(db: Queryable, tenantId: string): SlaPolicyRepository {
  return {
    async findByPriority(priority) {
      const { rows } = await db.query<PolicyRow>(
        'SELECT id, priority, response_minutes, resolution_minutes FROM sla_policies WHERE priority = $1',
        [priority],
      );
      return rows[0] ? toPolicy(rows[0]) : null;
    },

    async listWithStats() {
      const { rows } = await db.query<PolicyStatsRow>(
        `SELECT p.id, p.priority, p.response_minutes, p.resolution_minutes, p.updated_at,
                (SELECT COUNT(*)::bigint FROM tickets t WHERE t.priority = p.priority) AS ticket_count,
                (SELECT COUNT(*)::bigint FROM tickets t
                  WHERE t.priority = p.priority AND t.resolution_sla_state = 'breached') AS breached_count
           FROM sla_policies p
          ORDER BY ${PRIORITY_RANK_SQL('p.priority')}`,
      );
      return rows.map(toRecord);
    },

    async upsert(priority, targets) {
      const { rows } = await db.query<PolicyStatsRow>(
        `INSERT INTO sla_policies (tenant_id, priority, response_minutes, resolution_minutes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, priority)
         DO UPDATE SET response_minutes = EXCLUDED.response_minutes,
                       resolution_minutes = EXCLUDED.resolution_minutes
         RETURNING id, priority, response_minutes, resolution_minutes, updated_at,
                   0::bigint AS ticket_count, 0::bigint AS breached_count`,
        [tenantId, priority, targets.responseMinutes, targets.resolutionMinutes],
      );
      return toRecord(rows[0]!);
    },

    async insertMany(policies) {
      await db.query(
        `INSERT INTO sla_policies (tenant_id, priority, response_minutes, resolution_minutes)
         SELECT $1, x.priority::ticket_priority, x.response_minutes, x.resolution_minutes
           FROM jsonb_to_recordset($2::jsonb)
                AS x(priority text, response_minutes int, resolution_minutes int)`,
        [
          tenantId,
          JSON.stringify(
            policies.map((p) => ({
              priority: p.priority,
              response_minutes: p.responseMinutes,
              resolution_minutes: p.resolutionMinutes,
            })),
          ),
        ],
      );
    },
  };
}
