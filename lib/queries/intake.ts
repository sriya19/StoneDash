// Server-side queries for the AI intake list.
// Defensive-empty on error same as Task 5's reminders queries —
// the migration for ai_intake_events may not be applied in every
// env we run against, and the /intake page shouldn't 500.

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AiIntakeEventRow } from "@/lib/supabase/types";

// Newest first. Small cap — the list is scannable and older
// intakes fall out of the "worth reviewing" window quickly.
export async function listRecentIntakes(): Promise<AiIntakeEventRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ai_intake_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<AiIntakeEventRow[]>();
  if (error) return [];
  return data ?? [];
}

// Full-detail load used by the review sheet — same shape but
// returns a single row (or null).
export async function getIntakeEvent(
  id: string,
): Promise<AiIntakeEventRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ai_intake_events")
    .select("*")
    .eq("id", id)
    .maybeSingle<AiIntakeEventRow>();
  if (error) return null;
  return data;
}
