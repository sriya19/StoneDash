"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateShareLinkSlug } from "@/lib/share-link/slug";
import { EVENT_STATUSES, type EventStatus } from "@/lib/validators/events";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function invalidate() {
  revalidatePath("/schedule");
  revalidatePath("/orders");
}

// Create a fresh slug. RPC RAISEs `unique_violation` if a live link already
// exists — the modal disables the Generate button in that state to avoid
// the round-trip, but we surface the message gracefully if it slips through.
export async function createShareLink(
  input: unknown,
): Promise<ActionResult<{ slug: string; linkId: string }>> {
  if (!isEventIdInput(input)) {
    return { ok: false, error: "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const slug = generateShareLinkSlug();
  const { data, error } = await supabase.rpc("create_event_share_link", {
    p_event_id: input.eventId,
    p_slug: slug,
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: error?.message ?? "Could not create share link" };
  }
  invalidate();
  return { ok: true, data: { slug, linkId: data } };
}

// Atomically revoke any live link and issue a fresh one. Used by the "Rotate
// token" button when the owner wants to invalidate a previously-sent URL.
export async function rotateShareLink(
  input: unknown,
): Promise<ActionResult<{ slug: string; linkId: string }>> {
  if (!isEventIdInput(input)) {
    return { ok: false, error: "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const slug = generateShareLinkSlug();
  const { data, error } = await supabase.rpc("rotate_event_share_link", {
    p_event_id: input.eventId,
    p_slug: slug,
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: error?.message ?? "Could not rotate share link" };
  }
  invalidate();
  return { ok: true, data: { slug, linkId: data } };
}

export async function revokeShareLink(
  input: unknown,
): Promise<ActionResult<{ linkId: string }>> {
  if (!isLinkIdInput(input)) {
    return { ok: false, error: "Invalid input" };
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_event_share_link", {
    p_link_id: input.linkId,
  });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, data: { linkId: input.linkId } };
}

// ---------- public path: status updates via the share link ----------

// Called from /j/[slug]'s Mark-* buttons. Unauthenticated — trusts the slug.
// We re-validate the slug here (defense in depth on top of the route's
// validation) and use the admin client because there's no logged-in user.
// The update_event_status RPC with p_via_shared_link=true:
//   * asserts the caller is service_role (we are)
//   * sets the app.event_status_via_shared_link GUC so the AFTER UPDATE
//     trigger writes activity_log.metadata.via='shared_link'
//   * actor_id is NULL (no session)
export async function markEventStatusViaShareLink(
  input: unknown,
): Promise<ActionResult<{ eventId: string; status: EventStatus }>> {
  if (!isSlugStatusInput(input)) {
    return { ok: false, error: "Invalid input" };
  }
  const admin = createSupabaseAdminClient();
  const { data: link, error: lookupErr } = await admin
    .from("event_share_links")
    .select("id, event_id, revoked_at")
    .eq("slug", input.slug)
    .maybeSingle<{ id: string; event_id: string; revoked_at: string | null }>();
  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!link || link.revoked_at !== null) {
    return { ok: false, error: "Link is no longer active." };
  }

  const { error } = await admin.rpc("update_event_status", {
    p_event_id: link.event_id,
    p_status: input.status,
    p_via_shared_link: true,
  });
  if (error) return { ok: false, error: error.message };

  // /j/[slug] is force-dynamic so it'll re-fetch on next view anyway.
  revalidatePath(`/j/${input.slug}`);
  revalidatePath("/schedule");
  return { ok: true, data: { eventId: link.event_id, status: input.status } };
}

// ---------- input guards (zod would be overkill for 3 shapes) ----------

function isEventIdInput(input: unknown): input is { eventId: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as Record<string, unknown>).eventId === "string"
  );
}

function isLinkIdInput(input: unknown): input is { linkId: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as Record<string, unknown>).linkId === "string"
  );
}

function isSlugStatusInput(
  input: unknown,
): input is { slug: string; status: EventStatus } {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.slug === "string" &&
    obj.slug.length >= 12 &&
    typeof obj.status === "string" &&
    (EVENT_STATUSES as readonly string[]).includes(obj.status)
  );
}
