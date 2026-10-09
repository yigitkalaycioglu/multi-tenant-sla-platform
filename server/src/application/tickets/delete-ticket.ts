import { notFound } from '../../domain/errors.js';
import { assertPermission, type AuthUser } from '../../domain/identity.js';
import type { TicketDeps } from './ticket.use-cases.js';

export function makeDeleteTicket({ tx, realtime, log }: TicketDeps) {
  return async function deleteTicket(actor: AuthUser, ticketId: string): Promise<void> {
    assertPermission(actor, 'ticket:delete');

    await tx.run(actor.tenantId, async ({ tickets }) => {
      if (!(await tickets.delete(ticketId))) throw notFound('Bilet bulunamadi');
    });

    await realtime.publish({ tenantId: actor.tenantId, event: 'ticket:deleted', payload: { ticketId }, ticketId });
    log.info({ ticketId, actor: actor.id }, 'Bilet silindi');
  };
}
