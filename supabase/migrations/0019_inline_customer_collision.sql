-- 0019_inline_customer_collision.sql — Task 6A
--
-- Two pieces:
--   1. A unique partial index on (org_id, lower(name),
--      digits_only(phone)) so two concurrent inline-customer-create
--      flows can't succeed with the same customer. Postgres isolation
--      is READ COMMITTED, so a "check-then-insert" in the app can
--      race; the unique constraint is the last line of defense.
--   2. A SECURITY DEFINER `find_customer_collision` helper the RPC
--      (also here) uses to look up whether the proposed inline
--      customer would collide with an existing row. Returns the
--      colliding id or NULL.
--   3. `create_customer_and_order` SECURITY DEFINER RPC: single
--      Postgres txn that resolves customer (either existing id or
--      inline-create with collision check) + inserts the order.
--      Called from the `createOrder` server action's inline-customer
--      branch. If the collision check finds a match, the RPC RAISEs
--      with SQLSTATE = 'CST01' (our sentinel) and the message
--      contains the colliding row's id — the app parses that and
--      surfaces the "This looks like [name] — use them instead?"
--      banner.

BEGIN;

-- ===========================================================================
-- digits_only(phone) — used by the index + the collision helper.
-- ===========================================================================
--
-- IMMUTABLE so it's index-safe. Strips everything that isn't 0-9,
-- collapsing "+1 (555) 123-4567" → "15551234567" and "5551234567"
-- → "5551234567" — the two are still distinct (different real
-- numbers with different country codes), which is right; we don't
-- want to lie about US-only assumptions in the collision detector.

CREATE OR REPLACE FUNCTION digits_only(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(regexp_replace(input, '[^0-9]', '', 'g'), '')
$$;

-- ===========================================================================
-- Partial unique index — the safety net for the collision RPC.
-- ===========================================================================
--
-- Partial: skip rows where the phone is NULL or empty. Customers
-- created manually via /customers today can have NULL phones; we
-- don't want to reject a new inline customer with a valid phone
-- just because someone once added a phone-less customer with the
-- same name. Only inline-created customers have both a required
-- name AND a required phone, so the index is meaningful precisely
-- for the population it protects.

CREATE UNIQUE INDEX customers_org_name_phone_unique
  ON customers (org_id, lower(name), digits_only(phone))
  WHERE phone IS NOT NULL AND phone <> '';

-- ===========================================================================
-- find_customer_collision — used inside the RPC AND callable from
-- the client so the review-sheet's collision banner can pre-empt
-- the RPC round-trip. Returns the first colliding row id (NULL if
-- no collision).
-- ===========================================================================

CREATE OR REPLACE FUNCTION find_customer_collision(
  p_org_id uuid,
  p_name   text,
  p_phone  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_phone IS NULL OR length(trim(p_phone)) < 4 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM customers
    WHERE org_id = p_org_id
      AND lower(name) = lower(trim(p_name))
      AND digits_only(phone) = digits_only(p_phone)
      AND phone IS NOT NULL AND phone <> ''
    LIMIT 1;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION find_customer_collision(uuid, text, text)
  TO authenticated;

-- ===========================================================================
-- create_customer_and_order — one Postgres txn wrapping customer +
-- order INSERTs. Called by the createOrder server action's
-- inline-customer branch (the existing-customer path stays a plain
-- INSERT).
-- ===========================================================================
--
-- The order side does NOT include the eventing (measurement /
-- install events) — those still fire from the server action via
-- create_order_event RPCs after this returns. Rationale: an event
-- creation failure shouldn't roll back the order (matches the
-- existing behavior; PLAN sub-step 1 DEVLOG covers the asymmetry).
--
-- Payload shape uses JSONB so we don't have to change the RPC
-- signature every time a new order column lands. The RPC pulls
-- the values it needs and ignores anything else — belt and
-- suspenders against future-column-added drift.

CREATE OR REPLACE FUNCTION create_customer_and_order(
  p_customer jsonb,  -- { name, phone, company, email, city, state }
  p_order    jsonb   -- { project_name, stone_type, edge_profile, sink_cutouts, ... }
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor        uuid := auth.uid();
  v_org_id       uuid;
  v_customer_id  uuid;
  v_order_id     uuid;
  v_order_number text;
  v_collision    uuid;

  v_name  text := trim(p_customer ->> 'name');
  v_phone text := trim(p_customer ->> 'phone');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT active_org_id INTO v_org_id FROM profiles WHERE id = v_actor;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'no active org' USING ERRCODE = '42501';
  END IF;

  IF org_role(v_org_id) NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'insufficient role to create orders'
      USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR length(v_name) = 0 THEN
    RAISE EXCEPTION 'customer name is required' USING ERRCODE = '23514';
  END IF;
  IF v_phone IS NULL OR length(v_phone) < 4 THEN
    RAISE EXCEPTION 'customer phone is required' USING ERRCODE = '23514';
  END IF;

  -- Collision check first, so we can RAISE a distinctive sentinel
  -- before the INSERT would trip the unique index. The unique index
  -- is still there as the race-condition safety net.
  v_collision := find_customer_collision(v_org_id, v_name, v_phone);
  IF v_collision IS NOT NULL THEN
    -- SQLSTATE 'CST01' is our sentinel; the app parses the DETAIL to
    -- find the colliding id. Postgres error codes in the 'C' family
    -- are reserved for user-defined categories per the spec.
    RAISE EXCEPTION 'customer collision'
      USING ERRCODE = 'CST01',
            DETAIL  = 'colliding_customer_id=' || v_collision::text,
            HINT    = 'Use the existing customer instead of creating a duplicate.';
  END IF;

  INSERT INTO customers (
    org_id, name, company, email, phone, city, state, created_by
  ) VALUES (
    v_org_id,
    v_name,
    NULLIF(trim(p_customer ->> 'company'), ''),
    NULLIF(trim(p_customer ->> 'email'),   ''),
    v_phone,
    NULLIF(trim(p_customer ->> 'city'),    ''),
    NULLIF(trim(p_customer ->> 'state'),   ''),
    v_actor
  )
  RETURNING id INTO v_customer_id;

  -- Generate the order number via the existing helper.
  v_order_number := generate_order_number(v_org_id);

  INSERT INTO orders (
    org_id, order_number, customer_id, contractor_id, project_name,
    stone_type, edge_profile, sink_cutouts, cooktop_cutouts,
    estimated_sqft, quote_amount, deposit_received,
    fabrication_start_date, priority, assigned_to, notes, created_by
  ) VALUES (
    v_org_id,
    v_order_number,
    v_customer_id,
    NULLIF(trim(p_order ->> 'contractor_id'), '')::uuid,
    trim(p_order ->> 'project_name'),
    NULLIF(trim(p_order ->> 'stone_type'),    ''),
    NULLIF(trim(p_order ->> 'edge_profile'),  ''),
    COALESCE((p_order ->> 'sink_cutouts')::int,   0),
    COALESCE((p_order ->> 'cooktop_cutouts')::int, 0),
    NULLIF(p_order ->> 'estimated_sqft', '')::numeric,
    NULLIF(p_order ->> 'quote_amount',    '')::numeric,
    COALESCE(NULLIF(p_order ->> 'deposit_received', '')::numeric, 0),
    NULLIF(p_order ->> 'fabrication_start_date', '')::date,
    COALESCE(p_order ->> 'priority', 'normal')::order_priority,
    NULLIF(trim(p_order ->> 'assigned_to'), '')::uuid,
    NULLIF(trim(p_order ->> 'notes'), ''),
    v_actor
  )
  RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_id', v_customer_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_customer_and_order(jsonb, jsonb)
  TO authenticated;

COMMIT;
