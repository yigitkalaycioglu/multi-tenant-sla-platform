import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../../db/pool.js';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { parseOrThrow } from '../../lib/validate.js';
import { TICKET_PRIORITIES, type TicketPriority } from '../../types/domain.js';

interface PolicyRow {
  id: string;
  priority: TicketPriority;
  response_minutes: number;
  resolution_minutes: number;
  updated_at: Date;
  ticket_count: number;
  breached_count: number;
}

/** Onceligi ciddiyet sirasina gore siralar (enum alfabetik siralanmasin diye). */
const PRIORITY_ORDER = `CASE p.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

const upsertSchema = z.object({
  responseMinutes: z.coerce.number().int().min(5).max(100_000),
  resolutionMinutes: z.coerce.number().int().min(5).max(1_000_000),
});

const toDto = (r: PolicyRow) => ({
  id: r.id,
  priority: r.priority,
  responseMinutes: r.response_minutes,
  resolutionMinutes: r.resolution_minutes,
  ticketCount: r.ticket_count,
  breachedCount: r.breached_count,
  updatedAt: r.updated_at.toISOString(),
});

export const slaRouter: Router = Router();
slaRouter.use(requireAuth);

slaRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const items = await withTenant(auth.tenantId, async (db) => {
    const result = await db.query<PolicyRow>(
      `SELECT p.id, p.priority, p.response_minutes, p.resolution_minutes, p.updated_at,
              (SELECT COUNT(*)::bigint FROM tickets t WHERE t.priority = p.priority) AS ticket_count,
              (SELECT COUNT(*)::bigint FROM tickets t
                WHERE t.priority = p.priority AND t.resolution_sla_state = 'breached') AS breached_count
         FROM sla_policies p
        ORDER BY ${PRIORITY_ORDER}`,
    );
    return result.rows.map(toDto);
  });
  res.json({ items });
});

/**
 * Politikayi gunceller (yoksa olusturur).
 *
 * Not: Degisiklik yalnizca BUNDAN SONRA acilacak biletlere uygulanir; acik
 * biletlerin hedefleri korunur — gecmise donuk SLA degisimi denetim acisindan
 * dogru degildir. Bir biletin hedefini degistirmek icin oncelik degistirilir.
 */
slaRouter.put('/:priority', requirePermission('sla:manage'), async (req, res) => {
  const auth = getAuth(req);
  const priority = parseOrThrow(z.enum(TICKET_PRIORITIES), req.params.priority, 'Oncelik');
  const body = parseOrThrow(upsertSchema, req.body, 'SLA politikasi');

  if (body.resolutionMinutes < body.responseMinutes) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Cozum suresi, yanit suresinden kisa olamaz' },
    });
    return;
  }

  const policy = await withTenant(auth.tenantId, async (db) => {
    const result = await db.query<PolicyRow>(
      `INSERT INTO sla_policies (tenant_id, priority, response_minutes, resolution_minutes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, priority)
       DO UPDATE SET response_minutes = EXCLUDED.response_minutes,
                     resolution_minutes = EXCLUDED.resolution_minutes
       RETURNING id, priority, response_minutes, resolution_minutes, updated_at,
                 0::bigint AS ticket_count, 0::bigint AS breached_count`,
      [auth.tenantId, priority, body.responseMinutes, body.resolutionMinutes],
    );
    return toDto(result.rows[0]!);
  });

  res.json({ policy });
});
