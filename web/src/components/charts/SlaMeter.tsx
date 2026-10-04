import { Icon, type IconName } from '../Icon';

/**
 * SLA durum olcegi.
 *
 * Burada renk bir SERI degil, DURUM anlatir (hedefte / risk / asildi), bu
 * yuzden sabit durum paleti kullanilir ve her segment ikon + etiket + sayi
 * ile birlikte gosterilir — renk hicbir zaman tek basina anlam tasimaz.
 * Segmentler arasi 2px yuzey boslugu vardir (kenarlik cizilmez).
 */

export interface MeterSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  icon: IconName;
  tone: 'good' | 'warning' | 'critical' | 'neutral';
}

export function SlaMeter({ segments }: { segments: MeterSegment[] }): React.JSX.Element {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div>
      <div
        className="meter"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
      >
        {total === 0 ? (
          <div className="meter-seg" style={{ flex: 1, background: 'var(--surface-2)' }} />
        ) : (
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <div
                key={segment.key}
                className="meter-seg"
                style={{ flex: segment.value, background: segment.color }}
              />
            ))
        )}
      </div>

      <div className="meter-legend">
        {segments.map((segment) => (
          <div key={segment.key} className="meter-row">
            <span className="pill" data-tone={segment.tone}>
              <Icon name={segment.icon} size={11} />
              {segment.label}
            </span>
            <span className="num">{segment.value}</span>
            <span className="muted small nums" style={{ minWidth: 42, textAlign: 'right' }}>
              {total ? `%${Math.round((segment.value / total) * 100)}` : '-'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
