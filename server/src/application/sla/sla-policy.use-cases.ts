import { assertPermission, type AuthUser } from '../../domain/identity.js';
import { assertValidTargets, type SlaTargets } from '../../domain/sla/sla-policy.js';
import type { TicketPriority } from '../../domain/tickets/ticket.js';
import type { TenantTransactions } from '../ports/transactions.js';
import type { SlaPolicyRecord } from './sla-policy.ports.js';

export interface SlaPolicyDeps {
  tx: TenantTransactions;
}

const toDto = (r: SlaPolicyRecord) => ({
  id: r.id,
  priority: r.priority,
  responseMinutes: r.responseMinutes,
  resolutionMinutes: r.resolutionMinutes,
  ticketCount: r.ticketCount,
  breachedCount: r.breachedCount,
  updatedAt: r.updatedAt.toISOString(),
});

export function makeSlaPolicyUseCases({ tx }: SlaPolicyDeps) {
  return {
    async list(actor: AuthUser) {
      const records = await tx.run(actor.tenantId, ({ slaPolicies }) => slaPolicies.listWithStats());
      return records.map(toDto);
    },

    /**
     * Politikayi gunceller (yoksa olusturur).
     *
     * Not: Degisiklik yalnizca BUNDAN SONRA acilacak biletlere uygulanir; acik
     * biletlerin hedefleri korunur — gecmise donuk SLA degisimi denetim acisindan
     * dogru degildir. Bir biletin hedefini degistirmek icin oncelik degistirilir.
     */
    async upsert(actor: AuthUser, priority: TicketPriority, targets: SlaTargets) {
      assertPermission(actor, 'sla:manage');
      assertValidTargets(targets);

      const record = await tx.run(actor.tenantId, ({ slaPolicies }) => slaPolicies.upsert(priority, targets));
      return toDto(record);
    },
  };
}

export type SlaPolicyUseCases = ReturnType<typeof makeSlaPolicyUseCases>;
