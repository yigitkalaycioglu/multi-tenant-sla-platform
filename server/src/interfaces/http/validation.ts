import { z, type ZodTypeAny } from 'zod';
import { invalid } from '../../domain/errors.js';

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
    throw invalid(`${label} dogrulanamadi`, fieldErrors);
  }
  return result.data;
}

export const uuid = z.string().uuid('Gecerli bir kimlik degil');

/** Kayit ve kullanici olusturmada ortak sifre kurali. */
export const passwordSchema = z
  .string()
  .min(8, 'Sifre en az 8 karakter olmali')
  .max(128)
  .regex(/[A-Za-z]/, 'Sifre en az bir harf icermeli')
  .regex(/[0-9]/, 'Sifre en az bir rakam icermeli');

/** Sayfalama parametreleri. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function offsetOf(p: Pagination): number {
  return (p.page - 1) * p.pageSize;
}
