import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../../db/pool.js';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { parseOrThrow, uuid } from '../../lib/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { hashPassword } from '../auth/auth.service.js';
import { USER_ROLES, type UserRole } from '../../types/domain.js';

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  team_id: string | null;
  team_name: string | null;
  is_active: boolean;
  last_login_at: Date | null;
  open_ticket_count: number;
  created_at: Date;
}

const LIST_SQL = `
  SELECT u.id, u.full_name, u.email::text AS email, u.role, u.team_id, tm.name AS team_name,
         u.is_active, u.last_login_at, u.created_at,
         (SELECT COUNT(*)::bigint FROM tickets t
           WHERE t.assignee_id = u.id AND t.status NOT IN ('resolved','closed')) AS open_ticket_count
    FROM users u
    LEFT JOIN teams tm ON tm.id = u.team_id
`;

const toDto = (r: UserRow) => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  role: r.role,
  team: r.team_id ? { id: r.team_id, name: r.team_name ?? 'Bilinmiyor' } : null,
  isActive: r.is_active,
  lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
  openTicketCount: r.open_ticket_count,
  createdAt: r.created_at.toISOString(),
});

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email('Gecerli bir e-posta girin'),
  password: z
    .string()
    .min(8, 'Sifre en az 8 karakter olmali')
    .max(128)
    .regex(/[A-Za-z]/, 'Sifre en az bir harf icermeli')
    .regex(/[0-9]/, 'Sifre en az bir rakam icermeli'),
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

export const userRouter: Router = Router();
userRouter.use(requireAuth);

/** Atama kutulari icin tum aktif kullanicilar herkese gorunur. */
userRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const includeInactive = req.query.includeInactive === 'true';

  const items = await withTenant(auth.tenantId, async (db) => {
    const result = await db.query<UserRow>(
      `${LIST_SQL} ${includeInactive ? '' : 'WHERE u.is_active'} ORDER BY u.full_name`,
    );
    return result.rows.map(toDto);
  });

  res.json({ items });
});

userRouter.post('/', requirePermission('user:manage'), async (req, res) => {
  const auth = getAuth(req);
  const body = parseOrThrow(createSchema, req.body, 'Kullanici');
  const passwordHash = await hashPassword(body.password);

  const user = await withTenant(auth.tenantId, async (db) => {
    if (body.teamId) {
      const team = await db.query('SELECT 1 FROM teams WHERE id = $1', [body.teamId]);
      if (!team.rowCount) throw badRequest('Ekip bulunamadi');
    }

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, team_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [auth.tenantId, body.email, passwordHash, body.fullName, body.role, body.teamId ?? null],
    );

    const fresh = await db.query<UserRow>(`${LIST_SQL} WHERE u.id = $1`, [inserted.rows[0]!.id]);
    return toDto(fresh.rows[0]!);
  });

  res.status(201).json({ user });
});

userRouter.patch('/:id', requirePermission('user:manage'), async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Kullanici kimligi');
  const body = parseOrThrow(updateSchema, req.body, 'Kullanici');

  const user = await withTenant(auth.tenantId, async (db) => {
    // Kiracinin son aktif admin'i kilitlenemez / rolu dusurulemez.
    if ((body.isActive === false || (body.role && body.role !== 'admin')) && id === auth.id) {
      throw badRequest('Kendi yonetici yetkinizi kaldiramazsiniz');
    }
    if (body.isActive === false || (body.role && body.role !== 'admin')) {
      const admins = await db.query<{ count: number }>(
        `SELECT COUNT(*)::bigint AS count FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
        [id],
      );
      if ((admins.rows[0]?.count ?? 0) === 0) throw badRequest('Kiracida en az bir aktif yonetici kalmali');
    }

    const result = await db.query(
      `UPDATE users
          SET full_name = COALESCE($2, full_name),
              role      = COALESCE($3::user_role, role),
              team_id   = CASE WHEN $4::boolean THEN $5::uuid ELSE team_id END,
              is_active = COALESCE($6::boolean, is_active)
        WHERE id = $1`,
      [id, body.fullName ?? null, body.role ?? null, body.teamId !== undefined, body.teamId ?? null, body.isActive ?? null],
    );
    if (!result.rowCount) throw notFound('Kullanici bulunamadi');

    const fresh = await db.query<UserRow>(`${LIST_SQL} WHERE u.id = $1`, [id]);
    return toDto(fresh.rows[0]!);
  });

  res.json({ user });
});
