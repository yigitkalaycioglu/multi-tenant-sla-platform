import type { AuthUser } from '../../domain/identity.js';

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /**
   * Sifreyi dogrular. `hash` null verilirse (kullanici yok) yine de ayni
   * maliyette bir karsilastirma yapip false doner: "hesap yok" yaniti gecerli
   * bir hesaba gore belirgin hizli donerse saldirgan hesaplari sayabilir.
   */
  verify(plain: string, hash: string | null): Promise<boolean>;
}

export interface IssuedRefreshToken {
  /** Istemciye verilen ham deger. */
  token: string;
  /** Veritabaninda yalnizca bu ozet saklanir. */
  hash: string;
  expiresAt: Date;
}

export interface TokenService {
  issueAccessToken(user: AuthUser): string;
  /** Gecersiz ya da suresi dolmus token'da `unauthenticated` hatasi firlatir. */
  verifyAccessToken(token: string): AuthUser;
  issueRefreshToken(now: Date): IssuedRefreshToken;
  hashRefreshToken(token: string): string;
}
