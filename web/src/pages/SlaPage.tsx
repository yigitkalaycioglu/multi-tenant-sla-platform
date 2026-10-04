import { useEffect, useState } from 'react';
import { useSaveSlaPolicy, useSlaPolicies } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { ErrorNote, LoadingRows, PriorityPill } from '../components/ui';
import { formatMinutes, formatNumber } from '../lib/format';
import type { SlaPolicy, TicketPriority } from '../api/types';

/** Hazir sureler — dakika cinsinden girmek yerine tek tikla secilebilir. */
const PRESETS = [
  { label: '15 dk', minutes: 15 },
  { label: '1 saat', minutes: 60 },
  { label: '4 saat', minutes: 240 },
  { label: '8 saat', minutes: 480 },
  { label: '1 gun', minutes: 1440 },
  { label: '3 gun', minutes: 4320 },
];

export function SlaPage(): React.JSX.Element {
  const { is } = useAuth();
  const { data, isLoading, error } = useSlaPolicies();
  const canManage = is('admin');

  return (
    <>
      <div className="filter-bar">
        <span className="small muted">
          Hedefler bilet acilirken oncelige gore uygulanir. Politika degisikligi acik biletlerin hedeflerini
          <strong> geriye donuk degistirmez</strong> — bir biletin hedefini degistirmek icin onceligini degistirin.
        </span>
      </div>

      <ErrorNote error={error} />

      {isLoading ? (
        <div className="table-wrap">
          <LoadingRows />
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {(data?.items ?? []).map((policy) => (
            <PolicyCard key={policy.id} policy={policy} canManage={canManage} />
          ))}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">SLA motoru nasil calisir?</h2>
            <p className="card-sub">Arka plandaki tarayici ve bildirim kuyrugu</p>
          </div>
        </div>
        <div className="stack-sm small dim">
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <Icon name="clock" size={15} />
            <span>
              Bilet acildiginda oncelige karsilik gelen politikadan <strong>ilk yanit</strong> ve{' '}
              <strong>cozum</strong> hedef tarihleri hesaplanir.
            </span>
          </div>
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <Icon name="pause" size={15} />
            <span>
              Bilet <strong>beklemeye</strong> alindiginda SLA saati durur; devam edildiginde beklemede gecen sure
              kadar hedefler ileri kaydirilir.
            </span>
          </div>
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <Icon name="alert" size={15} />
            <span>
              Arka plandaki worker dakikada bir tarama yapar: sure <strong>%80</strong> tuketildiginde bilet
              &quot;risk altinda&quot;, hedef gecildiginde &quot;asildi&quot; olur.
            </span>
          </div>
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <Icon name="refresh" size={15} />
            <span>
              Her durum degisimi Socket.io ile panele aninda dusler; ayni anda BullMQ kuyruguna atanan kisi, ekip
              lideri ve yoneticiler icin e-posta bildirimi birakilir.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}

function PolicyCard({ policy, canManage }: { policy: SlaPolicy; canManage: boolean }): React.JSX.Element {
  const save = useSaveSlaPolicy();
  const [response, setResponse] = useState(policy.responseMinutes);
  const [resolution, setResolution] = useState(policy.resolutionMinutes);

  // Sunucudan yeni degerler gelirse formu senkronla.
  useEffect(() => {
    setResponse(policy.responseMinutes);
    setResolution(policy.resolutionMinutes);
  }, [policy.responseMinutes, policy.resolutionMinutes]);

  const dirty = response !== policy.responseMinutes || resolution !== policy.resolutionMinutes;
  const invalid = resolution < response;

  const breachRate = policy.ticketCount > 0 ? policy.breachedCount / policy.ticketCount : null;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <PriorityPill priority={policy.priority as TicketPriority} />
          <p className="card-sub">
            {formatNumber(policy.ticketCount)} bilet
            {breachRate !== null ? ` · %${Math.round(breachRate * 100)} ihlal orani` : ''}
          </p>
        </div>
      </div>

      <ErrorNote error={save.error} />

      <div className="stack-sm">
        <MinuteField
          id={`response-${policy.priority}`}
          label="Ilk yanit hedefi"
          value={response}
          onChange={setResponse}
          disabled={!canManage}
        />
        <MinuteField
          id={`resolution-${policy.priority}`}
          label="Cozum hedefi"
          value={resolution}
          onChange={setResolution}
          disabled={!canManage}
        />

        {invalid ? <span className="field-error">Cozum suresi, yanit suresinden kisa olamaz.</span> : null}

        {canManage ? (
          <div className="row">
            <span className="small muted">
              {dirty ? 'Kaydedilmemis degisiklik var' : `Guncellendi: ${new Date(policy.updatedAt).toLocaleDateString('tr-TR')}`}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm right"
              disabled={!dirty || invalid || save.isPending}
              onClick={() =>
                save.mutate({
                  priority: policy.priority,
                  responseMinutes: response,
                  resolutionMinutes: resolution,
                })
              }
            >
              {save.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        ) : (
          <span className="small muted">Degisiklik icin yonetici yetkisi gerekir.</span>
        )}
      </div>
    </section>
  );
}

function MinuteField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label} <span className="muted">({formatMinutes(value)})</span>
      </label>
      <input
        id={id}
        className="input"
        type="number"
        min={5}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {!disabled ? (
        <div className="row wrap" style={{ gap: 5, marginTop: 2 }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ padding: '3px 8px', fontSize: 11.5 }}
              onClick={() => onChange(preset.minutes)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
