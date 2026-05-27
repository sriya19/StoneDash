import {
  ClipboardCheck,
  Factory,
  Truck,
  Wallet,
} from "lucide-react";
import { addDays } from "date-fns";
import type { OrderStage } from "@prisma/client";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInTimeZone, parseLocalDateTime } from "@/lib/tz";
import { KpiCard } from "@/components/app/kpi-card";
import {
  PipelineStrip,
  STAGE_ORDER,
  type StageSummary,
} from "@/components/app/pipeline-strip";
import { ActivityFeed, type ActivityRow } from "@/components/app/activity-feed";

type OrderForKpis = {
  id: string;
  stage: OrderStage;
  quote_amount: string | null;
  balance_due: string;
};

type InstallEvent = {
  id: string;
  order_id: string;
  starts_at: string;
  project_name: string | null;
  stage: OrderStage;
  status: string;
};

type ActivityDbRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  entity_type: string;
  action: string;
  metadata: Record<string, unknown>;
};

type ProfileLookup = { id: string; full_name: string | null };

function toNumber(value: string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function DashboardPage() {
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  // "Installs this week" = events in [today 00:00 org-local, today+7 23:59 org-local],
  // expressed as UTC for the query (server-side timezone discipline).
  const todayDateStr = formatInTimeZone(new Date(), org.timezone, "yyyy-MM-dd");
  const sevenDateStr = formatInTimeZone(addDays(new Date(), 7), org.timezone, "yyyy-MM-dd");
  const todayStartUtc = parseLocalDateTime(todayDateStr, "00:00", org.timezone).toISOString();
  const sevenEndUtc = parseLocalDateTime(sevenDateStr, "23:59:59", org.timezone).toISOString();

  const [ordersRes, installsRes, activityRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, stage, quote_amount, balance_due")
      .returns<OrderForKpis[]>(),
    supabase
      .from("v_calendar_events")
      .select("id, order_id, starts_at, project_name, stage, status")
      .eq("kind", "install")
      .gte("starts_at", todayStartUtc)
      .lte("starts_at", sevenEndUtc)
      .not("status", "in", "(cancelled,no_show,complete)")
      .order("starts_at", { ascending: true })
      .returns<InstallEvent[]>(),
    supabase
      .from("activity_log")
      .select("id, created_at, actor_id, entity_type, action, metadata")
      .order("created_at", { ascending: false })
      .limit(15)
      .returns<ActivityDbRow[]>(),
  ]);

  const orders = ordersRes.data ?? [];
  const installEvents = (installsRes.data ?? []).filter(
    (e) => e.stage !== "cancelled" && e.stage !== "paid",
  );
  const activity = activityRes.data ?? [];

  // KPI aggregates
  const inFabrication = orders.filter((o) => o.stage === "fabrication");
  const fabSum = inFabrication.reduce((s, o) => s + toNumber(o.quote_amount), 0);

  const awaitingMeasurement = orders.filter(
    (o) => o.stage === "quote" || o.stage === "measurement",
  );

  const outstanding = orders
    .filter((o) => o.stage !== "paid" && o.stage !== "cancelled")
    .reduce((s, o) => s + toNumber(o.balance_due), 0);

  // Pipeline strip per-stage aggregates
  const summaries: StageSummary[] = STAGE_ORDER.map((stage) => {
    const rows = orders.filter((o) => o.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((s, r) => s + toNumber(r.quote_amount), 0),
    };
  });

  // Activity actors — fetch in one pass.
  const actorIds = Array.from(
    new Set(activity.map((a) => a.actor_id).filter((x): x is string => Boolean(x))),
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

  const activityItems: ActivityRow[] = activity.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorName: row.actor_id ? actorNames.get(row.actor_id) ?? null : null,
    entityType: row.entity_type,
    action: row.action,
    metadata: row.metadata,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {org.slug}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="In fabrication"
          value={inFabrication.length.toString()}
          sublabel={
            fabSum > 0 ? `${formatMoney(fabSum, org.currency)} quoted` : "No active jobs"
          }
          icon={Factory}
          href="/orders?stage=fabrication"
        />
        <KpiCard
          label="Installs this week"
          value={installEvents.length.toString()}
          sublabel={
            installEvents.length === 0
              ? "Nothing scheduled"
              : installEvents
                  .slice(0, 3)
                  .map((o) => o.project_name ?? "Untitled")
                  .join(", ") +
                (installEvents.length > 3
                  ? ` +${installEvents.length - 3} more`
                  : "")
          }
          icon={Truck}
          href="/schedule"
        />
        <KpiCard
          label="Awaiting measurement"
          value={awaitingMeasurement.length.toString()}
          sublabel={
            awaitingMeasurement.length === 0
              ? "Up to date"
              : `${awaitingMeasurement.length} in quote/measurement`
          }
          icon={ClipboardCheck}
          href="/orders?stage=measurement"
        />
        <KpiCard
          label="Outstanding balance"
          value={formatMoney(outstanding, org.currency)}
          sublabel={outstanding > 0 ? "Across unpaid orders" : "All collected"}
          icon={Wallet}
          href="/orders?stage=invoiced"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineStrip currency={org.currency} summaries={summaries} />
        </div>
        <div className="lg:col-span-1">
          <ActivityFeed items={activityItems} />
        </div>
      </div>
    </div>
  );
}
