import type { UserAccount, UserRecord, UserRepository } from '../../../application/users/user.ports.js';
import type { UserRole } from '../../../domain/identity.js';
import type { Queryable } from '../pool.js';

interface AccountRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  team_id: string | null;
  password_hash: string;
  is_active: boolean;
}

interface RecordRow {
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

const ACCOUNT_SELECT = `SELECT id, tenant_id, email::text AS email, full_name, role, team_id, password_hash, is_active FROM users`;

const RECORD_SELECT = `
  SELECT u.id, u.full_name, u.email::text AS email, u.role, u.team_id, tm.name AS team_name,
         u.is_active, u.last_login_at, u.created_at,
         (SELECT COUNT(*)::bigint FROM tickets t
           WHERE t.assignee_id = u.id AND t.status NOT IN ('resolved','closed')) AS open_ticket_count
    FROM users u
    LEFT JOIN teams tm ON tm.id = u.team_id
`;

const toAccount = (r: AccountRow): UserAccount => ({
  id: r.id,
  tenantId: r.tenant_id,
  email: r.email,
  fullName: r.full_name,
  role: r.role,
  teamId: r.team_id,
  passwordHash: r.password_hash,
  isActive: r.is_active,
});

const toRecord = (r: RecordRow): UserRecord => ({
  id: r.id,
  fullName: r.full_name,
  email: r.email,
  role: r.role,
  teamId: r.team_id,
  teamName: r.team_name,
  isActive: r.is_active,
  lastLoginAt: r.last_login_at,
  openTicketCount: r.open_ticket_count,
  createdAt: r.created_at,
});

export function createUserRepository(db: Queryable, tenantId: string): UserRepository {
  return {
    async findAccountByEmail(email) {
      const { rows } = await db.query<AccountRow>(`${ACCOUNT_SELECT} WHERE email = $1`, [email]);
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async findAccountById(id) {
      const { rows } = await db.query<AccountRow>(`${ACCOUNT_SELECT} WHERE id = $1`, [id]);
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async touchLastLogin(id) {
      await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
    },

    async findActiveEmail(id) {
      const { rows } = await db.query<{ email: string }>(
        'SELECT email::text AS email FROM users WHERE id = $1 AND is_active',
        [id],
      );
      return rows[0]?.email ?? null;
    },

    async findActiveRole(id) {
      const { rows } = await db.query<{ role: UserRole }>('SELECT role FROM users WHERE id = $1 AND is_active', [id]);
      return rows[0]?.role ?? null;
    },

    async list({ includeInactive }) {
      const { rows } = await db.query<RecordRow>(
        `${RECORD_SELECT} ${includeInactive ? '' : 'WHERE u.is_active'} ORDER BY u.full_name`,
      );
      return rows.map(toRecord);
    },

    async findRecord(id) {
      const { rows } = await db.query<RecordRow>(`${RECORD_SELECT} WHERE u.id = $1`, [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async insert(u) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role, team_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, u.email, u.passwordHash, u.fullName, u.role, u.teamId],
      );
      return rows[0]!.id;
    },

    async update(id, patch) {
      const result = await db.query(
        `UPDATE users
            SET full_name = COALESCE($2, full_name),
                role      = COALESCE($3::user_role, role),
                team_id   = CASE WHEN $4::boolean THEN $5::uuid ELSE team_id END,
                is_active = COALESCE($6::boolean, is_active)
          WHERE id = $1`,
        [
          id,
          patch.fullName ?? null,
          patch.role ?? null,
          patch.teamId !== undefined,
          patch.teamId ?? null,
          patch.isActive ?? null,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async countActiveAdminsExcept(id) {
      const { rows } = await db.query<{ count: number }>(
        `SELECT COUNT(*)::bigint AS count FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
        [id],
      );
      return rows[0]?.count ?? 0;
    },

    async joinTeamIfUnassigned(userId, teamId) {
      await db.query('UPDATE users SET team_id = $1 WHERE id = $2 AND team_id IS NULL', [teamId, userId]);
    },
  };
}
