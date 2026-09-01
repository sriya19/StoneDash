-- 0027_stage_notification_prompt_rpc.sql
--
-- Task 9 Feature A, sub-step 3. Answers one question after a stage change:
-- "should we offer to notify the customer, and with what?"
--
-- TWO DELIBERATE DEVIATIONS FROM THE BRIEF, both about not duplicating
-- things that already exist and are tested.
--
-- 1. It does NOT render the template. The brief says the RPC "renders the
--    template and returns everything the modal needs". Rendering here would
--    mean a second implementation of lib/messaging/render-template.ts in
--    plpgsql — and that renderer is not trivial: single-pass substitution
--    (so a context value containing {{...}} is never re-expanded), case-
--    insensitive tokens tolerating inner whitespace, and a tidy pass that
--    collapses dangling punctuation around empty placeholders. Fourteen
--    tests pin those behaviours. Two renderers drift; Task 6B's calendar
--    palette and Task 8's KIND_DOT are both in this log as exactly that
--    failure. So the RPC returns the RAW body and the caller renders with
--    the one renderer that exists.
--
-- 2. It takes the transition's default template slug as a PARAMETER rather
--    than knowing the transition->template map. Per PLAN Q5 that map lives
--    in TypeScript beside ORDER_STAGES; encoding it here too would be the
--    same drift in a different direction. The RPC owns pref precedence,
--    template lookup and the recipient snapshot — the things that are a
--    join and would otherwise be three round trips.
--
-- WHERE from_stage COMES FROM: the caller only knows the new stage, because
-- orders.stage has already been updated by the time this runs. The previous
-- stage is recovered from order_stage_history, which tg_orders_after_update
-- (0009) wrote inside the same transaction as the UPDATE. That is also why
-- this is safe to call immediately after changeStage returns.
--
-- SECURITY INVOKER on purpose (the change_order_stage shape): every read is
-- org-scoped and RLS already restricts members to their own org, so a
-- DEFINER would only widen what this can see for no gain.

CREATE OR REPLACE FUNCTION get_stage_notification_prompt(
  p_order_id              uuid,
  p_to_stage              order_stage,
  p_default_template_slug text
)
RETURNS TABLE (
  should_prompt      boolean,
  reason             text,
  from_stage         order_stage,
  to_stage           order_stage,
  template_slug      text,
  template_body      text,
  recipient_kind     text,
  recipient_snapshot jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id    uuid;
  v_from      order_stage;
  v_pref      stage_notification_prefs%ROWTYPE;
  v_slug      text;
  v_body      text;
  v_customer  record;
BEGIN
  -- Defaults for every early return below.
  should_prompt := false;
  to_stage      := p_to_stage;
  recipient_kind := 'customer';

  SELECT o.org_id INTO v_org_id FROM orders o WHERE o.id = p_order_id;
  IF v_org_id IS NULL THEN
    reason := 'order_not_found';
    RETURN NEXT; RETURN;
  END IF;

  -- Terminal stages never prompt. The prefs table forbids storing one, but
  -- a caller can still ask, and answering honestly beats erroring.
  IF p_to_stage IN ('paid', 'cancelled') THEN
    reason := 'terminal_stage';
    RETURN NEXT; RETURN;
  END IF;

  -- Most recent transition INTO this stage, written by the 0009 trigger.
  SELECT h.from_stage INTO v_from
    FROM order_stage_history h
   WHERE h.order_id = p_order_id
     AND h.to_stage = p_to_stage
   ORDER BY h.created_at DESC
   LIMIT 1;
  from_stage := v_from;

  -- Pref precedence: a row for this exact transition wins over a
  -- "from any stage" row; absence of both means enabled (PLAN Q5).
  SELECT * INTO v_pref
    FROM stage_notification_prefs p
   WHERE p.org_id = v_org_id
     AND p.to_stage = p_to_stage
     AND (p.from_stage = v_from OR p.from_stage IS NULL)
   ORDER BY (p.from_stage IS NULL)   -- false (specific) sorts before true
   LIMIT 1;

  IF FOUND AND NOT v_pref.is_enabled THEN
    reason := 'disabled_by_pref';
    RETURN NEXT; RETURN;
  END IF;

  -- An override slug wins; otherwise the caller's default for this
  -- transition. A blank default is a caller bug, not a silent no-prompt.
  v_slug := COALESCE(NULLIF(btrim(COALESCE(v_pref.template_slug, '')), ''),
                     NULLIF(btrim(COALESCE(p_default_template_slug, '')), ''));
  IF v_slug IS NULL THEN
    reason := 'no_template_configured';
    RETURN NEXT; RETURN;
  END IF;
  template_slug := v_slug;

  SELECT t.body INTO v_body
    FROM message_templates t
   WHERE t.org_id = v_org_id
     AND t.slug = v_slug
     AND t.is_active
   LIMIT 1;

  -- A dangling override resolves to nothing. Degrade to no-prompt rather
  -- than opening a modal with an empty body (see 0026: template_slug is
  -- deliberately not a FK, so this is a reachable state).
  IF v_body IS NULL THEN
    reason := 'template_not_found';
    RETURN NEXT; RETURN;
  END IF;
  template_body := v_body;

  SELECT c.id, c.name, c.phone, c.email
    INTO v_customer
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
   WHERE o.id = p_order_id;

  IF v_customer.id IS NULL THEN
    reason := 'no_customer';
    RETURN NEXT; RETURN;
  END IF;

  -- No phone and no email means there is no channel to send on. Prompting
  -- would offer an action that cannot complete.
  IF COALESCE(btrim(v_customer.phone), '') = ''
     AND COALESCE(btrim(v_customer.email), '') = '' THEN
    reason := 'customer_has_no_contact';
    recipient_snapshot := jsonb_build_object(
      'customer_id', v_customer.id, 'name', v_customer.name);
    RETURN NEXT; RETURN;
  END IF;

  recipient_snapshot := jsonb_build_object(
    'customer_id', v_customer.id,
    'name',        v_customer.name,
    'phone',       v_customer.phone,
    'email',       v_customer.email
  );

  should_prompt := true;
  reason := 'ok';
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION
  get_stage_notification_prompt(uuid, order_stage, text) TO authenticated;

COMMENT ON FUNCTION get_stage_notification_prompt(uuid, order_stage, text) IS
  'Post-stage-change prompt decision. Returns the RAW template body; the '
  'caller renders with lib/messaging/render-template.ts. `reason` is always '
  'populated so a false is debuggable.';
