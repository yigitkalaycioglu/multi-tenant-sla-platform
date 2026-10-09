import { formatRemaining } from '../../domain/sla/sla-engine.js';
import type { NotificationJob } from '../ports/events.js';
import type { Clock, Logger } from '../ports/runtime.js';
import { renderTicketMail } from './mail-template.js';
import type { EmailLog, MailSender } from './notification.ports.js';

export interface NotificationDeps {
  mailer: MailSender;
  emailLog: EmailLog;
  clock: Clock;
  log: Logger;
  /** E-postadaki "Bileti ac" baglantisinin koku. */
  appUrl: string;
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Dusuk',
  medium: 'Orta',
  high: 'Yuksek',
  urgent: 'Acil',
};

const ACCENTS = {
  sla_breached: '#dc2626',
  sla_at_risk: '#d97706',
  ticket_assigned: '#2563eb',
} as const;

const COPY = {
  sla_breached: {
    subject: '[SLA ASILDI]',
    heading: 'SLA suresi asildi',
    intro: 'Asagidaki bilet hedef suresini gecti. Lutfen en kisa surede aksiyon alin.',
  },
  sla_at_risk: {
    subject: '[SLA RISKI]',
    heading: 'SLA suresi dolmak uzere',
    intro: 'Bu bilet SLA suresinin son dilimine girdi.',
  },
  ticket_assigned: {
    subject: '[YENI ATAMA]',
    heading: 'Size yeni bir bilet atandi',
    intro: 'Asagidaki bilet uzerinizde. SLA saati islemeye devam ediyor.',
  },
} as const;

export function composeNotificationMail(job: NotificationJob, now: Date, appUrl: string) {
  const dueAt = new Date(job.dueAt);
  const dueLabel = `${dueAt.toLocaleString('tr-TR')} (${formatRemaining(dueAt.getTime() - now.getTime())})`;
  const copy = COPY[job.kind];

  const { html, text } = renderTicketMail({
    heading: copy.heading,
    intro: copy.intro,
    reference: job.reference,
    title: job.title,
    priority: PRIORITY_LABELS[job.priority] ?? job.priority,
    dueAt: dueLabel,
    accent: ACCENTS[job.kind],
    ctaUrl: `${appUrl}/tickets/${job.ticketId}`,
  });

  return { subject: `${copy.subject} ${job.reference} — ${job.title}`, html, text };
}

/**
 * Bildirimi her aliciya gonderir ve sonucu e-posta kaydina yazar.
 * Bir gonderim basarisiz olursa hata yukari tasinir; kuyruk isi yeniden dener.
 */
export function makeDeliverNotification({ mailer, emailLog, clock, log, appUrl }: NotificationDeps) {
  const mailLog = log.child({ module: 'mailer' });

  return async function deliverNotification(job: NotificationJob): Promise<{ sent: number }> {
    const { subject, html, text } = composeNotificationMail(job, clock.now(), appUrl);

    let sent = 0;
    for (const recipient of job.recipients) {
      const logId = await emailLog.create({
        tenantId: job.tenantId,
        ticketId: job.ticketId,
        kind: job.kind,
        recipient,
        subject,
      });

      try {
        const info = await mailer.send({ to: recipient, subject, html, text });
        await emailLog.markSent(logId);
        mailLog.info({ to: recipient, kind: job.kind, messageId: info.messageId }, 'E-posta gonderildi');
      } catch (err) {
        await emailLog.markFailed(logId, err instanceof Error ? err.message : String(err));
        mailLog.error({ err, to: recipient, kind: job.kind }, 'E-posta gonderilemedi');
        throw err;
      }
      sent += 1;
    }
    return { sent };
  };
}
