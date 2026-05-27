import type { OrderStage } from "@prisma/client";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOrders, getOrderDetail } from "@/lib/queries/orders";
import { listCustomersLite } from "@/lib/queries/customers";
import { listContractorsLite } from "@/lib/queries/contractors";
import { listCrewLite } from "@/lib/queries/crew";
import {
  getEventForEdit,
  listEventsForOrder,
  listOrdersForEventPicker,
} from "@/lib/queries/events";
import { getSendModalContext } from "@/lib/queries/share-links";
import { createSignedUrls } from "@/lib/actions/attachments";
import { ORDER_STAGES } from "@/lib/validators/orders";
import { OrdersFilterBar } from "@/components/app/orders-filter-bar";
import { OrdersViewToggle } from "@/components/app/orders-view-toggle";
import { OrdersTable } from "@/components/app/orders-table";
import { OrdersBoard } from "@/components/app/orders-board";
import { NewOrderDialog } from "@/components/app/new-order-dialog";
import {
  OrderDetailSheet,
  type AttachmentRow,
} from "@/components/app/order-detail-sheet";
import { EventDialog } from "@/components/app/event-dialog";
import { SendToCrewModal } from "@/components/app/send-to-crew-modal";
import type { ActivityRow } from "@/components/app/activity-feed";

type SearchParams = {
  stage?: string;
  contractor?: string;
  q?: string;
  view?: string;
  sort?: string;
  dir?: string;
  page?: string;
  order?: string;
  new?: string;
  tab?: string;
  event?: string;
  date?: string;
  time?: string;
  send?: string;
};

type DetailTab = "overview" | "events" | "files" | "activity";
const DETAIL_TABS: readonly DetailTab[] = ["overview", "events", "files", "activity"];
function parseTab(value: string | undefined): DetailTab {
  return (DETAIL_TABS as readonly string[]).includes(value ?? "")
    ? (value as DetailTab)
    : "overview";
}

type ActivityDbRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  entity_type: string;
  action: string;
  metadata: Record<string, unknown>;
};

type ProfileLookup = { id: string; full_name: string | null };

function parseStageList(value: string | undefined): OrderStage[] {
  if (!value) return [];
  const parts = value.split(",").map((s) => s.trim());
  return parts.filter((p): p is OrderStage =>
    (ORDER_STAGES as readonly string[]).includes(p),
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseContractorList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export const metadata = { title: "Orders · Stone & Design Board" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { org, role } = await getCurrentUserAndOrg();

  const view = searchParams.view === "board" ? "board" : "table";
  const stages = parseStageList(searchParams.stage);
  const contractorIds = parseContractorList(searchParams.contractor);
  const q = searchParams.q ?? "";
  const sort = searchParams.sort ?? "updated";
  const dir = searchParams.dir === "asc" ? "asc" : "desc";
  const page = Number.parseInt(searchParams.page ?? "1", 10) || 1;
  const boardView = view === "board";

  const pageSize = boardView ? 500 : 50;

  const [{ rows, total }, contractorOptions] = await Promise.all([
    listOrders(
      {
        stages,
        contractorIds,
        search: q,
        sort,
        dir,
        page: boardView ? 1 : page,
        pageSize,
      },
      org.timezone,
    ),
    listContractorsLite(false),
  ]);

  const showNewDialog = searchParams.new === "1";
  const detailOrderId = searchParams.order ?? null;
  const detailTab = parseTab(searchParams.tab);

  // Event dialog opened from the detail sheet's Events tab.
  const eventParam = searchParams.event ?? null;
  const showEventCreate = eventParam === "new";
  const editEventId = eventParam && UUID_RE.test(eventParam) ? eventParam : null;
  const showEventDialog = detailOrderId !== null && (showEventCreate || editEventId !== null);
  const sendEventId =
    searchParams.send && UUID_RE.test(searchParams.send) ? searchParams.send : null;

  const customers = showNewDialog ? await listCustomersLite() : [];

  let detailOrder = null;
  let attachments: AttachmentRow[] = [];
  let activity: ActivityRow[] = [];
  let photoUrls: Record<string, string> = {};
  let detailEvents: Awaited<ReturnType<typeof listEventsForOrder>> = [];
  let lastNotesEdit: Awaited<ReturnType<typeof getOrderDetail>>["lastNotesEdit"] = null;
  if (detailOrderId) {
    const supabase = createSupabaseServerClient();
    const [detailRes, attachmentRes, activityRes, eventsRes] = await Promise.all([
      getOrderDetail(detailOrderId, org.timezone),
      supabase
        .from("order_attachments")
        .select("id, storage_path, original_name, mime, size_bytes, kind, created_at")
        .eq("order_id", detailOrderId)
        .order("created_at", { ascending: false })
        .returns<AttachmentRow[]>(),
      supabase
        .from("activity_log")
        .select("id, created_at, actor_id, entity_type, action, metadata")
        .eq("entity_type", "order")
        .eq("entity_id", detailOrderId)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<ActivityDbRow[]>(),
      listEventsForOrder(detailOrderId),
    ]);
    detailOrder = detailRes.detail;
    detailEvents = eventsRes;
    lastNotesEdit = detailRes.lastNotesEdit;
    attachments = attachmentRes.data ?? [];

    const actorIds = Array.from(
      new Set(
        (activityRes.data ?? []).map((a) => a.actor_id).filter((x): x is string => Boolean(x)),
      ),
    );
    let actorNames = new Map<string, string | null>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds)
        .returns<ProfileLookup[]>();
      actorNames = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    }
    activity = (activityRes.data ?? []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorName: row.actor_id ? actorNames.get(row.actor_id) ?? null : null,
      entityType: row.entity_type,
      action: row.action,
      metadata: row.metadata,
    }));

    // Batch-sign URLs for every photo attachment so the gallery renders
    // thumbnails immediately. Non-image attachments (PDFs etc.) still use
    // the on-demand createSignedUrl path when the user clicks Download.
    const photoPaths = attachments
      .filter((a) => a.mime?.startsWith("image/"))
      .map((a) => a.storage_path);
    photoUrls = await createSignedUrls(photoPaths, 60 * 60);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <OrdersViewToggle />
      </header>

      <OrdersFilterBar contractorOptions={contractorOptions} />

      {boardView ? (
        <OrdersBoard rows={rows} currency={org.currency} />
      ) : (
        <OrdersTable
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          currency={org.currency}
          currentSort={sort}
          currentDir={dir}
        />
      )}

      {showNewDialog ? (
        <NewOrderDialog
          customers={customers}
          contractors={contractorOptions.filter((c) => c.isActive)}
          currency={org.currency}
        />
      ) : null}

      {detailOrderId ? (
        <OrderDetailSheet
          order={detailOrder}
          attachments={attachments}
          photoUrls={photoUrls}
          activity={activity}
          lastNotesEdit={lastNotesEdit}
          orgId={org.id}
          role={role}
          currency={org.currency}
          contractors={contractorOptions}
          events={detailEvents}
          defaultTab={detailTab}
          orgTimezone={org.timezone}
        />
      ) : null}

      {showEventDialog ? <EventDialogMount
        timeZone={org.timezone}
        editEventId={editEventId}
        detailOrderId={detailOrderId}
        initialDate={searchParams.date ?? null}
        initialTime={searchParams.time ?? null}
      /> : null}

      {sendEventId ? (
        <SendModalMount eventId={sendEventId} timeZone={org.timezone} />
      ) : null}
    </div>
  );
}

async function SendModalMount({
  eventId,
  timeZone,
}: {
  eventId: string;
  timeZone: string;
}) {
  const ctx = await getSendModalContext(eventId);
  if (!ctx) return null;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  return (
    <SendToCrewModal
      state={{
        eventId,
        timeZone,
        baseContext: {
          kind: ctx.event.kind,
          startsAt: ctx.event.startsAt,
          durationMin: ctx.event.durationMin,
          orderNumber: ctx.order.orderNumber,
          projectName: ctx.order.projectName,
          location: ctx.event.locationText,
          customerName: ctx.customer.name,
          customerPhone: ctx.customer.phone,
          stoneType: ctx.order.stoneType,
          edgeProfile: ctx.order.edgeProfile,
          sinkCutouts: ctx.order.sinkCutouts,
          cooktopCutouts: ctx.order.cooktopCutouts,
          notes: ctx.event.notes,
        },
        link: ctx.link
          ? {
              id: ctx.link.id,
              slug: ctx.link.slug,
              createdAt: ctx.link.createdAt,
              revokedAt: ctx.link.revokedAt,
              lastOpenedAt: ctx.link.lastOpenedAt,
            }
          : null,
        siteUrl,
      }}
    />
  );
}

async function EventDialogMount({
  timeZone,
  editEventId,
  detailOrderId,
  initialDate,
  initialTime,
}: {
  timeZone: string;
  editEventId: string | null;
  detailOrderId: string;
  initialDate: string | null;
  initialTime: string | null;
}) {
  const [orders, crew, editEvent] = await Promise.all([
    listOrdersForEventPicker(),
    listCrewLite(true),
    editEventId ? getEventForEdit(editEventId) : Promise.resolve(null),
  ]);
  return (
    <EventDialog
      mode={editEventId ? "edit" : "create"}
      timeZone={timeZone}
      orders={orders}
      crew={crew}
      initial={editEvent ?? undefined}
      initialDate={initialDate}
      initialTime={initialTime}
      initialOrderId={editEventId ? null : detailOrderId}
    />
  );
}
