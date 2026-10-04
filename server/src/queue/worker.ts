/**
 * Arka plan worker sureci.
 *
 * Iki isi vardir:
 *   1. `sla-scan`      — dakikada bir tum kiracilarin SLA saatlerini tarar.
 *   2. `notifications` — geciken/riskli isler ve atamalar icin e-posta gonderir.
 *
 * API'den ayri bir konteyner olarak calisir; boylece yogun e-posta trafigi
 * HTTP yanit surelerini etkilemez ve worker bagimsiz olceklenebilir.
 */
import { Worker, type Job } from 'bullmq';
import { createRedis } from '../lib/redis.js';
import { queueLogger } from '../lib/logger.js';
import { closePools } from '../db/pool.js';
import { renderTicketMail, sendMail } from '../lib/mailer.js';
import { runSlaScan } from '../modules/sla/sla.scanner.js';
import { QUEUE_NAMES, closeQueues, scheduleSlaScan, type NotificationJob } from './index.js';
import { formatRemaining } from '../modules/sla/sla.engine.js';

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

const APP_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:5173';

function buildMail(job: NotificationJob) {
  const dueAt = new Date(job.dueAt);
  const dueLabel = `${dueAt.toLocaleString('tr-TR')} (${formatRemaining(dueAt.getTime() - Date.now())})`;
  const priority = PRIORITY_LABELS[job.priority] ?? job.priority;

  const copy = {
    sla_breached: {
      subject: `[SLA ASILDI] ${job.reference} — ${job.title}`,
      heading: 'SLA suresi asildi',
      intro: 'Asagidaki bilet hedef suresini gecti. Lutfen en kisa surede aksiyon alin.',
    },
    sla_at_risk: {
      subject: `[SLA RISKI] ${job.reference} — ${job.title}`,
      heading: 'SLA suresi dolmak uzere',
      intro: 'Bu bilet SLA suresinin son dilimine girdi.',
    },
    ticket_assigned: {
      subject: `[YENI ATAMA] ${job.reference} — ${job.title}`,
      heading: 'Size yeni bir bilet atandi',
      intro: 'Asagidaki bilet uzerinizde. SLA saati islemeye devam ediyor.',
    },
  }[job.kind];

  const { html, text } = renderTicketMail({
    heading: copy.heading,
    intro: copy.intro,
    reference: job.reference,
    title: job.title,
    priority,
    dueAt: dueLabel,
    accent: ACCENTS[job.kind],
    ctaUrl: `${APP_URL}/tickets/${job.ticketId}`,
  });

  return { subject: copy.subject, html, text };
}

async function processNotification(job: Job<NotificationJob>): Promise<{ sent: number }> {
  const data = job.data;
  const { subject, html, text } = buildMail(data);

  let sent = 0;
  for (const recipient of data.recipients) {
    await sendMail({
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      kind: data.kind,
      to: recipient,
      subject,
      html,
      text,
    });
    sent += 1;
  }
  return { sent };
}

async function main(): Promise<void> {
  const connection = createRedis('worker');

  const notificationWorker = new Worker<NotificationJob>(QUEUE_NAMES.notifications, processNotification, {
    connection,
    concurrency: 5,
    limiter: { max: 30, duration: 1_000 },
  });

  const slaWorker = new Worker(
    QUEUE_NAMES.slaScan,
    async () => {
      const summary = await runSlaScan();
      const total =
        summary.resolutionBreached + summary.resolutionAtRisk + summary.responseBreached + summary.responseAtRisk;
      if (total > 0) queueLogger.info(summary, 'SLA taramasi tamamlandi');
      else queueLogger.debug(summary, 'SLA taramasi tamamlandi (degisiklik yok)');
      return summary;
    },
    { connection, concurrency: 1 },
  );

  for (const worker of [notificationWorker, slaWorker]) {
    worker.on('failed', (job, err) =>
      queueLogger.error({ err, jobId: job?.id, queue: worker.name, attempt: job?.attemptsMade }, 'Is basarisiz'),
    );
    worker.on('error', (err) => queueLogger.error({ err, queue: worker.name }, 'Worker hatasi'));
  }

  await scheduleSlaScan();
  queueLogger.info('Worker calisiyor');

  const shutdown = async (signal: string): Promise<void> => {
    queueLogger.info({ signal }, 'Worker kapatiliyor');
    await Promise.allSettled([notificationWorker.close(), slaWorker.close()]);
    await closeQueues();
    await connection.quit().catch(() => undefined);
    await closePools();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  queueLogger.error({ err }, 'Worker baslatilamadi');
  process.exit(1);
});
