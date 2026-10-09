import type { UserRole } from '../../domain/identity.js';

/** Kimlik dogrulama icin kullanici (sifre ozetiyle birlikte). */
export interface UserAccount {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
  passwordHash: string;
  isActive: boolean;
}

/** Yonetim ekrani icin kullanici + ekip adi ve is yuku. */
export interface UserRecord {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  teamId: string | null;
  teamName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  openTicketCount: number;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
}

export interface UserPatch {
  fullName?: string;
  role?: UserRole;
  /** null: ekipten cikar; undefined: dokunma. */
  teamId?: string | null;
  isActive?: boolean;
}

export interface UserRepository {
  findAccountByEmail(email: string): Promise<UserAccount | null>;
  findAccountById(id: string): Promise<UserAccount | null>;
  touchLastLogin(id: string): Promise<void>;
  /** Aktif kullanicinin e-postasi; kullanici yoksa ya da pasifse null. */
  findActiveEmail(id: string): Promise<string | null>;
  /** Aktif kullanicinin rolu; kullanici yoksa ya da pasifse null. */
  findActiveRole(id: string): Promise<UserRole | null>;

  list(options: { includeInactive: boolean }): Promise<UserRecord[]>;
  findRecord(id: string): Promise<UserRecord | null>;
  insert(user: NewUser): Promise<string>;
  /** Kullanici yoksa false doner. */
  update(id: string, patch: UserPatch): Promise<boolean>;
  countActiveAdminsExcept(id: string): Promise<number>;
  /** Kullanici henuz bir ekipte degilse bu ekibe ekler. */
  joinTeamIfUnassigned(userId: string, teamId: string): Promise<void>;
}
