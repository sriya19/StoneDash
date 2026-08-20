-- 0021_v_calendar_events_color.sql — Task 6B follow-up
--
-- v_calendar_events didn't expose the new `color` column from
-- migration 0020. Adding it now so the calendar UI can read the
-- user-picked override via a single query — same batch as every
-- other event field.
--
-- Postgres views can't ALTER-add a column; DROP + recreate with
-- the identical column list plus `color`.

BEGIN;

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
    e.color,                                  -- Task 6B
    o.order_number,
    o.project_name,
    -- Unified display label: order's project name when tied to an
    -- order, the event's own title for standalone events.
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

COMMIT;
