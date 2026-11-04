import { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { toJobId } from '../../src/infrastructure/queue/queues.js';

/**
 * BullMQ'nun ozel jobId kuralini, kutuphanenin kendi dogrulamasiyla sinar.
 * Redis gerekmez: dogrulama, is Redis'e yazilmadan once calisir.
 */
function bullAccepts(jobId: string): boolean {
  const fakeQueue = { opts: {}, name: 'notifications', qualifiedName: 'bull:notifications', keys: {}, toKey: String };
  const job = new Job(fakeQueue as never, 'test', {}, { jobId });
  try {
    // `validateOptions` protected; `queue.add()` icinde Redis'e yazmadan once cagrilan
    // dogrulamanin aynisi oldugu icin testte dogrudan kullanilir.
    (job as unknown as { validateOptions(data: unknown): void }).validateOptions(job.asJSON());
    return true;
  } catch {
    return false;
  }
}

describe('bildirim isi kimligi', () => {
  // Uygulamanin urettigi tekillestirme anahtari bicimleri.
  const keys = [
    'assigned:2f1c0d3e-0000-4000-8000-000000000001:9a7b0c1d-0000-4000-8000-000000000002',
    'assigned:2f1c0d3e-0000-4000-8000-000000000001:9a7b0c1d-0000-4000-8000-000000000002:1730700000000',
    'breached:resolution:2f1c0d3e-0000-4000-8000-000000000001:1730700000000',
    'ticket_assigned:2f1c0d3e-0000-4000-8000-000000000001',
  ];

  it('BullMQ ham anahtarlarin bir kismini reddeder (hatanin kaynagi)', () => {
    expect(bullAccepts(keys[1]!)).toBe(false);
  });

  it('cevrilen her anahtar BullMQ tarafindan kabul edilir', () => {
    for (const key of keys) expect(bullAccepts(toJobId(key)), key).toBe(true);
  });

  it('cevirme farkli anahtarlari ayni kimlige indirgemez', () => {
    expect(new Set(keys.map(toJobId)).size).toBe(keys.length);
  });
});
