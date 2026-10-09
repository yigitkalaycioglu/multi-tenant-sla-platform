import type { Request, Response } from 'express';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/application/ports/runtime.js';
import { DomainError, forbidden, type ErrorKind } from '../../src/domain/errors.js';
import { HTTP_ERRORS, makeErrorHandler } from '../../src/interfaces/http/error-handler.js';
import { getAuth } from '../../src/interfaces/http/middleware/auth.js';
import { offsetOf, paginationSchema, parseOrThrow } from '../../src/interfaces/http/validation.js';

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    return err as DomainError;
  }
  throw new Error('hata bekleniyordu');
}

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

function fakeResponse() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('istek dogrulama', () => {
  const schema = z.object({ title: z.string().min(3), priority: z.enum(['low', 'high']) });

  it('gecerli veriyi dondurur', () => {
    expect(parseOrThrow(schema, { title: 'Odeme hatasi', priority: 'high' })).toEqual({
      title: 'Odeme hatasi',
      priority: 'high',
    });
  });

  it('gecersiz veride alan bazli "invalid" hatasi firlatir', () => {
    const err = errorOf(() => parseOrThrow(schema, { title: 'a', priority: 'x' }, 'Bilet'));
    expect(err.kind).toBe('invalid');
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

describe('domain hatalarinin HTTP yanitina cevrilmesi', () => {
  it('her hata turunun bir HTTP karsiligi vardir ve API kodlari sabittir', () => {
    const expected: Record<ErrorKind, [number, string]> = {
      invalid: [400, 'BAD_REQUEST'],
      unauthenticated: [401, 'UNAUTHORIZED'],
      forbidden: [403, 'FORBIDDEN'],
      not_found: [404, 'NOT_FOUND'],
      conflict: [409, 'CONFLICT'],
      rate_limited: [429, 'RATE_LIMITED'],
    };
    for (const [kind, [status, code]] of Object.entries(expected)) {
      expect(HTTP_ERRORS[kind as ErrorKind]).toEqual({ status, code });
    }
  });

  it('domain hatasi kendi durum koduyla doner', () => {
    const res = fakeResponse();
    makeErrorHandler(silentLog, false)(forbidden('Yok'), { path: '/x' } as Request, res as unknown as Response, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'FORBIDDEN', message: 'Yok', details: undefined } });
  });

  it('beklenmeyen hata 500 olur ve ayrintisi uretimde gizlenir', () => {
    const res = fakeResponse();
    makeErrorHandler(silentLog, false)(new Error('gizli'), { path: '/x' } as Request, res as unknown as Response, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL', message: 'Sunucu hatasi' } });
  });

  it('oturum yoksa "unauthenticated" hatasi firlatilir', () => {
    expect(errorOf(() => getAuth({} as Request)).kind).toBe('unauthenticated');
  });
});
