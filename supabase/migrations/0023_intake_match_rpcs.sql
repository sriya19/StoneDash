-- 0023_intake_match_rpcs.sql — Task 6C Step B helper RPCs.
--
-- Three SECURITY DEFINER functions the matching module calls to
-- exercise the pg_trgm indexes from migration 0020. Each takes an
-- org_id + a normalized (lowercased, trimmed) search string + a
-- minimum similarity floor, and returns the single best matching
-- row with its similarity score.
--
-- SECURITY DEFINER because the intake pipeline runs under the
-- service-role client inside the route handler (no user session
-- on the internal fire-and-forget). RLS on the underlying tables
-- wouldn't apply anyway; org scoping happens via the p_org_id
-- parameter.
--
-- Returns a TABLE(...) so callers can consume via `data[0]` in JS
-- without needing an out-parameter dance.

BEGIN;

CREATE OR REPLACE FUNCTION intake_match_customer_by_name(
  p_org_id         uuid,
  p_name           text,
  p_min_similarity real DEFAULT 0.5
)
RETURNS TABLE(id uuid, similarity real)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.id, similarity(lower(c.name), p_name) AS similarity
    FROM customers c
   WHERE c.org_id = p_org_id
     AND similarity(lower(c.name), p_name) >= p_min_similarity
   ORDER BY similarity(lower(c.name), p_name) DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION
  intake_match_customer_by_name(uuid, text, real)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION intake_match_order_by_project(
  p_org_id         uuid,
  p_project        text,
  p_min_similarity real DEFAULT 0.5
)
RETURNS TABLE(id uuid, similarity real)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT o.id, similarity(lower(o.project_name), p_project) AS similarity
    FROM orders o
   WHERE o.org_id = p_org_id
     AND o.project_name IS NOT NULL
     AND similarity(lower(o.project_name), p_project) >= p_min_similarity
   ORDER BY similarity(lower(o.project_name), p_project) DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION
  intake_match_order_by_project(uuid, text, real)
  TO service_role, authenticated;

CREATE OR REPLACE FUNCTION intake_match_contractor_by_name(
  p_org_id         uuid,
  p_name           text,
  p_min_similarity real DEFAULT 0.5
)
RETURNS TABLE(id uuid, similarity real)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.id, similarity(lower(c.name), p_name) AS similarity
    FROM contractors c
   WHERE c.org_id = p_org_id
     AND similarity(lower(c.name), p_name) >= p_min_similarity
   ORDER BY similarity(lower(c.name), p_name) DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION
  intake_match_contractor_by_name(uuid, text, real)
  TO service_role, authenticated;

COMMIT;
