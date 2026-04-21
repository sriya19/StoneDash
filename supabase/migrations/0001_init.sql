-- 0001_init.sql — Stone&DesignBoard initial schema
-- Tables, enums, indexes, updated_at triggers, org_order_seq, RLS helpers.
-- RLS policies live in 0002. Order-number function in 0003. Balance trigger
-- in 0004. Storage and audit triggers in 0005.

-- ===========================================================================
-- Enums
-- ===========================================================================

CREATE TYPE order_stage AS ENUM (
  'quote',
  'measurement',
  'fabrication',
  'qc',
  'installation',
  'invoiced',
  'paid',
  'cancelled'
);

CREATE TYPE order_priority AS ENUM (
  'low',
  'normal',
  'high',
  'rush'
);

CREATE TYPE member_role AS ENUM (
  'owner',
  'admin',
  'manager',
  'field'
);

CREATE TYPE attachment_kind AS ENUM (
  'template',
  'contract',
  'photo',
  'invoice',
  'other'
);

-- ===========================================================================
-- Generic updated_at helper
-- ===========================================================================

CREATE OR REPLACE FUNCTION tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- organizations
-- ===========================================================================

CREATE TABLE organizations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  logo_url         text,
  timezone         text NOT NULL DEFAULT 'America/New_York',
  currency         text NOT NULL DEFAULT 'USD',
  order_prefix     text NOT NULL,
  order_seq_start  integer NOT NULL DEFAULT 1000,
  owner_id         uuid NOT NULL REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_slug_lowercase CHECK (slug = lower(slug)),
  CONSTRAINT organizations_order_prefix_nonempty CHECK (length(trim(order_prefix)) > 0),
  CONSTRAINT organizations_order_seq_start_nonneg CHECK (order_seq_start >= 0)
);

CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- Default order_prefix from slug when caller doesn't supply one. Matches the
-- spec rule: upper(left(slug, 2)) with non-letter chars stripped first.
CREATE OR REPLACE FUNCTION tg_default_order_prefix()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_prefix IS NULL OR length(trim(NEW.order_prefix)) = 0 THEN
    NEW.order_prefix := upper(
      left(regexp_replace(NEW.slug, '[^a-zA-Z]', '', 'g'), 2)
    );
    IF NEW.order_prefix IS NULL OR length(NEW.order_prefix) = 0 THEN
      NEW.order_prefix := 'OR';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_default_prefix
BEFORE INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION tg_default_order_prefix();

-- ===========================================================================
-- profiles  (1-to-1 with auth.users)
-- ===========================================================================

CREATE TABLE profiles (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name      text,
  avatar_url     text,
  phone          text,
  active_org_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  theme          text NOT NULL DEFAULT 'light',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_theme_valid CHECK (theme IN ('light', 'dark', 'system'))
);

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- org_members
-- ===========================================================================

CREATE TABLE org_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role                member_role NOT NULL DEFAULT 'manager',
  invited_email       text,
  invite_token        text UNIQUE,
  invite_accepted_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_members_user_or_invite
    CHECK (user_id IS NOT NULL OR invite_accepted_at IS NULL),
  CONSTRAINT org_members_invite_has_token
    CHECK (user_id IS NOT NULL OR invite_token IS NOT NULL)
);

-- One accepted membership per (org, user)
CREATE UNIQUE INDEX org_members_org_user_idx
ON org_members (org_id, user_id)
WHERE user_id IS NOT NULL;

CREATE INDEX org_members_user_idx
ON org_members (user_id)
WHERE user_id IS NOT NULL;

CREATE INDEX org_members_invite_token_idx
ON org_members (invite_token)
WHERE invite_token IS NOT NULL;

-- ===========================================================================
-- customers
-- ===========================================================================

CREATE TABLE customers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           text NOT NULL,
  company        text,
  email          text,
  phone          text,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  notes          text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customers_org_idx ON customers (org_id);
CREATE INDEX customers_org_name_idx ON customers (org_id, lower(name));

CREATE TRIGGER customers_set_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- orders
-- ===========================================================================

CREATE TABLE orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number            text NOT NULL,
  customer_id             uuid REFERENCES customers(id) ON DELETE SET NULL,
  project_name            text,
  stage                   order_stage NOT NULL DEFAULT 'quote',
  priority                order_priority NOT NULL DEFAULT 'normal',
  stone_type              text,
  edge_profile            text,
  sink_cutouts            integer NOT NULL DEFAULT 0 CHECK (sink_cutouts >= 0),
  cooktop_cutouts         integer NOT NULL DEFAULT 0 CHECK (cooktop_cutouts >= 0),
  estimated_sqft          numeric CHECK (estimated_sqft IS NULL OR estimated_sqft >= 0),
  quote_amount            numeric CHECK (quote_amount IS NULL OR quote_amount >= 0),
  deposit_received        numeric NOT NULL DEFAULT 0 CHECK (deposit_received >= 0),
  balance_due             numeric NOT NULL DEFAULT 0,
  measured_at             date,
  fabrication_start_date  date,
  scheduled_install_date  date,
  installed_at            date,
  notes                   text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_order_number_unique_per_org UNIQUE (org_id, order_number)
);

CREATE INDEX orders_org_stage_idx ON orders (org_id, stage);
CREATE INDEX orders_org_install_idx ON orders (org_id, scheduled_install_date);
CREATE INDEX orders_org_updated_idx ON orders (org_id, updated_at DESC);
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_assigned_idx ON orders (assigned_to);

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- order_stage_history
-- ===========================================================================

CREATE TABLE order_stage_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_stage  order_stage,
  to_stage    order_stage NOT NULL,
  changed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_stage_history_order_idx
ON order_stage_history (order_id, created_at DESC);

-- ===========================================================================
-- order_attachments
-- ===========================================================================

CREATE TABLE order_attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  storage_path   text NOT NULL,
  original_name  text,
  mime           text,
  size_bytes     bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  kind           attachment_kind NOT NULL DEFAULT 'other',
  uploaded_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_attachments_order_idx ON order_attachments (order_id);
CREATE INDEX order_attachments_org_idx ON order_attachments (org_id);

-- ===========================================================================
-- activity_log
-- ===========================================================================

CREATE TABLE activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  action       text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_log_org_created_idx
ON activity_log (org_id, created_at DESC);

CREATE INDEX activity_log_entity_idx
ON activity_log (entity_type, entity_id);

-- ===========================================================================
-- org_order_seq  (backing state for generate_order_number)
-- ===========================================================================

CREATE TABLE org_order_seq (
  org_id    uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  next_seq  integer NOT NULL CHECK (next_seq > 0)
);

-- ===========================================================================
-- RLS helper functions (used by 0002_rls.sql and future policies)
-- ===========================================================================

-- Returns true if the caller is an accepted member of p_org_id.
CREATE OR REPLACE FUNCTION is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND invite_accepted_at IS NOT NULL
  );
$$;

-- Returns the caller's role in p_org_id, or NULL if not a member.
CREATE OR REPLACE FUNCTION org_role(p_org_id uuid)
RETURNS member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM org_members
  WHERE org_id = p_org_id
    AND user_id = auth.uid()
    AND invite_accepted_at IS NOT NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION is_org_member(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION org_role(uuid)      TO authenticated, anon;
