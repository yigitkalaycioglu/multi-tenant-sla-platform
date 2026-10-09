import type { ReportRepository } from '../../../application/reports/report.ports.js';
import type { TicketPriority } from '../../../domain/tickets/ticket.js';
import type { Queryable } from '../pool.js';
import { PRIORITY_RANK_SQL, visibilitySql } from './ticket-visibility.sql.js';

export function createReportRepository(db: Queryable): ReportRepository {
  return {
    async overview(visibility, days) {
      const params: unknown[] = [];
      const scope = visibilitySql(visibility, params);

      // --- 1) Durum / SLA sayaclari ve ortalamalar ----------------------------
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

      // --- 2) Oncelik dagilimi --------------------------------------------------
      const byPriority = await db.query<{ priority: TicketPriority; total: number; open: number; breached: number }>(
        `SELECT t.priority,
                COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed'))::bigint AS open,
                COUNT(*) FILTER (WHERE t.resolution_sla_state = 'breached')::bigint    AS breached
           FROM tickets t
          WHERE ${scope}
          GROUP BY t.priority
          ORDER BY ${PRIORITY_RANK_SQL('t.priority')}`,
        params,
      );

      // --- 3) Gunluk trend (bos gunler 0 olarak doldurulur) --------------------
      const trendParams = [...params, days];
      const daysIdx = trendParams.length;
      const trend = await db.query<{ day: Date; created: number; resolved: number }>(
        `WITH span AS (
           SELECT generate_series(
                    date_trunc('day', now()) - make_interval(days => $${daysIdx}::int - 1),
                    date_trunc('day', now()),
                    interval '1 day'
                  ) AS day
         ),
         created AS (
           SELECT date_trunc('day', t.created_at) AS day, COUNT(*)::bigint AS n
             FROM tickets t
            WHERE ${scope}
              AND t.created_at >= date_trunc('day', now()) - make_interval(days => $${daysIdx}::int - 1)
            GROUP BY 1
         ),
         resolved AS (
           SELECT date_trunc('day', t.resolved_at) AS day, COUNT(*)::bigint AS n
             FROM tickets t
            WHERE ${scope}
              AND t.resolved_at >= date_trunc('day', now()) - make_interval(days => $${daysIdx}::int - 1)
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

      // --- 4) Ekip yuku -----------------------------------------------------------
      const teams = await db.query<{ team_id: string | null; team_name: string | null; open: number; breached: number }>(
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

      // --- 5) En cok yuklu kisiler -----------------------------------------------
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
      return {
        summary: {
          total: s.total,
          open: s.open,
          inProgress: s.in_progress,
          onHold: s.on_hold,
          resolved: s.resolved,
          closed: s.closed,
          openBreached: s.open_breached,
          openAtRisk: s.open_at_risk,
          sealedMet: s.sealed_met,
          sealedBreached: s.sealed_breached,
          avgResolutionMinutes: s.avg_resolution_minutes,
          avgFirstResponseMinutes: s.avg_first_response_minutes,
        },
        byPriority: byPriority.rows.map((r) => ({
          priority: r.priority,
          total: r.total,
          open: r.open,
          breached: r.breached,
        })),
        trend: trend.rows,
        teamWorkload: teams.rows.map((r) => ({
          teamId: r.team_id,
          teamName: r.team_name,
          open: r.open,
          breached: r.breached,
        })),
        topAssignees: assignees.rows.map((r) => ({
          userId: r.user_id,
          name: r.name,
          open: r.open,
          breached: r.breached,
        })),
      };
    },
  };
}
