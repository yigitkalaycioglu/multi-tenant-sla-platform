import { forbidden, invalid } from '../../domain/errors.js';
import { can, type AuthUser } from '../../domain/identity.js';
import {
  canChangeTicketStatus,
  canEditTicketContent,
  canManageTicket,
  ticketVisibilityFor,
} from '../../domain/tickets/ticket-access.js';
import { changePriority, changeStatus } from '../../domain/tickets/ticket-lifecycle.js';
import {
  OPEN_STATUSES,
  type TicketChanges,
  type TicketPriority,
  type TicketStatus,
} from '../../domain/tickets/ticket.js';
import { toTicketDto, type TicketDto } from './ticket-dto.js';
import { requireLocked, requireRecord } from './ticket-lookup.js';
import type { TicketDeps } from './ticket.use-cases.js';

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
}

export function makeUpdateTicket({ tx, realtime, notifications, clock, slaRiskThreshold }: TicketDeps) {
  return async function updateTicket(actor: AuthUser, ticketId: string, patch: UpdateTicketInput): Promise<TicketDto> {
    const { dto, changed, newAssigneeEmail } = await tx.run(
      actor.tenantId,
      async ({ tickets, teams, users, slaPolicies }) => {
        const visibility = ticketVisibilityFor(actor);
        // Yaris kosullarini onlemek icin satir kilitlenir.
        const current = await requireLocked(tickets, ticketId, visibility);

        const now = clock.now();
        const changed: string[] = [];

        // Ayni alan iki adimda (orn. hem durum hem oncelik degisiminde)
        // atanabilir; nesne birlestirme sayesinde son yazan kazanir.
        let changes: TicketChanges = {};
        const apply = (next: TicketChanges): void => {
          changes = { ...changes, ...next };
        };

        // --- Metin alanlari ---------------------------------------------------
        if (patch.title !== undefined || patch.description !== undefined) {
          if (!canEditTicketContent(actor, current)) throw forbidden('Bilet icerigini duzenleme yetkiniz yok');
          if (patch.title !== undefined) {
            apply({ title: patch.title });
            changed.push('title');
          }
          if (patch.description !== undefined) {
            apply({ description: patch.description });
            changed.push('description');
          }
        }

        // --- Ekip -------------------------------------------------------------
        if (patch.teamId !== undefined && patch.teamId !== current.teamId) {
          if (!canManageTicket(actor, current)) throw forbidden('Ekip degistirme yetkiniz yok');
          if (patch.teamId && !(await teams.exists(patch.teamId))) throw invalid('Ekip bulunamadi');
          apply({ teamId: patch.teamId });
          changed.push('team');
        }

        // --- Atama ------------------------------------------------------------
        let newAssigneeEmail: string | null = null;
        if (patch.assigneeId !== undefined && patch.assigneeId !== current.assigneeId) {
          if (!can(actor.role, 'ticket:assign')) throw forbidden('Atama yapma yetkiniz yok');
          if (!canManageTicket(actor, current)) throw forbidden('Bu bilet uzerinde atama yapamazsiniz');

          if (patch.assigneeId) {
            newAssigneeEmail = await users.findActiveEmail(patch.assigneeId);
            if (!newAssigneeEmail) throw invalid('Atanacak kullanici bulunamadi');
          }

          apply({ assigneeId: patch.assigneeId });
          changed.push('assignee');
          await tickets.recordEvent(ticketId, actor.id, patch.assigneeId ? 'assigned' : 'unassigned', {
            assigneeId: patch.assigneeId,
          });
        }

        // --- Durum ------------------------------------------------------------
        if (patch.status && patch.status !== current.status) {
          if (!canChangeTicketStatus(actor, current)) throw forbidden('Durum degistirme yetkiniz yok');

          apply(changeStatus(current, patch.status, now));
          changed.push('status');

          const reopened = OPEN_STATUSES.includes(patch.status) && !OPEN_STATUSES.includes(current.status);
          await tickets.recordEvent(ticketId, actor.id, reopened ? 'reopened' : 'status_changed', {
            from: current.status,
            to: patch.status,
          });
        }

        // --- Oncelik: SLA hedefleri yeniden hesaplanir --------------------------
        //     Durum degisiminden SONRA calisir; boylece guncel bekleme suresini
        //     baz alir ve hedefleri bir kez yazar.
        if (patch.priority && patch.priority !== current.priority) {
          if (!canManageTicket(actor, current)) throw forbidden('Oncelik degistirme yetkiniz yok');

          const policy = await slaPolicies.findByPriority(patch.priority);
          apply(changePriority({ ...current, ...changes }, patch.priority, policy));
          changed.push('priority');
        }

        if (Object.keys(changes).length > 0) await tickets.update(ticketId, changes);

        const record = await requireRecord(tickets, ticketId, visibility);
        return { dto: toTicketDto(record, clock.now(), slaRiskThreshold), changed, newAssigneeEmail };
      },
    );

    if (changed.length) {
      await realtime.publish({
        tenantId: actor.tenantId,
        event: 'ticket:updated',
        ticketId: dto.id,
        payload: { ticket: dto, changes: changed, actor: { id: actor.id, name: actor.fullName } },
      });
    }

    if (newAssigneeEmail && dto.assignee) {
      await notifications.enqueue(
        {
          kind: 'ticket_assigned',
          tenantId: actor.tenantId,
          ticketId: dto.id,
          reference: dto.reference,
          title: dto.title,
          priority: dto.priority,
          dueAt: dto.sla.resolution.dueAt ?? clock.now().toISOString(),
          recipients: [newAssigneeEmail],
          assignedBy: actor.fullName,
        },
        `assigned:${dto.id}:${dto.assignee.id}:${clock.now().getTime()}`,
      );
    }

    return dto;
  };
}
