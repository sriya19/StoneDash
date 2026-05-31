-- 0017_scheduling_v2_rpcs.sql — RPC updates for standalone + all-day events (Task 3.1)
--
-- Three RPCs change signature to accept the new shape:
--   create_order_event  — adds p_title, p_is_all_day
--   update_order_event  — adds p_title, p_is_all_day
--   _validate_event_same_utc_day — adds p_is_all_day branch (skips the check)
--
-- Adding parameters requires DROP + CREATE (CREATE OR REPLACE only works
-- when the signature is identical). All three are re-granted on EXECUTE.
--
-- For standalone events (p_order_id IS NULL), org_id is resolved from the
-- caller's active org via profiles.active_org_id. The RPC RAISEs if the
-- caller has no active org — the app path always does (getCurrentUserAndOrg
-- enforces it), so this only trips on direct DB writes from a profile
-- without an active org, which shouldn't happen.

-- ===========================================================================
-- _validate_event_same_utc_day — new p_is_all_day param
-- ===========================================================================

DROP FUNCTION _validate_event_same_utc_day(timestamptz, int);

CREATE OR REPLACE FUNCTION _validate_event_same_utc_day(
  p_starts_at    timestamptz,
  p_duration_min int,
  p_is_all_day   boolean
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_duration_min <= 0 THEN
    RAISE EXCEPTION 'duration_min must be > 0' USING ERRCODE = 'check_violation';
  END IF;

  IF p_is_all_day THEN
    -- All-day events bypass the same-UTC-day check (matches the table CHECK).
    -- Action layer enforces 00:00 org-local + duration_min = 1440 before
    -- calling this RPC; the table CHECK catches the duration mismatch.
    RETURN;
  END IF;

  IF date_trunc('day', p_starts_at AT TIME ZONE 'UTC')
     <> date_trunc('day', ((p_starts_at AT TIME ZONE 'UTC') + make_interval(mins => p_duration_min)) AT TIME ZONE 'UTC')
  THEN
    RAISE EXCEPTION 'event must start and end on the same UTC calendar day'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ===========================================================================
-- create_order_event — supports standalone + all-day
-- ===========================================================================

DROP FUNCTION create_order_event(uuid, text, timestamptz, int, text, text, jsonb);

CREATE OR REPLACE FUNCTION create_order_event(
  p_order_id      uuid,
  p_kind          text,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_location_text text,
  p_notes         text,
  p_assignments   jsonb,
  p_title         text DEFAULT NULL,
  p_is_all_day    boolean DEFAULT false
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

  IF p_kind NOT IN ('measurement', 'install', 'delivery', 'pickup', 'other', 'task') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  -- Title-or-order rule — enforced at the table level too, but a friendlier
  -- error message here.
  IF p_order_id IS NULL AND (p_title IS NULL OR length(trim(p_title)) = 0) THEN
    RAISE EXCEPTION 'standalone events require a title' USING ERRCODE = 'check_violation';
  END IF;

  -- Resolve org_id. Order-tied events read from the order; standalone events
  -- read from the caller's active org.
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

  -- All-day events: force duration = 1440 (silently overrides caller).
  -- The action layer also enforces this, but the RPC is the last line.
  IF p_is_all_day THEN
    v_duration := 1440;
  END IF;

  PERFORM _validate_event_same_utc_day(p_starts_at, v_duration, p_is_all_day);

  INSERT INTO order_events
    (org_id, order_id, kind, title, is_all_day, starts_at, duration_min,
     location_text, notes, created_by)
  VALUES
    (v_org_id, p_order_id, p_kind, NULLIF(p_title, ''), p_is_all_day,
     p_starts_at, v_duration,
     NULLIF(p_location_text, ''), NULLIF(p_notes, ''), v_actor)
  RETURNING id INTO v_event_id;

  PERFORM _replace_event_assignments(v_event_id, v_org_id, p_assignments);

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  create_order_event(uuid, text, timestamptz, int, text, text, jsonb, text, boolean)
  TO authenticated;

-- ===========================================================================
-- update_order_event — supports title + all-day; allows toggling neither
-- ===========================================================================
--
-- Note: changing order_id from set→null or null→set on an existing event
-- is not supported (PLAN Q3: event type is fixed at create time). The RPC
-- doesn't accept p_order_id — the caller can't move events between orders.

DROP FUNCTION update_order_event(uuid, text, timestamptz, int, text, text, jsonb);

CREATE OR REPLACE FUNCTION update_order_event(
  p_event_id      uuid,
  p_kind          text,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_location_text text,
  p_notes         text,
  p_assignments   jsonb,
  p_title         text DEFAULT NULL,
  p_is_all_day    boolean DEFAULT false
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

  IF p_kind NOT IN ('measurement', 'install', 'delivery', 'pickup', 'other', 'task') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  -- title-or-order rule: standalone events keep needing a title.
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
         notes         = NULLIF(p_notes, '')
   WHERE id = p_event_id;

  PERFORM _replace_event_assignments(p_event_id, v_org_id, p_assignments);
END;
$$;

GRANT EXECUTE ON FUNCTION
  update_order_event(uuid, text, timestamptz, int, text, text, jsonb, text, boolean)
  TO authenticated;
