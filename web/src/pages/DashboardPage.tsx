import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOverview } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorNote, StatTile } from '../components/ui';
import { TrendChart } from '../components/charts/TrendChart';
import { BarList } from '../components/charts/BarList';
import { SlaMeter, type MeterSegment } from '../components/charts/SlaMeter';
import { PRIORITY_LABELS, formatMinutes, formatNumber, formatPercent } from '../lib/format';

const RANGES = [
  { days: 7, label: '7 gun' },
  { days: 14, label: '14 gun' },
  { days: 30, label: '30 gun' },
  { days: 90, label: '90 gun' },
];

export function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();
  const [days, setDays] = useState(14);
  const [showTable, setShowTable] = useState(false);

  const { data, isLoading, isFetching, error } = useOverview(days);

  if (error) return <ErrorNote error={error} />;

  if (isLoading || !data) {
    return (
      <div className="grid grid-kpi">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton" style={{ height: 106 }} />
        ))}
      </div>
    );
  }

  const { totals, sla, averages } = data;
  const openTracked = totals.activeTotal;
  const onTrack = Math.max(0, openTracked - sla.openBreached - sla.openAtRisk);

  const segments: MeterSegment[] = [
    {
      key: 'on_track',
      label: 'Hedefte',
      value: onTrack,
      color: 'var(--status-good)',
      icon: 'check',
      tone: 'good',
    },
    {
      key: 'at_risk',
      label: 'Risk altinda',
      value: sla.openAtRisk,
      color: 'var(--status-warning)',
      icon: 'alert',
      tone: 'warning',
    },
    {
      key: 'breached',
      label: 'Suresi asildi',
      value: sla.openBreached,
      color: 'var(--status-critical)',
      icon: 'siren',
      tone: 'critical',
    },
  ];

  return (
    <>
      {/* Tek filtre satiri — asagidaki tum kartlari ayni dilime gore kapsar */}
      <div className="filter-bar">
        <span className="small muted">
          {data.scope === 'tenant' ? 'Kiraci genelinde' : 'Size ve ekibinize ait kayitlar'}
        </span>
        <span className="row" style={{ gap: 6, marginLeft: 8 }}>
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              className={`btn btn-sm${days === range.days ? ' btn-primary' : ''}`}
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </span>
        <span className="filter-spacer" />
        <Link className="btn btn-sm" to="/tickets?slaState=breached">
          <Icon name="siren" size={14} />
          Asilan SLA'lari gor
        </Link>
      </div>

      <div className={`grid grid-kpi${isFetching ? ' refetching' : ''}`}>
        <StatTile
          label="Acik is"
          value={formatNumber(openTracked)}
          foot={`${totals.open} acik · ${totals.inProgress} islemde · ${totals.onHold} beklemede`}
          icon="ticket"
        />
        <StatTile
          label="SLA suresi asilan"
          value={formatNumber(sla.openBreached)}
          foot={sla.openBreached > 0 ? 'Acil mudahale gerekiyor' : 'Asilan acik bilet yok'}
          tone={sla.openBreached > 0 ? 'critical' : 'good'}
          icon="siren"
        />
        <StatTile
          label="Risk altinda"
          value={formatNumber(sla.openAtRisk)}
          foot="SLA suresinin son diliminde"
          tone={sla.openAtRisk > 0 ? 'warning' : 'neutral'}
          icon="alert"
        />
        <StatTile
          label="SLA uyum orani"
          value={formatPercent(sla.complianceRate)}
          foot={`${formatNumber(sla.met)} karsilandi · ${formatNumber(sla.breached)} asildi`}
          tone={
            sla.complianceRate === null ? 'neutral' : sla.complianceRate >= 0.9 ? 'good' : sla.complianceRate >= 0.75 ? 'warning' : 'critical'
          }
          icon="shield"
        />
      </div>

      <div className={`grid grid-2${isFetching ? ' refetching' : ''}`}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Is akisi</h2>
              <p className="card-sub">Son {data.days} gunde acilan ve cozulen bilet sayisi</p>
            </div>
            <div className="card-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setShowTable((value) => !value)}
                aria-pressed={showTable}
              >
                <Icon name={showTable ? 'chart' : 'table'} size={14} />
                {showTable ? 'Grafik' : 'Tablo'}
              </button>
            </div>
          </div>
          <TrendChart data={data.trend} showTable={showTable} />
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Acik islerin SLA durumu</h2>
              <p className="card-sub">Su an cozum hedefi isleyen {formatNumber(openTracked)} bilet</p>
            </div>
          </div>
          <SlaMeter segments={segments} />

          <div className="row wrap" style={{ gap: 18, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div className="col">
              <span className="small muted">Ort. cozum suresi</span>
              <span className="strong nums">{formatMinutes(averages.resolutionMinutes)}</span>
            </div>
            <div className="col">
              <span className="small muted">Ort. ilk yanit</span>
              <span className="strong nums">{formatMinutes(averages.firstResponseMinutes)}</span>
            </div>
            <div className="col">
              <span className="small muted">Toplam bilet</span>
              <span className="strong nums">{formatNumber(totals.total)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Oncelik dagilimi</h2>
              <p className="card-sub">Acik biletlerin onceliklere gore dagilimi</p>
            </div>
          </div>
          <BarList
            items={data.byPriority.map((row) => ({
              id: row.priority,
              label: PRIORITY_LABELS[row.priority],
              value: row.open,
              alertCount: row.breached,
            }))}
            valueLabel="acik"
            emptyText="Acik bilet yok"
          />
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Ekip yuku</h2>
              <p className="card-sub">Ekiplere gore acik bilet sayisi</p>
            </div>
          </div>
          <BarList
            items={data.teamWorkload.map((row) => ({
              id: row.teamId ?? 'none',
              label: row.teamName,
              value: row.open,
              alertCount: row.breached,
            }))}
            valueLabel="acik"
            emptyText="Ekiplere atanmis acik bilet yok"
          />
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Kisi bazli yuk</h2>
              <p className="card-sub">En cok acik bileti olan kisiler</p>
            </div>
          </div>
          {data.topAssignees.length === 0 ? (
            <EmptyState title="Atanmis acik bilet yok" text="Bilet atandiginda burada gorunur." />
          ) : (
            <BarList
              items={data.topAssignees.map((row) => ({
                id: row.userId,
                label: row.name + (row.userId === user?.id ? ' (siz)' : ''),
                value: row.open,
                alertCount: row.breached,
              }))}
              valueLabel="acik"
            />
          )}
        </section>
      </div>
    </>
  );
}
