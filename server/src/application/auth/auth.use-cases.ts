import { conflict, forbidden, unauthenticated } from '../../domain/errors.js';
import type { AuthUser } from '../../domain/identity.js';
import { DEFAULT_SLA_POLICIES } from '../../domain/sla/sla-policy.js';
import type { Clock, Logger } from '../ports/runtime.js';
import type { PasswordHasher, TokenService } from '../ports/security.js';
import type { TenantDirectory, TenantRepositories, TenantTransactions } from '../ports/transactions.js';

export interface AuthDeps {
  tx: TenantTransactions;
  tenants: TenantDirectory;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  log: Logger;
}

export interface SessionResult {
  accessToken: string;
  /**
   * Istemciye verilen yenileme anahtari: `<tenantId>.<token>`.
   * refresh_tokens tablosu da RLS altinda oldugu icin, token'i bulmadan once
   * hangi kiracinin baglamina gecilecegini bilmek gerekir.
   */
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

function parseRefreshHandle(handle: string): { tenantId: string; token: string } | null {
  const [tenantId, token] = handle.split('.', 2);
  return tenantId && token ? { tenantId, token } : null;
}

export function makeAuthUseCases({ tx, tenants, hasher, tokens, clock, log }: AuthDeps) {
  const authLog = log.child({ module: 'auth' });

  async function issueSession(repos: TenantRepositories, user: AuthUser, userAgent?: string): Promise<SessionResult> {
    const refresh = tokens.issueRefreshToken(clock.now());

    await repos.refreshTokens.insert({
      userId: user.id,
      tokenHash: refresh.hash,
      userAgent: userAgent?.slice(0, 255) ?? null,
      expiresAt: refresh.expiresAt,
    });

    return {
      accessToken: tokens.issueAccessToken(user),
      refreshToken: `${user.tenantId}.${refresh.token}`,
      refreshExpiresAt: refresh.expiresAt,
      user,
    };
  }

  return {
    /**
     * Yeni kiraci kaydi.
     *
     * Tek transaction icinde: kiraci + varsayilan SLA politikalari + admin
     * kullanicisi + ilk oturum olusturulur. Herhangi bir adim basarisiz olursa
     * hicbiri kalmaz (atomiklik).
     */
    async registerTenant(input: {
      tenantName: string;
      slug: string;
      adminName: string;
      adminEmail: string;
      password: string;
      userAgent?: string;
    }): Promise<SessionResult> {
      if (await tenants.findBySlug(input.slug)) throw conflict('Bu kiraci kisa adi (slug) zaten kullaniliyor.');

      const passwordHash = await hasher.hash(input.password);

      const session = await tx.runForNewTenant({ slug: input.slug, name: input.tenantName }, async (tenant, repos) => {
        await repos.slaPolicies.insertMany(DEFAULT_SLA_POLICIES);

        const adminId = await repos.users.insert({
          email: input.adminEmail,
          passwordHash,
          fullName: input.adminName,
          role: 'admin',
          teamId: null,
        });

        const admin: AuthUser = {
          id: adminId,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          email: input.adminEmail,
          fullName: input.adminName,
          role: 'admin',
          teamId: null,
        };
        return issueSession(repos, admin, input.userAgent);
      });

      authLog.info({ tenantId: session.user.tenantId, slug: input.slug }, 'Yeni kiraci olusturuldu');
      return session;
    },

    async login(input: { tenantSlug: string; email: string; password: string; userAgent?: string }) {
      const tenant = await tenants.findBySlug(input.tenantSlug);

      if (!tenant) {
        await hasher.verify(input.password, null);
        throw unauthenticated('Kiraci, e-posta veya sifre hatali');
      }
      if (!tenant.isActive) throw forbidden('Bu kiraci hesabi pasif durumda');

      return tx.run(tenant.id, async (repos) => {
        const account = await repos.users.findAccountByEmail(input.email);

        if (!account) {
          await hasher.verify(input.password, null);
          throw unauthenticated('Kiraci, e-posta veya sifre hatali');
        }
        if (!account.isActive) throw forbidden('Hesabiniz pasif durumda, yoneticinize basvurun');

        const ok = await hasher.verify(input.password, account.passwordHash);
        if (!ok) throw unauthenticated('Kiraci, e-posta veya sifre hatali');

        await repos.users.touchLastLogin(account.id);
        authLog.info({ userId: account.id, tenantId: account.tenantId }, 'Giris basarili');

        return issueSession(repos, { ...toAuthUser(account), tenantSlug: tenant.slug }, input.userAgent);
      });
    },

    /**
     * Refresh token rotasyonu: eski token iptal edilir, yenisi verilir.
     * Iptal edilmis bir token tekrar gelirse token calinmis sayilir ve
     * kullanicinin tum oturumlari kapatilir.
     */
    async refresh(handle: string, userAgent?: string): Promise<SessionResult> {
      const parsed = parseRefreshHandle(handle);
      if (!parsed) throw unauthenticated('Oturum yenilenemedi');

      const tenant = await tenants.findById(parsed.tenantId);
      if (!tenant || !tenant.isActive) throw unauthenticated('Oturum yenilenemedi');

      return tx.run(tenant.id, async (repos) => {
        const stored = await repos.refreshTokens.findByHashForUpdate(tokens.hashRefreshToken(parsed.token));
        if (!stored) throw unauthenticated('Oturum yenilenemedi');

        if (stored.revokedAt) {
          await repos.refreshTokens.revokeAllForUser(stored.userId);
          authLog.warn({ userId: stored.userId }, 'Iptal edilmis refresh token kullanildi, oturumlar kapatildi');
          throw unauthenticated('Oturum gecersiz kilindi, tekrar giris yapin');
        }

        if (stored.expiresAt.getTime() <= clock.now().getTime()) throw unauthenticated('Oturum suresi doldu');

        const account = await repos.users.findAccountById(stored.userId);
        if (!account || !account.isActive) throw unauthenticated('Kullanici bulunamadi veya pasif');

        await repos.refreshTokens.revoke(stored.id);
        return issueSession(repos, { ...toAuthUser(account), tenantSlug: tenant.slug }, userAgent);
      });
    },

    /** Cikis her zaman basarili sayilir; token iptal edilemese bile istemci oturumu kapatir. */
    async logout(handle: string | undefined): Promise<void> {
      const parsed = handle ? parseRefreshHandle(handle) : null;
      if (!parsed) return;

      await tx
        .run(parsed.tenantId, (repos) => repos.refreshTokens.revokeByHash(tokens.hashRefreshToken(parsed.token)))
        .catch((err: unknown) => authLog.warn({ err }, 'Cikis sirasinda token iptal edilemedi'));
    },
  };
}

function toAuthUser(account: {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: AuthUser['role'];
  teamId: string | null;
}): Omit<AuthUser, 'tenantSlug'> {
  return {
    id: account.id,
    tenantId: account.tenantId,
    email: account.email,
    fullName: account.fullName,
    role: account.role,
    teamId: account.teamId,
  };
}

export type AuthUseCases = ReturnType<typeof makeAuthUseCases>;
