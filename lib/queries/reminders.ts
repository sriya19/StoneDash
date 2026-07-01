// Server-side reminder queries. Callers are Server Components and
// route handlers — the RLS on `reminders` scopes SELECT to
// (user_id = auth.uid()), so these functions only return rows the
// current session's user owns.
//
// Defensive-empty on error: the migration for `reminders` may not
// have been applied yet in the environment we run against. Rather
// than 500ing the topbar and /reminders page, we return `[]` / `0`
// when the table doesn't exist. The dev-server console will still
// show the underlying error via Supabase's default logging.

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ReminderRow } from "@/lib/supabase/types";

// Only rows that the bell popover cares about: not dismissed, not
// completed, and past-or-equal to now.
export async function listActiveDueReminders(): Promise<ReminderRow[]> {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .is("dismissed_at", null)
    .is("completed_at", null)
    .lte("remind_at", nowIso)
    .order("remind_at", { ascending: false })
    .limit(50)
    .returns<ReminderRow[]>();
  if (error) return [];
  return data ?? [];
}

// Bell badge count. Same predicate as listActiveDueReminders but a
// scalar count so the topbar doesn't move any payload past the row
// count itself.
export async function countActiveDueReminders(): Promise<number> {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { count, error } = await supabase
    .from("reminders")
    .select("id", { count: "exact", head: true })
    .is("dismissed_at", null)
    .is("completed_at", null)
    .lte("remind_at", nowIso);
  if (error) return 0;
  return count ?? 0;
}

export type RemindersFilter = "active" | "upcoming" | "dismissed" | "all";

// /reminders page. Filters:
//   active     — not dismissed, remind_at <= now (same as bell)
//   upcoming   — not dismissed, remind_at > now
//   dismissed  — dismissed_at IS NOT NULL
//   all        — no filter (still user-scoped by RLS)
export async function listRemindersForPage(
  filter: RemindersFilter,
): Promise<ReminderRow[]> {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  let query = supabase.from("reminders").select("*").limit(200);

  if (filter === "active") {
    query = query
      .is("dismissed_at", null)
      .is("completed_at", null)
      .lte("remind_at", nowIso)
      .order("remind_at", { ascending: false });
  } else if (filter === "upcoming") {
    query = query
      .is("dismissed_at", null)
      .is("completed_at", null)
      .gt("remind_at", nowIso)
      .order("remind_at", { ascending: true });
  } else if (filter === "dismissed") {
    query = query
      .not("dismissed_at", "is", null)
      .order("dismissed_at", { ascending: false });
  } else {
    query = query.order("remind_at", { ascending: false });
  }

  const { data, error } = await query.returns<ReminderRow[]>();
  if (error) return [];
  return data ?? [];
}
