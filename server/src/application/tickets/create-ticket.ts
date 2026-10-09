import { invalid } from '../../domain/errors.js';
import type { AuthUser } from '../../domain/identity.js';
import { computeDueDates } from '../../domain/sla/sla-engine.js';
import { ticketVisibilityFor } from '../../domain/tickets/ticket-access.js';
import { formatTicketReference, type TicketPriority } from '../../domain/tickets/ticket.js';
import { toTicketDto, type TicketDto } from './ticket-dto.js';
import { requireRecord } from './ticket-lookup.js';
import type { TicketDeps } from './ticket.use-cases.js';

export interface CreateTicketInput {
  title: string;
  description?: string;
  priority: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
}

export function makeCreateTicket({ tx, realtime, notifications, clock, log, slaRiskThreshold }: TicketDeps) {
  return async function createTicket(actor: AuthUser, input: CreateTicketInput): Promise<TicketDto> {
    const { dto, assigneeEmail } = await tx.run(actor.tenantId, async ({ tickets, slaPolicies, users }) => {
      // 1) Kiraci bazli bilet numarasi. Sayac satiri transaction bitene kadar
      //    kilitli kalir; baska bir istek ayni numarayi alamaz.
      const reference = formatTicketReference(await tickets.nextSequence());

      // 2) Oncelige karsilik gelen SLA politikasi
      const policy = await slaPolicies.findByPriority(input.priority);
      const createdAt = clock.now();
      const dues = policy ? computeDueDates(createdAt, policy) : null;

      // 3) Atanan kisi dogrulanir (RLS sayesinde baska kiracidan kullanici gelemez)
      let assigneeEmail: string | null = null;
      if (input.assigneeId) {
        assigneeEmail = await users.findActiveEmail(input.assigneeId);
        if (!assigneeEmail) throw invalid('Atanacak kullanici bulunamadi');
      }

      const ticketId = await tickets.insert({
        reference,
        title: input.title,
        description: input.description ?? '',
        priority: input.priority,
        teamId: input.teamId ?? null,
        assigneeId: input.assigneeId ?? null,
        reporterId: actor.id,
        slaPolicyId: policy?.id ?? null,
        createdAt,
        responseDueAt: dues?.responseDueAt ?? null,
        resolutionDueAt: dues?.resolutionDueAt ?? null,
      });

      await tickets.recordEvent(ticketId, actor.id, 'created', { priority: input.priority, reference });
      if (input.assigneeId) {
        await tickets.recordEvent(ticketId, actor.id, 'assigned', { assigneeId: input.assigneeId });
      }

      const record = await requireRecord(tickets, ticketId, ticketVisibilityFor(actor));
      return { dto: toTicketDto(record, clock.now(), slaRiskThreshold), assigneeEmail };
    });

    // Transaction kapandiktan SONRA yan etkiler: canli olay + e-posta kuyrugu.
    await realtime.publish({ tenantId: actor.tenantId, event: 'ticket:created', payload: dto, ticketId: dto.id });

    if (assigneeEmail && dto.assignee) {
      await notifications.enqueue(
        {
          kind: 'ticket_assigned',
          tenantId: actor.tenantId,
          ticketId: dto.id,
          reference: dto.reference,
          title: dto.title,
          priority: dto.priority,
          dueAt: dto.sla.resolution.dueAt ?? clock.now().toISOString(),
          recipients: [assigneeEmail],
          assignedBy: actor.fullName,
        },
        `assigned:${dto.id}:${dto.assignee.id}`,
      );
    }

    log.info({ ticketId: dto.id, reference: dto.reference, tenantId: actor.tenantId }, 'Bilet olusturuldu');
    return dto;
  };
}
