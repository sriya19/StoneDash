-- 0002_rls.sql — Row-Level Security policies
-- Policies rely on is_org_member() and org_role() from 0001_init.sql.
-- Tenancy rule: a row is readable/writable only by accepted members of its org.
-- Role rule: field < manager < admin < owner (field is most restricted).

-- ===========================================================================
-- Enable RLS on every tenant table
-- ===========================================================================

ALTER TABLE organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_stage_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_attachments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_order_seq        ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- profiles  (each user reads/writes their own row)
-- ===========================================================================

CREATE POLICY profiles_self_select
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_self_insert
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_self_update
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Profiles cascade-delete from auth.users — no user-facing DELETE policy.

-- ===========================================================================
-- organizations
-- ===========================================================================

CREATE POLICY organizations_select
  ON organizations FOR SELECT TO authenticated
  USING (is_org_member(id));

-- Any authenticated user can create an org they own (owner_id = auth.uid()).
-- The matching org_members 'owner' row is inserted immediately afterward by
-- onboarding, which is why org-member insert policy below also allows the
-- first-ever owner insert for a brand new org.
CREATE POLICY organizations_insert
  ON organizations FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY organizations_update
  ON organizations FOR UPDATE TO authenticated
  USING (org_role(id) IN ('owner', 'admin'))
  WITH CHECK (org_role(id) IN ('owner', 'admin'));

CREATE POLICY organizations_delete
  ON organizations FOR DELETE TO authenticated
  USING (org_role(id) = 'owner');

-- ===========================================================================
-- org_members
-- ===========================================================================

-- You can see memberships in orgs you belong to, rows pointing at your user
-- id, and open invites sent to your email.
CREATE POLICY org_members_select
  ON org_members FOR SELECT TO authenticated
  USING (
    is_org_member(org_id)
    OR user_id = auth.uid()
    OR (
      invited_email IS NOT NULL
      AND lower(invited_email) = lower(
        COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '')
      )
    )
  );

-- Owner/admin can invite. The very first owner row (for a freshly created
-- org that has no members yet) is allowed when the caller is the org owner.
CREATE POLICY org_members_insert
  ON org_members FOR INSERT TO authenticated
  WITH CHECK (
    -- Normal path: inviter must be owner/admin of the org
    org_role(org_id) IN ('owner', 'admin')
    OR
    -- Bootstrap path: the caller is the org's owner and this is their own
    -- accepted owner membership row
    (
      user_id = auth.uid()
      AND role = 'owner'
      AND invite_accepted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = org_id AND o.owner_id = auth.uid()
      )
    )
  );

-- Owner/admin manages any row; a member can accept their own invite (update
-- their own row to set user_id + invite_accepted_at).
CREATE POLICY org_members_update
  ON org_members FOR UPDATE TO authenticated
  USING (
    org_role(org_id) IN ('owner', 'admin')
    OR user_id = auth.uid()
    OR (
      invited_email IS NOT NULL
      AND lower(invited_email) = lower(
        COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), '')
      )
    )
  )
  WITH CHECK (
    org_role(org_id) IN ('owner', 'admin')
    OR user_id = auth.uid()
  );

-- Owner/admin can remove members, but not the owner row.
CREATE POLICY org_members_delete
  ON org_members FOR DELETE TO authenticated
  USING (
    org_role(org_id) IN ('owner', 'admin')
    AND role <> 'owner'
  );

-- ===========================================================================
-- customers  (field role has no write access)
-- ===========================================================================

CREATE POLICY customers_select
  ON customers FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY customers_insert
  ON customers FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY customers_update
  ON customers FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY customers_delete
  ON customers FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ===========================================================================
-- orders
-- ===========================================================================

CREATE POLICY orders_select
  ON orders FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY orders_insert
  ON orders FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Field role may UPDATE too; the accompanying trigger below restricts them
-- to stage + notes only (Postgres RLS cannot do column-level checks).
CREATE POLICY orders_update
  ON orders FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager', 'field'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager', 'field'));

CREATE POLICY orders_delete
  ON orders FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Enforce that 'field' updates touch only stage/notes/updated_at.
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

CREATE TRIGGER orders_field_role_check
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION enforce_field_role_columns();

-- ===========================================================================
-- order_stage_history  (read-only; writes come from SECURITY DEFINER triggers)
-- ===========================================================================

CREATE POLICY order_stage_history_select
  ON order_stage_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_stage_history.order_id
        AND is_org_member(o.org_id)
    )
  );

-- ===========================================================================
-- order_attachments  (field can upload)
-- ===========================================================================

CREATE POLICY order_attachments_select
  ON order_attachments FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY order_attachments_insert
  ON order_attachments FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager', 'field'));

CREATE POLICY order_attachments_update
  ON order_attachments FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY order_attachments_delete
  ON order_attachments FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ===========================================================================
-- activity_log  (members may read; writes come from SECURITY DEFINER triggers)
-- ===========================================================================

CREATE POLICY activity_log_select
  ON activity_log FOR SELECT TO authenticated
  USING (is_org_member(org_id));

-- ===========================================================================
-- org_order_seq  (no user-facing policies; only generate_order_number accesses)
-- ===========================================================================
-- RLS remains enabled with no policies so the table is inaccessible except
-- through generate_order_number(), which is SECURITY DEFINER.
