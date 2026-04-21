-- 0003_order_number_fn.sql — Per-org order-number generation
--
-- Called from server actions (not from a default/trigger) so the new number
-- is available to the calling code for the success toast. Concurrency safety
-- comes from SELECT ... FOR UPDATE on the org_order_seq row.
--
-- Returned value: '{order_prefix}-{seq}' where seq is the greatest of:
--   * next_seq column on org_order_seq (grows by 1 per call)
--   * max integer suffix across existing orders in this org, +1
--   * organizations.order_seq_start
-- The last two guard against backfilled rows or a deleted org_order_seq row.

CREATE OR REPLACE FUNCTION generate_order_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefix      text;
  v_seq_start   integer;
  v_next        integer;
  v_existing    integer;
BEGIN
  SELECT order_prefix, order_seq_start
    INTO v_prefix, v_seq_start
    FROM organizations
    WHERE id = p_org_id;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'organization % not found', p_org_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- First call for this org: seed with order_seq_start
  INSERT INTO org_order_seq (org_id, next_seq)
    VALUES (p_org_id, v_seq_start)
    ON CONFLICT (org_id) DO NOTHING;

  -- Exclusive lock for the duration of this transaction; concurrent callers
  -- for the same org serialize here.
  SELECT next_seq INTO v_next
    FROM org_order_seq
    WHERE org_id = p_org_id
    FOR UPDATE;

  -- Defensive: never return a number <= any existing order suffix in this org.
  SELECT COALESCE(max(
           CASE
             WHEN order_number ~ '-\d+$'
               THEN (regexp_replace(order_number, '^.*-', ''))::integer
             ELSE NULL
           END
         ), 0) + 1
    INTO v_existing
    FROM orders
    WHERE org_id = p_org_id;

  v_next := GREATEST(v_next, v_existing, v_seq_start);

  UPDATE org_order_seq
    SET next_seq = v_next + 1
    WHERE org_id = p_org_id;

  RETURN v_prefix || '-' || v_next::text;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_order_number(uuid) TO authenticated;
