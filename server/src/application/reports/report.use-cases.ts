import type { AuthUser } from '../../domain/identity.js';
import { ticketVisibilityFor } from '../../domain/tickets/ticket-access.js';
import type { TenantTransactions } from '../ports/transactions.js';

export interface ReportDeps {
  tx: TenantTransactions;
}

const roundOrNull = (v: number | null): number | null => (v === null ? null : Math.round(v));

export function makeReportUseCases({ tx }: ReportDeps) {
  return {
    /**
     * Yonetim paneli ozeti.
     *
     * Tum sorgular ayni kiraci transaction'inda ve kullanicinin rol kapsaminda
     * calisir: bir gelistirici yalnizca kendi/ekibinin biletlerinin istatistigini
     * gorur, admin ise kiracinin tamamini.
     */
    async overview(actor: AuthUser, days: number) {
      const visibility = ticketVisibilityFor(actor);
      const stats = await tx.run(actor.tenantId, ({ reports }) => reports.overview(visibility, days));

      const s = stats.summary;
      const sealedTotal = s.sealedMet + s.sealedBreached;

      return {
        totals: {
          total: s.total,
          open: s.open,
          inProgress: s.inProgress,
          onHold: s.onHold,
          resolved: s.resolved,
          closed: s.closed,
          activeTotal: s.open + s.inProgress + s.onHold,
        },
        sla: {
          openBreached: s.openBreached,
          openAtRisk: s.openAtRisk,
          met: s.sealedMet,
          breached: s.sealedBreached,
          /** Kapanmis biletlerde SLA'ya uyum orani (0-1). */
          complianceRate: sealedTotal ? s.sealedMet / sealedTotal : null,
        },
        averages: {
          resolutionMinutes: roundOrNull(s.avgResolutionMinutes),
          firstResponseMinutes: roundOrNull(s.avgFirstResponseMinutes),
        },
        byPriority: stats.byPriority,
        trend: stats.trend.map((r) => ({
          date: r.day.toISOString().slice(0, 10),
          created: r.created,
          resolved: r.resolved,
        })),
        teamWorkload: stats.teamWorkload.map((r) => ({
          teamId: r.teamId,
          teamName: r.teamName ?? 'Atanmamis',
          open: r.open,
          breached: r.breached,
        })),
        topAssignees: stats.topAssignees,
        scope: visibility.scope === 'tenant' ? 'tenant' : 'personal',
        days,
      };
    },
  };
}

export type ReportUseCases = ReturnType<typeof makeReportUseCases>;
