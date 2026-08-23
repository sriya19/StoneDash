-- 0025_messaging.sql — Task 7 sub-step 1: messaging schema.
--
-- Five pieces:
--   message_templates   one row per (org, slug). System defaults ship with
--                       is_system_default=true; an org edit INSERTs a second
--                       row with the same slug and is_system_default=false,
--                       which the query layer prefers. "Reset to default"
--                       is a DELETE of the org row.
--   message_send_log    append-only record of every Copy / deep-link intent.
--                       We cannot observe delivery — this logs intent only.
--   orders              site-contact columns + cached travel time.
--   crew_members        is_favorite, for the Send modal's recipient picker.
--   organizations       shop address + phone, for ETA origin and
--                       the {{shop_phone}} placeholder.
--
-- Per PLAN.md Q13, message_send_log deliberately has NO audit trigger: it is
-- itself the audit record for sends, and mirroring 30 sends/day into
-- activity_log would bury stage changes in the dashboard feed.
-- message_templates DOES audit — template edits are config changes.

BEGIN;

-- ===========================================================================
-- message_templates
-- ===========================================================================

CREATE TABLE message_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  audience          text NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL,
  is_system_default boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_templates_audience_valid
    CHECK (audience IN ('crew', 'customer', 'contractor')),
  CONSTRAINT message_templates_slug_not_blank
    CHECK (length(trim(slug)) > 0),
  CONSTRAINT message_templates_body_not_blank
    CHECK (length(trim(body)) > 0)
);

-- One row per slug per org. The system default and an org override cannot
-- coexist for the same slug in the same org: the override REPLACES the row
-- for that org, and "reset" restores it from the seed's canonical copy.
CREATE UNIQUE INDEX message_templates_org_slug_unique
ON message_templates (org_id, slug);

CREATE INDEX message_templates_org_audience_idx
ON message_templates (org_id, audience);

CREATE TRIGGER message_templates_set_updated_at
BEFORE UPDATE ON message_templates
FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

-- ===========================================================================
-- message_send_log
-- ===========================================================================
--
-- recipient_snapshot is written at send time from the same object the deep
-- link used — never re-fetched. If the crew member is later renamed or
-- deleted, the log still says who actually received the message.

CREATE TABLE message_send_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  template_slug      text,
  audience           text,
  channel            text NOT NULL,
  event_id           uuid REFERENCES order_events(id) ON DELETE SET NULL,
  order_id           uuid REFERENCES orders(id) ON DELETE SET NULL,
  recipient_kind     text,
  recipient_id       uuid,
  recipient_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_body       text NOT NULL DEFAULT '',
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_send_log_channel_valid
    CHECK (channel IN ('copy', 'whatsapp', 'messages', 'email', 'sms')),
  CONSTRAINT message_send_log_audience_valid
    CHECK (audience IS NULL OR audience IN ('crew', 'customer', 'contractor')),
  CONSTRAINT message_send_log_recipient_kind_valid
    CHECK (recipient_kind IS NULL OR recipient_kind IN
           ('crew_member', 'customer', 'contractor', 'ad_hoc'))
);

CREATE INDEX message_send_log_org_created_idx
ON message_send_log (org_id, created_at DESC);

CREATE INDEX message_send_log_event_idx
ON message_send_log (event_id) WHERE event_id IS NOT NULL;

CREATE INDEX message_send_log_order_idx
ON message_send_log (order_id) WHERE order_id IS NOT NULL;

-- ===========================================================================
-- orders — site contact + cached travel time
-- ===========================================================================
--
-- estimated_travel_computed_at exists because orders.updated_at moves on
-- every unrelated edit: a stage change would make a stale ETA look fresh,
-- and an untouched order would never go stale. ETA_STALE_HOURS (72) is
-- compared against this column, not updated_at. (PLAN.md Q11)
--
-- estimated_travel_meters is persisted because message_send_log.metadata
-- records distance_meters; without it we would pay for a second Routes API
-- call to recover a number the first call already returned.

ALTER TABLE orders
  ADD COLUMN site_contact_name           text,
  ADD COLUMN site_contact_phone          text,
  ADD COLUMN site_contact_email          text,
  ADD COLUMN estimated_travel_min        integer,
  ADD COLUMN estimated_travel_meters     integer,
  ADD COLUMN estimated_travel_computed_at timestamptz;

ALTER TABLE orders
  ADD CONSTRAINT orders_estimated_travel_min_sane
    CHECK (estimated_travel_min IS NULL
           OR (estimated_travel_min >= 0 AND estimated_travel_min <= 1440)),
  ADD CONSTRAINT orders_estimated_travel_meters_sane
    CHECK (estimated_travel_meters IS NULL OR estimated_travel_meters >= 0);

-- ===========================================================================
-- crew_members — favorites
-- ===========================================================================
--
-- The 5-per-org cap is enforced in the server action, not here: "at most 5
-- rows per org" is not expressible as a unique or check constraint, and a
-- trigger is disproportionate for a cosmetic picker limit. (PLAN.md Q9)

ALTER TABLE crew_members
  ADD COLUMN is_favorite boolean NOT NULL DEFAULT false;

CREATE INDEX crew_members_org_favorite_idx
ON crew_members (org_id) WHERE is_favorite;

-- ===========================================================================
-- organizations — shop address + phone
-- ===========================================================================
--
-- phone backs the {{shop_phone}} placeholder used by four of the six system
-- templates. It is org-level, not profiles.phone: the number a customer is
-- told to call must not change with whichever manager clicked Send.
-- (PLAN.md Q1)
--
-- The address columns are the origin for Routes API travel time. Unset
-- address means ETA degrades to manual entry, never a hard failure.

ALTER TABLE organizations
  ADD COLUMN phone              text,
  ADD COLUMN shop_address_line1 text,
  ADD COLUMN shop_city          text,
  ADD COLUMN shop_state         text,
  ADD COLUMN shop_postal_code   text;

-- ===========================================================================
-- RLS — message_templates
-- ===========================================================================
--
-- Read is org-wide (field crew need to see the template a message came
-- from). Writes are manager+, matching the contractors policy shape
-- from 0011.

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_templates_select
  ON message_templates FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY message_templates_insert
  ON message_templates FOR INSERT TO authenticated
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY message_templates_update
  ON message_templates FOR UPDATE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'))
  WITH CHECK (org_role(org_id) IN ('owner', 'admin', 'manager'));

CREATE POLICY message_templates_delete
  ON message_templates FOR DELETE TO authenticated
  USING (org_role(org_id) IN ('owner', 'admin', 'manager'));

-- ===========================================================================
-- RLS — message_send_log (append-only)
-- ===========================================================================
--
-- PLAN.md Q4: rather than funnel writes through a SECURITY DEFINER RPC
-- (the contractor_payments shape), this is a plain append with two
-- guarantees:
--   * sender_id = auth.uid() on INSERT, so a member cannot forge entries
--     attributed to a colleague.
--   * NO update or delete policy exists at all, and the privileges are
--     revoked as well — belt and suspenders, the same posture 0011 took.
-- The result is genuine immutability without an RPC for a plain insert.

ALTER TABLE message_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_send_log_select
  ON message_send_log FOR SELECT TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY message_send_log_insert
  ON message_send_log FOR INSERT TO authenticated
  WITH CHECK (is_org_member(org_id) AND sender_id = auth.uid());

REVOKE UPDATE, DELETE ON message_send_log FROM authenticated;

-- ===========================================================================
-- Audit triggers — message_templates
-- ===========================================================================
--
-- Template edits are config changes and belong in the activity feed.
-- Sends do not (PLAN.md Q13) — message_send_log is their record.
--
-- The before-delete cleanup mirrors 0006: activity_log rows are removed
-- ahead of the row itself so an org cascade cannot trip the AFTER DELETE
-- trigger against an already-deleted parent.

CREATE OR REPLACE FUNCTION tg_message_templates_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- System defaults arrive via the seed, not a user action. Logging them
  -- would put six rows in the feed every time an org is created.
  IF NEW.is_system_default THEN
    RETURN NEW;
  END IF;

  INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
    VALUES (
      NEW.org_id,
      auth.uid(),
      'message_template',
      NEW.id,
      'created',
      jsonb_build_object(
        'slug', NEW.slug,
        'audience', NEW.audience,
        'title', NEW.title
      )
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_templates_after_insert
AFTER INSERT ON message_templates
FOR EACH ROW EXECUTE FUNCTION tg_message_templates_after_insert();

CREATE OR REPLACE FUNCTION tg_message_templates_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO activity_log (org_id, actor_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id,
        auth.uid(),
        'message_template',
        NEW.id,
        'updated',
        jsonb_build_object(
          'slug', NEW.slug,
          'audience', NEW.audience,
          'body_changed', NEW.body IS DISTINCT FROM OLD.body,
          'is_active', NEW.is_active
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_templates_after_update
AFTER UPDATE ON message_templates
FOR EACH ROW EXECUTE FUNCTION tg_message_templates_after_update();

CREATE OR REPLACE FUNCTION tg_message_templates_before_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM activity_log
    WHERE entity_type = 'message_template' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER message_templates_before_delete_cleanup
BEFORE DELETE ON message_templates
FOR EACH ROW EXECUTE FUNCTION tg_message_templates_before_delete_cleanup();

COMMIT;
