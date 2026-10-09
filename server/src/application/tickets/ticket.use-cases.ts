import type { Clock, Logger } from '../ports/runtime.js';
import type { NotificationQueue, RealtimePublisher } from '../ports/events.js';
import type { TenantTransactions } from '../ports/transactions.js';
import { makeAddComment } from './add-comment.js';
import { makeCreateTicket } from './create-ticket.js';
import { makeDeleteTicket } from './delete-ticket.js';
import { makeGetTicket, makeListTickets } from './query-tickets.js';
import { makeUpdateTicket } from './update-ticket.js';

export interface TicketDeps {
  tx: TenantTransactions;
  realtime: RealtimePublisher;
  notifications: NotificationQueue;
  clock: Clock;
  log: Logger;
  /** Anlik SLA durumunda "risk altinda" esigi (0-1). */
  slaRiskThreshold: number;
}

export function makeTicketUseCases(deps: TicketDeps) {
  return {
    list: makeListTickets(deps),
    get: makeGetTicket(deps),
    create: makeCreateTicket(deps),
    update: makeUpdateTicket(deps),
    addComment: makeAddComment(deps),
    remove: makeDeleteTicket(deps),
  };
}

export type TicketUseCases = ReturnType<typeof makeTicketUseCases>;
