import { Router, type CookieOptions, type Response } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate.js';
import { authRateLimit } from '../../middleware/rateLimit.js';
import { requireAuth, getAuth } from '../../middleware/auth.js';
import { isProd } from '../../config/env.js';
import { login, logout, refreshSession, registerTenant, type SessionResult } from './auth.service.js';
import { unauthorized } from '../../lib/errors.js';

export const REFRESH_COOKIE = 'sla_rt';

const cookieOptions = (expiresAt: Date): CookieOptions => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/api/auth',
  expires: expiresAt,
});

/**
 * Access token yanit govdesinde doner (istemci bellekte tutar),
 * refresh token ise yalnizca httpOnly cerezde yasar — XSS ile okunamaz.
 */
function sendSession(res: Response, session: SessionResult): void {
  res.cookie(REFRESH_COOKIE, `${session.user.tenantId}.${session.refreshToken}`, cookieOptions(session.refreshExpiresAt));
  res.json({ accessToken: session.accessToken, user: session.user });
}

const passwordSchema = z
  .string()
  .min(8, 'Sifre en az 8 karakter olmali')
  .max(128)
  .regex(/[A-Za-z]/, 'Sifre en az bir harf icermeli')
  .regex(/[0-9]/, 'Sifre en az bir rakam icermeli');

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

export const authRouter: Router = Router();

authRouter.post('/register', authRateLimit, async (req, res) => {
  const body = parseOrThrow(registerSchema, req.body, 'Kayit');
  const session = await registerTenant({ ...body, userAgent: req.get('user-agent') });
  res.status(201);
  sendSession(res, session);
});

authRouter.post('/login', authRateLimit, async (req, res) => {
  const body = parseOrThrow(loginSchema, req.body, 'Giris');
  const session = await login({ ...body, userAgent: req.get('user-agent') });
  sendSession(res, session);
});

authRouter.post('/refresh', async (req, res) => {
  const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!cookie) throw unauthorized('Oturum bulunamadi');
  const session = await refreshSession(cookie, req.get('user-agent'));
  sendSession(res, session);
});

authRouter.post('/logout', async (req, res) => {
  await logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: getAuth(req) });
});
