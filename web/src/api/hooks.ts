import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch, qs } from './client';
import type {
  Overview,
  Paged,
  SlaPolicy,
  Team,
  TenantUser,
  Ticket,
  TicketComment,
  TicketDetail,
  TicketPriority,
  TicketStatus,
  UserRole,
} from './types';

export interface TicketQuery {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  slaState?: string[];
  teamId?: string;
  assigneeId?: string;
  search?: string;
  sort?: 'created_desc' | 'created_asc' | 'due_asc' | 'priority_desc';
  page?: number;
  pageSize?: number;
}

export const keys = {
  tickets: (q: TicketQuery) => ['tickets', q] as const,
  ticket: (id: string) => ['ticket', id] as const,
  teams: ['teams'] as const,
  users: ['users'] as const,
  slaPolicies: ['sla-policies'] as const,
  overview: (days: number) => ['overview', days] as const,
};

// --- Biletler ---------------------------------------------------------------

export function useTickets(query: TicketQuery) {
  return useQuery({
    queryKey: keys.tickets(query),
    queryFn: () =>
      apiFetch<Paged<Ticket>>(
        `/api/tickets${qs({
          status: query.status?.join(','),
          priority: query.priority?.join(','),
          slaState: query.slaState?.join(','),
          teamId: query.teamId,
          assigneeId: query.assigneeId,
          search: query.search,
          sort: query.sort,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
      ),
    // Yeniden veri cekerken onceki liste ekranda kalir (iskelet parlamasi yok).
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: keys.ticket(id ?? ''),
    queryFn: () => apiFetch<TicketDetail>(`/api/tickets/${id}`),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export interface CreateTicketBody {
  title: string;
  description?: string;
  priority: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTicketBody) =>
      apiFetch<{ ticket: Ticket }>('/api/tickets', { method: 'POST', body }),
    onSuccess: () => invalidateTicketViews(qc),
  });
}

export interface UpdateTicketBody {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
}

export function useUpdateTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTicketBody) =>
      apiFetch<{ ticket: Ticket }>(`/api/tickets/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ticket(id) });
      invalidateTicketViews(qc);
    },
  });
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/tickets/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTicketViews(qc),
  });
}

export function useAddComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; isInternal: boolean }) =>
      apiFetch<{ comment: TicketComment }>(`/api/tickets/${ticketId}/comments`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) });
      invalidateTicketViews(qc);
    },
  });
}

// --- Ekipler ----------------------------------------------------------------

export function useTeams() {
  return useQuery({
    queryKey: keys.teams,
    queryFn: () => apiFetch<{ items: Team[] }>('/api/teams'),
    staleTime: 60_000,
  });
}

export interface TeamBody {
  name: string;
  description?: string | null;
  leadId?: string | null;
}

export function useSaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: TeamBody & { id?: string }) =>
      apiFetch<{ team: Team }>(id ? `/api/teams/${id}` : '/api/teams', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.teams });
      void qc.invalidateQueries({ queryKey: keys.users });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/teams/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.teams }),
  });
}

// --- Kullanicilar -----------------------------------------------------------

export function useUsers() {
  return useQuery({
    queryKey: keys.users,
    queryFn: () => apiFetch<{ items: TenantUser[] }>('/api/users?includeInactive=true'),
    staleTime: 60_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      fullName: string;
      email: string;
      password: string;
      role: UserRole;
      teamId?: string | null;
    }) => apiFetch<{ user: TenantUser }>('/api/users', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.users }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      fullName?: string;
      role?: UserRole;
      teamId?: string | null;
      isActive?: boolean;
    }) => apiFetch<{ user: TenantUser }>(`/api/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.users });
      void qc.invalidateQueries({ queryKey: keys.teams });
    },
  });
}

// --- SLA politikalari -------------------------------------------------------

export function useSlaPolicies() {
  return useQuery({
    queryKey: keys.slaPolicies,
    queryFn: () => apiFetch<{ items: SlaPolicy[] }>('/api/sla-policies'),
    staleTime: 60_000,
  });
}

export function useSaveSlaPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      priority,
      ...body
    }: {
      priority: TicketPriority;
      responseMinutes: number;
      resolutionMinutes: number;
    }) => apiFetch<{ policy: SlaPolicy }>(`/api/sla-policies/${priority}`, { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.slaPolicies }),
  });
}

// --- Raporlar ---------------------------------------------------------------

export function useOverview(days: number) {
  return useQuery({
    queryKey: keys.overview(days),
    queryFn: () => apiFetch<Overview>(`/api/reports/overview${qs({ days })}`),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

/** Bilet degisimi tum liste/rapor gorunumlerini etkiler. */
export function invalidateTicketViews(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['tickets'] });
  void qc.invalidateQueries({ queryKey: ['overview'] });
}
