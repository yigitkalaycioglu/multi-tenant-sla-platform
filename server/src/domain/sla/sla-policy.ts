import type { TicketPriority } from '../tickets/ticket.js';
import { invalid } from '../errors.js';

export const SLA_STATES = ['on_track', 'at_risk', 'breached', 'met'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** Bir oncelik icin yanit ve cozum hedefleri (dakika). */
export interface SlaTargets {
  responseMinutes: number;
  resolutionMinutes: number;
}

export interface SlaPolicy extends SlaTargets {
  id: string;
  priority: TicketPriority;
}

/** Yeni kiracilar icin makul baslangic SLA hedefleri. */
export const DEFAULT_SLA_POLICIES: ReadonlyArray<SlaTargets & { priority: TicketPriority }> = [
  { priority: 'urgent', responseMinutes: 15, resolutionMinutes: 240 },
  { priority: 'high', responseMinutes: 60, resolutionMinutes: 480 },
  { priority: 'medium', responseMinutes: 240, resolutionMinutes: 1440 },
  { priority: 'low', responseMinutes: 480, resolutionMinutes: 4320 },
];

export function assertValidTargets(targets: SlaTargets): void {
  if (targets.resolutionMinutes < targets.responseMinutes) {
    throw invalid('Cozum suresi, yanit suresinden kisa olamaz');
  }
}

/** Tamamlanan bir pencerenin sonucu: hedefe gore zamaninda mi, gec mi? */
export function sealedState(dueAt: Date | null, completedAt: Date): SlaState {
  return dueAt && completedAt.getTime() > dueAt.getTime() ? 'breached' : 'met';
}
