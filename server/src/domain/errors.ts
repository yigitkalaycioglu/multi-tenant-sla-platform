/**
 * Is kurali ihlallerini anlatan hata tipi.
 *
 * Bilerek HTTP durum kodu TASIMAZ: ayni kural bir HTTP isteginden, worker'dan
 * ya da bir birim testinden tetiklenebilir. Hangi turun hangi HTTP yanitina
 * donusecegine sunum katmani karar verir (interfaces/http/error-handler.ts).
 */
export type ErrorKind = 'invalid' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited';

export class DomainError extends Error {
  readonly kind: ErrorKind;
  readonly details?: unknown;

  constructor(kind: ErrorKind, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
    this.details = details;
  }
}

export const invalid = (msg: string, details?: unknown) => new DomainError('invalid', msg, details);
export const unauthenticated = (msg = 'Kimlik dogrulanamadi') => new DomainError('unauthenticated', msg);
export const forbidden = (msg = 'Bu islem icin yetkiniz yok') => new DomainError('forbidden', msg);
export const notFound = (msg = 'Kayit bulunamadi') => new DomainError('not_found', msg);
export const conflict = (msg: string, details?: unknown) => new DomainError('conflict', msg, details);
export const rateLimited = (msg = 'Cok fazla istek gonderildi') => new DomainError('rate_limited', msg);
