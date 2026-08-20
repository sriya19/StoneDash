-- 0022_ai_intake.sql — Task 6C: AI screenshot intake pipeline.
--
-- Storage convention (documented; no SQL change needed — the
-- existing `order-files` bucket is reused):
--   {org_id}/intake/{intake_id}-{filename}     — screenshot at
--                                                 upload time.
--   {org_id}/{order_id}/{uuid}-{filename}      — copied here at
--                                                 confirm time.
-- Per PLAN Q12: the copy is a bucket-level server-side COPY (not
-- download-then-re-upload), and the intake keeps its own copy for
-- audit even after the confirm attaches a normal attachment to the
-- order.
--
-- Pieces:
--   1. ai_intake_events table + CHECK constraints + indexes.
--   2. RLS: org-wide SELECT (field can see the intake list),
--      manager+ INSERT (only manager+ can drop screenshots) and
--      UPDATE (only manager+ can confirm/discard).
--   3. Audit triggers on INSERT + status change + BEFORE DELETE
--      cleanup, mirroring the file_extractions pattern from Task 5.
--   4. Scaffold apply_intake SECURITY DEFINER RPC — empty body,
--      real implementation lands in sub-step 10. Landing the
--      stub now so the client action + server helper have a
--      stable signature to bind against.

BEGIN;

-- ===========================================================================
-- ai_intake_events
-- ===========================================================================

CREATE TABLE ai_intake_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_path      text NOT NULL,

  status            text NOT NULL DEFAULT 'processing'
    CHECK (status IN (
      'processing', 'review', 'confirmed', 'discarded', 'failed'
    )),

  -- Three JSONB payloads produced by the pipeline. All optional
  -- because a `processing` row lands with none set and each
  -- payload writes as the pipeline advances.
  extraction        jsonb,  -- Step A: GPT-4o vision extraction
  matches           jsonb,  -- Step B: fuzzy-match against org data
  proposal          jsonb,  -- Step C: deterministic action proposal

  applied_actions   jsonb,  -- Written by apply_intake on confirm
  error_message     text,
  cost_cents        integer CHECK (cost_cents IS NULL OR cost_cents >= 0),

  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_intake_events_org_status_idx
  ON ai_intake_events (org_id, status);

CREATE INDEX ai_intake_events_org_created_idx
  ON ai_intake_events (org_id, created_at DESC);

CREATE TRIGGER ai_intake_events_set_updated_at
BEFORE UPDATE ON ai_intake_events
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================

ALTER TABLE ai_intake_events ENABLE ROW LEVEL SECURITY;

-- Field-role users can SELECT the intake list (so a shop-floor
-- tech knows what's been dropped in the queue) but cannot INSERT
-- (upload) or UPDATE (confirm / discard). Mirrors Task 5's
-- extraction pattern one level stricter — Task 5 lets field
-- SELECT extractions on files they can see; here we let field
-- see the intake list but not participate.
CREATE POLICY ai_intake_events_select
  ON ai_intake_events FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY ai_intake_events_insert
  ON ai_intake_events FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY ai_intake_events_update
  ON ai_intake_events FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY ai_intake_events_delete
  ON ai_intake_events FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ===========================================================================
-- Audit triggers — activity_log entries on CREATE + status_changed
-- ===========================================================================
--
-- Same shape as file_extractions triggers in migration 0018. The
-- feed learns `ai_intake:created` / `ai_intake:status_changed`
-- verbs in sub-step 9 (in the activity feed phraseFor branch).

CREATE OR REPLACE FUNCTION tg_ai_intake_events_after_insert()
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
      'ai_intake',
      NEW.id,
      'created',
      jsonb_build_object(
        'storage_path', NEW.storage_path,
        'status',       NEW.status
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_intake_events_after_insert_audit
AFTER INSERT ON ai_intake_events
FOR EACH ROW EXECUTE FUNCTION tg_ai_intake_events_after_insert();

CREATE OR REPLACE FUNCTION tg_ai_intake_events_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id,
        auth.uid(),
        'ai_intake',
        NEW.id,
        'status_changed',
        jsonb_build_object(
          'from', OLD.status,
          'to',   NEW.status
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_intake_events_after_update_audit
AFTER UPDATE ON ai_intake_events
FOR EACH ROW EXECUTE FUNCTION tg_ai_intake_events_after_update();

-- BEFORE DELETE cleanup — same pattern as contractor / file_extraction
-- triggers so a delete doesn't leave orphaned polymorphic
-- activity_log rows pointing at nothing.
CREATE OR REPLACE FUNCTION tg_ai_intake_events_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'ai_intake' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER ai_intake_events_before_delete_cleanup
BEFORE DELETE ON ai_intake_events
FOR EACH ROW EXECUTE FUNCTION tg_ai_intake_events_before_delete_cleanup();

-- ===========================================================================
-- apply_intake — SECURITY DEFINER RPC scaffold
-- ===========================================================================
--
-- Empty body for now. Real implementation lands in sub-step 10:
--   * whitelist proposed action types (belt-and-suspenders; the
--     client already gates via checkbox, but the RPC re-validates
--     so a rogue client can't smuggle a novel action key);
--   * dependency-ordered writes (customer → order → event → note)
--     in one Postgres txn;
--   * server-side COPY of the screenshot from `{org}/intake/` to
--     the target order's attachment folder;
--   * single activity_log row with metadata.via='ai_intake' AND
--     metadata.summary (rendered human-readable sentence naming
--     every entity created — per user refinement to Q11);
--   * update the intake row: status='confirmed', applied_actions
--     JSONB, reviewed_by, reviewed_at.
--
-- Landing the stub now so sub-step 5's server action can bind to
-- a stable signature and be smoke-tested without waiting for
-- sub-step 10 to land the full implementation.

CREATE OR REPLACE FUNCTION apply_intake(
  p_intake_id   uuid,
  p_edits       jsonb,           -- user-edited action payloads
  p_selected_action_keys text[]  -- keys the user checked
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Sub-step 10 scaffold — real implementation lands there.
  RAISE EXCEPTION 'apply_intake not yet implemented'
    USING ERRCODE = '0A000';  -- feature_not_supported
END;
$$;

GRANT EXECUTE ON FUNCTION apply_intake(uuid, jsonb, text[]) TO authenticated;

COMMIT;
