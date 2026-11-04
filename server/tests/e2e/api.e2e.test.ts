/**
 * Uctan uca API testleri: gercek PostgreSQL + Redis + Mailpit.
 *
 * API ve worker ayni surecte, uretimdeki composition root ile (main/container.ts)
 * ayaga kaldirilir; istekler gercek HTTP uzerinden gider, canli olaylar gercek
 * bir Socket.io istemcisiyle dinlenir, e-postalar Mailpit'in API'sinden okunur.
 *
 * CI'da `e2e` isinde calisir. Yerelde: Postgres, Redis ve Mailpit acikken
 * `npm run migrate` sonrasi `RUN_E2E=1 SLA_SCAN_INTERVAL_MS=5000 npm run test:e2e`.
 */
import type { AddressInfo } from 'node:net';
import http from 'node:http';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';

const enabled = process.env.RUN_E2E === '1';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const RUN = Date.now().toString(36);
const PASSWORD = 'E2eParola1';

interface CallResult<T = any> {
  status: number;
  body: T;
  cookie: string | null;
}

/** Kosul saglanana kadar bekler; zaman asiminda son hatayi firlatir. */
async function eventually<T>(fn: () => Promise<T>, timeoutMs = 30_000, intervalMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw lastError;
}

describe.skipIf(!enabled)('uctan uca API', { timeout: 60_000 }, () => {
  let base = '';
  let server: http.Server;
  let closeApi: () => Promise<void>;
  let stopWorker: () => Promise<void>;
  let adminPool: pg.Pool;
  let connectSocket: (token: string) => Promise<Socket>;
  const sockets: Socket[] = [];

  async function call<T = any>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; cookie?: string } = {},
  ): Promise<CallResult<T>> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('sla_rt='));
    return {
      status: res.status,
      body: text ? JSON.parse(text) : null,
      cookie: setCookie ? setCookie.split(';')[0]! : null,
    };
  }

  async function login(slug: string, email: string) {
    const res = await call('POST', '/api/auth/login', { body: { tenantSlug: slug, email, password: PASSWORD } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { token: res.body.accessToken as string, cookie: res.cookie!, user: res.body.user };
  }

  /** Bir sokete gelen olaylari toplar. */
  function record(socket: Socket): Array<{ event: string; payload: any }> {
    const received: Array<{ event: string; payload: any }> = [];
    socket.onAny((event: string, payload: unknown) => received.push({ event, payload }));
    return received;
  }

  async function mailpitMessages(): Promise<Array<{ Subject: string; To: Array<{ Address: string }> }>> {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    return ((await res.json()) as { messages: Array<{ Subject: string; To: Array<{ Address: string }> }> }).messages;
  }

  beforeAll(async () => {
    // Uygulama modulleri dinamik yuklenir: test atlandiginda baglanti acilmasin.
    const { buildApiContainer, buildWorkerContainer } = await import('../../src/main/container.js');
    const { createApp } = await import('../../src/interfaces/http/app.js');
    const { initRealtime } = await import('../../src/interfaces/realtime/socket-server.js');
    const { createPool } = await import('../../src/infrastructure/db/pool.js');
    const { corsOrigins, env } = await import('../../src/infrastructure/config/env.js');
    const { logger } = await import('../../src/infrastructure/logger.js');
    const { io } = await import('socket.io-client');

    adminPool = createPool({ connectionString: env.DATABASE_ADMIN_URL, max: 2, applicationName: 'e2e' }, logger);

    const api = buildApiContainer();
    server = http.createServer(createApp(api.app));
    const realtime = initRealtime(server, {
      tokens: api.app.tokens,
      subscribe: (h) => api.realtime.subscribe(h),
      corsOrigins,
      log: logger,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeApi = async () => {
      await realtime.stopListening();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await api.close();
    };

    stopWorker = await buildWorkerContainer().start();

    connectSocket = (token: string) =>
      new Promise((resolve, reject) => {
        const socket = io(base, { path: '/socket.io', auth: { token }, transports: ['websocket'], forceNew: true });
        sockets.push(socket);
        socket.once('connected', () => resolve(socket));
        socket.once('connect_error', reject);
      });
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await stopWorker?.();
    await closeApi?.();
    await adminPool?.query('DELETE FROM tenants WHERE slug LIKE $1', [`e2e-%-${RUN}`]);
    await adminPool?.end();
  }, 60_000);

  // --- Paylasilan durum (testler sirayla calisir) ----------------------------
  const slugA = `e2e-a-${RUN}`;
  const slugB = `e2e-b-${RUN}`;
  const devEmail = `dev-${RUN}@e2e.test`;
  let admin = { token: '', cookie: '' };
  let lead = { token: '' };
  let dev = { token: '', id: '' };
  let outsider = { token: '' };
  let leadId = '';
  let teamId = '';
  let ticketId = '';

  it('saglik ucu tum bagimliliklari "up" gosterir', async () => {
    const res = await call('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', postgres: 'up', redis: 'up' });
  });

  it('kiraci kaydi admin oturumu ve httpOnly refresh cerezi verir', async () => {
    const res = await call('POST', '/api/auth/register', {
      body: { tenantName: 'E2E Sirket A', slug: slugA, adminName: 'Admin A', adminEmail: `admin-${RUN}@e2e.test`, password: PASSWORD },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'admin', tenantSlug: slugA });
    expect(res.cookie).toMatch(/^sla_rt=/);
    admin = { token: res.body.accessToken, cookie: res.cookie! };

    const me = await call('GET', '/api/auth/me', { token: admin.token });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(`admin-${RUN}@e2e.test`);

    const policies = await call('GET', '/api/sla-policies', { token: admin.token });
    expect(policies.body.items.map((p: { priority: string }) => p.priority)).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('ayni slug ile ikinci kayit 409 doner', async () => {
    const res = await call('POST', '/api/auth/register', {
      body: { tenantName: 'Tekrar', slug: slugA, adminName: 'Admin', adminEmail: `x-${RUN}@e2e.test`, password: PASSWORD },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('hatali giris bilgisi 401 doner', async () => {
    const wrongPassword = await call('POST', '/api/auth/login', {
      body: { tenantSlug: slugA, email: `admin-${RUN}@e2e.test`, password: 'YanlisSifre1' },
    });
    const wrongTenant = await call('POST', '/api/auth/login', {
      body: { tenantSlug: 'olmayan-kiraci', email: `admin-${RUN}@e2e.test`, password: PASSWORD },
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongTenant.status).toBe(401);
  });

  it('admin ekip ve kullanicilari olusturur', async () => {
    const team = await call('POST', '/api/teams', { token: admin.token, body: { name: 'Platform', description: 'Altyapi' } });
    expect(team.status, JSON.stringify(team.body)).toBe(201);
    teamId = team.body.team.id;

    const mk = (email: string, role: string, withTeam: boolean) =>
      call('POST', '/api/users', {
        token: admin.token,
        body: { fullName: `Kullanici ${role}`, email, password: PASSWORD, role, teamId: withTeam ? teamId : null },
      });
    expect((await mk(`lead-${RUN}@e2e.test`, 'team_lead', true)).status).toBe(201);
    const devRes = await mk(devEmail, 'developer', true);
    expect(devRes.status).toBe(201);
    expect(devRes.body.user.team).toMatchObject({ id: teamId });
    expect((await mk(`out-${RUN}@e2e.test`, 'developer', false)).status).toBe(201);

    const duplicate = await mk(devEmail, 'developer', true);
    expect(duplicate.status).toBe(409);

    const leadSession = await login(slugA, `lead-${RUN}@e2e.test`);
    lead = { token: leadSession.token };
    leadId = leadSession.user.id;
    const devSession = await login(slugA, devEmail);
    dev = { token: devSession.token, id: devSession.user.id };
    outsider = await login(slugA, `out-${RUN}@e2e.test`);

    const devCreatesUser = await call('POST', '/api/users', {
      token: dev.token,
      body: { fullName: 'Yetkisiz', email: `no-${RUN}@e2e.test`, password: PASSWORD, role: 'admin' },
    });
    expect(devCreatesUser.status).toBe(403);
  });

  it('bilet olusturma: referans, SLA hedefleri, canli olay ve atama e-postasi', async () => {
    const devSocket = await connectSocket(dev.token);
    const received = record(devSocket);
    const outsiderSocket = await connectSocket(outsider.token);
    const outsiderReceived = record(outsiderSocket);

    const res = await call('POST', '/api/tickets', {
      token: admin.token,
      body: { title: 'Odeme servisi 502 donuyor', priority: 'high', teamId, assigneeId: dev.id },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const t = res.body.ticket;
    ticketId = t.id;
    expect(t.reference).toBe('TCK-000001');
    expect(t.assignee.id).toBe(dev.id);
    const created = new Date(t.createdAt).getTime();
    expect(new Date(t.sla.response.dueAt).getTime() - created).toBe(60 * 60_000);
    expect(new Date(t.sla.resolution.dueAt).getTime() - created).toBe(480 * 60_000);

    await eventually(async () => {
      expect(received.some((e) => e.event === 'ticket:created' && e.payload.id === ticketId)).toBe(true);
    });
    // Bileti HTTP'de goremeyen ekip disi gelistirici canli olayla da gormemeli.
    await new Promise((r) => setTimeout(r, 300));
    expect(outsiderReceived.filter((e) => e.event.startsWith('ticket:'))).toEqual([]);

    await eventually(async () => {
      const mails = await mailpitMessages();
      expect(
        mails.some((m) => m.Subject.includes('[YENI ATAMA]') && m.To.some((to) => to.Address === devEmail)),
      ).toBe(true);
    });
  });

  it('gorunurluk: ekip uyesi bileti gorur, ekip disi gelistirici goremez', async () => {
    const devList = await call('GET', '/api/tickets?assigneeId=me&status=open&priority=high', { token: dev.token });
    expect(devList.status).toBe(200);
    expect(devList.body.items.map((i: { id: string }) => i.id)).toContain(ticketId);

    const outsiderList = await call('GET', '/api/tickets', { token: outsider.token });
    expect(outsiderList.body.total).toBe(0);
    expect((await call('GET', `/api/tickets/${ticketId}`, { token: outsider.token })).status).toBe(404);

    const search = await call('GET', '/api/tickets?search=TCK-000001', { token: admin.token });
    expect(search.body.total).toBe(1);

    // Yalnizca bosluktan olusan arama filtre sayilmaz (onceden 400 donuyordu).
    const blank = await call('GET', '/api/tickets?search=%20%20', { token: admin.token });
    expect(blank.status).toBe(200);
    expect(blank.body.total).toBe(1);
  });

  it('rol kurallari: gelistirici atama ve oncelik degistiremez, durumu degistirebilir', async () => {
    expect((await call('PATCH', `/api/tickets/${ticketId}`, { token: dev.token, body: { assigneeId: null } })).status).toBe(403);
    expect((await call('PATCH', `/api/tickets/${ticketId}`, { token: dev.token, body: { priority: 'low' } })).status).toBe(403);

    const res = await call('PATCH', `/api/tickets/${ticketId}`, { token: dev.token, body: { status: 'in_progress' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ticket.status).toBe('in_progress');

    const invalid = await call('PATCH', `/api/tickets/${ticketId}`, { token: dev.token, body: { status: 'open' } });
    expect(invalid.status).toBe(400);
  });

  it('ekip lideri onceligi degistirir ve SLA hedefleri yeniden hesaplanir', async () => {
    const res = await call('PATCH', `/api/tickets/${ticketId}`, { token: lead.token, body: { priority: 'urgent' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      (await call('GET', `/api/tickets/${ticketId}`, { token: lead.token })).body.events.map((e: { type: string }) => e.type),
    ).toContain('priority_changed');
    const t = res.body.ticket;
    const created = new Date(t.createdAt).getTime();
    expect(new Date(t.sla.response.dueAt).getTime() - created).toBe(15 * 60_000);
    expect(new Date(t.sla.resolution.dueAt).getTime() - created).toBe(240 * 60_000);
  });

  it('yeniden atama yeni atanan kisiye e-posta gonderir', async () => {
    const toLead = await call('PATCH', `/api/tickets/${ticketId}`, { token: lead.token, body: { assigneeId: leadId } });
    expect(toLead.status, JSON.stringify(toLead.body)).toBe(200);
    expect(toLead.body.ticket.assignee.id).toBe(leadId);

    await eventually(async () => {
      const mails = await mailpitMessages();
      expect(
        mails.some((m) => m.Subject.includes('[YENI ATAMA]') && m.To.some((to) => to.Address === `lead-${RUN}@e2e.test`)),
      ).toBe(true);
    });

    const back = await call('PATCH', `/api/tickets/${ticketId}`, { token: lead.token, body: { assigneeId: dev.id } });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.ticket.assignee.id).toBe(dev.id);
  });

  it('yorum ilk yaniti kaydeder ve zaman tunelinde gorunur', async () => {
    const res = await call('POST', `/api/tickets/${ticketId}/comments`, {
      token: dev.token,
      body: { body: 'Loglara baktim, inceliyorum.' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const detail = await call('GET', `/api/tickets/${ticketId}`, { token: dev.token });
    expect(detail.body.ticket.firstResponseAt).not.toBeNull();
    expect(detail.body.ticket.sla.response.state).toBe('met');
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['created', 'assigned', 'status_changed', 'commented', 'first_response']),
    );
  });

  it('bekletme ve cozum: SLA saati durur, bilet zamaninda muhurlenir', async () => {
    const held = await call('PATCH', `/api/tickets/${ticketId}`, { token: dev.token, body: { status: 'on_hold' } });
    expect(held.status, JSON.stringify(held.body)).toBe(200);
    expect(held.body.ticket.isPaused).toBe(true);

    const resolved = await call('PATCH', `/api/tickets/${ticketId}`, { token: dev.token, body: { status: 'resolved' } });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(resolved.body.ticket.isPaused).toBe(false);
    expect(resolved.body.ticket.resolvedAt).not.toBeNull();
    expect(resolved.body.ticket.sla.resolution.state).toBe('met');

    const reopened = await call('PATCH', `/api/tickets/${ticketId}`, { token: lead.token, body: { status: 'in_progress' } });
    expect(reopened.status).toBe(200);
    expect(reopened.body.ticket.resolvedAt).toBeNull();
  });

  it('SLA politikasi: admin gunceller, gecersiz pencere ve yetkisiz kullanici reddedilir', async () => {
    const ok = await call('PUT', '/api/sla-policies/low', {
      token: admin.token,
      body: { responseMinutes: 600, resolutionMinutes: 5000 },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.policy).toMatchObject({ priority: 'low', responseMinutes: 600, resolutionMinutes: 5000 });

    const bad = await call('PUT', '/api/sla-policies/low', {
      token: admin.token,
      body: { responseMinutes: 600, resolutionMinutes: 100 },
    });
    expect(bad.status).toBe(400);

    const forbidden = await call('PUT', '/api/sla-policies/low', {
      token: lead.token,
      body: { responseMinutes: 600, resolutionMinutes: 5000 },
    });
    expect(forbidden.status).toBe(403);
  });

  it('kullanici ve ekip yonetim kurallari', async () => {
    const me = await call('GET', '/api/auth/me', { token: admin.token });
    const selfDemote = await call('PATCH', `/api/users/${me.body.user.id}`, { token: admin.token, body: { role: 'developer' } });
    expect(selfDemote.status).toBe(400);

    const deleteTeam = await call('DELETE', `/api/teams/${teamId}`, { token: admin.token });
    expect(deleteTeam.status).toBe(400); // acik bilet var

    const users = await call('GET', '/api/users', { token: dev.token });
    expect(users.status).toBe(200);
    expect(users.body.items.length).toBe(4);

    const teams = await call('GET', '/api/teams', { token: dev.token });
    expect(teams.body.items[0]).toMatchObject({ id: teamId, memberCount: 2, openTicketCount: 1 });

    // Lider gelistiriciye dusurulunce ekibin lideri bosalir.
    const setLead = await call('PATCH', `/api/teams/${teamId}`, { token: admin.token, body: { leadId } });
    expect(setLead.status, JSON.stringify(setLead.body)).toBe(200);
    expect(setLead.body.team.lead.id).toBe(leadId);
    const demote = await call('PATCH', `/api/users/${leadId}`, { token: admin.token, body: { role: 'developer' } });
    expect(demote.status, JSON.stringify(demote.body)).toBe(200);
    const afterDemote = await call('GET', '/api/teams', { token: admin.token });
    expect(afterDemote.body.items[0].lead).toBeNull();
  });

  it('rapor ozeti rol kapsamina gore hesaplanir', async () => {
    const adminReport = await call('GET', '/api/reports/overview?days=7', { token: admin.token });
    expect(adminReport.status, JSON.stringify(adminReport.body)).toBe(200);
    expect(adminReport.body).toMatchObject({ scope: 'tenant', days: 7 });
    expect(adminReport.body.totals.total).toBe(1);
    expect(adminReport.body.trend).toHaveLength(7);

    const outsiderReport = await call('GET', '/api/reports/overview', { token: outsider.token });
    expect(outsiderReport.body).toMatchObject({ scope: 'personal' });
    expect(outsiderReport.body.totals.total).toBe(0);
  });

  it('kiraci izolasyonu: baska kiracinin admini bileti ne gorur ne de canli olayini alir', async () => {
    const reg = await call('POST', '/api/auth/register', {
      body: { tenantName: 'E2E Sirket B', slug: slugB, adminName: 'Admin B', adminEmail: `admin-${RUN}@e2e.test`, password: PASSWORD },
    });
    expect(reg.status).toBe(201);
    const tokenB = reg.body.accessToken as string;

    expect((await call('GET', `/api/tickets/${ticketId}`, { token: tokenB })).status).toBe(404);
    expect((await call('GET', '/api/tickets', { token: tokenB })).body.total).toBe(0);
    expect((await call('PATCH', `/api/tickets/${ticketId}`, { token: tokenB, body: { title: 'ele gecirildi' } })).status).toBe(404);

    // B, A'nin bilet odasina abone olmaya calisir; A'daki degisiklik B'ye ulasmamali.
    const socketB = await connectSocket(tokenB);
    const receivedB = record(socketB);
    socketB.emit('ticket:subscribe', ticketId);
    const devSocket = await connectSocket(dev.token);
    const receivedDev = record(devSocket);
    devSocket.emit('ticket:subscribe', ticketId);
    await new Promise((r) => setTimeout(r, 300));

    const update = await call('PATCH', `/api/tickets/${ticketId}`, { token: admin.token, body: { title: 'Odeme servisi 502 (guncel)' } });
    expect(update.status).toBe(200);

    await eventually(async () => {
      expect(receivedDev.some((e) => e.event === 'ticket:updated')).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(receivedB.filter((e) => e.event.startsWith('ticket:'))).toEqual([]);
  });

  it('SLA tarayicisi gecikmis bileti isaretler, canli olay ve ihlal e-postasi uretir', async () => {
    const created = await call('POST', '/api/tickets', {
      token: admin.token,
      body: { title: 'Gece ETL isi zaman asimi', priority: 'urgent', teamId, assigneeId: dev.id },
    });
    expect(created.status).toBe(201);
    const lateId = created.body.ticket.id as string;

    const devSocket = await connectSocket(dev.token);
    const received = record(devSocket);

    // Hedefleri gecmise cek: tarayicinin bir sonraki turunda "breached" olmali.
    await adminPool.query(
      `UPDATE tickets SET response_due_at = now() - interval '1 minute',
                          resolution_due_at = now() - interval '1 minute'
        WHERE id = $1`,
      [lateId],
    );

    await eventually(async () => {
      const { rows } = await adminPool.query<{ resolution_sla_state: string; breach_notified_at: Date | null }>(
        'SELECT resolution_sla_state, breach_notified_at FROM tickets WHERE id = $1',
        [lateId],
      );
      expect(rows[0]).toMatchObject({ resolution_sla_state: 'breached' });
      expect(rows[0]!.breach_notified_at).not.toBeNull();
    }, 45_000);

    await eventually(async () => {
      expect(received.some((e) => e.event === 'sla:breached' && e.payload.ticketId === lateId)).toBe(true);
    });

    await eventually(async () => {
      const { rows } = await adminPool.query<{ status: string }>(
        `SELECT status FROM email_log WHERE ticket_id = $1 AND kind = 'sla_breached'`,
        [lateId],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === 'sent')).toBe(true);
      const mails = await mailpitMessages();
      expect(mails.some((m) => m.Subject.includes('[SLA ASILDI]') && m.To.some((to) => to.Address === devEmail))).toBe(true);
    }, 45_000);

    const detail = await call('GET', `/api/tickets/${lateId}`, { token: dev.token });
    expect(detail.body.ticket.sla.resolution.state).toBe('breached');
    // Tarayicinin gecisi zaman tunelinde de gorunur.
    expect(detail.body.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'sla_breached', actor: null })]),
    );
  }, 120_000);

  it('admin bileti siler; gelistirici silemez', async () => {
    expect((await call('DELETE', `/api/tickets/${ticketId}`, { token: dev.token })).status).toBe(403);
    expect((await call('DELETE', `/api/tickets/${ticketId}`, { token: admin.token })).status).toBe(204);
    expect((await call('GET', `/api/tickets/${ticketId}`, { token: admin.token })).status).toBe(404);
  });

  it('refresh token rotasyonu ve yeniden kullanim tespiti', async () => {
    const first = await call('POST', '/api/auth/refresh', { cookie: admin.cookie });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.cookie).not.toBe(admin.cookie);
    expect((await call('GET', '/api/auth/me', { token: first.body.accessToken })).status).toBe(200);

    // Eski (iptal edilmis) cerez tekrar kullanilirsa tum oturumlar kapanir.
    expect((await call('POST', '/api/auth/refresh', { cookie: admin.cookie })).status).toBe(401);
    expect((await call('POST', '/api/auth/refresh', { cookie: first.cookie! })).status).toBe(401);
  });

  it('cikis refresh cerezini gecersiz kilar', async () => {
    const session = await login(slugA, devEmail);
    const out = await call('POST', '/api/auth/logout', { cookie: session.cookie });
    expect(out.status).toBe(204);
    expect((await call('POST', '/api/auth/refresh', { cookie: session.cookie })).status).toBe(401);
  });
});
