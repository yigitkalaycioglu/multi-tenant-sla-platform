import type { TicketVisibility } from '../../../domain/tickets/ticket-access.js';

/**
 * Domain'deki gorunurluk kuralini (`ticketVisibilityFor`) `tickets t` takma
 * adli sorgular icin WHERE kosuluna cevirir. Parametreleri `params` dizisinin
 * sonuna ekler; numaralandirma onceki parametrelerin arkasindan devam eder.
 */
export function visibilitySql(visibility: TicketVisibility, params: unknown[]): string {
  if (visibility.scope === 'tenant') return 'TRUE';

  params.push(visibility.userId);
  const userIdx = params.length;

  if (visibility.teamId) {
    params.push(visibility.teamId);
    return `(t.assignee_id = $${userIdx} OR t.reporter_id = $${userIdx} OR t.team_id = $${params.length})`;
  }
  return `(t.assignee_id = $${userIdx} OR t.reporter_id = $${userIdx})`;
}

/** Onceligi ciddiyet sirasina gore siralar (enum alfabetik siralanmasin diye). */
export const PRIORITY_RANK_SQL = (column: string): string =>
  `CASE ${column} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
