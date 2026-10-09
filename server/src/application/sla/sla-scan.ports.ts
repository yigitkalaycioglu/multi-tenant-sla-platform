import type { TicketPriority } from '../../domain/tickets/ticket.js';

export type SlaWindow = 'response' | 'resolution';
export type SlaTransition = 'breached' | 'at_risk';

/** Taramada durumu degisen bir bilet ve bildirim alacak kisiler. */
export interface SlaTransitionHit {
  ticketId: string;
  tenantId: string;
  reference: string;
  title: string;
  priority: TicketPriority;
  dueAt: Date;
  /** E-posta alicilari: atanan kisi, ekip lideri (ihlalde ayrica adminler). */
  emailRecipients: string[];
  /** Canli bildirim alacak kullanici kimlikleri. */
  watcherIds: string[];
}

/**
 * Kiracilar arasi SLA taramasi. Sistem baglantisiyla calisir; HTTP istek
 * yolunda kullanilmaz.
 */
export interface SlaScanRepository {
  /**
   * Kosulu saglayan biletleri isaretler ve dondurur. Durum degisimi ile
   * "bildirildi" isareti tek atomik adimdir: ayni bilet ikinci kez donmez,
   * eszamanli calisan diger worker'lar ayni bileti almaz.
   */
  markTransitions(window: SlaWindow, transition: SlaTransition, riskThreshold: number): Promise<SlaTransitionHit[]>;
}
