import type { AuthUser } from '../../domain/identity.js';

declare global {
  namespace Express {
    interface Request {
      /** requireAuth middleware'i tarafindan doldurulur. */
      auth?: AuthUser;
      /** Istek kimligi (log korelasyonu). */
      id?: string;
    }
  }
}

export {};
