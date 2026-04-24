-- 0012_contractor_payment_rpc.sql
--
-- RPC-only write path for contractor_payments and contractor_payment_allocations.
-- Direct INSERT/UPDATE/DELETE on both tables is revoked and RLS-blocked in
-- 0011; these functions are the single entry point.
--
-- Why SECURITY DEFINER here (not SECURITY INVOKER like change_order_stage):
-- we bypass the WITH CHECK (false) policies so the actual write can land.
-- Because we bypass RLS, we MUST do the auth check ourselves — same shape
-- as `is_org_member(org_id)` + `org_role(org_id) IN (...)`. auth.uid() is
-- the caller, not the function owner.
--
-- Sum invariant: sum(allocations.amount) must equal payment.amount. Both
-- columns are numeric(12,2) so we compare with an exact-equality ROUND to
-- two decimal places (no float tolerance).
--
-- Audit: activity_log is written by the AFTER INSERT / AFTER DELETE
-- triggers defined in 0011. We do not insert into activity_log manually —
-- the triggers fire inside this function's transaction, so every row is
-- audited atomically with the mutation.

-- ===========================================================================
-- Shared helper: validate + insert allocations for a payment.
-- Extracted so record/update share identical allocation logic.
-- ===========================================================================

CREATE OR REPLACE FUNCTION _insert_contractor_allocations(
  p_payment_id    uuid,
  p_contractor_id uuid,
  p_org_id        uuid,
  p_amount        numeric,
  p_allocations   jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sum    numeric;
  v_count  integer;
BEGIN
  IF jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'allocations must be a JSON array' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_allocations);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'at least one allocation is required' USING ERRCODE = '22023';
  END IF;

  -- Sum check (exact at 2dp — both sides are numeric(12,2)).
  SELECT SUM(((elem ->> 'amount')::numeric))
    INTO v_sum
    FROM jsonb_array_elements(p_allocations) AS elem;

  IF v_sum IS NULL OR ROUND(v_sum, 2) <> ROUND(p_amount, 2) THEN
    RAISE EXCEPTION 'allocation sum (%) does not equal payment amount (%)',
      COALESCE(v_sum, 0), p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every allocation must name a positive amount and an order that
  -- belongs to this contractor in this org.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_allocations) AS elem
     WHERE (elem ->> 'amount')::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'every allocation amount must be > 0' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_allocations) AS elem
     WHERE NOT EXISTS (
       SELECT 1 FROM orders o
        WHERE o.id = (elem ->> 'order_id')::uuid
          AND o.contractor_id = p_contractor_id
          AND o.org_id = p_org_id
     )
  ) THEN
    RAISE EXCEPTION
      'one or more allocation order_ids do not belong to this contractor'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- All-or-nothing insert. UNIQUE(payment_id, order_id) enforces that a
  -- single payment can't allocate to the same order twice.
  INSERT INTO contractor_payment_allocations (payment_id, order_id, amount)
  SELECT
    p_payment_id,
    (elem ->> 'order_id')::uuid,
    (elem ->> 'amount')::numeric
  FROM jsonb_array_elements(p_allocations) AS elem;
END;
$$;

REVOKE EXECUTE ON FUNCTION _insert_contractor_allocations(uuid, uuid, uuid, numeric, jsonb) FROM PUBLIC;

-- ===========================================================================
-- record_contractor_payment
-- ===========================================================================

CREATE OR REPLACE FUNCTION record_contractor_payment(
  p_contractor_id uuid,
  p_amount        numeric,
  p_received_on   date,
  p_method        text,
  p_reference     text,
  p_notes         text,
  p_allocations   jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_org_id     uuid;
  v_payment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0' USING ERRCODE = 'check_violation';
  END IF;

  SELECT org_id INTO v_org_id
    FROM contractors
   WHERE id = p_contractor_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'contractor not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of contractor org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to record payments' USING ERRCODE = '42501';
  END IF;

  INSERT INTO contractor_payments
    (org_id, contractor_id, amount, received_on, method, reference, notes, created_by)
  VALUES
    (v_org_id, p_contractor_id, p_amount, p_received_on, p_method, p_reference, p_notes, v_actor)
  RETURNING id INTO v_payment_id;

  PERFORM _insert_contractor_allocations(
    v_payment_id, p_contractor_id, v_org_id, p_amount, p_allocations
  );

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION record_contractor_payment(uuid, numeric, date, text, text, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- update_contractor_payment
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_contractor_payment(
  p_payment_id  uuid,
  p_amount      numeric,
  p_received_on date,
  p_method      text,
  p_reference   text,
  p_notes       text,
  p_allocations jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor         uuid := auth.uid();
  v_org_id        uuid;
  v_contractor_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0' USING ERRCODE = 'check_violation';
  END IF;

  SELECT org_id, contractor_id
    INTO v_org_id, v_contractor_id
    FROM contractor_payments
   WHERE id = p_payment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of payment org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to edit payments' USING ERRCODE = '42501';
  END IF;

  UPDATE contractor_payments
     SET amount      = p_amount,
         received_on = p_received_on,
         method      = p_method,
         reference   = p_reference,
         notes       = p_notes
   WHERE id = p_payment_id;

  -- Replace allocations atomically: delete all, validate + re-insert new.
  DELETE FROM contractor_payment_allocations WHERE payment_id = p_payment_id;

  PERFORM _insert_contractor_allocations(
    p_payment_id, v_contractor_id, v_org_id, p_amount, p_allocations
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_contractor_payment(uuid, numeric, date, text, text, text, jsonb)
  TO authenticated;

-- ===========================================================================
-- delete_contractor_payment
-- ===========================================================================

CREATE OR REPLACE FUNCTION delete_contractor_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id
    FROM contractor_payments
   WHERE id = p_payment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'not a member of payment org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to delete payments' USING ERRCODE = '42501';
  END IF;

  DELETE FROM contractor_payments WHERE id = p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_contractor_payment(uuid) TO authenticated;
