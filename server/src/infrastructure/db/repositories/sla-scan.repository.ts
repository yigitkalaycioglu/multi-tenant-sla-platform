/**
 * Kiracilar arasi SLA taramasi (sistem baglantisi, RLS disi).
 *
 * Onemli detaylar:
 *   - `FOR UPDATE SKIP LOCKED` sayesinde birden fazla worker ornegi ayni
 *     bileti iki kez islemez.
 *   - Durum degisimi ve bildirim isareti tek UPDATE ... RETURNING icinde
 *     yapilir; bu yuzden ayni bilet icin ikinci kez e-posta uretilmez.
 *   - Duraklatilmis (on_hold) biletler tamamen disarida birakilir.
 */
import type pg from 'pg';
import type {
  SlaScanRepository,
  SlaTransition,
  SlaTransitionHit,
  SlaWindow,
} from '../../../application/sla/sla-scan.ports.js';
import type { TicketPriority } from '../../../domain/tickets/ticket.js';
import { withTransaction } from '../pool.js';

const BATCH_SIZE = 500;

interface ScanRow {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  priority: TicketPriority;
  due_at: Date;
  recipients: string[];
  watchers: string[];
}

const WINDOW_COLUMNS: Record<SlaWindow, { due: string; state: string; extraFilter: string }> = {
  response: {
    due: 'response_due_at',
    state: 'response_sla_state',
    extraFilter: 'AND t.first_response_at IS NULL',
  },
  resolution: {
    due: 'resolution_due_at',
    state: 'resolution_sla_state',
    extraFilter: '',
  },
};

export function buildScanSql(window: SlaWindow, transition: SlaTransition): string {
  const col = WINDOW_COLUMNS[window];

  // Ihlal: hedef gecmis. Risk: aktif gecen sure / pencere >= esik.
  // Not: due_at duraklatma kadar ileri kaydirildigi icin gercek pencere
  //      (due_at - created_at - paused_total) olur.
  const trigger =
    transition === 'breached'
      ? `t.${col.due} <= now()`
      : `now() >= t.created_at
           + make_interval(secs => t.paused_total_seconds)
           + ($1::numeric * EXTRACT(EPOCH FROM (t.${col.due} - t.created_at - make_interval(secs => t.paused_total_seconds)))) * interval '1 second'
         AND t.${col.due} > now()`;

  const nextStateGuard =
    transition === 'breached' ? `t.${col.state} <> 'breached'` : `t.${col.state} = 'on_track'`;

  const notifiedColumn = transition === 'breached' ? 'breach_notified_at' : 'risk_notified_at';

  return `
    WITH candidates AS (
      SELECT t.id
        FROM tickets t
       WHERE t.status NOT IN ('resolved','closed')
         AND t.paused_at IS NULL
         AND t.${col.due} IS NOT NULL
         AND ${nextStateGuard}
         AND (${trigger})
         ${col.extraFilter}
       ORDER BY t.${col.due}
       LIMIT ${BATCH_SIZE}
       FOR UPDATE SKIP LOCKED
    ),
    updated AS (
      UPDATE tickets t
         SET ${col.state} = '${transition}',
             ${notifiedColumn} = COALESCE(t.${notifiedColumn}, now()),
             updated_at = now()
        FROM candidates c
       WHERE t.id = c.id
      RETURNING t.id, t.tenant_id, t.reference, t.title, t.priority,
                t.${col.due} AS due_at, t.assignee_id, t.team_id
    )
    SELECT u.id, u.tenant_id, u.reference, u.title, u.priority, u.due_at, u.assignee_id,
           COALESCE(ARRAY(
             SELECT DISTINCT usr.email::text
               FROM users usr
              WHERE usr.tenant_id = u.tenant_id
                AND usr.is_active
                AND (
                  usr.id = u.assignee_id
                  OR usr.id = (SELECT tm.lead_id FROM teams tm WHERE tm.id = u.team_id)
                  ${transition === 'breached' ? "OR usr.role = 'admin'" : ''}
                )
           ), '{}') AS recipients,
           COALESCE(ARRAY(
             SELECT DISTINCT usr.id::text
               FROM users usr
              WHERE usr.tenant_id = u.tenant_id
                AND usr.is_active
                AND (
                  usr.id = u.assignee_id
                  OR usr.id = (SELECT tm.lead_id FROM teams tm WHERE tm.id = u.team_id)
                  OR usr.role = 'admin'
                )
           ), '{}') AS watchers
      FROM updated u;
  `;
}

export function createSlaScanRepository(adminPool: pg.Pool): SlaScanRepository {
  return {
    async markTransitions(window, transition, riskThreshold) {
      const sql = buildScanSql(window, transition);
      const params = transition === 'at_risk' ? [riskThreshold] : [];

      const rows = await withTransaction(adminPool, async (db) => (await db.query<ScanRow>(sql, params)).rows);

      return rows.map(
        (r): SlaTransitionHit => ({
          ticketId: r.id,
          tenantId: r.tenant_id,
          reference: r.reference,
          title: r.title,
          priority: r.priority,
          dueAt: r.due_at,
          emailRecipients: r.recipients,
          watcherIds: r.watchers,
        }),
      );
    },
  };
}
