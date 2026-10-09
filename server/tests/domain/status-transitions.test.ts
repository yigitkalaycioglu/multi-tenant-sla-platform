import { describe, expect, it } from 'vitest';
import { STATUS_TRANSITIONS, type TicketStatus } from '../../src/domain/tickets/ticket.js';

describe('durum gecis matrisi', () => {
  it('her durumun en az bir cikisi vardir', () => {
    for (const [status, next] of Object.entries(STATUS_TRANSITIONS)) {
      expect(next.length, `${status} icin gecis tanimli degil`).toBeGreaterThan(0);
    }
  });

  it('hicbir durum kendine gecemez', () => {
    for (const [status, next] of Object.entries(STATUS_TRANSITIONS)) {
      expect(next).not.toContain(status as TicketStatus);
    }
  });

  it('kapali bilet yalnizca yeniden acilabilir', () => {
    expect(STATUS_TRANSITIONS.closed).toEqual(['in_progress']);
  });

  it('beklemedeki bilet dogrudan cozulebilir', () => {
    expect(STATUS_TRANSITIONS.on_hold).toContain('resolved');
  });
});
