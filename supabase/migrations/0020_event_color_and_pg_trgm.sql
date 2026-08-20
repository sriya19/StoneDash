-- 0020_event_color_and_pg_trgm.sql — Task 6B color picker + Task 6C
-- pg_trgm prerequisite. Bundled per PLAN Q10 lock so we only pay
-- one migration round-trip for both.
--
-- Pieces:
--   1. Enable pg_trgm extension.
--   2. ALTER TABLE order_events ADD COLUMN color text NULL with a
--      palette CHECK constraint on the 10 curated keys.
--   3. Extend the kind CHECK to include 'repair'.
--   4. DROP + CREATE update_order_event / create_order_event to
--      accept the new p_color parameter. Function overloading in
--      Postgres by parameter name is nightmarish, so we drop the
--      old signatures cleanly and re-add.
--   5. Three GIN trigram indexes: customers.name, orders.project_name,
--      contractors.name — the substrate the 6C matching module
--      needs (PLAN Q10 lock).

BEGIN;

-- ===========================================================================
-- pg_trgm
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===========================================================================
-- order_events.color + kind CHECK extended for 'repair'
-- ===========================================================================
--
-- The palette keys are curated (10 total). Storing keys, not hex,
-- means palette drift stays a design decision — we change the hex
-- in one place (`lib/events/color.ts`) and every stored row moves
-- with it. NULL means "use the kind's default color" — no data
-- change needed for the ~5k existing events; `getEventColor(event)`
-- returns the kind default when `color IS NULL`.

ALTER TABLE order_events
  ADD COLUMN color text NULL;

ALTER TABLE order_events
  ADD CONSTRAINT order_events_color_valid
  CHECK (
    color IS NULL
    OR color IN (
      'terracotta', 'green', 'blue', 'purple', 'amber',
      'rose', 'teal', 'indigo', 'slate', 'brown'
    )
  );

-- Extend the kind CHECK to include 'repair'. Repairs are jobs too —
-- 6C's proposal dispatcher creates repair events on request_type
-- 'repair' + order-match. The default color for repair events is
-- amber (per the brief); enforced client-side in KIND_DEFAULT_COLOR.

ALTER TABLE order_events DROP CONSTRAINT order_events_kind_valid;

ALTER TABLE order_events
  ADD CONSTRAINT order_events_kind_valid
  CHECK (kind IN (
    'measurement', 'install', 'delivery', 'pickup', 'other', 'task', 'repair'
  ));

-- ===========================================================================
-- create_order_event / update_order_event — add p_color
-- ===========================================================================
--
-- Signature change: adding a new DEFAULT-NULL parameter. Postgres
-- treats this as a different function overload, so we DROP the old
-- signatures cleanly. Existing callers pass positional args today;
-- they'll continue to work because p_color defaults to NULL.

DROP FUNCTION IF EXISTS create_order_event(
  uuid, text, timestamptz, int, text, text, jsonb, text, boolean
);

CREATE OR REPLACE FUNCTION create_order_event(
  p_order_id      uuid,
  p_kind          text,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_location_text text,
  p_notes         text,
  p_assignments   jsonb,
  p_title         text DEFAULT NULL,
  p_is_all_day    boolean DEFAULT false,
  p_color         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_org_id   uuid;
  v_event_id uuid;
  v_duration int := p_duration_min;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN (
    'measurement', 'install', 'delivery', 'pickup', 'other', 'task', 'repair'
  ) THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  -- Palette validation. NULL means "use the kind default"; anything
  -- else must match the curated set. The table CHECK is the last
  -- line of defense; this one gives a friendlier error message.
  IF p_color IS NOT NULL AND p_color NOT IN (
    'terracotta', 'green', 'blue', 'purple', 'amber',
    'rose', 'teal', 'indigo', 'slate', 'brown'
  ) THEN
    RAISE EXCEPTION 'invalid color: %', p_color USING ERRCODE = 'check_violation';
  END IF;

  -- Title-or-order rule — enforced at the table level too, but a
  -- friendlier error message here.
  IF p_order_id IS NULL AND (p_title IS NULL OR length(trim(p_title)) = 0) THEN
    RAISE EXCEPTION 'standalone events require a title' USING ERRCODE = 'check_violation';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM orders WHERE id = p_order_id;
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'order not found' USING ERRCODE = 'no_data_found';
    END IF;
  ELSE
    SELECT active_org_id INTO v_org_id FROM profiles WHERE id = v_actor;
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'caller has no active org' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to create events' USING ERRCODE = '42501';
  END IF;

  IF p_is_all_day THEN
    v_duration := 1440;
  END IF;

  PERFORM _validate_event_same_utc_day(p_starts_at, v_duration, p_is_all_day);

  INSERT INTO order_events
    (org_id, order_id, kind, title, is_all_day, starts_at, duration_min,
     location_text, notes, color, created_by)
  VALUES
    (v_org_id, p_order_id, p_kind, NULLIF(p_title, ''), p_is_all_day,
     p_starts_at, v_duration,
     NULLIF(p_location_text, ''), NULLIF(p_notes, ''), p_color, v_actor)
  RETURNING id INTO v_event_id;

  PERFORM _replace_event_assignments(v_event_id, v_org_id, p_assignments);

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  create_order_event(uuid, text, timestamptz, int, text, text, jsonb, text, boolean, text)
  TO authenticated;

-- ---------- update_order_event ----------

DROP FUNCTION IF EXISTS update_order_event(
  uuid, text, timestamptz, int, text, text, jsonb, text, boolean
);

CREATE OR REPLACE FUNCTION update_order_event(
  p_event_id      uuid,
  p_kind          text,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_location_text text,
  p_notes         text,
  p_assignments   jsonb,
  p_title         text DEFAULT NULL,
  p_is_all_day    boolean DEFAULT false,
  p_color         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_org_id   uuid;
  v_order_id uuid;
  v_duration int := p_duration_min;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id, order_id INTO v_org_id, v_order_id
    FROM order_events WHERE id = p_event_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to edit events' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN (
    'measurement', 'install', 'delivery', 'pickup', 'other', 'task', 'repair'
  ) THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  IF p_color IS NOT NULL AND p_color NOT IN (
    'terracotta', 'green', 'blue', 'purple', 'amber',
    'rose', 'teal', 'indigo', 'slate', 'brown'
  ) THEN
    RAISE EXCEPTION 'invalid color: %', p_color USING ERRCODE = 'check_violation';
  END IF;

  IF v_order_id IS NULL AND (p_title IS NULL OR length(trim(p_title)) = 0) THEN
    RAISE EXCEPTION 'standalone events require a title' USING ERRCODE = 'check_violation';
  END IF;

  IF p_is_all_day THEN
    v_duration := 1440;
  END IF;

  PERFORM _validate_event_same_utc_day(p_starts_at, v_duration, p_is_all_day);

  UPDATE order_events
     SET kind          = p_kind,
         title         = CASE WHEN v_order_id IS NULL THEN NULLIF(p_title, '') ELSE title END,
         is_all_day    = p_is_all_day,
         starts_at     = p_starts_at,
         duration_min  = v_duration,
         location_text = NULLIF(p_location_text, ''),
         notes         = NULLIF(p_notes, ''),
         color         = p_color
   WHERE id = p_event_id;

  PERFORM _replace_event_assignments(p_event_id, v_org_id, p_assignments);
END;
$$;

GRANT EXECUTE ON FUNCTION
  update_order_event(uuid, text, timestamptz, int, text, text, jsonb, text, boolean, text)
  TO authenticated;

-- ===========================================================================
-- pg_trgm indexes — feed the 6C matching module
-- ===========================================================================
--
-- All three are GIN + gin_trgm_ops. Trigram similarity queries like
-- `similarity(lower(name), lower(:input)) > 0.4` scan the whole table
-- without an index; with these, the same query is index-supported.
-- Partial index on orders.project_name (nullable) skips rows without
-- a project name so the index footprint stays tight.

CREATE INDEX customers_name_trgm_idx
  ON customers USING gin (lower(name) gin_trgm_ops);

CREATE INDEX orders_project_trgm_idx
  ON orders USING gin (lower(project_name) gin_trgm_ops)
  WHERE project_name IS NOT NULL;

CREATE INDEX contractors_name_trgm_idx
  ON contractors USING gin (lower(name) gin_trgm_ops);

COMMIT;
