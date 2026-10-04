import type { ApiErrorBody, AuthUser } from './types';

/**
 * API istemcisi.
 *
 * Access token yalnizca BELLEKTE tutulur (localStorage'a yazilmaz) — XSS ile
 * calinmasi zorlasir. Kalicilik httpOnly refresh cerezinden gelir: sayfa
 * yenilendiginde `/api/auth/refresh` cagrilir ve yeni bir access token alinir.
 *
 * 401 alan her istek, bir kez refresh denemesi yapip otomatik tekrarlanir.
 * Es zamanli 401'ler tek bir refresh isteginde birlestirilir.
 */

let accessToken: string | null = null;
export interface Session {
  accessToken: string;
  user: AuthUser;
}

let refreshPromise: Promise<Session | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Array<{ field: string; message: string }>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.fieldErrors = Array.isArray(body?.error?.details)
      ? (body.error.details as Array<{ field: string; message: string }>)
      : [];
  }
}

async function readError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  return new ApiError(res.status, body, `Istek basarisiz (${res.status})`);
}

/** Tek ucusta bir refresh: paralel 401'ler ayni promise'i bekler. */
async function refreshAccessToken(): Promise<Session | null> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const data = (await res.json()) as Session;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      // Bir sonraki 401 yeni bir deneme baslatabilsin.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Sonsuz donguyu onlemek icin: refresh cagrisi kendini tekrar denemez. */
  retryOnUnauthorized?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, retryOnUnauthorized = true } = options;

  const send = async (token: string | null): Promise<Response> =>
    fetch(path, {
      method,
      credentials: 'include',
      signal: signal ?? null,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  let res = await send(accessToken);

  if (res.status === 401 && retryOnUnauthorized) {
    const fresh = await refreshAccessToken();
    if (!fresh) {
      accessToken = null;
      onSessionLost?.();
      throw await readError(res);
    }
    res = await send(fresh.accessToken);
  }

  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

/** Sorgu dizesini bos degerleri atlayarak kurar. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const auth = {
  login: (input: { tenantSlug: string; email: string; password: string }) =>
    apiFetch<{ accessToken: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: input,
      retryOnUnauthorized: false,
    }),

  register: (input: {
    tenantName: string;
    slug: string;
    adminName: string;
    adminEmail: string;
    password: string;
  }) =>
    apiFetch<{ accessToken: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: input,
      retryOnUnauthorized: false,
    }),

  refresh: refreshAccessToken,

  logout: () => apiFetch<void>('/api/auth/logout', { method: 'POST', retryOnUnauthorized: false }),

  me: () => apiFetch<{ user: AuthUser }>('/api/auth/me'),
};
