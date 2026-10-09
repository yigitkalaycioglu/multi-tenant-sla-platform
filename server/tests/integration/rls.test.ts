import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Logger } from '../../src/application/ports/runtime.js';
import { createPool, withTenant } from '../../src/infrastructure/db/pool.js';
import { createTenantTransactions } from '../../src/infrastructure/db/tenant-transactions.js';

// Bu testler gercek bir PostgreSQL ister. CI'da Postgres servisiyle calisir;
// yerelde `npm run migrate` sonrasi RUN_DB_TESTS=1 ile `npm run test:db`.
const enabled = process.env.RUN_DB_TESTS === '1';

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

describe.skipIf(!enabled)('kiraci izolasyonu (PostgreSQL RLS)', () => {
  const pool = createPool(
    { connectionString: process.env.DATABASE_URL!, max: 2, applicationName: 'rls-test' },
    silentLog,
  );
  const adminPool = createPool(
    { connectionString: process.env.DATABASE_ADMIN_URL!, max: 2, applicationName: 'rls-test-admin' },
    silentLog,
  );

  const slugs = ['rls-test-a', 'rls-test-b'];
  let tenantA = '';
  let tenantB = '';
  let ticketB = '';

  beforeAll(async () => {
    await adminPool.query('DELETE FROM tenants WHERE slug = ANY($1)', [slugs]);

    const tenants = await adminPool.query<{ id: string; slug: string }>(
      `INSERT INTO tenants (slug, name) VALUES ($1, 'RLS Test A'), ($2, 'RLS Test B') RETURNING id, slug`,
      slugs,
    );
    tenantA = tenants.rows.find((r) => r.slug === 'rls-test-a')!.id;
    tenantB = tenants.rows.find((r) => r.slug === 'rls-test-b')!.id;

    const tickets = await adminPool.query<{ id: string; tenant_id: string }>(
      `INSERT INTO tickets (tenant_id, reference, title)
       VALUES ($1, 'TCK-000001', 'A kiracisinin bileti'), ($2, 'TCK-000001', 'B kiracisinin bileti')
       RETURNING id, tenant_id`,
      [tenantA, tenantB],
    );
    ticketB = tickets.rows.find((r) => r.tenant_id === tenantB)!.id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM tenants WHERE slug = ANY($1)', [slugs]);
    await Promise.allSettled([pool.end(), adminPool.end()]);
  });

  it('uygulama rolu RLS i asamaz', async () => {
    const { rows } = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('kiraci sadece kendi biletlerini gorur', async () => {
    const titles = await withTenant(pool, tenantA, async (db) => {
      const { rows } = await db.query<{ title: string }>('SELECT title FROM tickets');
      return rows.map((r) => r.title);
    });
    expect(titles).toEqual(['A kiracisinin bileti']);
  });

  it('baska kiracinin biletine id ile de ulasilamaz', async () => {
    const found = await withTenant(pool, tenantA, async (db) => {
      const { rowCount } = await db.query('SELECT 1 FROM tickets WHERE id = $1', [ticketB]);
      return rowCount;
    });
    expect(found).toBe(0);
  });

  it('depo katmani da gorunurluk kapsami ne olursa olsun baska kiracinin biletini bulamaz', async () => {
    // Yonetici kapsami ("tum biletler") bile kiraci sinirini asamaz: sinir RLS'te.
    const record = await createTenantTransactions(pool).run(tenantA, ({ tickets }) =>
      tickets.findRecord(ticketB, { scope: 'tenant' }),
    );
    expect(record).toBeNull();
  });

  it('baska kiracinin biletini guncelleyemez', async () => {
    const updated = await withTenant(pool, tenantA, async (db) => {
      const { rowCount } = await db.query(`UPDATE tickets SET title = 'degisti' WHERE id = $1`, [ticketB]);
      return rowCount;
    });
    expect(updated).toBe(0);

    const { rows } = await adminPool.query<{ title: string }>('SELECT title FROM tickets WHERE id = $1', [ticketB]);
    expect(rows[0]?.title).toBe('B kiracisinin bileti');
  });

  it('baska kiraci adina kayit ekleyemez', async () => {
    await expect(
      withTenant(pool, tenantA, (db) =>
        db.query(`INSERT INTO tickets (tenant_id, reference, title) VALUES ($1, 'TCK-999999', 'sizma denemesi')`, [
          tenantB,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('kiraci ayari transaction bitince baglantida kalmaz', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantA]);
      await client.query('COMMIT');

      const { rows } = await client.query<{ v: string }>(
        `SELECT coalesce(current_setting('app.tenant_id', true), '') AS v`,
      );
      expect(rows[0]?.v).toBe('');
    } finally {
      client.release();
    }
  });

  it('kiraci baglami olmadan satir sizmaz', async () => {
    // Ayar hic yapilmamissa sorgu bos doner; baglanti daha once kullanildiysa ayar bos
    // metin olur ve uuid donusumu hata verir. Iki durumda da veri gorunmez.
    const result = await pool.query('SELECT 1 FROM tickets').then(
      (r) => r.rowCount,
      (err: { code?: string }) => err.code,
    );
    expect([0, '22P02']).toContain(result);
  });
});
