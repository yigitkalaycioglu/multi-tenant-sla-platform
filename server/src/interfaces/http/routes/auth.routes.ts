import { Router, type CookieOptions, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AuthUseCases, SessionResult } from '../../../application/auth/auth.use-cases.js';
import { unauthenticated } from '../../../domain/errors.js';
import { getAuth } from '../middleware/auth.js';
import { parseOrThrow, passwordSchema } from '../validation.js';

export const REFRESH_COOKIE = 'sla_rt';

const registerSchema = z.object({
  tenantName: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Slug yalnizca kucuk harf, rakam ve tire icerebilir'),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email('Gecerli bir e-posta girin'),
  password: passwordSchema,
});

const loginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(2).max(40),
  email: z.string().trim().toLowerCase().email('Gecerli bir e-posta girin'),
  password: z.string().min(1, 'Sifre gerekli'),
});

export function authRoutes(deps: {
  auth: AuthUseCases;
  requireAuth: RequestHandler;
  authRateLimit: RequestHandler;
  secureCookies: boolean;
}): Router {
  const { auth, requireAuth, authRateLimit, secureCookies } = deps;

  const cookieOptions = (expiresAt: Date): CookieOptions => ({
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/api/auth',
    expires: expiresAt,
  });

  /**
   * Access token yanit govdesinde doner (istemci bellekte tutar),
   * refresh token ise yalnizca httpOnly cerezde yasar — XSS ile okunamaz.
   */
  function sendSession(res: Response, session: SessionResult): void {
    res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(session.refreshExpiresAt));
    res.json({ accessToken: session.accessToken, user: session.user });
  }

  const router = Router();

  router.post('/register', authRateLimit, async (req, res) => {
    const body = parseOrThrow(registerSchema, req.body, 'Kayit');
    const session = await auth.registerTenant({ ...body, userAgent: req.get('user-agent') });
    res.status(201);
    sendSession(res, session);
  });

  router.post('/login', authRateLimit, async (req, res) => {
    const body = parseOrThrow(loginSchema, req.body, 'Giris');
    sendSession(res, await auth.login({ ...body, userAgent: req.get('user-agent') }));
  });

  router.post('/refresh', async (req, res) => {
    const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!cookie) throw unauthenticated('Oturum bulunamadi');
    sendSession(res, await auth.refresh(cookie, req.get('user-agent')));
  });

  router.post('/logout', async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: getAuth(req) });
  });

  return router;
}
