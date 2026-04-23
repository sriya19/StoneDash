-- 0006_cascade_audit_fix.sql
--
-- Fixes two related problems surfaced by the first `pnpm db:seed` run:
--
-- ISSUE 1 (the visible bug).
-- The AFTER DELETE audit triggers defined in 0005_storage_policies.sql on
-- `orders`, `customers`, and `order_attachments` insert a 'deleted' row
-- into `activity_log`, re-using `OLD.org_id`. When an organization is
-- cascade-deleted, those triggers fire for every child row, but by the
-- time the INSERT runs Postgres has already marked the parent
-- organizations row as gone — so the INSERT violates
-- `activity_log_org_id_fkey`. The constraint itself is correct; the trigger
-- is the problem.
-- Fix: guard each audit INSERT with `IF NOT EXISTS (SELECT 1 FROM
-- organizations ...)`. Normal single-entity deletes still record a
-- 'deleted' activity row; cascade deletes quietly skip the audit (the org
-- and its activity_log are being wiped anyway).
--
-- ISSUE 2 (answering the cascade question).
-- `activity_log` stores the audit trail polymorphically (entity_type +
-- entity_id), so it has no FK to `orders`, `customers`, or
-- `order_attachments`. Individually deleting an order therefore leaves
-- its prior activity rows as dangling references. We add BEFORE DELETE
-- cleanup triggers that remove matching activity rows. With both the
-- BEFORE cleanup and the (guarded) AFTER audit in place, an individual
-- order delete leaves exactly one trailing 'deleted' activity row; an
-- org-wide cascade leaves nothing.

-- ===========================================================================
-- Guarded AFTER DELETE audit triggers
-- ===========================================================================

CREATE OR REPLACE FUNCTION tg_orders_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'order', OLD.id, 'deleted',
      jsonb_build_object(
        'order_number', OLD.order_number,
        'project_name', OLD.project_name
      )
    );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION tg_customers_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'customer', OLD.id, 'deleted',
      jsonb_build_object('name', OLD.name)
    );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION tg_attachments_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'attachment', OLD.id, 'deleted',
      jsonb_build_object(
        'order_id',      OLD.order_id,
        'original_name', OLD.original_name
      )
    );
  RETURN OLD;
END;
$$;

-- ===========================================================================
-- BEFORE DELETE polymorphic cleanup (activity_log has no FK to these)
-- ===========================================================================

CREATE OR REPLACE FUNCTION tg_orders_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'order' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS orders_before_delete_cleanup ON orders;
CREATE TRIGGER orders_before_delete_cleanup
BEFORE DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION tg_orders_before_delete_cleanup();

CREATE OR REPLACE FUNCTION tg_customers_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'customer' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS customers_before_delete_cleanup ON customers;
CREATE TRIGGER customers_before_delete_cleanup
BEFORE DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION tg_customers_before_delete_cleanup();

CREATE OR REPLACE FUNCTION tg_attachments_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'attachment' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS attachments_before_delete_cleanup ON order_attachments;
CREATE TRIGGER attachments_before_delete_cleanup
BEFORE DELETE ON order_attachments
FOR EACH ROW EXECUTE FUNCTION tg_attachments_before_delete_cleanup();
