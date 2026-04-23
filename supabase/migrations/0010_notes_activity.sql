-- 0010_notes_activity.sql
--
-- Notes edits are their own audit event. Previously a notes change took
-- the generic `updated` path with the full before/after text in metadata
-- — noisy and a mild privacy concern. Now:
--
-- * notes-only change → action = 'notes_updated', metadata carries only
--   { order_number, length_before, length_after } (no text).
-- * stage change → 'stage_changed' (unchanged from 0009, still reads the
--   app.stage_change_note GUC).
-- * anything else (mixed updates, priority, dates, money, etc.) → the
--   existing 'updated' action with a field diff, BUT notes is excluded
--   from that diff so the full text never leaks even when bundled with
--   other edits.

CREATE OR REPLACE FUNCTION tg_orders_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_note  text;
  v_diff  jsonb;
  v_notes_changed boolean;
  v_other_changed boolean;
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    v_note := NULLIF(current_setting('app.stage_change_note', true), '');

    INSERT INTO order_stage_history (order_id, from_stage, to_stage, changed_by, note)
      VALUES (NEW.id, OLD.stage, NEW.stage, v_actor, v_note);

    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, v_actor, 'order', NEW.id, 'stage_changed',
        jsonb_build_object(
          'order_number', NEW.order_number,
          'from', OLD.stage,
          'to',   NEW.stage,
          'note', v_note
        )
      );
    RETURN NEW;
  END IF;

  v_notes_changed := NEW.notes IS DISTINCT FROM OLD.notes;

  -- Build a diff that always excludes `notes` (full text) and `updated_at`.
  SELECT jsonb_object_agg(key, jsonb_build_object('from', o_val, 'to', n_val))
    INTO v_diff
    FROM (
      SELECT o.key,
             o.value AS o_val,
             n.value AS n_val
        FROM jsonb_each(to_jsonb(OLD)) o
        JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
       WHERE o.value IS DISTINCT FROM n.value
         AND o.key NOT IN ('updated_at', 'notes')
    ) changed;

  v_other_changed := v_diff IS NOT NULL;

  IF v_notes_changed THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, v_actor, 'order', NEW.id, 'notes_updated',
        jsonb_build_object(
          'order_number',  NEW.order_number,
          'length_before', coalesce(length(OLD.notes), 0),
          'length_after',  coalesce(length(NEW.notes), 0)
        )
      );
  END IF;

  IF v_other_changed THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, v_actor, 'order', NEW.id, 'updated',
        jsonb_build_object(
          'order_number', NEW.order_number,
          'changed',      v_diff
        )
      );
  END IF;

  RETURN NEW;
END;
$$;
