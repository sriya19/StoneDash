-- 0005_storage_policies.sql — Storage bucket + RLS, plus audit triggers.
--
-- Path convention in the 'order-files' bucket:
--     {org_id}/{order_id}/{uuid}-{filename}
-- The first path segment MUST be an org uuid the caller belongs to.
--
-- This migration also owns the audit-trail triggers (activity_log and
-- order_stage_history) because attachment uploads feed activity_log and
-- conceptually belong with the other audit plumbing.

-- ===========================================================================
-- order-files bucket
-- ===========================================================================

INSERT INTO storage.buckets (id, name, public)
  VALUES ('order-files', 'order-files', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage RLS — storage.objects already has RLS enabled by Supabase
CREATE POLICY "order_files_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'order-files'
    AND is_org_member(NULLIF((storage.foldername(name))[1], '')::uuid)
  );

CREATE POLICY "order_files_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'order-files'
    AND is_org_member(NULLIF((storage.foldername(name))[1], '')::uuid)
  );

CREATE POLICY "order_files_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'order-files'
    AND is_org_member(NULLIF((storage.foldername(name))[1], '')::uuid)
  );

CREATE POLICY "order_files_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'order-files'
    AND is_org_member(NULLIF((storage.foldername(name))[1], '')::uuid)
  );

-- ===========================================================================
-- Audit triggers
-- ---------------------------------------------------------------------------
-- Every mutation on orders / customers / order_attachments writes an
-- activity_log row in the same transaction. Stage transitions on orders
-- additionally write to order_stage_history.
--
-- All trigger functions are SECURITY DEFINER so they bypass RLS when writing
-- to activity_log / order_stage_history, whose INSERT paths are otherwise
-- closed. Actor is resolved via auth.uid() (falls back to the row's
-- created_by / uploaded_by when the caller is service-role, e.g. seed).
-- ===========================================================================

-- ---------- orders ----------

CREATE OR REPLACE FUNCTION tg_orders_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := COALESCE(NEW.created_by, auth.uid());
BEGIN
  INSERT INTO order_stage_history (order_id, from_stage, to_stage, changed_by)
    VALUES (NEW.id, NULL, NEW.stage, v_actor);

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      v_actor,
      'order',
      NEW.id,
      'created',
      jsonb_build_object(
        'order_number', NEW.order_number,
        'project_name', NEW.project_name,
        'stage', NEW.stage
      )
    );

  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_after_insert_audit
AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION tg_orders_after_insert();

CREATE OR REPLACE FUNCTION tg_orders_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_diff  jsonb;
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO order_stage_history (order_id, from_stage, to_stage, changed_by)
      VALUES (NEW.id, OLD.stage, NEW.stage, v_actor);

    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, v_actor, 'order', NEW.id, 'stage_changed',
        jsonb_build_object(
          'order_number', NEW.order_number,
          'from', OLD.stage,
          'to',   NEW.stage
        )
      );
  ELSE
    -- Any non-stage update: capture a compact diff of changed columns
    -- (excluding timestamp housekeeping) in metadata.
    SELECT jsonb_object_agg(key, jsonb_build_object('from', o_val, 'to', n_val))
      INTO v_diff
      FROM (
        SELECT o.key,
               o.value AS o_val,
               n.value AS n_val
          FROM jsonb_each(to_jsonb(OLD)) o
          JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
         WHERE o.value IS DISTINCT FROM n.value
           AND o.key NOT IN ('updated_at')
      ) changed;

    IF v_diff IS NOT NULL THEN
      INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
        VALUES (
          NEW.org_id, v_actor, 'order', NEW.id, 'updated',
          jsonb_build_object(
            'order_number', NEW.order_number,
            'changed',      v_diff
          )
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_after_update_audit
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION tg_orders_after_update();

CREATE OR REPLACE FUNCTION tg_orders_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

CREATE TRIGGER orders_after_delete_audit
AFTER DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION tg_orders_after_delete();

-- ---------- customers ----------

CREATE OR REPLACE FUNCTION tg_customers_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      COALESCE(NEW.created_by, auth.uid()),
      'customer',
      NEW.id,
      'created',
      jsonb_build_object('name', NEW.name, 'company', NEW.company)
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_after_insert_audit
AFTER INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION tg_customers_after_insert();

CREATE OR REPLACE FUNCTION tg_customers_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, auth.uid(), 'customer', NEW.id, 'updated',
        jsonb_build_object('name', NEW.name)
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_after_update_audit
AFTER UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION tg_customers_after_update();

CREATE OR REPLACE FUNCTION tg_customers_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'customer', OLD.id, 'deleted',
      jsonb_build_object('name', OLD.name)
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER customers_after_delete_audit
AFTER DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION tg_customers_after_delete();

-- ---------- order_attachments ----------

CREATE OR REPLACE FUNCTION tg_attachments_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      COALESCE(NEW.uploaded_by, auth.uid()),
      'attachment',
      NEW.id,
      'uploaded',
      jsonb_build_object(
        'order_id',      NEW.order_id,
        'original_name', NEW.original_name,
        'kind',          NEW.kind,
        'size_bytes',    NEW.size_bytes
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER attachments_after_insert_audit
AFTER INSERT ON order_attachments
FOR EACH ROW EXECUTE FUNCTION tg_attachments_after_insert();

CREATE OR REPLACE FUNCTION tg_attachments_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

CREATE TRIGGER attachments_after_delete_audit
AFTER DELETE ON order_attachments
FOR EACH ROW EXECUTE FUNCTION tg_attachments_after_delete();
