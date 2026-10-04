import { Icon } from '../Icon';

/**
 * Yatay cubuk listesi — TEK seri, tek renk (kategorik slot 1).
 *
 * Kategoriler dogal bir siraya sahip olmadigi icin renk buyuklukle
 * degismez (deger rampasi kullanilmaz); uzunluk zaten buyuklugu anlatir.
 * Degerler cubuk ucunda DOGRUDAN etiketlenir, yani ipucu tek erisim
 * yolu degildir. Ihlal sayisi ayri bir seri degil, DURUM bilgisidir:
 * ikon + etiketle birlikte durum renginde gosterilir.
 */

export interface BarItem {
  id: string;
  label: string;
  value: number;
  /** Durum vurgusu (orn. SLA ihlali) — renk tek basina anlam tasimaz. */
  alertCount?: number;
  alertLabel?: string;
}

interface BarListProps {
  items: BarItem[];
  emptyText?: string;
  valueLabel?: string;
}

export function BarList({ items, emptyText = 'Gosterilecek kayit yok', valueLabel }: BarListProps): React.JSX.Element {
  if (items.length === 0) {
    return <p className="muted small">{emptyText}</p>;
  }

  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="stack-sm" role="list">
      {items.map((item) => {
        const ratio = item.value / max;
        return (
          <div key={item.id} role="listitem">
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span className="small truncate" style={{ maxWidth: '60%' }} title={item.label}>
                {item.label}
              </span>
              {item.alertCount ? (
                <span className="pill" data-tone="critical" title={item.alertLabel ?? 'SLA ihlali'}>
                  <Icon name="siren" size={11} />
                  {item.alertCount} {item.alertLabel ?? 'ihlal'}
                </span>
              ) : null}
              <span className="right small strong nums">
                {item.value}
                {valueLabel ? <span className="muted"> {valueLabel}</span> : null}
              </span>
            </div>

            {/* Cubuk: taban sola sabit, veri ucu 4px yuvarlatilmis */}
            <div
              style={{
                height: 8,
                background: 'var(--surface-2)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(2, ratio * 100)}%`,
                  background: 'var(--series-1)',
                  borderRadius: '0 4px 4px 0',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
