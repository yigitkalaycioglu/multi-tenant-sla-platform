import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../src/domain/identity.js';
import {
  canChangeTicketStatus,
  canEditTicketContent,
  canManageTicket,
  ticketVisibilityFor,
} from '../../src/domain/tickets/ticket-access.js';
import { visibilitySql } from '../../src/infrastructure/db/repositories/ticket-visibility.sql.js';

const developer: AuthUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'kuzey',
  email: 'burak@kuzey.io',
  fullName: 'Burak Sahin',
  role: 'developer',
  teamId: null,
};

describe('bilet gorunurluk kurali', () => {
  it('yonetici kiracidaki tum biletleri gorur', () => {
    expect(ticketVisibilityFor({ ...developer, role: 'admin' })).toEqual({ scope: 'tenant' });
  });

  it('diger roller yalnizca katildiklari biletleri gorur', () => {
    expect(ticketVisibilityFor({ ...developer, role: 'team_lead', teamId: 'team-9' })).toEqual({
      scope: 'participant',
      userId: 'user-1',
      teamId: 'team-9',
    });
  });
});

describe('gorunurlugun SQL karsiligi', () => {
  it('kiraci kapsami parametre eklemez', () => {
    const params: unknown[] = ['open'];
    expect(visibilitySql({ scope: 'tenant' }, params)).toBe('TRUE');
    expect(params).toEqual(['open']);
  });

  it('ekibi olan kullanici kendi biletlerini ve ekibinin biletlerini gorur', () => {
    const params: unknown[] = ['open'];
    const sql = visibilitySql({ scope: 'participant', userId: 'user-1', teamId: 'team-9' }, params);

    // Onceki parametreler korunur, numaralar onlarin arkasindan devam eder.
    expect(sql).toBe('(t.assignee_id = $2 OR t.reporter_id = $2 OR t.team_id = $3)');
    expect(params).toEqual(['open', 'user-1', 'team-9']);
  });

  it('ekibi olmayan kullanici sadece kendisine atanan ve actigi biletleri gorur', () => {
    const params: unknown[] = [];
    expect(visibilitySql(ticketVisibilityFor(developer), params)).toBe('(t.assignee_id = $1 OR t.reporter_id = $1)');
    expect(params).toEqual(['user-1']);
  });
});

describe('bilet uzerinde yetki', () => {
  const lead: AuthUser = { ...developer, id: 'lead-1', role: 'team_lead', teamId: 'team-9' };
  const ticket = { teamId: 'team-9', assigneeId: 'user-1', reporterId: 'user-2' };

  it('ekip lideri yalnizca kendi ekibinin biletini yonetir', () => {
    expect(canManageTicket(lead, ticket)).toBe(true);
    expect(canManageTicket(lead, { ...ticket, teamId: 'team-1' })).toBe(false);
    expect(canManageTicket(lead, { ...ticket, teamId: null })).toBe(false);
  });

  it('gelistirici yalnizca uzerindeki biletin durumunu degistirir', () => {
    expect(canChangeTicketStatus(developer, ticket)).toBe(true);
    expect(canChangeTicketStatus(developer, { ...ticket, assigneeId: 'baska' })).toBe(false);
  });

  it('bileti acan kisi icerigi duzenleyebilir', () => {
    expect(canEditTicketContent({ ...developer, id: 'user-2' }, { ...ticket, assigneeId: null })).toBe(true);
    expect(canEditTicketContent({ ...developer, id: 'user-3' }, ticket)).toBe(false);
  });
});
