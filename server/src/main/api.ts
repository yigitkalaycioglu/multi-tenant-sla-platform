import http from 'node:http';
import { corsOrigins, env } from '../infrastructure/config/env.js';
import { logger } from '../infrastructure/logger.js';
import { createApp } from '../interfaces/http/app.js';
import { initRealtime } from '../interfaces/realtime/socket-server.js';
import { buildApiContainer } from './container.js';

const container = buildApiContainer();
const server = http.createServer(createApp(container.app));

const realtime = initRealtime(server, {
  tokens: container.app.tokens,
  subscribe: (handler) => container.realtime.subscribe(handler),
  corsOrigins,
  log: logger,
});

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

  await realtime.stopListening().catch(() => undefined);
  await container.close();

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
