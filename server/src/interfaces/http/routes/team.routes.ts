import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { TeamUseCases } from '../../../application/teams/team.use-cases.js';
import { getAuth } from '../middleware/auth.js';
import { parseOrThrow, uuid } from '../validation.js';

const teamSchema = z.object({
  name: z.string().trim().min(2, 'Ekip adi en az 2 karakter').max(80),
  description: z.string().trim().max(500).nullish(),
  leadId: uuid.nullish(),
});

export function teamRoutes(teams: TeamUseCases, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.json({ items: await teams.list(getAuth(req)) });
  });

  router.post('/', async (req, res) => {
    const body = parseOrThrow(teamSchema, req.body, 'Ekip');
    res.status(201).json({ team: await teams.create(getAuth(req), body) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Ekip kimligi');
    const body = parseOrThrow(teamSchema.partial(), req.body, 'Ekip');
    res.json({ team: await teams.update(getAuth(req), id, body) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Ekip kimligi');
    await teams.remove(getAuth(req), id);
    res.status(204).end();
  });

  return router;
}
