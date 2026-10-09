/**
 * Bilet yasam dongusu: durum, oncelik ve ilk yanit degisikliklerinin SLA'ya etkisi.
 *
 * Her fonksiyon mevcut bileti alir ve uygulanacak degisiklikleri (TicketChanges)
 * dondurur; hicbir sey yazmaz, `now` disaridan gelir. Boylece en hassas is
 * kurallari veritabani olmadan, saniye hassasiyetinde test edilebilir.
 */
import { invalid } from '../errors.js';
import { MINUTE_MS, resumeFromHold } from '../sla/sla-engine.js';
import { sealedState, type SlaPolicy } from '../sla/sla-policy.js';
import {
  OPEN_STATUSES,
  STATUS_TRANSITIONS,
  type Ticket,
  type TicketChanges,
  type TicketPriority,
  type TicketStatus,
} from './ticket.js';

/**
 * Durum gecisini dogrular ve SLA saatine etkisini hesaplar.
 *  - on_hold  : saat durur (pausedAt)
 *  - devam    : beklenen sure kadar hedefler ileri kaydirilir
 *  - resolved : cozum SLA'si "met" ya da "breached" olarak muhurlenir
 *  - reopen   : cozum alanlari temizlenir, saat yeniden isler
 */
export function changeStatus(ticket: Ticket, next: TicketStatus, now: Date): TicketChanges {
  if (!STATUS_TRANSITIONS[ticket.status].includes(next)) {
    throw invalid(`"${ticket.status}" durumundan "${next}" durumuna gecilemez`);
  }

  const changes: TicketChanges = { status: next };

  // Beklemeden cikis
  if (ticket.pausedAt && next !== 'on_hold') {
    const resumed = resumeFromHold({
      pausedAt: ticket.pausedAt,
      now,
      pausedTotalSeconds: ticket.pausedTotalSeconds,
      responseDueAt: ticket.responseDueAt,
      resolutionDueAt: ticket.resolutionDueAt,
      firstResponseAt: ticket.firstResponseAt,
    });
    changes.pausedAt = null;
    changes.pausedTotalSeconds = resumed.pausedTotalSeconds;
    changes.responseDueAt = resumed.responseDueAt;
    changes.resolutionDueAt = resumed.resolutionDueAt;
  }

  if (next === 'on_hold') {
    changes.pausedAt = now;
  }

  if (next === 'resolved' || next === 'closed') {
    changes.resolvedAt = now;
    if (next === 'closed') changes.closedAt = now;

    // Cozum an itibariyle muhurlenir.
    changes.resolutionSlaState = sealedState(ticket.resolutionDueAt, now);

    // Cozum, ayni zamanda ilk yanit sayilir.
    if (!ticket.firstResponseAt) {
      changes.firstResponseAt = now;
      changes.responseSlaState = sealedState(ticket.responseDueAt, now);
    }
  }

  // Yeniden acma
  if (OPEN_STATUSES.includes(next)) {
    changes.resolvedAt = null;
    changes.closedAt = null;
    changes.resolutionSlaState = 'on_track';
    changes.breachNotifiedAt = null;
    changes.riskNotifiedAt = null;
  }

  return changes;
}

/**
 * Oncelik degisimi: SLA hedefleri yeni politikaya gore yeniden hesaplanir.
 *
 * `ticket`, ayni istekteki durum degisikligi UYGULANMIS hali olmalidir; boylece
 * guncel bekleme suresini ve ilk yanit bilgisini baz alir.
 */
export function changePriority(ticket: Ticket, next: TicketPriority, policy: SlaPolicy | null): TicketChanges {
  const changes: TicketChanges = { priority: next };
  if (!policy) return changes;

  // Yeni hedefler acilis anindan hesaplanir; beklemede gecen sure eklenir.
  const pausedMs = ticket.pausedTotalSeconds * 1000;
  changes.slaPolicyId = policy.id;
  changes.responseDueAt = new Date(ticket.createdAt.getTime() + policy.responseMinutes * MINUTE_MS + pausedMs);
  changes.resolutionDueAt = new Date(ticket.createdAt.getTime() + policy.resolutionMinutes * MINUTE_MS + pausedMs);

  // Bilet hala acikken durumlar sifirlanir ki tarayici yeniden degerlendirsin.
  // Cozulmus bilette muhurlenen SLA sonucuna dokunulmaz.
  if (OPEN_STATUSES.includes(ticket.status)) {
    changes.responseSlaState = ticket.firstResponseAt ? 'met' : 'on_track';
    changes.resolutionSlaState = 'on_track';
    changes.riskNotifiedAt = null;
    changes.breachNotifiedAt = null;
  }

  return changes;
}

/**
 * Ilk yanit SLA'si: bileti acan disindaki biri, dahili olmayan bir yorum
 * yazdiginda "ilk yanit verildi" sayilir. Yanit sayilmiyorsa null doner.
 */
export function registerFirstResponse(
  ticket: Ticket,
  comment: { authorId: string; isInternal: boolean },
  at: Date,
): TicketChanges | null {
  if (ticket.firstResponseAt || comment.isInternal || ticket.reporterId === comment.authorId) return null;
  return { firstResponseAt: at, responseSlaState: sealedState(ticket.responseDueAt, at) };
}
