import type { AuthUser } from '../../domain/identity.js';
import { ticketVisibilityFor } from '../../domain/tickets/ticket-access.js';
import { registerFirstResponse } from '../../domain/tickets/ticket-lifecycle.js';
import { toTicketDto, type TicketCommentDto } from './ticket-dto.js';
import { requireLocked, requireRecord } from './ticket-lookup.js';
import type { TicketDeps } from './ticket.use-cases.js';

export function makeAddComment({ tx, realtime, clock, slaRiskThreshold }: TicketDeps) {
  return async function addComment(
    actor: AuthUser,
    ticketId: string,
    input: { body: string; isInternal: boolean },
  ): Promise<TicketCommentDto> {
    const { comment, firstResponse, ticket } = await tx.run(actor.tenantId, async ({ tickets }) => {
      const visibility = ticketVisibilityFor(actor);
      const current = await requireLocked(tickets, ticketId, visibility);

      const inserted = await tickets.addComment({
        ticketId,
        authorId: actor.id,
        body: input.body,
        isInternal: input.isInternal,
      });
      await tickets.recordEvent(ticketId, actor.id, 'commented', { isInternal: input.isInternal });

      const firstResponse = registerFirstResponse(
        current,
        { authorId: actor.id, isInternal: input.isInternal },
        inserted.createdAt,
      );
      if (firstResponse) {
        await tickets.update(ticketId, firstResponse);
        await tickets.recordEvent(ticketId, actor.id, 'first_response', {});
      }

      const record = await requireRecord(tickets, ticketId, visibility);

      return {
        comment: {
          id: inserted.id,
          body: input.body,
          isInternal: input.isInternal,
          author: { id: actor.id, name: actor.fullName },
          createdAt: inserted.createdAt.toISOString(),
        } satisfies TicketCommentDto,
        firstResponse: firstResponse !== null,
        ticket: toTicketDto(record, clock.now(), slaRiskThreshold),
      };
    });

    await realtime.publish({
      tenantId: actor.tenantId,
      event: 'ticket:comment',
      ticketId,
      payload: { ticketId, comment, ticket, firstResponse },
    });

    return comment;
  };
}
