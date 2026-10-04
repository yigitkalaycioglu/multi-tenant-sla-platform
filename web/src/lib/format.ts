import type { SlaState, TicketPriority, TicketStatus, UserRole } from '../api/types';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Acik',
  in_progress: 'Islemde',
  on_hold: 'Beklemede',
  resolved: 'Cozuldu',
  closed: 'Kapandi',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Dusuk',
  medium: 'Orta',
  high: 'Yuksek',
  urgent: 'Acil',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Yonetici',
  team_lead: 'Ekip Lideri',
  developer: 'Gelistirici',
};

export const SLA_LABELS: Record<SlaState, string> = {
  on_track: 'Hedefte',
  at_risk: 'Risk altinda',
  breached: 'Asildi',
  met: 'Karsilandi',
};

/** SLA durumu -> durum paleti tonu (renk asla tek basina anlam tasimaz). */
export type Tone = 'neutral' | 'info' | 'good' | 'warning' | 'serious' | 'critical';

export const SLA_TONES: Record<SlaState, Tone> = {
  on_track: 'good',
  at_risk: 'warning',
  breached: 'critical',
  met: 'good',
};

export const STATUS_TONES: Record<TicketStatus, Tone> = {
  open: 'info',
  in_progress: 'info',
  on_hold: 'neutral',
  resolved: 'good',
  closed: 'neutral',
};

export const PRIORITY_TONES: Record<TicketPriority, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'serious',
  urgent: 'critical',
};

const dateTime = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const dateOnly = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
const dayShort = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' });

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? dateTime.format(new Date(iso)) : '-';

export const formatDate = (iso: string | null | undefined): string =>
  iso ? dateOnly.format(new Date(iso)) : '-';

export const formatDayShort = (iso: string): string => dayShort.format(new Date(`${iso}T00:00:00`));

/** "3 saat once" tarzi goreli zaman. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '-';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'az once';
  if (minutes < 60) return `${minutes} dk once`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat once`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gun once`;
  return formatDate(iso);
}

/** Kalan/gecen SLA suresi: "2s 15dk kaldi" / "1g 4s gecti". */
export function formatRemaining(remainingMs: number | null): string {
  if (remainingMs === null) return 'SLA yok';

  const overdue = remainingMs < 0;
  const total = Math.abs(remainingMs);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);

  const parts: string[] = [];
  if (days) parts.push(`${days}g`);
  if (hours || days) parts.push(`${hours}s`);
  if (!days) parts.push(`${minutes}dk`);

  return `${parts.join(' ')} ${overdue ? 'gecti' : 'kaldi'}`;
}

/** Dakikayi "4s 30dk" bicimine cevirir (SLA politikalari icin). */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '-';
  if (minutes < 60) return `${minutes} dk`;

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);

  const parts: string[] = [];
  if (days) parts.push(`${days} gun`);
  if (hours) parts.push(`${hours} sa`);
  if (mins && !days) parts.push(`${mins} dk`);
  return parts.join(' ') || '0 dk';
}

export const formatPercent = (ratio: number | null): string =>
  ratio === null ? '-' : `%${Math.round(ratio * 100)}`;

export const formatNumber = (value: number): string => new Intl.NumberFormat('tr-TR').format(value);

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('');
}

/** Denetim izi olaylarini insan diline cevirir. */
export function describeEvent(
  type: string,
  payload: Record<string, unknown>,
  actorName: string | null,
): { text: string; tone: Tone; icon: 'plus' | 'refresh' | 'user' | 'message' | 'flag' | 'alert' | 'siren' | 'check' } {
  const actor = actorName ?? 'Sistem';
  const status = (value: unknown): string =>
    typeof value === 'string' && value in STATUS_LABELS ? STATUS_LABELS[value as TicketStatus] : String(value ?? '');

  switch (type) {
    case 'created':
      return { text: `${actor} bileti olusturdu`, tone: 'info', icon: 'plus' };
    case 'status_changed':
      return {
        text: `${actor} durumu "${status(payload.from)}" -> "${status(payload.to)}" yapti`,
        tone: 'info',
        icon: 'refresh',
      };
    case 'reopened':
      return { text: `${actor} bileti yeniden acti`, tone: 'warning', icon: 'refresh' };
    case 'assigned':
      return { text: `${actor} bileti atadi`, tone: 'info', icon: 'user' };
    case 'unassigned':
      return { text: `${actor} atamayi kaldirdi`, tone: 'neutral', icon: 'user' };
    case 'team_changed':
      return { text: `${actor} ekibi degistirdi`, tone: 'neutral', icon: 'flag' };
    case 'commented':
      return {
        text: `${actor} ${payload.isInternal ? 'dahili not' : 'yorum'} ekledi`,
        tone: 'neutral',
        icon: 'message',
      };
    case 'first_response':
      return { text: 'Ilk yanit verildi — yanit SLA hedefi kapandi', tone: 'good', icon: 'check' };
    case 'sla_at_risk':
      return { text: 'SLA suresi dolmak uzere', tone: 'warning', icon: 'alert' };
    case 'sla_breached':
      return { text: 'SLA suresi asildi', tone: 'critical', icon: 'siren' };
    default:
      return { text: `${actor}: ${type}`, tone: 'neutral', icon: 'refresh' };
  }
}
