-- 0018_extractions.sql — AI document extraction + reminders (Task 5)
--
-- Two new tables and two org-scoped settings columns:
--
--   file_extractions            one row per order_attachments file;
--                               owns the classification result, the
--                               structured fields, review status, and
--                               the cost / audit metadata.
--   reminders                   future-dated per-user reminders. Bell
--                               icon in the topbar + /reminders page
--                               read from this; extractions of
--                               licenses / insurance / invoices write
--                               rows here on confirm.
--   organizations.ai_auto_extract      (default true)
--   organizations.ai_email_on_review   (default false — email is UI-
--                                       only until a later task ships
--                                       a real delivery mechanism)
--
-- RLS follows the existing patterns:
--   * SELECT gated on is_org_member() (org-wide read).
--   * INSERT / UPDATE / DELETE on file_extractions gated on
--     org_role() >= manager. Field role can SELECT but not mutate.
--   * reminders READ is user-scoped (only the user_id who is being
--     reminded, not the whole org — bell counts differ per user).
--     UPDATE (dismiss / complete) is also user-scoped. INSERT stays
--     manager+ so a field user can't manufacture reminders for
--     themselves. DELETE is manager+ or the reminder owner.
--
-- Audit triggers write activity_log entries for every mutation so the
-- activity feed can render extraction and reminder events alongside
-- everything else.

BEGIN;

-- ===========================================================================
-- organizations columns
-- ===========================================================================
--
-- Two org-scoped toggles. If ai_auto_extract is false, the upload path
-- still inserts an order_attachments row but skips the file_extractions
-- insert entirely — no chip, no processing. ai_email_on_review is UI-
-- only until Task 6+ wires up delivery; recorded here so the toggle
-- state persists.

ALTER TABLE organizations
  ADD COLUMN ai_auto_extract      boolean NOT NULL DEFAULT true,
  ADD COLUMN ai_email_on_review   boolean NOT NULL DEFAULT false;

-- ===========================================================================
-- file_extractions
-- ===========================================================================

CREATE TABLE file_extractions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id           uuid NOT NULL REFERENCES order_attachments(id) ON DELETE CASCADE,
  document_type     text NOT NULL DEFAULT 'other'
    CHECK (document_type IN (
      'template', 'contract', 'invoice', 'license', 'insurance', 'other'
    )),
  status            text NOT NULL DEFAULT 'processing'
    CHECK (status IN (
      'processing', 'review', 'confirmed', 'declined', 'failed'
    )),
  raw_response      jsonb,
  extracted_fields  jsonb,
  confidence        text
    CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  applied_actions   jsonb,
  error_message     text,
  cost_cents        integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- One extraction row per file. Re-extract deletes + inserts.
  CONSTRAINT file_extractions_file_unique UNIQUE (file_id)
);

CREATE INDEX file_extractions_org_status_idx
  ON file_extractions (org_id, status);

CREATE INDEX file_extractions_org_created_idx
  ON file_extractions (org_id, created_at DESC);

CREATE TRIGGER file_extractions_set_updated_at
BEFORE UPDATE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- reminders
-- ===========================================================================

CREATE TABLE reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(trim(title)) > 0),
  body            text,
  remind_at       timestamptz NOT NULL,
  kind            text NOT NULL DEFAULT 'custom'
    CHECK (kind IN (
      'license_expiry', 'insurance_expiry', 'invoice_due', 'custom'
    )),
  source_type     text
    CHECK (source_type IS NULL OR source_type IN (
      'file_extraction', 'manual', 'contractor', 'order'
    )),
  source_id       uuid,
  -- Encoded at write time so the bell popover can render a "click me"
  -- link without reconstructing it from source_type + source_id at
  -- render time. Nullable — manual reminders may have no natural
  -- destination.
  link_url        text,
  dismissed_at    timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Bell popover query: "active reminders for me due now or earlier".
-- The partial index skips dismissed rows so busy shops with a long
-- reminder history stay fast.
CREATE INDEX reminders_user_active_idx
  ON reminders (user_id, remind_at)
  WHERE dismissed_at IS NULL;

-- Dashboard aggregate + /reminders page: "all reminders for this org".
CREATE INDEX reminders_org_active_idx
  ON reminders (org_id, remind_at)
  WHERE dismissed_at IS NULL;

-- ===========================================================================
-- RLS — file_extractions
-- ===========================================================================

ALTER TABLE file_extractions ENABLE ROW LEVEL SECURITY;

-- Org-wide SELECT. Field role can see extractions so the chip renders
-- on file cards, but can't confirm / decline / re-extract (manager+
-- gates on the mutations below).
CREATE POLICY file_extractions_select
  ON file_extractions FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY file_extractions_insert
  ON file_extractions FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY file_extractions_update
  ON file_extractions FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY file_extractions_delete
  ON file_extractions FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ===========================================================================
-- RLS — reminders
-- ===========================================================================

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Read is user-scoped: only the person who owns the reminder can see
-- it. Bell counts differ per user, and one user's unreviewed license
-- expiry shouldn't leak into another user's popover.
CREATE POLICY reminders_select
  ON reminders FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND is_org_member(org_id));

-- Manager+ can write reminders for anyone in the org (the extraction
-- confirm flow needs this — a manager confirming a license extraction
-- creates a reminder for the org owner).
CREATE POLICY reminders_insert
  ON reminders FOR INSERT TO authenticated
  WITH CHECK (
    is_org_member(org_id)
    AND org_role(org_id) IN ('owner', 'admin', 'manager')
  );

-- Dismiss / complete: only the target user (they might not be a
-- manager but they still need to clear their own bell). No other
-- fields are mutable.
CREATE POLICY reminders_update
  ON reminders FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_org_member(org_id))
  WITH CHECK (user_id = auth.uid() AND is_org_member(org_id));

-- Delete: manager+ (housekeeping) or the target user (clearing their
-- own list).
CREATE POLICY reminders_delete
  ON reminders FOR DELETE TO authenticated
  USING (
    is_org_member(org_id)
    AND (
      user_id = auth.uid()
      OR org_role(org_id) IN ('owner', 'admin', 'manager')
    )
  );

-- ===========================================================================
-- Audit triggers — file_extractions
-- ===========================================================================
--
-- The activity feed learns three verbs: created (extraction row born,
-- usually via kickOffExtraction), status_changed (the interesting one
-- — moves through review / confirmed / declined / failed), and the
-- implicit "deleted" case from re-extract. Same SECURITY DEFINER
-- shape as the contractor audit triggers so RLS on activity_log
-- doesn't block them.

CREATE OR REPLACE FUNCTION tg_file_extractions_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id     uuid;
  v_file_name    text;
BEGIN
  SELECT order_id, original_name
    INTO v_order_id, v_file_name
    FROM order_attachments
    WHERE id = NEW.file_id;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      auth.uid(),
      'file_extraction',
      NEW.id,
      'created',
      jsonb_build_object(
        'file_id', NEW.file_id,
        'order_id', v_order_id,
        'file_name', v_file_name,
        'status', NEW.status
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_extractions_after_insert_audit
AFTER INSERT ON file_extractions
FOR EACH ROW EXECUTE FUNCTION tg_file_extractions_after_insert();

CREATE OR REPLACE FUNCTION tg_file_extractions_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id  uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT order_id INTO v_order_id
      FROM order_attachments
      WHERE id = NEW.file_id;

    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id,
        auth.uid(),
        'file_extraction',
        NEW.id,
        'status_changed',
        jsonb_build_object(
          'from', OLD.status,
          'to', NEW.status,
          'document_type', NEW.document_type,
          'file_id', NEW.file_id,
          'order_id', v_order_id
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_extractions_after_update_audit
AFTER UPDATE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION tg_file_extractions_after_update();

-- Cleanup on delete: remove the polymorphic activity_log rows that
-- point at this extraction. Same pattern the contractor tables use so
-- a re-extract (which deletes + re-inserts) doesn't leave orphaned
-- feed rows.
CREATE OR REPLACE FUNCTION tg_file_extractions_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'file_extraction' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER file_extractions_before_delete_cleanup
BEFORE DELETE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION tg_file_extractions_before_delete_cleanup();

-- ===========================================================================
-- Audit triggers — reminders
-- ===========================================================================
--
-- Reminders show up in the activity feed too — but only for CREATE
-- (someone scheduled a reminder for you). Dismiss / complete are
-- per-user chore actions and would drown the shop-wide feed if we
-- surfaced them.

CREATE OR REPLACE FUNCTION tg_reminders_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      auth.uid(),
      'reminder',
      NEW.id,
      'created',
      jsonb_build_object(
        'title', NEW.title,
        'remind_at', NEW.remind_at,
        'kind', NEW.kind,
        'target_user_id', NEW.user_id,
        'source_type', NEW.source_type,
        'source_id', NEW.source_id
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER reminders_after_insert_audit
AFTER INSERT ON reminders
FOR EACH ROW EXECUTE FUNCTION tg_reminders_after_insert();

CREATE OR REPLACE FUNCTION tg_reminders_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'reminder' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER reminders_before_delete_cleanup
BEFORE DELETE ON reminders
FOR EACH ROW EXECUTE FUNCTION tg_reminders_before_delete_cleanup();

COMMIT;
