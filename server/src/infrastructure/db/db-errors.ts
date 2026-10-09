import { conflict, DomainError, forbidden, invalid } from '../../domain/errors.js';

/**
 * PostgreSQL hata kodlarini domain hatalarina cevirir.
 *
 * Ceviri burada, veritabani adaptorunde yapilir: ust katmanlar SQLSTATE
 * kodlarini ya da kisit adlarini bilmez, yalnizca "cakisma" veya "gecersiz
 * veri" gibi anlamli bir hata gorur.
 */
export function mapDbError(err: unknown): DomainError | null {
  const e = err as { code?: string; constraint?: string };
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
      return invalid('Iliskili kayit bulunamadi (foreign key ihlali).', { constraint: e.constraint });
    case '23514':
      return invalid('Veri dogrulama kurali ihlal edildi.', { constraint: e.constraint });
    case '22P02':
      return invalid('Gecersiz deger formati.');
    case '42501':
      return forbidden('Veritabani seviyesinde erisim reddedildi (RLS).');
    default:
      return null;
  }
}

/** Bilinen veritabani hatalarini cevirir, digerlerini oldugu gibi yeniden firlatir. */
export async function translateDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw mapDbError(err) ?? err;
  }
}
