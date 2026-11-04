import { describe, expect, it } from 'vitest';
import type { TenantRepositories, TenantTransactions } from '../../src/application/ports/transactions.js';
import type { UserPatch, UserRecord } from '../../src/application/users/user.ports.js';
import { makeUserUseCases } from '../../src/application/users/user.use-cases.js';
import type { AuthUser } from '../../src/domain/identity.js';

const admin: AuthUser = {
  id: 'admin-1',
  tenantId: 'tenant-1',
  tenantSlug: 'kuzey',
  email: 'admin@kuzey.io',
  fullName: 'Elif Yildirim',
  role: 'admin',
  teamId: null,
};

function record(overrides: Partial<UserRecord>): UserRecord {
  return {
    id: 'x',
    fullName: 'Kullanici',
    email: 'x@kuzey.io',
    role: 'developer',
    teamId: null,
    teamName: null,
    isActive: true,
    lastLoginAt: null,
    openTicketCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function setup() {
  const users = new Map<string, UserRecord>([
    ['admin-1', record({ id: 'admin-1', role: 'admin' })],
    ['lead-1', record({ id: 'lead-1', role: 'team_lead', teamId: 'mobil' })],
  ]);
  // ekip -> lider
  const leads = new Map<string, string | null>([
    ['mobil', 'lead-1'],
    ['platform', 'admin-1'],
  ]);

  const repos = {
    users: {
      countActiveAdminsExcept: async () => 1,
      update: async (id: string, patch: UserPatch) => {
        const u = users.get(id);
        if (!u) return false;
        users.set(id, {
          ...u,
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.teamId !== undefined ? { teamId: patch.teamId } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        });
        return true;
      },
      findRecord: async (id: string) => users.get(id) ?? null,
    },
    teams: {
      clearLead: async (userId: string, keepTeamId: string | null) => {
        for (const [team, lead] of leads) if (lead === userId && team !== keepTeamId) leads.set(team, null);
      },
    },
  } as unknown as TenantRepositories;

  const tx: TenantTransactions = {
    run: (_tenantId, work) => work(repos),
    runForNewTenant: () => Promise.reject(new Error('bu testte kullanilmaz')),
  };

  const useCases = makeUserUseCases({ tx, hasher: { hash: async (p) => p, verify: async () => true } });
  return { useCases, leads };
}

describe('ekip liderligi tutarliligi', () => {
  it('lider gelistiriciye dusurulurse ekibin lideri bosalir', async () => {
    const { useCases, leads } = setup();
    await useCases.update(admin, 'lead-1', { role: 'developer' });
    expect(leads.get('mobil')).toBeNull();
  });

  it('lider baska ekibe tasinirsa eski ekibin lideri bosalir', async () => {
    const { useCases, leads } = setup();
    await useCases.update(admin, 'lead-1', { teamId: 'platform' });
    expect(leads.get('mobil')).toBeNull();
    expect(leads.get('platform')).toBe('admin-1');
  });

  it('pasiflestirilen lider ekip liderliginden cikar', async () => {
    const { useCases, leads } = setup();
    await useCases.update(admin, 'lead-1', { isActive: false });
    expect(leads.get('mobil')).toBeNull();
  });

  it('adi degisen lider ve ekibi degisen admin liderligini korur', async () => {
    const { useCases, leads } = setup();
    await useCases.update(admin, 'lead-1', { fullName: 'Deniz Arslan' });
    await useCases.update(admin, 'admin-1', { teamId: 'mobil' });
    expect(leads.get('mobil')).toBe('lead-1');
    expect(leads.get('platform')).toBe('admin-1');
  });
});
