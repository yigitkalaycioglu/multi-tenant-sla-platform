import { useMemo, useState } from 'react';
import { useMeasure } from '../../hooks/useMeasure';
import { formatDayShort } from '../../lib/format';

/**
 * Gunluk trend — iki seri, TEK eksen.
 *
 * Tasarim kurallari:
 *  - Kategorik renkler sabit sirayla atanir (slot 1 = Acilan, slot 2 = Cozulen);
 *    filtre degisse bile seri rengi degismez.
 *  - 2px cizgi, ince ve geri planda kalan hairline izgara (kesikli degil).
 *  - Her nokta etiketlenmez; yalnizca son nokta dogrudan etiketlenir,
 *    kalan degerler crosshair + ipucundan ve tablo gorunumunden okunur.
 *  - Klavye ile de gezilebilir (sol/sag ok), yani ipucu tek erisim yolu degil.
 */

export interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
}

interface TrendChartProps {
  data: TrendPoint[];
  showTable: boolean;
}

const SERIES = [
  { key: 'created', label: 'Acilan', color: 'var(--series-1)' },
  { key: 'resolved', label: 'Cozulen', color: 'var(--series-2)' },
] as const;

const PAD = { top: 18, right: 46, bottom: 30, left: 34 };
const PLOT_HEIGHT = 168;

export function TrendChart({ data, showTable }: TrendChartProps): React.JSX.Element {
  const [hostRef, width] = useMeasure<HTMLDivElement>(680);
  const [cursor, setCursor] = useState<number | null>(null);

  const height = PLOT_HEIGHT + PAD.top + PAD.bottom;
  const innerW = Math.max(120, width - PAD.left - PAD.right);

  const { ticks, xOf, yOf } = useMemo(() => {
    const peak = Math.max(1, ...data.flatMap((d) => [d.created, d.resolved]));
    // Ust siniri okunakli bir sayiya yuvarla.
    const step = peak <= 4 ? 1 : peak <= 10 ? 2 : peak <= 40 ? 5 : Math.ceil(peak / 8 / 10) * 10;
    const top = Math.ceil(peak / step) * step;

    const tickValues: number[] = [];
    for (let value = 0; value <= top; value += step) tickValues.push(value);

    return {
      ticks: tickValues.length > 6 ? tickValues.filter((_, i) => i % 2 === 0) : tickValues,
      xOf: (index: number) =>
        PAD.left + (data.length <= 1 ? innerW / 2 : (index / (data.length - 1)) * innerW),
      yOf: (value: number) => PAD.top + PLOT_HEIGHT - (value / top) * PLOT_HEIGHT,
    };
  }, [data, innerW]);

  if (showTable) {
    return (
      <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
        <table className="table">
          <caption className="visually-hidden" style={{ position: 'absolute', left: -9999 }}>
            Gunluk acilan ve cozulen bilet sayilari
          </caption>
          <thead>
            <tr>
              <th scope="col">Tarih</th>
              <th scope="col" className="num">
                Acilan
              </th>
              <th scope="col" className="num">
                Cozulen
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.date}>
                <td>{formatDayShort(point.date)}</td>
                <td className="num">{point.created}</td>
                <td className="num">{point.resolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const lineOf = (key: 'created' | 'resolved'): string =>
    data.map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(index)},${yOf(point[key])}`).join(' ');

  const active = cursor !== null ? data[cursor] : undefined;
  const lastIndex = data.length - 1;
  const labelStep = Math.max(1, Math.ceil(data.length / (innerW < 420 ? 4 : 7)));

  const moveCursor = (delta: number): void => {
    setCursor((current) => {
      const next = (current ?? lastIndex) + delta;
      return Math.min(lastIndex, Math.max(0, next));
    });
  };

  return (
    <figure className="chart-figure">
      <div className="chart-legend">
        {SERIES.map((series) => (
          <span key={series.key} className="legend-item">
            <span className="legend-swatch" style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
      </div>

      <div className="chart-host" ref={hostRef}>
        <svg
          className="chart-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Son ${data.length} gunde acilan ve cozulen bilet sayilari`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              moveCursor(-1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              moveCursor(1);
            } else if (event.key === 'Escape') {
              setCursor(null);
            }
          }}
          onMouseLeave={() => setCursor(null)}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - bounds.left - PAD.left;
            const ratio = innerW === 0 ? 0 : x / innerW;
            const index = Math.round(ratio * (data.length - 1));
            setCursor(Math.min(lastIndex, Math.max(0, index)));
          }}
        >
          {/* Yatay izgara — duz hairline, kesikli degil */}
          {ticks.map((value) => (
            <g key={value}>
              <line
                className="chart-grid-line"
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={yOf(value)}
                y2={yOf(value)}
              />
              <text className="chart-tick" x={PAD.left - 8} y={yOf(value) + 4} textAnchor="end">
                {value}
              </text>
            </g>
          ))}

          {/* Taban ekseni */}
          <line
            className="chart-axis-line"
            x1={PAD.left}
            x2={PAD.left + innerW}
            y1={yOf(0)}
            y2={yOf(0)}
          />

          {/* X etiketleri — secmeli, carpismayi onlemek icin adimli */}
          {data.map((point, index) =>
            index % labelStep === 0 || index === lastIndex ? (
              <text
                key={point.date}
                className="chart-tick"
                x={xOf(index)}
                y={PAD.top + PLOT_HEIGHT + 18}
                textAnchor={index === lastIndex ? 'end' : index === 0 ? 'start' : 'middle'}
              >
                {formatDayShort(point.date)}
              </text>
            ) : null,
          )}

          {/* Crosshair */}
          {cursor !== null ? (
            <line
              className="chart-axis-line"
              x1={xOf(cursor)}
              x2={xOf(cursor)}
              y1={PAD.top}
              y2={PAD.top + PLOT_HEIGHT}
            />
          ) : null}

          {/* Seriler */}
          {SERIES.map((series) => (
            <path
              key={series.key}
              d={lineOf(series.key)}
              fill="none"
              stroke={series.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Son noktanin dogrudan etiketi (her noktaya deger yazilmaz) */}
          {data.length > 0
            ? SERIES.map((series) => {
                const point = data[lastIndex]!;
                return (
                  <g key={`end-${series.key}`}>
                    <circle
                      cx={xOf(lastIndex)}
                      cy={yOf(point[series.key])}
                      r={4}
                      fill={series.color}
                      stroke="var(--surface-1)"
                      strokeWidth={2}
                    />
                    <text
                      className="chart-value"
                      x={xOf(lastIndex) + 9}
                      y={yOf(point[series.key]) + 4}
                      fill={series.color}
                    >
                      {point[series.key]}
                    </text>
                  </g>
                );
              })
            : null}

          {/* Imlecteki noktalar — 2px yuzey halkasiyla ayrilir */}
          {cursor !== null && active
            ? SERIES.map((series) => (
                <circle
                  key={`cursor-${series.key}`}
                  cx={xOf(cursor)}
                  cy={yOf(active[series.key])}
                  r={5}
                  fill={series.color}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              ))
            : null}
        </svg>

        {cursor !== null && active ? (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(Math.max(xOf(cursor), 70), width - 70),
              top: PAD.top + 4,
            }}
          >
            <div className="tooltip-title">{formatDayShort(active.date)}</div>
            {SERIES.map((series) => (
              <div key={series.key} className="tooltip-row">
                <span className="legend-swatch" style={{ background: series.color }} />
                {series.label}
                <span className="num">{active[series.key]}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
