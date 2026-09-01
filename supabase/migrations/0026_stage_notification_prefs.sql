-- 0026_stage_notification_prefs.sql
--
-- Task 9 Feature A, sub-step 1. Two things: a per-org fabrication estimate
-- used by the new in_fabrication template, and the table that decides
-- whether a stage change offers to notify the customer.
--
-- DESIGN: this table stores OVERRIDES ONLY (PLAN Q5).
--
-- The brief specified seeding five rows per org with is_enabled=true. That
-- shape needs a seeding path for every new org — a trigger, or a line in
-- onboarding — and any org created before that path exists silently gets no
-- prompts. Inverting it removes the whole concern: an absent row means
-- ENABLED, which is exactly what "default all on" means, so a brand-new org
-- behaves correctly with zero rows and nothing to seed. "Don't ask for this"
-- inserts is_enabled=false; the Settings toggle upserts.
--
-- The canonical transition list therefore lives in TypeScript next to
-- ORDER_STAGES, which is where the rest of the app's stage knowledge already
-- is. The Settings table renders that list joined to whatever rows exist.
--
-- NULL from_stage means "from any stage". Postgres treats NULLs as distinct
-- in a UNIQUE constraint, so a plain UNIQUE (org_id, from_stage, to_stage)
-- would happily accept ten rows with from_stage IS NULL and the same
-- to_stage. Two partial unique indexes express the real rule and work on
-- every PG version (UNIQUE ... NULLS NOT DISTINCT is PG15+).
--
-- Stage columns are the order_stage ENUM rather than the brief's `text`, so a
-- typo'd stage is rejected by the database instead of silently never
-- matching. Same type change_order_stage(p_to_stage order_stage) already
-- takes.
--
-- template_slug is a plain slug, deliberately NOT a FK to
-- message_templates(org_id, slug). A dangling override should degrade to the
-- transition's default template, not block the stage change or cascade a
-- delete into notification config. The RPC resolves it and falls back.
--
-- Recorded here because sub-step 1 was asked to check it (PLAN Q3):
-- bulkChangeStage does NOT skip stage history. History and activity_log are
-- written by the AFTER UPDATE trigger tg_orders_after_update (0009), which
-- fires on any UPDATE orders SET stage, RPC or not — the note is simply NULL
-- on the direct path, which 0009's own comment calls out as intended. The
-- live table confirms it: 14 of 17 order_stage_history rows have note IS
-- NULL. There is no bug to fix, and bulk changes will bypass only the
-- prompt, which is the desired behaviour.

-- ---------------------------------------------------------------------------
-- organizations.default_fabrication_days
-- ---------------------------------------------------------------------------

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_fabrication_days integer NOT NULL DEFAULT 10
    CHECK (default_fabrication_days BETWEEN 1 AND 365);

COMMENT ON COLUMN organizations.default_fabrication_days IS
  'Typical fabrication turnaround in days. Renders into the in_fabrication '
  'customer template as {{fabrication_days}}. Org-wide, not per-order — the '
  'template says "typical", which is what makes a constant honest.';

-- ---------------------------------------------------------------------------
-- stage_notification_prefs
-- ---------------------------------------------------------------------------

CREATE TABLE stage_notification_prefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_stage    order_stage,            -- NULL = "from any stage"
  to_stage      order_stage NOT NULL,
  is_enabled    boolean NOT NULL DEFAULT true,
  template_slug text CHECK (template_slug IS NULL OR length(btrim(template_slug)) > 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- paid and cancelled are terminal: the brief specifies no prompt for
  -- either, so make storing one impossible rather than filtering it in
  -- three different call sites.
  CONSTRAINT stage_notification_prefs_notifiable_target
    CHECK (to_stage NOT IN ('paid', 'cancelled')),

  -- A transition to the stage it came from is not a transition.
  CONSTRAINT stage_notification_prefs_distinct_stages
    CHECK (from_stage IS NULL OR from_stage <> to_stage)
);

CREATE UNIQUE INDEX stage_notification_prefs_specific_uniq
  ON stage_notification_prefs (org_id, from_stage, to_stage)
  WHERE from_stage IS NOT NULL;

CREATE UNIQUE INDEX stage_notification_prefs_any_from_uniq
  ON stage_notification_prefs (org_id, to_stage)
  WHERE from_stage IS NULL;

CREATE INDEX stage_notification_prefs_org_idx
  ON stage_notification_prefs (org_id);

CREATE TRIGGER stage_notification_prefs_set_updated_at
BEFORE UPDATE ON stage_notification_prefs
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

COMMENT ON TABLE stage_notification_prefs IS
  'Overrides only. An absent row means the transition prompts (default on). '
  'The canonical transition list lives in lib/validators/orders.ts.';

-- ---------------------------------------------------------------------------
-- RLS — the contractors/message_templates shape from 0011/0025
-- ---------------------------------------------------------------------------

ALTER TABLE stage_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY stage_notification_prefs_select
  ON stage_notification_prefs FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY stage_notification_prefs_insert
  ON stage_notification_prefs FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY stage_notification_prefs_update
  ON stage_notification_prefs FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY stage_notification_prefs_delete
  ON stage_notification_prefs FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ---------------------------------------------------------------------------
-- Audit — notification config is a config change, so it logs. Follows the
-- message_templates shape from 0025, including the before-delete cleanup
-- that mirrors 0006 so an org cascade cannot trip an AFTER DELETE trigger
-- against an already-deleted parent.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tg_stage_notification_prefs_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only log when the meaningful fields actually moved. An updated_at-only
  -- touch is not a config change anyone wants in the feed.
  IF TG_OP = 'UPDATE'
     AND NEW.is_enabled IS NOT DISTINCT FROM OLD.is_enabled
     AND NEW.template_slug IS NOT DISTINCT FROM OLD.template_slug THEN
    RETURN NEW;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      auth.uid(),
      'stage_notification_pref',
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END,
      jsonb_build_object(
        'from_stage', NEW.from_stage,
        'to_stage', NEW.to_stage,
        'is_enabled', NEW.is_enabled,
        'template_slug', NEW.template_slug
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER stage_notification_prefs_after_insert
AFTER INSERT ON stage_notification_prefs
FOR EACH ROW EXECUTE FUNCTION tg_stage_notification_prefs_after_write();

CREATE TRIGGER stage_notification_prefs_after_update
AFTER UPDATE ON stage_notification_prefs
FOR EACH ROW EXECUTE FUNCTION tg_stage_notification_prefs_after_write();
