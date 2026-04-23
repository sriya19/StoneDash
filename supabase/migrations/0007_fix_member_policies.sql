-- 0007_fix_member_policies.sql
--
-- The org_members_select and org_members_update policies used
-- (SELECT email FROM auth.users WHERE id = auth.uid()) as a subquery to match
-- pending-invite rows by email. The `authenticated` role has no privileges on
-- auth.users, so when the policy expression is evaluated Postgres raises
-- "permission denied for table users" — this masked the real decision in the
-- three-way OR and made org_members reads fail for every authenticated
-- caller. The dashboard loop (/dashboard <-> /onboarding) was a direct
-- consequence: getCurrentUserAndOrg's org_members check returned null →
-- redirected to /onboarding → /onboarding saw active_org_id set → redirected
-- back.
--
-- Swap the subquery for auth.jwt() ->> 'email', which reads the JWT claim
-- the SSR client sets and requires no auth.users access.
--
-- Rule going forward: RLS policies must not query auth.users (the
-- authenticated role can't read it). Use auth.jwt() claims or a SECURITY
-- DEFINER helper instead.

DROP POLICY IF EXISTS org_members_select ON org_members;
CREATE POLICY org_members_select
  ON org_members FOR SELECT TO authenticated
  USING (
    is_org_member(org_id)
    OR user_id = auth.uid()
    OR (
      invited_email IS NOT NULL
      AND lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

DROP POLICY IF EXISTS org_members_update ON org_members;
CREATE POLICY org_members_update
  ON org_members FOR UPDATE TO authenticated
  USING (
    org_role(org_id) IN ('owner', 'admin')
    OR user_id = auth.uid()
    OR (
      invited_email IS NOT NULL
      AND lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  WITH CHECK (
    org_role(org_id) IN ('owner', 'admin')
    OR user_id = auth.uid()
  );
