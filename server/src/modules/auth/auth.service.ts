import bcrypt from 'bcryptjs';
import { pool, query, withTenant, type Db } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { conflict, forbidden, unauthorized } from '../../lib/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../lib/tokens.js';
import { logger } from '../../lib/logger.js';
import type { AuthUser, TicketPriority, UserRole } from '../../types/domain.js';

const log = logger.child({ module: 'auth' });

/** Yeni kiracilar icin makul baslangic SLA hedefleri (dakika). */
export const DEFAULT_SLA_POLICIES: Array<{
  priority: TicketPriority;
  response_minutes: number;
  resolution_minutes: number;
}> = [
  { priority: 'urgent', response_minutes: 15, resolution_minutes: 240 },
  { priority: 'high', response_minutes: 60, resolution_minutes: 480 },
  { priority: 'medium', response_minutes: 240, resolution_minutes: 1440 },
  { priority: 'low', response_minutes: 480, resolution_minutes: 4320 },
];

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: AuthUser;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  team_id: string | null;
  password_hash: string;
  is_active: boolean;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

/**
 * Kullanici ya da kiraci bulunamadiginda da bir bcrypt karsilastirmasi yapilir.
 *
 * Amac zamanlama sizintisini kapatmak: aksi halde "hesap yok" yaniti gecerli
 * bir e-postaya gore belirgin sekilde daha hizli doner ve saldirgan gecerli
 * hesaplari sayabilir. Sahte hash bir kez, gercek maliyet parametresiyle
 * uretilir — elle yazilmis gecersiz bir hash bcrypt'te hata firlatirdi.
 */
let dummyHash: string | null = null;
async function burnPasswordCheck(password: string): Promise<void> {
  try {
    dummyHash ??= await bcrypt.hash('sla-platform-dummy-secret', env.BCRYPT_ROUNDS);
    await bcrypt.compare(password, dummyHash);
  } catch {
    /* karsilastirma yalnizca zaman harcamak icindir, sonucu kullanilmaz */
  }
}

async function issueSession(db: Db, user: UserRow, tenantSlug: string, userAgent?: string): Promise<SessionResult> {
  const { token, hash } = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();

  await db.query(
    `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.tenant_id, user.id, hash, userAgent?.slice(0, 255) ?? null, expiresAt],
  );

  const authUser: AuthUser = {
    id: user.id,
    tenantId: user.tenant_id,
    tenantSlug,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    teamId: user.team_id,
  };

  const accessToken = signAccessToken({
    sub: user.id,
    tid: user.tenant_id,
    slug: tenantSlug,
    role: user.role,
    team: user.team_id,
    email: user.email,
    name: user.full_name,
  });

  return { accessToken, refreshToken: token, refreshExpiresAt: expiresAt, user: authUser };
}

/**
 * Yeni kiraci kaydi.
 *
 * Tek transaction icinde: kiraci + bilet numaratoru + varsayilan SLA
 * politikalari + admin kullanicisi olusturulur. Herhangi bir adim
 * basarisiz olursa hicbiri kalmaz (atomiklik).
 *
 * `tenants` tablosunda RLS yoktur; kiraci satiri olustuktan hemen sonra
 * `app.tenant_id` transaction icinde set edilir ve kalan INSERT'ler RLS
 * politikasini saglar.
 */
export async function registerTenant(input: {
  tenantName: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  password: string;
  userAgent?: string;
}): Promise<SessionResult> {
  const existing = await query('SELECT 1 FROM tenants WHERE slug = $1', [input.slug]);
  if (existing.rowCount) throw conflict('Bu kiraci kisa adi (slug) zaten kullaniliyor.');

  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tenant = await client.query<{ id: string; slug: string }>(
      `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id, slug`,
      [input.slug, input.tenantName],
    );
    const tenantId = tenant.rows[0]!.id;

    // Bundan sonraki tum sorgular bu kiracinin RLS baglaminda calisir.
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

    await client.query('INSERT INTO ticket_counters (tenant_id) VALUES ($1)', [tenantId]);

    await client.query(
      `INSERT INTO sla_policies (tenant_id, priority, response_minutes, resolution_minutes)
       SELECT $1, x.priority::ticket_priority, x.response_minutes, x.resolution_minutes
         FROM jsonb_to_recordset($2::jsonb)
              AS x(priority text, response_minutes int, resolution_minutes int)`,
      [tenantId, JSON.stringify(DEFAULT_SLA_POLICIES)],
    );

    const admin = await client.query<UserRow>(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, 'admin')
       RETURNING id, tenant_id, email, full_name, role, team_id, password_hash, is_active`,
      [tenantId, input.adminEmail, passwordHash, input.adminName],
    );

    const session = await issueSession(client, admin.rows[0]!, tenant.rows[0]!.slug, input.userAgent);

    await client.query('COMMIT');
    log.info({ tenantId, slug: input.slug }, 'Yeni kiraci olusturuldu');
    return session;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function login(input: {
  tenantSlug: string;
  email: string;
  password: string;
  userAgent?: string;
}): Promise<SessionResult> {
  const tenant = await query<{ id: string; slug: string; is_active: boolean }>(
    'SELECT id, slug, is_active FROM tenants WHERE slug = $1',
    [input.tenantSlug],
  );
  const tenantRow = tenant.rows[0];

  if (!tenantRow) {
    await burnPasswordCheck(input.password);
    throw unauthorized('Kiraci, e-posta veya sifre hatali');
  }
  if (!tenantRow.is_active) throw forbidden('Bu kiraci hesabi pasif durumda');

  return withTenant(tenantRow.id, async (db) => {
    const users = await db.query<UserRow>(
      `SELECT id, tenant_id, email, full_name, role, team_id, password_hash, is_active
         FROM users WHERE email = $1`,
      [input.email],
    );
    const user = users.rows[0];

    if (!user) {
      await burnPasswordCheck(input.password);
      throw unauthorized('Kiraci, e-posta veya sifre hatali');
    }
    if (!user.is_active) throw forbidden('Hesabiniz pasif durumda, yoneticinize basvurun');

    const ok = await bcrypt.compare(input.password, user.password_hash);
    if (!ok) throw unauthorized('Kiraci, e-posta veya sifre hatali');

    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    log.info({ userId: user.id, tenantId: user.tenant_id }, 'Giris basarili');

    return issueSession(db, user, tenantRow.slug, input.userAgent);
  });
}

/**
 * Refresh token rotasyonu: eski token iptal edilir, yenisi verilir.
 * Kiraci kimligi cerez degerinin ilk parcasindan gelir (`tenantId.token`),
 * cunku refresh_tokens tablosu da RLS altindadir.
 */
export async function refreshSession(cookieValue: string, userAgent?: string): Promise<SessionResult> {
  const [tenantId, rawToken] = cookieValue.split('.', 2);
  if (!tenantId || !rawToken) throw unauthorized('Oturum yenilenemedi');

  const tenant = await query<{ slug: string; is_active: boolean }>(
    'SELECT slug, is_active FROM tenants WHERE id = $1',
    [tenantId],
  );
  const tenantRow = tenant.rows[0];
  if (!tenantRow || !tenantRow.is_active) throw unauthorized('Oturum yenilenemedi');

  return withTenant(tenantId, async (db) => {
    const tokenHash = hashRefreshToken(rawToken);
    const found = await db.query<{ id: string; user_id: string; revoked_at: Date | null; expires_at: Date }>(
      `SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const row = found.rows[0];
    if (!row) throw unauthorized('Oturum yenilenemedi');

    if (row.revoked_at) {
      // Iptal edilmis bir token yeniden kullanildi -> muhtemel token hirsizligi.
      // Kullanicinin tum oturumlarini kapat.
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
        row.user_id,
      ]);
      log.warn({ userId: row.user_id }, 'Iptal edilmis refresh token kullanildi, oturumlar kapatildi');
      throw unauthorized('Oturum gecersiz kilindi, tekrar giris yapin');
    }

    if (row.expires_at.getTime() <= Date.now()) throw unauthorized('Oturum suresi doldu');

    const users = await db.query<UserRow>(
      `SELECT id, tenant_id, email, full_name, role, team_id, password_hash, is_active
         FROM users WHERE id = $1`,
      [row.user_id],
    );
    const user = users.rows[0];
    if (!user || !user.is_active) throw unauthorized('Kullanici bulunamadi veya pasif');

    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    return issueSession(db, user, tenantRow.slug, userAgent);
  });
}

export async function logout(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  const [tenantId, rawToken] = cookieValue.split('.', 2);
  if (!tenantId || !rawToken) return;

  await withTenant(tenantId, async (db) => {
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
      hashRefreshToken(rawToken),
    ]);
  }).catch((err) => log.warn({ err }, 'Cikis sirasinda token iptal edilemedi'));
}
