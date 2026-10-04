import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { initRealtime } from './realtime/io.js';
import { closePools } from './db/pool.js';
import { closeQueues } from './queue/index.js';
import { redis } from './lib/redis.js';

const app = createApp();
const server = http.createServer(app);

initRealtime(server);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API ve Socket.io dinlemede');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Kapatiliyor');

  // Yeni baglanti kabul etmeyi birak, acik istekleri tamamla.
  server.close(() => logger.info('HTTP sunucusu kapandi'));

  const timeout = setTimeout(() => {
    logger.warn('Zamaninda kapanamadi, zorla cikiliyor');
    process.exit(1);
  }, 10_000);
  timeout.unref();

  await closeQueues().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await closePools();

  clearTimeout(timeout);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Yakalanmamis promise reddi'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Yakalanmamis istisna');
  void shutdown('uncaughtException');
});
