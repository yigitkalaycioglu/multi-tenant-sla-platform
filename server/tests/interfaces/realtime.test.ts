import { describe, expect, it } from 'vitest';
import type { RealtimeMessage } from '../../src/application/ports/events.js';
import type { AuthUser } from '../../src/domain/identity.js';
import { canReceive, rooms } from '../../src/interfaces/realtime/socket-server.js';

const dev: AuthUser = {
  id: 'dev-1',
  tenantId: 'tenant-a',
  tenantSlug: 'kuzey',
  email: 'burak@kuzey.io',
  fullName: 'Burak Sahin',
  role: 'developer',
  teamId: 'team-1',
};

const message = (overrides: Partial<RealtimeMessage> = {}): RealtimeMessage => ({
  tenantId: 'tenant-a',
  event: 'ticket:updated',
  payload: {},
  ticketId: 'ticket-1',
  audience: { teamId: 'team-1', assigneeId: null, reporterId: 'admin-1' },
  ...overrides,
});

describe('canli olay alicilari', () => {
  it('bilet odasi kiraci kapsamlidir: ayni bilet kimligi baska kiracida farkli odadir', () => {
    expect(rooms.ticket('tenant-a', 'ticket-1')).not.toBe(rooms.ticket('tenant-b', 'ticket-1'));
  });

  it('baska kiracinin kullanicisi olayi almaz', () => {
    expect(canReceive({ ...dev, tenantId: 'tenant-b', role: 'admin' }, message())).toBe(false);
  });

  it('bileti gorebilen kullanici olayi alir', () => {
    expect(canReceive(dev, message())).toBe(true);
    expect(canReceive({ ...dev, role: 'admin', teamId: null }, message())).toBe(true);
  });

  it('rol kapsami disindaki gelistirici bilet olayini almaz', () => {
    expect(canReceive({ ...dev, teamId: 'team-2' }, message())).toBe(false);
    expect(canReceive({ ...dev, teamId: null }, message())).toBe(false);
  });

  it('bilete ozel olmayan olaylar kiracidaki herkese gider', () => {
    expect(canReceive({ ...dev, teamId: null }, message({ audience: undefined, event: 'ticket:deleted' }))).toBe(true);
  });
});
