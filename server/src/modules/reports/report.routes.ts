import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../../db/pool.js';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import { parseOrThrow } from '../../lib/validate.js';
import { scopeClause } from '../tickets/ticket.service.js';
import type { TicketPriority } from '../../types/domain.js';

const querySchema = z.object({
  /** Trend ve ortalama hesaplarinin bakacagi gun sayisi. */
  days: z.coerce.number().int().min(7).max(90).default(14),
});

export const reportRouter: Router = Router();
reportRouter.use(requireAuth);

/**
 * Yonetim paneli ozeti.
 *
 * Tum sorgular ayni kiraci transaction'inda ve kullanicinin rol kapsaminda
 * calisir: bir gelistirici yalnizca kendi/ekibinin biletlerinin istatistigini
 * gorur, admin ise kiracinin tamamini.
 */
reportRouter.get('/overview', async (req, res) => {
  const auth = getAuth(req);
  const { days } = parseOrThrow(querySchema, req.query, 'Rapor filtresi');

  const data = await withTenant(auth.tenantId, async (db) => {
    const params: unknown[] = [];
    const scope = scopeClause(auth, params);

    // --- 1) Durum / SLA sayaclari ve ortalamalar --------------------------
    const summary = await db.query<{
      total: number;
      open: number;
      in_progress: number;
      on_hold: number;
      resolved: number;
      closed: number;
      open_breached: number;
      open_at_risk: number;
      sealed_met: number;
      sealed_breached: number;
      avg_resolution_minutes: number | null;
      avg_first_response_minutes: number | null;
    }>(
      `SELECT
         COUNT(*)::bigint                                                              AS total,
         COUNT(*) FILTER (WHERE t.status = 'open')::bigint                             AS open,
         COUNT(*) FILTER (WHERE t.status = 'in_progress')::bigint                      AS in_progress,
         COUNT(*) FILTER (WHERE t.status = 'on_hold')::bigint                          AS on_hold,
         COUNT(*) FILTER (WHERE t.status = 'resolved')::bigint                         AS resolved,
         COUNT(*) FILTER (WHERE t.status = 'closed')::bigint                           AS closed,
         COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')
                            AND t.resolution_sla_state = 'breached')::bigint           AS open_breached,
         COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')
                            AND t.resolution_sla_state = 'at_risk')::bigint            AS open_at_risk,
         COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL
                            AND t.resolution_sla_state = 'met')::bigint                AS sealed_met,
         COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL
                            AND t.resolution_sla_state = 'breached')::bigint           AS sealed_breached,
         AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60)
           FILTER (WHERE t.resolved_at IS NOT NULL)                                    AS avg_resolution_minutes,
         AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60)
           FILTER (WHERE t.first_response_at IS NOT NULL)                              AS avg_first_response_minutes
       FROM tickets t
       WHERE ${scope}`,
      params,
    );

    // --- 2) Oncelik dagilimi ----------------------------------------------
    const byPriority = await db.query<{
      priority: TicketPriority;
      total: number;
      open: number;
      breached: number;
    }>(
      `SELECT t.priority,
              COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed'))::bigint AS open,
              COUNT(*) FILTER (WHERE t.resolution_sla_state = 'breached')::bigint    AS breached
         FROM tickets t
        WHERE ${scope}
        GROUP BY t.priority
        ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      params,
    );

    // --- 3) Gunluk trend (bos gunler 0 olarak doldurulur) ------------------
    const trendParams = [...params, days];
    const trend = await db.query<{ day: Date; created: number; resolved: number }>(
      `WITH span AS (
         SELECT generate_series(
                  date_trunc('day', now()) - make_interval(days => $${trendParams.length}::int - 1),
                  date_trunc('day', now()),
                  interval '1 day'
                ) AS day
       ),
       created AS (
         SELECT date_trunc('day', t.created_at) AS day, COUNT(*)::bigint AS n
           FROM tickets t
          WHERE ${scope}
            AND t.created_at >= date_trunc('day', now()) - make_interval(days => $${trendParams.length}::int - 1)
          GROUP BY 1
       ),
       resolved AS (
         SELECT date_trunc('day', t.resolved_at) AS day, COUNT(*)::bigint AS n
           FROM tickets t
          WHERE ${scope}
            AND t.resolved_at >= date_trunc('day', now()) - make_interval(days => $${trendParams.length}::int - 1)
          GROUP BY 1
       )
       SELECT s.day,
              COALESCE(c.n, 0)::bigint AS created,
              COALESCE(r.n, 0)::bigint AS resolved
         FROM span s
         LEFT JOIN created  c ON c.day = s.day
         LEFT JOIN resolved r ON r.day = s.day
        ORDER BY s.day`,
      trendParams,
    );

    // --- 4) Ekip yuku -------------------------------------------------------
    const teams = await db.query<{
      team_id: string | null;
      team_name: string | null;
      open: number;
      breached: number;
    }>(
      `SELECT t.team_id, tm.name AS team_name,
              COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed'))::bigint AS open,
              COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')
                                 AND t.resolution_sla_state = 'breached')::bigint   AS breached
         FROM tickets t
         LEFT JOIN teams tm ON tm.id = t.team_id
        WHERE ${scope}
        GROUP BY t.team_id, tm.name
        HAVING COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')) > 0
        ORDER BY open DESC
        LIMIT 8`,
      params,
    );

    // --- 5) En cok yuklu kisiler -------------------------------------------
    const assignees = await db.query<{ user_id: string; name: string; open: number; breached: number }>(
      `SELECT t.assignee_id AS user_id, u.full_name AS name,
              COUNT(*)::bigint AS open,
              COUNT(*) FILTER (WHERE t.resolution_sla_state = 'breached')::bigint AS breached
         FROM tickets t
         JOIN users u ON u.id = t.assignee_id
        WHERE ${scope} AND t.status NOT IN ('resolved','closed')
        GROUP BY t.assignee_id, u.full_name
        ORDER BY open DESC
        LIMIT 8`,
      params,
    );

    const s = summary.rows[0]!;
    const sealedTotal = s.sealed_met + s.sealed_breached;

    return {
      totals: {
        total: s.total,
        open: s.open,
        inProgress: s.in_progress,
        onHold: s.on_hold,
        resolved: s.resolved,
        closed: s.closed,
        activeTotal: s.open + s.in_progress + s.on_hold,
      },
      sla: {
        openBreached: s.open_breached,
        openAtRisk: s.open_at_risk,
        met: s.sealed_met,
        breached: s.sealed_breached,
        /** Kapanmis biletlerde SLA'ya uyum orani (0-1). */
        complianceRate: sealedTotal ? s.sealed_met / sealedTotal : null,
      },
      averages: {
        resolutionMinutes: s.avg_resolution_minutes === null ? null : Math.round(s.avg_resolution_minutes),
        firstResponseMinutes:
          s.avg_first_response_minutes === null ? null : Math.round(s.avg_first_response_minutes),
      },
      byPriority: byPriority.rows.map((r) => ({
        priority: r.priority,
        total: r.total,
        open: r.open,
        breached: r.breached,
      })),
      trend: trend.rows.map((r) => ({
        date: r.day.toISOString().slice(0, 10),
        created: r.created,
        resolved: r.resolved,
      })),
      teamWorkload: teams.rows.map((r) => ({
        teamId: r.team_id,
        teamName: r.team_name ?? 'Atanmamis',
        open: r.open,
        breached: r.breached,
      })),
      topAssignees: assignees.rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        open: r.open,
        breached: r.breached,
      })),
      scope: auth.role === 'admin' ? 'tenant' : 'personal',
      days,
    };
  });

  res.json(data);
});
