import type { AuthUser } from '../../domain/identity.js';
import { ticketVisibilityFor } from '../../domain/tickets/ticket-access.js';
import {
  toCommentDto,
  toEventDto,
  toTicketDto,
  type TicketCommentDto,
  type TicketDto,
  type TicketEventDto,
} from './ticket-dto.js';
import { requireRecord } from './ticket-lookup.js';
import type { TicketListQuery } from './ticket.ports.js';
import type { TicketDeps } from './ticket.use-cases.js';

export function makeListTickets({ tx, clock, slaRiskThreshold }: TicketDeps) {
  return async function listTickets(
    actor: AuthUser,
    query: TicketListQuery,
  ): Promise<{ items: TicketDto[]; total: number; page: number; pageSize: number }> {
    const { items, total } = await tx.run(actor.tenantId, ({ tickets }) =>
      tickets.list(query, ticketVisibilityFor(actor)),
    );

    const now = clock.now();
    return {
      items: items.map((r) => toTicketDto(r, now, slaRiskThreshold)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  };
}

export function makeGetTicket({ tx, clock, slaRiskThreshold }: TicketDeps) {
  return async function getTicket(
    actor: AuthUser,
    ticketId: string,
  ): Promise<{ ticket: TicketDto; comments: TicketCommentDto[]; events: TicketEventDto[] }> {
    return tx.run(actor.tenantId, async ({ tickets }) => {
      const record = await requireRecord(tickets, ticketId, ticketVisibilityFor(actor));
      const comments = await tickets.listComments(ticketId);
      const events = await tickets.listEvents(ticketId);

      return {
        ticket: toTicketDto(record, clock.now(), slaRiskThreshold),
        comments: comments.map(toCommentDto),
        events: events.map(toEventDto),
      };
    });
  };
}
