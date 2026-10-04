import { Router } from 'express';
import { z } from 'zod';
import { withTenant, type Db } from '../../db/pool.js';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { parseOrThrow, uuid } from '../../lib/validate.js';
import { badRequest, notFound } from '../../lib/errors.js';

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  lead_id: string | null;
  lead_name: string | null;
  member_count: number;
  open_ticket_count: number;
  created_at: Date;
}

const teamSchema = z.object({
  name: z.string().trim().min(2, 'Ekip adi en az 2 karakter').max(80),
  description: z.string().trim().max(500).nullish(),
  leadId: uuid.nullish(),
});

export const teamRouter: Router = Router();
teamRouter.use(requireAuth);

const LIST_SQL = `
  SELECT tm.id, tm.name, tm.description, tm.lead_id, u.full_name AS lead_name, tm.created_at,
         (SELECT COUNT(*)::bigint FROM users m WHERE m.team_id = tm.id AND m.is_active) AS member_count,
         (SELECT COUNT(*)::bigint FROM tickets t
           WHERE t.team_id = tm.id AND t.status NOT IN ('resolved','closed')) AS open_ticket_count
    FROM teams tm
    LEFT JOIN users u ON u.id = tm.lead_id
`;

const toDto = (r: TeamRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  lead: r.lead_id ? { id: r.lead_id, name: r.lead_name ?? 'Bilinmiyor' } : null,
  memberCount: r.member_count,
  openTicketCount: r.open_ticket_count,
  createdAt: r.created_at.toISOString(),
});

teamRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const teams = await withTenant(auth.tenantId, async (db) => {
    const result = await db.query<TeamRow>(`${LIST_SQL} ORDER BY tm.name`);
    return result.rows.map(toDto);
  });
  res.json({ items: teams });
});

teamRouter.post('/', requirePermission('team:manage'), async (req, res) => {
  const auth = getAuth(req);
  const body = parseOrThrow(teamSchema, req.body, 'Ekip');

  const team = await withTenant(auth.tenantId, async (db) => {
    if (body.leadId) await assertLeadEligible(db, body.leadId);

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO teams (tenant_id, name, description, lead_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [auth.tenantId, body.name, body.description ?? null, body.leadId ?? null],
    );
    const id = inserted.rows[0]!.id;

    // Ekip lideri otomatik olarak bu ekibin uyesi olur.
    if (body.leadId) {
      await db.query(`UPDATE users SET team_id = $1 WHERE id = $2 AND team_id IS NULL`, [id, body.leadId]);
    }

    const result = await db.query<TeamRow>(`${LIST_SQL} WHERE tm.id = $1`, [id]);
    return toDto(result.rows[0]!);
  });

  res.status(201).json({ team });
});

teamRouter.patch('/:id', requirePermission('team:manage'), async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Ekip kimligi');
  const body = parseOrThrow(teamSchema.partial(), req.body, 'Ekip');

  const team = await withTenant(auth.tenantId, async (db) => {
    if (body.leadId) await assertLeadEligible(db, body.leadId);

    const result = await db.query(
      `UPDATE teams
          SET name        = COALESCE($2, name),
              description = COALESCE($3, description),
              lead_id     = CASE WHEN $4::boolean THEN $5::uuid ELSE lead_id END
        WHERE id = $1`,
      [id, body.name ?? null, body.description ?? null, body.leadId !== undefined, body.leadId ?? null],
    );
    if (!result.rowCount) throw notFound('Ekip bulunamadi');

    const fresh = await db.query<TeamRow>(`${LIST_SQL} WHERE tm.id = $1`, [id]);
    return toDto(fresh.rows[0]!);
  });

  res.json({ team });
});

teamRouter.delete('/:id', requirePermission('team:manage'), async (req, res) => {
  const auth = getAuth(req);
  const id = parseOrThrow(uuid, req.params.id, 'Ekip kimligi');

  await withTenant(auth.tenantId, async (db) => {
    const open = await db.query(
      `SELECT 1 FROM tickets WHERE team_id = $1 AND status NOT IN ('resolved','closed') LIMIT 1`,
      [id],
    );
    if (open.rowCount) throw badRequest('Ekibin acik biletleri var; once bunlari devredin.');

    const result = await db.query('DELETE FROM teams WHERE id = $1', [id]);
    if (!result.rowCount) throw notFound('Ekip bulunamadi');
  });

  res.status(204).end();
});

/** Ekip lideri olarak yalnizca admin veya team_lead rolundeki aktif kullanici secilebilir. */
async function assertLeadEligible(db: Db, leadId: string): Promise<void> {
  const result = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND is_active AND role IN ('admin','team_lead')`,
    [leadId],
  );
  if (!result.rowCount) throw badRequest('Ekip lideri, aktif bir admin veya ekip lideri olmalidir');
}
