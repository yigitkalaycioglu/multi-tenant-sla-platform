import { notFound } from '../../domain/errors.js';
import type { TicketVisibility } from '../../domain/tickets/ticket-access.js';
import type { Ticket } from '../../domain/tickets/ticket.js';
import type { TicketRecord, TicketRepository } from './ticket.ports.js';

/**
 * Baska kiracinin bileti RLS nedeniyle hic gorunmez; kiraci icinde kapsam
 * disindaki bilet de ayni mesajla 404 olur — varligi sizdirilmaz.
 */
const NOT_VISIBLE = 'Bilet bulunamadi veya goruntuleme yetkiniz yok';

export async function requireRecord(
  tickets: TicketRepository,
  id: string,
  visibility: TicketVisibility,
): Promise<TicketRecord> {
  const record = await tickets.findRecord(id, visibility);
  if (!record) throw notFound(NOT_VISIBLE);
  return record;
}

export async function requireLocked(
  tickets: TicketRepository,
  id: string,
  visibility: TicketVisibility,
): Promise<Ticket> {
  const ticket = await tickets.lockForUpdate(id, visibility);
  if (!ticket) throw notFound(NOT_VISIBLE);
  return ticket;
}
