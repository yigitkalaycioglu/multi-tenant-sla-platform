/**
 * Bilet use case'leri — veritabani, Redis ya da HTTP olmadan.
 *
 * Portlarin bellek ici sahteleri (fake) kullanilir. Sahte transaction, gercegi
 * gibi hata durumunda tum degisiklikleri geri alir; boylece "yan etkiler yalnizca
 * commit'ten sonra" kurali dogrulanabilir.
 */
import { describe, expect, it } from 'vitest';
import type { NotificationJob, RealtimeMessage } from '../../src/application/ports/events.js';
import type { Logger } from '../../src/application/ports/runtime.js';
import type { TenantRepositories, TenantTransactions } from '../../src/application/ports/transactions.js';
import type { TicketRecord } from '../../src/application/tickets/ticket.ports.js';
import { makeTicketUseCases } from '../../src/application/tickets/ticket.use-cases.js';
import type { AuthUser } from '../../src/domain/identity.js';
import { MINUTE_MS } from '../../src/domain/sla/sla-engine.js';
import type { SlaPolicy } from '../../src/domain/sla/sla-policy.js';
import type { Ticket, TicketChanges } from '../../src/domain/tickets/ticket.js';

const NOW = new Date('2025-03-10T12:00:00.000Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * MINUTE_MS);

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

const admin: AuthUser = {
  id: 'admin-1',
  tenantId: 'tenant-1',
  tenantSlug: 'kuzey',
  email: 'admin@kuzey.io',
  fullName: 'Elif Yildirim',
  role: 'admin',
  teamId: null,
};

const POLICIES: SlaPolicy[] = [
  { id: 'p-high', priority: 'high', responseMinutes: 60, resolutionMinutes: 480 },
  { id: 'p-urgent', priority: 'urgent', responseMinutes: 15, resolutionMinutes: 240 },
];

const USERS = [{ id: 'dev-1', email: 'burak@kuzey.io' }];

function setup(existing: Ticket[] = []) {
  const state = {
    tickets: new Map(existing.map((t) => [t.id, t])),
    events: [] as Array<{ ticketId: string; type: string }>,
    sequence: 0,
  };

  const asRecord = (t: Ticket): TicketRecord => ({
    ...t,
    teamName: null,
    assigneeName: null,
    assigneeEmail: USERS.find((u) => u.id === t.assigneeId)?.email ?? null,
    reporterName: null,
    commentCount: 0,
    updatedAt: t.createdAt,
  });

  // Testler admin ile calisir; gorunurluk kapsami burada bilincli olarak yok sayilir.
  const repos = {
    tickets: {
      nextSequence: async () => ++state.sequence,
      insert: async (t: Omit<Ticket, 'id'>) => {
        const id = `ticket-${state.tickets.size + 1}`;
        state.tickets.set(id, {
          ...t,
          id,
          tenantId: admin.tenantId,
          status: 'open',
          firstResponseAt: null,
          resolvedAt: null,
          closedAt: null,
          pausedAt: null,
          pausedTotalSeconds: 0,
          responseSlaState: 'on_track',
          resolutionSlaState: 'on_track',
          riskNotifiedAt: null,
          breachNotifiedAt: null,
        } as Ticket);
        return id;
      },
      findRecord: async (id: string) => (state.tickets.has(id) ? asRecord(state.tickets.get(id)!) : null),
      lockForUpdate: async (id: string) => state.tickets.get(id) ?? null,
      update: async (id: string, changes: TicketChanges) => {
        state.tickets.set(id, { ...state.tickets.get(id)!, ...changes });
      },
      recordEvent: async (ticketId: string, _actor: string, type: string) => {
        state.events.push({ ticketId, type });
      },
    },
    slaPolicies: { findByPriority: async (p: string) => POLICIES.find((x) => x.priority === p) ?? null },
    users: { findActiveEmail: async (id: string) => USERS.find((u) => u.id === id)?.email ?? null },
    teams: { exists: async () => true },
  } as unknown as TenantRepositories;

  const tx: TenantTransactions = {
    async run(_tenantId, work) {
      const snapshot = { tickets: structuredClone(state.tickets), events: [...state.events], sequence: state.sequence };
      try {
        return await work(repos);
      } catch (err) {
        Object.assign(state, snapshot); // ROLLBACK
        throw err;
      }
    },
    runForNewTenant: () => Promise.reject(new Error('bu testte kullanilmaz')),
  };

  const published: RealtimeMessage[] = [];
  const enqueued: Array<{ job: NotificationJob; dedupeKey?: string }> = [];

  const useCases = makeTicketUseCases({
    tx,
    realtime: {
      publish: async (m) => {
        published.push(m);
      },
    },
    notifications: {
      enqueue: async (job, dedupeKey) => {
        enqueued.push({ job, dedupeKey });
      },
    },
    clock: { now: () => NOW },
    log: silentLog,
    slaRiskThreshold: 0.8,
  });

  return { useCases, state, published, enqueued };
}

describe('bilet olusturma', () => {
  it('numara, SLA hedefleri ve zaman tunelini tek islemde olusturur; yan etkileri sonra tetikler', async () => {
    const { useCases, state, published, enqueued } = setup();

    const dto = await useCases.create(admin, { title: 'Odeme servisi 502', priority: 'high', assigneeId: 'dev-1' });

    expect(dto.reference).toBe('TCK-000001');
    expect(dto.sla.response.dueAt).toBe(new Date(NOW.getTime() + 60 * MINUTE_MS).toISOString());
    expect(dto.sla.resolution.dueAt).toBe(new Date(NOW.getTime() + 480 * MINUTE_MS).toISOString());
    expect(state.events.map((e) => e.type)).toEqual(['created', 'assigned']);

    expect(published).toEqual([expect.objectContaining({ event: 'ticket:created', ticketId: dto.id })]);
    expect(enqueued).toEqual([
      {
        job: expect.objectContaining({ kind: 'ticket_assigned', recipients: ['burak@kuzey.io'] }),
        dedupeKey: `assigned:${dto.id}:dev-1`,
      },
    ]);
  });

  it('islem geri alinirsa hicbir kayit kalmaz ve bildirim gitmez', async () => {
    const { useCases, state, published, enqueued } = setup();

    await expect(
      useCases.create(admin, { title: 'Odeme servisi 502', priority: 'high', assigneeId: 'olmayan-kisi' }),
    ).rejects.toMatchObject({ kind: 'invalid' });

    expect(state.tickets.size).toBe(0);
    expect(state.sequence).toBe(0);
    expect(published).toEqual([]);
    expect(enqueued).toEqual([]);
  });
});

describe('bilet guncelleme', () => {
  const onHold: Ticket = {
    id: 'ticket-1',
    tenantId: 'tenant-1',
    reference: 'TCK-000001',
    title: 'Odeme servisi 502',
    description: '',
    status: 'on_hold',
    priority: 'high',
    teamId: 'team-1',
    assigneeId: 'dev-1',
    reporterId: 'admin-1',
    slaPolicyId: 'p-high',
    createdAt: minutesAgo(120),
    responseDueAt: minutesAgo(60),
    resolutionDueAt: minutesAgo(-360),
    firstResponseAt: minutesAgo(100),
    resolvedAt: null,
    closedAt: null,
    pausedAt: minutesAgo(30),
    pausedTotalSeconds: 0,
    responseSlaState: 'met',
    resolutionSlaState: 'on_track',
    riskNotifiedAt: null,
    breachNotifiedAt: null,
  };

  it('ayni istekte durum ve oncelik degisirse yeni hedefler guncel bekleme suresini icerir', async () => {
    const { useCases, state, published } = setup([onHold]);

    await useCases.update(admin, 'ticket-1', { status: 'in_progress', priority: 'urgent' });

    const saved = state.tickets.get('ticket-1')!;
    // 30 dk beklemede kaldi; urgent cozum hedefi = acilis + 240 dk + 30 dk.
    expect(saved.pausedTotalSeconds).toBe(30 * 60);
    expect(saved.resolutionDueAt).toEqual(new Date(onHold.createdAt.getTime() + (240 + 30) * MINUTE_MS));
    expect(saved.slaPolicyId).toBe('p-urgent');
    expect(state.events.map((e) => e.type)).toEqual(['status_changed']);
    expect(published[0]?.payload).toMatchObject({ changes: ['status', 'priority'] });
  });

  it('gelistirici atama yapamaz; hicbir degisiklik yazilmaz', async () => {
    const { useCases, state, published } = setup([onHold]);
    const developer: AuthUser = { ...admin, id: 'dev-1', role: 'developer', teamId: 'team-1' };

    await expect(useCases.update(developer, 'ticket-1', { assigneeId: null })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(state.tickets.get('ticket-1')).toEqual(onHold);
    expect(published).toEqual([]);
  });
});
