import { invalid, notFound } from '../../domain/errors.js';
import { assertPermission, type AuthUser, type UserRole } from '../../domain/identity.js';
import type { PasswordHasher } from '../ports/security.js';
import type { TenantTransactions } from '../ports/transactions.js';
import type { UserPatch, UserRecord } from './user.ports.js';

export interface UserDeps {
  tx: TenantTransactions;
  hasher: PasswordHasher;
}

const toDto = (r: UserRecord) => ({
  id: r.id,
  fullName: r.fullName,
  email: r.email,
  role: r.role,
  team: r.teamId ? { id: r.teamId, name: r.teamName ?? 'Bilinmiyor' } : null,
  isActive: r.isActive,
  lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
  openTicketCount: r.openTicketCount,
  createdAt: r.createdAt.toISOString(),
});

/** Pasiflestirme ya da admin disi bir role gecis, yonetici yetkisini kaldirabilir. */
const dropsAdminRights = (patch: UserPatch): boolean =>
  patch.isActive === false || (patch.role !== undefined && patch.role !== 'admin');

export function makeUserUseCases({ tx, hasher }: UserDeps) {
  return {
    /** Atama kutulari icin tum aktif kullanicilar herkese gorunur. */
    async list(actor: AuthUser, options: { includeInactive: boolean }) {
      const records = await tx.run(actor.tenantId, ({ users }) => users.list(options));
      return records.map(toDto);
    },

    async create(
      actor: AuthUser,
      input: { fullName: string; email: string; password: string; role: UserRole; teamId?: string | null },
    ) {
      assertPermission(actor, 'user:manage');
      const passwordHash = await hasher.hash(input.password);

      return tx.run(actor.tenantId, async ({ users, teams }) => {
        if (input.teamId && !(await teams.exists(input.teamId))) throw invalid('Ekip bulunamadi');

        const id = await users.insert({
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: input.role,
          teamId: input.teamId ?? null,
        });
        return toDto((await users.findRecord(id))!);
      });
    },

    async update(actor: AuthUser, userId: string, patch: UserPatch) {
      assertPermission(actor, 'user:manage');

      return tx.run(actor.tenantId, async ({ users }) => {
        // Kiracinin son aktif admin'i kilitlenemez / rolu dusurulemez.
        if (dropsAdminRights(patch)) {
          if (userId === actor.id) throw invalid('Kendi yonetici yetkinizi kaldiramazsiniz');
          if ((await users.countActiveAdminsExcept(userId)) === 0) {
            throw invalid('Kiracida en az bir aktif yonetici kalmali');
          }
        }

        if (!(await users.update(userId, patch))) throw notFound('Kullanici bulunamadi');
        return toDto((await users.findRecord(userId))!);
      });
    },
  };
}

export type UserUseCases = ReturnType<typeof makeUserUseCases>;
