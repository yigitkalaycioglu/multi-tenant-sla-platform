import { describe, expect, it } from 'vitest';
import { mapDbError, translateDbErrors } from '../../src/infrastructure/db/db-errors.js';

describe('veritabani hatalarinin domain hatasina cevrilmesi', () => {
  it('bilinen unique kisitlari anlasilir bir "conflict" mesajina cevrilir', () => {
    const err = mapDbError({ code: '23505', constraint: 'users_tenant_email_uniq' });
    expect(err?.kind).toBe('conflict');
    expect(err?.message).toBe('Bu e-posta adresi bu kiracida zaten kayitli.');
  });

  it('bilinmeyen unique kisitlari genel mesajla "conflict" olur', () => {
    expect(mapDbError({ code: '23505', constraint: 'baska_bir_kisit' })?.message).toBe('Kayit zaten mevcut.');
  });

  it('RLS reddi "forbidden", kisit ve format hatalari "invalid" olur', () => {
    expect(mapDbError({ code: '42501' })?.kind).toBe('forbidden');
    expect(mapDbError({ code: '23503' })?.kind).toBe('invalid');
    expect(mapDbError({ code: '23514' })?.kind).toBe('invalid');
    expect(mapDbError({ code: '22P02' })?.kind).toBe('invalid');
  });

  it('veritabani hatasi olmayanlar icin null doner', () => {
    expect(mapDbError(new Error('baska bir hata'))).toBeNull();
    expect(mapDbError({ code: '99999' })).toBeNull();
    expect(mapDbError(undefined)).toBeNull();
  });

  it('adaptor bilinen hatalari cevirir, digerlerini oldugu gibi birakir', async () => {
    await expect(translateDbErrors(() => Promise.reject({ code: '42501' }))).rejects.toMatchObject({
      kind: 'forbidden',
    });
    const unknown = new Error('baglanti koptu');
    await expect(translateDbErrors(() => Promise.reject(unknown))).rejects.toBe(unknown);
  });
});
