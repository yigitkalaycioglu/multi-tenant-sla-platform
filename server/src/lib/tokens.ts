import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';
import type { UserRole } from '../types/domain.js';

export interface AccessTokenClaims {
  sub: string;
  tid: string;
  slug: string;
  role: UserRole;
  team: string | null;
  email: string;
  name: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'sla-platform',
    audience: 'sla-platform-web',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'sla-platform',
      audience: 'sla-platform-web',
    }) as AccessTokenClaims;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw unauthorized(expired ? 'Oturum suresi doldu' : 'Gecersiz oturum belirteci');
  }
}

/** Refresh token: rastgele 48 bayt. Veritabaninda yalnizca SHA-256 ozeti saklanir. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(from = new Date()): Date {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}
