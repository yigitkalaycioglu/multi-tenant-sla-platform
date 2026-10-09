export interface StoredRefreshToken {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

/** Refresh token kayitlari; ham token degil yalnizca ozeti saklanir. */
export interface RefreshTokenRepository {
  insert(token: { userId: string; tokenHash: string; userAgent: string | null; expiresAt: Date }): Promise<void>;
  /** Kaydi transaction sonuna kadar kilitler: ayni token'la iki eszamanli yenileme yapilamaz. */
  findByHashForUpdate(tokenHash: string): Promise<StoredRefreshToken | null>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  revokeByHash(tokenHash: string): Promise<void>;
}
