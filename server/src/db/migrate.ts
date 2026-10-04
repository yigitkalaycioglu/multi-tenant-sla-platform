/**
 * Migration calistiricisi.
 *
 * 1) Dusuk yetkili `app_user` rolunu olusturur (API bu rolle baglanir, RLS'e tabidir).
 * 2) src/db/migrations/*.sql dosyalarini sirayla ve transaction icinde uygular.
 * 3) Uygulanan surumleri schema_migrations tablosunda tutar (idempotent).
 * 4) Tablolar olustuktan sonra app_user'a gerekli yetkileri verir.
 *
 * Yonetici baglantisi (DATABASE_ADMIN_URL) ile calisir.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'migrate' });
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureAppRole(client: pg.Client): Promise<void> {
  await client.query('SELECT set_config($1, $2, false)', ['app.bootstrap_user', env.APP_DB_USER]);
  await client.query('SELECT set_config($1, $2, false)', ['app.bootstrap_pw', env.APP_DB_PASSWORD]);

  // Rolu olustur / sifresini guncelle. Injection'a kapali: degerler
  // current_setting uzerinden gelir, format(%I/%L) ile tirnaklanir.
  await client.query(`
    DO $bootstrap$
    DECLARE
      role_name text := current_setting('app.bootstrap_user');
      role_pw   text := current_setting('app.bootstrap_pw');
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', role_name, role_pw);
      ELSE
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', role_name, role_pw);
      END IF;
      -- Guvenlik: uygulama rolu hicbir kosulda RLS'i asamaz.
      EXECUTE format('ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', role_name);
    END
    $bootstrap$;
  `);

  log.info({ role: env.APP_DB_USER }, 'Uygulama rolu hazir');
}

async function grantAppPrivileges(client: pg.Client): Promise<void> {
  const dbName = client.database ?? new URL(env.DATABASE_ADMIN_URL).pathname.replace('/', '');
  await client.query('SELECT set_config($1, $2, false)', ['app.bootstrap_user', env.APP_DB_USER]);
  await client.query('SELECT set_config($1, $2, false)', ['app.bootstrap_db', dbName]);

  await client.query(`
    DO $grants$
    DECLARE
      role_name text := current_setting('app.bootstrap_user');
      db_name   text := current_setting('app.bootstrap_db');
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', db_name, role_name);
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', role_name);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', role_name);
      -- Sema degistirme yetkisi verilmez.
      EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', role_name);
    END
    $grants$;
  `);

  log.info('Yetkiler uygulandi');
}

export async function runMigrations(): Promise<void> {
  const client = new pg.Client({ connectionString: env.DATABASE_ADMIN_URL, application_name: 'sla-migrate' });
  await client.connect();

  try {
    await ensureAppRole(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now(),
        duration_ms integer NOT NULL DEFAULT 0
      );
    `);

    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        log.debug({ file }, 'Atlandi (zaten uygulanmis)');
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const startedAt = Date.now();

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, duration_ms) VALUES ($1, $2)', [
          file,
          Date.now() - startedAt,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        log.error({ err, file }, 'Migration basarisiz, geri alindi');
        throw err;
      }

      count += 1;
      log.info({ file, ms: Date.now() - startedAt }, 'Migration uygulandi');
    }

    await grantAppPrivileges(client);
    log.info({ applied: count, total: files.length }, 'Migration tamamlandi');
  } finally {
    await client.end();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error({ err }, 'Migration hatasi');
      process.exit(1);
    });
}
