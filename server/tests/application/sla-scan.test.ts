import { describe, expect, it } from 'vitest';
import type { NotificationJob, RealtimeMessage } from '../../src/application/ports/events.js';
import type { Logger } from '../../src/application/ports/runtime.js';
import type { SlaTransitionHit } from '../../src/application/sla/sla-scan.ports.js';
import { makeRunSlaScan } from '../../src/application/sla/sla-scan.use-case.js';

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
};

function hit(dueAt: Date): SlaTransitionHit {
  return {
    ticketId: 'ticket-1',
    tenantId: 'tenant-1',
    reference: 'TCK-000001',
    title: 'Odeme servisi 502',
    priority: 'urgent',
    dueAt,
    emailRecipients: ['burak@kuzey.io'],
    watcherIds: ['dev-1'],
    audience: { teamId: 'team-1', assigneeId: 'dev-1', reporterId: 'admin-1' },
  };
}

function scanWith(hits: SlaTransitionHit[]) {
  const enqueued: Array<{ job: NotificationJob; dedupeKey?: string }> = [];
  const published: RealtimeMessage[] = [];
  const run = makeRunSlaScan({
    scanner: {
      markTransitions: async (window, transition) =>
        window === 'resolution' && transition === 'breached' ? hits : [],
    },
    realtime: { publish: async (m) => void published.push(m) },
    notifications: { enqueue: async (job, dedupeKey) => void enqueued.push({ job, dedupeKey }) },
    clock: { now: () => new Date('2025-03-10T12:00:00Z') },
    log: silentLog,
    riskThreshold: 0.8,
  });
  return { run, enqueued, published };
}

describe('SLA taramasi bildirimleri', () => {
  it('ayni bilet yeni bir hedefle tekrar ihlale duserse yeni bir bildirim anahtari uretir', async () => {
    // Oncelik degisimi hedefi kaydirir ve "bildirildi" isaretini sifirlar; ikinci
    // ihlal, kuyrukta hala duran ilk isle ayni anahtari alirsa sessizce dusurulur.
    const first = scanWith([hit(new Date('2025-03-10T10:00:00Z'))]);
    const second = scanWith([hit(new Date('2025-03-10T11:00:00Z'))]);
    await first.run();
    await second.run();

    expect(first.enqueued[0]?.dedupeKey).toBeDefined();
    expect(first.enqueued[0]?.dedupeKey).not.toBe(second.enqueued[0]?.dedupeKey);
  });

  it('ayni gecis icin anahtar deterministiktir (tekrar calisan tarama cift e-posta uretmez)', async () => {
    const a = scanWith([hit(new Date('2025-03-10T10:00:00Z'))]);
    const b = scanWith([hit(new Date('2025-03-10T10:00:00Z'))]);
    await a.run();
    await b.run();
    expect(a.enqueued[0]?.dedupeKey).toBe(b.enqueued[0]?.dedupeKey);
  });

  it('canli olay bilet kapsamini tasir; gorme yetkisi olmayan kullaniciya iletilmez', async () => {
    const { run, published } = scanWith([hit(new Date('2025-03-10T10:00:00Z'))]);
    await run();
    expect(published[0]).toMatchObject({
      event: 'sla:breached',
      audience: { teamId: 'team-1', assigneeId: 'dev-1', reporterId: 'admin-1' },
    });
  });
});
