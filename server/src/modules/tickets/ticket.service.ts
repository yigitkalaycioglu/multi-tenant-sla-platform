import { withTenant, type Db } from '../../db/pool.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { publishRealtime } from '../../realtime/bus.js';
import { enqueueNotification } from '../../queue/index.js';
import { can } from '../../middleware/rbac.js';
import { computeDueDates, resumeFromHold, MINUTE_MS } from '../sla/sla.engine.js';
import { TICKET_JOINS, TICKET_SELECT, toTicketDto, type TicketDto, type TicketJoinedRow } from './ticket.dto.js';
import {
  OPEN_STATUSES,
  STATUS_TRANSITIONS,
  type AuthUser,
  type SlaState,
  type TicketEventType,
  type TicketPriority,
  type TicketStatus,
} from '../../types/domain.js';

const log = logger.child({ module: 'tickets' });

// ---------------------------------------------------------------------------
//  Yetki kapsami
// ---------------------------------------------------------------------------

/**
 * Rol bazli okuma kapsami.
 *  admin      -> kiracidaki tum biletler
 *  digerleri  -> kendi ekibinin, kendine atanmis ya da kendi actigi biletler
 *
 * Not: kiraci izolasyonu ayrica RLS tarafindan garanti edilir; buradaki
 * filtre kiraci ICINDEKI gorunurluk kuralidir.
 */
export function scopeClause(auth: AuthUser, params: unknown[]): string {
  if (auth.role === 'admin') return 'TRUE';

  params.push(auth.id);
  const userIdx = params.length;

  if (auth.teamId) {
    params.push(auth.teamId);
    return `(t.assignee_id = $${userIdx} OR t.reporter_id = $${userIdx} OR t.team_id = $${params.length})`;
  }
  return `(t.assignee_id = $${userIdx} OR t.reporter_id = $${userIdx})`;
}

/** Biletin uzerinde yonetsel degisiklik (atama, oncelik, ekip) yapabilir mi? */
function canManage(auth: AuthUser, row: { team_id: string | null }): boolean {
  if (auth.role === 'admin') return true;
  if (auth.role === 'team_lead') return row.team_id !== null && row.team_id === auth.teamId;
  return false;
}

/** Durum degisikligi: yoneticiler ya da bileti ustlenen kisi. */
function canChangeStatus(auth: AuthUser, row: { team_id: string | null; assignee_id: string | null }): boolean {
  return canManage(auth, row) || row.assignee_id === auth.id;
}

// ---------------------------------------------------------------------------
//  Listeleme
// ---------------------------------------------------------------------------

export interface TicketFilters {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  teamId?: string;
  assigneeId?: string;
  slaState?: SlaState[];
  search?: string;
  sort: 'created_desc' | 'created_asc' | 'due_asc' | 'priority_desc';
  page: number;
  pageSize: number;
}

const SORT_SQL: Record<TicketFilters['sort'], string> = {
  created_desc: 't.created_at DESC',
  created_asc: 't.created_at ASC',
  due_asc: 't.resolution_due_at ASC NULLS LAST',
  priority_desc: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC`,
};

export async function listTickets(
  auth: AuthUser,
  filters: TicketFilters,
): Promise<{ items: TicketDto[]; total: number; page: number; pageSize: number }> {
  return withTenant(auth.tenantId, async (db) => {
    const params: unknown[] = [];
    const where: string[] = [scopeClause(auth, params)];

    if (filters.status?.length) {
      params.push(filters.status);
      where.push(`t.status = ANY($${params.length}::ticket_status[])`);
    }
    if (filters.priority?.length) {
      params.push(filters.priority);
      where.push(`t.priority = ANY($${params.length}::ticket_priority[])`);
    }
    if (filters.slaState?.length) {
      params.push(filters.slaState);
      where.push(`t.resolution_sla_state = ANY($${params.length}::sla_state[])`);
    }
    if (filters.teamId) {
      params.push(filters.teamId);
      where.push(`t.team_id = $${params.length}`);
    }
    if (filters.assigneeId === 'unassigned') {
      where.push('t.assignee_id IS NULL');
    } else if (filters.assigneeId) {
      params.push(filters.assigneeId);
      where.push(`t.assignee_id = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      where.push(`(t.title ILIKE $${params.length} OR t.reference ILIKE $${params.length})`);
    }

    const whereSql = where.join(' AND ');

    const totalResult = await db.query<{ count: number }>(
      `SELECT COUNT(*)::bigint AS count ${TICKET_JOINS} WHERE ${whereSql}`,
      params,
    );

    const offset = (filters.page - 1) * filters.pageSize;
    params.push(filters.pageSize, offset);

    const rows = await db.query<TicketJoinedRow>(
      `SELECT ${TICKET_SELECT},
              (SELECT COUNT(*)::bigint FROM ticket_comments c WHERE c.ticket_id = t.id) AS comment_count
         ${TICKET_JOINS}
        WHERE ${whereSql}
        ORDER BY ${SORT_SQL[filters.sort]}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const now = new Date();
    return {
      items: rows.rows.map((r) => toTicketDto(r, now)),
      total: totalResult.rows[0]?.count ?? 0,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  });
}

// ---------------------------------------------------------------------------
//  Tekil bilet + zaman tuneli
// ---------------------------------------------------------------------------

export interface TicketEventDto {
  id: string;
  type: TicketEventType | string;
  payload: Record<string, unknown>;
  actor: { id: string; name: string } | null;
  createdAt: string;
}

export interface TicketCommentDto {
  id: string;
  body: string;
  isInternal: boolean;
  author: { id: string; name: string } | null;
  createdAt: string;
}

async function loadTicketOrThrow(db: Db, auth: AuthUser, ticketId: string): Promise<TicketJoinedRow> {
  const params: unknown[] = [ticketId];
  const scope = scopeClause(auth, params);

  const result = await db.query<TicketJoinedRow>(
    `SELECT ${TICKET_SELECT},
            (SELECT COUNT(*)::bigint FROM ticket_comments c WHERE c.ticket_id = t.id) AS comment_count
       ${TICKET_JOINS}
      WHERE t.id = $1 AND ${scope}`,
    params,
  );

  const row = result.rows[0];
  if (!row) throw notFound('Bilet bulunamadi veya goruntuleme yetkiniz yok');
  return row;
}

export async function getTicket(
  auth: AuthUser,
  ticketId: string,
): Promise<{ ticket: TicketDto; comments: TicketCommentDto[]; events: TicketEventDto[] }> {
  return withTenant(auth.tenantId, async (db) => {
    const row = await loadTicketOrThrow(db, auth, ticketId);

    const comments = await db.query<{
      id: string;
      body: string;
      is_internal: boolean;
      author_id: string | null;
      author_name: string | null;
      created_at: Date;
    }>(
      `SELECT c.id, c.body, c.is_internal, c.author_id, u.full_name AS author_name, c.created_at
         FROM ticket_comments c
         LEFT JOIN users u ON u.id = c.author_id
        WHERE c.ticket_id = $1
        ORDER BY c.created_at ASC`,
      [ticketId],
    );

    const events = await db.query<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      actor_id: string | null;
      actor_name: string | null;
      created_at: Date;
    }>(
      `SELECT e.id::text AS id, e.type, e.payload, e.actor_id, u.full_name AS actor_name, e.created_at
         FROM ticket_events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.ticket_id = $1
        ORDER BY e.created_at ASC, e.id ASC`,
      [ticketId],
    );

    return {
      ticket: toTicketDto(row),
      comments: comments.rows.map((c) => ({
        id: c.id,
        body: c.body,
        isInternal: c.is_internal,
        author: c.author_id ? { id: c.author_id, name: c.author_name ?? 'Silinmis kullanici' } : null,
        createdAt: c.created_at.toISOString(),
      })),
      events: events.rows.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload ?? {},
        actor: e.actor_id ? { id: e.actor_id, name: e.actor_name ?? 'Silinmis kullanici' } : null,
        createdAt: e.created_at.toISOString(),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
//  Olusturma
// ---------------------------------------------------------------------------

async function recordEvent(
  db: Db,
  tenantId: string,
  ticketId: string,
  actorId: string | null,
  type: TicketEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO ticket_events (tenant_id, ticket_id, actor_id, type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, ticketId, actorId, type, JSON.stringify(payload)],
  );
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  priority: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
}

export async function createTicket(auth: AuthUser, input: CreateTicketInput): Promise<TicketDto> {
  const { dto, assigneeEmail } = await withTenant(auth.tenantId, async (db) => {
    // 1) Kiraci bazli bilet numarasi. INSERT ... ON CONFLICT DO UPDATE satiri
    //    kilitler; transaction bitene kadar baska bir istek ayni numarayi alamaz.
    const counter = await db.query<{ last_number: number }>(
      `INSERT INTO ticket_counters (tenant_id, last_number) VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET last_number = ticket_counters.last_number + 1
       RETURNING last_number`,
      [auth.tenantId],
    );
    const reference = `TCK-${String(counter.rows[0]!.last_number).padStart(6, '0')}`;

    // 2) Oncelige karsilik gelen SLA politikasi
    const policy = await db.query<{ id: string; response_minutes: number; resolution_minutes: number }>(
      `SELECT id, response_minutes, resolution_minutes FROM sla_policies WHERE priority = $1`,
      [input.priority],
    );
    const slaPolicy = policy.rows[0] ?? null;

    const createdAt = new Date();
    const dues = slaPolicy ? computeDueDates(createdAt, slaPolicy) : null;

    // 3) Atanan kisi dogrulanir (RLS sayesinde baska kiracidan kullanici gelemez)
    if (input.assigneeId) {
      const exists = await db.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [input.assigneeId]);
      if (!exists.rowCount) throw badRequest('Atanacak kullanici bulunamadi');
    }

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO tickets (tenant_id, reference, title, description, priority, status,
                            team_id, assignee_id, reporter_id, sla_policy_id,
                            created_at, response_due_at, resolution_due_at)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        auth.tenantId,
        reference,
        input.title,
        input.description ?? '',
        input.priority,
        input.teamId ?? null,
        input.assigneeId ?? null,
        auth.id,
        slaPolicy?.id ?? null,
        createdAt,
        dues?.responseDueAt ?? null,
        dues?.resolutionDueAt ?? null,
      ],
    );
    const ticketId = inserted.rows[0]!.id;

    await recordEvent(db, auth.tenantId, ticketId, auth.id, 'created', {
      priority: input.priority,
      reference,
    });

    let assigneeEmail: string | null = null;
    if (input.assigneeId) {
      await recordEvent(db, auth.tenantId, ticketId, auth.id, 'assigned', { assigneeId: input.assigneeId });
      const mail = await db.query<{ email: string }>('SELECT email::text AS email FROM users WHERE id = $1', [
        input.assigneeId,
      ]);
      assigneeEmail = mail.rows[0]?.email ?? null;
    }

    const row = await db.query<TicketJoinedRow>(
      `SELECT ${TICKET_SELECT}, 0::bigint AS comment_count ${TICKET_JOINS} WHERE t.id = $1`,
      [ticketId],
    );

    return { dto: toTicketDto(row.rows[0]!), assigneeEmail };
  });

  // Transaction kapandiktan SONRA yan etkiler: canli olay + e-posta kuyrugu.
  await publishRealtime({ tenantId: auth.tenantId, event: 'ticket:created', payload: dto, ticketId: dto.id });

  if (assigneeEmail && dto.assignee) {
    await enqueueNotification(
      {
        kind: 'ticket_assigned',
        tenantId: auth.tenantId,
        ticketId: dto.id,
        reference: dto.reference,
        title: dto.title,
        priority: dto.priority,
        dueAt: dto.sla.resolution.dueAt ?? new Date().toISOString(),
        recipients: [assigneeEmail],
        assignedBy: auth.fullName,
      },
      `assigned:${dto.id}:${dto.assignee.id}`,
    );
  }

  log.info({ ticketId: dto.id, reference: dto.reference, tenantId: auth.tenantId }, 'Bilet olusturuldu');
  return dto;
}

// ---------------------------------------------------------------------------
//  Guncelleme
// ---------------------------------------------------------------------------

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  teamId?: string | null;
  assigneeId?: string | null;
}

interface MutableTicketRow {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  team_id: string | null;
  assignee_id: string | null;
  reporter_id: string | null;
  created_at: Date;
  response_due_at: Date | null;
  resolution_due_at: Date | null;
  first_response_at: Date | null;
  paused_at: Date | null;
  paused_total_seconds: number;
}

export async function updateTicket(auth: AuthUser, ticketId: string, patch: UpdateTicketInput): Promise<TicketDto> {
  const { dto, changes, newAssigneeEmail } = await withTenant(auth.tenantId, async (db) => {
    // Yaris kosullarini onlemek icin satiri kilitle.
    const params: unknown[] = [ticketId];
    const scope = scopeClause(auth, params);
    const current = await db.query<MutableTicketRow>(
      `SELECT t.id, t.status, t.priority, t.team_id, t.assignee_id, t.reporter_id, t.created_at,
              t.response_due_at, t.resolution_due_at, t.first_response_at,
              t.paused_at, t.paused_total_seconds
         FROM tickets t
        WHERE t.id = $1 AND ${scope}
        FOR UPDATE`,
      params,
    );

    const row = current.rows[0];
    if (!row) throw notFound('Bilet bulunamadi veya goruntuleme yetkiniz yok');

    const now = new Date();
    const changes: string[] = [];

    // Kolon -> deger esleme. Map kullanmak, ayni kolonun iki farkli adimda
    // (orn. hem oncelik hem durum degisiminde) atanmasi durumunda
    // "multiple assignments to same column" hatasini engeller: son yazan kazanir.
    const assignments = new Map<string, unknown>();
    const set = (column: string, value: unknown): void => {
      assignments.set(column, value);
    };

    // Durum degisimi bu iki degeri etkileyebilir; oncelik hesabi guncel
    // degerleri kullanmak zorunda.
    let effectivePausedTotal = row.paused_total_seconds;
    let effectiveFirstResponse: Date | null = row.first_response_at;

    // --- Metin alanlari -----------------------------------------------------
    if (patch.title !== undefined || patch.description !== undefined) {
      if (!canManage(auth, row) && row.reporter_id !== auth.id && row.assignee_id !== auth.id) {
        throw forbidden('Bilet icerigini duzenleme yetkiniz yok');
      }
      if (patch.title !== undefined) {
        set('title', patch.title);
        changes.push('title');
      }
      if (patch.description !== undefined) {
        set('description', patch.description);
        changes.push('description');
      }
    }

    // --- Ekip ---------------------------------------------------------------
    if (patch.teamId !== undefined && patch.teamId !== row.team_id) {
      if (!canManage(auth, row)) throw forbidden('Ekip degistirme yetkiniz yok');
      if (patch.teamId) {
        const exists = await db.query('SELECT 1 FROM teams WHERE id = $1', [patch.teamId]);
        if (!exists.rowCount) throw badRequest('Ekip bulunamadi');
      }
      set('team_id', patch.teamId);
      changes.push('team');
    }

    // --- Atama --------------------------------------------------------------
    let newAssigneeEmail: string | null = null;
    if (patch.assigneeId !== undefined && patch.assigneeId !== row.assignee_id) {
      if (!can(auth.role, 'ticket:assign')) throw forbidden('Atama yapma yetkiniz yok');
      if (!canManage(auth, row)) throw forbidden('Bu bilet uzerinde atama yapamazsiniz');

      if (patch.assigneeId) {
        const assignee = await db.query<{ email: string }>(
          'SELECT email::text AS email FROM users WHERE id = $1 AND is_active',
          [patch.assigneeId],
        );
        if (!assignee.rowCount) throw badRequest('Atanacak kullanici bulunamadi');
        newAssigneeEmail = assignee.rows[0]!.email;
      }

      set('assignee_id', patch.assigneeId);
      changes.push('assignee');
      await recordEvent(
        db,
        auth.tenantId,
        ticketId,
        auth.id,
        patch.assigneeId ? 'assigned' : 'unassigned',
        { assigneeId: patch.assigneeId },
      );
    }

    // --- Durum --------------------------------------------------------------
    if (patch.status && patch.status !== row.status) {
      if (!canChangeStatus(auth, row)) throw forbidden('Durum degistirme yetkiniz yok');

      const allowed = STATUS_TRANSITIONS[row.status];
      if (!allowed.includes(patch.status)) {
        throw badRequest(`"${row.status}" durumundan "${patch.status}" durumuna gecilemez`);
      }

      const outcome = applyStatusChange({ row, next: patch.status, now, set });
      effectivePausedTotal = outcome.pausedTotalSeconds;
      effectiveFirstResponse = outcome.firstResponseAt;

      changes.push('status');
      const reopened = OPEN_STATUSES.includes(patch.status) && !OPEN_STATUSES.includes(row.status);
      await recordEvent(db, auth.tenantId, ticketId, auth.id, reopened ? 'reopened' : 'status_changed', {
        from: row.status,
        to: patch.status,
      });
    }

    // --- Oncelik: SLA hedefleri yeniden hesaplanir ---------------------------
    //     Durum degisiminden SONRA calisir; boylece guncel bekleme suresini
    //     (effectivePausedTotal) baz alir ve hedefleri bir kez yazar.
    if (patch.priority && patch.priority !== row.priority) {
      if (!canManage(auth, row)) throw forbidden('Oncelik degistirme yetkiniz yok');

      const policy = await db.query<{ id: string; response_minutes: number; resolution_minutes: number }>(
        `SELECT id, response_minutes, resolution_minutes FROM sla_policies WHERE priority = $1`,
        [patch.priority],
      );
      const slaPolicy = policy.rows[0];

      set('priority', patch.priority);
      changes.push('priority');

      if (slaPolicy) {
        // Yeni hedefler acilis anindan hesaplanir; beklemede gecen sure eklenir.
        const pausedMs = effectivePausedTotal * 1000;
        set('sla_policy_id', slaPolicy.id);
        set('response_due_at', new Date(row.created_at.getTime() + slaPolicy.response_minutes * MINUTE_MS + pausedMs));
        set(
          'resolution_due_at',
          new Date(row.created_at.getTime() + slaPolicy.resolution_minutes * MINUTE_MS + pausedMs),
        );

        // Bilet hala acikken durumlar sifirlanir ki tarayici yeniden
        // degerlendirsin. Cozulmus bilette muhurlenen SLA sonucuna dokunulmaz.
        const finalStatus = patch.status ?? row.status;
        if (OPEN_STATUSES.includes(finalStatus)) {
          set('response_sla_state', effectiveFirstResponse ? 'met' : 'on_track');
          set('resolution_sla_state', 'on_track');
          set('risk_notified_at', null);
          set('breach_notified_at', null);
        }
      }
    }

    if (assignments.size === 0) {
      const unchanged = await loadTicketOrThrow(db, auth, ticketId);
      return { dto: toTicketDto(unchanged), changes, newAssigneeEmail };
    }

    const columns = [...assignments.keys()];
    const values: unknown[] = columns.map((c) => assignments.get(c));
    const setSql = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    values.push(ticketId);
    await db.query(`UPDATE tickets SET ${setSql} WHERE id = $${values.length}`, values);

    const updated = await loadTicketOrThrow(db, auth, ticketId);
    return { dto: toTicketDto(updated), changes, newAssigneeEmail };
  });

  if (changes.length) {
    await publishRealtime({
      tenantId: auth.tenantId,
      event: 'ticket:updated',
      ticketId: dto.id,
      payload: { ticket: dto, changes, actor: { id: auth.id, name: auth.fullName } },
    });
  }

  if (newAssigneeEmail && dto.assignee) {
    await enqueueNotification(
      {
        kind: 'ticket_assigned',
        tenantId: auth.tenantId,
        ticketId: dto.id,
        reference: dto.reference,
        title: dto.title,
        priority: dto.priority,
        dueAt: dto.sla.resolution.dueAt ?? new Date().toISOString(),
        recipients: [newAssigneeEmail],
        assignedBy: auth.fullName,
      },
      `assigned:${dto.id}:${dto.assignee.id}:${Date.now()}`,
    );
  }

  return dto;
}

/**
 * Durum gecisinin SLA saatine etkisini uygular.
 *  - on_hold  : saat durur (paused_at)
 *  - devam    : beklenen sure kadar hedefler ileri kaydirilir
 *  - resolved : cozum SLA'si "met" ya da "breached" olarak muhurlenir
 *  - reopen   : cozum alanlari temizlenir, saat yeniden isler
 */
function applyStatusChange(args: {
  row: MutableTicketRow;
  next: TicketStatus;
  now: Date;
  set: (column: string, value: unknown) => void;
}): { pausedTotalSeconds: number; firstResponseAt: Date | null } {
  const { row, next, now, set } = args;

  let pausedTotalSeconds = row.paused_total_seconds;
  let firstResponseAt = row.first_response_at;

  set('status', next);

  // Beklemeden cikis
  if (row.paused_at && next !== 'on_hold') {
    const resumed = resumeFromHold({
      pausedAt: row.paused_at,
      now,
      pausedTotalSeconds: row.paused_total_seconds,
      responseDueAt: row.response_due_at,
      resolutionDueAt: row.resolution_due_at,
      firstResponseAt: row.first_response_at,
    });
    set('paused_at', null);
    set('paused_total_seconds', resumed.pausedTotalSeconds);
    set('response_due_at', resumed.responseDueAt);
    set('resolution_due_at', resumed.resolutionDueAt);
    pausedTotalSeconds = resumed.pausedTotalSeconds;
  }

  if (next === 'on_hold') {
    set('paused_at', now);
  }

  if (next === 'resolved' || next === 'closed') {
    set('resolved_at', now);
    if (next === 'closed') set('closed_at', now);

    // Cozum an itibariyle muhurlenir.
    const dueAt = row.resolution_due_at;
    set('resolution_sla_state', dueAt && now.getTime() > dueAt.getTime() ? 'breached' : 'met');

    // Cozum, ayni zamanda ilk yanit sayilir.
    if (!row.first_response_at) {
      set('first_response_at', now);
      const responseDue = row.response_due_at;
      set('response_sla_state', responseDue && now.getTime() > responseDue.getTime() ? 'breached' : 'met');
      firstResponseAt = now;
    }
  }

  // Yeniden acma
  if (OPEN_STATUSES.includes(next)) {
    set('resolved_at', null);
    set('closed_at', null);
    set('resolution_sla_state', 'on_track');
    set('breach_notified_at', null);
    set('risk_notified_at', null);
  }

  return { pausedTotalSeconds, firstResponseAt };
}

// ---------------------------------------------------------------------------
//  Yorumlar
// ---------------------------------------------------------------------------

export async function addComment(
  auth: AuthUser,
  ticketId: string,
  input: { body: string; isInternal: boolean },
): Promise<TicketCommentDto> {
  const { comment, firstResponse, ticket } = await withTenant(auth.tenantId, async (db) => {
    const params: unknown[] = [ticketId];
    const scope = scopeClause(auth, params);
    const found = await db.query<MutableTicketRow>(
      `SELECT t.id, t.status, t.priority, t.team_id, t.assignee_id, t.reporter_id, t.created_at,
              t.response_due_at, t.resolution_due_at, t.first_response_at, t.paused_at, t.paused_total_seconds
         FROM tickets t WHERE t.id = $1 AND ${scope} FOR UPDATE`,
      params,
    );
    const row = found.rows[0];
    if (!row) throw notFound('Bilet bulunamadi veya goruntuleme yetkiniz yok');

    const inserted = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO ticket_comments (tenant_id, ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [auth.tenantId, ticketId, auth.id, input.body, input.isInternal],
    );

    await recordEvent(db, auth.tenantId, ticketId, auth.id, 'commented', { isInternal: input.isInternal });

    // Ilk yanit SLA'si: bileti acan disindaki biri, dahili olmayan bir yorum
    // yazdiginda "ilk yanit verildi" sayilir.
    let firstResponse = false;
    if (!row.first_response_at && !input.isInternal && row.reporter_id !== auth.id) {
      const now = inserted.rows[0]!.created_at;
      const due = row.response_due_at;
      await db.query(
        `UPDATE tickets SET first_response_at = $2, response_sla_state = $3 WHERE id = $1`,
        [ticketId, now, due && now.getTime() > due.getTime() ? 'breached' : 'met'],
      );
      await recordEvent(db, auth.tenantId, ticketId, auth.id, 'first_response', {});
      firstResponse = true;
    }

    const ticketRow = await loadTicketOrThrow(db, auth, ticketId);

    return {
      comment: {
        id: inserted.rows[0]!.id,
        body: input.body,
        isInternal: input.isInternal,
        author: { id: auth.id, name: auth.fullName },
        createdAt: inserted.rows[0]!.created_at.toISOString(),
      } satisfies TicketCommentDto,
      firstResponse,
      ticket: toTicketDto(ticketRow),
    };
  });

  await publishRealtime({
    tenantId: auth.tenantId,
    event: 'ticket:comment',
    ticketId,
    payload: { ticketId, comment, ticket, firstResponse },
  });

  return comment;
}

// ---------------------------------------------------------------------------
//  Silme
// ---------------------------------------------------------------------------

export async function deleteTicket(auth: AuthUser, ticketId: string): Promise<void> {
  await withTenant(auth.tenantId, async (db) => {
    const result = await db.query('DELETE FROM tickets WHERE id = $1', [ticketId]);
    if (!result.rowCount) throw notFound('Bilet bulunamadi');
  });

  await publishRealtime({ tenantId: auth.tenantId, event: 'ticket:deleted', payload: { ticketId }, ticketId });
  log.info({ ticketId, actor: auth.id }, 'Bilet silindi');
}
