import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { SlaPolicyUseCases } from '../../../application/sla/sla-policy.use-cases.js';
import { TICKET_PRIORITIES } from '../../../domain/tickets/ticket.js';
import { getAuth } from '../middleware/auth.js';
import { parseOrThrow } from '../validation.js';

const upsertSchema = z.object({
  responseMinutes: z.coerce.number().int().min(5).max(100_000),
  resolutionMinutes: z.coerce.number().int().min(5).max(1_000_000),
});

export function slaPolicyRoutes(slaPolicies: SlaPolicyUseCases, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.json({ items: await slaPolicies.list(getAuth(req)) });
  });

  router.put('/:priority', async (req, res) => {
    const priority = parseOrThrow(z.enum(TICKET_PRIORITIES), req.params.priority, 'Oncelik');
    const body = parseOrThrow(upsertSchema, req.body, 'SLA politikasi');
    res.json({ policy: await slaPolicies.upsert(getAuth(req), priority, body) });
  });

  return router;
}
