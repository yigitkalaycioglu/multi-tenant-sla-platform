import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import type { AuthUser } from '../../src/domain/identity.js';
import { createJwtTokenService } from '../../src/infrastructure/security/jwt-token-service.js';

const SECRET = 'test-access-secret-0123456789';
const tokens = createJwtTokenService({ accessSecret: SECRET, accessTtl: '15m', refreshTtlDays: 7 });

const user: AuthUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'kuzey',
  role: 'developer',
  teamId: null,
  email: 'burak@kuzey.io',
  fullName: 'Burak Sahin',
};

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    return err as DomainError;
  }
  throw new Error('hata bekleniyordu');
}

describe('access token', () => {
  it('imzalanan token dogrulaninca ayni kullaniciyi dondurur', () => {
    expect(tokens.verifyAccessToken(tokens.issueAccessToken(user))).toEqual(user);
  });

  it('icerigi degistirilen token reddedilir', () => {
    const [header, , signature] = tokens.issueAccessToken(user).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: user.id, tid: user.tenantId, role: 'admin' })).toString(
      'base64url',
    );

    const err = errorOf(() => tokens.verifyAccessToken(`${header}.${forged}.${signature}`));
    expect(err).toBeInstanceOf(DomainError);
    expect(err.kind).toBe('unauthenticated');
  });

  it('baska bir anahtarla imzalanan token reddedilir', () => {
    const token = jwt.sign({ sub: user.id }, 'baska-bir-anahtar-0123456789', {
      issuer: 'sla-platform',
      audience: 'sla-platform-web',
    });
    expect(errorOf(() => tokens.verifyAccessToken(token)).message).toBe('Gecersiz oturum belirteci');
  });

  it('suresi dolan token icin ayri mesaj verir', () => {
    const token = jwt.sign({ sub: user.id, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET, {
      issuer: 'sla-platform',
      audience: 'sla-platform-web',
    });
    expect(errorOf(() => tokens.verifyAccessToken(token)).message).toBe('Oturum suresi doldu');
  });
});

describe('refresh token', () => {
  it('veritabanina tokenin kendisi degil SHA-256 ozeti yazilir', () => {
    const { token, hash } = tokens.issueRefreshToken(new Date());
    expect(hash).toBe(tokens.hashRefreshToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('her seferinde farkli token uretir', () => {
    const now = new Date();
    expect(tokens.issueRefreshToken(now).token).not.toBe(tokens.issueRefreshToken(now).token);
  });

  it('gecerlilik suresi ayarlanan gun sayisi kadar ileridedir', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(tokens.issueRefreshToken(from).expiresAt.getTime() - from.getTime()).toBe(7 * 86_400_000);
  });
});
