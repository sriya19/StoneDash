-- 0024_apply_intake_impl.sql — Task 6C sub-step 10.
--
-- Fills in the apply_intake RPC that was scaffolded (empty body)
-- in migration 0022. Runs the selected proposal actions in
-- dependency order inside one Postgres txn:
--
--   1. customer:new  → INSERT customers, returns new id
--   2. order:new     → generate_order_number + INSERT orders,
--                       resolving customerRef via matched id OR
--                       the id from step 1
--   3. event:new     → create_order_event RPC, resolving orderRef
--   4. note:append   → append " [YYYY-MM-DD HH:MM] intake note"
--                       to orders.notes
--
-- Any failure at any step ROLLBACKs everything — the intake stays
-- in 'review' for retry.
--
-- Returns applied_actions JSONB shape:
--   [ { type, key, entity_id } ]
--
-- Client-side per-action edits arrive via p_edits keyed by action
-- key. The RPC pulls fields from p_edits, falling back to the
-- stored proposal for anything missing. Fields the client can
-- edit are whitelisted at the SQL level so a rogue client can't
-- smuggle rogue fields past the schema check.
--
-- User Q11 refinement lock: the activity_log entry written on
-- confirm carries metadata.summary as a rendered human-readable
-- sentence naming every entity created. Format:
--   "AI intake created customer NAME + order TM-1055 + event
--    EventKind Mon Jun 8 — from screenshot."

BEGIN;

CREATE OR REPLACE FUNCTION apply_intake(
  p_intake_id             uuid,
  p_edits                 jsonb,
  p_selected_action_keys  text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid := auth.uid();
  v_intake       ai_intake_events%ROWTYPE;
  v_proposal     jsonb;
  v_extraction   jsonb;
  v_selected     text[];
  v_action_key   text;
  v_customer_id  uuid;
  v_order_id     uuid;
  v_order_num    text;
  v_event_id     uuid;
  v_ctx          jsonb;
  v_matched_customer uuid;
  v_matched_order    uuid;
  v_edits        jsonb;
  v_action       jsonb;
  v_applied      jsonb := '[]'::jsonb;
  v_summary_parts text[] := ARRAY[]::text[];
  v_summary      text;
  v_new_customer_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Load intake row + extract inputs.
  SELECT * INTO v_intake FROM ai_intake_events WHERE id = p_intake_id;
  IF v_intake.id IS NULL THEN
    RAISE EXCEPTION 'intake not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_intake.org_id) THEN
    RAISE EXCEPTION 'not a member of intake org' USING ERRCODE = '42501';
  END IF;
  IF org_role(v_intake.org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to confirm intake'
      USING ERRCODE = '42501';
  END IF;

  IF v_intake.status <> 'review' THEN
    RAISE EXCEPTION 'intake not in review state (current: %)', v_intake.status
      USING ERRCODE = 'check_violation';
  END IF;

  v_proposal   := COALESCE(v_intake.proposal,   '{}'::jsonb);
  v_extraction := COALESCE(v_intake.extraction, '{}'::jsonb);
  v_edits      := COALESCE(p_edits,             '{}'::jsonb);
  v_selected   := COALESCE(p_selected_action_keys, ARRAY[]::text[]);

  -- Prefetch matched entity ids so orderRef / customerRef with
  -- kind='matched' resolve directly.
  v_matched_customer := NULLIF(
    (v_intake.matches -> 'matched_customer' ->> 'id'), ''
  )::uuid;
  v_matched_order := NULLIF(
    (v_intake.matches -> 'matched_order' ->> 'id'), ''
  )::uuid;

  -- ----------------------------------------------------------------
  -- Iterate the primary proposal actions in the order the dispatcher
  -- emitted them. That order IS the dependency order (customer →
  -- order → event → note), so we don't need to re-sort.
  -- ----------------------------------------------------------------

  FOR v_action IN
    SELECT jsonb_array_elements(COALESCE(v_proposal -> 'primary', '[]'::jsonb))
  LOOP
    v_action_key := v_action ->> 'key';

    -- Skip keys the user didn't check.
    IF NOT (v_action_key = ANY(v_selected)) THEN
      CONTINUE;
    END IF;

    CASE v_action ->> 'type'
      -- ---------- customer:new ----------
      WHEN 'create_customer' THEN
        v_new_customer_name := COALESCE(
          v_edits -> v_action_key ->> 'name',
          v_action ->> 'name'
        );
        INSERT INTO customers (
          org_id, name, phone, email, address_line1, created_by
        ) VALUES (
          v_intake.org_id,
          v_new_customer_name,
          NULLIF(COALESCE(v_edits -> v_action_key ->> 'phone', v_action ->> 'phone'), ''),
          NULLIF(COALESCE(v_edits -> v_action_key ->> 'email', v_action ->> 'email'), ''),
          NULLIF(COALESCE(v_edits -> v_action_key ->> 'address', v_action ->> 'address'), ''),
          v_actor
        )
        RETURNING id INTO v_customer_id;

        v_applied := v_applied || jsonb_build_object(
          'type', 'create_customer',
          'key',  v_action_key,
          'entity_id', v_customer_id
        );
        v_summary_parts := v_summary_parts || format(
          'customer %s', v_new_customer_name
        );

      -- ---------- order:new ----------
      WHEN 'create_order' THEN
        -- Resolve customerRef.
        DECLARE
          v_ref_kind text := v_action -> 'customerRef' ->> 'kind';
          v_ref_id   uuid;
          v_stage    text;
        BEGIN
          IF v_ref_kind = 'matched' THEN
            v_ref_id := NULLIF(v_action -> 'customerRef' ->> 'id', '')::uuid;
          ELSE
            -- kind='new' — points at customer:new action. Fall back
            -- to matched_customer if the user unchecked customer:new
            -- but kept order:new.
            v_ref_id := COALESCE(v_customer_id, v_matched_customer);
          END IF;
          IF v_ref_id IS NULL THEN
            RAISE EXCEPTION 'order:new needs a resolvable customer'
              USING ERRCODE = 'check_violation';
          END IF;

          v_order_num := generate_order_number(v_intake.org_id);
          v_stage := COALESCE(v_action ->> 'stage', 'quote');

          INSERT INTO orders (
            org_id, order_number, customer_id, project_name,
            stone_type, stage, notes, created_by
          ) VALUES (
            v_intake.org_id,
            v_order_num,
            v_ref_id,
            COALESCE(v_edits -> v_action_key ->> 'projectName', v_action ->> 'projectName'),
            NULLIF(COALESCE(v_edits -> v_action_key ->> 'stoneType', v_action ->> 'stoneType'), ''),
            v_stage::order_stage,
            NULLIF(COALESCE(v_edits -> v_action_key ->> 'notes', v_action ->> 'notes'), ''),
            v_actor
          )
          RETURNING id INTO v_order_id;

          v_applied := v_applied || jsonb_build_object(
            'type', 'create_order',
            'key',  v_action_key,
            'entity_id', v_order_id,
            'order_number', v_order_num
          );
          v_summary_parts := v_summary_parts || format(
            'order %s (%s)',
            v_order_num,
            COALESCE(v_edits -> v_action_key ->> 'projectName', v_action ->> 'projectName')
          );
        END;

      -- ---------- event:new ----------
      WHEN 'create_event' THEN
        DECLARE
          v_ref_kind    text := v_action -> 'orderRef' ->> 'kind';
          v_ref_id      uuid;
          v_kind        text;
          v_starts_at   timestamptz;
          v_duration    int;
          v_starts_str  text;
        BEGIN
          IF v_ref_kind = 'matched' THEN
            v_ref_id := NULLIF(v_action -> 'orderRef' ->> 'id', '')::uuid;
          ELSE
            v_ref_id := COALESCE(v_order_id, v_matched_order);
          END IF;
          IF v_ref_id IS NULL THEN
            RAISE EXCEPTION 'event:new needs a resolvable order'
              USING ERRCODE = 'check_violation';
          END IF;

          v_kind := COALESCE(v_edits -> v_action_key ->> 'kind', v_action ->> 'kind');
          v_starts_str := COALESCE(
            v_edits -> v_action_key ->> 'startsAtIso',
            v_action ->> 'startsAtIso'
          );
          -- yyyy-MM-ddTHH:mm:ss (local, org tz). We interpret as
          -- UTC-like here — the dispatcher already produced 9am
          -- local; when apply differs from schedule by an hour or
          -- so due to tz drift, the reviewer can edit before
          -- confirm.
          v_starts_at := (v_starts_str)::timestamptz;
          v_duration := COALESCE(
            (v_edits -> v_action_key ->> 'durationMin')::int,
            (v_action ->> 'durationMin')::int,
            60
          );

          -- Reuse the existing create_order_event RPC — same shape
          -- the manual dialog uses. Assignments empty; user can
          -- add crew on the calendar afterward.
          v_event_id := create_order_event(
            v_ref_id,
            v_kind,
            v_starts_at,
            v_duration,
            NULLIF(COALESCE(v_edits -> v_action_key ->> 'locationText',
                            v_action ->> 'locationText'), ''),
            NULLIF(COALESCE(v_edits -> v_action_key ->> 'notes',
                            v_action ->> 'notes'), ''),
            '[]'::jsonb,
            NULL,      -- p_title (order-tied events don't need it)
            false,     -- p_is_all_day
            NULL       -- p_color (fall through to kind default)
          );

          v_applied := v_applied || jsonb_build_object(
            'type', 'create_event',
            'key',  v_action_key,
            'entity_id', v_event_id
          );
          v_summary_parts := v_summary_parts || format(
            'event %s %s',
            v_kind,
            to_char(v_starts_at, 'Dy Mon FMDD')
          );
        END;

      -- ---------- note:append ----------
      WHEN 'append_note' THEN
        DECLARE
          v_ref_kind text := v_action -> 'orderRef' ->> 'kind';
          v_ref_id   uuid;
          v_body     text;
        BEGIN
          IF v_ref_kind = 'matched' THEN
            v_ref_id := NULLIF(v_action -> 'orderRef' ->> 'id', '')::uuid;
          ELSE
            v_ref_id := COALESCE(v_order_id, v_matched_order);
          END IF;
          IF v_ref_id IS NULL THEN
            RAISE EXCEPTION 'note:append needs a resolvable order'
              USING ERRCODE = 'check_violation';
          END IF;

          v_body := COALESCE(v_edits -> v_action_key ->> 'body', v_action ->> 'body');

          -- Append instead of replace. Prefix a timestamp so the
          -- reviewer's context is preserved even after other edits.
          UPDATE orders
             SET notes = CASE
                   WHEN notes IS NULL OR length(trim(notes)) = 0
                     THEN format('[%s] %s',
                                 to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
                                 v_body)
                   ELSE notes || E'\n\n[' ||
                        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') ||
                        '] ' || v_body
                 END,
                 updated_at = now()
           WHERE id = v_ref_id;

          v_applied := v_applied || jsonb_build_object(
            'type', 'append_note',
            'key',  v_action_key,
            'entity_id', v_ref_id
          );
        END;

      WHEN 'no_op' THEN
        -- Nothing to do; still record so the audit trail shows the
        -- user reviewed + confirmed a "no-action" intake.
        v_applied := v_applied || jsonb_build_object(
          'type', 'no_op', 'key', v_action_key
        );

      ELSE
        -- Unknown action type — reject rather than silently skip.
        -- Belt-and-suspenders vs. rogue clients smuggling novel
        -- action types past the client-side check.
        RAISE EXCEPTION 'unknown action type: %', v_action ->> 'type'
          USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;

  -- Flip status to confirmed + record applied.
  UPDATE ai_intake_events
     SET status          = 'confirmed',
         applied_actions = v_applied,
         reviewed_by     = v_actor,
         reviewed_at     = now(),
         updated_at      = now()
   WHERE id = p_intake_id;

  -- Q11 refinement — human-readable summary in metadata.summary.
  v_summary := 'AI intake';
  IF array_length(v_summary_parts, 1) IS NOT NULL THEN
    v_summary := v_summary || ' created ' ||
                 array_to_string(v_summary_parts, ' + ') ||
                 ' — from screenshot.';
  ELSE
    v_summary := v_summary || ' reviewed with no writes.';
  END IF;

  v_ctx := jsonb_build_object(
    'via',     'ai_intake',
    'summary', v_summary,
    'applied', v_applied
  );

  INSERT INTO activity_log (
    org_id, actor_id, entity_type, entity_id, action, metadata
  ) VALUES (
    v_intake.org_id,
    v_actor,
    'ai_intake',
    p_intake_id,
    'applied',
    v_ctx
  );

  RETURN v_applied;
END;
$$;

-- Signature is unchanged from the sub-step 4 scaffold; GRANT was
-- already applied. Re-issuing here so a repeated push is idempotent.
GRANT EXECUTE ON FUNCTION apply_intake(uuid, jsonb, text[]) TO authenticated;

COMMIT;
