/**
 * Kiraci ICINDEKI bilet gorunurlugu ve yetki kurallari.
 *
 * Kiracilar arasi izolasyon burada degil, veritabaninda (RLS) saglanir; bu
 * dosya "ayni sirketteki hangi kullanici hangi bileti gorebilir/degistirebilir"
 * sorusunu cevaplar. Saf fonksiyonlardir: SQL'e cevirisi altyapi katmanindadir.
 */
import type { AuthUser } from '../identity.js';
import type { Ticket } from './ticket.js';

/**
 * Rol bazli okuma kapsami.
 *  admin      -> kiracidaki tum biletler
 *  digerleri  -> kendi ekibinin, kendine atanmis ya da kendi actigi biletler
 */
export type TicketVisibility =
  | { scope: 'tenant' }
  | { scope: 'participant'; userId: string; teamId: string | null };

export function ticketVisibilityFor(actor: AuthUser): TicketVisibility {
  if (actor.role === 'admin') return { scope: 'tenant' };
  return { scope: 'participant', userId: actor.id, teamId: actor.teamId };
}

/** Biletin uzerinde yonetsel degisiklik (atama, oncelik, ekip) yapabilir mi? */
export function canManageTicket(actor: AuthUser, ticket: Pick<Ticket, 'teamId'>): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'team_lead') return ticket.teamId !== null && ticket.teamId === actor.teamId;
  return false;
}

/** Durum degisikligi: yoneticiler ya da bileti ustlenen kisi. */
export function canChangeTicketStatus(actor: AuthUser, ticket: Pick<Ticket, 'teamId' | 'assigneeId'>): boolean {
  return canManageTicket(actor, ticket) || ticket.assigneeId === actor.id;
}

/** Baslik/aciklama: yoneticiler, bileti acan ya da ustlenen kisi. */
export function canEditTicketContent(
  actor: AuthUser,
  ticket: Pick<Ticket, 'teamId' | 'assigneeId' | 'reporterId'>,
): boolean {
  return canManageTicket(actor, ticket) || ticket.reporterId === actor.id || ticket.assigneeId === actor.id;
}
