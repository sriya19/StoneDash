-- 0014_scheduling_rpcs.sql — Write-path RPCs for scheduling (Task 3)
--
-- All event + share-link writes go through these SECURITY DEFINER functions.
-- 0013 REVOKEs direct INSERT/UPDATE/DELETE on order_events,
-- order_event_assignments, and event_share_links from the authenticated
-- and anon roles, and layers WITH CHECK (false) policies on top.
--
-- Auth rules (all RPCs do their own check; SECURITY DEFINER bypasses RLS):
--   create_order_event       — manager+
--   update_order_event       — manager+
--   delete_order_event       — manager+
--   update_event_status      — any org member (field+); OR service_role
--                              when called via the public /j/[slug] page
--                              (the p_via_shared_link=true branch)
--   create_event_share_link  — manager+
--   rotate_event_share_link  — manager+
--   revoke_event_share_link  — manager+
--
-- Slugs are generated in Node (lib/share-link/slug.ts) and passed in.
-- The RPC validates length and uniqueness; the table CHECK guarantees
-- length >= 12 as a backstop.

-- ===========================================================================
-- Shared helper: insert/replace assignments for an event.
-- ===========================================================================

CREATE OR REPLACE FUNCTION _replace_event_assignments(
  p_event_id    uuid,
  p_org_id      uuid,
  p_assignments jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) = 'null' THEN
    -- treat as empty
    DELETE FROM order_event_assignments WHERE event_id = p_event_id;
    RETURN;
  END IF;

  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'assignments must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Every named crew member must belong to the same org.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_assignments) AS elem
     WHERE NOT EXISTS (
       SELECT 1 FROM crew_members cm
        WHERE cm.id = (elem ->> 'crew_member_id')::uuid
          AND cm.org_id = p_org_id
     )
  ) THEN
    RAISE EXCEPTION 'one or more crew_member_ids are not in this org'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Replace strategy: delete all, insert new. Cheap for small N (a typical
  -- event has 1-3 assignments).
  DELETE FROM order_event_assignments WHERE event_id = p_event_id;

  v_count := jsonb_array_length(p_assignments);
  IF v_count > 0 THEN
    INSERT INTO order_event_assignments (event_id, crew_member_id, role)
    SELECT
      p_event_id,
      (elem ->> 'crew_member_id')::uuid,
      NULLIF(elem ->> 'role', '')
    FROM jsonb_array_elements(p_assignments) AS elem;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION _replace_event_assignments(uuid, uuid, jsonb) FROM PUBLIC;

-- ===========================================================================
-- Shared helper: validate same-UTC-day in the RPC body too.
-- The DB CHECK enforces it at the constraint level; this gives a
-- friendlier error message to the action layer.
-- ===========================================================================

CREATE OR REPLACE FUNCTION _validate_event_same_utc_day(
  p_starts_at    timestamptz,
  p_duration_min int
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_duration_min <= 0 THEN
    RAISE EXCEPTION 'duration_min must be > 0' USING ERRCODE = 'check_violation';
  END IF;

  IF date_trunc('day', p_starts_at AT TIME ZONE 'UTC')
     <> date_trunc('day', (p_starts_at + make_interval(mins => p_duration_min)) AT TIME ZONE 'UTC')
  THEN
    RAISE EXCEPTION 'event must start and end on the same UTC calendar day'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ===========================================================================
-- create_order_event
-- ===========================================================================

CREATE OR REPLACE FUNCTION create_order_event(
  p_order_id      uuid,
  p_kind          text,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_location_text text,
  p_notes         text,
  p_assignments   jsonb
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
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM orders WHERE id = p_order_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of order org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to create events' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('measurement', 'install', 'delivery', 'pickup', 'other') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  PERFORM _validate_event_same_utc_day(p_starts_at, p_duration_min);

  INSERT INTO order_events
    (org_id, order_id, kind, starts_at, duration_min, location_text, notes, created_by)
  VALUES
    (v_org_id, p_order_id, p_kind, p_starts_at, p_duration_min,
     NULLIF(p_location_text, ''), NULLIF(p_notes, ''), v_actor)
  RETURNING id INTO v_event_id;

  PERFORM _replace_event_assignments(v_event_id, v_org_id, p_assignments);

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_order_event(uuid, text, timestamptz, int, text, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- update_order_event
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_order_event(
  p_event_id      uuid,
  p_kind          text,
  p_starts_at     timestamptz,
  p_duration_min  int,
  p_location_text text,
  p_notes         text,
  p_assignments   jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM order_events WHERE id = p_event_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to edit events' USING ERRCODE = '42501';
  END IF;

  IF p_kind NOT IN ('measurement', 'install', 'delivery', 'pickup', 'other') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind USING ERRCODE = 'check_violation';
  END IF;

  PERFORM _validate_event_same_utc_day(p_starts_at, p_duration_min);

  UPDATE order_events
     SET kind          = p_kind,
         starts_at     = p_starts_at,
         duration_min  = p_duration_min,
         location_text = NULLIF(p_location_text, ''),
         notes         = NULLIF(p_notes, '')
   WHERE id = p_event_id;

  PERFORM _replace_event_assignments(p_event_id, v_org_id, p_assignments);
END;
$$;

GRANT EXECUTE ON FUNCTION update_order_event(uuid, text, timestamptz, int, text, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- delete_order_event
-- ===========================================================================

CREATE OR REPLACE FUNCTION delete_order_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM order_events WHERE id = p_event_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to delete events' USING ERRCODE = '42501';
  END IF;

  DELETE FROM order_events WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_order_event(uuid) TO authenticated;

-- ===========================================================================
-- update_event_status
-- ---------------------------------------------------------------------------
-- Two call sites:
--   1. App-side action (any authenticated org member, incl. field role)
--      → p_via_shared_link = false → must pass is_org_member()
--   2. Public /j/[slug] server fetcher (no JWT, service_role client)
--      → p_via_shared_link = true → must be service_role
--
-- State machine (PLAN Q7): block 'complete' → 'scheduled' and
-- 'cancelled' → 'in_progress'. Everything else free.
--
-- The via marker is plumbed through a transaction-local GUC so the
-- AFTER UPDATE trigger can write it into activity_log.metadata.via.
-- Same pattern as app.stage_change_note from 0009.
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_event_status(
  p_event_id          uuid,
  p_status            text,
  p_via_shared_link   boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id     uuid;
  v_old_status text;
BEGIN
  IF p_status NOT IN ('scheduled', 'en_route', 'in_progress',
                      'complete', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = 'check_violation';
  END IF;

  SELECT org_id, status INTO v_org_id, v_old_status
    FROM order_events WHERE id = p_event_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Auth branch depends on caller.
  IF p_via_shared_link THEN
    -- Public /j/[slug] path. The route validates the slug and is_revoked
    -- BEFORE calling this RPC using the service-role client. We assert
    -- the caller is service_role here as a backstop — no other path
    -- legitimately sets p_via_shared_link=true.
    IF current_setting('request.jwt.claim.role', true) <> 'service_role'
       AND auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'via_shared_link requires service_role'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- App path. Any authenticated org member can call this, including
    -- field role. This is the *only* way field role mutates events.
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;
    IF NOT is_org_member(v_org_id) THEN
      RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- State machine: block the two transitions that almost certainly mean
  -- "wrong button". Everything else free.
  IF (v_old_status = 'complete'  AND p_status = 'scheduled')
     OR (v_old_status = 'cancelled' AND p_status = 'in_progress') THEN
    RAISE EXCEPTION 'invalid status transition: % -> %', v_old_status, p_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Plumb via marker for the audit trigger. Transaction-local; auto-clears
  -- at commit.
  IF p_via_shared_link THEN
    PERFORM set_config('app.event_status_via_shared_link', '1', true);
  ELSE
    PERFORM set_config('app.event_status_via_shared_link', '', true);
  END IF;

  UPDATE order_events SET status = p_status WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_event_status(uuid, text, boolean) TO authenticated, service_role;

-- ===========================================================================
-- create_event_share_link
-- ---------------------------------------------------------------------------
-- Semantics: at most one live (revoked_at IS NULL) link per event. This
-- function RAISES if one already exists. To replace a live link with a
-- fresh slug, call rotate_event_share_link instead.
-- ===========================================================================

CREATE OR REPLACE FUNCTION create_event_share_link(
  p_event_id uuid,
  p_slug     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_org_id  uuid;
  v_link_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_slug IS NULL OR length(p_slug) < 12 THEN
    RAISE EXCEPTION 'slug too short' USING ERRCODE = 'check_violation';
  END IF;

  SELECT org_id INTO v_org_id FROM order_events WHERE id = p_event_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to create share links' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM event_share_links
     WHERE event_id = p_event_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a live share link already exists for this event'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO event_share_links (org_id, event_id, slug, created_by)
  VALUES (v_org_id, p_event_id, p_slug, v_actor)
  RETURNING id INTO v_link_id;

  RETURN v_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_event_share_link(uuid, text) TO authenticated;

-- ===========================================================================
-- rotate_event_share_link
-- ---------------------------------------------------------------------------
-- Atomically revoke any live link for the event and insert a new one.
-- ===========================================================================

CREATE OR REPLACE FUNCTION rotate_event_share_link(
  p_event_id uuid,
  p_slug     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_org_id  uuid;
  v_link_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_slug IS NULL OR length(p_slug) < 12 THEN
    RAISE EXCEPTION 'slug too short' USING ERRCODE = 'check_violation';
  END IF;

  SELECT org_id INTO v_org_id FROM order_events WHERE id = p_event_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of event org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to rotate share links' USING ERRCODE = '42501';
  END IF;

  UPDATE event_share_links
     SET revoked_at = now()
   WHERE event_id = p_event_id AND revoked_at IS NULL;

  INSERT INTO event_share_links (org_id, event_id, slug, created_by)
  VALUES (v_org_id, p_event_id, p_slug, v_actor)
  RETURNING id INTO v_link_id;

  RETURN v_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION rotate_event_share_link(uuid, text) TO authenticated;

-- ===========================================================================
-- revoke_event_share_link
-- ===========================================================================

CREATE OR REPLACE FUNCTION revoke_event_share_link(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM event_share_links WHERE id = p_link_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'share link not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of link org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to revoke share links' USING ERRCODE = '42501';
  END IF;

  UPDATE event_share_links
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_link_id;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_event_share_link(uuid) TO authenticated;
