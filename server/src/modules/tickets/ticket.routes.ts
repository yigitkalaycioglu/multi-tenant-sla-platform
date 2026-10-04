import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { parseOrThrow, uuid } from '../../lib/validate.js';
import { TICKET_PRIORITIES, TICKET_STATUSES, SLA_STATES } from '../../types/domain.js';
import {
  addComment,
  createTicket,
  deleteTicket,
  getTicket,
  listTickets,
  updateTicket,
} from './ticket.service.js';

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

export const ticketRouter: Router = Router();

ticketRouter.use(requireAuth);

ticketRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const q = parseOrThrow(listQuerySchema, req.query, 'Filtre');

  const result = await listTickets(auth, {
    ...q,
    assigneeId: q.assigneeId === 'me' ? auth.id : q.assigneeId,
  });
  res.json(result);
});

ticketRouter.post('/', async (req, res) => {
  const auth = getAuth(req);
  const body = parseOrThrow(createSchema, req.body, 'Bilet');
  const ticket = await createTicket(auth, body);
  res.status(201).json({ ticket });
});

ticketRouter.get('/:id', async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
  res.json(await getTicket(auth, id));
});

ticketRouter.patch('/:id', async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
  const patch = parseOrThrow(updateSchema, req.body, 'Guncelleme');
  res.json({ ticket: await updateTicket(auth, id, patch) });
});

ticketRouter.delete('/:id', requirePermission('ticket:delete'), async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
  await deleteTicket(auth, id);
  res.status(204).end();
});

ticketRouter.post('/:id/comments', async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Bilet kimligi');
  const body = parseOrThrow(commentSchema, req.body, 'Yorum');
  res.status(201).json({ comment: await addComment(auth, id, body) });
});
