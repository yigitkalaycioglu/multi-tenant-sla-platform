import { describe, expect, it } from 'vitest';
import { MINUTE_MS } from '../../src/domain/sla/sla-engine.js';
import type { SlaPolicy } from '../../src/domain/sla/sla-policy.js';
import { changePriority, changeStatus, registerFirstResponse } from '../../src/domain/tickets/ticket-lifecycle.js';
import type { Ticket } from '../../src/domain/tickets/ticket.js';

const T0 = new Date('2025-03-10T09:00:00.000Z');
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * MINUTE_MS);

/** Saat 09:00'da acilmis, yanit hedefi 60 dk, cozum hedefi 480 dk olan bilet. */
function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    tenantId: 'tenant-1',
    reference: 'TCK-000001',
    title: 'Odeme servisi 502 donuyor',
    description: '',
    status: 'open',
    priority: 'high',
    teamId: 'team-1',
    assigneeId: 'dev-1',
    reporterId: 'reporter-1',
    slaPolicyId: 'policy-high',
    createdAt: T0,
    responseDueAt: at(60),
    resolutionDueAt: at(480),
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    pausedAt: null,
    pausedTotalSeconds: 0,
    responseSlaState: 'on_track',
    resolutionSlaState: 'on_track',
    riskNotifiedAt: null,
    breachNotifiedAt: null,
    ...overrides,
  };
}

describe('durum gecisi', () => {
  it('izin verilmeyen gecisi "invalid" hatasiyla reddeder', () => {
    expect(() => changeStatus(ticket({ status: 'closed' }), 'on_hold', at(10))).toThrowError(
      expect.objectContaining({ kind: 'invalid' }) as unknown as Error,
    );
  });

  it('beklemeye alinca SLA saati durur', () => {
    const changes = changeStatus(ticket({ status: 'in_progress' }), 'on_hold', at(30));
    expect(changes.status).toBe('on_hold');
    expect(changes.pausedAt).toEqual(at(30));
  });

  it('beklemeden donunce hedefler beklenen sure kadar ileri kayar', () => {
    const changes = changeStatus(ticket({ status: 'on_hold', pausedAt: at(30) }), 'in_progress', at(90));

    expect(changes.pausedAt).toBeNull();
    expect(changes.pausedTotalSeconds).toBe(60 * 60);
    expect(changes.responseDueAt).toEqual(at(120));
    expect(changes.resolutionDueAt).toEqual(at(540));
  });

  it('zamaninda cozulen bilet "met" olarak muhurlenir ve ilk yanit da sayilir', () => {
    const changes = changeStatus(ticket({ status: 'in_progress' }), 'resolved', at(45));

    expect(changes.resolvedAt).toEqual(at(45));
    expect(changes.resolutionSlaState).toBe('met');
    expect(changes.firstResponseAt).toEqual(at(45));
    expect(changes.responseSlaState).toBe('met');
  });

  it('gec cozulen bilet "breached" olarak muhurlenir; onceki ilk yanita dokunulmaz', () => {
    const changes = changeStatus(ticket({ status: 'in_progress', firstResponseAt: at(20) }), 'closed', at(500));

    expect(changes.resolutionSlaState).toBe('breached');
    expect(changes.closedAt).toEqual(at(500));
    expect(changes).not.toHaveProperty('firstResponseAt');
  });

  it('beklemeden dogrudan cozulen bilet kaydirilmis hedefe gore muhurlenir', () => {
    // 400. dakikada beklemeye alindi, 200 dk bekledi, 600. dakikada cozuldu.
    // Aktif sure 400 dk < 480 dk hedef: zamaninda. Kaydirilmis hedef = 680. dakika.
    const changes = changeStatus(ticket({ status: 'on_hold', pausedAt: at(400) }), 'resolved', at(600));

    expect(changes.resolutionDueAt).toEqual(at(680));
    expect(changes.resolutionSlaState).toBe('met');
  });

  it('beklemeden dogrudan kapatilan bilette ilk yanit da kaydirilmis hedefe gore muhurlenir', () => {
    // 30. dakikada beklemeye alindi, 60 dk bekledi, 90. dakikada kapatildi.
    // Yanit icin aktif sure 30 dk < 60 dk hedef: zamaninda. Kaydirilmis hedef = 120. dakika.
    const changes = changeStatus(ticket({ status: 'on_hold', pausedAt: at(30) }), 'closed', at(90));

    expect(changes.firstResponseAt).toEqual(at(90));
    expect(changes.responseSlaState).toBe('met');
  });

  it('yeniden acilan biletin cozum alanlari ve bildirim isaretleri temizlenir', () => {
    const changes = changeStatus(
      ticket({ status: 'closed', resolvedAt: at(100), closedAt: at(110), breachNotifiedAt: at(90) }),
      'in_progress',
      at(200),
    );

    expect(changes).toMatchObject({
      resolvedAt: null,
      closedAt: null,
      resolutionSlaState: 'on_track',
      breachNotifiedAt: null,
      riskNotifiedAt: null,
    });
  });
});

describe('oncelik degisimi', () => {
  const urgent: SlaPolicy = { id: 'policy-urgent', priority: 'urgent', responseMinutes: 15, resolutionMinutes: 240 };

  it('hedefler acilis anindan yeni politikaya gore, bekleme suresi eklenerek hesaplanir', () => {
    const changes = changePriority(ticket({ pausedTotalSeconds: 30 * 60 }), 'urgent', urgent);

    expect(changes.slaPolicyId).toBe('policy-urgent');
    expect(changes.responseDueAt).toEqual(at(15 + 30));
    expect(changes.resolutionDueAt).toEqual(at(240 + 30));
  });

  it('acik bilette SLA durumlari tarayicinin yeniden degerlendirmesi icin sifirlanir', () => {
    const changes = changePriority(
      ticket({ resolutionSlaState: 'at_risk', riskNotifiedAt: at(300), firstResponseAt: at(10) }),
      'urgent',
      urgent,
    );

    expect(changes).toMatchObject({
      responseSlaState: 'met',
      resolutionSlaState: 'on_track',
      riskNotifiedAt: null,
      breachNotifiedAt: null,
    });
  });

  it('cozulmus bilette muhurlenen SLA sonucuna dokunulmaz', () => {
    const changes = changePriority(ticket({ status: 'resolved', resolutionSlaState: 'breached' }), 'urgent', urgent);
    expect(changes).not.toHaveProperty('resolutionSlaState');
  });

  it('politika yoksa yalnizca oncelik degisir', () => {
    expect(changePriority(ticket(), 'low', null)).toEqual({ priority: 'low' });
  });
});

describe('ilk yanit', () => {
  it('bileti acanin kendi yorumu ilk yanit sayilmaz', () => {
    expect(registerFirstResponse(ticket(), { authorId: 'reporter-1', isInternal: false }, at(5))).toBeNull();
  });

  it('dahili not ilk yanit sayilmaz', () => {
    expect(registerFirstResponse(ticket(), { authorId: 'dev-1', isInternal: true }, at(5))).toBeNull();
  });

  it('zaten yanitlanmis bilette tekrar kaydedilmez', () => {
    expect(registerFirstResponse(ticket({ firstResponseAt: at(1) }), { authorId: 'dev-1', isInternal: false }, at(5)))
      .toBeNull();
  });

  it('hedeften once ya da sonra verilmesine gore muhurlenir', () => {
    expect(registerFirstResponse(ticket(), { authorId: 'dev-1', isInternal: false }, at(30))).toEqual({
      firstResponseAt: at(30),
      responseSlaState: 'met',
    });
    expect(registerFirstResponse(ticket(), { authorId: 'dev-1', isInternal: false }, at(90))?.responseSlaState).toBe(
      'breached',
    );
  });
});
