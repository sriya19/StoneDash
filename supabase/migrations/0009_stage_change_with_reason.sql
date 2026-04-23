-- 0009_stage_change_with_reason.sql
--
-- Adds a required "reason" to every stage change. Real-world: customers
-- reschedule installs, slabs crack, a quote flips back to measurement —
-- stage moves go both directions and we want every transition traceable.
--
-- How the reason flows from the app to the DB:
--   * App calls the new RPC change_order_stage(p_order_id, p_to_stage, p_note).
--   * The RPC sets a transaction-local session GUC `app.stage_change_note`
--     via set_config(..., true).
--   * The existing AFTER UPDATE audit trigger now reads that GUC and writes
--     the note into order_stage_history.note and activity_log.metadata.note.
--
-- The GUC is scoped to the transaction (set_config's third arg is true), so
-- nothing leaks across requests. The trigger still fires on any direct
-- `UPDATE orders SET stage = …` path — the note is just NULL in that case,
-- which matches the pre-2A behaviour.

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
  ELSE
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

-- RPC the app calls to move a stage with a reason. SECURITY INVOKER so the
-- UPDATE runs under the caller's RLS — if they can't write the order they
-- can't move its stage either.
CREATE OR REPLACE FUNCTION change_order_stage(
  p_order_id uuid,
  p_to_stage order_stage,
  p_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_note IS NULL OR length(btrim(p_note)) < 3 THEN
    RAISE EXCEPTION 'stage change reason must be at least 3 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Transaction-local: the GUC disappears at commit or rollback.
  PERFORM set_config('app.stage_change_note', p_note, true);

  UPDATE orders
     SET stage = p_to_stage
   WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION change_order_stage(uuid, order_stage, text) TO authenticated;
