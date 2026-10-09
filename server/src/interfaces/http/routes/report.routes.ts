import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { ReportUseCases } from '../../../application/reports/report.use-cases.js';
import { getAuth } from '../middleware/auth.js';
import { parseOrThrow } from '../validation.js';

const querySchema = z.object({
  /** Trend ve ortalama hesaplarinin bakacagi gun sayisi. */
  days: z.coerce.number().int().min(7).max(90).default(14),
});

export function reportRoutes(reports: ReportUseCases, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/overview', async (req, res) => {
    const { days } = parseOrThrow(querySchema, req.query, 'Rapor filtresi');
    res.json(await reports.overview(getAuth(req), days));
  });

  return router;
}
