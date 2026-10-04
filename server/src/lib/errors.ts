/** Uygulama genelinde kullanilan, HTTP durum kodu tasiyan hata tipi. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Kimlik dogrulanamadi') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Bu islem icin yetkiniz yok') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Kayit bulunamadi') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
export const tooManyRequests = (msg = 'Cok fazla istek gonderildi') => new AppError(429, 'RATE_LIMITED', msg);

/** PostgreSQL hata kodlarini anlamli HTTP yanitlarina cevirir. */
export function mapDbError(err: unknown): AppError | null {
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (!e?.code) return null;

  switch (e.code) {
    case '23505': {
      const byConstraint: Record<string, string> = {
        tenants_slug_key: 'Bu kiraci kisa adi (slug) zaten kullaniliyor.',
        users_tenant_email_uniq: 'Bu e-posta adresi bu kiracida zaten kayitli.',
        teams_tenant_name_uniq: 'Bu isimde bir ekip zaten var.',
        sla_policy_tenant_priority_uniq: 'Bu oncelik icin zaten bir SLA politikasi tanimli.',
        tickets_tenant_reference_uniq: 'Bilet referansi cakisti, tekrar deneyin.',
      };
      return conflict(byConstraint[e.constraint ?? ''] ?? 'Kayit zaten mevcut.', { constraint: e.constraint });
    }
    case '23503':
      return badRequest('Iliskili kayit bulunamadi (foreign key ihlali).', { constraint: e.constraint });
    case '23514':
      return badRequest('Veri dogrulama kurali ihlal edildi.', { constraint: e.constraint });
    case '22P02':
      return badRequest('Gecersiz deger formati.');
    case '42501':
      return forbidden('Veritabani seviyesinde erisim reddedildi (RLS).');
    default:
      return null;
  }
}
