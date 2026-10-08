import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { can, PERMISSIONS, requirePermission, requireRole, type Permission } from '../src/middleware/rbac.js';
import type { AuthUser, UserRole } from '../src/types/domain.js';

const ALL = Object.keys(PERMISSIONS) as Permission[];

const user: AuthUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'kuzey',
  email: 'mert@kuzey.io',
  fullName: 'Mert Kaya',
  role: 'developer',
  teamId: 'team-1',
};

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

function run(mw: Middleware, role: UserRole): unknown {
  const next = vi.fn();
  mw({ auth: { ...user, role } } as unknown as Request, {} as Response, next);
  expect(next).toHaveBeenCalledOnce();
  return next.mock.calls[0]?.[0];
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

describe('yetki middleware', () => {
  it('izni olan kullaniciyi gecirir', () => {
    expect(run(requirePermission('ticket:assign'), 'team_lead')).toBeUndefined();
  });

  it('izni olmayan kullanici 403 alir', () => {
    const err = run(requirePermission('user:manage'), 'developer') as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(403);
  });

  it('rol kontrolu sadece istenen rolleri gecirir', () => {
    expect(run(requireRole('admin', 'team_lead'), 'team_lead')).toBeUndefined();
    expect((run(requireRole('admin'), 'team_lead') as AppError).status).toBe(403);
  });

  it('oturum yoksa 401 doner', () => {
    const mw = requireRole('admin');
    expect(() => mw({} as Request, {} as Response, vi.fn())).toThrowError(
      expect.objectContaining({ status: 401 }) as unknown as Error,
    );
  });
});
