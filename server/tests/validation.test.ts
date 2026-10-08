import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AppError, mapDbError } from '../src/lib/errors.js';
import { offsetOf, paginationSchema, parseOrThrow } from '../src/lib/validate.js';

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error('hata bekleniyordu');
}

describe('istek dogrulama', () => {
  const schema = z.object({ title: z.string().min(3), priority: z.enum(['low', 'high']) });

  it('gecerli veriyi dondurur', () => {
    expect(parseOrThrow(schema, { title: 'Odeme hatasi', priority: 'high' })).toEqual({
      title: 'Odeme hatasi',
      priority: 'high',
    });
  });

  it('gecersiz veride alan bazli 400 firlatir', () => {
    const err = errorOf(() => parseOrThrow(schema, { title: 'a', priority: 'x' }, 'Bilet'));
    expect(err.status).toBe(400);
    expect(err.message).toBe('Bilet dogrulanamadi');
    const fields = (err.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(['priority', 'title']);
  });
});

describe('sayfalama', () => {
  it('varsayilan degerleri kullanir', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('query string degerlerini sayiya cevirir', () => {
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('100 den buyuk sayfa boyutunu reddeder', () => {
    expect(paginationSchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('offseti sayfa numarasindan hesaplar', () => {
    expect(offsetOf({ page: 3, pageSize: 20 })).toBe(40);
  });
});

describe('veritabani hatalarinin HTTP yanitina cevrilmesi', () => {
  it('bilinen unique kisitlari anlasilir bir 409 mesajina cevrilir', () => {
    const err = mapDbError({ code: '23505', constraint: 'users_tenant_email_uniq' });
    expect(err?.status).toBe(409);
    expect(err?.message).toBe('Bu e-posta adresi bu kiracida zaten kayitli.');
  });

  it('bilinmeyen unique kisitlari genel mesajla 409 olur', () => {
    expect(mapDbError({ code: '23505', constraint: 'baska_bir_kisit' })?.message).toBe('Kayit zaten mevcut.');
  });

  it('RLS reddi 403, kisit ve format hatalari 400 olur', () => {
    expect(mapDbError({ code: '42501' })?.status).toBe(403);
    expect(mapDbError({ code: '23503' })?.status).toBe(400);
    expect(mapDbError({ code: '23514' })?.status).toBe(400);
    expect(mapDbError({ code: '22P02' })?.status).toBe(400);
  });

  it('veritabani hatasi olmayanlar icin null doner', () => {
    expect(mapDbError(new Error('baska bir hata'))).toBeNull();
    expect(mapDbError({ code: '99999' })).toBeNull();
    expect(mapDbError(undefined)).toBeNull();
  });
});
