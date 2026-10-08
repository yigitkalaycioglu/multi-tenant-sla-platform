import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/types/domain.js';

// scopeClause saf bir fonksiyon ama ayni modul veritabani, Redis ve kuyruk
// baglantilarini import ediyor. Test sirasinda baglanti acilmasin diye taklit ediyoruz.
vi.mock('../src/db/pool.js', () => ({ withTenant: vi.fn(), pool: {}, adminPool: {} }));
vi.mock('../src/realtime/bus.js', () => ({ publishRealtime: vi.fn() }));
vi.mock('../src/queue/index.js', () => ({ enqueueNotification: vi.fn() }));

const { scopeClause } = await import('../src/modules/tickets/ticket.service.js');

const developer: AuthUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'kuzey',
  email: 'burak@kuzey.io',
  fullName: 'Burak Sahin',
  role: 'developer',
  teamId: null,
};

describe('bilet gorunurluk kapsami', () => {
  it('yonetici kiracidaki tum biletleri gorur ve parametre eklenmez', () => {
    const params: unknown[] = ['open'];
    expect(scopeClause({ ...developer, role: 'admin' }, params)).toBe('TRUE');
    expect(params).toEqual(['open']);
  });

  it('ekibi olan kullanici kendi biletlerini ve ekibinin biletlerini gorur', () => {
    const params: unknown[] = ['open'];
    const sql = scopeClause({ ...developer, role: 'team_lead', teamId: 'team-9' }, params);

    // Onceki parametreler korunur, numaralar onlarin arkasindan devam eder.
    expect(sql).toBe('(t.assignee_id = $2 OR t.reporter_id = $2 OR t.team_id = $3)');
    expect(params).toEqual(['open', 'user-1', 'team-9']);
  });

  it('ekibi olmayan kullanici sadece kendisine atanan ve actigi biletleri gorur', () => {
    const params: unknown[] = [];
    expect(scopeClause(developer, params)).toBe('(t.assignee_id = $1 OR t.reporter_id = $1)');
    expect(params).toEqual(['user-1']);
  });
});
