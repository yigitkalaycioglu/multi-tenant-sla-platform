import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src/infrastructure/config -> proje kokunun .env dosyasi
loadDotenv({ path: path.resolve(here, '../../../../.env') });
loadDotenv();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().min(1),
  APP_DB_USER: z.string().min(1).default('app_user'),
  APP_DB_PASSWORD: z.string().min(1).default('app_user_pw'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  SLA_SCAN_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),
  SLA_RISK_THRESHOLD: z.coerce.number().min(0.1).max(0.99).default(0.8),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('SLA Platform <no-reply@slaplatform.local>'),

  /** E-postalardaki "Bileti ac" baglantisinin koku. */
  APP_PUBLIC_URL: z.string().default('http://localhost:5173'),

  SEED_PASSWORD: z.string().min(6).default('Passw0rd!'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Ortam degiskenleri gecersiz:\n${issues}\n\n.env.example dosyasini .env olarak kopyalayin.`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/** CORS_ORIGIN virgulle ayrilmis birden fazla origin alabilir. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
