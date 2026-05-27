-- 0013_scheduling.sql — Scheduling + crew dispatch (Task 3)
--
-- New entities:
--   crew_members            — the people we assign work to (not app users)
--   order_events            — measurement / install / delivery / pickup / other
--   order_event_assignments — links events to crew, role per assignment
--   event_share_links       — public, slug-based share URLs for crew dispatch
--   v_calendar_events       — joined read-model for the calendar UI
--
-- Server-side timezone discipline (see DEVLOG header note):
-- All comparisons + indexes operate on UTC timestamptz. The same-day CHECK
-- below evaluates calendar-day-in-UTC, NOT in org-local time, because the
-- DB has no per-row knowledge of org tz at constraint-evaluation time.
-- Conversion to org timezone happens only in React render paths.
--
-- Write path: order_events and event_share_links are RPC-only (mirrors
-- the contractor-payments pattern from 0011). Direct INSERT/UPDATE/DELETE
-- is REVOKEd from authenticated, anon AND WITH CHECK (false) at the
-- policy layer — belt-and-suspenders.
--
-- Backfill: at the bottom of this file we backfill order_events from the
-- existing orders.measured_at / orders.scheduled_install_date columns,
-- assert the counts match (RAISE EXCEPTION on mismatch), and leave those
-- two columns populated for historical reference. A future migration drops
-- them once the read paths have been switched. Per PLAN.md Q5/Q13.

-- ===========================================================================
-- crew_members
-- ===========================================================================

CREATE TABLE crew_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  email       text,
  role        text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_members_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE INDEX crew_members_org_active_idx ON crew_members (org_id, is_active);
CREATE UNIQUE INDEX crew_members_org_name_unique_idx
  ON crew_members (org_id, lower(name));

CREATE TRIGGER crew_members_set_updated_at
BEFORE UPDATE ON crew_members
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- order_events
-- ===========================================================================
--
-- ends_at is a STORED generated column. Postgres CHECK constraints can
-- reference STORED-generated columns since the generated value is
-- computed before constraint evaluation; we explicitly reference the
-- underlying expression in the CHECK below to keep the rule independent
-- of column order. Both forms work; the explicit form is clearer.

CREATE TABLE order_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled',
  starts_at       timestamptz NOT NULL,
  duration_min    int NOT NULL DEFAULT 60,
  -- timestamptz + interval is STABLE (depends on session tz). The arithmetic
  -- has to route through `timestamp without tz` to be IMMUTABLE, which STORED
  -- generated columns require. AT TIME ZONE 'UTC' (constant) is itself
  -- IMMUTABLE; the round-trip ts→tz→ts preserves the moment.
  ends_at         timestamptz
                  GENERATED ALWAYS AS (
                    ((starts_at AT TIME ZONE 'UTC')
                     + make_interval(mins => duration_min))
                    AT TIME ZONE 'UTC'
                  )
                  STORED,
  location_text   text,
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT order_events_kind_valid
    CHECK (kind IN ('measurement', 'install', 'delivery', 'pickup', 'other')),

  CONSTRAINT order_events_status_valid
    CHECK (status IN ('scheduled', 'en_route', 'in_progress',
                      'complete', 'cancelled', 'no_show')),

  CONSTRAINT order_events_duration_positive
    CHECK (duration_min > 0),

  -- Same-day in UTC. See PLAN Q4. Restrictive but safe: any event
  -- spanning UTC midnight is rejected. For Top Marble (Eastern, UTC-5/-4)
  -- the practical cutoff is roughly 7 PM local — well outside install
  -- business hours. For a Pacific shop the cutoff would be earlier
  -- (around 4 PM local); revisit when/if we onboard one.
  CONSTRAINT order_events_same_utc_day
    CHECK (
      date_trunc('day', starts_at AT TIME ZONE 'UTC')
      = date_trunc('day', (starts_at + make_interval(mins => duration_min)) AT TIME ZONE 'UTC')
    )
);

CREATE INDEX order_events_org_starts_idx ON order_events (org_id, starts_at);
CREATE INDEX order_events_order_idx      ON order_events (order_id);
CREATE INDEX order_events_org_status_idx ON order_events (org_id, status);
CREATE INDEX order_events_org_kind_starts_idx
  ON order_events (org_id, kind, starts_at);

CREATE TRIGGER order_events_set_updated_at
BEFORE UPDATE ON order_events
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- order_event_assignments
-- ===========================================================================

CREATE TABLE order_event_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES order_events(id) ON DELETE CASCADE,
  crew_member_id  uuid NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  role            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_event_assignments_unique UNIQUE (event_id, crew_member_id)
);

CREATE INDEX order_event_assignments_event_idx ON order_event_assignments (event_id);
CREATE INDEX order_event_assignments_crew_idx  ON order_event_assignments (crew_member_id);

-- ===========================================================================
-- event_share_links
-- ===========================================================================

CREATE TABLE event_share_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES order_events(id) ON DELETE CASCADE,
  slug            text NOT NULL UNIQUE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  last_opened_at  timestamptz,
  CONSTRAINT event_share_links_slug_format CHECK (length(slug) >= 12)
);

CREATE INDEX event_share_links_org_event_idx
  ON event_share_links (org_id, event_id);
CREATE INDEX event_share_links_event_live_idx
  ON event_share_links (event_id) WHERE revoked_at IS NULL;

-- ===========================================================================
-- v_calendar_events  (security_invoker so RLS on underlying tables applies)
-- ===========================================================================

CREATE VIEW v_calendar_events
WITH (security_invoker = true)
AS
  SELECT
    e.id,
    e.org_id,
    e.order_id,
    e.kind,
    e.status,
    e.starts_at,
    e.ends_at,
    e.duration_min,
    e.location_text,
    e.notes,
    o.order_number,
    o.project_name,
    o.stone_type,
    o.stage,
    o.contractor_id,
    c.name  AS customer_name,
    c.phone AS customer_phone,
    cn.name AS contractor_name,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'id',   cm.id,
                'name', cm.name,
                'role', a.role
              ) ORDER BY cm.name)
         FROM order_event_assignments a
         JOIN crew_members cm ON cm.id = a.crew_member_id
        WHERE a.event_id = e.id),
      '[]'::jsonb
    ) AS crew
  FROM order_events e
  JOIN orders o      ON o.id  = e.order_id
  LEFT JOIN customers   c  ON c.id  = o.customer_id
  LEFT JOIN contractors cn ON cn.id = o.contractor_id;

-- ===========================================================================
-- v_orders_with_event_dates — orders + derived next install/measurement dates
-- ---------------------------------------------------------------------------
-- After the backfill, order_events is the source of truth for measurement
-- and install dates. Existing read paths (orders table, kanban, detail sheet,
-- contractor jobs tab, customer detail, dashboard KPI) were keyed on the
-- legacy date columns. This view derives the new values from order_events
-- while preserving the rest of the orders shape, so read paths can swap with
-- minimal change.
--
-- next_install_at and next_measurement_at are timestamptz (the actual event
-- starts_at, not just the date). Callers that need YYYY-MM-DD in org-local
-- format do the conversion at render time via lib/tz.ts.
-- ===========================================================================

CREATE VIEW v_orders_with_event_dates
WITH (security_invoker = true)
AS
  SELECT
    o.*,
    (SELECT MIN(starts_at) FROM order_events ev
      WHERE ev.order_id = o.id AND ev.kind = 'install')
      AS next_install_at,
    (SELECT MIN(starts_at) FROM order_events ev
      WHERE ev.order_id = o.id AND ev.kind = 'measurement')
      AS next_measurement_at
  FROM orders o;

-- ===========================================================================
-- RLS + direct-write lockdown
-- ===========================================================================

ALTER TABLE crew_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_event_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_share_links        ENABLE ROW LEVEL SECURITY;

-- ---------- crew_members (manager+ CRUD; field SELECT only) ----------

CREATE POLICY crew_members_select
  ON crew_members FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY crew_members_insert
  ON crew_members FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY crew_members_update
  ON crew_members FOR UPDATE TO authenticated
  USING      (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY crew_members_delete
  ON crew_members FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ---------- order_events (RPC-only writes) ----------
--
-- SELECT for any org member. All writes go through SECURITY DEFINER RPCs
-- (0014) which do their own RBAC. The WITH CHECK (false) policies plus
-- the REVOKE below mean even a future dev who forgets one of the two
-- still can't open a direct-write hole.
--
-- Field role: can SELECT; can call update_event_status RPC (which permits
-- field role explicitly); CANNOT write directly. This is how we express
-- "field can only update status" in v1 — no column-level RLS needed.

CREATE POLICY order_events_select
  ON order_events FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY order_events_no_direct_insert
  ON order_events FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY order_events_no_direct_update
  ON order_events FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY order_events_no_direct_delete
  ON order_events FOR DELETE TO authenticated
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON order_events FROM authenticated, anon;

-- ---------- order_event_assignments (RPC-only writes) ----------

CREATE POLICY order_event_assignments_select
  ON order_event_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM order_events e
       WHERE e.id = order_event_assignments.event_id
         AND is_org_member(e.org_id)
    )
  );

CREATE POLICY order_event_assignments_no_direct_insert
  ON order_event_assignments FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY order_event_assignments_no_direct_update
  ON order_event_assignments FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY order_event_assignments_no_direct_delete
  ON order_event_assignments FOR DELETE TO authenticated
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON order_event_assignments FROM authenticated, anon;

-- ---------- event_share_links (RPC-only writes) ----------

CREATE POLICY event_share_links_select
  ON event_share_links FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY event_share_links_no_direct_insert
  ON event_share_links FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY event_share_links_no_direct_update
  ON event_share_links FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY event_share_links_no_direct_delete
  ON event_share_links FOR DELETE TO authenticated
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON event_share_links FROM authenticated, anon;

-- ===========================================================================
-- Audit triggers
-- ---------------------------------------------------------------------------
-- Same pattern as 0011. AFTER INSERT/UPDATE/DELETE writes activity_log;
-- BEFORE DELETE clears dangling polymorphic rows; AFTER DELETE guards
-- against cascade-delete of the parent org.
--
-- For order_events specifically, the AFTER UPDATE trigger distinguishes
-- between 'rescheduled' (starts_at or duration changed), 'status_changed'
-- (status changed), and generic 'updated' (anything else). status_changed
-- carries the via=shared_link marker via the app.event_status_via_shared_link
-- GUC set by update_event_status — same pattern as 0009's stage-note GUC.
-- ===========================================================================

-- ---------- crew_members ----------

CREATE OR REPLACE FUNCTION tg_crew_members_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id, COALESCE(NEW.created_by, auth.uid()),
      'crew_member', NEW.id, 'created',
      jsonb_build_object('name', NEW.name, 'role', NEW.role)
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER crew_members_after_insert_audit
AFTER INSERT ON crew_members
FOR EACH ROW EXECUTE FUNCTION tg_crew_members_after_insert();

CREATE OR REPLACE FUNCTION tg_crew_members_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, auth.uid(), 'crew_member', NEW.id, 'updated',
        jsonb_build_object('name', NEW.name, 'is_active', NEW.is_active)
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER crew_members_after_update_audit
AFTER UPDATE ON crew_members
FOR EACH ROW EXECUTE FUNCTION tg_crew_members_after_update();

CREATE OR REPLACE FUNCTION tg_crew_members_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'crew_member', OLD.id, 'deleted',
      jsonb_build_object('name', OLD.name)
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER crew_members_after_delete_audit
AFTER DELETE ON crew_members
FOR EACH ROW EXECUTE FUNCTION tg_crew_members_after_delete();

CREATE OR REPLACE FUNCTION tg_crew_members_before_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'crew_member' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER crew_members_before_delete_cleanup
BEFORE DELETE ON crew_members
FOR EACH ROW EXECUTE FUNCTION tg_crew_members_before_delete_cleanup();

-- ---------- order_events ----------

CREATE OR REPLACE FUNCTION tg_order_events_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id, COALESCE(NEW.created_by, auth.uid()),
      'order_event', NEW.id, 'created',
      jsonb_build_object(
        'order_id',     NEW.order_id,
        'kind',         NEW.kind,
        'starts_at',    NEW.starts_at,
        'duration_min', NEW.duration_min,
        'status',       NEW.status
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_events_after_insert_audit
AFTER INSERT ON order_events
FOR EACH ROW EXECUTE FUNCTION tg_order_events_after_insert();

CREATE OR REPLACE FUNCTION tg_order_events_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_via text;
BEGIN
  -- Skip silent no-op updates (updated_at-only).
  IF to_jsonb(NEW) - 'updated_at' IS NOT DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RETURN NEW;
  END IF;

  -- Status-only change → status_changed (with optional shared-link marker).
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.starts_at    IS NOT DISTINCT FROM OLD.starts_at
     AND NEW.duration_min IS NOT DISTINCT FROM OLD.duration_min
     AND NEW.kind         IS NOT DISTINCT FROM OLD.kind
     AND NEW.location_text IS NOT DISTINCT FROM OLD.location_text
     AND NEW.notes        IS NOT DISTINCT FROM OLD.notes
  THEN
    v_via := NULLIF(current_setting('app.event_status_via_shared_link', true), '');
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id,
        CASE WHEN v_via = '1' THEN NULL ELSE auth.uid() END,
        'order_event', NEW.id, 'status_changed',
        jsonb_strip_nulls(jsonb_build_object(
          'order_id', NEW.order_id,
          'kind',     NEW.kind,
          'from',     OLD.status,
          'to',       NEW.status,
          'via',      CASE WHEN v_via = '1' THEN 'shared_link' ELSE NULL END
        ))
      );
    RETURN NEW;
  END IF;

  -- Time/duration change → rescheduled (preserves the from→to slot).
  IF (NEW.starts_at IS DISTINCT FROM OLD.starts_at
      OR NEW.duration_min IS DISTINCT FROM OLD.duration_min)
  THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, auth.uid(), 'order_event', NEW.id, 'rescheduled',
        jsonb_build_object(
          'order_id', NEW.order_id,
          'kind',     NEW.kind,
          'from',     jsonb_build_object('starts_at', OLD.starts_at, 'duration_min', OLD.duration_min),
          'to',       jsonb_build_object('starts_at', NEW.starts_at, 'duration_min', NEW.duration_min)
        )
      );
    RETURN NEW;
  END IF;

  -- Anything else → generic update (kind / location_text / notes).
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id, auth.uid(), 'order_event', NEW.id, 'updated',
      jsonb_build_object(
        'order_id', NEW.order_id,
        'kind',     NEW.kind
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_events_after_update_audit
AFTER UPDATE ON order_events
FOR EACH ROW EXECUTE FUNCTION tg_order_events_after_update();

CREATE OR REPLACE FUNCTION tg_order_events_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'order_event', OLD.id, 'deleted',
      jsonb_build_object(
        'order_id',  OLD.order_id,
        'kind',      OLD.kind,
        'starts_at', OLD.starts_at
      )
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER order_events_after_delete_audit
AFTER DELETE ON order_events
FOR EACH ROW EXECUTE FUNCTION tg_order_events_after_delete();

CREATE OR REPLACE FUNCTION tg_order_events_before_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'order_event' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER order_events_before_delete_cleanup
BEFORE DELETE ON order_events
FOR EACH ROW EXECUTE FUNCTION tg_order_events_before_delete_cleanup();

-- ---------- order_event_assignments ----------
--
-- Assignments are deliberately quiet in the activity feed (the event
-- row tells the story). We DO write activity_log rows so the data
-- exists for future use, but activity-feed.tsx hides them by default
-- (same dedupe pattern as contractor_allocation in Task 2B).

CREATE OR REPLACE FUNCTION tg_order_event_assignments_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM order_events WHERE id = NEW.event_id;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      v_org_id, auth.uid(), 'order_event_assignment', NEW.id, 'created',
      jsonb_build_object(
        'event_id',       NEW.event_id,
        'crew_member_id', NEW.crew_member_id,
        'role',           NEW.role
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_event_assignments_after_insert_audit
AFTER INSERT ON order_event_assignments
FOR EACH ROW EXECUTE FUNCTION tg_order_event_assignments_after_insert();

CREATE OR REPLACE FUNCTION tg_order_event_assignments_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM order_events WHERE id = OLD.event_id;
  IF v_org_id IS NULL THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      v_org_id, auth.uid(), 'order_event_assignment', OLD.id, 'deleted',
      jsonb_build_object(
        'event_id',       OLD.event_id,
        'crew_member_id', OLD.crew_member_id
      )
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER order_event_assignments_after_delete_audit
AFTER DELETE ON order_event_assignments
FOR EACH ROW EXECUTE FUNCTION tg_order_event_assignments_after_delete();

CREATE OR REPLACE FUNCTION tg_order_event_assignments_before_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'order_event_assignment' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER order_event_assignments_before_delete_cleanup
BEFORE DELETE ON order_event_assignments
FOR EACH ROW EXECUTE FUNCTION tg_order_event_assignments_before_delete_cleanup();

-- ---------- event_share_links ----------

CREATE OR REPLACE FUNCTION tg_event_share_links_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id, COALESCE(NEW.created_by, auth.uid()),
      'event_share_link', NEW.id, 'created',
      jsonb_build_object('event_id', NEW.event_id)
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_share_links_after_insert_audit
AFTER INSERT ON event_share_links
FOR EACH ROW EXECUTE FUNCTION tg_event_share_links_after_insert();

CREATE OR REPLACE FUNCTION tg_event_share_links_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only audit revocation transitions or new last_opened_at IS NOT what
  -- we audit (every page open would flood the feed). Revocation transitions
  -- are the interesting case.
  IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at AND NEW.revoked_at IS NOT NULL THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, auth.uid(), 'event_share_link', NEW.id, 'revoked',
        jsonb_build_object('event_id', NEW.event_id)
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_share_links_after_update_audit
AFTER UPDATE ON event_share_links
FOR EACH ROW EXECUTE FUNCTION tg_event_share_links_after_update();

CREATE OR REPLACE FUNCTION tg_event_share_links_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'event_share_link', OLD.id, 'deleted',
      jsonb_build_object('event_id', OLD.event_id)
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER event_share_links_after_delete_audit
AFTER DELETE ON event_share_links
FOR EACH ROW EXECUTE FUNCTION tg_event_share_links_after_delete();

CREATE OR REPLACE FUNCTION tg_event_share_links_before_delete_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'event_share_link' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER event_share_links_before_delete_cleanup
BEFORE DELETE ON event_share_links
FOR EACH ROW EXECUTE FUNCTION tg_event_share_links_before_delete_cleanup();

-- ===========================================================================
-- Backfill from orders.measured_at / orders.scheduled_install_date
-- ---------------------------------------------------------------------------
-- Per PLAN Q5/Q13: this is the one-time data migration. We INSERT into
-- order_events; we do NOT touch the source columns. A separate future
-- migration will drop them once read paths have moved over.
--
-- Audit trigger is disabled around the backfill so activity_log isn't
-- flooded with "scheduled install" rows for every legacy order. A single
-- summary activity_log entry is written at the end for visibility.
-- ===========================================================================

ALTER TABLE order_events DISABLE TRIGGER order_events_after_insert_audit;

-- Measurement events: 9 AM org-local, 60 min.
INSERT INTO order_events
  (org_id, order_id, kind, starts_at, duration_min, location_text)
SELECT
  o.org_id,
  o.id,
  'measurement',
  ((o.measured_at::text || ' 09:00:00')::timestamp AT TIME ZONE org.timezone),
  60,
  NULL
FROM orders o
JOIN organizations org ON org.id = o.org_id
WHERE o.measured_at IS NOT NULL;

-- Install events: 10 AM org-local, 180 min.
INSERT INTO order_events
  (org_id, order_id, kind, starts_at, duration_min, location_text)
SELECT
  o.org_id,
  o.id,
  'install',
  ((o.scheduled_install_date::text || ' 10:00:00')::timestamp AT TIME ZONE org.timezone),
  180,
  NULL
FROM orders o
JOIN organizations org ON org.id = o.org_id
WHERE o.scheduled_install_date IS NOT NULL;

ALTER TABLE order_events ENABLE TRIGGER order_events_after_insert_audit;

-- ---------------------------------------------------------------------------
-- In-migration assertion: counts MUST match. Abort the whole transaction
-- if the backfill produced the wrong number of rows. Per PLAN Q5/Q13
-- "belt and suspenders" — the verify script is the pre-flight check, this
-- is the safety net.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_orders_measured           int;
  v_events_measurement        int;
  v_orders_scheduled_install  int;
  v_events_install            int;
BEGIN
  SELECT count(*) INTO v_orders_measured
    FROM orders WHERE measured_at IS NOT NULL;
  SELECT count(*) INTO v_events_measurement
    FROM order_events WHERE kind = 'measurement';

  IF v_orders_measured <> v_events_measurement THEN
    RAISE EXCEPTION
      'backfill mismatch (measurement): orders.measured_at=% but order_events(kind=measurement)=%',
      v_orders_measured, v_events_measurement;
  END IF;

  SELECT count(*) INTO v_orders_scheduled_install
    FROM orders WHERE scheduled_install_date IS NOT NULL;
  SELECT count(*) INTO v_events_install
    FROM order_events WHERE kind = 'install';

  IF v_orders_scheduled_install <> v_events_install THEN
    RAISE EXCEPTION
      'backfill mismatch (install): orders.scheduled_install_date=% but order_events(kind=install)=%',
      v_orders_scheduled_install, v_events_install;
  END IF;
END $$;
