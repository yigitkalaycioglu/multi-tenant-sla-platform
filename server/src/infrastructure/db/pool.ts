import pg from 'pg';
import type { Logger } from '../../application/ports/runtime.js';

const { Pool, types } = pg;

// bigint (int8) ve numeric alanlari JS number olarak al: COUNT/AVG sonuclari
// aksi halde string doner ve JSON'da tirnakli cikar.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.PoolClient;
export type Queryable = Pick<pg.PoolClient, 'query'>;

/**
 * Iki tur baglanti vardir ve her surec yalnizca ihtiyac duydugunu olusturur:
 *
 *  - uygulama (`DATABASE_URL`): RLS zorunlu, dusuk yetkili rol. API bunu kullanir.
 *  - sistem (`DATABASE_ADMIN_URL`): kiracilar arasi isler (SLA tarayicisi,
 *    e-posta kaydi, migration). RLS'i asar; API sureci bu havuzu HIC olusturmaz.
 */
export function createPool(
  config: { connectionString: string; max: number; applicationName: string },
  log: Logger,
): pg.Pool {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: config.applicationName,
  });

  pool.on('error', (err) =>
    log.child({ module: 'db' }).error({ err, pool: config.applicationName }, 'Beklenmeyen pool hatasi'),
  );
  return pool;
}

/** BEGIN/COMMIT ile sarar; hata olursa ROLLBACK eder ve baglantiyi her durumda birakir. */
export async function withTransaction<T>(pool: pg.Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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

/** RLS politikalarinin okudugu oturum degiskenini transaction'a OZEL (LOCAL) olarak ayarlar. */
export async function setTenantContext(db: Queryable, tenantId: string): Promise<void> {
  await db.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
}

/**
 * Kiraci kapsamli transaction.
 *
 * Transaction basinda `app.tenant_id` LOCAL olarak set edilir; RLS politikalari
 * bu degeri okur. Boylece fn icindeki her sorgu otomatik olarak yalnizca ilgili
 * kiracinin satirlarini gorur. LOCAL oldugu icin deger COMMIT/ROLLBACK ile
 * silinir ve havuza donen baglantida baska bir istege sizmaz.
 */
export function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (db) => {
    await setTenantContext(db, tenantId);
    return fn(db);
  });
}
