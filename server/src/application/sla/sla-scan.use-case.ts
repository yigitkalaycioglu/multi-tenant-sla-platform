/**
 * SLA tarayicisi — worker surecinde periyodik olarak calisir.
 *
 * Her tarama iki tur gecis yapar: once hedefi asmis biletler `breached`,
 * sonra esige (varsayilan %80) gelmis biletler `at_risk` yapilir. Duraklatilmis
 * (on_hold) biletler disarida birakilir. Isaretleme atomiktir (bkz. port);
 * canli olay ve e-posta, isaretleme commit edildikten sonra uretilir.
 */
import type { NotificationQueue, RealtimePublisher } from '../ports/events.js';
import type { Clock, Logger } from '../ports/runtime.js';
import type { SlaScanRepository, SlaTransition, SlaWindow } from './sla-scan.ports.js';

export interface SlaScanDeps {
  scanner: SlaScanRepository;
  realtime: RealtimePublisher;
  notifications: NotificationQueue;
  clock: Clock;
  log: Logger;
  riskThreshold: number;
}

export interface ScanSummary {
  responseBreached: number;
  responseAtRisk: number;
  resolutionBreached: number;
  resolutionAtRisk: number;
  durationMs: number;
}

export function makeRunSlaScan({ scanner, realtime, notifications, clock, log, riskThreshold }: SlaScanDeps) {
  async function runPass(window: SlaWindow, transition: SlaTransition): Promise<number> {
    const hits = await scanner.markTransitions(window, transition, riskThreshold);

    for (const hit of hits) {
      // 1) Canli bildirim — ilgili kisilerin (atanan, ekip lideri, admin)
      //    panelinde aninda gorunur; bilet detayi acik olanlara da gider.
      await realtime.publish({
        tenantId: hit.tenantId,
        event: transition === 'breached' ? 'sla:breached' : 'sla:at_risk',
        ticketId: hit.ticketId,
        ...(hit.watcherIds.length ? { userIds: hit.watcherIds } : {}),
        payload: {
          ticketId: hit.ticketId,
          reference: hit.reference,
          title: hit.title,
          priority: hit.priority,
          window,
          dueAt: hit.dueAt,
          state: transition,
        },
      });

      // 2) E-posta kuyrugu — geciken/gecikmek uzere olan isler icin.
      await notifications.enqueue(
        {
          kind: transition === 'breached' ? 'sla_breached' : 'sla_at_risk',
          tenantId: hit.tenantId,
          ticketId: hit.ticketId,
          reference: hit.reference,
          title: hit.title,
          priority: hit.priority,
          dueAt: hit.dueAt.toISOString(),
          recipients: hit.emailRecipients,
        },
        `${transition}:${window}:${hit.ticketId}`,
      );
    }

    if (hits.length) log.info({ window, transition, count: hits.length }, 'SLA durum degisimi islendi');
    return hits.length;
  }

  return async function runSlaScan(): Promise<ScanSummary> {
    const startedAt = clock.now().getTime();

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
      durationMs: clock.now().getTime() - startedAt,
    };
  };
}
