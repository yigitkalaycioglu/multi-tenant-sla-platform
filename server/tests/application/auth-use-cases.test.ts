/**
 * Oturum use case'leri — sahte portlarla. Sahte transaction, gercegi gibi
 * callback hata firlatirsa tum degisiklikleri geri alir.
 */
import { describe, expect, it } from 'vitest';
import { makeAuthUseCases } from '../../src/application/auth/auth.use-cases.js';
import type { StoredRefreshToken } from '../../src/application/auth/auth.ports.js';
import type { Logger } from '../../src/application/ports/runtime.js';
import type { TenantRepositories, TenantTransactions } from '../../src/application/ports/transactions.js';
import type { UserAccount } from '../../src/application/users/user.ports.js';

const NOW = new Date('2026-01-01T10:00:00Z');
const TENANT = { id: 'tenant-1', slug: 'kuzey', isActive: true };

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

const account: UserAccount = {
  id: 'user-1',
  tenantId: TENANT.id,
  email: 'admin@kuzey.io',
  fullName: 'Elif Yildirim',
  role: 'admin',
  teamId: null,
  passwordHash: 'hash',
  isActive: true,
};

function setup() {
  const state = { tokens: [] as Array<StoredRefreshToken & { hash: string }>, seq: 0 };

  const repos = {
    refreshTokens: {
      insert: async (t: { userId: string; tokenHash: string; expiresAt: Date }) => {
        state.tokens.push({ id: `rt-${++state.seq}`, userId: t.userId, hash: t.tokenHash, revokedAt: null, expiresAt: t.expiresAt });
      },
      findByHashForUpdate: async (hash: string) => state.tokens.find((t) => t.hash === hash) ?? null,
      revoke: async (id: string) => {
        state.tokens = state.tokens.map((t) => (t.id === id ? { ...t, revokedAt: NOW } : t));
      },
      revokeAllForUser: async (userId: string) => {
        state.tokens = state.tokens.map((t) => (t.userId === userId && !t.revokedAt ? { ...t, revokedAt: NOW } : t));
      },
      revokeByHash: async () => undefined,
    },
    users: {
      findAccountById: async () => account,
      findAccountByEmail: async () => account,
      touchLastLogin: async () => undefined,
    },
  } as unknown as TenantRepositories;

  const tx: TenantTransactions = {
    async run(_tenantId, work) {
      const snapshot = structuredClone(state);
      try {
        return await work(repos);
      } catch (err) {
        Object.assign(state, snapshot); // ROLLBACK
        throw err;
      }
    },
    runForNewTenant: () => Promise.reject(new Error('bu testte kullanilmaz')),
  };

  let counter = 0;
  const auth = makeAuthUseCases({
    tx,
    tenants: { findBySlug: async () => TENANT, findById: async () => TENANT },
    hasher: { hash: async (p) => p, verify: async () => true },
    tokens: {
      issueAccessToken: () => 'access',
      verifyAccessToken: () => {
        throw new Error('kullanilmaz');
      },
      issueRefreshToken: () => {
        const token = `raw-${++counter}`;
        return { token, hash: `h:${token}`, expiresAt: new Date(NOW.getTime() + 86_400_000) };
      },
      hashRefreshToken: (t) => `h:${t}`,
    },
    clock: { now: () => NOW },
    log: silentLog,
  });

  return { auth, state };
}

describe('refresh token yeniden kullanim tespiti', () => {
  it('iptal edilmis token tekrar gelirse kullanicinin TUM oturumlari kalici olarak kapanir', async () => {
    const { auth, state } = setup();
    const login = await auth.login({ tenantSlug: 'kuzey', email: account.email, password: 'x' });
    const rotated = await auth.refresh(login.refreshToken);

    // Calinmis eski token tekrar kullaniliyor.
    await expect(auth.refresh(login.refreshToken)).rejects.toMatchObject({ kind: 'unauthenticated' });

    // Hata firlatilmis olsa da iptal geri alinmamali: yeni token da artik gecersiz.
    expect(state.tokens.every((t) => t.revokedAt !== null)).toBe(true);
    await expect(auth.refresh(rotated.refreshToken)).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('normal rotasyonda eski token iptal edilir, yenisi calisir', async () => {
    const { auth } = setup();
    const login = await auth.login({ tenantSlug: 'kuzey', email: account.email, password: 'x' });
    const rotated = await auth.refresh(login.refreshToken);
    await expect(auth.refresh(rotated.refreshToken)).resolves.toMatchObject({ user: { id: account.id } });
  });
});
