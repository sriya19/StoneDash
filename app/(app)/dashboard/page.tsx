import {
  ClipboardCheck,
  Factory,
  Truck,
  Wallet,
} from "lucide-react";
import type { OrderStage } from "@prisma/client";

import { getCurrentUserAndOrg } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  project_name: string | null;
  scheduled_install_date: string | null;
  quote_amount: string | null;
  balance_due: string;
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const { org } = await getCurrentUserAndOrg();
  const supabase = createSupabaseServerClient();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sevenOut = new Date(today);
  sevenOut.setUTCDate(today.getUTCDate() + 7);

  const [ordersRes, activityRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, stage, project_name, scheduled_install_date, quote_amount, balance_due")
      .returns<OrderForKpis[]>(),
    supabase
      .from("activity_log")
      .select("id, created_at, actor_id, entity_type, action, metadata")
      .order("created_at", { ascending: false })
      .limit(15)
      .returns<ActivityDbRow[]>(),
  ]);

  const orders = ordersRes.data ?? [];
  const activity = activityRes.data ?? [];

  // KPI aggregates
  const inFabrication = orders.filter((o) => o.stage === "fabrication");
  const fabSum = inFabrication.reduce((s, o) => s + toNumber(o.quote_amount), 0);

  const installsThisWeek = orders
    .filter(
      (o) =>
        o.stage !== "cancelled" &&
        o.stage !== "paid" &&
        o.scheduled_install_date &&
        o.scheduled_install_date >= isoDate(today) &&
        o.scheduled_install_date <= isoDate(sevenOut),
    )
    .sort((a, b) =>
      (a.scheduled_install_date ?? "").localeCompare(b.scheduled_install_date ?? ""),
    );

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
          value={installsThisWeek.length.toString()}
          sublabel={
            installsThisWeek.length === 0
              ? "Nothing scheduled"
              : installsThisWeek
                  .slice(0, 3)
                  .map((o) => o.project_name ?? "Untitled")
                  .join(", ") +
                (installsThisWeek.length > 3
                  ? ` +${installsThisWeek.length - 3} more`
                  : "")
          }
          icon={Truck}
          href="/orders?stage=installation"
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
