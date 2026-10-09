import type { SlaState } from '../../domain/sla/sla-policy.js';
import type { TicketVisibility } from '../../domain/tickets/ticket-access.js';
import type {
  Ticket,
  TicketChanges,
  TicketEventType,
  TicketPriority,
  TicketStatus,
} from '../../domain/tickets/ticket.js';

/** Liste ve detay ekranlari icin bilet + iliskili kayitlarin adlari. */
export interface TicketRecord extends Ticket {
  teamName: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  reporterName: string | null;
  commentCount: number;
  updatedAt: Date;
}

export type TicketSort = 'created_desc' | 'created_asc' | 'due_asc' | 'priority_desc';

export interface TicketListQuery {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  slaState?: SlaState[];
  teamId?: string;
  /** Kullanici kimligi ya da atanmamis biletler icin 'unassigned'. */
  assigneeId?: string;
  search?: string;
  sort: TicketSort;
  page: number;
  pageSize: number;
}

export interface NewTicket {
  reference: string;
  title: string;
  description: string;
  priority: TicketPriority;
  teamId: string | null;
  assigneeId: string | null;
  reporterId: string;
  slaPolicyId: string | null;
  createdAt: Date;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

export interface TicketEventRecord {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface TicketCommentRecord {
  id: string;
  body: string;
  isInternal: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
}

/** Biletler, zaman tuneli ve yorumlar. Bir kiracinin transaction'ina baglidir. */
export interface TicketRepository {
  /** Kiraci bazli siradaki numara; satir transaction bitene kadar kilitli kalir. */
  nextSequence(): Promise<number>;
  insert(ticket: NewTicket): Promise<string>;
  /** Gorunurluk kapsami disindaki bilet icin null doner. */
  findRecord(id: string, visibility: TicketVisibility): Promise<TicketRecord | null>;
  /** Bileti okur ve transaction sonuna kadar kilitler (eszamanli guncellemelere karsi). */
  lockForUpdate(id: string, visibility: TicketVisibility): Promise<Ticket | null>;
  list(query: TicketListQuery, visibility: TicketVisibility): Promise<{ items: TicketRecord[]; total: number }>;
  update(id: string, changes: TicketChanges): Promise<void>;
  delete(id: string): Promise<boolean>;

  recordEvent(ticketId: string, actorId: string | null, type: TicketEventType, payload?: object): Promise<void>;
  listEvents(ticketId: string): Promise<TicketEventRecord[]>;
  addComment(comment: {
    ticketId: string;
    authorId: string;
    body: string;
    isInternal: boolean;
  }): Promise<{ id: string; createdAt: Date }>;
  listComments(ticketId: string): Promise<TicketCommentRecord[]>;
}
