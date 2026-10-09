/**
 * TenantTransactions portunun PostgreSQL + Row Level Security uygulamasi.
 *
 * Kiraci izolasyonunun asil garantisi buradadir: her is birimi dusuk yetkili
 * (NOBYPASSRLS) baglantida, `app.tenant_id` set edilmis bir transaction icinde
 * calisir. Bir depoda `WHERE tenant_id = ...` unutulsa bile baska kiracinin
 * satiri donmez.
 */
import type pg from 'pg';
import type {
  Tenant,
  TenantDirectory,
  TenantRepositories,
  TenantTransactions,
} from '../../application/ports/transactions.js';
import { translateDbErrors } from './db-errors.js';
import { setTenantContext, withTenant, withTransaction, type Queryable } from './pool.js';
import { createRefreshTokenRepository } from './repositories/refresh-token.repository.js';
import { createReportRepository } from './repositories/report.repository.js';
import { createSlaPolicyRepository } from './repositories/sla-policy.repository.js';
import { createTeamRepository } from './repositories/team.repository.js';
import { createTicketRepository } from './repositories/ticket.repository.js';
import { createUserRepository } from './repositories/user.repository.js';

interface TenantRow {
  id: string;
  slug: string;
  is_active: boolean;
}

const toTenant = (r: TenantRow): Tenant => ({ id: r.id, slug: r.slug, isActive: r.is_active });

export function createTenantRepositories(db: Queryable, tenantId: string): TenantRepositories {
  return {
    tickets: createTicketRepository(db, tenantId),
    slaPolicies: createSlaPolicyRepository(db, tenantId),
    users: createUserRepository(db, tenantId),
    teams: createTeamRepository(db, tenantId),
    refreshTokens: createRefreshTokenRepository(db, tenantId),
    reports: createReportRepository(db),
  };
}

export function createTenantTransactions(appPool: pg.Pool): TenantTransactions {
  return {
    run(tenantId, work) {
      return translateDbErrors(() =>
        withTenant(appPool, tenantId, (db) => work(createTenantRepositories(db, tenantId))),
      );
    },

    runForNewTenant(input, work) {
      return translateDbErrors(() =>
        withTransaction(appPool, async (db) => {
          // `tenants` tablosunda RLS yoktur; kiraci satiri olustuktan hemen sonra
          // ayni transaction'da onun baglamina gecilir ve kalan INSERT'ler RLS
          // politikasindan gecer.
          const inserted = await db.query<TenantRow>(
            'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id, slug, is_active',
            [input.slug, input.name],
          );
          const tenant = toTenant(inserted.rows[0]!);

          await setTenantContext(db, tenant.id);
          await db.query('INSERT INTO ticket_counters (tenant_id) VALUES ($1)', [tenant.id]);

          return work(tenant, createTenantRepositories(db, tenant.id));
        }),
      );
    },
  };
}

export function createTenantDirectory(appPool: pg.Pool): TenantDirectory {
  const findOne = (where: string, value: string) =>
    translateDbErrors(async () => {
      const { rows } = await appPool.query<TenantRow>(`SELECT id, slug, is_active FROM tenants WHERE ${where} = $1`, [
        value,
      ]);
      return rows[0] ? toTenant(rows[0]) : null;
    });

  return {
    findBySlug: (slug) => findOne('slug', slug),
    findById: (id) => findOne('id', id),
  };
}
