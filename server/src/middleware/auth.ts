import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/tokens.js';
import { unauthorized } from '../lib/errors.js';
import type { AuthUser } from '../types/domain.js';

/**
 * Authorization: Bearer <access-token> basligini dogrular ve req.auth'u doldurur.
 * Kiraci kimligi ISTEMCIDEN DEGIL, imzalanmis token'dan gelir.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Yetkilendirme basligi eksik'));
    return;
  }

  const claims = verifyAccessToken(header.slice(7).trim());
  req.auth = {
    id: claims.sub,
    tenantId: claims.tid,
    tenantSlug: claims.slug,
    role: claims.role,
    teamId: claims.team,
    email: claims.email,
    fullName: claims.name,
  };
  next();
}

/** req.auth'u tip guvenli sekilde okur. requireAuth'tan sonra kullanilir. */
export function getAuth(req: Request): AuthUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
