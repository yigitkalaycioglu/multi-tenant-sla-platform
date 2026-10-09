/**
 * Demo verisi.
 *
 * Iki ayri kiraci olusturur; boylece cok kiracililik ve RLS izolasyonu
 * gercekten denenebilir (bir kiracinin kullanicisiyla giris yapip digerinin
 * verisine ulasilamadigi gorulebilir).
 *
 * Veri deterministiktir (sabit tohumlu PRNG) — her calistirmada ayni tablo.
 *
 *   npm run seed        (server/ dizininde)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';
import { createPool, setTenantContext, type Db } from './pool.js';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { createBcryptPasswordHasher } from '../security/bcrypt-password-hasher.js';
import { DEFAULT_SLA_POLICIES } from '../../domain/sla/sla-policy.js';
import { computeDueDates } from '../../domain/sla/sla-engine.js';
import type { TicketPriority, TicketStatus } from '../../domain/tickets/ticket.js';
import type { UserRole } from '../../domain/identity.js';

const log = logger.child({ module: 'seed' });

/** Sabit tohumlu PRNG — demo verisi her seferinde ayni olsun diye. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20240517);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const chance = (p: number): boolean => rand() < p;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SeedUser {
  email: string;
  fullName: string;
  role: UserRole;
  team?: string;
}

interface SeedTenant {
  slug: string;
  name: string;
  teams: Array<{ name: string; description: string }>;
  users: SeedUser[];
  ticketCount: number;
  titles: string[];
}

const TENANTS: SeedTenant[] = [
  {
    slug: 'kuzey',
    name: 'Kuzey Teknoloji A.S.',
    teams: [
      { name: 'Platform', description: 'Altyapi, CI/CD ve servis guvenilirligi' },
      { name: 'Mobil', description: 'iOS ve Android uygulamalari' },
      { name: 'Veri', description: 'Raporlama, ETL ve veri ambari' },
    ],
    users: [
      { email: 'admin@kuzey.io', fullName: 'Elif Yildirim', role: 'admin' },
      { email: 'mert@kuzey.io', fullName: 'Mert Kaya', role: 'team_lead', team: 'Platform' },
      { email: 'deniz@kuzey.io', fullName: 'Deniz Arslan', role: 'team_lead', team: 'Mobil' },
      { email: 'burak@kuzey.io', fullName: 'Burak Sahin', role: 'developer', team: 'Platform' },
      { email: 'zeynep@kuzey.io', fullName: 'Zeynep Demir', role: 'developer', team: 'Platform' },
      { email: 'can@kuzey.io', fullName: 'Can Ozturk', role: 'developer', team: 'Mobil' },
      { email: 'irem@kuzey.io', fullName: 'Irem Koc', role: 'developer', team: 'Veri' },
    ],
    ticketCount: 46,
    titles: [
      'Odeme servisi 502 donuyor',
      'Gece ETL isi zaman asimina ugruyor',
      'Mobil uygulamada oturum dusuyor',
      'Musteri paneli yavas aciliyor',
      'Fatura PDF ciktisi bozuk',
      'Bildirim e-postalari gecikmeli gidiyor',
      'Rapor ekraninda toplamlar tutmuyor',
      'Kubernetes pod surekli yeniden basliyor',
      'Arama sonuclari eksik geliyor',
      'SSO girisinde yonlendirme hatasi',
      'Depo stok senkronizasyonu kaydi',
      'Yedekleme isi disk doldu hatasi veriyor',
      'API hiz siniri yanlis calisiyor',
      'Android surumunde cokme raporu',
      'Veri ambarinda mukerrer kayitlar',
      'Webhook teslimatlari basarisiz',
    ],
  },
  {
    slug: 'acme',
    name: 'Acme Lojistik',
    teams: [
      { name: 'Operasyon', description: 'Saha operasyonlari ve depo sistemleri' },
      { name: 'Entegrasyon', description: 'Musteri ve tasiyici entegrasyonlari' },
    ],
    users: [
      { email: 'admin@acme.com', fullName: 'Selin Aydin', role: 'admin' },
      { email: 'okan@acme.com', fullName: 'Okan Celik', role: 'team_lead', team: 'Operasyon' },
      { email: 'hakan@acme.com', fullName: 'Hakan Toprak', role: 'developer', team: 'Operasyon' },
      { email: 'ayse@acme.com', fullName: 'Ayse Gunes', role: 'developer', team: 'Entegrasyon' },
    ],
    ticketCount: 22,
    titles: [
      'Sevkiyat etiketi yazdirilamiyor',
      'Tasiyici API yaniti gecikiyor',
      'Barkod okuyucu baglanti kaybi',
      'Rota optimizasyonu hatali sonuc veriyor',
      'Depo sayim raporu bos geliyor',
      'Musteri entegrasyonunda alan eslesmesi hatasi',
      'Teslimat bildirimi SMS gitmiyor',
      'Arac takip verisi guncellenmiyor',
    ],
  },
];

const STATUS_WEIGHTS: Array<{ status: TicketStatus; weight: number }> = [
  { status: 'open', weight: 0.24 },
  { status: 'in_progress', weight: 0.26 },
  { status: 'on_hold', weight: 0.08 },
  { status: 'resolved', weight: 0.24 },
  { status: 'closed', weight: 0.18 },
];

function pickStatus(): TicketStatus {
  const r = rand();
  let acc = 0;
  for (const entry of STATUS_WEIGHTS) {
    acc += entry.weight;
    if (r <= acc) return entry.status;
  }
  return 'open';
}

const COMMENTS = [
  'Loglara baktim, hata odeme saglayicisindan donuyor. Destek kaydi actim.',
  'Gecici cozum uygulandi, kalici duzeltme icin PR hazirliyorum.',
  'Musteriyle gorusuldu, ek bilgi bekliyoruz.',
  'Staging ortaminda tekrar edemedim, prod loglari gerekiyor.',
  'Duzeltme yayina alindi, izlemedeyim.',
  'Bu konu altyapi ekibini de ilgilendiriyor, onlara da ilettim.',
];

async function resetTenant(db: Db, slug: string): Promise<void> {
  // ON DELETE CASCADE tum bagli kayitlari temizler.
  await db.query('DELETE FROM tenants WHERE slug = $1', [slug]);
}

async function seedTenant(db: Db, tenant: SeedTenant, passwordHash: string): Promise<void> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, name, plan) VALUES ($1, $2, 'pro') RETURNING id`,
    [tenant.slug, tenant.name],
  );
  const tenantId = inserted.rows[0]!.id;

  // Bu noktadan sonra tum INSERT'ler RLS politikasindan gecer.
  await setTenantContext(db, tenantId);

  await db.query('INSERT INTO ticket_counters (tenant_id, last_number) VALUES ($1, 0)', [tenantId]);

  const policyIds = new Map<TicketPriority, { id: string; response: number; resolution: number }>();
  for (const policy of DEFAULT_SLA_POLICIES) {
    const row = await db.query<{ id: string }>(
      `INSERT INTO sla_policies (tenant_id, priority, response_minutes, resolution_minutes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, policy.priority, policy.responseMinutes, policy.resolutionMinutes],
    );
    policyIds.set(policy.priority, {
      id: row.rows[0]!.id,
      response: policy.responseMinutes,
      resolution: policy.resolutionMinutes,
    });
  }

  const teamIds = new Map<string, string>();
  for (const team of tenant.teams) {
    const row = await db.query<{ id: string }>(
      `INSERT INTO teams (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, team.name, team.description],
    );
    teamIds.set(team.name, row.rows[0]!.id);
  }

  const userIds = new Map<string, string>();
  for (const user of tenant.users) {
    const row = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, team_id, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(hours => $7::int)) RETURNING id`,
      [
        tenantId,
        user.email,
        passwordHash,
        user.fullName,
        user.role,
        user.team ? (teamIds.get(user.team) ?? null) : null,
        Math.floor(rand() * 72),
      ],
    );
    userIds.set(user.email, row.rows[0]!.id);
  }

  // Ekip liderlerini bagla
  for (const user of tenant.users) {
    if (user.role === 'team_lead' && user.team) {
      await db.query('UPDATE teams SET lead_id = $1 WHERE id = $2', [
        userIds.get(user.email),
        teamIds.get(user.team),
      ]);
    }
  }

  const admins = tenant.users.filter((u) => u.role === 'admin');
  const assignables = tenant.users.filter((u) => u.role !== 'admin');
  const now = Date.now();

  for (let i = 1; i <= tenant.ticketCount; i += 1) {
    const priority = chance(0.12) ? 'urgent' : chance(0.3) ? 'high' : chance(0.65) ? 'medium' : 'low';
    const policy = policyIds.get(priority as TicketPriority)!;
    const status = pickStatus();

    // Son 21 gune yayilmis acilis zamani
    const createdAt = new Date(now - rand() * 21 * DAY - HOUR);
    const dues = computeDueDates(createdAt, {
      responseMinutes: policy.response,
      resolutionMinutes: policy.resolution,
    });

    const assignee = status === 'open' && chance(0.35) ? null : pick(assignables);
    const teamName = assignee?.team ?? pick(tenant.teams).name;
    const reporter = chance(0.4) ? pick(admins) : pick(tenant.users);

    let firstResponseAt: Date | null = null;
    let resolvedAt: Date | null = null;
    let closedAt: Date | null = null;
    let pausedAt: Date | null = null;
    let pausedTotal = 0;

    if (status !== 'open') {
      // Ilk yanit: hedefin %30-140'i arasinda (bazilari gecikmis)
      const factor = 0.3 + rand() * 1.1;
      firstResponseAt = new Date(createdAt.getTime() + policy.response * MINUTE * factor);
      if (firstResponseAt.getTime() > now) firstResponseAt = new Date(now - MINUTE);
    }

    if (status === 'resolved' || status === 'closed') {
      const factor = 0.35 + rand() * 1.25;
      resolvedAt = new Date(createdAt.getTime() + policy.resolution * MINUTE * factor);
      if (resolvedAt.getTime() > now) resolvedAt = new Date(now - MINUTE);
      if (status === 'closed') closedAt = new Date(resolvedAt.getTime() + rand() * 2 * HOUR);
    }

    if (status === 'on_hold') {
      pausedAt = new Date(now - rand() * 2 * DAY);
      pausedTotal = Math.floor(rand() * 6 * 3600);
    }

    const responseState = firstResponseAt
      ? firstResponseAt.getTime() <= dues.responseDueAt.getTime()
        ? 'met'
        : 'breached'
      : dues.responseDueAt.getTime() < now
        ? 'breached'
        : 'on_track';

    const resolutionState = resolvedAt
      ? resolvedAt.getTime() <= dues.resolutionDueAt.getTime()
        ? 'met'
        : 'breached'
      : dues.resolutionDueAt.getTime() < now
        ? 'breached'
        : dues.resolutionDueAt.getTime() - now < (policy.resolution * MINUTE) / 5
          ? 'at_risk'
          : 'on_track';

    const reference = `TCK-${String(i).padStart(6, '0')}`;
    const title = `${pick(tenant.titles)}${chance(0.35) ? ` (#${100 + Math.floor(rand() * 900)})` : ''}`;

    const ticket = await db.query<{ id: string }>(
      `INSERT INTO tickets (tenant_id, reference, title, description, status, priority,
                            team_id, assignee_id, reporter_id, sla_policy_id, created_at,
                            response_due_at, resolution_due_at, first_response_at,
                            resolved_at, closed_at, paused_at, paused_total_seconds,
                            response_sla_state, resolution_sla_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        tenantId,
        reference,
        title,
        'Musteri kaydi uzerinden iletilen sorun. Detaylar ve loglar ekli yorumlarda.',
        status,
        priority,
        teamIds.get(teamName) ?? null,
        assignee ? userIds.get(assignee.email) : null,
        userIds.get(reporter.email) ?? null,
        policy.id,
        createdAt,
        dues.responseDueAt,
        dues.resolutionDueAt,
        firstResponseAt,
        resolvedAt,
        closedAt,
        pausedAt,
        pausedTotal,
        responseState,
        resolutionState,
      ],
    );
    const ticketId = ticket.rows[0]!.id;

    await db.query(
      `INSERT INTO ticket_events (tenant_id, ticket_id, actor_id, type, payload, created_at)
       VALUES ($1, $2, $3, 'created', $4::jsonb, $5)`,
      [tenantId, ticketId, userIds.get(reporter.email) ?? null, JSON.stringify({ reference, priority }), createdAt],
    );

    const commentCount = Math.floor(rand() * 4);
    for (let c = 0; c < commentCount; c += 1) {
      const author = pick(tenant.users);
      const at = new Date(createdAt.getTime() + (c + 1) * (rand() * 6 + 1) * HOUR);
      if (at.getTime() > now) break;
      await db.query(
        `INSERT INTO ticket_comments (tenant_id, ticket_id, author_id, body, is_internal, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, ticketId, userIds.get(author.email) ?? null, pick(COMMENTS), chance(0.25), at],
      );
    }
  }

  await db.query('UPDATE ticket_counters SET last_number = $2 WHERE tenant_id = $1', [
    tenantId,
    tenant.ticketCount,
  ]);

  log.info(
    { slug: tenant.slug, users: tenant.users.length, tickets: tenant.ticketCount },
    'Kiraci demo verisi olusturuldu',
  );
}

/** Demo kiracilari sifirlar ve yeniden olusturur. RLS'e tabi uygulama baglantisini kullanir. */
export async function seed(pool: pg.Pool): Promise<void> {
  const passwordHash = await createBcryptPasswordHasher(env.BCRYPT_ROUNDS).hash(env.SEED_PASSWORD);
  const client = await pool.connect();

  try {
    for (const tenant of TENANTS) {
      await client.query('BEGIN');
      try {
        await resetTenant(client, tenant.slug);
        await seedTenant(client, tenant, passwordHash);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }

  log.info('--------------------------------------------------------');
  log.info('Demo hesaplari (sifre: %s)', env.SEED_PASSWORD);
  for (const tenant of TENANTS) {
    log.info('  Kiraci "%s" (%s)', tenant.name, tenant.slug);
    for (const user of tenant.users) log.info('    %s  ->  %s', user.role.padEnd(10), user.email);
  }
  log.info('--------------------------------------------------------');
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const pool = createPool({ connectionString: env.DATABASE_URL, max: 2, applicationName: 'sla-seed' }, logger);
  seed(pool)
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err }, 'Seed basarisiz');
      await pool.end();
      process.exit(1);
    });
}
