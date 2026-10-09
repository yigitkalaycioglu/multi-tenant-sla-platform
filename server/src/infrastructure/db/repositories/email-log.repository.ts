import type pg from 'pg';
import type { EmailLog } from '../../../application/notifications/notification.ports.js';

/**
 * Worker sureci kiracilar arasi calistigi icin e-posta kaydi sistem (admin)
 * baglantisini kullanir.
 */
export function createEmailLogRepository(adminPool: pg.Pool): EmailLog {
  return {
    async create(entry) {
      const { rows } = await adminPool.query<{ id: string }>(
        `INSERT INTO email_log (tenant_id, ticket_id, kind, recipient, subject, status)
         VALUES ($1, $2, $3, $4, $5, 'queued')
         RETURNING id`,
        [entry.tenantId, entry.ticketId, entry.kind, entry.recipient, entry.subject],
      );
      return rows[0]!.id;
    },

    async markSent(id) {
      await adminPool.query(`UPDATE email_log SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
    },

    async markFailed(id, error) {
      await adminPool.query(`UPDATE email_log SET status = 'failed', error = $2 WHERE id = $1`, [id, error]);
    },
  };
}
