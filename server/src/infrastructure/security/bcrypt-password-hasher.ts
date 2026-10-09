import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../application/ports/security.js';

export function createBcryptPasswordHasher(rounds: number): PasswordHasher {
  // Sahte hash bir kez, gercek maliyet parametresiyle uretilir — elle yazilmis
  // gecersiz bir hash bcrypt'te hata firlatirdi ve sure esitlenmezdi.
  let dummyHash: Promise<string> | null = null;

  return {
    hash: (plain) => bcrypt.hash(plain, rounds),

    async verify(plain, hash) {
      if (hash) return bcrypt.compare(plain, hash);
      try {
        dummyHash ??= bcrypt.hash('sla-platform-dummy-secret', rounds);
        await bcrypt.compare(plain, await dummyHash);
      } catch {
        /* karsilastirma yalnizca zaman harcamak icindir, sonucu kullanilmaz */
      }
      return false;
    },
  };
}
