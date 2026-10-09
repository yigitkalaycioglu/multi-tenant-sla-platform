import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { UserUseCases } from '../../../application/users/user.use-cases.js';
import { USER_ROLES } from '../../../domain/identity.js';
import { getAuth } from '../middleware/auth.js';
import { parseOrThrow, passwordSchema, uuid } from '../validation.js';

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email('Gecerli bir e-posta girin'),
  password: passwordSchema,
  role: z.enum(USER_ROLES).default('developer'),
  teamId: uuid.nullish(),
});

const updateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    teamId: uuid.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Guncellenecek en az bir alan gonderin' });

export function userRoutes(users: UserUseCases, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    res.json({ items: await users.list(getAuth(req), { includeInactive }) });
  });

  router.post('/', async (req, res) => {
    const body = parseOrThrow(createSchema, req.body, 'Kullanici');
    res.status(201).json({ user: await users.create(getAuth(req), body) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Kullanici kimligi');
    const body = parseOrThrow(updateSchema, req.body, 'Kullanici');
    res.json({ user: await users.update(getAuth(req), id, body) });
  });

  return router;
}
