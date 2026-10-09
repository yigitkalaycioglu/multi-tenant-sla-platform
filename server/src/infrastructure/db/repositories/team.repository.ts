import type { TeamRecord, TeamRepository } from '../../../application/teams/team.ports.js';
import type { Queryable } from '../pool.js';

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

const RECORD_SELECT = `
  SELECT tm.id, tm.name, tm.description, tm.lead_id, u.full_name AS lead_name, tm.created_at,
         (SELECT COUNT(*)::bigint FROM users m WHERE m.team_id = tm.id AND m.is_active) AS member_count,
         (SELECT COUNT(*)::bigint FROM tickets t
           WHERE t.team_id = tm.id AND t.status NOT IN ('resolved','closed')) AS open_ticket_count
    FROM teams tm
    LEFT JOIN users u ON u.id = tm.lead_id
`;

const toRecord = (r: TeamRow): TeamRecord => ({
  id: r.id,
  name: r.name,
  description: r.description,
  leadId: r.lead_id,
  leadName: r.lead_name,
  memberCount: r.member_count,
  openTicketCount: r.open_ticket_count,
  createdAt: r.created_at,
});

export function createTeamRepository(db: Queryable, tenantId: string): TeamRepository {
  return {
    async list() {
      const { rows } = await db.query<TeamRow>(`${RECORD_SELECT} ORDER BY tm.name`);
      return rows.map(toRecord);
    },

    async findRecord(id) {
      const { rows } = await db.query<TeamRow>(`${RECORD_SELECT} WHERE tm.id = $1`, [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async exists(id) {
      const result = await db.query('SELECT 1 FROM teams WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async insert(team) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO teams (tenant_id, name, description, lead_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, team.name, team.description, team.leadId],
      );
      return rows[0]!.id;
    },

    async update(id, patch) {
      const result = await db.query(
        `UPDATE teams
            SET name        = COALESCE($2, name),
                description = COALESCE($3, description),
                lead_id     = CASE WHEN $4::boolean THEN $5::uuid ELSE lead_id END
          WHERE id = $1`,
        [id, patch.name ?? null, patch.description ?? null, patch.leadId !== undefined, patch.leadId ?? null],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async delete(id) {
      const result = await db.query('DELETE FROM teams WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    },

    async hasOpenTickets(id) {
      const result = await db.query(
        `SELECT 1 FROM tickets WHERE team_id = $1 AND status NOT IN ('resolved','closed') LIMIT 1`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
