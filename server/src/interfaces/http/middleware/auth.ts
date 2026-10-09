import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TokenService } from '../../../application/ports/security.js';
import { unauthenticated } from '../../../domain/errors.js';
import type { AuthUser } from '../../../domain/identity.js';

/**
 * Authorization: Bearer <access-token> basligini dogrular ve req.auth'u doldurur.
 * Kiraci kimligi ISTEMCIDEN DEGIL, imzalanmis token'dan gelir.
 */
export function makeRequireAuth(tokens: TokenService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      next(unauthenticated('Yetkilendirme basligi eksik'));
      return;
    }

    req.auth = tokens.verifyAccessToken(header.slice(7).trim());
    next();
  };
}

/** req.auth'u tip guvenli sekilde okur. requireAuth'tan sonra kullanilir. */
export function getAuth(req: Request): AuthUser {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
