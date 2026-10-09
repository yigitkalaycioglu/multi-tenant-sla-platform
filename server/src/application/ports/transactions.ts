import type { TicketRepository } from '../tickets/ticket.ports.js';
import type { SlaPolicyRepository } from '../sla/sla-policy.ports.js';
import type { UserRepository } from '../users/user.ports.js';
import type { TeamRepository } from '../teams/team.ports.js';
import type { RefreshTokenRepository } from '../auth/auth.ports.js';
import type { ReportRepository } from '../reports/report.ports.js';

/** Bir kiracinin transaction'ina bagli depolar. */
export interface TenantRepositories {
  tickets: TicketRepository;
  slaPolicies: SlaPolicyRepository;
  users: UserRepository;
  teams: TeamRepository;
  refreshTokens: RefreshTokenRepository;
  reports: ReportRepository;
}

export interface Tenant {
  id: string;
  slug: string;
  isActive: boolean;
}

/**
 * Kiraci kapsamli is birimi (unit of work).
 *
 * Use case "bu adimlar X kiracisi adina tek bir atomik islem olarak calissin"
 * der; bunun PostgreSQL'de BEGIN + set_config('app.tenant_id') + Row Level
 * Security ile saglandigini bilmez. Callback'e verilen depolar ayni
 * transaction'a baglidir; callback hata firlatirsa hepsi geri alinir.
 *
 * Kural: canli olay ve e-posta gibi yan etkiler callback'in DISINDA, yani
 * commit'ten sonra tetiklenir — geri alinan bir islem icin bildirim gitmez.
 */
export interface TenantTransactions {
  run<T>(tenantId: string, work: (repos: TenantRepositories) => Promise<T>): Promise<T>;

  /** Kiraciyi olusturur ve AYNI transaction icinde onun baglamina gecer. */
  runForNewTenant<T>(
    tenant: { slug: string; name: string },
    work: (tenant: Tenant, repos: TenantRepositories) => Promise<T>,
  ): Promise<T>;
}

/** Kiraci dizini: giristen once, kiraci baglami olmadan yapilan aramalar. */
export interface TenantDirectory {
  findBySlug(slug: string): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
}
