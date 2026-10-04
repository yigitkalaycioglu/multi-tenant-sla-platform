import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth, setAccessToken, setSessionLostHandler } from '../api/client';
import type { AuthUser, UserRole } from '../api/types';

interface AuthState {
  user: AuthUser | null;
  /** Ilk oturum geri yukleme denemesi surerken true. */
  booting: boolean;
  login: (input: { tenantSlug: string; email: string; password: string }) => Promise<void>;
  register: (input: {
    tenantName: string;
    slug: string;
    adminName: string;
    adminEmail: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Rol kontrolu: `is('admin')` ya da `is('admin', 'team_lead')`. */
  is: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);
  const queryClient = useQueryClient();

  // Sayfa yenilendiginde httpOnly refresh cerezinden oturumu geri getir.
  useEffect(() => {
    let cancelled = false;
    void auth
      .refresh()
      .then((session) => {
        if (!cancelled && session) setUser(session.user);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh de basarisiz olursa (token iptal/suresi doldu) oturumu dusur.
  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => setSessionLostHandler(null);
  }, [queryClient]);

  const login = useCallback<AuthState['login']>(async (input) => {
    const session = await auth.login(input);
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const register = useCallback<AuthState['register']>(async (input) => {
    const session = await auth.register(input);
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    await auth.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      booting,
      login,
      register,
      logout,
      is: (...roles: UserRole[]) => (user ? roles.includes(user.role) : false),
    }),
    [user, booting, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth yalnizca AuthProvider icinde kullanilabilir');
  return context;
}
