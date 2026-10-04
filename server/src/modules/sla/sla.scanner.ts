/**
 * SLA tarayicisi — worker surecinde periyodik olarak calisir.
 *
 * Kiracilar arasi calistigi icin sistem (admin) baglantisini kullanir.
 * Her tarama iki gecis yapar:
 *   1. Hedefi asmis biletleri `breached` yapar,
 *   2. Esige (varsayilan %80) gelmis biletleri `at_risk` yapar.
 *
 * Onemli detaylar:
 *   - `FOR UPDATE SKIP LOCKED` sayesinde birden fazla worker ornegi ayni
 *     bileti iki kez islemez.
 *   - Durum degisimi ve bildirim isareti tek UPDATE ... RETURNING icinde
 *     yapilir; bu yuzden ayni bilet icin ikinci kez e-posta uretilmez.
 *   - Duraklatilmis (on_hold) biletler tamamen disarida birakilir.
 */
import { adminPool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { queueLogger } from '../../lib/logger.js';
import { enqueueNotification } from '../../queue/index.js';
import { publishRealtime } from '../../realtime/bus.js';
import type { TicketPriority } from '../../types/domain.js';

const BATCH_SIZE = 500;

interface ScanHit {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  priority: TicketPriority;
  due_at: Date;
  assignee_id: string | null;
  recipients: string[];
  watchers: string[];
}

type Window = 'response' | 'resolution';
type Transition = 'breached' | 'at_risk';

const WINDOW_COLUMNS: Record<Window, { due: string; state: string; extraFilter: string }> = {
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

function buildScanSql(window: Window, transition: Transition): string {
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
    transition === 'breached'
      ? `t.${col.state} <> 'breached'`
      : `t.${col.state} = 'on_track'`;

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

async function runPass(window: Window, transition: Transition): Promise<number> {
  const sql = buildScanSql(window, transition);
  const params = transition === 'at_risk' ? [env.SLA_RISK_THRESHOLD] : [];

  const client = await adminPool.connect();
  let hits: ScanHit[] = [];
  try {
    await client.query('BEGIN');
    const result = await client.query<ScanHit>(sql, params);
    hits = result.rows;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  for (const hit of hits) {
    const event = transition === 'breached' ? 'sla:breached' : 'sla:at_risk';

    // 1) Canli bildirim — ilgili kisilerin (atanan, ekip lideri, admin)
    //    panelinde aninda gorunur; bilet detayi acik olanlara da gider.
    await publishRealtime({
      tenantId: hit.tenant_id,
      event,
      ticketId: hit.id,
      ...(hit.watchers.length ? { userIds: hit.watchers } : {}),
      payload: {
        ticketId: hit.id,
        reference: hit.reference,
        title: hit.title,
        priority: hit.priority,
        window,
        dueAt: hit.due_at,
        state: transition,
      },
    });

    // 2) E-posta kuyruğu — geciken/gecikmek uzere olan isler icin.
    await enqueueNotification(
      {
        kind: transition === 'breached' ? 'sla_breached' : 'sla_at_risk',
        tenantId: hit.tenant_id,
        ticketId: hit.id,
        reference: hit.reference,
        title: hit.title,
        priority: hit.priority,
        dueAt: hit.due_at.toISOString(),
        recipients: hit.recipients,
      },
      `${transition}:${window}:${hit.id}`,
    );
  }

  if (hits.length) {
    queueLogger.info({ window, transition, count: hits.length }, 'SLA durum degisimi islendi');
  }
  return hits.length;
}

export interface ScanSummary {
  responseBreached: number;
  responseAtRisk: number;
  resolutionBreached: number;
  resolutionAtRisk: number;
  durationMs: number;
}

export async function runSlaScan(): Promise<ScanSummary> {
  const startedAt = Date.now();

  // Once ihlaller, sonra riskler: bir bilet ayni turda iki kez isaretlenmez.
  const resolutionBreached = await runPass('resolution', 'breached');
  const responseBreached = await runPass('response', 'breached');
  const resolutionAtRisk = await runPass('resolution', 'at_risk');
  const responseAtRisk = await runPass('response', 'at_risk');

  return {
    responseBreached,
    responseAtRisk,
    resolutionBreached,
    resolutionAtRisk,
    durationMs: Date.now() - startedAt,
  };
}
