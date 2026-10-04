import pg from 'pg';
import { env } from '../config/env.js';
import { dbLogger } from '../lib/logger.js';

const { Pool, types } = pg;

// bigint (int8) ve numeric alanlari JS number olarak al: COUNT/AVG sonuclari
// aksi halde string doner ve JSON'da tirnakli cikar.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.PoolClient;
export type Queryable = Pick<pg.PoolClient, 'query'>;

/** RLS zorunlu, dusuk yetkili uygulama baglantisi (API tarafi). */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'sla-api',
});

/**
 * Kiracilar arasi (sistem seviyesi) islerin baglantisi: migration, seed ve
 * SLA tarayici worker'i bunu kullanir. RLS'i asar, bu yuzden HTTP istek
 * yolunda ASLA kullanilmaz.
 */
export const adminPool = new Pool({
  connectionString: env.DATABASE_ADMIN_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'sla-system',
});

pool.on('error', (err) => dbLogger.error({ err }, 'Beklenmeyen pool hatasi (app)'));
adminPool.on('error', (err) => dbLogger.error({ err }, 'Beklenmeyen pool hatasi (admin)'));

/**
 * Kiraci kapsamli transaction.
 *
 * Transaction basinda `app.tenant_id` oturum degiskenini LOCAL olarak set eder;
 * RLS politikalari bu degeri okur. Boylece fn icindeki her sorgu otomatik
 * olarak yalnizca ilgili kiracinin satirlarini gorur.
 */
export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Kiraci baglami gerektirmeyen (tenants tablosu vb.) tekil sorgu. */
export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<R>> {
  return pool.query<R>(text, params as never[]);
}

/** Sistem seviyesi (kiracilar arasi) transaction — yalnizca worker/migration. */
export async function withSystemTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.allSettled([pool.end(), adminPool.end()]);
}
