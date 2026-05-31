-- 0016_scheduling_v2.sql — Standalone events, all-day flag, 'task' kind (Task 3.1)
--
-- Three additions to the order_events shape uncovered during shop-floor use:
--   * Some events aren't tied to an order ("call Khaled about Springfield",
--     "pick up checks", "crew meeting"). order_id becomes nullable.
--   * Some events have no specific time ("Trade show Wednesday all day").
--     New is_all_day flag.
--   * New 'task' kind for the non-job catch-all (distinct from 'other').
--
-- Per PLAN Q1: the same-UTC-day CHECK doesn't survive an all-day event in
-- a non-UTC org tz (00:00 ET + 1440 min crosses UTC midnight). The CHECK
-- is split into an is_all_day branch (asserting duration = 1440) and the
-- existing branch for timed events. The action layer adds a runtime
-- assertion that all-day starts_at is exactly midnight org-local.

-- ===========================================================================
-- order_events column changes
-- ===========================================================================

ALTER TABLE order_events
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE order_events
  ADD COLUMN title text NULL;

ALTER TABLE order_events
  ADD COLUMN is_all_day boolean NOT NULL DEFAULT false;

-- title is required when order_id is null; either an order or a title (or
-- both) must identify the event. The view's COALESCE(o.project_name,
-- e.title) gives the display label.
ALTER TABLE order_events
  ADD CONSTRAINT order_events_title_or_order CHECK (
    order_id IS NOT NULL
    OR (title IS NOT NULL AND length(trim(title)) > 0)
  );

-- ===========================================================================
-- Kind CHECK — add 'task'
-- ===========================================================================
-- The actual constraint name in 0013 is order_events_kind_valid (the brief
-- referenced order_events_kind_check, which doesn't exist).

ALTER TABLE order_events DROP CONSTRAINT order_events_kind_valid;
ALTER TABLE order_events
  ADD CONSTRAINT order_events_kind_valid CHECK (
    kind IN ('measurement', 'install', 'delivery', 'pickup', 'other', 'task')
  );

-- ===========================================================================
-- Same-UTC-day CHECK — split for all-day events (PLAN Q1)
-- ===========================================================================
--
-- Simpler form: is_all_day events bypass the same-day check, but must have
-- duration_min = 1440. This catches the most likely accidental bug
-- (someone passes is_all_day=true with a stray duration). The 00:00
-- org-local assertion lives in the server action — see lib/actions/events.ts.
--
-- We CAN'T do the rigorous check (starts_at = midnight org-local) here
-- because that needs per-row org tz, which is STABLE not IMMUTABLE, and
-- IMMUTABLE is required in a constraint expression.

ALTER TABLE order_events DROP CONSTRAINT order_events_same_utc_day;
ALTER TABLE order_events
  ADD CONSTRAINT order_events_same_utc_day CHECK (
    (is_all_day = true AND duration_min = 1440)
    OR (
      is_all_day = false
      AND date_trunc('day', starts_at AT TIME ZONE 'UTC')
          = date_trunc('day', ((starts_at AT TIME ZONE 'UTC') + make_interval(mins => duration_min)) AT TIME ZONE 'UTC')
    )
  );

-- ===========================================================================
-- v_calendar_events — LEFT JOIN orders, expose title + is_all_day + is_standalone
-- ===========================================================================

DROP VIEW v_calendar_events;

CREATE VIEW v_calendar_events
WITH (security_invoker = true)
AS
  SELECT
    e.id,
    e.org_id,
    e.order_id,
    e.kind,
    e.status,
    e.starts_at,
    e.ends_at,
    e.duration_min,
    e.is_all_day,
    (e.order_id IS NULL)                      AS is_standalone,
    e.location_text,
    e.notes,
    o.order_number,
    o.project_name,
    -- Unified display label: order's project name when tied to an order,
    -- the event's own title for standalone events.
    COALESCE(o.project_name, e.title)         AS title,
    o.stone_type,
    o.stage,
    o.contractor_id,
    c.name  AS customer_name,
    c.phone AS customer_phone,
    cn.name AS contractor_name,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'id',   cm.id,
                'name', cm.name,
                'role', a.role
              ) ORDER BY cm.name)
         FROM order_event_assignments a
         JOIN crew_members cm ON cm.id = a.crew_member_id
        WHERE a.event_id = e.id),
      '[]'::jsonb
    ) AS crew
  FROM order_events e
  LEFT JOIN orders      o  ON o.id  = e.order_id
  LEFT JOIN customers   c  ON c.id  = o.customer_id
  LEFT JOIN contractors cn ON cn.id = o.contractor_id;
