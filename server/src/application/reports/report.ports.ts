import type { TicketVisibility } from '../../domain/tickets/ticket-access.js';
import type { TicketPriority } from '../../domain/tickets/ticket.js';

/** Yonetim paneli icin ham sayaclar; turetilmis oranlari use case hesaplar. */
export interface OverviewStats {
  summary: {
    total: number;
    open: number;
    inProgress: number;
    onHold: number;
    resolved: number;
    closed: number;
    openBreached: number;
    openAtRisk: number;
    sealedMet: number;
    sealedBreached: number;
    avgResolutionMinutes: number | null;
    avgFirstResponseMinutes: number | null;
  };
  byPriority: Array<{ priority: TicketPriority; total: number; open: number; breached: number }>;
  /** Son `days` gun; bos gunler 0 ile doldurulmus. */
  trend: Array<{ day: Date; created: number; resolved: number }>;
  teamWorkload: Array<{ teamId: string | null; teamName: string | null; open: number; breached: number }>;
  topAssignees: Array<{ userId: string; name: string; open: number; breached: number }>;
}

export interface ReportRepository {
  overview(visibility: TicketVisibility, days: number): Promise<OverviewStats>;
}
