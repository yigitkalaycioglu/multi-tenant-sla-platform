import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAddComment, useDeleteTicket, useTeams, useTicket, useUpdateTicket, useUsers } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { useTicketRoom } from '../context/SocketContext';
import { Icon } from '../components/Icon';
import { ErrorNote, Modal, Pill, PriorityPill, SlaCell, StatusPill } from '../components/ui';
import {
  PRIORITY_LABELS,
  SLA_LABELS,
  STATUS_LABELS,
  describeEvent,
  formatDateTime,
  formatRelative,
  initials,
} from '../lib/format';
import type { TicketPriority, TicketStatus } from '../api/types';

/** Sunucudaki gecis matrisinin aynasi — kullaniciya yalnizca gecerli secenekler gosterilir. */
const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'on_hold', 'resolved', 'closed'],
  in_progress: ['on_hold', 'resolved', 'closed'],
  on_hold: ['in_progress', 'open', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};

export function TicketDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, is } = useAuth();

  useTicketRoom(id);

  const { data, isLoading, isFetching, error } = useTicket(id);
  const update = useUpdateTicket(id ?? '');
  const remove = useDeleteTicket();
  const teams = useTeams();
  const users = useUsers();

  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addComment = useAddComment(id ?? '');

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <div className="skeleton" style={{ height: 320 }} />;

  const { ticket, comments, events } = data;

  const canManage = is('admin') || (is('team_lead') && ticket.team?.id === user?.teamId);
  const canChangeStatus = canManage || ticket.assignee?.id === user?.id;

  const submitComment = (event: FormEvent): void => {
    event.preventDefault();
    if (comment.trim().length === 0) return;
    addComment.mutate(
      { body: comment.trim(), isInternal: internal },
      {
        onSuccess: () => {
          setComment('');
          setInternal(false);
        },
      },
    );
  };

  return (
    <div className={isFetching ? 'refetching' : undefined}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        <Link className="btn btn-sm btn-ghost" to="/tickets">
          <Icon name="chevronLeft" size={15} />
          Biletler
        </Link>
        <span className="mono-ref">{ticket.reference}</span>
        <StatusPill status={ticket.status} />
        <PriorityPill priority={ticket.priority} />
        {ticket.isPaused ? (
          <Pill tone="neutral" icon="pause">
            SLA saati durdu
          </Pill>
        ) : null}

        {is('admin') ? (
          <button type="button" className="btn btn-sm btn-danger right" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} />
            Sil
          </button>
        ) : null}
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 660, letterSpacing: '-0.02em', marginBottom: 18 }}>{ticket.title}</h1>

      <div className="grid grid-2">
        {/* --- Sol kolon: icerik, yorumlar, zaman tuneli --------------------- */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Aciklama</h2>
                <p className="card-sub">
                  {ticket.reporter?.name ?? 'Bilinmiyor'} tarafindan {formatRelative(ticket.createdAt)} acildi
                </p>
              </div>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, color: 'var(--ink-2)' }}>
              {ticket.description || 'Aciklama girilmemis.'}
            </p>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Yorumlar</h2>
                <p className="card-sub">
                  {comments.length} kayit · dahili notlar yalnizca ekip icindir
                </p>
              </div>
            </div>

            <div className="stack-sm" style={{ marginBottom: 16 }}>
              {comments.length === 0 ? (
                <p className="muted small">Henuz yorum yok. Ilk yaniti siz verin.</p>
              ) : (
                comments.map((item) => (
                  <article key={item.id} className="comment" data-internal={item.isInternal}>
                    <div className="comment-head">
                      <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                        {initials(item.author?.name ?? '?')}
                      </span>
                      <span className="comment-author">{item.author?.name ?? 'Silinmis kullanici'}</span>
                      <span className="comment-time">{formatDateTime(item.createdAt)}</span>
                      {item.isInternal ? (
                        <Pill tone="warning" icon="shield">
                          Dahili not
                        </Pill>
                      ) : null}
                    </div>
                    <div className="comment-body">{item.body}</div>
                  </article>
                ))
              )}
            </div>

            <form onSubmit={submitComment} className="stack-sm">
              <ErrorNote error={addComment.error} />
              <textarea
                className="textarea"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Yorum yazin... Bileti acan disindaki ilk genel yorum, yanit SLA hedefini kapatir."
                required
              />
              <div className="row">
                <label className="checkbox">
                  <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                  Dahili not (yanit SLA saatini kapatmaz)
                </label>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm right"
                  disabled={addComment.isPending || comment.trim().length === 0}
                >
                  <Icon name="message" size={14} />
                  {addComment.isPending ? 'Gonderiliyor...' : 'Yorum ekle'}
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Zaman tuneli</h2>
                <p className="card-sub">Denetim izi — her degisiklik kaydedilir</p>
              </div>
            </div>
            <div className="timeline">
              {events.map((event) => {
                const described = describeEvent(event.type, event.payload, event.actor?.name ?? null);
                return (
                  <div key={event.id} className="tl-item">
                    <div className="tl-dot" data-tone={described.tone}>
                      <Icon name={described.icon} size={13} />
                    </div>
                    <div className="tl-body">
                      <div className="tl-text">{described.text}</div>
                      <div className="tl-meta">{formatDateTime(event.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* --- Sag kolon: SLA ve ozellikler ---------------------------------- */}
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">SLA saati</h2>
                <p className="card-sub">Beklemede gecen sure hedeflere eklenir</p>
              </div>
            </div>

            <div className="stack-sm">
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Ilk yanit hedefi
                </div>
                <SlaCell sla={ticket.sla.response} paused={ticket.isPaused} />
                <div className="small muted" style={{ marginTop: 6 }}>
                  Hedef: {formatDateTime(ticket.sla.response.dueAt)}
                  {ticket.firstResponseAt ? ` · Yanit: ${formatDateTime(ticket.firstResponseAt)}` : ''}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Cozum hedefi
                </div>
                <SlaCell sla={ticket.sla.resolution} paused={ticket.isPaused} />
                <div className="small muted" style={{ marginTop: 6 }}>
                  Hedef: {formatDateTime(ticket.sla.resolution.dueAt)}
                  {ticket.resolvedAt ? ` · Cozum: ${formatDateTime(ticket.resolvedAt)}` : ''}
                </div>
              </div>

              {ticket.pausedTotalSeconds > 0 ? (
                <div className="small muted">
                  Toplam bekleme: {Math.round(ticket.pausedTotalSeconds / 60)} dk (hedeflere eklendi)
                </div>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Ozellikler</h2>
                <p className="card-sub">
                  {canManage ? 'Degisiklikler aninda tum ekibe yansir' : 'Duzenleme icin yetkiniz sinirli'}
                </p>
              </div>
            </div>

            <ErrorNote error={update.error} />

            <div className="stack-sm">
              <div className="field">
                <label className="label" htmlFor="status">
                  Durum
                </label>
                <select
                  id="status"
                  className="select"
                  value={ticket.status}
                  disabled={!canChangeStatus || update.isPending}
                  onChange={(event) => update.mutate({ status: event.target.value as TicketStatus })}
                >
                  <option value={ticket.status}>{STATUS_LABELS[ticket.status]}</option>
                  {STATUS_TRANSITIONS[ticket.status].map((next) => (
                    <option key={next} value={next}>
                      {STATUS_LABELS[next]}
                    </option>
                  ))}
                </select>
                {!canChangeStatus ? (
                  <span className="hint">Durumu yalnizca atanan kisi veya ekip lideri degistirebilir.</span>
                ) : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="priority">
                  Oncelik
                </label>
                <select
                  id="priority"
                  className="select"
                  value={ticket.priority}
                  disabled={!canManage || update.isPending}
                  onChange={(event) => update.mutate({ priority: event.target.value as TicketPriority })}
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {canManage ? (
                  <span className="hint">Oncelik degisince SLA hedefleri yeniden hesaplanir.</span>
                ) : null}
              </div>

              <div className="field">
                <label className="label" htmlFor="assignee">
                  Atanan
                </label>
                <select
                  id="assignee"
                  className="select"
                  value={ticket.assignee?.id ?? ''}
                  disabled={!canManage || update.isPending}
                  onChange={(event) => update.mutate({ assigneeId: event.target.value || null })}
                >
                  <option value="">Atanmamis</option>
                  {(users.data?.items ?? [])
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.fullName}
                      </option>
                    ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="team">
                  Ekip
                </label>
                <select
                  id="team"
                  className="select"
                  value={ticket.team?.id ?? ''}
                  disabled={!canManage || update.isPending}
                  onChange={(event) => update.mutate({ teamId: event.target.value || null })}
                >
                  <option value="">Ekip yok</option>
                  {(teams.data?.items ?? []).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <dl
              className="stack-sm"
              style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 13 }}
            >
              <div className="row">
                <dt className="muted">Acan</dt>
                <dd className="right strong">{ticket.reporter?.name ?? '-'}</dd>
              </div>
              <div className="row">
                <dt className="muted">Olusturulma</dt>
                <dd className="right">{formatDateTime(ticket.createdAt)}</dd>
              </div>
              <div className="row">
                <dt className="muted">Son guncelleme</dt>
                <dd className="right">{formatRelative(ticket.updatedAt)}</dd>
              </div>
              <div className="row">
                <dt className="muted">Cozum SLA</dt>
                <dd className="right">{SLA_LABELS[ticket.sla.resolution.state]}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      {confirmDelete ? (
        <Modal
          title="Bileti sil"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Vazgec
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(ticket.id, {
                    onSuccess: () => {
                      setConfirmDelete(false);
                      void navigate('/tickets', { replace: true });
                    },
                  })
                }
              >
                {remove.isPending ? 'Siliniyor...' : 'Kalici olarak sil'}
              </button>
            </>
          }
        >
          <p className="small">
            <strong>{ticket.reference}</strong> ve tum yorum/olay kayitlari kalici olarak silinecek. Bu islem geri
            alinamaz.
          </p>
          <ErrorNote error={remove.error} />
        </Modal>
      ) : null}
    </div>
  );
}
