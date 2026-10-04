import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors.js';
import { getAuth } from './auth.js';
import type { UserRole } from '../types/domain.js';

/**
 * Rol Tabanli Erisim Kontrolu (RBAC).
 *
 *  admin      -> kiraci icinde her sey: kullanici/ekip/SLA politikasi yonetimi,
 *                tum biletler, tum raporlar.
 *  team_lead  -> kendi ekibinin biletleri: atama, oncelik, durum; ekip raporlari.
 *                Kullanici olusturamaz, SLA politikasi degistiremez.
 *  developer  -> kendisine ya da ekibine atanmis biletleri gorur; kendi
 *                biletinin durumunu gunceller, yorum yazar.
 */
export const PERMISSIONS = {
  'tenant:manage': ['admin'],
  'user:manage': ['admin'],
  'team:manage': ['admin'],
  'sla:manage': ['admin'],
  'ticket:create': ['admin', 'team_lead', 'developer'],
  'ticket:assign': ['admin', 'team_lead'],
  'ticket:delete': ['admin'],
  'ticket:update-any': ['admin', 'team_lead'],
  'report:view-all': ['admin', 'team_lead'],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** Belirtilen rollerden birine sahip olmayi zorunlu kilar. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    if (!roles.includes(auth.role)) {
      next(forbidden(`Bu islem icin gerekli rol: ${roles.join(' veya ')}`));
      return;
    }
    next();
  };
}

/** Belirtilen izni zorunlu kilar. */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    if (!can(auth.role, permission)) {
      next(forbidden('Bu islem icin yetkiniz yok'));
      return;
    }
    next();
  };
}
