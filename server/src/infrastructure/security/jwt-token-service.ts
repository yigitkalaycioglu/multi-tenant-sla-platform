import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { TokenService } from '../../application/ports/security.js';
import { unauthenticated } from '../../domain/errors.js';
import type { AuthUser, UserRole } from '../../domain/identity.js';

/** Access token icindeki kisa alan adlari (token boyutunu kucuk tutar). */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  slug: string;
  role: UserRole;
  team: string | null;
  email: string;
  name: string;
}

export interface JwtConfig {
  accessSecret: string;
  /** jsonwebtoken bicimi, orn. "15m". */
  accessTtl: string;
  refreshTtlDays: number;
}

const ISSUER = 'sla-platform';
const AUDIENCE = 'sla-platform-web';

export function createJwtTokenService(config: JwtConfig): TokenService {
  const hashRefreshToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

  return {
    issueAccessToken(user: AuthUser) {
      const claims: AccessTokenClaims = {
        sub: user.id,
        tid: user.tenantId,
        slug: user.tenantSlug,
        role: user.role,
        team: user.teamId,
        email: user.email,
        name: user.fullName,
      };
      return jwt.sign(claims, config.accessSecret, {
        expiresIn: config.accessTtl as jwt.SignOptions['expiresIn'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    },

    verifyAccessToken(token) {
      let claims: AccessTokenClaims;
      try {
        claims = jwt.verify(token, config.accessSecret, { issuer: ISSUER, audience: AUDIENCE }) as AccessTokenClaims;
      } catch (err) {
        const expired = err instanceof jwt.TokenExpiredError;
        throw unauthenticated(expired ? 'Oturum suresi doldu' : 'Gecersiz oturum belirteci');
      }
      return {
        id: claims.sub,
        tenantId: claims.tid,
        tenantSlug: claims.slug,
        role: claims.role,
        teamId: claims.team,
        email: claims.email,
        fullName: claims.name,
      };
    },

    /** Refresh token: rastgele 48 bayt. Veritabaninda yalnizca SHA-256 ozeti saklanir. */
    issueRefreshToken(now) {
      const token = crypto.randomBytes(48).toString('base64url');
      return {
        token,
        hash: hashRefreshToken(token),
        expiresAt: new Date(now.getTime() + config.refreshTtlDays * 86_400_000),
      };
    },

    hashRefreshToken,
  };
}
