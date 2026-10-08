import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from '../src/lib/tokens.js';

const claims: AccessTokenClaims = {
  sub: 'user-1',
  tid: 'tenant-1',
  slug: 'kuzey',
  role: 'developer',
  team: null,
  email: 'burak@kuzey.io',
  name: 'Burak Sahin',
};

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error('hata bekleniyordu');
}

describe('access token', () => {
  it('imzalanan token dogrulaninca ayni bilgileri dondurur', () => {
    expect(verifyAccessToken(signAccessToken(claims))).toMatchObject(claims);
  });

  it('icerigi degistirilen token reddedilir', () => {
    const [header, , signature] = signAccessToken(claims).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');

    const err = errorOf(() => verifyAccessToken(`${header}.${forged}.${signature}`));
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });

  it('baska bir anahtarla imzalanan token reddedilir', () => {
    const token = jwt.sign(claims, 'baska-bir-anahtar-0123456789', {
      issuer: 'sla-platform',
      audience: 'sla-platform-web',
    });
    expect(errorOf(() => verifyAccessToken(token)).message).toBe('Gecersiz oturum belirteci');
  });

  it('suresi dolan token icin ayri mesaj verir', () => {
    const token = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_ACCESS_SECRET!, {
      issuer: 'sla-platform',
      audience: 'sla-platform-web',
    });
    expect(errorOf(() => verifyAccessToken(token)).message).toBe('Oturum suresi doldu');
  });
});

describe('refresh token', () => {
  it('veritabanina tokenin kendisi degil SHA-256 ozeti yazilir', () => {
    const { token, hash } = generateRefreshToken();
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('her seferinde farkli token uretir', () => {
    expect(generateRefreshToken().token).not.toBe(generateRefreshToken().token);
  });

  it('gecerlilik suresi ayarlanan gun sayisi kadar ileridedir', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
    expect(refreshTokenExpiry(from).getTime() - from.getTime()).toBe(days * 86_400_000);
  });
});
