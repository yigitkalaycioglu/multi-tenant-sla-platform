import { Queue, type JobsOptions } from 'bullmq';
import { createRedis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { queueLogger } from '../lib/logger.js';
import type { TicketPriority } from '../types/domain.js';

export const QUEUE_NAMES = {
  notifications: 'notifications',
  slaScan: 'sla-scan',
} as const;

/** Kuyruga giren bildirim isleri. */
export type NotificationJob =
  | {
      kind: 'sla_at_risk' | 'sla_breached';
      tenantId: string;
      ticketId: string;
      reference: string;
      title: string;
      priority: TicketPriority;
      dueAt: string;
      recipients: string[];
    }
  | {
      kind: 'ticket_assigned';
      tenantId: string;
      ticketId: string;
      reference: string;
      title: string;
      priority: TicketPriority;
      dueAt: string;
      recipients: string[];
      assignedBy: string;
    };

const connection = createRedis('queue-producer');

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 },
};

export const notificationsQueue = new Queue<NotificationJob>(QUEUE_NAMES.notifications, {
  connection,
  defaultJobOptions,
});

export const slaScanQueue = new Queue(QUEUE_NAMES.slaScan, {
  connection,
  defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
});

/**
 * Bildirim isini kuyruga alir.
 *
 * `jobId` deterministik secilir: ayni bilet icin ayni tur bildirim, tarayici
 * ust uste calissa bile bir kez kuyruga girer (idempotensi).
 */
export async function enqueueNotification(job: NotificationJob, dedupeKey?: string): Promise<void> {
  if (job.recipients.length === 0) {
    queueLogger.debug({ ticketId: job.ticketId, kind: job.kind }, 'Alici yok, bildirim atlandi');
    return;
  }

  await notificationsQueue.add(job.kind, job, {
    jobId: dedupeKey ?? `${job.kind}:${job.ticketId}`,
  });
  queueLogger.debug({ kind: job.kind, ticketId: job.ticketId, recipients: job.recipients.length }, 'Bildirim kuyruga alindi');
}

/** Periyodik SLA taramasini planlar (tekrarli is). */
export async function scheduleSlaScan(): Promise<void> {
  await slaScanQueue.upsertJobScheduler(
    'sla-scan-scheduler',
    { every: env.SLA_SCAN_INTERVAL_MS },
    { name: 'scan', data: {} },
  );
  queueLogger.info({ everyMs: env.SLA_SCAN_INTERVAL_MS }, 'SLA tarayicisi planlandi');
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([notificationsQueue.close(), slaScanQueue.close()]);
  await connection.quit().catch(() => undefined);
}
