/**
 * SLA motoru - saf (yan etkisiz) hesaplama fonksiyonlari.
 *
 * Buradaki her sey deterministik: `now` disaridan verilir. Bu sayede hem
 * worker hem API ayni matematigi kullanir ve birim testlerle dogrulanabilir.
 *
 * Duraklatma (on_hold) modeli:
 *   Bilet beklemeye alindiginda `paused_at` set edilir ve SLA saati durur.
 *   Devam edildiginde gecen sure `paused_total_seconds`'a eklenir ve
 *   `*_due_at` alanlari ayni kadar ileri kaydirilir. Boylece hedef tarihler
 *   her zaman "gercek" son tarihi gosterir ve indeksli sorgular basit kalir.
 */
import type { SlaState, SlaTargets } from './sla-policy.js';

export const MINUTE_MS = 60_000;

export interface SlaWindowInput {
  /** Biletin acildigi an. */
  createdAt: Date;
  /** Hedef tarih (duraklatma kaydirmalari uygulanmis hali). */
  dueAt: Date | null;
  /** Hedef karsilandiysa gerceklesme ani (ilk yanit / cozum). */
  completedAt?: Date | null;
  /** Bilet su an beklemedeyse duraklatma ani. */
  pausedAt?: Date | null;
  /** Bugune kadar toplam duraklatma suresi (saniye). */
  pausedTotalSeconds?: number;
  /** Referans an. */
  now: Date;
  /** Bu orana ulasildiginda "risk altinda" sayilir (varsayilan %80). */
  riskThreshold?: number;
}

export interface SlaWindowResult {
  state: SlaState;
  /** 0..1+ arasi tuketilen SLA orani. */
  consumedRatio: number;
  /** Hedefe kalan sure (ms). Negatifse asilmis demektir. */
  remainingMs: number;
  /** Toplam SLA penceresi (ms, duraklatmalar haric). */
  windowMs: number;
}

/** Hedef tarihleri politikadan uretir. */
export function computeDueDates(
  createdAt: Date,
  targets: SlaTargets,
): { responseDueAt: Date; resolutionDueAt: Date } {
  return {
    responseDueAt: new Date(createdAt.getTime() + targets.responseMinutes * MINUTE_MS),
    resolutionDueAt: new Date(createdAt.getTime() + targets.resolutionMinutes * MINUTE_MS),
  };
}

/**
 * Tek bir SLA penceresinin (yanit ya da cozum) anlik durumunu hesaplar.
 */
export function evaluateSlaWindow(input: SlaWindowInput): SlaWindowResult {
  const {
    createdAt,
    dueAt,
    completedAt = null,
    pausedAt = null,
    pausedTotalSeconds = 0,
    now,
    riskThreshold = 0.8,
  } = input;

  if (!dueAt) {
    return { state: 'on_track', consumedRatio: 0, remainingMs: Number.POSITIVE_INFINITY, windowMs: 0 };
  }

  const pausedMs = Math.max(0, pausedTotalSeconds) * 1000;
  // dueAt zaten duraklatmalar kadar ileri kaydirilmis oldugu icin, orijinal
  // pencereye donmek adina toplam duraklatmayi cikariyoruz.
  const windowMs = Math.max(1, dueAt.getTime() - createdAt.getTime() - pausedMs);

  if (completedAt) {
    const consumed = Math.max(0, completedAt.getTime() - createdAt.getTime() - pausedMs);
    return {
      state: completedAt.getTime() <= dueAt.getTime() ? 'met' : 'breached',
      consumedRatio: consumed / windowMs,
      remainingMs: dueAt.getTime() - completedAt.getTime(),
      windowMs,
    };
  }

  // Beklemedeyken saat durur: referans an duraklatma anidir.
  const effectiveNow = pausedAt ? pausedAt.getTime() : now.getTime();
  const elapsedMs = Math.max(0, effectiveNow - createdAt.getTime() - pausedMs);
  const consumedRatio = elapsedMs / windowMs;
  const remainingMs = dueAt.getTime() - effectiveNow;

  let state: SlaState = 'on_track';
  if (remainingMs <= 0) state = 'breached';
  else if (consumedRatio >= riskThreshold) state = 'at_risk';

  return { state, consumedRatio, remainingMs, windowMs };
}

/**
 * Beklemeden cikarken hedef tarihleri, beklemede gecen sure kadar ileri kaydirir.
 */
export function resumeFromHold(params: {
  pausedAt: Date;
  now: Date;
  pausedTotalSeconds: number;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstResponseAt: Date | null;
}): {
  pausedTotalSeconds: number;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  heldSeconds: number;
} {
  const heldMs = Math.max(0, params.now.getTime() - params.pausedAt.getTime());
  const heldSeconds = Math.round(heldMs / 1000);

  return {
    pausedTotalSeconds: params.pausedTotalSeconds + heldSeconds,
    // Ilk yanit verilmisse yanit SLA'si zaten kapanmistir, kaydirmaya gerek yok.
    responseDueAt:
      params.firstResponseAt || !params.responseDueAt
        ? params.responseDueAt
        : new Date(params.responseDueAt.getTime() + heldMs),
    resolutionDueAt: params.resolutionDueAt ? new Date(params.resolutionDueAt.getTime() + heldMs) : null,
    heldSeconds,
  };
}

/** Insan okunur geri sayim: "2s 15dk kaldi" / "1s 5dk gecti". */
export function formatRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return '-';
  const overdue = remainingMs < 0;
  const total = Math.abs(remainingMs);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);

  const parts: string[] = [];
  if (days) parts.push(`${days}g`);
  if (hours || days) parts.push(`${hours}s`);
  parts.push(`${minutes}dk`);

  return `${parts.join(' ')} ${overdue ? 'gecti' : 'kaldi'}`;
}
