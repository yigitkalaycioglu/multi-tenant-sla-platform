import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCreateTicket, useTeams, useTickets, useUsers, type TicketQuery } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNote, LoadingRows, Modal, Pager, PriorityPill, SlaCell, StatusPill } from '../components/ui';
import { PRIORITY_LABELS, SLA_LABELS, STATUS_LABELS, formatRelative } from '../lib/format';
import type { SlaState, TicketPriority, TicketStatus } from '../api/types';

const STATUS_OPTIONS = Object.entries(STATUS_LABELS) as Array<[TicketStatus, string]>;
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as Array<[TicketPriority, string]>;
const SLA_OPTIONS = Object.entries(SLA_LABELS) as Array<[SlaState, string]>;

const PAGE_SIZE = 20;

export function TicketsPage(): React.JSX.Element {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(params.get('search') ?? '');

  // Arama kutusu icin gecikmeli (debounce) URL guncellemesi.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (search) next.set('search', search);
          else next.delete('search');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, setParams]);

  const query = useMemo<TicketQuery>(() => {
    const csv = (key: string): string[] | undefined => {
      const value = params.get(key);
      return value ? value.split(',').filter(Boolean) : undefined;
    };

    return {
      status: csv('status') as TicketStatus[] | undefined,
      priority: csv('priority') as TicketPriority[] | undefined,
      slaState: csv('slaState'),
      teamId: params.get('teamId') ?? undefined,
      assigneeId: params.get('assigneeId') ?? undefined,
      search: params.get('search') ?? undefined,
      sort: (params.get('sort') as TicketQuery['sort']) ?? 'created_desc',
      page: Number(params.get('page') ?? 1),
      pageSize: PAGE_SIZE,
    };
  }, [params]);

  const { data, isLoading, isFetching, error } = useTickets(query);
  const teams = useTeams();
  const users = useUsers();

  const setParam = (key: string, value: string): void => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  };

  const activeFilters = ['status', 'priority', 'slaState', 'teamId', 'assigneeId', 'search'].filter((key) =>
    params.get(key),
  ).length;

  return (
    <>
      {/* Tek filtre satiri — tablo ve sayfalama bu dilime gore calisir */}
      <div className="filter-bar">
        <span className="row search" style={{ gap: 6 }}>
          <Icon name="search" size={15} className="muted" />
          <input
            className="input search"
            placeholder="Baslik veya referans ara (TCK-000123)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Bilet ara"
          />
        </span>

        <select
          className="select"
          value={params.get('status') ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
          aria-label="Durum filtresi"
        >
          <option value="">Tum durumlar</option>
          <option value="open,in_progress,on_hold">Yalnizca acik olanlar</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={params.get('priority') ?? ''}
          onChange={(event) => setParam('priority', event.target.value)}
          aria-label="Oncelik filtresi"
        >
          <option value="">Tum oncelikler</option>
          {PRIORITY_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={params.get('slaState') ?? ''}
          onChange={(event) => setParam('slaState', event.target.value)}
          aria-label="SLA durumu filtresi"
        >
          <option value="">Tum SLA durumlari</option>
          {SLA_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={params.get('assigneeId') ?? ''}
          onChange={(event) => setParam('assigneeId', event.target.value)}
          aria-label="Atanan kisi filtresi"
        >
          <option value="">Herkes</option>
          <option value={user?.id ?? 'me'}>Bana atananlar</option>
          <option value="unassigned">Atanmamis</option>
          {(users.data?.items ?? [])
            .filter((item) => item.isActive)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName}
              </option>
            ))}
        </select>

        <select
          className="select"
          value={params.get('teamId') ?? ''}
          onChange={(event) => setParam('teamId', event.target.value)}
          aria-label="Ekip filtresi"
        >
          <option value="">Tum ekipler</option>
          {(teams.data?.items ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={params.get('sort') ?? 'created_desc'}
          onChange={(event) => setParam('sort', event.target.value)}
          aria-label="Siralama"
        >
          <option value="created_desc">En yeni</option>
          <option value="created_asc">En eski</option>
          <option value="due_asc">SLA hedefine gore</option>
          <option value="priority_desc">Oncelige gore</option>
        </select>

        {activeFilters > 0 ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams());
            }}
          >
            <Icon name="close" size={14} />
            Filtreleri temizle ({activeFilters})
          </button>
        ) : null}

        <span className="filter-spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          Yeni bilet
        </button>
      </div>

      <ErrorNote error={error} />

      <div className={`table-wrap${isFetching && !isLoading ? ' refetching' : ''}`}>
        {isLoading ? (
          <LoadingRows rows={6} />
        ) : data && data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Bilet</th>
                <th scope="col">Durum</th>
                <th scope="col">Oncelik</th>
                <th scope="col">Cozum SLA</th>
                <th scope="col">Atanan</th>
                <th scope="col">Ekip</th>
                <th scope="col">Acilis</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((ticket) => (
                <tr key={ticket.id}>
                  <td>
                    <div className="col" style={{ gap: 2, minWidth: 230 }}>
                      <Link className="row-link" to={`/tickets/${ticket.id}`}>
                        {ticket.title}
                      </Link>
                      <span className="mono-ref">
                        {ticket.reference}
                        {ticket.commentCount > 0 ? ` · ${ticket.commentCount} yorum` : ''}
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={ticket.status} />
                  </td>
                  <td>
                    <PriorityPill priority={ticket.priority} />
                  </td>
                  <td>
                    <SlaCell sla={ticket.sla.resolution} paused={ticket.isPaused} />
                  </td>
                  <td className="small">{ticket.assignee?.name ?? <span className="muted">Atanmamis</span>}</td>
                  <td className="small">{ticket.team?.name ?? <span className="muted">-</span>}</td>
                  <td className="small muted">{formatRelative(ticket.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Bilet bulunamadi"
            text={activeFilters ? 'Filtreleri gevsetmeyi deneyin.' : 'Ilk bileti olusturarak baslayin.'}
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} />
                Yeni bilet
              </button>
            }
          />
        )}
      </div>

      {data ? (
        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onChange={(page) => setParam('page', String(page))}
        />
      ) : null}

      {creating ? <NewTicketModal onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewTicketModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { is, user } = useAuth();
  const create = useCreateTicket();
  const teams = useTeams();
  const users = useUsers();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [teamId, setTeamId] = useState(user?.teamId ?? '');
  const [assigneeId, setAssigneeId] = useState('');

  const canAssign = is('admin', 'team_lead');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        teamId: teamId || null,
        assigneeId: canAssign && assigneeId ? assigneeId : null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      title="Yeni bilet"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Vazgec
          </button>
          <button
            type="submit"
            form="new-ticket-form"
            className="btn btn-primary"
            disabled={create.isPending || title.trim().length < 3}
          >
            {create.isPending ? 'Olusturuluyor...' : 'Bileti olustur'}
          </button>
        </>
      }
    >
      <form id="new-ticket-form" className="modal-body" onSubmit={submit}>
        <ErrorNote error={create.error} />

        <div className="field">
          <label className="label" htmlFor="ticket-title">
            Baslik
          </label>
          <input
            id="ticket-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Kisa ve net bir ozet"
            required
            minLength={3}
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="ticket-desc">
            Aciklama
          </label>
          <textarea
            id="ticket-desc"
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Adimlar, beklenen ve gerceklesen davranis, loglar..."
          />
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="ticket-priority">
              Oncelik
            </label>
            <select
              id="ticket-priority"
              className="select"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TicketPriority)}
            >
              {PRIORITY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="hint">SLA hedefleri oncelige gore otomatik hesaplanir.</span>
          </div>

          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="ticket-team">
              Ekip
            </label>
            <select
              id="ticket-team"
              className="select"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="">Ekip secilmedi</option>
              {(teams.data?.items ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canAssign ? (
          <div className="field">
            <label className="label" htmlFor="ticket-assignee">
              Atanacak kisi
            </label>
            <select
              id="ticket-assignee"
              className="select"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Simdilik atanmasin</option>
              {(users.data?.items ?? [])
                .filter((item) => item.isActive)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
            </select>
            <span className="hint">Atama yapildiginda kisiye e-posta bildirimi kuyruga alinir.</span>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
