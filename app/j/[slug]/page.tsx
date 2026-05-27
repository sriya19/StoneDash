// Public share page for crew dispatch. Outside (auth) — no session
// required, trusts the slug (16 chars base62, ~95 bits entropy from a
// CSPRNG; brute force is intractable).
//
// Per PLAN Q10/Q11:
//   * force-dynamic + revalidate=0 so signed photo URLs (1h TTL) are
//     re-generated per request, not cached in HTML.
//   * service-role client fetches event + order + customer + crew +
//     attachments (bypasses RLS — required since the visitor isn't an
//     org member).
//   * last_opened_at is updated as a fire-and-forget side effect.
//
// Per PLAN Q2: rate limiting (30/min per IP) is enforced in middleware.ts
// before this page renders.
//
// Per PLAN ADD-1 + ADD-3 below: missing / revoked / fake slugs all go
// through notFound() which renders /j/[slug]/not-found.tsx with a uniform
// 404 status + identical "no longer active" body. Timing differences
// between the three paths are negligible vs network jitter.

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { notFound } from "next/navigation";
import { Calendar, MapPin, Phone } from "lucide-react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSignedUrls } from "@/lib/actions/attachments";
import { formatInTimeZone, tzAbbreviation } from "@/lib/tz";
import { SharePageActions } from "@/components/app/share-page-actions";

type Params = { slug: string };

type EventDetailDb = {
  id: string;
  org_id: string;
  order_id: string;
  kind: string;
  status: string;
  starts_at: string;
  ends_at: string;
  duration_min: number;
  location_text: string | null;
  notes: string | null;
  orders: {
    order_number: string;
    project_name: string | null;
    stone_type: string | null;
    edge_profile: string | null;
    sink_cutouts: number;
    cooktop_cutouts: number;
    customers: { name: string | null; phone: string | null } | null;
  } | null;
};

type CrewRow = {
  role: string | null;
  crew_members: { id: string; name: string; role: string | null } | null;
};

type AttachmentRow = {
  storage_path: string;
  original_name: string | null;
  mime: string | null;
};

const KIND_LABEL: Record<string, string> = {
  measurement: "Measurement",
  install: "Install",
  delivery: "Delivery",
  pickup: "Pickup",
  other: "Event",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  en_route: "En route",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const metadata = {
  // The /j/[slug] URLs should NEVER land in a search index. They're bearer
  // tokens — leaking them in a robots-allowed page would defeat the entire
  // share-link design.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicSharePage({ params }: { params: Params }) {
  const admin = createSupabaseAdminClient();

  // 1. Resolve slug → live link. notFound() if missing / revoked.
  const { data: link } = await admin
    .from("event_share_links")
    .select("id, event_id, org_id, revoked_at")
    .eq("slug", params.slug)
    .maybeSingle<{
      id: string;
      event_id: string;
      org_id: string;
      revoked_at: string | null;
    }>();
  if (!link || link.revoked_at !== null) notFound();

  // 2. Fetch event + order + customer in one shot.
  const { data: event } = await admin
    .from("order_events")
    .select(
      "id, org_id, order_id, kind, status, starts_at, ends_at, duration_min, location_text, notes, orders!inner(order_number, project_name, stone_type, edge_profile, sink_cutouts, cooktop_cutouts, customers(name, phone))",
    )
    .eq("id", link.event_id)
    .maybeSingle<EventDetailDb>();
  if (!event || !event.orders) notFound();

  // 3. Crew (separate query for clarity; small bounded set).
  const { data: crewAssignments } = await admin
    .from("order_event_assignments")
    .select("role, crew_members!inner(id, name, role)")
    .eq("event_id", event.id)
    .returns<CrewRow[]>();
  const crew = (crewAssignments ?? [])
    .map((row) => row.crew_members)
    .filter((c): c is NonNullable<CrewRow["crew_members"]> => c !== null);

  // 4. Org name + timezone for header/footer.
  const { data: org } = await admin
    .from("organizations")
    .select("name, timezone")
    .eq("id", event.org_id)
    .maybeSingle<{ name: string; timezone: string }>();
  const orgName = org?.name ?? "Throughstone";
  const orgTz = org?.timezone ?? "America/New_York";

  // 5. Photo attachments for the parent order. Pre-sign per-request (1h
  // TTL) so a crew opening the link 2h after share-time gets fresh URLs.
  const { data: attachments } = await admin
    .from("order_attachments")
    .select("storage_path, original_name, mime")
    .eq("order_id", event.order_id)
    .returns<AttachmentRow[]>();
  const photos = (attachments ?? []).filter((a) => a.mime?.startsWith("image/"));
  const photoPaths = photos.map((p) => p.storage_path);
  const photoUrls = photoPaths.length > 0 ? await createSignedUrls(photoPaths, 60 * 60) : {};

  // 6. Fire-and-forget: bump last_opened_at. Don't await — page render is
  // the user-visible path and shouldn't wait on a one-row UPDATE.
  void admin
    .from("event_share_links")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", link.id);

  const mapsUrl = event.location_text
    ? `https://maps.google.com/?q=${encodeURIComponent(event.location_text)}`
    : null;

  const customer = event.orders.customers;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background px-4 py-6">
      <div className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
        {/* Header: kind chip + status pill */}
        <div className="flex items-center justify-between">
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${kindBadge(event.kind)}`}
          >
            {KIND_LABEL[event.kind] ?? event.kind}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(event.status)}`}>
            {STATUS_LABEL[event.status] ?? event.status}
          </span>
        </div>

        <div>
          <h1 className="text-lg font-semibold leading-tight">
            {KIND_LABEL[event.kind] ?? "Event"} — {event.orders.order_number}
            {event.orders.project_name ? ` — ${event.orders.project_name}` : ""}
          </h1>
        </div>

        <section className="flex items-start gap-2 text-sm">
          <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">
              {formatInTimeZone(event.starts_at, orgTz, "EEE, MMM d, yyyy")}
            </p>
            <p className="text-muted-foreground">
              {formatInTimeZone(event.starts_at, orgTz, "h:mm a")}–
              {formatInTimeZone(event.ends_at, orgTz, "h:mm a")} ·{" "}
              {tzAbbreviation(orgTz)}
            </p>
          </div>
        </section>

        {event.location_text ? (
          <section className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p>{event.location_text}</p>
              {mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand underline-offset-2 hover:underline"
                >
                  Open in Maps
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {customer?.name ? (
          <section className="flex items-start gap-2 text-sm">
            <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">{customer.name}</p>
              {customer.phone ? (
                <a
                  href={`tel:${customer.phone}`}
                  className="text-xs text-brand underline-offset-2 hover:underline"
                >
                  {customer.phone}
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="space-y-1 border-t pt-3 text-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Project
          </p>
          <p className="text-sm">
            {event.orders.stone_type ?? "Stone TBD"}
            {event.orders.edge_profile ? `, ${event.orders.edge_profile} edge` : ""}
          </p>
          {(event.orders.sink_cutouts > 0 || event.orders.cooktop_cutouts > 0) ? (
            <p className="text-xs text-muted-foreground">
              {event.orders.sink_cutouts > 0
                ? `${event.orders.sink_cutouts} sink cutout${event.orders.sink_cutouts === 1 ? "" : "s"}`
                : ""}
              {event.orders.sink_cutouts > 0 && event.orders.cooktop_cutouts > 0 ? " · " : ""}
              {event.orders.cooktop_cutouts > 0
                ? `${event.orders.cooktop_cutouts} cooktop cutout${event.orders.cooktop_cutouts === 1 ? "" : "s"}`
                : ""}
            </p>
          ) : null}
        </section>

        {event.notes ? (
          <section className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap">{event.notes}</p>
          </section>
        ) : null}

        {photos.length > 0 ? (
          <section className="space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Photos
            </p>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => {
                const url = photoUrls[p.storage_path];
                if (!url) return null;
                return (
                  <a
                    key={p.storage_path}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={p.original_name ?? "Order photo"}
                      className="h-full w-full object-cover"
                    />
                  </a>
                );
              })}
            </div>
          </section>
        ) : null}

        {crew.length > 0 ? (
          <section className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Crew
            </p>
            <ul className="text-sm">
              {crew.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.role ? (
                    <span className="ml-1 text-xs text-muted-foreground">— {c.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <SharePageActions slug={params.slug} currentStatus={event.status} />

        <footer className="border-t pt-3 text-center text-[11px] text-muted-foreground">
          Throughstone — sent by {orgName}
        </footer>
      </div>
    </div>
  );
}

function kindBadge(kind: string): string {
  switch (kind) {
    case "measurement":
      return "bg-purple-100 text-purple-900";
    case "install":
      return "bg-emerald-100 text-emerald-900";
    case "delivery":
      return "bg-blue-100 text-blue-900";
    case "pickup":
      return "bg-sky-100 text-sky-900";
    default:
      return "bg-zinc-100 text-zinc-900";
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case "scheduled":
      return "bg-muted text-muted-foreground";
    case "en_route":
      return "bg-amber-100 text-amber-900";
    case "in_progress":
      return "bg-blue-100 text-blue-900";
    case "complete":
      return "bg-emerald-100 text-emerald-900";
    case "cancelled":
    case "no_show":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}
