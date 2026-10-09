import { invalid, notFound } from '../../domain/errors.js';
import { assertPermission, TEAM_LEAD_ROLES, type AuthUser } from '../../domain/identity.js';
import type { TenantRepositories, TenantTransactions } from '../ports/transactions.js';
import type { TeamPatch, TeamRecord } from './team.ports.js';

export interface TeamDeps {
  tx: TenantTransactions;
}

const toDto = (r: TeamRecord) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  lead: r.leadId ? { id: r.leadId, name: r.leadName ?? 'Bilinmiyor' } : null,
  memberCount: r.memberCount,
  openTicketCount: r.openTicketCount,
  createdAt: r.createdAt.toISOString(),
});

/** Ekip lideri olarak yalnizca admin veya team_lead rolundeki aktif kullanici secilebilir. */
async function assertLeadEligible({ users }: TenantRepositories, leadId: string): Promise<void> {
  const role = await users.findActiveRole(leadId);
  if (!role || !TEAM_LEAD_ROLES.includes(role)) {
    throw invalid('Ekip lideri, aktif bir admin veya ekip lideri olmalidir');
  }
}

export function makeTeamUseCases({ tx }: TeamDeps) {
  return {
    async list(actor: AuthUser) {
      const records = await tx.run(actor.tenantId, ({ teams }) => teams.list());
      return records.map(toDto);
    },

    async create(actor: AuthUser, input: { name: string; description?: string | null; leadId?: string | null }) {
      assertPermission(actor, 'team:manage');

      return tx.run(actor.tenantId, async (repos) => {
        if (input.leadId) await assertLeadEligible(repos, input.leadId);

        const id = await repos.teams.insert({
          name: input.name,
          description: input.description ?? null,
          leadId: input.leadId ?? null,
        });

        // Ekip lideri otomatik olarak bu ekibin uyesi olur.
        if (input.leadId) await repos.users.joinTeamIfUnassigned(input.leadId, id);

        return toDto((await repos.teams.findRecord(id))!);
      });
    },

    async update(actor: AuthUser, teamId: string, patch: TeamPatch) {
      assertPermission(actor, 'team:manage');

      return tx.run(actor.tenantId, async (repos) => {
        if (patch.leadId) await assertLeadEligible(repos, patch.leadId);
        if (!(await repos.teams.update(teamId, patch))) throw notFound('Ekip bulunamadi');
        return toDto((await repos.teams.findRecord(teamId))!);
      });
    },

    async remove(actor: AuthUser, teamId: string): Promise<void> {
      assertPermission(actor, 'team:manage');

      await tx.run(actor.tenantId, async ({ teams }) => {
        if (await teams.hasOpenTickets(teamId)) throw invalid('Ekibin acik biletleri var; once bunlari devredin.');
        if (!(await teams.delete(teamId))) throw notFound('Ekip bulunamadi');
      });
    },
  };
}

export type TeamUseCases = ReturnType<typeof makeTeamUseCases>;
