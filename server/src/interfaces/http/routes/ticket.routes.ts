import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { TicketUseCases } from '../../../application/tickets/ticket.use-cases.js';
import { SLA_STATES } from '../../../domain/sla/sla-policy.js';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../../../domain/tickets/ticket.js';
import { getAuth } from '../middleware/auth.js';
import { parseOrThrow, uuid } from '../validation.js';

/** "open,in_progress" gibi virgullu listeyi diziye cevirir. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((raw) => (raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const listQuerySchema = z.object({
  status: csvEnum(TICKET_STATUSES),
  priority: csvEnum(TICKET_PRIORITIES),
  slaState: csvEnum(SLA_STATES),
  teamId: uuid.optional(),
  assigneeId: z.union([uuid, z.literal('unassigned'), z.literal('me')]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'due_asc', 'priority_desc']).default('created_desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  title: z.string().trim().min(3, 'Baslik en az 3 karakter').max(200),
  description: z.string().trim().max(10_000).optional(),
  priority: z.enum(TICKET_PRIORITIES).default('medium'),
  teamId: uuid.nullish(),
  assigneeId: uuid.nullish(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(10_000).optional(),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    teamId: uuid.nullable().optional(),
    assigneeId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Guncellenecek en az bir alan gonderin' });

const commentSchema = z.object({
  body: z.string().trim().min(1, 'Yorum bos olamaz').max(5000),
  isInternal: z.boolean().default(false),
});

export function ticketRoutes(tickets: TicketUseCases, requireAuth: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const auth = getAuth(req);
    const q = parseOrThrow(listQuerySchema, req.query, 'Filtre');
    res.json(await tickets.list(auth, { ...q, assigneeId: q.assigneeId === 'me' ? auth.id : q.assigneeId }));
  });

  router.post('/', async (req, res) => {
    const body = parseOrThrow(createSchema, req.body, 'Bilet');
    res.status(201).json({ ticket: await tickets.create(getAuth(req), body) });
  });

  router.get('/:id', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
    res.json(await tickets.get(getAuth(req), id));
  });

  router.patch('/:id', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
    const patch = parseOrThrow(updateSchema, req.body, 'Guncelleme');
    res.json({ ticket: await tickets.update(getAuth(req), id, patch) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
    await tickets.remove(getAuth(req), id);
    res.status(204).end();
  });

  router.post('/:id/comments', async (req, res) => {
    const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
    const body = parseOrThrow(commentSchema, req.body, 'Yorum');
    res.status(201).json({ comment: await tickets.addComment(getAuth(req), id, body) });
  });

  return router;
}
