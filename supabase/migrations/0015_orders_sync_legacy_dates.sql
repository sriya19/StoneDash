-- 0015_orders_sync_legacy_dates.sql — bridge trigger for the Task 3 transition
--
-- 0013 backfilled order_events from orders.measured_at / scheduled_install_date
-- ONCE. After that, the New Order action (lib/actions/orders.ts) calls
-- create_order_event explicitly and does not write the legacy columns.
--
-- But the seed (supabase/seed.ts) still inserts orders with those columns
-- populated via Prisma (the path bypasses RLS and the app action). Without
-- a bridge, seeded orders would have legacy values but no events, and every
-- read path (which now sources from order_events) would show "—" for the
-- install date — a demo regression on every db:seed.
--
-- This trigger fires on INSERT into orders. If measured_at or
-- scheduled_install_date is set, it creates the matching event at the
-- org-local default time (9 AM measurement, 10 AM install).
--
-- Scope: INSERT only. Direct UPDATEs to the legacy columns do NOT propagate
-- to events — that path should always go through update_order_event. The
-- order detail sheet's date fields are read-only in this task to enforce it.
--
-- Lifecycle: when sub-step 3 updates the seed to call create_order_event
-- explicitly, this trigger becomes redundant for the seed path too. Leave
-- it in place as a safety net for ad-hoc DB writes; drop it (alongside the
-- legacy columns) in the future migration that retires the columns.

CREATE OR REPLACE FUNCTION tg_orders_after_insert_sync_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT timezone INTO v_tz FROM organizations WHERE id = NEW.org_id;
  IF v_tz IS NULL THEN v_tz := 'UTC'; END IF;

  IF NEW.measured_at IS NOT NULL THEN
    INSERT INTO order_events
      (org_id, order_id, kind, starts_at, duration_min, created_by)
    VALUES
      (NEW.org_id, NEW.id, 'measurement',
       ((NEW.measured_at::text || ' 09:00:00')::timestamp AT TIME ZONE v_tz),
       60, NEW.created_by);
  END IF;

  IF NEW.scheduled_install_date IS NOT NULL THEN
    INSERT INTO order_events
      (org_id, order_id, kind, starts_at, duration_min, created_by)
    VALUES
      (NEW.org_id, NEW.id, 'install',
       ((NEW.scheduled_install_date::text || ' 10:00:00')::timestamp AT TIME ZONE v_tz),
       180, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_after_insert_sync_dates
AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION tg_orders_after_insert_sync_dates();
