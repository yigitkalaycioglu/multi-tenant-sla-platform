import { useState, type FormEvent } from 'react';
import { useCreateUser, useTeams, useUpdateUser, useUsers } from '../api/hooks';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNote, LoadingRows, Modal, Pill } from '../components/ui';
import { ROLE_LABELS, formatRelative, initials } from '../lib/format';
import type { UserRole } from '../api/types';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS) as Array<[UserRole, string]>;

export function UsersPage(): React.JSX.Element {
  const { data, isLoading, error } = useUsers();
  const teams = useTeams();
  const update = useUpdateUser();
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <div className="filter-bar">
        <span className="small muted">
          Rol, kullanicinin neleri gorup degistirebilecegini belirler. Kiracida her zaman en az bir aktif
          yonetici kalmalidir.
        </span>
        <span className="filter-spacer" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviting(true)}>
          <Icon name="plus" size={15} />
          Kullanici ekle
        </button>
      </div>

      <ErrorNote error={error ?? update.error} />

      <div className="table-wrap">
        {isLoading ? (
          <LoadingRows />
        ) : data && data.items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Kullanici</th>
                <th scope="col">Rol</th>
                <th scope="col">Ekip</th>
                <th scope="col" className="num">
                  Acik bilet
                </th>
                <th scope="col">Son giris</th>
                <th scope="col">Durum</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} style={item.isActive ? undefined : { opacity: 0.6 }}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="avatar">{initials(item.fullName)}</span>
                      <div className="col" style={{ gap: 1 }}>
                        <span className="strong">{item.fullName}</span>
                        <span className="small muted">{item.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      className="select"
                      style={{ minWidth: 140, padding: '5px 8px', fontSize: 12.5 }}
                      value={item.role}
                      disabled={update.isPending}
                      onChange={(event) => update.mutate({ id: item.id, role: event.target.value as UserRole })}
                      aria-label={`${item.fullName} rolu`}
                    >
                      {ROLE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="select"
                      style={{ minWidth: 140, padding: '5px 8px', fontSize: 12.5 }}
                      value={item.team?.id ?? ''}
                      disabled={update.isPending}
                      onChange={(event) => update.mutate({ id: item.id, teamId: event.target.value || null })}
                      aria-label={`${item.fullName} ekibi`}
                    >
                      <option value="">Ekip yok</option>
                      {(teams.data?.items ?? []).map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{item.openTicketCount}</td>
                  <td className="small muted">{item.lastLoginAt ? formatRelative(item.lastLoginAt) : 'Hic'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: item.id, isActive: !item.isActive })}
                    >
                      {item.isActive ? (
                        <Pill tone="good" icon="check">
                          Aktif
                        </Pill>
                      ) : (
                        <Pill tone="neutral" icon="pause">
                          Pasif
                        </Pill>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Kullanici bulunamadi" />
        )}
      </div>

      <p className="small muted">
        Roller: <strong>{ROLE_LABELS.admin}</strong> kiracinin tamamini yonetir ·{' '}
        <strong>{ROLE_LABELS.team_lead}</strong> kendi ekibinin biletlerini atar ve onceliklendirir ·{' '}
        <strong>{ROLE_LABELS.developer}</strong> kendine/ekibine ait biletleri gorur ve gunceller.
      </p>

      {inviting ? <NewUserModal onClose={() => setInviting(false)} /> : null}
    </>
  );
}

function NewUserModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useCreateUser();
  const teams = useTeams();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('developer');
  const [teamId, setTeamId] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    create.mutate(
      {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        teamId: teamId || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      title="Kullanici ekle"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Vazgec
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Ekleniyor...' : 'Kullaniciyi ekle'}
          </button>
        </>
      }
    >
      <form id="user-form" className="modal-body" onSubmit={submit}>
        <ErrorNote error={create.error} />

        <div className="field">
          <label className="label" htmlFor="u-name">
            Ad soyad
          </label>
          <input
            id="u-name"
            className="input"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
            minLength={2}
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="u-email">
            E-posta
          </label>
          <input
            id="u-email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="u-pass">
            Gecici sifre
          </label>
          <input
            id="u-pass"
            className="input"
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          <span className="hint">En az 8 karakter, bir harf ve bir rakam. Kullaniciya guvenli sekilde iletin.</span>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="u-role">
              Rol
            </label>
            <select
              id="u-role"
              className="select"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              {ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: 1 }}>
            <label className="label" htmlFor="u-team">
              Ekip
            </label>
            <select id="u-team" className="select" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">Ekip yok</option>
              {(teams.data?.items ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}
