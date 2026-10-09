import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import { assertPermission, can, PERMISSIONS, type Permission } from '../../src/domain/identity.js';

const ALL = Object.keys(PERMISSIONS) as Permission[];

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    return err as DomainError;
  }
  throw new Error('hata bekleniyordu');
}

describe('izin matrisi', () => {
  it('yonetici her izne sahiptir', () => {
    expect(ALL.every((p) => can('admin', p))).toBe(true);
  });

  it('ekip lideri atama yapabilir ama kullanici, SLA ve silme yetkisi yoktur', () => {
    expect(can('team_lead', 'ticket:assign')).toBe(true);
    expect(can('team_lead', 'ticket:update-any')).toBe(true);
    expect(can('team_lead', 'report:view-all')).toBe(true);
    expect(can('team_lead', 'user:manage')).toBe(false);
    expect(can('team_lead', 'sla:manage')).toBe(false);
    expect(can('team_lead', 'ticket:delete')).toBe(false);
  });

  it('gelistirici sadece bilet acabilir', () => {
    expect(ALL.filter((p) => can('developer', p))).toEqual(['ticket:create']);
  });
});

describe('assertPermission', () => {
  it('izni olan kullaniciyi gecirir', () => {
    expect(() => assertPermission({ role: 'team_lead' }, 'ticket:assign')).not.toThrow();
  });

  it('izni olmayan kullanici icin "forbidden" hatasi firlatir', () => {
    const err = errorOf(() => assertPermission({ role: 'developer' }, 'user:manage'));
    expect(err).toBeInstanceOf(DomainError);
    expect(err.kind).toBe('forbidden');
  });
});
