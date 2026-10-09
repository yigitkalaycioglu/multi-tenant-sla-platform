import type { RefreshTokenRepository } from '../../../application/auth/auth.ports.js';
import type { Queryable } from '../pool.js';

export function createRefreshTokenRepository(db: Queryable, tenantId: string): RefreshTokenRepository {
  return {
    async insert(t) {
      await db.query(
        `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, t.userId, t.tokenHash, t.userAgent, t.expiresAt],
      );
    },

    async findByHashForUpdate(tokenHash) {
      const { rows } = await db.query<{ id: string; user_id: string; revoked_at: Date | null; expires_at: Date }>(
        'SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      );
      const r = rows[0];
      return r ? { id: r.id, userId: r.user_id, revokedAt: r.revoked_at, expiresAt: r.expires_at } : null;
    },

    async revoke(id) {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [id]);
    },

    async revokeAllForUser(userId) {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
        userId,
      ]);
    },

    async revokeByHash(tokenHash) {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
        tokenHash,
      ]);
    },
  };
}
