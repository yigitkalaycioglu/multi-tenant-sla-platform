import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../application/ports/runtime.js';
import { DomainError, notFound, type ErrorKind } from '../../domain/errors.js';

/**
 * Domain hata turu -> HTTP yaniti.
 *
 * HTTP'ye ozgu bilgi yalnizca burada yasar. `code` degerleri istemcinin
 * dayandigi API sozlesmesidir; degistirilmemelidir.
 */
export const HTTP_ERRORS: Record<ErrorKind, { status: number; code: string }> = {
  invalid: { status: 400, code: 'BAD_REQUEST' },
  unauthenticated: { status: 401, code: 'UNAUTHORIZED' },
  forbidden: { status: 403, code: 'FORBIDDEN' },
  not_found: { status: 404, code: 'NOT_FOUND' },
  conflict: { status: 409, code: 'CONFLICT' },
  rate_limited: { status: 429, code: 'RATE_LIMITED' },
};

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(notFound('Uc nokta bulunamadi'));
}

/**
 * Merkezi hata yakalayici.
 * Express 5 async handler'lardaki reddedilen promise'leri buraya iletir,
 * bu yuzden route'larda try/catch tekrarina gerek yoktur.
 */
export function makeErrorHandler(log: Logger, exposeDebug: boolean) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof DomainError) {
      const { status, code } = HTTP_ERRORS[err.kind];
      log.debug({ code, path: req.path }, err.message);
      res.status(status).json({ error: { code, message: err.message, details: err.details } });
      return;
    }

    // Express'in kendi istemci hatalari (bozuk JSON, buyuk govde, gecersiz URL
    // kodlamasi) `status` ve `expose` tasir; bunlar sunucu hatasi degildir.
    const clientError = err as { status?: unknown; expose?: unknown };
    if (typeof clientError.status === 'number' && clientError.status >= 400 && clientError.status < 500 && clientError.expose) {
      const tooLarge = clientError.status === 413;
      log.debug({ status: clientError.status, path: req.path }, 'Gecersiz istek');
      res.status(clientError.status).json({
        error: {
          code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
          message: tooLarge ? 'Istek govdesi cok buyuk' : 'Istek govdesi ya da adresi gecersiz',
        },
      });
      return;
    }

    log.error({ err, path: req.path, method: req.method }, 'Beklenmeyen sunucu hatasi');
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Sunucu hatasi',
        ...(exposeDebug ? { debug: err instanceof Error ? err.message : String(err) } : {}),
      },
    });
  };
}
