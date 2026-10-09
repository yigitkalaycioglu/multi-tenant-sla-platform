/**
 * Arka plan worker sureci: SLA taramasi ve e-posta bildirimleri.
 *
 * API'den ayri bir konteyner olarak calisir; boylece yogun e-posta trafigi
 * HTTP yanit surelerini etkilemez ve worker bagimsiz olceklenebilir.
 */
import { logger } from '../infrastructure/logger.js';
import { buildWorkerContainer } from './container.js';

async function main(): Promise<void> {
  const stop = await buildWorkerContainer().start();
  logger.info('Worker calisiyor');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker kapatiliyor');
    await stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Worker baslatilamadi');
  process.exit(1);
});
