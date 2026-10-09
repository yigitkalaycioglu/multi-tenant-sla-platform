import { forbidden } from './errors.js';

export const USER_ROLES = ['admin', 'team_lead', 'developer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Oturum acmis kullanici; kiraci kimligi imzali token'dan gelir, istemciden degil. */
export interface AuthUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
}

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

/** Ekip lideri olarak yalnizca bu rollerdeki aktif kullanicilar secilebilir. */
export const TEAM_LEAD_ROLES: readonly UserRole[] = ['admin', 'team_lead'];

/**
 * Kaba taneli izin kontrolu. Use case'ler bunu ilk satirda cagirir; boylece
 * kural HTTP disindan (worker, betik, test) cagrildiginda da gecerlidir.
 */
export function assertPermission(actor: Pick<AuthUser, 'role'>, permission: Permission): void {
  if (!can(actor.role, permission)) throw forbidden('Bu islem icin yetkiniz yok');
}
