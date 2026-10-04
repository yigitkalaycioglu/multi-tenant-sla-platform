import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useDeleteTeam, useSaveTeam, useTeams, useUsers } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNote, LoadingRows, Modal, Pill } from '../components/ui';
import type { Team } from '../api/types';

export function TeamsPage(): React.JSX.Element {
  const { is } = useAuth();
  const { data, isLoading, error } = useTeams();
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const remove = useDeleteTeam();

  const canManage = is('admin');

  return (
    <>
      <div className="filter-bar">
        <span className="small muted">
          Ekipler, biletlerin gorunurlugunu ve SLA bildirimlerinin kime gidecegini belirler.
        </span>
        <span className="filter-spacer" />
        {canManage ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <Icon name="plus" size={15} />
            Yeni ekip
          </button>
        ) : null}
      </div>

      <ErrorNote error={error ?? remove.error} />

      <div className="table-wrap">
        {isLoading ? (
          <LoadingRows />
        ) : data && data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Ekip</th>
                <th scope="col">Lider</th>
                <th scope="col" className="num">
                  Uye
                </th>
                <th scope="col" className="num">
                  Acik bilet
                </th>
                {canManage ? <th scope="col" /> : null}
              </tr>
            </thead>
            <tbody>
              {data.items.map((team) => (
                <tr key={team.id}>
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <span className="strong">{team.name}</span>
                      {team.description ? <span className="small muted">{team.description}</span> : null}
                    </div>
                  </td>
                  <td className="small">
                    {team.lead ? (
                      team.lead.name
                    ) : (
                      <Pill tone="warning" icon="alert">
                        Lider atanmamis
                      </Pill>
                    )}
                  </td>
                  <td className="num">{team.memberCount}</td>
                  <td className="num">
                    <Link to={`/tickets?teamId=${team.id}&status=open,in_progress,on_hold`}>
                      {team.openTicketCount}
                    </Link>
                  </td>
                  {canManage ? (
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setEditing(team)}
                          aria-label={`${team.name} ekibini duzenle`}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (window.confirm(`"${team.name}" ekibi silinsin mi?`)) remove.mutate(team.id);
                          }}
                          aria-label={`${team.name} ekibini sil`}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Henuz ekip yok"
            text={canManage ? 'Bir ekip olusturup kullanicilari atayin.' : 'Yoneticiniz ekip olusturdugunda burada gorunur.'}
          />
        )}
      </div>

      {editing ? <TeamModal team={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function TeamModal({ team, onClose }: { team: Team | null; onClose: () => void }): React.JSX.Element {
  const save = useSaveTeam();
  const users = useUsers();

  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [leadId, setLeadId] = useState(team?.lead?.id ?? '');

  const eligibleLeads = (users.data?.items ?? []).filter(
    (item) => item.isActive && (item.role === 'admin' || item.role === 'team_lead'),
  );

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate(
      {
        ...(team ? { id: team.id } : {}),
        name: name.trim(),
        description: description.trim() || null,
        leadId: leadId || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      title={team ? 'Ekibi duzenle' : 'Yeni ekip'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Vazgec
          </button>
          <button type="submit" form="team-form" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </>
      }
    >
      <form id="team-form" className="modal-body" onSubmit={submit}>
        <ErrorNote error={save.error} />

        <div className="field">
          <label className="label" htmlFor="team-name">
            Ekip adi
          </label>
          <input
            id="team-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="team-desc">
            Aciklama
          </label>
          <input
            id="team-desc"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ekibin sorumluluk alani"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="team-lead">
            Ekip lideri
          </label>
          <select id="team-lead" className="select" value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            <option value="">Lider atanmasin</option>
            {eligibleLeads.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName}
              </option>
            ))}
          </select>
          <span className="hint">
            Lider, ekibinin tum biletlerini yonetebilir ve SLA uyarilarini e-posta ile alir.
          </span>
        </div>
      </form>
    </Modal>
  );
}
