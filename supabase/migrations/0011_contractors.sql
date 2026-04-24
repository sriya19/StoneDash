-- 0011_contractors.sql — Contractor tracking (Task 2B)
--
-- Some customers come in through general contractors, K&B dealers, or
-- builders. We need to tag an order with a contractor, track payments
-- that span multiple jobs, and tell a contractor "here's what you owe
-- on the Springfield kitchen specifically".
--
-- Shape:
--   contractors                       — the org on the other side
--   orders.contractor_id              — nullable FK, ON DELETE SET NULL
--   contractor_payments               — one row per check/ACH/etc.
--   contractor_payment_allocations    — payment ↔ order, one row per split
--   v_order_contractor_paid           — per-order sum of allocations
--   v_contractor_balances             — per-contractor totals & balance
--
-- Write path for payments + allocations is RPC-only. See 0012 for the
-- SECURITY DEFINER functions. This file REVOKEs direct writes and sets
-- RLS WITH CHECK (false) as belt-and-suspenders — if a future dev forgets
-- the REVOKE, the policy still rejects the INSERT.

-- ===========================================================================
-- contractors
-- ===========================================================================

CREATE TABLE contractors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  primary_contact  text,
  phone            text,
  email            text,
  address_line1    text,
  address_line2    text,
  city             text,
  state            text,
  postal_code      text,
  payment_terms    text,
  notes            text,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractors_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE INDEX contractors_org_idx ON contractors (org_id);
CREATE INDEX contractors_org_name_idx ON contractors (org_id, lower(name));

CREATE TRIGGER contractors_set_updated_at
BEFORE UPDATE ON contractors
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- orders.contractor_id
-- ===========================================================================
--
-- SET NULL, never CASCADE: deleting a contractor must not delete jobs.
-- That would be catastrophic and obviously wrong.

ALTER TABLE orders
  ADD COLUMN contractor_id uuid NULL
    REFERENCES contractors(id) ON DELETE SET NULL;

CREATE INDEX orders_contractor_id_idx
  ON orders (contractor_id)
  WHERE contractor_id IS NOT NULL;

-- Field role must not be able to re-tag a job with a different contractor.
-- Extend the existing column-lock trigger from 0002.
CREATE OR REPLACE FUNCTION enforce_field_role_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role member_role;
BEGIN
  v_role := org_role(NEW.org_id);
  IF v_role IS DISTINCT FROM 'field' THEN
    RETURN NEW;
  END IF;

  IF NEW.org_id                 IS DISTINCT FROM OLD.org_id
     OR NEW.order_number        IS DISTINCT FROM OLD.order_number
     OR NEW.customer_id         IS DISTINCT FROM OLD.customer_id
     OR NEW.contractor_id       IS DISTINCT FROM OLD.contractor_id
     OR NEW.project_name        IS DISTINCT FROM OLD.project_name
     OR NEW.priority            IS DISTINCT FROM OLD.priority
     OR NEW.stone_type          IS DISTINCT FROM OLD.stone_type
     OR NEW.edge_profile        IS DISTINCT FROM OLD.edge_profile
     OR NEW.sink_cutouts        IS DISTINCT FROM OLD.sink_cutouts
     OR NEW.cooktop_cutouts     IS DISTINCT FROM OLD.cooktop_cutouts
     OR NEW.estimated_sqft      IS DISTINCT FROM OLD.estimated_sqft
     OR NEW.quote_amount        IS DISTINCT FROM OLD.quote_amount
     OR NEW.deposit_received    IS DISTINCT FROM OLD.deposit_received
     OR NEW.balance_due         IS DISTINCT FROM OLD.balance_due
     OR NEW.measured_at         IS DISTINCT FROM OLD.measured_at
     OR NEW.fabrication_start_date IS DISTINCT FROM OLD.fabrication_start_date
     OR NEW.scheduled_install_date IS DISTINCT FROM OLD.scheduled_install_date
     OR NEW.installed_at        IS DISTINCT FROM OLD.installed_at
     OR NEW.created_by          IS DISTINCT FROM OLD.created_by
     OR NEW.assigned_to         IS DISTINCT FROM OLD.assigned_to
  THEN
    RAISE EXCEPTION 'field role may only update stage and notes'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- contractor_payments
-- ===========================================================================

CREATE TABLE contractor_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contractor_id  uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  amount         numeric(12, 2) NOT NULL CHECK (amount > 0),
  received_on    date NOT NULL,
  method         text,
  reference      text,
  notes          text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payments_method_valid
    CHECK (method IS NULL OR method IN ('check', 'ach', 'cash', 'card', 'other'))
);

CREATE INDEX contractor_payments_org_contractor_received_idx
  ON contractor_payments (org_id, contractor_id, received_on DESC);

-- ===========================================================================
-- contractor_payment_allocations
-- ===========================================================================
--
-- When Ameer sends one check for $10k that covers three kitchens, we
-- record three allocation rows. This is what lets us say "here's what
-- you still owe on the Springfield kitchen specifically".

CREATE TABLE contractor_payment_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  uuid NOT NULL REFERENCES contractor_payments(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payment_allocations_payment_order_unique
    UNIQUE (payment_id, order_id)
);

CREATE INDEX contractor_payment_allocations_payment_idx
  ON contractor_payment_allocations (payment_id);
CREATE INDEX contractor_payment_allocations_order_idx
  ON contractor_payment_allocations (order_id);

-- ===========================================================================
-- Views  (security_invoker=true so underlying-table RLS applies)
-- ===========================================================================

CREATE VIEW v_order_contractor_paid
WITH (security_invoker = true)
AS
  SELECT
    a.order_id,
    SUM(a.amount)::numeric(14, 2) AS paid_by_contractor
  FROM contractor_payment_allocations a
  GROUP BY a.order_id;

CREATE VIEW v_contractor_balances
WITH (security_invoker = true)
AS
  SELECT
    c.id                                                  AS contractor_id,
    c.org_id,
    COALESCE(SUM(o.quote_amount), 0)::numeric(14, 2)      AS jobs_total,
    COALESCE(SUM(paid.paid_by_contractor), 0)::numeric(14, 2) AS paid_total,
    (COALESCE(SUM(o.quote_amount), 0)
      - COALESCE(SUM(paid.paid_by_contractor), 0))::numeric(14, 2) AS balance_owed,
    COUNT(o.id) FILTER (WHERE o.stage <> 'cancelled')     AS job_count,
    COUNT(o.id) FILTER (WHERE o.stage NOT IN ('paid', 'cancelled')) AS active_job_count
  FROM contractors c
  LEFT JOIN orders o
    ON o.contractor_id = c.id AND o.stage <> 'cancelled'
  LEFT JOIN v_order_contractor_paid paid
    ON paid.order_id = o.id
  GROUP BY c.id, c.org_id;

-- ===========================================================================
-- RLS + direct-write lockdown for payments/allocations
-- ===========================================================================

ALTER TABLE contractors                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_payment_allocations ENABLE ROW LEVEL SECURITY;

-- ---------- contractors (manager+ CRUD; field SELECT only) ----------

CREATE POLICY contractors_select
  ON contractors FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY contractors_insert
  ON contractors FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY contractors_update
  ON contractors FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY contractors_delete
  ON contractors FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ---------- contractor_payments (RPC-only writes) ----------
--
-- SELECT is allowed for any org member. Writes are rejected at the
-- policy level (WITH CHECK (false)) and the privilege level (REVOKE
-- below). The only way to write is through the SECURITY DEFINER RPCs
-- in 0012_contractor_payment_rpc.sql, which do their own RBAC check.

CREATE POLICY contractor_payments_select
  ON contractor_payments FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY contractor_payments_no_direct_insert
  ON contractor_payments FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY contractor_payments_no_direct_update
  ON contractor_payments FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY contractor_payments_no_direct_delete
  ON contractor_payments FOR DELETE TO authenticated
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON contractor_payments FROM authenticated, anon;

-- ---------- contractor_payment_allocations (RPC-only writes) ----------

CREATE POLICY contractor_payment_allocations_select
  ON contractor_payment_allocations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contractor_payments p
      WHERE p.id = contractor_payment_allocations.payment_id
        AND is_org_member(p.org_id)
    )
  );

CREATE POLICY contractor_payment_allocations_no_direct_insert
  ON contractor_payment_allocations FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY contractor_payment_allocations_no_direct_update
  ON contractor_payment_allocations FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY contractor_payment_allocations_no_direct_delete
  ON contractor_payment_allocations FOR DELETE TO authenticated
  USING (false);

REVOKE INSERT, UPDATE, DELETE ON contractor_payment_allocations FROM authenticated, anon;

-- ===========================================================================
-- Audit triggers
-- ---------------------------------------------------------------------------
-- Same shape as customers/orders/attachments: AFTER INSERT/UPDATE/DELETE
-- writes activity_log; BEFORE DELETE removes dangling polymorphic rows;
-- AFTER DELETE guarded against cascade-delete of the parent org.
-- ===========================================================================

-- ---------- contractors ----------

CREATE OR REPLACE FUNCTION tg_contractors_after_insert()
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
      'contractor',
      NEW.id,
      'created',
      jsonb_build_object('name', NEW.name, 'payment_terms', NEW.payment_terms)
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER contractors_after_insert_audit
AFTER INSERT ON contractors
FOR EACH ROW EXECUTE FUNCTION tg_contractors_after_insert();

CREATE OR REPLACE FUNCTION tg_contractors_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, auth.uid(), 'contractor', NEW.id, 'updated',
        jsonb_build_object('name', NEW.name, 'is_active', NEW.is_active)
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contractors_after_update_audit
AFTER UPDATE ON contractors
FOR EACH ROW EXECUTE FUNCTION tg_contractors_after_update();

CREATE OR REPLACE FUNCTION tg_contractors_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'contractor', OLD.id, 'deleted',
      jsonb_build_object('name', OLD.name)
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER contractors_after_delete_audit
AFTER DELETE ON contractors
FOR EACH ROW EXECUTE FUNCTION tg_contractors_after_delete();

CREATE OR REPLACE FUNCTION tg_contractors_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'contractor' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER contractors_before_delete_cleanup
BEFORE DELETE ON contractors
FOR EACH ROW EXECUTE FUNCTION tg_contractors_before_delete_cleanup();

-- ---------- contractor_payments ----------

CREATE OR REPLACE FUNCTION tg_contractor_payments_after_insert()
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
      'contractor_payment',
      NEW.id,
      'created',
      jsonb_build_object(
        'contractor_id', NEW.contractor_id,
        'amount',        NEW.amount,
        'received_on',   NEW.received_on,
        'method',        NEW.method
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER contractor_payments_after_insert_audit
AFTER INSERT ON contractor_payments
FOR EACH ROW EXECUTE FUNCTION tg_contractor_payments_after_insert();

CREATE OR REPLACE FUNCTION tg_contractor_payments_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id, auth.uid(), 'contractor_payment', NEW.id, 'updated',
        jsonb_build_object(
          'contractor_id', NEW.contractor_id,
          'amount',        NEW.amount,
          'received_on',   NEW.received_on
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contractor_payments_after_update_audit
AFTER UPDATE ON contractor_payments
FOR EACH ROW EXECUTE FUNCTION tg_contractor_payments_after_update();

CREATE OR REPLACE FUNCTION tg_contractor_payments_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      OLD.org_id, auth.uid(), 'contractor_payment', OLD.id, 'deleted',
      jsonb_build_object(
        'contractor_id', OLD.contractor_id,
        'amount',        OLD.amount,
        'received_on',   OLD.received_on
      )
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER contractor_payments_after_delete_audit
AFTER DELETE ON contractor_payments
FOR EACH ROW EXECUTE FUNCTION tg_contractor_payments_after_delete();

CREATE OR REPLACE FUNCTION tg_contractor_payments_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'contractor_payment' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER contractor_payments_before_delete_cleanup
BEFORE DELETE ON contractor_payments
FOR EACH ROW EXECUTE FUNCTION tg_contractor_payments_before_delete_cleanup();

-- ---------- contractor_payment_allocations ----------
--
-- Allocations don't carry org_id; we resolve it via the parent payment.
-- The AFTER DELETE guard still checks organizations first so cascade-
-- delete of the org is silent.

CREATE OR REPLACE FUNCTION tg_contractor_allocations_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM contractor_payments WHERE id = NEW.payment_id;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      v_org_id, auth.uid(), 'contractor_allocation', NEW.id, 'created',
      jsonb_build_object(
        'payment_id', NEW.payment_id,
        'order_id',   NEW.order_id,
        'amount',     NEW.amount
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER contractor_allocations_after_insert_audit
AFTER INSERT ON contractor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION tg_contractor_allocations_after_insert();

CREATE OR REPLACE FUNCTION tg_contractor_allocations_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Parent payment may already be gone when a payment is cascade-deleted;
  -- in that case the payment's AFTER DELETE already carries the context,
  -- so skip to keep the feed quiet.
  SELECT org_id INTO v_org_id FROM contractor_payments WHERE id = OLD.payment_id;
  IF v_org_id IS NULL THEN RETURN OLD; END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id) THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      v_org_id, auth.uid(), 'contractor_allocation', OLD.id, 'deleted',
      jsonb_build_object(
        'payment_id', OLD.payment_id,
        'order_id',   OLD.order_id,
        'amount',     OLD.amount
      )
    );
  RETURN OLD;
END;
$$;

CREATE TRIGGER contractor_allocations_after_delete_audit
AFTER DELETE ON contractor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION tg_contractor_allocations_after_delete();

CREATE OR REPLACE FUNCTION tg_contractor_allocations_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'contractor_allocation' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER contractor_allocations_before_delete_cleanup
BEFORE DELETE ON contractor_payment_allocations
FOR EACH ROW EXECUTE FUNCTION tg_contractor_allocations_before_delete_cleanup();
