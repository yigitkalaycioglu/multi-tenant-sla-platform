import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  SLA_LABELS,
  SLA_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  formatRemaining,
  type Tone,
} from '../lib/format';
import type { SlaSnapshot, TicketPriority, TicketStatus } from '../api/types';

// --- Rozetler ---------------------------------------------------------------

export function Pill({
  tone,
  icon,
  children,
  title,
}: {
  tone: Tone;
  icon?: IconName;
  children: ReactNode;
  title?: string;
}): React.JSX.Element {
  return (
    <span className="pill" data-tone={tone} title={title}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

const STATUS_ICONS: Record<TicketStatus, IconName> = {
  open: 'ticket',
  in_progress: 'play',
  on_hold: 'pause',
  resolved: 'check',
  closed: 'check',
};

export const StatusPill = ({ status }: { status: TicketStatus }): React.JSX.Element => (
  <Pill tone={STATUS_TONES[status]} icon={STATUS_ICONS[status]}>
    {STATUS_LABELS[status]}
  </Pill>
);

export const PriorityPill = ({ priority }: { priority: TicketPriority }): React.JSX.Element => (
  <Pill tone={PRIORITY_TONES[priority]} icon="flag">
    {PRIORITY_LABELS[priority]}
  </Pill>
);

const SLA_ICONS: Record<string, IconName> = {
  on_track: 'check',
  met: 'check',
  at_risk: 'alert',
  breached: 'siren',
};

/**
 * SLA hucresi: durum rozeti (ikon + etiket) + geri sayim + tuketim cubugu.
 * Renk tek basina bilgi tasimaz; metin her zaman durumu yazar.
 */
export function SlaCell({ sla, paused }: { sla: SlaSnapshot; paused?: boolean }): React.JSX.Element {
  const tone = SLA_TONES[sla.state];
  const ratio = Math.min(1, Math.max(0, sla.consumedRatio));
  const fill =
    sla.state === 'breached'
      ? 'var(--status-critical)'
      : sla.state === 'at_risk'
        ? 'var(--status-warning)'
        : 'var(--status-good)';

  return (
    <div className="col" style={{ gap: 5, minWidth: 132 }}>
      <div className="row" style={{ gap: 6 }}>
        <Pill tone={tone} icon={SLA_ICONS[sla.state] ?? 'clock'}>
          {SLA_LABELS[sla.state]}
        </Pill>
        {paused ? (
          <Pill tone="neutral" icon="pause" title="SLA saati durduruldu">
            Durdu
          </Pill>
        ) : null}
      </div>
      <div className="small muted nums">
        {sla.state === 'met' ? 'Hedef karsilandi' : formatRemaining(sla.remainingMs)}
      </div>
      <div className="sla-bar" aria-hidden="true">
        <div className="sla-bar-fill" style={{ width: `${Math.max(3, ratio * 100)}%`, background: fill }} />
      </div>
    </div>
  );
}

// --- Istatistik karosu ------------------------------------------------------

export function StatTile({
  label,
  value,
  foot,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string | number;
  foot?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'critical';
  icon?: IconName;
}): React.JSX.Element {
  return (
    <div className="stat" data-tone={tone}>
      <div className="stat-label">
        {icon ? <Icon name={icon} size={14} /> : null}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  );
}

// --- Modal ------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon right" onClick={onClose} aria-label="Kapat">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// --- Bos durum & sayfalama --------------------------------------------------

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {text ? <div className="small">{text}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}): React.JSX.Element | null {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="pager">
      <span className="small muted nums">
        {from}-{to} / {total} kayit
      </span>
      <span className="right row" style={{ gap: 6 }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Onceki sayfa"
        >
          <Icon name="chevronLeft" size={14} />
        </button>
        <span className="small nums">
          {page} / {pages}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Sonraki sayfa"
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }): React.JSX.Element | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Beklenmeyen bir hata olustu';
  return (
    <div className="alert" data-tone="critical">
      <Icon name="alert" size={15} />
      <span>{message}</span>
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="stack-sm" style={{ padding: 14 }}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: 34 }} />
      ))}
    </div>
  );
}
