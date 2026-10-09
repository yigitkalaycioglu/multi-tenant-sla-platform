import { Queue, type JobsOptions } from 'bullmq';
import type { NotificationJob, NotificationQueue } from '../../application/ports/events.js';
import type { Logger } from '../../application/ports/runtime.js';
import { createRedis } from '../redis/redis.js';

export const QUEUE_NAMES = {
  notifications: 'notifications',
  slaScan: 'sla-scan',
} as const;

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 },
};

/** NotificationQueue portunun BullMQ uygulamasi (ureticisi). */
export function createNotificationQueue(redisUrl: string, log: Logger): NotificationQueue & { close(): Promise<void> } {
  const queueLog = log.child({ module: 'queue' });
  const connection = createRedis(redisUrl, 'queue-producer', log);
  const queue = new Queue<NotificationJob>(QUEUE_NAMES.notifications, { connection, defaultJobOptions });

  return {
    async enqueue(job, dedupeKey) {
      if (job.recipients.length === 0) {
        queueLog.debug({ ticketId: job.ticketId, kind: job.kind }, 'Alici yok, bildirim atlandi');
        return;
      }

      await queue.add(job.kind, job, { jobId: dedupeKey ?? `${job.kind}:${job.ticketId}` });
      queueLog.debug(
        { kind: job.kind, ticketId: job.ticketId, recipients: job.recipients.length },
        'Bildirim kuyruga alindi',
      );
    },

    async close() {
      await queue.close().catch(() => undefined);
      await connection.quit().catch(() => undefined);
    },
  };
}

/** Periyodik SLA taramasini planlar (tekrarli is). Yalnizca worker kullanir. */
export function createSlaScanScheduler(redisUrl: string, log: Logger) {
  const queueLog = log.child({ module: 'queue' });
  const connection = createRedis(redisUrl, 'scan-scheduler', log);
  const queue = new Queue(QUEUE_NAMES.slaScan, {
    connection,
    defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } },
  });

  return {
    async schedule(everyMs: number): Promise<void> {
      await queue.upsertJobScheduler('sla-scan-scheduler', { every: everyMs }, { name: 'scan', data: {} });
      queueLog.info({ everyMs }, 'SLA tarayicisi planlandi');
    },

    async close(): Promise<void> {
      await queue.close().catch(() => undefined);
      await connection.quit().catch(() => undefined);
    },
  };
}
