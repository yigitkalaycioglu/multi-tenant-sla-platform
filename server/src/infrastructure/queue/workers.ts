/**
 * BullMQ tuketicileri: kuyruktan gelen isleri use case'lere iletir.
 *
 * Iki is vardir:
 *   1. `sla-scan`      — periyodik olarak tum kiracilarin SLA saatlerini tarar.
 *   2. `notifications` — geciken/riskli isler ve atamalar icin e-posta gonderir.
 */
import { Worker } from 'bullmq';
import type { NotificationJob } from '../../application/ports/events.js';
import type { Logger } from '../../application/ports/runtime.js';
import type { ScanSummary } from '../../application/sla/sla-scan.use-case.js';
import { createRedis } from '../redis/redis.js';
import { QUEUE_NAMES } from './queues.js';

export interface QueueWorkerDeps {
  redisUrl: string;
  log: Logger;
  runSlaScan(): Promise<ScanSummary>;
  deliverNotification(job: NotificationJob): Promise<{ sent: number }>;
}

export function startQueueWorkers({ redisUrl, log, runSlaScan, deliverNotification }: QueueWorkerDeps) {
  const queueLog = log.child({ module: 'queue' });
  const connection = createRedis(redisUrl, 'worker', log);

  const notificationWorker = new Worker<NotificationJob>(
    QUEUE_NAMES.notifications,
    (job) => deliverNotification(job.data),
    { connection, concurrency: 5, limiter: { max: 30, duration: 1_000 } },
  );

  const slaWorker = new Worker(
    QUEUE_NAMES.slaScan,
    async () => {
      const summary = await runSlaScan();
      const total =
        summary.resolutionBreached + summary.resolutionAtRisk + summary.responseBreached + summary.responseAtRisk;
      if (total > 0) queueLog.info(summary, 'SLA taramasi tamamlandi');
      else queueLog.debug(summary, 'SLA taramasi tamamlandi (degisiklik yok)');
      return summary;
    },
    { connection, concurrency: 1 },
  );

  for (const worker of [notificationWorker, slaWorker]) {
    worker.on('failed', (job, err) =>
      queueLog.error({ err, jobId: job?.id, queue: worker.name, attempt: job?.attemptsMade }, 'Is basarisiz'),
    );
    worker.on('error', (err) => queueLog.error({ err, queue: worker.name }, 'Worker hatasi'));
  }

  return {
    async close(): Promise<void> {
      await Promise.allSettled([notificationWorker.close(), slaWorker.close()]);
      await connection.quit().catch(() => undefined);
    },
  };
}
