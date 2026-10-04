import type { NextFunction, Request, Response } from 'express';
import { AppError, mapDbError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(notFound('Uc nokta bulunamadi'));
}

/**
 * Merkezi hata yakalayici.
 * Express 5 async handler'lardaki reddedilen promise'leri buraya iletir,
 * bu yuzden route'larda try/catch tekrarina gerek yoktur.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = err instanceof AppError ? err : mapDbError(err);

  if (appError) {
    if (appError.status >= 500) logger.error({ err, path: req.path }, appError.message);
    else logger.debug({ code: appError.code, path: req.path }, appError.message);

    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, details: appError.details },
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Beklenmeyen sunucu hatasi');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Sunucu hatasi',
      ...(isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}
