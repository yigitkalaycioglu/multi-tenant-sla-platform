-- ============================================================================
--  001_init.sql - Cok kiracili (multi-tenant) is takip & SLA semasi
--
--  Notlar:
--   * Her kiraci-kapsamli tabloda tenant_id + Row Level Security (RLS) vardir.
--   * API baglantisi dusuk yetkili "app_user" rolu ile kurulur; her istek
--     transaction basinda SET LOCAL app.tenant_id yapar. Boylece bir kiracinin
--     verisi, uygulama katmaninda bir WHERE unutulsa bile veritabani
--     tarafindan gorunmez olur (defense in depth).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- --- Enum tipleri -----------------------------------------------------------
DO $mig$ BEGIN CREATE TYPE user_role       AS ENUM ('admin','team_lead','developer');              EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;
DO $mig$ BEGIN CREATE TYPE ticket_status   AS ENUM ('open','in_progress','on_hold','resolved','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;
DO $mig$ BEGIN CREATE TYPE ticket_priority AS ENUM ('low','medium','high','urgent');               EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;
DO $mig$ BEGIN CREATE TYPE sla_state       AS ENUM ('on_track','at_risk','breached','met');        EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;
DO $mig$ BEGIN CREATE TYPE email_status    AS ENUM ('queued','sent','failed');                     EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

-- --- Ortak updated_at tetikleyicisi -----------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- --- Kiracilar --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  plan       text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','pro','enterprise')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- --- Ekipler ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description text,
  lead_id     uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_tenant_name_uniq UNIQUE (tenant_id, name)
);

-- --- Kullanicilar -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  role          user_role NOT NULL DEFAULT 'developer',
  team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_tenant_email_uniq UNIQUE (tenant_id, email)
);

-- teams.lead_id -> users FK'si, dairesel bagimlilik nedeniyle sonradan eklenir
DO $mig$ BEGIN
  ALTER TABLE teams
    ADD CONSTRAINT teams_lead_fk FOREIGN KEY (lead_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

-- --- SLA politikalari (kiraci x oncelik) ------------------------------------
CREATE TABLE IF NOT EXISTS sla_policies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  priority           ticket_priority NOT NULL,
  response_minutes   integer NOT NULL CHECK (response_minutes   BETWEEN 5 AND 100000),
  resolution_minutes integer NOT NULL CHECK (resolution_minutes BETWEEN 5 AND 1000000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sla_policy_tenant_priority_uniq UNIQUE (tenant_id, priority),
  CONSTRAINT sla_policy_window_valid CHECK (resolution_minutes >= response_minutes)
);

-- --- Kiraci bazli bilet numaratoru (TCK-000001) -----------------------------
CREATE TABLE IF NOT EXISTS ticket_counters (
  tenant_id   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

-- --- Biletler ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference            text NOT NULL,
  title                text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description          text NOT NULL DEFAULT '',
  status               ticket_status   NOT NULL DEFAULT 'open',
  priority             ticket_priority NOT NULL DEFAULT 'medium',
  team_id              uuid REFERENCES teams(id)        ON DELETE SET NULL,
  assignee_id          uuid REFERENCES users(id)        ON DELETE SET NULL,
  reporter_id          uuid REFERENCES users(id)        ON DELETE SET NULL,
  sla_policy_id        uuid REFERENCES sla_policies(id) ON DELETE SET NULL,

  -- SLA saat isleyisi
  response_due_at      timestamptz,
  resolution_due_at    timestamptz,
  first_response_at    timestamptz,
  resolved_at          timestamptz,
  closed_at            timestamptz,
  paused_at            timestamptz,
  paused_total_seconds integer NOT NULL DEFAULT 0 CHECK (paused_total_seconds >= 0),
  response_sla_state   sla_state NOT NULL DEFAULT 'on_track',
  resolution_sla_state sla_state NOT NULL DEFAULT 'on_track',
  risk_notified_at     timestamptz,
  breach_notified_at   timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tickets_tenant_reference_uniq UNIQUE (tenant_id, reference),
  CONSTRAINT tickets_resolved_consistency CHECK (
    (status IN ('resolved','closed')) = (resolved_at IS NOT NULL)
  ),
  CONSTRAINT tickets_hold_consistency CHECK (
    (status = 'on_hold') = (paused_at IS NOT NULL)
  )
);

-- --- Yorumlar ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  is_internal boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- --- Denetim izi / zaman tuneli ---------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_events (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id  uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  type       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --- E-posta bildirim kaydi (kuyruktan yazilir) -----------------------------
CREATE TABLE IF NOT EXISTS email_log (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id  uuid REFERENCES tickets(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  recipient  citext NOT NULL,
  subject    text NOT NULL,
  status     email_status NOT NULL DEFAULT 'queued',
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

-- --- Refresh token'lar (rotasyonlu) -----------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
--  Indeksler
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_tenant            ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_team       ON users (tenant_id, team_id);
CREATE INDEX IF NOT EXISTS idx_teams_tenant            ON teams (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_status   ON tickets (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_assignee ON tickets (tenant_id, assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_team     ON tickets (tenant_id, team_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_created  ON tickets (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_priority        ON tickets (tenant_id, priority, status);

-- SLA tarayicisi yalnizca acik ve duraklatilmamis biletlere bakar -> kismi indeks
CREATE INDEX IF NOT EXISTS idx_tickets_open_resolution_due
  ON tickets (resolution_due_at)
  WHERE status NOT IN ('resolved','closed') AND paused_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_open_response_due
  ON tickets (response_due_at)
  WHERE first_response_at IS NULL AND status NOT IN ('resolved','closed') AND paused_at IS NULL;

-- Serbest metin arama (baslik + referans)
CREATE INDEX IF NOT EXISTS idx_tickets_search
  ON tickets USING gin (to_tsvector('simple', title || ' ' || reference));

CREATE INDEX IF NOT EXISTS idx_comments_ticket  ON ticket_comments (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_ticket    ON ticket_events   (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_tenant ON email_log       (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_user     ON refresh_tokens  (user_id) WHERE revoked_at IS NULL;

-- ============================================================================
--  updated_at tetikleyicileri
-- ============================================================================
DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','teams','users','sla_policies','tickets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $mig$;

-- ============================================================================
--  Row Level Security - kiraci izolasyonu veritabani seviyesinde
-- ============================================================================
DO $mig$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['teams','users','sla_policies','ticket_counters','tickets',
                           'ticket_comments','ticket_events','email_log','refresh_tokens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I'
      ' USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)'
      ' WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $mig$;
