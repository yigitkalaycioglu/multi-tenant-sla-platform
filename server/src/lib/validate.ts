import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

/**
 * Zod semasini uygular; hata durumunda alan bazli 400 dondurur.
 *
 * Express 5'te `req.query` salt-okunur bir getter oldugu icin middleware ile
 * yerine yazmak yerine handler icinde acikca dogrulariz — hem tip guvenli
 * hem de hangi verinin dogrulandigi okurken belli olur.
 */
export function parseOrThrow<T extends ZodTypeAny>(schema: T, data: unknown, label = 'Istek'): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw badRequest(`${label} dogrulanamadi`, fieldErrors);
  }
  return result.data;
}

export const uuid = z.string().uuid('Gecerli bir kimlik degil');

/** Sayfalama parametreleri. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function offsetOf(p: Pagination): number {
  return (p.page - 1) * p.pageSize;
}
