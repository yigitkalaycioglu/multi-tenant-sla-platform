import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Birim testleri veritabanina ya da Redis'e baglanmaz; env.ts'in dogrulamasindan
    // gecmek icin ornek degerler yeterli. Gercek .env varsa bunlar onun yerine gecer.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://app_user:app_user_pw@localhost:5432/sla_platform',
      DATABASE_ADMIN_URL: 'postgres://postgres:postgres@localhost:5432/sla_platform',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
    },
  },
});
